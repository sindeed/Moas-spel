// Dear Fishermen — threats.js — THE DIRECTOR.
// Difficulty scheduling, storms/typhoons, leaks & fires, night creepiness,
// shark hull attacks, curses, MEGALODON, and the LEVIATHAN traitor finale.
// Owns DOM: #alert, #bossbar (+ #bossname, #boss-fill), #curse-tint.
// Owns G.flags.cannonTargets (array of shootable monster entries).
import * as THREE from '../lib/three.module.min.js';

let GG = null;

// ---------------------------------------------------------------- DOM refs
let alertEl, bossEl, bossNameEl, bossFillEl, tintEl;
let alertTimer = 0;

// ---------------------------------------------------------------- temp vectors (no per-frame allocs)
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

// ---------------------------------------------------------------- tuning
const GRACE_SEC = 240;          // tutorial grace: zero threats for first 4 minutes of a run
const CURSE_SEC = 60;
const SHARK_ATTACK_SEC = 30;
const MEG_TIMEOUT_SEC = 180;
const LEV_SURVIVE_SEC = 90;

// ---------------------------------------------------------------- director state
let schedule = [];              // [{at:secToday, kind:'storm'|'typhoon'}]
let scheduledDay = -1;
let leakRoll = 0, fireRoll = 0; // probability accumulators
let creepTimer = 30;
let sharkCheckTimer = 25;
let megAt = -1;                 // secToday when megalodon becomes possible today (-1 = not today)
let megUsedDay = -1;
let targetSeq = 0;

// storm
let storm = null;               // {level, t, typhoon}
let stormSpikeT = 0;            // tail-slam wave spike

// shark hull attack
let shark = null;               // {t, ramT, entry}
let sharkMesh = null;

// curse
let curse = null;               // {kind, t, creepT}
let floppers = [];              // rebellion fish on deck
let flopperPool = [];
let curseLight = null;

// megalodon
let meg = null;                 // {phase, t, angle, radius, ramCd, biteCd, entry}
let megMesh = null;

// leviathan
let lev = null;                 // {phase, t, playerIdx, hpEntry, surviveT, ...}
let levHead = null, levSegs = [], levGroup = null;
let legendMesh = null;
const levSegPos = [];
const LEV_SEG_N = 10, LEV_SPACING = 5;

// splash pool
const splashes = [];

// ================================================================ small utils
function boatPos() { return GG?.boat?.group?.position || _v3.set(0, 0, 0); }
function curWeek() { return GG?.time?.week || 1; }
function scaleW() { return 1 + 0.15 * Math.max(0, curWeek() - 3); }
function graceOver() { return (GG?.time?.total || 0) >= GRACE_SEC; }
function curZone() {
  const p = GG?.boat?.group?.position;
  if (!p || typeof GG?.zoneAt !== 'function') return 'open';
  try { return GG.zoneAt(p.x, p.z); } catch (e) { return 'open'; }
}
function isNight() { return GG?.time?.phase === 'night'; }
function rnd() { return GG?.rng ? GG.rng() : Math.random(); }
function toast(t) { GG?.ui?.toast?.(t); }
function banner(t, ms, kind) { GG?.ui?.banner?.(t, ms, kind); }
function sfx(n, o) { try { GG?.sfx?.(n, o); } catch (e) {} }
function playerName(p) { return 'P' + ((p?.idx ?? 0) + 1); }
function ensureFlags() {
  if (!GG.flags) GG.flags = {};
  if (!Array.isArray(GG.flags.cannonTargets)) GG.flags.cannonTargets = [];
  if (GG.flags.sharkLevel === undefined) GG.flags.sharkLevel = 0;
}

// ---------------------------------------------------------------- alert (#alert)
function showAlert(text, secs = 3.2, creepy = false) {
  if (!alertEl) return;
  alertEl.textContent = text;
  alertEl.classList.toggle('creepy', !!creepy);
  alertEl.classList.remove('hidden');
  alertTimer = secs;
}
function alertTick(dt) {
  if (alertTimer > 0) {
    alertTimer -= dt;
    if (alertTimer <= 0 && alertEl) alertEl.classList.add('hidden');
  }
}

// ---------------------------------------------------------------- bossbar
function showBoss(name) {
  if (!bossEl) return;
  if (bossNameEl) bossNameEl.textContent = name;
  if (bossFillEl) bossFillEl.style.width = '100%';
  bossEl.classList.remove('hidden');
}
function setBoss(frac, name) {
  if (bossFillEl) bossFillEl.style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%';
  if (name !== undefined && bossNameEl) bossNameEl.textContent = name;
}
function hideBoss() { bossEl?.classList.add('hidden'); }

// ---------------------------------------------------------------- cannon targets (WE own this array)
function addCannonTarget(kind, obj, radius, maxHits) {
  const entry = {
    id: kind + '-' + (++targetSeq), kind, obj, radius,
    hp: maxHits, maxHp: maxHits,
    // boat.js cannon calls entry.onHit(dmg) on a landed shot; dmg = harpoon level (1-3) counts as that many hits.
    hit(dmg) { entry.hp = Math.max(0, entry.hp - Math.max(1, Math.round(dmg || 1))); entry.lastHit = GG?.time?.total || 0; sfx('thud'); },
    onHit(dmg) { entry.hit(dmg); },
  };
  ensureFlags();
  GG.flags.cannonTargets.push(entry);
  return entry;
}
function removeCannonTarget(entry) {
  ensureFlags();
  const i = GG.flags.cannonTargets.indexOf(entry);
  if (i >= 0) GG.flags.cannonTargets.splice(i, 1);
}

