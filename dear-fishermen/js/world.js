// Dear Fishermen — world.js
// Owns: ocean (analytic waves + visual mesh), sky/day-night, weather (storm,
// rain, lightning, wind), zones, cursed-fog visuals, and the harbor island.
// Fills: G.ocean, G.weather, G.zoneAt. Emits: 'lightning'. Listens: 'game:new',
// 'game:continue'.
import * as THREE from '../lib/three.module.min.js';

let G = null;

// ------------------------------------------------------------- tunables
const OCEAN_SIZE = 500;
const OCEAN_SEG = 88;          // 89x89 = 7921 verts — smooth enough, iPad-safe
const FAR_RADIUS = 2300;
const SKY_RADIUS = 820;
const RAIN_COUNT = 600;
const RAIN_BOX = 140;          // xz extent around boat
const RAIN_HEIGHT = 70;
const WISP_COUNT = 8;
const BUOY_COUNT = 6;
const HARBOR_CALM_NEAR = 40;   // waves damped close to the dock
const HARBOR_CALM_FAR = 150;

// Directional wave set (Gerstner-ish sum of sines). amp values are relative
// weights; the whole thing is scaled by the storm-driven amplitude.
const WAVES = [
  { dx: 1.0, dz: 0.35, len: 34.0, speed: 1.05, amp: 0.55 },
  { dx: -0.7, dz: 1.0, len: 21.0, speed: 1.65, amp: 0.30 },
  { dx: 0.45, dz: -0.9, len: 12.5, speed: 2.30, amp: 0.17 },
  { dx: -0.2, dz: -1.0, len: 6.5, speed: 3.10, amp: 0.09 },
];
for (const w of WAVES) { // precompute wave vectors (k = 2pi/len along dir)
  const d = Math.hypot(w.dx, w.dz), k = (Math.PI * 2) / w.len;
  w.kx = (w.dx / d) * k; w.kz = (w.dz / d) * k;
}

// Sky color over dayFrac (0=dawn, 0.25=noon, 0.5=dusk, 0.75=midnight).
const SKY_STOPS = [
  [0.00, 0xffb45e], // dawn gold
  [0.07, 0xffd489],
  [0.16, 0x53b6f2], // bright day blue
  [0.38, 0x3fa7ee],
  [0.46, 0xff9950], // sunset orange
  [0.52, 0x4a3260], // dusk purple
  [0.60, 0x0b1533], // deep navy night (creepy but readable)
  [0.90, 0x080f28],
  [0.97, 0x243056], // pre-dawn
  [1.00, 0xffb45e],
];

// ------------------------------------------------------------- module state
let HARBOR = { x: 0, z: 60 };
let oceanAmp = 0.8;            // current effective wave amplitude (storm-driven)
let typhoonMix = 0;            // smoothed 0..1 typhoon boost
let flashI = 0;                // lightning flash intensity (decays)
let boltTimer = 4;             // countdown to next auto lightning
let wispFade = 0;              // cursed-fog visuals fade 0..1
let windAngle = 0.4;
let firstFrame = true;

// three objects
let oceanMesh, oceanGeo, oceanBaseX, oceanBaseZ, farDisc, farMat;
let skyGroup, sunMesh, moonMesh, starPoints, starMat;
let hemiLight, dirLight, flashLight;
let rainPoints, rainMat, rainPos;
let wispGroup, wispOrbs = [], wispLights = [], wispMat;
let beamGroup, beamMat, windowMat, hutLight, lampMat;
let buoys = [];
let lastOceanT = -1, lastCX = 1e9, lastCZ = 1e9;

// temps (no per-frame allocations)
const tmpC1 = new THREE.Color();
const tmpC2 = new THREE.Color();
const skyColor = new THREE.Color(0x53b6f2);
const fogTargetC = new THREE.Color(0x9fd4ef);
const C_STORM_SKY = new THREE.Color(0x39424d);
const C_CURSE_SKY = new THREE.Color(0x1c3a26);
const C_CURSE_FOG = new THREE.Color(0x3fae62);
const C_FOG_HAZE = new THREE.Color(0xffffff);
const C_FAR_DAY = new THREE.Color(0x1a5f96);
const C_FAR_NIGHT = new THREE.Color(0x081832);
const C_FAR_STORM = new THREE.Color(0x24333d);
const C_GROUND_DAY = new THREE.Color(0x27506b);
const C_GROUND_NIGHT = new THREE.Color(0x0a1626);
const C_SUN_WARM = new THREE.Color(0xfff0cf);
const C_SUN_LOW = new THREE.Color(0xffa04d);
const C_MOON = new THREE.Color(0x93aeff);
const C_LAMP_DAY = new THREE.Color(0xcfc9b8);
const C_LAMP_NIGHT = new THREE.Color(0xffd873);

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function ss(a, b, x) { x = clamp01((x - a) / (b - a)); return x * x * (3 - 2 * x); }
function lerp(a, b, t) { return a + (b - a) * t; }

// ------------------------------------------------------------- analytic ocean
function heightAt(x, z) {
  const t = G?.time?.total ?? 0;
  let h = 0;
  for (let i = 0; i < WAVES.length; i++) {
    const w = WAVES[i];
    const ph = x * w.kx + z * w.kz + t * w.speed;
    // slight second harmonic sharpens crests a bit (choppy look)
    h += w.amp * (Math.sin(ph) + 0.24 * Math.sin(ph * 2.17 + 1.3));
  }
  // calm pocket around the harbor so mooring/shop time isn't a rodeo
  const dx = x - HARBOR.x, dz = z - HARBOR.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  const damp = 0.2 + 0.8 * ss(HARBOR_CALM_NEAR, HARBOR_CALM_FAR, d);
  return h * oceanAmp * damp;
}

