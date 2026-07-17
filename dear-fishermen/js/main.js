// Dear Fishermen — core engine (game loop, state, input, time, camera, save).
// Designed by Eidan, age 12. This file is the CONTRACT: modules plug into G.
import * as THREE from '../lib/three.module.min.js';
import * as world from './world.js';
import * as boat from './boat.js';
import * as characters from './characters.js';
import * as sea from './sea.js';
import * as fishing from './fishing.js';
import * as threats from './threats.js';
import * as economy from './economy.js';
import * as hud from './hud.js';
import * as map from './map.js';
import * as audio from './audio.js';

const MODULES = { world, boat, characters, sea, fishing, threats, economy, hud, map, audio };
const SAVE_KEY = 'dear-fishermen-v1';
export const DAY_SEC = 600;   // 10 min of daylight (Eidan's spec)
export const NIGHT_SEC = 600; // 10 min of night
const FULL_DAY = DAY_SEC + NIGHT_SEC;
const DAYS_PER_WEEK = 7;
const RUN_WEEKS = 3;

// ---------------------------------------------------------------- three setup
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('game').appendChild(renderer.domElement);

// Pixelated "A Short Hike" look (Eidan's request): render small, upscale with chunky pixels.
let pixelMode = true;
try { pixelMode = (localStorage.getItem('df-pixel') ?? '1') === '1'; } catch (e) { /* storage blocked (Safari private): default pixel */ }
function applyPixelLook() {
  const ratio = pixelMode
    ? Math.min(0.5, Math.max(0.2, 340 / window.innerHeight)) // ~340px tall internal render
    : Math.min(window.devicePixelRatio, 1.5);
  renderer.setPixelRatio(ratio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.domElement.style.imageRendering = pixelMode ? 'pixelated' : 'auto';
}
applyPixelLook();
function togglePixel() {
  pixelMode = !pixelMode;
  try { localStorage.setItem('df-pixel', pixelMode ? '1' : '0'); } catch (e) {}
  applyPixelLook();
  G.ui?.toast(pixelMode ? 'Pixel mode 👾' : 'Smooth mode ✨');
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 3000);
camera.position.set(0, 26, 42);
camera.lookAt(0, 0, 0);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  applyPixelLook();
});

// ---------------------------------------------------------------- event bus
const listeners = new Map();
function on(name, fn) {
  if (!listeners.has(name)) listeners.set(name, []);
  listeners.get(name).push(fn);
}
function emit(name, data) {
  const fns = listeners.get(name);
  if (!fns) return;
  for (const fn of fns) {
    try { fn(data); } catch (err) { console.error(`[bus:${name}]`, err); }
  }
}

