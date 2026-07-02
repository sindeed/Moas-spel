// world.js — bygger slottsvärlden utifrån Moas handritade karta
import * as THREE from './lib/three.module.min.js';
import { toon, slump } from './verktyg.js';

export const TILE = 4;

// Moas karta översatt till rutnät:
// # = mur   . = golv   P = prinsessan Moa   H = hjärta   K = nyckel
// D = låst dörr   G = spöke   S = slime   B = draken   U = enhörningen   F = blomman
export const KARTA = [
  '##########################',
  '#.....#......H.....#..U..#',
  '#..P..#............#.....#',
  '#.....#..G......S..#..B..#',
  '###.######.########......#',
  '#.................####D###',
  '#..........#...#..#......#',
  '#..........#.H.#..#...H..#',
  '#...G......#...#..#......#',
  '#..........#...#..D......#',
  '#..........#.K.#..#..G...#',
  '#..S.......#...#..#......#',
  '#..........#...#..#......#',
  '#.....##.####.###.#......#',
  '#...F.....S.......#......#',
  '#.........K...G...#...H..#',
  '#.................#......#',
  '##########################',
];

export const RADER = KARTA.length;
export const KOLUMNER = KARTA[0].length;

export function tillVarld(kol, rad) {
  return new THREE.Vector3(
    (kol - (KOLUMNER - 1) / 2) * TILE,
    0,
    (rad - (RADER - 1) / 2) * TILE
  );
}

function tegelTextur() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#eba7c9';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#f9d9e9';
  g.lineWidth = 5;
  for (let rad = 0; rad < 4; rad++) {
    const y = rad * 32;
    g.beginPath(); g.moveTo(0, y); g.lineTo(128, y); g.stroke();
    const skift = rad % 2 === 0 ? 0 : 32;
    for (let x = skift; x <= 128; x += 64) {
      g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 32); g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function golvTextur() {
  const px = 32;
  const c = document.createElement('canvas');
  c.width = KOLUMNER * px; c.height = RADER * px;
  const g = c.getContext('2d');
  for (let r = 0; r < RADER; r++) {
    for (let k = 0; k < KOLUMNER; k++) {
      g.fillStyle = (r + k) % 2 === 0 ? '#fff3e8' : '#ffdcec';
      g.fillRect(k * px, r * px, px, px);
      // små prickar och blomblad här och där
      if (slump(r * 131 + k * 7) < 0.14) {
        g.fillStyle = 'rgba(255,150,200,0.35)';
        g.beginPath();
        g.arc(k * px + 8 + slump(r + k) * 16, r * px + 8 + slump(r * 3 + k) * 16, 2.5, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

function himmelTextur() {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#ffeef8');
  grad.addColorStop(0.5, '#f4d5f2');
  grad.addColorStop(1, '#cdb6f7');
  g.fillStyle = grad;
  g.fillRect(0, 0, 8, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function byggMoln() {
  const grupp = new THREE.Group();
  const mat = toon(0xffffff);
  const delar = [
    [0, 0, 0, 1.6], [1.4, -0.2, 0.3, 1.1], [-1.4, -0.15, -0.2, 1.2], [0.5, 0.5, -0.3, 1.0],
  ];
  for (const [x, y, z, s] of delar) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), mat);
    m.position.set(x, y, z);
    m.scale.set(s, s * 0.7, s);
    grupp.add(m);
  }
  return grupp;
}

function byggTorn(x, z) {
  const grupp = new THREE.Group();
  const kropp = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3, 8, 12), toon(0xf3b9d3));
  kropp.position.y = 4;
  kropp.castShadow = true;
  const tak = new THREE.Mesh(new THREE.ConeGeometry(3.3, 3.4, 12), toon(0xd97fb8));
  tak.position.y = 9.6;
  tak.castShadow = true;
  const flaggstang = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.6), toon(0xffcf5c));
  flaggstang.position.y = 12;
  const flagga = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.0, 4), toon(0xffcf5c));
  flagga.rotation.z = -Math.PI / 2;
  flagga.position.set(0.55, 12.4, 0);
  grupp.add(kropp, tak, flaggstang, flagga);
  grupp.position.set(x, 0, z);
  return grupp;
}

function byggBlomma() {
  // Den stora blomman från Moas teckning (nere till vänster på kartan)
  const grupp = new THREE.Group();
  const stjalk = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 2.4, 8), toon(0x6fbf6a));
  stjalk.position.y = 1.2;
  stjalk.castShadow = true;
  grupp.add(stjalk);
  for (const sida of [-1, 1]) {
    const blad = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), toon(0x7ccf74));
    blad.scale.set(1.3, 0.3, 0.6);
    blad.position.set(sida * 0.5, 0.8 + (sida > 0 ? 0.25 : 0), 0);
    blad.rotation.z = sida * -0.5;
    grupp.add(blad);
  }
  const mitt = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 10), toon(0xffd94d));
  mitt.position.y = 2.6;
  mitt.castShadow = true;
  grupp.add(mitt);
  for (let i = 0; i < 7; i++) {
    const v = (i / 7) * Math.PI * 2;
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), toon(0xff8fc4));
    p.position.set(Math.cos(v) * 0.62, 2.6 + Math.sin(v) * 0.62, 0.05);
    p.scale.z = 0.55;
    grupp.add(p);
  }
  return grupp;
}