const NRM_EPS = 0.55;
function normalAt(x, z, out) {
  const v = out || new THREE.Vector3();
  const hl = heightAt(x - NRM_EPS, z), hr = heightAt(x + NRM_EPS, z);
  const hd = heightAt(x, z - NRM_EPS), hu = heightAt(x, z + NRM_EPS);
  return v.set(hl - hr, 2 * NRM_EPS, hd - hu).normalize();
}

function floorAt(x, z) {
  const dx = x - HARBOR.x, dz = z - HARBOR.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  // beach ~-3 at the island, ~-12 along the coast, down to ~-30 in the deep
  let depth = -3 - 9 * ss(15, 70, d) - 18 * ss(220, 560, d);
  depth += Math.sin(x * 0.05) * Math.cos(z * 0.043) * 1.8 * ss(30, 90, d);
  return depth;
}

function zoneAt(x, z) {
  if (x < -260 && z < -260) return 'fog'; // cursed north-west quadrant
  const dx = x - HARBOR.x, dz = z - HARBOR.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d < 70) return 'harbor';
  if (d < 220) return 'coast';
  if (d < 520) return 'open';
  return 'deep';
}

// ------------------------------------------------------------- weather
function lightning() {
  flashI = 2.6;
  G?.emit?.('lightning', {});
}

function resetWeather() {
  const w = G.weather;
  w.storm = 0; w.stormTarget = 0; w.typhoon = false;
  oceanAmp = 0.8; typhoonMix = 0; flashI = 0; boltTimer = 5;
}

// ------------------------------------------------------------- init helpers
function toon(color, extra) {
  return new THREE.MeshToonMaterial(Object.assign({ color }, extra));
}

function buildOcean(scene) {
  oceanGeo = new THREE.PlaneGeometry(OCEAN_SIZE, OCEAN_SIZE, OCEAN_SEG, OCEAN_SEG);
  oceanGeo.rotateX(-Math.PI / 2);
  const pos = oceanGeo.attributes.position;
  const n = pos.count;
  oceanBaseX = new Float32Array(n);
  oceanBaseZ = new Float32Array(n);
  for (let i = 0; i < n; i++) { oceanBaseX[i] = pos.getX(i); oceanBaseZ[i] = pos.getZ(i); }
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { colors[i * 3] = 0.16; colors[i * 3 + 1] = 0.55; colors[i * 3 + 2] = 0.85; }
  oceanGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshToonMaterial({
    color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.94,
  });
  oceanMesh = new THREE.Mesh(oceanGeo, mat);
  oceanMesh.frustumCulled = false; // it's always under the camera
  scene.add(oceanMesh);

  const farGeo = new THREE.CircleGeometry(FAR_RADIUS, 40);
  farGeo.rotateX(-Math.PI / 2);
  farMat = new THREE.MeshBasicMaterial({ color: 0x1a5f96 });
  farDisc = new THREE.Mesh(farGeo, farMat);
  farDisc.position.y = -1.4;
  farDisc.frustumCulled = false;
  scene.add(farDisc);
}

function buildSky(scene) {
  scene.background = skyColor;
  scene.fog = new THREE.Fog(0x9fd4ef, 140, 1000);

  skyGroup = new THREE.Group();
  scene.add(skyGroup);

  sunMesh = new THREE.Mesh(
    new THREE.SphereGeometry(30, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xffd94f, fog: false }));
  skyGroup.add(sunMesh);
  moonMesh = new THREE.Mesh(
    new THREE.SphereGeometry(21, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xdfe8ff, fog: false }));
  skyGroup.add(moonMesh);

  const starN = 380;
  const sp = new Float32Array(starN * 3);
  for (let i = 0; i < starN; i++) {
    const a = Math.random() * Math.PI * 2;
    const y = 0.12 + 0.88 * Math.random();
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    sp[i * 3] = Math.cos(a) * r * SKY_RADIUS;
    sp[i * 3 + 1] = y * SKY_RADIUS;
    sp[i * 3 + 2] = Math.sin(a) * r * SKY_RADIUS;
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  starMat = new THREE.PointsMaterial({
    color: 0xeef4ff, size: 2, sizeAttenuation: false,
    transparent: true, opacity: 0, fog: false, depthWrite: false,
  });
  starPoints = new THREE.Points(sg, starMat);
  starPoints.frustumCulled = false;
  skyGroup.add(starPoints);

  hemiLight = new THREE.HemisphereLight(0xbfe3ff, 0x27506b, 0.8);
  scene.add(hemiLight);
  dirLight = new THREE.DirectionalLight(0xfff0cf, 1.0);
  scene.add(dirLight);
  scene.add(dirLight.target);
  flashLight = new THREE.AmbientLight(0xd8e6ff, 0);
  scene.add(flashLight);
}

