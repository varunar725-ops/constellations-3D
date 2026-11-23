// Headless smoke test: boots app.js with a mocked DOM/canvas, runs frames, checks math.
const fs = require('fs');
const path = require('path');

// ---------- mock DOM ----------
class ClassList {
  constructor() { this.set = new Set(); }
  add(c) { this.set.add(c); }
  remove(c) { this.set.delete(c); }
  contains(c) { return this.set.has(c); }
  toggle(c, force) {
    if (force === undefined) force = !this.set.has(c);
    if (force) this.set.add(c); else this.set.delete(c);
    return force;
  }
}
function makeEl(tag = 'div') {
  const el = {
    tagName: tag.toUpperCase(),
    style: {},
    dataset: {},
    value: '',
    textContent: '',
    innerHTML: '',
    offsetWidth: 100,
    offsetHeight: 30,
    classList: new ClassList(),
    listeners: {},
    options: [],
    addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); },
    click() { (this.listeners.click || []).forEach(f => f({})); },
    getContext() { return ctxStub; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 720 }; },
    setPointerCapture() {},
  };
  return el;
}
const ctxStub = new Proxy({
  canvas: { width: 0, height: 0 },
  globalAlpha: 1,
  setTransform() {}, fillRect() {}, fill() {}, stroke() {}, beginPath() {},
  moveTo() {}, lineTo() {}, arc() {}, fillText() {}, drawImage() {},
  measureText() { return { width: 20 }; },
  createRadialGradient() { return { addColorStop() {} }; },
}, { get(t, p) { return p in t ? t[p] : () => {}; }, set(t, p, v) { t[p] = v; return true; } });

const elements = {};
function getEl(id) {
  if (!elements[id]) elements[id] = makeEl();
  return elements[id];
}
const presetOptions = [
  ['', '— choose a city —'],
  ['12.9878,80.1403,Tambaram (Chennai), India', 'Tambaram (Chennai)'],
  ['13.0827,80.2707,Chennai, India', 'Chennai'],
  ['51.5072,-0.1276,London, UK', 'London'],
];
getEl('preset-city').options = presetOptions;

const _qsCache = {};
const docStub = {
  getElementById: getEl,
  createElement: () => makeEl('canvas'),
  querySelectorAll(sel) {
    if (_qsCache[sel]) return _qsCache[sel];
    const list = [];
    if (sel === '[data-time]') {
      for (const t of ['now', 'yesterday', 'tomorrow', '-1h', '+1h', '-1d', '+1d']) {
        const b = makeEl(); b.dataset.time = t; list.push(b);
      }
    }
    if (sel === '.toggle') {
      for (const t of ['lines', 'cnames', 'snames', 'below', 'mw']) {
        const b = makeEl(); b.dataset.toggle = t; list.push(b);
      }
    }
    _qsCache[sel] = list;
    return list;
  },
};

let rafCount = 0;
const winStub = {
  innerWidth: 1280,
  innerHeight: 720,
  devicePixelRatio: 1,
  navigator: {},
  listeners: {},
  addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); },
  requestAnimationFrame(fn) { if (rafCount++ < 40) fn(rafCount * 16); return rafCount; },
};

global.window = winStub;
global.document = docStub;
global.navigator = {};
global.requestAnimationFrame = winStub.requestAnimationFrame;

// ---------- load app ----------
eval(fs.readFileSync(path.join(__dirname, 'js/data/stars.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, 'js/data/constellations.js'), 'utf8'));
const appCode = fs.readFileSync(path.join(__dirname, 'js/app.js'), 'utf8');
eval(appCode);

// ---------- assertions ----------
let failures = 0;
function check(name, cond, extra = '') {
  if (cond) console.log('  ✓ ' + name);
  else { failures++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
}

console.log('Boot checks:');
check('9096 stars loaded', window.STAR_DATA.length === 9096);
check('88 constellations loaded', window.CONST_DATA.length === 88);
check('10 render frames ran without exception', rafCount >= 10);

// inspect internal state via re-eval trick: re-run a mini frame probe by calling into the
// module scope is not possible after eval in strict mode; instead check DOM side effects.
console.log('\nDOM side effects:');
check('location chip populated', /Tambaram/.test(getEl('chip-loc').textContent), getEl('chip-loc').textContent);
check('time chip populated', getEl('chip-time').textContent.length > 3, getEl('chip-time').textContent);
check('LST chip populated', /LST/.test(getEl('chip-lst').textContent), getEl('chip-lst').textContent);
check('sidereal readout populated', getEl('ro-lst').textContent.length > 4, getEl('ro-lst').textContent);
check('UTC readout populated', /UTC/.test(getEl('ro-utc').textContent), getEl('ro-utc').textContent);
check('JD readout populated', /^2\d\d\d/.test(getEl('ro-jd').textContent), getEl('ro-jd').textContent);
check('lat input filled', getEl('lat').value === '12.9878', getEl('lat').value);
check('lon input filled', getEl('lon').value === '80.1403', getEl('lon').value);
check('datetime input filled', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(getEl('datetime').value), getEl('datetime').value);

console.log('\nInteraction checks:');
// preset buttons
const timeBtns = docStub.querySelectorAll('[data-time]');
check('7 time preset buttons wired', timeBtns.length === 7);
// toggles
const toggles = docStub.querySelectorAll('.toggle');
check('5 display toggles wired', toggles.length === 5);
toggles[3].click(); // below-horizon on
check('toggle flips active class', toggles[3].classList.contains('active'));
// globe slider
const globeEl = getEl('globe');
globeEl.value = '100';
(globeEl.listeners.input || []).forEach(f => f({ target: globeEl }));
check('globe slider updates label', getEl('globe-label').textContent === 'Sky globe (outside)', getEl('globe-label').textContent);
// time preset click (yesterday)
timeBtns[1].click();
check('yesterday preset runs', true);
// play button
getEl('btn-play').click();
check('play button toggles', getEl('btn-play').classList.contains('btn-play-active'));
getEl('btn-play').click();
// preset city change
const sel = getEl('preset-city');
sel.value = '51.5072,-0.1276,London, UK';
(sel.listeners.change || []).forEach(f => f({ target: sel }));
check('city preset applies London', getEl('chip-loc').textContent.includes('London'), getEl('chip-loc').textContent);
// manual apply with bad coords
getEl('lat').value = '999';
getEl('lon').value = '0';
getEl('btn-apply').click();
check('invalid coords rejected', /Invalid/.test(getEl('geo-status').textContent), getEl('geo-status').textContent);
getEl('lat').value = '19.076';
getEl('lon').value = '72.8777';
getEl('btn-apply').click();
check('manual coords accepted', /Mumbai|Manual/.test(getEl('geo-status').textContent), getEl('geo-status').textContent);
// geolocation button without API
getEl('btn-geo').click();
check('geolocation absence handled gracefully', /not available|manually/i.test(getEl('geo-status').textContent), getEl('geo-status').textContent);

console.log(failures === 0 ? '\nALL CHECKS PASSED ✓' : `\n${failures} CHECK(S) FAILED ✗`);
process.exit(failures === 0 ? 0 : 1);
