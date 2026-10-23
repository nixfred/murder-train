import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import './style.css';
import { Track } from './track';
import { World, Biome } from './world';
import { Train } from './train';
import { Gore } from './gore';
import { Synth } from './audio';
import { HUD } from './ui';
import { Target, TYPES, TypeId, TYPE_IDS, BIOME_SPAWNS, Behavior } from './targets';
import { BOX, lin, modelGroup } from './voxels';
import { mulberry32, clamp, lerp } from './rng';
import * as M from './models';
import { Intro, BloodFX } from './intro';
import { IS_TOUCH, PERF } from './device';
import { initTouch, installTouchGuards } from './touch';

const params = new URLSearchParams(location.search);
const SEED = +(params.get('seed') ?? 7);
const RADIUS = +(params.get('radius') ?? PERF.radius);
const AUTOSTART = params.has('autostart');
const SKIP_INTRO = AUTOSTART || params.has('skipintro');
const MANUAL = params.has('manual');
if (params.has('clean')) document.body.classList.add('clean'); // headless tests drive frames explicitly
const MPH = 2.6; // world units/s -> scale mph
const SLOWMO = 0.3;

type CamMode = 'orbit' | 'standing' | 'chase';
interface Frame { t: number; s: number; speed: number; ids: number[]; d: Float32Array; }
interface HitEvent { t: number; id: number; x: number; y: number; z: number; ry: number; dx: number; dz: number; speed: number; seed: number; type: TypeId; int?: number; }

