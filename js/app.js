/* =====================================================================
   CELESTIAL 3D — 3D constellation sky
   - Renders all 88 constellations + 9,096 naked-eye stars as a 3D
     celestial sphere around the observer, computed for the observer's
     location and the chosen moment in time (past or future).
   - No external libraries: manual 3D projection on Canvas 2D.
   ===================================================================== */
'use strict';

const STAR_DATA   = window.STAR_DATA;
const CONST_DATA  = window.CONST_DATA;

const DEG = Math.PI / 180;
const R   = 1000;                 // celestial sphere radius (world units)
const UP_W = [0, 1, 0];           // world up = observer zenith

/* ---------------- data preparation ---------------- */
const nStars = STAR_DATA.length;
const e0 = new Float32Array(nStars * 3);          // equatorial unit vector, J2000
const sMag = new Float32Array(nStars);
const sName = new Array(nStars);
const sHR   = new Int32Array(nStars);

const hrIndex = new Map();
for (let i = 0; i < nStars; i++) {
  const s = STAR_DATA[i];
  hrIndex.set(s.hr, i);
  const ra = s.ra * DEG, dec = s.dec * DEG;
  const cd = Math.cos(dec);
  e0[i * 3]     = cd * Math.cos(ra);
  e0[i * 3 + 1] = Math.sin(dec);
  e0[i * 3 + 2] = cd * Math.sin(ra);
  sMag[i]  = s.mag;
  sName[i] = s.name || '';
  sHR[i]   = s.hr;
}

// star -> constellation (via the figure lines)
const starCon = new Int16Array(nStars).fill(-1);
const conStars = CONST_DATA.map(c => []);           // line star indices per constellation
for (let ci = 0; ci < CONST_DATA.length; ci++) {
  for (const line of CONST_DATA[ci].lines) {
    for (const hr of line) {
      const idx = hrIndex.get(hr);
      if (idx !== undefined) {
        starCon[idx] = ci;
        conStars[ci].push(idx);
      }
    }
  }
}
const conName = CONST_DATA.map(c => c.name);

// constellation label anchor = normalised centroid of its line stars (J2000 equatorial)
const conCentroid = [];
for (let ci = 0; ci < CONST_DATA.length; ci++) {
  const idxs = conStars[ci];
  let x = 0, y = 0, z = 0;
  for (const i of idxs) { x += e0[i*3]; y += e0[i*3+1]; z += e0[i*3+2]; }
  const m = Math.hypot(x, y, z) || 1;
  conCentroid.push([x / m, y / m, z / m]);
}

// stars eligible for name labels
const labelStars = [];
for (let i = 0; i < nStars; i++) {
  if (sName[i] && sMag[i] <= 2.4) labelStars.push(i);
}

/* ---------------- astronomy math ---------------- */
function julianDay(d) {
  return d.getTime() / 86400000 + 2440587.5;
}

// Greenwich mean sidereal time, degrees
// Meeus eq. 11.4: GMST(seconds) = 67310.54841 + (876600h + 8640184.812866s)·T + 0.093104·T² − 6.2e−6·T³
function gmstDeg(jd) {
  const T = (jd - 2451545.0) / 36525.0;
  let g = 67310.54841 + (876600 * 3600 + 8640184.812866) * T + 0.093104 * T * T - 6.2e-6 * T ** 3;
  g = ((g % 86400) + 86400) % 86400;          // seconds
  return g * 15 / 3600;                        // degrees
}

// Precession matrix J2000 -> mean equator/equinox of date (Newcomb/IAU1976)
// v_date = M · v_J2000  with  M = Polar(z) · Rx(-θ) · Polar(ζ)
// (frame convention: x = vernal equinox, y = celestial pole, z = RA 6h)
// Verified numerically: J2000 equinox -> RA 1.2816°, Dec 0.0062° per century,
// and the old pole -> RA 270.64°, Dec 89.44°, matching the geometric construction.
function precessionMatrix(jd) {
  const t = (jd - 2451545.0) / 36525.0;
  const zeta  = (2306.2181 * t + 0.30188 * t * t + 0.017998 * t ** 3) / 3600 * DEG;
  const z     = (2306.2181 * t + 1.09468 * t * t + 0.018203 * t ** 3) / 3600 * DEG;
  const theta = (2004.3109 * t - 0.42665 * t * t - 0.041833 * t ** 3) / 3600 * DEG;
  const cz = Math.cos(zeta), sz = Math.sin(zeta);
  const ct = Math.cos(theta), st = Math.sin(theta);
  const c2 = Math.cos(z),  s2 = Math.sin(z);
  return [
    c2 * cz - s2 * ct * sz,   s2 * st,              -c2 * sz - s2 * ct * cz,
    st * sz,                  ct,                   st * cz,
    s2 * cz + c2 * ct * sz,  -c2 * st,              -s2 * sz + c2 * ct * cz,
  ];
}

