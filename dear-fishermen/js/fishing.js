// Dear Fishermen — fishing.js
// Rods (cast → bite → hook), the reel minigame (#fishing-ui), the fishdex,
// and the fish hold. Owned DOM: #fishing-ui only. All cross-module talk via
// G state + G.emit/G.on per GDD §7.
import * as THREE from '../lib/three.module.min.js';

let G = null;

// ------------------------------------------------------------------ fishdex
// zones: where a species can bite. night:true = only bites at night.
// rarity is a pick-weight (higher = more common). Sizes in kg.
const FISHDEX = [
  // Coast — small silly fish
  { id: 'bloopfish',    name: 'Bloopfish',      emoji: '🐟', zones: ['harbor', 'coast'], minSize: 0.2, maxSize: 1.5,  valuePerKg: 4,  rarity: 1.0 },
  { id: 'sock-snapper', name: 'Sock Snapper',   emoji: '🐠', zones: ['coast'],           minSize: 0.3, maxSize: 2.0,  valuePerKg: 5,  rarity: 1.0 },
  { id: 'giggle-guppy', name: 'Giggle Guppy',   emoji: '🐡', zones: ['coast'],           minSize: 0.1, maxSize: 0.8,  valuePerKg: 7,  rarity: 0.8 },
  { id: 'burpfish',     name: 'Burpfish',       emoji: '🎏', zones: ['coast', 'open'],   minSize: 0.5, maxSize: 3.0,  valuePerKg: 5,  rarity: 0.7 },
  // Open sea — decent fish
  { id: 'drama-herring', name: 'Drama Herring', emoji: '🐟', zones: ['open'],            minSize: 0.5, maxSize: 4.0,  valuePerKg: 8,  rarity: 1.0 },
  { id: 'chunky-cod',    name: 'Chunky Cod',    emoji: '🐠', zones: ['open'],            minSize: 1.0, maxSize: 8.0,  valuePerKg: 9,  rarity: 0.9 },
  { id: 'moon-mackerel', name: 'Moon Mackerel', emoji: '🌙', zones: ['open', 'deep'],    minSize: 1.0, maxSize: 6.0,  valuePerKg: 14, rarity: 0.6, night: true },
  { id: 'zappy-eel',     name: 'Zappy Eel',     emoji: '⚡', zones: ['open', 'deep'],    minSize: 1.0, maxSize: 5.0,  valuePerKg: 12, rarity: 0.5 },
  // The Deep — big + valuable
  { id: 'turbo-tuna',    name: 'Turbo Tuna',     emoji: '🐟', zones: ['deep'],           minSize: 5.0, maxSize: 40.0, valuePerKg: 11, rarity: 1.0 },
  { id: 'sir-swordfish', name: 'Sir Swordfish',  emoji: '🤺', zones: ['deep'],           minSize: 8.0, maxSize: 60.0, valuePerKg: 13, rarity: 0.7 },
  { id: 'grumbler',      name: 'Grumbler Angler', emoji: '🏮', zones: ['deep'],          minSize: 2.0, maxSize: 15.0, valuePerKg: 18, rarity: 0.5, night: true },
  { id: 'wobble-squid',  name: 'Wobble Squid',   emoji: '🦑', zones: ['deep', 'fog'],    minSize: 3.0, maxSize: 25.0, valuePerKg: 12, rarity: 0.6 },
  // Cursed Fog — weird glowing ones
  { id: 'ghost-guppy',   name: 'Ghost Guppy',    emoji: '👻', zones: ['fog'],            minSize: 0.5, maxSize: 4.0,  valuePerKg: 20, rarity: 1.0 },
  { id: 'lantern-jelly', name: 'Lantern Jelly',  emoji: '🎐', zones: ['fog'],            minSize: 1.0, maxSize: 10.0, valuePerKg: 22, rarity: 0.7, night: true },
  // THE LEGENDARY FISH — unique. Landing it does NOT go in the hold: it eats you.
  { id: 'legendary', name: 'THE LEGENDARY FISH', emoji: '🐋', zones: ['fog'], minSize: 600, maxSize: 999, valuePerKg: 50, rarity: 0, legendary: true },
  // Pure junk — worth 1 coin, funny toast
  { id: 'old-boot',    name: 'Old Boot',    emoji: '👢', zones: ['harbor', 'coast', 'open', 'deep', 'fog'], minSize: 1, maxSize: 1, valuePerKg: 1, rarity: 0, junk: true },
  { id: 'soggy-crate', name: 'Soggy Crate', emoji: '📦', zones: ['harbor', 'coast', 'open', 'deep', 'fog'], minSize: 1, maxSize: 1, valuePerKg: 1, rarity: 0, junk: true },
  { id: 'angry-kelp',  name: 'Angry Kelp',  emoji: '🌿', zones: ['harbor', 'coast', 'open', 'deep', 'fog'], minSize: 1, maxSize: 1, valuePerKg: 1, rarity: 0, junk: true },
];
const JUNK = FISHDEX.filter((s) => s.junk);
const JUNK_TOASTS = {
  'old-boot':    'You caught… an Old Boot 👢! Very fashion. 1 coin.',
  'soggy-crate': 'You caught… a Soggy Crate 📦! It sloshes. 1 coin.',
  'angry-kelp':  'You caught… Angry Kelp 🌿! It slapped you. 1 coin.',
};

