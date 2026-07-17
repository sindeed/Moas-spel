// Dear Fishermen — boat.js
// The fishing boat: mesh, wave physics, stations, damage/leaks/fires, cannon, loose props.
// Owns G.boat. Talks to everything else ONLY via G state + G.emit/G.on (GDD §7).
import * as THREE from '../lib/three.module.min.js';

// ---------------------------------------------------------------- tuning
const DECK_Y = 1.15;                 // walkable deck height (boat-local)
const WALK_X = 2.55;                 // walkable half-width
const WALK_Z = 6.55;                 // walkable half-length (bow +z, stern -z)
const FLOAT_Y = 0.55;                // hull rest height over the water line
const MAX_SPEED = [0, 6, 8, 10];     // u/s by engine level 1..3
const TURN_RATE = [0, 0.55, 0.7, 0.85]; // rad/s by engine level
const REVERSE_FRAC = 0.4;            // reverse speed fraction
const ACCEL = 3.0;                   // u/s^2 toward target speed
const LEAK_FILL = 1 / 90;            // water 0..1 per second per active leak
const FIRE_SPREAD_SEC = 20;          // unattended fire spawns a friend
const FIRE_MAX = 4;
const FIRE_DPS = 0.7;                // hull damage per second per fire
const SINK_SEC = 4;                  // listing-over animation length
const BOLT_SPEED = 40;
const BOLT_GRAV = 9.8;
const BOLT_LIFE = 4;
const CANNON_COOLDOWN = 0.7;
const HARBOR_MOOR_DIST = 62; // reaches the tip of Port Johnson's long dock
const HARBOR_CALM_DIST = 80;         // waves fade to 30% inside this radius
const PROP_SLIDE_TILT = 0.12;        // |tilt| where cargo starts sliding

// Solid blocks on deck that you cannot walk through (local rects).
const BLOCKS = [
  { x0: -1.5, x1: 1.5, z0: -3.35, z1: -2.65 },  // cabin console (wheel stands in front)
  { x0: -0.9, x1: 0.9, z0: -5.85, z1: -4.9 },   // engine block at the stern
];

// Where leaks may pop open (deck-floor spots away from stations).
const LEAK_SPOTS = [
  [-1.8, -1.2], [1.8, -1.6], [-1.6, 1.8], [1.5, 2.6],
  [0.0, 0.2], [-1.9, 4.0], [1.8, 4.4], [0.4, -4.3],
];
// Where fires may start.
const FIRE_SPOTS = [
  [0, -5.3],      // engine (most likely — first pick)
  [-1.2, -2.9],   // cabin side
  [1.6, 1.4],     // deck mid
  [-1.7, 3.2],    // deck fore
  [1.2, -3.8],    // aft deck
];

// ---------------------------------------------------------------- module state
let B = null;          // shortcut to G.boat
let group = null;
let wheelStation = null, cannonStation = null;
let yawPivot = null, pitchPivot = null, muzzle = null, barrel = null;
let lantern = null, waterPlane = null, stackTip = null, fireLight = null, radarBar = null;
let leaks = [], fires = [], props = [];
let leakSeq = 0, fireSeq = 0;
let cannonCd = 0, recoil = 0;
let sinkT = 0, sunkEmitted = false;
let rollKick = 0;                    // comedy jolt on damage
let smokeT = 0, mooredBobT = 0, bubbleT = 0;
let lastWashSeq = null;                // one-shot guard for G.flags.washImpulse
let Gref = null;

// pools
const bolts = [];                    // { mesh, vel, life, active }
const puffs = [];                    // { mesh, mat, vel:y, life, maxLife, s0, s1, active }
const PUFF_N = 20, BOLT_N = 8;

// temp vectors (never allocate in per-frame code)
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _twV = new THREE.Vector3();
const _tlV = new THREE.Vector3();
const _dbRes = { pos: new THREE.Vector3(), onDeck: true };

// shared materials / geometries
const M = {};
const GEO = {};

function toon(color, opts) {
  return new THREE.MeshToonMaterial(Object.assign({ color }, opts || {}));
}

// ============================================================== INIT
export function init(G) {
  Gref = G;
  group = new THREE.Group();
  group.rotation.order = 'YXZ'; // yaw, then pitch, then roll
  G.scene.add(group);

  makeMaterials();
  buildHull();
  buildWheelhouse();
  buildMast();
  buildEngine();
  buildGantry();
  buildDeckDressing();
  buildRailings();
  buildCannon();
  buildStationProps();
  buildRigging();
  flushBatches();
  buildWaterPlane();
  buildProps();
  buildPools(G);

  // ONE shared fire light for all fires (adding/removing lights forces shader recompiles)
  fireLight = new THREE.PointLight(0xff7a2a, 0, 9, 1.8);
  fireLight.position.set(0, DECK_Y + 0.65, 0);
  group.add(fireLight);

  const stations = [
    st('wheel', 'wheel', 0, -2.2),
    st('rod-port', 'rod', -2.2, -6.1),
    st('rod-star', 'rod', 2.2, -6.1),
    st('cannon', 'cannon', 0, 5.6),
    st('supply', 'supply', -2.1, 0.6),
    st('hold', 'hold', 1.7, 0.6),
    st('ladder', 'ladder', 0, -6.6),
  ];
  wheelStation = stations[0];
  cannonStation = stations[3];

  G.boat = B = {
    group,
    heading: Math.PI, throttle: 0, speed: 0, moored: false, sinking: false,
    hull: { hp: 100, maxHp: 100 },
    water: 0,
    leaks, fires, props,
    stations,
    tilt: { pitch: 0, roll: 0 },
    deckBound, toWorld, toLocal,
    damage, repair, addLeak, addFire, douse, extinguish,
    kick(n) { rollKick += n; },
    cannon: { yaw: 0, pitch: 0.25, aim: cannonAim, fire: cannonFire },
  };

  resetFresh(G);

  G.on('game:new', () => resetFresh(G));
  G.on('save:collect', (data) => {
    data.boat = {
      hp: B.hull.hp, water: B.water,
      x: group.position.x, z: group.position.z, heading: B.heading,
    };
  });
  G.on('save:apply', (data) => applySave(G, data && data.boat));
}

function st(id, type, x, z) {
  return { id, type, localPos: new THREE.Vector3(x, DECK_Y, z), radius: 1.6, user: null };
}

