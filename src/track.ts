// Endless procedural rail line. Heading wanders but always stays within
// +-66 degrees of -Z, so z is strictly decreasing along the track. That makes
// nearest-point queries a binary search instead of a scan.
import { mulberry32, RNG } from './rng';

export interface Crossing { s: number; x: number; z: number; dx: number; dz: number; half: number; }
export interface TrackPoint { x: number; z: number; h: number; dx: number; dz: number; }

export class Track {
  readonly spacing = 0.5;
  xs: number[] = [];
  zs: number[] = [];
  hs: number[] = [];
  base = 0; // global index of xs[0]
  crossings: Crossing[] = [];
  private ph: number[];
  private rng: RNG;
  private nextCrossing = 120;

  constructor(seed: number) {
    this.rng = mulberry32(seed * 7 + 3);
    this.ph = [0, 1, 2, 3].map(() => this.rng() * Math.PI * 2);
    this.xs.push(0); this.zs.push(0); this.hs.push(this.headingAt(0));
  }

  headingAt(s: number): number {
    const p = this.ph;
    // gentle straight-ish start, then wander
    const ramp = Math.min(1, s / 220);
    const raw = 0.95 * Math.sin(s / 140 + p[0]) + 0.55 * Math.sin(s / 61 + p[1]) + 0.3 * Math.sin(s / 29 + p[2]);
    return 1.15 * Math.tanh((raw * ramp) / 1.15);
  }

  get endS() { return (this.base + this.xs.length - 1) * this.spacing; }
  get startS() { return this.base * this.spacing; }

  extendTo(s: number) {
    while (this.endS < s) {
      const i = this.xs.length - 1;
      const sNow = (this.base + i) * this.spacing;
      const h = this.headingAt(sNow + this.spacing * 0.5);
      const x = this.xs[i] + Math.sin(h) * this.spacing;
      const z = this.zs[i] - Math.cos(h) * this.spacing;
      this.xs.push(x); this.zs.push(z); this.hs.push(h);
      const sN = sNow + this.spacing;
      if (sN >= this.nextCrossing) {
        const ang = h + Math.PI / 2 + (this.rng() - 0.5) * 0.7;
        this.crossings.push({ s: sN, x, z, dx: Math.sin(ang), dz: -Math.cos(ang), half: 70 });
        this.nextCrossing = sN + 150 + this.rng() * 170;
      }
    }
  }

  trim(sMin: number) {
    const k = Math.floor(sMin / this.spacing) - this.base;
    if (k > 2000) {
      this.xs.splice(0, k); this.zs.splice(0, k); this.hs.splice(0, k);
      this.base += k;
      this.crossings = this.crossings.filter((c) => c.s > sMin - 400);
    }
  }

  at(s: number, out: TrackPoint = { x: 0, z: 0, h: 0, dx: 0, dz: -1 }): TrackPoint {
    let f = s / this.spacing - this.base;
    if (f < 0) f = 0;
    const n = this.xs.length - 1;
    if (f > n - 1) f = n - 1;
    const i = Math.floor(f), t = f - i;
    out.x = this.xs[i] + (this.xs[i + 1] - this.xs[i]) * t;
    out.z = this.zs[i] + (this.zs[i + 1] - this.zs[i]) * t;
    out.h = this.hs[i] + (this.hs[i + 1] - this.hs[i]) * t;
    out.dx = Math.sin(out.h); out.dz = -Math.cos(out.h);
    return out;
  }

  /** index of first sample with z <= zq (zs decreasing) */
  private idxForZ(zq: number): number {
    let lo = 0, hi = this.zs.length - 1;
    if (this.zs[0] <= zq) return 0;
    if (this.zs[hi] > zq) return hi;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (this.zs[m] > zq) lo = m; else hi = m;
    }
    return hi;
  }

  /** nearest track point within radius R (returns dist=R+1 if none) */
  nearest(x: number, z: number, R = 30): { s: number; dist: number; side: number } {
    const i0 = this.idxForZ(z + R), i1 = this.idxForZ(z - R);
    let best = 1e9, bi = -1;
    for (let i = i0; i <= i1; i++) {
      const dx = this.xs[i] - x, dz = this.zs[i] - z;
      const d = dx * dx + dz * dz;
      if (d < best) { best = d; bi = i; }
    }
    if (bi < 0) return { s: 0, dist: R + 1, side: 1 };
    const h = this.hs[bi];
    const side = Math.sign((x - this.xs[bi]) * -Math.cos(h) - (z - this.zs[bi]) * Math.sin(h)) || 1;
    return { s: (this.base + bi) * this.spacing, dist: Math.sqrt(best), side };
  }

  /** fill dist grid (size n*n, origin x0,z0, unit cells) with distance to track, capped at R */
  distGrid(x0: number, z0: number, n: number, R: number, out: Float32Array) {
    out.fill(R);
    const i0 = this.idxForZ(z0 + n + R), i1 = this.idxForZ(z0 - R);
    const R2 = R * R;
    for (let i = i0; i <= i1; i += 1) {
      const px = this.xs[i] - x0, pz = this.zs[i] - z0;
      const ax = Math.max(0, Math.floor(px - R)), bx = Math.min(n - 1, Math.ceil(px + R));
      const az = Math.max(0, Math.floor(pz - R)), bz = Math.min(n - 1, Math.ceil(pz + R));
      for (let gz = az; gz <= bz; gz++) {
        const dz = gz + 0.5 - pz, dz2 = dz * dz;
        if (dz2 > R2) continue;
        const row = gz * n;
        for (let gx = ax; gx <= bx; gx++) {
          const dx = gx + 0.5 - px;
          const d2 = dx * dx + dz2;
          if (d2 < R2) { const d = Math.sqrt(d2); if (d < out[row + gx]) out[row + gx] = d; }
        }
      }
    }
  }
}
