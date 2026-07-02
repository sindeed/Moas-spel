// game.js — Prinsessans skattjakt: huvudmotorn
// Prinsessan Moa letar nycklar, besegrar draken och räddar den förtrollade enhörningen!
import * as THREE from './lib/three.module.min.js';
import { TILE, KARTA, RADER, KOLUMNER, tillVarld, byggVarld } from './world.js';
import { kontur, lerp } from './verktyg.js';
import {
  byggPrinsessa, byggSpoke, byggSlime, byggDrake, byggEnhorning,
  byggHjarta, byggNyckel, byggStjarna, byggEldklot,
} from './entities.js';
import { Ljud } from './audio.js';

// ---------- Grund ----------
const ljud = new Ljud();
const klocka = new THREE.Clock();
let scen, kamera, renderare, varld;

const spel = {
  igang: false,
  klar: false,
  doende: false,
  hjartan: 5,
  maxHjartan: 5,
  nycklar: 0,
  osarbar: 0,
  startTid: 0,
};

const spelare = {
  grupp: null,
  modell: null,
  delar: null,
  radie: 0.72,
  fart: 8,
  vinkel: 0,
  y: 0,
  vy: 0,
  iLuften: false,
  sving: 0,
  svingTraff: false,
  kastCd: 0,
  kastAnim: 0,
  knock: new THREE.Vector3(),
  blink: 0,
};

const fiender = [];      // spöken och slimes
const stjarnor = [];     // prinsessans magiska stjärnskott
const eldklot = [];      // drakens eldklot
const partiklar = [];
const foremal = [];      // hjärtan och nycklar

const boss = {
  drake: null, aktiv: false, besegrad: false, hp: 10, maxHp: 10,
  attackTimer: 2.5, flash: 0, flyktTid: 0, gronhet: 0,
  rum: null,
};
let enhorning = null;
let enhorningRaddad = false;
let enhorningBas = null;

// ---------- DOM ----------
const el = (id) => document.getElementById(id);
let hudHjartanEl, hudNycklarEl, meddelandeEl, bossrutaEl, bosshpEl;
let medTimeout = null;

function meddelande(text, tid = 2.8) {
  meddelandeEl.textContent = text;
  meddelandeEl.classList.add('visas');
  clearTimeout(medTimeout);
  medTimeout = setTimeout(() => meddelandeEl.classList.remove('visas'), tid * 1000);
}

function uppdateraHjartan() {
  let html = '';
  for (let i = 0; i < spel.maxHjartan; i++) {
    html += `<span class="${i < spel.hjartan ? 'hjarta' : 'hjarta tom'}">♥</span>`;
  }
  hudHjartanEl.innerHTML = html;
}

function uppdateraNycklar() {
  hudNycklarEl.textContent = `🗝️ × ${spel.nycklar}`;
}

// ---------- Partiklar ----------
const partikelGeo = new THREE.SphereGeometry(1, 6, 5);
function explosion(pos, farg, antal = 12, kraft = 5, storlek = 0.13, liv = 0.7, grav = 7) {
  if (partiklar.length > 280) return;
  for (let i = 0; i < antal; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: farg, transparent: true });
    const m = new THREE.Mesh(partikelGeo, mat);
    m.scale.setScalar(storlek * (0.6 + Math.random() * 0.8));
    m.position.copy(pos);
    scen.add(m);
    const v = new THREE.Vector3(
      (Math.random() - 0.5) * 2, Math.random() * 0.9 + 0.2, (Math.random() - 0.5) * 2
    ).normalize().multiplyScalar(kraft * (0.5 + Math.random() * 0.8));
    partiklar.push({ mesh: m, v, liv: liv * (0.7 + Math.random() * 0.6), maxLiv: liv, grav });
  }
}

function uppdateraPartiklar(dt) {
  for (let i = partiklar.length - 1; i >= 0; i--) {
    const p = partiklar[i];
    p.liv -= dt;
    if (p.liv <= 0 || p.mesh.position.y < -0.5) {
      scen.remove(p.mesh);
      p.mesh.material.dispose();
      partiklar.splice(i, 1);
      continue;
    }
    p.mesh.position.addScaledVector(p.v, dt);
    p.v.y -= p.grav * dt;
    p.mesh.material.opacity = Math.max(0, p.liv / p.maxLiv);
  }
}

// ---------- Kollisioner mot murarna ----------
const CK = (KOLUMNER - 1) / 2, CR = (RADER - 1) / 2;

function solidVid(k, r) {
  if (r < 0 || r >= RADER || k < 0 || k >= KOLUMNER) return true;
  return varld.solid[r][k];
}

