# DEAR FISHERMEN — Game Design Document

**Designer: Eidan (age 12).** Built by his game studio (Claude).
A silly co-op fishing chaos game in the browser, inspired by the vibe of *Dear Passengers* — but on the world's worst fishing boat.

---

## 1. The Pitch

You and your wobbly goofball crew run a fishing boat. Fish with rods, dive with a harpoon,
patch the leaks, put out the fires, ride out the storms, sell your catch, upgrade the boat.
Survive **3 weeks at sea** and you can retire rich… or continue your legacy into ever-harder weeks.

**THE TWIST:** somewhere out there swims the **Legendary Fish**, the biggest fish in the game.
Hook it and it **eats you** — you become a **LEVIATHAN** and turn on your own crew,
tilting and smashing the ship while they fight back with harpoons.

Vibes: **epic & intense** + **creepy & mysterious** (nights, fog) + **funny & chaotic** (wobbly physics crew).

## 2. Core Facts

- Platform: browser (desktop + iPad Safari). Three.js (vendored `lib/three.module.min.js`), no build step, no network.
- Players: 1–2 humans on ONE keyboard (P1 WASD, P2 arrows) or 1 human on iPad touch. AI crewmates ("bots") fill the crew to 4 total.
- Language: English UI, simple words (a 8–12 year old must understand).
- Camera: one shared cinematic chase camera on the boat (Overcooked-style shared arena). No split screen.
- Save: `localStorage` (`dear-fishermen-v1`), auto-save at every dawn and at the harbor. "Continue" on title screen.
- A game day = **10 min day + 10 min night** (`DAY_SEC=600`, `NIGHT_SEC=600`). Week = 7 days. Run = 3 weeks, then retire-or-continue (endless, scaling).
- Debug hook: `window.__df` = `{G, step(dt), timeScale}` for deterministic testing.

## 3. The Game Loop

1. **Sail** from the harbor to fishing zones (further = better fish, more danger).
2. **Fish** with rods (reel minigame) or **dive** with the harpoon (oxygen limit, seashells on the floor, sharks circling).
3. **Chaos happens**: leaks, fires, sliding crates, storms, shark attacks, cursed fish, night creepiness.
4. **Sell** at the harbor, **buy upgrades** (rod, harpoon, hull, engine, silly hats).
5. Survive to dawn → new day. Day 21 dawn → **RETIRE (victory)** or **CONTINUE LEGACY** (endless).

### Zones (by distance from harbor, world units)
- **Harbor** (dock at world origin area, safe): shop opens when moored.
- **Coast** (< 220): calm, small cheap fish.
- **Open Sea** (220–520): medium fish, storms possible.
- **The Deep** (> 520): big fish, sharks, megalodon territory.
- **Cursed Fog** (north-west quadrant beyond 400): green fog, cursed fish, and the **Legendary Fish** at night (week ≥ 2).

### Difficulty by week (threats.js director)
- Week 1: gentle. Short storms, rare leaks, sharks only in the Deep.
- Week 2: storms + typhoon chance, shark hull attacks, cursed fish common in fog, Legendary Fish can appear.
- Week 3: frequent storms, typhoons, shark packs, **Megalodon** event (huge shark rams the boat repeatedly; crew must drive it off with the mounted harpoon cannon).
- Week 4+ (legacy): everything scales up ~15% per week.

## 4. Systems (what each does)

### Fishing (rods)
Stand at a rod station → press ACTION → cast. Wait for a bite (bobber dips, sound cue) → press ACTION to hook →
**reel minigame**: a fish icon moves along a tension bar; hold ACTION to reel when the marker is in the green zone,
release when it leaves. Line tension too high → line snaps. Bigger fish = faster marker, smaller green zone.
Catch lands in the **fish hold** (limited capacity by hull level). Fish have species/size/value; some are **cursed** (green glow — catching one triggers a curse), and at night in the fog the **Legendary Fish** can bite (unmistakable: the music stops).

### Diving (harpoon & seashells)
Jump off the boat → you swim. Oxygen bar (60 s, upgradeable). Throw harpoons at fish (straight projectile, arcs slightly),
grab **seashells** on the seafloor (valuable, glowing). Sharks circle in deep zones — they charge if you're close too long; a harpoon hit scares a shark off. Climb the boat ladder to get back up. Drop your catch on deck into the hold.

