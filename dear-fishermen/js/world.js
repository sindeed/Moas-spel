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
const RAIN_COUNT = 500;        // wind-slanted streaks (instanced thin boxes)
const RAIN_BOX = 140;          // xz extent around boat
const RAIN_HEIGHT = 70;
const RIPPLE_COUNT = 30;       // pooled rain-hit rings on the water
const SPRAY_COUNT = 80;        // pooled crest spray puffs
const GLINT_COUNT = 40;        // sun glints on the water near the boat
const SMOKE_COUNT = 9;         // chimney smoke puffs (3 per cottage)
const WISP_COUNT = 8;
const BUOY_COUNT = 6;
const HARBOR_CALM_NEAR = 55;   // waves damped close to the (longer) dock
const HARBOR_CALM_FAR = 160;
const ISLAND_TOP_R = 24;       // grass plateau radius (island XL)
const ISLAND_MID_R = 30;       // mound-top / sand-ring radius
const ISLAND_R = 48;           // beach outer radius = G.island.radius

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
let rainMesh, rainMat, rainPos;
let ripMesh, ripP = [], ripAccum = 0;
let sprayMesh, sprayP = [], sprayAccum = 0;
let glintMesh, glintMat, glintX, glintZ, glintPhase, glintO = 0;
let smokeMesh, chimTops = [];
let boltCore, boltGlow, boltCoreMat, boltGlowMat, boltLife = 0;
let wispGroup, wispOrbs = [], wispLights = [], wispMat;
let beamGroup, beamMat, windowMat, hutLight, lampMat;
let buoys = [];
let lastOceanT = -1, lastCX = 1e9, lastCZ = 1e9;

// shared instancing helpers (no per-frame allocations)
const dum = new THREE.Object3D();
const ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);
const UP_V = new THREE.Vector3(0, 1, 0);
const rainVel = new THREE.Vector3();
const rainDir = new THREE.Vector3();
const boltTmp = new THREE.Vector3();
const boltPts = [];
for (let i = 0; i < 5; i++) boltPts.push(new THREE.Vector3());
function hideAllInstances(im, n) {
  for (let i = 0; i < n; i++) im.setMatrixAt(i, ZERO_M);
  im.instanceMatrix.needsUpdate = true;
}

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
    // 2nd + small 3rd harmonic = punchy sharp crests (keep in sync with updateOcean!)
    h += w.amp * (Math.sin(ph) + 0.34 * Math.sin(ph * 2.17 + 1.3) + 0.12 * Math.sin(ph * 3.37 + 2.1));
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
  // beach ~-3 at the (XL) island, ~-12 along the coast, down to ~-30 in the deep
  let depth = -3 - 9 * ss(48, 115, d) - 18 * ss(220, 560, d);
  depth += Math.sin(x * 0.05) * Math.cos(z * 0.043) * 1.8 * ss(55, 120, d);
  return depth;
}

function zoneAt(x, z) {
  if (x < -260 && z < -260) return 'fog'; // cursed north-west quadrant
  const dx = x - HARBOR.x, dz = z - HARBOR.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d < 80) return 'harbor'; // ≥ island radius (48) + 25
  if (d < 220) return 'coast';
  if (d < 520) return 'open';
  return 'deep';
}

// ------------------------------------------------------------- weather
// Jagged bolt (4 white core segments + additive glow) drawn sky → target point.
function fireBoltVisual(tx, ty, tz) {
  if (!boltCore) return;
  const sx = tx + (G.rng() * 2 - 1) * 34;
  const sz = tz + (G.rng() * 2 - 1) * 34;
  const sy = ty + 115;
  for (let i = 0; i <= 4; i++) {
    const u = i / 4;
    const jag = (i > 0 && i < 4) ? 1 : 0; // endpoints stay pinned
    boltPts[i].set(
      lerp(sx, tx, u) + jag * (G.rng() * 2 - 1) * 11,
      lerp(sy, ty, u),
      lerp(sz, tz, u) + jag * (G.rng() * 2 - 1) * 11);
  }
  for (let i = 0; i < 4; i++) {
    const a = boltPts[i], b = boltPts[i + 1];
    const len = a.distanceTo(b);
    boltTmp.copy(b).sub(a).normalize();
    dum.position.copy(a).add(b).multiplyScalar(0.5);
    dum.quaternion.setFromUnitVectors(UP_V, boltTmp);
    dum.scale.set(0.4, len, 0.4);
    dum.updateMatrix();
    boltCore.setMatrixAt(i, dum.matrix);
    dum.scale.set(1.5, len, 1.5);
    dum.updateMatrix();
    boltGlow.setMatrixAt(i, dum.matrix);
  }
  boltCore.instanceMatrix.needsUpdate = true;
  boltGlow.instanceMatrix.needsUpdate = true;
  boltCore.visible = boltGlow.visible = true;
  boltLife = 0.25;
}

