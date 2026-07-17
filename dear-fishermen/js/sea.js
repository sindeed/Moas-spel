// Dear Fishermen — sea.js
// The underwater world: decor fish schools, bubbles, seafloor decor,
// harpoonable fish, harpoon projectiles, glowing seashells, and sharks.
// Owns: G.seaPickups (surface/floor pickups divers can take) and G.sea (read-only info).
// Cross-talk only via G state + events (see GDD §7).
import * as THREE from '../lib/three.module.min.js';

// ---------------------------------------------------------------- tuning
const FISH_POOL = 10;       // harpoonable medium fish
const SHELL_POOL = 14;      // glowing seashells on the floor
const HARPOON_POOL = 6;     // in-flight harpoons
const SHARK_POOL = 2;
const SCHOOL_COUNT = 3;     // decor schools near the surface
const SCHOOL_SIZE = 22;     // tiny fish per school
const BUBBLE_POOL = 36;
const WEED_CLUSTERS = 12;   // seafloor decor slots recycled around the boat
const WEEDS_PER_CLUSTER = 5;
const DECOR_GRID = 26;      // world units per decor grid cell
const FISH_ROAM = 40;       // fish stay within this range of the boat
const HARPOON_SPEED = 26;   // u/s at harpoon level 1
const SHARK_CIRCLE_R = 10;  // circling radius around a swimmer
const SHARK_BOAT_R = 16;    // circling radius around the boat (menace only)
const CHOMP_OXYGEN = 15;
const CHOMP_KNOCK_UP = 6;
const FLEE_SEC = 20;        // shark flees this long after a harpoon hit
const DEFAULT_FLOOR = -26;  // fallback when world.js has no floorAt

// If G.fishdex is missing/unreadable we use this mini-table (reported in summary).
const FALLBACK_FISH = {
  harbor: [{ name: 'Harbor Minnow', emoji: '🐟', size: [0.1, 0.4], value: [2, 4] }],
  coast: [
    { name: 'Sardine', emoji: '🐟', size: [0.2, 0.7], value: [3, 6] },
    { name: 'Silly Mackerel', emoji: '🐟', size: [0.4, 1.1], value: [5, 9] },
  ],
  open: [
    { name: 'Snappy Snapper', emoji: '🐠', size: [0.8, 2.2], value: [8, 14] },
    { name: 'Blue Tuna', emoji: '🐟', size: [1.5, 4], value: [12, 20] },
  ],
  deep: [
    { name: 'Grumpy Grouper', emoji: '🐡', size: [2, 5], value: [16, 26] },
    { name: 'Swordfish', emoji: '🐠', size: [3, 6.5], value: [20, 32] },
  ],
  fog: [
    { name: 'Ghost Fish', emoji: '👻', size: [1, 3], value: [18, 30] },
    { name: 'Glow Eel', emoji: '🐍', size: [1.2, 4], value: [16, 28] },
  ],
};

// ---------------------------------------------------------------- module state
let root = null;
let schoolsMesh = null, bubblesMesh = null, weedMesh = null, rockMesh = null;
const schools = [];       // {phase, radius, speed, offX, offZ, depth}
const bubbles = [];       // {x,y,z, vy, alive}
let bubbleTimer = 0;
const clusters = [];      // {cellX, cellZ}
let decorCheckT = 0;
const fishes = [];        // harpoonable fish entities
const shells = [];        // seashell entities
const harpoons = [];      // projectile entities
const sharks = [];        // shark entities
const chompInvuln = new Map(); // player -> ignore-until time (module-scoped, no writes on player)
let surfCache = 0;        // surface height near the boat, refreshed each frame
let mats = null, geos = null;

// reusable temps — never allocate in the frame loop
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _obj = new THREE.Object3D();
const _zero = new THREE.Vector3();
const _swim = [];         // per-frame list of {p, pos} (pos vectors preallocated)
const _swimPos = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

