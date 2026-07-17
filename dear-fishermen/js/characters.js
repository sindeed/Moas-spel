// Dear Fishermen — characters.js
// The wobbly goofball fishermen: looks, player control, interactions ("the hands"), bot AI.
// Owns: G.players, G.nearestStation. Talks to everything else via G + events only.
import * as THREE from '../lib/three.module.min.js';

const CREW_SIZE = 4;
const WALK_SPEED = 5;
const SWIM_SPEED = 3.4;
const DIVE_SPEED = 2.6;
const HOP_V = 5.2;
const GRAV = 16;
const OX_BASE = 60;
const COAT_COLORS = [0xffd23f, 0xff7a2f, 0x2fc4b2, 0xff6fa5]; // yellow orange teal pink
const RING_COLORS = [0xffee66, 0x6fd3ff];
const HAT_KINDS = ['souwester', 'bucket', 'party', 'squid'];
const FIX_TIME_HUMAN = 1.5;
const FIX_TIME_BOT = 2.6;
const SPRAY_TIME_HUMAN = 1.2;   // 🧯 hold-to-FOOSH
const SPRAY_TIME_BOT = 2.2;     // bots spray comically long

let G = null;
// shared geometries / materials (built once in init)
const GEO = {};
const MAT = {};
// temp vectors — never allocate in per-frame code
const TA = new THREE.Vector3();
const TB = new THREE.Vector3();
const TC = new THREE.Vector3();
let pendingHats = null;   // from save:apply, used at crew build
const splashPool = [];    // tiny water-droplet pool
const foamPool = [];      // white 🧯 foam droplets (same trick, white + floatier)

// The boat's walkable deck height in boat-local space (stations sit on it).
function deckY() {
  return G?.boat?.stations?.[0]?.localPos?.y ?? 1.15;
}

// ---------------------------------------------------------------- assets
function buildAssets() {
  GEO.body = new THREE.SphereGeometry(0.55, 18, 14);
  GEO.eyeW = new THREE.SphereGeometry(0.14, 10, 8);
  GEO.pupil = new THREE.SphereGeometry(0.065, 8, 6);
  GEO.leg = new THREE.CylinderGeometry(0.09, 0.12, 0.26, 8);
  GEO.armSeg = new THREE.CylinderGeometry(0.075, 0.06, 0.24, 7);
  GEO.ring = new THREE.RingGeometry(0.55, 0.78, 24);
  GEO.tag = new THREE.ConeGeometry(0.18, 0.34, 8);
  GEO.star = new THREE.OctahedronGeometry(0.09);
  GEO.plank = new THREE.BoxGeometry(0.7, 0.08, 0.22);
  GEO.bucket = new THREE.CylinderGeometry(0.18, 0.14, 0.24, 10, 1, true);
  GEO.extTank = new THREE.CylinderGeometry(0.09, 0.09, 0.3, 8);
  GEO.extNozzle = new THREE.ConeGeometry(0.05, 0.14, 6);
  GEO.fish = new THREE.SphereGeometry(0.24, 10, 8);
  GEO.drop = new THREE.SphereGeometry(0.06, 6, 5);
  // hats
  GEO.hatCone = new THREE.ConeGeometry(0.22, 0.42, 10);
  GEO.hatBrim = new THREE.CylinderGeometry(0.42, 0.46, 0.06, 12);
  GEO.hatDome = new THREE.SphereGeometry(0.3, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
  GEO.hatBucket = new THREE.CylinderGeometry(0.3, 0.24, 0.3, 10);
  GEO.tentacle = new THREE.ConeGeometry(0.05, 0.3, 6);
  GEO.fish.scale(1.4, 0.8, 0.7); // fishy blob

  const toon = (color) => new THREE.MeshToonMaterial({ color });
  MAT.coats = COAT_COLORS.map(toon);
  MAT.white = toon(0xffffff);
  MAT.black = toon(0x20242b);
  MAT.boot = toon(0x2b4a63);
  MAT.wood = toon(0xb07a45);
  MAT.metal = toon(0x9fb2bd);
  MAT.fish = toon(0x7fc7e8);
  MAT.star = toon(0xffe066);
  MAT.drop = new THREE.MeshToonMaterial({ color: 0x8fd8ff, transparent: true, opacity: 0.9 });
  MAT.foam = new THREE.MeshToonMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
  MAT.extRed = toon(0xd23c2a);
  MAT.rings = RING_COLORS.map((c) => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
  MAT.hatYellow = toon(0xffc94d);
  MAT.hatGray = toon(0xb9c4cc);
  MAT.hatParty = toon(0xff5d9e);
  MAT.hatSquid = toon(0xe58cd2);
}

function buildHat(kind) {
  const g = new THREE.Group();
  if (kind === 'souwester') {
    const brim = new THREE.Mesh(GEO.hatBrim, MAT.hatYellow);
    const top = new THREE.Mesh(GEO.hatDome, MAT.hatYellow);
    top.scale.set(1.1, 0.8, 1.1);
    brim.position.y = 0.02; top.position.y = 0.05;
    brim.rotation.x = 0.18; // rain runs off the back!
    g.add(brim, top);
  } else if (kind === 'bucket') {
    const b = new THREE.Mesh(GEO.hatBucket, MAT.hatGray);
    b.position.y = 0.14; b.rotation.z = 0.12;
    g.add(b);
  } else if (kind === 'party') {
    const c = new THREE.Mesh(GEO.hatCone, MAT.hatParty);
    c.position.y = 0.2; c.rotation.z = -0.15;
    const pom = new THREE.Mesh(GEO.star, MAT.star);
    pom.position.set(0.06, 0.42, 0);
    g.add(c, pom);
  } else if (kind === 'squid') {
    const head = new THREE.Mesh(GEO.hatDome, MAT.hatSquid);
    head.scale.set(1, 1.4, 1);
    head.position.y = 0.05;
    g.add(head);
    for (let i = 0; i < 5; i++) {
      const t = new THREE.Mesh(GEO.tentacle, MAT.hatSquid);
      const a = (i / 5) * Math.PI * 2;
      t.position.set(Math.cos(a) * 0.24, 0.02, Math.sin(a) * 0.24);
      t.rotation.z = Math.cos(a) * 0.9;
      t.rotation.x = -Math.sin(a) * 0.9;
      g.add(t);
    }
  }
  return g;
}

function setHat(p, kind) {
  p.hat = kind || null;
  if (p._hatObj) { p._hatHolder.remove(p._hatObj); p._hatObj = null; }
  if (kind && HAT_KINDS.includes(kind)) {
    p._hatObj = buildHat(kind);
    p._hatHolder.add(p._hatObj);
  }
}

// ---------------------------------------------------------------- the goofball
function buildGoofball(idx) {
  const obj = new THREE.Group();          // moved/rotated by movement code
  const body = new THREE.Group();         // wobbles + leans
  obj.add(body);

  const belly = new THREE.Mesh(GEO.body, MAT.coats[idx % MAT.coats.length]);
  belly.scale.set(1, 0.88, 0.92);
  belly.position.y = 0.62;
  body.add(belly);

  // big cartoon eyes (front = +Z of the group; facing code points +Z along move dir)
  const eyes = new THREE.Group();
  eyes.position.set(0, 0.78, 0.42);
  const eL = new THREE.Mesh(GEO.eyeW, MAT.white);
  const eR = new THREE.Mesh(GEO.eyeW, MAT.white);
  eL.position.x = -0.17; eR.position.x = 0.17;
  const pL = new THREE.Mesh(GEO.pupil, MAT.black);
  const pR = new THREE.Mesh(GEO.pupil, MAT.black);
  pL.position.set(-0.17, 0, 0.1); pR.position.set(0.17, 0, 0.1);
  eyes.add(eL, eR, pL, pR);
  body.add(eyes);

  // tiny stub legs
  const legL = new THREE.Mesh(GEO.leg, MAT.boot);
  const legR = new THREE.Mesh(GEO.leg, MAT.boot);
  legL.position.set(-0.2, 0.13, 0); legR.position.set(0.2, 0.13, 0);
  obj.add(legL, legR);

  // NOODLE ARMS — 4 floppy segments each, the signature look
  const arms = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.5, 0.72, 0);
    body.add(shoulder);
    const segs = [];
    let parent = shoulder;
    for (let s = 0; s < 4; s++) {
      const j = new THREE.Group();
      if (s > 0) j.position.y = -0.2;
      const m = new THREE.Mesh(GEO.armSeg, MAT.coats[idx % MAT.coats.length]);
      m.position.y = -0.1;
      j.add(m);
      parent.add(j);
      parent = j;
      segs.push(j);
    }
    arms.push({ side, shoulder, segs, hand: parent });
  }

  // hat holder on top of the head
  const hatHolder = new THREE.Group();
  hatHolder.position.y = 1.12;
  body.add(hatHolder);

  // carry visuals (held in front)
  const carryHolder = new THREE.Group();
  carryHolder.position.set(0, 0.55, 0.55);
  body.add(carryHolder);
  const plankM = new THREE.Mesh(GEO.plank, MAT.wood);
  const bucketM = new THREE.Mesh(GEO.bucket, MAT.metal);
  const waterM = new THREE.Mesh(GEO.drop, MAT.drop);
  waterM.scale.set(2.4, 1.2, 2.4); waterM.position.y = 0.08;
  bucketM.add(waterM);
  const fishM = new THREE.Mesh(GEO.fish, MAT.fish);
  // fire extinguisher 🧯: little red tank + nozzle pointing forward
  const extM = new THREE.Group();
  const extTank = new THREE.Mesh(GEO.extTank, MAT.extRed);
  const extNozzle = new THREE.Mesh(GEO.extNozzle, MAT.black);
  extNozzle.rotation.x = Math.PI / 2; // cone tip -> +z, at the fire
  extNozzle.position.set(0, 0.16, 0.12);
  extM.add(extTank, extNozzle);
  plankM.visible = bucketM.visible = fishM.visible = extM.visible = false;
  carryHolder.add(plankM, bucketM, fishM, extM);

  // player ring + join tag (humans only, toggled later)
  const ring = new THREE.Mesh(GEO.ring, MAT.rings[0]);
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; ring.visible = false;
  obj.add(ring);
  const tag = new THREE.Mesh(GEO.tag, MAT.rings[0]);
  tag.rotation.x = Math.PI; tag.position.y = 1.9; tag.visible = false;
  obj.add(tag);

  // dizzy stars
  const stars = new THREE.Group();
  stars.position.y = 1.45; stars.visible = false;
  for (let i = 0; i < 3; i++) {
    const st = new THREE.Mesh(GEO.star, MAT.star);
    stars.add(st);
  }
  obj.add(stars);

  obj.scale.setScalar(1.45); // chunky goofballs read better from the chase camera (Dear Passengers energy)

  return { obj, body, eyes, pupils: [pL, pR], eyesWhites: [eL, eR], legs: [legL, legR], arms, hatHolder, carryHolder, plankM, bucketM, waterM, fishM, extM, ring, tag, stars };
}

