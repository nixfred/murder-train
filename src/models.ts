// Every model in the game, built voxel by voxel. No assets, ever.
import { MB, Vox } from './voxels';
import { RNG, hash3, pick } from './rng';

const BLACK = 0x15151a;
const SKINS = [0xf1c9a5, 0xe0ac7e, 0xc68c5a, 0x8d5a3b, 0x5c3a24, 0xffd9c0];
const HAIRS = [0x2b1a10, 0x5a3418, 0xd8b45a, 0x1a1a1a, 0xa0401c, 0xe8e0d0];
const SHIRTS = [0xd94141, 0x3f7fd9, 0x45b36b, 0xf2c94c, 0x9b59d0, 0xf27f3d, 0xffffff, 0x2bb3b3, 0xf06292];
const PANTS = [0x2f3d5c, 0x3a3a3a, 0x6b4f2d, 0x24324f, 0x5c5c66];
export const CAR_COLORS = [0xd63a3a, 0x2f6fd6, 0xf2c230, 0x3fb36a, 0xf0f0f0, 0x2b2b30, 0xf2873a, 0x7d4fd0];

// ---------------------------------------------------------------- humanoids
interface HumanOpts { shirt: number; pants: number; skin: number; hair: number; shoes?: number; }
function humanoid(b: MB, o: HumanOpts) {
  const shoes = o.shoes ?? 0x2a2420;
  b.box(-2, 0, -1, -1, 4, 0, o.pants).box(0, 0, -1, 1, 4, 0, o.pants);
  b.box(-2, 0, -1, -1, 0, 1, shoes).box(0, 0, -1, 1, 0, 1, shoes);
  b.box(-2, 5, -1, 1, 8, 0, o.shirt);
  b.box(-3, 5, -1, -3, 8, 0, o.shirt).box(2, 5, -1, 2, 8, 0, o.shirt);
  b.set(-3, 4, -1, o.skin).set(2, 4, -1, o.skin);
  b.box(-2, 9, -1, 1, 12, 1, o.skin);
  b.box(-2, 12, -1, 1, 12, 1, o.hair).box(-2, 10, -1, 1, 11, -1, o.hair);
  b.set(-2, 11, 1, BLACK).set(1, 11, 1, BLACK);
  b.set(-1, 10, 1, 0xd9826e).set(0, 10, 1, 0xd9826e);
}

export function person(r: RNG): Vox[] {
  const b = new MB();
  humanoid(b, { shirt: pick(r, SHIRTS), pants: pick(r, PANTS), skin: pick(r, SKINS), hair: pick(r, HAIRS) });
  if (r() < 0.3) b.box(-2, 13, -1, 1, 13, 1, pick(r, SHIRTS)).box(-2, 13, 2, 1, 13, 2, pick(r, SHIRTS)); // cap
  return b.list();
}

export function clown(r: RNG): Vox[] {
  const b = new MB();
  const suit = (x: number, y: number, z: number) => (hash3(x >> 1, y >> 1, z, 77) > 0.7 ? pick(r, [0xffe14a, 0x4ad2ff, 0x6bff6b]) : (x < 0 ? 0xe23b8a : 0x3b6be2));
  humanoid(b, { shirt: 0, pants: 0, skin: 0xffffff, hair: 0xff3030, shoes: 0xe02020 });
  b.box(-3, 0, -1, -1, 8, 0, suit).box(0, 0, -1, 2, 8, 0, suit);
  b.box(-3, 0, -1, -1, 0, 3, 0xe02020).box(0, 0, -1, 2, 0, 3, 0xe02020);
  b.box(-3, 8, -2, 2, 8, 1, 0xffffff); // ruff
  b.box(-2, 9, -1, 1, 12, 1, 0xffffff);
  b.set(-1, 10, 2, 0xff1a1a).set(0, 10, 2, 0xff1a1a);
  b.set(-2, 11, 1, 0x2040ff).set(1, 11, 1, 0x2040ff);
  const rainbow = [0xff3030, 0xff9a1a, 0xffe14a, 0x4ad25a, 0x3b8bff, 0xa64dff];
  b.ell(-3, 11.5, 0, 1.8, 2, 2, (x, y) => rainbow[(y + 6) % 6]);
  b.ell(3, 11.5, 0, 1.8, 2, 2, (x, y) => rainbow[(y + 3) % 6]);
  b.box(-1, 13, -1, 0, 14, 0, 0x30d040).set(-1, 15, -1, 0xffe14a);
  return b.list();
}

