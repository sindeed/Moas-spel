// entities.js — alla figurer i spelet, byggda av enkla former med cel-shading
import * as THREE from './lib/three.module.min.js';
import { toon, kontur } from './verktyg.js';

function skuggor(grupp) {
  grupp.traverse((m) => {
    if (m.isMesh && !m.userData.ingenKontur) m.castShadow = true;
  });
}

// ---------- Prinsessan Moa ----------
export function byggPrinsessa() {
  const grupp = new THREE.Group();
  const modell = new THREE.Group();
  grupp.add(modell);

  const HUD = 0xffe0cc, ROSA = 0xff7fbe, LJUSROSA = 0xffa9d6, GULD = 0xffcf5c, HAR = 0xb5793f;

  const kjol = new THREE.Mesh(new THREE.ConeGeometry(0.65, 1.05, 18), toon(ROSA));
  kjol.position.y = 0.55;
  const kjolkant = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.06, 8, 22), toon(GULD));
  kjolkant.rotation.x = Math.PI / 2;
  kjolkant.position.y = 0.1;
  const kropp = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 0.5, 12), toon(LJUSROSA));
  kropp.position.y = 1.2;
  const skarp = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.045, 8, 16), toon(GULD));
  skarp.rotation.x = Math.PI / 2;
  skarp.position.y = 1.0;
  modell.add(kjol, kjolkant, kropp, skarp);

  const huvud = new THREE.Group();
  const ansikte = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), toon(HUD));
  huvud.add(ansikte);
  const ogon = [];
  for (const sida of [-1, 1]) {
    const oga = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), toon(0x2a1a2e));
    oga.position.set(sida * 0.11, 0.05, 0.26);
    huvud.add(oga);
    ogon.push(oga);
    const kind = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), toon(0xff9fb0));
    kind.position.set(sida * 0.18, -0.06, 0.23);
    kind.scale.z = 0.5;
    huvud.add(kind);
  }
  const mun = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.016, 6, 12, Math.PI), toon(0xc2455f));
  mun.position.set(0, -0.08, 0.27);
  mun.rotation.z = Math.PI;
  huvud.add(mun);
  // Hår med två tofsar, som på Moas teckning
  const har = new THREE.Mesh(
    new THREE.SphereGeometry(0.33, 14, 10, 0, Math.PI * 2, 0, Math.PI / 1.8), toon(HAR)
  );
  har.position.set(0, 0.06, -0.03);
  huvud.add(har);
  for (const sida of [-1, 1]) {
    const tofs = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), toon(HAR));
    tofs.position.set(sida * 0.34, 0.16, -0.04);
    const tofs2 = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), toon(HAR));
    tofs2.position.set(sida * 0.44, 0.03, -0.04);
    huvud.add(tofs, tofs2);
  }
  // Guldkrona med tre spetsar och en rosa ädelsten
  const kronring = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.12, 12, 1, true),
    toon(GULD, { side: THREE.DoubleSide }));
  kronring.position.y = 0.32;
  huvud.add(kronring);
  for (const v of [-0.5, 0, 0.5]) {
    const spets = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.17, 6), toon(GULD));
    spets.position.set(Math.sin(v) * 0.17, 0.44, Math.cos(v) * 0.17);
    huvud.add(spets);
  }
  const juvel = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), toon(0xff4d94));
  juvel.position.set(0, 0.32, 0.2);
  huvud.add(juvel);
  huvud.position.y = 1.72;
  modell.add(huvud);

  // Armar (grupper vid axlarna så de kan svängas)
  const armL = new THREE.Group();
  armL.position.set(-0.3, 1.4, 0);
  const varmL = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.42, 4, 8), toon(HUD));
  varmL.position.y = -0.27;
  armL.add(varmL);
  const puffL = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 8), toon(LJUSROSA));
  armL.add(puffL);
  modell.add(armL);

  const armR = new THREE.Group();
  armR.position.set(0.3, 1.4, 0);
  const varmR = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.42, 4, 8), toon(HUD));
  varmR.position.y = -0.27;
  armR.add(varmR);
  const puffR = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 8), toon(LJUSROSA));
  armR.add(puffR);

  // Svärdet sitter i höger hand och pekar i armens riktning
  const svard = new THREE.Group();
  const klinga = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.95, 0.16), toon(0xe8ecf5));
  klinga.position.y = -0.55;
  const spets = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.22, 4), toon(0xe8ecf5));
  spets.rotation.x = Math.PI;
  spets.rotation.y = Math.PI / 4;
  spets.position.y = -1.11;
  const parerstang = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.07, 0.2), toon(GULD));
  parerstang.position.y = -0.06;
  const gem = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), toon(0xff4d94));
  gem.position.y = 0.05;
  svard.add(klinga, spets, parerstang, gem);
  svard.position.y = -0.5;
  armR.add(svard);
  modell.add(armR);

  kontur(grupp, 0.06);
  skuggor(grupp);
  return { grupp, modell, huvud, armL, armR, svard, ogon };
}

