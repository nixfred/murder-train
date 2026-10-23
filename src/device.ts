// Device detection + per-device performance budget. Desktop values are the original ones.
const q = new URLSearchParams(location.search);
const mm = (s: string) => typeof matchMedia === 'function' && matchMedia(s).matches;

/** touch-first device (phones, tablets). ?touch forces it on, ?desktop forces it off. */
export const IS_TOUCH = q.has('touch') || (!q.has('desktop') && (mm('(pointer: coarse)') || ('ontouchstart' in window && !mm('(hover: hover) and (pointer: fine)'))));
export const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const PERF = IS_TOUCH
  ? { dpr: Math.min(window.devicePixelRatio || 1, 1.25), antialias: false, radius: 95, shadowMap: 1024, debris: 5000, blood: 7000, glow: 1200, decals: 5000, debrisShadows: false, streamMs: 3, dprLow: 0.9, radiusLow: 85, radiusMin: 72, shadowLow: 512, smoke: 220 }
  : { dpr: Math.min(window.devicePixelRatio || 1, 1.5), antialias: true, radius: 150, shadowMap: 2048, debris: 14000, blood: 20000, glow: 3500, decals: 16000, debrisShadows: true, streamMs: 4, dprLow: 1, radiusLow: 125, radiusMin: 105, shadowLow: 1024, smoke: 360 };

if (IS_TOUCH) document.documentElement.classList.add('touch');