// ------------------------------------------------------------------ tuning
const CAST_ANIM_SEC = 0.55;
const LAND_ANIM_SEC = 0.7;
const HOOK_WINDOW_SEC = 1.2;
const JUNK_CHANCE = 0.12;
const LEGENDARY_CHANCE = 1 / 6;
const CURSED_FOG = 0.12;          // cursed odds for fog catches
const CURSED_OPEN_NIGHT = 0.05;   // week>=2, open sea, night
const BOT_SUCCESS = 0.55;

// ------------------------------------------------------------------ state
const rods = new Map();       // station.id -> rod state
const fights = [null, null];  // reel minigame per human player idx
let legendaryHooked = false;  // only one legendary fight at a time
let uiRoot = null;
const panels = [null, null];  // DOM panels per player idx

// shared three resources (created in init)
let bobberGeo, bobberMat, bobberLegendMat, lineMat;
const TMP_A = new THREE.Vector3();
const TMP_B = new THREE.Vector3();

// ------------------------------------------------------------------ helpers
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function rand() { return G.rng ? G.rng() : Math.random(); }

function resolveUser(user) {
  if (user == null) return null;
  if (typeof user === 'number') return G.players?.[user] || null;
  if (typeof user === 'object') return user; // assume a player object
  return null;
}
function padFor(player) {
  if (!player?.human) return null;
  return player.idx === 0 ? G.input?.p1 : player.idx === 1 ? G.input?.p2 : null;
}
function actionKeyName(player) {
  if (player.idx === 1) return '.';
  return G.input?.touchActive ? 'A' : 'E';
}
function playerName(player) {
  if (!player) return 'Someone';
  if (player.human) return player.idx === 0 ? 'P1' : 'P2';
  return player.name || 'A crewmate';
}
function toast(text) { G.ui?.toast?.(text); }
function prompt(player, text) { if (player?.human) G.ui?.prompt?.(player.idx, text); }
function oceanY(x, z) { return G.ocean?.heightAt?.(x, z) ?? 0; }
function zoneAtPos(x, z) { return G.zoneAt?.(x, z) ?? 'coast'; }
function isNight() { return G.time?.phase === 'night'; }
function rodLevel() { return G.upgrades?.rod || 1; }

// ------------------------------------------------------------------ hold
function holdCapacity() {
  const h = G.upgrades?.hull || 1;
  return h >= 3 ? 24 : h === 2 ? 16 : 10;
}
function makeHold() {
  const hold = {
    fish: [],
    get capacity() { return holdCapacity(); },
    takeAllValue() { // economy calls when selling: empties hold, returns coins
      let total = 0;
      for (const f of hold.fish) total += f.value || 0;
      hold.fish.length = 0;
      return total;
    },
    clear() { hold.fish.length = 0; },
    removeRandom(n) { // Fish Rebellion curse: n fish jump out
      const out = [];
      for (let i = 0; i < n && hold.fish.length > 0; i++) {
        const j = Math.floor(rand() * hold.fish.length);
        out.push(hold.fish.splice(j, 1)[0]);
      }
      if (out.length) G.emit('hold:spilled', { fish: out });
      return out;
    },
  };
  return hold;
}
function addToHold(fish) {
  const hold = G.hold;
  if (!hold) return;
  hold.fish.push(fish);
  if (hold.fish.length > hold.capacity) {
    let si = 0;
    for (let i = 1; i < hold.fish.length; i++) {
      if ((hold.fish[i].size || 0) < (hold.fish[si].size || 0)) si = i;
    }
    hold.fish.splice(si, 1);
    toast('Hold full! Released the smallest 🐟');
  }
}