// apply row-major 3x3 matrix M to vector (x,y,z)
function mulM(M, x, y, z) {
  return [
    x * M[0] + y * M[1] + z * M[2],
    x * M[3] + y * M[4] + z * M[5],
    x * M[6] + y * M[7] + z * M[8],
  ];
}

function rotVec(v, k, a) {
  // Rodrigues rotation of v about unit axis k by angle a
  const c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  const kx = k[0], ky = k[1], kz = k[2];
  const vx = v[0], vy = v[1], vz = v[2];
  const kd = kx * vx + ky * vy + kz * vz;
  const cx = ky * vz - kz * vy, cy = kz * vx - kx * vz, cz = kx * vy - ky * vx;
  return [
    vx * c + cx * s + kx * t * kd,
    vy * c + cy * s + ky * t * kd,
    vz * c + cz * s + kz * t * kd,
  ];
}

/* ---------------- renderer state ---------------- */
const canvas = document.getElementById('sky');
const ctx = canvas.getContext('2d');

let W = 0, H = 0, CX = 0, CY = 0, focal = 0, dpr = 1;

// observer / time state
let obsLat = 12.9878, obsLon = 80.1403;          // degrees, east positive
let obsLabel = 'Tambaram, India';
let skyTime = new Date();

// camera state
let camF = norm([0, 0.35, 1]);                    // view direction (animated)
let camFTarget = [...camF];
let camD = 0;                                     // distance from centre (animated)
let fov = 62 * DEG;
let globeFrac = 0;                                // 0 = inside sky, 1 = outside globe

// display options
let showLines = true, showCNames = true, showSNames = true;
let showBelow = false, showMW = true;

// interaction
let playing = false;
let hoverIdx = -1, hoverCon = -1;
let mouse = { x: -9999, y: -9999, inside: false };
let dragging = false, dragStart = null;
let animTarget = null;                            // star index to centre on

/* ---------------- star sprites ---------------- */
function makeSprite(inner, mid, size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.35, mid);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.beginPath();
  g.arc(size/2, size/2, size/2, 0, Math.PI * 2);
  g.fill();
  return c;
}
const SPR_STAR  = makeSprite('rgba(255,255,255,1)', 'rgba(255,255,255,0.28)');
const SPR_BIG   = makeSprite('rgba(255,255,255,1)', 'rgba(190,215,255,0.35)');
const SPR_MW    = makeSprite('rgba(200,222,255,0.85)', 'rgba(90,130,220,0.22)');

/* ---------------- Milky Way band ---------------- */
// Galactic north pole (J2000): RA 192.85948°, Dec 27.12825°
const gPole = [
  Math.cos(27.12825 * DEG) * Math.cos(192.85948 * DEG),
  Math.sin(27.12825 * DEG),
  Math.cos(27.12825 * DEG) * Math.sin(192.85948 * DEG),
];
// Galactic centre: RA 266.4051°, Dec -28.9362°
const gCentre = [
  Math.cos(-28.9362 * DEG) * Math.cos(266.4051 * DEG),
  Math.sin(-28.9362 * DEG),
  Math.cos(-28.9362 * DEG) * Math.sin(266.4051 * DEG),
];
const gw = Math.hypot(...gPole);
gPole[0] /= gw; gPole[1] /= gw; gPole[2] /= gw;
// orthonormal basis in the galactic plane
let ga = [gPole[1], -gPole[0], 0].map(v => v);
const magA = Math.hypot(...ga) || 1;
ga = ga.map(v => v / magA);
const gb = [
  gPole[1] * ga[2] - gPole[2] * ga[1],
  gPole[2] * ga[0] - gPole[0] * ga[2],
  gPole[0] * ga[1] - gPole[1] * ga[0],
];
const MW_PTS = 420;
const mwEq = [];                                   // unit vectors along galactic equator
for (let i = 0; i < MW_PTS; i++) {
  const a = (i / MW_PTS) * Math.PI * 2;
  mwEq.push([
    Math.cos(a) * ga[0] + Math.sin(a) * gb[0],
    Math.cos(a) * ga[1] + Math.sin(a) * gb[1],
    Math.cos(a) * ga[2] + Math.sin(a) * gb[2],
  ]);
}

