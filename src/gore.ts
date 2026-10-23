// Physics-driven voxel gore. Fixed-size InstancedMesh pools for body chunks,
// blood droplets, sparks/confetti and ground splatter decals.
import * as THREE from 'three';
import { BOX, MAT, GLOW_MAT, lin, writeMatrix, Vox } from './voxels';
import { mulberry32, RNG } from './rng';
import { PERF } from './device';

export type Bleed = 'red' | 'green' | 'oil' | 'confetti' | 'snow' | 'splinter';

const CONFETTI = [0xff3b6b, 0xffe14a, 0x4ad2ff, 0x6bff6b, 0xb06bff, 0xff9a1a, 0xffffff];
const BLOOD = [0xb3000c, 0x8f0008, 0xd4101c, 0x6e0006];
const GREEN = [0x5aff2a, 0x2ed40e, 0x9bff4a, 0x3ab81a];
const OIL = [0x14110f, 0x221c18, 0x0c0a09];

export interface HeightFn { (x: number, z: number): number; }

class Pool {
  mesh: THREE.InstancedMesh;
  n: number;
  next = 0;
  alive = 0;
  pos: Float32Array; vel: Float32Array; rot: Float32Array; av: Float32Array;
  size: Float32Array; life: Float32Array; max: Float32Array; flag: Uint8Array; drag: Float32Array;
  col: Float32Array;
  gh: Float32Array; gx: Float32Array; gz: Float32Array; // cached ground height + where it was sampled
  dirty = true; // force full matrix rebuild (after restore)
  constructor(n: number, mat: THREE.Material, shadows: boolean) {
    this.n = n;
    this.mesh = new THREE.InstancedMesh(BOX, mat, n);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.col = this.mesh.instanceColor.array as Float32Array;
    (this.mesh.instanceMatrix.array as Float32Array).fill(0);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = shadows;
    this.mesh.receiveShadow = true;
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3);
    this.rot = new Float32Array(n * 3); this.av = new Float32Array(n * 3);
    this.size = new Float32Array(n); this.life = new Float32Array(n); this.max = new Float32Array(n);
    this.flag = new Uint8Array(n); this.drag = new Float32Array(n);
    this.gh = new Float32Array(n); this.gx = new Float32Array(n).fill(1e9); this.gz = new Float32Array(n);
  }
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, hex: number, life: number, r: RNG, flag = 0, drag = 0.2, jit = 0.15) {
    const i = this.next; this.next = (this.next + 1) % this.n;
    const o = i * 3;
    this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = z;
    this.vel[o] = vx; this.vel[o + 1] = vy; this.vel[o + 2] = vz;
    this.rot[o] = r() * 6; this.rot[o + 1] = r() * 6; this.rot[o + 2] = r() * 6;
    this.av[o] = (r() - 0.5) * 18; this.av[o + 1] = (r() - 0.5) * 18; this.av[o + 2] = (r() - 0.5) * 18;
    this.gx[i] = 1e9;
    this.size[i] = size; this.life[i] = life; this.max[i] = life; this.flag[i] = flag; this.drag[i] = drag;
    const c = lin(hex), k = 1 + (r() - 0.5) * jit;
    this.col[o] = c[0] * k; this.col[o + 1] = c[1] * k; this.col[o + 2] = c[2] * k;
    this.mesh.instanceColor!.needsUpdate = true;
  }
  snapshot() {
    return { next: this.next, arr: [this.pos, this.vel, this.rot, this.av, this.size, this.life, this.max, this.flag, this.drag, this.col].map((a) => a.slice()) };
  }
  restore(s: ReturnType<Pool['snapshot']>) {
    this.next = s.next;
    const t = [this.pos, this.vel, this.rot, this.av, this.size, this.life, this.max, this.flag, this.drag, this.col];
    t.forEach((a, i) => (a as Float32Array).set(s.arr[i] as Float32Array));
    this.mesh.instanceColor!.needsUpdate = true;
    this.dirty = true;
  }
  clear() { this.life.fill(0); }
}