// ------------------------------------------------------------------ fish picking
function pickSpecies(zone, night, forBot) {
  const z = zone === 'harbor' ? 'coast' : zone;
  let total = 0;
  for (const s of FISHDEX) {
    if (s.junk || s.legendary) continue;
    if (!s.zones.includes(z)) continue;
    if (s.night && !night) continue;
    total += s.rarity;
  }
  if (total <= 0) return FISHDEX[0]; // Bloopfish fallback
  let roll = rand() * total;
  for (const s of FISHDEX) {
    if (s.junk || s.legendary) continue;
    if (!s.zones.includes(z)) continue;
    if (s.night && !night) continue;
    roll -= s.rarity;
    if (roll <= 0) return s;
  }
  return FISHDEX[0];
}

function rollFish(zone, player) {
  const night = isNight();
  const week = G.time?.week || 1;
  const forBot = !player?.human;
  // THE LEGENDARY FISH: night + fog + week>=2 + HUMAN + no boss already raging
  if (!forBot && !legendaryHooked && night && zone === 'fog' && week >= 2 &&
      !G.flags?.bossActive && rand() < LEGENDARY_CHANCE) {
    const s = FISHDEX.find((f) => f.legendary);
    const size = Math.round(s.minSize + rand() * (s.maxSize - s.minSize));
    return { id: s.id, name: s.name, emoji: s.emoji, size, value: 0, cursed: false, legendary: true, junk: false };
  }
  // Junk
  if (rand() < JUNK_CHANCE) {
    const s = JUNK[Math.floor(rand() * JUNK.length)];
    return { id: s.id, name: s.name, emoji: s.emoji, size: 1, value: 1, cursed: false, legendary: false, junk: true };
  }
  const s = pickSpecies(zone, night, forBot);
  let t = Math.pow(rand(), 1.7); // skew small
  if (forBot) t *= 0.3;          // bots only catch small ones
  const size = Math.max(s.minSize, Math.round((s.minSize + (s.maxSize - s.minSize) * t) * 10) / 10);
  const value = Math.max(1, Math.round(size * s.valuePerKg));
  let cursed = false;
  if (zone === 'fog') cursed = rand() < CURSED_FOG;
  else if (zone === 'open' && night && week >= 2) cursed = rand() < CURSED_OPEN_NIGHT;
  return { id: s.id, name: s.name, emoji: s.emoji, size, value, cursed, legendary: false, junk: false };
}

// ------------------------------------------------------------------ rod visuals
function makeRodVisual() {
  const bobber = new THREE.Mesh(bobberGeo, bobberMat);
  bobber.visible = false;
  G.scene.add(bobber);
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(lg, lineMat);
  line.frustumCulled = false;
  line.visible = false;
  G.scene.add(line);
  return { bobber, line };
}

function rodTip(rod, out) {
  // world position of the rod tip: station pos lifted up a bit
  const st = rod.station;
  TMP_A.set(st.localPos?.x || 0, st.localPos?.y || 0, st.localPos?.z || 0);
  const w = G.boat?.toWorld ? G.boat.toWorld(TMP_A) : TMP_A;
  out.copy(w);
  out.y += 2.4;
  return out;
}

function updateLine(rod) {
  const { bobber, line } = rod.vis;
  line.visible = bobber.visible;
  if (!bobber.visible) return;
  rodTip(rod, TMP_B);
  const pos = line.geometry.attributes.position;
  pos.setXYZ(0, TMP_B.x, TMP_B.y, TMP_B.z);
  pos.setXYZ(1, bobber.position.x, bobber.position.y, bobber.position.z);
  pos.needsUpdate = true;
}

function hideRodVisual(rod) {
  rod.vis.bobber.visible = false;
  rod.vis.line.visible = false;
  rod.vis.bobber.material = bobberMat;
  rod.vis.bobber.scale.setScalar(1);
}