// ---------------------------------------------------------------- small helpers
function surfaceAt(G, x, z) {
  return G.ocean?.heightAt ? G.ocean.heightAt(x, z) : 0;
}
function floorAt(G, x, z) {
  return G.ocean?.floorAt ? G.ocean.floorAt(x, z) : DEFAULT_FLOOR;
}
function boatPos(G) {
  return G.boat?.group?.position || _zero;
}
function zoneHere(G) {
  const b = boatPos(G);
  try { return G.zoneAt ? G.zoneAt(b.x, b.z) : 'coast'; } catch (e) { return 'coast'; }
}
function rand(G, a, b) { return a + (G.rng ? G.rng() : Math.random()) * (b - a); }
function cellHash(ix, iz, salt) {
  let h = (ix * 374761393 + iz * 668265263) ^ (salt * 69069);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
// Gather swimming players once per frame (positions copied into preallocated vecs).
function gatherSwimmers(G) {
  _swim.length = 0;
  const players = G.players || [];
  for (let i = 0; i < players.length && _swim.length < _swimPos.length; i++) {
    const p = players[i];
    if (!p || p.mode !== 'swim') continue;
    const pos = _swimPos[_swim.length];
    if (p.worldPos) pos.copy(p.worldPos());
    else if (p.obj) pos.copy(p.obj.position);
    else continue;
    _swim.push({ p, pos });
  }
  return _swim;
}
function nearestSwimmer(x, y, z) {
  let best = null, bestD = Infinity;
  for (const s of _swim) {
    const d = s.pos.distanceToSquared(_v3.set(x, y, z));
    if (d < bestD) { bestD = d; best = s; }
  }
  return best ? { s: best, dist: Math.sqrt(bestD) } : null;
}

// ---------------------------------------------------------------- species picking
function pickSpecies(G, zone) {
  // Prefer the real fishdex from fishing.js if it looks usable; guard every shape.
  const fd = G.fishdex;
  let list = null;
  try {
    if (Array.isArray(fd)) {
      list = fd.filter((s) => s && typeof s.name === 'string' && !s.legendary && !s.junk &&
        (!s.zones || (Array.isArray(s.zones) && s.zones.includes(zone))));
    } else if (fd && Array.isArray(fd[zone])) {
      list = fd[zone].filter((s) => s && typeof s.name === 'string' && !s.legendary && !s.junk);
    }
  } catch (e) { list = null; }
  if (list && list.length) {
    const s = list[Math.floor(rand(G, 0, list.length)) % list.length];
    const szMin = Number(s.minSize ?? s.sizeMin ?? (Array.isArray(s.size) ? s.size[0] : 0.5)) || 0.5;
    const szMax = Number(s.maxSize ?? s.sizeMax ?? (Array.isArray(s.size) ? s.size[1] : 2)) || 2;
    const size = Math.round(rand(G, szMin, szMax) * 10) / 10;
    const perKg = Number(s.valuePerKg) || 0;
    const baseV = Number(s.value ?? s.baseValue ?? 8) || 8;
    return {
      name: String(s.name), emoji: typeof s.emoji === 'string' ? s.emoji : '🐟',
      size,
      value: perKg > 0 ? Math.max(1, Math.round(size * perKg)) : Math.max(1, Math.round(baseV * (0.7 + size * 0.2))),
      cursed: !!s.cursed,
    };
  }
  const table = FALLBACK_FISH[zone] || FALLBACK_FISH.coast;
  const s = table[Math.floor(rand(G, 0, table.length)) % table.length];
  const size = Math.round(rand(G, s.size[0], s.size[1]) * 10) / 10;
  const t = (size - s.size[0]) / Math.max(0.01, s.size[1] - s.size[0]);
  return { name: s.name, emoji: s.emoji, size, value: Math.round(s.value[0] + t * (s.value[1] - s.value[0])) };
}

// ---------------------------------------------------------------- pickups registry
function addPickup(G, entry) {
  if (!Array.isArray(G.seaPickups)) G.seaPickups = [];
  if (!G.seaPickups.includes(entry)) G.seaPickups.push(entry);
}
function removePickup(G, entry) {
  const arr = G.seaPickups;
  if (!Array.isArray(arr)) return;
  const i = arr.indexOf(entry);
  if (i >= 0) arr.splice(i, 1);
}

// ---------------------------------------------------------------- init: build everything
export function init(G) {
  G.seaPickups = [];
  root = new THREE.Group();
  root.name = 'sea';
  G.scene.add(root);

  geos = {
    tiny: new THREE.ConeGeometry(0.16, 0.5, 5),
    bubble: new THREE.SphereGeometry(0.12, 6, 5),
    weed: new THREE.ConeGeometry(0.35, 2.6, 5),
    rock: new THREE.DodecahedronGeometry(1, 0),
    fishBody: new THREE.SphereGeometry(0.8, 8, 6),
    fishTail: new THREE.ConeGeometry(0.45, 0.8, 4),
    shell: new THREE.SphereGeometry(0.55, 8, 6),
    netBubble: new THREE.SphereGeometry(1.3, 10, 8),
    shaft: new THREE.CylinderGeometry(0.06, 0.06, 1.6, 5),
    tip: new THREE.ConeGeometry(0.14, 0.4, 5),
    sharkBody: new THREE.SphereGeometry(1, 10, 8),
    fin: new THREE.ConeGeometry(0.6, 1.4, 4),
    wake: new THREE.BoxGeometry(0.15, 0.06, 2.4),
  };
  mats = {
    tiny: new THREE.MeshToonMaterial({ color: 0xb8d8e8 }),
    bubble: new THREE.MeshToonMaterial({ color: 0xcdeeff, transparent: true, opacity: 0.45 }),
    weed: new THREE.MeshToonMaterial({ color: 0x2e8b57 }),
    rock: new THREE.MeshToonMaterial({ color: 0x5c6672 }),
    tailGrey: new THREE.MeshToonMaterial({ color: 0x8899aa }),
    shell: new THREE.MeshToonMaterial({ color: 0xffd27f, emissive: 0xffb347, emissiveIntensity: 0.8 }),
    net: new THREE.MeshToonMaterial({ color: 0xbfefff, transparent: true, opacity: 0.28 }),
    wood: new THREE.MeshToonMaterial({ color: 0x9c6b3f }),
    steel: new THREE.MeshToonMaterial({ color: 0xcfd6dd }),
    shark: new THREE.MeshToonMaterial({ color: 0x5f7f95 }),
    wake: new THREE.MeshToonMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 }),
    fishColors: [
      new THREE.MeshToonMaterial({ color: 0xff8c42 }),
      new THREE.MeshToonMaterial({ color: 0x4cc9f0 }),
      new THREE.MeshToonMaterial({ color: 0xf9c74f }),
      new THREE.MeshToonMaterial({ color: 0x90be6d }),
      new THREE.MeshToonMaterial({ color: 0xf28ac2 }),
      new THREE.MeshToonMaterial({ color: 0x9bf6ff }),
    ],
  };

  buildSchools(G);
  buildBubbles();
  buildFloorDecor();
  buildFish(G);
  buildShells(G);
  buildHarpoons();
  buildSharks();

  // Read-only-ish window for threats.js / debug: shark states + pickups.
  G.sea = { sharks, pickups: G.seaPickups };

  G.on('harpoon:throw', (d) => throwHarpoon(G, d));
  const reset = () => resetSea(G);
  G.on('game:new', reset);
  G.on('game:continue', reset);
}

