// Touch controls overlay for phones and tablets. Only built when IS_TOUCH is true.
// Throttle slider + brake on the left thumb, horn / camera / drop / spawn menu on the right thumb,
// small utility row (replay, mute, music, night, fullscreen) along the top edge.
import { IS_IOS } from './device';

export interface TouchHost {
  getThrottle(): number;
  setThrottle(v: number): void;
  brake(on: boolean): void;
  horn(): void;
  cycleCam(): string;
  replay(): void;
  canReplay(): boolean;
  inReplay(): boolean;
  toggleMute(): boolean;
  toggleMusic(): boolean;
  toggleNight(): boolean;
  dropAhead(): void;
  selectedName(): string;
  unlockAudio(): void;
}

const SVG = {
  horn: '<svg viewBox="0 0 16 16"><path d="M2 6.5h5l5-3v9l-5-3H2zM4 9.5l1 3h2l-1-3" /></svg>',
  brake: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" /><path d="M5 8h6" /></svg>',
  cam: '<svg viewBox="0 0 16 16"><rect x="2" y="4.5" width="12" height="8.5" rx="1.5" /><circle cx="8" cy="8.7" r="2.3" /><path d="M5.5 4.5l1-2h3l1 2" /></svg>',
  drop: '<svg viewBox="0 0 16 16"><path d="M8 2v9M4.5 7.5L8 11l3.5-3.5M3 14h10" /></svg>',
  menu: '<svg viewBox="0 0 16 16"><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></svg>',
  replay: '<svg viewBox="0 0 16 16"><path d="M3 8a5 5 0 1 0 1.5-3.5M3 2.5v2.5h2.5" /><path d="M7 6l3 2-3 2z" /></svg>',
  mute: '<svg viewBox="0 0 16 16"><path d="M2 6h3l4-3v10l-4-3H2z" /><path class="w" d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.8a6 6 0 0 1 0 8.4" /><path class="x" d="M11 6l4 4M15 6l-4 4" /></svg>',
  music: '<svg viewBox="0 0 16 16"><path d="M6 12V3.5l7-1.5V10" /><circle cx="4.5" cy="12" r="1.8" /><circle cx="11.5" cy="10" r="1.8" /><path class="x" d="M2 2l12 12" /></svg>',
  night: '<svg viewBox="0 0 16 16"><path d="M12.5 10.5A5.5 5.5 0 0 1 5.5 3.5a5.5 5.5 0 1 0 7 7z" /></svg>',
  fs: '<svg viewBox="0 0 16 16"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" /></svg>',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, html = '', parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  e.innerHTML = html;
  parent?.appendChild(e);
  return e;
}