// ---------- Spöke ----------
export function byggSpoke() {
  const grupp = new THREE.Group();
  const modell = new THREE.Group();
  grupp.add(modell);
  const mat = toon(0xf4f7ff, { transparent: true, opacity: 0.85 });
  const kropp = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 12), mat);
  kropp.scale.y = 1.15;
  kropp.userData.ingenKontur = true;
  modell.add(kropp);
  for (let i = 0; i < 5; i++) {
    const v = (i / 5) * Math.PI * 2;
    const vag = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 8), mat);
    vag.position.set(Math.cos(v) * 0.4, -0.55, Math.sin(v) * 0.4);
    vag.userData.ingenKontur = true;
    modell.add(vag);
  }
  for (const sida of [-1, 1]) {
    const oga = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), toon(0x2a1a2e));
    oga.position.set(sida * 0.18, 0.12, 0.48);
    oga.userData.ingenKontur = true;
    modell.add(oga);
    const arm = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), mat);
    arm.position.set(sida * 0.55, -0.1, 0.1);
    arm.scale.set(0.7, 1.3, 0.7);
    arm.userData.ingenKontur = true;
    modell.add(arm);
  }
  const mun = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), toon(0x3d2440));
  mun.position.set(0, -0.12, 0.5);
  mun.scale.set(0.8, 1.1, 0.5);
  mun.userData.ingenKontur = true;
  modell.add(mun);
  return { grupp, modell };
}

// ---------- Slime ----------
const SLIMEFARGER = [0xb78bff, 0x7be3c4, 0xff9de2];
export function byggSlime(i) {
  const grupp = new THREE.Group();
  const modell = new THREE.Group();
  grupp.add(modell);
  const farg = SLIMEFARGER[i % SLIMEFARGER.length];
  const kropp = new THREE.Mesh(new THREE.SphereGeometry(0.52, 14, 12), toon(farg));
  kropp.scale.y = 0.78;
  kropp.position.y = 0.4;
  modell.add(kropp);
  const glans = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 8), toon(0xffffff));
  glans.position.set(0.2, 0.62, 0.3);
  glans.userData.ingenKontur = true;
  modell.add(glans);
  for (const sida of [-1, 1]) {
    const oga = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), toon(0x2a1a2e));
    oga.position.set(sida * 0.17, 0.48, 0.42);
    modell.add(oga);
  }
  const mun = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.015, 6, 10, Math.PI), toon(0x2a1a2e));
  mun.position.set(0, 0.38, 0.47);
  mun.rotation.z = Math.PI;
  modell.add(mun);
  kontur(grupp, 0.07);
  skuggor(grupp);
  return { grupp, modell, kropp };
}