function buildRain(scene) {
  rainPos = new Float32Array(RAIN_COUNT * 3);
  for (let i = 0; i < RAIN_COUNT; i++) {
    rainPos[i * 3] = (Math.random() * 2 - 1) * RAIN_BOX * 0.5;
    rainPos[i * 3 + 1] = Math.random() * RAIN_HEIGHT;
    rainPos[i * 3 + 2] = (Math.random() * 2 - 1) * RAIN_BOX * 0.5;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  rainMat = new THREE.PointsMaterial({
    color: 0xa9c4de, size: 1.7, sizeAttenuation: false,
    transparent: true, opacity: 0, depthWrite: false,
  });
  rainPoints = new THREE.Points(g, rainMat);
  rainPoints.frustumCulled = false;
  rainPoints.visible = false;
  scene.add(rainPoints);
}

function buildWisps(scene) {
  wispGroup = new THREE.Group();
  wispGroup.visible = false;
  scene.add(wispGroup);
  const orbGeo = new THREE.SphereGeometry(0.55, 8, 6);
  wispMat = new THREE.MeshBasicMaterial({
    color: 0x7dff9e, transparent: true, opacity: 0, fog: false, depthWrite: false,
  });
  for (let i = 0; i < WISP_COUNT; i++) {
    const orb = new THREE.Mesh(orbGeo, wispMat);
    wispGroup.add(orb);
    wispOrbs.push(orb);
  }
  for (let i = 0; i < 2; i++) {
    const l = new THREE.PointLight(0x59ff87, 0, 60);
    wispGroup.add(l);
    wispLights.push(l);
  }
}

function buildHarbor(scene) {
  const h = new THREE.Group();
  h.position.set(HARBOR.x, 0, HARBOR.z);
  scene.add(h);

  const sand = toon(0xf0d98c);
  const wood = toon(0xa9713d);
  const woodDark = toon(0x7d5228);

  // island mound + grass top
  const mound = new THREE.Mesh(new THREE.CylinderGeometry(19, 30, 7, 12), sand);
  mound.position.y = -1.0;
  h.add(mound);
  const grass = new THREE.Mesh(new THREE.CylinderGeometry(15, 18.5, 1.6, 12), toon(0x6cc24a));
  grass.position.y = 2.6;
  h.add(grass);

  // dock: planks marching toward the open sea (-z), on posts
  const plankGeo = new THREE.BoxGeometry(6, 0.5, 2.1);
  for (let i = 0; i < 10; i++) {
    const p = new THREE.Mesh(plankGeo, i % 2 ? wood : woodDark);
    p.position.set(0, 2.1, -22 - i * 2.5);
    p.rotation.y = (i % 3 - 1) * 0.02; // slightly wonky planks, on purpose
    h.add(p);
  }
  const postGeo = new THREE.CylinderGeometry(0.45, 0.5, 7, 7);
  for (let i = 0; i < 3; i++) {
    for (const sx of [-2.6, 2.6]) {
      const post = new THREE.Mesh(postGeo, woodDark);
      post.position.set(sx, -1.0, -24 - i * 10);
      h.add(post);
    }
  }
  // mooring bollards at the dock end
  const bollGeo = new THREE.CylinderGeometry(0.5, 0.6, 1.5, 8);
  for (const sx of [-2.4, 2.4]) {
    const b = new THREE.Mesh(bollGeo, toon(0x394b59));
    b.position.set(sx, 3.0, -45);
    h.add(b);
  }

  // harbor hut with a warm little window (glows at night)
  const hut = new THREE.Group();
  hut.position.set(-8, 3.4, 8);
  const walls = new THREE.Mesh(new THREE.BoxGeometry(7, 5, 6), toon(0xd9583b));
  walls.position.y = 2.5;
  hut.add(walls);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(5.8, 3.2, 4), toon(0x5b8bb0));
  roof.position.y = 6.6; roof.rotation.y = Math.PI / 4;
  hut.add(roof);
  windowMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.25 });
  const win = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7), windowMat);
  win.position.set(0, 2.6, -3.05); win.rotation.y = Math.PI;
  hut.add(win);
  hutLight = new THREE.PointLight(0xffc36b, 0, 40);
  hutLight.position.set(0, 3, -4.5);
  hut.add(hutLight);
  h.add(hut);

  // lighthouse with rotating night beam
  const lh = new THREE.Group();
  lh.position.set(10, 2.8, 9);
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.8, 15, 10), toon(0xf5f1e6));
  tower.position.y = 7.5;
  lh.add(tower);
  const stripeGeo = new THREE.CylinderGeometry(2.45, 2.45, 1.7, 10);
  const red = toon(0xe5484d);
  for (const sy of [4.5, 10.5]) {
    const s = new THREE.Mesh(stripeGeo, red);
    s.position.y = sy;
    lh.add(s);
  }
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 2.2, 8),
    new THREE.MeshBasicMaterial({ color: 0xfff2b0 }));
  lamp.position.y = 16.1;
  lh.add(lamp);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(2.1, 2.2, 8), red);
  cap.position.y = 18.3;
  lh.add(cap);
  beamGroup = new THREE.Group();
  beamGroup.position.y = 16.1;
  const beamGeo = new THREE.ConeGeometry(8, 70, 10, 1, true);
  beamGeo.translate(0, -35, 0);   // apex at the lamp
  beamGeo.rotateX(Math.PI / 2);   // shine outward along -z
  beamMat = new THREE.MeshBasicMaterial({
    color: 0xffe9a0, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
    side: THREE.DoubleSide, fog: false,
  });
  const beamA = new THREE.Mesh(beamGeo, beamMat);
  const beamB = new THREE.Mesh(beamGeo, beamMat);
  beamB.rotation.y = Math.PI;
  beamGroup.add(beamA); beamGroup.add(beamB);
  lh.add(beamGroup);
  h.add(lh);

  // palm-ish trees
  const trunkGeo = new THREE.CylinderGeometry(0.45, 0.7, 7, 7);
  const trunkMat = toon(0xa9713d);
  const leafGeo = new THREE.ConeGeometry(3.2, 1.4, 6);
  const leafMat = toon(0x3bb273);
  const palmSpots = [[-13, -2, 0.22], [5, 14, -0.18], [14, -4, 0.12]];
  for (const [px, pz, tilt] of palmSpots) {
    const tr = new THREE.Mesh(trunkGeo, trunkMat);
    tr.position.set(px, 6, pz); tr.rotation.z = tilt;
    h.add(tr);
    const top = new THREE.Mesh(leafGeo, leafMat);
    top.position.set(px - Math.sin(tilt) * 7, 9.6, pz);
    top.scale.y = 1.6;
    h.add(top);
    const top2 = new THREE.Mesh(leafGeo, leafMat);
    top2.position.set(px - Math.sin(tilt) * 7, 10.7, pz);
    top2.scale.set(0.62, 1.1, 0.62);
    h.add(top2);
  }

  // buoys marking the coast/open border (dist 220 from harbor)
  const buoyGeo = new THREE.CylinderGeometry(0.9, 1.3, 2.2, 8);
  const buoyTopGeo = new THREE.CylinderGeometry(0.16, 0.16, 2.4, 5);
  const buoyMat = toon(0xff7043);
  const buoyPoleMat = toon(0xfff8ea);
  for (let i = 0; i < BUOY_COUNT; i++) {
    const a = (i / BUOY_COUNT) * Math.PI * 2 + 0.35 + (i % 2) * 0.22;
    const bx = HARBOR.x + Math.cos(a) * 220;
    const bz = HARBOR.z + Math.sin(a) * 220;
    const bg = new THREE.Group();
    bg.position.set(bx, 0, bz);
    const body = new THREE.Mesh(buoyGeo, buoyMat);
    body.position.y = 0.6;
    bg.add(body);
    const pole = new THREE.Mesh(buoyTopGeo, buoyPoleMat);
    pole.position.y = 2.4;
    bg.add(pole);
    scene.add(bg);
    buoys.push({ g: bg, x: bx, z: bz, phase: i * 1.7 });
  }

  buildVillage(h, wood, woodDark);
}