/* ---------------- projection scratch ---------------- */
const sxArr = new Float32Array(nStars);
const syArr = new Float32Array(nStars);
const visArr = new Uint8Array(nStars);
const upArr  = new Float32Array(nStars);
const wArrX  = new Float32Array(nStars);
const wArrY  = new Float32Array(nStars);
const wArrZ  = new Float32Array(nStars);

function norm(v) {
  const m = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / m, v[1] / m, v[2] / m];
}

/* ---------------- resize ---------------- */
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  CX = W / 2;
  CY = H / 2;
  focal = (H / 2) / Math.tan(fov / 2);
}
window.addEventListener('resize', resize);
resize();

/* ---------------- main render loop ---------------- */
let lastStatusTick = 0;

function frame(ts) {
  requestAnimationFrame(frame);

  // --- time animation ---
  if (playing) {
    skyTime = new Date(skyTime.getTime() + 1000 / 15);   // ~4x real time
    if (ts - lastStatusTick > 240) syncTimeUI();
  }

  // --- camera animation ---
  const k = 0.14;
  camF[0] += (camFTarget[0] - camF[0]) * k;
  camF[1] += (camFTarget[1] - camF[1]) * k;
  camF[2] += (camFTarget[2] - camF[2]) * k;
  camF = norm(camF);
  const camDTarget = globeFrac * 2.2 * R;
  camD += (camDTarget - camD) * k;
  focal = (H / 2) / Math.tan(fov / 2);

  // --- sky frame: time + location ---
  const jd = julianDay(skyTime);
  const lst = (gmstDeg(jd) + obsLon + 360) % 360;
  const lstR = lst * DEG;
  const phiR = obsLat * DEG;

  const M = precessionMatrix(jd);

  // local frame basis in equatorial coordinates
  const upE   = [Math.cos(phiR) * Math.cos(lstR), Math.sin(phiR), Math.cos(phiR) * Math.sin(lstR)];
  const eastE = [-Math.sin(lstR), 0, Math.cos(lstR)];
  const northE = cross(eastE, upE);

  // camera basis
  let upP = [UP_W[0] - camF[0] * (camF[0] * UP_W[0] + camF[1] * UP_W[1] + camF[2] * UP_W[2]),
             UP_W[1] - camF[1] * (camF[0] * UP_W[0] + camF[1] * UP_W[1] + camF[2] * UP_W[2]),
             UP_W[2] - camF[2] * (camF[0] * UP_W[0] + camF[1] * UP_W[1] + camF[2] * UP_W[2])];
  if (Math.hypot(...upP) < 0.002) {
    upP = [1, 0, 0];
    const d = camF[0];
    upP = [1 - camF[0] * d, -camF[1] * d, -camF[2] * d];
  }
  const axisH = norm(upP);
  const rCam = norm(cross(camF, axisH));
  const uCam = cross(rCam, camF);
  const C = [-camD * camF[0], -camD * camF[1], -camD * camF[2]];

  // occlusion threshold for globe (camera outside the sphere)
  const occlude = camD > R;
  const occThr = -R * R / camD;

  // ---- clear ----
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);
  // subtle vignette tint
  const bg = ctx.createRadialGradient(CX, CY * 0.9, 0, CX, CY, Math.max(W, H) * 0.75);
  bg.addColorStop(0, 'rgba(10, 18, 48, 0.55)');
  bg.addColorStop(0.6, 'rgba(3, 6, 16, 0.3)');
  bg.addColorStop(1, 'rgba(0, 0, 0, 0.85)');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // ---- project + draw stars ----
  ctx.globalCompositeOperation = 'lighter';

  for (let i = 0; i < nStars; i++) {
    const v = mulM(M, e0[i*3], e0[i*3+1], e0[i*3+2]);
    const x = v[0], y = v[1], z = v[2];

    const eastC = x * eastE[0] + y * eastE[1] + z * eastE[2];
    const upC   = x * upE[0]   + y * upE[1]   + z * upE[2];
    const northC= x * northE[0]+ y * northE[1]+ z * northE[2];

    const wx = eastC * R, wy = upC * R, wz = -northC * R;
    wArrX[i] = wx; wArrY[i] = wy; wArrZ[i] = wz;
    upArr[i] = upC;

    const vx = wx - C[0], vy = wy - C[1], vz = wz - C[2];
    const depth = vx * camF[0] + vy * camF[1] + vz * camF[2];
    if (depth <= 0.02 * R) { visArr[i] = 0; continue; }

    if (occlude && (wx * camF[0] + wy * camF[1] + wz * camF[2]) > occThr) {
      visArr[i] = 0; continue;
    }

    const sx = CX + (vx * rCam[0] + vy * rCam[1] + vz * rCam[2]) * focal / depth;
    const sy = CY - (vx * uCam[0] + vy * uCam[1] + vz * uCam[2]) * focal / depth;
    if (sx < -60 || sx > W + 60 || sy < -60 || sy > H + 60) { visArr[i] = 0; continue; }

    sxArr[i] = sx; syArr[i] = sy; visArr[i] = 1;

    // brightness: magnitude + depth fog + horizon dimming
    const mag = sMag[i];
    let alpha = 1 - (mag - 0) / 9.5;
    alpha = Math.max(0.12, Math.min(1, alpha));
    const depthT = Math.min(1, depth / (camD + R));
    alpha *= 0.42 + 0.58 * Math.pow(depthT, 0.7);
    if (upC < 0 && !showBelow) alpha *= 0.12;

    const radius = Math.max(0.5, (7.5 - 1.6 * mag) * focal / depth);
    if (mag <= 1.4 && radius > 2.2) {
      // bright star: glow + core
      ctx.globalAlpha = alpha * 0.35;
      ctx.drawImage(SPR_BIG, sx - radius * 2.6, sy - radius * 2.6, radius * 5.2, radius * 5.2);
      ctx.globalAlpha = alpha;
      ctx.drawImage(SPR_BIG, sx - radius * 1.7, sy - radius * 1.7, radius * 3.4, radius * 3.4);
    } else if (radius > 1.7) {
      ctx.globalAlpha = alpha;
      ctx.drawImage(SPR_STAR, sx - radius * 2.2, sy - radius * 2.2, radius * 4.4, radius * 4.4);
    } else {
      ctx.globalAlpha = Math.min(1, alpha * 1.4);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(sx - 0.7, sy - 0.7, 1.4, 1.4);
    }
    ctx.globalAlpha = 1;
  }

  // ---- Milky Way band ----
  if (showMW) {
    for (const p of mwEq) {
      const v = mulM(M, p[0], p[1], p[2]);
      const x = v[0], y = v[1], z = v[2];
      const eastC = x * eastE[0] + y * eastE[1] + z * eastE[2];
      const upC   = x * upE[0]   + y * upE[1]   + z * upE[2];
      const northC= x * northE[0]+ y * northE[1]+ z * northE[2];
      const wx = eastC * R, wy = upC * R, wz = -northC * R;
      const vx = wx - C[0], vy = wy - C[1], vz = wz - C[2];
      const depth = vx * camF[0] + vy * camF[1] + vz * camF[2];
      if (depth <= 0.02 * R) continue;
      if (occlude && (wx * camF[0] + wy * camF[1] + wz * camF[2]) > occThr) continue;

      const sx = CX + (vx * rCam[0] + vy * rCam[1] + vz * rCam[2]) * focal / depth;
      const sy = CY - (vx * uCam[0] + vy * uCam[1] + vz * uCam[2]) * focal / depth;
      if (sx < -80 || sx > W + 80 || sy < -80 || sy > H + 80) continue;

      // density weight: brighter toward the galactic centre (both J2000 vectors)
      const gd = gCentre[0] * p[0] + gCentre[1] * p[1] + gCentre[2] * p[2]; // cos angle from centre
      const w = 0.45 + 0.55 * Math.max(0, gd);

      let a = 0.10 + 0.16 * w;
      if (upC < 0 && !showBelow) a *= 0.3;
      const s = (55 + 50 * w) * focal / depth;
      ctx.globalAlpha = a;
      ctx.drawImage(SPR_MW, sx - s / 2, sy - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
  }

  ctx.globalCompositeOperation = 'source-over';

  // ---- horizon ring (alt = 0 great circle) ----
  if (camD < R * 1.05) {
    ctx.strokeStyle = 'rgba(125, 176, 255, 0.38)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    let started = false;
    for (let k2 = 0; k2 <= 96; k2++) {
      const az = (k2 / 96) * Math.PI * 2;
      const wx = Math.cos(az) * R, wy = 0, wz = -Math.sin(az) * R;
      const vx = wx - C[0], vy = wy - C[1], vz = wz - C[2];
      const depth = vx * camF[0] + vy * camF[1] + vz * camF[2];
      if (depth <= 0.02 * R) { started = false; continue; }
      const sx = CX + (vx * rCam[0] + vy * rCam[1] + vz * rCam[2]) * focal / depth;
      const sy = CY - (vx * uCam[0] + vy * uCam[1] + vz * uCam[2]) * focal / depth;
      if (!started) { ctx.moveTo(sx, sy); started = true; }
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
  }

  // ---- constellation lines ----
  if (showLines) {
    for (let ci = 0; ci < CONST_DATA.length; ci++) {
      const idxs = conStars[ci];
      const highlighted = hoverCon === ci;
      const dimmed = hoverCon >= 0 && !highlighted;
      let a = highlighted ? 0.95 : dimmed ? 0.22 : 0.5;
      ctx.strokeStyle = highlighted
        ? 'rgba(93, 169, 255, ' + a + ')'
        : 'rgba(255, 59, 48, ' + a + ')';
      ctx.lineWidth = highlighted ? 2.2 : 1.1;
      ctx.beginPath();
      for (let li = 0; li < CONST_DATA[ci].lines.length; li++) {
        const line = CONST_DATA[ci].lines[li];
        let prev = -1;
        for (const hr of line) {
          const i = hrIndex.get(hr);
          if (i === undefined || !visArr[i]) { prev = -1; continue; }
          if (prev >= 0) {
            ctx.moveTo(sxArr[prev], syArr[prev]);
            ctx.lineTo(sxArr[i], syArr[i]);
          }
          prev = i;
        }
      }
      ctx.stroke();
    }
  }

  // ---- hover star ring ----
  if (hoverIdx >= 0 && visArr[hoverIdx]) {
    ctx.strokeStyle = 'rgba(125, 176, 255, 0.95)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(sxArr[hoverIdx], syArr[hoverIdx], 9, 0, Math.PI * 2);
    ctx.stroke();
  }

  // ---- labels ----
  const drawnRects = [];
  function placeLabel(text, x, y, fontSize, color, padX = 4, padY = 2) {
    ctx.font = fontSize + 'px "Segoe UI", Roboto, sans-serif';
    const w = ctx.measureText(text).width;
    for (const r of drawnRects) {
      if (x - padX < r.x + r.w && x + w + padX > r.x &&
          y - fontSize * 1.1 - padY < r.y + r.h && y + fontSize * 0.4 + padY > r.y) return;
    }
    drawnRects.push({ x: x - padX, y: y - fontSize * 1.1 - padY, w: w + 2 * padX, h: fontSize * 1.5 + 2 * padY });
    ctx.fillStyle = 'rgba(2, 4, 12, 0.6)';
    ctx.fillRect(x - padX, y - fontSize * 1.1 - padY, w + 2 * padX, fontSize * 1.5 + 2 * padY);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  if (showCNames) {
    for (let ci = 0; ci < CONST_DATA.length; ci++) {
      const p = conCentroid[ci];
      const v = mulM(M, p[0], p[1], p[2]);
      const x = v[0], y = v[1], z = v[2];
      const eastC = x * eastE[0] + y * eastE[1] + z * eastE[2];
      const upC   = x * upE[0]   + y * upE[1]   + z * upE[2];
      const northC= x * northE[0]+ y * northE[1]+ z * northE[2];
      const wx = eastC * R, wy = upC * R, wz = -northC * R;
      const vx = wx - C[0], vy = wy - C[1], vz = wz - C[2];
      const depth = vx * camF[0] + vy * camF[1] + vz * camF[2];
      if (depth <= 0.02 * R) continue;
      if (occlude && (wx * camF[0] + wy * camF[1] + wz * camF[2]) > occThr) continue;
      const sx = CX + (vx * rCam[0] + vy * rCam[1] + vz * rCam[2]) * focal / depth;
      const sy = CY - (vx * uCam[0] + vy * uCam[1] + vz * uCam[2]) * focal / depth;
      if (sx < -120 || sx > W + 120 || sy < -60 || sy > H + 60) continue;
      const dim = hoverCon >= 0 && hoverCon !== ci ? 0.3 : 1;
      ctx.globalAlpha = dim;
      placeLabel(conName[ci], sx + 6, sy - 4, 11,
        hoverCon === ci ? '#7db0ff' : 'rgba(238, 243, 255, 0.85)');
      ctx.globalAlpha = 1;
    }
  }

  if (showSNames) {
    for (const i of labelStars) {
      if (!visArr[i]) continue;
      const dim = hoverCon >= 0 && starCon[i] !== hoverCon ? 0.25 : 1;
      ctx.globalAlpha = dim;
      placeLabel(sName[i], sxArr[i] + 8, syArr[i] - 4, 10,
        'rgba(230, 238, 255, 0.8)');
      ctx.globalAlpha = 1;
    }
  }

  // ---- hover detection ----
  hoverIdx = -1;
  if (mouse.inside) {
    let best = 15 * 15, bestI = -1;
    for (let i = 0; i < nStars; i++) {
      if (!visArr[i]) continue;
      const dx = sxArr[i] - mouse.x, dy = syArr[i] - mouse.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < best) { best = d2; bestI = i; }
    }
    hoverIdx = bestI;
    hoverCon = bestI >= 0 ? starCon[bestI] : -1;
  } else {
    hoverCon = -1;
  }
  updateTooltip();

  // ---- status readouts ----
  if (ts - lastStatusTick > 200) {
    lastStatusTick = ts;
    updateStatus(lst);
  }
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/* ---------------- tooltip ---------------- */
const tooltipEl = document.getElementById('tooltip');
function updateTooltip() {
  if (hoverIdx < 0 || !mouse.inside) {
    tooltipEl.style.display = 'none';
    return;
  }
  const i = hoverIdx;
  const alt = Math.asin(Math.max(-1, Math.min(1, upArr[i]))) / DEG;
  let az = Math.atan2(wArrX[i], -wArrZ[i]) / DEG;
  az = ((az % 360) + 360) % 360;
  const cname = starCon[i] >= 0 ? conName[starCon[i]] : '—';
  tooltipEl.innerHTML =
    '<b>' + (sName[i] || 'HR ' + sHR[i]) + '</b><br>' +
    '<span class="con">' + cname + '</span> · <span class="mag">mag ' + sMag[i].toFixed(2) + '</span><br>' +
    'Alt <b>' + alt.toFixed(1) + '°</b> · Az <b>' + az.toFixed(1) + '°</b>';
  tooltipEl.style.display = 'block';
  const tw = tooltipEl.offsetWidth, th = tooltipEl.offsetHeight;
  let tx = mouse.x, ty = mouse.y;
  if (tx + tw + 28 > W) tx = mouse.x - tw - 28;
  if (ty + th + 28 > H) ty = mouse.y - th - 28;
  tooltipEl.style.left = tx + 'px';
  tooltipEl.style.top = ty + 'px';
}

/* ---------------- status chips ---------------- */
function pad(v, w = 2) { return String(Math.floor(v)).padStart(w, '0'); }
function fmtSkyTime(d) {
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function updateStatus(lst) {
  document.getElementById('chip-loc').textContent =
    '📍 ' + obsLabel + ' · ' + obsLat.toFixed(2) + '° ' + (obsLat >= 0 ? 'N' : 'S') +
    ' ' + Math.abs(obsLon).toFixed(2) + '° ' + (obsLon >= 0 ? 'E' : 'W');
  document.getElementById('chip-time').textContent = '🕒 ' + fmtSkyTime(skyTime);
  const h = Math.floor(lst / 15), m = Math.floor((lst / 15) % 1 * 60), s = Math.floor((lst % 15) * 4);
  document.getElementById('chip-lst').textContent = '🌍 LST ' + pad(h) + ':' + pad(m) + ':' + pad(s);
  document.getElementById('ro-lst').textContent = pad(h) + ':' + pad(m) + ':' + pad(s);
  const u = skyTime.toISOString();
  document.getElementById('ro-utc').textContent = u.slice(0, 16).replace('T', ' ') + ' UTC';
  document.getElementById('ro-jd').textContent = julianDay(skyTime).toFixed(3);
}

function syncTimeUI() {
  const d = skyTime;
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  document.getElementById('datetime').value =
    local.getFullYear() + '-' + pad(local.getMonth() + 1) + '-' + pad(local.getDate()) +
    'T' + pad(local.getHours()) + ':' + pad(local.getMinutes());
  updateStatus(gmstDeg(julianDay(skyTime)) + obsLon);
}

/* ---------------- camera control ---------------- */
function setViewDir(f) {
  // clamp pitch: never look more than ~20° below the horizontal
  const f2 = norm(f);
  if (f2[1] < -0.35) {
    const hz = Math.hypot(f2[0], f2[2]) || 1;
    f2[0] /= hz;
    f2[2] /= hz;
    f2[1] = -0.35;
  }
  camFTarget = norm(f2);
}

canvas.addEventListener('pointerdown', e => {
  dragging = true;
  dragStart = { x: e.clientX, y: e.clientY };
  canvas.classList.add('dragging');
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  const rect = canvas.getBoundingClientRect();
  mouse.x = e.clientX - rect.left;
  mouse.y = e.clientY - rect.top;
  mouse.inside = true;
  if (!dragging) return;
  const dx = e.clientX - dragStart.x;
  const dy = e.clientY - dragStart.y;
  dragStart = { x: e.clientX, y: e.clientY };

  const axisH = norm([
    UP_W[0] - camF[0] * (camF[0] * UP_W[0] + camF[1] * UP_W[1] + camF[2] * UP_W[2]),
    UP_W[1] - camF[1] * (camF[0] * UP_W[0] + camF[1] * UP_W[1] + camF[2] * UP_W[2]),
    UP_W[2] - camF[2] * (camF[0] * UP_W[0] + camF[1] * UP_W[1] + camF[2] * UP_W[2]),
  ]);
  if (Math.hypot(...axisH) < 0.002) {
    const d = camF[0];
    axisH[0] = 1 - camF[0] * d; axisH[1] = -camF[1] * d; axisH[2] = -camF[2] * d;
  }
  let f = rotVec(camFTarget, axisH, -dx * 0.005);
  const axisV = norm(cross(f, axisH));
  f = rotVec(f, axisV, dy * 0.005);
  setViewDir(f);
});
canvas.addEventListener('pointerup', e => {
  dragging = false;
  canvas.classList.remove('dragging');
});
canvas.addEventListener('pointerleave', () => {
  mouse.inside = false;
});

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  fov = Math.max(20 * DEG, Math.min(110 * DEG, fov + e.deltaY * 0.04 * DEG));
  document.getElementById('zoom-label').textContent = 'Zoom ' + Math.round(fov / DEG) + '°';
}, { passive: false });

canvas.addEventListener('dblclick', () => {
  camFTarget = norm([0, 0.35, 1]);
});

canvas.addEventListener('click', e => {
  if (Math.hypot(e.movementX || 0, e.movementY || 0) > 2) return; // ignore click after drag
  if (hoverIdx >= 0 && visArr[hoverIdx]) {
    // centre the camera on the clicked star
    const wx = wArrX[hoverIdx], wy = wArrY[hoverIdx], wz = wArrZ[hoverIdx];
    setViewDir([wx, wy, wz]);
  }
});

/* ---------------- location UI ---------------- */
const geoBtn = document.getElementById('btn-geo');
const geoStatus = document.getElementById('geo-status');
geoBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    geoStatus.textContent = 'Geolocation is not available in this browser/context. Enter coordinates manually below.';
    return;
  }
  geoStatus.textContent = 'Requesting location permission…';
  geoBtn.disabled = true;
  navigator.geolocation.getCurrentPosition(
    pos => {
      geoBtn.disabled = false;
      obsLat = pos.coords.latitude;
      obsLon = pos.coords.longitude;
      obsLabel = nearestPreset(obsLat, obsLon) || 'My location';
      applyLocationToInputs();
      syncTimeUI();
      geoStatus.textContent = 'Using your browser location: ' + obsLabel +
        ' (' + obsLat.toFixed(3) + ', ' + obsLon.toFixed(3) + ').';
    },
    err => {
      geoBtn.disabled = false;
      geoStatus.textContent = err.code === err.PERMISSION_DENIED
        ? 'Location permission denied — no problem, enter latitude and longitude manually below.'
        : 'Could not get location (' + err.message + '). Enter coordinates manually below.';
    },
    { enableHighAccuracy: false, timeout: 15000 }
  );
});