// ---------- Draken ----------
export function byggDrake() {
  const grupp = new THREE.Group();
  const modell = new THREE.Group();
  grupp.add(modell);
  const LILA = 0x8e5cd9, ORANGE = 0xffb45c, ROSA = 0xff9de2;
  const kroppsmaterial = [];
  const lila = () => { const m = toon(LILA); kroppsmaterial.push(m); return m; };

  const kropp = new THREE.Mesh(new THREE.SphereGeometry(1.25, 16, 14), lila());
  kropp.scale.set(1, 1.08, 1.2);
  kropp.position.y = 1.5;
  modell.add(kropp);
  const mage = new THREE.Mesh(new THREE.SphereGeometry(0.95, 14, 12), toon(ORANGE));
  mage.scale.set(0.85, 1, 0.6);
  mage.position.set(0, 1.35, 0.62);
  modell.add(mage);

  const huvud = new THREE.Group();
  const skalle = new THREE.Mesh(new THREE.SphereGeometry(0.72, 16, 12), lila());
  huvud.add(skalle);
  const nos = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), lila());
  nos.scale.set(1, 0.7, 1);
  nos.position.set(0, -0.15, 0.55);
  huvud.add(nos);
  for (const sida of [-1, 1]) {
    const oga = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), toon(0xffffff));
    oga.position.set(sida * 0.3, 0.22, 0.52);
    huvud.add(oga);
    const pupill = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), toon(0x2a1a2e));
    pupill.position.set(sida * 0.3, 0.22, 0.66);
    huvud.add(pupill);
    const bryn = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.06, 0.08), lila());
    bryn.position.set(sida * 0.3, 0.42, 0.55);
    bryn.rotation.z = sida * 0.45;
    huvud.add(bryn);
    const nasborre = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), toon(0x5a3a80));
    nasborre.position.set(sida * 0.13, -0.1, 0.93);
    huvud.add(nasborre);
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.42, 8), toon(0xfff1d6));
    horn.position.set(sida * 0.33, 0.62, -0.05);
    horn.rotation.z = sida * -0.35;
    huvud.add(horn);
  }
  huvud.position.set(0, 3.0, 0.75);
  modell.add(huvud);

  // Vingar
  const vingar = [];
  for (const sida of [-1, 1]) {
    const ving = new THREE.Group();
    const membran = new THREE.Mesh(new THREE.ConeGeometry(0.95, 1.9, 3), toon(ROSA, { side: THREE.DoubleSide }));
    membran.scale.z = 0.12;
    membran.rotation.z = sida * (Math.PI / 2 + 0.25);
    membran.position.x = sida * 0.95;
    ving.add(membran);
    ving.position.set(sida * 0.75, 2.3, -0.5);
    modell.add(ving);
    vingar.push(ving);
  }

  // Svans
  let svansFäste = modell;
  const svansdelar = [];
  for (let i = 0; i < 3; i++) {
    const del = new THREE.Mesh(new THREE.SphereGeometry(0.45 - i * 0.12, 10, 8), lila());
    del.position.set(0, i === 0 ? 1.0 : -0.12, i === 0 ? -1.3 : -0.42);
    svansFäste.add(del);
    svansFäste = del;
    svansdelar.push(del);
  }
  const svanspets = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.4, 6), toon(ORANGE));
  svanspets.rotation.x = -Math.PI / 2;
  svanspets.position.set(0, 0, -0.45);
  svansFäste.add(svanspets);

  // Ben
  for (const sida of [-1, 1]) {
    for (const fram of [0.55, -0.55]) {
      const ben = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.7, 10), lila());
      ben.position.set(sida * 0.72, 0.35, fram);
      modell.add(ben);
    }
  }

  kontur(grupp, 0.045);
  skuggor(grupp);
  return { grupp, modell, huvud, vingar, kroppsmaterial };
}

// ---------- Enhörningen ----------
export function byggEnhorning() {
  const grupp = new THREE.Group();
  const modell = new THREE.Group();
  grupp.add(modell);
  const VIT = 0xfdfdff, GULD = 0xffcf5c;
  const REGNBAGE = [0xff6b6b, 0xffa94d, 0xffe066, 0x8ce99a, 0x74c0fc, 0xb197fc];

  const kropp = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.75, 6, 12), toon(VIT));
  kropp.rotation.z = Math.PI / 2;
  kropp.position.y = 0.95;
  modell.add(kropp);
  for (const sida of [-1, 1]) {
    for (const fram of [0.42, -0.42]) {
      const ben = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.08, 0.62, 8), toon(VIT));
      ben.position.set(fram, 0.35, sida * 0.22);
      modell.add(ben);
      const hov = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.1, 8), toon(GULD));
      hov.position.set(fram, 0.06, sida * 0.22);
      modell.add(hov);
    }
  }
  const hals = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.5, 4, 10), toon(VIT));
  hals.position.set(0.62, 1.45, 0);
  hals.rotation.z = -0.5;
  modell.add(hals);
  const huvudGrupp = new THREE.Group();
  const skalle = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), toon(VIT));
  huvudGrupp.add(skalle);
  const nos = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), toon(0xffd7e8));
  nos.position.set(0.22, -0.06, 0);
  huvudGrupp.add(nos);
  for (const sida of [-1, 1]) {
    const oga = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), toon(0x2a1a2e));
    oga.position.set(0.12, 0.08, sida * 0.18);
    huvudGrupp.add(oga);
    const ora = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 6), toon(VIT));
    ora.position.set(-0.08, 0.27, sida * 0.12);
    huvudGrupp.add(ora);
  }
  const hornet = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.45, 8), toon(GULD));
  hornet.position.set(0.1, 0.38, 0);
  hornet.rotation.z = -0.25;
  huvudGrupp.add(hornet);
  huvudGrupp.position.set(0.85, 1.85, 0);
  modell.add(huvudGrupp);

  // Regnbågsman och svans
  REGNBAGE.forEach((farg, i) => {
    const man = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 8), toon(farg));
    const t = i / (REGNBAGE.length - 1);
    man.position.set(0.75 - t * 0.55, 1.95 - t * 0.55, -0.12);
    modell.add(man);
    const svans = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), toon(farg));
    svans.position.set(-0.75 - t * 0.25, 1.15 - t * 0.42, 0);
    modell.add(svans);
  });

  kontur(grupp, 0.05);
  skuggor(grupp);

  // Den magiska bubblan som draken fångat enhörningen i
  const bubbla = new THREE.Mesh(
    new THREE.SphereGeometry(1.7, 20, 16),
    toon(0xffb3d9, { transparent: true, opacity: 0.32 })
  );
  bubbla.position.y = 1.2;
  bubbla.userData.ingenKontur = true;
  grupp.add(bubbla);

  return { grupp, modell, huvudGrupp, bubbla };
}