// ---------------------------------------------- fishing village (Islands update)
// Cheap analytic island surface matching the mound + grass cylinders (world coords).
function islandGroundY(x, z) {
  const dx = x - HARBOR.x, dz = z - HARBOR.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d < 15) return 3.4;                         // grass top
  if (d < 19) return 3.4 - 0.9 * ((d - 15) / 4);  // grass rim down to the sand ring
  if (d < 30) return 2.5 - 7.0 * ((d - 19) / 11); // beach slope into the sea
  return -4.5;                                    // underwater — off the island
}

function buildVillage(h, wood, woodDark) {
  const dummy = new THREE.Object3D();
  const gy = (lx, lz) => islandGroundY(HARBOR.x + lx, HARBOR.z + lz);
  const M = (x, y, z, ry = 0, s = null, rx = 0, rz = 0) => {
    dummy.position.set(x, y, z);
    dummy.rotation.set(rx, ry, rz);
    if (s) dummy.scale.set(s[0], s[1], s[2]); else dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    return dummy.matrix.clone();
  };
  const inst = (parent, geo, mat, mats) => {
    const im = new THREE.InstancedMesh(geo, mat, mats.length);
    for (let i = 0; i < mats.length; i++) im.setMatrixAt(i, mats[i]);
    im.computeBoundingSphere?.();
    parent.add(im);
    return im;
  };
  const white = toon(0xf6f2e8);
  const blue = toon(0x5b7fb8);
  const postM = []; // every wooden pole in the village shares ONE instanced mesh

  // --- 3 cottages in a half-circle facing the dock (windows reuse windowMat → night glow, no lights)
  const wallGeo = new THREE.BoxGeometry(4.6, 3.2, 4.0);
  const cRoofGeo = new THREE.ConeGeometry(3.6, 2.4, 4);
  const roofMat = toon(0x6b4a33);
  const doorM = [], winM = [], wboxM = [], chimM = [];
  for (const [cx, cz, ry, mat] of [
    [-9, -8, -0.3, toon(0xc94f43)],   // red
    [0.5, -10.5, 0.05, toon(0xd9a441)], // ochre
    [9, -7.5, 0.35, blue],            // blue
  ]) {
    const walls = new THREE.Mesh(wallGeo, mat);
    walls.position.set(cx, 5.0, cz); walls.rotation.y = ry;
    h.add(walls);
    const roof = new THREE.Mesh(cRoofGeo, roofMat);
    roof.position.set(cx, 7.8, cz); roof.rotation.y = ry + Math.PI / 4;
    h.add(roof);
    const hm = M(cx, 3.4, cz, ry); // cottage frame on the grass
    doorM.push(M(-0.85, 1.0, -2.06).premultiply(hm));
    winM.push(M(1.2, 2.1, -2.02, Math.PI).premultiply(hm));
    wboxM.push(M(1.2, 1.42, -2.22).premultiply(hm));
    chimM.push(M(-1.3, 4.1, 0.8).premultiply(hm));
  }
  inst(h, new THREE.BoxGeometry(1.1, 2.0, 0.16), white, doorM);
  inst(h, new THREE.PlaneGeometry(1.15, 1.15), windowMat, winM);
  inst(h, new THREE.BoxGeometry(1.5, 0.34, 0.4), white, wboxM);
  inst(h, new THREE.BoxGeometry(0.7, 1.4, 0.7), woodDark, chimM);

  // --- market stall near the dock (striped awning + crate of fish)
  const stall = new THREE.Group();
  stall.position.set(6.2, gy(6.2, -16.5), -16.5);
  stall.rotation.y = 0.5;
  h.add(stall);
  const counter = new THREE.Mesh(new THREE.BoxGeometry(3.0, 1.0, 1.2), wood);
  counter.position.y = 0.5;
  stall.add(counter);
  const crate = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 0.7), woodDark);
  crate.position.set(0.2, 1.25, 0.05); crate.rotation.y = 0.15;
  stall.add(crate);
  const awnGeo = new THREE.BoxGeometry(0.82, 0.08, 1.8);
  const awnRed = [], awnCream = [];
  for (let i = 0; i < 4; i++) {
    (i % 2 ? awnCream : awnRed).push(M(-1.23 + i * 0.82, 2.55, 0.15, 0, null, 0.18));
  }
  inst(stall, awnGeo, toon(0xe5484d), awnRed);
  inst(stall, awnGeo, white, awnCream);
  const stallM = M(6.2, gy(6.2, -16.5), -16.5, 0.5);
  postM.push(
    M(-1.35, 1.3, -0.5, 0, [0.8, 2.6, 0.8]).premultiply(stallM),
    M(1.35, 1.3, -0.5, 0, [0.8, 2.6, 0.8]).premultiply(stallM));

  // --- fish shapes: 3 in the stall crate + 4 on the drying rack (one instanced mesh)
  const fishMat = toon(0x9fb7c4);
  const fishM = [
    M(0.05, 1.58, -0.02, 0.4, [1.5, 0.5, 0.65]).premultiply(stallM),
    M(0.35, 1.58, 0.12, -0.5, [1.5, 0.5, 0.65]).premultiply(stallM),
    M(0.15, 1.7, 0.03, 1.2, [1.4, 0.45, 0.6]).premultiply(stallM),
  ];
  postM.push(M(-5.6, 4.5, -4.5, 0, [0.8, 2.2, 0.8]), M(-3.4, 4.5, -4.5, 0, [0.8, 2.2, 0.8]));
  const bar = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.14, 0.14), woodDark);
  bar.position.set(-4.5, 5.45, -4.5);
  h.add(bar);
  for (let i = 0; i < 4; i++) {
    fishM.push(M(-5.25 + i * 0.5, 4.98, -4.5, 0.3 * (i % 2), [0.55, 1.35, 0.4]));
  }
  inst(h, new THREE.SphereGeometry(0.34, 6, 5), fishMat, fishM);

  // --- winding sand path: dock start → cottages (instanced flat patches)
  const PATH = [
    [0, -19.4, 0.1], [-0.8, -17.2, -0.3], [-0.3, -15.0, 0.25], [0.8, -13.0, 0.15],
    [0.3, -11.0, -0.1], [-3.2, -9.6, 0.5], [-6.3, -8.6, 0.3], [4.6, -9.0, -0.5], [7.2, -8.2, -0.3],
  ];
  inst(h, new THREE.BoxGeometry(2.3, 0.14, 1.7), toon(0xf7e7ae),
    PATH.map(([x, z, ry]) => M(x, gy(x, z) + 0.07, z, ry)));

  // --- 4 lamp posts along the path (glow-material heads, no extra lights)
  lampMat = new THREE.MeshBasicMaterial({ color: 0xcfc9b8 });
  const lampM = [];
  for (const [x, z] of [[-2.2, -17.5], [2.2, -13.5], [-2.6, -10.8], [3.4, -9.0]]) {
    const y = gy(x, z);
    postM.push(M(x, y + 1.6, z, 0, [0.85, 3.2, 0.85]));
    lampM.push(M(x, y + 3.4, z));
  }
  inst(h, new THREE.SphereGeometry(0.34, 8, 6), lampMat, lampM);

  // --- rope fence along both dock edges (posts + sagging Line rope)
  const ropeMat = new THREE.LineBasicMaterial({ color: 0xd9c08a });
  for (const sx of [-2.75, 2.75]) {
    const zs = [-23, -30, -37, -44];
    const pts = [];
    for (let i = 0; i < zs.length; i++) {
      postM.push(M(sx, 2.9, zs[i], 0, [0.8, 1.1, 0.8]));
      pts.push(new THREE.Vector3(sx, 3.38, zs[i]));
      if (i < zs.length - 1) pts.push(new THREE.Vector3(sx, 3.08, (zs[i] + zs[i + 1]) / 2));
    }
    h.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), ropeMat));
  }

  // --- beached rowboat on the sand
  const row = new THREE.Group();
  row.position.set(-13, gy(-13, -14) + 0.35, -14);
  row.rotation.set(0.06, 0.7, 0.08);
  h.add(row);
  row.add(new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.8, 1.5), blue));
  const bench = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 1.3), wood);
  bench.position.set(0.3, 0.42, 0);
  row.add(bench);

  // --- 2 barrel clusters
  inst(h, new THREE.CylinderGeometry(0.5, 0.55, 1.1, 8), woodDark, [
    [-3.9, -16.1], [-3.1, -16.9], [-3.6, -15.4], [8.5, -13.3], [9.3, -13.9], [8.8, -14.6],
  ].map(([x, z], i) => M(x, gy(x, z) + 0.55, z, i * 0.9)));

  // --- scattered flowers on the grass (instanced, per-instance colors)
  const petals = [0xff8fb3, 0xffd23e, 0xf6f2e8, 0xb48cff];
  const AVOID = [
    [-9, -8, 3.4], [0.5, -10.5, 3.4], [9, -7.5, 3.4],   // cottages
    [-8, 8, 4.6], [10, 9, 3.6], [-4.5, -4.5, 2.2],      // hut, lighthouse, rack
    ...PATH.map(([x, z]) => [x, z, 1.7]),
  ];
  const flowers = new THREE.InstancedMesh(new THREE.SphereGeometry(0.18, 6, 5), toon(0xffffff), 20);
  let fi = 0, guard = 0;
  while (fi < 20 && guard++ < 300) {
    const a = G.rng() * Math.PI * 2, r = 4.5 + G.rng() * 9;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    let bad = false;
    for (const [ax, az, ad] of AVOID) {
      if ((x - ax) * (x - ax) + (z - az) * (z - az) < ad * ad) { bad = true; break; }
    }
    if (bad) continue;
    flowers.setMatrixAt(fi, M(x, 3.5, z, 0, [1, 0.7, 1]));
    flowers.setColorAt(fi, tmpC1.setHex(petals[fi % petals.length]));
    fi++;
  }
  flowers.count = fi;
  if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true;
  flowers.computeBoundingSphere?.();
  h.add(flowers);

  // --- 2 seagulls perched on the dock-end bollards
  const gullM = [], wingM = [];
  for (const [gx, ry] of [[2.4, 2.6], [-2.4, -2.1]]) {
    const gm = M(gx, 4.1, -45, ry);
    gullM.push(M(0, 0, 0, 0, [1, 0.85, 1.3]).premultiply(gm));
    wingM.push(M(0.36, 0.02, -0.05, 0, null, 0, 0.25).premultiply(gm));
    wingM.push(M(-0.36, 0.02, -0.05, 0, null, 0, -0.25).premultiply(gm));
  }
  inst(h, new THREE.SphereGeometry(0.4, 7, 6), white, gullM);
  inst(h, new THREE.BoxGeometry(0.5, 0.06, 0.34), toon(0xcfd6dc), wingM);

  // --- quest notice board beside the dock start (quests.js reads G.island)
  const by = gy(-4.6, -19);
  const bGroup = new THREE.Group();
  bGroup.position.set(-4.6, by, -19); bGroup.rotation.y = 0.25;
  h.add(bGroup);
  const board = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.5, 0.14), wood);
  board.position.y = 2.0;
  bGroup.add(board);
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 1.0), white);
  paper.position.set(-0.1, 2.0, -0.09); paper.rotation.y = Math.PI;
  bGroup.add(paper);
  const bm = M(-4.6, by, -19, 0.25);
  postM.push(
    M(-0.75, 1.45, 0, 0, [0.8, 2.9, 0.8]).premultiply(bm),
    M(0.75, 1.45, 0, 0, [0.8, 2.9, 0.8]).premultiply(bm));

  // all wooden poles in one draw call
  inst(h, new THREE.CylinderGeometry(0.13, 0.15, 1, 6), woodDark, postM);

  // --- contract for quests.js (world coordinates)
  G.island = {
    dockEnd: { x: HARBOR.x, z: HARBOR.z - 45 },                      // seaward dock tip
    boardPos: { x: HARBOR.x - 4.6, y: by + 2.0, z: HARBOR.z - 19 },  // notice-board center
    groundY: islandGroundY,                                          // (x,z) -> island surface y
  };
}