function makeMaterials() {
  M.red = toon(0xd23c2a);
  M.white = toon(0xf4f1e8);
  M.wood = toon(0xa5713f);
  M.woodDark = toon(0x6e4a2a);
  M.metal = toon(0x5a6570);
  M.metalDark = toon(0x333a41);
  M.canvas = toon(0xe8dcc0);
  M.dark = toon(0x1c2126);
  M.brass = toon(0xc9a227);
  M.bilge = toon(0x2e7fb8, { transparent: true, opacity: 0.55 });
  M.puddle = toon(0x2e7fb8, { transparent: true, opacity: 0.5 });
  M.spray = toon(0xbfe6ff, { transparent: true, opacity: 0.55 });
  M.flameO = toon(0xff7a1a, { transparent: true, opacity: 0.9 });
  M.flameY = toon(0xffd23a, { transparent: true, opacity: 0.9 });
  M.bolt = toon(0x3d434a);
  M.blue = toon(0x2f6fd1);     // fish crates
  M.net = toon(0x47694b);      // fishing-net green
  M.buoy = toon(0xe8862f);     // orange fenders
  M.glow = new THREE.MeshBasicMaterial({ color: 0xffd98a });
  M.navR = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
  M.navG = new THREE.MeshBasicMaterial({ color: 0x30d158 });
  M.line = new THREE.LineBasicMaterial({ color: 0x3a4046 });

  GEO.flame = new THREE.ConeGeometry(0.22, 0.7, 6);
  GEO.puddle = new THREE.CircleGeometry(0.5, 12);
  GEO.hole = new THREE.CircleGeometry(0.26, 8);
  GEO.spray = new THREE.ConeGeometry(0.16, 0.9, 6);
  GEO.puff = new THREE.SphereGeometry(0.28, 6, 5);
  GEO.bolt = new THREE.CylinderGeometry(0.06, 0.06, 1.1, 5);
  GEO.unit = new THREE.BoxGeometry(1, 1, 1);
  GEO.porthole = new THREE.CylinderGeometry(0.14, 0.14, 0.1, 10);
  GEO.fender = new THREE.CylinderGeometry(0.17, 0.17, 0.45, 7);
  GEO.crate = new THREE.BoxGeometry(0.7, 0.7, 0.7);
  GEO.barrel = new THREE.CylinderGeometry(0.34, 0.34, 0.8, 8);
  GEO.bucket = new THREE.CylinderGeometry(0.22, 0.16, 0.3, 8);
}

function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  group.add(m);
  return m;
}

// Batched unit-box instances grouped per material — flushed to ONE InstancedMesh
// per material. Lets the trawler carry lots of little details for very few draw calls.
const BATCH = {};
function bat(mat, sx, sy, sz, x, y, z, rx, ry, rz) {
  (BATCH[mat] || (BATCH[mat] = [])).push([sx, sy, sz, x, y, z, rx, ry, rz]);
}
function makeInstanced(geo, mat, items) {
  const inst = new THREE.InstancedMesh(geo, mat, items.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  items.forEach((it, i) => {
    e.set(it[6] || 0, it[7] || 0, it[8] || 0);
    _a.set(it[3], it[4], it[5]);
    _b.set(it[0], it[1], it[2]);
    m4.compose(_a, q.setFromEuler(e), _b);
    inst.setMatrixAt(i, m4);
  });
  inst.instanceMatrix.needsUpdate = true;
  group.add(inst);
  return inst;
}
function flushBatches() {
  for (const key of Object.keys(BATCH)) {
    makeInstanced(GEO.unit, M[key], BATCH[key]);
    delete BATCH[key];
  }
}

function buildHull() {
  // real trawler profile — still the loved red + white
  bat('red', 5.6, 1.6, 13.0, 0, 0.2, -0.5);                  // main hull
  bat('white', 5.8, 0.42, 13.2, 0, 0.78, -0.5);              // white stripe band
  bat('dark', 5.92, 0.12, 13.3, 0, 0.45, -0.5);              // rub rail stripe
  bat('dark', 0.28, 0.4, 11.6, 0, -0.5, -0.5);               // keel hint at the waterline
  // pointy bow: a 4-sided cone lying forward
  const bow = new THREE.Mesh(new THREE.ConeGeometry(2.75, 2.6, 4), M.red);
  bow.rotation.x = Math.PI / 2; bow.rotation.y = Math.PI / 4;
  bow.scale.set(1.42, 1, 0.58); // wide + flat like the hull cross-section
  bow.position.set(0, 0.28, 7.15);
  group.add(bow);
  const bowStripe = new THREE.Mesh(new THREE.ConeGeometry(2.85, 2.7, 4), M.white);
  bowStripe.rotation.copy(bow.rotation); bowStripe.rotation.y = Math.PI / 4;
  bowStripe.scale.set(1.44, 1, 0.16);
  bowStripe.position.set(0, 0.78, 7.1);
  group.add(bowStripe);
  bat('wood', 5.4, 0.16, 13.6, 0, 1.07, 0);                  // wooden deck
  // a few darker plank lines (cheap detail)
  for (let i = -2; i <= 2; i++) bat('woodDark', 0.06, 0.17, 13.6, i * 1.05, 1.075, 0);
  // raised red bulwark along both sides, sweeping up toward the bow, with a wooden gunwale cap
  const SHEER = -0.107; // sweep angle of the bow sections
  for (const s of [-1, 1]) {
    bat('red', 0.14, 0.55, 8.7, s * 2.76, DECK_Y + 0.28, -2.3);            // side bulwark
    bat('wood', 0.26, 0.09, 8.75, s * 2.74, DECK_Y + 0.6, -2.3);           // gunwale cap rail
    bat('red', 0.14, 0.55, 4.0, s * 2.76, DECK_Y + 0.48, 3.95, SHEER);     // sheer sweep to the bow
    bat('wood', 0.26, 0.09, 4.05, s * 2.74, DECK_Y + 0.8, 3.95, SHEER);    // sweeping cap
  }
  // round portholes, 4 per side
  const ph = [];
  for (const s of [-1, 1]) for (const z of [2.6, 1.0, -0.8, -2.6])
    ph.push([1, 1, 1, s * 2.82, 0.18, z, 0, 0, Math.PI / 2]);
  makeInstanced(GEO.porthole, M.dark, ph);
  // anchor hanging at the port bow (cross of boxes against the bow flare)
  bat('metalDark', 0.09, 0.78, 0.09, -2.35, 0.5, 6.2, 0, -0.72);   // shank
  bat('metalDark', 0.56, 0.08, 0.08, -2.35, 0.82, 6.2, 0, -0.72);  // stock
  bat('metalDark', 0.44, 0.16, 0.08, -2.35, 0.17, 6.2, 0, -0.72);  // flukes
}

function buildWheelhouse() {
  // Proper little wheelhouse over the console block. The white cabin body sits on
  // the starboard two-thirds; the port third is an open "bridge wing" under the
  // same red roof — so the deck fire spot beside the cabin stays visible.
  bat('white', 2.05, 1.9, 0.7, 0.48, DECK_Y + 0.95, -3.0);       // cabin body
  bat('white', 0.13, 1.9, 0.13, -1.42, DECK_Y + 0.95, -2.72);    // wing posts hold the roof
  bat('white', 0.13, 1.9, 0.13, -1.42, DECK_Y + 0.95, -3.28);
  // big dark windows on all four sides (front panes raked forward, trawler-style)
  const wy = DECK_Y + 1.42;
  bat('dark', 0.78, 0.58, 0.07, 0.06, wy, -2.57, 0.18);          // front panes
  bat('dark', 0.78, 0.58, 0.07, 0.92, wy, -2.57, 0.18);
  bat('dark', 0.07, 0.52, 0.5, 1.52, wy, -3.0);                  // starboard window
  bat('dark', 0.07, 0.52, 0.5, -0.56, wy, -3.0);                 // wing-side window
  bat('dark', 0.85, 0.48, 0.07, 0.95, wy, -3.37);                // back window
  bat('dark', 0.6, 1.35, 0.07, 0.02, DECK_Y + 0.7, -3.37);       // back door
  bat('red', 3.5, 0.16, 1.2, 0, DECK_Y + 1.98, -3.0);            // red roof (covers the wing too)
  // roof gear: spinning radar bar, exhaust stack, nav lights (antenna line in buildRigging)
  bat('metalDark', 0.09, 0.24, 0.09, 0.5, DECK_Y + 2.18, -3.1);  // radar post
  radarBar = box(0.9, 0.07, 0.18, M.white, 0.5, DECK_Y + 2.33, -3.1);
  const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.8, 8), M.metalDark);
  stack.position.set(1.15, DECK_Y + 2.42, -3.3);
  group.add(stack);
  stackTip = new THREE.Object3D();                               // smoke puffs from here
  stackTip.position.set(1.15, DECK_Y + 2.85, -3.3);
  group.add(stackTip);
  box(0.14, 0.14, 0.14, M.navR, -1.62, DECK_Y + 2.13, -2.75);    // port nav light (red)
  box(0.14, 0.14, 0.14, M.navG, 1.62, DECK_Y + 2.13, -2.75);     // starboard nav light (green)
  // life-buoy ring on the back wall
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.07, 6, 12), M.red);
  ring.position.set(0.95, DECK_Y + 0.8, -3.42);
  group.add(ring);
  // fire extinguisher 🧯 mounted on the starboard cabin wall (visual home of the pro tool;
  // characters.js hands out the carried copy from the supply crate)
  const extTank = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.34, 8), M.red);
  extTank.position.set(1.6, DECK_Y + 0.75, -3.0);
  group.add(extTank);
  bat('dark', 0.07, 0.1, 0.07, 1.6, DECK_Y + 0.97, -3.0);        // valve head
  bat('dark', 0.05, 0.05, 0.16, 1.6, DECK_Y + 0.99, -2.9);       // stubby nozzle
  bat('metalDark', 0.04, 0.3, 0.14, 1.53, DECK_Y + 0.75, -3.0);  // wall bracket
  // ship's wheel out front (the wheel station stands here, facing the windows)
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.06, 6, 10), M.woodDark);
  wheel.position.set(0, DECK_Y + 1.2, -2.45);
  group.add(wheel);
  for (let i = 0; i < 3; i++)
    bat('woodDark', 0.98, 0.06, 0.06, 0, DECK_Y + 1.2, -2.45, 0, 0, (i / 3) * Math.PI);
  bat('woodDark', 0.13, 0.6, 0.13, 0, DECK_Y + 0.92, -2.56, 0.3); // wheel pedestal
  // lantern on the wheelhouse roof (warm light at night)
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), M.glow);
  lamp.position.set(-0.3, DECK_Y + 2.25, -2.75);
  group.add(lamp);
  lantern = new THREE.PointLight(0xffb45e, 0, 22, 1.6);
  lantern.position.copy(lamp.position);
  group.add(lantern);
}