// ---------- Föremål ----------
function hjartGeometri() {
  const s = new THREE.Shape();
  const x = -0.25, y = -0.45;
  s.moveTo(x + 0.25, y + 0.25);
  s.bezierCurveTo(x + 0.25, y + 0.25, x + 0.2, y, x, y);
  s.bezierCurveTo(x - 0.3, y, x - 0.3, y + 0.35, x - 0.3, y + 0.35);
  s.bezierCurveTo(x - 0.3, y + 0.55, x - 0.1, y + 0.77, x + 0.25, y + 0.95);
  s.bezierCurveTo(x + 0.6, y + 0.77, x + 0.8, y + 0.55, x + 0.8, y + 0.35);
  s.bezierCurveTo(x + 0.8, y + 0.35, x + 0.8, y, x + 0.5, y);
  s.bezierCurveTo(x + 0.35, y, x + 0.25, y + 0.25, x + 0.25, y + 0.25);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.22, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 2 });
  geo.center();
  geo.rotateZ(Math.PI);
  return geo;
}
let HJARTGEO = null;

export function byggHjarta() {
  if (!HJARTGEO) HJARTGEO = hjartGeometri();
  const grupp = new THREE.Group();
  const hjarta = new THREE.Mesh(HJARTGEO, toon(0xff5c8a));
  hjarta.scale.setScalar(0.75);
  grupp.add(hjarta);
  kontur(grupp, 0.08);
  skuggor(grupp);
  return grupp;
}

export function byggNyckel() {
  const grupp = new THREE.Group();
  const GULD = toon(0xffcf5c);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.07, 8, 16), GULD);
  ring.position.y = 0.3;
  const skaft = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.55, 8), GULD);
  skaft.position.y = -0.15;
  const tand1 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.08), GULD);
  tand1.position.set(0.12, -0.38, 0);
  const tand2 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.08), GULD);
  tand2.position.set(0.09, -0.24, 0);
  grupp.add(ring, skaft, tand1, tand2);
  kontur(grupp, 0.09);
  skuggor(grupp);
  return grupp;
}

function stjarnGeometri() {
  const s = new THREE.Shape();
  const spetsar = 5, yttre = 0.32, inre = 0.13;
  for (let i = 0; i < spetsar * 2; i++) {
    const r = i % 2 === 0 ? yttre : inre;
    const v = (i / (spetsar * 2)) * Math.PI * 2 - Math.PI / 2;
    if (i === 0) s.moveTo(Math.cos(v) * r, Math.sin(v) * r);
    else s.lineTo(Math.cos(v) * r, Math.sin(v) * r);
  }
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.1, bevelEnabled: false });
  geo.center();
  return geo;
}
let STJARNGEO = null;

export function byggStjarna() {
  if (!STJARNGEO) STJARNGEO = stjarnGeometri();
  const m = new THREE.Mesh(STJARNGEO, new THREE.MeshBasicMaterial({ color: 0xffe066 }));
  return m;
}

export function byggEldklot() {
  const grupp = new THREE.Group();
  const yttre = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xff8c42, transparent: true, opacity: 0.9 }));
  const inre = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xffe08a }));
  grupp.add(yttre, inre);
  return grupp;
}
