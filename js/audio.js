// Procedural audio engine (Web Audio API). Every sound in the game is
// synthesised at runtime — no external sound files to break or download.
import { store } from './storage.js';

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxBus = null;
    this.musicBus = null;
    this.crowdGain = null;
    this.noiseBuf = null;
    this.musicTimer = null;
    this.musicStep = 0;
    this.musicMode = null;
    this.crowdLevel = 0.25;
  }

  /** Must be called from a user gesture (iOS requirement). */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain();
    this.master.connect(c.destination);
    this.sfxBus = c.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus = c.createGain();
    this.musicBus.connect(this.master);
    // white noise buffer reused by many effects
    const len = c.sampleRate * 2;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    // unlock trick for iOS: play an empty buffer
    const s = c.createBufferSource();
    s.buffer = c.createBuffer(1, 1, 22050);
    s.connect(c.destination);
    s.start(0);
    this._startCrowd();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const st = store.settings;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(st.muted ? 0 : 1, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(st.sfx, t, 0.05);
    this.musicBus.gain.setTargetAtTime(st.music * 0.55, t, 0.05);
  }

  // ── helpers ────────────────────────────────────────────
  _noise(dur, { type = 'bandpass', freq = 1000, q = 1, gain = 0.5, attack = 0.005, freqEnd, bus } = {}) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(bus || this.sfxBus);
    src.start(t, Math.random() * 1.5, dur + 0.05);
  }

  _tone(freq, dur, { type = 'sine', gain = 0.4, freqEnd, attack = 0.005, delay = 0, bus } = {}) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus || this.sfxBus);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // ── game sounds ────────────────────────────────────────
  kick(power = 0.5) {
    this._tone(140 + power * 40, 0.16, { freqEnd: 45, gain: 0.5 + power * 0.4 });
    this._noise(0.07, { freq: 2200, q: 0.8, gain: 0.25 + power * 0.3 });
    if (power > 0.75) this._noise(0.45, { type: 'bandpass', freq: 600, freqEnd: 3500, q: 1.5, gain: 0.25 });
  }
  touch() { this._tone(220, 0.06, { freqEnd: 90, gain: 0.18 }); }
  pass() { this._tone(180, 0.1, { freqEnd: 70, gain: 0.35 }); this._noise(0.05, { freq: 1800, gain: 0.12 }); }
  post() {
    [520, 1310, 2210].forEach((f, i) => this._tone(f, 0.9 - i * 0.2, { type: 'triangle', gain: 0.18 / (i + 1) }));
  }
  tackle() {
    this._noise(0.25, { type: 'lowpass', freq: 900, freqEnd: 200, gain: 0.45 });
    this._tone(90, 0.15, { freqEnd: 50, gain: 0.35 });
  }
  steal() { this._tone(660, 0.08, { type: 'square', gain: 0.08 }); this._tone(990, 0.12, { type: 'square', gain: 0.08, delay: 0.06 }); }
  whoosh() { this._noise(0.3, { type: 'bandpass', freq: 400, freqEnd: 2400, q: 2, gain: 0.3 }); }
  jump() { this._tone(260, 0.12, { freqEnd: 520, type: 'triangle', gain: 0.1 }); }
  bounce(v = 0.3) { this._tone(110, 0.08, { freqEnd: 60, gain: Math.min(0.3, v) }); }
  net() { this._noise(0.5, { type: 'highpass', freq: 1200, gain: 0.2, attack: 0.02 }); }
  click() { this._tone(880, 0.05, { type: 'triangle', gain: 0.12 }); }
  select() { this._tone(660, 0.07, { type: 'square', gain: 0.07 }); this._tone(1320, 0.1, { type: 'square', gain: 0.06, delay: 0.05 }); }
  deny() { this._tone(180, 0.15, { type: 'square', gain: 0.08 }); }
  tick() { this._tone(1200, 0.04, { type: 'square', gain: 0.05 }); }
  save() { this._tone(300, 0.12, { freqEnd: 150, gain: 0.3 }); this._noise(0.12, { type: 'lowpass', freq: 800, gain: 0.3 }); }

  whistle(long = false) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const make = (start, dur) => {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = 2900;
      const lfo = c.createOscillator(); lfo.frequency.value = 28;
      const lg = c.createGain(); lg.gain.value = 140;
      lfo.connect(lg); lg.connect(o.frequency);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t + start);
      g.gain.exponentialRampToValueAtTime(0.22, t + start + 0.02);
      g.gain.setValueAtTime(0.22, t + start + dur - 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + start + dur);
      o.connect(g); g.connect(this.sfxBus);
      o.start(t + start); lfo.start(t + start); o.stop(t + start + dur + 0.05); lfo.stop(t + start + dur + 0.05);
    };
    if (long) { make(0, 0.35); make(0.45, 0.35); make(0.9, 0.9); } else make(0, 0.45);
  }

  special() {
    this._tone(110, 0.9, { type: 'sawtooth', freqEnd: 880, gain: 0.12, attack: 0.05 });
    this._tone(220, 0.9, { type: 'square', freqEnd: 1760, gain: 0.05, attack: 0.05 });
    this._noise(1.0, { type: 'bandpass', freq: 200, freqEnd: 5000, q: 1.2, gain: 0.3, attack: 0.2 });
  }
  boom() {
    this._tone(80, 0.6, { freqEnd: 30, gain: 0.7 });
    this._noise(0.7, { type: 'lowpass', freq: 2000, freqEnd: 100, gain: 0.5 });
  }
  countdown(final = false) { this._tone(final ? 1046 : 523, final ? 0.4 : 0.15, { type: 'square', gain: 0.1 }); }

  // ── crowd ambience ─────────────────────────────────────
  _startCrowd() {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 0.6;
    const f2 = c.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = 2200;
    this.crowdGain = c.createGain(); this.crowdGain.gain.value = 0;
    src.connect(f); f.connect(f2); f2.connect(this.crowdGain); this.crowdGain.connect(this.sfxBus);
    src.start();
  }
  setCrowd(level) {
    this.crowdLevel = level;
    if (this.crowdGain) this.crowdGain.gain.setTargetAtTime(level * 0.35, this.ctx.currentTime, 0.4);
  }
  cheer(intensity = 1) {
    if (!this.ctx) return;
    this._noise(2.8 * intensity, { type: 'bandpass', freq: 900, q: 0.5, gain: 0.55 * intensity, attack: 0.25 });
    this._noise(2.2 * intensity, { type: 'bandpass', freq: 2200, q: 0.8, gain: 0.25 * intensity, attack: 0.3 });
  }
  groan() { this._noise(1.2, { type: 'bandpass', freq: 600, freqEnd: 300, q: 0.7, gain: 0.35, attack: 0.15 }); }

  // ── music: simple synthwave sequencer ─────────────────
  playMusic(mode = 'menu') {
    if (!this.ctx || this.musicMode === mode) return;
    this.stopMusic();
    this.musicMode = mode;
    const bpm = mode === 'menu' ? 104 : 124;
    const stepDur = 60 / bpm / 4;
    const prog = mode === 'menu' ? [45, 41, 48, 43] : [40, 43, 38, 45]; // midi roots
    let next = this.ctx.currentTime + 0.1;
    const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
    const schedule = () => {
      const c = this.ctx;
      while (next < c.currentTime + 0.25) {
        const s = this.musicStep;
        const bar = Math.floor(s / 16) % 4;
        const root = prog[bar];
        const st = s % 16;
        // bass: driving eighths
        if (st % 2 === 0) this._mTone(midi(root - 12 + (st % 8 === 6 ? 12 : 0)), stepDur * 1.6, next, 'sawtooth', 0.09, 600);
        // arp
        const arp = [0, 7, 12, 15, 12, 7, 3, 7];
        if (mode === 'menu' || st % 2 === 1) this._mTone(midi(root + 12 + arp[st % 8]), stepDur * 0.9, next, 'square', 0.025, 2400);
        // pad on bar start
        if (st === 0) [0, 3, 7, 10].forEach((iv) => this._mTone(midi(root + iv), stepDur * 16, next, 'triangle', 0.03, 1200, 0.4));
        // drums
        if (st % 4 === 0) this._mKick(next);
        if (st % 8 === 4) this._mSnare(next);
        if (st % 2 === 1) this._mHat(next);
        this.musicStep++;
        next += stepDur;
      }
    };
    this.musicTimer = setInterval(schedule, 60);
    schedule();
  }
  stopMusic() {
    clearInterval(this.musicTimer); this.musicTimer = null; this.musicMode = null;
  }
  _mTone(freq, dur, t, type, gain, cutoff, attack = 0.01) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = type; o.frequency.value = freq;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(g); g.connect(this.musicBus);
    o.start(t); o.stop(t + dur + 0.05);
  }
  _mKick(t) {
    const c = this.ctx;
    const o = c.createOscillator(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    const g = c.createGain(); g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g); g.connect(this.musicBus); o.start(t); o.stop(t + 0.25);
  }
  _mSnare(t) {
    const c = this.ctx;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1500;
    const g = c.createGain(); g.gain.setValueAtTime(0.15, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    s.connect(f); f.connect(g); g.connect(this.musicBus); s.start(t, Math.random(), 0.2);
  }
  _mHat(t) {
    const c = this.ctx;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
    const g = c.createGain(); g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    s.connect(f); f.connect(g); g.connect(this.musicBus); s.start(t, Math.random(), 0.05);
  }
}

export const audio = new AudioEngine();
