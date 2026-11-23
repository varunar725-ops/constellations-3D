# 🌟 Celestial 3D — Interactive 3D Constellation Sky

A fully self-contained, dependency-free website that renders **all 88 constellations and 9,096 naked-eye stars in 3D**, computed for **any place on Earth at any moment in time** — past, present, or future.

The sky is projected around the observer: constellation stick figures, named stars, the Milky Way band, and a horizon ring are all positioned by real astronomy (sidereal time + precession + your coordinates), not by a static image.

![theme](https://img.shields.io/badge/theme-black%20%2F%20white%20%2F%20red%20%2F%20blue-ff3b30)
![deps](https://img.shields.io/badge/dependencies-none-4f8cff)
![data](https://img.shields.io/badge/stars-9096%20%2F%2088%20constellations-7db0ff)

---

## 🌐 View the live website

👉 **[**Open Celestial 3D — 3D Constellation Sky**](https://varunar725-ops.github.io/constellations-3D/)**

---

## ✨ Features

- **3D sky from the viewer's location** — The full celestial sphere is rendered around you. Drag to look around, scroll to zoom, and slide the **View mode** control to fly from an immersive *inside-the-sky* view out to an outside *sky globe*.
- **Any time, past or future** — Pick any date and time with the built-in picker, or use the quick buttons: **Now · Yesterday · Tomorrow · −1 h · +1 h · −1 day · +1 day**. A **Play** button fast-forwards the sky rotation so you can watch constellations wheel across the sky.
- **Location by permission or by hand** — The **"Use my location"** button requests browser location services. If permission is denied (or unavailable), enter **latitude / longitude manually**, or pick from the built-in city presets.
- **Complete constellation set** — All 88 IAU constellations drawn as their standard stick figures, with names, plus the brightest ~120 named stars labelled.
- **Live star data** — Hover any star to see its name, magnitude, constellation, altitude and azimuth; the hovered constellation is highlighted.
- **Extra layers** — Toggle constellation lines, constellation names, star names, below-horizon stars, and a soft Milky Way band.
- **Zero dependencies** — No frameworks, no CDN, no network calls. Everything (including the star catalogue) is bundled, so it works offline once loaded.

## 🎨 Theme

| Colour | Use |
|---|---|
| **Black** | Background |
| **White** | Stars, text, UI accents |
| **Red** | Constellation lines, time controls |
| **Blue** | Highlights, hover states, location controls |

## 🚀 How to run

The site is static — serve the folder with any static file server.

**Option A — Python (built in):**

```bash
cd constellation-sky
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

**Option B — any static server:**

```bash
npx serve constellation-sky      # or: php -S localhost:8000
```

**Deploy to GitHub Pages:** push the folder to a repository, then enable *Settings → Pages → deploy from a branch* (choose the project root). The site will be live at your Pages address (e.g. `https://<user>.github.io/<repo>/`), and the link in the **"View the live website"** section at the top of this README points straight to it.

> **Note on location permission:** browsers only allow geolocation on secure contexts (`http://localhost` or `https://`). If you open `index.html` directly from disk (`file://`), the "Use my location" button will report that geolocation is unavailable — just enter coordinates manually, or serve the folder over HTTP as above.

## 🎮 How to use

| Action | Result |
|---|---|
| **Drag** on the sky | Look around (orbit the sky) |
| **Scroll wheel** | Zoom in / out (field of view) |
| **Click a star** | Centre the camera on that star |
| **Double-click** | Reset the view |
| **Space** | Play / pause the sky rotation |
| **Hover a star** | Tooltip: name, magnitude, constellation, Alt/Az |

**Left panel — Location:** request your browser location, type latitude/longitude, or choose a city preset.

**Right panel — Time:** set any sky moment, use the quick presets, or press **Play** to watch the sky rotate. The readouts show **Local Sidereal Time**, **UTC**, and the **Julian day** — the exact astronomical state behind the rendered sky.

**Bottom bar:** display toggles and the inside-sky ↔ sky-globe view slider.

## 🧠 How it works

### 1. Data

Two bundled datasets (no API calls at runtime):

- **`js/data/stars.js`** — the **Yale Bright Star Catalogue, 5th revised edition**: 9,096 stars to magnitude 6.5 with J2000 right ascension, declination, visual magnitude, and IAU names where they exist.
- **`js/data/constellations.js`** — the **88 constellation stick figures**: ordered lists of BSC (HR) star numbers to connect, one polyline per constellation.

### 2. Astronomy (all in `js/app.js`, no libraries)

For the chosen **moment** and **observer position**, every star is placed in the observer's sky:

1. **Julian day** from the selected date/time.
2. **Greenwich Mean Sidereal Time (GMST)** from the Meeus polynomial, then **Local Sidereal Time = GMST + observer's east longitude**.
3. **Precession** from the J2000 catalogue epoch to the selected date using the IAU 1976 (Newcomb) angles ζ, z, θ, applied as `v_date = Polar(z)·Rx(−θ)·Polar(ζ)·v_J2000` — so positions stay correct decades or centuries from J2000.
4. Each star's equatorial vector is rotated into the **local horizon frame** (east / north / up) from the observer's latitude, giving true **altitude and azimuth**.
5. Stars are placed on a 3D **celestial sphere** and rendered with a hand-written perspective camera on Canvas 2D (drag-to-orbit, perspective projection, depth fog, horizon occlusion when viewing the globe from outside).

The math is validated against reference values (GMST = 280.46061837° at J2000.0, a 360.9856°/day sidereal rate, and a geometric check of the precession matrix against the old equator ∩ ecliptic).

### 3. Rendering

- **Stars** — pre-rendered glow sprites, sized by magnitude, dimmed with distance and (optionally) hidden below the horizon.
- **Constellation lines** — the 750 standard segments drawn in red; the hovered constellation turns blue.
- **Milky Way** — a soft band along the galactic plane, denser toward the galactic centre.
- **Horizon ring** — the observer's altitude-0° great circle, drawn as a perspective ellipse.
- **Labels** — constellation names and bright-star names with collision avoidance.

## 📁 Project structure

```
constellation-sky/
├── index.html                 # page layout & control panels
├── styles.css                 # black / white / red / blue theme
├── README.md
├── js/
│   ├── app.js                 # astronomy, 3D renderer, camera, UI
│   └── data/
│       ├── stars.js           # 9,096 stars (Yale BSC5)
│       └── constellations.js  # 88 constellation figures
└── smoke_test.js              # headless test harness (Node) — optional
```

## 🔬 Testing

A headless smoke test boots the app with a mocked DOM/canvas and verifies boot, 40 render frames, all UI wiring, and error handling:

```bash
node smoke_test.js
```

## 📜 Credits & licences

- **Star data:** Yale Bright Star Catalogue, 5th revised edition (Hoffleit & Warren, 1991), NASA Astronomical Data Center, catalogue V/50.
- **Constellation figures:** [MarcvdSluys/ConstellationLines](https://github.com/MarcvdSluys/ConstellationLines) — **CC BY 4.0**.
- **Star names:** IAU Working Group on Star Names.
- **Code:** MIT — free to use, modify, and redistribute.

## ⚠️ Limitations

- Star positions are catalogue (J2000) positions with precession applied — no per-star proper motion, so very long-term (multi-millennium) views drift slightly.
- Atmospheric effects (twinkling, refraction, light pollution) are intentionally not simulated.
- Location services require a secure context (localhost or HTTPS).