/** tap button: fires on pointerdown for zero latency, swallows the synthetic click */
function tap(b: HTMLElement, fn: () => void) {
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); b.classList.add('down'); fn(); });
  const up = () => b.classList.remove('down');
  b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
  b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
  // cancelling touchstart suppresses the compat click, so it can't land on whatever opens under the finger
  b.addEventListener('touchstart', (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
}

export function initTouch(h: TouchHost) {
  const root = el('div', '', '', document.body);
  root.id = 'touchui';

  // ---------------- left thumb: throttle + brake
  const left = el('div', 'tc-left', '', root);
  const thr = el('div', 'tc-thr', '<div class="tc-thr-fill"></div><div class="tc-thr-knob"></div><span class="tc-thr-lbl">THROTTLE</span><span class="tc-thr-num">0.0</span>', left);
  thr.setAttribute('aria-label', 'throttle');
  const fill = thr.querySelector<HTMLElement>('.tc-thr-fill')!, knob = thr.querySelector<HTMLElement>('.tc-thr-knob')!, num = thr.querySelector<HTMLElement>('.tc-thr-num')!;
  let dragging = -1;
  const setFrom = (clientY: number) => {
    const r = thr.getBoundingClientRect();
    const k = 1 - (clientY - r.top - 14) / Math.max(1, r.height - 28);
    h.setThrottle(Math.round(Math.max(0, Math.min(1, k)) * 100) / 10);
  };
  thr.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); dragging = e.pointerId; thr.setPointerCapture(e.pointerId); thr.classList.add('down'); setFrom(e.clientY); });
  thr.addEventListener('pointermove', (e) => { if (e.pointerId === dragging) { e.preventDefault(); setFrom(e.clientY); } });
  const endDrag = (e: PointerEvent) => { if (e.pointerId === dragging) { dragging = -1; thr.classList.remove('down'); } };
  thr.addEventListener('pointerup', endDrag); thr.addEventListener('pointercancel', endDrag);

  const brake = el('button', 'tc-btn tc-brake', SVG.brake + '<span>BRAKE</span>', left);
  brake.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); brake.setPointerCapture(e.pointerId); brake.classList.add('down'); h.brake(true); });
  const brakeUp = () => { brake.classList.remove('down'); h.brake(false); };
  brake.addEventListener('pointerup', brakeUp); brake.addEventListener('pointercancel', brakeUp); brake.addEventListener('lostpointercapture', brakeUp);
  brake.addEventListener('click', (e) => e.preventDefault());

  // ---------------- right thumb: horn, camera, drop, spawn menu
  const right = el('div', 'tc-right', '', root);
  const horn = el('button', 'tc-btn tc-horn', SVG.horn + '<span>HORN</span>', right);
  const cam = el('button', 'tc-btn tc-cam', SVG.cam + '<span>ORBIT</span>', right);
  const drop = el('button', 'tc-btn tc-drop', SVG.drop + '<span>DROP</span>', right);
  const menu = el('button', 'tc-btn tc-menu', SVG.menu + '<span>SPAWN</span>', right);
  tap(horn, () => h.horn());
  tap(cam, () => { cam.querySelector('span')!.textContent = h.cycleCam().toUpperCase(); });
  tap(drop, () => h.dropAhead());

  // ---------------- top utility row
  const top = el('div', 'tc-top', '', root);
  const rp = el('button', 'tc-sm tc-replay', SVG.replay + '<span>REPLAY</span>', top);
  const mute = el('button', 'tc-sm', SVG.mute, top); mute.setAttribute('aria-label', 'mute');
  const mus = el('button', 'tc-sm', SVG.music, top); mus.setAttribute('aria-label', 'music');
  const night = el('button', 'tc-sm', SVG.night, top); night.setAttribute('aria-label', 'night');
  tap(rp, () => h.replay());
  tap(mute, () => mute.classList.toggle('muted', h.toggleMute()));
  tap(mus, () => mus.classList.toggle('muted', h.toggleMusic()));
  tap(night, () => night.classList.toggle('on', h.toggleNight()));
  const de = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
  const canFS = !IS_IOS && !!(de.requestFullscreen || de.webkitRequestFullscreen) && document.fullscreenEnabled !== false;
  if (canFS) {
    const fs = el('button', 'tc-sm', SVG.fs, top); fs.setAttribute('aria-label', 'fullscreen');
    tap(fs, () => {
      if (document.fullscreenElement) { document.exitFullscreen?.().catch(() => {}); return; }
      const p = de.requestFullscreen ? de.requestFullscreen({ navigationUI: 'hide' }) : de.webkitRequestFullscreen!();
      Promise.resolve(p).then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })?.lock?.('landscape')).catch(() => {});
    });
  }

  // ---------------- spawn menu: re-uses the desktop drop palette as a bottom sheet
  const palette = document.getElementById('palette')!;
  const h3span = palette.querySelector('h3 span');
  if (h3span) h3span.textContent = 'pick, then tap the ground or DROP';
  const closeBtn = el('button', 'tc-close', 'Close', palette);
  let menuAt = 0;
  const setMenu = (on: boolean) => { document.body.classList.toggle('spawnmenu', on); menu.classList.toggle('on', on); if (on) menuAt = performance.now(); };
  tap(menu, () => setMenu(!document.body.classList.contains('spawnmenu')));
  tap(closeBtn, () => setMenu(false));
  document.getElementById('chips')!.addEventListener('click', (e) => {
    // ignore a stray click that arrives right after the sheet opened under the finger
    if (performance.now() - menuAt < 400) { e.stopPropagation(); e.preventDefault(); return; }
    setTimeout(() => { setMenu(false); toast(`${h.selectedName()} armed. Tap the ground or hit DROP.`); }, 0);
  }, true);
  palette.addEventListener('pointerdown', (e) => e.stopPropagation());

  // ---------------- replay skip: the "press R" line becomes a button
  const skip = document.querySelector<HTMLElement>('#replay .skip');
  if (skip) { skip.textContent = 'Tap to skip'; skip.classList.add('tc-skip'); tap(skip, () => h.replay()); }

  // ---------------- toast + rotate tip
  const toastEl = el('div', 'tc-toast', '', document.body);
  let toastT = 0;
  function toast(msg: string, ms = 2200) {
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastT); toastT = window.setTimeout(() => toastEl.classList.remove('show'), ms);
  }
  let rotateShown = false;

  // ---------------- per-frame sync (cheap: only touches the DOM when values change)
  let lastThr = -1, lastRp = '';
  function sync() {
    const t = h.getThrottle();
    if (t !== lastThr) {
      lastThr = t;
      const p = (t / 10) * 100;
      fill.style.height = p + '%';
      knob.style.bottom = `calc(${p / 100} * (100% - 28px))`;
      num.textContent = t.toFixed(1);
    }
    const st = h.inReplay() ? 'skip' : h.canReplay() ? 'ready' : 'off';
    if (st !== lastRp) {
      lastRp = st;
      rp.classList.toggle('ready', st !== 'off');
      rp.querySelector('span')!.textContent = st === 'skip' ? 'SKIP' : 'REPLAY';
    }
    if (!rotateShown && !document.body.classList.contains('intro') && window.innerHeight > window.innerWidth) {
      rotateShown = true; toast('Tip: rotate to landscape for a wider view', 3200);
    }
  }
  return { sync, toast };
}

/** global guards: no pinch zoom, no double tap zoom, no long-press callouts, audio unlock on first gesture */
export function installTouchGuards(unlock: () => void) {
  const prevent = (e: Event) => e.preventDefault();
  document.addEventListener('gesturestart', prevent, { passive: false });
  document.addEventListener('gesturechange', prevent, { passive: false });
  document.addEventListener('dblclick', prevent, { passive: false });
  document.addEventListener('contextmenu', prevent);
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1 || !(e.target as HTMLElement)?.closest?.('#palette')) e.preventDefault(); }, { passive: false });
  // iOS only lets AudioContext.resume() succeed inside touchend / click, so listen on all of them
  for (const ev of ['touchend', 'pointerup', 'click', 'keydown']) document.addEventListener(ev, unlock, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) unlock(); });
}
