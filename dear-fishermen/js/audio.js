// audio.js — Dear Fishermen: all music + SFX, pure WebAudio, no assets.
// Owns: nothing in the DOM. Fills: G.sfx(name, opts), G.music(mode), G.audioMuted.
// Music modes: 'title' | 'day' | 'night' | 'boss' | null (silence).
// Storm percussion is a LAYER on top of day/night. Curse adds a wonky detune warble.

const MUTE_KEY = 'df-muted';
const LOOKAHEAD = 0.12;      // seconds of scheduling lookahead
const TICK_MS = 40;          // scheduler interval
const XFADE = 2.0;           // music crossfade seconds
const MAX_SFX_VOICES = 8;    // concurrent one-shots

let ctx = null;              // AudioContext (created on first user gesture)
let master = null;           // master gain (mute target)
let musicBus = null;         // all music -> here
let sfxBus = null;
let noiseBuf = null;         // shared white-noise buffer
let warbleLfo = null;        // curse vibrato source (osc)
let warbleGain = null;       // curse vibrato depth (cents) — 0 when not cursed
let Gref = null;

let muted = false;
let sfxVoices = 0;

// ---- music engine state ----
const tracks = [];           // active songs/layers: {song, bus, step, nextTime, stopping}
let currentMode = null;      // requested main-music mode
let stormOn = false;
let schedTimer = null;
let stingLock = 0;           // ctx.currentTime until which normal music may not start (legendary silence)
let creakCooldown = 0;
let thunderCooldown = 0;

// ------------------------------------------------------------------ helpers
function midi(n) { return 440 * Math.pow(2, (n - 69) / 12); }
function now() { return ctx ? ctx.currentTime : 0; }

function ensureCtx() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0.0001 : 0.55;
  master.connect(ctx.destination);
  musicBus = ctx.createGain();
  musicBus.gain.value = 0.5;
  musicBus.connect(master);
  sfxBus = ctx.createGain();
  sfxBus.gain.value = 0.85;
  sfxBus.connect(master);
  // soft echo on music for coziness
  const echo = ctx.createDelay(0.6);
  echo.delayTime.value = 0.29;
  const echoG = ctx.createGain();
  echoG.gain.value = 0.18;
  musicBus.connect(echo); echo.connect(echoG); echoG.connect(master);
  // shared noise buffer (1 s)
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  // curse warble: one LFO, depth gain in cents; connected to music osc detune when scheduling
  warbleLfo = ctx.createOscillator();
  warbleLfo.type = 'sine';
  warbleLfo.frequency.value = 5.2;
  warbleGain = ctx.createGain();
  warbleGain.gain.value = 0;
  warbleLfo.connect(warbleGain);
  warbleLfo.start();
  if (!schedTimer) schedTimer = setInterval(schedule, TICK_MS);
  applyMusicForState(); // start whatever the game is doing right now
}

function setMuted(m) {
  muted = m;
  try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch (e) {}
  if (Gref) Gref.audioMuted = m;
  if (master) {
    const t = now();
    master.gain.cancelScheduledValues(t);
    master.gain.setTargetAtTime(m ? 0.0001 : 0.55, t, 0.05);
  }
}

// One tone with exp-safe envelope. Music notes get the curse warble on detune.
function tone(t, freq, dur, type, vol, dest, opts) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(Math.max(20, freq), t);
  if (opts?.glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.glide), t + dur);
  if (opts?.detune) o.detune.value = opts.detune;
  if (opts?.warble && warbleGain) warbleGain.connect(o.detune);
  const g = ctx.createGain();
  const a = opts?.attack ?? 0.012;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.001, vol), t + a);
  g.gain.setValueAtTime(Math.max(0.001, vol), t + Math.max(a, dur - 0.06));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
  if (opts?.filter) {
    const f = ctx.createBiquadFilter();
    f.type = opts.filterType || 'lowpass';
    f.frequency.setValueAtTime(opts.filter, t);
    if (opts.filterEnd) f.frequency.exponentialRampToValueAtTime(opts.filterEnd, t + dur);
    o.connect(f); f.connect(g);
  } else {
    o.connect(g);
  }
  g.connect(dest);
  o.start(t);
  o.stop(t + dur + 0.1);
  return o;
}

