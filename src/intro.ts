// The bait-and-switch intro: a cozy "Voxel Train Yard" demo... until it isn't.
//   gate  -> sweet title card over a gently chugging train (click unlocks audio)
//   cozy  -> jaunty music, a cow on the line, a pedestrian waving
//   splat -> hit! blood across the screen, record scratch, slow motion
//   title -> smash cut to a blood-dripping MURDER TRAIN, heavy music, press any key
import type { TypeId } from './targets';

export type IntroPhase = 'gate' | 'cozy' | 'splat' | 'title' | 'done';

export interface IntroHost {
  train: { s: number; speed: number; throttle: number };
  synth: { unlock(): void; playMusic(m: 'off' | 'cozy' | 'metal'): void; scratch(): void; gore(b: string, big: number): void; whistle(): void; creature(k: string): void };
  shake: number;
  replayCooldown: number;
  time: number;
  spawnOnTrack(type: TypeId, ahead: number, lat: number, beh?: 'stand' | 'loiter'): number;
  start(gesture?: boolean): void;
  syncThrottle(): void;
}

const $ = (id: string) => document.getElementById(id)!;

class BloodFX {
  c = $('bloodfx') as HTMLCanvasElement;
  g = this.c.getContext('2d')!;
  drips: { x: number; y: number; w: number; len: number; max: number; v: number }[] = [];
  resize() { this.c.width = window.innerWidth; this.c.height = window.innerHeight; }
  splatter(seedCount = 9) {
    this.resize();
    const g = this.g, W = this.c.width, H = this.c.height;
    g.clearRect(0, 0, W, H);
    const reds = ['#8a0008', '#a8000c', '#c20012', '#6e0006'];
    for (let i = 0; i < seedCount; i++) {
      const cx = W * (0.15 + Math.random() * 0.7), cy = H * (0.1 + Math.random() * 0.65);
      const R = Math.min(W, H) * (0.05 + Math.random() * 0.13);
      g.fillStyle = reds[i % reds.length];
      g.beginPath();
      for (let a = 0; a <= Math.PI * 2 + 0.01; a += Math.PI / 14) {
        const rr = R * (0.75 + Math.random() * 0.45);
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        if (a === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath(); g.fill();
      // spray streaks + droplets
      for (let k = 0; k < 26; k++) {
        const a = Math.random() * Math.PI * 2, d = R * (1 + Math.random() * 2.2), s = R * (0.03 + Math.random() * 0.12);
        g.beginPath(); g.ellipse(cx + Math.cos(a) * d, cy + Math.sin(a) * d, s * 2.2, s, a, 0, Math.PI * 2); g.fill();
      }
      // drips start along the lower edge
      for (let k = 0; k < 4; k++) this.drips.push({ x: cx + (Math.random() - 0.5) * R * 1.4, y: cy + R * 0.5, w: 4 + Math.random() * 9, len: 0, max: H * (0.15 + Math.random() * 0.6), v: 40 + Math.random() * 140 });
      // glossy highlight
      g.fillStyle = 'rgba(255,120,120,0.18)';
      g.beginPath(); g.ellipse(cx - R * 0.3, cy - R * 0.35, R * 0.28, R * 0.12, -0.6, 0, Math.PI * 2); g.fill();
    }
    this.c.classList.add('on');
  }
  update(dt: number) {
    const g = this.g;
    for (const d of this.drips) {
      if (d.len >= d.max) continue;
      const nl = Math.min(d.max, d.len + d.v * dt);
      g.fillStyle = '#9a000a';
      g.fillRect(d.x - d.w / 2, d.y + d.len, d.w, nl - d.len);
      d.len = nl;
      g.beginPath(); g.arc(d.x, d.y + d.len, d.w * 0.62, 0, Math.PI * 2); g.fill();
      d.v *= 1 - dt * 0.4;
    }
  }
  fade() { this.c.classList.remove('on'); setTimeout(() => { this.drips = []; this.g.clearRect(0, 0, this.c.width, this.c.height); }, 1300); }
}

export class Intro {
  phase: IntroPhase = 'gate';
  t = 0;
  fx = new BloodFX();
  victim = -1;

  constructor(private h: IntroHost) {
    document.body.classList.add('intro', 'gate');
    $('hud-title').textContent = 'Voxel Train Yard';
    $('sub-pre').textContent = 'An HO-scale layout of rolling farmland, built from';
    $('sub-post').textContent = 'procedurally placed voxels. Zero assets.';
    $('hint-text').textContent = 'Sit back and enjoy the ride. Drag to orbit, scroll to zoom.';
    $('cozy-go').onclick = (e) => { e.stopPropagation(); this.begin(); };
    $('skipintro').onclick = (e) => { e.stopPropagation(); this.finish(); };
    h.replayCooldown = 1e9;
    h.train.throttle = 2.5; h.syncThrottle();
  }

  get active() { return this.phase !== 'done'; }
  /** slow motion during the splat beat */
  get timeScale() { return this.phase === 'splat' ? 0.28 : 1; }

  begin() {
    if (this.phase !== 'gate') return;
    this.h.synth.unlock();
    this.h.synth.playMusic('cozy');
    document.body.classList.remove('gate');
    this.phase = 'cozy'; this.t = 0;
    // a friendly passer-by and an unlucky cow standing on the line
    this.h.spawnOnTrack('person', 20, 4.2, 'stand');
    this.victim = this.h.spawnOnTrack('cow', Math.max(30, this.h.train.speed * 7), 0.2, 'stand');
    setTimeout(() => this.h.synth.whistle(), 900);
  }

  /** called by the game whenever something dies */
  onKill(id: number) {
    if (this.phase === 'cozy' || this.phase === 'gate') {
      if (id !== this.victim && this.phase !== 'cozy') return;
      this.phase = 'splat'; this.t = 0;
      document.body.classList.remove('gate');
      this.h.synth.unlock();
      this.h.synth.scratch();
      this.h.synth.gore('red', 2.2);
      this.h.shake = 1.4;
      this.fx.splatter(9);
      const f = $('flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
    }
  }

  update(dt: number, realDt: number) {
    if (this.phase === 'done') return;
    this.t += dt;
    this.fx.update(realDt);
    if (this.phase === 'gate' || this.phase === 'cozy') {
      this.h.train.speed = 7.5; // a gentle, constant demo pace
      if (this.phase === 'cozy' && this.t > 14 && this.victim >= 0) this.victim = this.h.spawnOnTrack('cow', 14, 0, 'stand'); // fallback
    } else if (this.phase === 'splat' && this.t > 0.45) {
      this.toTitle();
    }
  }

  toTitle() {
    this.phase = 'title'; this.t = 0;
    document.body.classList.add('titlecard');
    this.h.synth.playMusic('metal');
    const drips = $('drips');
    drips.innerHTML = '';
    for (let i = 0; i < 22; i++) {
      const d = document.createElement('div');
      d.className = 'drip';
      d.style.left = (Math.random() * 100).toFixed(1) + '%';
      d.style.width = (5 + Math.random() * 12).toFixed(0) + 'px';
      d.style.setProperty('--h', (20 + Math.random() * 150).toFixed(0) + 'px');
      d.style.setProperty('--d', (1.5 + Math.random() * 3).toFixed(2) + 's');
      d.style.setProperty('--delay', (0.3 + Math.random() * 1.5).toFixed(2) + 's');
      drips.appendChild(d);
    }
  }

  /** returns true if the intro consumed the input */
  key(code: string): boolean {
    if (this.phase === 'done') return false;
    if (code === 'Escape') { this.finish(); return true; }
    if (this.phase === 'gate' && (code === 'Enter' || code === 'Space')) { this.begin(); return true; }
    if (this.phase === 'title' && this.t > 0.6) { this.finish(); return true; }
    return true;
  }
  click() { if (this.phase === 'title' && this.t > 0.6) this.finish(); }

  finish() {
    if (this.phase === 'done') return;
    const skipped = this.phase !== 'title';
    this.phase = 'done';
    document.body.classList.remove('intro', 'gate', 'titlecard');
    $('hud-title').textContent = 'Murder Train';
    $('sub-pre').textContent = 'An endless voxel rail line through farms, towns, deserts and alien crash sites, built from';
    $('sub-post').textContent = 'procedurally placed voxels. Zero assets. Run everything over.';
    this.fx.fade();
    this.h.replayCooldown = this.h.time + 8;
    this.h.synth.unlock();
    this.h.synth.playMusic(skipped ? 'cozy' : 'metal');
    this.h.start(true);
  }
}
