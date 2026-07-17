// Dear Fishermen — economy.js
// Money, the harbor shop, upgrades, silly hats. Owns #shop-ui.
// Cross-module talk ONLY via G state + events (see GDD.md §7).
import * as THREE from '../lib/three.module.min.js'; // (kept for contract consistency; DOM-only module)

// ---------------------------------------------------------------- tuning
const START_MONEY = 30; // day-1 kindness: enough for one small thing

const UPGRADES = {
  rod: {
    icon: '🎣', name: 'Fishing Rod',
    prices: [0, 180, 450],
    effect: ['', 'Bigger green zone!', 'HUGE green zone + rare fish bite!'],
  },
  harpoon: {
    icon: '🔱', name: 'Harpoon',
    prices: [0, 160, 420],
    effect: ['', 'Throws faster + cannon hits harder!', 'Super zoomy spears. Sharks hate it!'],
  },
  hull: {
    icon: '🚢', name: 'Hull',
    prices: [0, 220, 600],
    effect: ['', 'Tougher boat + bigger fish hold!', 'Mega tough! Holds SO many fish!'],
  },
  engine: {
    icon: '⚙️', name: 'Engine',
    prices: [0, 200, 550],
    effect: ['', 'Boat goes VROOM!', 'Boat goes VROOOOOOM!!'],
  },
};
const MAX_LEVEL = 3;

// Hull level side effects (boat.js may also read G.upgrades.hull; we apply
// directly too so buying feels instant even if boat.js doesn't listen).
const HULL_MAX_HP = [0, 100, 150, 200];
const HOLD_CAPACITY = [0, 10, 16, 24];

const HAT_PRICE = 60;
const HATS = ['souwester', 'bucket', 'party', 'squid'];
const HAT_NAMES = {
  souwester: "Sou'wester 🌧️", bucket: 'Bucket Hat 🪣', party: 'Party Hat 🎉',
  squid: 'Squid Hat 🦑',
};

const QUOTES = [
  '“Fresh fish! Well… they WERE fresh.” 🐟',
  '“I once caught a boot. Best soup ever.” 🥾',
  '“The sea gives, the sea takes. Mostly takes.” 🌊',
  '“Nice boat. Would be a shame if it… leaked.” 😏',
  '“Hats make you 12% braver. Science.” 🎩',
  '“Don\'t talk to the big fish. Trust me.” 👀',
  '“Coins go clink. Best sound in the world.” 🪙',
  '“My grandma wrestled a shark. The shark says hi.” 🦈',
];

const HAT_QUOTES = [
  'Ooh la la, fancy! 🎩',
  'The fish will respect you now.',
  'It smells a little like squid. That\'s normal.',
  'A legendary look for a legendary crew!',
  'No refunds. Hat magic is forever.',
];

const REPAIR_PER_HP = 2; // coins per hp patched

// ---------------------------------------------------------------- module state
let root = null;          // #shop-ui
let els = null;           // dom refs
let shopOpen = false;
let prevMoored = false;
let leftDockOnce = false;
let quoteIdx = 0;
let hatQuoteIdx = 0;
let Gref = null;

// ---------------------------------------------------------------- money helpers
function earn(amount, why) {
  const G = Gref;
  if (!G || !amount) return 0;
  amount = Math.round(amount);
  G.money = Math.max(0, (G.money || 0) + amount);
  G.emit('money:change', { delta: amount, why: why || '', total: G.money });
  if (shopOpen) refreshShop(G);
  return amount;
}
function spend(amount, why) {
  const G = Gref;
  amount = Math.round(amount);
  if (!G || amount <= 0 || (G.money || 0) < amount) return false;
  G.money -= amount;
  G.emit('money:change', { delta: -amount, why: why || '', total: G.money });
  if (shopOpen) refreshShop(G);
  return true;
}
function canAfford(amount) { return (Gref?.money || 0) >= amount; }

// ---------------------------------------------------------------- DOM build
function el(tag, style, text) {
  const e = document.createElement(tag);
  if (style) e.style.cssText = style;
  if (text != null) e.textContent = text;
  return e;
}

const BTN_BASE =
  'font-family:inherit;font-weight:700;cursor:pointer;border:0;border-radius:14px;' +
  'min-height:48px;padding:10px 16px;color:var(--paper);' +
  'background:rgba(255,248,234,0.16);font-size:16px;touch-action:manipulation;';
const BTN_PRIMARY =
  BTN_BASE + 'background:var(--sun);color:var(--ink);box-shadow:0 4px 0 rgba(0,0,0,0.35);';

