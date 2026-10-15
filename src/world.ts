// Chunk streaming. The world is generated in 32x32 chunks around a focus point
// ahead of the train and disposed behind it. Biomes come from a jittered Voronoi
// over large cells so the line runs through farms, towns, forest, desert, snow and alien zones.
import * as THREE from 'three';
import { Track, Crossing } from './track';
import { VoxelList, buildGroup, disposeGroup, placeModel, Vox } from './voxels';
import { fbm, hash2, mulberry32, smoothstep, vnoise, RNG } from './rng';
import * as M from './models';

export const CHUNK = 32;
export type Biome = 'farm' | 'town' | 'forest' | 'desert' | 'snow' | 'alien';
export const BIOMES: Biome[] = ['farm', 'town', 'forest', 'desert', 'snow', 'alien'];
const BIOME_W: [Biome, number][] = [['farm', 0.24], ['town', 0.2], ['forest', 0.17], ['desert', 0.16], ['snow', 0.12], ['alien', 0.11]];
const CELL = 230;

interface Chunk { cx: number; cz: number; group: THREE.Group; heights: Int8Array; count: number; }

export class World {
  chunks = new Map<string, Chunk>();
  group = new THREE.Group();
  voxelCount = 0;
  private dist = new Float32Array(CHUNK * CHUNK);
  private hgrid = new Int16Array((CHUNK + 2) * (CHUNK + 2));
  private modelCache = new Map<string, Vox[][]>();

  constructor(public track: Track, public seed: number) {}