### Boat & chaos (Overcooked energy)
The boat tilts on real waves. High tilt or wet deck → crew and loose crates **slide**.
- **Leaks**: holes below deck line spray water; water level rises → boat slows, sinks at 100%. Fix: grab plank from supply crate, hammer at the leak (hold ACTION).
- **Fires**: engine or lightning starts fires; spread if ignored. Fix: grab bucket, scoop over the side, throw water.
- **Bail**: bucket also bails bilge water.
- **Harpoon cannon** (mounted, aft): aim + shoot at sharks/megalodon/leviathan.
- **Steering wheel**: hold to drive (heading + throttle). Compass HUD shows Harbor / Deep / Fog directions.

### Cursed fish (curses last ~60 s, one at a time)
1. **Ghost Deck** — green fog on board, whispers, lights flicker, HUD text turns spooky.
2. **Fish Rebellion** — caught fish flop out of the hold and bounce around; catch them before they escape overboard!
3. **Dance Curse** — bots drop everything and dance uncontrollably.
4. **Heavy Boots** — players walk slower and wobblier, screen tilts slightly.

### The Leviathan (traitor mode — the finale twist)
Trigger: a HUMAN player lands the Legendary Fish. Cutscene: the fish swallows the player, water erupts, and they surface as a **LEVIATHAN** (serpent monster, ~3× boat length).
- Leviathan player controls: swim (move keys), **RAM** (action — hits hull, big tilt), **TAIL SLAM** (secondary — huge wave washes the deck, sliding chaos).
- Crew goal: survive **90 s** OR deal enough harpoon-cannon damage to drive it off.
- Crew wins → the leviathan spits the player back on deck (soaked, 1 money "sorry" bonus is fine to joke about) + big survival bonus.
- Leviathan wins (ship sinks) → funny game-over screen ("Blub blub… the sea remembers."), restart from last dawn save.
- Solo: bots man the cannon and CAN win. Bots never hook the Legendary Fish (humans only).

### Megalodon (week ≥ 3 escalation)
Warning music + fin circling → it rams the hull on a timer (new leak each ram). Harpoon-cannon damage threshold drives it away. It can bite a diver back onto the deck (lose carried fish, comedic scream).