// ------------------------------------------------------------------ rod state machine
function ensureRods() {
  const stations = G.boat?.stations;
  if (!stations) return;
  for (const st of stations) {
    if (st.type !== 'rod') continue;
    const existing = rods.get(st.id);
    if (existing) { existing.station = st; continue; } // boat may rebuild station objects
    {
      rods.set(st.id, {
        station: st, phase: 'idle', user: null, t: 0, animT: 0,
        waitT: 0, biteT: 0, castAt: 0, pendingFish: null,
        botTimer: 0, botBit: false, bob: rand() * 6.28,
        target: new THREE.Vector3(), from: new THREE.Vector3(),
        vis: makeRodVisual(),
      });
    }
  }
}

function waitTime(zone) {
  let w = 4 + rand() * 10;                       // 4–14 s
  w *= 1 - 0.12 * (rodLevel() - 1);              // better rod = faster bites
  if (isNight() && (zone === 'fog' || zone === 'deep')) w *= 0.7;
  return w;
}

function beginCast(rod, user) {
  const st = rod.station;
  rod.user = user;
  rod.phase = 'cast';
  rod.animT = 0;
  rod.castAt = rod.t;
  rod.botBit = false;
  // cast outward: away from the boat's center, past the station
  rodTip(rod, rod.from);
  const boatPos = G.boat?.group?.position;
  TMP_A.copy(rod.from);
  if (boatPos) TMP_A.sub(boatPos);
  TMP_A.y = 0;
  if (TMP_A.lengthSq() < 0.01) TMP_A.set(1, 0, 0);
  TMP_A.normalize();
  const dist = 9 + rand() * 5 + rodLevel() * 1.5;
  rod.target.copy(rod.from).addScaledVector(TMP_A, dist);
  rod.target.y = oceanY(rod.target.x, rod.target.z);
  rod.vis.bobber.visible = true;
  rod.vis.bobber.position.copy(rod.from);
  G.sfx?.('cast');
}

function startWaiting(rod) {
  rod.phase = 'wait';
  const zone = zoneAtPos(rod.target.x, rod.target.z);
  if (rod.user && !rod.user.human) {
    rod.botTimer = 20 + rand() * 20; // bots: slow, no minigame
  } else {
    rod.waitT = waitTime(zone);
  }
}

function startBite(rod, user) {
  const zone = zoneAtPos(rod.target.x, rod.target.z);
  rod.pendingFish = rollFish(zone, user);
  rod.phase = 'bite';
  rod.biteT = HOOK_WINDOW_SEC;
  G.emit('fish:bite', { station: rod.station, player: user });
  G.sfx?.('bite');
  if (rod.pendingFish.legendary) {
    rod.vis.bobber.material = bobberLegendMat; // something HUGE is under there
    G.sfx?.('rumble');
  }
  prompt(user, `‼️ HOOK IT! Press ${actionKeyName(user)}`);
}

function missBite(rod, user) {
  rod.pendingFish = null;
  rod.vis.bobber.material = bobberMat;
  prompt(user, null);
  toast('It got away… 🫧');
  G.emit('fish:lost', { player: user });
  startWaiting(rod); // line stays out, wait for the next one
}

function cancelRod(rod) {
  if (rod.user) prompt(rod.user, null);
  rod.phase = 'idle';
  rod.user = null;
  rod.pendingFish = null;
  hideRodVisual(rod);
}

function hook(rod, user) {
  const fish = rod.pendingFish;
  prompt(user, null);
  if (fish.legendary) {
    legendaryHooked = true;
    G.emit('fish:legendary-bite', { player: user, station: rod.station }); // audio: music stops
  }
  rod.phase = 'fight';
  G.sfx?.('hook');
  startFight(user, rod, fish);
}

function startLandAnim(rod) {
  rod.phase = 'land';
  rod.animT = 0;
  rod.from.copy(rod.vis.bobber.position);
  rodTip(rod, rod.target);
  rod.target.y -= 1.5; // onto the deck
}