// ---------------------------------------------------------------- rng (seeded)
let rngState = 20260717;
function rng() {
  rngState |= 0; rngState = (rngState + 0x6D2B79F5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------- shared state
const G = {
  THREE, scene, camera, renderer,
  state: 'title',
  cameraMode: 'third',        // 'third' | 'first' (solo only; V / 👁️ toggles — Eidan's request)
  time: { week: 1, day: 1, phase: 'day', dayFrac: 0, secToday: 0, total: 0 },
  timeScale: 1,
  legacy: false,
  flags: {},                  // shared scratch: threats sets flags.bossActive, etc.
  cameraFocus: null,          // null | { target: Object3D|Vector3, dist, height } — threats may override
  consts: {
    HARBOR: { x: 0, z: 60 }, // dock position; world.js builds it here
    DAY_SEC, NIGHT_SEC, FULL_DAY, RUN_WEEKS,
  },
  input: {
    p1: mkPad(), p2: mkPad(),
    p2Active: false,
    touchActive: false,
    touchState: { x: 0, z: 0, action: false, secondary: false, jump: false }, // hud.js writes
  },
  emit, on, rng,
  // Filled by modules during init (see GDD.md §7):
  ocean: null, weather: null, zoneAt: null,          // world.js
  boat: null,                                        // boat.js
  players: [], nearestStation: null,                 // characters.js
  fishdex: null, hold: null, biggestCatch: null,     // fishing.js
  money: 0, upgrades: { rod: 1, harpoon: 1, hull: 1, engine: 1, hats: [] }, // economy.js manages
  ui: null,                                          // hud.js
  sfx: () => {}, music: () => {},                    // audio.js replaces
  setState, save, load, wipeSave, hasSave,
};

function mkPad() {
  return { x: 0, z: 0, action: false, secondary: false, jump: false, helm: false,
           actionHit: false, secondaryHit: false, jumpHit: false, helmHit: false };
}

// ---------------------------------------------------------------- state machine
function setState(next) {
  const prev = G.state;
  if (prev === next) return;
  G.state = next;
  emit('state:change', { from: prev, to: next });
}

// ---------------------------------------------------------------- save / load
function save() {
  const data = { version: 1, savedAt: G.time.total };
  data.time = { week: G.time.week, day: G.time.day, secToday: G.time.secToday, total: G.time.total };
  data.legacy = G.legacy;
  emit('save:collect', data); // modules add their slices (economy: money/upgrades, fishing: hold, boat: hull…)
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch (e) { /* private mode: ignore */ }
}
function hasSave() {
  try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
}
function load() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) {}
  if (!data) return false;
  Object.assign(G.time, data.time);
  G.time.phase = G.time.secToday < DAY_SEC ? 'day' : 'night';
  G.time.dayFrac = G.time.secToday / FULL_DAY;
  G.legacy = !!data.legacy;
  emit('save:apply', data);
  return true;
}
function wipeSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
}

// ---------------------------------------------------------------- input
const KEYMAP = {
  p1: { KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
        KeyE: 'action', KeyQ: 'secondary', Space: 'jump', KeyF: 'helm' },
  p2: { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
        Period: 'action', Comma: 'secondary', ShiftRight: 'jump' },
};
// Fallback for keyboards/dispatchers that send ev.key but an empty ev.code
const KEYMAP_BYKEY = {
  p1: { w: 'up', s: 'down', a: 'left', d: 'right', e: 'action', q: 'secondary', ' ': 'jump', f: 'helm' },
  p2: { arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right', '.': 'action', ',': 'secondary' },
};
function actFor(pid, ev) {
  return KEYMAP[pid][ev.code] || (!ev.code ? KEYMAP_BYKEY[pid][(ev.key || '').toLowerCase()] : undefined);
}
const held = { p1: {}, p2: {} };
const hits = { p1: {}, p2: {} };

window.addEventListener('keydown', (ev) => {
  if (ev.repeat) return;
  for (const pid of ['p1', 'p2']) {
    const act = actFor(pid, ev);
    if (!act) continue;
    if (pid === 'p2' && !G.input.p2Active) { G.input.p2Active = true; emit('p2:join', {}); }
    held[pid][act] = true;
    hits[pid][act] = true;
    if (['jump', 'action', 'secondary', 'up', 'down', 'left', 'right'].includes(act)) ev.preventDefault();
  }
  if (ev.code === 'Escape') {
    if (G.state === 'playing') setState('paused');
    else if (G.state === 'paused') setState('playing');
  }
  if (ev.code === 'KeyV' || (!ev.code && ev.key?.toLowerCase?.() === 'v')) togglePov();
  if (ev.code === 'KeyG' || (!ev.code && ev.key?.toLowerCase?.() === 'g')) togglePixel();
  if (ev.code === 'KeyC' || (!ev.code && ev.key?.toLowerCase?.() === 'c')) resetCam();
});
window.addEventListener('keyup', (ev) => {
  for (const pid of ['p1', 'p2']) {
    const act = actFor(pid, ev);
    if (act) held[pid][act] = false;
  }
});
// Focus loss eats keyup events — clear held keys so nobody marches overboard on their own.
const clearHeld = () => { held.p1 = {}; held.p2 = {}; hits.p1 = {}; hits.p2 = {}; };
window.addEventListener('blur', clearHeld);
document.addEventListener('visibilitychange', () => { if (document.hidden) clearHeld(); });
window.addEventListener('pointerdown', () => {}, { passive: true }); // iOS audio unlock helper elsewhere
if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
  G.input.touchActive = true;
}
window.addEventListener('touchstart', () => { G.input.touchActive = true; }, { once: true, passive: true });