export function bandMember(r: RNG, idx: number): Vox[] {
  const b = new MB();
  humanoid(b, { shirt: 0xc8202a, pants: 0x1c2340, skin: pick(r, SKINS), hair: pick(r, HAIRS), shoes: 0x111111 });
  b.set(-1, 7, 1, 0xffd23a).set(0, 6, 1, 0xffd23a).set(-1, 5, 1, 0xffd23a);
  b.box(-2, 13, -1, 1, 15, 1, 0x1c2340).box(-2, 13, 1, 1, 13, 1, 0xffd23a);
  b.box(-1, 16, 0, 0, 17, 0, 0xffffff);
  const GOLD = 0xe8b82a;
  const kind = idx % 3;
  if (kind === 0) { // tuba
    b.cylY(-3.5, 0, 1.6, 6, 9, GOLD); b.cylY(-3.5, 0, 2.6, 10, 12, GOLD);
  } else if (kind === 1) { // drum
    for (let x = -3; x <= 2; x++) for (let y = 4; y <= 8; y++) {
      const dx = x + 0.5, dy = y - 5.5;
      if (dx * dx + dy * dy <= 7) b.box(x, y, 1, x, y, 2, x === -3 || x === 2 ? 0xc8202a : 0xffffff);
    }
  } else { // trumpet
    b.box(0, 10, 2, 0, 10, 5, GOLD).box(-1, 9, 6, 1, 11, 6, GOLD);
  }
  return b.list();
}

export function robot(r: RNG): Vox[] {
  const b = new MB();
  const ST = 0x8d98a6, DK = 0x4a525e;
  b.box(-3, 0, -1, -2, 4, 0, DK).box(1, 0, -1, 2, 4, 0, DK);
  b.box(-3, 5, -2, 2, 10, 1, ST);
  b.set(-2, 8, 2, 0xff3b3b, true).set(-1, 8, 2, 0x3bff6b, true).set(0, 8, 2, 0x3b8bff, true).set(1, 8, 2, 0xffe14a, true);
  b.box(-2, 6, 2, 1, 6, 2, DK);
  b.box(-4, 6, -1, -4, 10, 0, DK).box(3, 6, -1, 3, 10, 0, DK);
  b.box(-4, 5, 0, -4, 5, 1, ST).box(3, 5, 0, 3, 5, 1, ST);
  b.box(-2, 11, -1, 1, 14, 1, ST);
  b.set(-2, 13, 2, 0x5ff2ff, true).set(1, 13, 2, 0x5ff2ff, true).box(-1, 12, 2, 0, 12, 2, DK);
  b.set(0, 15, 0, DK).set(0, 16, 0, 0xff3030, true);
  return b.list();
}

export function alien(r: RNG): Vox[] {
  const b = new MB();
  const G = r() < 0.5 ? 0x7be05a : 0x5ad6a8;
  b.box(-2, 0, 0, -1, 2, 0, G).box(0, 0, 0, 1, 2, 0, G);
  b.box(-2, 3, -1, 1, 6, 0, G);
  b.box(-3, 4, -1, -3, 6, -1, G).box(2, 4, -1, 2, 6, -1, G);
  b.ell(0, 10, 0, 3.6, 3, 3, G);
  b.box(-3, 10, 2, -1, 11, 2, BLACK).box(0, 10, 2, 2, 11, 2, BLACK);
  b.box(-3, 10, 3, -1, 11, 3, BLACK).box(0, 10, 3, 2, 11, 3, BLACK);
  b.set(0, 13, 0, G).set(0, 14, 0, G).set(0, 15, 0, 0xc6ff4a, true);
  return b.list();
}

export function cow(r: RNG): Vox[] {
  const b = new MB();
  const seed = Math.floor(r() * 1000);
  const W = 0xf2efe6;
  const spot = (x: number, y: number, z: number) => (hash3(x >> 1, y >> 1, z >> 1, seed) > 0.6 ? 0x1c1c1c : W);
  for (const [lx, lz] of [[-3, -4], [1, -4], [-3, 3], [1, 3]]) {
    b.box(lx, 0, lz, lx + 1, 0, lz + 1, 0x2a2420).box(lx, 1, lz, lx + 1, 2, lz + 1, W);
  }
  b.box(-3, 3, -5, 2, 6, 4, spot);
  b.box(-1, 2, 0, 0, 2, 1, 0xf0a0a8);
  b.box(-2, 5, 5, 1, 8, 7, W);
  b.box(-2, 5, 8, 1, 6, 8, 0xe8a0a0);
  b.set(-2, 7, 8, BLACK).set(1, 7, 8, BLACK);
  b.set(-3, 8, 6, spot(0, 0, 0)).set(2, 8, 6, 0x1c1c1c);
  b.set(-2, 9, 6, 0xe8e0c8).set(1, 9, 6, 0xe8e0c8);
  b.box(0, 4, -6, 0, 6, -6, W).set(0, 3, -6, BLACK);
  return b.list();
}