// ---------------------------------------------------------------- builders
function buildSchools(G) {
  schoolsMesh = new THREE.InstancedMesh(geos.tiny, mats.tiny, SCHOOL_COUNT * SCHOOL_SIZE);
  schoolsMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  schoolsMesh.frustumCulled = false;
  root.add(schoolsMesh);
  for (let i = 0; i < SCHOOL_COUNT; i++) {
    schools.push({
      phase: rand(G, 0, Math.PI * 2),
      radius: rand(G, 3.5, 6),
      speed: rand(G, 0.5, 0.9) * (i % 2 ? -1 : 1),
      offX: rand(G, -18, 18), offZ: rand(G, -18, 18),
      depth: rand(G, 0.8, 2.2),
    });
  }
}

function buildBubbles() {
  bubblesMesh = new THREE.InstancedMesh(geos.bubble, mats.bubble, BUBBLE_POOL);
  bubblesMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  bubblesMesh.frustumCulled = false;
  bubblesMesh.visible = false;
  root.add(bubblesMesh);
  for (let i = 0; i < BUBBLE_POOL; i++) bubbles.push({ x: 0, y: -999, z: 0, vy: 0, alive: false });
}

function buildFloorDecor() {
  weedMesh = new THREE.InstancedMesh(geos.weed, mats.weed, WEED_CLUSTERS * WEEDS_PER_CLUSTER);
  rockMesh = new THREE.InstancedMesh(geos.rock, mats.rock, WEED_CLUSTERS);
  weedMesh.frustumCulled = false;
  rockMesh.frustumCulled = false;
  root.add(weedMesh, rockMesh);
  // Fixed ring of grid offsets around the boat cell; one slot per offset.
  const offs = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1], [0, -2], [2, 0], [0, 2], [-2, 0]];
  for (let i = 0; i < WEED_CLUSTERS; i++) {
    clusters.push({ offX: offs[i][0], offZ: offs[i][1], cellX: 1e9, cellZ: 1e9 });
  }
  // Park all instances at "nothing" until first placement.
  _obj.position.set(0, -999, 0); _obj.scale.setScalar(0.001); _obj.updateMatrix();
  for (let i = 0; i < weedMesh.count; i++) weedMesh.setMatrixAt(i, _obj.matrix);
  for (let i = 0; i < rockMesh.count; i++) rockMesh.setMatrixAt(i, _obj.matrix);
}

function makeFishGroup(G, i) {
  const grp = new THREE.Group();
  const mat = mats.fishColors[i % mats.fishColors.length];
  const body = new THREE.Mesh(geos.fishBody, mat);
  body.scale.set(1, 0.62, 0.42);
  const tail = new THREE.Mesh(geos.fishTail, mats.tailGrey);
  tail.rotation.z = Math.PI / 2;
  tail.position.x = -0.95;
  tail.scale.set(1, 1, 0.3);
  const net = new THREE.Mesh(geos.netBubble, mats.net);
  net.visible = false;
  grp.add(body, tail, net);
  grp.visible = false;
  return { grp, tail, net };
}

function buildFish(G) {
  for (let i = 0; i < FISH_POOL; i++) {
    const parts = makeFishGroup(G, i);
    root.add(parts.grp);
    fishes.push({
      ...parts,
      state: 'off',          // off | swim | caught
      vel: new THREE.Vector3(),
      target: new THREE.Vector3(),
      species: null,
      timer: rand(G, 0.2, 3), // respawn delay
      wanderT: 0,
      bobPhase: rand(G, 0, 6.28),
      pickup: null,
    });
  }
}

function buildShells(G) {
  for (let i = 0; i < SHELL_POOL; i++) {
    const mesh = new THREE.Mesh(geos.shell, mats.shell);
    mesh.scale.set(1, 0.5, 0.85);
    mesh.visible = false;
    root.add(mesh);
    shells.push({ mesh, active: false, value: 10, timer: rand(G, 0.1, 2), pickup: null, spin: rand(G, 0, 6.28) });
  }
}