function nearestPreset(lat, lon) {
  let best = null, bestD = 0.6;
  for (const opt of document.getElementById('preset-city').options) {
    if (!opt.value) continue;
    const [la, lo] = opt.value.split(',');
    const d = Math.hypot(parseFloat(la) - lat, parseFloat(lo) - lon);
    if (d < bestD) { bestD = d; best = opt.textContent; }
  }
  return best;
}

function applyLocationToInputs() {
  document.getElementById('lat').value = obsLat.toFixed(4);
  document.getElementById('lon').value = obsLon.toFixed(4);
}

document.getElementById('btn-apply').addEventListener('click', () => {
  const lat = parseFloat(document.getElementById('lat').value);
  const lon = parseFloat(document.getElementById('lon').value);
  if (isNaN(lat) || lat < -90 || lat > 90 || isNaN(lon) || lon < -180 || lon > 180) {
    geoStatus.textContent = 'Invalid coordinates — latitude must be −90…90 and longitude −180…180.';
    return;
  }
  obsLat = lat;
  obsLon = lon;
  obsLabel = nearestPreset(lat, lon) || 'Manual location';
  syncTimeUI();
  geoStatus.textContent = 'Location set: ' + obsLabel + ' (' + lat.toFixed(3) + ', ' + lon.toFixed(3) + ').';
});