// ------------------------------------------------------------- init
export function init(g) {
  G = g;
  if (G.consts?.HARBOR) HARBOR = G.consts.HARBOR;

  G.ocean = { heightAt, normalAt, floorAt };
  G.weather = {
    storm: 0, stormTarget: 0, typhoon: false,
    wind: new THREE.Vector2(3, 0), lightning,
  };
  G.zoneAt = zoneAt;

  buildOcean(G.scene);
  buildSky(G.scene);
  buildRain(G.scene);
  buildWisps(G.scene);
  buildHarbor(G.scene);

  G.on('game:new', resetWeather);
  G.on('game:continue', resetWeather);
}

// ------------------------------------------------------------- frame values
const frame = { bx: 0, bz: 0, dayL: 0, nightF: 0, storm: 0, zone: 'harbor' };

function computeFrame() {
  const bp = G.boat?.group?.position;
  frame.bx = bp ? bp.x : HARBOR.x;
  frame.bz = bp ? bp.z : HARBOR.z;
  const f = G.time?.dayFrac ?? 0;
  const u = f * 2; // 0..1 day, 1..2 night
  frame.dayL = u < 1 ? Math.sin(Math.PI * u) : 0;
  frame.nightF = ss(0.47, 0.55, f) * (1 - ss(0.955, 0.995, f));
  frame.storm = G.weather.storm;
  frame.zone = zoneAt(frame.bx, frame.bz);
}

