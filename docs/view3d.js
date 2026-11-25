// Real-time 3D view of the tank (three.js). Sim coordinates are centimetres:
// sim x → world X, sim y (0 = back glass) → world Z (+Z toward the viewer), Y is up.
import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';

const TANK_HEIGHT = 34;
const CRAB_SCALE = 1.7; // slightly larger than life so kids can see them

// ---------------------------------------------------------------- noise ---
function hash(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y) => vnoise(x, y) * 0.55 + vnoise(x * 2.1, y * 2.1) * 0.28 + vnoise(x * 4.3, y * 4.3) * 0.17;

// ------------------------------------------------------------- textures ---
function canvasTex(w, h, paint, repeat = 1) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  paint(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  return t;
}
function grain(g, w, h, base, dots, n) {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  let s = 11; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < n; i++) { g.fillStyle = dots[Math.floor(r() * dots.length)]; const z = 0.6 + r() * 1.8; g.fillRect(r() * w, r() * h, z, z); }
}
const TEX = {};
const ENV = { tex: null };
function sandTex(kind) {
  const key = 'sub-' + kind;
  if (TEX[key]) return TEX[key];
  const pal = {
    sand: ['#c9b083', ['#bfa980', '#e8dcc0', '#a99470', '#f3ead6', '#8e7a58']],
    soil: ['#4d3a2b', ['#3b2c20', '#6a523d', '#2d2118', '#7d6448']],
    wood: ['#8a6a48', ['#6e5236', '#a58460']],
    tile: ['#bcc2c0', ['#a9b0ae', '#d3d8d6']],
  }[kind] ?? ['#d6c29b', ['#bfa980', '#e8dcc0']];
  TEX[key] = canvasTex(512, 512, (g, w, h) => {
    grain(g, w, h, pal[0], pal[1], 26000);
    g.strokeStyle = 'rgba(90,70,40,0.10)'; g.lineWidth = 2;
    for (let i = 0; i < 60; i++) { const y = Math.random() * h, x = Math.random() * w; g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + 30, y - 8, x + 60, y + 8, x + 90, y); g.stroke(); }
  }, 4);
  return TEX[key];
}
function fibreTex() {
  return TEX.fibre ??= canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#6b3a1d'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) { g.strokeStyle = `rgba(${150 + Math.random() * 60},${80 + Math.random() * 40},${40 + Math.random() * 20},${0.35 + Math.random() * 0.4})`; g.lineWidth = 0.6 + Math.random(); const x = Math.random() * w, y = Math.random() * h, a = Math.random() * 0.6 - 0.3; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 18, y + Math.sin(a) * 18 + 8); g.stroke(); }
  });
}
function mossTex() {
  return TEX.moss ??= canvasTex(256, 256, (g, w, h) => grain(g, w, h, '#7a7a2e', ['#5d6224', '#9a963c', '#b4a64a', '#4b5220', '#8f7a35'], 9000), 2);
}
function spongeTex() {
  return TEX.sponge ??= canvasTex(256, 256, (g, w, h) => {
    grain(g, w, h, '#b8873e', ['#a47530', '#c99a52'], 3000);
    for (let i = 0; i < 90; i++) { g.fillStyle = 'rgba(80,50,15,0.75)'; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 2 + Math.random() * 5, 0, 7); g.fill(); }
  });
}

