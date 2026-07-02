// audio.js — all musik och alla ljudeffekter skapas med WebAudio, inga ljudfiler behövs
function midi(n) { return 440 * Math.pow(2, (n - 69) / 12); }

// Äventyrslåten: gladt tema i F-dur, 4 takter som loopar
const AVENTYR = {
  bpm: 132,
  steg: 64,
  melodi: [
    [0, 69, 2], [2, 72, 2], [4, 69, 2], [6, 65, 2], [8, 67, 4], [12, 69, 4],
    [16, 67, 2], [18, 64, 2], [20, 67, 2], [22, 72, 2], [24, 74, 4], [28, 72, 4],
    [32, 69, 2], [34, 74, 2], [36, 72, 2], [38, 69, 2], [40, 65, 4], [44, 67, 4],
    [48, 70, 2], [50, 72, 2], [52, 74, 2], [54, 72, 2], [56, 69, 2], [58, 67, 2], [60, 65, 4],
  ],
  bas: [
    [0, 41, 2], [4, 48, 2], [8, 41, 2], [12, 48, 2],
    [16, 48, 2], [20, 43, 2], [24, 48, 2], [28, 43, 2],
    [32, 50, 2], [36, 45, 2], [40, 50, 2], [44, 45, 2],
    [48, 46, 2], [52, 53, 2], [56, 48, 2], [60, 43, 2],
  ],
  ackord: [[65, 69, 72], [64, 67, 72], [62, 65, 69], [58, 62, 65]],
};

// Drakens låt: spänning i d-moll, snabbare puls
const DRAKE = {
  bpm: 148,
  steg: 32,
  melodi: [
    [0, 74, 1], [2, 74, 1], [4, 77, 3], [8, 74, 1], [10, 72, 1], [12, 69, 3],
    [16, 70, 2], [19, 70, 1], [20, 72, 2], [24, 69, 2], [26, 67, 1], [28, 65, 3],
  ],
  bas: [
    [0, 38, 1], [2, 50, 1], [4, 38, 1], [6, 50, 1], [8, 38, 1], [10, 50, 1], [12, 38, 1], [14, 50, 1],
    [16, 46, 1], [18, 58, 1], [20, 46, 1], [22, 58, 1], [24, 45, 1], [26, 57, 1], [28, 45, 1], [30, 57, 1],
  ],
  ackord: [[62, 65, 69], [62, 65, 69], [58, 62, 65], [57, 61, 64]],
};

const LATAR = { aventyr: AVENTYR, drake: DRAKE };

export class Ljud {
  constructor() {
    this.ctx = null;
    this.tystad = false;
    this._lat = null;
    this._steg = 0;
    this._nastaTid = 0;
    this._timer = null;
    this._brus = null;
  }

  igang() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.musik = this.ctx.createGain();
      this.musik.gain.value = 0.4;
      this.musik.connect(this.master);
      this.sfx = this.ctx.createGain();
      this.sfx.gain.value = 0.8;
      this.sfx.connect(this.master);
      // Ett mjukt eko på musiken gör den mysigare
      const eko = this.ctx.createDelay(0.5);
      eko.delayTime.value = 0.27;
      const ekoGain = this.ctx.createGain();
      ekoGain.gain.value = 0.22;
      this.musik.connect(eko);
      eko.connect(ekoGain);
      ekoGain.connect(this.master);
      // Brusbuffert för trummor och effekter
      const buf = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this._brus = buf;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  vaxlaTyst() {
    this.tystad = !this.tystad;
    if (this.master) this.master.gain.value = this.tystad ? 0 : 0.5;
    return this.tystad;
  }

  // ---------- Musikmotorn ----------
  spelaLat(namn) {
    if (!this.ctx) return;
    this._lat = LATAR[namn];
    this._steg = 0;
    this._nastaTid = this.ctx.currentTime + 0.06;
    if (!this._timer) this._timer = setInterval(() => this._schemalagg(), 40);
  }

  stoppaMusik() { this._lat = null; }

