// Dear Fishermen — quests.js
// Islander NPCs on the harbor island + Old Maja's side quests ("find 15 shells
// in the sea for me" — Eidan's spec). Owns: G.quest. Cross-module talk ONLY via
// G state + events (GDD.md §7). Does NOT touch G.ui.prompt (characters.js owns it).
import * as THREE from '../lib/three.module.min.js';

let G = null;

// ---------------------------------------------------------------- tunables
const TALK_DIST = 12;       // any human this close to the notice board can talk
const ANIM_DIST = 120;      // islanders freeze + hide beyond this (iPad perf)
const WAVE_DIST = 60;       // islanders wave at the moored boat inside this
const FALLBACK_BOARD = { x: 0, y: 2.6, z: 38 }; // if world.js hasn't set G.island yet
const HAT_KINDS = ['souwester', 'bucket', 'party', 'squid'];
const SCALE = 1.45;         // same chunky scale as the crew goofballs

// ---------------------------------------------------------------- shared assets
const GEO = {};
const MAT = {};
const TA = new THREE.Vector3(); // temps — no per-frame allocations
const TB = new THREE.Vector3();

// ---------------------------------------------------------------- module state
let rootGroup = null;       // all islanders + marker live under this (easy hide)
let islanders = [];         // [{ obj, body, ... , home, phase }]
let maja = null;
let marker = null, markerBar = null, markerDot = null;
let placedFromIsland = false;
let boardPos = { x: FALLBACK_BOARD.x, y: FALLBACK_BOARD.y, z: FALLBACK_BOARD.z };

let quest = null;           // { type, target, progress, reward, done, label }
let completedCount = 0;
let bannerShown = false;    // once per mooring
let nearBoard = false;      // cached each sim frame for the T-key handler

// ---------------------------------------------------------------- quest text
const EMOJI = { shells: '🐚', fish: '🎣', repairs: '🔧', goldfish: '💰' };
const GIVE_LINES = {
  shells: ['👵 Old Maja: My shell collection lost its SPARKLE!',
    '🐚 Dive down and find {N} seashells in the sea for me, dear!'],
  fish: ['👵 Old Maja: My soup pot is big and VERY empty!',
    '🎣 Catch {N} fish for me — any fish! Even the silly ones!'],
  repairs: ['👵 Old Maja: A good boat is a FIXED boat, sonny!',
    '🔧 Patch {N} leaks or put out {N} fires, then come get paid!'],
  goldfish: ['👵 Old Maja: I only cook the FANCY fish. 💅',
    '💰 Bring in {N} fish worth 40 coins or more. Chop chop!'],
};
const DONE_LINES = [
  '👵 Old Maja: WONDERFUL! You lovely sea potatoes! 🎉',
  '👵 Old Maja: Ooh, splendid! Grandma is PROUD! 🎉',
  '👵 Old Maja: Ha! Better than my late husband ever did! 🎉',
];