// ---------------------------------------------------------------- splash pool (cheap, reused)
function initSplashes(scene) {
  const geo = new THREE.SphereGeometry(1, 8, 6);
  geo.scale(1, 0.35, 1);
  for (let i = 0; i < 4; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0 });
    const m = new THREE.Mesh(geo, mat);
    m.visible = false;
    scene.add(m);
    splashes.push({ mesh: m, t: 0, dur: 0.7, size: 3 });
  }
}
function splashAt(x, y, z, size = 3) {
  const s = splashes.find((sp) => !sp.mesh.visible) || splashes[0];
  s.mesh.position.set(x, y, z);
  s.mesh.visible = true;
  s.t = 0; s.size = size;
  s.mesh.scale.setScalar(0.4);
  s.mesh.material.opacity = 0.85;
  sfx('splash');
}
function splashTick(dt) {
  for (const s of splashes) {
    if (!s.mesh.visible) continue;
    s.t += dt;
    const k = s.t / s.dur;
    if (k >= 1) { s.mesh.visible = false; continue; }
    s.mesh.scale.setScalar(0.4 + k * s.size);
    s.mesh.material.opacity = 0.85 * (1 - k);
  }
}

// ================================================================ DAY SCHEDULER
function rollDay() {
  schedule.length = 0;
  scheduledDay = (GG?.time?.week || 1) * 10 + (GG?.time?.day || 1);
  const wk = curWeek();
  const full = GG?.consts?.FULL_DAY || 1200;
  // storms: week1 gentle (0-1), later 1-3, scaled by legacy
  let nStorms = wk <= 1 ? (rnd() < 0.6 ? 1 : 0) : Math.min(3, 1 + Math.floor(rnd() * (1 + wk * 0.5 * scaleW())));
  for (let i = 0; i < nStorms; i++) {
    schedule.push({ at: 120 + rnd() * (full - 300), kind: 'storm' });
  }
  // typhoon: week >= 2, rare
  if (wk >= 2 && rnd() < 0.12 + 0.06 * (wk - 2)) {
    schedule.push({ at: 200 + rnd() * (full - 400), kind: 'typhoon' });
  }
  // megalodon: week >= 3, roughly once per 1-2 days
  megAt = -1;
  if (wk >= 3 && rnd() < 0.6 && megUsedDay !== scheduledDay) {
    megAt = 150 + rnd() * (full - 400);
  }
  leakRoll = 0; fireRoll = 0;
  creepTimer = 40 + rnd() * 50;
  sharkCheckTimer = 20 + rnd() * 30;
}

function schedulerTick(dt) {
  if (scheduledDay !== (GG.time.week * 10 + GG.time.day)) rollDay();
  if (!graceOver()) return;
  const sec = GG.time.secToday;

  // fire scheduled weather events
  for (let i = schedule.length - 1; i >= 0; i--) {
    const ev = schedule[i];
    if (sec >= ev.at) {
      schedule.splice(i, 1);
      if (!storm && !GG.flags.bossActive) {
        if (ev.kind === 'storm') startStorm(false);
        else if (ev.kind === 'typhoon') startStorm(true);
      }
    }
  }

  // random leaks & fires (more at night / storm / later weeks)
  const wkF = 0.5 + curWeek() * 0.35;
  const stormF = 1 + (GG.weather?.storm || 0) * 2.2;
  const nightF = isNight() ? 1.6 : 1;
  const moored = !!GG.boat?.moored;
  if (!moored) {
    const activeLeaks = GG.boat?.leaks ? GG.boat.leaks.filter((l) => l && l.active).length : 0;
    leakRoll += dt * 0.0035 * wkF * stormF * nightF * scaleW();
    if (leakRoll >= 1) {
      leakRoll = rnd() * 0.5; // jitter the next one
      if (activeLeaks < 5) { try { GG.boat?.addLeak?.(); } catch (e) {} }
    }
    const fires = GG.boat?.fires ? GG.boat.fires.length : 0;
    fireRoll += dt * 0.0016 * wkF * stormF * nightF * scaleW();
    if (fireRoll >= 1) {
      fireRoll = rnd() * 0.5;
      if (fires < 3) { try { GG.boat?.addFire?.(); } catch (e) {} }
    }
  }

  // night creepiness in the fog
  if (isNight() && curZone() === 'fog') {
    creepTimer -= dt;
    if (creepTimer <= 0) {
      creepTimer = 45 + rnd() * 45;
      GG.emit('creepy', {});
      const lines = ['...did you hear that? 👂', 'something is watching... 👀', 'the fog whispers... 🌫️', 'don’t look at the water. 🌊'];
      showAlert(lines[Math.floor(rnd() * lines.length)], 2.6, true);
    }
  }

  // shark hull attack rolls
  if (!shark && !meg && !storm?.typhoon && curWeek() >= 2 && !GG.flags.bossActive) {
    const z = curZone();
    if ((z === 'deep' || z === 'fog') && !GG.boat?.moored) {
      sharkCheckTimer -= dt;
      if (sharkCheckTimer <= 0) {
        sharkCheckTimer = 45 + rnd() * 60;
        if (rnd() < 0.5 * scaleW()) startSharkAttack();
      }
    }
  }

  // megalodon trigger
  if (megAt >= 0 && sec >= megAt && !meg && !shark && !GG.flags.bossActive) {
    const z = curZone();
    if ((z === 'deep' || z === 'fog') && !GG.boat?.moored) {
      megAt = -1;
      megUsedDay = scheduledDay;
      startMegalodon();
    }
  }
}