export function sheep(r: RNG): Vox[] {
  const b = new MB();
  const seed = Math.floor(r() * 1000);
  const wool = (x: number, y: number, z: number) => (hash3(x, y, z, seed) > 0.5 ? 0xf7f4ea : 0xe6e1d2);
  for (const [lx, lz] of [[-2, -3], [1, -3], [-2, 2], [1, 2]]) b.box(lx, 0, lz, lx, 2, lz, 0x222222);
  b.ell(0, 5, 0, 3.2, 2.7, 4.2, wool);
  b.box(-1, 5, 4, 0, 7, 6, 0x2a2a2a);
  b.set(-2, 7, 4, 0x2a2a2a).set(1, 7, 4, 0x2a2a2a);
  b.set(-1, 7, 6, 0xffffff).set(0, 7, 6, 0xffffff);
  b.box(-1, 8, 4, 0, 8, 5, wool);
  return b.list();
}

export function chicken(r: RNG): Vox[] {
  const b = new MB();
  b.box(-1, 0, 0, -1, 2, 0, 0xf2b630).box(0, 0, 0, 0, 2, 0, 0xf2b630);
  b.ell(0, 4.5, 0, 2.4, 2.2, 3, 0xfbfbf5);
  b.box(-1, 6, 2, 0, 8, 3, 0xfbfbf5);
  b.box(-1, 9, 2, 0, 9, 3, 0xe02020).set(0, 6, 3, 0xe02020);
  b.box(-1, 7, 4, 0, 7, 4, 0xf2b630);
  b.set(-2, 8, 3, BLACK).set(1, 8, 3, BLACK);
  b.box(-1, 5, -4, 0, 7, -3, 0xfbfbf5);
  return b.list();
}

export function snowman(r: RNG): Vox[] {
  const b = new MB();
  const S = 0xf6f8fc;
  b.ell(0, 3, 0, 3.4, 3, 3.4, S).ell(0, 8, 0, 2.6, 2.3, 2.6, S).ell(0, 11.8, 0, 1.9, 1.8, 1.9, S);
  b.set(-1, 12, 1, BLACK).set(0, 12, 1, BLACK);
  b.box(0, 11, 2, 0, 11, 3, 0xff7a1a);
  b.set(0, 9, 2, BLACK).set(0, 7, 2, BLACK);
  b.box(-6, 9, 0, -3, 9, 0, 0x6b4426).set(-6, 10, 0, 0x6b4426).box(3, 9, 0, 5, 9, 0, 0x6b4426).set(5, 10, 0, 0x6b4426);
  b.box(-2, 13, -2, 1, 13, 1, BLACK).box(-1, 14, -1, 0, 16, 0, BLACK).box(-1, 14, -1, 0, 14, 0, 0xd02020);
  b.box(-2, 10, -1, 1, 10, 1, r() < 0.5 ? 0xd02020 : 0x2060d0);
  return b.list();
}

export function car(r: RNG): Vox[] {
  const b = new MB();
  const body = pick(r, CAR_COLORS);
  const glass = 0x9cc8e6;
  b.box(-3, 1, -8, 2, 3, 7, body);
  b.box(-3, 4, -4, 2, 5, 3, (x, y, z) => (z === -4 || z === 3 || x === -3 || x === 2 ? (z === 0 ? body : glass) : body));
  b.box(-3, 6, -4, 2, 6, 3, body);
  for (const x of [-3, 2]) for (const z of [-6, 4]) b.box(x, 0, z, x, 1, z + 1, 0x111111);
  b.set(-3, 2, 8, 0xfff2b0, true).set(2, 2, 8, 0xfff2b0, true);
  b.set(-3, 2, -9, 0xff2a2a, true).set(2, 2, -9, 0xff2a2a, true);
  b.box(-2, 1, 8, 1, 1, 8, 0x888888).box(-2, 1, -9, 1, 1, -9, 0x888888);
  return b.list();
}

export function duck(): Vox[] {
  const b = new MB();
  const Y = 0xffd21f;
  b.ell(0, 3, -0.5, 3.6, 2.6, 4.6, Y);
  b.ell(0, 6.8, 2.2, 2.4, 2.3, 2.3, Y);
  b.box(-1, 5, 4, 0, 6, 6, 0xff8a1c);
  b.set(-3, 7, 3, BLACK).set(2, 7, 3, BLACK);
  b.box(-1, 4, -6, 0, 5, -5, Y).set(-1, 6, -6, Y).set(0, 6, -6, Y);
  b.ell(-3, 3.5, -0.5, 0.9, 1.4, 2.6, 0xf5c010).ell(3, 3.5, -0.5, 0.9, 1.4, 2.6, 0xf5c010);
  return b.list();
}