function updateRod(rod, dt) {
  rod.t += dt;
  const st = rod.station;
  const user = resolveUser(st.user);

  // Boat sailed away from the bobber? Line snaps (prevents mile-long lines to the horizon).
  if (rod.phase === 'wait' || rod.phase === 'bite') {
    rodTip(rod, TMP_B);
    if (TMP_B.distanceTo(rod.vis.bobber.position) > 42) {
      G.sfx?.('lineSnap');
      if (user?.human) G.ui?.toast('Line snapped — too fast! 🧵');
      cancelRod(rod);
      updateLine(rod);
      return;
    }
  }

  switch (rod.phase) {
    case 'idle': {
      if (!user || user.mode === 'busy' || user.mode === 'leviathan') break;
      if (user.human) {
        if (padFor(user)?.actionHit) beginCast(rod, user);
      } else {
        beginCast(rod, user);
      }
      break;
    }
    case 'cast': {
      rod.animT += dt;
      const k = Math.min(1, rod.animT / CAST_ANIM_SEC);
      TMP_A.lerpVectors(rod.from, rod.target, k);
      TMP_A.y += Math.sin(k * Math.PI) * 4; // arc
      rod.vis.bobber.position.copy(TMP_A);
      if (k >= 1) { G.sfx?.('splash'); startWaiting(rod); }
      break;
    }
    case 'wait': {
      if (!user || user !== rod.user) { cancelRod(rod); break; }
      // bobber bobs on the waves
      rod.bob += dt * 3;
      rod.vis.bobber.position.y = oceanY(rod.vis.bobber.position.x, rod.vis.bobber.position.z)
        + Math.sin(rod.bob) * 0.12;
      if (user.human) {
        if (padFor(user)?.actionHit && rod.t - rod.castAt > 0.6) { cancelRod(rod); break; } // reel in early
        rod.waitT -= dt;
        if (rod.waitT <= 0) startBite(rod, user);
      } else {
        updateBot(rod, user, dt);
      }
      break;
    }
    case 'bite': {
      if (!user || user !== rod.user) { cancelRod(rod); break; }
      // bobber yanked underwater
      rod.vis.bobber.position.y = oceanY(rod.vis.bobber.position.x, rod.vis.bobber.position.z)
        - 0.6 - Math.sin(rod.t * 22) * 0.15;
      if (padFor(user)?.actionHit) { hook(rod, user); break; }
      rod.biteT -= dt;
      if (rod.biteT <= 0) missBite(rod, user);
      break;
    }
    case 'fight': {
      // logic lives in the minigame; if it got force-ended elsewhere, tidy up
      const fi = rod.user?.idx;
      if (fi !== 0 && fi !== 1) { cancelRod(rod); break; }
      if (!fights[fi] || fights[fi].rod !== rod) { cancelRod(rod); break; }
      // just thrash the bobber
      const wild = rod.pendingFish?.legendary ? 1.2 : 0.4;
      rod.vis.bobber.position.y = oceanY(rod.vis.bobber.position.x, rod.vis.bobber.position.z)
        - 0.3 + Math.sin(rod.t * 14) * wild * 0.5;
      rod.vis.bobber.position.x += Math.sin(rod.t * 9.7) * wild * dt * 2;
      rod.vis.bobber.position.z += Math.cos(rod.t * 8.3) * wild * dt * 2;
      break;
    }
    case 'land': {
      rod.animT += dt;
      const k = Math.min(1, rod.animT / LAND_ANIM_SEC);
      TMP_A.lerpVectors(rod.from, rod.target, k);
      TMP_A.y += Math.sin(k * Math.PI) * 6; // fanfare arc onto the deck
      rod.vis.bobber.position.copy(TMP_A);
      if (k >= 1) cancelRod(rod);
      break;
    }
  }
  updateLine(rod);
}

// ------------------------------------------------------------------ bots
function updateBot(rod, bot, dt) {
  rod.botTimer -= dt;
  if (!rod.botBit && rod.botTimer <= 1) {
    rod.botBit = true;
    G.emit('fish:bite', { station: rod.station, player: bot });
    G.sfx?.('bite');
  }
  if (rod.botTimer > 0) return;
  if (rand() < BOT_SUCCESS) {
    const zone = zoneAtPos(rod.target.x, rod.target.z);
    let fish = rollFish(zone, bot); // forBot: small only, never legendary
    if (fish.legendary) fish = rollFish('coast', bot); // paranoia: bots never get it
    finishCatch(fish, bot, 'rod');
  } else {
    G.emit('fish:lost', { player: bot });
  }
  rod.botBit = false;
  startWaiting(rod); // bot keeps fishing
}