function pollInput() {
  for (const pid of ['p1', 'p2']) {
    const pad = G.input[pid];
    const h = held[pid];
    pad.x = (h.right ? 1 : 0) - (h.left ? 1 : 0);
    pad.z = (h.down ? 1 : 0) - (h.up ? 1 : 0);
    pad.action = !!h.action; pad.secondary = !!h.secondary; pad.jump = !!h.jump; pad.helm = !!h.helm;
    pad.actionHit = !!hits[pid].action; pad.secondaryHit = !!hits[pid].secondary; pad.jumpHit = !!hits[pid].jump;
    pad.helmHit = !!hits[pid].helm;
    hits[pid] = {};
  }
  // Touch merges into P1 (single human on iPad).
  const t = G.input.touchState;
  if (G.input.touchActive) {
    const p1 = G.input.p1;
    if (t.x || t.z) { p1.x = t.x; p1.z = t.z; }
    if (t.action) p1.action = true;
    if (t.secondary) p1.secondary = true;
    if (t.jump) p1.jump = true;
  }
  // First person + mouse look: W walks where you're looking
  if (pointerLocked && G.cameraMode === 'first') {
    const p1 = G.input.p1;
    const c = Math.cos(mouseYaw), s = Math.sin(mouseYaw);
    const x = p1.x, z = p1.z;
    p1.x = x * c - z * s;
    p1.z = x * s + z * c;
  }
}
// Touch edge-detection: hud.js just sets booleans on touchState; hits derived here.
let touchPrev = { action: false, secondary: false, jump: false };
function pollTouchEdges() {
  const t = G.input.touchState, p1 = G.input.p1;
  if (!G.input.touchActive) return;
  if (t.action && !touchPrev.action) p1.actionHit = true;
  if (t.secondary && !touchPrev.secondary) p1.secondaryHit = true;
  if (t.jump && !touchPrev.jump) p1.jumpHit = true;
  touchPrev = { action: t.action, secondary: t.secondary, jump: t.jump };
}

// ---------------------------------------------------------------- time of day
function advanceTime(dt) {
  const T = G.time;
  T.total += dt;
  T.secToday += dt;
  if (T.phase === 'day' && T.secToday >= DAY_SEC) {
    T.phase = 'night';
    emit('day:dusk', { week: T.week, day: T.day });
  }
  if (T.secToday >= FULL_DAY) {
    T.secToday -= FULL_DAY;
    T.phase = 'day';
    T.day += 1;
    if (T.day > DAYS_PER_WEEK) { T.day = 1; T.week += 1; emit('week:new', { week: T.week }); }
    const totalDays = (T.week - 1) * DAYS_PER_WEEK + T.day;
    emit('day:dawn', { week: T.week, day: T.day, totalDays });
    save(); // auto-save every morning
    if (!G.legacy && totalDays > RUN_WEEKS * DAYS_PER_WEEK) {
      setState('retired'); // hud shows retire-or-legacy choice
      return;
    }
    if (!G.flags.bossActive) setState('summary'); // morning breather (hud fills text)
  }
  T.dayFrac = T.secToday / FULL_DAY;
}