function buildShopDom(G) {
  root = document.getElementById('shop-ui');
  if (!root) return;
  root.innerHTML = '';

  const panel = el('div');
  panel.className = 'panel';
  panel.style.cssText = 'max-width:680px;text-align:center;';

  els = {};
  els.title = el('h1', '', '🛒 Harbor Shop');
  els.money = el('div',
    'font-size:22px;font-weight:700;margin:4px 0 2px;color:var(--sun);', '🪙 0');
  els.quote = el('p',
    'font-size:14px;opacity:0.85;font-style:italic;margin:2px 0 12px;min-height:20px;', QUOTES[0]);

  // Sell + repair row
  const sellRow = el('div', 'display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-bottom:12px;');
  els.sellBtn = el('button', BTN_PRIMARY, 'Sell catch');
  els.sellBtn.addEventListener('click', () => doSellAll(G));
  els.repairBtn = el('button', BTN_BASE, 'Patch the hull ❤️');
  els.repairBtn.addEventListener('click', () => doRepair(G));
  sellRow.append(els.sellBtn, els.repairBtn);

  // Upgrade cards grid
  const grid = el('div',
    'display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:12px;');
  els.cards = {};
  for (const kind of Object.keys(UPGRADES)) {
    const spec = UPGRADES[kind];
    const card = el('div',
      'background:rgba(255,248,234,0.08);border-radius:16px;padding:10px 8px;' +
      'display:flex;flex-direction:column;gap:4px;align-items:center;');
    const head = el('div', 'font-size:15px;font-weight:700;', `${spec.icon} ${spec.name}`);
    const pips = el('div', 'font-size:14px;letter-spacing:3px;color:var(--sun);', '●○○');
    const effect = el('div', 'font-size:12.5px;opacity:0.9;min-height:32px;line-height:1.25;', '');
    const btn = el('button', BTN_BASE + 'width:100%;font-size:15px;', 'Upgrade');
    btn.addEventListener('click', () => doUpgrade(G, kind));
    card.append(head, pips, effect, btn);
    grid.appendChild(card);
    els.cards[kind] = { pips, effect, btn };
  }

  // Hat button
  els.hatBtn = el('button', BTN_BASE + 'width:100%;margin-bottom:10px;',
    `Mystery Hat 🎩 (${HAT_PRICE})`);
  els.hatBtn.addEventListener('click', () => doBuyHat(G));

  // Leave
  els.leaveBtn = el('button', BTN_PRIMARY + 'width:100%;font-size:19px;min-height:56px;',
    'Back to sea ⚓');
  els.leaveBtn.addEventListener('click', () => closeShop(G, true));

  panel.append(els.title, els.money, els.quote, sellRow, grid, els.hatBtn, els.leaveBtn);
  root.appendChild(panel);
}

// ---------------------------------------------------------------- refresh
function refreshShop(G) {
  if (!els) return;
  const w = G.time?.week ?? 1, d = G.time?.day ?? 1;
  els.title.textContent = `🛒 Port Johnson Shop — Week ${w} Day ${d}`;
  els.money.textContent = `🪙 ${G.money || 0}`;

  // Sell button (non-destructive appraisal — takeAllValue only on actual sell)
  const fish = G.hold?.fish || [];
  const value = appraise(G);
  els.sellBtn.textContent = `Sell catch: ${fish.length} fish + shells = 🪙${value}`;
  setEnabled(els.sellBtn, value > 0, true);

  // Repair button
  const hull = G.boat?.hull;
  const missing = hull ? Math.max(0, Math.ceil(hull.maxHp - hull.hp)) : 0;
  if (missing > 0) {
    els.repairBtn.textContent = `Patch the hull ❤️ (${REPAIR_PER_HP} coins per hp, ${missing} hp)`;
    setEnabled(els.repairBtn, (G.money || 0) >= REPAIR_PER_HP, false);
  } else {
    els.repairBtn.textContent = 'Hull is perfect! ❤️';
    setEnabled(els.repairBtn, false, false);
  }

  // Upgrade cards
  for (const kind of Object.keys(UPGRADES)) {
    const spec = UPGRADES[kind];
    const lv = G.upgrades?.[kind] || 1;
    const c = els.cards[kind];
    c.pips.textContent = '●'.repeat(lv) + '○'.repeat(MAX_LEVEL - lv);
    if (lv >= MAX_LEVEL) {
      c.effect.textContent = 'Maxed out! 💪';
      c.btn.textContent = 'MAX';
      setEnabled(c.btn, false, false);
    } else {
      const price = spec.prices[lv]; // price to reach lv+1
      c.effect.textContent = spec.effect[lv];
      c.btn.textContent = `Lv ${lv + 1} · 🪙${price}`;
      setEnabled(c.btn, (G.money || 0) >= price, false);
    }
  }

  // Hats
  const owned = G.upgrades?.hats?.length || 0;
  els.hatBtn.textContent = `Mystery Hat 🎩 (🪙${HAT_PRICE})` + (owned ? ` — you own ${owned}!` : '');
  setEnabled(els.hatBtn, (G.money || 0) >= HAT_PRICE, false);
}