// ================================================================ STORMS
function startStorm(typhoon) {
  if (!GG.weather) return;
  const level = typhoon ? 1 : 0.5 + rnd() * 0.5;
  storm = { level, t: typhoon ? 90 : 60 + rnd() * 90, typhoon };
  GG.weather.stormTarget = level;
  if (typhoon) {
    GG.weather.typhoon = true;
    showAlert('TYPHOON!!! ⛈️🌊⛈️', 4);
    GG.emit('typhoon:start', {});
    GG.emit('storm:start', { level });
  } else {
    showAlert('STORM INCOMING! ⛈️', 3.5);
    GG.emit('storm:start', { level });
  }
  sfx('thunder');
}
function endStorm() {
  if (!storm) return;
  const wasTyphoon = storm.typhoon;
  storm = null;
  if (GG.weather) {
    GG.weather.stormTarget = 0;
    if (wasTyphoon) GG.weather.typhoon = false;
  }
  if (wasTyphoon) GG.emit('typhoon:end', {});
  GG.emit('storm:end', {});
}
function stormTick(dt) {
  if (storm) {
    storm.t -= dt;
    if (storm.t <= 0) endStorm();
  }
  // ease weather.storm toward stormTarget (world.js may also do this; both converge).
  // Never touch weather.storm before we have ever set a stormTarget.
  const w = GG.weather;
  if (stormSpikeT > 0) stormSpikeT -= dt;
  if (w && typeof w.storm === 'number') {
    let target = typeof w.stormTarget === 'number' ? w.stormTarget : null;
    if (stormSpikeT > 0) target = Math.max(target ?? 0, 0.9);
    if (target !== null) {
      w.storm += (target - w.storm) * Math.min(1, dt * 0.25);
      if (Math.abs(target - w.storm) < 0.005) w.storm = target;
    }
  }
  // wash impulse expiry
  if (GG.flags.washImpulse && (GG.time?.total || 0) > (GG.flags.washUntil || 0)) {
    GG.flags.washImpulse = null;
  }
}

// ================================================================ SHARK HULL ATTACK
function buildShark(color, len) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshToonMaterial({ color });
  const bodyGeo = new THREE.SphereGeometry(1, 10, 8);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.scale.set(len * 0.5, len * 0.16, len * 0.18); g.add(body);
  const belly = new THREE.Mesh(bodyGeo, new THREE.MeshToonMaterial({ color: 0xcfe3ee }));
  belly.scale.set(len * 0.44, len * 0.12, len * 0.16); belly.position.y = -len * 0.05; g.add(belly);
  const finGeo = new THREE.ConeGeometry(len * 0.12, len * 0.3, 4);
  const dorsal = new THREE.Mesh(finGeo, bodyMat);
  dorsal.position.set(0, len * 0.24, 0); g.add(dorsal);
  const tail = new THREE.Mesh(finGeo, bodyMat);
  tail.position.set(-len * 0.5, len * 0.06, 0); tail.rotation.z = Math.PI / 3; g.add(tail);
  const eyeGeo = new THREE.SphereGeometry(len * 0.035, 6, 5);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(len * 0.32, len * 0.06, s * len * 0.12); g.add(eye);
  }
  // goofy teeth band so it stays cartoonish
  const teeth = new THREE.Mesh(new THREE.TorusGeometry(len * 0.1, len * 0.025, 6, 10), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  teeth.position.set(len * 0.44, 0, 0); teeth.rotation.y = Math.PI / 2; g.add(teeth);
  g.visible = false;
  return g;
}

function startSharkAttack() {
  shark = { t: SHARK_ATTACK_SEC, ramT: 4, angle: rnd() * Math.PI * 2, entry: null };
  shark.entry = addCannonTarget('shark', sharkMesh, 5, 2);
  GG.flags.sharkLevel = 1;
  sharkMesh.visible = true;
  const bp = boatPos();
  sharkMesh.position.set(bp.x + 20, -0.5, bp.z);
  showAlert('SHARK RAMMING THE HULL! 🦈', 3.5);
  GG.emit('shark:attack', { shark: shark.entry });
  sfx('shark');
}
function endSharkAttack(shot) {
  if (!shark) return;
  if (shark.entry) removeCannonTarget(shark.entry);
  shark = null;
  GG.flags.sharkLevel = 0;
  if (sharkMesh) sharkMesh.visible = false;
  if (shot) { toast('Shark driven off! 🦈💨'); GG.emit('reward:money', { amount: 20 * curWeek(), why: 'shark' }); }
  else toast('The shark got bored and left. 🦈');
}
function sharkTick(dt) {
  if (!shark) return;
  shark.t -= dt;
  if (shark.entry && shark.entry.hp <= 0) { splashAt(sharkMesh.position.x, 0.5, sharkMesh.position.z, 4); endSharkAttack(true); return; }
  if (shark.t <= 0) { endSharkAttack(false); return; }
  // circle tight around the boat
  const bp = boatPos();
  shark.angle += dt * 0.9;
  const r = 13 + Math.sin(shark.angle * 2.3) * 2;
  const x = bp.x + Math.cos(shark.angle) * r;
  const z = bp.z + Math.sin(shark.angle) * r;
  sharkMesh.position.set(x, -0.4 + Math.sin(shark.angle * 4) * 0.3, z);
  sharkMesh.rotation.y = -shark.angle - Math.PI / 2 + Math.PI;
  // ram the hull every ~8s
  shark.ramT -= dt;
  if (shark.ramT <= 0) {
    shark.ramT = 7 + rnd() * 2.5;
    try { GG.boat?.damage?.(4, 'shark'); } catch (e) {}
    if (rnd() < 0.35) { try { GG.boat?.addLeak?.(); } catch (e) {} }
    splashAt(bp.x + (x - bp.x) * 0.45, 0.6, bp.z + (z - bp.z) * 0.45, 3);
    sfx('thud');
  }
}