function byggKristall(i) {
  const farger = [0xff9fd0, 0xc9a6ff, 0x9fdcff, 0xffd166];
  const m = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.35 + slump(i) * 0.3, 0),
    toon(farger[Math.floor(slump(i * 3) * farger.length)], { transparent: true, opacity: 0.9 })
  );
  m.position.y = 0.35;
  m.rotation.set(slump(i * 5) * 0.6, slump(i * 7) * Math.PI, 0);
  m.castShadow = true;
  return m;
}

function byggFjaril(i) {
  const grupp = new THREE.Group();
  const farg = [0xff8fc4, 0xc9a6ff, 0xffd166][i % 3];
  const kropp = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.2, 3, 6), toon(0x5a4160));
  kropp.rotation.x = Math.PI / 2;
  grupp.add(kropp);
  const vingGeo = new THREE.CircleGeometry(0.22, 8);
  const vingMat = toon(farg, { side: THREE.DoubleSide });
  const vingL = new THREE.Mesh(vingGeo, vingMat);
  const vingR = new THREE.Mesh(vingGeo, vingMat);
  vingL.position.x = -0.13; vingR.position.x = 0.13;
  grupp.add(vingL, vingR);
  grupp.userData = { vingL, vingR };
  return grupp;
}

function byggDorr(vertikal) {
  // Gyllene port med rosa galler som glider upp när den låses upp
  const grupp = new THREE.Group();
  const guld = toon(0xffc94d);
  const rosa = toon(0xff86bf);
  for (const sida of [-1, 1]) {
    const stolpe = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.4, 0.6), guld);
    stolpe.position.set(sida * (TILE / 2 - 0.25), 1.7, 0);
    stolpe.castShadow = true;
    grupp.add(stolpe);
  }
  const balk = new THREE.Mesh(new THREE.BoxGeometry(TILE, 0.5, 0.6), guld);
  balk.position.y = 3.15;
  balk.castShadow = true;
  grupp.add(balk);
  const galler = new THREE.Group();
  for (let i = -1; i <= 1; i++) {
    const stang = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.9, 8), rosa);
    stang.position.set(i * 0.9, 1.45, 0);
    galler.add(stang);
  }
  const tvarslad = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.16, 0.2), rosa);
  tvarslad.position.y = 1.5;
  galler.add(tvarslad);
  const las = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), guld);
  las.position.set(0, 1.5, 0.3);
  galler.add(las);
  grupp.add(galler);
  grupp.userData.galler = galler;
  if (vertikal) grupp.rotation.y = Math.PI / 2;
  return grupp;
}