// ---------------------------------------------------------------- players
function makePlayer(idx, human) {
  const parts = buildGoofball(idx);
  const p = {
    idx, human,
    obj: parts.obj,
    mode: 'deck',                       // 'deck'|'swim'|'busy'|'leviathan'
    localPos: new THREE.Vector3((idx % 2 ? 1.4 : -1.4), deckY(), idx < 2 ? 1.6 : -1.6),
    carry: null,
    oxygen: OX_BASE,
    oxygenMax: OX_BASE,
    hat: null,
    worldPos() { return this.obj.getWorldPosition(this._wp); },
    _wp: new THREE.Vector3(),
    _parts: parts,
    _vel: new THREE.Vector3(),
    _face: 0,
    _hopY: 0, _hopV: 0, _grounded: true,
    _station: null,                     // claimed station (wheel/cannon/rod)
    _fixT: 0,                           // plank-fix progress seconds
    _sprayT: 0, _foamT: 0,              // 🧯 spray progress + foam-particle throttle
    _submerged: false,
    _dizzy: 0,
    _stumble: 0,
    _blinkT: 1 + Math.random() * 3, _blinkAnim: 0,
    _tagT: human ? 6 : 0,
    _wobPhase: Math.random() * 10,
    _levPrev: false,
    // bot brain
    _decT: Math.random() * 0.4,
    _task: 'idle', _target: new THREE.Vector3(), _idleT: 0, _panicYell: 2 + Math.random() * 4,
  };
  if (human) {
    parts.ring.visible = true;
    parts.tag.visible = true;
    const mat = MAT.rings[Math.min(idx, 1)];
    parts.ring.material = mat;
    parts.tag.material = mat;
  }
  return p;
}

function parentToDeck(p) {
  const boat = G.boat;
  if (p.obj.parent) p.obj.parent.remove(p.obj);
  if (boat?.group) boat.group.add(p.obj);
  else G.scene.add(p.obj);
  p.obj.position.copy(p.localPos);
}

function makeCrew() {
  // clear old crew
  for (const p of G.players) {
    releaseStation(p);
    if (p.obj?.parent) p.obj.parent.remove(p.obj);
  }
  G.players.length = 0;
  const humans = 1 + (G.input?.p2Active ? 1 : 0);
  for (let i = 0; i < CREW_SIZE; i++) {
    const p = makePlayer(i, i < humans);
    G.players.push(p);
    parentToDeck(p);
  }
  if (Array.isArray(pendingHats)) {
    pendingHats.forEach((h, i) => { if (G.players[i]) setHat(G.players[i], h); });
    pendingHats = null;
  }
}