export function trex(): Vox[] {
  const b = new MB();
  const col = (x: number, y: number, z: number) => (y < 8 ? 0x9cc06a : y > 11 && (z & 3) === 0 ? 0x335c24 : 0x4f8f3a);
  b.ell(0, 9.5, 0, 3.6, 3.6, 5.5, col);
  for (let i = 0; i < 6; i++) b.ell(0, 9 - i * 0.5, -5 - i * 1.8, 2.6 - i * 0.38, 2.4 - i * 0.33, 1.6, col);
  b.ell(0, 12.5, 4.5, 2, 2.4, 2.4, col);
  b.ell(0, 14.5, 7.5, 2.4, 2.2, 3.6, 0x4f8f3a);
  b.box(-2, 12, 7, 1, 12, 10, 0x8f3030);
  b.box(-2, 11, 6, 1, 11, 10, 0x4f8f3a);
  for (let z = 7; z <= 10; z++) { b.set(-2, 12, z, 0xffffff).set(1, 12, z, 0xffffff); }
  b.set(-3, 15, 8, 0xffd23a).set(2, 15, 8, 0xffd23a);
  b.set(-3, 9, 4, 0x4f8f3a).set(-3, 8, 5, 0x4f8f3a).set(2, 9, 4, 0x4f8f3a).set(2, 8, 5, 0x4f8f3a);
  for (const sx of [-1, 1]) {
    const x = sx < 0 ? -3 : 2;
    b.ell(x + 0.5, 7, 0, 1.6, 2.6, 2.2, col);
    b.box(x, 1, -1, x, 4, 0, 0x4f8f3a);
    b.box(x, 0, -1, x, 0, 2, 0x335c24);
  }
  return b.list();
}

export function ufo(): Vox[] {
  const b = new MB();
  b.ell(0, 3, 0, 7.5, 1.4, 7.5, (x, y, z) => (y < 3 ? 0x7f8796 : 0xc4ccd8));
  b.ell(0, 4.6, 0, 3.4, 2.6, 3.4, 0x7fe6ff, true);
  const L = [0xff3b6b, 0xffe14a, 0x6bff8a, 0x5ab4ff];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    b.set(Math.round(Math.cos(a) * 7.2 - 0.5), 3, Math.round(Math.sin(a) * 7.2 - 0.5), L[i % 4], true);
  }
  for (const a of [0, 2.1, 4.2]) b.box(Math.round(Math.cos(a) * 4), 0, Math.round(Math.sin(a) * 4), Math.round(Math.cos(a) * 4), 2, Math.round(Math.sin(a) * 4), 0x555b66);
  b.ell(0, 1.6, 0, 2, 0.6, 2, 0xb6ff5a, true);
  return b.list();
}

export function piano(): Vox[] {
  const b = new MB();
  const BK = 0x16161a;
  for (let x = -6; x <= 5; x++) for (let z = -9; z <= 5; z++) {
    if (z < -2) { const t = (x + 6) / 11; if (t > 1 - (z + 9) / 9) continue; }
    b.box(x, 4, z, x, 6, z, BK);
  }
  for (let x = -6; x <= 5; x++) { b.set(x, 5, 6, 0xf6f2e8); if ([0, 1, 3, 4, 5].includes((x + 7) % 7)) b.set(x, 6, 6, BK); }
  b.box(-6, 4, 6, 5, 4, 7, BK);
  for (const [x, z] of [[-6, 4], [5, 4], [-5, -6]]) b.box(x, 0, z, x, 3, z, BK);
  for (let z = -9; z <= 4; z++) for (let x = -6; x <= 5; x++) {
    if (z < -2) { const t = (x + 6) / 11; if (t > 1 - (z + 9) / 9) continue; }
    if (x > -1) b.set(x, 7 + Math.floor((x + 1) * 0.9), z, BK);
  }
  b.box(-1, 2, 2, 0, 2, 3, 0xd9a830);
  return b.list();
}

// ---------------------------------------------------------------- train
const T_BLACK = 0x1f2026, T_RED = 0xb3262a, T_GOLD = 0xd9a830, T_DK = 0x2b2c32;

function bogies(b: MB, zs: number[]) {
  for (const z of zs) for (const x of [-4, 3]) {
    b.discX(x, 1.5, z + 0.5, 1.6, (xx, y, zz) => ((y + 0.5 - 1.5) ** 2 + (zz - z) ** 2 < 0.8 ? 0xb0b0b0 : 0x222226));
  }
  b.box(-3, 1, zs[0] - 1, 2, 1, zs[zs.length - 1] + 1, T_DK);
}

