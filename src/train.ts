// The train: a locomotive, tender and N cars riding the track by arc length.
import * as THREE from 'three';
import { Track, TrackPoint } from './track';
import { modelGroup, VoxelList, buildInstanced, MAT, lin, writeMatrix } from './voxels';
import * as M from './models';
import { mulberry32 } from './rng';

export interface Segment { x: number; z: number; dx: number; dz: number; halfLen: number; halfW: number; }

const S = 0.25;
const RIDE_Y = 0.36;

export class Train {
  group = new THREE.Group();
  cars: { g: THREE.Group; len: number; offset: number }[] = [];
  s = 30;
  speed = 0;
  throttle = 0; // 0..10
  braking = false;
  maxSpeed = 34;
  distance = 0;
  topSpeed = 0;
  segments: Segment[] = [];
  splat: THREE.InstancedMesh;
  private splatN = 0;
  private splatMax = 500;
  headlight: THREE.SpotLight;
  voxelCount = 0;
  private tp: TrackPoint = { x: 0, z: 0, h: 0, dx: 0, dz: -1 };
  private tp2: TrackPoint = { x: 0, z: 0, h: 0, dx: 0, dz: -1 };

  constructor(public track: Track, nCars: number) {
    const loco = modelGroup(M.locomotive(), S, 0.05);
    this.addCar(loco, 8.0);
    this.splat = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), MAT, this.splatMax);
    this.splat.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.splatMax * 3), 3);
    (this.splat.instanceMatrix.array as Float32Array).fill(0);
    this.splat.frustumCulled = false;
    loco.add(this.splat);
    this.headlight = new THREE.SpotLight(0xfff0c8, 0, 70, 0.5, 0.5, 1.2);
    this.headlight.position.set(-0.1, 2.7, 3.6);
    this.headlight.target.position.set(0, 0.5, 20);
    loco.add(this.headlight, this.headlight.target);
    this.addCar(modelGroup(M.tender(), S, 0.05), 4.0);
    this.setCars(nCars);
  }

  private addCar(g: THREE.Group, len: number) {
    this.group.add(g);
    this.cars.push({ g, len, offset: 0 });
    this.relayout();
  }

  setCars(n: number) {
    while (this.cars.length > 2) { const c = this.cars.pop()!; c.g.traverse((o) => (o as THREE.InstancedMesh).isInstancedMesh && (o as THREE.InstancedMesh).dispose()); c.g.removeFromParent(); }
    const r = mulberry32(42);
    for (let i = 0; i < n; i++) {
      const kind: M.CarKind = i === n - 1 && n > 1 ? 'caboose' : M.CAR_KINDS[i % M.CAR_KINDS.length];
      this.addCar(modelGroup(M.railcar(kind, r), S, 0.05), 6.0);
    }
    this.voxelCount = 0;
    this.group.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh && o !== this.splat) this.voxelCount += (o as THREE.InstancedMesh).count; });
  }

  private relayout() {
    let off = 0;
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      if (i > 0) off -= this.cars[i - 1].len / 2 + 0.35 + c.len / 2;
      c.offset = off;
    }
  }

  get length() { const l = this.cars[this.cars.length - 1]; return -l.offset + l.len / 2 + this.cars[0].len / 2; }

  update(dt: number) {
    const accel = (this.throttle / 10) * 9 * (1 - this.speed / this.maxSpeed);
    let a = accel - 0.35 - this.speed * 0.012;
    if (this.braking) a -= 16;
    this.speed = Math.max(0, Math.min(this.maxSpeed, this.speed + a * dt));
    if (this.throttle === 0 && this.speed < 0.3 && !this.braking) this.speed = Math.max(0, this.speed - dt);
    const ds = this.speed * dt;
    this.s += ds;
    this.distance += ds;
    this.topSpeed = Math.max(this.topSpeed, this.speed);
  }

  /** place cars at arc length s (may be a replay value) */
  place(s: number) {
    this.segments.length = 0;
    for (const c of this.cars) {
      const sc = s + c.offset;
      const a = this.track.at(sc + c.len * 0.33, this.tp), b = this.track.at(sc - c.len * 0.33, this.tp2);
      const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2;
      let dx = a.x - b.x, dz = a.z - b.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      c.g.position.set(x, RIDE_Y + Math.abs(Math.sin(s * 3.1 + c.offset)) * 0.02 * Math.min(1, this.speed / 10), z);
      c.g.rotation.y = Math.atan2(dx, dz);
      this.segments.push({ x, z, dx, dz, halfLen: c.len / 2, halfW: 1.3 });
    }
  }

  get loco() { return this.cars[0].g; }

  /** smear gore onto the front of the locomotive */
  addSplat(hex: number, n: number, rnd: () => number) {
    const a = this.splat.instanceMatrix.array as Float32Array;
    const col = this.splat.instanceColor!.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const k = this.splatN++ % this.splatMax;
      const face = rnd();
      let x: number, y: number, z: number, sx: number, sy: number, sz: number;
      const sz0 = 0.12 + rnd() * 0.22;
      if (face < 0.55) { // front: cowcatcher + smokebox
        x = (rnd() - 0.5) * 2.0; y = rnd() * 3.2; z = y < 0.9 ? 4.35 - y * 0.3 : 3.5; sx = sz0; sy = sz0 * (1 + rnd()); sz = 0.06;
      } else if (face < 0.85) { // sides
        x = (rnd() < 0.5 ? -1 : 1) * 1.04; y = 0.4 + rnd() * 2.6; z = -1.4 + rnd() * 5; sx = 0.06; sy = sz0 * (1 + rnd() * 2); sz = sz0;
      } else { // top of boiler
        x = (rnd() - 0.5) * 1.4; y = 3.1; z = -1 + rnd() * 4.3; sx = sz0; sy = 0.06; sz = sz0;
      }
      writeMatrix(a, k * 16, x, y, z, sx, sy, sz, 0);
      const c = lin(hex);
      const j = 0.7 + rnd() * 0.5;
      col[k * 3] = c[0] * j; col[k * 3 + 1] = c[1] * j; col[k * 3 + 2] = c[2] * j;
    }
    this.splat.instanceMatrix.needsUpdate = true;
    this.splat.instanceColor!.needsUpdate = true;
  }
}
export { VoxelList, buildInstanced };