function buildHarpoons() {
  for (let i = 0; i < HARPOON_POOL; i++) {
    const grp = new THREE.Group();
    const shaft = new THREE.Mesh(geos.shaft, mats.wood);
    shaft.rotation.x = Math.PI / 2;
    const tip = new THREE.Mesh(geos.tip, mats.steel);
    tip.rotation.x = Math.PI / 2;
    tip.position.z = 1;
    grp.add(shaft, tip);
    grp.visible = false;
    root.add(grp);
    harpoons.push({ grp, vel: new THREE.Vector3(), life: 0, active: false });
  }
}

function buildSharks() {
  for (let i = 0; i < SHARK_POOL; i++) {
    const grp = new THREE.Group();
    const body = new THREE.Mesh(geos.sharkBody, mats.shark);
    body.scale.set(2.6, 0.9, 0.8);
    const fin = new THREE.Mesh(geos.fin, mats.shark);
    fin.position.set(0.2, 1.1, 0);
    fin.scale.set(1, 1, 0.3);
    const tail = new THREE.Mesh(geos.fin, mats.shark);
    tail.position.set(-2.5, 0.2, 0);
    tail.rotation.z = -0.5;
    tail.scale.set(0.9, 1.1, 0.25);
    const wakeL = new THREE.Mesh(geos.wake, mats.wake);
    const wakeR = new THREE.Mesh(geos.wake, mats.wake);
    wakeL.position.set(-0.9, 1.15, 0.45); wakeL.rotation.y = -0.35;
    wakeR.position.set(-0.9, 1.15, -0.45); wakeR.rotation.y = 0.35;
    grp.add(body, fin, tail, wakeL, wakeR);
    grp.visible = false;
    root.add(grp);
    sharks.push({
      grp, wakeL, wakeR,
      state: 'off',           // off | circle | charge | flee | leave
      angle: (i * Math.PI),   // orbit angle
      menace: 0,              // seconds a swimmer has been nearby
      fleeT: 0, chargeT: 0, leaveT: 0,
      vel: new THREE.Vector3(),
      targetPlayer: null,
    });
  }
}

// ---------------------------------------------------------------- reset
function resetSea(G) {
  for (const f of fishes) {
    if (f.pickup) { removePickup(G, f.pickup); f.pickup = null; }
    f.state = 'off'; f.grp.visible = false; f.timer = rand(G, 0.2, 3);
  }
  for (const sh of shells) {
    if (sh.pickup) { removePickup(G, sh.pickup); sh.pickup = null; }
    sh.active = false; sh.mesh.visible = false; sh.timer = rand(G, 0.1, 2);
  }
  for (const h of harpoons) { h.active = false; h.grp.visible = false; }
  for (const s of sharks) { s.state = 'off'; s.grp.visible = false; s.menace = 0; s.fleeT = 0; }
  for (const b of bubbles) b.alive = false;
  for (const c of clusters) { c.cellX = 1e9; c.cellZ = 1e9; }
  chompInvuln.clear();
}

// ---------------------------------------------------------------- harpoon throw
function throwHarpoon(G, d) {
  if (!d) return;
  let slot = harpoons.find((h) => !h.active);
  if (!slot) slot = harpoons[0]; // recycle oldest-ish
  const o = d.origin || {};
  slot.grp.position.set(o.x || 0, o.y || 0, o.z || 0);
  const dir = d.dir || {};
  _v1.set(dir.x || 0, dir.y || 0, dir.z || 1);
  if (_v1.lengthSq() < 0.0001) _v1.set(0, 0, 1);
  _v1.normalize();
  const lv = G.upgrades?.harpoon || 1;
  slot.vel.copy(_v1).multiplyScalar(HARPOON_SPEED * (1 + 0.2 * (lv - 1)));
  slot.life = 4;
  slot.active = true;
  slot.grp.visible = true;
  G.sfx?.('splash', { small: true });
}

// ---------------------------------------------------------------- fish logic
function spawnFish(G, f) {
  const b = boatPos(G);
  const ang = rand(G, 0, Math.PI * 2);
  const dist = rand(G, 12, FISH_ROAM - 6);
  const x = b.x + Math.cos(ang) * dist;
  const z = b.z + Math.sin(ang) * dist;
  const fl = floorAt(G, x, z);
  const su = surfaceAt(G, x, z);
  f.grp.position.set(x, Math.min(su - 2, rand(G, fl + 2, su - 2)), z);
  f.species = pickSpecies(G, zoneHere(G));
  const s = 0.55 + Math.min(2.2, f.species.size * 0.22);
  f.grp.scale.setScalar(s);
  f.net.visible = false;
  f.state = 'swim';
  f.grp.visible = true;
  f.wanderT = 0;
  f.vel.set(rand(G, -1, 1), 0, rand(G, -1, 1)).normalize().multiplyScalar(3);
}