class Smoke {
  mesh: THREE.InstancedMesh;
  n = PERF.smoke; next = 0;
  pos = new Float32Array(this.n * 3); vel = new Float32Array(this.n * 3); life = new Float32Array(this.n); size = new Float32Array(this.n); rot = new Float32Array(this.n);
  mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.72, depthWrite: false });
  constructor() {
    this.mesh = new THREE.InstancedMesh(BOX, this.mat, this.n);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.n * 3).fill(1), 3);
    (this.mesh.instanceMatrix.array as Float32Array).fill(0);
    this.mesh.frustumCulled = false;
  }
  emit(x: number, y: number, z: number, vx: number, vz: number) {
    const i = this.next; this.next = (this.next + 1) % this.n;
    this.pos.set([x + (Math.random() - 0.5) * 0.3, y, z + (Math.random() - 0.5) * 0.3], i * 3);
    this.vel.set([vx + (Math.random() - 0.5) * 0.8, 3.4 + Math.random() * 2, vz + (Math.random() - 0.5) * 0.8], i * 3);
    this.life[i] = 2.6 + Math.random();
    this.size[i] = 0.45 + Math.random() * 0.3;
    this.rot[i] = Math.random() * 3;
    const g = 0.82 + Math.random() * 0.18;
    const c = this.mesh.instanceColor!.array as Float32Array;
    c[i * 3] = g; c[i * 3 + 1] = g; c[i * 3 + 2] = g;
    this.mesh.instanceColor!.needsUpdate = true;
  }
  update(dt: number) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const a = this.mesh.instanceMatrix.array as Float32Array;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { if (a[i * 16 + 15]) a.fill(0, i * 16, i * 16 + 16); continue; }
      this.life[i] -= dt;
      const o = i * 3;
      this.vel[o + 1] *= 1 - dt * 0.35; this.vel[o] *= 1 - dt * 0.8; this.vel[o + 2] *= 1 - dt * 0.8;
      this.pos[o] += this.vel[o] * dt; this.pos[o + 1] += this.vel[o + 1] * dt; this.pos[o + 2] += this.vel[o + 2] * dt;
      this.size[i] += dt * 0.7;
      const k = Math.min(1, this.life[i] / 0.8);
      const sc = this.size[i] * k;
      this.rot[i] += dt * 0.6;
      q.setFromAxisAngle(up, this.rot[i]);
      m.compose(p.set(this.pos[o], this.pos[o + 1], this.pos[o + 2]), q, s.set(sc, sc, sc));
      m.toArray(a, i * 16);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  sky: THREE.Mesh;
  skyU = { top: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, bot: { value: new THREE.Color() } };
  track = new Track(SEED);
  world: World;
  train: Train;
  gore: Gore;
  smoke = new Smoke();
  synth = new Synth();
  hud = new HUD();
  targets: Target[] = [];
  graveyard: Target[] = [];
  byId = new Map<number, Target>();
  clouds: THREE.Group[] = [];
  rng = mulberry32(SEED * 31 + 5);

  time = 0;
  score = 0; combo = 1; lastKill = -99; maxCombo = 1; totalKills = 0;
  kills: Partial<Record<TypeId, number>> = {};
  recentKills: number[] = [];
  shake = 0;
  screenBlood: BloodFX | null = null; screenBloodT = 0; trainBlood = 0; trainBloodHex = 0xa0000a;
  camMode: CamMode = 'orbit';
  night = false; nightK = 0;
  keys = new Set<string>();
  spawnAcc = 0; nextGap = 10;
  chuffAcc = 0; smokeAcc = 0; bellT = 0;
  standCam = new THREE.Vector3(); standS = -1e9;
  lastLoco = new THREE.Vector3();
  started = false;
  fpsT = 0; fpsN = 0; fps = 60; hudT = 0;

  frames: Frame[] = [];
  events: HitEvent[] = [];
  pendingReplay: { at: number; ev: HitEvent; cap: string } | null = null;
  replay: null | { rt: number; t0: number; t1: number; ev: HitEvent; snap: ReturnType<Gore['snapshot']>; fired: Set<HitEvent>; mode: number; side: number; ang: number; cap: string } = null;
  replayCooldown = 0;
  replays = 0;
  intro: Intro | null = null;
  vw = 0; vh = 0; onResize = () => {};
  touch: ReturnType<typeof initTouch> | null = null;

  constructor() {
    const canvas = document.getElementById('c') as HTMLCanvasElement;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: PERF.antialias, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(PERF.dpr);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 900);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 90;

    this.scene.fog = new THREE.Fog(0xf0d2a8, 70, RADIUS + 25);
    this.hemi = new THREE.HemisphereLight(0xcfe2ff, 0x5a4a36, 1.0);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffe2b8, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(PERF.shadowMap, PERF.shadowMap);
    const sc = this.sun.shadow.camera;
    sc.left = -55; sc.right = 55; sc.top = 55; sc.bottom = -55; sc.near = 1; sc.far = 260;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);

    const skyMat = new THREE.ShaderMaterial({
      uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(mid, top, pow(clamp(h*1.6,0.0,1.0), 0.7)) : mix(mid, bot, clamp(-h*4.0,0.0,1.0)); gl_FragColor = vec4(c,1.0); }',
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(600, 24, 16), skyMat);
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);

    this.world = new World(this.track, SEED);
    this.scene.add(this.world.group);
    this.track.extendTo(1000);
    this.train = new Train(this.track, 5);
    this.scene.add(this.train.group);
    this.gore = new Gore((x, z) => this.world.heightAt(x, z));
    this.gore.isTrack = (x, z) => this.track.nearest(x, z, 2.5).dist < 1.5;
    this.scene.add(this.gore.group, this.smoke.mesh);

    const cr = mulberry32(99);
    for (let i = 0; i < 14; i++) {
      const g = modelGroup(M.cloud(cr), 1.6, 0.04, false);
      g.position.set((cr() - 0.5) * 500, 70 + cr() * 40, -cr() * 500 + 100);
      this.clouds.push(g); this.scene.add(g);
    }

    this.train.place(this.train.s);
    const L = this.train.loco.position;
    this.lastLoco.copy(L);
    this.setCam('orbit');
    this.controls.update();
    this.applyLighting(0);
    this.bindUI();
    const resize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      if (w === this.vw && h === this.vh) return;
      this.vw = w; this.vh = h;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    };
    this.onResize = resize;
    window.addEventListener('resize', resize);
    // mobile browsers report the new size a beat after the rotation, so re-measure a few times
    const settle = () => { resize(); setTimeout(resize, 120); setTimeout(resize, 400); setTimeout(resize, 900); };
    window.addEventListener('orientationchange', settle);
    window.visualViewport?.addEventListener('resize', settle);
    document.addEventListener('fullscreenchange', settle);
  }

  // ------------------------------------------------------------ setup
  bindUI() {
    const thr = document.getElementById('thr') as HTMLInputElement;
    const cars = document.getElementById('cars') as HTMLInputElement;
    thr.oninput = () => { this.train.throttle = +thr.value; this.syncThrottle(); };
    cars.oninput = () => { this.train.setCars(+cars.value); document.getElementById('st-cars')!.textContent = String(this.train.cars.length); this.hud.fill(cars); document.getElementById('cars-val')!.textContent = cars.value; };
    document.getElementById('dn')!.onclick = () => this.toggleNight();
    document.querySelectorAll<HTMLButtonElement>('.cam').forEach((b) => (b.onclick = () => this.setCam(b.dataset.cam as CamMode)));
    const wh = document.getElementById('whistle')!;
    wh.onclick = () => { this.synth.unlock(); this.whistle(); };
    const br = document.getElementById('brake')!;
    br.onpointerdown = () => { this.train.braking = true; br.classList.add('active'); };
    const up = () => { this.train.braking = false; br.classList.remove('active'); };
    br.onpointerup = up; br.onpointerleave = up;
    const mu = document.getElementById('mute')!;
    mu.onclick = () => this.toggleMute();
    const mus = document.getElementById('mus') as HTMLInputElement;
    mus.oninput = () => { this.synth.setMusicVolume(+mus.value / 100); this.hud.fill(mus); document.getElementById('mus-val')!.textContent = mus.value; };
    this.hud.fill(mus);
    const mb = document.getElementById('musbtn')!;
    mb.onclick = () => { this.synth.unlock(); this.synth.setMusicMuted(!this.synth.musicMuted); mb.classList.toggle('muted', this.synth.musicMuted); };

    window.addEventListener('keydown', (e) => {
      if (e.repeat && e.code !== 'KeyW' && e.code !== 'KeyS') return;
      this.synth.unlock();
      if (this.intro?.active) { if (this.intro.key(e.code)) { e.preventDefault(); return; } }
      this.keys.add(e.code);
      if (!this.started && (e.code === 'Enter' || e.code === 'Space')) { this.start(); e.preventDefault(); return; }
      switch (e.code) {
        case 'Space': this.whistle(); e.preventDefault(); break;
        case 'KeyC': { const m: CamMode[] = ['orbit', 'standing', 'chase']; this.setCam(m[(m.indexOf(this.camMode) + 1) % 3]); break; }
        case 'KeyR': if (this.replay) this.endReplay(); break;
        case 'KeyN': this.toggleNight(); break;
        case 'KeyM': this.toggleMute(); break;
        case 'KeyU': document.getElementById('musbtn')!.click(); break;
        case 'KeyB': this.train.braking = true; break;
      }
      const d = parseInt(e.key);
      if (d >= 1 && d <= 9) this.hud.select(TYPE_IDS[d - 1]);
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); if (e.code === 'KeyB' || e.code === 'KeyS') this.train.braking = false; });

    const canvas = this.renderer.domElement;
    let down: { x: number; y: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; this.synth.unlock(); });
    canvas.addEventListener('pointerup', (e) => {
      if (this.intro?.active) { this.intro.click(); down = null; return; }
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < (IS_TOUCH ? 12 : 6) && this.started && !this.replay) this.clickDrop(e.clientX, e.clientY);
      down = null;
    });
    if (IS_TOUCH) this.bindTouch();
  }

  bindTouch() {
    installTouchGuards(() => this.synth.unlock());
    const cams: CamMode[] = ['orbit', 'standing', 'chase'];
    this.touch = initTouch({
      getThrottle: () => this.train.throttle,
      setThrottle: (v) => { this.train.throttle = clamp(v, 0, 10); this.syncThrottle(); if (!this.started && !this.intro) this.start(); },
      brake: (on) => { this.train.braking = on; },
      horn: () => { this.synth.unlock(); if (!this.started && !this.intro) { this.start(); return; } this.whistle(); },
      cycleCam: () => { this.setCam(cams[(cams.indexOf(this.camMode) + 1) % 3]); return this.camMode; },
      replay: () => this.replayButton(),
      canReplay: () => this.events.length > 0 && !this.pendingReplay,
      inReplay: () => !!this.replay,
      toggleMute: () => { this.toggleMute(); return this.synth.muted; },
      toggleMusic: () => { document.getElementById('musbtn')!.click(); return this.synth.musicMuted; },
      toggleNight: () => { this.toggleNight(); return this.night; },
      dropAhead: () => this.dropAhead(),
      selectedName: () => TYPES[this.hud.selected].name,
      unlockAudio: () => this.synth.unlock(),
    });
  }

  /** R / REPLAY button: skip a running replay, or replay the most recent kill on demand */
  replayButton() {
    if (this.replay) { this.endReplay(); return; }
    if (this.intro || this.pendingReplay || !this.events.length || !this.frames.length) return;
    const ev = this.events[this.events.length - 1];
    this.pendingReplay = { at: this.time, ev, cap: `${TYPES[ev.type].name.toUpperCase()} · ${Math.round(ev.speed * MPH)} MPH` };
  }

  /** drop the selected thing onto the line ahead of the train (easier than aiming a tap at speed) */
  dropAhead() {
    if (!this.started || this.replay || this.intro) return;
    const tp = this.track.at(this.train.s + 28 + this.train.speed * 1.6);
    const lat = (this.rng() - 0.5) * 6;
    this.dropAt(this.hud.selected, tp.x - tp.dz * lat, tp.z + tp.dx * lat);
  }

  syncThrottle() {
    const thr = document.getElementById('thr') as HTMLInputElement;
    thr.value = String(this.train.throttle);
    this.hud.fill(thr);
    document.getElementById('thr-val')!.textContent = this.train.throttle.toFixed(1);
  }

  start(gesture = true) {
    if (this.started) return;
    this.started = true;
    if (gesture) this.synth.unlock();
    this.hud.select(this.hud.selected);
    if (this.train.throttle < 4) { this.train.throttle = 4; this.syncThrottle(); }
    this.whistle();
  }

  setCam(m: CamMode) {
    this.camMode = m;
    document.querySelectorAll<HTMLButtonElement>('.cam').forEach((b) => b.classList.toggle('active', b.dataset.cam === m));
    this.controls.enabled = m === 'orbit';
    this.standS = -1e9;
    if (m === 'orbit') {
      const L = this.train.loco.position, d = this.trainDir();
      this.camera.position.set(L.x - d.z * 22 - d.x * 12, L.y + 19, L.z + d.x * 22 - d.z * 12);
      this.controls.target.copy(L);
    }
  }

  toggleNight() { this.night = !this.night; document.getElementById('dn')!.classList.toggle('on', this.night); }
  toggleMute() { this.synth.setMuted(!this.synth.muted); document.getElementById('mute')!.classList.toggle('muted', this.synth.muted); }

  applyLighting(k: number) {
    const c = (a: number, b: number) => new THREE.Color(a).lerp(new THREE.Color(b), k);
    this.skyU.top.value.copy(c(0x4f86d0, 0x050816));
    this.skyU.mid.value.copy(c(0xf6d2a2, 0x1a2240));
    this.skyU.bot.value.copy(c(0xd9b88a, 0x0d1020));
    (this.scene.fog as THREE.Fog).color.copy(c(0xefcfa2, 0x151b33));
    this.sun.color.copy(c(0xffdcb0, 0x8fa8ff));
    this.sun.intensity = lerp(2.7, 0.9, k);
    this.hemi.color.copy(c(0xcfe2ff, 0x5a6ab0));
    this.hemi.groundColor.copy(c(0x5a4a36, 0x10121c));
    this.hemi.intensity = lerp(1.05, 0.75, k);
    this.train.headlight.intensity = k * 60;
    this.smoke.mat.color.copy(c(0xffffff, 0x8890a8));
    this.renderer.toneMappingExposure = lerp(1.05, 1.25, k);
  }

  trainDir() { const s = this.train.segments[0]; return s ? new THREE.Vector3(s.dx, 0, s.dz) : new THREE.Vector3(0, 0, -1); }

  spawnOnTrack(type: TypeId, ahead: number, lat: number, beh: Behavior = 'stand'): number {
    const tp = this.track.at(this.train.s + ahead);
    const t = this.addTarget(type, tp.x - tp.dz * lat, tp.z + tp.dx * lat, beh);
    t.ry = Math.atan2(-tp.dz, tp.dx) * (lat > 0 ? 1 : -1);
    return t.id;
  }

  // ------------------------------------------------------------ spawning
  addTarget(type: TypeId, x: number, z: number, beh: Behavior, variant = Math.floor(this.rng() * 99)): Target {
    const t = new Target(TYPES[type], variant, beh);
    t.x = x; t.z = z; t.y = this.world.heightAt(x, z);
    t.gx = x; t.gz = z;
    this.targets.push(t);
    this.byId.set(t.id, t);
    this.scene.add(t.mesh);
    this.syncMesh(t);
    return t;
  }

  pickType(b: Biome): TypeId {
    const list = BIOME_SPAWNS[b];
    const tot = list.reduce((a, [, w]) => a + w, 0);
    let r = this.rng() * tot;
    for (const [t, w] of list) { r -= w; if (r <= 0) return t; }
    return list[0][0];
  }

  spawnEvent(forced?: TypeId, ahead?: number) {
    if (this.targets.length > 70 && !forced) return;
    const r = this.rng;
    const sA = this.train.s + (ahead ?? 75 + r() * 70);
    const tp = this.track.at(sA);
    const biome = this.world.biomeAt(tp.x, tp.z);
    let type = forced ?? this.pickType(biome);
    const nx = -tp.dz, nz = tp.dx; // lateral
    const eta = (sA - this.train.s) / Math.max(this.train.speed, 6);
    const P = (lat: number, along = 0) => ({ x: tp.x + nx * lat + tp.dx * along, z: tp.z + nz * lat + tp.dz * along });
    if (type === 'car') {
      const c = this.track.crossings.find((c) => c.s > this.train.s + 50 && c.s < this.train.s + 280);
      if (!c) type = 'person';
      else {
        const side = r() < 0.5 ? -1 : 1;
        const sp = TYPES.car.speed;
        const etaC = (c.s - this.train.s) / Math.max(this.train.speed, 6);
        const L = clamp(sp * etaC * (0.85 + r() * 0.3), 15, 65);
        const t = this.addTarget('car', c.x - c.dx * L * side, c.z - c.dz * L * side, 'drive');
        t.gx = c.x + c.dx * 70 * side; t.gz = c.z + c.dz * 70 * side;
        return;
      }
    }
    if (type === 'band') {
      const n = 6 + Math.floor(r() * 4);
      for (let i = 0; i < n; i++) {
        const p = P(((i % 3) - 1) * 0.75, Math.floor(i / 3) * -1.3);
        const t = this.addTarget('band', p.x, p.z, 'march', i);
        t.gx = sA - Math.floor(i / 3) * 1.3; t.gz = ((i % 3) - 1) * 0.75; // track-relative coords for march
      }
      return;
    }
    if (type === 'sheep' || (type === 'cow' && r() < 0.4) || type === 'chicken') {
      const n = type === 'sheep' ? 8 + Math.floor(r() * 8) : 2 + Math.floor(r() * 4);
      const side = r() < 0.5 ? -1 : 1;
      const dist = type === 'sheep' ? clamp(TYPES.sheep.speed * eta * 0.8, 12, 28) : 6 + r() * 8;
      for (let i = 0; i < n; i++) {
        const p = P(side * (dist + r() * 4), (r() - 0.5) * 8);
        const t = this.addTarget(type, p.x, p.z, type === 'sheep' ? 'cross' : (r() < 0.5 ? 'cross' : 'loiter'));
        const g = P(-side * (10 + r() * 8), (r() - 0.5) * 8);
        t.gx = g.x; t.gz = g.z;
        t.t = -r() * 0.6;
      }
      return;
    }
    if (type === 'ufo') { const t = this.addTarget('ufo', tp.x, tp.z, 'land'); t.y = 45; return; }
    if (type === 'piano') { const p = P((r() - 0.5) * 1.2); const t = this.addTarget('piano', p.x, p.z, 'drop'); t.y = 30 + r() * 10; t.airborne = true; t.ry = r() * 6; return; }
    if (type === 'snowman') { const p = P((r() - 0.5) * 6); const t = this.addTarget('snowman', p.x, p.z, 'stand'); t.ry = Math.atan2(-tp.dx, -tp.dz); return; }
    // generic walker
    const side = r() < 0.5 ? -1 : 1;
    if (r() < 0.6) {
      const sp = TYPES[type].speed;
      const dist = clamp(sp * eta * (0.7 + r() * 0.5), 4, 24);
      const p = P(side * dist);
      const t = this.addTarget(type, p.x, p.z, 'cross');
      const g = P(-side * (5 + r() * 8), (r() - 0.5) * 4);
      t.gx = g.x; t.gz = g.z;
    } else {
      const p = P((r() - 0.5) * 4);
      this.addTarget(type, p.x, p.z, 'loiter');
    }
  }

  clickDrop(cx: number, cy: number) {
    const ndc = new THREE.Vector2((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    let hit: THREE.Vector3 | null = null;
    for (let t = 0.5; t < 320; t += 0.4) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (y <= this.world.heightAt(x, z)) { hit = new THREE.Vector3(x, y, z); break; }
    }
    if (hit) this.dropAt(this.hud.selected, hit.x, hit.z);
  }

  dropAt(type: TypeId, x: number, z: number) {
    if (type === 'car' || type === 'band') {
      const near = this.track.nearest(x, z, 60);
      const tp = this.track.at(near.s);
      if (type === 'band') {
        for (let i = 0; i < 8; i++) { const t = this.addTarget('band', x, z, 'march', i); t.gx = near.s - Math.floor(i / 3) * 1.3; t.gz = ((i % 3) - 1) * 0.75; t.y = 14 + i; t.airborne = true; }
      } else {
        const t = this.addTarget('car', x, z, 'drive');
        const dx = tp.x - x, dz = tp.z - z, l = Math.hypot(dx, dz) || 1;
        t.gx = x + (dx / l) * (l + 40); t.gz = z + (dz / l) * (l + 40);
        t.y = 14; t.airborne = true;
      }
      return;
    }
    const beh: Behavior = type === 'ufo' ? 'land' : type === 'piano' || type === 'snowman' ? 'drop' : 'cross';
    const t = this.addTarget(type, x, z, beh);
    t.y = type === 'ufo' ? 40 : 16; t.airborne = type !== 'ufo';
    if (beh === 'cross') {
      const near = this.track.nearest(x, z, 80);
      const tp = this.track.at(near.s);
      t.gx = tp.x; t.gz = tp.z;
      t.behavior = 'cross';
      (t as Target & { stayOnTrack?: boolean }).stayOnTrack = true;
    }
  }

  // ------------------------------------------------------------ behaviors
  updateTargets(dt: number) {
    const L = this.train.loco.position;
    const dir = this.trainDir();
    for (let i = this.targets.length - 1; i >= 0; i--) {
      const t = this.targets[i];
      t.t += dt;
      t.phase += dt * (3 + t.speed * 2.2);
      let moving = false;
      const ground = this.world.heightAt(t.x, t.z) + (Math.abs(this.track.nearest(t.x, t.z, 2).dist) < 1.4 ? 0.2 : 0);
      if (t.airborne) {
        t.vy -= 30 * dt; t.y += t.vy * dt;
        if (t.y <= ground) {
          const v = -t.vy;
          t.y = ground; t.vy = 0; t.airborne = false;
          if (v > 10 && this.dist2(t.x, t.z, L.x, L.z) < 90 * 90) { this.synth.thud(Math.min(1, v / 30)); if (t.type.id === 'piano') this.synth.creature('piano'); this.shake = Math.max(this.shake, 0.15); }
          if (t.behavior === 'drop') t.behavior = 'stand';
        }
      } else if (t.t >= 0) {
        switch (t.behavior) {
          case 'cross': case 'drive': {
            const dx = t.gx - t.x, dz = t.gz - t.z, d = Math.hypot(dx, dz);
            if (d < 0.6) {
              if (t.behavior === 'drive') { this.removeTarget(i); continue; }
              t.behavior = 'loiter';
            } else {
              const sp = t.speed * (t.scared > 0 ? 1.6 : 1);
              t.x += (dx / d) * sp * dt; t.z += (dz / d) * sp * dt;
              t.ry = this.turn(t.ry, Math.atan2(dx, dz), dt * 6);
              moving = true;
            }
            break;
          }
          case 'march': {
            t.gx -= t.speed * dt; // track-relative s
            const tp = this.track.at(t.gx);
            const nx = -tp.dz, nz = tp.dx;
            t.x = tp.x + nx * t.gz; t.z = tp.z + nz * t.gz;
            t.ry = Math.atan2(-tp.dx, -tp.dz);
            moving = true;
            break;
          }
          case 'land': {
            const target = ground + 0.35 + Math.sin(t.t * 2) * 0.15;
            t.y = lerp(t.y, target, Math.min(1, dt * 0.9));
            t.ry += dt * 1.5;
            break;
          }
          case 'loiter': {
            if (t.speed > 0) {
              if (t.t % 3 < dt) {
                const near = this.track.nearest(t.x, t.z, 30);
                const tp = this.track.at(near.s + (this.rng() - 0.5) * 6);
                const lat = (this.rng() - 0.5) * 4;
                t.gx = tp.x - tp.dz * lat; t.gz = tp.z + tp.dx * lat;
              }
              const dx = t.gx - t.x, dz = t.gz - t.z, d = Math.hypot(dx, dz);
              if (d > 0.4) { t.x += (dx / d) * t.speed * 0.45 * dt; t.z += (dz / d) * t.speed * 0.45 * dt; t.ry = this.turn(t.ry, Math.atan2(dx, dz), dt * 4); moving = true; }
            }
            break;
          }
        }
        if (t.behavior !== 'land') t.y = ground;
      }
      if (t.scared > 0) t.scared -= dt;
      // despawn behind the train
      const rx = t.x - L.x, rz = t.z - L.z;
      const along = rx * dir.x + rz * dir.z;
      if ((along < -45 && rx * rx + rz * rz > 50 * 50) || rx * rx + rz * rz > 260 * 260) { this.removeTarget(i); continue; }
      // animate
      const bob = moving ? Math.abs(Math.sin(t.phase)) * (t.type.id === 'car' ? 0.02 : 0.12) : 0;
      t.mesh.position.set(t.x, t.y + bob, t.z);
      t.mesh.rotation.set(0, t.ry, moving && t.type.id !== 'car' ? Math.sin(t.phase) * 0.09 : 0);
    }
  }

  syncMesh(t: Target) { t.mesh.position.set(t.x, t.y, t.z); t.mesh.rotation.set(0, t.ry, 0); }
  turn(a: number, b: number, k: number) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * Math.min(1, k); }
  dist2(ax: number, az: number, bx: number, bz: number) { return (ax - bx) ** 2 + (az - bz) ** 2; }

  removeTarget(i: number) {
    const t = this.targets[i];
    this.targets.splice(i, 1);
    this.byId.delete(t.id);
    t.dispose();
  }

  whistle() {
    this.synth.whistle();
    const wb = document.getElementById('whistle')!;
    wb.classList.add('active'); setTimeout(() => wb.classList.remove('active'), 250);
    for (let i = 0; i < 6; i++) this.emitSmoke(1.6);
    if (!this.started) return;
    // whistle lures nearby critters onto the line
    const L = this.train.loco.position;
    let n = 0;
    for (const t of this.targets) {
      if (!t.alive || t.speed <= 0 || t.behavior === 'drive' || t.behavior === 'march' || t.airborne) continue;
      if (this.dist2(t.x, t.z, L.x, L.z) > 60 * 60) continue;
      const near = this.track.nearest(t.x, t.z, 60);
      if (near.s < this.train.s + 8) continue;
      const tp = this.track.at(near.s + 2);
      t.gx = tp.x + (this.rng() - 0.5) * 1.2; t.gz = tp.z + (this.rng() - 0.5) * 1.2;
      t.behavior = 'cross'; t.scared = 3;
      (t as Target & { stayOnTrack?: boolean }).stayOnTrack = true;
      if (n++ < 2) setTimeout(() => this.synth.creature(t.type.sound), 200 + n * 250);
    }
  }

  // ------------------------------------------------------------ collisions + carnage
  collide() {
    const segs = this.train.segments;
    const sp = this.train.speed;
    for (let i = this.targets.length - 1; i >= 0; i--) {
      const t = this.targets[i];
      if (!t.alive || t.y - this.world.heightAt(t.x, t.z) > 3.2) continue;
      const r = t.type.radius;
      for (const s of segs) {
        const lx = t.x - s.x, lz = t.z - s.z;
        if (lx * lx + lz * lz > (s.halfLen + 3) ** 2) continue;
        const along = lx * s.dx + lz * s.dz, lat = lx * s.dz - lz * s.dx;
        if (Math.abs(along) < s.halfLen + r && Math.abs(lat) < s.halfW + r) {
          if (sp > 2.5) this.kill(i, s.dx, s.dz);
          else { const sg = Math.sign(lat) || 1; t.x += s.dz * sg * 0.15; t.z -= s.dx * sg * 0.15; }
          break;
        }
      }
    }
  }

  kill(i: number, dx: number, dz: number) {
    const t = this.targets[i];
    t.alive = false; t.deadAt = this.time; t.mesh.visible = false;
    this.targets.splice(i, 1);
    this.graveyard.push(t);
    const speed = this.train.speed, mph = speed * MPH;
    const seed = (Math.random() * 2 ** 31) | 0;
    const T = t.type;
    // gore tier: speed, rare targets and running combos all crank it up (>= 1.7 = fountain + blood rain)
    const comboNext = this.time - this.lastKill < 2.5 ? this.combo + 1 : 1;
    const intensity = Math.min(3, clamp(0.8 + speed / 24, 0.8, 2.1) * (T.rare ? 1.3 : 1) * (comboNext >= 3 ? 1.35 : comboNext >= 2 ? 1.15 : 1));
    this.gore.explode(t.vox, T.s, t.x, t.y, t.z, t.ry, dx, dz, speed, T.bleed, seed, intensity);
    const splatCol = T.bleed === 'green' ? 0x3ad41a : T.bleed === 'oil' ? 0x16120f : T.bleed === 'snow' ? 0xf4f8ff : T.bleed === 'confetti' ? [0xff3b6b, 0xffe14a, 0x4ad2ff][Math.floor(Math.random() * 3)] : T.bleed === 'splinter' ? 0x16161a : 0xa0000a;
    this.train.addSplat(splatCol, Math.round((T.rare ? 90 : 42) * intensity), Math.random);
    if (T.bleed !== 'confetti' && T.bleed !== 'snow') { this.trainBlood = Math.min(14, this.trainBlood + 3 + intensity * 2.5); this.trainBloodHex = splatCol; }
    this.synth.gore(T.bleed, intensity * (T.rare ? 1.2 : 1));
    this.synth.creature(T.sound);
    this.intro?.onKill(t.id);
    this.shake = Math.max(this.shake, clamp(0.4 + speed / 22, 0.4, 1.5) * (intensity >= 1.7 ? 1.5 : 1));
    this.hitFX(t.x, t.y, t.z, intensity, T.bleed);
    // scoring
    if (this.time - this.lastKill < 2.5) this.combo++; else this.combo = 1;
    this.lastKill = this.time;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    const mult = Math.min(this.combo, 10);
    const pts = Math.round(T.points * (1 + mph / 40) * mult);
    this.score += pts;
    this.kills[T.id] = (this.kills[T.id] ?? 0) + 1;
    this.totalKills++;
    this.recentKills = this.recentKills.filter((k) => this.time - k < 0.8);
    this.recentKills.push(this.time);
    const p = new THREE.Vector3(t.x, t.y + 2, t.z).project(this.camera);
    if (p.z < 1) this.hud.popup((p.x * 0.5 + 0.5) * window.innerWidth, (-p.y * 0.5 + 0.5) * window.innerHeight, ['SPLAT!', 'SPLORCH!', 'KABLOOEY!', 'SQUELCH!', 'BONK!', 'WHAM!'][Math.floor(Math.random() * 6)], `${T.name} +${pts.toLocaleString('en-US')}`, T.bleed === 'green');
    if (this.combo >= 2) { this.hud.combo(`COMBO x${mult}`, this.recentKills.length >= 3 ? 'MULTI-SPLAT' : `${Math.round(mph)} MPH`); this.synth.combo(this.combo); }
    this.hud.killboard(this.kills, T.id);
    const ev: HitEvent = { t: this.time, id: t.id, x: t.x, y: t.y, z: t.z, ry: t.ry, dx, dz, speed, seed, type: T.id, int: intensity };
    this.events.push(ev);
    // instant replay for the gruesome stuff
    const gruesome = T.rare || this.combo >= 4 || this.recentKills.length >= 3 || (mph > 62 && Math.random() < 0.5) || forceReplayNext;
    if (gruesome && !this.pendingReplay && (this.time > this.replayCooldown || forceReplayNext)) {
      forceReplayNext = false;
      const cap = this.recentKills.length >= 3 ? `${this.recentKills.length}x MULTI-SPLAT · ${Math.round(mph)} MPH` : `${T.name.toUpperCase()} DOWN · ${Math.round(mph)} MPH${this.combo > 1 ? ' · COMBO x' + mult : ''}`;
      this.pendingReplay = { at: this.time + 1.5, ev, cap };
    } else if (this.pendingReplay && this.time < this.pendingReplay.at) {
      this.pendingReplay.at = Math.max(this.pendingReplay.at, this.time + 1.0);
      if (this.recentKills.length >= 3) this.pendingReplay.cap = `${this.recentKills.length}x MULTI-SPLAT · ${Math.round(mph)} MPH`;
    }
  }

  // ------------------------------------------------------------ replay
  record() {
    const all = [...this.targets, ...this.graveyard.filter((g) => this.time - g.deadAt < 4)];
    const d = new Float32Array(all.length * 5);
    const ids: number[] = [];
    all.forEach((t, i) => { ids.push(t.id); d.set([t.mesh.position.x, t.mesh.position.y, t.mesh.position.z, t.ry, t.alive ? t.mesh.rotation.z + 10 : 0], i * 5); });
    this.frames.push({ t: this.time, s: this.train.s, speed: this.train.speed, ids, d });
    while (this.frames.length && this.time - this.frames[0].t > 7) this.frames.shift();
    this.events = this.events.filter((e) => this.time - e.t < 8);
    // free dead meshes no replay can still reference
    for (let i = this.graveyard.length - 1; i >= 0; i--) {
      const g = this.graveyard[i];
      if (this.time - g.deadAt > 7 && !(this.pendingReplay)) { this.byId.delete(g.id); g.dispose(); this.graveyard.splice(i, 1); }
    }
  }

  startReplay() {
    const pr = this.pendingReplay!;
    this.pendingReplay = null;
    const t0 = Math.max(this.frames[0]?.t ?? pr.ev.t, pr.ev.t - 1.4);
    const snap = this.gore.snapshot();
    this.gore.clear();
    this.gore.allowDecals = false;
    this.synth.rate = 0.45;
    this.synth.whoosh();
    this.replays++;
    this.replay = { rt: t0, t0, t1: this.time, ev: pr.ev, snap, fired: new Set(), mode: this.replays % 3, side: Math.random() < 0.5 ? -1 : 1, ang: 0, cap: pr.cap };
    this.hud.replay(true, pr.cap);
    this.camera.fov = 38; this.camera.updateProjectionMatrix();
  }

  endReplay() {
    const R = this.replay!;
    this.replay = null;
    this.gore.restore(R.snap);
    this.gore.allowDecals = true;
    this.synth.rate = 1;
    for (const t of this.targets) { t.mesh.visible = true; this.syncMesh(t); }
    for (const g of this.graveyard) g.mesh.visible = false;
    this.train.place(this.train.s);
    this.hud.replay(false);
    this.camera.fov = 50; this.camera.updateProjectionMatrix();
    this.replayCooldown = this.time + 14;
    if (this.camMode === 'orbit') this.setCam('orbit');
    this.lastLoco.copy(this.train.loco.position);
  }

  updateReplay(dt: number) {
    const R = this.replay!;
    R.rt += dt * SLOWMO;
    const F = this.frames;
    let i = 0;
    while (i < F.length - 2 && F[i + 1].t < R.rt) i++;
    const a = F[i], b = F[Math.min(i + 1, F.length - 1)];
    const k = b.t > a.t ? clamp((R.rt - a.t) / (b.t - a.t), 0, 1) : 0;
    this.train.place(lerp(a.s, b.s, k));
    const shown = new Set<number>();
    const bi = new Map<number, number>(); b.ids.forEach((id, j) => bi.set(id, j));
    a.ids.forEach((id, j) => {
      const t = this.byId.get(id);
      if (!t) return;
      const o = j * 5, jb = bi.get(id);
      const vis = a.d[o + 4] !== 0;
      if (!vis) return;
      let x = a.d[o], y = a.d[o + 1], z = a.d[o + 2];
      if (jb !== undefined && b.d[jb * 5 + 4] !== 0) { const ob = jb * 5; x = lerp(x, b.d[ob], k); y = lerp(y, b.d[ob + 1], k); z = lerp(z, b.d[ob + 2], k); }
      t.mesh.visible = true; t.mesh.position.set(x, y, z); t.mesh.rotation.set(0, a.d[o + 3], a.d[o + 4] - 10);
      shown.add(id);
    });
    for (const t of [...this.targets, ...this.graveyard]) if (!shown.has(t.id)) t.mesh.visible = false;
    for (const e of this.events) {
      if (e.t <= R.rt && e.t >= R.t0 && !R.fired.has(e)) {
        R.fired.add(e);
        const T = TYPES[e.type];
        const tg = this.byId.get(e.id);
        const ei = e.int ?? clamp(0.8 + e.speed / 24, 0.8, 2.1);
        this.gore.explode(tg ? tg.vox : [], T.s, e.x, e.y, e.z, e.ry, e.dx, e.dz, e.speed, T.bleed, e.seed, ei);
        this.synth.gore(T.bleed, Math.max(2.2, ei * 1.3));
        this.synth.creature(T.sound);
        this.shake = 1.1;
        this.hitFX(e.x, e.y, e.z, Math.max(1.6, ei), T.bleed);
      }
    }
    this.gore.update(dt * SLOWMO);
    this.smoke.update(dt * SLOWMO);
    // cinematic camera
    const e = R.ev;
    const D = new THREE.Vector3(e.dx, 0, e.dz), N = new THREE.Vector3(-e.dz, 0, e.dx).multiplyScalar(R.side);
    const P = new THREE.Vector3(e.x, e.y, e.z);
    R.ang += dt * 0.12;
    const cam = new THREE.Vector3(), look = new THREE.Vector3();
    if (R.mode === 0) { // low side dolly
      const rot = N.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), R.ang - 0.5);
      cam.copy(P).addScaledVector(rot, 9).addScaledVector(D, 2.5).add(new THREE.Vector3(0, 1.3, 0));
      look.copy(P).addScaledVector(D, 1.5).add(new THREE.Vector3(0, 1.4, 0));
    } else if (R.mode === 1) { // on the rails, train coming at you
      cam.copy(P).addScaledVector(D, 14 + R.ang * 4).addScaledVector(N, 3.8).add(new THREE.Vector3(0, 1.3, 0));
      look.copy(P).addScaledVector(D, -3).add(new THREE.Vector3(0, 1.6, 0));
    } else { // crane
      cam.copy(P).addScaledVector(N, 11).addScaledVector(D, -5 + R.ang * 10).add(new THREE.Vector3(0, 6.5, 0));
      look.copy(P).addScaledVector(D, 3).add(new THREE.Vector3(0, 0.8, 0));
    }
    cam.y = Math.max(cam.y, this.world.heightAt(cam.x, cam.z) + 0.7);
    this.camera.position.copy(cam);
    this.camera.lookAt(look);
    this.applyShake(dt);
    if (R.rt >= R.t1) this.endReplay();
  }

  // ------------------------------------------------------------ camera
  updateCamera(dt: number) {
    const L = this.train.loco.position;
    const d = this.trainDir();
    if (this.camMode === 'orbit') {
      const delta = L.clone().sub(this.lastLoco);
      this.camera.position.add(delta);
      this.controls.target.set(L.x + d.x * 3, L.y + 1, L.z + d.z * 3);
      this.controls.update();
    } else if (this.camMode === 'chase') {
      const want = new THREE.Vector3(L.x - d.x * 16, L.y + 8, L.z - d.z * 16);
      want.y = Math.max(want.y, this.world.heightAt(want.x, want.z) + 2);
      this.camera.position.lerp(want, 1 - Math.exp(-dt * 4));
      this.camera.lookAt(L.x + d.x * 10, L.y + 2, L.z + d.z * 10);
    } else {
      if (this.train.s > this.standS + 20 || this.standS < -1e8) {
        this.standS = this.train.s + 45 + this.train.speed * 1.2;
        const tp = this.track.at(this.standS);
        const side = Math.random() < 0.5 ? -1 : 1;
        this.standCam.set(tp.x - tp.dz * 6 * side, 0, tp.z + tp.dx * 6 * side);
        this.standCam.y = this.world.heightAt(this.standCam.x, this.standCam.z) + 1.7;
      }
      this.camera.position.copy(this.standCam);
      this.camera.lookAt(L.x, L.y + 1.5, L.z);
    }
    // never let a live camera sink into the terrain
    const gy = this.world.heightAt(this.camera.position.x, this.camera.position.z) + 1.2;
    if (this.camera.position.y < gy) this.camera.position.y = gy;
    this.lastLoco.copy(L);
    this.applyShake(dt);
  }

  /** red flash + blood across the lens for hits near the camera */
  hitFX(x: number, y: number, z: number, intensity: number, bleed: string) {
    if (this.intro) return; // the intro stages its own splat
    const wet = bleed === 'red' || bleed === 'green';
    const f = document.getElementById('hitflash');
    if (f) {
      f.style.setProperty('--hf', String(Math.min(wet ? 0.75 : 0.4, 0.22 + intensity * 0.18)));
      f.style.background = bleed === 'green' ? '#2fd00e' : bleed === 'oil' ? '#8a6a50' : bleed === 'red' ? '#c00010' : '#ff7088';
      f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
    }
    if (!wet) return;
    const d = this.camera.position.distanceTo(new THREE.Vector3(x, y, z));
    const near = d < 18 ? 1 : d < 45 ? 0.6 : d < 80 ? 0.3 : 0;
    const p = new THREE.Vector3(x, y, z).project(this.camera);
    if (Math.abs(p.x) > 1.3 || Math.abs(p.y) > 1.3 || p.z > 1) return;
    if (near * intensity < 0.55 && !this.replay) return;
    if (!this.screenBlood) this.screenBlood = new BloodFX();
    const n = Math.max(1, Math.min(3, Math.round(near * intensity * 1.6)));
    const pal = bleed === 'green' ? ['#2aa80e', '#3ad41a', '#22900a'] : ['#8a0008', '#a8000c', '#c20012', '#6e0006'];
    this.screenBlood.splatter(n, false, 0.4 + 0.18 * intensity, pal, true);
    this.screenBloodT = 2.2 + intensity * 0.6;
  }

  updateScreenFX(dt: number) {
    if (this.screenBlood && this.screenBloodT > 0) {
      this.screenBlood.update(dt);
      this.screenBlood.decay(dt, 0.9);
      this.screenBloodT -= dt;
      if (this.screenBloodT <= 0) this.screenBlood.fade();
    }
    // blood dripping off the cowcatcher for a while after a kill
    if (this.trainBlood > 0 && !this.replay) {
      this.trainBlood -= dt;
      if (Math.random() < dt * (6 + this.trainBlood * 3)) {
        const p = new THREE.Vector3((Math.random() - 0.5) * 1.6, 0.4 + Math.random() * 1.2, 4.2).applyMatrix4(this.train.loco.matrixWorld);
        const d = this.trainDir();
        this.gore.drip(p.x, p.y, p.z, this.trainBloodHex, 1 + Math.floor(Math.random() * 3), d.x * this.train.speed, d.z * this.train.speed);
      }
    }
  }

  applyShake(dt: number) {
    if (this.shake > 0.001) {
      const s = this.shake * 0.5;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.position.z += (Math.random() - 0.5) * s;
      this.shake *= Math.exp(-dt * 6);
    }
  }

  emitSmoke(boost = 1) {
    const p = new THREE.Vector3(0, 4.3, 2.65).applyMatrix4(this.train.loco.matrixWorld);
    const d = this.trainDir();
    this.smoke.emit(p.x, p.y, p.z, -d.x * this.train.speed * 0.15 * boost, -d.z * this.train.speed * 0.15 * boost);
  }

  // ------------------------------------------------------------ main loop
  step(dt: number) {
    const tr = this.train;
    // input
    if (this.keys.has('KeyW')) { tr.throttle = clamp(tr.throttle + dt * 4, 0, 10); this.syncThrottle(); }
    if (this.keys.has('KeyS')) {
      if (tr.throttle > 0) { tr.throttle = clamp(tr.throttle - dt * 5, 0, 10); this.syncThrottle(); }
      else tr.braking = true;
    }
    const prevS = tr.s;
    tr.update(dt);
    const ds = tr.s - prevS;
    this.track.extendTo(tr.s + 1000);
    this.track.trim(tr.s - 400);
    tr.place(tr.s);
    this.time += dt;
    // sounds + smoke
    this.chuffAcc += ds;
    if (this.chuffAcc > 1.5) { this.chuffAcc = 0; this.synth.chuff(clamp(tr.throttle / 10, 0.15, 1)); }
    this.smokeAcc += dt * (1.5 + tr.speed * 0.35 + tr.throttle * 0.6);
    while (this.smokeAcc > 1) { this.smokeAcc -= 1; this.emitSmoke(); }
    const nextX = this.track.crossings.find((c) => c.s > tr.s && c.s < tr.s + 60);
    if (nextX) { this.bellT -= dt; if (this.bellT < 0) { this.bellT = 0.55; this.synth.bell(); } }
    // spawn
    this.spawnAcc += ds + dt * 1.2;
    if (this.started && this.spawnAcc > this.nextGap) { this.spawnAcc = 0; this.nextGap = 18 + this.rng() * 24; this.spawnEvent(); }
    this.updateTargets(dt);
    this.collide();
    this.gore.update(dt);
    this.smoke.update(dt);
    this.record();
    if (this.combo > 1 && this.time - this.lastKill > 2.5) this.combo = 1;
    if (this.pendingReplay && this.time >= this.pendingReplay.at) this.startReplay();
  }

  frame = (now: number) => {
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (now - (this.lastNow || now)) / 1000);
    this.lastNow = now;
    this.tick(dt);
    this.touch?.sync();
    this.renderer.render(this.scene, this.camera);
  };
  lastNow = 0;

  tick(dt: number) {
    const k = this.intro?.timeScale ?? 1;
    if (this.replay) this.updateReplay(dt);
    else { this.step(dt * k); if (!this.replay) this.updateCamera(dt); }
    this.intro?.update(dt * k, dt);
    this.updateScreenFX(dt);
    if (this.intro && !this.intro.active) this.intro = null;
    // soundtrack: cozy until the carnage begins, metal while it lasts
    if (this.started && !this.intro) this.synth.playMusic(this.totalKills > 0 && this.time - this.lastKill < 45 ? 'metal' : 'cozy');
    // world streaming always
    const L = this.train.loco.position, d = this.trainDir();
    this.world.update(L.x + d.x * 45, L.z + d.z * 45, this.radius, PERF.streamMs);
    // day/night
    const want = this.night ? 1 : 0;
    if (Math.abs(this.nightK - want) > 0.001) { this.nightK += clamp(want - this.nightK, -dt * 1.5, dt * 1.5); this.applyLighting(this.nightK); }
    // sun + sky follow
    this.sun.position.set(L.x + 60, 90, L.z + 35);
    this.sun.target.position.copy(L);
    this.sky.position.copy(this.camera.position);
    for (const c of this.clouds) {
      c.position.x += dt * 1.5;
      const dx = c.position.x - L.x, dz = c.position.z - L.z;
      if (dx * dx + dz * dz > 330 * 330) { c.position.set(L.x + d.x * 250 + (Math.random() - 0.5) * 400, c.position.y, L.z + d.z * 250 + (Math.random() - 0.5) * 300); }
    }
    // hud
    this.fpsN++; this.fpsT += dt;
    if (this.fpsT > 0.5) { this.fps = this.fpsN / this.fpsT; this.fpsN = 0; this.fpsT = 0; this.adapt(); }
    this.hudT -= dt;
    if (this.hudT < 0) {
      this.hudT = 0.12;
      const tp = this.train.loco.position;
      const b = this.world.biomeAt(tp.x, tp.z);
      const tv = this.targets.reduce((a, t) => a + t.vox.length, 0);
      this.hud.stats({
        mph: this.train.speed * MPH, score: this.score, combo: Math.min(this.combo, 10), kills: this.totalKills,
        miles: this.train.distance / 400, top: this.train.topSpeed * MPH,
        vox: this.world.voxelCount + this.train.voxelCount + tv + this.gore.activeCount,
        biome: { farm: 'Farmland', town: 'Town', forest: 'Forest', desert: 'Desert', snow: 'Snowfields', alien: 'Crash Site' }[b], fps: this.fps,
      });
    }
  }

  // drop quality a notch at a time if the machine can't hold ~50fps
  lowFrames = 0; quality = 2;
  adapt() {
    if (MANUAL || !this.started || this.replay) return;
    this.lowFrames = this.fps < 48 ? this.lowFrames + 1 : 0;
    if (this.lowFrames >= 6 && this.quality > 0) {
      this.lowFrames = 0;
      this.quality--;
      if (this.quality === 1) { this.renderer.setPixelRatio(Math.min(PERF.dprLow, PERF.dpr)); this.radius = Math.min(this.radius, PERF.radiusLow); }
      else { this.sun.shadow.mapSize.set(PERF.shadowLow, PERF.shadowLow); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget; this.radius = Math.min(this.radius, PERF.radiusMin); }
      (this.scene.fog as THREE.Fog).far = this.radius + 25;
      console.info('[vce] quality ->', this.quality);
    }
  }
  radius = RADIUS;

  boot() {
    // generate the starting area in one go
    const L = this.train.loco.position, d = this.trainDir();
    this.world.update(L.x + d.x * 45, L.z + d.z * 45, RADIUS, 1e9);
    this.syncThrottle();
    if (!MANUAL) requestAnimationFrame(this.frame);
    if (SKIP_INTRO) this.start(false);
    else this.intro = new Intro(this);
  }
}

