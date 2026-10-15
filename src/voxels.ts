// Voxel plumbing: one shared unit cube, a procedural "bevel" texture that gives
// every cube a soft dark edge, and helpers that turn voxel lists into InstancedMeshes.
import * as THREE from 'three';
import { hash3 } from './rng';

export const BOX = new THREE.BoxGeometry(1, 1, 1);

function bevelTexture(): THREE.Texture {
  const N = 64;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, N, N);
  for (let i = 0; i < 7; i++) {
    const a = 0.3 * Math.pow(1 - i / 7, 1.6);
    g.strokeStyle = `rgba(0,0,0,${a.toFixed(3)})`;
    g.lineWidth = 1;
    g.strokeRect(i + 0.5, i + 0.5, N - 1 - 2 * i, N - 1 - 2 * i);
  }
  // faint top-left highlight
  const grd = g.createLinearGradient(0, 0, N, N);
  grd.addColorStop(0, 'rgba(255,255,255,0.10)');
  grd.addColorStop(1, 'rgba(0,0,0,0.06)');
  g.fillStyle = grd;
  g.fillRect(0, 0, N, N);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export const BEVEL = bevelTexture();
export const MAT = new THREE.MeshStandardMaterial({ map: BEVEL, roughness: 0.86, metalness: 0.02 });
export const GLOW_MAT = new THREE.MeshBasicMaterial({ map: BEVEL });

const linCache = new Map<number, [number, number, number]>();
const tmpColor = new THREE.Color();
export function lin(hex: number): [number, number, number] {
  let v = linCache.get(hex);
  if (!v) {
    tmpColor.setHex(hex);
    v = [tmpColor.r, tmpColor.g, tmpColor.b];
    linCache.set(hex, v);
  }
  return v;
}

/** Flat float list: x,y,z, sx,sy,sz, ry, r,g,b  (10 per voxel) */
export const STRIDE = 10;
export class VoxelList {
  lit: number[] = [];
  glow: number[] = [];
  add(x: number, y: number, z: number, hex: number, sx = 1, sy = 1, sz = 1, ry = 0, glow = false, jit = 0) {
    const c = lin(hex);
    let k = 1;
    if (jit) k = 1 + (hash3(Math.floor(x * 4), Math.floor(y * 4), Math.floor(z * 4), 9) - 0.5) * jit;
    (glow ? this.glow : this.lit).push(x, y, z, sx, sy, sz, ry, c[0] * k, c[1] * k, c[2] * k);
  }
  get count() { return (this.lit.length + this.glow.length) / STRIDE; }
}

export function writeMatrix(a: Float32Array, o: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry: number) {
  const c = Math.cos(ry), s = Math.sin(ry);
  a[o] = c * sx; a[o + 1] = 0; a[o + 2] = -s * sx; a[o + 3] = 0;
  a[o + 4] = 0; a[o + 5] = sy; a[o + 6] = 0; a[o + 7] = 0;
  a[o + 8] = s * sz; a[o + 9] = 0; a[o + 10] = c * sz; a[o + 11] = 0;
  a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
}

export function buildInstanced(d: number[], mat: THREE.Material, shadows = true): THREE.InstancedMesh | null {
  const n = d.length / STRIDE;
  if (!n) return null;
  const m = new THREE.InstancedMesh(BOX, mat, n);
  const a = m.instanceMatrix.array as Float32Array;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const o = i * STRIDE;
    writeMatrix(a, i * 16, d[o], d[o + 1], d[o + 2], d[o + 3], d[o + 4], d[o + 5], d[o + 6]);
    col[i * 3] = d[o + 7]; col[i * 3 + 1] = d[o + 8]; col[i * 3 + 2] = d[o + 9];
  }
  m.instanceColor = new THREE.InstancedBufferAttribute(col, 3);
  m.castShadow = shadows;
  m.receiveShadow = true;
  m.computeBoundingSphere();
  return m;
}