// ------------------------------------------------------------- weather sim
function updateWeather(dt) {
  const w = G.weather;
  // slow build/fade toward the director's target (threats.js sets stormTarget)
  const step = dt * 0.08;
  const dS = w.stormTarget - w.storm;
  w.storm += Math.max(-step, Math.min(step, dS));
  w.storm = clamp01(w.storm);
  typhoonMix += Math.max(-dt * 0.1, Math.min(dt * 0.1, (w.typhoon ? 1 : 0) - typhoonMix));
  // calm ~0.4 → storm ~3 → typhoon ~4.5
  oceanAmp = 0.8 + w.storm * 2.4 + typhoonMix * 1.5;

  windAngle += Math.sin(G.time.total * 0.07) * dt * 0.25;
  const mag = 2 + w.storm * 16 + typhoonMix * 8;
  w.wind.set(Math.cos(windAngle) * mag, Math.sin(windAngle) * mag);

  // auto lightning during heavy storms
  if (w.storm > 0.7) {
    boltTimer -= dt * (w.typhoon ? 1.6 : 1);
    if (boltTimer <= 0) {
      lightning();
      boltTimer = 3 + G.rng() * 8;
    }
  } else {
    boltTimer = Math.max(boltTimer, 2);
  }
  flashI = Math.max(0, flashI - dt * (flashI * 6 + 0.6));
  flashLight.intensity = flashI;
}

// ------------------------------------------------------------- sky & fog
function sampleSky(f, out) {
  for (let i = 1; i < SKY_STOPS.length; i++) {
    if (f <= SKY_STOPS[i][0]) {
      const [f0, c0] = SKY_STOPS[i - 1];
      const [f1, c1] = SKY_STOPS[i];
      tmpC1.setHex(c0); tmpC2.setHex(c1);
      return out.copy(tmpC1).lerp(tmpC2, (f - f0) / (f1 - f0));
    }
  }
  return out.setHex(SKY_STOPS[SKY_STOPS.length - 1][1]);
}