function krockar(x, z, radie) {
  const kMin = Math.round((x - radie) / TILE + CK), kMax = Math.round((x + radie) / TILE + CK);
  const rMin = Math.round((z - radie) / TILE + CR), rMax = Math.round((z + radie) / TILE + CR);
  for (let r = rMin; r <= rMax; r++) {
    for (let k = kMin; k <= kMax; k++) {
      if (!solidVid(k, r)) continue;
      const cx = (k - CK) * TILE, cz = (r - CR) * TILE;
      const nx = Math.max(cx - TILE / 2, Math.min(x, cx + TILE / 2));
      const nz = Math.max(cz - TILE / 2, Math.min(z, cz + TILE / 2));
      if ((x - nx) ** 2 + (z - nz) ** 2 < radie * radie) return true;
    }
  }
  return false;
}

function flytta(pos, dx, dz, radie) {
  if (dx !== 0 && !krockar(pos.x + dx, pos.z, radie)) pos.x += dx;
  if (dz !== 0 && !krockar(pos.x, pos.z + dz, radie)) pos.z += dz;
}

// ---------- Styrning ----------
const tangenter = new Set();
const styrspak = { aktiv: false, id: null, x: 0, y: 0 };

function inmatning() {
  let x = 0, z = 0;
  if (tangenter.has('ArrowLeft') || tangenter.has('KeyA')) x -= 1;
  if (tangenter.has('ArrowRight') || tangenter.has('KeyD')) x += 1;
  if (tangenter.has('ArrowUp') || tangenter.has('KeyW')) z -= 1;
  if (tangenter.has('ArrowDown') || tangenter.has('KeyS')) z += 1;
  x += styrspak.x;
  z += styrspak.y;
  const v = new THREE.Vector2(x, z);
  if (v.length() > 1) v.normalize();
  return v;
}

function tryckAttack() {
  if (!spel.igang || spel.klar || spel.doende) return;
  if (spelare.sving <= 0) {
    spelare.sving = 0.32;
    spelare.svingTraff = false;
    ljud.svard();
  }
}

function tryckMagi() {
  if (!spel.igang || spel.klar || spel.doende) return;
  if (spelare.kastCd <= 0) {
    spelare.kastCd = 0.5;
    spelare.kastAnim = 0.25;
    ljud.magi();
    const dir = new THREE.Vector3(Math.sin(spelare.vinkel), 0, Math.cos(spelare.vinkel));
    const stjarna = byggStjarna();
    stjarna.position.copy(spelare.grupp.position).add(new THREE.Vector3(0, 1.4, 0)).addScaledVector(dir, 0.8);
    scen.add(stjarna);
    stjarnor.push({ mesh: stjarna, v: dir.multiplyScalar(19), liv: 1.2, glitter: 0 });
  }
}

function tryckHopp() {
  if (!spel.igang || spel.klar || spel.doende) return;
  if (!spelare.iLuften) {
    spelare.vy = 9.5;
    spelare.iLuften = true;
    ljud.hopp();
  }
}

function kopplaStyrning() {
  window.addEventListener('keydown', (e) => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    tangenter.add(e.code);
    if (['Space', 'KeyZ', 'KeyJ'].includes(e.code)) tryckAttack();
    if (['KeyE', 'KeyX', 'KeyK'].includes(e.code)) tryckMagi();
    if (['ShiftLeft', 'ShiftRight', 'KeyC'].includes(e.code)) tryckHopp();
  });
  window.addEventListener('keyup', (e) => tangenter.delete(e.code));

  const duk = renderare.domElement;
  duk.addEventListener('pointerdown', (e) => { if (e.button === 0 && !arTouch) tryckAttack(); });
  duk.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!arTouch) tryckMagi(); });

  // Pekskärmsstyrning
  if (arTouch) {
    el('touch').classList.remove('gomd');
    const zon = el('styrspak');
    const knopp = el('spakKnopp');
    const uppdateraSpak = (e) => {
      const rekt = zon.getBoundingClientRect();
      const cx = rekt.left + rekt.width / 2, cy = rekt.top + rekt.height / 2;
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const max = rekt.width / 2 - 18;
      const len = Math.hypot(dx, dy);
      if (len > max) { dx = (dx / len) * max; dy = (dy / len) * max; }
      knopp.style.transform = `translate(${dx}px, ${dy}px)`;
      styrspak.x = dx / max;
      styrspak.y = dy / max;
    };
    zon.addEventListener('pointerdown', (e) => {
      styrspak.aktiv = true; styrspak.id = e.pointerId;
      zon.setPointerCapture(e.pointerId);
      uppdateraSpak(e);
    });
    zon.addEventListener('pointermove', (e) => { if (styrspak.aktiv && e.pointerId === styrspak.id) uppdateraSpak(e); });
    const slappSpak = (e) => {
      if (e.pointerId !== styrspak.id) return;
      styrspak.aktiv = false; styrspak.x = 0; styrspak.y = 0;
      knopp.style.transform = 'translate(0px, 0px)';
    };
    zon.addEventListener('pointerup', slappSpak);
    zon.addEventListener('pointercancel', slappSpak);
    el('knappSvard').addEventListener('pointerdown', (e) => { e.preventDefault(); tryckAttack(); });
    el('knappMagi').addEventListener('pointerdown', (e) => { e.preventDefault(); tryckMagi(); });
    el('knappHopp').addEventListener('pointerdown', (e) => { e.preventDefault(); tryckHopp(); });
  }
}

const arTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

// ---------- Skada och strid ----------
function normaliseraVinkel(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// Avstånd i golvplanet (struntar i höjdled)
function planAvstand(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function svardTraff() {
  const pos = spelare.grupp.position;
  for (const f of [...fiender]) {
    const d = planAvstand(f.grupp.position, pos);
    if (d > 3.1) continue;
    const rikt = Math.atan2(f.grupp.position.x - pos.x, f.grupp.position.z - pos.z);
    if (Math.abs(normaliseraVinkel(rikt - spelare.vinkel)) < 1.15) {
      skadaFiende(f, 2);
    }
  }
  if (boss.aktiv && boss.drake) {
    const d = planAvstand(boss.drake.grupp.position, pos);
    if (d < 4.2) skadaBoss(2);
  }
}

function skadaFiende(f, n) {
  f.hp -= n;
  f.flash = 0.18;
  ljud.traff();
  const dir = f.grupp.position.clone().sub(spelare.grupp.position).setY(0).normalize();
  f.knock.copy(dir.multiplyScalar(9));
  f.grupp.traverse((m) => {
    if (m.isMesh && m.material.emissive) m.material.emissive.setHex(0xffffff);
  });
  if (f.hp <= 0) {
    ljud.poff();
    explosion(f.grupp.position.clone().add(new THREE.Vector3(0, 1, 0)),
      f.typ === 'spoke' ? 0xf4f7ff : 0xc59fff, 16, 5, 0.15, 0.8, 3);
    scen.remove(f.grupp);
    fiender.splice(fiender.indexOf(f), 1);
  }
}

function taSkada(fran) {
  if (spel.osarbar > 0 || spel.doende || spel.klar || !spel.igang) return;
  spel.hjartan--;
  uppdateraHjartan();
  ljud.aj();
  spel.osarbar = 1.3;
  const dir = spelare.grupp.position.clone().sub(fran).setY(0);
  if (dir.lengthSq() < 0.01) dir.set(0, 0, 1);
  spelare.knock.copy(dir.normalize().multiplyScalar(11));
  explosion(spelare.grupp.position.clone().add(new THREE.Vector3(0, 1.2, 0)), 0xff5c8a, 8, 4, 0.1, 0.5, 6);
  if (spel.hjartan <= 0) besegrad();
}

function besegrad() {
  spel.doende = true;
  el('svartfade').classList.add('visas');
  setTimeout(() => {
    spelare.grupp.position.copy(varld.start);
    spelare.knock.set(0, 0, 0);
    spelare.y = 0; spelare.vy = 0; spelare.iLuften = false;
    spel.hjartan = spel.maxHjartan;
    spel.osarbar = 2;
    uppdateraHjartan();
    if (boss.aktiv) {
      boss.aktiv = false;
      boss.hp = boss.maxHp;
      bossrutaEl.classList.add('gomd');
      for (const e of eldklot) scen.remove(e.grupp);
      eldklot.length = 0;
      if (boss.drake) boss.drake.grupp.position.copy(boss.hem);
      ljud.spelaLat('aventyr');
    }
    el('svartfade').classList.remove('visas');
    spel.doende = false;
    meddelande('Upp igen! Prinsessan Moa ger aldrig upp! 💪');
  }, 1400);
}

// ---------- Bossen ----------
function skadaBoss(n) {
  if (!boss.aktiv || boss.besegrad) return;
  boss.hp = Math.max(0, boss.hp - n);
  boss.flash = 0.2;
  ljud.traff();
  bosshpEl.style.width = `${(boss.hp / boss.maxHp) * 100}%`;
  for (const m of boss.drake.kroppsmaterial) m.emissive.setHex(0xffffff);
  if (boss.hp <= 0) bossBesegrad();
}

function startaBoss() {
  boss.aktiv = true;
  bossrutaEl.classList.remove('gomd');
  bosshpEl.style.width = '100%';
  ljud.vral();
  ljud.spelaLat('drake');
  meddelande('Draken vaknar! Rädda enhörningen! 🐉', 3);
}

function bossBesegrad() {
  boss.aktiv = false;
  boss.besegrad = true;
  boss.flyktTid = 3;
  bossrutaEl.classList.add('gomd');
  for (const e of eldklot) scen.remove(e.grupp);
  eldklot.length = 0;
  ljud.stoppaMusik();
  ljud.vral();
  meddelande('Draken ger sig! Han ville egentligen bara ha en vän 💜', 3.5);
  setTimeout(() => {
    // Bubblan spricker och enhörningen är fri!
    ljud.bubbla();
    enhorningRaddad = true;
    explosion(enhorning.grupp.position.clone().add(new THREE.Vector3(0, 1.5, 0)), 0xffb3d9, 24, 6, 0.18, 1, -2);
    enhorning.bubbla.visible = false;
    ljud.enhorningsljud();
    setTimeout(() => {
      ljud.fanfar();
      setTimeout(seger, 1600);
    }, 900);
  }, 2600);
}

function skjutEldklot() {
  const drakPos = boss.drake.grupp.position;
  const spelarePos = spelare.grupp.position;
  const bas = Math.atan2(spelarePos.x - drakPos.x, spelarePos.z - drakPos.z);
  ljud.eld();
  for (const spridning of [-0.32, 0, 0.32]) {
    const dir = new THREE.Vector3(Math.sin(bas + spridning), 0, Math.cos(bas + spridning));
    const klot = byggEldklot();
    klot.position.copy(drakPos).add(new THREE.Vector3(0, 2.6, 0)).addScaledVector(dir, 1.6);
    scen.add(klot);
    eldklot.push({ grupp: klot, v: dir.multiplyScalar(8.5), liv: 3.2 });
  }
}

// ---------- Seger ----------
function seger() {
  spel.klar = true;
  const sek = Math.floor(klocka.elapsedTime - spel.startTid);
  el('segerStats').textContent =
    `Du klarade det på ${Math.floor(sek / 60)} min ${sek % 60} s och hade ${spel.hjartan} ♥ kvar!`;
  el('seger').classList.remove('gomd');
  // Konfettiregn!
  const behallare = el('konfetti');
  const symboler = ['🎀', '✨', '💖', '⭐', '🦄', '👑', '💜'];
  for (let i = 0; i < 60; i++) {
    const s = document.createElement('span');
    s.textContent = symboler[Math.floor(Math.random() * symboler.length)];
    s.style.left = `${Math.random() * 100}%`;
    s.style.animationDuration = `${2.5 + Math.random() * 3}s`;
    s.style.animationDelay = `${Math.random() * 2.5}s`;
    s.style.fontSize = `${16 + Math.random() * 22}px`;
    behallare.appendChild(s);
  }
  setTimeout(() => ljud.spelaLat('aventyr'), 1200);
}

// ---------- Bygg spelvärlden ----------
function init() {
  renderare = new THREE.WebGLRenderer({ antialias: true });
  renderare.setSize(window.innerWidth, window.innerHeight);
  renderare.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderare.shadowMap.enabled = true;
  renderare.shadowMap.type = THREE.PCFSoftShadowMap;
  el('spelet').appendChild(renderare.domElement);

  scen = new THREE.Scene();
  kamera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 400);

  const himmelLjus = new THREE.HemisphereLight(0xfff3f9, 0xd9b8f5, 0.85);
  scen.add(himmelLjus);
  const sol = new THREE.DirectionalLight(0xfff2dd, 1.7);
  sol.position.set(35, 55, 25);
  sol.castShadow = true;
  sol.shadow.mapSize.set(2048, 2048);
  sol.shadow.camera.left = -80; sol.shadow.camera.right = 80;
  sol.shadow.camera.top = 80; sol.shadow.camera.bottom = -80;
  sol.shadow.camera.far = 160;
  scen.add(sol);

  varld = byggVarld(scen);

  // Prinsessan Moa
  const p = byggPrinsessa();
  spelare.grupp = p.grupp;
  spelare.modell = p.modell;
  spelare.delar = p;
  spelare.grupp.position.copy(varld.start);
  scen.add(spelare.grupp);

  // Föremål
  for (const pos of varld.hjartan) {
    const g = byggHjarta();
    g.position.copy(pos).setY(1.3);
    scen.add(g);
    foremal.push({ grupp: g, typ: 'hjarta', fas: Math.random() * 6 });
  }
  for (const pos of varld.nycklar) {
    const g = byggNyckel();
    g.position.copy(pos).setY(1.4);
    scen.add(g);
    foremal.push({ grupp: g, typ: 'nyckel', fas: Math.random() * 6 });
  }

  // Fiender
  for (const pos of varld.spoken) {
    const s = byggSpoke();
    s.grupp.position.copy(pos).setY(1.1);
    scen.add(s.grupp);
    fiender.push({
      typ: 'spoke', grupp: s.grupp, modell: s.modell, bas: pos.clone(),
      hp: 1, radie: 0.7, fart: 2.4, knock: new THREE.Vector3(), flash: 0, fas: Math.random() * 6,
    });
  }
  varld.slimes.forEach((pos, i) => {
    const s = byggSlime(i);
    s.grupp.position.copy(pos);
    scen.add(s.grupp);
    fiender.push({
      typ: 'slime', grupp: s.grupp, modell: s.modell, bas: pos.clone(),
      hp: 2, radie: 0.62, fart: 3.1, knock: new THREE.Vector3(), flash: 0, fas: Math.random() * 6,
    });
  });

  // Draken och enhörningen
  boss.drake = byggDrake();
  boss.drake.grupp.position.copy(varld.drakePos);
  boss.hem = varld.drakePos.clone();
  scen.add(boss.drake.grupp);

  enhorning = byggEnhorning();
  enhorning.grupp.position.copy(varld.enhorningPos);
  enhorning.grupp.rotation.y = -Math.PI / 2;
  enhorningBas = varld.enhorningPos.clone();
  scen.add(enhorning.grupp);

  // Drakens rum (för att veta när striden ska börja)
  const a = tillVarld(19, 1), b = tillVarld(24, 4);
  boss.rum = {
    xMin: a.x - TILE / 2, xMax: b.x + TILE / 2,
    zMin: a.z - TILE / 2, zMax: b.z + TILE / 2,
  };

  // HUD
  hudHjartanEl = el('hjartan');
  hudNycklarEl = el('nycklar');
  meddelandeEl = el('meddelande');
  bossrutaEl = el('bossruta');
  bosshpEl = el('bosshp');
  uppdateraHjartan();
  uppdateraNycklar();

  kopplaStyrning();

  el('startKnapp').addEventListener('click', () => {
    ljud.igang();
    ljud.spelaLat('aventyr');
    el('titel').classList.add('gomd');
    spel.igang = true;
    spel.startTid = klocka.elapsedTime;
    meddelande('Hitta nycklarna och rädda enhörningen! 🦄', 3.5);
  });

  el('spelaIgen').addEventListener('click', () => location.reload());

  el('tystKnapp').addEventListener('click', () => {
    const tyst = ljud.vaxlaTyst();
    el('tystKnapp').textContent = tyst ? '🔇' : '🔊';
  });

  window.addEventListener('resize', () => {
    kamera.aspect = window.innerWidth / window.innerHeight;
    kamera.updateProjectionMatrix();
    renderare.setSize(window.innerWidth, window.innerHeight);
  });

  renderare.setAnimationLoop(loop);

  // Krok för felsökning i webbläsarkonsolen
  window.__moa = { spel, spelare, boss, fiender, varld, foremal, skadaBoss, taSkada, tillVarld, tangenter, inmatning, klocka, steg };
}

// ---------- Uppdateringar per bildruta ----------
function uppdateraSpelare(dt, t) {
  const pos = spelare.grupp.position;
  const rikt = inmatning();
  const fart = spelare.fart * (spelare.iLuften ? 1.3 : 1);

  let dx = rikt.x * fart * dt;
  let dz = rikt.y * fart * dt;
  dx += spelare.knock.x * dt;
  dz += spelare.knock.z * dt;
  spelare.knock.multiplyScalar(Math.max(0, 1 - 6 * dt));

  if (!spel.doende && !spel.klar) flytta(pos, dx, dz, spelare.radie);

  // Hopp
  if (spelare.iLuften) {
    spelare.vy -= 30 * dt;
    spelare.y += spelare.vy * dt;
    if (spelare.y <= 0) {
      spelare.y = 0;
      spelare.iLuften = false;
      explosion(pos.clone().setY(0.1), 0xffd9ec, 5, 2.5, 0.08, 0.35, 4);
    }
  }
  spelare.grupp.position.y = spelare.y;

  // Vrid mot rörelseriktningen
  if (rikt.lengthSq() > 0.01) {
    const mal = Math.atan2(rikt.x, rikt.y);
    let diff = normaliseraVinkel(mal - spelare.vinkel);
    spelare.vinkel += diff * Math.min(1, 12 * dt);
    spelare.vinkel = normaliseraVinkel(spelare.vinkel);
  }
  spelare.grupp.rotation.y = spelare.vinkel;

  // Animationer
  const { armL, armR, modell, ogon } = spelare.delar;
  const gar = rikt.lengthSq() > 0.01 && !spel.doende;
  const svangfas = Math.sin(t * 11);
  modell.position.y = gar && !spelare.iLuften ? Math.abs(svangfas) * 0.08 : 0;
  modell.rotation.z = gar ? Math.sin(t * 11) * 0.03 : 0;

  if (spelare.sving > 0) {
    spelare.sving -= dt;
    const pr = 1 - Math.max(0, spelare.sving) / 0.32;
    armR.rotation.x = -2.5 + pr * 2.2;
    armR.rotation.z = -0.4 + pr * 0.55;
    if (!spelare.svingTraff && pr > 0.35) {
      spelare.svingTraff = true;
      svardTraff();
    }
  } else {
    armR.rotation.x = gar ? svangfas * 0.5 : Math.sin(t * 2) * 0.06;
    armR.rotation.z = 0;
  }

  if (spelare.kastAnim > 0) {
    spelare.kastAnim -= dt;
    armL.rotation.x = -1.5;
  } else {
    armL.rotation.x = gar ? -svangfas * 0.5 : -Math.sin(t * 2) * 0.06;
  }
  spelare.kastCd = Math.max(0, spelare.kastCd - dt);

  // Blinka med ögonen ibland
  spelare.blink -= dt;
  if (spelare.blink <= 0) spelare.blink = 2.6 + Math.random() * 1.8;
  const blinkNu = spelare.blink < 0.12;
  for (const oga of ogon) oga.scale.y = blinkNu ? 0.12 : 1;

  // Osårbarhets-blink
  if (spel.osarbar > 0) {
    spel.osarbar -= dt;
    spelare.modell.visible = Math.floor(t * 16) % 2 === 0;
  } else {
    spelare.modell.visible = true;
  }
}

function uppdateraFiender(dt, t) {
  const pos = spelare.grupp.position;
  for (const f of fiender) {
    const fpos = f.grupp.position;
    const avstand = fpos.distanceTo(pos);

    if (f.flash > 0) {
      f.flash -= dt;
      if (f.flash <= 0) {
        f.grupp.traverse((m) => {
          if (m.isMesh && m.material.emissive) m.material.emissive.setHex(0x000000);
        });
      }
    }

    let mx = f.knock.x * dt, mz = f.knock.z * dt;
    f.knock.multiplyScalar(Math.max(0, 1 - 5 * dt));

    if (f.typ === 'spoke') {
      // Spöken svävar och kan glida genom väggar — men håller sig nära sitt hem
      fpos.y = 1.1 + Math.sin(t * 2.2 + f.fas) * 0.25;
      const hemAvstand = fpos.distanceTo(f.bas);
      let mal = null;
      if (avstand < 12 && hemAvstand < 13 && !spel.doende) mal = pos;
      else if (hemAvstand > 2) mal = f.bas;
      if (mal) {
        const dir = mal.clone().sub(fpos).setY(0).normalize();
        mx += dir.x * f.fart * dt;
        mz += dir.z * f.fart * dt;
      }
      fpos.x += mx; fpos.z += mz;
      f.grupp.rotation.y = Math.atan2(pos.x - fpos.x, pos.z - fpos.z);
    } else {
      // Slimes studsar fram och krockar med murarna
      const hopp = Math.abs(Math.sin(t * 5 + f.fas));
      f.modell.position.y = hopp * 0.55;
      f.modell.scale.set(1 + (1 - hopp) * 0.18, 0.8 + hopp * 0.35, 1 + (1 - hopp) * 0.18);
      if (avstand < 11 && !spel.doende) {
        const dir = pos.clone().sub(fpos).setY(0).normalize();
        mx += dir.x * f.fart * dt;
        mz += dir.z * f.fart * dt;
        f.grupp.rotation.y = Math.atan2(dir.x, dir.z);
      }
      flytta(fpos, mx, mz, f.radie);
    }

    // Nuddar fienden prinsessan?
    if (planAvstand(fpos, pos) < f.radie + spelare.radie && spelare.y < 1.0) {
      taSkada(fpos);
    }
  }
}

function uppdateraBoss(dt, t) {
  if (!boss.drake) return;
  const drake = boss.drake;
  const pos = spelare.grupp.position;
  const dpos = drake.grupp.position;

  if (boss.flash > 0) {
    boss.flash -= dt;
    if (boss.flash <= 0) for (const m of drake.kroppsmaterial) m.emissive.setHex(0x000000);
  }

  if (boss.besegrad) {
    // Draken blir snäll, grönskimrande och flyger sin väg
    if (boss.flyktTid > 0) {
      boss.flyktTid -= dt;
      boss.gronhet = Math.min(1, boss.gronhet + dt * 0.8);
      for (const m of drake.kroppsmaterial) m.color.lerp(new THREE.Color(0x7ed08a), dt * 1.5);
      if (boss.flyktTid < 1.8) dpos.y += dt * 7;
      for (const v of drake.vingar) v.rotation.z = Math.sin(t * 16) * 0.5;
      drake.grupp.rotation.y += dt * 0.8;
      if (boss.flyktTid <= 0) scen.remove(drake.grupp);
    }
    return;
  }

  // Andas lugnt tills striden börjar
  drake.modell.position.y = Math.sin(t * 1.8) * 0.15;
  for (const v of drake.vingar) v.rotation.z = Math.sin(t * (boss.aktiv ? 9 : 3)) * (boss.aktiv ? 0.4 : 0.15);

  if (!boss.aktiv) {
    if (!spel.klar && !spel.doende && spel.igang &&
        pos.x > boss.rum.xMin && pos.x < boss.rum.xMax &&
        pos.z > boss.rum.zMin && pos.z < boss.rum.zMax) {
      startaBoss();
    }
    return;
  }

  // Om Moa springer ut ur rummet lugnar draken ner sig igen
  if (pos.x < boss.rum.xMin - 3 || pos.x > boss.rum.xMax + 3 ||
      pos.z < boss.rum.zMin - 3 || pos.z > boss.rum.zMax + 3) {
    boss.aktiv = false;
    bossrutaEl.classList.add('gomd');
    for (const e of eldklot) scen.remove(e.grupp);
    eldklot.length = 0;
    ljud.spelaLat('aventyr');
    return;
  }

  // Striden: draken tittar på Moa, glider sakta närmare och sprutar eldklot
  drake.grupp.rotation.y = Math.atan2(pos.x - dpos.x, pos.z - dpos.z);
  const dir = pos.clone().sub(dpos).setY(0);
  if (dir.length() > 3.5) {
    dir.normalize();
    dpos.x = Math.min(boss.rum.xMax - 2, Math.max(boss.rum.xMin + 2, dpos.x + dir.x * 1.1 * dt));
    dpos.z = Math.min(boss.rum.zMax - 2, Math.max(boss.rum.zMin + 2, dpos.z + dir.z * 1.1 * dt));
  }

  boss.attackTimer -= dt;
  if (boss.attackTimer <= 0) {
    boss.attackTimer = 2.1;
    skjutEldklot();
  }

  // Drakens kropp skadar vid beröring
  if (planAvstand(dpos, pos) < 2.6 && spelare.y < 1.2) taSkada(dpos);
}

function uppdateraProjektiler(dt, t) {
  const pos = spelare.grupp.position;

  // Magiska stjärnor
  for (let i = stjarnor.length - 1; i >= 0; i--) {
    const s = stjarnor[i];
    s.liv -= dt;
    s.mesh.position.addScaledVector(s.v, dt);
    s.mesh.rotation.z += dt * 12;
    s.mesh.rotation.y += dt * 4;
    s.glitter -= dt;
    if (s.glitter <= 0) {
      s.glitter = 0.06;
      explosion(s.mesh.position, 0xffe066, 1, 0.6, 0.06, 0.3, 0);
    }
    let bort = s.liv <= 0 || krockar(s.mesh.position.x, s.mesh.position.z, 0.3);
    if (!bort) {
      for (const f of fiender) {
        if (planAvstand(f.grupp.position, s.mesh.position) < f.radie + 0.5) {
          skadaFiende(f, 1);
          bort = true;
          break;
        }
      }
    }
    if (!bort && boss.aktiv && planAvstand(boss.drake.grupp.position, s.mesh.position) < 2.3) {
      skadaBoss(1);
      bort = true;
    }
    if (bort) {
      explosion(s.mesh.position, 0xffe066, 6, 3, 0.09, 0.4, 2);
      scen.remove(s.mesh);
      stjarnor.splice(i, 1);
    }
  }

  // Drakens eldklot
  for (let i = eldklot.length - 1; i >= 0; i--) {
    const e = eldklot[i];
    e.liv -= dt;
    e.grupp.position.addScaledVector(e.v, dt);
    e.grupp.position.y = 1.1 + Math.sin(t * 9 + i) * 0.1;
    const puls = 1 + Math.sin(t * 18 + i) * 0.15;
    e.grupp.scale.setScalar(puls);
    let bort = e.liv <= 0 || krockar(e.grupp.position.x, e.grupp.position.z, 0.3);
    if (!bort && planAvstand(e.grupp.position, pos) < 1.05 + spelare.radie && spelare.y < 1.1) {
      taSkada(e.grupp.position);
      bort = true;
    }
    if (bort) {
      explosion(e.grupp.position, 0xff8c42, 8, 4, 0.11, 0.45, 4);
      scen.remove(e.grupp);
      eldklot.splice(i, 1);
    }
  }
}

function uppdateraForemal(dt, t) {
  const pos = spelare.grupp.position;
  for (let i = foremal.length - 1; i >= 0; i--) {
    const f = foremal[i];
    f.grupp.rotation.y += dt * 2;
    f.grupp.position.y = 1.3 + Math.sin(t * 2.5 + f.fas) * 0.18;
    if (planAvstand(f.grupp.position, pos) < 1.6) {
      if (f.typ === 'hjarta') {
        spel.hjartan = Math.min(spel.maxHjartan, spel.hjartan + 1);
        uppdateraHjartan();
        ljud.plocka();
        meddelande('+1 hjärta! 💖', 1.8);
      } else {
        spel.nycklar++;
        uppdateraNycklar();
        ljud.nyckel();
        meddelande('Du hittade en nyckel! 🗝️', 2.4);
      }
      explosion(f.grupp.position, f.typ === 'hjarta' ? 0xff5c8a : 0xffcf5c, 14, 4, 0.12, 0.6, -1);
      scen.remove(f.grupp);
      foremal.splice(i, 1);
    }
  }

  // Dörrar
  for (const d of varld.dorrar) {
    if (d.oppen && d.animation < 1) {
      d.animation += dt;
      d.mesh.userData.galler.position.y = d.animation * 3;
      if (d.animation >= 1) d.mesh.userData.galler.visible = false;
      continue;
    }
    if (d.oppen) continue;
    const dpos = tillVarld(d.kol, d.rad);
    if (dpos.distanceTo(pos) < 3.4) {
      if (spel.nycklar > 0) {
        spel.nycklar--;
        uppdateraNycklar();
        d.oppen = true;
        varld.solid[d.rad][d.kol] = false;
        ljud.dorrUpp();
        meddelande('Dörren öppnas! ✨', 2.2);
        explosion(dpos.clone().setY(1.6), 0xffcf5c, 12, 3.5, 0.1, 0.6, 2);
      } else if ((d.meddelandeTid || 0) < klocka.elapsedTime) {
        d.meddelandeTid = klocka.elapsedTime + 2.5;
        ljud.last();
        meddelande('Låst! Du behöver en nyckel 🗝️', 2.2);
      }
    }
  }
}

function uppdateraEnhorning(dt, t) {
  if (!enhorning) return;
  if (!enhorningRaddad) {
    enhorning.modell.position.y = Math.sin(t * 1.6) * 0.14;
    enhorning.bubbla.scale.setScalar(1 + Math.sin(t * 2.4) * 0.035);
  } else {
    // Fri! Enhörningen skuttar glatt runt
    enhorning.modell.position.y = Math.abs(Math.sin(t * 5)) * 0.45;
    enhorning.grupp.position.x = enhorningBas.x + Math.sin(t * 0.9) * 1.6;
    enhorning.grupp.position.z = enhorningBas.z + Math.cos(t * 0.9) * 1.2;
    enhorning.grupp.rotation.y = -t * 0.9;
    if (Math.random() < dt * 2) {
      explosion(enhorning.grupp.position.clone().add(new THREE.Vector3(0, 2, 0)), 0xffb3d9, 2, 2, 0.09, 0.6, -2);
    }
  }
}

// ---------- Kamera ----------
const kameraMal = new THREE.Vector3();
function uppdateraKamera(dt, t) {
  if (!spel.igang) {
    // Innan spelet startar: sväva runt slottet
    kamera.position.set(Math.cos(t * 0.12) * 52, 30, Math.sin(t * 0.12) * 52);
    kamera.lookAt(0, 0, 0);
    return;
  }
  const pos = spelare.grupp.position;
  kameraMal.set(pos.x, 15.5, pos.z + 13.5);
  kamera.position.lerp(kameraMal, 1 - Math.pow(0.0001, dt));
  kamera.lookAt(pos.x, 1.2, pos.z - 1.5);
}

// ---------- Huvudloopen ----------
function steg(dt, t) {
  varld.uppdateraDekor(t, dt);

  if (spel.igang && !spel.klar) {
    uppdateraSpelare(dt, t);
    uppdateraFiender(dt, t);
    uppdateraBoss(dt, t);
    uppdateraProjektiler(dt, t);
    uppdateraForemal(dt, t);
  }
  uppdateraEnhorning(dt, t);
  uppdateraPartiklar(dt);
  uppdateraKamera(dt, t);

  renderare.render(scen, kamera);
}

function loop() {
  const dt = Math.min(klocka.getDelta(), 0.05);
  steg(dt, klocka.elapsedTime);
}

init();