function buildMast() {
  // trawler work mast just behind the wheelhouse, boom angled aft over the gantry
  bat('wood', 0.2, 4.7, 0.2, 0, DECK_Y + 2.35, -3.85);           // main pole
  bat('wood', 1.5, 0.1, 0.1, 0, DECK_Y + 3.85, -3.85);           // cross-tree
  bat('wood', 0.12, 3.0, 0.12, 0, DECK_Y + 2.68, -5.19, -1.1);   // boom, tip over the stern
  // little crow's-nest light on top
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), M.glow);
  top.position.set(0, DECK_Y + 4.82, -3.85);
  group.add(top);
}

function buildEngine() {
  bat('metal', 1.6, 0.9, 0.9, 0, DECK_Y + 0.45, -5.4);           // engine block
  bat('metalDark', 1.7, 0.2, 1.0, 0, DECK_Y + 0.95, -5.4);
  // net drum winch on the port quarter, next to the engine
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.05, 9), M.net);
  drum.rotation.x = Math.PI / 2;
  drum.position.set(-2.05, DECK_Y + 0.42, -4.35);
  group.add(drum);
  bat('woodDark', 0.34, 0.55, 0.1, -2.05, DECK_Y + 0.27, -4.95); // drum stands
  bat('woodDark', 0.34, 0.55, 0.1, -2.05, DECK_Y + 0.27, -3.75);
}

function buildGantry() {
  // stern A-frame gantry — pure visuals, everything above head height
  for (const s of [-1, 1]) {
    bat('red', 0.16, 2.85, 0.16, s * 2.4, 2.58, -6.3);           // legs
    bat('red', 0.11, 1.0, 0.11, s * 2.02, 3.42, -6.3, 0, 0, s * 0.55); // A-braces
  }
  bat('red', 5.1, 0.2, 0.2, 0, 4.0, -6.3);                       // crossbeam
  bat('metalDark', 0.2, 0.28, 0.16, 0, 3.5, -6.3);               // hanging block
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.03, 5, 10), M.metal);
  hook.position.set(0, 3.28, -6.3);
  group.add(hook);
  // rolled-up net draped over the beam + a bit of hanging mesh (cheap lattice)
  const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 3.4, 8), M.net);
  roll.rotation.z = Math.PI / 2;
  roll.position.set(0, 3.66, -6.5);
  group.add(roll);
  const lattice = [];
  for (const x of [-1.2, -0.45, 0.45, 1.2]) lattice.push([0.05, 0.8, 0.05, x, 3.4, -6.56, 0.08]);
  lattice.push([2.9, 0.05, 0.05, 0, 3.55, -6.56], [2.9, 0.05, 0.05, 0, 3.18, -6.56]);
  makeInstanced(GEO.unit, M.net, lattice);
}