function clampN(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function rnd() { return G?.rng ? G.rng() : Math.random(); }
function ri(n) { return Math.floor(rnd() * n); }

function labelFor(q) {
  if (q.type === 'shells') return `🐚 Shells for Maja: ${q.progress}/${q.target}`;
  if (q.type === 'fish') return `🎣 Fish for Maja: ${q.progress}/${q.target}`;
  if (q.type === 'repairs') return `🔧 Fix-it jobs: ${q.progress}/${q.target}`;
  if (q.type === 'goldfish') return `💰 Fancy fish: ${q.progress}/${q.target}`;
  return `⭐ Maja's quest: ${q.progress}/${q.target}`;
}

// keep G.quest in sync (main-owned modules like map read it for display)
function syncQuest() {
  if (!quest) { G.quest = null; refreshMarker(); return; }
  quest.done = quest.progress >= quest.target;
  quest.label = labelFor(quest);
  G.quest = quest;
  refreshMarker();
}

function makeQuest() {
  const week = G.time?.week || 1;
  const kinds = ['shells', 'fish', 'repairs', 'goldfish'];
  const type = kinds[Math.min(kinds.length - 1, ri(kinds.length))];
  let target;
  if (type === 'shells') target = clampN(6 + (week - 1) * 3 + ri(4), 6, 15);
  else if (type === 'fish') target = clampN(8 + (week - 1) * 4 + ri(5), 8, 20);
  else if (type === 'repairs') target = clampN(2 + ((week - 1) >> 1) + ri(2), 2, 4);
  else target = clampN(2 + (week - 1) + ri(2), 2, 5);
  let reward;
  if (type === 'shells') reward = 60 + target * 8;
  else if (type === 'fish') reward = 60 + target * 7;
  else if (type === 'repairs') reward = 60 + target * 40;
  else reward = 60 + target * 40;
  reward = clampN(Math.round(reward), 60, 260);
  return { type, target, progress: 0, reward, done: false, label: '' };
}

// ---------------------------------------------------------------- progress
function bump(type) {
  if (!quest || quest.type !== type || quest.done) return;
  quest.progress += 1;
  const wasDone = quest.progress >= quest.target;
  syncQuest();
  if (wasDone) G.ui?.toast?.(`✅ ${EMOJI[type]} ${quest.target}/${quest.target} — quest done! Sail home to Old Maja! 👵`);
  else G.ui?.toast?.(`${EMOJI[type]} ${quest.progress}/${quest.target}!`);
}

function onFishCaught(d) {
  const fish = d?.fish;
  if (!fish || d?.how === 'shell' || fish.junk || fish.legendary) return;
  bump('fish');
  if ((fish.value || 0) >= 40) bump('goldfish');
}

// ---------------------------------------------------------------- talking to Maja
function giveQuest() {
  quest = makeQuest();
  syncQuest();
  const lines = GIVE_LINES[quest.type] || GIVE_LINES.shells;
  G.ui?.banner?.(lines[0], 3400);
  G.ui?.toast?.(lines[1].replace(/\{N\}/g, String(quest.target)));
  G.sfx?.('pop');
  G.emit?.('quest:start', { type: quest.type, target: quest.target });
}

function turnIn() {
  const done = quest;
  quest = null;
  completedCount += 1;
  syncQuest();
  G.ui?.banner?.(DONE_LINES[completedCount % DONE_LINES.length], 3200);
  G.emit?.('reward:money', { amount: done.reward, why: 'quest' }); // economy toasts + coins
  if (completedCount % 3 === 0) {
    const hat = HAT_KINDS[ri(HAT_KINDS.length)];
    G.emit?.('hat:bought', { hat });
    G.ui?.toast?.(`🧶 Maja knitted you a ${hat} hat! Warm AND stylish!`);
  }
  G.emit?.('quest:complete', { type: done.type, reward: done.reward, completedCount });
}

function remind() {
  G.ui?.toast?.(`👵 Maja: ${quest.label} — keep going, dear!`);
}

function talk() {
  if (!G || G.state !== 'playing' || !G.boat?.moored || !nearBoard) return;
  if (!quest) giveQuest();
  else if (quest.done) turnIn();
  else remind();
}

function anyHumanNearBoard() {
  const players = G.players;
  if (!Array.isArray(players)) return false;
  TB.set(boardPos.x, boardPos.y, boardPos.z);
  for (const p of players) {
    if (!p?.human || !p.worldPos) continue;
    TA.copy(p.worldPos());
    TA.y = boardPos.y; // flat distance — deck height vs island height shouldn't matter
    if (TA.distanceToSquared(TB) < TALK_DIST * TALK_DIST) return true;
  }
  return false;
}

// ---------------------------------------------------------------- islander looks
function buildAssets() {
  const toon = (color) => new THREE.MeshToonMaterial({ color });
  GEO.body = new THREE.SphereGeometry(0.55, 16, 12);
  GEO.eyeW = new THREE.SphereGeometry(0.14, 10, 8);
  GEO.pupil = new THREE.SphereGeometry(0.065, 8, 6);
  GEO.leg = new THREE.CylinderGeometry(0.09, 0.12, 0.26, 8);
  GEO.arm = new THREE.CylinderGeometry(0.07, 0.055, 0.44, 7);
  GEO.dot = new THREE.SphereGeometry(0.075, 6, 5);
  GEO.brim = new THREE.CylinderGeometry(0.55, 0.6, 0.05, 12);
  GEO.crown = new THREE.ConeGeometry(0.34, 0.34, 12);
  GEO.band = new THREE.CylinderGeometry(0.35, 0.36, 0.07, 12);
  GEO.bun = new THREE.SphereGeometry(0.2, 10, 8);
  GEO.mark = new THREE.OctahedronGeometry(0.16);
  MAT.white = toon(0xffffff);
  MAT.black = toon(0x20242b);
  MAT.boot = toon(0x6b4a2f);
  MAT.straw = toon(0xe6c15c);
  MAT.band = toon(0xd9583b);
  MAT.hairWhite = toon(0xf2f0ea);
  MAT.shirts = [toon(0xb18ae0), toon(0xff8a5c), toon(0x2fc4b2)]; // lavender, hibiscus, tropic teal
  MAT.flower = toon(0xfff3c9);
  MAT.markGold = toon(0xff5f56);   // '❗' — red pops against the sky
  MAT.markGreen = toon(0x5fe37a);  // '✅'
}

// A simplified wobbly goofball in ISLANDER clothes (style of characters.js:
// squashed toon sphere body, big eyes, stub legs — but straw hats + flower shirts).
function buildIslander(idx, grandma) {
  const obj = new THREE.Group();
  const body = new THREE.Group();
  obj.add(body);

  const belly = new THREE.Mesh(GEO.body, MAT.shirts[idx % MAT.shirts.length]);
  belly.scale.set(1, 0.85, 0.95);
  belly.position.y = 0.6;
  body.add(belly);

  // flower-shirt dots on the front
  const dots = [[-0.26, 0.68, 0.4], [0.2, 0.52, 0.45], [0.02, 0.78, 0.42]];
  for (const [dx, dy, dz] of dots) {
    const fl = new THREE.Mesh(GEO.dot, MAT.flower);
    fl.position.set(dx, dy, dz);
    fl.scale.z = 0.5;
    body.add(fl);
  }

  // big eyes (face = +z, same convention as the crew)
  const eyes = new THREE.Group();
  eyes.position.set(0, 0.76, 0.4);
  const eL = new THREE.Mesh(GEO.eyeW, MAT.white);
  const eR = new THREE.Mesh(GEO.eyeW, MAT.white);
  eL.position.x = -0.17; eR.position.x = 0.17;
  const pL = new THREE.Mesh(GEO.pupil, MAT.black);
  const pR = new THREE.Mesh(GEO.pupil, MAT.black);
  pL.position.set(-0.17, 0, 0.1); pR.position.set(0.17, 0, 0.1);
  eyes.add(eL, eR, pL, pR);
  body.add(eyes);

  // stub legs
  const legL = new THREE.Mesh(GEO.leg, MAT.boot);
  const legR = new THREE.Mesh(GEO.leg, MAT.boot);
  legL.position.set(-0.2, 0.13, 0); legR.position.set(0.2, 0.13, 0);
  obj.add(legL, legR);

  // stub arms on shoulder pivots (so they can wave)
  const arms = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.5, 0.75, 0);
    const seg = new THREE.Mesh(GEO.arm, MAT.shirts[idx % MAT.shirts.length]);
    seg.position.y = -0.22;
    shoulder.add(seg);
    shoulder.rotation.z = side * 0.35;
    body.add(shoulder);
    arms.push({ side, shoulder });
  }

  // headwear
  if (grandma) {
    const bun = new THREE.Mesh(GEO.bun, MAT.hairWhite);
    bun.position.set(0, 1.14, -0.14);
    body.add(bun);
  } else {
    const hat = new THREE.Group();
    hat.position.y = 1.06;
    const brim = new THREE.Mesh(GEO.brim, MAT.straw);
    const band = new THREE.Mesh(GEO.band, MAT.band);
    band.position.y = 0.05;
    const crown = new THREE.Mesh(GEO.crown, MAT.straw);
    crown.position.y = 0.2;
    hat.add(brim, band, crown);
    hat.rotation.z = (idx % 2 ? -1 : 1) * 0.1;
    body.add(hat);
  }

  obj.scale.setScalar(SCALE);
  return {
    obj, body,
    eyesWhites: [eL, eR], pupils: [pL, pR],
    arms,
    home: { x: 0, z: 0, y: 0, face: Math.PI },
    phase: idx * 2.3 + 0.7,
    blinkT: 1 + idx, blinkAnim: 0,
    hopT: 2 + idx * 1.7, hopA: 0,
    grandma: !!grandma,
  };
}