// ---------------------------------------------------------------- POV toggle
function togglePov() {
  if (G.state !== 'playing' && G.state !== 'paused') return;
  if (G.input.p2Active) { G.ui?.toast('Two captains, one screen — third person it is! 👀'); return; }
  if (G.players[0]?.mode === 'leviathan') { G.ui?.toast('Monsters get the movie camera 🎥'); return; }
  G.cameraMode = G.cameraMode === 'third' ? 'first' : 'third';
  if (G.cameraMode === 'first') {
    mouseYaw = Math.atan2(povFacing.x, -povFacing.z);
    mousePitch = Math.asin(THREE.MathUtils.clamp(povFacing.y, -1, 1));
    // The V keypress is a user gesture, so we can grab the mouse right away (desktop).
    if (!G.input.touchActive) {
      try { renderer.domElement.requestPointerLock?.(); } catch (e) {}
      G.ui?.toast('First person 👁️ — move the mouse to look! (Esc frees the mouse)');
    } else {
      G.ui?.toast('First person 👁️');
    }
  } else {
    document.exitPointerLock?.();
    G.ui?.toast('Third person 🎥');
  }
  G.emit('camera:mode', { mode: G.cameraMode });
  if (G.cameraMode === 'third') restorePovBody();
}
function restorePovBody() {
  const p = G.players[0];
  if (p?.obj && p.mode !== 'leviathan') p.obj.visible = true;
}
document.getElementById('btn-pov')?.addEventListener('click', togglePov);
document.getElementById('btn-pixel')?.addEventListener('click', togglePixel);
on('leviathan:begin', () => { if (G.cameraMode === 'first') { G.cameraMode = 'third'; restorePovBody(); } });
on('state:change', ({ to }) => {
  if (to === 'title' || to === 'gameover') { G.cameraMode = 'third'; restorePovBody(); }
  if (to === 'title') { G.input.p2Active = false; clearHeld(); camManual = false; } // resets at the title
});

// Mouse look (Eidan's request): in first person, click the screen to grab the mouse and look around.
let mouseYaw = 0, mousePitch = 0, pointerLocked = false;
renderer.domElement.addEventListener('click', () => {
  if (G.cameraMode === 'first' && !pointerLocked && !G.input.touchActive) {
    renderer.domElement.requestPointerLock?.();
  }
});
document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === renderer.domElement;
});
document.addEventListener('mousemove', (ev) => {
  if (!pointerLocked) return;
  mouseYaw += ev.movementX * 0.0035;
  mousePitch = THREE.MathUtils.clamp(mousePitch - ev.movementY * 0.003, -1.15, 1.15);
});

// Third-person manual orbit (Eidan: "let me control my camera myself"):
// drag to spin around the boat, wheel to zoom, C to go back to auto.
let camManual = false;
let orbitYaw = 0, orbitPitch = 0.55, orbitDist = 30;
let dragId = null, dragX = 0, dragY = 0;
function seedOrbitFromCamera(target) {
  const dx = camera.position.x - target.x;
  const dy = camera.position.y - target.y;
  const dz = camera.position.z - target.z;
  orbitDist = Math.max(14, Math.hypot(dx, dy, dz));
  orbitYaw = Math.atan2(dx, dz);
  orbitPitch = THREE.MathUtils.clamp(Math.asin(dy / orbitDist), 0.08, 1.35);
}
renderer.domElement.addEventListener('pointerdown', (ev) => {
  if (G.cameraMode !== 'third' || G.state !== 'playing') return;
  dragId = ev.pointerId; dragX = ev.clientX; dragY = ev.clientY;
});
window.addEventListener('pointermove', (ev) => {
  if (ev.pointerId !== dragId) return;
  const dx = ev.clientX - dragX, dy = ev.clientY - dragY;
  dragX = ev.clientX; dragY = ev.clientY;
  if (!camManual) {
    if (Math.abs(dx) + Math.abs(dy) < 3) return; // ignore micro-jitter on taps
    if (G.boat) seedOrbitFromCamera(G.boat.group.position);
    camManual = true;
    G.ui?.toast('Free camera 🎥 — drag to spin, scroll to zoom, C = auto');
  }
  orbitYaw -= dx * 0.006;
  orbitPitch = THREE.MathUtils.clamp(orbitPitch + dy * 0.005, 0.08, 1.35);
});
const endDrag = (ev) => { if (ev.pointerId === dragId) dragId = null; };
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);
window.addEventListener('wheel', (ev) => {
  if (G.cameraMode !== 'third' || G.state !== 'playing') return;
  if (!camManual && G.boat) { seedOrbitFromCamera(G.boat.group.position); camManual = true; }
  orbitDist = THREE.MathUtils.clamp(orbitDist * (1 + ev.deltaY * 0.0012), 14, 85);
}, { passive: true });
function resetCam() {
  if (!camManual) return;
  camManual = false;
  G.ui?.toast('Auto camera 🎥');
}

