// DOM HUD: stat cards, kill board, drop palette, popups, replay banner.
import { Vox } from './voxels';
import { TYPES, TYPE_IDS, TypeId, modelsFor } from './targets';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function shade(hex: number, k: number) {
  const r = Math.min(255, ((hex >> 16) & 255) * k), g = Math.min(255, ((hex >> 8) & 255) * k), b = Math.min(255, (hex & 255) * k);
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

/** isometric 2D render of a voxel model into a canvas: zero assets, even for icons */
export function thumbnail(vox: Vox[], px = 48): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d')!;
  const C = 0.866, S = 0.5;
  const P = (x: number, y: number, z: number) => [(x - z) * C, (x + z) * S - y];
  let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
  for (const v of vox) for (const [dx, dy, dz] of [[0, 0, 0], [1, 1, 1], [1, 0, 0], [0, 0, 1], [0, 1, 0], [1, 1, 0], [0, 1, 1], [1, 0, 1]]) {
    const [X, Y] = P(v.x + dx, v.y + dy, v.z + dz);
    mnx = Math.min(mnx, X); mxx = Math.max(mxx, X); mny = Math.min(mny, Y); mxy = Math.max(mxy, Y);
  }
  const k = (px - 4) / Math.max(mxx - mnx, mxy - mny);
  const ox = (px - (mxx - mnx) * k) / 2 - mnx * k, oy = (px - (mxy - mny) * k) / 2 - mny * k;
  const sorted = [...vox].sort((a, b) => a.x + a.y + a.z - (b.x + b.y + b.z));
  const poly = (pts: number[][], fill: string) => {
    g.beginPath();
    pts.forEach(([x, y, z], i) => { const [X, Y] = P(x, y, z); const sx = X * k + ox, sy = Y * k + oy; if (i) g.lineTo(sx, sy); else g.moveTo(sx, sy); });
    g.closePath(); g.fillStyle = fill; g.fill();
  };
  for (const v of sorted) {
    const { x, y, z } = v;
    poly([[x, y + 1, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]], shade(v.c, 1.12));
    poly([[x, y, z + 1], [x + 1, y, z + 1], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]], shade(v.c, 0.86));
    poly([[x + 1, y, z], [x + 1, y, z + 1], [x + 1, y + 1, z + 1], [x + 1, y + 1, z]], shade(v.c, 0.66));
  }
  return c;
}

const thumbCache = new Map<TypeId, HTMLCanvasElement>();
function thumbFor(t: TypeId) {
  let c = thumbCache.get(t);
  if (!c) { c = thumbnail(modelsFor(t)[0], 48); thumbCache.set(t, c); }
  const copy = document.createElement('canvas');
  copy.width = copy.height = 48;
  copy.getContext('2d')!.drawImage(c, 0, 0);
  return copy;
}

export class HUD {
  selected: TypeId = 'cow';
  onSelect: (t: TypeId) => void = () => {};
  private lastKills = '';

  constructor() {
    const chips = $('chips');
    TYPE_IDS.forEach((t, i) => {
      const b = document.createElement('button');
      b.className = 'chip' + (t === this.selected ? ' sel' : '');
      b.dataset.t = t;
      b.appendChild(thumbFor(t));
      const s = document.createElement('span'); s.textContent = TYPES[t].name; b.appendChild(s);
      if (i < 9) { const k = document.createElement('kbd'); k.textContent = String(i + 1); b.appendChild(k); }
      b.onclick = (e) => { e.stopPropagation(); this.select(t); };
      chips.appendChild(b);
    });
    for (const id of ['thr', 'cars']) this.fill($(id) as HTMLInputElement);
  }

  select(t: TypeId) {
    this.selected = t;
    document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('sel', (c as HTMLElement).dataset.t === t));
    $('hint-text').textContent = `Click the terrain to drop a ${TYPES[t].name}. Drag to orbit, scroll to zoom.`;
    this.onSelect(t);
  }

  fill(inp: HTMLInputElement) {
    const p = ((+inp.value - +inp.min) / (+inp.max - +inp.min)) * 100;
    inp.style.setProperty('--p', p + '%');
  }

  stats(o: { mph: number; score: number; combo: number; kills: number; miles: number; top: number; vox: number; biome: string; fps: number }) {
    $('st-mph').textContent = o.mph.toFixed(1);
    $('st-score').textContent = Math.floor(o.score).toLocaleString('en-US');
    $('st-combo').textContent = 'x' + o.combo;
    $('st-kills').textContent = String(o.kills);
    $('st-dist').textContent = o.miles.toFixed(2) + ' mi';
    $('st-top').textContent = o.top.toFixed(1);
    $('st-vox').textContent = o.vox.toLocaleString('en-US');
    $('sub-vox').textContent = o.vox.toLocaleString('en-US');
    $('st-biome').textContent = o.biome;
    $('fps').textContent = o.fps.toFixed(0) + ' fps';
  }

  killboard(kills: Partial<Record<TypeId, number>>, bumped?: TypeId) {
    const key = JSON.stringify(kills);
    if (key === this.lastKills && !bumped) return;
    this.lastKills = key;
    const ul = $('kb-list');
    ul.innerHTML = '';
    const entries = (Object.entries(kills) as [TypeId, number][]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    if (!entries.length) { ul.innerHTML = '<li class="empty">Nothing flattened yet.</li>'; return; }
    for (const [t, n] of entries.slice(0, 9)) {
      const li = document.createElement('li');
      if (t === bumped) li.className = 'bump';
      li.appendChild(thumbFor(t));
      const s = document.createElement('span'); s.textContent = TYPES[t].name; li.appendChild(s);
      const c = document.createElement('span'); c.className = 'n'; c.textContent = String(n); li.appendChild(c);
      ul.appendChild(li);
    }
  }

  popup(x: number, y: number, text: string, sub: string, green = false) {
    const d = document.createElement('div');
    d.className = 'popup' + (green ? ' green' : '');
    d.style.left = x + 'px'; d.style.top = y + 'px';
    d.innerHTML = `${text}<small>${sub}</small>`;
    $('popups').appendChild(d);
    setTimeout(() => d.remove(), 1400);
  }

  combo(text: string, sub: string) {
    const el = $('combo');
    el.innerHTML = `${text}<small>${sub}</small>`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  replay(on: boolean, cap = '') {
    document.body.classList.toggle('replaying', on);
    $('replay-cap').textContent = cap;
  }
}
