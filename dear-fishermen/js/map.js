// Dear Fishermen — map.js
// The sea chart (Eidan's request): your boat cursor, zones, fish hotspots,
// the harbor, and every spot the LEVIATHAN has been seen. Toggle: M / 🗺️ button.
// Owns DOM: #map-ui (created here) + wires #btn-map. Saves sightings via save slices.
import * as THREE from '../lib/three.module.min.js'; // (contract consistency)

let G = null;
let root = null, canvas = null, ctx = null, visible = false;
let sightings = [];        // [{x, z, week, day}] — where the leviathan surfaced
const WORLD = 700;         // map covers world coords [-WORLD, +WORLD]
const SIZE = 480;          // canvas px

// Map convention: north = world -z = up, west = world -x = left (fog is north-west = top-left).
function px(x) { return ((x + WORLD) / (2 * WORLD)) * SIZE; }
function py(z) { return ((z + WORLD) / (2 * WORLD)) * SIZE; }

export function init(g) {
  G = g;
  buildDom();
  document.getElementById('btn-map')?.addEventListener('click', toggle);
  window.addEventListener('keydown', (ev) => {
    if (ev.code === 'KeyM' || (!ev.code && (ev.key || '').toLowerCase() === 'm')) toggle();
    if (ev.code === 'Escape' && visible) hide();
  });
  G.on('leviathan:begin', () => {
    const p = G.boat?.group?.position;
    if (!p) return;
    sightings.push({ x: Math.round(p.x), z: Math.round(p.z), week: G.time?.week || 1, day: G.time?.day || 1 });
    if (sightings.length > 8) sightings.shift();
  });
  G.on('game:new', () => { sightings = []; hide(); });
  G.on('save:collect', (data) => { data.map = { sightings }; });
  G.on('save:apply', (data) => { sightings = data?.map?.sightings || []; });
  G.on('state:change', ({ to }) => { if (to !== 'playing') hide(); });
}

function buildDom() {
  root = document.createElement('div');
  root.id = 'map-ui';
  root.style.cssText =
    'position:fixed;inset:0;z-index:35;display:none;align-items:center;justify-content:center;' +
    'background:rgba(4,20,32,0.6);backdrop-filter:blur(2px);';
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.style.cssText = 'max-width:560px;padding:16px 16px 12px;';
  const h = document.createElement('h1');
  h.textContent = '🗺️ Sea Chart';
  h.style.cssText = 'font-size:24px;margin:0 0 8px;';
  canvas = document.createElement('canvas');
  canvas.width = SIZE; canvas.height = SIZE;
  canvas.style.cssText = 'width:100%;max-width:480px;border-radius:14px;background:#1d6fa5;display:block;margin:0 auto;';
  ctx = canvas.getContext('2d');
  const legend = document.createElement('p');
  legend.style.cssText = 'font-size:13px;opacity:0.9;margin:8px 0 6px;line-height:1.5;';
  legend.innerHTML = '▲ you · ⚓ harbor · 🐟 fish (more fish = better!) · 🌫️ cursed fog · 🐉 leviathan seen here';
  const close = document.createElement('button');
  close.textContent = 'Back to the boat ⛵';
  close.className = 'primary';
  close.style.cssText =
    'font-family:inherit;font-weight:700;font-size:16px;cursor:pointer;border:0;border-radius:999px;' +
    'padding:10px 22px;background:var(--sun);color:var(--ink);min-height:48px;';
  close.addEventListener('click', hide);
  panel.append(h, canvas, legend, close);
  root.appendChild(panel);
  document.body.appendChild(root);
}

function toggle() {
  if (visible) hide();
  else if (G?.state === 'playing') show();
}
function show() { visible = true; root.style.display = 'flex'; draw(); G.sfx?.('uiClick'); }
function hide() { if (!visible) return; visible = false; root.style.display = 'none'; }

// ---------------------------------------------------------------- drawing
function ring(cx, cy, r, fill) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

function emoji(txt, x, z, size = 16) {
  ctx.font = `${size}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(txt, px(x), py(z));
}

function draw() {
  if (!ctx) return;
  const hb = G.consts?.HARBOR || { x: 0, z: 60 };
  const scale = SIZE / (2 * WORLD);
  ctx.clearRect(0, 0, SIZE, SIZE);

  // deep sea base, then lighter rings toward the harbor (zones)
  ctx.fillStyle = '#0c2f4e'; ctx.fillRect(0, 0, SIZE, SIZE);              // deep
  ring(px(hb.x), py(hb.z), 520 * scale, '#155a8a');                       // open
  ring(px(hb.x), py(hb.z), 220 * scale, '#1d7ab8');                       // coast
  ring(px(hb.x), py(hb.z), 70 * scale, '#2b96d8');                        // harbor waters

  // cursed fog quadrant (x < -260, z < -260 → top-left)
  ctx.fillStyle = 'rgba(63, 174, 98, 0.30)';
  ctx.fillRect(0, 0, px(-260), py(-260));
  emoji('🌫️', -480, -480, 26);
  if ((G.time?.week || 1) >= 2 && !sightings.length) emoji('❓', -420, -380, 18);

  // harbor island
  emoji('🏝️', hb.x, hb.z + 26, 20);
  emoji('⚓', hb.x, hb.z - 8, 16);

  // fish hotspots (more fish drawn = better fishing there)
  emoji('🐟', 150, -60, 13); emoji('🐟', -120, 140, 13);                   // coast: a little
  emoji('🐟', 330, -200, 15); emoji('🐟', -300, 220, 15); emoji('🐟', 90, -400, 15); // open: decent
  emoji('🐟🐟', 560, -320, 16); emoji('🐟🐟', -180, -600, 16); emoji('🐟🐟', 520, 380, 16); // deep: lots
  emoji('✨🐟', -450, -520, 15);                                            // fog: rare specials

  // leviathan sightings
  for (const s of sightings) emoji('🐉', s.x, s.z, 22);

  // buoy ring hint at coast edge
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.setLineDash([4, 6]);
  ctx.beginPath(); ctx.arc(px(hb.x), py(hb.z), 220 * scale, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);

  // YOUR BOAT — the cursor (triangle pointing along heading; heading 0 = +z = map down)
  const b = G.boat?.group?.position;
  if (b) {
    const bx = px(b.x), by = py(b.z);
    const h = G.boat.heading || 0;
    // world forward = (sin h, cos h); map right = +x, map down = +z
    const ang = Math.atan2(Math.cos(h), Math.sin(h)); // screen-space direction of travel
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(ang + Math.PI / 2);
    ctx.fillStyle = '#ffc94d';
    ctx.strokeStyle = '#0b2d4a'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -10); ctx.lineTo(7, 8); ctx.lineTo(-7, 8); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // compass rose
  ctx.fillStyle = 'rgba(255,248,234,0.85)';
  ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('N', SIZE - 22, 20);
  ctx.beginPath(); ctx.moveTo(SIZE - 22, 26); ctx.lineTo(SIZE - 22, 38); ctx.strokeStyle = 'rgba(255,248,234,0.6)'; ctx.stroke();
}

export function update(g, dt) {
  G = g;
  if (visible) draw(); // 2D canvas + ~25 emoji: trivially cheap, and only while open
}
