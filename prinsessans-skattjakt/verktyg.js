// verktyg.js — gemensamma hjälpmedel: cel-shading-material, konturer och slumptal
import * as THREE from './lib/three.module.min.js';

let GRADIENT = null;

// Trestegs-gradient som ger tecknad "cel-shading"-känsla åt allt i spelet
export function gradientKarta() {
  if (!GRADIENT) {
    const data = new Uint8Array([110, 175, 235, 255]);
    GRADIENT = new THREE.DataTexture(data, 4, 1, THREE.RedFormat);
    GRADIENT.minFilter = THREE.NearestFilter;
    GRADIENT.magFilter = THREE.NearestFilter;
    GRADIENT.needsUpdate = true;
  }
  return GRADIENT;
}

export function toon(farg, extra = {}) {
  return new THREE.MeshToonMaterial({ color: farg, gradientMap: gradientKarta(), ...extra });
}

let KONTURMAT = null;

// Ger en figur mörka serietidningskonturer (inverterat skal)
export function kontur(grupp, tjocklek = 0.05) {
  if (!KONTURMAT) {
    KONTURMAT = new THREE.MeshBasicMaterial({ color: 0x4a2545, side: THREE.BackSide });
  }
  const meshar = [];
  grupp.traverse((m) => {
    if (m.isMesh && !m.userData.ingenKontur) meshar.push(m);
  });
  for (const m of meshar) {
    const o = new THREE.Mesh(m.geometry, KONTURMAT);
    o.scale.setScalar(1 + tjocklek);
    o.userData.ingenKontur = true;
    o.raycast = () => {};
    m.add(o);
  }
}

// Deterministisk pseudo-slump (samma värld varje gång)
export function slump(i) {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function lerp(a, b, t) {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}
