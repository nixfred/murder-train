// Procedural soundtrack. Two moods, both synthesized live from oscillators and noise:
//  cozy  - a jaunty little train-set tune (C major, swung oom-pah bass, toy-piano melody)
//  metal - heavy, driving, menacing (E phrygian, distorted chugs, double kick, snare)
type Mode = 'off' | 'cozy' | 'metal';

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

// cozy: 8 bars, chord roots + melody (16th steps, -1 = rest, scale in midi)
const COZY_CHORDS = [[48, 52, 55], [53, 57, 60], [55, 59, 62], [48, 52, 55], [45, 48, 52], [53, 57, 60], [55, 59, 62], [48, 52, 55]];
const COZY_MEL = [
  [72, -1, 76, -1, 79, -1, 76, -1, 77, -1, 76, -1, 74, -1, 72, -1],
  [77, -1, 81, -1, 79, -1, 77, -1, 76, -1, 74, -1, 72, -1, -1, -1],
  [74, -1, 79, -1, 77, -1, 76, -1, 74, -1, 71, -1, 67, -1, -1, -1],
  [72, -1, 74, -1, 76, -1, 72, -1, 79, -1, -1, -1, 79, -1, -1, -1],
  [76, -1, 72, -1, 69, -1, 72, -1, 76, -1, 77, -1, 79, -1, 76, -1],
  [77, -1, 76, -1, 74, -1, 72, -1, 69, -1, 72, -1, 77, -1, -1, -1],
  [79, -1, 77, -1, 76, -1, 74, -1, 71, -1, 74, -1, 79, -1, 83, -1],
  [84, -1, -1, -1, 79, -1, 76, -1, 72, -1, -1, -1, -1, -1, -1, -1],
];
// metal: E phrygian riff roots per bar
const METAL_ROOTS = [40, 40, 41, 40, 40, 40, 43, 41];
const METAL_HITS = [0, 3, 6, 8, 10, 11, 14]; // accented chord hits; other 16ths = palm mute chugs

export class Music {
  out: GainNode;
  mode: Mode = 'off';
  private step = 0;
  private next = 0;
  private timer = 0;
  private dist: WaveShaperNode;
  private gtrBus: GainNode;
  volume = 0.55;
  private noise: AudioBuffer;

  constructor(private ctx: AudioContext, dest: AudioNode, noise: AudioBuffer) {
    this.noise = noise;
    this.out = ctx.createGain();
    this.out.gain.value = this.volume;
    this.out.connect(dest);
    // distortion chain for metal guitars
    this.dist = ctx.createWaveShaper();
    const curve = new Float32Array(2048);
    for (let i = 0; i < 2048; i++) { const x = (i / 1024) - 1; curve[i] = Math.tanh(x * 9) * 0.9; }
    this.dist.curve = curve;
    this.dist.oversample = '2x';
    const pre = ctx.createGain(); pre.gain.value = 1.4;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
    const cab = ctx.createBiquadFilter(); cab.type = 'peaking'; cab.frequency.value = 900; cab.gain.value = -5;
    this.gtrBus = pre;
    pre.connect(this.dist).connect(lp).connect(cab);
    const g = ctx.createGain(); g.gain.value = 0.32; cab.connect(g).connect(this.out);
  }

  setVolume(v: number) { this.volume = v; this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }

  play(mode: Mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === 'off') { clearInterval(this.timer); this.timer = 0; return; }
    this.step = 0;
    this.next = this.ctx.currentTime + 0.06;
    this.out.gain.cancelScheduledValues(this.ctx.currentTime);
    this.out.gain.setValueAtTime(this.volume, this.ctx.currentTime);
    if (!this.timer) this.timer = window.setInterval(() => this.pump(), 25);
  }

  /** abrupt stop (for the record scratch) */
  cut() {
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(0, t + 0.04);
    this.play('off');
  }

  private get spb() { return this.mode === 'metal' ? 60 / 152 / 4 : 60 / 112 / 4; }

  private pump() {
    if (this.mode === 'off' || this.ctx.state !== 'running') return;
    if (this.next < this.ctx.currentTime - 0.3) this.next = this.ctx.currentTime + 0.05;
    while (this.next < this.ctx.currentTime + 0.15) {
      let t = this.next;
      if (this.mode === 'cozy' && this.step % 2 === 1) t += this.spb * 0.28; // swing
      if (this.mode === 'cozy') this.cozyStep(this.step, t); else this.metalStep(this.step, t);
      this.next += this.spb;
      this.step++;
    }
  }

  // ------------------------------------------------------------ voices
  private tone(type: OscillatorType, f: number, t: number, dur: number, vol: number, dest: AudioNode = this.out, attack = 0.005) {
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.02);
    return o;
  }
  private hit(t: number, dur: number, vol: number, type: BiquadFilterType, f: number, q = 1) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const fl = this.ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl).connect(g).connect(this.out); s.start(t, Math.random()); s.stop(t + dur + 0.02);
  }
  private kick(t: number, vol = 0.9) {
    const o = this.ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(this.out); o.start(t); o.stop(t + 0.32);
    this.hit(t, 0.02, vol * 0.4, 'highpass', 2500);
  }

  private cozyStep(i: number, t: number) {
    const bar = Math.floor(i / 16) % 8, s = i % 16;
    const ch = COZY_CHORDS[bar];
    // oom-pah bass
    if (s === 0 || s === 8) this.tone('triangle', midi(ch[0] - 12 + (s === 8 ? 7 : 0)), t, 0.32, 0.32);
    if (s === 4 || s === 12) for (const n of ch) this.tone('square', midi(n), t, 0.09, 0.025);
    // melody: toy piano (triangle + sine bell an octave up)
    const m = COZY_MEL[bar][s];
    if (m > 0) {
      this.tone('triangle', midi(m), t, 0.35, 0.12);
      this.tone('sine', midi(m + 12), t, 0.25, 0.04);
    }
    // countermelody glock on even bars
    if (bar % 2 === 1 && s % 4 === 2) this.tone('sine', midi(ch[(s / 2) % 3] + 24), t, 0.4, 0.035);
    // soft shaker + choo-choo brush
    if (s % 2 === 0) this.hit(t, 0.04, s % 4 === 2 ? 0.05 : 0.025, 'highpass', 6000);
    if (s === 6 || s === 14) this.hit(t, 0.12, 0.05, 'bandpass', 1800, 0.8);
    if (s === 0) this.tone('sine', midi(ch[0] - 24), t, 0.25, 0.25); // soft kick-ish thump
  }

  private power(root: number, t: number, dur: number, vol: number) {
    for (const [iv, det] of [[0, -6], [0, 6], [7, -4], [12, 3]]) {
      const o = this.tone('sawtooth', midi(root + iv), t, dur, vol, this.gtrBus, 0.003);
      o.detune.value = det;
    }
  }

  private metalStep(i: number, t: number) {
    const bar = Math.floor(i / 16) % 8, s = i % 16;
    const root = METAL_ROOTS[bar];
    const accent = METAL_HITS.includes(s);
    // guitars: palm-muted chugs + accented power chords
    if (accent) this.power(root + (bar === 7 && s >= 8 ? -1 : 0), t, this.spb * 1.8, 0.16);
    else this.power(root, t, this.spb * 0.45, 0.09);
    // bass
    this.tone('sawtooth', midi(root - 12), t, this.spb * 0.9, 0.12);
    // drums
    const dbl = bar % 4 === 3;
    if (s === 0 || s === 3 || s === 6 || s === 10 || (dbl && s % 2 === 0)) this.kick(t);
    if (s === 4 || s === 12) { this.hit(t, 0.18, 0.5, 'bandpass', 1800, 0.6); this.tone('triangle', 190, t, 0.08, 0.25); }
    if (s % 2 === 0) this.hit(t, 0.05, s % 4 === 0 ? 0.12 : 0.07, 'highpass', 7000);
    if (s === 0 && bar % 4 === 0) this.hit(t, 1.2, 0.18, 'highpass', 4000); // crash
    // menacing lead: tritone bell every 2 bars
    if (bar % 2 === 1 && s === 0) { this.tone('square', midi(root + 24 + 6), t, 0.8, 0.035); this.tone('sine', midi(root + 36), t, 0.9, 0.05); }
    if (bar === 7 && (s === 8 || s === 10 || s === 12 || s === 14)) this.tone('sawtooth', midi(root + 24 - s / 2 + 4), t, 0.12, 0.04, this.gtrBus);
  }
}