function setEnabled(btn, on, primary) {
  btn.disabled = !on;
  btn.style.opacity = on ? '1' : '0.45';
  btn.style.cursor = on ? 'pointer' : 'default';
}

function appraise(G) {
  // Non-destructive estimate: sum fish (+ shells if fishing.js tracks them).
  let sum = 0;
  for (const f of G.hold?.fish || []) sum += f?.value || 0;
  for (const s of G.hold?.shells || []) sum += s?.value || 0;
  if (typeof G.hold?.shellValue === 'number') sum += G.hold.shellValue;
  return Math.round(sum);
}

function nextQuote() {
  quoteIdx = (quoteIdx + 1) % QUOTES.length;
  if (els) els.quote.textContent = QUOTES[quoteIdx];
}

// ---------------------------------------------------------------- actions
function doSellAll(G) {
  const fish = G.hold?.fish || [];
  const count = fish.length;
  // Contract: value comes from takeAllValue(), then clear(). Fall back to sum.
  let value = G.hold?.takeAllValue?.();
  if (typeof value !== 'number') value = appraise(G);
  value = Math.round(value);
  if (value <= 0) return;
  if (G.hold?.clear) G.hold.clear();
  else if (G.hold?.fish) G.hold.fish.length = 0;
  earn(value, 'sold catch');
  G.sfx?.('coin');
  G.ui?.toast?.(`Sold ${count} fish for 🪙${value}! Cha-ching!`);
  nextQuote();
  refreshShop(G);
}

function doRepair(G) {
  const hull = G.boat?.hull;
  if (!hull) return;
  const missing = Math.max(0, Math.ceil(hull.maxHp - hull.hp));
  if (missing <= 0) return;
  // Patch as much as we can afford (partial repairs welcome — kid-friendly).
  const affordable = Math.floor((G.money || 0) / REPAIR_PER_HP);
  const heal = Math.min(missing, affordable);
  if (heal <= 0) { G.ui?.toast?.('Not enough coins for planks! 🪵'); return; }
  if (!spend(heal * REPAIR_PER_HP, 'hull repair')) return;
  hull.hp = Math.min(hull.maxHp, hull.hp + heal);
  G.sfx?.('hammer');
  G.ui?.toast?.(heal >= missing ? 'Hull patched up! Good as new ❤️' : `Patched ${heal} hp! 🔨`);
  refreshShop(G);
}

function doUpgrade(G, kind) {
  const spec = UPGRADES[kind];
  const lv = G.upgrades?.[kind] || 1;
  if (lv >= MAX_LEVEL) return;
  const price = spec.prices[lv];
  if (!spend(price, `upgrade ${kind}`)) return;
  G.upgrades[kind] = lv + 1;
  applyUpgradeEffects(G, kind);
  G.emit('upgrade:bought', { kind, level: G.upgrades[kind] });
  G.sfx?.('upgrade');
  G.ui?.toast?.(`${spec.icon} ${spec.name} is now level ${G.upgrades[kind]}! ${spec.effect[lv]}`);
  refreshShop(G);
}

function applyUpgradeEffects(G, kind) {
  if (kind === 'hull') {
    const lv = G.upgrades.hull;
    if (G.boat?.hull) {
      G.boat.hull.maxHp = HULL_MAX_HP[lv] || G.boat.hull.maxHp;
      G.boat.hull.hp = G.boat.hull.maxHp; // new hull = fully healed
    }
    // fishing.js exposes capacity as a getter derived from G.upgrades.hull — only set if writable
    try { if (G.hold) G.hold.capacity = HOLD_CAPACITY[lv] || G.hold.capacity; } catch (e) {}
  }
  // rod/harpoon/engine: other modules read G.upgrades levels directly.
}

function doBuyHat(G) {
  if (!spend(HAT_PRICE, 'mystery hat')) return;
  const hat = HATS[Math.floor((G.rng?.() ?? Math.random()) * HATS.length)];
  if (!G.upgrades.hats) G.upgrades.hats = [];
  G.upgrades.hats.push(hat);
  G.emit('hat:bought', { hat });
  G.sfx?.('coin');
  hatQuoteIdx = (hatQuoteIdx + 1) % HAT_QUOTES.length;
  G.ui?.toast?.(`You got: ${HAT_NAMES[hat] || hat}! ${HAT_QUOTES[hatQuoteIdx]}`);
  nextQuote();
  refreshShop(G);
}