  _schemalagg() {
    if (!this._lat || !this.ctx) return;
    const stegTid = 60 / this._lat.bpm / 4;
    while (this._nastaTid < this.ctx.currentTime + 0.14) {
      this._spelaSteg(this._lat, this._steg % this._lat.steg, this._nastaTid, stegTid);
      this._steg++;
      this._nastaTid += stegTid;
    }
  }

  _spelaSteg(lat, steg, tid, stegTid) {
    for (const [s, ton, len] of lat.melodi) {
      if (s === steg) this._ton(tid, midi(ton), len * stegTid * 0.92, 'square', 0.11, this.musik, 1600);
    }
    for (const [s, ton, len] of lat.bas) {
      if (s === steg) this._ton(tid, midi(ton), len * stegTid * 0.9, 'triangle', 0.22, this.musik);
    }
    // Mjukt arpeggio på var fjärde steg
    if (steg % 4 === 2) {
      const takt = Math.floor(steg / 16) % lat.ackord.length;
      const ton = lat.ackord[takt][(steg / 2) % 3 | 0] + 12;
      this._ton(tid, midi(ton), stegTid * 1.8, 'sine', 0.05, this.musik);
    }
    // Trumkomp
    if (steg % 8 === 0) this._trumma(tid);
    if (steg % 8 === 4) this._shaker(tid);
  }

  _ton(tid, freq, dur, typ, vol, dest, filterHz, glidTill) {
    const o = this.ctx.createOscillator();
    o.type = typ;
    o.frequency.setValueAtTime(freq, tid);
    if (glidTill) o.frequency.exponentialRampToValueAtTime(glidTill, tid + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, tid);
    g.gain.linearRampToValueAtTime(vol, tid + 0.012);
    g.gain.setValueAtTime(vol, tid + Math.max(0.012, dur - 0.05));
    g.gain.linearRampToValueAtTime(0.0001, tid + dur + 0.03);
    let ut = g;
    if (filterHz) {
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = filterHz;
      o.connect(f); f.connect(g);
    } else {
      o.connect(g);
    }
    ut.connect(dest);
    o.start(tid);
    o.stop(tid + dur + 0.1);
  }

  _brusljud(tid, dur, vol, filterTyp, freqStart, freqSlut, dest) {
    const kalla = this.ctx.createBufferSource();
    kalla.buffer = this._brus;
    kalla.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = filterTyp;
    f.frequency.setValueAtTime(freqStart, tid);
    if (freqSlut) f.frequency.exponentialRampToValueAtTime(freqSlut, tid + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, tid);
    g.gain.exponentialRampToValueAtTime(0.0001, tid + dur);
    kalla.connect(f); f.connect(g); g.connect(dest || this.sfx);
    kalla.start(tid);
    kalla.stop(tid + dur + 0.05);
  }