/** inline compose: XYZ euler rotation + non-uniform scale + translation, written straight into the instance buffer */
function compose(a: Float32Array, k: number, x: number, y: number, z: number, rx: number, ry: number, rz: number, sx: number, sy: number, sz: number) {
  const ca = Math.cos(rx), sa = Math.sin(rx), c = Math.cos(ry), d = Math.sin(ry), ce = Math.cos(rz), f = Math.sin(rz);
  const ae = ca * ce, af = ca * f, be = sa * ce, bf = sa * f;
  a[k] = c * ce * sx; a[k + 1] = (af + be * d) * sx; a[k + 2] = (bf - ae * d) * sx; a[k + 3] = 0;
  a[k + 4] = -c * f * sy; a[k + 5] = (ae - bf * d) * sy; a[k + 6] = (be + af * d) * sy; a[k + 7] = 0;
  a[k + 8] = d * sz; a[k + 9] = -sa * c * sz; a[k + 10] = ca * c * sz; a[k + 11] = 0;
  a[k + 12] = x; a[k + 13] = y; a[k + 14] = z; a[k + 15] = 1;
}
function scaleOnly(a: Float32Array, k: number, x: number, y: number, z: number, sx: number, sy: number, sz: number) {
  a[k] = sx; a[k + 1] = 0; a[k + 2] = 0; a[k + 3] = 0;
  a[k + 4] = 0; a[k + 5] = sy; a[k + 6] = 0; a[k + 7] = 0;
  a[k + 8] = 0; a[k + 9] = 0; a[k + 10] = sz; a[k + 11] = 0;
  a[k + 12] = x; a[k + 13] = y; a[k + 14] = z; a[k + 15] = 1;
}

export class Gore {
  debris = new Pool(PERF.debris, MAT, PERF.debrisShadows);
  blood = new Pool(PERF.blood, MAT, false);
  glow = new Pool(PERF.glow, GLOW_MAT, false);
  decals: THREE.InstancedMesh;
  private decalN = 0; private decalMax = PERF.decals;
  private decalDirty = false;
  allowDecals = true;
  group = new THREE.Group();
  onTrainSplat: ((x: number, z: number) => boolean) | null = null;

  constructor(public heightAt: HeightFn) {
    const dm = new THREE.MeshStandardMaterial({ map: (MAT as THREE.MeshStandardMaterial).map, roughness: 0.35, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.decals = new THREE.InstancedMesh(BOX, dm, this.decalMax);
    this.decals.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.decalMax * 3), 3);
    (this.decals.instanceMatrix.array as Float32Array).fill(0);
    this.decals.frustumCulled = false;
    this.decals.receiveShadow = true;
    this.group.add(this.debris.mesh, this.blood.mesh, this.glow.mesh, this.decals);
  }

  get activeCount() { return this.debris.alive + this.blood.alive + this.glow.alive + Math.min(this.decalN, this.decalMax); }

  decal(x: number, y: number, z: number, hex: number, size: number, r: RNG) {
    if (!this.allowDecals) return;
    const k = this.decalN++ % this.decalMax;
    const a = this.decals.instanceMatrix.array as Float32Array;
    const sx = size * (0.6 + r() * 0.8), sz = size * (0.6 + r() * 0.8);
    writeMatrix(a, k * 16, x, y + 0.012, z, sx, 0.02, sz, r() * 3);
    const c = lin(hex), j = 0.75 + r() * 0.4;
    const col = this.decals.instanceColor!.array as Float32Array;
    col[k * 3] = c[0] * j; col[k * 3 + 1] = c[1] * j; col[k * 3 + 2] = c[2] * j;
    this.decalDirty = true;
  }