/** Build a group with a lit mesh + optional glow mesh from a VoxelList */
export function buildGroup(L: VoxelList, shadows = true): THREE.Group {
  const g = new THREE.Group();
  const a = buildInstanced(L.lit, MAT, shadows);
  if (a) g.add(a);
  const b = buildInstanced(L.glow, GLOW_MAT, false);
  if (b) { b.receiveShadow = false; g.add(b); }
  return g;
}

export function disposeGroup(g: THREE.Object3D) {
  g.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose(); });
  g.removeFromParent();
}

// ---------- grid models ----------
export interface Vox { x: number; y: number; z: number; c: number; g: boolean; }
type ColorFn = number | ((x: number, y: number, z: number) => number);

export class MB {
  m = new Map<number, Vox>();
  private k(x: number, y: number, z: number) { return ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512); }
  set(x: number, y: number, z: number, c: ColorFn, g = false) {
    const col = typeof c === 'number' ? c : c(x, y, z);
    if (col < 0) return this;
    this.m.set(this.k(x, y, z), { x, y, z, c: col, g });
    return this;
  }
  del(x: number, y: number, z: number) { this.m.delete(this.k(x, y, z)); return this; }
  has(x: number, y: number, z: number) { return this.m.has(this.k(x, y, z)); }
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: ColorFn, g = false) {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) this.set(x, y, z, c, g);
    return this;
  }
  ell(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, c: ColorFn, g = false) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++)
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
        for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++) {
          const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry, dz = (z + 0.5 - cz) / rz;
          if (dx * dx + dy * dy + dz * dz <= 1) this.set(x, y, z, c, g);
        }
    return this;
  }
  /** cylinder along z axis */
  cylZ(cx: number, cy: number, r: number, z0: number, z1: number, c: ColorFn) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
      for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r * r) for (let z = z0; z <= z1; z++) this.set(x, y, z, c);
      }
    return this;
  }
  /** cylinder along y axis */
  cylY(cx: number, cz: number, r: number, y0: number, y1: number, c: ColorFn, g = false) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
      for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++) {
        const dx = x + 0.5 - cx, dz = z + 0.5 - cz;
        if (dx * dx + dz * dz <= r * r) for (let y = y0; y <= y1; y++) this.set(x, y, z, c, g);
      }
    return this;
  }
  /** disc in YZ plane at x (wheels) */
  discX(x: number, cy: number, cz: number, r: number, c: ColorFn) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++) {
        const dy = y + 0.5 - cy, dz = z + 0.5 - cz;
        if (dy * dy + dz * dz <= r * r) this.set(x, y, z, c);
      }
    return this;
  }
  /** voxels, with fully enclosed interior culled */
  list(cull = true): Vox[] {
    const out: Vox[] = [];
    for (const v of this.m.values()) {
      if (cull && this.has(v.x + 1, v.y, v.z) && this.has(v.x - 1, v.y, v.z) && this.has(v.x, v.y + 1, v.z) &&
        this.has(v.x, v.y - 1, v.z) && this.has(v.x, v.y, v.z + 1) && this.has(v.x, v.y, v.z - 1)) continue;
      out.push(v);
    }
    return out;
  }
}

/** place a grid model into a VoxelList at world origin with rotation ry and voxel size s */
export function placeModel(L: VoxelList, vox: Vox[], s: number, ox: number, oy: number, oz: number, ry = 0, jit = 0.08) {
  const c = Math.cos(ry), sn = Math.sin(ry);
  for (const v of vox) {
    const lx = (v.x + 0.5) * s, ly = (v.y + 0.5) * s, lz = (v.z + 0.5) * s;
    L.add(ox + c * lx + sn * lz, oy + ly, oz - sn * lx + c * lz, v.c, s, s, s, ry, v.g, jit);
  }
}

/** a model as a standalone group in local space (for moving objects) */
export function modelGroup(vox: Vox[], s: number, jit = 0.08, shadows = true): THREE.Group {
  const L = new VoxelList();
  placeModel(L, vox, s, 0, 0, 0, 0, jit);
  return buildGroup(L, shadows);
}