export function locomotive(cab = 0x2f5d3a): Vox[] {
  const b = new MB();
  for (const z of [-3, 2, 7]) for (const x of [-5, 4]) {
    b.discX(x, 2.5, z + 0.5, 2.6, (xx, y, zz) => {
      const d = (y + 0.5 - 2.5) ** 2 + (zz + 0.5 - (z + 0.5)) ** 2;
      return d > 4.4 ? 0x1a1a1e : d < 0.8 ? T_GOLD : T_RED;
    });
  }
  b.box(-5, 1, -2, -5, 1, 8, 0xa0a0a8).box(4, 1, -2, 4, 1, 8, 0xa0a0a8);
  for (const z of [10, 12]) for (const x of [-4, 3]) b.discX(x, 1.3, z + 0.5, 1.4, 0x1a1a1e);
  b.box(-4, 2, -14, 3, 3, 13, T_DK);
  b.box(-5, 5, -6, 4, 5, 12, (x) => (x === -5 || x === 4 ? T_GOLD : T_DK));
  b.cylZ(0, 8.5, 3.6, -6, 12, (x, y, z) => (z === -2 || z === 4 || z === 10 ? T_GOLD : T_BLACK));
  for (let x = -4; x <= 3; x++) for (let y = 5; y <= 12; y++) {
    const dx = x + 0.5, dy = y + 0.5 - 8.5;
    if (dx * dx + dy * dy <= 12) b.set(x, y, 13, dx * dx + dy * dy < 2 ? 0x3a3a40 : 0x2c2d33);
  }
  b.box(-1, 10, 14, 0, 11, 14, 0xfff4c0, true);
  b.box(-2, 12, 13, 1, 12, 14, T_DK);
  b.cylY(0, 10.5, 1.5, 12, 15, T_BLACK);
  b.cylY(0, 10.5, 2.2, 16, 16, T_BLACK);
  b.cylY(0, 5.5, 1.6, 12, 13, T_GOLD);
  b.cylY(0, 1.5, 1.3, 12, 13, T_GOLD);
  b.box(-5, 4, -14, 4, 12, -7, (x, y, z) => (y >= 8 && y <= 10 && (x === -5 || x === 4) && z >= -12 && z <= -9 ? 0xffd27a : y === 4 ? T_GOLD : cab));
  b.box(-6, 13, -15, 5, 13, -6, 0x2a2d33).box(-5, 14, -14, 4, 14, -7, 0x2a2d33);
  for (let z = 14; z <= 17; z++) {
    const k = z - 14;
    b.box(-4 + k, 0, z, 3 - k, 3 - Math.floor(k * 0.7), z, (x) => ((x + z) & 1 ? T_RED : 0x8a1c1f));
  }
  b.set(0, 12, 6, T_GOLD).set(-1, 12, 6, T_GOLD);
  return b.list();
}

export function tender(): Vox[] {
  const b = new MB();
  bogies(b, [-5, -2, 2, 5]);
  b.box(-5, 2, -8, 4, 9, 8, (x, y) => (y === 9 ? T_GOLD : y === 2 ? T_DK : 0x2f5d3a));
  for (let x = -4; x <= 3; x++) for (let z = -7; z <= 7; z++) if (hash3(x, 0, z, 3) > 0.35) b.set(x, 10, z, hash3(x, 1, z, 4) > 0.5 ? 0x1a1a1a : 0x333338);
  return b.list();
}

export type CarKind = 'box' | 'passenger' | 'tanker' | 'hopper' | 'caboose' | 'flat';
export const CAR_KINDS: CarKind[] = ['box', 'passenger', 'tanker', 'hopper', 'flat', 'box', 'passenger', 'hopper', 'tanker'];

