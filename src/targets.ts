// Things to run over. Each type has a voxel model, a bleed style, a sound and a behavior.
import * as THREE from 'three';
import { Vox, modelGroup, disposeGroup } from './voxels';
import { RNG, mulberry32 } from './rng';
import * as M from './models';
import type { Bleed } from './gore';
import type { Biome } from './world';

export type TypeId = 'cow' | 'person' | 'alien' | 'car' | 'duck' | 'clown' | 'trex' | 'ufo' | 'band' | 'piano' | 'sheep' | 'snowman' | 'robot' | 'chicken';
export type Sound = 'moo' | 'scream' | 'alien' | 'crash' | 'squeak' | 'honk' | 'roar' | 'ufo' | 'piano' | 'baa' | 'snow' | 'robot' | 'cluck';

export interface TType {
  id: TypeId; name: string; s: number; points: number; bleed: Bleed; sound: Sound; speed: number; rare: boolean;
  variants: number; build: (r: RNG, i: number) => Vox[]; radius: number;
}

export const TYPES: Record<TypeId, TType> = {
  cow: { id: 'cow', name: 'Cow', s: 0.22, points: 100, bleed: 'red', sound: 'moo', speed: 1.6, rare: false, variants: 4, build: (r) => M.cow(r), radius: 0.8 },
  person: { id: 'person', name: 'Pedestrian', s: 0.16, points: 150, bleed: 'red', sound: 'scream', speed: 2.4, rare: false, variants: 10, build: (r) => M.person(r), radius: 0.4 },
  alien: { id: 'alien', name: 'Alien', s: 0.16, points: 250, bleed: 'green', sound: 'alien', speed: 2.8, rare: false, variants: 4, build: (r) => M.alien(r), radius: 0.5 },
  car: { id: 'car', name: 'Car', s: 0.25, points: 300, bleed: 'oil', sound: 'crash', speed: 9, rare: false, variants: 8, build: (r) => M.car(r), radius: 1.2 },
  duck: { id: 'duck', name: 'Giant Duck', s: 0.5, points: 700, bleed: 'confetti', sound: 'squeak', speed: 1.5, rare: true, variants: 1, build: () => M.duck(), radius: 1.9 },
  clown: { id: 'clown', name: 'Clown', s: 0.18, points: 450, bleed: 'red', sound: 'honk', speed: 2.6, rare: true, variants: 2, build: (r) => M.clown(r), radius: 0.5 },
  trex: { id: 'trex', name: 'T-Rex', s: 0.36, points: 1500, bleed: 'red', sound: 'roar', speed: 3.2, rare: true, variants: 1, build: () => M.trex(), radius: 1.6 },
  ufo: { id: 'ufo', name: 'UFO', s: 0.3, points: 1200, bleed: 'oil', sound: 'ufo', speed: 2, rare: true, variants: 1, build: () => M.ufo(), radius: 2.0 },
  band: { id: 'band', name: 'Band Member', s: 0.16, points: 200, bleed: 'red', sound: 'scream', speed: 1.8, rare: false, variants: 6, build: (r, i) => M.bandMember(r, i), radius: 0.45 },
  piano: { id: 'piano', name: 'Piano', s: 0.2, points: 800, bleed: 'splinter', sound: 'piano', speed: 0, rare: true, variants: 1, build: () => M.piano(), radius: 1.2 },
  sheep: { id: 'sheep', name: 'Sheep', s: 0.18, points: 80, bleed: 'red', sound: 'baa', speed: 5.5, rare: false, variants: 4, build: (r) => M.sheep(r), radius: 0.6 },
  snowman: { id: 'snowman', name: 'Snowman', s: 0.2, points: 120, bleed: 'snow', sound: 'snow', speed: 0, rare: false, variants: 2, build: (r) => M.snowman(r), radius: 0.7 },
  robot: { id: 'robot', name: 'Robot', s: 0.2, points: 350, bleed: 'oil', sound: 'robot', speed: 2, rare: false, variants: 2, build: (r) => M.robot(r), radius: 0.7 },
  chicken: { id: 'chicken', name: 'Chicken', s: 0.14, points: 60, bleed: 'red', sound: 'cluck', speed: 3, rare: false, variants: 2, build: (r) => M.chicken(r), radius: 0.35 },
};
export const TYPE_IDS = Object.keys(TYPES) as TypeId[];

const modelCache = new Map<TypeId, Vox[][]>();
export function modelsFor(t: TypeId): Vox[][] {
  let m = modelCache.get(t);
  if (!m) {
    const T = TYPES[t];
    const r = mulberry32(1234 + t.length * 97);
    m = [];
    for (let i = 0; i < T.variants; i++) m.push(T.build(r, i));
    modelCache.set(t, m);
  }
  return m;
}

export type Behavior = 'cross' | 'loiter' | 'drive' | 'land' | 'march' | 'drop' | 'stand';

let NEXT_ID = 1;
export class Target {
  id = NEXT_ID++;
  mesh: THREE.Group;
  vox: Vox[];
  alive = true;
  x = 0; y = 0; z = 0; ry = 0;
  vy = 0;
  gx = 0; gz = 0; // goal
  speed: number;
  phase = Math.random() * 10;
  t = 0;
  deadAt = 0;
  airborne = false;
  scared = 0;
  constructor(public type: TType, variant: number, public behavior: Behavior) {
    this.vox = modelsFor(type.id)[variant % type.variants];
    this.mesh = modelGroup(this.vox, type.s, 0.06);
    this.speed = type.speed * (0.8 + Math.random() * 0.4);
  }
  dispose() { disposeGroup(this.mesh); }
}

export const BIOME_SPAWNS: Record<Biome, [TypeId, number][]> = {
  farm: [['cow', 5], ['sheep', 2.2], ['chicken', 2], ['person', 1.5], ['duck', 0.5], ['trex', 0.25], ['clown', 0.3], ['piano', 0.25]],
  town: [['person', 5], ['band', 1.2], ['clown', 1], ['piano', 0.7], ['car', 1.3], ['robot', 0.4], ['duck', 0.4]],
  forest: [['person', 1.5], ['cow', 1.5], ['trex', 0.9], ['duck', 0.5], ['sheep', 1], ['clown', 0.3]],
  desert: [['alien', 2.5], ['trex', 1.2], ['robot', 1.4], ['ufo', 0.6], ['person', 1]],
  snow: [['snowman', 4], ['sheep', 2], ['person', 1], ['robot', 0.5], ['duck', 0.4]],
  alien: [['alien', 5], ['ufo', 1.6], ['robot', 1.2], ['trex', 0.3]],
};
