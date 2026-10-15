// Every sound is synthesized live with WebAudio. No samples.
import { Music } from './music';
export class Synth {
  ctx: AudioContext | null = null;
  master!: GainNode;
  noise!: AudioBuffer;
  muted = false;
  rate = 1; // < 1 in slow-mo replays
  private whistleUntil = 0;
  music: Music | null = null;
  musicVolume = 0.7;
  musicMuted = false;
  pendingMusic: 'off' | 'cozy' | 'metal' = 'off';

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.55;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 6;
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.music = new Music(this.ctx, this.master, this.noise);
      this.music.setVolume(this.musicMuted ? 0 : this.musicVolume);
      this.music.play(this.pendingMusic);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  playMusic(mode: 'off' | 'cozy' | 'metal') {
    this.pendingMusic = mode;
    this.music?.play(mode);
  }
  setMusicVolume(v: number) { this.musicVolume = v; this.music?.setVolume(this.musicMuted ? 0 : v); }
  setMusicMuted(m: boolean) { this.musicMuted = m; this.music?.setVolume(m ? 0 : this.musicVolume); }

  /** vinyl record scratch + music cut */
  scratch() {
    this.pendingMusic = 'off';
    if (!this.ctx) return;
    this.music?.cut();
    if (!this.ok) return;
    const t = this.now, c = this.ctx;
    for (const [t0, f0, f1, d] of [[0, 700, 3200, 0.12], [0.12, 3000, 500, 0.16], [0.3, 900, 2600, 0.1]] as const) {
      const n = this.noiseSrc(t + t0, d);
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 5;
      f.frequency.setValueAtTime(f0, t + t0); f.frequency.exponentialRampToValueAtTime(f1, t + t0 + d);
      const g = c.createGain(); this.env(g, t + t0, 0.01, 0.7, d);
      n.connect(f).connect(g).connect(this.master);
    }
    const o = this.osc('sawtooth', 520, t, 0.45); o.frequency.exponentialRampToValueAtTime(45, t + 0.45);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500;
    const og = c.createGain(); this.env(og, t, 0.005, 0.25, 0.42);
    o.connect(lp).connect(og).connect(this.master);
  }

  /** wet, layered impact: squish + bone crunch + gush + drips. big = 0.5..2 */
  gore(bleed: string, big = 1) {
    if (!this.ok) return;
    const t = this.now, c = this.ctx!, r = this.rate;
    const B = Math.min(2.2, big);
    const wet = bleed === 'red' || bleed === 'green';
    // slap: the body hits the cowcatcher
    { const n = this.noiseSrc(t, 0.08); const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2200 * r;
      const g = c.createGain(); this.env(g, t, 0.002, 0.7 * B, 0.07 / r); n.connect(f).connect(g).connect(this.master); }
    this.thudAt(t, 0.8 * B, 95 * r);
    if (wet || bleed === 'snow') {
      // squish: resonant noise with a wobbling formant
      const n = this.noiseSrc(t, 0.45 / r);
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 6;
      const base = (bleed === 'green' ? 900 : 420) * r;
      f.frequency.setValueAtTime(base * 2.5, t);
      for (let k = 1; k <= 6; k++) f.frequency.linearRampToValueAtTime(base * (0.6 + Math.random() * 1.8), t + (k * 0.06) / r);
      const g = c.createGain(); this.env(g, t + 0.01, 0.01, (bleed === 'snow' ? 0.25 : 0.65) * B, 0.4 / r);
      n.connect(f).connect(g).connect(this.master);
    }
    // crunch: bones / metal / wood snapping
    if (bleed !== 'confetti') {
      const nCr = Math.floor((6 + Math.random() * 6) * B);
      for (let k = 0; k < nCr; k++) {
        const tk = t + (Math.random() * 0.18) / r;
        const n = this.noiseSrc(tk, 0.03);
        const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = (bleed === 'oil' ? 3500 : 1800 + Math.random() * 2000) * r;
        const g = c.createGain(); this.env(g, tk, 0.001, (0.25 + Math.random() * 0.35) * B, (0.012 + Math.random() * 0.02) / r);
        n.connect(f).connect(g).connect(this.master);
      }
    }
    if (wet) {
      // gush: gurgling low noise with an LFO
      const dur = (0.5 + 0.5 * B) / r;
      const n = this.noiseSrc(t + 0.05, dur);
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(900 * r, t); f.frequency.exponentialRampToValueAtTime(220 * r, t + dur);
      const am = c.createGain(); am.gain.value = 0.5;
      const lfo = this.osc('sine', (9 + Math.random() * 6) * r, t, dur); const lg = c.createGain(); lg.gain.value = 0.5; lfo.connect(lg).connect(am.gain);
      const g = c.createGain(); this.env(g, t + 0.05, 0.03, 0.55 * B, dur);
      n.connect(f).connect(am).connect(g).connect(this.master);
      // drips
      for (let k = 0; k < 3 + B * 3; k++) {
        const tk = t + (0.35 + Math.random() * 1.1) / r;
        const o = this.osc('sine', (900 + Math.random() * 700) * r, tk, 0.08); o.frequency.exponentialRampToValueAtTime(260 * r, tk + 0.06);
        const og = c.createGain(); this.env(og, tk, 0.002, 0.08, 0.07); o.connect(og).connect(this.master);
      }
    }
    if (bleed === 'oil') this.metal();
    if (bleed === 'confetti') { // party pop
      const n = this.noiseSrc(t, 0.1); const g = c.createGain(); this.env(g, t, 0.001, 0.6, 0.09); n.connect(g).connect(this.master);
      const o = this.osc('square', 520 * r, t + 0.05, 0.4); o.frequency.linearRampToValueAtTime(380 * r, t + 0.45);
      const og = c.createGain(); this.env(og, t + 0.05, 0.02, 0.07, 0.38); o.connect(og).connect(this.master);
    }
  }