function convertBotToP2() {
  const p = G.players[1];
  if (!p || p.human) return;
  p.human = true;
  p._task = 'idle';
  releaseStation(p);
  const parts = p._parts;
  parts.ring.material = MAT.rings[1];
  parts.tag.material = MAT.rings[1];
  parts.ring.visible = true;
  parts.tag.visible = true;
  p._tagT = 6;
  G.ui?.toast?.('🎮 Player 2 joined the crew!');
}

// ---------------------------------------------------------------- station finding
function stationDist2(p, st) {
  if (!st?.localPos) return Infinity;
  if (p.mode === 'swim') {
    if (st.type !== 'ladder') return Infinity;
    if (G.boat?.toWorld) TB.copy(G.boat.toWorld(TA.copy(st.localPos)));
    else TB.copy(st.localPos);
    return TB.distanceToSquared(p.obj.position);
  }
  return TA.copy(st.localPos).sub(p.localPos).setY(0).lengthSq();
}

function nearestStation(p) {
  const sts = G.boat?.stations;
  if (!sts || !p) return null;
  let best = null, bestD = Infinity;
  for (const st of sts) {
    const r = p.mode === 'swim' ? 2.5 : (st.radius || 2);
    const d2 = stationDist2(p, st);
    if (d2 < r * r && d2 < bestD) { bestD = d2; best = st; }
  }
  return best;
}

function findStation(type, freeOnly) {
  const sts = G.boat?.stations;
  if (!sts) return null;
  for (const st of sts) {
    if (st.type === type && (!freeOnly || !st.user)) return st;
  }
  return null;
}

// F hotkey (Eidan's request): grab the wheel from anywhere on deck. Bots get booted; fish stay yours.
function takeHelm(p) {
  const wheel = findStation('wheel');
  if (!wheel || p.mode !== 'deck') return;
  if (p.carry?.fish) { G.ui?.toast('Drop your fish in the hold first! 🐟'); return; }
  if (wheel.user === p) { releaseStation(p); p._hopV = HOP_V * 0.6; p._grounded = false; return; } // F again = let go
  if (wheel.user) {
    if (wheel.user.human) { G.ui?.toast('The other captain has the wheel! 🛞'); return; }
    releaseStation(wheel.user); // shoo, bot
  }
  if (p.carry) setCarry(p, null); // tools go back in the pile, priorities!
  wheel.user = p; p._station = wheel;
  p.localPos.copy(wheel.localPos); p.localPos.y = deckY();
  p._vel.set(0, 0, 0);
  p.obj.position.copy(p.localPos);
  G.sfx?.('thunk');
  G.ui?.toast('You have the helm! 🛞');
}

function releaseStation(p) {
  if (p._station) {
    if (p._station.user === p) p._station.user = null;
    p._station = null;
  }
}

// ---------------------------------------------------------------- rail / overboard / swim
// Probe 1.6 units in the facing direction: if that point is off the deck, we're at a railing.
function nearRail(p) {
  const boat = G.boat;
  if (!boat?.deckBound) return false;
  TA.set(Math.sin(p._face), 0, Math.cos(p._face)).multiplyScalar(1.6).add(p.localPos);
  const r = boat.deckBound(TA);
  return !r?.onDeck || (r.pos && r.pos.distanceToSquared(TA) > 0.1);
}

function goOverboard(p) {
  releaseStation(p);
  p.obj.getWorldPosition(TA);
  if (p.obj.parent) p.obj.parent.remove(p.obj);
  G.scene.add(p.obj);
  p.obj.position.copy(TA);
  p.obj.rotation.set(0, p._face + (G.boat?.heading || 0), 0);
  p.mode = 'swim';
  p._vel.set(0, 0, 0);
  p._hopY = 0; p._hopV = 0;
  p.oxygenMax = OX_BASE * (1 + 0.5 * ((G.upgrades?.harpoon || 1) - 1));
  p.oxygen = p.oxygenMax;
  G.sfx?.('splash');
  if (p.human) G.ui?.toast?.('🌊 ' + (p.idx === 1 ? 'P2' : 'P1') + ' went overboard!');
}

function climbAboard(p, ladder) {
  if (p.obj.parent) p.obj.parent.remove(p.obj);
  if (G.boat?.group) G.boat.group.add(p.obj);
  p.localPos.copy(ladder?.localPos || TA.set(0, 0, 0));
  p.localPos.multiplyScalar(0.8); // step inward from the rail
  p.localPos.y = deckY();
  p.obj.position.copy(p.localPos);
  p.mode = 'deck';
  p._hopV = HOP_V; p._grounded = false; // fun little arrival hop
  if (p._submerged) { p._submerged = false; G.emit('underwater:exit', { player: p }); }
  G.sfx?.('splash');
}

function blackout(p) {
  // comic oxygen blackout: lose carry, dizzy stars, wake up on deck
  setCarry(p, null);
  p._dizzy = 3.5;
  if (p._submerged) { p._submerged = false; G.emit('underwater:exit', { player: p }); }
  const ladder = findStation('ladder');
  climbAboard(p, ladder);
  G.ui?.toast?.('😵 Glub… dragged back on deck!');
  G.sfx?.('wahh');
}

// ---------------------------------------------------------------- carrying + actions
function setCarry(p, c) {
  p.carry = c;
  const parts = p._parts;
  parts.plankM.visible = c === 'plank';
  parts.bucketM.visible = c === 'bucket' || c === 'bucketFull';
  parts.waterM.visible = c === 'bucketFull';
  parts.fishM.visible = !!(c && c.fish);
  parts.extM.visible = c === 'extinguisher';
  if (c !== 'extinguisher') p._sprayT = 0;
}

function anyActiveLeak() {
  const leaks = G.boat?.leaks;
  if (!leaks) return null;
  for (const l of leaks) if (l.active) return l;
  return null;
}

function anyBurningFire() {
  const fires = G.boat?.fires;
  if (!fires) return null;
  for (const f of fires) if (f.hp > 0) return f;
  return null;
}

function nearestLeak(p, maxD) {
  const leaks = G.boat?.leaks;
  if (!leaks) return null;
  let best = null, bd = (maxD || 1.6) ** 2;
  for (const l of leaks) {
    if (!l.active || !l.pos) continue;
    const d2 = TA.copy(l.pos).sub(p.localPos).setY(0).lengthSq();
    if (d2 < bd) { bd = d2; best = l; }
  }
  return best;
}

function nearestFire(p, maxD) {
  const fires = G.boat?.fires;
  if (!fires) return null;
  let best = null, bd = (maxD || 3) ** 2;
  for (const f of fires) {
    if (!f.pos || f.hp <= 0) continue;
    const d2 = TA.copy(f.pos).sub(p.localPos).setY(0).lengthSq();
    if (d2 < bd) { bd = d2; best = f; }
  }
  return best;
}