export function railcar(kind: CarKind, r: RNG): Vox[] {
  const b = new MB();
  bogies(b, [-9, -6, 6, 9]);
  b.box(-4, 2, -12, 3, 2, 11, T_DK);
  if (kind === 'box') {
    const c = pick(r, [0x8e3b2a, 0x6b3a26, 0x2f5d8a, 0xa85a20]);
    b.box(-5, 3, -11, 4, 12, 10, (x, y, z) => ((z + 11) % 4 === 0 ? 0x3a2a22 : (z >= -2 && z <= 1 && y < 11 ? 0x5a2a1e : c)));
    b.box(-5, 13, -11, 4, 13, 10, 0x55555c).box(-1, 14, -11, 0, 14, 10, 0x3a3a40);
  } else if (kind === 'passenger') {
    const c = pick(r, [0x2f5d3a, 0x7a2028, 0x23406b]);
    b.box(-5, 3, -11, 4, 12, 10, (x, y, z) => (y >= 8 && y <= 10 && (x === -5 || x === 4) && ((z + 11) % 4) < 2 ? 0xffd27a : y === 7 ? T_GOLD : c));
    b.box(-5, 13, -11, 4, 13, 10, 0x2a2d33).box(-4, 14, -11, 3, 14, 10, 0x2a2d33);
  } else if (kind === 'tanker') {
    const c = pick(r, [0xc0c4cc, 0x1c1c20, 0xe8e8e8]);
    b.cylZ(-0.5, 8, 4.2, -11, 10, (x, y, z) => ((z + 11) % 7 === 0 ? 0x55555c : c));
    b.cylY(-0.5, 0, 1.5, 12, 13, 0x55555c);
  } else if (kind === 'hopper') {
    b.box(-5, 3, -11, 4, 10, 10, (x, y, z) => ((z + 11) % 5 === 0 ? 0x5a5a60 : 0x7d7d84));
    for (let x = -4; x <= 3; x++) for (let z = -10; z <= 9; z++) b.set(x, 11 + (hash3(x, 0, z, 8) > 0.6 ? 1 : 0), z, hash3(x, 2, z, 1) > 0.5 ? 0x2a1d14 : 0x3d2a1c);
  } else if (kind === 'caboose') {
    b.box(-5, 3, -9, 4, 11, 8, (x, y, z) => (y >= 7 && y <= 9 && (x === -5 || x === 4) && Math.abs(z) % 5 < 2 ? 0xffd27a : 0xb3262a));
    b.box(-6, 12, -10, 5, 12, 9, 0x2a2d33).box(-3, 13, -3, 2, 15, 2, 0xb3262a).box(-4, 16, -4, 3, 16, 3, 0x2a2d33);
  } else {
    b.box(-5, 3, -11, 4, 3, 10, 0x6b4426);
    for (const x of [-3, 1]) b.cylZ(x + 0.5, 5.5, 1.8, -10, 9, (xx, y, z) => (z === -10 || z === 9 ? 0xc89a62 : 0x5a3a1e));
    b.cylZ(-1, 8.5, 1.8, -9, 8, (xx, y, z) => (z === -9 || z === 8 ? 0xc89a62 : 0x6b4426));
  }
  return b.list();
}

// ---------------------------------------------------------------- props (world, voxel size 0.5)
export function house(r: RNG, town = true): Vox[] {
  const b = new MB();
  const w = 5 + Math.floor(r() * 3), d = 4 + Math.floor(r() * 3), h = 6 + Math.floor(r() * 3);
  const wall = pick(r, [0xefe2c4, 0xd9c49a, 0x9db8d9, 0xf2f2ee, 0xc9b28f, 0xe8c9a0, 0xb8c9a8]);
  const roof = pick(r, [0x7a3e22, 0x8e2f24, 0x5a3420, 0x6b2a20, 0x3d4a5c]);
  const roofDk = roof - 0x101010 > 0 ? roof - 0x0e0a08 : roof;
  b.box(-w, 0, -d, w - 1, h - 1, d - 1, (x, y, z) => {
    const edgeX = x === -w || x === w - 1, edgeZ = z === -d || z === d - 1;
    if (y === 0) return 0x6b6258;
    if (edgeZ && !edgeX && y >= 2 && y <= 3 && ((x + w) % 3 === 1)) return z === d - 1 && x === 0 ? 0x5a3420 : 0xffd27a;
    if (edgeX && !edgeZ && y >= 2 && y <= 3 && ((z + d) % 3 === 1)) return 0xffd27a;
    if (edgeZ && !edgeX && y >= h - 3 && y <= h - 2 && ((x + w) % 3 === 1) && h > 6) return 0xffd27a;
    if (z === d - 1 && x === 0 && y <= 2) return 0x5a3420;
    return wall;
  });
  // windows glow
  for (const v of b.m.values()) if (v.c === 0xffd27a) v.g = true;
  // gable roof along x
  for (let k = 0; k <= d + 1; k++) {
    const y = h + k;
    const z0 = -d - 1 + k, z1 = d - k;
    if (z0 > z1) break;
    b.box(-w - 1, y, z0, w, y, z0, k % 2 ? roof : roofDk).box(-w - 1, y, z1, w, y, z1, k % 2 ? roof : roofDk);
    if (z1 - z0 > 1) for (const x of [-w, w - 1]) b.box(x, y, z0 + 1, x, y, z1 - 1, wall);
  }
  const cx = Math.floor(w * 0.5);
  b.box(cx, h, -1, cx + 1, h + d + 2, 0, 0x8a4a3a);
  return b.list();
}