  /** dripping blood from a point (train front, hanging gore). Not replay-deterministic, purely cosmetic. */
  drip(x: number, y: number, z: number, hex: number, n: number, vx = 0, vz = 0) {
    for (let i = 0; i < n; i++) {
      const r = Math.random;
      this.blood.spawn(x + (r() - 0.5) * 1.6, y - r() * 0.6, z + (r() - 0.5) * 1.6, vx * 0.6 + (r() - 0.5), -r() * 2, vz * 0.6 + (r() - 0.5), 0.07 + r() * 0.1, hex, 5, r, 2, 0.1, 0.2);
    }
  }

  /** surface height including track bed */
  private ground(x: number, z: number) { return this.heightAt(x, z); }

  /**
   * Blow a voxel model apart. pose = world transform of the model, s = voxel size.
   * dir = train direction, speed = train speed. Deterministic for a given seed (replays).
   */
  explode(vox: Vox[], s: number, px: number, py: number, pz: number, ry: number, dirx: number, dirz: number, speed: number, bleed: Bleed, seed: number, intensity = 1) {
    const r = mulberry32(seed);
    const c = Math.cos(ry), sn = Math.sin(ry);
    const sp = Math.max(6, speed);
    const step = vox.length > 900 ? vox.length / 900 : 1;
    let cxs = 0, cys = 0, czs = 0, cnt = 0;
    for (let f = 0; f < vox.length; f += step) {
      const v = vox[Math.floor(f)];
      const lx = (v.x + 0.5) * s, ly = (v.y + 0.5) * s, lz = (v.z + 0.5) * s;
      const x = px + c * lx + sn * lz, y = py + ly, z = pz - sn * lx + c * lz;
      cxs += x; cys += y; czs += z; cnt++;
      const fwd = sp * (0.6 + r() * 1.3) * (0.8 + intensity * 0.25);
      const spread = 3.5 + sp * 0.5 * intensity;
      const vx = dirx * fwd + (r() - 0.5) * spread + (x - px) * 2.6;
      const vz = dirz * fwd + (r() - 0.5) * spread + (z - pz) * 2.6;
      const vy = 4 + r() * (7 + sp * 0.45 * intensity) + ly * 1.0;
      const sz = s * step ** 0.33 * (0.85 + r() * 0.2);
      if (v.g) this.glow.spawn(x, y, z, vx, vy, vz, sz, v.c, 10 + r() * 6, r, 0, 0.07, 0);
      else this.debris.spawn(x, y, z, vx, vy, vz, sz, v.c, 18 + r() * 12, r, 0, 0.05, 0.1);
    }
    const mx = cxs / cnt, my = cys / cnt, mz = czs / cnt;
    const palette = bleed === 'green' ? GREEN : bleed === 'oil' ? OIL : bleed === 'snow' ? [0xffffff, 0xe8f0f8] : bleed === 'splinter' ? [0x16161a, 0xf6f2e8, 0x6b4426] : BLOOD;
    const bloody = bleed === 'red' || bleed === 'green';
    // meaty chunks
    if (bloody) {
      const meat = bleed === 'green' ? [0x2f8f1a, 0x4ab82a] : [0x9a1018, 0x6e0a10, 0xc23040, 0xf0e8dc];
      const n = Math.floor((32 + sp * 2.6) * intensity);
      for (let i = 0; i < n; i++) {
        const fwd = sp * (0.6 + r() * 1.4);
        this.debris.spawn(mx + (r() - 0.5), my + (r() - 0.5), mz + (r() - 0.5), dirx * fwd + (r() - 0.5) * 11, 5 + r() * (12 + 3 * intensity), dirz * fwd + (r() - 0.5) * 11, s * (0.8 + r() * 1.8), meat[Math.floor(r() * meat.length)], 20 + r() * 10, r, 1, 0.05, 0.2);
      }
    }
    // spray
    const nb = Math.min(4200, Math.floor((bleed === 'confetti' ? 560 : 440 + sp * 22) * intensity));
    for (let i = 0; i < nb; i++) {
      const gushy = r() < 0.25; // slow heavy gush that pours out near the body
      const fwd = gushy ? sp * r() * 0.35 : sp * (0.2 + r() * 1.6);
      const a = r() * Math.PI * 2, rad = r() * (gushy ? 3 : 6 + sp * 0.4 * intensity);
      const vx = dirx * fwd + Math.cos(a) * rad, vz = dirz * fwd + Math.sin(a) * rad;
      const vy = gushy ? 1 + r() * 5 : 2 + r() * (10 + sp * 0.4);
      if (bleed === 'confetti') {
        this.blood.spawn(mx, my, mz, vx * 0.7, vy * 1.2, vz * 0.7, 0.1 + r() * 0.08, CONFETTI[Math.floor(r() * CONFETTI.length)], 6 + r() * 4, r, 3, 1.6, 0);
      } else {
        this.blood.spawn(mx + (r() - 0.5) * 0.6, my + (r() - 0.5) * 0.6, mz + (r() - 0.5) * 0.6, vx, vy, vz, (gushy ? 0.12 : 0.07) + r() * 0.18, palette[Math.floor(r() * palette.length)], 6 + r() * 4, r, 2, 0.12, 0.2);
      }
    }
    if (bleed === 'oil' || bleed === 'splinter') {
      for (let i = 0; i < 240 * intensity; i++) {
        const a = r() * Math.PI * 2, rad = 3 + r() * 10;
        this.glow.spawn(mx, my, mz, Math.cos(a) * rad + dirx * sp * 0.6, 2 + r() * 12, Math.sin(a) * rad + dirz * sp * 0.6, 0.05 + r() * 0.06, r() < 0.5 ? 0xffd23a : 0xff8a1a, 0.6 + r() * 0.9, r, 4, 0.5, 0);
      }
    }
    // instant ground splat under impact
    if (bloody || bleed === 'oil') {
      for (let i = 0; i < 30 * intensity; i++) {
        const x = mx + dirx * r() * 11 + (r() - 0.5) * 4, z = mz + dirz * r() * 11 + (r() - 0.5) * 4;
        this.decal(x, this.gy(x, z), z, palette[Math.floor(r() * palette.length)], 0.5 + r() * 1.3, r);
      }
      // the big puddle: layered dark pools right where it happened
      const dark = bleed === 'green' ? [0x1f8a0a, 0x2ea814] : bleed === 'oil' ? OIL : [0x5a0005, 0x6e0006, 0x7a0008];
      for (let i = 0; i < 4 + 3 * intensity; i++) {
        const x = mx + dirx * r() * 3 + (r() - 0.5) * 2, z = mz + dirz * r() * 3 + (r() - 0.5) * 2;
        this.decal(x, this.gy(x, z) + 0.004 * i, z, dark[Math.floor(r() * dark.length)], 1.4 + r() * 1.6 * intensity, r);
      }
    }
    // extreme hits (combos, rare targets, flat-out speed): fountain + blood rain
    if (intensity >= 1.7 && bleed !== 'confetti') {
      const ex = intensity - 1.2;
      const nf = Math.floor(700 * ex);
      for (let i = 0; i < nf; i++) { // fountain: a geyser straight up out of the wreck
        const a = r() * Math.PI * 2, rad = r() * 3.2;
        this.blood.spawn(mx + (r() - 0.5) * 0.5, my, mz + (r() - 0.5) * 0.5, Math.cos(a) * rad + dirx * sp * 0.15, 15 + r() * 17, Math.sin(a) * rad + dirz * sp * 0.15, 0.08 + r() * 0.16, palette[Math.floor(r() * palette.length)], 8, r, 2, 0.1, 0.2);
      }
      const nr = Math.floor(900 * ex);
      const cx = mx + dirx * 7, cz = mz + dirz * 7;
      for (let i = 0; i < nr; i++) { // blood rain over the area ahead of the train
        const a = r() * Math.PI * 2, rad = Math.sqrt(r()) * 16;
        this.blood.spawn(cx + Math.cos(a) * rad, my + 10 + r() * 14, cz + Math.sin(a) * rad, dirx * sp * 0.1, -2 - r() * 5, dirz * sp * 0.1, 0.07 + r() * 0.12, palette[Math.floor(r() * palette.length)], 8, r, 2, 0.05, 0.2);
      }
    }
  }
  isTrack: (x: number, z: number) => boolean = () => false;
  private gy(x: number, z: number) { return this.ground(x, z) + 0.2 * +(this.isTrack(x, z)); }