function grabFromSupply(p) {
  if (p.carry) { setCarry(p, null); G.sfx?.('thunk'); return; } // put it back
  // supply cycling: fire beats leak beats bailing (🧯 > plank > bucket)
  setCarry(p, anyBurningFire() ? 'extinguisher' : anyActiveLeak() ? 'plank' : 'bucket');
  G.sfx?.('thunk');
}

function throwWater(p) {
  const fire = nearestFire(p, 3);
  if (fire && G.boat?.douse) G.boat.douse(fire.id);
  else if (fire) fire.hp -= 1; // fallback if boat.js lacks douse
  setCarry(p, 'bucket');
  spawnSplash(p);
  G.sfx?.('splash');
}

function depositFish(p) {
  const fish = p.carry?.fish;
  if (!fish) return;
  setCarry(p, null);
  G.emit('fish:caught', { fish, player: p, how: 'harpoon' });
  G.sfx?.('pop');
}

function throwHarpoon(p) {
  p.obj.getWorldPosition(TA);
  const origin = TA.clone(); origin.y += 0.5;           // rare event: alloc ok
  const dir = new THREE.Vector3(Math.sin(p._face), -0.12, Math.cos(p._face)).normalize();
  G.emit('harpoon:throw', { player: p, origin, dir });
  G.sfx?.('whoosh');
}