function buildDeckDressing() {
  // two stacked blue fish crates by the hold hatch
  bat('blue', 0.62, 0.6, 0.62, 2.2, DECK_Y + 0.3, 1.8);
  bat('blue', 0.62, 0.6, 0.62, 2.2, DECK_Y + 0.9, 1.8, 0, 0.18);
  // coiled rope on the foredeck (flat — slides stay funny)
  const coil = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.11, 6, 12), M.canvas);
  coil.scale.z = 0.5;
  coil.rotation.x = -Math.PI / 2;
  coil.position.set(-2.2, DECK_Y + 0.06, 2.7);
  group.add(coil);
  // three fenders hanging over each side (their lines live in buildRigging)
  const fd = [];
  for (const s of [-1, 1]) for (const z of [-4.0, -0.5, 3.0]) fd.push([1, 1, 1, s * 2.96, 0.78, z]);
  makeInstanced(GEO.fender, M.buoy, fd);
}

function buildRailings() {
  // bow + stern rails and posts (the side rails are now the bulwark from buildHull)
  bat('woodDark', 4.6, 0.1, 0.1, 0, DECK_Y + 0.85, 6.6);         // bow rail
  bat('woodDark', 1.9, 0.1, 0.1, -1.72, DECK_Y + 0.6, -6.6);     // stern port piece
  bat('woodDark', 1.9, 0.1, 0.1, 1.72, DECK_Y + 0.6, -6.6);      // stern starboard — gap at center = ladder
  for (let x = -2; x <= 2; x += 1) bat('woodDark', 0.1, 0.85, 0.1, x, DECK_Y + 0.42, 6.6);
  for (const x of [-2.0, -1.2, 1.2, 2.0]) bat('woodDark', 0.1, 0.55, 0.1, x, DECK_Y + 0.3, -6.6);
  // stern ladder (down the gap)
  bat('woodDark', 0.08, 0.08, 0.9, -0.35, 0.3, -7.0);
  bat('woodDark', 0.08, 0.08, 0.9, 0.35, 0.3, -7.0);
  for (let i = 0; i < 3; i++) bat('wood', 0.75, 0.07, 0.07, 0, -0.1 + i * 0.45, -7.0 - i * 0.12);
}

function buildRigging() {
  // ALL rigging as one LineSegments: stays, boom lift, hoist, antenna, fender lines
  const p = [];
  const seg = (ax, ay, az, bx, by, bz) => p.push(ax, ay, az, bx, by, bz);
  const mhY = DECK_Y + 4.7;                                      // masthead
  seg(0, mhY, -3.85, 0, DECK_Y + 0.9, 6.35);                     // forestay down to the bow
  seg(0, mhY, -3.85, 0, 4.0, -6.3);                              // backstay to the gantry beam
  seg(0, mhY, -3.85, 0, DECK_Y + 3.36, -6.52);                   // topping lift to the boom tip
  seg(0, 3.9, -6.3, 0, 3.64, -6.3);                              // hoist rope to the block
  seg(-1.42, DECK_Y + 2.06, -3.28, -1.58, DECK_Y + 3.6, -3.42);  // whip antenna off the roof
  for (const s of [-1, 1]) for (const z of [-4.0, -0.5, 3.0])
    seg(s * 2.74, DECK_Y + (z > 2 ? 0.82 : 0.62), z, s * 2.96, 1.0, z); // fender lines
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  group.add(new THREE.LineSegments(geo, M.line));
}

function buildCannon() {
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.62, 0.5, 8), M.metalDark);
  base.position.set(0, DECK_Y + 0.25, 5.6);
  group.add(base);
  yawPivot = new THREE.Group();
  yawPivot.position.set(0, DECK_Y + 0.55, 5.6);
  group.add(yawPivot);
  pitchPivot = new THREE.Group();
  pitchPivot.position.y = 0.15;
  yawPivot.add(pitchPivot);
  barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 1.7, 8), M.metal);
  barrel.rotation.x = Math.PI / 2; // cylinder Y-axis -> +z (forward)
  barrel.position.z = 0.6;
  pitchPivot.add(barrel);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.12), M.brass);
  grip.position.set(0, -0.05, -0.4);
  pitchPivot.add(grip);
  muzzle = new THREE.Object3D();
  muzzle.position.z = 1.5;
  pitchPivot.add(muzzle);
}

function buildStationProps() {
  // supply crate (planks + buckets painted on top)
  bat('wood', 1.0, 0.8, 1.0, -2.1, DECK_Y + 0.4, 0.6);
  box(0.8, 0.1, 0.25, M.canvas, -2.1, DECK_Y + 0.85, 0.45);  // planks peeking out
  const bkt = new THREE.Mesh(GEO.bucket, M.metal);
  bkt.position.set(-1.85, DECK_Y + 0.95, 0.85);
  group.add(bkt);
  // fish hold hatch
  bat('woodDark', 1.3, 0.12, 1.3, 1.7, DECK_Y + 0.06, 0.6);
  bat('brass', 0.35, 0.1, 0.12, 1.7, DECK_Y + 0.14, 0.6);
  // rod holders at stern corners
  bat('brass', 0.12, 0.7, 0.12, -2.2, DECK_Y + 0.35, -6.1);
  bat('brass', 0.12, 0.7, 0.12, 2.2, DECK_Y + 0.35, -6.1);
}

function buildWaterPlane() {
  // rising bilge water inside the hull (scaled by G.boat.water)
  waterPlane = new THREE.Mesh(new THREE.BoxGeometry(4.9, 1, 12.5), M.bilge);
  waterPlane.position.y = 0.1;
  waterPlane.visible = false;
  group.add(waterPlane);
}

function buildProps() {
  // loose cargo that slides around — pure comedy
  const defs = [
    [GEO.crate, M.wood, 1.9, 2.9, 0.35],
    [GEO.crate, M.woodDark, -1.6, 3.6, 0.35],
    [GEO.barrel, M.red, 2.0, -1.4, 0.4],
    [GEO.barrel, M.wood, -2.0, -0.9, 0.4],
    [GEO.crate, M.wood, -0.9, 1.9, 0.35],
    [GEO.bucket, M.metal, 0.9, 4.4, 0.15],
  ];
  for (const [geo, mat, x, z, hh] of defs) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, DECK_Y + hh, z);
    group.add(mesh);
    props.push({ obj: mesh, vel: new THREE.Vector3(), radius: 0.4, homeX: x, homeZ: z, hh });
  }
}