function buildMarker() {
  marker = new THREE.Group();
  markerBar = new THREE.Mesh(GEO.mark, MAT.markGold);
  markerBar.scale.set(0.7, 1.7, 0.7);
  markerBar.position.y = 0.22;
  markerDot = new THREE.Mesh(GEO.mark, MAT.markGold);
  markerDot.scale.setScalar(0.55);
  markerDot.position.y = -0.28;
  marker.add(markerBar, markerDot);
  marker.position.y = 2.15; // above Maja's head (in her scaled local space)
  maja.obj.add(marker);
}

function refreshMarker() {
  if (!marker) return;
  const avail = !quest;
  const done = !!quest?.done;
  marker.visible = avail || done;
  const mat = done ? MAT.markGreen : MAT.markGold;
  markerBar.material = mat;
  markerDot.material = mat;
  markerDot.visible = !done;            // '✅' = tilted green bar, no dot
  markerBar.rotation.z = done ? -0.55 : 0;
}

// ---------------------------------------------------------------- placement
function readNum(v, fb) { return typeof v === 'number' && isFinite(v) ? v : fb; }

function place() {
  const isl = G.island; // world.js exposes { dockEnd, boardPos, groundY } (Islands Update)
  const gy = readNum(isl?.groundY, FALLBACK_BOARD.y);
  const bp = isl?.boardPos;
  boardPos.x = readNum(bp?.x, FALLBACK_BOARD.x);
  boardPos.z = readNum(bp?.z, FALLBACK_BOARD.z);
  boardPos.y = readNum(bp?.y, gy);
  const de = isl?.dockEnd;
  const dx = readNum(de?.x, boardPos.x);
  const dz = readNum(de?.z, boardPos.z - 14);
  // face from the island toward the dock end (that's where the boat comes in)
  const seaFace = Math.atan2(dx - boardPos.x, dz - boardPos.z);

  // Old Maja stands right beside the notice board
  maja.home.x = boardPos.x + 1.3;
  maja.home.z = boardPos.z + 0.4;
  maja.home.y = boardPos.y;
  maja.home.face = seaFace;
  // the other two potter around between the board and the dock
  const spots = [{ ox: -4.5, oz: 5.5 }, { ox: 5.2, oz: 8 }];
  for (let i = 1; i < islanders.length; i++) {
    const m = islanders[i];
    const s = spots[(i - 1) % spots.length];
    m.home.x = boardPos.x + s.ox;
    m.home.z = boardPos.z + s.oz;
    m.home.y = gy;
    m.home.face = seaFace + (i === 1 ? 0.5 : -0.7);
  }
  for (const m of islanders) {
    m.obj.position.set(m.home.x, m.home.y, m.home.z);
    m.obj.rotation.y = m.home.face;
  }
  if (isl) placedFromIsland = true;
}