// ================================================================ CURSES
function pickCurse() {
  const kinds = ['ghost', 'rebellion', 'dance', 'boots'];
  const holdN = GG.hold?.fish?.length || 0;
  const pool = kinds.filter((k) => k !== 'rebellion' || holdN > 0);
  return pool[Math.floor(rnd() * pool.length)];
}
function startCurse() {
  if (curse || GG.flags.bossActive) return;
  const kind = pickCurse();
  curse = { kind, t: CURSE_SEC, creepT: 2 };
  GG.flags.curse = kind;
  tintEl?.classList.remove('hidden');
  const lines = {
    ghost: '👻 GHOST DECK! the lights feel... wrong',
    rebellion: '🐟 FISH REBELLION! catch them back!',
    dance: '🕺 DANCE CURSE! the crew can’t stop dancing!',
    boots: '🥾 HEAVY BOOTS! so... very... heavy...',
  };
  showAlert(lines[kind] || 'CURSED! 👻', 3.5, true);
  GG.emit('curse:start', { kind });
  sfx('curse');
  if (kind === 'ghost') {
    curseLight = GG.scene?.children?.find?.((o) => o.isHemisphereLight) || null;
  }
  if (kind === 'rebellion') startRebellion();
}
function endCurse() {
  if (!curse) return;
  const kind = curse.kind;
  curse = null;
  GG.flags.curse = null;
  tintEl?.classList.add('hidden');
  curseLight = null; // world.js rewrites the correct intensity next frame
  clearFloppers(false);
  GG.emit('curse:end', { kind });
}
function curseTick(dt) {
  if (!curse) return;
  curse.t -= dt;
  if (curse.t <= 0) { endCurse(); return; }
  if (curse.kind === 'ghost') {
    curse.creepT -= dt;
    if (curse.creepT <= 0) { curse.creepT = 4 + rnd() * 3; GG.emit('creepy', {}); }
    if (curseLight) {
      // subtle lantern flicker — world rewrites the base intensity each frame before us,
      // so multiplying in place flickers the live value without freezing it
      const fl = 0.82 + 0.18 * Math.abs(Math.sin((GG.time?.total || 0) * 7) * Math.sin((GG.time?.total || 0) * 2.3));
      curseLight.intensity *= fl;
    }
  }
  flopperTick(dt);
}

// ---- fish rebellion: spilled fish flop around the deck; walk over them to re-catch
function initFlopperPool(scene) {
  const bodyGeo = new THREE.SphereGeometry(0.45, 8, 6);
  bodyGeo.scale(1.4, 0.9, 0.7);
  const tailGeo = new THREE.ConeGeometry(0.3, 0.5, 4);
  const mat = new THREE.MeshToonMaterial({ color: 0x8fd0e8 });
  for (let i = 0; i < 4; i++) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(bodyGeo, mat));
    const tail = new THREE.Mesh(tailGeo, mat);
    tail.position.x = -0.75; tail.rotation.z = Math.PI / 2; g.add(tail);
    g.visible = false;
    scene.add(g);
    flopperPool.push(g);
  }
}
function startRebellion() {
  const holdFish = GG.hold?.fish;
  if (!Array.isArray(holdFish) || !holdFish.length) return;
  const n = Math.min(4, holdFish.length);
  // WE take the fish out of the hold and notify everyone via 'hold:spill'
  const spilled = holdFish.splice(holdFish.length - n, n);
  GG.emit('hold:spill', { n, fish: spilled });
  const deckY = GG.players?.[0]?.localPos?.y ?? 1;
  const parent = GG.boat?.group || GG.scene;
  for (let i = 0; i < spilled.length && i < flopperPool.length; i++) {
    const mesh = flopperPool[i];
    if (mesh.parent !== parent) parent.add(mesh);
    const lp = { x: (rnd() - 0.5) * 6, y: deckY, z: (rnd() - 0.5) * 10 };
    if (GG.boat?.deckBound) {
      try { const b = GG.boat.deckBound(_v1.set(lp.x, deckY, lp.z)); if (b?.pos) { lp.x = b.pos.x; lp.z = b.pos.z; } } catch (e) {}
    }
    mesh.position.set(lp.x, deckY, lp.z);
    mesh.visible = true;
    floppers.push({ mesh, fish: spilled[i], vy: 0, deckY, life: 25, dir: rnd() * Math.PI * 2, escaping: false });
  }
  toast('The catch is escaping! Step on the fish! 🐟');
}
function clearFloppers(withSplash) {
  for (const f of floppers) {
    if (withSplash) splashAt(f.mesh.getWorldPosition(_v1).x, 0.5, _v1.z, 2);
    f.mesh.visible = false;
  }
  floppers.length = 0;
}
function flopperTick(dt) {
  if (!floppers.length) return;
  for (let i = floppers.length - 1; i >= 0; i--) {
    const f = floppers[i];
    f.life -= dt;
    // flop-hop physics in boat-local space
    f.vy -= 22 * dt;
    f.mesh.position.y += f.vy * dt;
    if (f.mesh.position.y <= f.deckY) {
      f.mesh.position.y = f.deckY;
      f.vy = 3.5 + rnd() * 2.5;
      f.dir += (rnd() - 0.5) * 2.2;
      sfx('flop');
    }
    const hop = f.escaping ? 4.5 : 1.6;
    f.mesh.position.x += Math.cos(f.dir) * hop * dt;
    f.mesh.position.z += Math.sin(f.dir) * hop * dt;
    f.mesh.rotation.y = -f.dir;
    f.mesh.rotation.z = Math.sin((GG.time?.total || 0) * 14 + i) * 0.5;
    if (!f.escaping && GG.boat?.deckBound) {
      try {
        const b = GG.boat.deckBound(_v1.copy(f.mesh.position));
        if (b?.pos) { f.mesh.position.x = b.pos.x; f.mesh.position.z = b.pos.z; }
      } catch (e) {}
    }
    // players stepping on a fish re-catch it
    let caught = false;
    if (Array.isArray(GG.players)) {
      for (const p of GG.players) {
        if (!p || p.mode !== 'deck' || !p.localPos) continue;
        const dx = p.localPos.x - f.mesh.position.x;
        const dz = p.localPos.z - f.mesh.position.z;
        if (dx * dx + dz * dz < 2.0) {
          f.mesh.visible = false;
          floppers.splice(i, 1);
          GG.emit('fish:caught', { fish: f.fish, player: p, how: 'rod' });
          sfx('catch');
          caught = true;
          break;
        }
      }
    }
    if (caught) continue;
    if (f.life <= 6 && !f.escaping) { f.escaping = true; f.dir = Math.atan2(f.mesh.position.z, f.mesh.position.x); }
    if (f.life <= 0) {
      f.mesh.getWorldPosition(_v1);
      splashAt(_v1.x, 0.4, _v1.z, 2);
      toast('A fish hopped overboard... bye bye 🐟💨');
      f.mesh.visible = false;
      floppers.splice(i, 1);
    }
  }
}