function lightning() {
  flashI = 2.6;
  const w = G?.weather;
  const bp = G?.boat?.group?.position;
  if (bp && w && w.storm > 0.35) {
    const hit = G.rng() < (w.typhoon ? 0.05 : 0.01);
    if (hit) {
      // ZAP! straight into the mast top — big flash, damage, fire
      const m = G.boat?.toWorld?.(boltTmp.set(0, 6.0, -3.85));
      if (m) fireBoltVisual(m.x, m.y, m.z);
      else fireBoltVisual(bp.x, bp.y + 6, bp.z);
      flashI = 4.4;
      G.boat?.damage?.(6, 'lightning');
      G.boat?.addFire?.();
      G?.emit?.('lightning:strike', {});
    } else {
      // visible drama out at sea, 120–400u away, no damage
      const a = G.rng() * Math.PI * 2;
      const r = 120 + G.rng() * 280;
      const x = bp.x + Math.cos(a) * r, z = bp.z + Math.sin(a) * r;
      fireBoltVisual(x, heightAt(x, z), z);
    }
  }
  G?.emit?.('lightning', {});
}

function updateBolt(dt) {
  if (boltLife <= 0 || !boltCore) return;
  boltLife -= dt;
  const flick = 0.7 + 0.3 * Math.sin(G.time.total * 90);
  boltCoreMat.opacity = flick;
  boltGlowMat.opacity = flick * 0.5;
  if (boltLife <= 0) { boltCore.visible = boltGlow.visible = false; }
}

function resetWeather() {
  const w = G.weather;
  w.storm = 0; w.stormTarget = 0; w.typhoon = false;
  oceanAmp = 0.8; typhoonMix = 0; flashI = 0; boltTimer = 5;
  boltLife = 0;
  if (boltCore) boltCore.visible = boltGlow.visible = false;
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
  // RAIN 2.0: wind-slanted streaks — instanced thin boxes, one shared orientation
  rainPos = new Float32Array(RAIN_COUNT * 3);
  for (let i = 0; i < RAIN_COUNT; i++) {
    rainPos[i * 3] = (Math.random() * 2 - 1) * RAIN_BOX * 0.5;
    rainPos[i * 3 + 1] = Math.random() * RAIN_HEIGHT;
    rainPos[i * 3 + 2] = (Math.random() * 2 - 1) * RAIN_BOX * 0.5;
  }
  rainMat = new THREE.MeshBasicMaterial({
    color: 0xbcd3e8, transparent: true, opacity: 0, depthWrite: false, fog: false,
  });
  rainMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 1, 0.05), rainMat, RAIN_COUNT);
  rainMesh.instanceMatrix.setUsage?.(THREE.DynamicDrawUsage);
  rainMesh.frustumCulled = false;
  rainMesh.visible = false;
  hideAllInstances(rainMesh, RAIN_COUNT);
  scene.add(rainMesh);

  // rain-hit ring ripples on the water (pooled)
  const ripGeo = new THREE.RingGeometry(0.55, 0.78, 14);
  ripGeo.rotateX(-Math.PI / 2);
  ripMesh = new THREE.InstancedMesh(ripGeo, new THREE.MeshBasicMaterial({
    color: 0xe4f2ff, transparent: true, opacity: 0.38, depthWrite: false,
  }), RIPPLE_COUNT);
  ripMesh.instanceMatrix.setUsage?.(THREE.DynamicDrawUsage);
  ripMesh.frustumCulled = false;
  ripMesh.visible = false;
  hideAllInstances(ripMesh, RIPPLE_COUNT);
  for (let i = 0; i < RIPPLE_COUNT; i++) ripP.push({ on: false, x: 0, z: 0, age: 0 });
  scene.add(ripMesh);
}