// Facing for first person: derived from movement so no module contract change is needed.
const povFacing = new THREE.Vector3(0, 0, -1);
const povPrev = new THREE.Vector3();
const povDelta = new THREE.Vector3();
let povPrevValid = false;
function trackFacing(dt) {
  const p = G.players[0];
  if (!p || !p.worldPos) { povPrevValid = false; return; }
  const w = p.worldPos();
  if (povPrevValid && dt > 0) {
    povDelta.copy(w).sub(povPrev);
    povDelta.y *= 0.4; // mild pitch from climbing/diving
    if (povDelta.lengthSq() > 1e-6) {
      povDelta.normalize();
      povFacing.lerp(povDelta, Math.min(1, dt * 8)).normalize();
    }
  }
  povPrev.copy(w);
  povPrevValid = true;
}

// ---------------------------------------------------------------- camera rig
const camGoal = new THREE.Vector3();
const camLook = new THREE.Vector3();
const tmpV = new THREE.Vector3();
function updateCamera(dt) {
  const povP = G.players[0];
  if (G.cameraMode === 'first' && povP?.obj && povP.mode !== 'leviathan' && !G.cameraFocus) {
    if (pointerLocked) {
      const cp = Math.cos(mousePitch);
      povFacing.set(Math.sin(mouseYaw) * cp, Math.sin(mousePitch), -Math.cos(mouseYaw) * cp);
    } else {
      trackFacing(dt);
    }
    povP.obj.visible = false;
    const head = tmpV.copy(povP.worldPos());
    head.y += povP.mode === 'swim' ? 0.6 : 1.75;
    head.addScaledVector(povFacing, -0.4); // just behind the eyes so arms/rod stay out of face
    camera.position.lerp(head, Math.min(1, dt * 14));
    camLook.copy(camera.position).addScaledVector(povFacing, 12);
    camera.lookAt(camLook);
    return;
  }
  restorePovBody();
  // Cannon cam (Eidan's request): when the solo human mans the cannon, aim over the shoulder.
  if (!G.cameraFocus && !G.input.p2Active && G.boat) {
    const can = G.boat.stations?.find?.(s => s.type === 'cannon');
    if (can && can.user === G.players[0] && G.players[0]?.human) {
      const h = G.boat.heading || 0;
      const cy = G.boat.cannon?.yaw || 0, cp = G.boat.cannon?.pitch || 0;
      // cannon aim in boat-local (+z = over the bow), rotated into world by heading
      const lx = Math.sin(cy) * Math.cos(cp), ly = Math.sin(cp), lz = Math.cos(cy) * Math.cos(cp);
      const wx = lx * Math.cos(h) + lz * Math.sin(h);
      const wz = -lx * Math.sin(h) + lz * Math.cos(h);
      const cw = G.boat.toWorld(tmpV.copy(can.localPos));
      const px = cw.x, py = cw.y, pz = cw.z;
      // close over-the-shoulder: 4.5 back (stays in front of the mast) + 1.9 to the right
      const rx = -wz, rz = wx; // aim's right vector
      camGoal.set(px - wx * 4.5 + rx * 1.9, py + 3.2 - ly * 1.5, pz - wz * 4.5 + rz * 1.9);
      camera.position.lerp(camGoal, Math.min(1, dt * 6));
      camLook.lerp(tmpV.set(px + wx * 22, py + 1 + ly * 18, pz + wz * 22), Math.min(1, dt * 8));
      camera.lookAt(camLook);
      return;
    }
  }
  let target, dist = 46, height = 30;
  if (G.cameraFocus) {
    const f = G.cameraFocus;
    target = f.target.isVector3 ? f.target : f.target.position;
    dist = f.dist ?? dist; height = f.height ?? height;
  } else if (G.boat) {
    target = G.boat.group.position;
    // widen when players spread out / dive away from the boat
    let spread = 0;
    for (const p of G.players) {
      if (!p.obj) continue;
      spread = Math.max(spread, tmpV.copy(p.worldPos()).sub(target).length());
    }
    const zoom = THREE.MathUtils.clamp((spread - 10) / 30, 0, 1);
    dist = 27 + zoom * 34; height = 13 + zoom * 20;
  } else {
    target = camLook.set(0, 0, 0);
  }
  // manual orbit overrides the auto angle (still follows the boat)
  if (camManual && !G.cameraFocus && G.boat) {
    const cp = Math.cos(orbitPitch);
    camGoal.set(
      target.x + Math.sin(orbitYaw) * cp * orbitDist,
      target.y + Math.sin(orbitPitch) * orbitDist,
      target.z + Math.cos(orbitYaw) * cp * orbitDist);
    camera.position.lerp(camGoal, Math.min(1, dt * 8));
    camLook.lerp(tmpV.set(target.x, target.y + 2, target.z), Math.min(1, dt * 10));
    camera.lookAt(camLook);
    return;
  }
  camGoal.set(target.x, target.y + height, target.z + dist);
  camera.position.lerp(camGoal, Math.min(1, dt * 2.2));
  camLook.lerp(tmpV.set(target.x, target.y + 2, target.z), Math.min(1, dt * 3));
  camera.lookAt(camLook);
}