export function barn(r: RNG): Vox[] {
  const b = new MB();
  const R = 0xa8322a, W = 0xf2efe6;
  b.box(-6, 0, -8, 5, 7, 7, (x, y, z) => {
    if ((z === 7 || z === -8) && (x === -6 || x === 5 || y === 7)) return W;
    if (z === 7 && x >= -2 && x <= 1 && y <= 5) return (x + y) % 3 === 0 ? W : 0x7a2420;
    return R;
  });
  for (let k = 0; k < 7; k++) {
    const inset = k < 3 ? k : 2 + (k - 2) * 2;
    if (inset > 6) break;
    b.box(-7 + inset, 8 + k, -9, 6 - inset, 8 + k, 8, (x, y, z) => (z === -9 || z === 8 ? (Math.abs(x + 0.5) > 5.5 - inset - 1 ? 0x3d3d44 : R) : 0x3d3d44));
  }
  return b.list();
}

export function silo(): Vox[] {
  const b = new MB();
  b.cylY(0, 0, 3.2, 0, 16, (x, y) => (y % 4 === 0 ? 0x8f9aa6 : 0xb5bec8));
  b.ell(0, 17, 0, 3.2, 2.4, 3.2, 0x7a8590);
  return b.list();
}

export function appleTree(r: RNG, apples = true): Vox[] {
  const b = new MB();
  const th = 3 + Math.floor(r() * 3);
  b.box(-1, 0, -1, 0, th, 0, 0x6b4426);
  const rr = 3.4 + r() * 1.6;
  const greens = [0x3f8f3a, 0x4ea23f, 0x2f7a33, 0x5cb347];
  const seed = Math.floor(r() * 999);
  b.ell(0, th + rr, 0, rr, rr * 0.95, rr, (x, y, z) => greens[Math.floor(hash3(x, y, z, seed) * 4)]);
  if (r() < 0.5) b.ell(rr * 0.6, th + rr * 0.7, -rr * 0.3, rr * 0.6, rr * 0.6, rr * 0.6, (x, y, z) => greens[Math.floor(hash3(x, y, z, seed + 1) * 4)]);
  const out = b.list();
  if (apples) for (const v of out) if (v.y > th && hash3(v.x, v.y, v.z, seed + 7) > 0.92) v.c = 0xd81f26;
  return out;
}

export function pine(r: RNG, snow: boolean): Vox[] {
  const b = new MB();
  b.box(-1, 0, -1, 0, 2, 0, 0x5a3a22);
  const layers = 3 + Math.floor(r() * 2);
  let y = 2;
  for (let i = 0; i < layers; i++) {
    const rad = 4.2 - i * 0.9;
    for (let k = 0; k < 3; k++) {
      const rk = rad - k * 1.1;
      if (rk < 0.6) break;
      b.cylY(0, 0, rk, y, y, (x, yy, z) => (snow && k === 2 - 0 && hash3(x, yy, z, 1) > 0.3 ? 0xf2f6fa : snow && hash3(x, yy, z, 2) > 0.75 ? 0xe8eef4 : (hash3(x, yy, z, 3) > 0.5 ? 0x1f5a32 : 0x2a6e3c)));
      y++;
    }
  }
  b.box(-1, y, -1, 0, y + 1, 0, snow ? 0xf2f6fa : 0x2a6e3c);
  return b.list();
}

export function cactus(r: RNG): Vox[] {
  const b = new MB();
  const G = (x: number, y: number, z: number) => ((x + z + y) % 3 === 0 ? 0x2f7a3a : 0x3f9a48);
  const h = 6 + Math.floor(r() * 5);
  b.box(-1, 0, -1, 0, h, 0, G);
  const a1 = 2 + Math.floor(r() * 3);
  b.box(1, a1, -1, 2, a1, 0, G).box(2, a1, -1, 2, a1 + 3, 0, G);
  if (r() < 0.7) { const a2 = 3 + Math.floor(r() * 3); b.box(-3, a2, -1, -2, a2, 0, G).box(-3, a2, -1, -3, a2 + 2, 0, G); }
  if (r() < 0.4) b.set(0, h + 1, 0, 0xff5aa0);
  return b.list();
}