function updateSky(dt) {
  const f = G.time?.dayFrac ?? 0;
  const { dayL, nightF, storm } = frame;
  const damp = firstFrame ? 1 : 1 - Math.exp(-dt * 1.6);

  // ---- target sky color
  sampleSky(f, tmpC1);
  tmpC1.lerp(C_STORM_SKY, storm * 0.7);
  if (frame.zone === 'fog') tmpC1.lerp(C_CURSE_SKY, wispFade * 0.85);
  if (flashI > 0) tmpC1.lerp(C_FOG_HAZE, Math.min(0.5, flashI * 0.22));
  skyColor.lerp(tmpC1, flashI > 0 ? 1 : damp);

  // ---- fog target follows sky + haze
  tmpC2.copy(tmpC1).lerp(C_FOG_HAZE, 0.14 * dayL);
  let fogNear = lerp(140, 55, storm);
  let fogFar = lerp(1000, 340, storm);
  fogFar *= 1 - nightF * 0.3; // nights close in a little (creepy)
  if (frame.zone === 'fog') {
    tmpC2.lerp(C_CURSE_FOG, wispFade);
    fogNear = lerp(fogNear, 18, wispFade);
    fogFar = lerp(fogFar, 150, wispFade);
  }
  fogTargetC.lerp(tmpC2, damp);
  G.scene.fog.color.copy(fogTargetC);
  G.scene.fog.near = lerp(G.scene.fog.near, fogNear, damp);
  G.scene.fog.far = lerp(G.scene.fog.far, fogFar, damp);

  // ---- celestial bodies orbit around the boat
  skyGroup.position.set(frame.bx, 0, frame.bz);
  const u = f * 2;
  const su = clamp01(u);
  sunMesh.position.set(
    Math.cos(Math.PI * (1 - su)) * SKY_RADIUS * 0.9,
    Math.sin(Math.PI * su) * SKY_RADIUS * 0.55 + 26,
    -SKY_RADIUS * 0.34);
  sunMesh.visible = dayL > 0.02;
  const mu = clamp01(u - 1);
  moonMesh.position.set(
    Math.cos(Math.PI * (1 - mu)) * SKY_RADIUS * 0.9,
    Math.sin(Math.PI * mu) * SKY_RADIUS * 0.5 + 26,
    -SKY_RADIUS * 0.3);
  moonMesh.visible = nightF > 0.02;
  starMat.opacity = nightF * (1 - storm * 0.7);
  starPoints.visible = starMat.opacity > 0.02;

  // ---- lights
  const lowSun = ss(0.0, 0.12, dayL); // 0 near sunrise/sunset → warm orange
  if (dayL > 0.02) {
    tmpC1.copy(C_SUN_LOW).lerp(C_SUN_WARM, lowSun);
    dirLight.color.copy(tmpC1);
    dirLight.intensity = Math.max(0.15, 0.3 + dayL * 0.9 - storm * 0.45);
    dirLight.position.copy(sunMesh.position).multiplyScalar(0.4);
    dirLight.position.x += frame.bx; dirLight.position.z += frame.bz;
  } else {
    dirLight.color.copy(C_MOON);
    dirLight.intensity = Math.max(0.1, 0.24 - storm * 0.1);
    dirLight.position.copy(moonMesh.position).multiplyScalar(0.4);
    dirLight.position.x += frame.bx; dirLight.position.z += frame.bz;
  }
  dirLight.target.position.set(frame.bx, 0, frame.bz);
  hemiLight.color.copy(skyColor).lerp(C_FOG_HAZE, 0.25);
  hemiLight.groundColor.copy(C_GROUND_DAY).lerp(C_GROUND_NIGHT, nightF);
  hemiLight.intensity = Math.max(0.2, 0.38 + dayL * 0.5 - storm * 0.2);

  // ---- far ocean disc tint
  farMat.color.copy(C_FAR_DAY).lerp(C_FAR_NIGHT, nightF).lerp(C_FAR_STORM, storm * 0.6);
}