export function byggVarld(scen) {
  const info = {
    solid: [],
    dorrar: [],
    hjartan: [],
    nycklar: [],
    spoken: [],
    slimes: [],
    start: null,
    drakePos: null,
    enhorningPos: null,
    moln: [],
    fjarilar: [],
    blomma: null,
  };

  // Läs kartan
  for (let r = 0; r < RADER; r++) {
    info.solid.push([]);
    for (let k = 0; k < KOLUMNER; k++) {
      const c = KARTA[r][k];
      info.solid[r].push(c === '#');
      const pos = tillVarld(k, r);
      if (c === 'P') info.start = pos;
      if (c === 'H') info.hjartan.push(pos);
      if (c === 'K') info.nycklar.push(pos);
      if (c === 'G') info.spoken.push(pos);
      if (c === 'S') info.slimes.push(pos);
      if (c === 'B') info.drakePos = pos;
      if (c === 'U') info.enhorningPos = pos;
      if (c === 'D') info.dorrar.push({ kol: k, rad: r });
      if (c === 'F') info.blommaPos = pos;
    }
  }
  // Dörrar är solida tills de öppnas
  for (const d of info.dorrar) info.solid[d.rad][d.kol] = true;

  // Himmel och dis
  scen.background = himmelTextur();
  scen.fog = new THREE.Fog(0xf3d3ee, 70, 170);

  // Golv
  const golv = new THREE.Mesh(
    new THREE.PlaneGeometry(KOLUMNER * TILE, RADER * TILE),
    toon(0xffffff, { map: golvTextur() })
  );
  golv.rotation.x = -Math.PI / 2;
  golv.receiveShadow = true;
  scen.add(golv);

  // Gräsmatta runt slottet
  const mark = new THREE.Mesh(new THREE.CircleGeometry(220, 40), toon(0xa8df9a));
  mark.rotation.x = -Math.PI / 2;
  mark.position.y = -0.05;
  scen.add(mark);

  // Murar (instansierade lådor med tegelmönster)
  const murTiles = [];
  for (let r = 0; r < RADER; r++) {
    for (let k = 0; k < KOLUMNER; k++) {
      if (KARTA[r][k] === '#') murTiles.push([k, r]);
    }
  }
  const murGeo = new THREE.BoxGeometry(TILE, 3.2, TILE);
  const murMat = toon(0xffffff, { map: tegelTextur() });
  const murar = new THREE.InstancedMesh(murGeo, murMat, murTiles.length);
  const mtx = new THREE.Matrix4();
  const kant = new THREE.Color(0xffe9f2);
  murTiles.forEach(([k, r], i) => {
    const pos = tillVarld(k, r);
    const ytterkant = r === 0 || r === RADER - 1 || k === 0 || k === KOLUMNER - 1;
    const h = (ytterkant ? 1.12 : 1) + (slump(i) - 0.5) * 0.08;
    mtx.makeScale(1, h, 1);
    mtx.setPosition(pos.x, 1.6 * h, pos.z);
    murar.setMatrixAt(i, mtx);
    murar.setColorAt(i, kant.clone().offsetHSL(0, 0, (slump(i * 13) - 0.5) * 0.08));
  });
  murar.instanceMatrix.needsUpdate = true;
  if (murar.instanceColor) murar.instanceColor.needsUpdate = true;
  murar.castShadow = true;
  murar.receiveShadow = true;
  scen.add(murar);

  // Fyra sagotorn i hörnen
  const hörn = [
    tillVarld(0, 0), tillVarld(KOLUMNER - 1, 0),
    tillVarld(0, RADER - 1), tillVarld(KOLUMNER - 1, RADER - 1),
  ];
  for (const h of hörn) scen.add(byggTorn(h.x, h.z));

  // Dörrar
  for (const d of info.dorrar) {
    const vertikal = KARTA[d.rad][d.kol - 1] !== '#' || KARTA[d.rad][d.kol + 1] !== '#';
    const mesh = byggDorr(vertikal);
    const pos = tillVarld(d.kol, d.rad);
    mesh.position.set(pos.x, 0, pos.z);
    scen.add(mesh);
    d.mesh = mesh;
    d.oppen = false;
    d.animation = 0;
    d.meddelandeTid = 0;
  }

  // Moln som seglar förbi
  for (let i = 0; i < 6; i++) {
    const moln = byggMoln();
    moln.position.set((slump(i * 11) - 0.5) * 140, 20 + slump(i * 17) * 8, (slump(i * 23) - 0.5) * 110);
    moln.scale.setScalar(1.2 + slump(i * 29) * 1.4);
    scen.add(moln);
    info.moln.push({ mesh: moln, fart: 0.6 + slump(i * 31) * 0.8 });
  }

  // Blomman från teckningen
  if (info.blommaPos) {
    const blomma = byggBlomma();
    blomma.position.copy(info.blommaPos);
    scen.add(blomma);
    info.blomma = blomma;
  }

  // Kristaller utspridda på lediga golvrutor
  let antalKristaller = 0;
  for (let r = 1; r < RADER - 1 && antalKristaller < 16; r++) {
    for (let k = 1; k < KOLUMNER - 1 && antalKristaller < 16; k++) {
      if (KARTA[r][k] !== '.') continue;
      if (r <= 4 && k >= 19) continue; // inte i drakens rum
      if (slump(r * 37 + k * 11) < 0.045) {
        const kristall = byggKristall(r * 100 + k);
        const pos = tillVarld(k, r);
        kristall.position.x = pos.x + (slump(k * 3 + r) - 0.5) * 1.6;
        kristall.position.z = pos.z + (slump(k * 7 + r) - 0.5) * 1.6;
        scen.add(kristall);
        antalKristaller++;
      }
    }
  }

  // Fjärilar i trädgården
  for (let i = 0; i < 3; i++) {
    const fjaril = byggFjaril(i);
    const bas = tillVarld(5 + i * 4, 14);
    fjaril.position.copy(bas);
    scen.add(fjaril);
    info.fjarilar.push({ mesh: fjaril, bas, fas: i * 2.1 });
  }

  // Uppdaterar dekor varje bildruta (moln, blomma, fjärilar)
  info.uppdateraDekor = (t, dt) => {
    for (const m of info.moln) {
      m.mesh.position.x += m.fart * dt;
      if (m.mesh.position.x > 90) m.mesh.position.x = -90;
    }
    if (info.blomma) info.blomma.rotation.z = Math.sin(t * 1.2) * 0.06;
    for (const f of info.fjarilar) {
      const { mesh, bas, fas } = f;
      mesh.position.set(
        bas.x + Math.sin(t * 0.5 + fas) * 6,
        1.6 + Math.sin(t * 1.3 + fas) * 0.7,
        bas.z + Math.cos(t * 0.37 + fas) * 4
      );
      mesh.rotation.y = t * 0.5 + fas;
      const flax = Math.sin(t * 14 + fas) * 0.9;
      mesh.userData.vingL.rotation.y = flax;
      mesh.userData.vingR.rotation.y = -flax;
    }
  };

  return info;
}