function catchFishEntity(G, f) {
  if (f.state !== 'swim') return;
  f.state = 'caught';
  f.net.visible = true;
  G.sfx?.('splash');
  const data = f.species;
  const pickup = {
    obj: f.grp, kind: 'fish', data,
    take(player) {
      if (f.pickup !== pickup) return; // already taken
      removePickup(G, pickup);
      f.pickup = null;
      f.state = 'off';
      f.grp.visible = false;
      f.timer = rand(G, 8, 20);
      G.emit('fish:caught', { fish: data, player, how: 'harpoon' });
      G.sfx?.('pickup');
    },
  };
  f.pickup = pickup;
  addPickup(G, pickup);
}

function updateFish(G, dt, t) {
  const b = boatPos(G);
  for (const f of fishes) {
    if (f.state === 'off') {
      f.timer -= dt;
      if (f.timer <= 0) spawnFish(G, f);
      continue;
    }
    const pos = f.grp.position;
    if (f.state === 'caught') {
      // Float belly-friendly in a net bubble at the surface; drift gently.
      const su = surfaceAt(G, pos.x, pos.z);
      pos.y += (su + 0.25 - pos.y) * Math.min(1, dt * 2.5);
      f.grp.rotation.z = Math.sin(t * 2 + f.bobPhase) * 0.15;
      f.grp.rotation.y += dt * 0.4;
      f.net.scale.setScalar(1 + Math.sin(t * 3 + f.bobPhase) * 0.06);
      // Recycle if the boat sails far away with it unclaimed.
      if (pos.distanceToSquared(b) > 120 * 120) {
        if (f.pickup) { removePickup(G, f.pickup); f.pickup = null; }
        f.state = 'off'; f.grp.visible = false; f.timer = rand(G, 4, 10);
      }
      continue;
    }
    // --- swimming ---
    f.wanderT -= dt;
    const near = nearestSwimmer(pos.x, pos.y, pos.z);
    let speed = 3;
    if (near && near.dist < 7) {
      // flee: away from the swimmer
      _v1.copy(pos).sub(near.s.pos); _v1.y *= 0.4;
      if (_v1.lengthSq() < 0.001) _v1.set(1, 0, 0);
      _v1.normalize();
      speed = 8.5;
      f.vel.lerp(_v1.multiplyScalar(speed), Math.min(1, dt * 5));
    } else {
      if (f.wanderT <= 0) {
        f.wanderT = rand(G, 1.5, 4);
        const ang = rand(G, 0, Math.PI * 2);
        f.target.set(b.x + Math.cos(ang) * rand(G, 8, FISH_ROAM - 4), 0, b.z + Math.sin(ang) * rand(G, 8, FISH_ROAM - 4));
      }
      _v1.copy(f.target).sub(pos); _v1.y = 0;
      if (_v1.lengthSq() > 1) {
        _v1.normalize().multiplyScalar(speed);
        f.vel.lerp(_v1, Math.min(1, dt * 2));
      }
    }
    pos.addScaledVector(f.vel, dt);
    // Depth clamp between floor and surface.
    const fl = floorAt(G, pos.x, pos.z);
    const su = surfaceAt(G, pos.x, pos.z);
    const targetY = THREE.MathUtils.clamp(pos.y + Math.sin(t * 0.8 + f.bobPhase) * dt, fl + 1.5, su - 1.5);
    pos.y = targetY;
    // Hard leash: teleport-respawn if boat sailed away.
    if (pos.distanceToSquared(b) > (FISH_ROAM + 25) * (FISH_ROAM + 25)) {
      f.state = 'off'; f.grp.visible = false; f.timer = rand(G, 0.5, 2);
      continue;
    }
    // Face travel direction + tail flap.
    if (f.vel.lengthSq() > 0.01) {
      _v2.copy(pos).add(_v1.copy(f.vel).normalize());
      f.grp.lookAt(_v2);
      f.grp.rotateY(-Math.PI / 2); // body points +x locally
    }
    f.tail.rotation.y = Math.sin(t * 8 + f.bobPhase) * 0.5;
  }
}

// ---------------------------------------------------------------- shells
function spawnShell(G, sh) {
  const b = boatPos(G);
  const zone = zoneHere(G);
  // Denser in coast/open: in deep/fog half the respawns wait longer instead.
  if ((zone === 'deep' || zone === 'fog') && rand(G, 0, 1) < 0.45) { sh.timer = rand(G, 4, 9); return; }
  const ang = rand(G, 0, Math.PI * 2);
  const dist = rand(G, 14, 65);
  const x = b.x + Math.cos(ang) * dist;
  const z = b.z + Math.sin(ang) * dist;
  sh.mesh.position.set(x, floorAt(G, x, z) + 0.3, z);
  sh.mesh.rotation.y = rand(G, 0, Math.PI * 2);
  sh.value = Math.round(rand(G, 8, 25));
  sh.active = true;
  sh.mesh.visible = true;
  const value = sh.value;
  const pickup = {
    obj: sh.mesh, kind: 'shell', data: { name: 'Seashell 🐚', emoji: '🐚', size: 0, value },
    take(player) {
      if (sh.pickup !== pickup) return;
      removePickup(G, pickup);
      sh.pickup = null;
      sh.active = false;
      sh.mesh.visible = false;
      sh.timer = rand(G, 6, 14);
      G.emit('shell:collected', { player, value });
      // fishing.js owns the hold — hand the shell over as a "catch".
      G.emit('fish:caught', { fish: { name: 'Seashell 🐚', emoji: '🐚', size: 0, value }, player, how: 'shell' });
      G.sfx?.('pickup');
    },
  };
  sh.pickup = pickup;
  addPickup(G, pickup);
}

