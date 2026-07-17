// Dear Fishermen — hud.js
// HUD, prompts/banners/toasts, all overlays, touch controls.
// Owns: #hud (+children), #prompt-p1/2, #banner, #toast, #touch, #title,
//       #pause, #summary, #gameover, #retire.
// Fills G.ui = { prompt, banner, toast }. Never touches other modules' DOM.
import * as THREE from '../lib/three.module.min.js';

let G = null;

// ---------------------------------------------------------------- dom cache
const el = {};
const IDS = [
  'hud', 'hud-day', 'hud-clock-icon', 'hud-clock-fill', 'hud-money',
  'hud-hull', 'hud-hull-fill', 'hud-hold', 'hud-oxygen', 'hud-oxygen-fill',
  'compass-harbor', 'compass-fog', 'compass-deep', 'btn-pov', 'btn-mute', 'btn-pause',
  'prompt-p1', 'prompt-p2', 'banner', 'toast',
  'touch', 'joystick', 'joystick-knob', 'btn-jump', 'btn-secondary', 'btn-action',
  'title', 'pause', 'summary', 'gameover', 'retire',
  'btn-start', 'btn-continue', 'btn-resume', 'btn-quit', 'btn-next-day',
  'btn-retry', 'btn-gameover-title', 'btn-retire', 'btn-legacy',
  'summary-title', 'summary-text', 'gameover-title', 'gameover-text', 'retire-text',
];

function grabDom() {
  for (const id of IDS) el[id] = document.getElementById(id);
  el.hullIcon = document.querySelector('#hud-hull > span');
}

function show(node, on) {
  if (node) node.classList.toggle('hidden', !on);
}

// ---------------------------------------------------------------- ui: prompt / banner / toast
function prompt(idx, text) {
  const node = idx === 1 ? el['prompt-p2'] : el['prompt-p1'];
  if (!node) return;
  if (text) { node.textContent = text; show(node, true); }
  else show(node, false);
}

let bannerTimer = 0;
function banner(text, ms = 2600, kind = '') {
  const node = el.banner;
  if (!node) return;
  node.textContent = text;
  node.classList.toggle('creepy', kind === 'creepy');
  // style.css has no #banner.creepy rule, so tint inline for the spooky look.
  node.style.color = kind === 'creepy' ? '#8ef0a2' : '';
  node.style.borderColor = kind === 'creepy' ? '#2e7d4f' : '';
  show(node, true);
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => show(node, false), ms);
}

const toastQueue = [];
let toastBusy = false;
function toast(text) {
  toastQueue.push(String(text));
  if (toastQueue.length > 6) toastQueue.shift(); // never let it pile up forever
  pumpToast();
}
function pumpToast() {
  if (toastBusy || !toastQueue.length || !el.toast) return;
  toastBusy = true;
  el.toast.textContent = toastQueue.shift();
  show(el.toast, true);
  setTimeout(() => {
    show(el.toast, false);
    setTimeout(() => { toastBusy = false; pumpToast(); }, 220);
  }, 2500);
}

// ---------------------------------------------------------------- day stats (for summary)
const stats = { fish: 0, coins: 0, damage: 0, funniest: '' };
let statsSnap = null;      // frozen copy taken at dawn, shown on the summary screen
let lastDawnTotalDays = 1; // total day number of the morning we just reached

function resetStats() {
  stats.fish = 0; stats.coins = 0; stats.damage = 0; stats.funniest = '';
}

const CURSE_NAMES = {
  ghost: 'Ghost fog crawled over the deck… 👻',
  ghostdeck: 'Ghost fog crawled over the deck… 👻',
  rebellion: 'The fish staged a rebellion! 🐟💥',
  fishrebellion: 'The fish staged a rebellion! 🐟💥',
  dance: 'The whole crew HAD to dance! 🕺',
  dancecurse: 'The whole crew HAD to dance! 🕺',
  boots: 'Heavy boots! Everyone walked like grandpas. 🥾',
  heavyboots: 'Heavy boots! Everyone walked like grandpas. 🥾',
};

// ---------------------------------------------------------------- game over cause
let fogHintShown = false; // one-time "green fog" hint, once per session
let lastDamageWhy = '';
let leviathanActive = false;