// ---------------------------------------------------------------- animation
function animateIslander(m, t, dt, waving, boatPos) {
  const body = m.body;
  const ph = t * 1.3 + m.phase;

  // gentle idle sway
  body.rotation.z = Math.sin(ph) * 0.06;
  body.rotation.x = Math.sin(ph * 0.7 + 1.1) * 0.045;
  body.position.y = Math.sin(ph * 2) * 0.015;

  // tiny surprise hops (and a new stare direction after each one)
  if (dt > 0) {
    m.hopT -= dt;
    if (m.hopT <= 0) {
      m.hopT = 3 + rnd() * 6;
      m.hopA = 1;
      m.home.face += (rnd() - 0.5) * 1.2;
    }
    if (m.hopA > 0) m.hopA = Math.max(0, m.hopA - dt * 2.4);
  }
  const hopY = m.hopA > 0 ? Math.sin((1 - m.hopA) * Math.PI) * 0.28 : 0;
  m.obj.position.y = m.home.y + hopY;

  // face the moored boat when waving, else potter-face
  if (waving && boatPos) {
    const want = Math.atan2(boatPos.x - m.obj.position.x, boatPos.z - m.obj.position.z);
    m.obj.rotation.y += (want - m.obj.rotation.y) * Math.min(1, dt * 4 || 0.08);
  } else {
    m.obj.rotation.y += (m.home.face - m.obj.rotation.y) * Math.min(1, dt * 2 || 0.05);
  }

  // arms: dangle-swing, or one arm up waving hello at the boat
  for (const arm of m.arms) {
    if (waving && arm.side === 1) {
      arm.shoulder.rotation.z = -2.3 + Math.sin(t * 7 + m.phase) * 0.45;
    } else {
      arm.shoulder.rotation.z = arm.side * 0.35 + Math.sin(ph * 1.4 + arm.side) * 0.1;
    }
    arm.shoulder.rotation.x = Math.sin(ph + arm.side * 2) * 0.08;
  }

  // blinks
  m.blinkT -= dt;
  if (m.blinkT <= 0) { m.blinkT = 1.8 + rnd() * 3.4; m.blinkAnim = 0.13; }
  let eyeScale = 1;
  if (m.blinkAnim > 0) { m.blinkAnim -= dt; eyeScale = 0.12; }
  m.eyesWhites[0].scale.y = eyeScale;
  m.eyesWhites[1].scale.y = eyeScale;
  m.pupils[0].visible = m.pupils[1].visible = eyeScale > 0.5;
}