function updateShells(G, dt, t) {
  const b = boatPos(G);
  // Shared glow pulse (one material = one uniform for all shells).
  mats.shell.emissiveIntensity = 0.6 + 0.35 * Math.sin(t * 2.4);
  for (const sh of shells) {
    if (!sh.active) {
      sh.timer -= dt;
      if (sh.timer <= 0) spawnShell(G, sh);
      continue;
    }
    sh.mesh.rotation.y += dt * 0.3;
    // Recycle when the boat has moved on.
    if (sh.mesh.position.distanceToSquared(b) > 95 * 95) {
      if (sh.pickup) { removePickup(G, sh.pickup); sh.pickup = null; }
      sh.active = false; sh.mesh.visible = false; sh.timer = rand(G, 0.2, 2);
    }
  }
}

// ---------------------------------------------------------------- harpoons
function updateHarpoons(G, dt) {
  for (const h of harpoons) {
    if (!h.active) continue;
    h.life -= dt;
    const pos = h.grp.position;
    const su = surfaceAt(G, pos.x, pos.z);
    const underwater = pos.y < su;
    // slight drop; heavier above water, drag below
    h.vel.y -= (underwater ? 3.5 : 9.8) * dt;
    if (underwater) h.vel.multiplyScalar(Math.max(0, 1 - 0.35 * dt));
    pos.addScaledVector(h.vel, dt);
    // orient along velocity
    if (h.vel.lengthSq() > 0.01) {
      _v2.copy(pos).add(_v1.copy(h.vel).normalize());
      h.grp.lookAt(_v2);
    }
    // hit fish?
    let hit = false;
    for (const f of fishes) {
      if (f.state !== 'swim') continue;
      if (f.grp.position.distanceToSquared(pos) < 1.7 * 1.7) {
        catchFishEntity(G, f);
        hit = true;
        break;
      }
    }
    // scare shark?
    if (!hit) {
      for (const s of sharks) {
        if (s.state === 'off' || s.state === 'flee') continue;
        if (s.grp.position.distanceToSquared(pos) < 2.8 * 2.8) {
          s.state = 'flee';
          s.fleeT = FLEE_SEC;
          s.menace = 0;
          hit = true;
          G.ui?.toast?.('Shark scared off! 🦈💨');
          G.sfx?.('sharkFlee');
          break;
        }
      }
    }
    if (hit || h.life <= 0 || pos.y < floorAt(G, pos.x, pos.z) + 0.2) {
      h.active = false;
      h.grp.visible = false;
    }
  }
}

// ---------------------------------------------------------------- sharks
function sharkLevel(G, zone) {
  const lv = G.flags?.sharkLevel;
  if (typeof lv === 'number') return THREE.MathUtils.clamp(lv, 0, 3);
  if (zone === 'deep') return 1;
  if (zone === 'fog') return 2;
  return 0;
}

function chompPlayer(G, shark, swim) {
  const p = swim.p;
  const now = G.time?.total || 0;
  if ((chompInvuln.get(p) || 0) > now) return;
  chompInvuln.set(p, now + 5); // brief invulnerability
  // Slapstick chomp: never lethal. Oxygen hit + drop carried pickup + bump to surface.
  if (typeof p.oxygen === 'number') p.oxygen = Math.max(1, p.oxygen - CHOMP_OXYGEN);
  if (p.carry && typeof p.carry === 'object') p.carry = null; // drops fish/pickup, keeps tools
  if (p.obj?.position && p.mode === 'swim') {
    const pp = p.obj.position;
    const su = surfaceAt(G, pp.x, pp.z);
    pp.y = Math.min(su - 0.2, pp.y + CHOMP_KNOCK_UP);
    _v1.copy(pp).sub(shark.grp.position); _v1.y = 0;
    if (_v1.lengthSq() > 0.001) pp.addScaledVector(_v1.normalize(), 2.5);
  }
  G.emit('shark:chomp', { player: p });
  G.ui?.toast?.('CHOMP! 🦈 Swim up!');
  G.sfx?.('chomp');
}