  private thudAt(t: number, v: number, f: number) {
    const o = this.osc('sine', f, t, 0.4); o.frequency.exponentialRampToValueAtTime(30, t + 0.35);
    const g = this.ctx!.createGain(); this.env(g, t, 0.003, v, 0.38); o.connect(g).connect(this.master);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.05);
  }

  private get ok() { return !!this.ctx && this.ctx.state === 'running' && !this.muted; }
  private get now() { return this.ctx!.currentTime; }

  private env(g: GainNode, t: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private noiseSrc(t: number, dur: number) {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.05);
    return s;
  }

  private osc(type: OscillatorType, f: number, t: number, dur: number) {
    const o = this.ctx!.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  chuff(intensity: number) {
    if (!this.ok) return;
    const t = this.now, c = this.ctx!;
    const dur = 0.16 + 0.12 * (1 - intensity);
    const n = this.noiseSrc(t, dur);
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(900 + intensity * 500, t); f.frequency.exponentialRampToValueAtTime(260, t + dur); f.Q.value = 0.9;
    const g = c.createGain(); this.env(g, t, 0.01, 0.12 + intensity * 0.18, dur);
    n.connect(f).connect(g).connect(this.master);
    const o = this.osc('sine', 70, t, 0.12); const og = c.createGain(); this.env(og, t, 0.005, 0.12 * intensity, 0.1);
    o.connect(og).connect(this.master);
  }

  whistle() {
    if (!this.ok) return;
    const t = this.now, c = this.ctx!;
    if (t < this.whistleUntil - 0.3) return;
    const dur = 1.3;
    this.whistleUntil = t + dur;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.08);
    g.gain.setValueAtTime(0.16, t + dur - 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    for (const f of [392, 494, 587, 740]) {
      const o = this.osc('triangle', f * 0.97, t, dur);
      o.frequency.linearRampToValueAtTime(f, t + 0.12);
      const lfo = this.osc('sine', 5.5, t, dur); const lg = c.createGain(); lg.gain.value = 3; lfo.connect(lg).connect(o.frequency);
      o.connect(g);
    }
    const n = this.noiseSrc(t, dur); const bf = c.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = 2400; bf.Q.value = 3;
    const ng = c.createGain(); ng.gain.value = 0.25; n.connect(bf).connect(ng).connect(g);
    g.connect(this.master);
  }

  splat(big = 1) {
    if (!this.ok) return;
    const t = this.now, c = this.ctx!, r = this.rate;
    const n = this.noiseSrc(t, 0.5 / r);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(3000 * r, t); f.frequency.exponentialRampToValueAtTime(180 * r, t + 0.4 / r);
    const g = c.createGain(); this.env(g, t, 0.004, 0.55 * big, 0.45 / r);
    n.connect(f).connect(g).connect(this.master);
    const o = this.osc('sine', 120 * r, t, 0.35 / r); o.frequency.exponentialRampToValueAtTime(38 * r, t + 0.3 / r);
    const og = c.createGain(); this.env(og, t, 0.004, 0.6 * big, 0.3 / r);
    o.connect(og).connect(this.master);
    // wet squelch
    const s = this.osc('sawtooth', 300 * r, t + 0.03, 0.15 / r); s.frequency.exponentialRampToValueAtTime(60 * r, t + 0.15 / r);
    const sf = c.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 900 * r;
    const sg = c.createGain(); this.env(sg, t + 0.03, 0.005, 0.15, 0.14 / r);
    s.connect(sf).connect(sg).connect(this.master);
  }

  private voice(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, formant: number, vib = 0, vibF = 6, delay = 0) {
    const r = this.rate, c = this.ctx!, t = this.now + delay;
    dur /= r;
    const o = this.osc(type, f0 * r, t, dur); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1 * r), t + dur);
    if (vib) { const l = this.osc('sine', vibF, t, dur); const lg = c.createGain(); lg.gain.value = vib * r; l.connect(lg).connect(o.frequency); }
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = formant * r; f.Q.value = 2;
    const f2 = c.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = formant * 2.5 * r;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.04); g.gain.setValueAtTime(vol, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g); o.connect(f2).connect(g); g.connect(this.master);
  }

  creature(kind: string) {
    if (!this.ok) return;
    const j = 0.9 + Math.random() * 0.25;
    switch (kind) {
      case 'moo': this.voice('sawtooth', 140 * j, 95 * j, 0.9, 0.35, 600, 4, 5); break;
      case 'scream': this.voice('sawtooth', 700 * j, 420 * j, 0.7, 0.28, 1400, 40, 9); this.voice('square', 1050 * j, 600, 0.6, 0.06, 2500, 30, 11); break;
      case 'alien': for (let i = 0; i < 3; i++) this.voice('sine', 1800 * j, 600 * j, 0.18, 0.25, 1500, 300, 30, i * 0.12); break;
      case 'crash': this.metal(); break;
      case 'squeak': this.voice('sine', 900, 2400, 0.25, 0.35, 1600, 50, 20); this.voice('sine', 2400, 700, 0.4, 0.25, 1600, 0, 1, 0.25); break;
      case 'honk': this.voice('square', 330, 320, 0.25, 0.3, 900); this.voice('square', 330, 320, 0.25, 0.3, 900, 0, 1, 0.3); break;
      case 'roar': this.voice('sawtooth', 90 * j, 55, 1.4, 0.5, 300, 12, 13); this.voice('sawtooth', 180, 90, 1.2, 0.2, 700, 30, 17); this.thud(0.8); break;
      case 'ufo': this.voice('sine', 300, 2400, 0.6, 0.25, 1200, 120, 14); this.metal(); break;
      case 'piano': for (const [i, f] of [262, 330, 392, 466, 523, 311].entries()) this.voice('triangle', f * (Math.random() < 0.5 ? 1 : 1.06), f, 1.6, 0.18, f * 2, 0, 1, i * 0.015); this.metal(); break;
      case 'baa': this.voice('sawtooth', 380 * j, 330 * j, 0.6, 0.22, 900, 25, 18); break;
      case 'snow': this.thud(0.5); break;
      case 'robot': for (let i = 0; i < 4; i++) this.voice('square', 880 - i * 160, 440 - i * 80, 0.1, 0.12, 1200, 0, 1, i * 0.08); this.metal(); break;
      case 'cluck': for (let i = 0; i < 3; i++) this.voice('square', 700, 900, 0.07, 0.12, 1100, 0, 1, i * 0.1); break;
    }
  }

  metal() {
    if (!this.ok) return;
    const t = this.now, c = this.ctx!, r = this.rate;
    const n = this.noiseSrc(t, 0.8 / r);
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1200 * r;
    const g = c.createGain(); this.env(g, t, 0.003, 0.35, 0.6 / r);
    n.connect(f).connect(g).connect(this.master);
    for (const fr of [523, 1187, 1873, 2711]) {
      const o = this.osc('square', fr * r, t, 0.7 / r); const og = c.createGain(); this.env(og, t, 0.002, 0.03, 0.6 / r); o.connect(og).connect(this.master);
    }
  }

  thud(v = 1) {
    if (!this.ok) return;
    const t = this.now, c = this.ctx!;
    const o = this.osc('sine', 90, t, 0.5); o.frequency.exponentialRampToValueAtTime(30, t + 0.4);
    const g = c.createGain(); this.env(g, t, 0.005, 0.6 * v, 0.45); o.connect(g).connect(this.master);
  }

  combo(level: number) {
    if (!this.ok) return;
    const base = 440 * Math.pow(2, Math.min(level, 10) / 12);
    [0, 4, 7, 12].forEach((s, i) => this.voice('square', base * Math.pow(2, s / 12), base * Math.pow(2, s / 12), 0.12, 0.08, 2000, 0, 1, i * 0.06));
  }

  whoosh() {
    if (!this.ok) return;
    const t = this.now, c = this.ctx!;
    const n = this.noiseSrc(t, 0.8);
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2; f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(3000, t + 0.6);
    const g = c.createGain(); this.env(g, t, 0.2, 0.25, 0.5);
    n.connect(f).connect(g).connect(this.master);
  }

  bell() {
    if (!this.ok) return;
    const t = this.now, c = this.ctx!;
    for (const f of [1320, 1980]) { const o = this.osc('sine', f, t, 0.4); const g = c.createGain(); this.env(g, t, 0.002, 0.05, 0.35); o.connect(g).connect(this.master); }
  }
}