let forceReplayNext = false;
const game = new Game();
game.boot();

// test / debug hooks (used by the headless verification script)
(window as unknown as { __vce: unknown }).__vce = {
  game,
  spawn: (type: TypeId, ahead = 30, lat = 0) => { const tp = game.track.at(game.train.s + ahead); const t = game.addTarget(type, tp.x - tp.dz * lat, tp.z + tp.dx * lat, type === 'ufo' ? 'land' : 'stand'); if (type === 'ufo') t.y = 2; return t.id; },
  throttle: (v: number) => { game.train.throttle = v; game.syncThrottle(); },
  forceReplay: () => { forceReplayNext = true; },
  state: () => ({ intro: game.intro?.phase ?? 'done', music: game.synth.music?.mode ?? game.synth.pendingMusic, audio: game.synth.ctx?.state ?? 'none', started: game.started, s: game.train.s, speed: game.train.speed, chunks: game.world.chunks.size, targets: game.targets.length, kills: game.totalKills, score: game.score, replay: !!game.replay, replays: game.replays, debris: game.gore.debris.alive, blood: game.gore.blood.alive, voxels: game.world.voxelCount, fps: game.fps, x: game.train.loco.position.x, z: game.train.loco.position.z, biome: game.world.biomeAt(game.train.loco.position.x, game.train.loco.position.z) }),
  // advance the simulation deterministically (headless GPUs are slow)
  advance: (sec: number, dt = 1 / 30, render = false) => { for (let t = 0; t < sec; t += dt) game.tick(dt); if (!render) return 0; const t0 = performance.now(); game.renderer.render(game.scene, game.camera); return performance.now() - t0; },
  setCam: (m: CamMode) => game.setCam(m),
  night: (on: boolean) => { if (game.night !== on) game.toggleNight(); },
  drop: (type: TypeId, x: number, z: number) => game.dropAt(type, x, z),
  teleport: (s: number) => { game.train.s = s; game.track.extendTo(s + 1000); game.train.place(s); const L = game.train.loco.position, d = game.trainDir(); game.world.update(L.x + d.x * 45, L.z + d.z * 45, RADIUS, 1e9); game.lastLoco.copy(L); game.setCam(game.camMode); },
  findBiome: (b: string, from = 0) => { for (let s = from; s < from + 30000; s += 40) { game.track.extendTo(s + 1100); const tp = game.track.at(s); if (game.world.biomeAt(tp.x, tp.z) === b) { const tp2 = game.track.at(s + 60); if (game.world.biomeAt(tp2.x, tp2.z) === b) return s; } } return -1; },
};
void lin;