// ---------------------------------------------------------------- open / close
function openShop(G) {
  if (shopOpen || !root) return;
  shopOpen = true;
  quoteIdx = Math.floor((G.rng?.() ?? Math.random()) * QUOTES.length);
  if (els) els.quote.textContent = QUOTES[quoteIdx];
  refreshShop(G);
  root.classList.remove('hidden');
  G.setState?.('shop');
  G.emit('shop:open', {});
  G.sfx?.('bell');
  G.save?.(); // harbor auto-save per GDD
}

function closeShop(G, backToSea) {
  if (!shopOpen) return;
  shopOpen = false;
  root?.classList.add('hidden');
  G.emit('shop:close', {});
  if (backToSea && G.state === 'shop') G.setState?.('playing');
}

// ---------------------------------------------------------------- lifecycle
export function init(G) {
  Gref = G;
  if (typeof G.money !== 'number') G.money = 0;
  if (!G.upgrades) G.upgrades = { rod: 1, harpoon: 1, hull: 1, engine: 1, hats: [] };
  if (!G.upgrades.hats) G.upgrades.hats = [];
  G.economy = { earn, spend, canAfford }; // helpers for other modules

  buildShopDom(G);

  G.on('reward:money', (d) => {
    const amount = Math.round(d?.amount || 0);
    if (amount <= 0) return;
    earn(amount, d?.why || 'reward');
    G.sfx?.('coin');
    G.ui?.toast?.(`+🪙${amount} — ${d?.why || 'nice one!'}`);
  });

  G.on('save:collect', (data) => {
    data.economy = {
      money: G.money,
      upgrades: {
        rod: G.upgrades.rod, harpoon: G.upgrades.harpoon,
        hull: G.upgrades.hull, engine: G.upgrades.engine,
        hats: (G.upgrades.hats || []).slice(),
      },
    };
  });

  G.on('save:apply', (data) => {
    const e = data?.economy;
    if (!e) return;
    G.money = typeof e.money === 'number' ? e.money : G.money;
    if (e.upgrades) {
      G.upgrades.rod = e.upgrades.rod || 1;
      G.upgrades.harpoon = e.upgrades.harpoon || 1;
      G.upgrades.hull = e.upgrades.hull || 1;
      G.upgrades.engine = e.upgrades.engine || 1;
      G.upgrades.hats = Array.isArray(e.upgrades.hats) ? e.upgrades.hats.slice() : [];
    }
    // Sync hull/hold to the loaded level WITHOUT full-healing (boat.js already
    // restored saved hp, clamped to its stale level-1 maxHp — re-restore it here).
    if (G.boat?.hull) {
      G.boat.hull.maxHp = HULL_MAX_HP[G.upgrades.hull] || G.boat.hull.maxHp;
      G.boat.hull.hp = Math.min(Math.max(data?.boat?.hp ?? G.boat.hull.hp, 1), G.boat.hull.maxHp);
    }
    try { if (G.hold) G.hold.capacity = HOLD_CAPACITY[G.upgrades.hull] || G.hold.capacity; } catch (err) {}
    G.emit('money:change', { delta: 0, why: 'loaded save', total: G.money });
  });

  G.on('game:new', () => {
    G.money = 0;
    G.upgrades.rod = 1; G.upgrades.harpoon = 1;
    G.upgrades.hull = 1; G.upgrades.engine = 1;
    G.upgrades.hats = [];
    applyUpgradeEffects(G, 'hull');
    closeShop(G, false);
    // If a new game starts already moored at the dock, don't pop the shop instantly.
    prevMoored = !!G.boat?.moored;
    leftDockOnce = false;
    earn(START_MONEY, 'starting coins');
    G.ui?.toast?.(`Grandpa left you 🪙${START_MONEY} to start. Spend it wisely! 👴`);
  });

  // If something else changes state away from 'shop' (e.g. game over), hide us.
  G.on('state:change', ({ to }) => {
    if (shopOpen && to !== 'shop') closeShop(G, false);
  });
}

export function update(G, dt) {
  // Watch mooring even when paused-adjacent; state checks keep it safe.
  const moored = !!G.boat?.moored;
  if (!moored && G.boat) leftDockOnce = true; // must actually sail out before the shop can auto-open
  if (moored && !prevMoored && leftDockOnce && G.state === 'playing') openShop(G);
  if (!moored && shopOpen) closeShop(G, true); // boat drifted off? back to playing
  prevMoored = moored;
}