export function rock(r: RNG, snowCap = false, tint = 0x8a8a90): Vox[] {
  const b = new MB();
  const seed = Math.floor(r() * 999);
  const rx = 1.8 + r() * 2.2, ry = 1.4 + r() * 2.2, rz = 1.8 + r() * 2;
  const cols = [tint, tint - 0x101010, tint + 0x0a0a0a, tint - 0x1a1a1a];
  b.ell(0, ry * 0.6, 0, rx, ry, rz, (x, y, z) => (snowCap && y >= ry * 0.9 ? 0xf4f7fb : cols[Math.floor(hash3(x, y, z, seed) * 4)]));
  return b.list().filter((v) => v.y >= 0);
}

export function haystack(): Vox[] {
  const b = new MB();
  b.cylZ(0, 2, 2.2, -2, 1, (x, y, z) => (z === -2 || z === 1 ? 0xd9b04a : (x + y) % 2 ? 0xe8c25a : 0xd4a83e));
  return b.list().filter((v) => v.y >= 0);
}

export function crossbuck(): Vox[] {
  const b = new MB();
  b.box(0, 0, 0, 0, 9, 0, 0xd8d8dc);
  for (let i = -3; i <= 3; i++) { b.set(i, 10 + i, 0, 0xf4f4f4); b.set(i, 10 - i, 0, 0xf4f4f4); }
  b.box(-1, 7, 1, -1, 7, 1, 0xff2020, true).box(1, 7, 1, 1, 7, 1, 0xff2020, true).box(-1, 7, 0, 1, 7, 0, 0x222226);
  return b.list();
}

export function lamp(): Vox[] {
  const b = new MB();
  b.box(0, 0, 0, 0, 8, 0, 0x2a2a30).box(0, 8, 1, 0, 8, 2, 0x2a2a30).box(0, 7, 2, 0, 7, 2, 0xfff0b0, true);
  return b.list();
}

export function crystal(r: RNG): Vox[] {
  const b = new MB();
  const c = pick(r, [0x6bff8a, 0xff5ae0, 0x5ae0ff]);
  const n = 2 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const x = Math.floor((r() - 0.5) * 4), z = Math.floor((r() - 0.5) * 4), h = 3 + Math.floor(r() * 6);
    for (let y = 0; y < h; y++) { const lean = Math.floor(y * (i % 2 ? 0.3 : -0.3)); b.box(x + lean, y, z, x + lean + (y < h - 2 ? 1 : 0), y, z + (y < h - 2 ? 1 : 0), c, true); }
  }
  return b.list();
}

export function crashedSaucer(): Vox[] {
  const b = new MB();
  for (let x = -12; x <= 11; x++) for (let z = -12; z <= 11; z++) {
    const d = Math.sqrt((x + 0.5) ** 2 + (z + 0.5) ** 2);
    if (d > 12) continue;
    const tilt = Math.round((x + 0.5) * 0.35);
    const th = d < 5 ? 3 : d < 9 ? 2 : 1;
    for (let k = 0; k < th; k++) b.set(x, tilt + k + 1, z, d > 11 ? (Math.floor(Math.atan2(z, x) * 4) % 2 ? 0xff3b6b : 0xffe14a) : k === th - 1 ? 0xb8c0cc : 0x6d7584, d > 11);
  }
  b.ell(1, 6, 0, 4, 3, 4, 0x7fe6ff, true);
  for (const v of b.m.values()) if (v.y < 0) b.m.delete(0);
  return b.list().filter((v) => v.y >= 0);
}

export function waterTower(): Vox[] {
  const b = new MB();
  for (const [x, z] of [[-3, -3], [2, -3], [-3, 2], [2, 2]]) b.box(x, 0, z, x, 10, z, 0x5a3a22);
  b.cylY(-0.5, -0.5, 4, 11, 16, (x, y) => (y % 2 ? 0x7a4a2a : 0x6b3e22));
  b.cylY(-0.5, -0.5, 3, 17, 17, 0x3d4a5c).cylY(-0.5, -0.5, 1.8, 18, 18, 0x3d4a5c);
  return b.list();
}

export function skull(): Vox[] {
  const b = new MB();
  b.box(-2, 0, -2, 1, 2, 1, 0xf2ecd8).set(-2, 1, 1, BLACK).set(1, 1, 1, BLACK).box(-6, 0, 0, -3, 0, 0, 0xf2ecd8).box(3, 0, -3, 5, 0, -3, 0xf2ecd8);
  return b.list();
}

export function cloud(r: RNG): Vox[] {
  const b = new MB();
  const n = 3 + Math.floor(r() * 4);
  for (let i = 0; i < n; i++) b.ell((r() - 0.5) * 14, (r() - 0.3) * 2, (r() - 0.5) * 8, 3 + r() * 3, 1.5 + r() * 1.5, 2.5 + r() * 2, (x, y) => (y < -1 ? 0xe4e8f0 : 0xffffff));
  return b.list();
}