function updateMarker(t) {
  if (!marker || !marker.visible) return;
  marker.position.y = 2.15 + Math.abs(Math.sin(t * 2.6)) * 0.28;
  marker.rotation.y = t * 1.6;
}

// ---------------------------------------------------------------- module API
export function init(g) {
  G = g;
  buildAssets();
  rootGroup = new THREE.Group();
  G.scene.add(rootGroup);

  maja = buildIslander(0, true);           // 👵 Old Maja — THE quest giver
  const pelle = buildIslander(1, false);   // straw-hat flower-shirt potterer
  const stina = buildIslander(2, false);   // straw-hat flower-shirt potterer
  islanders = [maja, pelle, stina];
  for (const m of islanders) rootGroup.add(m.obj);
  buildMarker();
  place();      // fallback spots now; snaps to G.island when world.js provides it
  G.quest = null;
  refreshMarker();

  // T talks to Maja (own listener; accept ev.code or the ev.key fallback)
  window.addEventListener('keydown', (ev) => {
    if (ev.repeat) return;
    if (ev.code === 'KeyT' || (!ev.code && (ev.key || '').toLowerCase() === 't')) talk();
  });

  // quest progress listeners
  G.on('shell:collected', () => bump('shells'));
  G.on('fish:caught', onFishCaught);
  G.on('boat:repaired', () => bump('repairs')); // leaks fixed AND fires doused both emit this

  // persistence
  G.on('save:collect', (data) => {
    data.quests = {
      active: quest
        ? { type: quest.type, target: quest.target, progress: quest.progress, reward: quest.reward }
        : null,
      completedCount,
    };
  });
  G.on('save:apply', (data) => {
    const q = data?.quests;
    completedCount = q?.completedCount || 0;
    const a = q?.active;
    quest = (a && EMOJI[a.type])
      ? { type: a.type, target: Math.max(1, a.target | 0), progress: Math.max(0, a.progress | 0),
          reward: clampN(a.reward | 0, 60, 260), done: false, label: '' }
      : null;
    syncQuest();
  });
  G.on('game:new', () => {
    quest = null;
    completedCount = 0;
    bannerShown = false;
    syncQuest();
  });
}

export function update(g, dt) {
  G = g;
  if (!islanders.length) return;
  if (!placedFromIsland && G.island) place(); // world.js finished the island after us

  // cheap distance gate: no islander work when the boat is far from the harbor
  const bp = G.boat?.group?.position || null;
  const bx = bp ? bp.x : boardPos.x;
  const bz = bp ? bp.z : boardPos.z;
  const ddx = bx - boardPos.x, ddz = bz - boardPos.z;
  const d2 = ddx * ddx + ddz * ddz;
  const within = d2 < ANIM_DIST * ANIM_DIST;
  if (rootGroup) rootGroup.visible = within;
  if (!within) return;

  const moored = !!G.boat?.moored;
  const waving = moored && d2 < WAVE_DIST * WAVE_DIST;

  if (dt === 0) {
    // paused/menu/shop: idle sway off wall-clock only (like characters.js)
    const tNow = performance.now() * 0.001;
    for (const m of islanders) animateIslander(m, tNow, 1 / 60, false, null);
    updateMarker(tNow);
    return;
  }

  const t = G.time?.total || 0;
  for (const m of islanders) animateIslander(m, t, dt, waving, bp);
  updateMarker(t);

  if (G.state !== 'playing') return;
  nearBoard = moored && anyHumanNearBoard();
  if (!moored) bannerShown = false;
  if (moored && nearBoard && !bannerShown) {
    bannerShown = true;
    const how = G.input?.touchActive ? 'tap A' : 'press T';
    G.ui?.banner?.(`🏝️ Old Maja waves — ${how} to talk!`, 3200);
    G.sfx?.('pop');
  }

  // iPad fallback: the A button talks too (only when no station would grab it)
  if (G.input?.touchActive && nearBoard && G.input.p1?.actionHit) {
    const p0 = G.players?.[0];
    if (p0 && !G.nearestStation?.(p0)) talk();
  }
}