function buildPools(G) {
  for (let i = 0; i < BOLT_N; i++) {
    const mesh = new THREE.Mesh(GEO.bolt, M.bolt);
    mesh.visible = false;
    G.scene.add(mesh); // bolts fly in world space
    bolts.push({ mesh, vel: new THREE.Vector3(), life: 0, active: false });
  }
  for (let i = 0; i < PUFF_N; i++) {
    const mat = new THREE.MeshToonMaterial({ color: 0xcccccc, transparent: true, opacity: 0 });
    const mesh = new THREE.Mesh(GEO.puff, mat);
    mesh.visible = false;
    G.scene.add(mesh); // world-space: smoke drifts behind the boat, splashes stay put
    puffs.push({ mesh, mat, rise: 0, life: 0, maxLife: 1, s0: 0.2, s1: 0.7, active: false });
  }
}

// ============================================================== PUBLIC API
function damage(n, why) {
  if (!B || B.sinking) return;
  B.hull.hp = Math.max(0, B.hull.hp - n);
  rollKick += (Gref && Gref.rng() > 0.5 ? 1 : -1) * Math.min(0.09, 0.02 * n);
  Gref && Gref.emit('boat:damage', { n, why });
}

function addLeak() {
  if (!B || B.sinking) return null;
  // pick a spot no active leak uses
  let spot = null;
  for (let tries = 0; tries < 10 && !spot; tries++) {
    const s = LEAK_SPOTS[Math.floor((Gref ? Gref.rng() : Math.random()) * LEAK_SPOTS.length)];
    if (!leaks.some((l) => l.active && l.pos.x === s[0] && l.pos.z === s[1])) spot = s;
  }
  if (!spot) return null;
  const id = 'leak' + (++leakSeq);
  const holder = new THREE.Group();
  holder.position.set(spot[0], DECK_Y + 0.02, spot[1]);
  const hole = new THREE.Mesh(GEO.hole, M.dark);
  hole.rotation.x = -Math.PI / 2;
  holder.add(hole);
  const spray = new THREE.Mesh(GEO.spray, M.spray);
  spray.position.y = 0.45;
  holder.add(spray);
  const puddle = new THREE.Mesh(GEO.puddle, M.puddle);
  puddle.rotation.x = -Math.PI / 2;
  puddle.position.y = 0.015;
  puddle.scale.setScalar(0.3);
  holder.add(puddle);
  group.add(holder);
  const leak = { id, pos: new THREE.Vector3(spot[0], DECK_Y, spot[1]), active: true, holder, spray, puddle, age: 0 };
  leaks.push(leak);
  Gref && Gref.emit('boat:leak', { leak });
  return leak;
}

function repair(id) {
  const i = leaks.findIndex((l) => l.id === id);
  if (i < 0) return false;
  const leak = leaks[i];
  group.remove(leak.holder);
  leaks.splice(i, 1);
  Gref && Gref.emit('boat:repaired', { id });
  return true;
}

function addFire() {
  if (!B || B.sinking || fires.length >= FIRE_MAX) return null;
  let spot = null;
  for (let tries = 0; tries < 10 && !spot; tries++) {
    const s = FIRE_SPOTS[tries === 0 && fires.length === 0 ? 0 // engine catches first
      : Math.floor((Gref ? Gref.rng() : Math.random()) * FIRE_SPOTS.length)];
    if (!fires.some((f) => f.pos.x === s[0] && f.pos.z === s[1])) spot = s;
  }
  if (!spot) return null;
  const id = 'fire' + (++fireSeq);
  const holder = new THREE.Group();
  holder.position.set(spot[0], DECK_Y + 0.05, spot[1]);
  const cones = [];
  for (let i = 0; i < 3; i++) {
    const c = new THREE.Mesh(GEO.flame, i === 1 ? M.flameY : M.flameO);
    c.position.set((i - 1) * 0.16, 0.3, (i % 2) * 0.12 - 0.06);
    holder.add(c);
    cones.push(c);
  }
  group.add(holder);
  const fire = { id, pos: new THREE.Vector3(spot[0], DECK_Y, spot[1]), hp: 3, holder, cones, spreadT: 0 };
  fires.push(fire);
  Gref && Gref.emit('boat:fire', { fire });
  return fire;
}

function douse(id) {
  const i = fires.findIndex((f) => f.id === id);
  if (i < 0) return false;
  const fire = fires[i];
  fire.hp -= 1;
  fire.spreadT = 0; // being fought = not "unattended"
  spawnPuff(toWorld(fire.pos), 0xdddddd, 1.2, 0.8, 0.25, 0.7); // steam
  if (fire.hp <= 0) {
    group.remove(fire.holder);
    fires.splice(i, 1);
    Gref && Gref.emit('boat:repaired', { id });
  }
  return true;
}

// extinguish(fireId): the 🧯 pro tool — fully douses one fire in a single FOOSH.
// Reuses douse() (steam puff per hit); douse emits 'boat:repaired' exactly once,
// on the hit that kills the fire, so no extra emission is needed here.
function extinguish(id) {
  if (!fires.some((f) => f.id === id)) return false;
  for (let k = 0; k < 3; k++) if (!douse(id)) break; // fires start at hp 3
  return true;
}

// aim(dir): world direction -> cannon yaw/pitch (bots + auto-aim use this)
function cannonAim(dir) {
  if (!B || !dir) return;
  _a.copy(dir).normalize();
  const pitch = Math.asin(THREE.MathUtils.clamp(_a.y, -1, 1));
  // world yaw -> boat-local yaw (0 = straight over the bow)
  const worldYaw = Math.atan2(_a.x, _a.z);
  let local = worldYaw - B.heading;
  while (local > Math.PI) local -= Math.PI * 2;
  while (local < -Math.PI) local += Math.PI * 2;
  B.cannon.yaw = THREE.MathUtils.clamp(local, -2.4, 2.4);
  B.cannon.pitch = THREE.MathUtils.clamp(pitch, -0.15, 0.95);
}

function cannonFire() {
  if (!B || cannonCd > 0 || B.sinking) return false;
  const bolt = bolts.find((b) => !b.active);
  if (!bolt) return false;
  cannonCd = CANNON_COOLDOWN;
  recoil = 0.18;
  muzzle.getWorldPosition(_a);
  pitchPivot.getWorldDirection(_b); // +z of the pivot = barrel direction
  bolt.active = true;
  bolt.life = BOLT_LIFE;
  bolt.mesh.visible = true;
  bolt.mesh.position.copy(_a);
  bolt.vel.copy(_b).multiplyScalar(BOLT_SPEED);
  Gref && Gref.emit('cannon:fire', {});
  return true;
}