// ================================================================ MEGALODON
function startMegalodon() {
  meg = { phase: 'omen', t: 0, angle: rnd() * Math.PI * 2, radius: 70, ramCd: 6, biteCd: 12, entry: null, alive: MEG_TIMEOUT_SEC };
  megMesh.visible = true;
  const bp = boatPos();
  megMesh.position.set(bp.x + Math.cos(meg.angle) * 70, -4.5, bp.z + Math.sin(meg.angle) * 70);
  showAlert('...something BIG is coming 🦈🦈🦈', 4, true);
  GG.emit('megalodon:begin', {});
  sfx('boss');
}
function endMegalodon(defeated) {
  if (!meg) return;
  if (meg.entry) removeCannonTarget(meg.entry);
  meg = null;
  megMesh.visible = false;
  hideBoss();
  if (defeated) {
    const amount = 150 + 60 * curWeek();
    GG.emit('reward:money', { amount, why: 'megalodon' });
    banner('MEGALODON DRIVEN OFF! 💰 +' + amount, 3500, 'ok');
  } else {
    toast('The megalodon swims away... for now. 🦈');
  }
  GG.emit('megalodon:end', { defeated: !!defeated });
}
function megTick(dt) {
  if (!meg) return;
  const bp = boatPos();
  meg.alive -= dt;
  if (meg.phase !== 'flee') {
    if (meg.entry && meg.entry.hp <= 0) {
      meg.phase = 'flee'; meg.t = 0;
      splashAt(megMesh.position.x, 1, megMesh.position.z, 8);
      showAlert('THE MEGALODON FLEES! 🦈💨', 3);
    } else if (meg.alive <= 0) {
      meg.phase = 'flee'; meg.t = 0; meg.gaveUp = true;
    }
  }
  switch (meg.phase) {
    case 'omen': {
      meg.t += dt;
      meg.angle += dt * 0.5;
      meg.radius = Math.max(34, meg.radius - dt * 6);
      megMesh.position.set(bp.x + Math.cos(meg.angle) * meg.radius, -4.2, bp.z + Math.sin(meg.angle) * meg.radius);
      megMesh.rotation.y = -meg.angle - Math.PI / 2 + Math.PI;
      if (meg.t >= 6) {
        meg.phase = 'circle'; meg.t = 0;
        const hits = Math.min(16, 8 + 2 * Math.max(0, curWeek() - 3));
        meg.entry = addCannonTarget('megalodon', megMesh, 9, hits);
        showAlert('MEGALODON!!! 🦈', 3.5);
        showBoss('🦈 MEGALODON');
        splashAt(megMesh.position.x, 1, megMesh.position.z, 9);
      }
      break;
    }
    case 'circle': {
      meg.angle += dt * 0.55;
      meg.radius += (30 - meg.radius) * Math.min(1, dt * 1.5);
      megMesh.position.x += (bp.x + Math.cos(meg.angle) * meg.radius - megMesh.position.x) * Math.min(1, dt * 2);
      megMesh.position.z += (bp.z + Math.sin(meg.angle) * meg.radius - megMesh.position.z) * Math.min(1, dt * 2);
      megMesh.position.y = -1.6 + Math.sin(meg.angle * 3) * 0.5;
      megMesh.rotation.y = -meg.angle - Math.PI / 2 + Math.PI;
      meg.ramCd -= dt;
      if (meg.ramCd <= 0) { meg.phase = 'ram'; meg.t = 0; sfx('shark'); }
      // comic bite: launches a swimming player back onto the deck
      meg.biteCd -= dt;
      if (meg.biteCd <= 0 && Array.isArray(GG.players)) {
        for (const p of GG.players) {
          if (!p || p.mode !== 'swim') continue;
          const wp = p.worldPos ? p.worldPos() : null;
          if (!wp) continue;
          if (_v1.copy(wp).sub(megMesh.position).lengthSq() < 28 * 28) {
            meg.biteCd = 20;
            splashAt(wp.x, 0.6, wp.z, 5);
            p.mode = 'deck';
            p.carry = null;
            if (p.localPos) {
              p.localPos.x = (rnd() - 0.5) * 4;
              p.localPos.z = (rnd() - 0.5) * 6;
            }
            toast('🦈 MEGALODON spat ' + playerName(p) + ' back on deck! Rude.');
            sfx('wahh');
            break;
          }
        }
      }
      break;
    }
    case 'ram': {
      meg.t += dt;
      _v1.copy(bp).sub(megMesh.position); _v1.y = 0;
      const d = _v1.length();
      if (d > 0.01) _v1.multiplyScalar(1 / d);
      megMesh.position.x += _v1.x * 34 * dt;
      megMesh.position.z += _v1.z * 34 * dt;
      megMesh.position.y = -1.2;
      megMesh.rotation.y = Math.atan2(-_v1.z, _v1.x) + Math.PI;
      if (d < 11) {
        try { GG.boat?.damage?.(10, 'megalodon'); } catch (e) {}
        if (rnd() < 0.5) { try { GG.boat?.addLeak?.(); } catch (e) {} }
        splashAt(megMesh.position.x, 1.2, megMesh.position.z, 8);
        showAlert('IT HIT THE HULL! 🦈💥', 2);
        meg.phase = 'circle';
        meg.ramCd = 10 + rnd() * 4;
        meg.angle = Math.atan2(megMesh.position.z - bp.z, megMesh.position.x - bp.x);
      } else if (meg.t > 3.5) {
        meg.phase = 'circle';
        meg.ramCd = 8;
        meg.angle = Math.atan2(megMesh.position.z - bp.z, megMesh.position.x - bp.x);
      }
      break;
    }
    case 'flee': {
      meg.t += dt;
      _v1.copy(megMesh.position).sub(bp); _v1.y = 0;
      if (_v1.lengthSq() > 0.01) _v1.normalize();
      megMesh.position.x += _v1.x * 40 * dt;
      megMesh.position.z += _v1.z * 40 * dt;
      megMesh.position.y = Math.max(-6, megMesh.position.y - dt * 2);
      megMesh.rotation.y = Math.atan2(-_v1.z, _v1.x) + Math.PI;
      if (meg.t > 4) endMegalodon(!meg.gaveUp);
      break;
    }
  }
  if (meg && meg.entry) setBoss(meg.entry.hp / meg.entry.maxHp);
}