function gameoverText() {
  if (leviathanActive) return 'The Leviathan sends its regards. 🐉';
  const why = String(lastDamageWhy || '').toLowerCase();
  if (why.includes('megalodon')) return 'That was a LOT of teeth. 🦈 The Megalodon says thanks for the boat.';
  if (why.includes('shark')) return 'Sharks 1 — Fishermen 0. 🦈 The sea remembers.';
  if (why.includes('storm') || why.includes('typhoon') || why.includes('lightning'))
    return 'The storm won this round. ⛈️ The sea remembers.';
  if (why.includes('fire')) return 'The boat got a little too cozy. 🔥 The sea remembers.';
  if (why.includes('leak') || why.includes('water') || why.includes('sink'))
    return 'Too many leaks, not enough buckets. 💧 The sea remembers.';
  return 'The sea remembers. 🌊';
}

// ---------------------------------------------------------------- overlays / states
const HUD_STATES = new Set(['playing', 'paused', 'shop']);

function applyState(state) {
  show(el.title, state === 'title');
  show(el.pause, state === 'paused');
  show(el.summary, state === 'summary');
  show(el.gameover, state === 'gameover');
  show(el.retire, state === 'retired');
  show(el.hud, HUD_STATES.has(state));
  updateTouchVisibility();

  if (state === 'title') show(el['btn-continue'], !!G?.hasSave?.());
  if (state === 'summary') fillSummary();
  if (state === 'gameover') {
    if (el['gameover-text']) el['gameover-text'].textContent = gameoverText();
  }
  if (state === 'retired') fillRetire();
}

function fillSummary() {
  const s = statsSnap || stats;
  const dayNum = Math.max(1, lastDawnTotalDays - 1); // the day we just survived
  if (el['summary-title']) el['summary-title'].textContent = `Day ${dayNum} survived! 🌅`;
  const funniest = s.funniest || 'The sea was suspiciously calm. 🌊';
  if (el['summary-text']) {
    el['summary-text'].textContent =
      `You caught ${s.fish} fish 🐟 and earned ${Math.round(s.coins)} coins 🪙.\n` +
      `The boat took ${Math.round(s.damage)} damage 🔨.\n` +
      `${funniest}`;
    el['summary-text'].style.whiteSpace = 'pre-line';
  }
}

function fillRetire() {
  retireDone = false;
  if (el['btn-retire']) el['btn-retire'].textContent = 'Retire as a legend 🌴';
  show(el['btn-legacy'], true);
  const weeks = Math.max(1, (G?.time?.week ?? 4) - 1);
  const money = Math.round(G?.money ?? 0);
  const big = G?.biggestCatch;
  const bigLine = big?.name
    ? `Biggest catch: ${big.name} (${Math.round(big.size ?? 0)} cm, ${Math.round(big.value ?? 0)} 🪙)!`
    : 'Biggest catch: a very old boot. 🥾';
  if (el['retire-text']) {
    el['retire-text'].textContent =
      `${weeks} ${weeks === 1 ? 'week' : 'weeks'} at sea. ${money} coins in the chest. 💰\n${bigLine}\n` +
      `Retire on a sunny beach… or keep sailing into scarier waters?`;
    el['retire-text'].style.whiteSpace = 'pre-line';
  }
}

// btn-retire is two-stage: first click = show THE END, second click = title.
let retireDone = false;
function onRetireClick() {
  if (!retireDone) {
    retireDone = true;
    if (el['retire-text']) {
      el['retire-text'].textContent =
        `THE END — Eidan's legend retires rich 🌴\n` +
        `The wobbliest crew on the seven seas hangs up their rods. Well fished, captain! 🎣`;
    }
    show(el['btn-legacy'], false);
    if (el['btn-retire']) el['btn-retire'].textContent = 'Back to title 🏠';
  } else {
    G?.setState?.('title');
  }
}

// ---------------------------------------------------------------- buttons
function wireButtons() {
  const click = (id, fn) => { el[id]?.addEventListener('click', fn); };
  click('btn-start', () => G.emit('ui:start-new', {}));
  click('btn-continue', () => G.emit('ui:continue', {}));
  click('btn-resume', () => G.setState('playing'));
  click('btn-quit', () => G.setState('title'));
  click('btn-next-day', () => G.setState('playing'));
  click('btn-retry', () => G.emit('ui:retry', {}));
  click('btn-gameover-title', () => G.setState('title'));
  click('btn-retire', onRetireClick);
  click('btn-legacy', () => G.emit('ui:legacy', {}));
  click('btn-pause', () => { if (G.state === 'playing') G.setState('paused'); });
  click('btn-mute', () => {
    muted = !muted;
    if (el['btn-mute']) el['btn-mute'].textContent = muted ? '🔇' : '🔊';
    G.emit('audio:mute', { muted });
  });
  // #btn-pov is wired by main.js (owns the camera + leviathan/body-visibility guards).
}
let muted = false;