document.getElementById('preset-city').addEventListener('change', e => {
  if (!e.target.value) return;
  const [lat, lon, label] = e.target.value.split(',');
  obsLat = parseFloat(lat);
  obsLon = parseFloat(lon);
  obsLabel = label;
  applyLocationToInputs();
  syncTimeUI();
});

/* ---------------- time UI ---------------- */
const dtInput = document.getElementById('datetime');
dtInput.addEventListener('change', () => {
  if (!dtInput.value) return;
  const d = new Date(dtInput.value);
  if (!isNaN(d.getTime())) {
    skyTime = d;
    updateStatus(gmstDeg(julianDay(skyTime)) + obsLon);
  }
});

document.querySelectorAll('[data-time]').forEach(btn => {
  btn.addEventListener('click', () => {
    const now = Date.now();
    const sky = skyTime.getTime();
    let t;
    switch (btn.dataset.time) {
      case 'now':     t = now; break;
      case 'yesterday': t = now - 24 * 3600 * 1000; break;
      case 'tomorrow':  t = now + 24 * 3600 * 1000; break;
      case '-1h':     t = sky - 3600 * 1000; break;
      case '+1h':     t = sky + 3600 * 1000; break;
      case '-1d':     t = sky - 24 * 3600 * 1000; break;
      case '+1d':     t = sky + 24 * 3600 * 1000; break;
    }
    skyTime = new Date(t);
    syncTimeUI();
  });
});