function buildSpray(scene) {
  // white crest-spray puffs (pooled, one instanced mesh)
  sprayMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.42, 6, 5),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false }),
    SPRAY_COUNT);
  sprayMesh.instanceMatrix.setUsage?.(THREE.DynamicDrawUsage);
  sprayMesh.frustumCulled = false;
  hideAllInstances(sprayMesh, SPRAY_COUNT);
  for (let i = 0; i < SPRAY_COUNT; i++) {
    sprayP.push({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1 });
  }
  scene.add(sprayMesh);

  // sun glints: tiny bright quads lying flat on the swell
  const gg = new THREE.PlaneGeometry(0.55, 0.55);
  gg.rotateX(-Math.PI / 2);
  glintMat = new THREE.MeshBasicMaterial({
    color: 0xfff6c9, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  glintMesh = new THREE.InstancedMesh(gg, glintMat, GLINT_COUNT);
  glintMesh.instanceMatrix.setUsage?.(THREE.DynamicDrawUsage);
  glintMesh.frustumCulled = false;
  glintMesh.visible = false;
  glintX = new Float32Array(GLINT_COUNT);
  glintZ = new Float32Array(GLINT_COUNT);
  glintPhase = new Float32Array(GLINT_COUNT);
  for (let i = 0; i < GLINT_COUNT; i++) {
    glintX[i] = (Math.random() * 2 - 1) * 40;
    glintZ[i] = (Math.random() * 2 - 1) * 40;
    glintPhase[i] = Math.random() * Math.PI * 2;
  }
  scene.add(glintMesh);
}

function buildBolt(scene) {
  const seg = new THREE.BoxGeometry(1, 1, 1);
  boltCoreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, fog: false });
  boltGlowMat = new THREE.MeshBasicMaterial({
    color: 0x9fd0ff, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  boltCore = new THREE.InstancedMesh(seg, boltCoreMat, 4);
  boltGlow = new THREE.InstancedMesh(seg, boltGlowMat, 4);
  for (const m of [boltCore, boltGlow]) {
    m.frustumCulled = false;
    m.visible = false;
    scene.add(m);
  }
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

  // island mound + grass top (ISLAND XL: top 30, base 48)
  const mound = new THREE.Mesh(new THREE.CylinderGeometry(ISLAND_MID_R, ISLAND_R, 7, 14), sand);
  mound.position.y = -1.0;
  h.add(mound);
  const grass = new THREE.Mesh(new THREE.CylinderGeometry(ISLAND_TOP_R, 29.5, 1.6, 14), toon(0x6cc24a));
  grass.position.y = 2.6;
  h.add(grass);

  // dock: planks marching toward the open sea (-z), on posts — longer to clear the bigger beach
  const plankGeo = new THREE.BoxGeometry(6, 0.5, 2.2);
  for (let i = 0; i < 11; i++) {
    const p = new THREE.Mesh(plankGeo, i % 2 ? wood : woodDark);
    p.position.set(0, 2.1, -32 - i * 2.6);
    p.rotation.y = (i % 3 - 1) * 0.02; // slightly wonky planks, on purpose
    h.add(p);
  }
  const postGeo = new THREE.CylinderGeometry(0.45, 0.5, 7, 7);
  for (let i = 0; i < 3; i++) {
    for (const sx of [-2.6, 2.6]) {
      const post = new THREE.Mesh(postGeo, woodDark);
      post.position.set(sx, -1.0, -34 - i * 11);
      h.add(post);
    }
  }
  // mooring bollards at the dock end
  const bollGeo = new THREE.CylinderGeometry(0.5, 0.6, 1.5, 8);
  for (const sx of [-2.4, 2.4]) {
    const b = new THREE.Mesh(bollGeo, toon(0x394b59));
    b.position.set(sx, 3.0, -58);
    h.add(b);
  }

  // harbor hut with a warm little window (glows at night)
  const hut = new THREE.Group();
  hut.position.set(-14, 3.4, 12);
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
  lh.position.set(16, 3.0, 13);
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
  const palmSpots = [[-21, -5, 0.22], [7, 20, -0.18], [22, -7, 0.12], [-8, 21, -0.1]];
  for (const [px, pz, tilt] of palmSpots) {
    const base = islandGroundY(HARBOR.x + px, HARBOR.z + pz);
    const tr = new THREE.Mesh(trunkGeo, trunkMat);
    tr.position.set(px, base + 3.3, pz); tr.rotation.z = tilt;
    h.add(tr);
    const top = new THREE.Mesh(leafGeo, leafMat);
    top.position.set(px - Math.sin(tilt) * 7, base + 6.9, pz);
    top.scale.y = 1.6;
    h.add(top);
    const top2 = new THREE.Mesh(leafGeo, leafMat);
    top2.position.set(px - Math.sin(tilt) * 7, base + 8.0, pz);
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
  if (d < ISLAND_TOP_R) return 3.4;                              // grass top
  if (d < ISLAND_MID_R) return 3.4 - 0.9 * ((d - ISLAND_TOP_R) / (ISLAND_MID_R - ISLAND_TOP_R));
  if (d < ISLAND_R) return 2.5 - 7.0 * ((d - ISLAND_MID_R) / (ISLAND_R - ISLAND_MID_R)); // beach
  return -4.5;                                                   // underwater — off the island
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
  // ISLAND XL: respaced onto the bigger grass top + porches, shutters, ridge caps, fences.
  const wallGeo = new THREE.BoxGeometry(4.6, 3.2, 4.0);
  const cRoofGeo = new THREE.ConeGeometry(3.6, 2.4, 4);
  const roofMat = toon(0x6b4a33);
  const doorM = [], winM = [], wboxM = [], chimM = [];
  const porchM = [], shutM = [], capM = [], fenceM = [];
  chimTops.length = 0;
  const COTTAGES = [
    [-16, -13, -0.35, toon(0xc94f43), true],   // red (fenced)
    [1, -17, 0.05, toon(0xd9a441), false],     // ochre
    [16, -12, 0.4, blue, true],                // blue (fenced)
  ];
  const chimV = new THREE.Vector3();
  for (const [cx, cz, ry, mat, fenced] of COTTAGES) {
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
    // chimney mouth in world coords (smoke puffs spawn here)
    chimV.set(-1.3, 4.95, 0.8).applyMatrix4(hm);
    chimTops.push(new THREE.Vector3(HARBOR.x + chimV.x, chimV.y, HARBOR.z + chimV.z));
    // porch: little sloped roof over the door + 2 posts
    porchM.push(M(-0.85, 2.62, -2.75, 0, null, 0.3).premultiply(hm));
    postM.push(
      M(-1.85, 1.15, -2.85, 0, [0.8, 2.3, 0.8]).premultiply(hm),
      M(0.15, 1.15, -2.85, 0, [0.8, 2.3, 0.8]).premultiply(hm));
    // window shutters
    shutM.push(
      M(0.44, 2.1, -2.06).premultiply(hm),
      M(1.96, 2.1, -2.06).premultiply(hm));
    // roof ridge cap on the apex
    capM.push(M(0, 5.72, 0, Math.PI / 4).premultiply(hm));
    // garden picket fence: front run (gate gap at the door) + two short sides
    if (!fenced) continue;
    for (let px = -2.7; px <= 2.7; px += 0.6) {
      if (px > -1.7 && px < 0.1) continue; // gate
      fenceM.push(M(px, 0.5, -4.3, 0, [0.13, 1.0, 0.07]).premultiply(hm));
    }
    for (const sx of [-2.7, 2.7]) {
      for (const pz of [-3.7, -3.1, -2.5]) {
        fenceM.push(M(sx, 0.5, pz, 0, [0.07, 1.0, 0.13]).premultiply(hm));
      }
      fenceM.push(M(sx, 0.72, -3.35, 0, [0.06, 0.08, 2.0]).premultiply(hm)); // side rail
    }
    fenceM.push(
      M(-2.2, 0.72, -4.3, 0, [1.15, 0.08, 0.06]).premultiply(hm),  // front rails
      M(1.45, 0.72, -4.3, 0, [2.4, 0.08, 0.06]).premultiply(hm));
  }
  inst(h, new THREE.BoxGeometry(1.1, 2.0, 0.16), white, doorM);
  inst(h, new THREE.PlaneGeometry(1.15, 1.15), windowMat, winM);
  inst(h, new THREE.BoxGeometry(1.5, 0.34, 0.4), white, wboxM);
  inst(h, new THREE.BoxGeometry(0.7, 1.4, 0.7), woodDark, chimM);
  inst(h, new THREE.BoxGeometry(2.3, 0.12, 1.4), roofMat, porchM);
  inst(h, new THREE.BoxGeometry(0.36, 1.15, 0.1), toon(0x3e6b4f), shutM);
  inst(h, new THREE.BoxGeometry(0.62, 0.24, 0.62), woodDark, capM);
  inst(h, new THREE.BoxGeometry(1, 1, 1), white, fenceM);

  // --- clothesline between the red and ochre cottages (2 posts + line + 3 cloths)
  const clA = { x: -10.5, z: -15.2 }, clB = { x: -3.6, z: -16.3 };
  postM.push(
    M(clA.x, gy(clA.x, clA.z) + 1.35, clA.z, 0, [0.8, 2.7, 0.8]),
    M(clB.x, gy(clB.x, clB.z) + 1.35, clB.z, 0, [0.8, 2.7, 0.8]));
  const clY = 3.4 + 2.6;
  const clPts = [
    new THREE.Vector3(clA.x, clY, clA.z),
    new THREE.Vector3((clA.x + clB.x) / 2, clY - 0.3, (clA.z + clB.z) / 2),
    new THREE.Vector3(clB.x, clY, clB.z),
  ];
  h.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(clPts),
    new THREE.LineBasicMaterial({ color: 0xe8e2d2 })));
  const clothGeo = new THREE.PlaneGeometry(0.95, 0.75);
  const clothMat = toon(0xffffff, { side: THREE.DoubleSide });
  const cloths = new THREE.InstancedMesh(clothGeo, clothMat, 3);
  const clAng = Math.atan2(clB.x - clA.x, clB.z - clA.z) + Math.PI / 2;
  const clCol = [0xf3b6c9, 0x9cc8f0, 0xf6f2e8];
  for (let i = 0; i < 3; i++) {
    const u = 0.25 + i * 0.25;
    cloths.setMatrixAt(i, M(
      lerp(clA.x, clB.x, u), clY - 0.32 - Math.sin(Math.PI * u) * 0.28,
      lerp(clA.z, clB.z, u), clAng, null, 0, 0.06 - i * 0.05));
    cloths.setColorAt(i, tmpC1.setHex(clCol[i]));
  }
  if (cloths.instanceColor) cloths.instanceColor.needsUpdate = true;
  cloths.computeBoundingSphere?.();
  h.add(cloths);

  // --- market stall near the dock (striped awning + crate of fish)
  const stall = new THREE.Group();
  stall.position.set(8, gy(8, -25), -25);
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
  const stallM = M(8, gy(8, -25), -25, 0.5);
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
  postM.push(M(-9.1, 4.5, -7.5, 0, [0.8, 2.2, 0.8]), M(-6.9, 4.5, -7.5, 0, [0.8, 2.2, 0.8]));
  const bar = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.14, 0.14), woodDark);
  bar.position.set(-8.0, 5.45, -7.5);
  h.add(bar);
  for (let i = 0; i < 4; i++) {
    fishM.push(M(-8.75 + i * 0.5, 4.98, -7.5, 0.3 * (i % 2), [0.55, 1.35, 0.4]));
  }
  inst(h, new THREE.SphereGeometry(0.34, 6, 5), fishMat, fishM);

  // --- winding sand path: dock start → cottages (instanced flat patches)
  const PATH = [
    [0, -29.5, 0.1], [-0.7, -27.0, -0.3], [0.4, -24.6, 0.25], [-0.5, -22.2, 0.15],
    [0.6, -19.8, -0.1], [0, -17.4, 0.2],
    [-4.2, -15.6, 0.5], [-8.4, -14.4, 0.35], [-12.4, -13.6, 0.25],
    [4.8, -15.8, -0.5], [9.2, -14.4, -0.35], [13.2, -13.2, -0.25],
  ];
  inst(h, new THREE.BoxGeometry(2.3, 0.14, 1.7), toon(0xf7e7ae),
    PATH.map(([x, z, ry]) => M(x, gy(x, z) + 0.07, z, ry)));

  // --- 4 lamp posts along the path (glow-material heads, no extra lights)
  lampMat = new THREE.MeshBasicMaterial({ color: 0xcfc9b8 });
  const lampM = [];
  for (const [x, z] of [[-2.3, -27.5], [2.4, -22.5], [-2.6, -18.0], [3.6, -15.2]]) {
    const y = gy(x, z);
    postM.push(M(x, y + 1.6, z, 0, [0.85, 3.2, 0.85]));
    lampM.push(M(x, y + 3.4, z));
  }
  inst(h, new THREE.SphereGeometry(0.34, 8, 6), lampMat, lampM);

  // --- rope fence along both dock edges (posts + sagging Line rope)
  const ropeMat = new THREE.LineBasicMaterial({ color: 0xd9c08a });
  for (const sx of [-2.75, 2.75]) {
    const zs = [-33, -41, -49, -57];
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
  row.position.set(-20, gy(-20, -26) + 0.35, -26);
  row.rotation.set(0.06, 0.7, 0.08);
  h.add(row);
  row.add(new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.8, 1.5), blue));
  const bench = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 1.3), wood);
  bench.position.set(0.3, 0.42, 0);
  row.add(bench);

  // --- 2 barrel clusters
  inst(h, new THREE.CylinderGeometry(0.5, 0.55, 1.1, 8), woodDark, [
    [-5.5, -23.6], [-4.7, -24.4], [-5.2, -22.9], [12.5, -19.3], [13.3, -19.9], [12.8, -20.6],
  ].map(([x, z], i) => M(x, gy(x, z) + 0.55, z, i * 0.9)));

  // --- scattered flowers on the grass (instanced, per-instance colors)
  const petals = [0xff8fb3, 0xffd23e, 0xf6f2e8, 0xb48cff];
  const AVOID = [
    [-16, -13, 4.8], [1, -17, 4.8], [16, -12, 4.8],       // cottages (+fences)
    [-14, 12, 4.6], [16, 13, 3.6], [-8, -7.5, 2.4],       // hut, lighthouse, rack
    [8, -25, 2.6], [-7, -15.7, 1.4],                      // stall, clothesline
    ...PATH.map(([x, z]) => [x, z, 1.7]),
  ];
  const flowers = new THREE.InstancedMesh(new THREE.SphereGeometry(0.18, 6, 5), toon(0xffffff), 20);
  let fi = 0, guard = 0;
  while (fi < 20 && guard++ < 300) {
    const a = G.rng() * Math.PI * 2, r = 5 + G.rng() * 17;
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
    const gm = M(gx, 4.1, -58, ry);
    gullM.push(M(0, 0, 0, 0, [1, 0.85, 1.3]).premultiply(gm));
    wingM.push(M(0.36, 0.02, -0.05, 0, null, 0, 0.25).premultiply(gm));
    wingM.push(M(-0.36, 0.02, -0.05, 0, null, 0, -0.25).premultiply(gm));
  }
  inst(h, new THREE.SphereGeometry(0.4, 7, 6), white, gullM);
  inst(h, new THREE.BoxGeometry(0.5, 0.06, 0.34), toon(0xcfd6dc), wingM);

  // --- quest notice board beside the dock start (quests.js reads G.island)
  const by = gy(-5.2, -26);
  const bGroup = new THREE.Group();
  bGroup.position.set(-5.2, by, -26); bGroup.rotation.y = 0.25;
  h.add(bGroup);
  const board = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.5, 0.14), wood);
  board.position.y = 2.0;
  bGroup.add(board);
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 1.0), white);
  paper.position.set(-0.1, 2.0, -0.09); paper.rotation.y = Math.PI;
  bGroup.add(paper);
  const bm = M(-5.2, by, -26, 0.25);
  postM.push(
    M(-0.75, 1.45, 0, 0, [0.8, 2.9, 0.8]).premultiply(bm),
    M(0.75, 1.45, 0, 0, [0.8, 2.9, 0.8]).premultiply(bm));

  // all wooden poles in one draw call
  inst(h, new THREE.CylinderGeometry(0.13, 0.15, 1, 6), woodDark, postM);

  // --- slow chimney smoke puffs (pooled; animated only when the boat is near)
  smokeMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.34, 6, 5),
    new THREE.MeshBasicMaterial({ color: 0xd8d8d4, transparent: true, opacity: 0.42, depthWrite: false }),
    SMOKE_COUNT);
  smokeMesh.instanceMatrix.setUsage?.(THREE.DynamicDrawUsage);
  smokeMesh.frustumCulled = false;
  smokeMesh.visible = false;
  hideAllInstances(smokeMesh, SMOKE_COUNT);
  G.scene.add(smokeMesh); // world coords (chimTops)

  // --- contract for quests.js + boat.js/characters.js (world coordinates)
  G.island = {
    dockEnd: { x: HARBOR.x, z: HARBOR.z - 59 },                      // seaward dock tip (open water)
    boardPos: { x: HARBOR.x - 5.2, y: by + 2.0, z: HARBOR.z - 26 },  // notice-board center
    groundY: islandGroundY,                                          // (x,z) -> island surface y
    radius: ISLAND_R,                                                // beach outer radius (collision)
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
  buildSpray(G.scene);
  buildBolt(G.scene);
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
  // calm ~0.8 → storm ~4 → typhoon ~5.6 (storm waves read TALL — Eidan's request)
  oceanAmp = 0.8 + w.storm * 3.2 + typhoonMix * 1.6;

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
      h += w.amp * (Math.sin(ph) + 0.34 * Math.sin(ph * 2.17 + 1.3) + 0.12 * Math.sin(ph * 3.37 + 2.1));
      const dh = w.amp * (Math.cos(ph) + 0.34 * 2.17 * Math.cos(ph * 2.17 + 1.3) + 0.12 * 3.37 * Math.cos(ph * 3.37 + 2.1));
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

// ------------------------------------------------------------- rain 2.0
function updateRain(dt) {
  const storm = frame.storm;
  rainMat.opacity = clamp01(storm * 1.6 - 0.15) * 0.9;
  rainMesh.visible = rainMat.opacity > 0.02;
  updateRipples(dt);
  if (!rainMesh.visible) return;
  rainMesh.position.set(frame.bx, 0, frame.bz);
  const w = G.weather.wind;
  // typhoon = near-horizontal sheets: more wind push, less fall
  const horiz = 0.55 + typhoonMix * 1.3;
  rainVel.set(w.x * horiz, -(26 + storm * 16) * (1 - typhoonMix * 0.45), w.y * horiz);
  const speed = rainVel.length();
  rainDir.copy(rainVel).divideScalar(speed || 1);
  dum.quaternion.setFromUnitVectors(UP_V, rainDir);
  const len = Math.min(3.4, 1.1 + speed * 0.032);
  dum.scale.set(1, len, 1);
  // denser with the storm; typhoon uses the whole pool
  rainMesh.count = Math.max(80, Math.floor(RAIN_COUNT * clamp01(storm * 1.1 + typhoonMix * 0.6)));
  const half = RAIN_BOX * 0.5;
  for (let i = 0; i < rainMesh.count; i++) {
    const ix = i * 3;
    rainPos[ix] += rainVel.x * dt;
    rainPos[ix + 1] += rainVel.y * dt;
    rainPos[ix + 2] += rainVel.z * dt;
    if (rainPos[ix + 1] < -2) {
      rainPos[ix + 1] += RAIN_HEIGHT;
      rainPos[ix] = (G.rng() * 2 - 1) * half;
      rainPos[ix + 2] = (G.rng() * 2 - 1) * half;
    }
    if (rainPos[ix] > half) rainPos[ix] -= RAIN_BOX;
    else if (rainPos[ix] < -half) rainPos[ix] += RAIN_BOX;
    if (rainPos[ix + 2] > half) rainPos[ix + 2] -= RAIN_BOX;
    else if (rainPos[ix + 2] < -half) rainPos[ix + 2] += RAIN_BOX;
    dum.position.set(rainPos[ix], rainPos[ix + 1], rainPos[ix + 2]);
    dum.updateMatrix();
    rainMesh.setMatrixAt(i, dum.matrix);
  }
  rainMesh.instanceMatrix.needsUpdate = true;
}

// pooled ring ripples where drops smack the water near the boat
function updateRipples(dt) {
  const raining = rainMat.opacity > 0.05;
  if (raining) {
    ripAccum += dt * (4 + frame.storm * 16 + typhoonMix * 12);
    let spawns = Math.floor(ripAccum);
    ripAccum -= spawns;
    for (let i = 0; i < RIPPLE_COUNT && spawns > 0; i++) {
      const p = ripP[i];
      if (p.on) continue;
      p.on = true; p.age = 0;
      const a = G.rng() * Math.PI * 2, r = 4 + G.rng() * 24;
      p.x = frame.bx + Math.cos(a) * r;
      p.z = frame.bz + Math.sin(a) * r;
      spawns--;
    }
  }
  let any = false;
  dum.quaternion.set(0, 0, 0, 1);
  for (let i = 0; i < RIPPLE_COUNT; i++) {
    const p = ripP[i];
    if (!p.on) continue;
    p.age += dt;
    if (p.age > 0.65) { p.on = false; ripMesh.setMatrixAt(i, ZERO_M); any = true; continue; }
    dum.position.set(p.x, heightAt(p.x, p.z) + 0.06, p.z);
    const s = 0.4 + p.age * 4.2;
    dum.scale.set(s, 1, s);
    dum.updateMatrix();
    ripMesh.setMatrixAt(i, dum.matrix);
    any = true;
  }
  if (any) ripMesh.instanceMatrix.needsUpdate = true;
  ripMesh.visible = raining || any;
}

// ------------------------------------------------------------- crest spray
function updateSpray(dt) {
  const rate = 5 + frame.storm * 32 + typhoonMix * 22; // spawn tries/sec (more in storms)
  sprayAccum += dt * rate;
  let tries = Math.min(6, Math.floor(sprayAccum));
  sprayAccum -= tries;
  const thresh = oceanAmp * 0.6; // only on real crests
  while (tries-- > 0) {
    const a = G.rng() * Math.PI * 2, r = 6 + G.rng() * 44; // within ~50u of the boat
    const x = frame.bx + Math.cos(a) * r;
    const z = frame.bz + Math.sin(a) * r;
    const hgt = heightAt(x, z);
    if (hgt < thresh) continue;
    for (let i = 0; i < SPRAY_COUNT; i++) {
      const p = sprayP[i];
      if (p.on) continue;
      p.on = true;
      p.x = x; p.y = hgt + 0.2; p.z = z;
      p.vx = (G.rng() * 2 - 1) * 2 + G.weather.wind.x * 0.12;
      p.vy = 3.5 + G.rng() * 3.5;
      p.vz = (G.rng() * 2 - 1) * 2 + G.weather.wind.y * 0.12;
      p.max = p.life = 0.55 + G.rng() * 0.4;
      break;
    }
  }
  let any = false;
  dum.quaternion.set(0, 0, 0, 1);
  for (let i = 0; i < SPRAY_COUNT; i++) {
    const p = sprayP[i];
    if (!p.on) continue;
    p.life -= dt;
    if (p.life <= 0) { p.on = false; sprayMesh.setMatrixAt(i, ZERO_M); any = true; continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    p.vy -= 13 * dt;
    const u = 1 - p.life / p.max;
    dum.position.set(p.x, p.y, p.z);
    dum.scale.setScalar(0.5 + u * 1.7); // puff grows as it flies
    dum.updateMatrix();
    sprayMesh.setMatrixAt(i, dum.matrix);
    any = true;
  }
  if (any) sprayMesh.instanceMatrix.needsUpdate = true;
}

// ------------------------------------------------------------- sun glints
function updateGlints(dt) {
  const want = frame.dayL * (1 - frame.storm) * (1 - typhoonMix) * 0.75; // day + calm only
  glintO = lerp(glintO, want, Math.min(1, dt * 2));
  glintMat.opacity = glintO;
  glintMesh.visible = glintO > 0.03;
  if (!glintMesh.visible) return;
  const t = G.time.total;
  for (let i = 0; i < GLINT_COUNT; i++) {
    // glints live in boat-relative offsets; twinkle by scale
    const x = frame.bx + glintX[i];
    const z = frame.bz + glintZ[i];
    const tw = Math.sin(t * 2.1 + glintPhase[i]);
    dum.position.set(x, heightAt(x, z) + 0.07, z);
    dum.scale.setScalar(Math.max(0.001, tw) * (0.7 + 0.5 * Math.sin(glintPhase[i] * 3)));
    dum.updateMatrix();
    glintMesh.setMatrixAt(i, dum.matrix);
  }
  glintMesh.instanceMatrix.needsUpdate = true;
}

// ------------------------------------------------------------- chimney smoke
function updateSmoke() {
  const dx = frame.bx - HARBOR.x, dz = frame.bz - HARBOR.z;
  const near = dx * dx + dz * dz < 140 * 140 && chimTops.length > 0;
  smokeMesh.visible = near;
  if (!near) return;
  const t = G.time.total;
  dum.quaternion.set(0, 0, 0, 1);
  for (let i = 0; i < SMOKE_COUNT; i++) {
    const top = chimTops[(i / 3) | 0] || chimTops[0];
    const u = (t * 0.35 + i * 1.23) % 3 / 3; // slow looping rise
    dum.position.set(
      top.x + Math.sin(t * 0.6 + i * 2.1) * 0.25 + u * 1.1,
      top.y + u * 3.2,
      top.z + Math.cos(t * 0.5 + i * 1.7) * 0.2 + u * 0.5);
    dum.scale.setScalar((0.5 + u * 1.5) * (1 - ss(0.8, 1, u)));
    dum.updateMatrix();
    smokeMesh.setMatrixAt(i, dum.matrix);
  }
  smokeMesh.instanceMatrix.needsUpdate = true;
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
  updateSpray(dt);
  updateGlints(dt);
  updateBolt(dt);
  updateSmoke();
  updateWisps(dt);
  updateHarbor(dt);
  firstFrame = false;
}