// --------------------------------------------------------- spiral shells ---
// A logarithmic-spiral seashell, generated once per type and cached.
const SHELL_TYPES = {
  turbo: { base: [0.22, 0.52, 0.40], band: [0.13, 0.36, 0.28], whorls: 3.4, flare: 0.62, lift: 1.35, spots: false, bands: true },
  babylon: { base: [0.95, 0.92, 0.86], band: [0.50, 0.24, 0.12], whorls: 3.6, flare: 0.55, lift: 1.3, spots: true },
  whelk: { base: [0.78, 0.63, 0.47], band: [0.60, 0.46, 0.32], whorls: 3.8, flare: 0.5, lift: 1.5, bands: true },
  'white-moon': { base: [0.96, 0.95, 0.92], band: [0.85, 0.82, 0.76], whorls: 2.4, flare: 0.75, lift: 0.5 },
};
const shellGeoCache = {};
function shellGeometry(type) {
  if (shellGeoCache[type]) return shellGeoCache[type];
  const p = SHELL_TYPES[type] ?? SHELL_TYPES.whelk;
  const N = 140, M = 22;
  const turns = p.whorls * Math.PI * 2;
  const k = Math.log(1 / 0.08) / turns; // radius shrinks to 8% at the apex
  const pos = [], col = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const th = (i / N) * turns;
    const e = Math.exp(-k * th);
    const R = 0.62 * e, tube = 0.36 * e * (0.9 + p.flare * 0.2);
    const cx = R * Math.cos(th), cz = R * Math.sin(th), cy = p.lift * (1 - e) * 0.9;
    for (let j = 0; j <= M; j++) {
      const ph = (j / M) * Math.PI * 2;
      const nx = Math.cos(ph) * Math.cos(th), nz = Math.cos(ph) * Math.sin(th), ny = Math.sin(ph);
      const rib = 1 + 0.05 * Math.sin(ph * 12) + 0.04 * Math.sin(th * 16); // spiral cords and growth lines
      pos.push(cx + tube * rib * nx, cy + tube * rib * ny * 0.95, cz + tube * rib * nz);
      let c = p.base;
      if (p.bands && Math.sin(ph * 3 + th * 1.5) > 0.55) c = p.band;
      if (p.spots) { const sx = Math.sin(th * 4.0) * Math.sin(ph * 3.0 + th); if (sx > 0.55) c = p.band; }
      const shade = 0.85 + 0.15 * Math.sin(th * 7);
      col.push(c[0] * shade, c[1] * shade, c[2] * shade);
    }
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) {
    const a = i * (M + 1) + j, b = a + M + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return (shellGeoCache[type] = g);
}
const shellMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.3, side: THREE.DoubleSide });
function makeShell(type, size) {
  const m = new THREE.Mesh(shellGeometry(type), shellMat);
  m.scale.setScalar(size * 0.5); // geometry is ~2 units across; size = aperture-fit diameter in cm
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

// ----------------------------------------------------------------- crabs ---
function bodyColor(hue) {
  const stops = [[0.48, 0.25, 0.55], [0.72, 0.25, 0.18], [0.85, 0.47, 0.17]];
  const f = Math.min(0.999, Math.max(0, hue)) * 2, i = Math.floor(f), u = f - i;
  const a = stops[i], b = stops[i + 1];
  return new THREE.Color(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u);
}

class Crab3D {
  constructor(crab) {
    this.id = crab.id;
    this.root = new THREE.Group();
    this.root.userData.crabId = crab.id;
    this.pos = null; this.heading = 0; this.y = 0; this.pitch = 0;
    this.build(crab);
  }
  build(crab) {
    const b = crab.body, s = Math.max(0.6, b.size) * CRAB_SCALE;
    this.sig = JSON.stringify([crab.shell, b.size, b.clawL, b.clawR, b.legLen, b.posture, b.armor, b.hue, b.eyeStalk, b.antenna, b.cranium]);
    this.s = s;
    this.root.clear();
    const body = new THREE.Group(); this.body = body; this.root.add(body);
    const col = bodyColor(b.hue);
    const leg = col.clone().lerp(new THREE.Color(0.9, 0.45, 0.2), 0.45);
    const matBody = new THREE.MeshStandardMaterial({ color: col, roughness: 0.5 });
    const matLeg = new THREE.MeshStandardMaterial({ color: leg, roughness: 0.55 });
    const matDark = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 });
    const add = (geo, mat, parent = body) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; parent.add(m); return m; };
    const lift = s * (0.32 + b.posture * 0.25);

    // shell (or armoured abdomen)
    if (crab.shell) {
      const sh = makeShell(crab.shell.type, crab.shell.size * CRAB_SCALE * 0.95);
      sh.position.set(-s * 0.3, lift + s * 0.12, 0);
      sh.rotation.set(0.2, 0, 1.15);
      body.add(sh); this.shell = sh;
    } else {
      for (let i = 0; i < 4; i++) { const seg = add(new THREE.SphereGeometry(s * (0.32 - i * 0.05), 16, 12), matBody); seg.position.set(-s * (0.25 + i * 0.2), lift - i * s * 0.04, 0); seg.scale.set(1, 0.7, 1.1); }
    }
    // carapace / head
    const head = add(new THREE.SphereGeometry(s * 0.3, 20, 16), matBody);
    head.position.set(s * 0.12, lift, 0); head.scale.set(1.15 + b.cranium * 0.15, 0.75 + b.cranium * 0.2, 0.95);

    // claws: big left (-Z), small right (+Z)
    this.claws = [];
    for (const [side, sc] of [[-1, b.clawL], [1, b.clawR]]) {
      const g = new THREE.Group(); g.position.set(s * 0.34, lift - s * 0.05, side * s * 0.17); body.add(g);
      const arm = add(new THREE.CylinderGeometry(s * 0.06, s * 0.07, s * 0.28, 8), matBody, g); arm.rotation.z = Math.PI / 2; arm.position.x = s * 0.1;
      const palm = add(new THREE.SphereGeometry(s * 0.2 * sc, 16, 12), matBody, g); palm.position.set(s * (0.28 + 0.1 * sc), 0, 0); palm.scale.set(1.3, 0.75, 0.8);
      const finger = add(new THREE.ConeGeometry(s * 0.07 * sc, s * 0.25 * sc, 8), matBody, g); finger.rotation.z = -Math.PI / 2; finger.position.set(s * (0.48 + 0.18 * sc), -s * 0.03, 0);
      this.claws.push(g);
    }
    // walking legs: two visible pairs each side, each with a hip and a knee
    this.legs = [];
    const L = s * 0.42 * b.legLen * (1 + b.posture * 0.3);
    for (const side of [-1, 1]) for (let i = 0; i < 2; i++) {
      const hip = new THREE.Group(); hip.position.set(s * (0.16 - i * 0.16), lift - s * 0.05, side * s * 0.16); body.add(hip);
      hip.rotation.y = side * (0.35 - i * 0.55);
      const up = add(new THREE.CylinderGeometry(s * 0.045, s * 0.055, L, 6), matLeg, hip);
      up.rotation.x = side * -1.0; up.position.set(0, L * 0.27, side * L * 0.42);
      const knee = new THREE.Group(); knee.position.set(0, L * 0.54, side * L * 0.84); hip.add(knee);
      const low = add(new THREE.CylinderGeometry(s * 0.035, s * 0.02, L * 1.25, 6), matLeg, knee);
      low.rotation.x = side * 0.45; low.position.set(0, -L * 0.56, side * L * 0.28);
      this.legs.push({ hip, side, i, base: hip.rotation.y });
    }
    // eyestalks & antennae
    this.antennae = [];
    for (const side of [-1, 1]) {
      const stalkLen = s * 0.28 * b.eyeStalk;
      const st = add(new THREE.CylinderGeometry(s * 0.025, s * 0.03, stalkLen, 6), matLeg);
      st.position.set(s * 0.36, lift + s * 0.12 + stalkLen * 0.4, side * s * 0.07); st.rotation.z = -0.45; st.rotation.x = side * 0.25;
      const eye = add(new THREE.SphereGeometry(s * 0.05, 10, 8), matDark);
      eye.position.set(s * 0.36 + stalkLen * 0.43, lift + s * 0.12 + stalkLen * 0.85, side * s * (0.07 + 0.06));
      const ag = new THREE.Group(); ag.position.set(s * 0.42, lift + s * 0.08, side * s * 0.04); body.add(ag);
      const al = s * (1.1 + 0.4 * b.antenna);
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(al * 0.4, al * 0.25, side * al * 0.15), new THREE.Vector3(al, al * 0.15, side * al * 0.45)]);
      add(new THREE.TubeGeometry(curve, 12, s * 0.012, 4), new THREE.MeshStandardMaterial({ color: 0xe0805a, roughness: 0.6 }), ag);
      this.antennae.push({ g: ag, side });
    }
  }
  update(crab, st, ground, t, dt) {
    if (this.sig !== JSON.stringify([crab.shell, crab.body.size, crab.body.clawL, crab.body.clawR, crab.body.legLen, crab.body.posture, crab.body.armor, crab.body.hue, crab.body.eyeStalk, crab.body.antenna, crab.body.cranium])) this.build(crab);
    const target = new THREE.Vector3(st.wx, 0, st.wz);
    if (!this.pos || this.pos.distanceTo(target) > 8) this.pos = target.clone();
    else this.pos.lerp(target, Math.min(1, dt * 8));
    // smooth turning
    let d = (-st.heading) - this.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.heading += d * Math.min(1, dt * 4);
    const yTarget = ground + st.lift;
    this.y += (yTarget - this.y) * Math.min(1, dt * 5);
    this.root.position.set(this.pos.x, this.y, this.pos.z);
    this.root.rotation.y = this.heading;
    this.root.visible = st.act !== 'molt';
    const moving = st.moving;
    const ph = t * 10 + crab._ci;
    for (const l of this.legs) {
      const sw = moving ? Math.sin(ph + l.i * Math.PI + (l.side > 0 ? Math.PI / 2 : 0)) * 0.35 : 0;
      l.hip.rotation.y = l.base + sw;
      l.hip.rotation.x = moving ? Math.max(0, Math.cos(ph + l.i * Math.PI)) * 0.25 * l.side : 0;
    }
    const busy = ['eat', 'build', 'dig', 'drink'].includes(st.act);
    this.claws.forEach((c, i) => { c.rotation.z = busy ? Math.sin(t * 6 + i * 1.7) * 0.35 - 0.1 : Math.sin(t * 0.7 + i) * 0.05; c.rotation.y = busy ? Math.sin(t * 4 + i) * 0.2 : 0; });
    for (const a of this.antennae) { a.g.rotation.y = Math.sin(t * 3.1 + a.side + crab._ci) * 0.35; a.g.rotation.z = Math.sin(t * 2.3 + a.side * 2) * 0.2; }
    // tuck into the shell while resting; bob while walking
    const tuck = st.act === 'rest' ? 0.75 : 1;
    this.body.scale.setScalar(1);
    this.body.position.y = moving ? Math.abs(Math.sin(ph)) * this.s * 0.04 : 0;
    this.claws.forEach((c) => c.scale.setScalar(tuck));
    this.root.rotation.z = st.pitch ?? 0;
  }
}