// ---------------------------------------------------------------- HUD refresh
let lastRefresh = 0;
const tmpF = new THREE.Vector3();
const tmpD = new THREE.Vector3();

function refreshHud() {
  if (!G || !HUD_STATES.has(G.state)) return;
  const T = G.time || {};
  const DAY = G.consts?.DAY_SEC ?? 600;
  const NIGHT = G.consts?.NIGHT_SEC ?? 600;

  // Day label
  if (el['hud-day']) {
    let txt = `Week ${T.week ?? 1} · Day ${T.day ?? 1}`;
    if (T.phase === 'night') txt += ' 🌙';
    if (G.legacy) txt += ' · LEGACY 🔥';
    el['hud-day'].textContent = txt;
  }

  // Clock: bar restarts at each phase (dawn and dusk)
  const sec = T.secToday ?? 0;
  const isNight = T.phase === 'night';
  const frac = isNight
    ? Math.min(1, Math.max(0, (sec - DAY) / NIGHT))
    : Math.min(1, Math.max(0, sec / DAY));
  if (el['hud-clock-fill']) {
    el['hud-clock-fill'].style.width = `${(frac * 100).toFixed(1)}%`;
    el['hud-clock-fill'].style.background = isNight ? '#9db8ff' : '';
  }
  if (el['hud-clock-icon']) el['hud-clock-icon'].textContent = isNight ? '🌙' : '☀️';

  // Money (also updated instantly on money:change)
  if (el['hud-money']) el['hud-money'].textContent = `🪙 ${Math.round(G.money ?? 0)}`;

  // Hull bar: green -> red by hp, tinted watery-blue when bilge is filling
  const hull = G.boat?.hull;
  if (el['hud-hull-fill'] && hull) {
    const hp = Math.min(1, Math.max(0, (hull.hp ?? 1) / (hull.maxHp || 1)));
    el['hud-hull-fill'].style.width = `${(hp * 100).toFixed(1)}%`;
    const wet = (G.boat.water ?? 0) > 0.3;
    // lerp ok-green (59,178,115) -> danger-red (229,72,77)
    const r = Math.round(229 + (59 - 229) * hp);
    const g = Math.round(72 + (178 - 72) * hp);
    const b = Math.round(77 + (115 - 77) * hp);
    el['hud-hull-fill'].style.background = wet ? `rgb(${Math.round(r * 0.6)}, ${g}, 230)` : `rgb(${r}, ${g}, ${b})`;
    if (el.hullIcon) el.hullIcon.textContent = wet ? '🚢💧' : '🚢';
  }

  // Fish hold
  if (el['hud-hold']) {
    const n = G.hold?.fish?.length ?? 0;
    const cap = G.hold?.capacity ?? 10;
    el['hud-hold'].textContent = `🐟 ${n}/${cap}`;
  }

  // Oxygen: only while a human is underwater (P1 priority)
  refreshOxygen();

  // Compass: rotate the anchor toward the harbor, relative to camera forward
  refreshCompass();
}

const submerged = new Set(); // player idx values currently underwater

function playerIdxFrom(data) {
  if (typeof data?.player?.idx === 'number') return data.player.idx;
  if (typeof data?.idx === 'number') return data.idx;
  if (typeof data?.player === 'number') return data.player;
  return 0;
}

function oxygenFraction(p) {
  if (!p) return 1;
  const o = p.oxygen ?? 1;
  if (typeof p.oxygenMax === 'number' && p.oxygenMax > 0) return Math.min(1, Math.max(0, o / p.oxygenMax));
  if (o > 1.001) return Math.min(1, Math.max(0, o / 60)); // looks like seconds (base tank = 60 s)
  return Math.min(1, Math.max(0, o)); // already a fraction
}

function refreshOxygen() {
  if (!el['hud-oxygen']) return;
  // Drop stale entries defensively (module may have surfaced the player without emitting)
  for (const idx of submerged) {
    const p = G.players?.[idx];
    if (!p || (p.human && p.mode !== 'swim' && p.mode !== 'busy')) submerged.delete(idx);
  }
  let best = null;
  for (const idx of [...submerged].sort((a, b) => a - b)) {
    const p = G.players?.[idx];
    if (p?.human) { best = p; break; } // lowest idx human = P1 priority
  }
  if (!best) { show(el['hud-oxygen'], false); return; }
  show(el['hud-oxygen'], true);
  if (el['hud-oxygen-fill']) el['hud-oxygen-fill'].style.width = `${(oxygenFraction(best) * 100).toFixed(1)}%`;
}