  _trumma(tid) {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(130, tid);
    o.frequency.exponentialRampToValueAtTime(45, tid + 0.11);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.4, tid);
    g.gain.exponentialRampToValueAtTime(0.0001, tid + 0.13);
    o.connect(g); g.connect(this.musik);
    o.start(tid); o.stop(tid + 0.15);
  }

  _shaker(tid) {
    this._brusljud(tid, 0.05, 0.07, 'highpass', 7000, null, this.musik);
  }

  // ---------- Ljudeffekter ----------
  _nu() { return this.ctx ? this.ctx.currentTime : 0; }

  svard() {
    if (!this.ctx) return;
    this._brusljud(this._nu(), 0.16, 0.25, 'bandpass', 900, 220);
  }

  magi() {
    if (!this.ctx) return;
    const t = this._nu();
    [79, 84, 88, 91].forEach((n, i) => {
      this._ton(t + i * 0.045, midi(n), 0.16, 'sine', 0.09, this.sfx);
    });
    this._brusljud(t, 0.3, 0.05, 'highpass', 6000);
  }

  plocka() {
    if (!this.ctx) return;
    const t = this._nu();
    [72, 76, 79, 84].forEach((n, i) => {
      this._ton(t + i * 0.06, midi(n), 0.18, 'triangle', 0.12, this.sfx);
    });
  }

  nyckel() {
    if (!this.ctx) return;
    const t = this._nu();
    [76, 81, 85, 88, 93].forEach((n, i) => {
      this._ton(t + i * 0.055, midi(n), 0.22, 'sine', 0.11, this.sfx);
      this._ton(t + i * 0.055, midi(n) * 2, 0.12, 'sine', 0.04, this.sfx);
    });
  }

  dorrUpp() {
    if (!this.ctx) return;
    const t = this._nu();
    this._ton(t, 70, 0.18, 'square', 0.18, this.sfx, 400);
    this._ton(t + 0.12, 120, 0.5, 'sawtooth', 0.1, this.sfx, 900, 480);
    this._ton(t + 0.55, midi(77), 0.3, 'sine', 0.1, this.sfx);
  }

  last() {
    if (!this.ctx) return;
    const t = this._nu();
    this._ton(t, 110, 0.07, 'triangle', 0.22, this.sfx);
    this._ton(t + 0.13, 95, 0.09, 'triangle', 0.22, this.sfx);
  }

  hopp() {
    if (!this.ctx) return;
    this._ton(this._nu(), 300, 0.13, 'sine', 0.14, this.sfx, null, 640);
  }

  klattra() {
    if (!this.ctx) return;
    const t = this._nu();
    this._ton(t, 290 + Math.random() * 50, 0.07, 'triangle', 0.1, this.sfx);
    this._ton(t + 0.09, 370 + Math.random() * 50, 0.07, 'triangle', 0.08, this.sfx);
  }

  traff() {
    if (!this.ctx) return;
    this._ton(this._nu(), 240, 0.08, 'square', 0.14, this.sfx, 1200, 150);
  }

  poff() {
    if (!this.ctx) return;
    const t = this._nu();
    this._brusljud(t, 0.24, 0.28, 'lowpass', 1400, 250);
    this._ton(t, 320, 0.16, 'sine', 0.12, this.sfx, null, 110);
  }

  aj() {
    if (!this.ctx) return;
    this._ton(this._nu(), 260, 0.22, 'triangle', 0.2, this.sfx, null, 120);
  }

  eld() {
    if (!this.ctx) return;
    this._brusljud(this._nu(), 0.38, 0.16, 'lowpass', 2200, 320);
  }

  vral() {
    if (!this.ctx) return;
    const t = this._nu();
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(62, t);
    o.frequency.linearRampToValueAtTime(88, t + 0.4);
    o.frequency.linearRampToValueAtTime(55, t + 0.85);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.3, t + 0.08);
    g.gain.linearRampToValueAtTime(0.0001, t + 0.9);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 500;
    o.connect(f); f.connect(g); g.connect(this.sfx);
    o.start(t); o.stop(t + 1);
    this._brusljud(t, 0.8, 0.1, 'bandpass', 300, 150);
  }

  bubbla() {
    if (!this.ctx) return;
    const t = this._nu();
    this._ton(t, 480, 0.13, 'sine', 0.16, this.sfx, null, 950);
    this._brusljud(t + 0.1, 0.06, 0.14, 'highpass', 2000);
  }

  enhorningsljud() {
    if (!this.ctx) return;
    const t = this._nu();
    [65, 67, 69, 72, 74, 77, 79, 84].forEach((n, i) => {
      this._ton(t + i * 0.05, midi(n), 0.25, 'sine', 0.09, this.sfx);
    });
  }

  fanfar() {
    if (!this.ctx) return;
    const t = this._nu();
    const spela = (tid, toner, dur) => {
      for (const n of toner) {
        this._ton(tid, midi(n), dur, 'sawtooth', 0.07, this.sfx, 1800);
        this._ton(tid, midi(n), dur, 'triangle', 0.1, this.sfx);
      }
    };
    spela(t, [65, 69, 72], 0.18);
    spela(t + 0.22, [65, 69, 72], 0.14);
    spela(t + 0.44, [67, 70, 74], 0.2);
    spela(t + 0.72, [69, 72, 77], 0.85);
    this._brusljud(t + 0.72, 0.4, 0.08, 'highpass', 5000);
  }
}