// ================================================================ LEVIATHAN (traitor finale)
function buildLegendary(scene) {
  const g = new THREE.Group();
  const mat = new THREE.MeshToonMaterial({ color: 0x7be08a, emissive: 0x2c7a3d });
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), mat);
  body.scale.set(3.2, 2, 1.4); g.add(body);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(1.4, 2.4, 5), mat);
  tail.position.x = -3.4; tail.rotation.z = Math.PI / 2; g.add(tail);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xfff2a8 });
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.45, 6, 5), eyeMat);
    eye.position.set(2, 0.8, s * 1); g.add(eye);
  }
  g.visible = false;
  scene.add(g);
  return g;
}
function buildLeviathan(scene) {
  levGroup = new THREE.Group();
  const bodyMat = new THREE.MeshToonMaterial({ color: 0x1f4d5c, emissive: 0x0a2e1f });
  const finMat = new THREE.MeshToonMaterial({ color: 0x2e7d6b });
  // head
  levHead = new THREE.Group();
  const skull = new THREE.Mesh(new THREE.SphereGeometry(3.4, 12, 10), bodyMat);
  skull.scale.set(1.3, 1, 1); levHead.add(skull);
  const jaw = new THREE.Mesh(new THREE.ConeGeometry(2.2, 4.5, 6), bodyMat);
  jaw.rotation.z = -Math.PI / 2; jaw.position.set(4, -0.6, 0); levHead.add(jaw);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xaef060 });
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), eyeMat);
    eye.position.set(2.4, 1.6, s * 2); levHead.add(eye);
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.7, 2.6, 5), finMat);
    horn.position.set(-0.5, 2.6, s * 1.6); horn.rotation.x = s * 0.4; levHead.add(horn);
  }
  levGroup.add(levHead);
  // segments (follow-the-leader chain) ~3x boat length in total
  const segGeo = new THREE.SphereGeometry(1, 10, 8);
  for (let i = 0; i < LEV_SEG_N; i++) {
    const r = 3 - (i / LEV_SEG_N) * 1.9;
    const seg = new THREE.Mesh(segGeo, bodyMat);
    seg.scale.setScalar(r);
    levGroup.add(seg);
    levSegs.push(seg);
    levSegPos.push(new THREE.Vector3());
    if (i % 3 === 1) {
      const fin = new THREE.Mesh(new THREE.ConeGeometry(0.8, 2.2, 4), finMat);
      fin.userData.seg = i;
      levGroup.add(fin);
      (levSegs[i].userData.fins ||= []).push(fin);
    }
  }
  const tailFin = new THREE.Mesh(new THREE.ConeGeometry(1.6, 3.4, 4), finMat);
  levGroup.add(tailFin);
  levSegs[LEV_SEG_N - 1].userData.tailFin = tailFin;
  levGroup.visible = false;
  scene.add(levGroup);
}
function levPad() {
  if (!lev) return null;
  return lev.playerIdx === 1 ? GG.input?.p2 : GG.input?.p1;
}
function resolveLegendaryPlayer(data) {
  const ps = Array.isArray(GG.players) ? GG.players : [];
  let p = data?.player;
  if (typeof p === 'number') p = ps[p];
  if (!p || !ps.includes(p) || !p.human) p = ps.find((q) => q && q.human);
  return p || null;
}
function startLeviathan(data) {
  if (lev || GG.flags.bossActive) return;
  const player = resolveLegendaryPlayer(data);
  if (!player) return;
  // freeze the rest of the show
  endStorm();
  endSharkAttack(false);
  if (meg) { meg.phase = 'flee'; meg.t = 0; meg.gaveUp = true; }
  GG.flags.bossActive = true;
  const bp = boatPos();
  const fx = bp.x + 22, fz = bp.z + 6;
  lev = {
    phase: 'focus', t: 0, playerIdx: player.idx ?? 0, player,
    surviveT: LEV_SURVIVE_SEC, entry: null,
    vel: new THREE.Vector3(), ramT: 0, ramCd: 0, slamT: 0,
    focus: new THREE.Vector3(fx, 1, fz),
  };
  GG.cameraFocus = { target: lev.focus, dist: 30, height: 14 };
  legendMesh.position.set(fx, -6, fz);
  legendMesh.visible = true;
  showAlert("EIDAN'S LAW: THE BIGGEST FISH CATCHES YOU", 5, true);
  GG.music?.('legendary');
}
function levSpitPlayer() {
  const p = lev?.player;
  if (!p) return;
  p.mode = 'deck';
  p.carry = null;
  if (p.localPos) { p.localPos.x = 0; p.localPos.z = 0; }
  if (p.obj) p.obj.visible = true;
  toast('Welcome back. You taste terrible. 🐉');
  sfx('wahh');
}
function endLeviathan(crewWon) {
  if (!lev) return;
  const player = lev.player;
  if (lev.entry) removeCannonTarget(lev.entry);
  if (player && player.mode === 'leviathan') levSpitPlayer();
  lev = null;
  levGroup.visible = false;
  legendMesh.visible = false;
  hideBoss();
  GG.cameraFocus = null;
  GG.flags.bossActive = false;
  GG.flags.washImpulse = null;
  if (crewWon) {
    const amount = 300 * curWeek();
    GG.emit('reward:money', { amount, why: 'leviathan' });
    banner('THE CREW SURVIVES THE LEVIATHAN! 🏆 +' + amount, 4200, 'ok');
  }
  GG.emit('leviathan:end', { crewWon: !!crewWon });
}
function levPlaceSerpent(bp) {
  levHead.position.set(bp.x + 26, -18, bp.z + 10);
  for (let i = 0; i < LEV_SEG_N; i++) {
    levSegPos[i].set(levHead.position.x - (i + 1) * LEV_SPACING, levHead.position.y, levHead.position.z);
  }
}
function levChainTick(dt) {
  // follow-the-leader body chain
  let prev = levHead.position;
  const t = GG.time?.total || 0;
  for (let i = 0; i < LEV_SEG_N; i++) {
    const p = levSegPos[i];
    _v1.copy(p).sub(prev);
    const d = _v1.length() || 0.001;
    _v1.multiplyScalar(LEV_SPACING / d);
    p.copy(prev).add(_v1);
    p.y = prev.y * 0.85 + Math.sin(t * 2.2 + i * 0.9) * 0.8 - 0.4;
    const seg = levSegs[i];
    seg.position.copy(p);
    if (seg.userData.fins) for (const f of seg.userData.fins) { f.position.set(p.x, p.y + seg.scale.x + 0.6, p.z); }
    if (seg.userData.tailFin) { seg.userData.tailFin.position.set(p.x, p.y + 1, p.z); seg.userData.tailFin.rotation.z = Math.sin(t * 3) * 0.6; }
    prev = p;
  }
}
function levTick(dt) {
  if (!lev) return;
  const bp = boatPos();
  lev.t += dt;
  switch (lev.phase) {
    case 'focus': {
      if (lev.t > 1.4) { lev.phase = 'leap'; lev.t = 0; sfx('splash'); splashAt(lev.focus.x, 0.5, lev.focus.z, 5); }
      break;
    }
    case 'leap': {
      // legendary fish arcs out of the water and GULPS the player
      const k = Math.min(1, lev.t / 1.6);
      legendMesh.position.y = -6 + Math.sin(k * Math.PI) * 14;
      legendMesh.rotation.z = Math.sin(k * Math.PI) * -0.9;
      legendMesh.rotation.y = (GG.time?.total || 0) * 2;
      if (!lev.ate && k > 0.5) {
        lev.ate = true;
        const p = lev.player;
        if (p) { p.mode = 'busy'; if (p.obj) p.obj.visible = false; }
        splashAt(lev.focus.x, 2, lev.focus.z, 6);
        sfx('gulp');
        showAlert('GULP. 😱', 2, true);
      }
      if (k >= 1) { legendMesh.visible = false; lev.phase = 'beat'; lev.t = 0; }
      break;
    }
    case 'beat': {
      // 3 quiet seconds... the sea is too calm
      if (lev.t > 3) {
        lev.phase = 'rise'; lev.t = 0;
        levGroup.visible = true;
        levPlaceSerpent(bp);
        GG.cameraFocus = { target: levHead.position, dist: 40, height: 18 };
        sfx('boss');
        GG.music?.('boss');
      }
      break;
    }
    case 'rise': {
      const k = Math.min(1, lev.t / 2.5);
      levHead.position.y = -18 + k * 22;
      levChainTick(dt);
      if (k > 0.4 && !lev.announced) {
        lev.announced = true;
        showAlert(playerName(lev.player) + ' IS THE LEVIATHAN! 🐉', 4.5);
        splashAt(levHead.position.x, 1, levHead.position.z, 10);
      }
      if (k >= 1) {
        lev.phase = 'active'; lev.t = 0;
        const p = lev.player;
        if (p) p.mode = 'leviathan';
        const hits = Math.min(16, 10 + 2 * Math.max(0, curWeek() - 1));
        lev.entry = addCannonTarget('leviathan', levHead, 10, hits);
        showBoss('🐉 LEVIATHAN · 90s');
        GG.cameraFocus = null;
        GG.emit('leviathan:begin', { player: lev.playerIdx });
        toast(playerName(lev.player) + ': move to swim · ACTION = RAM 💥 · SECONDARY = TAIL SLAM 🌊');
      }
      break;
    }
    case 'active': {
      lev.surviveT -= dt;
      const pad = levPad();
      // -------- swim
      _v1.set(pad?.x || 0, 0, pad?.z || 0);
      if (_v1.lengthSq() > 1) _v1.normalize();
      const speed = lev.ramT > 0 ? 46 : 26;
      if (lev.ramT > 0) {
        // ram: charge straight at the hull
        _v1.copy(bp).sub(levHead.position); _v1.y = 0;
        if (_v1.lengthSq() > 0.01) _v1.normalize();
      }
      lev.vel.x += (_v1.x * speed - lev.vel.x) * Math.min(1, dt * 3);
      lev.vel.z += (_v1.z * speed - lev.vel.z) * Math.min(1, dt * 3);
      levHead.position.x += lev.vel.x * dt;
      levHead.position.z += lev.vel.z * dt;
      // stay near the surface, soft leash to the boat
      let wy = 1.5;
      try { if (GG.ocean?.heightAt) wy = GG.ocean.heightAt(levHead.position.x, levHead.position.z) + 1.5; } catch (e) {}
      if (lev.slamT > 0) wy += Math.sin(Math.min(1, lev.slamT / 0.6) * Math.PI) * 8; // rear up
      levHead.position.y += (wy - levHead.position.y) * Math.min(1, dt * 4);
      _v2.copy(levHead.position).sub(bp); _v2.y = 0;
      const leash = _v2.length();
      if (leash > 95) { levHead.position.x -= _v2.x / leash * (leash - 95); levHead.position.z -= _v2.z / leash * (leash - 95); }
      if (lev.vel.lengthSq() > 1) levHead.rotation.y = Math.atan2(-lev.vel.z, lev.vel.x);
      levChainTick(dt);
      // -------- RAM (ACTION)
      lev.ramCd -= dt;
      if (pad?.actionHit && lev.ramCd <= 0 && lev.ramT <= 0 && lev.slamT <= 0) { lev.ramT = 1.6; sfx('shark'); }
      if (lev.ramT > 0) {
        lev.ramT -= dt;
        if (leash < 13) {
          lev.ramT = 0; lev.ramCd = 4;
          try { GG.boat?.damage?.(8, 'leviathan'); } catch (e) {}
          try { GG.boat?.kick?.(0.3 * (GG.rng() < 0.5 ? -1 : 1)); } catch (e) {}
          splashAt(levHead.position.x, 1.5, levHead.position.z, 9);
          showAlert('RAMMED! 🐉💥', 1.6);
          // knock the serpent back a bit
          lev.vel.x = _v2.x * 30; lev.vel.z = _v2.z * 30;
        }
      }
      // -------- TAIL SLAM (SECONDARY)
      if (pad?.secondaryHit && lev.slamT <= 0 && lev.ramT <= 0 && (lev.slamCd || 0) <= 0) {
        lev.slamT = 1.1; lev.slamCd = 7;
      }
      if (lev.slamCd > 0) lev.slamCd -= dt;
      if (lev.slamT > 0) {
        lev.slamT -= dt;
        if (lev.slamT <= 0.45 && !lev.slammed) {
          lev.slammed = true;
          stormSpikeT = 4;
          splashAt(levHead.position.x, 1, levHead.position.z, 12);
          _v2.copy(bp).sub(levHead.position); _v2.y = 0;
          if (_v2.lengthSq() > 0.01) _v2.normalize();
          GG.flags.washImpulse = new THREE.Vector3(_v2.x * 6, 0, _v2.z * 6);
          GG.flags.washSeq = (GG.flags.washSeq || 0) + 1;
          GG.flags.washUntil = (GG.time?.total || 0) + 0.9;
          GG.boat?.kick?.(0.35);
          GG.emit('wave:wash', { x: levHead.position.x, z: levHead.position.z });
          showAlert('TAIL SLAM! 🌊', 1.6);
          sfx('thunder');
        }
        if (lev.slamT <= 0) lev.slammed = false;
      }
      // -------- bossbar: hp AND timer
      if (lev.entry) setBoss(lev.entry.hp / lev.entry.maxHp, '🐉 LEVIATHAN · ' + Math.max(0, Math.ceil(lev.surviveT)) + 's');
      // -------- end conditions
      if ((lev.entry && lev.entry.hp <= 0) || lev.surviveT <= 0) {
        lev.phase = 'spit'; lev.t = 0;
        showAlert(lev.entry && lev.entry.hp <= 0 ? 'THE CREW DROVE IT OFF! 🎯' : 'THE LEVIATHAN GIVES UP! ⏱️', 3);
        sfx('groan');
      }
      break;
    }
    case 'spit': {
      // groan, sink, and spit the player back on deck
      levHead.position.y += ((-2) - levHead.position.y) * Math.min(1, dt * 2);
      levChainTick(dt);
      if (lev.t > 1.6) {
        splashAt(bp.x, 1.5, bp.z, 6);
        endLeviathan(true);
      }
      break;
    }
  }
}