### Economy & upgrades (harbor shop)
Sell all fish + shells with one button. Buy:
- **Rod** lv1–3 (bigger green zone, rarer fish table)
- **Harpoon** lv1–3 (throw speed, cannon damage)
- **Hull** lv1–3 (max HP, hold capacity, leak resistance)
- **Engine** lv1–3 (speed, turn rate)
- **Silly hats** (pure cosmetics, random per buy: sou'wester, bucket, party cone, squid hat…)

### Characters (wobbly goofballs)
Round bodies, stubby legs, floppy noodle arms (sinusoidal flop), big eyes, constant lean/wobble in the move direction, comic stumble when sliding. Bright rain gear colors (yellow, orange, teal, pink) + hats. Bots wander, fish badly, fix leaks slowly, panic in storms (run in circles, scream), celebrate catches.

## 5. Controls

| Action | P1 | P2 | Touch (iPad) |
|---|---|---|---|
| Move | WASD | Arrow keys | left joystick |
| ACTION (use/cast/reel/fix/steer) | E | . (period) | A button |
| SECONDARY (throw water/harpoon, tail slam) | Q | , (comma) | B button |
| Jump / dive / ladder | Space | Right Shift | JUMP button |
| Take the helm (from anywhere on deck) | F | — | — |
| Camera POV (1st ↔ 3rd person) | V | — | 👁️ button |
| Pause | Esc | Esc | ⏸ button |

**POV rule:** third person is the default shared camera. A **solo** human can toggle first person (V / 👁️) —
seen from the goofball's own eyes, facing where they walk. With two humans on one screen the game stays in
third person (toast explains why). Becoming the leviathan forces cinematic third person.

P2 joins by pressing any of their keys on the title screen ("P2 press → to join"). Touch = single human + 3 bots.

## 6. Look & Sound

- Bright toon look (MeshToonMaterial like Moa's game), saturated sea, fat white foam caps, chunky low-poly boat with red hull, warm lantern light at night, green fog in the cursed zone. Sun/moon cycle, stars at night.
- Music: WebAudio-generated (no assets): jaunty sea-shanty loop by day, sparse creepy pads at night, storm percussion layer, silent-then-horror sting for the Legendary Fish, big boss brass for leviathan/megalodon. SFX: splashes, reel clicks, wood creaks, goofy "wahh" voices (pitch-shifted blips).

---

## 6b. THE ISLANDS UPDATE (Eidan's expansion #1 — build right after the base game boots)

- **Islands:** 3 explorable islands out at sea (one per zone: coast, open, and a spooky one at the edge of the fog).
  Each has a small wooden dock — sail close + slow → moored, walk off the boat onto the dock and EXPLORE on foot.
- **Islanders:** wobbly goofball humans (same builder as the crew, but islander outfits: straw hats, flower shirts)
  who wander, wave, and say funny things (speech-bubble toasts) — a fisherman who lies about fish sizes,
  a grandma who knits seaweed sweaters, a kid who's afraid of crabs…
- **Animals:** silly island wildlife to find: sideways-scuttling crabs, seagulls that steal small fish from your hold
  if you idle at the dock, goats that headbutt (comic bump), and on the spooky island something… glowing in a cave.
- **Island stalls:** buy **BAIT** and stuff at each island's dock stall (cheaper than harbor, each island has a specialty):
  - Worms 🪱 (cheap, +bite speed)
  - Shiny Lure ✨ (rarer fish table boost)
  - Squid Bait 🦑 (needed odds boost for deep/fog specials — and the Legendary Fish)
  - Snacks 🥪 (crew runs faster 1 day), Mystery Crate 📦 (random silly item)
- **Bait system:** bait is equipped per rod cast (auto-consume best bait? no — player picks in shop, active bait shown
  in HUD next to hold count). Affects bite time and rarity rolls in fishing.js.
- Exploration rewards: shells, coconuts (sellable), hidden treasure chest per island (one-time money bonus).

# 7. MODULE CONTRACT (for the build agents)

**Read `js/main.js` first — it is the source of truth.** Each module is an ES module in `dear-fishermen/js/`, owned by exactly ONE agent. Import Three as `import * as THREE from '../lib/three.module.min.js';` and never import another feature module — all cross-talk goes through `G` (shared state) and `G.emit`/`G.on` (event bus). Each module exports:

```js
export function init(G) {}       // build meshes/DOM, subscribe to events
export function update(G, dt) {} // dt seconds (capped), called every frame in registration order
```

`main.js` calls init/update in this order: `world, boat, characters, sea, fishing, threats, economy, hud, audio`.

## G — shared state (main.js creates; modules fill their sections)

```js
G = {
  THREE, scene, camera, renderer,          // three basics (main)
  state: 'title'|'playing'|'paused'|'shop'|'summary'|'gameover'|'retired',
  setState(s),                             // main; emits 'state:change'
  time: { week, day, phase:'day'|'night', dayFrac, secToday, total },  // main
  timeScale,                               // main (debug speedup)
  rng(),                                   // seeded-ish random (main)
  input: { p1:{x,z,action,secondary,jump, actionHit,secondaryHit,jumpHit}, p2:{...}, p2Active, touchActive }, // main
  emit(name, data), on(name, fn),          // event bus (main)
  save(), load(), wipeSave(),              // main (modules add via 'save:collect'/'save:apply' events)
  ui: { prompt(playerIdx, text|null), banner(text, ms, kind), toast(text) },   // hud fills
  // ---- world ----
  ocean: { heightAt(x,z), normalAt(x,z) }, // Gerstner-ish waves, uses G.time + weather internally
  weather: { storm:0..1, typhoon:false, wind:THREE.Vector2, lightning() },
  zoneAt(x,z) -> 'harbor'|'coast'|'open'|'deep'|'fog',
  // ---- boat ----
  boat: {
    group,                                 // THREE.Group; position/rotation = boat pose (boat.js simulates from ocean)
    heading, throttle, speed, moored,      // moored=true when stopped at harbor dock
    hull: { hp, maxHp },
    water: 0..1,                           // bilge water level
    leaks: [{id,pos,active}], fires: [{id,pos,hp}],
    stations: [{ id, type:'wheel'|'rod'|'cannon'|'supply'|'hold'|'ladder', localPos, radius, user }],
    deckBound(p),                          // clamp local point to walkable deck, returns {pos, onDeck}
    toWorld(v), toLocal(v),                // convert local deck <-> world
    damage(n, why), repair(id),
    cannon: { aim(dir), fire() },
  },
  // ---- characters ----
  players: [ { idx, human, obj, mode:'deck'|'swim'|'busy'|'leviathan', localPos, worldPos(), carry:null|'plank'|'bucket'|'bucketFull'|{fish}, oxygen, hat } ],
    // players[0..1] humans (p2 may be absent), rest bots (human:false)
  nearestStation(player) -> station|null,
  // ---- fishing ----
  fishdex,                                 // species table (see fishing.js)
  hold: { fish:[], capacity },             // caught fish inventory
  biggestCatch,                            // {name,size,value} record
  // ---- economy ----
  money, upgrades: { rod:1, harpoon:1, hull:1, engine:1, hats:[] },
  // ---- audio ----
  sfx(name, opts), music(mode),            // fire-and-forget; audio.js implements
}
```

## Key events (bus)

- `state:change {from,to}` — main
- `day:dawn {week,day}` (also triggers autosave), `day:dusk`, `week:new {week}` — main
- `fish:bite {station,player}`, `fish:caught {fish,player,how:'rod'|'harpoon'}`, `fish:lost {player}` — fishing/sea
- `fish:cursed {fish}` → threats runs a curse; `curse:start {kind}` / `curse:end`
- `fish:legendary {player}` → threats runs leviathan sequence: `leviathan:begin {player}`, `leviathan:end {crewWon}`
- `boat:leak {leak}`, `boat:fire {fire}`, `boat:damage {n,why}`, `boat:repaired {id}`, `boat:sinking`, `boat:sunk`
- `storm:start {level}` / `storm:end`, `typhoon:start/end`, `shark:attack {shark}`, `megalodon:begin/end`
- `shop:open` / `shop:close`, `money:change {delta,why}`
- `minigame:start {player,kind}` / `minigame:end {player,success}` — set player.mode='busy' while active
- `save:collect {data}` (modules write their slice) / `save:apply {data}` (modules read their slice)

## DOM ownership (ids already exist in index.html)

- **hud.js**: `#hud` (+ its children: money, clock, day, hull, oxygen, compass), `#prompt-p1`, `#prompt-p2`, `#banner`, `#toast`, `#touch` controls wiring, `#title`, `#pause`, `#summary`, `#gameover`, `#retire` overlays (show/hide + fill text; buttons emit events / call G.setState)
- **fishing.js**: `#fishing-ui` (tension bar minigame)
- **economy.js**: `#shop-ui`
- **threats.js**: `#alert` (big center warnings: STORM! / MEGALODON! / LEVIATHAN!) and `#curse-tint`
- Modules must not touch DOM they don't own.

## Hard rules for agents

1. Write ONLY your assigned file. Never edit main.js, index.html, style.css, or another module.
2. ES module, no TypeScript, no external imports beyond Three from `../lib/three.module.min.js`.
3. Everything procedural — no textures, no models, no fonts, no fetch. Geometry from primitives; toon materials.
4. Guard every cross-module read (`G.boat?.`, `G.players?.length`) — init order is fixed but be defensive in update.
5. Performance: target 60 fps on iPad. Reuse geometries/materials, no per-frame allocations in hot loops (reuse temp vectors), max ~200 draw calls total budget — instance or merge where sensible.
6. Kid-friendly: no blood, no death screams, danger is always slapstick. English, simple words, a few emoji ok.
7. `node --check js/yourfile.js` must pass before you finish.
8. Keep it ≤ ~900 lines. Prefer fewer, chunkier functions with clear names. Comment only non-obvious constraints.