// clamp a boat-local point onto the walkable deck; onDeck=false if it left the deck rect
function deckBound(p) {
  const r = _dbRes;
  r.pos.copy(p);
  r.onDeck = Math.abs(p.x) <= WALK_X + 0.35 && Math.abs(p.z) <= WALK_Z + 0.35;
  r.pos.x = THREE.MathUtils.clamp(r.pos.x, -WALK_X, WALK_X);
  r.pos.z = THREE.MathUtils.clamp(r.pos.z, -WALK_Z, WALK_Z);
  for (const bl of BLOCKS) {
    if (r.pos.x > bl.x0 && r.pos.x < bl.x1 && r.pos.z > bl.z0 && r.pos.z < bl.z1) {
      // push out along the axis of least penetration
      const dx = r.pos.x - bl.x0 < bl.x1 - r.pos.x ? bl.x0 - r.pos.x : bl.x1 - r.pos.x;
      const dz = r.pos.z - bl.z0 < bl.z1 - r.pos.z ? bl.z0 - r.pos.z : bl.z1 - r.pos.z;
      if (Math.abs(dx) < Math.abs(dz)) r.pos.x += dx; else r.pos.z += dz;
    }
  }
  r.pos.y = DECK_Y;
  return r; // NOTE: shared object — copy pos if you keep it
}

// NOTE: both return shared temp vectors — copy the result if you keep it.
function toWorld(v) { return group.localToWorld(_twV.copy(v)); }
function toLocal(v) { return group.worldToLocal(_tlV.copy(v)); }

// ============================================================== RESET / SAVE
function clearHazards() {
  for (const l of leaks) group.remove(l.holder);
  leaks.length = 0;
  for (const f of fires) group.remove(f.holder);
  fires.length = 0;
  if (fireLight) fireLight.intensity = 0;
  for (const b of bolts) { b.active = false; b.mesh.visible = false; }
  for (const p of puffs) { p.active = false; p.mesh.visible = false; }
}

function resetFresh(G) {
  if (!B) return;
  clearHazards();
  B.hull.maxHp = maxHpFor(G);
  B.hull.hp = B.hull.maxHp;
  B.water = 0;
  B.sinking = false; sinkT = 0; sunkEmitted = false; rollKick = 0;
  B.throttle = 0; B.speed = 0;
  B.cannon.yaw = 0; B.cannon.pitch = 0.25;
  for (const st of B.stations) st.user = null;
  const hb = G.consts?.HARBOR || { x: 0, z: 60 };
  group.position.set(hb.x + 7.5, FLOAT_Y, hb.z - 52); // in open water beside the long dock (island beach reaches r~48)
  B.heading = Math.PI;                              // nose pointing out to sea
  group.rotation.set(0, B.heading, 0);
  B.tilt.pitch = 0; B.tilt.roll = 0;
  for (const p of props) { p.obj.position.set(p.homeX, DECK_Y + p.hh, p.homeZ); p.vel.set(0, 0, 0); }
  group.updateMatrixWorld();
}

function applySave(G, slice) {
  resetFresh(G);
  if (!slice) return;
  B.hull.hp = THREE.MathUtils.clamp(slice.hp ?? B.hull.maxHp, 1, B.hull.maxHp);
  B.water = THREE.MathUtils.clamp(slice.water ?? 0, 0, 0.95);
  if (typeof slice.x === 'number') group.position.x = slice.x;
  if (typeof slice.z === 'number') group.position.z = slice.z;
  if (typeof slice.heading === 'number') { B.heading = slice.heading; group.rotation.y = B.heading; }
  group.updateMatrixWorld();
}

function maxHpFor(G) {
  const lvl = THREE.MathUtils.clamp(G.upgrades?.hull || 1, 1, 3);
  return 100 + 50 * (lvl - 1); // 100 / 150 / 200
}

// ============================================================== UPDATE
export function update(G, dt) {
  if (!B) return;
  if (dt === 0) return; // paused/menu: freeze, ambient handled elsewhere
  syncUpgrades(G);

  if (B.sinking) { updateSinking(G, dt); group.updateMatrixWorld(); return; }

  readWheel(G, dt);
  readCannonInput(G, dt);
  moveBoat(G, dt);
  floatBoat(G, dt);
  group.updateMatrixWorld();

  updateLeaks(G, dt);
  updateFires(G, dt);
  updateWaterPlane();
  updateProps(G, dt);
  updateSmoke(G, dt);
  updateBolts(G, dt);
  updateLantern(G, dt);
  updateRadar(dt);
  updatePuffs(dt);

  if (B.hull.hp <= 0 || B.water >= 1) startSinking(G);
}

function syncUpgrades(G) {
  const m = maxHpFor(G);
  if (m !== B.hull.maxHp) {
    if (m > B.hull.maxHp) B.hull.hp += m - B.hull.maxHp; // upgrade also patches you up
    B.hull.maxHp = m;
    B.hull.hp = Math.min(B.hull.hp, m);
  }
}

function padFor(G, user) {
  if (!user || !user.human) return null;
  return user.idx === 0 ? G.input?.p1 : user.idx === 1 ? G.input?.p2 : null;
}

function readWheel(G, dt) {
  const user = wheelStation.user;
  const pad = padFor(G, user);
  if (!pad) return; // throttle persists when nobody steers
  const lvl = THREE.MathUtils.clamp(G.upgrades?.engine || 1, 1, 3);
  B.heading -= pad.x * TURN_RATE[lvl] * dt;
  B.throttle = THREE.MathUtils.clamp(B.throttle + -pad.z * 0.8 * dt, -REVERSE_FRAC, 1);
}

function readCannonInput(G, dt) {
  cannonCd = Math.max(0, cannonCd - dt);
  recoil = Math.max(0, recoil - dt * 0.8);
  const user = cannonStation.user;
  const pad = padFor(G, user);
  if (pad) {
    B.cannon.yaw = THREE.MathUtils.clamp(B.cannon.yaw + pad.x * 1.6 * dt, -2.4, 2.4);
    B.cannon.pitch = THREE.MathUtils.clamp(B.cannon.pitch + -pad.z * 1.2 * dt, -0.15, 0.95);
    if (pad.secondaryHit) cannonFire();
  }
  yawPivot.rotation.y = B.cannon.yaw;
  pitchPivot.rotation.x = -B.cannon.pitch;
  barrel.position.z = 0.6 - recoil;
}