// ================================================================ RESET
function clearAll() {
  storm = null;
  stormSpikeT = 0;
  if (GG.weather) { GG.weather.stormTarget = 0; GG.weather.typhoon = false; }
  if (shark) { if (shark.entry) removeCannonTarget(shark.entry); shark = null; }
  if (sharkMesh) sharkMesh.visible = false;
  if (curse) { curse = null; if (GG.flags) GG.flags.curse = null; }
  curseLight = null;
  clearFloppers(false);
  if (meg) { if (meg.entry) removeCannonTarget(meg.entry); meg = null; }
  if (megMesh) megMesh.visible = false;
  if (lev) {
    const player = lev.player;
    if (lev.entry) removeCannonTarget(lev.entry);
    if (player) { if (player.mode === 'leviathan' || player.mode === 'busy') player.mode = 'deck'; if (player.obj) player.obj.visible = true; }
    const wasActive = lev.phase === 'active' || lev.phase === 'spit';
    lev = null;
    if (wasActive) GG.emit('leviathan:end', { crewWon: false });
  }
  if (levGroup) levGroup.visible = false;
  if (legendMesh) legendMesh.visible = false;
  ensureFlags();
  GG.flags.cannonTargets.length = 0;
  GG.flags.sharkLevel = 0;
  GG.flags.bossActive = false;
  GG.flags.washImpulse = null;
  GG.cameraFocus = null;
  alertTimer = 0;
  alertEl?.classList.add('hidden');
  hideBoss();
  tintEl?.classList.add('hidden');
  for (const s of splashes) s.mesh.visible = false;
  scheduledDay = -1; // reroll schedule next tick
  megUsedDay = -1;
}