  update(dt: number) {
    for (const P of [this.debris, this.blood, this.glow]) this.step(P, dt);
    if (this.decalDirty) {
      this.decalDirty = false;
      this.decals.instanceMatrix.needsUpdate = true;
      this.decals.instanceColor!.needsUpdate = true;
    }
  }

  private step(P: Pool, dt: number) {
    const a = P.mesh.instanceMatrix.array as Float32Array;
    let alive = 0, hi = 0;
    const g = 24;
    const dr = new THREE.Vector3();
    const full = P.dirty;
    P.dirty = false;
    // cull pressure: when a pool runs hot, settled bits fade out faster so fresh gore always has room
    const pressure = P.alive > P.n * 0.8 ? 4 : P.alive > P.n * 0.6 ? 2 : 1;
    const trails = P === this.debris;
    for (let i = 0; i < P.n; i++) {
      const o = i * 3;
      if (P.life[i] <= 0) {
        if (a[i * 16 + 15] !== 0) { a.fill(0, i * 16, i * 16 + 16); }
        continue;
      }
      alive++; hi = i + 1;
      const fl = P.flag[i];
      P.life[i] -= fl === 9 ? dt * pressure : dt;
      let x = P.pos[o], y = P.pos[o + 1], z = P.pos[o + 2];
      let vx = P.vel[o], vy = P.vel[o + 1], vz = P.vel[o + 2];
      const resting = fl === 9;
      if (!resting) {
        const d = Math.max(0, 1 - P.drag[i] * dt);
        vx *= d; vz *= d; vy = vy * d - g * dt * (fl === 3 ? 0.35 : 1);
        if (fl === 3) { vx += Math.sin(P.life[i] * 7 + i) * dt * 3; }
        x += vx * dt; y += vy * dt; z += vz * dt;
        const half = P.size[i] * 0.5;
        let gy = P.gh[i];
        // only resample the terrain when close to it and moved, which skips most airborne particles
        if (y - half < gy + 3 && Math.abs(x - P.gx[i]) + Math.abs(z - P.gz[i]) > 0.35) {
          const h0 = this.ground(x, z);
          gy = h0 === 0 && this.isTrack(x, z) ? 0.2 : h0;
          P.gh[i] = gy; P.gx[i] = x; P.gz[i] = z;
        } else if (P.gx[i] === 1e9) {
          const h0 = this.ground(x, z);
          gy = h0 === 0 && this.isTrack(x, z) ? 0.2 : h0;
          P.gh[i] = gy; P.gx[i] = x; P.gz[i] = z;
        }
        if (y - half < gy) {
          y = gy + half;
          if (fl === 2) { // blood droplet: splat into a decal and die
            if (this.allowDecals && i % 3 === 0) this.decal(x, gy, z, 0, 0, Math.random);
            this.decalColorFrom(P, i, x, gy, z);
            P.life[i] = 0;
            continue;
          }
          if (fl === 4) { P.life[i] = 0; continue; }
          vy = -vy * 0.35; vx *= 0.6; vz *= 0.6;
          P.av[o] *= 0.6; P.av[o + 1] *= 0.6; P.av[o + 2] *= 0.6;
          if (Math.abs(vy) < 1.2 && vx * vx + vz * vz < 0.5) { P.flag[i] = 9; vy = vx = vz = 0; if (fl === 1 && this.allowDecals && Math.random() < 0.7) this.decal(x, gy, z, 0x7a0008, P.size[i] * 2.4, Math.random); }
        }
        if (trails && fl === 1 && Math.random() < dt * 30) { // flying meat leaves a blood trail
          this.blood.spawn(x, y, z, vx * 0.3, vy * 0.3, vz * 0.3, 0.06 + Math.random() * 0.08, 0x9a000a, 4, Math.random, 2, 0.2, 0.25);
        }
        P.rot[o] += P.av[o] * dt; P.rot[o + 1] += P.av[o + 1] * dt; P.rot[o + 2] += P.av[o + 2] * dt;
        P.pos[o] = x; P.pos[o + 1] = y; P.pos[o + 2] = z;
        P.vel[o] = vx; P.vel[o + 1] = vy; P.vel[o + 2] = vz;
      }
      let sc = P.size[i];
      const lf = P.life[i];
      if (lf < 1.2) sc *= Math.max(0, lf / 1.2);
      if (resting && lf >= 1.2 && !full && a[i * 16 + 15] !== 0) {
        // settled and not fading: matrix is already in place. Meat keeps oozing into its puddle.
        if (trails && P.mesh.material === MAT && P.col[o] > P.col[o + 1] * 3 && lf > 6 && Math.random() < dt * 0.25 && this.allowDecals) this.decal(x, y - P.size[i] * 0.5, z, 0x6e0006, P.size[i] * 2.4 + Math.random() * 0.6, Math.random);
        continue;
      }
      if (fl === 3) compose(a, i * 16, x, y, z, P.rot[o], P.rot[o + 1], P.rot[o + 2], sc, sc * 0.15, sc); // confetti: flat flutter
      else if (fl === 2 || fl === 4) scaleOnly(a, i * 16, x, y, z, sc, sc * (1 + Math.min(2, Math.abs(P.vel[o + 1]) * 0.08)), sc); // droplets stretch with speed
      else compose(a, i * 16, x, y, z, P.rot[o], P.rot[o + 1], P.rot[o + 2], sc, sc, sc);
      void dr;
    }
    P.alive = alive;
    P.mesh.count = hi; // only draw (and upload) up to the highest live slot
    P.mesh.instanceMatrix.clearUpdateRanges();
    P.mesh.instanceMatrix.addUpdateRange(0, hi * 16);
    P.mesh.instanceMatrix.needsUpdate = true;
  }

  private decalColorFrom(P: Pool, i: number, x: number, y: number, z: number) {
    // overwrite the last decal's color with this droplet's color (decal() above used a dummy)
    if (!this.allowDecals || i % 3 !== 0) return;
    const k = (this.decalN - 1) % this.decalMax;
    const a = this.decals.instanceMatrix.array as Float32Array;
    const sz = 0.14 + P.size[i] * 3.2 + Math.random() * 0.3;
    writeMatrix(a, k * 16, x, y + 0.012, z, sz * (0.6 + Math.random()), 0.02, sz * (0.6 + Math.random()), Math.random() * 3);
    const col = this.decals.instanceColor!.array as Float32Array;
    col[k * 3] = P.col[i * 3] * 0.8; col[k * 3 + 1] = P.col[i * 3 + 1] * 0.8; col[k * 3 + 2] = P.col[i * 3 + 2] * 0.8;
  }

  snapshot() { return [this.debris.snapshot(), this.blood.snapshot(), this.glow.snapshot()]; }
  restore(s: ReturnType<Gore['snapshot']>) { this.debris.restore(s[0]); this.blood.restore(s[1]); this.glow.restore(s[2]); }
  clear() { this.debris.clear(); this.blood.clear(); this.glow.clear(); }
}