// ------------------------------------------------------------------ reel minigame
function fightParams(fish) {
  if (fish.legendary) {
    return { speed: 3.4, greenW: 0.16, fightSec: 34, tensRate: 0.42, amp: 0.44 };
  }
  const species = FISHDEX.find((s) => s.id === fish.id);
  const r = species ? clamp(fish.size / species.maxSize, 0, 1) : 0.3;
  const big = clamp(fish.size / 40, 0, 1); // absolute chunk factor
  const greenBase = [0, 0.3, 0.38, 0.46][rodLevel()] || 0.3;
  return {
    speed: 1.5 + r * 1.2 + big * 0.8,
    greenW: clamp(greenBase - r * 0.08, 0.14, 0.5),
    fightSec: fish.junk ? 6 : 15 + 15 * Math.max(r, big),
    tensRate: 0.3 + r * 0.12,
    amp: 0.36 + r * 0.08,
  };
}

function startFight(player, rod, fish) {
  const idx = player.idx;
  if (idx !== 0 && idx !== 1) return; // humans only
  const p = fightParams(fish);
  fights[idx] = {
    player, rod, fish,
    t: rand() * 6.28, jit: 0, marker: 0.5,
    progress: 0.15, tension: 0,
    speed: p.speed, greenW: p.greenW, amp: p.amp,
    reelRate: 1 / (p.fightSec * 0.55), tensRate: p.tensRate,
    sndT: 0, flash: false,
  };
  if (player.mode !== 'leviathan') player.mode = 'busy';
  G.emit('minigame:start', { player, kind: 'reel' });
  showPanel(idx, fish, player);
}

function endFight(f, success) {
  const idx = f.player?.idx ?? 0;
  fights[idx] = null;
  hidePanel(idx);
  if (f.fish?.legendary) legendaryHooked = false;
  if (f.player && f.player.mode === 'busy') f.player.mode = 'deck';
  G.emit('minigame:end', { player: f.player, success });
}

function snapLine(f) {
  G.sfx?.('snap'); // comic twang
  toast(`TWANG! ${f.player ? playerName(f.player) + "'s" : 'The'} line snapped! 🎸`);
  G.emit('fish:lost', { player: f.player });
  if (f.rod) cancelRod(f.rod);
  endFight(f, false);
}

function landFish(f) {
  const { fish, player, rod } = f;
  if (fish.legendary) {
    // Do NOT put it in the hold. It puts YOU in ITS hold.
    if (rod) cancelRod(rod);
    endFight(f, true);
    G.sfx?.('legendary');
    G.emit('fish:legendary', { player }); // threats takes over from here
    return;
  }
  if (rod) startLandAnim(rod);
  endFight(f, true);
  finishCatch(fish, player, 'rod');
}

function updateFight(f, dt) {
  if (!f.player || f.player.mode === 'leviathan') { endFight(f, false); return; }
  const pad = padFor(f.player);
  const holding = !!pad?.action;
  f.t += dt * f.speed;
  f.jit += (rand() - 0.5) * 2.6 * dt;
  f.jit *= Math.max(0, 1 - dt * 1.6);
  f.marker = clamp(0.5 + Math.sin(f.t) * f.amp + Math.sin(f.t * 2.7 + 1.3) * 0.07 + f.jit, 0.02, 0.98);
  const inGreen = Math.abs(f.marker - 0.5) <= f.greenW / 2;
  f.flash = false;
  if (holding) {
    if (inGreen) {
      f.progress += f.reelRate * dt;
      f.tension = Math.max(0, f.tension - 0.12 * dt);
      f.sndT += dt;
      if (f.sndT > 0.22) { f.sndT = 0; G.sfx?.('reel'); }
    } else {
      f.tension += f.tensRate * dt; // wrong! tension rises fast
      f.flash = true;
    }
  } else {
    f.tension = Math.max(0, f.tension - 0.3 * dt);
    f.progress = Math.max(0, f.progress - 0.05 * dt);
  }
  // walked-away guard: a fight can't run forever (kids WILL put the keyboard down mid-fight)
  f.idleT = holding ? 0 : (f.idleT || 0) + dt;
  f.totalT = (f.totalT || 0) + dt;
  if (f.idleT > 8 || f.totalT > 75) {
    G.ui?.toast('The fish wriggled free… 🐟💨');
    endFight(f, false);
    return;
  }
  if (f.tension >= 1) { snapLine(f); return; }
  if (f.progress >= 1) { landFish(f); }
}