// ================================================================ init / update
export function init(G) {
  GG = G;
  alertEl = document.getElementById('alert');
  bossEl = document.getElementById('bossbar');
  bossNameEl = document.getElementById('bossname');
  bossFillEl = document.getElementById('boss-fill');
  tintEl = document.getElementById('curse-tint');

  initSplashes(G.scene);
  initFlopperPool(G.scene);
  sharkMesh = buildShark(0x5b7c99, 8);
  G.scene.add(sharkMesh);
  megMesh = buildShark(0x46606f, 26); // MEGALODON: same goofy shark, absurdly bigger
  G.scene.add(megMesh);
  legendMesh = buildLegendary(G.scene);
  buildLeviathan(G.scene);

  ensureFlags();

  G.on('fish:cursed', () => startCurse());
  G.on('fish:legendary', (d) => startLeviathan(d));
  G.on('game:new', () => clearAll());
  G.on('game:continue', () => clearAll());
  G.on('boat:sunk', () => clearAll());
  G.on('day:dawn', () => { rollDay(); });
}

export function update(G, dt) {
  GG = G;
  if (!dt) return; // paused/menu: CSS animates the DOM; keep the sim frozen
  ensureFlags();
  alertTick(dt);
  splashTick(dt);
  stormTick(dt);
  curseTick(dt);
  if (lev) {
    levTick(dt); // finale freezes all other threats
    return;
  }
  schedulerTick(dt);
  sharkTick(dt);
  megTick(dt);
}