// Filtered noise burst from the shared buffer.
function noise(t, dur, vol, filterType, f0, f1, dest, q) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = filterType;
  f.frequency.setValueAtTime(Math.max(20, f0), t);
  if (f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  if (q) f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(Math.max(0.001, vol), t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(dest);
  src.start(t);
  src.stop(t + dur + 0.05);
}

// ------------------------------------------------------------------ SONGS
// Each song: { bpm, steps (16th-note loop length), play(step, t, sd, bus) }.
// sd = duration of one 16th step in seconds.

// DAY — jaunty sea shanty, D pentatonic-ish, 8 bars of 4/4 = 128 sixteenths.
const DAY_MELODY = [ // [step, midiNote, lenSteps] — plucky square
  [0, 74, 2], [2, 76, 2], [4, 78, 2], [6, 81, 2], [8, 78, 3], [12, 76, 3],
  [16, 74, 2], [18, 71, 2], [20, 74, 2], [22, 76, 2], [24, 78, 6],
  [32, 81, 2], [34, 83, 2], [36, 81, 2], [38, 78, 2], [40, 76, 3], [44, 74, 3],
  [48, 71, 2], [50, 74, 2], [52, 76, 2], [54, 74, 2], [56, 71, 4], [60, 69, 4],
  [64, 74, 2], [66, 76, 2], [68, 78, 2], [70, 81, 2], [72, 83, 3], [76, 81, 3],
  [80, 78, 2], [82, 76, 2], [84, 78, 2], [86, 81, 2], [88, 78, 6],
  [96, 76, 2], [98, 74, 2], [100, 71, 2], [102, 69, 2], [104, 71, 3], [108, 74, 3],
  [112, 76, 2], [114, 78, 2], [116, 76, 2], [118, 71, 2], [120, 74, 8],
];
const DAY_BASS_ROOTS = [50, 50, 55, 55, 50, 50, 43, 45]; // per bar (D D G G D D G, A)
const SONG_DAY = {
  bpm: 120, steps: 128,
  play(step, t, sd, bus) {
    for (let i = 0; i < DAY_MELODY.length; i++) {
      const m = DAY_MELODY[i];
      if (m[0] === step) tone(t, midi(m[1]), m[2] * sd * 0.9, 'square', 0.085, bus, { filter: 1900, warble: true });
    }
    const bar = (step / 16) | 0;
    const inBar = step % 16;
    if (inBar === 0 || inBar === 6 || inBar === 8 || inBar === 14) { // oom-PAH bounce
      const root = DAY_BASS_ROOTS[bar % 8];
      const n = (inBar === 6 || inBar === 14) ? root + 7 : root;
      tone(t, midi(n), sd * 1.7, 'triangle', 0.22, bus, { warble: true });
    }
    if (step % 4 === 2) noise(t, 0.04, 0.06, 'highpass', 7500, null, bus); // light hats
    if (inBar === 0) { // soft kick thump
      tone(t, 120, 0.1, 'sine', 0.2, bus, { glide: 48 });
    }
  },
};

// NIGHT — sparse creepy: slow minor pad, lonely bell, deep sub pulses. Bar = slow.
const NIGHT_CHORDS = [[50, 53, 57], [48, 51, 55], [50, 53, 57], [46, 50, 53]]; // Dm, Cm-ish, Dm, Bb-ish
const NIGHT_BELLS = [74, 77, 69, 81, 72];
const SONG_NIGHT = {
  bpm: 56, steps: 64, // 4 slow bars
  play(step, t, sd, bus) {
    if (step % 32 === 0) { // pad chord: detuned saws through dark lowpass, long swell
      const ch = NIGHT_CHORDS[((step / 32) | 0) % NIGHT_CHORDS.length];
      for (let i = 0; i < 3; i++) {
        tone(t, midi(ch[i]), sd * 30, 'sawtooth', 0.05, bus, { filter: 420, detune: 7, attack: sd * 6, warble: true });
        tone(t, midi(ch[i]), sd * 30, 'sawtooth', 0.045, bus, { filter: 420, detune: -8, attack: sd * 8, warble: true });
      }
    }
    if (step % 16 === 0) tone(t, midi(26), sd * 6, 'sine', 0.22, bus, { attack: sd * 1.5 }); // ocean sub pulse
    if (step % 8 === 4 && Math.random() < 0.22) { // occasional lonely bell
      const n = NIGHT_BELLS[(Math.random() * NIGHT_BELLS.length) | 0];
      tone(t, midi(n), sd * 7, 'sine', 0.07, bus, { warble: true });
      tone(t, midi(n) * 2.01, sd * 4, 'sine', 0.02, bus);
    }
  },
};

// BOSS — low brass-ish stabs + driving drums. D minor menace, 2 bars.
const BOSS_STAB_STEPS = { 0: 0, 3: 0, 6: 1, 10: 0, 16: 2, 19: 2, 22: 1, 26: 3 };
const BOSS_STABS = [[38, 45, 50], [36, 43, 48], [41, 48, 53], [37, 44, 49]];
const SONG_BOSS = {
  bpm: 140, steps: 32,
  play(step, t, sd, bus) {
    const stab = BOSS_STAB_STEPS[step];
    if (stab !== undefined) {
      const ch = BOSS_STABS[stab];
      for (let i = 0; i < 3; i++) {
        tone(t, midi(ch[i]), sd * 2.6, 'sawtooth', 0.11, bus, { filter: 900, filterEnd: 300, warble: true });
      }
    }
    if (step % 8 === 0) tone(t, 130, 0.12, 'sine', 0.34, bus, { glide: 42 });           // kick
    if (step % 8 === 4) noise(t, 0.09, 0.2, 'bandpass', 1300, 500, bus, 1.2);           // snare-ish
    if (step % 2 === 0) noise(t, 0.03, 0.07, 'highpass', 8000, null, bus);              // driving hats
    if (step === 14 || step === 30) tone(t, 98, 0.14, 'sine', 0.24, bus, { glide: 55 }); // tom fill
  },
};

// TITLE — soft calm ditty, gentle waves of sine.
const TITLE_MELODY = [[0, 69, 4], [8, 72, 4], [16, 76, 6], [24, 74, 4], [32, 72, 4], [40, 69, 6], [48, 67, 4], [56, 64, 6]];
const SONG_TITLE = {
  bpm: 84, steps: 64,
  play(step, t, sd, bus) {
    for (let i = 0; i < TITLE_MELODY.length; i++) {
      const m = TITLE_MELODY[i];
      if (m[0] === step) {
        tone(t, midi(m[1]), m[2] * sd * 1.1, 'sine', 0.1, bus, { attack: 0.05 });
        tone(t, midi(m[1] - 24), m[2] * sd * 1.2, 'triangle', 0.12, bus, { attack: 0.06 });
      }
    }
    if (step % 16 === 8) noise(t, sd * 6, 0.03, 'lowpass', 900, 300, bus); // distant wave wash
  },
};

// STORM layer — driving toms + fast hats + tension drone (drone via long notes).
const SONG_STORM = {
  bpm: 140, steps: 16,
  play(step, t, sd, bus) {
    if (step % 4 === 0 || step === 6 || step === 13) {              // rolling toms
      tone(t, 110 + (step % 8) * 8, 0.12, 'sine', 0.26, bus, { glide: 50 });
    }
    if (step % 2 === 1) noise(t, 0.028, 0.06, 'highpass', 9000, null, bus); // rain-fast hats
    if (step === 0) tone(t, midi(38), sd * 17, 'sawtooth', 0.05, bus, { filter: 260, detune: 5, attack: sd * 3 }); // drone
  },
};

const SONGS = { day: SONG_DAY, night: SONG_NIGHT, boss: SONG_BOSS, title: SONG_TITLE, storm: SONG_STORM };

// ------------------------------------------------------------------ track control
function startTrack(name) {
  const song = SONGS[name];
  if (!song || !ctx) return null;
  const bus = ctx.createGain();
  bus.gain.setValueAtTime(0.0001, now());
  bus.gain.exponentialRampToValueAtTime(1, now() + XFADE);
  bus.connect(musicBus);
  const tr = { name, song, bus, step: 0, nextTime: now() + 0.06, stopping: false };
  tracks.push(tr);
  return tr;
}

function stopTrack(tr, fade) {
  if (!tr || tr.stopping) return;
  tr.stopping = true;
  const t = now();
  const f = Math.max(0.05, fade);
  tr.bus.gain.cancelScheduledValues(t);
  tr.bus.gain.setValueAtTime(Math.max(0.0001, tr.bus.gain.value), t);
  tr.bus.gain.exponentialRampToValueAtTime(0.0001, t + f);
  setTimeout(() => {
    const i = tracks.indexOf(tr);
    if (i >= 0) tracks.splice(i, 1);
    try { tr.bus.disconnect(); } catch (e) {}
  }, (f + 1.2) * 1000);
}

function schedule() {
  if (!ctx) return;
  const horizon = now() + LOOKAHEAD;
  for (let i = 0; i < tracks.length; i++) {
    const tr = tracks[i];
    if (tr.stopping) continue;
    const sd = 60 / tr.song.bpm / 4;
    while (tr.nextTime < horizon) {
      tr.song.play(tr.step % tr.song.steps, tr.nextTime, sd, tr.bus);
      tr.step++;
      tr.nextTime += sd;
    }
  }
}

function mainTrack() {
  for (let i = 0; i < tracks.length; i++) {
    if (!tracks[i].stopping && tracks[i].name !== 'storm') return tracks[i];
  }
  return null;
}
function stormTrack() {
  for (let i = 0; i < tracks.length; i++) {
    if (!tracks[i].stopping && tracks[i].name === 'storm') return tracks[i];
  }
  return null;
}

// Request a main-music mode ('title'|'day'|'night'|'boss'|null). Crossfades.
function setMusic(mode, fade) {
  currentMode = mode;
  if (!ctx) return;
  if (mode && now() < stingLock) return; // legendary silence in progress; resumes on leviathan:begin
  const cur = mainTrack();
  if (cur && cur.name === mode) return;
  if (cur) stopTrack(cur, fade ?? XFADE);
  if (mode) startTrack(mode);
  syncStormLayer();
}

function syncStormLayer() {
  const want = stormOn && (currentMode === 'day' || currentMode === 'night' || currentMode === 'boss');
  const have = stormTrack();
  if (want && !have) startTrack('storm');
  if (!want && have) stopTrack(have, XFADE);
}

// Pick music from game state (used on unlock + state changes).
function applyMusicForState() {
  const G = Gref;
  if (!G) return;
  const s = G.state;
  if (s === 'title' || s === 'retired') setMusic('title');
  else if (s === 'gameover') setMusic(null, 0.8);
  else if (s === 'playing' || s === 'paused' || s === 'shop' || s === 'summary') {
    if (G.flags?.bossActive || bossOn) setMusic('boss');
    else setMusic(G.time?.phase === 'night' ? 'night' : 'day');
  }
}
let bossOn = false;

// Legendary bite: hard-stop everything — the silence IS the horror — then one deep eerie swell.
function legendarySting() {
  if (!ctx) return;
  for (let i = tracks.length - 1; i >= 0; i--) stopTrack(tracks[i], 0.12); // hard stop (fast, click-free)
  stingLock = now() + 30; // no normal music until leviathan:begin (or 30 s failsafe)
  const t = now() + 1.4;  // ...silence...
  tone(t, midi(26), 6, 'sine', 0.3, musicBus, { attack: 2.5 });                              // deep swell
  tone(t + 0.1, midi(26) * 0.5, 6, 'sine', 0.18, musicBus, { attack: 3 });                   // sub under it
  tone(t + 1, midi(38), 5, 'sawtooth', 0.04, musicBus, { filter: 200, detune: 9, attack: 2 }); // dark shimmer
  noise(t + 2, 3.5, 0.05, 'lowpass', 300, 90, musicBus);
}

// ------------------------------------------------------------------ SFX
const SFX = {
  splash(t, o) { noise(t, 0.3, 0.3, 'lowpass', 1500, 300, sfxBus); tone(t, 300, 0.12, 'sine', 0.1, sfxBus, { glide: 90 }); },
  bigsplash(t) {
    noise(t, 0.7, 0.42, 'lowpass', 1100, 160, sfxBus);
    tone(t, 140, 0.3, 'sine', 0.25, sfxBus, { glide: 45 });
    noise(t + 0.25, 0.5, 0.12, 'highpass', 2500, 6000, sfxBus); // droplets
  },
  reel(t, o) { // ratchet ticks — one call = a short burst
    const n = o?.ticks ?? 3;
    for (let i = 0; i < n; i++) {
      noise(t + i * 0.05, 0.018, 0.16, 'bandpass', 2600 + Math.random() * 500, null, sfxBus, 6);
    }
  },
  lineSnap(t) {
    tone(t, 900, 0.09, 'sawtooth', 0.2, sfxBus, { glide: 200, filter: 3000 }); // twang
    noise(t + 0.02, 0.08, 0.15, 'highpass', 3000, null, sfxBus);
  },
  bite(t) { tone(t, 260, 0.14, 'sine', 0.22, sfxBus, { glide: 520 }); tone(t + 0.1, 480, 0.08, 'sine', 0.12, sfxBus, { glide: 240 }); }, // blub!
  catch(t) { // 3-note fanfare
    tone(t, midi(72), 0.13, 'square', 0.1, sfxBus, { filter: 2200 });
    tone(t + 0.13, midi(76), 0.13, 'square', 0.1, sfxBus, { filter: 2200 });
    tone(t + 0.26, midi(79), 0.3, 'square', 0.12, sfxBus, { filter: 2600 });
    tone(t + 0.26, midi(67), 0.3, 'triangle', 0.12, sfxBus);
  },
  coin(t) { tone(t, midi(88), 0.07, 'square', 0.09, sfxBus, { filter: 5000 }); tone(t + 0.07, midi(93), 0.22, 'square', 0.09, sfxBus, { filter: 6000 }); },
  hammer(t) { // thock x2
    tone(t, 190, 0.07, 'square', 0.2, sfxBus, { filter: 800, glide: 90 });
    tone(t + 0.16, 170, 0.07, 'square', 0.18, sfxBus, { filter: 700, glide: 80 });
    noise(t, 0.03, 0.1, 'lowpass', 1200, null, sfxBus);
  },
  fireWhoosh(t) { noise(t, 0.5, 0.2, 'lowpass', 2400, 500, sfxBus); noise(t + 0.05, 0.35, 0.08, 'bandpass', 700, 250, sfxBus, 1.5); },
  bucketSplash(t) { noise(t, 0.35, 0.3, 'lowpass', 1800, 350, sfxBus); tone(t + 0.05, 400, 0.1, 'sine', 0.08, sfxBus, { glide: 150 }); },
  creak(t) { // slow wooden bend
    tone(t, 160, 0.8, 'sawtooth', 0.07, sfxBus, { filter: 500, glide: 95, attack: 0.15 });
    tone(t + 0.1, 210, 0.6, 'sawtooth', 0.04, sfxBus, { filter: 450, glide: 140, attack: 0.2 });
  },
  cannon(t) {
    tone(t, 90, 0.25, 'sine', 0.4, sfxBus, { glide: 35 });                     // deep thunk
    noise(t, 0.12, 0.3, 'lowpass', 900, 200, sfxBus);
    noise(t + 0.08, 0.5, 0.14, 'bandpass', 1600, 300, sfxBus, 1);              // whoosh away
  },
  chomp(t) {
    noise(t, 0.07, 0.3, 'lowpass', 1300, 500, sfxBus);
    tone(t + 0.06, 140, 0.09, 'square', 0.2, sfxBus, { filter: 600, glide: 70 });
  },
  roar(t) { // big filtered saw growl — scary but goofy
    const o = tone(t, 58, 1.1, 'sawtooth', 0.3, sfxBus, { filter: 480, filterEnd: 180 });
    o.frequency.linearRampToValueAtTime(92, t + 0.35);
    o.frequency.linearRampToValueAtTime(48, t + 1.0);
    noise(t, 0.9, 0.12, 'bandpass', 260, 120, sfxBus, 1.2);
  },
  gulp(t) { tone(t, 300, 0.18, 'sine', 0.2, sfxBus, { glide: 90 }); tone(t + 0.16, 120, 0.12, 'sine', 0.16, sfxBus, { glide: 260 }); },
  wahh(t) { // goofy pitch-bent voice blip (panic/stumble)
    const o = tone(t, 340 + Math.random() * 80, 0.34, 'triangle', 0.18, sfxBus, { filter: 1400 });
    o.frequency.exponentialRampToValueAtTime(150, t + 0.32); // waaaahh (down-bend)
    tone(t + 0.02, 680, 0.1, 'sine', 0.05, sfxBus, { glide: 300 });
  },
  spooky(t) { // airy whisper-ish noise
    noise(t, 1.6, 0.06, 'bandpass', 1800, 900, sfxBus, 4);
    noise(t + 0.5, 1.1, 0.04, 'bandpass', 2600, 1400, sfxBus, 5);
    tone(t + 0.2, midi(62), 1.4, 'sine', 0.03, sfxBus, { detune: 12, attack: 0.5 });
  },
  thunder(t) {
    noise(t, 0.15, 0.35, 'lowpass', 4000, 1000, sfxBus);   // crack
    noise(t + 0.12, 2.2, 0.28, 'lowpass', 380, 70, sfxBus); // rumble
    tone(t + 0.1, 55, 1.8, 'sine', 0.15, sfxBus, { glide: 30, attack: 0.1 });
  },
  uiClick(t) { tone(t, 700, 0.05, 'square', 0.07, sfxBus, { filter: 2500, glide: 500 }); },
};

const SFX_ALIAS = { cast: 'fireWhoosh', hook: 'bite', snap: 'lineSnap', rumble: 'roar', legendary: 'roar', plop: 'splash', fanfare: 'catch', thunk: 'hammer', pop: 'uiClick', whoosh: 'fireWhoosh', boing: 'wahh', scoop: 'bucketSplash', thud: 'hammer', shark: 'chomp', curse: 'spooky', flop: 'splash', boss: 'roar', groan: 'creak', pickup: 'coin', sharkFlee: 'splash', sharkAttack: 'chomp', upgrade: 'catch', bell: 'coin' };

function playSfx(name, opts) {
  if (!ctx || muted) return;
  const fn = SFX[name] || SFX[SFX_ALIAS[name]];
  if (!fn) return;
  if (sfxVoices >= MAX_SFX_VOICES) return; // stay light on iPad
  sfxVoices++;
  setTimeout(() => { sfxVoices = Math.max(0, sfxVoices - 1); }, 350);
  try { fn(now(), opts); } catch (e) {}
}

// ------------------------------------------------------------------ module API
export function init(G) {
  Gref = G;
  try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) {}
  G.audioMuted = muted;
  G.sfx = (name, opts) => playSfx(name, opts);
  G.music = (mode) => { if (SONGS[mode] || mode === null) setMusic(mode === 'storm' ? currentMode : mode); };

  // Unlock the AudioContext on the first real user gesture (iOS requirement).
  const unlock = () => {
    ensureCtx();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    window.removeEventListener('touchstart', unlock);
  };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock);
  window.addEventListener('touchstart', unlock, { passive: true });

  // -------- mute toggle (hud button emits 'audio:mute')
  G.on('audio:mute', () => {
    ensureCtx();
    setMuted(!muted);
    G.emit('audio:muted', { muted });
  });

  // -------- music routing
  G.on('state:change', ({ to }) => {
    if (to === 'title' || to === 'gameover' || to === 'retired') { bossOn = false; stingLock = 0; }
    applyMusicForState();
    if (to === 'paused' || to === 'shop') playSfx('uiClick');
  });
  G.on('day:dusk', () => { if (!bossOn) setMusic('night'); playSfx('spooky'); });
  G.on('day:dawn', () => { if (!bossOn) setMusic('day'); });
  G.on('storm:start', () => { stormOn = true; syncStormLayer(); });
  G.on('storm:end', () => { stormOn = false; syncStormLayer(); });
  G.on('typhoon:start', () => { stormOn = true; syncStormLayer(); });
  G.on('typhoon:end', () => { stormOn = false; syncStormLayer(); });
  G.on('megalodon:begin', () => { bossOn = true; setMusic('boss'); playSfx('roar'); });
  G.on('megalodon:end', () => { bossOn = false; applyMusicForState(); });
  G.on('leviathan:begin', () => { bossOn = true; stingLock = 0; setMusic('boss', 0.3); playSfx('roar'); });
  G.on('leviathan:end', () => { bossOn = false; applyMusicForState(); });
  // The legendary bite: music hard-stops — that silence IS the horror.
  G.on('fish:legendary-bite', legendarySting);
  G.on('fish:legendary', legendarySting); // GDD names this one; support both, sting guards itself

  // -------- curse warble (comic creepy detune wobble on all music notes)
  G.on('curse:start', () => {
    if (!warbleGain) return;
    warbleGain.gain.setTargetAtTime(38, now(), 0.4); // ±38 cents of seasick vibrato
    warbleLfo.frequency.setTargetAtTime(4.6, now(), 0.4);
    playSfx('spooky');
  });
  G.on('curse:end', () => {
    if (warbleGain) warbleGain.gain.setTargetAtTime(0, now(), 0.6);
  });

  // -------- SFX wired to events (fire-and-forget; modules can also call G.sfx directly)
  const wire = (ev, name) => G.on(ev, (d) => playSfx(name, d));
  wire('fish:bite', 'bite');
  wire('fish:lost', 'lineSnap');
  wire('boat:leak', 'splash');
  wire('boat:fire', 'fireWhoosh');
  wire('boat:repaired', 'hammer');
  wire('shark:attack', 'chomp');
  wire('bot:panic', 'wahh');
  wire('lightning', 'thunder');
  wire('p2:join', 'coin');
  G.on('fish:caught', (d) => {
    playSfx('catch');
    playSfx('splash');
  });
  G.on('money:change', (d) => { if ((d?.delta ?? 0) > 0) playSfx('coin'); });
  G.on('boat:damage', () => playSfx('bigsplash'));
  G.on('boat:sinking', () => playSfx('wahh'));
  G.on('shop:open', () => playSfx('uiClick'));
  G.on('shop:close', () => playSfx('uiClick'));
  G.on('cannon:fire', () => playSfx('cannon'));
  G.on('creepy', () => playSfx('spooky'));
}

export function update(G, dt) {
  if (!ctx) return;

  // Thunder self-trigger fallback: if no 'lightning' event exists, fire on strong storms now and then.
  if (dt > 0) {
    creakCooldown -= dt;
    thunderCooldown -= dt;

    // Wood creaks tied to big boat tilt (self-triggered — feels alive).
    const rot = G.boat?.group?.rotation;
    if (rot && creakCooldown <= 0) {
      const tilt = Math.abs(rot.x) + Math.abs(rot.z);
      if (tilt > 0.12) {
        playSfx('creak');
        creakCooldown = 1.6 + Math.random() * 2.5;
      }
    }
    const storm = G.weather?.storm ?? 0;
    if (storm > 0.6 && thunderCooldown <= 0 && Math.random() < dt * 0.08) {
      playSfx('thunder');
      thunderCooldown = 8;
    }
    // Failsafe: if the legendary silence lock expired with no leviathan, resume music.
    if (stingLock && now() > stingLock) { stingLock = 0; applyMusicForState(); }
    // Defensive resync: if playing with no main track (e.g. after rapid flapping), restart.
    if (!mainTrack() && currentMode && now() > stingLock) setMusic(currentMode);
  }
}