// ---------------------------------------------------------------- game start/reset
function newGame() {
  wipeSave();
  G.time.week = 1; G.time.day = 1; G.time.phase = 'day';
  G.time.secToday = 0; G.time.dayFrac = 0; G.time.total = 0;
  G.legacy = false; G.flags = {}; G.cameraFocus = null;
  emit('game:new', {});
  save();
  setState('playing');
}
function continueGame() {
  if (!load()) return newGame();
  G.flags = {}; G.cameraFocus = null;
  emit('game:continue', {});
  setState('playing');
}
on('ui:start-new', newGame);
on('ui:continue', continueGame);
on('ui:retry', () => { // back to last morning after game over
  if (load()) { G.flags = {}; G.cameraFocus = null; emit('game:continue', {}); setState('playing'); }
  else newGame();
});
on('ui:legacy', () => { G.legacy = true; setState('playing'); emit('game:legacy', {}); });
on('boat:sunk', () => { setState('gameover'); });

// ---------------------------------------------------------------- init modules
const ORDER = ['world', 'boat', 'characters', 'sea', 'fishing', 'threats', 'economy', 'hud', 'map', 'audio'];
for (const name of ORDER) {
  try { MODULES[name].init(G); } catch (err) { console.error(`[init:${name}]`, err); }
}
emit('modules:ready', {});

// ---------------------------------------------------------------- main loop
const SIM_STATES = new Set(['playing']);
let last = performance.now();
const errOnce = new Set();
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  dt *= G.timeScale;
  step(dt);
}
function step(dt) {
  pollInput();
  pollTouchEdges();
  const simulating = SIM_STATES.has(G.state);
  if (simulating) advanceTime(dt);
  const effDt = simulating ? dt : 0; // modules still get update() for menus/ambient, with dt=0 when paused
  for (const name of ORDER) {
    try { MODULES[name].update(G, effDt); }
    catch (err) {
      if (!errOnce.has(name)) { errOnce.add(name); console.error(`[update:${name}]`, err); }
    }
  }
  if (simulating) updateCamera(dt);
  renderer.render(scene, camera);
}
requestAnimationFrame((t) => { last = t; requestAnimationFrame(frame); });

// ---------------------------------------------------------------- debug hook
window.__df = {
  G,
  step: (dt = 1 / 60) => step(dt),
  set timeScale(v) { G.timeScale = v; },
  get timeScale() { return G.timeScale; },
};
const quick = new URLSearchParams(location.search).get('quick');
if (quick) G.timeScale = Number(quick) || 10;