const playBtn = document.getElementById('btn-play');
playBtn.addEventListener('click', () => {
  playing = !playing;
  playBtn.textContent = playing ? '⏸ Pause sky rotation' : '▶ Play sky rotation';
  playBtn.classList.toggle('btn-play-active', playing);
});

window.addEventListener('keydown', e => {
  if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT') {
    e.preventDefault();
    playBtn.click();
  }
});

/* ---------------- display toggles ---------------- */
document.querySelectorAll('.toggle').forEach(t => {
  t.addEventListener('click', () => {
    t.classList.toggle('active');
    const on = t.classList.contains('active');
    switch (t.dataset.toggle) {
      case 'lines':  showLines = on; break;
      case 'cnames': showCNames = on; break;
      case 'snames': showSNames = on; break;
      case 'below':  showBelow = on; break;
      case 'mw':     showMW = on; break;
    }
  });
});

document.getElementById('globe').addEventListener('input', e => {
  globeFrac = e.target.value / 100;
  const txt = globeFrac < 0.08 ? 'Inside sky'
            : globeFrac > 0.92 ? 'Sky globe (outside)'
            : 'Approaching globe';
  document.getElementById('globe-label').textContent = txt;
});

/* ---------------- boot ---------------- */
applyLocationToInputs();
syncTimeUI();
requestAnimationFrame(frame);