// ------------------------------------------------------------------ catches
function finishCatch(fish, player, how) {
  G.emit('fish:caught', { fish, player, how }); // hold listener stores it
  if (fish.cursed) G.emit('fish:cursed', { fish });
  if (fish.junk) {
    G.sfx?.('plop');
    toast(JUNK_TOASTS[fish.id] || `You caught… junk ${fish.emoji}. 1 coin.`);
  } else {
    G.sfx?.(player?.human ? 'catch' : 'plop');
    if (player?.human) G.sfx?.('fanfare');
    const curse = fish.cursed ? ' 💚 It glows… uh oh.' : '';
    toast(`${playerName(player)} caught a ${fish.name} ${fish.emoji} · ${fish.size} kg · 🪙${fish.value}!${curse}`);
  }
}

// ------------------------------------------------------------------ minigame DOM (#fishing-ui — ours)
function buildUI() {
  uiRoot = document.getElementById('fishing-ui');
  if (!uiRoot) return;
  const style = document.createElement('style');
  style.id = 'df-fishing-style';
  style.textContent = `
    #fishing-ui { display: flex; gap: 14px; align-items: flex-end; pointer-events: none; }
    .df-reel {
      background: rgba(11, 45, 74, 0.92); border: 3px solid #ffc94d; border-radius: 18px;
      padding: 10px 14px 12px; width: min(300px, 42vw); text-align: center;
      font-weight: 700; color: #fff8ea;
    }
    .df-reel.df-p2 { border-color: #6fd3ff; }
    .df-reel.df-legendary { border-color: #8ef0a2; box-shadow: 0 0 22px rgba(80, 240, 140, 0.7); animation: dfShake 0.15s infinite; }
    @keyframes dfShake { 0% { transform: translate(0,0); } 50% { transform: translate(2px,-1px); } 100% { transform: translate(-2px,1px); } }
    .df-name { font-size: 16px; margin-bottom: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .df-track {
      position: relative; height: 30px; border-radius: 999px;
      background: rgba(255,255,255,0.15); overflow: hidden; margin-bottom: 7px;
    }
    .df-green {
      position: absolute; top: 0; bottom: 0; left: 50%; transform: translateX(-50%);
      background: rgba(59, 178, 115, 0.85); border-radius: 8px;
    }
    .df-marker {
      position: absolute; top: 50%; transform: translate(-50%, -50%);
      font-size: 22px; line-height: 1; filter: drop-shadow(0 2px 2px rgba(0,0,0,0.5));
    }
    .df-row { display: flex; align-items: center; gap: 6px; margin-top: 4px; font-size: 13px; }
    .df-bar { flex: 1; height: 12px; border-radius: 999px; background: rgba(255,255,255,0.15); overflow: hidden; }
    .df-bar > div { height: 100%; border-radius: 999px; }
    .df-prog > div { background: #ffc94d; width: 0%; }
    .df-tens > div { background: #e5484d; width: 0%; }
    .df-reel.df-flash .df-tens { animation: dfFlash 0.2s infinite; }
    @keyframes dfFlash { 0% { background: rgba(229,72,77,0.2); } 50% { background: rgba(229,72,77,0.6); } 100% { background: rgba(229,72,77,0.2); } }
    .df-hint { margin-top: 7px; font-size: 18px; letter-spacing: 1px; color: #ffc94d; }
    .df-reel.df-legendary .df-hint, .df-reel.df-legendary .df-name { color: #8ef0a2; }
  `;
  document.head.appendChild(style);
  for (let i = 0; i < 2; i++) {
    const el = document.createElement('div');
    el.className = 'df-reel' + (i === 1 ? ' df-p2' : '');
    el.innerHTML = `
      <div class="df-name"></div>
      <div class="df-track"><div class="df-green"></div><div class="df-marker">🐟</div></div>
      <div class="df-row"><span>🎣</span><div class="df-bar df-prog"><div></div></div></div>
      <div class="df-row"><span>🧵</span><div class="df-bar df-tens"><div></div></div></div>
      <div class="df-hint"></div>
    `;
    el.style.display = 'none';
    uiRoot.appendChild(el);
    panels[i] = {
      root: el,
      name: el.querySelector('.df-name'),
      green: el.querySelector('.df-green'),
      marker: el.querySelector('.df-marker'),
      prog: el.querySelector('.df-prog > div'),
      tens: el.querySelector('.df-tens > div'),
      hint: el.querySelector('.df-hint'),
    };
  }
}