function aimNeedle(node, tx, tz) {
  const boatPos = G.boat?.group?.position;
  if (!node || !boatPos || !G.camera) return;
  tmpD.set(tx - boatPos.x, 0, tz - boatPos.z);
  if (tmpD.lengthSq() < 1) { node.style.transform = 'rotate(0rad)'; return; }
  tmpD.normalize();
  G.camera.getWorldDirection(tmpF);
  tmpF.y = 0;
  if (tmpF.lengthSq() < 0.0001) return; // camera looking straight down; keep last rotation
  tmpF.normalize();
  const fwd = tmpD.x * tmpF.x + tmpD.z * tmpF.z;          // screen-up component
  const right = tmpD.x * -tmpF.z + tmpD.z * tmpF.x;       // screen-right component (f × up)
  const ang = Math.atan2(right, fwd);                      // CSS clockwise-from-up
  node.style.transform = `rotate(${ang.toFixed(3)}rad)`;
}

function refreshCompass() {
  const boatPos = G.boat?.group?.position;
  if (!boatPos) return;
  const h = G.consts?.HARBOR ?? { x: 0, z: 60 };
  aimNeedle(el['compass-harbor'], h.x, h.z);

  // Fog needle: center of the cursed quadrant. Hidden in week 1 to keep it gentle.
  const fog = el['compass-fog'];
  if (fog) {
    const fogOn = (G.time?.week ?? 1) >= 2;
    fog.style.display = fogOn ? '' : 'none';
    if (fogOn) aimNeedle(fog, -400, -400);
  }

  // Deep needle: points "further out" — harbor + normalized(boat - harbor) * 600.
  const dx = boatPos.x - h.x, dz = boatPos.z - h.z;
  const len = Math.hypot(dx, dz);
  if (len > 0.001) aimNeedle(el['compass-deep'], h.x + (dx / len) * 600, h.z + (dz / len) * 600);
}

function popMoney() {
  const m = el['hud-money'];
  if (!m) return;
  m.style.transition = 'transform 0.12s';
  m.style.transform = 'scale(1.3)';
  clearTimeout(popMoney._t);
  popMoney._t = setTimeout(() => { m.style.transform = 'scale(1)'; }, 130);
}

// ---------------------------------------------------------------- touch controls
function updateTouchVisibility() {
  show(el.touch, !!(G?.input?.touchActive && G.state === 'playing'));
}

function wireTouch() {
  const joy = el.joystick, knob = el['joystick-knob'], ts = G.input.touchState;
  const swallow = (ev) => { ev.preventDefault(); };
  el.touch?.addEventListener('touchstart', swallow, { passive: false });
  el.touch?.addEventListener('touchmove', swallow, { passive: false });
  el.touch?.addEventListener('contextmenu', swallow);

  // --- joystick: single owning pointer, other fingers belong to the buttons ---
  let joyId = null;
  let cx = 0, cy = 0, radius = 48;
  const setStick = (px, py) => {
    let dx = (px - cx) / radius;
    let dy = (py - cy) / radius;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    if (len < 0.2) { ts.x = 0; ts.z = 0; }
    else { ts.x = dx; ts.z = dy; } // screen down = +z (matches keyboard "down")
    if (knob) {
      const kx = Math.max(-1, Math.min(1, dx)) * radius;
      const ky = Math.max(-1, Math.min(1, dy)) * radius;
      knob.style.transform = `translate(calc(-50% + ${kx.toFixed(1)}px), calc(-50% + ${ky.toFixed(1)}px))`;
    }
  };
  const releaseStick = () => {
    joyId = null; ts.x = 0; ts.z = 0;
    if (knob) knob.style.transform = 'translate(-50%, -50%)';
  };
  joy?.addEventListener('pointerdown', (ev) => {
    if (joyId !== null) return; // a second finger here is ignored
    joyId = ev.pointerId;
    const r = joy.getBoundingClientRect();
    cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    radius = Math.max(24, r.width / 2 - 14);
    try { joy.setPointerCapture(ev.pointerId); } catch (e) {}
    setStick(ev.clientX, ev.clientY);
    ev.preventDefault();
  });
  joy?.addEventListener('pointermove', (ev) => {
    if (ev.pointerId !== joyId) return;
    setStick(ev.clientX, ev.clientY);
    ev.preventDefault();
  });
  const joyEnd = (ev) => { if (ev.pointerId === joyId) releaseStick(); };
  joy?.addEventListener('pointerup', joyEnd);
  joy?.addEventListener('pointercancel', joyEnd);
  joy?.addEventListener('lostpointercapture', joyEnd);

  // --- action buttons: press = true, release/leave = false, per-button pointer ---
  const wireBtn = (id, key) => {
    const btn = el[id];
    if (!btn) return;
    let pid = null;
    btn.addEventListener('pointerdown', (ev) => {
      pid = ev.pointerId; ts[key] = true;
      try { btn.setPointerCapture(ev.pointerId); } catch (e) {}
      ev.preventDefault();
    });
    const end = (ev) => { if (ev.pointerId === pid || pid === null) { pid = null; ts[key] = false; } };
    btn.addEventListener('pointerup', end);
    btn.addEventListener('pointercancel', end);
    btn.addEventListener('pointerleave', end);
    btn.addEventListener('lostpointercapture', end);
  };
  wireBtn('btn-action', 'action');
  wireBtn('btn-secondary', 'secondary');
  wireBtn('btn-jump', 'jump');
}