function moveBoat(G, dt) {
  const lvl = THREE.MathUtils.clamp(G.upgrades?.engine || 1, 1, 3);
  const slow = 1 - 0.55 * B.water;                 // waterlogged = sluggish
  const target = B.throttle * MAX_SPEED[lvl] * slow;
  const d = THREE.MathUtils.clamp(target - B.speed, -ACCEL * dt, ACCEL * dt);
  B.speed += d;
  const p = group.position;
  p.x += Math.sin(B.heading) * B.speed * dt;
  p.z += Math.cos(B.heading) * B.speed * dt;
  // storm drift: waves shove the boat with the wind
  const w = G.weather;
  if (w && w.storm > 0 && w.wind && !B.moored) {
    const push = w.storm * (w.typhoon ? 1.2 : 0.6);
    p.x += (w.wind.x || 0) * push * dt;
    p.z += (w.wind.y || 0) * push * dt;
  }
  // moored check
  const hb = G.consts?.HARBOR || { x: 0, z: 60 };
  const distH = Math.hypot(p.x - hb.x, p.z - hb.z);
  B.moored = distH < HARBOR_MOOR_DIST && Math.abs(B.speed) < 0.5;
  // island collision: gentle radial pushback so the boat can't beach itself on the sand.
  // The island GROWS — world.js owns the number via G.island.radius (fallback = old 33).
  const ISLAND_R = (G.island?.radius ?? 31) + 2;
  if (distH < ISLAND_R) {
    const nx = (p.x - hb.x) / (distH || 1), nz = (p.z - hb.z) / (distH || 1);
    p.x = hb.x + nx * ISLAND_R;
    p.z = hb.z + nz * ISLAND_R;
    if (Math.abs(B.speed) > 2) { B.speed *= 0.3; G.sfx?.('creak'); }
  }
}

function heightAt(G, x, z) {
  const oc = G.ocean;
  return oc && oc.heightAt ? oc.heightAt(x, z) : 0;
}

function floatBoat(G, dt) {
  const p = group.position;
  const hb = G.consts?.HARBOR || { x: 0, z: 60 };
  const distH = Math.hypot(p.x - hb.x, p.z - hb.z);
  // harbor is sheltered: fade waves to 30% (visual only — we scale our own samples)
  let calm = 1;
  if (distH < HARBOR_CALM_DIST) {
    calm = THREE.MathUtils.lerp(0.3, 1, THREE.MathUtils.smoothstep(distH, HARBOR_MOOR_DIST, HARBOR_CALM_DIST));
  }
  const sh = Math.sin(B.heading), ch = Math.cos(B.heading);
  // sample points: bow, stern, port, starboard (rotated to world)
  const hBow = heightAt(G, p.x + sh * 6, p.z + ch * 6) * calm;
  const hSt = heightAt(G, p.x - sh * 6, p.z - ch * 6) * calm;
  const hPort = heightAt(G, p.x - ch * 2.5, p.z + sh * 2.5) * calm;
  const hStar = heightAt(G, p.x + ch * 2.5, p.z - sh * 2.5) * calm;

  let ty = (hBow + hSt + hPort + hStar) / 4 + FLOAT_Y - B.water * 0.85;
  let tPitch = -Math.atan2(hBow - hSt, 12);
  let tRoll = Math.atan2(hStar - hPort, 5);

  if (B.moored) {
    // gentle dock-side rest pose with a tiny bob
    mooredBobT += dt;
    ty = FLOAT_Y - B.water * 0.85 + Math.sin(mooredBobT * 1.2) * 0.05;
    tPitch = Math.sin(mooredBobT * 0.9) * 0.008;
    tRoll = Math.cos(mooredBobT * 1.1) * 0.012;
  }
  tRoll += rollKick;
  rollKick *= Math.max(0, 1 - dt * 2.2);

  const k = Math.min(1, dt * (B.moored ? 1.4 : 2.6));
  p.y += (ty - p.y) * k;
  B.tilt.pitch += (tPitch - B.tilt.pitch) * k;
  B.tilt.roll += (tRoll - B.tilt.roll) * k;
  group.rotation.y = B.heading;
  group.rotation.x = B.tilt.pitch;
  group.rotation.z = B.tilt.roll;
}

function updateLeaks(G, dt) {
  let filling = 0;
  for (const leak of leaks) {
    if (!leak.active) continue;
    filling++;
    leak.age += dt;
    // spray wobbles, puddle spreads
    const s = 0.8 + 0.35 * Math.sin(leak.age * 9);
    leak.spray.scale.set(s, 1 + 0.3 * Math.sin(leak.age * 7), s);
    const ps = Math.min(2.2, 0.3 + leak.age * 0.08);
    leak.puddle.scale.setScalar(ps);
  }
  if (filling > 0) B.water = Math.min(1, B.water + filling * LEAK_FILL * dt);
}

function updateFires(G, dt) {
  let burn = 0;
  for (const fire of fires) {
    burn += FIRE_DPS * dt;
    fire.spreadT += dt;
    const t = (G.time?.total || 0) * 10 + fire.pos.x * 3;
    for (let i = 0; i < fire.cones.length; i++) {
      const c = fire.cones[i];
      const f = 0.8 + 0.3 * Math.sin(t + i * 2.1);
      c.scale.set(f, f * (1 + 0.25 * Math.sin(t * 1.3 + i)), f);
    }
    if (fire.spreadT >= FIRE_SPREAD_SEC && fires.length < FIRE_MAX) {
      fire.spreadT = 0;
      addFire();
    }
  }
  // shared fire light: centroid of active fires, flickering; off when no fires
  if (fires.length > 0) {
    let cx = 0, cz = 0;
    for (const f of fires) { cx += f.pos.x; cz += f.pos.z; }
    cx /= fires.length; cz /= fires.length;
    fireLight.position.set(cx, DECK_Y + 0.65, cz);
    const tl = (G.time?.total || 0) * 10;
    fireLight.intensity = 1.4 * Math.min(fires.length, 2) * (0.8 + 0.35 * Math.sin(tl * 1.7));
  } else {
    fireLight.intensity = 0;
  }
  if (burn > 0) {
    fireDmgAcc += burn;
    if (fireDmgAcc >= 2) { const n = Math.floor(fireDmgAcc); fireDmgAcc -= n; damage(n, 'fire'); }
  }
}
let fireDmgAcc = 0;

function updateWaterPlane() {
  const w = B.water;
  waterPlane.visible = w > 0.01;
  if (!waterPlane.visible) return;
  const h = Math.max(0.02, w * 1.3);
  waterPlane.scale.y = h;
  waterPlane.position.y = -0.5 + h / 2 + 0.55; // from the bilge up toward the deck
}