  biomeAt(x: number, z: number): Biome {
    // the first stretch is always farmland so you start in the cow fields
    if (z > -160 && Math.abs(x) < 200) return 'farm';
    const gx = Math.floor(x / CELL), gz = Math.floor(z / CELL);
    let best = 1e18, bh = 0;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const cx = gx + i, cz = gz + j;
      const px = (cx + hash2(cx, cz, this.seed + 11)) * CELL, pz = (cz + hash2(cx, cz, this.seed + 12)) * CELL;
      const d = (px - x) ** 2 + (pz - z) ** 2;
      if (d < best) { best = d; bh = hash2(cx, cz, this.seed + 13); }
    }
    let acc = 0;
    for (const [b, w] of BIOME_W) { acc += w; if (bh < acc) return b; }
    return 'farm';
  }

  heightAt(x: number, z: number): number {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const c = this.chunks.get(cx + ',' + cz);
    if (!c) return 0;
    const i = Math.floor(x - cx * CHUNK), j = Math.floor(z - cz * CHUNK);
    return c.heights[j * CHUNK + i];
  }

  /** raw terrain height before track/road flattening */
  private rawHeight(x: number, z: number, b: Biome): number {
    const n = fbm(x * 0.018, z * 0.018, this.seed, 4);
    switch (b) {
      case 'farm': return Math.floor((n - 0.45) * 7);
      case 'town': return Math.floor((n - 0.45) * 3);
      case 'forest': return Math.floor((n - 0.4) * 10);
      case 'desert': {
        const m = vnoise(x * 0.03, z * 0.03, this.seed + 5);
        return Math.floor((n - 0.45) * 5) + (m > 0.68 ? Math.floor(8 + (m - 0.68) * 30) : 0);
      }
      case 'snow': return Math.floor((n - 0.35) * 22 + Math.max(0, fbm(x * 0.05, z * 0.05, this.seed + 3, 2) - 0.5) * 14);
      case 'alien': return Math.floor((n - 0.45) * 8);
    }
  }

  private roadInfo(x: number, z: number, cs: Crossing[]): { d: number; along: number } {
    let best = 99, along = 0;
    for (const c of cs) {
      const rx = x - c.x, rz = z - c.z;
      const t = rx * c.dx + rz * c.dz;
      if (t < -c.half || t > c.half) continue;
      const d = Math.abs(rx * -c.dz + rz * c.dx);
      if (d < best) { best = d; along = t; }
    }
    return { d: best, along };
  }

  private cached(key: string, n: number, f: (r: RNG) => Vox[]): Vox[][] {
    let arr = this.modelCache.get(key);
    if (!arr) {
      const r = mulberry32(this.seed + key.length * 131 + key.charCodeAt(0));
      arr = [];
      for (let i = 0; i < n; i++) arr.push(f(r));
      this.modelCache.set(key, arr);
    }
    return arr;
  }

  private genChunk(cx: number, cz: number): Chunk {
    const N = CHUNK, x0 = cx * N, z0 = cz * N;
    this.track.distGrid(x0 - 1, z0 - 1, N + 2, 16, this.distBig);
    const cs = this.track.crossings.filter((c) => Math.abs(c.x - (x0 + N / 2)) < c.half + N && Math.abs(c.z - (z0 + N / 2)) < c.half + N);
    const L = new VoxelList();
    const heights = new Int8Array(N * N);
    const W = N + 2;
    const biomeGrid: Biome[] = new Array(W * W);
    const roadD = new Float32Array(W * W), roadA = new Float32Array(W * W);
    // pass 1: heights over padded grid
    for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
      const x = x0 + i - 1 + 0.5, z = z0 + j - 1 + 0.5;
      const b = this.biomeAt(x, z);
      biomeGrid[j * W + i] = b;
      let h = this.rawHeight(x, z, b);
      const dT = this.distBig[j * W + i];
      const rd = this.roadInfo(x, z, cs);
      roadD[j * W + i] = rd.d; roadA[j * W + i] = rd.along;
      const flat = Math.min(smoothstep(3.5, 15, dT), smoothstep(2.2, 7, rd.d));
      h = Math.round(h * flat);
      // ponds
      if (h <= 0 && (b === 'farm' || b === 'forest' || b === 'town') && dT > 9 && rd.d > 5) {
        const p = vnoise(x * 0.04, z * 0.04, this.seed + 21);
        if (p > 0.7) h = -1;
      }
      if (h > 30) h = 30;
      this.hgrid[j * W + i] = h;
    }
    let lights = 0;
    // pass 2: terrain voxels
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const gi = (j + 1) * W + (i + 1);
      const h = this.hgrid[gi];
      const b = biomeGrid[gi];
      const x = x0 + i + 0.5, z = z0 + j + 0.5;
      heights[j * N + i] = h < 0 ? -1 : h;
      const dT = this.distBig[gi], rD = roadD[gi];
      let top: number, side: number;
      const n2 = hash2(Math.floor(x), Math.floor(z), 99);
      switch (b) {
        case 'farm': {
          const f = vnoise(x * 0.05, z * 0.05, this.seed + 8);
          if (f > 0.6 && dT > 6) { const s = Math.floor(x) % 3; top = [0xd9b44a, 0x8fb04a, 0x7a5a32][(s + 3) % 3]; }
          else top = n2 > 0.5 ? 0x5fae3f : 0x56a03a;
          side = 0x7a5232; break;
        }
        case 'town': top = n2 > 0.5 ? 0x67b245 : 0x5ea83f; side = 0x7a5232; break;
        case 'forest': top = n2 > 0.5 ? 0x3f8f35 : 0x4a9a3a; side = 0x6b4628; break;
        case 'desert': top = n2 > 0.5 ? 0xe3c27e : 0xdcb874; side = h > 3 ? [0xc0643a, 0xd98a4a, 0xa84e30][((h % 3) + 3) % 3] : 0xc9a466; if (h > 6) top = 0xd0773f; break;
        case 'snow': top = h >= 3 ? (n2 > 0.3 ? 0xf2f5fa : 0xe4e9f0) : (n2 > 0.5 ? 0xdfe8ee : 0xcfdbe2); side = 0x8a8f99; break;
        case 'alien': top = n2 > 0.85 ? 0x7cff5a : n2 > 0.5 ? 0x5b4a72 : 0x50426a; side = 0x3a2f4d; break;
      }
      let glow = b === 'alien' && n2 > 0.85;
      if (dT < 2.1) { top = n2 > 0.5 ? 0x8a8378 : 0x7a746a; glow = false; }
      if (rD < 1.7) {
        const dash = rD < 0.35 && ((Math.floor(roadA[gi] / 1.5) & 1) === 0);
        top = dash ? 0xf2c230 : (rD > 1.3 ? 0x8a8a8a : 0x3c3c42);
        glow = false;
      }
      if (h < 0) {
        L.add(x, -0.75, z, n2 > 0.5 ? 0x3d7fd6 : 0x3577cc, 1, 0.5, 1, 0, false);
        L.add(x, -1.5, z, 0x2a4f80, 1, 1, 1);
        continue;
      }
      const ty = h - 0.5;
      L.add(x, ty, z, top, 1, 1, 1, 0, glow, 0.07);
      let mn = h;
      mn = Math.min(mn, this.hgrid[gi - 1], this.hgrid[gi + 1], this.hgrid[gi - W], this.hgrid[gi + W]);
      if (mn < -1) mn = -1;
      const depth = h - mn;
      if (depth >= 1) {
        if (depth <= 3) for (let k = 1; k <= depth; k++) L.add(x, ty - k, z, side, 1, 1, 1, 0, false, 0.08);
        else { L.add(x, ty - 1, z, side, 1, 1, 1, 0, false, 0.08); L.add(x, ty - 1.5 - (depth - 1) / 2, z, side, 1, depth - 1, 1); }
      }
      // ground clutter: flowers and grass tufts
      if (dT > 3 && rD > 2 && h >= 0) {
        const fl = hash2(Math.floor(x), Math.floor(z), 5);
        if ((b === 'farm' || b === 'town' || b === 'forest') && fl > 0.93) L.add(x + (fl - 0.96) * 6, h + 0.12, z, [0xffe14a, 0xff7ab0, 0xffffff, 0xff5a3a][Math.floor(fl * 400) % 4], 0.25, 0.25, 0.25);
        if (b === 'alien' && fl > 0.985) L.add(x, h + 0.3, z, 0x9bff6a, 0.3, 0.6, 0.3, 0, true);
      }
    }
    // track: ties + rails
    const sp = this.track.spacing;
    const tr = this.track;
    for (let k = 0; k < tr.xs.length - 1; k++) {
      const px = tr.xs[k], pz = tr.zs[k];
      if (px < x0 || px >= x0 + N || pz < z0 || pz >= z0 + N) continue;
      const g = tr.base + k;
      const h = tr.hs[k], ry = Math.atan2(Math.sin(h), -Math.cos(h));
      const nx = Math.cos(h), nz = Math.sin(h);
      if (g % 2 === 0) L.add(px, 0.1, pz, (g >> 1) % 3 ? 0x5a3b26 : 0x4a3020, 2.6, 0.2, 0.35, ry, false, 0.12);
      for (const o of [-0.72, 0.72]) {
        L.add(px + nx * o, 0.3, pz + nz * o, 0x9c9ea6, 0.14, 0.2, sp + 0.04, ry, false);
      }
    }
    // crossings: signs + planks
    const r = mulberry32(hash2(cx, cz, this.seed) * 1e9);
    for (const c of tr.crossings) {
      if (c.x < x0 || c.x >= x0 + N || c.z < z0 || c.z >= z0 + N) continue;
      const tp = tr.at(c.s);
      const ry = Math.atan2(tp.dx, tp.dz);
      const cb = this.cached('crossbuck', 1, () => M.crossbuck())[0];
      const nx = -tp.dz, nz = tp.dx;
      placeModel(L, cb, 0.4, c.x + nx * 3.2 + c.dx * 2.2, 0, c.z + nz * 3.2 + c.dz * 2.2, ry);
      placeModel(L, cb, 0.4, c.x - nx * 3.2 - c.dx * 2.2, 0, c.z - nz * 3.2 - c.dz * 2.2, ry + Math.PI);
      lights++;
    }
    // props
    const occ = new Uint8Array((N / 4) * (N / 4));
    for (let gj = 0; gj < N / 4; gj++) for (let gi2 = 0; gi2 < N / 4; gi2++) {
      if (occ[gj * (N / 4) + gi2]) continue;
      const i = gi2 * 4 + Math.floor(r() * 3), j = gj * 4 + Math.floor(r() * 3);
      const gi = (j + 1) * W + (i + 1);
      const h = this.hgrid[gi];
      const dT = this.distBig[gi], rD = roadD[gi];
      const b = biomeGrid[gi];
      const x = x0 + i + 0.5, z = z0 + j + 0.5;
      if (h < 0 || dT < 5.5 || rD < 3.5) continue;
      const roll = r();
      const rot = Math.floor(r() * 4) * (Math.PI / 2);
      const put = (vox: Vox[], s = 0.5, big = false) => {
        placeModel(L, vox, s, x, h, z, rot);
        if (big) { for (const [a, bb] of [[1, 0], [0, 1], [1, 1]]) if (gi2 + a < N / 4 && gj + bb < N / 4) occ[(gj + bb) * (N / 4) + gi2 + a] = 1; }
      };
      const pk = (key: string, n: number, f: (r: RNG) => Vox[]) => { const a = this.cached(key, n, f); return a[Math.floor(r() * a.length)]; };
      switch (b) {
        case 'farm':
          if (roll < 0.035 && dT > 12) put(pk('barn', 2, (q) => M.barn(q)), 0.5, true);
          else if (roll < 0.05 && dT > 10) put(this.cached('silo', 1, () => M.silo())[0], 0.5, true);
          else if (roll < 0.12) put(pk('house', 10, (q) => M.house(q)), 0.5, true);
          else if (roll < 0.3) put(pk('apple', 8, (q) => M.appleTree(q)), 0.5);
          else if (roll < 0.36) put(this.cached('hay', 1, () => M.haystack())[0], 0.5);
          else if (roll < 0.39) put(pk('rock', 6, (q) => M.rock(q)), 0.5);
          break;
        case 'town':
          if (roll < 0.42 && dT > 7) put(pk('house', 10, (q) => M.house(q)), 0.5, true);
          else if (roll < 0.45 && dT > 10) put(this.cached('wt', 1, () => M.waterTower())[0], 0.5, true);
          else if (roll < 0.6) put(pk('apple', 8, (q) => M.appleTree(q)), 0.5);
          else if (roll < 0.7) { put(this.cached('lamp', 1, () => M.lamp())[0], 0.4); lights++; }
          break;
        case 'forest':
          if (roll < 0.55) put(pk('apple', 8, (q) => M.appleTree(q)), 0.5);
          else if (roll < 0.8) put(pk('pine', 6, (q) => M.pine(q, false)), 0.5);
          else if (roll < 0.86) put(pk('rock', 6, (q) => M.rock(q)), 0.5);
          break;
        case 'desert':
          if (roll < 0.16) put(pk('cactus', 6, (q) => M.cactus(q)), 0.5);
          else if (roll < 0.22) put(pk('drock', 6, (q) => M.rock(q, false, 0xb0603a)), 0.5);
          else if (roll < 0.24) put(this.cached('skull', 1, () => M.skull())[0], 0.4);
          else if (roll < 0.26 && dT > 10) put(pk('house', 10, (q) => M.house(q)), 0.5, true);
          break;
        case 'snow':
          if (roll < 0.35) put(pk('spine', 6, (q) => M.pine(q, true)), 0.5);
          else if (roll < 0.47) put(pk('srock', 6, (q) => M.rock(q, true)), 0.5);
          else if (roll < 0.5 && dT > 9) put(pk('house', 10, (q) => M.house(q)), 0.5, true);
          break;
        case 'alien':
          if (roll < 0.03 && dT > 16) put(this.cached('saucer', 1, () => M.crashedSaucer())[0], 0.5, true);
          else if (roll < 0.2) put(pk('crystal', 8, (q) => M.crystal(q)), 0.5);
          else if (roll < 0.3) put(pk('arock', 6, (q) => M.rock(q, false, 0x5a5068)), 0.5);
          break;
      }
    }
    const group = buildGroup(L);
    group.userData.lights = lights;
    return { cx, cz, group, heights, count: L.count };
  }
  private distBig = new Float32Array((CHUNK + 2) * (CHUNK + 2));

  /** stream chunks around focus. Returns number generated this call. */
  update(fx: number, fz: number, radius: number, budgetMs: number): number {
    const t0 = performance.now();
    const N = CHUNK;
    const fcx = Math.floor(fx / N), fcz = Math.floor(fz / N);
    const R = Math.ceil(radius / N);
    // unload
    for (const [k, c] of this.chunks) {
      const dx = (c.cx + 0.5) * N - fx, dz = (c.cz + 0.5) * N - fz;
      if (dx * dx + dz * dz > (radius + 60) ** 2) {
        disposeGroup(c.group);
        this.voxelCount -= c.count;
        this.chunks.delete(k);
      }
    }
    // collect missing, nearest first
    const want: [number, number, number][] = [];
    for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
      const cx = fcx + i, cz = fcz + j;
      const dx = (cx + 0.5) * N - fx, dz = (cz + 0.5) * N - fz;
      const d = dx * dx + dz * dz;
      if (d > radius * radius) continue;
      if (!this.chunks.has(cx + ',' + cz)) want.push([d, cx, cz]);
    }
    want.sort((a, b) => a[0] - b[0]);
    let n = 0;
    for (const [, cx, cz] of want) {
      const c = this.genChunk(cx, cz);
      this.chunks.set(cx + ',' + cz, c);
      this.group.add(c.group);
      this.voxelCount += c.count;
      n++;
      if (performance.now() - t0 > budgetMs) break;
    }
    return n;
  }
}