function updateSharks(G, dt, t) {
  const zone = zoneHere(G);
  const level = sharkLevel(G, zone);
  const wanted = level <= 0 ? 0 : Math.min(SHARK_POOL, level >= 2 ? 2 : 1);
  const b = boatPos(G);

  let active = 0;
  for (const s of sharks) if (s.state !== 'off' && s.state !== 'leave') active++;

  for (const s of sharks) {
    // spawn / despawn management
    if (s.state === 'off') {
      if (active < wanted) {
        active++;
        const ang = rand(G, 0, Math.PI * 2);
        const d = rand(G, 30, 45);
        s.grp.position.set(b.x + Math.cos(ang) * d, surfaceAt(G, b.x, b.z) - 3, b.z + Math.sin(ang) * d);
        s.state = 'circle';
        s.menace = 0;
        s.angle = ang;
        s.grp.visible = true;
      }
      continue;
    }
    if (active > wanted && s.state !== 'leave' && s.state !== 'flee') {
      s.state = 'leave';
      s.leaveT = 4;
      active--;
    }

    const pos = s.grp.position;
    const su = surfaceAt(G, pos.x, pos.z);
    const near = nearestSwimmer(pos.x, pos.y, pos.z);
    const aggro = 1 + level * 0.25;

    if (s.state === 'leave') {
      s.leaveT -= dt;
      pos.y -= dt * 4; // dive away dramatically
      _v1.set(pos.x - b.x, 0, pos.z - b.z).normalize();
      pos.addScaledVector(_v1, dt * 8);
      if (s.leaveT <= 0) { s.state = 'off'; s.grp.visible = false; }
    } else if (s.state === 'flee') {
      s.fleeT -= dt;
      _v1.copy(pos).sub(b); _v1.y = 0;
      if (_v1.lengthSq() < 0.01) _v1.set(1, 0, 0);
      _v1.normalize();
      _v2.copy(_v1.multiplyScalar(14));
      s.vel.lerp(_v2, Math.min(1, dt * 3));
      pos.addScaledVector(s.vel, dt);
      pos.y += (su - 4 - pos.y) * Math.min(1, dt);
      if (s.fleeT <= 0) s.state = 'circle';
    } else if (s.state === 'charge') {
      const target = s.targetPlayer && _swim.find((w) => w.p === s.targetPlayer);
      if (!target) {
        s.state = 'circle'; s.menace = 0;
      } else {
        _v1.copy(target.pos).sub(pos);
        const dist = _v1.length();
        _v1.normalize().multiplyScalar(12 + level * 2);
        s.vel.lerp(_v1, Math.min(1, dt * 4));
        pos.addScaledVector(s.vel, dt);
        if (dist < 1.8) {
          chompPlayer(G, s, target);
          s.state = 'circle';
          s.menace = -4; // cooldown before it gets grumpy again
        }
        s.chargeT -= dt;
        if (s.chargeT <= 0) { s.state = 'circle'; s.menace = 0; }
      }
    } else { // circle
      let cx, cz, radius, depth;
      if (near && near.dist < 26) {
        // circle the swimmer, menace rising
        cx = near.s.pos.x; cz = near.s.pos.z;
        radius = SHARK_CIRCLE_R;
        depth = 2.5;
        if (near.dist < 15) s.menace += dt * aggro;
        if (s.menace > 6) {
          s.state = 'charge';
          s.chargeT = 3;
          s.targetPlayer = near.s.p;
          G.emit('shark:attack', { shark: s });
          G.sfx?.('sharkAttack');
        }
      } else {
        // nobody swimming: menace the BOAT — fins only, threats.js does any damage
        cx = b.x; cz = b.z;
        radius = SHARK_BOAT_R;
        depth = 1.1; // shallow → dorsal fin cuts the surface
        s.menace = Math.max(0, s.menace - dt);
      }
      s.angle += dt * (0.55 + level * 0.12);
      _v1.set(cx + Math.cos(s.angle) * radius, 0, cz + Math.sin(s.angle) * radius);
      _v2.copy(_v1).sub(pos); _v2.y = 0;
      const d = _v2.length();
      if (d > 0.05) {
        _v2.normalize().multiplyScalar(Math.min(10, d * 2.5));
        s.vel.lerp(_v2, Math.min(1, dt * 2.5));
        pos.addScaledVector(s.vel, dt);
      }
      pos.y += (su - depth - pos.y) * Math.min(1, dt * 1.5);
    }

    // face travel direction
    if (s.vel.lengthSq() > 0.02) {
      _v2.copy(pos).add(_v1.copy(s.vel).normalize());
      s.grp.lookAt(_v2);
      s.grp.rotateY(-Math.PI / 2); // body long axis is +x
    }
    // V wake only when the fin is slicing the surface
    const finOut = pos.y > su - 1.6;
    s.wakeL.visible = finOut;
    s.wakeR.visible = finOut;
  }
}

// ---------------------------------------------------------------- decor updates
function updateSchools(G, dt, t) {
  const b = boatPos(G);
  let idx = 0;
  for (let si = 0; si < SCHOOL_COUNT; si++) {
    const sc = schools[si];
    const cx = b.x + sc.offX;
    const cz = b.z + sc.offZ;
    const cy = surfaceAt(G, cx, cz) - sc.depth; // one wave sample per school
    for (let i = 0; i < SCHOOL_SIZE; i++) {
      const a = sc.phase + t * sc.speed + (i / SCHOOL_SIZE) * Math.PI * 2;
      const r = sc.radius + Math.sin(i * 2.7 + t) * 0.5;
      _obj.position.set(cx + Math.cos(a) * r, cy + Math.sin(i + t * 2) * 0.25, cz + Math.sin(a) * r);
      // tiny cones point along the swim direction (tangent)
      _obj.rotation.set(Math.PI / 2, 0, -a - (sc.speed > 0 ? 0 : Math.PI), 'YXZ');
      _obj.scale.setScalar(1);
      _obj.updateMatrix();
      schoolsMesh.setMatrixAt(idx++, _obj.matrix);
    }
  }
  schoolsMesh.instanceMatrix.needsUpdate = true;
}