function updateProps(G, dt) {
  // tail-slam wash: one-shot kick from threats.js (washSeq counter + world-space washImpulse)
  const seq = G.flags?.washSeq;
  if (seq != null && seq !== lastWashSeq) {
    lastWashSeq = seq;
    const w = G.flags?.washImpulse;
    if (w) {
      const h = B.heading;
      const lx = w.x * Math.cos(h) - w.z * Math.sin(h);
      const lz = w.x * Math.sin(h) + w.z * Math.cos(h);
      let ax = lx * 0.8, az = lz * 0.8;
      const asp = Math.hypot(ax, az);
      if (asp > 4) { ax *= 4 / asp; az *= 4 / asp; }
      for (const pr of props) { pr.vel.x += ax; pr.vel.z += az; }
    }
  }
  const tilt = Math.abs(B.tilt.pitch) + Math.abs(B.tilt.roll);
  const sliding = tilt > PROP_SLIDE_TILT;
  for (const pr of props) {
    const v = pr.vel, pos = pr.obj.position;
    if (sliding) {
      v.x += -Math.sin(B.tilt.roll) * 7 * dt;   // downhill
      v.z += Math.sin(B.tilt.pitch) * 7 * dt;
    }
    const damp = Math.max(0, 1 - (sliding ? 1.2 : 4.5) * dt);
    v.x *= damp; v.z *= damp;
    const sp = Math.hypot(v.x, v.z);
    if (sp > 4) { v.x *= 4 / sp; v.z *= 4 / sp; }
    if (sp < 0.01 && !sliding) { v.x = 0; v.z = 0; continue; }
    pos.x += v.x * dt;
    pos.z += v.z * dt;
    // bounce off railings
    if (pos.x > WALK_X) { pos.x = WALK_X; v.x *= -0.5; }
    if (pos.x < -WALK_X) { pos.x = -WALK_X; v.x *= -0.5; }
    if (pos.z > WALK_Z) { pos.z = WALK_Z; v.z *= -0.5; }
    if (pos.z < -WALK_Z) { pos.z = -WALK_Z; v.z *= -0.5; }
    // bounce off the console / engine blocks
    for (const bl of BLOCKS) {
      if (pos.x > bl.x0 - 0.2 && pos.x < bl.x1 + 0.2 && pos.z > bl.z0 - 0.2 && pos.z < bl.z1 + 0.2) {
        const dx = pos.x - (bl.x0 + bl.x1) / 2, dz = pos.z - (bl.z0 + bl.z1) / 2;
        if (Math.abs(dx) > Math.abs(dz)) { pos.x += Math.sign(dx) * 0.15; v.x *= -0.5; }
        else { pos.z += Math.sign(dz) * 0.15; v.z *= -0.5; }
      }
    }
    pr.obj.rotation.y += sp * dt * 1.5; // little spin while sliding = funnier
  }
}

function updateSmoke(G, dt) {
  if (B.throttle <= 0.05) return;
  smokeT -= dt;
  if (smokeT <= 0) {
    smokeT = 0.45 / Math.max(0.2, B.throttle);
    stackTip.getWorldPosition(_c);
    spawnPuff(_c, 0x9aa2a8, 1.4, 1.1, 0.18, 0.75);
  }
}

function updateBolts(G, dt) {
  const targets = G.flags?.cannonTargets;
  const harpoonLvl = THREE.MathUtils.clamp(G.upgrades?.harpoon || 1, 1, 3);
  for (const bolt of bolts) {
    if (!bolt.active) continue;
    bolt.life -= dt;
    bolt.vel.y -= BOLT_GRAV * dt;
    const m = bolt.mesh;
    m.position.x += bolt.vel.x * dt;
    m.position.y += bolt.vel.y * dt;
    m.position.z += bolt.vel.z * dt;
    // point along velocity (cylinder Y-axis)
    _a.copy(bolt.vel).normalize();
    m.quaternion.setFromUnitVectors(_b.set(0, 1, 0), _a);
    let dead = bolt.life <= 0;
    // hit a monster?
    if (!dead && targets && targets.length) {
      for (const t of targets) {
        if (!t || !t.obj) continue;
        const tp = t.obj.isVector3 ? t.obj : t.obj.position;
        if (!tp) continue;
        const r = t.radius || 2;
        if (m.position.distanceToSquared(tp) < r * r) {
          if (typeof t.onHit === 'function') t.onHit(1 * harpoonLvl);
          spawnPuff(m.position, 0xffffff, 0.5, 0.6, 0.2, 0.6);
          dead = true;
          break;
        }
      }
    }
    // splash into the sea
    if (!dead && m.position.y < heightAt(G, m.position.x, m.position.z)) {
      spawnPuff(m.position, 0xd8f0ff, 0.7, 0.9, 0.25, 0.9);
      G.sfx && G.sfx('splash');
      dead = true;
    }
    if (dead) { bolt.active = false; m.visible = false; }
  }
}

function updateLantern(G, dt) {
  const want = G.time?.phase === 'night' ? 1.8 : 0;
  lantern.intensity += (want - lantern.intensity) * Math.min(1, dt * 2);
}

function updateRadar(dt) {
  radarBar.rotation.y += dt * 1.6; // roof radar sweeps slowly, forever
}

// ---------------------------------------------------------------- puffs (smoke/steam/splash/bubbles)
function spawnPuff(worldPos, color, rise, life, s0, s1) {
  const p = puffs.find((q) => !q.active);
  if (!p) return;
  p.active = true;
  p.mesh.visible = true;
  p.mesh.position.copy(worldPos);
  p.mat.color.setHex(color);
  p.mat.opacity = 0.75;
  p.rise = rise; p.life = life; p.maxLife = life; p.s0 = s0; p.s1 = s1;
  p.mesh.scale.setScalar(s0);
}

function updatePuffs(dt) {
  for (const p of puffs) {
    if (!p.active) continue;
    p.life -= dt;
    if (p.life <= 0) { p.active = false; p.mesh.visible = false; continue; }
    const t = 1 - p.life / p.maxLife;
    p.mesh.position.y += p.rise * dt;
    p.mesh.scale.setScalar(p.s0 + (p.s1 - p.s0) * t);
    p.mat.opacity = 0.75 * (1 - t);
  }
}

// ---------------------------------------------------------------- sinking
function startSinking(G) {
  if (B.sinking) return;
  B.sinking = true;
  sinkT = 0;
  sunkEmitted = false;
  G.emit('boat:sinking', {});
}

function updateSinking(G, dt) {
  sinkT += dt;
  const t = Math.min(1, sinkT / SINK_SEC);
  // list over and go down — slapstick, no drama
  B.tilt.roll += (0.9 - B.tilt.roll) * Math.min(1, dt * 1.5);
  B.tilt.pitch += (0.25 - B.tilt.pitch) * Math.min(1, dt * 1.5);
  group.rotation.x = B.tilt.pitch;
  group.rotation.z = B.tilt.roll;
  group.position.y -= dt * (0.6 + t * 1.2);
  B.water = 1;
  bubbleT -= dt;
  if (bubbleT <= 0) {
    bubbleT = 0.12;
    _a.set((G.rng() - 0.5) * 5, 0.3, (G.rng() - 0.5) * 12);
    spawnPuff(toWorld(_a), 0xeaf6ff, 1.6, 1.0, 0.15, 0.6);
  }
  updatePuffs(dt);
  if (t >= 1 && !sunkEmitted) {
    sunkEmitted = true;
    G.emit('boat:sunk', {});
  }
}