// ------------------------------------------------------------- the view ---
export class TankView3D {
  constructor(container, overlay, { onPick } = {}) {
    this.container = container; this.overlay = overlay; this.onPick = onPick;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.95;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    container.prepend(r.domElement);
    r.domElement.className = 'gl';

    this.scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(r);
    ENV.tex = pm.fromScene(new RoomEnvironment(), 0.04).texture; // reflections only, dimmed at night
    shellMat.envMap = ENV.tex;

    this.camera = new THREE.PerspectiveCamera(40, 16 / 10, 1, 800);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.49; this.controls.minDistance = 10; this.controls.maxDistance = 160;
    this.controls.addEventListener('start', () => { this.userMoved = true; this.mode = this.mode === 'tour' ? 'free' : this.mode; });

    // lights
    this.hemi = new THREE.HemisphereLight(0xdfe9ff, 0x6b5a44, 0.8); this.scene.add(this.hemi);
    this.moon = new THREE.DirectionalLight(0x7f9cff, 0.0); this.moon.position.set(-40, 80, 60); this.scene.add(this.moon);
    this.room = new THREE.DirectionalLight(0xfff4e6, 0.9); this.room.position.set(30, 90, 80); this.room.castShadow = true;
    this.room.shadow.mapSize.set(1024, 1024); Object.assign(this.room.shadow.camera, { left: -45, right: 45, top: 40, bottom: -40, near: 10, far: 250 });
    this.scene.add(this.room);

    this.world = new THREE.Group(); this.scene.add(this.world);
    this.crabs = new Map();
    this.tankId = null;
    this.mode = 'front';
    this.clock = new THREE.Clock();
    this.tags = new Map();
    this.ray = new THREE.Raycaster();
    this.bg(0xdfe3e1);
    this.setView('front', true);

    // picking (a tap, not a drag)
    let down = null;
    r.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
    r.domElement.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
      const rect = r.domElement.getBoundingClientRect();
      const v = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      this.ray.setFromCamera(v, this.camera);
      const hits = this.ray.intersectObjects([...this.crabs.values()].map((c) => c.root), true);
      let id = null;
      if (hits.length) { let o = hits[0].object; while (o && !o.userData.crabId) o = o.parent; id = o?.userData.crabId ?? null; }
      else {
        // generous hit area: nearest crab on screen within 40px
        let best = 40;
        for (const c of this.crabs.values()) { const p = this.toScreen(c.root.position); const dd = Math.hypot(p.x - (e.clientX - rect.left), p.y - (e.clientY - rect.top)); if (dd < best) { best = dd; id = c.id; } }
      }
      this.onPick?.(id);
    });
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  bg(hex) { this.scene.background = new THREE.Color(hex); }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  setView(mode, instant = false) {
    this.mode = mode;
    const W = this.tank?.w ?? 60, H = this.tank?.h ?? 45;
    const presets = {
      front: { pos: [0, 20, H / 2 + 36], target: [0, 1, 1] },
      top: { pos: [0, 70, 6], target: [0, 0, 0] },
      tour: { pos: [W * 0.7, 26, H * 0.9], target: [0, 2, 0] },
    };
    const p = presets[mode];
    if (p) { this.camGoal = { pos: new THREE.Vector3(...p.pos), target: new THREE.Vector3(...p.target) }; if (instant) { this.camera.position.copy(this.camGoal.pos); this.controls.target.copy(this.camGoal.target); } }
    else this.camGoal = null;
    this.controls.autoRotate = mode === 'tour'; this.controls.autoRotateSpeed = 0.45;
  }

  ground(x, y) {
    // sim coords → height of the substrate (cm)
    const t = this.tank;
    if (!t) return 0;
    const bank = t.id === 'home' ? Math.max(0, (18 - x) / 18) * 2.2 + Math.max(0, (12 - y) / 12) * 1.0 : 0;
    return 1.2 + fbm(x * 0.09, y * 0.09) * 1.6 + bank;
  }

  buildTank(tank, world) {
    this.tank = tank; this.tankId = tank.id;
    this.world.clear();
    const W = tank.w, H = tank.h, D = TANK_HEIGHT;
    const X = (x) => x - W / 2, Z = (y) => y - H / 2;
    this.X = X; this.Z = Z;
    const add = (m, shadow = true) => { m.castShadow = shadow; m.receiveShadow = true; this.world.add(m); return m; };

    // furniture: a shelf top the tank sits on, and a wall behind
    const stand = add(new THREE.Mesh(new THREE.BoxGeometry(W + 30, 3, H + 24), new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.6 })), false);
    stand.position.set(0, -1.6, 0);
    this.wallMat = new THREE.MeshStandardMaterial({ color: 0xe9e6ea, roughness: 0.95 });
    const wall = add(new THREE.Mesh(new THREE.PlaneGeometry(400, 220), this.wallMat), false);
    wall.position.set(0, 60, -H / 2 - 22);

    // substrate with gentle dunes and a bank on the left
    const seg = 100;
    const g = new THREE.PlaneGeometry(W, H, seg, Math.round(seg * H / W));
    g.rotateX(-Math.PI / 2);
    const pa = g.attributes.position;
    for (let i = 0; i < pa.count; i++) { const sx = pa.getX(i) + W / 2, sy = pa.getZ(i) + H / 2; pa.setY(i, this.ground(sx, sy)); }
    g.computeVertexNormals();
    const sub = add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: sandTex(tank.substrate), roughness: 0.95, bumpMap: sandTex(tank.substrate), bumpScale: 0.4 })), false);
    sub.receiveShadow = true;
    // substrate edge visible through the front glass
    const side = add(new THREE.Mesh(new THREE.BoxGeometry(W, 2.4, H), new THREE.MeshStandardMaterial({ map: sandTex(tank.substrate), roughness: 1 })), false);
    side.position.y = 1.1;

    // glass + black frame
    const glass = new THREE.MeshPhysicalMaterial({ envMap: ENV.tex, envMapIntensity: 0.6, color: 0xffffff, transparent: true, opacity: 0.08, roughness: 0.05, metalness: 0, side: THREE.DoubleSide, depthWrite: false });
    const panes = [[W, D, 0, D / 2, -H / 2, 0], [W, D, 0, D / 2, H / 2, 0], [H, D, -W / 2, D / 2, 0, Math.PI / 2], [H, D, W / 2, D / 2, 0, Math.PI / 2]];
    for (const [w, h, x, y, z, ry] of panes) { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glass); p.position.set(x, y, z); p.rotation.y = ry; p.renderOrder = 2; this.world.add(p); }
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.4, metalness: 0.3 });
    const bar = (w, h, d, x, y, z) => { const m = add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frameMat), false); m.position.set(x, y, z); };
    for (const y of [0.3, D]) { bar(W + 1, 1, 1, 0, y, H / 2); bar(W + 1, 1, 1, 0, y, -H / 2); bar(1, 1, H + 1, -W / 2, y, 0); bar(1, 1, H + 1, W / 2, y, 0); }
    for (const [x, z] of [[-W / 2, -H / 2], [W / 2, -H / 2], [-W / 2, H / 2], [W / 2, H / 2]]) bar(1, D, 1, x, D / 2, z);
    // screen lid over the back half
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H * 0.45), new THREE.MeshStandardMaterial({ color: 0x111111, transparent: true, opacity: 0.35, roughness: 0.8, side: THREE.DoubleSide }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(0, D + 0.2, -H / 2 + H * 0.225); this.world.add(mesh);

    // heat lamps sitting on the lid
    this.lamps = [];
    for (const o of tank.objects.filter((o) => o.kind === 'heat-lamp')) {
      const dome = add(new THREE.Mesh(new THREE.CylinderGeometry(3.2, 6.5, 9, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.35, metalness: 0.6, side: THREE.DoubleSide })));
      dome.position.set(X(o.x), D + 5, Z(o.y + 4));
      const cap = add(new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.8, 5, 16), new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.6 })));
      cap.position.set(X(o.x), D + 11, Z(o.y + 4));
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 12), new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffa040, emissiveIntensity: 0 }));
      bulb.position.set(X(o.x), D + 2.2, Z(o.y + 4)); this.world.add(bulb);
      const spot = new THREE.SpotLight(0xffb066, 0, 90, 0.75, 0.6, 1.2);
      spot.position.set(X(o.x), D + 1, Z(o.y + 4)); spot.target.position.set(X(o.x), 0, Z(o.y + 10));
      spot.castShadow = true; spot.shadow.mapSize.set(1024, 1024); spot.shadow.bias = -0.0005;
      this.world.add(spot, spot.target);
      this.lamps.push({ bulb, spot });
    }

    for (const o of tank.objects) this.addObject(o, tank);
    this.spareShells = new THREE.Group(); this.world.add(this.spareShells);
    this.renderShells(tank);
    this.projects = new THREE.Group(); this.world.add(this.projects);
    this.mounds = new THREE.Group(); this.world.add(this.mounds);
    this.projSig = null;
    for (const c of this.crabs.values()) this.world.add(c.root);
  }

  renderShells(tank) {
    this.spareShells.clear();
    tank.shells.forEach((s, i) => {
      const m = makeShell(s.type, s.size * CRAB_SCALE * 0.95);
      m.position.set(this.X(s.x), this.ground(s.x, s.y) + s.size * CRAB_SCALE * 0.3, this.Z(s.y));
      m.rotation.set(0.3 * Math.sin(i * 3), i * 2.4, 1.35 + 0.2 * Math.cos(i));
      this.spareShells.add(m);
    });
    this.shellSig = JSON.stringify(tank.shells);
  }

  addObject(o, tank) {
    const X = this.X, Z = this.Z;
    const add = (m) => { m.castShadow = true; m.receiveShadow = true; this.world.add(m); return m; };
    const gy = (x, y) => this.ground(x, y);
    switch (o.kind) {
      case 'coconut-hut': {
        const g = new THREE.SphereGeometry(o.r, 40, 24, 0, Math.PI * 2, 0, Math.PI / 2);
        const m = add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: fibreTex(), bumpMap: fibreTex(), bumpScale: 1.2, roughness: 1, side: THREE.DoubleSide })));
        m.scale.set(1, 0.85, 1); m.position.set(X(o.x), gy(o.x, o.y) - 0.6, Z(o.y));
        const door = add(new THREE.Mesh(new THREE.CircleGeometry(2.6, 24), new THREE.MeshBasicMaterial({ color: 0x140a04 })));
        door.scale.set(1.2, 0.85, 1); door.position.set(X(o.x) + 2.5, gy(o.x, o.y) + 1.6, Z(o.y) + o.r * 0.93); door.rotation.y = 0.3;
        break;
      }
      case 'moss-path': {
        const mat = new THREE.MeshStandardMaterial({ map: mossTex(), bumpMap: mossTex(), bumpScale: 1.5, roughness: 1 });
        for (const pts of [o.points, o.branch].filter(Boolean)) {
          const curve = new THREE.CatmullRomCurve3(pts.map(([x, y]) => new THREE.Vector3(X(x), gy(x, y) + 0.6, Z(y))));
          const tube = add(new THREE.Mesh(new THREE.TubeGeometry(curve, 60, 1.6, 10), mat));
          tube.scale.y = 0.7;
          for (let i = 0; i < 40; i++) {
            const p = curve.getPoint(i / 40);
            const tuft = add(new THREE.Mesh(new THREE.SphereGeometry(0.5 + hash(i, p.x) * 0.7, 8, 6), mat));
            tuft.scale.y = 0.6;
            tuft.position.set(p.x + (hash(i, 2) - 0.5) * 2.4, p.y * 0.7 + 0.5, p.z + (hash(3, i) - 0.5) * 2.4);
          }
        }
        break;
      }
      case 'food-pile': {
        const geo = new THREE.CylinderGeometry(0.28, 0.28, 0.6, 6);
        const inst = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.8 }), 160);
        const dummy = new THREE.Object3D();
        for (let i = 0; i < 160; i++) {
          const a = i * 2.39996, r = Math.sqrt(i / 160) * o.r;
          dummy.position.set(X(o.x) + Math.cos(a) * r, gy(o.x, o.y) + 0.3 + (1 - r / o.r) * 1.0 + hash(i, 1) * 0.3, Z(o.y) + Math.sin(a) * r);
          dummy.rotation.set(hash(i, 2) * 3, hash(i, 3) * 3, hash(i, 4) * 3); dummy.updateMatrix(); inst.setMatrixAt(i, dummy.matrix);
          inst.setColorAt(i, new THREE.Color().setHSL(0.07 + hash(i, 5) * 0.03, 0.55, 0.28 + hash(i, 6) * 0.12));
        }
        inst.castShadow = true; this.world.add(inst);
        break;
      }
      case 'sponge': {
        const g = new THREE.IcosahedronGeometry(o.r, 3);
        const pa = g.attributes.position;
        for (let i = 0; i < pa.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(pa, i); v.multiplyScalar(0.85 + vnoise(v.x * 0.9 + 5, v.y * 0.9 + v.z) * 0.3); pa.setXYZ(i, v.x, v.y, v.z); }
        g.computeVertexNormals();
        const m = add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: spongeTex(), bumpMap: spongeTex(), bumpScale: 2, roughness: 1 })));
        m.scale.set(1, 0.75, 0.9); m.position.set(X(o.x), gy(o.x, o.y) + o.r * 0.5, Z(o.y));
        break;
      }
      case 'water-dish': {
        const shape = new THREE.Shape();
        const r = o.r;
        shape.moveTo(-r, -r * 0.6); shape.quadraticCurveTo(0, -r * 0.9, r, -r * 0.6); shape.quadraticCurveTo(r * 0.55, r * 0.95, 0, r * 0.8); shape.quadraticCurveTo(-r * 0.55, r * 0.95, -r, -r * 0.6);
        const dish = add(new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 2.2, bevelEnabled: true, bevelSize: 0.7, bevelThickness: 0.6, bevelSegments: 3 }), new THREE.MeshStandardMaterial({ color: o.water === 'salt' ? 0x2b6c8c : 0x2fa043, roughness: 0.45 })));
        dish.rotation.x = -Math.PI / 2; dish.position.set(X(o.x), gy(o.x, o.y) - 0.6, Z(o.y));
        const inner = new THREE.Shape(shape.getPoints(30).map((p) => new THREE.Vector2(p.x * 0.78, p.y * 0.78)));
        const water = new THREE.Mesh(new THREE.ShapeGeometry(inner), new THREE.MeshPhysicalMaterial({ color: o.water === 'salt' ? 0x5fb3d6 : 0x8fd3c0, transparent: true, opacity: 0.7, roughness: 0.05, metalness: 0, clearcoat: 1 }));
        water.rotation.x = -Math.PI / 2; water.position.set(X(o.x), gy(o.x, o.y) + 2.5, Z(o.y)); this.world.add(water);
        this.waters = (this.waters ?? []).concat(water);
        break;
      }
      case 'shell-fragment': {
        const m = add(new THREE.Mesh(new THREE.SphereGeometry(o.r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe6d7bd, roughness: 0.6, side: THREE.DoubleSide })));
        m.scale.set(1, 0.45, 0.75); m.position.set(X(o.x), gy(o.x, o.y), Z(o.y)); m.rotation.y = 0.6;
        break;
      }
      case 'plant': {
        const mat = new THREE.MeshStandardMaterial({ color: 0x3f8a3a, roughness: 0.6, side: THREE.DoubleSide });
        for (let i = 0; i < 26; i++) {
          const leaf = add(new THREE.Mesh(new THREE.CircleGeometry(1.6 + hash(i, o.x) * 1.2, 12), mat));
          leaf.scale.set(1, 0.6, 1);
          leaf.position.set(X(o.x) + (hash(i, 1) - 0.5) * o.r * 1.6, gy(o.x, o.y) + 1 + hash(i, 2) * o.r * 1.4, Z(o.y) + (hash(i, 3) - 0.5) * o.r * 1.6);
          leaf.rotation.set(-1.1 + hash(i, 4), hash(i, 5) * 6, 0);
        }
        break;
      }
      case 'cork-bark': {
        const m = add(new THREE.Mesh(new THREE.CylinderGeometry(o.r * 0.6, o.r * 0.6, o.r * 2, 20, 1, true, 0, Math.PI), new THREE.MeshStandardMaterial({ color: 0x5b4231, roughness: 1, side: THREE.DoubleSide })));
        m.rotation.z = Math.PI / 2; m.position.set(X(o.x), gy(o.x, o.y), Z(o.y));
        break;
      }
      case 'rock': {
        const g = new THREE.DodecahedronGeometry(o.r * 0.7, 1);
        const m = add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x4b4f52, roughness: 0.9, flatShading: true })));
        m.scale.y = 0.6; m.position.set(X(o.x), gy(o.x, o.y) + o.r * 0.2, Z(o.y));
        break;
      }
      case 'hide-box': {
        const m = add(new THREE.Mesh(new THREE.BoxGeometry(o.r * 2, o.r * 1.1, o.r * 1.4), new THREE.MeshStandardMaterial({ color: 0xeef1ef, roughness: 0.5 })));
        m.position.set(X(o.x), gy(o.x, o.y) + o.r * 0.5, Z(o.y));
        break;
      }
      default: break; // cord-port and lamps are handled elsewhere
    }
  }

  renderProjects(world, tank) {
    const sig = JSON.stringify(world.projects.filter((p) => p.tank === tank.id).map((p) => [p.id, Math.round(p.progress * 50), p.done])) + JSON.stringify(tank.objects.length);
    if (sig === this.projSig) return;
    this.projSig = sig;
    this.projects.clear();
    const mat = new THREE.MeshStandardMaterial({ map: mossTex(), roughness: 1 });
    for (const p of world.projects.filter((p) => p.tank === tank.id)) {
      const k = p.done ? 1 : p.progress;
      if (p.type === 'moss-ladder') {
        const h = TANK_HEIGHT * k;
        const m = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.6, Math.max(0.5, h), 10), mat);
        m.position.set(this.X(p.x), this.ground(p.x, p.y) + h / 2, this.Z(p.y)); m.castShadow = true; this.projects.add(m);
      } else if (!p.done) {
        const m = new THREE.Mesh(new THREE.ConeGeometry(1 + 3 * k, 0.5 + 2.5 * k, 12), mat);
        m.position.set(this.X(p.x), this.ground(p.x, p.y) + (0.5 + 2.5 * k) / 2, this.Z(p.y)); m.castShadow = true; this.projects.add(m);
      }
    }
    // structures the crabs finished
    for (const o of tank.objects.filter((o) => o.builtBy || ['shell-cache', 'burrow-network', 'monument'].includes(o.kind))) {
      if (o.kind === 'shell-cache') for (let i = 0; i < 7; i++) { const s = makeShell(['turbo', 'white-moon', 'babylon'][i % 3], 1.4); s.position.set(this.X(o.x) + Math.cos(i) * 2, this.ground(o.x, o.y) + 0.5 + (i % 3) * 0.5, this.Z(o.y) + Math.sin(i * 1.3) * 1.6); this.projects.add(s); }
      else if (o.kind === 'burrow-network') for (let i = 0; i < 5; i++) { const h = new THREE.Mesh(new THREE.CircleGeometry(1, 16), new THREE.MeshBasicMaterial({ color: 0x2a1c0e })); h.rotation.x = -Math.PI / 2; const x = o.x + Math.cos(i * 1.3) * 4, y = o.y + Math.sin(i * 1.3) * 3; h.position.set(this.X(x), this.ground(x, y) + 0.05, this.Z(y)); this.projects.add(h); }
      else { const m = new THREE.Mesh(new THREE.TorusGeometry(3, 0.5, 8, 24), new THREE.MeshStandardMaterial({ color: 0xd8cfc0 })); m.rotation.x = -Math.PI / 2; m.position.set(this.X(o.x), this.ground(o.x, o.y) + 0.3, this.Z(o.y)); this.projects.add(m); }
    }
  }

  toScreen(v) {
    const p = v.clone().project(this.camera);
    const r = this.renderer.domElement;
    return { x: (p.x * 0.5 + 0.5) * r.clientWidth, y: (-p.y * 0.5 + 0.5) * r.clientHeight, behind: p.z > 1 };
  }

  // per-frame update. f = { world, tank, t, localHour, crabs: [{ c, st, said, thought, color }], selected, gloss }
  render(f) {
    const dt = Math.min(0.1, this.clock.getDelta());
    const tank = f.tank;
    if (tank.id !== this.tankId) { this.buildTank(tank, f.world); for (const [, c] of this.crabs) this.world.add(c.root); }
    if (JSON.stringify(tank.shells) !== this.shellSig) this.renderShells(tank);
    this.renderProjects(f.world, tank);

    // light: day (lamps on), dusk, night (moonlit, still visible for viewers)
    const h = f.localHour;
    const lampsOn = h >= 8 && h < 20;
    const dayness = h >= 7 && h < 19 ? 1 : h >= 19 && h < 21 ? (21 - h) / 2 : h >= 5 && h < 7 ? (h - 5) / 2 : 0;
    this.hemi.intensity = 0.18 + 0.5 * dayness;
    this.hemi.color.setRGB(0.55 + 0.35 * dayness, 0.62 + 0.3 * dayness, 0.9);
    this.room.intensity = 0.05 + 0.85 * dayness;
    const envI = 0.15 + 0.85 * dayness;
    shellMat.envMapIntensity = envI; for (const w of this.waters ?? []) { w.material.envMap = ENV.tex; w.material.envMapIntensity = envI; }
    this.moon.intensity = 0.9 * (1 - dayness);
    this.bg(new THREE.Color(0x0d1220).lerp(new THREE.Color(0xdfe3e1), dayness).getHex());
    if (this.wallMat) this.wallMat.color.copy(new THREE.Color(0x232a3a).lerp(new THREE.Color(0xe9e6ea), dayness));
    for (const l of this.lamps ?? []) { l.spot.intensity = lampsOn ? 900 : 0; l.bulb.material.emissiveIntensity = lampsOn ? 2.2 : 0; }
    for (const w of this.waters ?? []) w.position.y += Math.sin(performance.now() / 700) * 0.0015;

    // crabs
    const seen = new Set();
    const tSec = performance.now() / 1000;
    for (const { c, st } of f.crabs) {
      seen.add(c.id);
      let cr = this.crabs.get(c.id);
      if (!cr) { cr = new Crab3D(c); this.crabs.set(c.id, cr); this.world.add(cr.root); }
      const lift = this.liftFor(st, tank);
      cr.update(c, { ...st, wx: this.X(st.x), wz: this.Z(st.y), lift: lift.y, pitch: lift.pitch }, this.ground(st.x, st.y), tSec, dt);
    }
    for (const [id, cr] of this.crabs) if (!seen.has(id)) { cr.root.visible = false; }

    // molting mounds
    const sig = f.crabs.filter((x) => x.st.act === 'molt').map((x) => x.c.id + Math.round(x.st.x) + Math.round(x.st.y)).join();
    if (sig !== this.moundSig) {
      this.moundSig = sig; this.mounds.clear();
      for (const { c, st } of f.crabs.filter((x) => x.st.act === 'molt')) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(c.body.size * 1.3, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ map: sandTex(tank.substrate), roughness: 1 }));
        m.scale.y = 0.4; m.position.set(this.X(st.x), this.ground(st.x, st.y) - 0.2, this.Z(st.y)); m.receiveShadow = true; this.mounds.add(m);
      }
    }

    // camera
    const sel = f.selected && this.crabs.get(f.selected);
    if (this.mode === 'follow' && sel && sel.root.visible) {
      const p = sel.root.position;
      this.controls.target.lerp(new THREE.Vector3(p.x, p.y + 1, p.z), Math.min(1, dt * 3));
      const want = new THREE.Vector3(p.x, p.y + 16, p.z + 26);
      if (!this.userMoved) this.camera.position.lerp(want, Math.min(1, dt * 1.5));
    } else if (this.mode === 'eye' && sel) {
      const p = sel.root.position, hd = sel.heading;
      const back = new THREE.Vector3(Math.cos(hd), 0, -Math.sin(hd));
      this.camera.position.lerp(new THREE.Vector3(p.x - back.x * 9, p.y + 4, p.z - back.z * 9), Math.min(1, dt * 2.5));
      this.controls.target.lerp(new THREE.Vector3(p.x + back.x * 10, p.y + 1, p.z + back.z * 10), Math.min(1, dt * 3));
    } else if (this.camGoal) {
      this.camera.position.lerp(this.camGoal.pos, Math.min(1, dt * 2));
      this.controls.target.lerp(this.camGoal.target, Math.min(1, dt * 2));
      if (this.camera.position.distanceTo(this.camGoal.pos) < 0.5) this.camGoal = null;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.drawTags(f);
  }

  liftFor(st, tank) {
    const near = (kind) => tank.objects.find((o) => o.kind === kind && Math.hypot(o.x - st.x, o.y - st.y) < (o.r ?? 3) + 0.5);
    if (st.act === 'climb') {
      const coco = near('coconut-hut');
      if (coco) { const d = Math.hypot(coco.x - st.x, coco.y - st.y); return { y: Math.sqrt(Math.max(0, coco.r * coco.r - d * d)) * 0.85 - 0.3, pitch: 0 }; }
      const sp = near('sponge'); if (sp) return { y: sp.r * 1.1, pitch: 0 };
      const rock = near('rock') || near('cork-bark'); if (rock) return { y: rock.r * 0.7, pitch: 0 };
      if (st.x < 3 || st.x > tank.w - 3) return { y: 5 + Math.sin(st.y) * 2, pitch: 0.9 * (st.x < 3 ? 1 : -1) };
      return { y: 1.4, pitch: 0 }; // on the moss
    }
    if (st.act === 'dig') return { y: -0.9, pitch: 0.15 };
    if (st.act === 'drink') return { y: 0.9, pitch: 0 };
    return { y: 0, pitch: 0 };
  }

  drawTags(f) {
    const ov = this.overlay;
    const used = new Set();
    const placed = [];
    for (const { c, st, said, thought, color } of f.crabs) {
      const cr = this.crabs.get(c.id);
      if (!cr) continue;
      used.add(c.id);
      let tag = this.tags.get(c.id);
      if (!tag) {
        tag = document.createElement('div'); tag.className = 'tag3d';
        tag.innerHTML = '<div class="bubbles"></div><button type="button" class="nametag"><i></i><span></span></button>';
        tag.querySelector('button').onclick = () => this.onPick?.(c.id);
        ov.append(tag); this.tags.set(c.id, tag);
      }
      const p = this.toScreen(cr.root.position.clone().add(new THREE.Vector3(0, (st.act === 'molt' ? 1 : c.body.size * CRAB_SCALE * 0.75), 0)));
      const visible = !p.behind && p.x > -50 && p.y > -50 && p.x < ov.clientWidth + 50 && p.y < ov.clientHeight + 50;
      tag.hidden = !visible;
      if (!visible) continue;
      let y = p.y;
      for (const q of placed) if (Math.abs(q.x - p.x) < 95 && Math.abs(q.y - y) < 26) y = q.y - 28;
      placed.push({ x: p.x, y });
      tag.style.transform = `translate(${p.x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      tag.classList.toggle('sel', f.selected === c.id);
      const nameEl = tag.querySelector('span');
      const label = c.name + (st.act === 'molt' ? ' · molting' : '');
      if (nameEl.textContent !== label) nameEl.textContent = label;
      tag.querySelector('i').style.background = color;
      const bub = tag.querySelector('.bubbles');
      const html = (thought && (f.selected === c.id || !said) ? `<div class="think">${esc(thought.text)}</div>` : '') +
        (said ? `<div class="say"><b>${esc(said.form)}</b>${f.gloss && said.gloss ? `<small>${esc(said.gloss.toLowerCase())}</small>` : ''}</div>` : '');
      if (bub._h !== html) { bub.innerHTML = html; bub._h = html; }
    }
    for (const [id, tag] of this.tags) if (!used.has(id)) tag.hidden = true;
  }
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