// ------------------------------------------------------------- ocean mesh
function updateOcean() {
  const cell = OCEAN_SIZE / OCEAN_SEG;
  const cx = Math.round(frame.bx / cell) * cell; // snap so waves don't swim
  const cz = Math.round(frame.bz / cell) * cell;
  const t = G.time.total;
  farDisc.position.set(frame.bx, -1.4, frame.bz);
  // 30 Hz is plenty for the mesh (physics samples heightAt analytically);
  // also covers the paused case (t - lastOceanT === 0). Recenter forces update.
  if (t - lastOceanT < 1 / 30 && cx === lastCX && cz === lastCZ) return;
  lastOceanT = t; lastCX = cx; lastCZ = cz;

  oceanMesh.position.set(cx, 0, cz);
  const pos = oceanGeo.attributes.position.array;
  const nrm = oceanGeo.attributes.normal.array;
  const col = oceanGeo.attributes.color.array;
  const n = oceanBaseX.length;
  const foamLo = oceanAmp * 0.38 + 0.08;   // foam starts lower on the crest = lots more visible foam
  const foamSpan = Math.max(0.001, oceanAmp * 0.42 + 0.16);
  for (let i = 0; i < n; i++) {
    const wx = oceanBaseX[i] + cx;
    const wz = oceanBaseZ[i] + cz;
    // one pass over the waves: height + analytic slope (same math as heightAt)
    let h = 0, sx = 0, sz = 0;
    for (let j = 0; j < WAVES.length; j++) {
      const w = WAVES[j];
      const ph = wx * w.kx + wz * w.kz + t * w.speed;
      h += w.amp * (Math.sin(ph) + 0.24 * Math.sin(ph * 2.17 + 1.3));
      const dh = w.amp * (Math.cos(ph) + 0.24 * 2.17 * Math.cos(ph * 2.17 + 1.3));
      sx += dh * w.kx;
      sz += dh * w.kz;
    }
    const ddx = wx - HARBOR.x, ddz = wz - HARBOR.z;
    const dd = Math.sqrt(ddx * ddx + ddz * ddz);
    const damp = 0.2 + 0.8 * ss(HARBOR_CALM_NEAR, HARBOR_CALM_FAR, dd);
    const scale = oceanAmp * damp; // damp treated as locally constant for the slope
    h *= scale; sx *= scale; sz *= scale;
    const ix = i * 3;
    pos[ix + 1] = h;
    // analytic normal: normalize(-dHdx, 1, -dHdz) — replaces computeVertexNormals()
    const inv = 1 / Math.sqrt(sx * sx + 1 + sz * sz);
    nrm[ix] = -sx * inv;
    nrm[ix + 1] = inv;
    nrm[ix + 2] = -sz * inv;
    // fat white foam on the crests via vertex color
    let foam = (h - foamLo) / foamSpan;
    foam = foam < 0 ? 0 : foam > 1 ? 1 : foam;
    foam *= foam;
    col[ix] = 0.16 + foam * 0.84;
    col[ix + 1] = 0.55 + foam * 0.45;
    col[ix + 2] = 0.85 + foam * 0.15;
  }
  oceanGeo.attributes.position.needsUpdate = true;
  oceanGeo.attributes.normal.needsUpdate = true;
  oceanGeo.attributes.color.needsUpdate = true;
}

// ------------------------------------------------------------- rain
function updateRain(dt) {
  const storm = frame.storm;
  rainMat.opacity = clamp01(storm * 1.6 - 0.15) * 0.85;
  rainPoints.visible = rainMat.opacity > 0.02;
  if (!rainPoints.visible) return;
  rainPoints.position.set(frame.bx, 0, frame.bz);
  const w = G.weather.wind;
  const fall = (26 + storm * 14) * dt;
  const wx = w.x * 0.25 * dt, wz = w.y * 0.25 * dt;
  const half = RAIN_BOX * 0.5;
  for (let i = 0; i < RAIN_COUNT; i++) {
    const ix = i * 3;
    rainPos[ix] += wx;
    rainPos[ix + 1] -= fall;
    rainPos[ix + 2] += wz;
    if (rainPos[ix + 1] < -2) {
      rainPos[ix + 1] += RAIN_HEIGHT;
      rainPos[ix] = (G.rng() * 2 - 1) * half;
      rainPos[ix + 2] = (G.rng() * 2 - 1) * half;
    }
    if (rainPos[ix] > half) rainPos[ix] -= RAIN_BOX;
    else if (rainPos[ix] < -half) rainPos[ix] += RAIN_BOX;
    if (rainPos[ix + 2] > half) rainPos[ix + 2] -= RAIN_BOX;
    else if (rainPos[ix + 2] < -half) rainPos[ix + 2] += RAIN_BOX;
  }
  rainPoints.geometry.attributes.position.needsUpdate = true;
}

// ------------------------------------------------------------- cursed wisps
function updateWisps(dt) {
  const want = frame.zone === 'fog' ? 1 : 0;
  wispFade += Math.max(-dt * 0.7, Math.min(dt * 0.7, want - wispFade));
  wispGroup.visible = wispFade > 0.01;
  if (!wispGroup.visible) return;
  wispMat.opacity = wispFade * 0.9;
  const t = G.time.total;
  for (let i = 0; i < WISP_COUNT; i++) {
    const orb = wispOrbs[i];
    const a = t * 0.28 + i * 2.4;
    const r = 22 + 16 * Math.sin(t * 0.16 + i * 1.9);
    orb.position.set(
      frame.bx + Math.cos(a) * r,
      2.5 + Math.sin(t * 0.9 + i * 1.3) * 1.8 + (i % 3),
      frame.bz + Math.sin(a) * r);
    const s = 0.7 + 0.4 * Math.sin(t * 2.1 + i * 2.2);
    orb.scale.setScalar(s);
  }
  for (let i = 0; i < wispLights.length; i++) {
    const l = wispLights[i];
    l.intensity = wispFade * (1.1 + 0.5 * Math.sin(t * 1.7 + i * 3));
    l.position.copy(wispOrbs[i * 3]?.position || wispOrbs[0].position);
  }
}

// ------------------------------------------------------------- harbor life
function updateHarbor(dt) {
  const { nightF } = frame;
  windowMat.opacity = 0.2 + nightF * 0.8;
  hutLight.intensity = nightF * 1.2;
  if (lampMat) lampMat.color.copy(C_LAMP_DAY).lerp(C_LAMP_NIGHT, nightF); // lamp heads warm up at night

  beamGroup.rotation.y += dt * 0.5;
  beamMat.opacity = nightF * 0.4;
  const t = G.time.total;
  for (let i = 0; i < buoys.length; i++) {
    const b = buoys[i];
    b.g.position.y = heightAt(b.x, b.z) + 0.25;
    b.g.rotation.x = Math.sin(t * 1.1 + b.phase) * 0.12;
    b.g.rotation.z = Math.cos(t * 0.9 + b.phase) * 0.12;
  }
}

// ------------------------------------------------------------- update
export function update(g, dt) {
  if (!G || !G.weather) return;
  computeFrame();
  updateWeather(dt);
  updateSky(dt);
  updateOcean();
  updateRain(dt);
  updateWisps(dt);
  updateHarbor(dt);
  firstFrame = false;
}