function grabSeaPickup(p) {
  const list = G.seaPickups;
  if (!Array.isArray(list)) return false;
  for (const pk of list) {
    if (!pk?.obj) continue;
    if (pk.obj.getWorldPosition(TA).distanceToSquared(p.obj.position) < 4) {
      pk.take?.(p);
      G.sfx?.('pop');
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------- splash particles
function buildSplashPool() {
  for (let i = 0; i < 14; i++) {
    const m = new THREE.Mesh(GEO.drop, MAT.drop);
    m.visible = false;
    G.scene.add(m);
    splashPool.push({ m, vel: new THREE.Vector3(), life: 0 });
  }
  // white foam droplets for the 🧯 (lighter gravity = puffy cone)
  for (let i = 0; i < 12; i++) {
    const m = new THREE.Mesh(GEO.drop, MAT.foam);
    m.scale.setScalar(1.6);
    m.visible = false;
    G.scene.add(m);
    foamPool.push({ m, vel: new THREE.Vector3(), life: 0 });
  }
}
// steady white foam cone out of the nozzle while spraying (throttled, pooled, cheap)
function spawnFoam(p, dt) {
  p._foamT -= dt;
  if (p._foamT > 0) return;
  p._foamT = 0.07;
  p.obj.getWorldPosition(TB);
  const wf = p._face + (G.boat?.heading || 0); // deck-local facing -> world yaw
  let n = 0;
  for (const d of foamPool) {
    if (d.life > 0) continue;
    d.life = 0.3 + G.rng() * 0.15;
    d.m.visible = true;
    d.m.position.copy(TB);
    d.m.position.y += 1.0;
    d.vel.set(Math.sin(wf) * 5 + (G.rng() - 0.5) * 1.8,
              0.5 + (G.rng() - 0.5) * 1.4,
              Math.cos(wf) * 5 + (G.rng() - 0.5) * 1.8);
    if (++n >= 2) break;
  }
}
function spawnSplash(p) {
  p.obj.getWorldPosition(TB);
  let n = 0;
  for (const d of splashPool) {
    if (d.life > 0) continue;
    d.life = 0.6;
    d.m.visible = true;
    d.m.position.copy(TB);
    d.m.position.y += 0.9;
    d.vel.set(Math.sin(p._face) * 3 + (G.rng() - 0.5) * 2, 2 + G.rng() * 2, Math.cos(p._face) * 3 + (G.rng() - 0.5) * 2);
    if (++n >= 7) break;
  }
}
function updateSplashes(dt) {
  for (const d of splashPool) {
    if (d.life <= 0) continue;
    d.life -= dt;
    d.vel.y -= GRAV * dt * 0.6;
    d.m.position.addScaledVector(d.vel, dt);
    if (d.life <= 0) d.m.visible = false;
  }
  for (const d of foamPool) {
    if (d.life <= 0) continue;
    d.life -= dt;
    d.vel.y -= GRAV * dt * 0.25; // foam is fluffy
    d.m.position.addScaledVector(d.vel, dt);
    if (d.life <= 0) d.m.visible = false;
  }
}

// ---------------------------------------------------------------- deck movement
// mvx/mvz are BOAT-LOCAL move intent (-1..1). Human input gets rotated by -heading first.
function moveOnDeck(p, dt, mvx, mvz, wantJump) {
  let spd = WALK_SPEED;
  if (G.flags?.curse === 'boots') spd *= 0.55;
  if (p._dizzy > 0) spd *= 0.5;

  TA.set(mvx, 0, mvz);
  if (TA.lengthSq() > 1) TA.normalize();
  TA.multiplyScalar(spd);
  const k = Math.min(1, dt * 10);
  p._vel.x += (TA.x - p._vel.x) * k;
  p._vel.z += (TA.z - p._vel.z) * k;

  // sliding down the tilted deck
  const tilt = G.boat?.tilt;
  // boat.js exposes {pitch, roll} (radians): downslope accel is +z for pitch, -x for roll
  const tx = tilt?.x ?? (typeof tilt?.roll === 'number' ? -tilt.roll : 0);
  const tz = tilt?.z ?? (typeof tilt?.pitch === 'number' ? tilt.pitch : (typeof tilt === 'number' ? tilt : 0));
  const tiltMag = Math.hypot(tx, tz);
  const slippery = tiltMag > 0.12 || G.flags?.curse === 'boots';
  if (slippery) {
    p._vel.x += tx * 22 * dt;
    p._vel.z += tz * 22 * dt;
    if (tiltMag > 0.16 && p._stumble <= 0 && G.rng() < dt * 1.5) p._stumble = 0.9; // whoops!
  }
  // tail-slam wash: one-shot world-space kick from threats.js, rotated into boat-local
  const wash = G.flags?.washImpulse;
  if (wash && G.flags.washSeq !== undefined && p._washSeq !== G.flags.washSeq) {
    p._washSeq = G.flags.washSeq;
    const wh = G.boat?.heading || 0;
    TB.set(wash.x * Math.cos(wh) - wash.z * Math.sin(wh), 0, wash.x * Math.sin(wh) + wash.z * Math.cos(wh));
    const wm = TB.length();
    if (wm > 4) TB.multiplyScalar(4 / wm);
    p._vel.x += TB.x;
    p._vel.z += TB.z;
    p._stumble = 0.9;
  }
  if (p._stumble > 0) p._stumble -= dt;

  p.localPos.x += p._vel.x * dt;
  p.localPos.z += p._vel.z * dt;

  // hop physics
  if (wantJump && p._grounded) { p._hopV = HOP_V; p._grounded = false; G.sfx?.('boing'); }
  if (!p._grounded) {
    p._hopV -= GRAV * dt;
    p._hopY += p._hopV * dt;
    if (p._hopY <= 0) { p._hopY = 0; p._hopV = 0; p._grounded = true; }
  }

  // deck clamp — grounded players get clamped; a landing beyond the rail = overboard
  const boat = G.boat;
  if (boat?.deckBound) {
    const r = boat.deckBound(p.localPos);
    if (p._grounded) {
      if (r?.onDeck === false) { goOverboard(p); return; }
      if (r?.pos) { p.localPos.copy(r.pos); p.localPos.y = deckY(); }
    } else if (r?.pos && r.pos.distanceToSquared(p.localPos) > 4) {
      // sailed way past the railing mid-hop
      goOverboard(p);
      return;
    }
  }

  // facing + writing to the object
  const v2 = p._vel.x * p._vel.x + p._vel.z * p._vel.z;
  if (v2 > 0.3) p._face = Math.atan2(p._vel.x, p._vel.z);
  p.obj.position.set(p.localPos.x, p.localPos.y + p._hopY, p.localPos.z);
  p.obj.rotation.y = p._face;

  shoveProps(p, dt);
}

function shoveProps(p, dt) {
  const props = G.boat?.props;
  if (!Array.isArray(props)) return;
  for (const prop of props) {
    const pos = prop?.obj?.position || prop?.pos;
    if (!pos) continue;
    TA.copy(pos).sub(p.localPos).setY(0);
    const d2 = TA.lengthSq();
    if (d2 > 1.2 * 1.2 || d2 < 1e-4) continue;
    TA.normalize();
    if (prop.vel?.addScaledVector) prop.vel.addScaledVector(TA, 3);
    else pos.addScaledVector(TA, dt * 2.5);
  }
}

// ---------------------------------------------------------------- swimming
function moveInWater(p, dt, mvx, mvz, diveHeld) {
  const pos = p.obj.position;
  let spd = SWIM_SPEED * (G.flags?.curse === 'boots' ? 0.7 : 1);
  pos.x += mvx * spd * dt;
  pos.z += mvz * spd * dt;

  const surf = (G.ocean?.heightAt?.(pos.x, pos.z) ?? 0) - 0.35;
  if (diveHeld) pos.y -= DIVE_SPEED * dt;               // hold jump to dive
  else pos.y += (surf - pos.y) * Math.min(1, dt * 1.6); // release to bob up
  const floor = surf - 26;
  if (pos.y < floor) pos.y = floor;
  if (pos.y > surf) pos.y = surf;

  if (mvx || mvz) p._face = Math.atan2(mvx, mvz);
  p.obj.rotation.y = p._face;

  // oxygen — head is ~0.9 above position
  const headUnder = pos.y + 0.9 < (surf + 0.35) - 0.08;
  if (headUnder !== p._submerged) {
    p._submerged = headUnder;
    G.emit(headUnder ? 'underwater:enter' : 'underwater:exit', { player: p });
  }
  p.oxygenMax = OX_BASE * (1 + 0.5 * ((G.upgrades?.harpoon || 1) - 1));
  if (headUnder) {
    p.oxygen -= dt;
    if (p.oxygen <= 0) { blackout(p); return; }
  } else {
    p.oxygen = Math.min(p.oxygenMax, p.oxygen + dt * 10);
  }
}

// ---------------------------------------------------------------- prompts & human control
function keyNames(p) {
  if (G.input?.touchActive && p.idx === 0) return { act: 'A', sec: 'B', jump: 'JUMP' };
  if (p.idx === 1) return { act: '.', sec: ',', jump: 'Shift' };
  return { act: 'E', sec: 'Q', jump: 'Space' };
}

function humanPrompt(p) {
  const K = keyNames(p);
  if (p.mode === 'busy') return null; // fishing UI owns the screen
  if (p.mode === 'swim') {
    const ladder = nearestStation(p);
    if (ladder) return `🪜 ${K.act}: Climb up`;
    if (Array.isArray(G.seaPickups) && G.seaPickups.length) {
      for (const pk of G.seaPickups) {
        if (pk?.obj && pk.obj.getWorldPosition(TA).distanceToSquared(p.obj.position) < 4)
          return `✋ ${K.act}: Grab it!`;
      }
    }
    return `🔱 ${K.sec}: Harpoon · hold ${K.jump}: dive`;
  }
  if (p._station) {
    if (p._station.type === 'wheel') return `🛞 Steering! ${K.act}: let go`;
    if (p._station.type === 'cannon') return `💣 ${K.sec}: FIRE! · ${K.act}: let go`;
    return `🎣 Fishing… ${K.jump}: walk away`;
  }
  if (p._fixT > 0) return `🔨 Fixing… ${Math.round((p._fixT / FIX_TIME_HUMAN) * 100)}%`;
  if (p._sprayT > 0) return `🧯 FOOSH… ${Math.round((p._sprayT / SPRAY_TIME_HUMAN) * 100)}%`;
  if (p.carry === 'extinguisher') {
    if (nearestFire(p, 3)) return `🧯 ${K.act}: FOOSH the fire!`;
    if (nearestStation(p)?.type === 'supply') return `📦 ${K.act}: Put back`;
    return `🧯 Find the fire!`;
  }
  if (p.carry === 'bucketFull') return `💦 ${K.sec}: Throw water!`;
  if (p.carry === 'plank') {
    const leak = nearestLeak(p);
    if (leak) return `🔨 Hold ${K.act}: fix leak`;
    return `🪵 Find the leak!`;
  }
  const ns = nearestStation(p);
  if (p.carry === 'bucket') {
    if (ns?.type === 'hold' && (G.boat?.water || 0) > 0.02) return `🪣 ${K.act}: Scoop bilge`;
    if (nearRail(p)) return `🪣 ${K.act}: Scoop sea water`;
    if (ns?.type === 'supply') return `📦 ${K.act}: Put back`;
    return `🪣 Scoop at the railing!`;
  }
  if (p.carry?.fish) {
    if (ns?.type === 'hold') return `🐟 ${K.act}: Drop in hold`;
    return `🐟 Bring it to the hold!`;
  }
  if (ns) {
    if (ns.type === 'wheel') return `🛞 ${K.act}: Steer`;
    if (ns.type === 'rod') return ns.user ? null : `🎣 ${K.act}: Cast line`;
    if (ns.type === 'cannon') return ns.user ? null : `💣 ${K.act}: Man cannon`;
    if (ns.type === 'supply') return `📦 ${K.act}: Grab ${anyBurningFire() ? 'extinguisher' : anyActiveLeak() ? 'plank' : 'bucket'}`;
    if (ns.type === 'ladder') return null;
  }
  return null;
}

function controlHuman(p, pad, dt) {
  if (p.mode === 'busy' || p.mode === 'leviathan') return;

  if (p.mode === 'swim') {
    moveInWater(p, dt, pad.x, pad.z, pad.jump);
    if (p.mode !== 'swim') return; // blackout happened
    if (pad.actionHit) {
      const ladder = nearestStation(p);
      if (ladder) climbAboard(p, ladder);
      else grabSeaPickup(p);
    }
    if (pad.secondaryHit) throwHarpoon(p);
    return;
  }

  // --- on deck ---
  if (p._station) {
    // parked at wheel/cannon/rod: movement locked (boat.js reads steering input itself)
    p.obj.position.set(p.localPos.x, p.localPos.y, p.localPos.z);
    if (pad.helmHit) {
      const atWheel = p._station.type === 'wheel';
      releaseStation(p);
      if (atWheel) { p._hopV = HOP_V * 0.6; p._grounded = false; } // F at the wheel = let go
      else takeHelm(p);                                            // F elsewhere = swap to the wheel
      return;
    }
    const isRod = p._station.type === 'rod';
    if (pad.jumpHit || (!isRod && pad.actionHit)) {
      releaseStation(p);
      p._hopV = HOP_V * 0.6; p._grounded = false;
    }
    return;
  }

  // screen-relative controls: rotate the raw pad from world space into boat-local space
  const h = G.boat?.heading || 0, c = Math.cos(h), s = Math.sin(h);
  moveOnDeck(p, dt, pad.x * c - pad.z * s, pad.x * s + pad.z * c, pad.jumpHit);
  if (p.mode !== 'deck') return; // went overboard

  // plank fixing: hold ACTION near a leak
  if (p.carry === 'plank') {
    const leak = nearestLeak(p);
    if (leak && pad.action) {
      p._fixT += dt;
      if (p._fixT >= FIX_TIME_HUMAN) {
        G.boat?.repair?.(leak.id);
        setCarry(p, null);
        p._fixT = 0;
        G.sfx?.('hammer');
      }
      return; // fixing = standing still-ish, no other action
    }
    p._fixT = Math.max(0, p._fixT - dt * 2);
  }

  // extinguisher spray: hold ACTION near a burning fire — FOOSH!
  if (p.carry === 'extinguisher') {
    const fire = nearestFire(p, 3);
    if (fire && pad.action) {
      p._sprayT += dt;
      spawnFoam(p, dt);
      if (p._sprayT >= SPRAY_TIME_HUMAN) {
        G.boat?.extinguish?.(fire.id);
        p._sprayT = 0;
        G.sfx?.('whoosh');
      }
      return; // spraying = standing your ground, no other action
    }
    p._sprayT = Math.max(0, p._sprayT - dt * 2);
  }

  if (pad.secondaryHit && p.carry === 'bucketFull') throwWater(p);

  if (pad.helmHit) { takeHelm(p); return; } // F: run to the wheel from anywhere on deck

  if (pad.actionHit) {
    const ns = nearestStation(p);
    if (p.carry?.fish && ns?.type === 'hold') { depositFish(p); return; }
    if (p.carry === 'bucket') {
      if (ns?.type === 'hold' && (G.boat?.water || 0) > 0.02) {
        G.boat.water = Math.max(0, G.boat.water - 0.12);
        setCarry(p, 'bucketFull'); G.sfx?.('scoop');
        return;
      }
      if (nearRail(p)) { setCarry(p, 'bucketFull'); G.sfx?.('scoop'); return; }
      if (ns?.type === 'supply') { grabFromSupply(p); return; }
      return;
    }
    if (ns?.type === 'supply') { grabFromSupply(p); return; }
    if ((ns?.type === 'wheel' || ns?.type === 'cannon' || ns?.type === 'rod') &&
        (!ns.user || !ns.user.human) && !p.carry) {
      if (ns.user) { releaseStation(ns.user); G.ui?.toast('Move over, buddy! 🎣'); } // bots yield to humans
      ns.user = p; p._station = ns;
      p.localPos.copy(ns.localPos); p.localPos.y = deckY();
      p._vel.set(0, 0, 0);
      p.obj.position.copy(p.localPos);
      G.sfx?.('thunk');
    }
  }
}

// ---------------------------------------------------------------- bot AI (goofy on purpose)
function botDecide(p) {
  const boss = !!G.flags?.bossActive;
  const scared = (G.weather?.storm || 0) > 0.7 || boss;

  if (G.flags?.curse === 'dance') { releaseStation(p); setTask(p, 'dance'); return; }

  // the LOWEST-indexed bot is The Brave One: mans the cannon during a boss while the rest panic
  if (boss) {
    let braveIdx = -1;
    for (const q of G.players) if (!q.human && q.mode === 'deck') { braveIdx = q.idx; break; }
    const cannon = findStation('cannon', true);
    if (p.idx === braveIdx && (cannon || p._station?.type === 'cannon')) {
      if (p._station?.type !== 'cannon') { releaseStation(p); setTask(p, 'cannon'); }
      return;
    }
  }
  if (scared) { releaseStation(p); setTask(p, 'panic'); return; }

  const fire = G.boat?.fires?.find?.((f) => f.hp > 0);
  if (fire) { if (p._task !== 'douse') { releaseStation(p); setTask(p, 'douse'); } return; }

  const leak = anyActiveLeak();
  if (leak) { if (p._task !== 'fix') { releaseStation(p); setTask(p, 'fix'); } return; }

  // drop the emergency gear when things are calm again
  if (p.carry === 'bucket' || p.carry === 'bucketFull' || p.carry === 'plank' || p.carry === 'extinguisher') { setTask(p, 'stow'); return; }

  if (p._station?.type === 'rod') { p._task = 'fish'; return; }
  const rod = findStation('rod', true);
  if (rod && G.rng() < 0.6) { setTask(p, 'fish'); return; }
  setTask(p, 'wander');
}

function setTask(p, task) {
  if (p._task === task && task !== 'wander') return;
  p._task = task;
  if (task === 'wander' || task === 'panic') {
    const r = task === 'panic' ? 5 : 3.5;
    p._target.set((G.rng() - 0.5) * 2 * r, 0, (G.rng() - 0.5) * 2 * r);
    p._idleT = task === 'panic' ? 0 : G.rng() * 2;
  }
}

function botGoTo(p, dt, tx, tz, arriveR) {
  TA.set(tx - p.localPos.x, 0, tz - p.localPos.z);
  const d = TA.length();
  if (d < (arriveR || 0.8)) { moveOnDeck(p, dt, 0, 0, false); return true; }
  TA.divideScalar(d);
  moveOnDeck(p, dt, TA.x, TA.z, false);
  return false;
}

function controlBot(p, dt) {
  if (p.mode === 'leviathan' || p.mode === 'busy') return;
  if (p.mode === 'swim') {
    // bots doggy-paddle straight back to the ladder
    const ladder = nearestStation(p);
    if (ladder) { climbAboard(p, ladder); return; }
    const lst = findStation('ladder');
    let dx = 0, dz = 0;
    if (lst && G.boat?.toWorld) {
      TB.copy(G.boat.toWorld(TA.copy(lst.localPos)));
      dx = Math.sign(TB.x - p.obj.position.x); dz = Math.sign(TB.z - p.obj.position.z);
    } else if (G.boat?.group) {
      dx = Math.sign(G.boat.group.position.x - p.obj.position.x);
      dz = Math.sign(G.boat.group.position.z - p.obj.position.z);
    }
    moveInWater(p, dt, dx * 0.8, dz * 0.8, false);
    if (p.mode === 'swim' && nearestStation(p)) climbAboard(p, findStation('ladder'));
    return;
  }

  p._decT -= dt;
  if (p._decT <= 0) { p._decT = 0.33; botDecide(p); }

  const task = p._task;
  if (p._station) {
    // stay parked (rod fishing / cannon). fishing.js feeds bots small catches.
    p.obj.position.copy(p.localPos);
    if (task !== 'fish' && task !== 'cannon') releaseStation(p);
    // bot gunner: periodically aim + fire at whatever threats.js marks as a target
    if (p._station?.type === 'cannon') {
      p._gunT = (p._gunT || 0) - dt;
      if (p._gunT <= 0) {
        p._gunT = 1.2 + G.rng() * 0.8;
        const targets = G.flags?.cannonTargets;
        if (targets?.length && G.boat?.cannon && G.boat?.toWorld) {
          TB.copy(G.boat.toWorld(TA.copy(p._station.localPos))); // cannon world pos (copy: toWorld reuses a temp)
          let found = false, bd = Infinity;
          for (const entry of targets) {
            const o = entry?.obj;
            if (!o) continue;
            if (o.getWorldPosition) o.getWorldPosition(TA);
            else if (o.isVector3) TA.copy(o);
            else continue;
            const d2 = TA.distanceToSquared(TB);
            if (d2 < bd) { bd = d2; TC.copy(TA); found = true; }
          }
          if (found) {
            const dir = TA.copy(TC).sub(TB).normalize();
            const a = Math.atan2(dir.x, dir.z) + (G.rng() - 0.5) * 0.3; // ±0.15 rad spread
            const flat = Math.hypot(dir.x, dir.z);
            dir.x = Math.sin(a) * flat;
            dir.z = Math.cos(a) * flat;
            dir.y += 0.2; // slight upward lob
            dir.normalize();
            p._face = Math.atan2(TC.x - TB.x, TC.z - TB.z) - (G.boat.heading || 0);
            p.obj.rotation.y = p._face;
            G.boat.cannon.aim?.(dir);
            G.boat.cannon.fire?.();
          }
        }
      }
    }
    return;
  }

  if (task === 'dance') {
    moveOnDeck(p, dt, 0, 0, G.rng() < dt * 1.2);
    p._face += dt * 4; // spiiiin
    p.obj.rotation.y = p._face;
    return;
  }
  if (task === 'panic') {
    if (botGoTo(p, dt, p._target.x, p._target.z, 1)) {
      // pick a new spot to scramble to, arms flailing
      p._target.set((G.rng() - 0.5) * 10, 0, (G.rng() - 0.5) * 10);
    }
    p._panicYell -= dt;
    if (p._panicYell <= 0) { p._panicYell = 2 + G.rng() * 4; G.emit('bot:panic', { player: p }); }
    return;
  }
  if (task === 'douse') {
    if (p.carry === 'extinguisher') {
      const fire = nearestFire(p, 3);
      if (fire) {
        // plant feet, face the flames, and FOOSH for a comically long time
        moveOnDeck(p, dt, 0, 0, false);
        if (p.mode !== 'deck') return; // slid overboard mid-FOOSH
        p._face = Math.atan2(fire.pos.x - p.localPos.x, fire.pos.z - p.localPos.z);
        p.obj.rotation.y = p._face;
        p._sprayT += dt;
        spawnFoam(p, dt);
        if (p._sprayT >= SPRAY_TIME_BOT) { G.boat?.extinguish?.(fire.id); p._sprayT = 0; G.sfx?.('whoosh'); }
      } else {
        p._sprayT = 0;
        const f = anyBurningFire();
        if (f?.pos) botGoTo(p, dt, f.pos.x, f.pos.z, 2);
        else setTask(p, 'stow');
      }
    } else if (p.carry === 'bucketFull') {
      const fire = nearestFire(p, 2.5);
      if (fire) throwWater(p);
      else {
        const f = G.boat?.fires?.find?.((x) => x.hp > 0);
        if (f?.pos) botGoTo(p, dt, f.pos.x, f.pos.z, 2);
        else setTask(p, 'wander');
      }
    } else if (p.carry === 'bucket') {
      // waddle to the nearest rail (x edge) and scoop
      if (nearRail(p)) { setCarry(p, 'bucketFull'); G.sfx?.('scoop'); }
      else botGoTo(p, dt, Math.sign(p.localPos.x || 1) * 50, p.localPos.z, 0.4);
    } else {
      const sup = findStation('supply');
      if (sup && botGoTo(p, dt, sup.localPos.x, sup.localPos.z, sup.radius || 1.5)) {
        // 50/50: the pro tool or the trusty bucket
        setCarry(p, G.rng() < 0.5 ? 'extinguisher' : 'bucket');
        G.sfx?.('thunk');
      }
    }
    return;
  }
  if (task === 'fix') {
    if (p.carry === 'plank') {
      const leak = anyActiveLeak();
      if (!leak) { setTask(p, 'stow'); return; }
      if (leak.pos && botGoTo(p, dt, leak.pos.x, leak.pos.z, 1.3)) {
        p._fixT += dt;
        if (p._fixT >= FIX_TIME_BOT) {
          G.boat?.repair?.(leak.id);
          setCarry(p, null); p._fixT = 0; G.sfx?.('hammer');
        }
      }
    } else {
      const sup = findStation('supply');
      if (sup && botGoTo(p, dt, sup.localPos.x, sup.localPos.z, sup.radius || 1.5)) { setCarry(p, 'plank'); G.sfx?.('thunk'); }
    }
    return;
  }
  if (task === 'stow') {
    const sup = findStation('supply');
    if (!sup || botGoTo(p, dt, sup.localPos.x, sup.localPos.z, sup.radius || 1.5)) { setCarry(p, null); setTask(p, 'wander'); }
    return;
  }
  if (task === 'cannon' || task === 'fish') {
    const st = findStation(task === 'cannon' ? 'cannon' : 'rod', true);
    if (!st) { setTask(p, 'wander'); return; }
    if (botGoTo(p, dt, st.localPos.x, st.localPos.z, st.radius || 1.4)) {
      st.user = p; p._station = st;
      p.localPos.copy(st.localPos); p.localPos.y = deckY();
      p._vel.set(0, 0, 0);
      p.obj.position.copy(p.localPos);
    }
    return;
  }
  // wander: amble, pause, stare at the sea, jump for no reason
  if (p._idleT > 0) { p._idleT -= dt; moveOnDeck(p, dt, 0, 0, G.rng() < dt * 0.15); return; }
  if (botGoTo(p, dt, p._target.x, p._target.z, 0.8)) setTask(p, 'wander');
}

// ---------------------------------------------------------------- animation
function animate(p, dt, t) {
  const parts = p._parts;
  const swim = p.mode === 'swim';
  const speed = Math.hypot(p._vel.x, p._vel.z);
  const mov = swim ? 0.7 : Math.min(1, speed / WALK_SPEED);
  const boots = G.flags?.curse === 'boots';
  const dance = !p.human && p._task === 'dance';
  const panic = !p.human && p._task === 'panic';
  const ph = t * (8 + mov * 5) + p._wobPhase * 7;

  // body: lean into move direction, wobble, stumble flail
  const body = parts.body;
  let lean = mov * 0.28;
  if (p._stumble > 0) lean += Math.sin(t * 22) * 0.3;
  body.rotation.x = swim ? 1.25 : lean;
  body.rotation.z = Math.sin(ph) * (0.06 + mov * 0.07) * (boots ? 2.2 : 1);
  body.position.y = Math.abs(Math.sin(ph)) * 0.07 * mov + (swim ? -0.25 : 0);
  if (dance) { body.rotation.z = Math.sin(t * 9) * 0.3; body.position.y = Math.abs(Math.sin(t * 9)) * 0.15; }

  // stub legs patter
  const kick = Math.sin(ph * 1.7) * (swim ? 0.8 : 0.95 * mov);
  parts.legs[0].rotation.x = kick;
  parts.legs[1].rotation.x = -kick;

  // NOODLE ARMS: sinusoidal flop with per-segment lag off velocity
  for (const arm of p._parts.arms) {
    const up = panic ? arm.side * 2.5 : dance ? arm.side * (1.6 + Math.sin(t * 7 + arm.side) * 0.9) : arm.side * 0.5;
    arm.shoulder.rotation.z = up;
    const amp = 0.22 + mov * 0.4 + (p._stumble > 0 ? 0.5 : 0) + (panic || dance ? 0.45 : 0);
    for (let s = 0; s < arm.segs.length; s++) {
      const seg = arm.segs[s];
      seg.rotation.z = Math.sin(ph * 1.35 - s * 1.1 + arm.side) * amp;
      seg.rotation.x = swim ? Math.sin(ph * 1.6 - s * 0.9) * 0.7 : Math.sin(ph * 0.9 - s * 1.3) * amp * 0.6 - mov * 0.2;
    }
  }

  // blinks
  p._blinkT -= dt;
  if (p._blinkT <= 0) { p._blinkT = 1.6 + G.rng() * 3.2; p._blinkAnim = 0.13; }
  let eyeScale = 1;
  if (p._blinkAnim > 0) { p._blinkAnim -= dt; eyeScale = 0.12; }
  parts.eyesWhites[0].scale.y = eyeScale;
  parts.eyesWhites[1].scale.y = eyeScale;
  parts.pupils[0].visible = parts.pupils[1].visible = eyeScale > 0.5;

  // P1/P2 tag bobs for a few seconds
  if (p._tagT > 0) {
    p._tagT -= dt;
    parts.tag.visible = true;
    parts.tag.position.y = 1.9 + Math.sin(t * 5) * 0.12;
    parts.tag.rotation.y = t * 2;
  } else if (p.human) parts.tag.visible = false;

  // dizzy stars orbit the head
  if (p._dizzy > 0) {
    p._dizzy -= dt;
    parts.stars.visible = true;
    const kids = parts.stars.children;
    for (let i = 0; i < kids.length; i++) {
      const a = t * 4 + i * 2.09;
      kids[i].position.set(Math.cos(a) * 0.38, Math.sin(t * 6 + i) * 0.05, Math.sin(a) * 0.38);
      kids[i].rotation.y = t * 5;
    }
  } else parts.stars.visible = false;
}

// ---------------------------------------------------------------- module API
export function init(g) {
  G = g;
  buildAssets();
  buildSplashPool();
  G.nearestStation = nearestStation;

  G.on('game:new', () => { pendingHats = null; makeCrew(); });
  G.on('game:continue', makeCrew);
  G.on('p2:join', () => { if (G.players.length) convertBotToP2(); });
  G.on('hat:bought', (d) => {
    const kind = HAT_KINDS.includes(d?.hat) ? d.hat : HAT_KINDS[(G.rng() * HAT_KINDS.length) | 0];
    const bare = G.players.filter((q) => !q.hat);
    const lucky = (bare.length ? bare : G.players)[(G.rng() * Math.max(1, (bare.length ? bare : G.players).length)) | 0];
    if (lucky) { setHat(lucky, kind); G.ui?.toast?.(`🎩 A crewmate got a ${kind} hat!`); }
  });
  G.on('save:collect', (data) => { data.characters = { hats: G.players.map((q) => q.hat) }; });
  G.on('save:apply', (data) => { pendingHats = data?.characters?.hats || null; });
}

export function update(g, dt) {
  G = g;
  const t = G.time?.total || 0;
  if (dt === 0) {
    // paused/menu: only cheap ambient blinks
    for (const p of G.players) animate(p, 1 / 60, performance.now() * 0.001);
    return;
  }
  updateSplashes(dt);
  for (const p of G.players) {
    // leviathan: threats.js drives the monster; our goofball hides
    if (p.mode === 'leviathan') {
      if (!p._levPrev) { p._levPrev = true; releaseStation(p); setCarry(p, null); p.obj.visible = false; }
      continue;
    }
    if (p._levPrev) { p._levPrev = false; p.obj.visible = true; climbAboard(p, findStation('ladder')); }

    // safety: if the boat appeared after we spawned, adopt it as parent
    if (p.mode === 'deck' && G.boat?.group && p.obj.parent !== G.boat.group) parentToDeck(p);

    if (p.human) {
      const pad = p.idx === 1 ? G.input?.p2 : G.input?.p1;
      if (pad) controlHuman(p, pad, dt);
      if (p.idx <= 1) G.ui?.prompt?.(p.idx, humanPrompt(p));
    } else {
      controlBot(p, dt);
    }
    // swimmers can't climb onto the harbor island (island WALKING comes with the Islands Update)
    if (p.mode === 'swim') {
      const hb = G.consts?.HARBOR;
      if (hb) {
        const dx = p.obj.position.x - hb.x, dz = p.obj.position.z - hb.z;
        const dist = Math.hypot(dx, dz);
        // the island GROWS — world.js owns the number via G.island.radius (fallback = old 32)
        const clampR = (G.island?.radius ?? 31) + 1;
        if (dist < clampR) {
          const k = clampR / (dist || 1);
          p.obj.position.x = hb.x + dx * k;
          p.obj.position.z = hb.z + dz * k;
        }
      }
    }
    animate(p, dt, t);
  }
}