function showPanel(idx, fish, player) {
  const p = panels[idx];
  if (!p) return;
  uiRoot?.classList.remove('hidden');
  p.root.style.display = '';
  p.root.classList.toggle('df-legendary', !!fish.legendary);
  p.name.textContent = fish.legendary
    ? '🌑 ??? SOMETHING ENORMOUS ???'
    : `${fish.emoji} ${fish.name} · ${fish.size} kg`;
  p.marker.textContent = fish.legendary ? '🌑' : fish.emoji;
  p.hint.textContent = `HOLD ${actionKeyName(player)} in the green!`;
}

function hidePanel(idx) {
  const p = panels[idx];
  if (!p) return;
  p.root.style.display = 'none';
  p.root.classList.remove('df-flash', 'df-legendary');
  if (!fights[0] && !fights[1]) uiRoot?.classList.add('hidden');
}

function syncUI() {
  for (let i = 0; i < 2; i++) {
    const f = fights[i];
    const p = panels[i];
    if (!f || !p) continue;
    p.green.style.width = `${(f.greenW * 100).toFixed(1)}%`;
    p.marker.style.left = `${(f.marker * 100).toFixed(1)}%`;
    p.prog.style.width = `${(clamp(f.progress, 0, 1) * 100).toFixed(1)}%`;
    p.tens.style.width = `${(clamp(f.tension, 0, 1) * 100).toFixed(1)}%`;
    p.root.classList.toggle('df-flash', f.flash);
  }
}

// ------------------------------------------------------------------ reset / save
function cancelAll() {
  for (let i = 0; i < 2; i++) if (fights[i]) endFight(fights[i], false);
  for (const rod of rods.values()) cancelRod(rod);
  legendaryHooked = false;
}
function resetAll() {
  cancelAll();
  if (G.hold) G.hold.fish.length = 0;
  G.biggestCatch = null;
}

// ------------------------------------------------------------------ module API
export function init(g) {
  G = g;
  G.fishdex = FISHDEX;
  G.hold = makeHold();
  G.biggestCatch = null;

  bobberGeo = new THREE.SphereGeometry(0.32, 10, 8);
  bobberMat = new THREE.MeshToonMaterial({ color: 0xe5484d });
  bobberLegendMat = new THREE.MeshToonMaterial({ color: 0x39d97a, emissive: 0x1c7a3e });
  lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.65 });

  buildUI();

  // Store every catch from ANY source (rod / harpoon / shell) + track record.
  G.on('fish:caught', ({ fish }) => {
    if (!fish || fish.legendary) return;
    addToHold(fish);
    if (!fish.junk && (!G.biggestCatch || fish.size > G.biggestCatch.size)) {
      G.biggestCatch = { name: fish.name, emoji: fish.emoji, size: fish.size, value: fish.value };
    }
  });

  // Fish Rebellion curse: threats asks the hold to spill n fish.
  // threats.js pre-removes the fish itself and sends them in the payload — only remove when asked without a fish list
  G.on('hold:spill', (d) => { if (!d?.fish) G.hold?.removeRandom(d?.n || 3); });

  G.on('save:collect', (data) => {
    data.fishing = {
      hold: G.hold ? G.hold.fish.map((f) => ({ ...f })) : [],
      biggestCatch: G.biggestCatch ? { ...G.biggestCatch } : null,
    };
  });
  G.on('save:apply', (data) => {
    const s = data?.fishing;
    if (!s || !G.hold) return;
    G.hold.fish.length = 0;
    if (Array.isArray(s.hold)) for (const f of s.hold) G.hold.fish.push(f);
    G.biggestCatch = s.biggestCatch || null;
  });

  G.on('game:new', resetAll);
  G.on('game:continue', cancelAll); // lines don't survive a reload
  G.on('leviathan:begin', cancelAll); // everyone drops their rods when the boss shows up
}

export function update(g, dt) {
  G = g;
  ensureRods();
  if (dt > 0) {
    for (const rod of rods.values()) updateRod(rod, dt);
    for (let i = 0; i < 2; i++) if (fights[i]) updateFight(fights[i], dt);
  }
  syncUI();
}