// ---------------------------------------------------------------- events
function wireEvents() {
  G.on('state:change', ({ to }) => applyState(to));

  G.on('money:change', ({ delta } = {}) => {
    if ((delta ?? 0) > 0) stats.coins += delta;
    if (el['hud-money']) el['hud-money'].textContent = `🪙 ${Math.round(G.money ?? 0)}`;
    popMoney();
  });

  G.on('fish:caught', ({ fish } = {}) => {
    stats.fish += 1;
    if (fish?.name && (fish.value ?? 0) >= 40) stats.funniest = `Landed a mighty ${fish.name}! 💪🐟`;
  });

  G.on('boat:damage', ({ n, why } = {}) => {
    stats.damage += n ?? 0;
    if (why) lastDamageWhy = why;
  });

  G.on('curse:start', ({ kind } = {}) => {
    const key = String(kind ?? '').toLowerCase().replace(/[^a-z]/g, '');
    stats.funniest = CURSE_NAMES[key] || `A cursed fish struck: ${kind ?? 'something spooky'}! 🧿`;
  });

  G.on('megalodon:begin', () => { stats.funniest = 'The MEGALODON came to visit… 🦈'; });
  G.on('megalodon:end', () => { stats.funniest = 'Survived the MEGALODON! 🦈💪'; });
  G.on('leviathan:begin', () => { leviathanActive = true; });
  G.on('leviathan:end', ({ crewWon } = {}) => {
    leviathanActive = false;
    stats.funniest = crewWon
      ? 'The crew fought off the LEVIATHAN! 🐉⚔️'
      : 'The LEVIATHAN got a little too friendly. 🐉';
  });

  G.on('underwater:enter', (d) => { submerged.add(playerIdxFrom(d)); refreshOxygen(); });
  G.on('underwater:exit', (d) => { submerged.delete(playerIdxFrom(d)); refreshOxygen(); });

  G.on('day:dawn', ({ totalDays } = {}) => {
    lastDawnTotalDays = totalDays ?? ((G.time.week - 1) * 7 + G.time.day);
    statsSnap = { ...stats }; // freeze for the summary screen, then start a fresh day
    resetStats();
  });
  G.on('day:dusk', () => {
    banner('Night falls… 🌙', 3000, 'creepy');
    if (!fogHintShown && (G.time?.week ?? 1) >= 2) {
      fogHintShown = true;
      toast('Old sailors say a green fog glows to the north-west… 🌫️');
    }
  });
  G.on('week:new', ({ week } = {}) => banner(`WEEK ${week ?? '?'} — it gets worse 😈`, 3200));
  G.on('p2:join', () => toast('Player 2 joined! 🎉'));

  G.on('game:new', () => { resetStats(); statsSnap = null; lastDamageWhy = ''; leviathanActive = false; submerged.clear(); });
  G.on('game:continue', () => { resetStats(); statsSnap = null; lastDamageWhy = ''; leviathanActive = false; submerged.clear(); });
}

// ---------------------------------------------------------------- module API
export function init(g) {
  G = g;
  grabDom();
  G.ui = { prompt, banner, toast };
  wireButtons();
  wireTouch();
  wireEvents();
  applyState(G.state); // initial 'title' overlay + Continue button
}

export function update(g, dt) {
  if (!G) return;
  // Cheap wall-clock throttle (~4x/sec) — runs even when paused so menus stay fresh.
  const now = performance.now();
  if (now - lastRefresh < 250) return;
  lastRefresh = now;
  refreshHud();
  updateTouchVisibility();
}