function updateBubbles(G, dt, t) {
  const anySwim = _swim.length > 0;
  if (!anySwim) {
    let anyAlive = false;
    for (const bb of bubbles) if (bb.alive) { anyAlive = true; break; }
    if (!anyAlive) { bubblesMesh.visible = false; return; }
  }
  bubblesMesh.visible = true;
  bubbleTimer -= dt;
  if (anySwim && bubbleTimer <= 0) {
    bubbleTimer = 0.09;
    const src = _swim[Math.floor(rand(G, 0, _swim.length)) % _swim.length];
    const slot = bubbles.find((bb) => !bb.alive);
    if (slot) {
      slot.x = src.pos.x + rand(G, -0.4, 0.4);
      slot.y = src.pos.y + 0.4;
      slot.z = src.pos.z + rand(G, -0.4, 0.4);
      slot.vy = rand(G, 2, 4);
      slot.alive = true;
    }
  }
  for (let i = 0; i < BUBBLE_POOL; i++) {
    const bb = bubbles[i];
    if (bb.alive) {
      bb.y += bb.vy * dt;
      bb.x += Math.sin(t * 4 + i) * dt * 0.4;
      if (bb.y > surfCache + 0.3) bb.alive = false;
    }
    _obj.position.set(bb.x, bb.alive ? bb.y : -999, bb.z);
    _obj.rotation.set(0, 0, 0);
    _obj.scale.setScalar(bb.alive ? 1 : 0.001);
    _obj.updateMatrix();
    bubblesMesh.setMatrixAt(i, _obj.matrix);
  }
  bubblesMesh.instanceMatrix.needsUpdate = true;
}

function placeCluster(G, ci) {
  const c = clusters[ci];
  const present = cellHash(c.cellX, c.cellZ, 7) > 0.3; // some cells stay bare
  for (let w = 0; w < WEEDS_PER_CLUSTER; w++) {
    const wi = ci * WEEDS_PER_CLUSTER + w;
    if (!present) {
      _obj.position.set(0, -999, 0); _obj.scale.setScalar(0.001);
    } else {
      const hx = cellHash(c.cellX, c.cellZ, 11 + w);
      const hz = cellHash(c.cellX, c.cellZ, 29 + w);
      const x = (c.cellX + 0.15 + hx * 0.7) * DECOR_GRID;
      const z = (c.cellZ + 0.15 + hz * 0.7) * DECOR_GRID;
      const y = floorAt(G, x, z);
      _obj.position.set(x, y + 1.1, z);
      _obj.rotation.set(cellHash(c.cellX, c.cellZ, 41 + w) * 0.3 - 0.15, hx * 6.28, 0);
      _obj.scale.set(1, 0.7 + hz * 1.2, 1);
    }
    _obj.updateMatrix();
    weedMesh.setMatrixAt(wi, _obj.matrix);
  }
  const hr = cellHash(c.cellX, c.cellZ, 53);
  if (!present || hr < 0.35) {
    _obj.position.set(0, -999, 0); _obj.scale.setScalar(0.001);
  } else {
    const x = (c.cellX + 0.2 + hr * 0.6) * DECOR_GRID;
    const z = (c.cellZ + 0.2 + cellHash(c.cellX, c.cellZ, 67) * 0.6) * DECOR_GRID;
    _obj.position.set(x, floorAt(G, x, z) + 0.4, z);
    _obj.rotation.set(hr * 3, hr * 6, 0);
    _obj.scale.setScalar(0.6 + hr * 1.1);
  }
  _obj.updateMatrix();
  rockMesh.setMatrixAt(ci, _obj.matrix);
  _obj.rotation.set(0, 0, 0);
  _obj.scale.setScalar(1);
}

function updateFloorDecor(G, dt) {
  decorCheckT -= dt;
  if (decorCheckT > 0) return;
  decorCheckT = 0.5; // reposition check twice a second is plenty
  const b = boatPos(G);
  const baseX = Math.round(b.x / DECOR_GRID);
  const baseZ = Math.round(b.z / DECOR_GRID);
  let changed = false;
  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i];
    const cx = baseX + c.offX;
    const cz = baseZ + c.offZ;
    if (cx !== c.cellX || cz !== c.cellZ) {
      c.cellX = cx; c.cellZ = cz;
      placeCluster(G, i);
      changed = true;
    }
  }
  if (changed) {
    weedMesh.instanceMatrix.needsUpdate = true;
    rockMesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- update
export function update(G, dt) {
  if (!root) return;
  if (!dt) return; // paused / menu: static ambient is fine, no sim, no matrix churn
  const t = G.time?.total || 0;
  const b = boatPos(G);
  surfCache = surfaceAt(G, b.x, b.z);
  gatherSwimmers(G);

  updateSchools(G, dt, t);
  updateBubbles(G, dt, t);
  updateFloorDecor(G, dt);
  updateShells(G, dt, t);
  updateFish(G, dt, t);
  updateHarpoons(G, dt);
  updateSharks(G, dt, t);
}
