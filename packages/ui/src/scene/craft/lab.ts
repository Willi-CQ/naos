// The craft lab, lab-craft.html. Not part of the app: it draws the family on the void under the real bloom and the real Finish, so a shot here
// predicts the product. `?view=` picks the page, and window.lab lets a script drive it without a reload.
import { BloomEffect, EffectComposer, EffectPass } from 'postprocessing';
import * as THREE from 'three';
import { FinishEffect } from '../Finish.ts';
import { Meter, timedRenderPass } from '../meter.ts';
import { linear, type Token } from '../tokens.ts';
import { CraftLayer, shipFrame, type CraftDraw } from './Layer.ts';
import { HULLS, ROLES, craftLength, type CraftKind, type HullClass, type Role } from './kind.ts';
import { assembly, part, PART_IDS } from './parts.ts';

// The values of Stage.tsx, copied so the lab does not break while the app's stage is being rebuilt around it.
const BLOOM = { intensity: 0.5, radius: 0.7, luminanceThreshold: 1, luminanceSmoothing: 0.2 };

const params = new URLSearchParams(location.search);
const view = params.get('view') ?? 'hero';
const num = (name: string, fallback: number): number => {
  const v = params.get(name);
  return v === null ? fallback : Number(v);
};

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false, depth: true, preserveDrawingBuffer: true });
const dpr = window.devicePixelRatio;
renderer.setPixelRatio(dpr);
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x000000, 1);
renderer.info.autoReset = false;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(num('fov', 30), innerWidth / innerHeight, 0.05, 20000);
const meter = new Meter();
meter.attach(renderer);

const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: num('msaa', 0) });
composer.addPass(timedRenderPass(meter)(scene, camera));
const finish = new FinishEffect();
(finish.uniforms.get('uDisc') as THREE.Uniform<THREE.Vector3>).value.set(-9, -9, 0.0001);
const bloom = new BloomEffect({ mipmapBlur: true, ...BLOOM, levels: 8 });
const post = new EffectPass(camera, bloom, finish);
post.dithering = true;
composer.addPass(post);

const layer = new CraftLayer({ base: 10, sync: !params.has('worker') });
scene.add(layer.group);

function backdrop(): void {
  const n = 2600;
  const p = new Float32Array(n * 3);
  const c = new Float32Array(n * 3);
  let seed = 7;
  const r = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < n; i++) {
    const z = r() * 2 - 1;
    const a = r() * Math.PI * 2;
    const q = Math.sqrt(1 - z * z);
    p.set([q * Math.cos(a) * 9000, z * 9000, q * Math.sin(a) * 9000], i * 3);
    const b = Math.pow(r(), 9) * 1.6 + 0.012;
    c.set([b, b * 0.96, b * 0.9], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  const stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.4 * dpr, sizeAttenuation: false, vertexColors: true, toneMapped: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  stars.renderOrder = -10;
  scene.add(stars);
}

const notes = document.getElementById('notes')!;
const note = (x: number, y: number, text: string, cls = ''): void => {
  const d = document.createElement('div');
  d.textContent = text;
  d.className = cls;
  d.style.left = `${x}px`;
  d.style.top = `${y}px`;
  notes.append(d);
};

interface Tone { name: string; tone: Token; gain: number; fill: number; drive?: number; dashed?: boolean; strobe?: number; broken?: number; turn?: number }

const STATES: Tone[] = [
  { name: 'writing\nowned', tone: 'oiii', gain: 2.8, fill: 1, drive: 1 },
  { name: 'generating\nobserved', tone: 'oiii', gain: 2.8, fill: 0, drive: 0.6 },
  { name: 'tool', tone: 'pearl', gain: 2.8, fill: 1 },
  { name: 'approve', tone: 'nad', gain: 2.6, fill: 1 },
  { name: 'source', tone: 'nad', gain: 2.5, fill: 0 },
  { name: 'errored', tone: 'halpha', gain: 2.8, fill: 1, turn: 0.8 },
  { name: 'crashed', tone: 'halpha', gain: 2.8, fill: 1, broken: 1 },
  { name: 'idle', tone: 'ash', gain: 1.3, fill: 0, strobe: 1 },
  { name: 'ready', tone: 'bone', gain: 1.2, fill: 0 },
  { name: 'lost', tone: 'slag', gain: 1.2, fill: 0, dashed: true },
];

let draws: CraftDraw[] = [];

const craft = (kind: CraftKind, at: THREE.Vector3, q: THREE.Quaternion, t: Tone = STATES[2]!, extra: Partial<CraftDraw> = {}): CraftDraw => ({
  kind, position: at, quaternion: q, tone: linear(t.tone), gain: t.gain, fill: t.fill, drive: t.drive ?? 0, dashed: t.dashed ?? false, strobe: t.strobe ?? 0, ...(t.broken === undefined ? {} : { broken: t.broken }), ...extra,
});

const parseShip = (s: string | null): CraftKind => {
  const [hull, role] = (s ?? 'capital:plain').split(':') as [HullClass, Role];
  return { hull, role: role ?? 'plain', size: 'vessel' };
};

const state = { az: num('az', 28), el: num('el', 14), dist: num('dist', 2.3), px: num('px', 0), py: num('py', 0), light: num('light', 200), elight: num('elight', 8) };

/** Puts the disk somewhere around the ship. */
function placeLight(azDeg: number, elDeg: number, r = 5000): void {
  const a = (azDeg * Math.PI) / 180;
  const e = (elDeg * Math.PI) / 180;
  layer.uniforms.uDisk.value.set(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r);
}

function aim(target: THREE.Vector3, az: number, el: number, dist: number): void {
  const a = (az * Math.PI) / 180;
  const e = (el * Math.PI) / 180;
  camera.position.set(target.x + Math.cos(a) * Math.cos(e) * dist, target.y + Math.sin(e) * dist, target.z + Math.sin(a) * Math.cos(e) * dist);
  camera.up.set(0, 1, 0);
  camera.lookAt(target);
  camera.updateMatrixWorld();
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
}

/** A flat page: the camera looks down -z at a plane, so a craft lands on the pixel asked for. One px is `perPx` world units. */
function page(fov = 18): { at: (x: number, y: number) => THREE.Vector3; perPx: number } {
  camera.fov = fov;
  camera.updateProjectionMatrix();
  const dist = 400;
  const worldH = 2 * dist * Math.tan((fov * Math.PI) / 360);
  const perPx = worldH / innerHeight;
  aim(new THREE.Vector3(), 90, 0, dist);
  return { perPx, at: (x, y) => new THREE.Vector3((x - innerWidth / 2) * perPx, (innerHeight / 2 - y) * perPx, 0) };
}

const THREE_QUARTER = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.62, 0.3, -0.22, 'YXZ'));
const NOSE_ON = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1));
const TAIL_ON = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1));

/** The page camera looks down -z. Five ways a free camera can meet a ship, and the fade has to hold in all of them. */
const POSES: Array<{ name: string; q: THREE.Quaternion; light: [number, number] }> = [
  { name: 'lit', q: THREE_QUARTER, light: [68, 32] },
  { name: 'backlit', q: THREE_QUARTER, light: [-90, 14] },
  { name: 'head on', q: NOSE_ON, light: [68, 32] },
  { name: 'tail on', q: TAIL_ON, light: [68, 32] },
  { name: 'head on, backlit', q: NOSE_ON, light: [-90, 14] },
];

function setupHero(): void {
  backdrop();
  const kind = parseShip(params.get('ship'));
  const t = STATES[num('state', 2)]!;
  draws = [craft(kind, new THREE.Vector3(), new THREE.Quaternion(), t, { drive: num('drive', t.drive ?? 0), ring: num('ring', 0) })];
  if (params.has('body')) {
    const q = params.get('body')!.split(',').map(Number) as [number, number, number];
    layer.uniforms.uBody.value.set(q[0], q[1], q[2], num('bodyr', 60));
  }
  placeLight(state.light, state.elight);
}

function setupSheet(): void {
  const cols = ROLES.length;
  const left = 56;
  const cellW = (innerWidth - left) / cols;
  const cellH = (innerHeight - 30) / HULLS.length;
  const { at, perPx } = page();
  placeLight(68, 32);
  const q = THREE_QUARTER;
  HULLS.forEach((hull, r) => {
    note(8, 30 + cellH * (r + 0.42), hull, 'left');
    ROLES.forEach((role, c) => {
      const x = left + cellW * (c + 0.5);
      const y = 30 + cellH * (r + 0.46);
      const kind: CraftKind = { hull, role, size: 'vessel' };
      const asm = assembly(hull, role);
      const length = (Math.min(cellW * 0.86, cellH * 1.7) * perPx * asm.length) / (asm.radius * 2);
      const shift = new THREE.Vector3(...asm.centre).multiplyScalar(-length / asm.length).applyQuaternion(q);
      draws.push(craft(kind, at(x, y).add(shift), q, STATES[0], { length, drive: 0, ring: 0.2 }));
    });
  });
  ROLES.forEach((role, c) => note(left + cellW * (c + 0.5), 8, role, 'title'));
}

/** The whole family at true size, as the system view shows it, in both fills and at free headings. */
function setupMarks(): void {
  const { at } = page();
  placeLight(68, 32);
  const pitch = 40;
  const block = (ox: number, oy: number, title: string, t: Tone, turning: boolean, size: CraftKind['size'] = 'vessel'): void => {
    note(ox + (ROLES.length * pitch) / 2, oy - 26, title, 'title');
    HULLS.forEach((hull, r) => ROLES.forEach((role, c) => {
      const angle = turning ? (r * 2.399 + c * 1.1) : 0;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle);
      draws.push(craft({ hull, role, size }, at(ox + pitch * (c + 0.5), oy + pitch * (r + 0.5)), q, t, { length: 0.001 }));
    }));
  };
  block(30, 40, 'owned, filled', STATES[0]!, false);
  block(310, 40, 'observed, outline', STATES[1]!, false);
  block(590, 40, 'tool, free headings', STATES[2]!, true);
  block(870, 40, 'source, free headings', STATES[4]!, true);
  block(30, 300, 'tender, 11 px, filled', STATES[0]!, false, 'tender');
  block(310, 300, 'tender, 11 px, outline', STATES[1]!, false, 'tender');
  block(590, 300, 'lost, dashed', STATES[9]!, false);
  block(870, 300, 'idle', STATES[7]!, true);
}

/** Every state on one ship at the sizes it is seen at. State beats kind, so this page matters more than the beauty shot. */
function setupStates(): void {
  const kind = parseShip(params.get('ship') ?? 'cruiser:tug');
  const { at, perPx } = page();
  placeLight(68, 32);
  const cols = STATES.length;
  const cellW = (innerWidth - 20) / cols;
  const sizes = [0.1, num('s1', 40), num('s2', 70), num('big', 130)];
  const ys = [76, 170, num('y2', 280), num('y3', 430)];
  const asm = assembly(kind.hull, kind.role);
  STATES.forEach((t, c) => {
    const x = 10 + cellW * (c + 0.5);
    note(x, 8, t.name, 'title');
    sizes.forEach((s, r) => {
      const q = t.turn ? THREE_QUARTER.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0.3, 0.4, 0.86).normalize(), t.turn)) : THREE_QUARTER;
      const length = s * perPx;
      const shift = new THREE.Vector3(...asm.centre).multiplyScalar(-length / asm.length).applyQuaternion(q);
      draws.push(craft(kind, at(x, ys[r]!).add(shift), q, t, { length, ring: 0.3 }));
    });
  });
  ['mark', `${sizes[1]} px`, `${sizes[2]} px`, `${sizes[3]} px`].forEach((text, r) => note(4, ys[r]! - 30, text, 'left'));
}

/** One ship stepping through the zoom where its two bodies trade places. */
function setupFade(): void {
  const kind = parseShip(params.get('ship') ?? 'capital:command');
  const { at, perPx } = page();
  const pose = POSES[num('pose', 0)]!;
  placeLight(pose.light[0], pose.light[1]);
  const steps = [12, 16, 19, 22, 25, 28, 32, 36, 40, 46, 52, 60];
  const pitch = (innerWidth - 40) / steps.length;
  [STATES[0]!, STATES[1]!, STATES[3]!].forEach((t, row) => {
    steps.forEach((s, i) => {
      draws.push(craft(kind, at(20 + pitch * (i + 0.5), 90 + row * 120), pose.q, t, { length: s * perPx }));
      if (row === 0) note(20 + pitch * (i + 0.5), 14, `${s} px`);
    });
  });
  note(8, 40, pose.name, 'left');
}

/** A ship in a stated pose at a stated length on screen, for the measured crossfade. */
function setupOne(): void {
  const kind = parseShip(params.get('ship') ?? 'capital:command');
  const { at, perPx } = page();
  const pose = POSES[num('pose', 0)]!;
  placeLight(pose.light[0], pose.light[1]);
  draws = [craft(kind, at(innerWidth / 2, innerHeight / 2), pose.q, STATES[num('state', 0)], { length: num('s', 40) * perPx })];
  lab.resize = (s) => { draws[0]!.length = s * perPx; frame(); frame(); };
}

/** Craft flying a circle in the system plane, far enough off to be marks, so a free camera can prove that each keeps its heading. */
function setupOrbit(): void {
  camera.fov = 22;
  camera.updateProjectionMatrix();
  placeLight(68, 26);
  const R = 300;
  const kinds: CraftKind[] = [];
  for (const hull of ['capital', 'cruiser', 'scout', 'longrange'] as HullClass[]) for (const role of ['tug', 'probe', 'command'] as Role[]) kinds.push({ hull, role, size: 'vessel' });
  kinds.forEach((kind, i) => {
    const a = (i / kinds.length) * Math.PI * 2;
    const outward = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const tangent = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
    const q = shipFrame(tangent, outward, 0, 0, new THREE.Quaternion());
    draws.push(craft(kind, outward.clone().multiplyScalar(R), q, STATES[i % 3 === 0 ? 0 : i % 3 === 1 ? 3 : 2]!, { length: 0.001 }));
  });
  orbiting = true;
  aim(new THREE.Vector3(), state.az, state.el, 1800);
}

/** A fleet on a shell around a point, in the mix of models and types a real day has. */
function setupBench(): void {
  const n = num('n', 20);
  const zoom = params.get('zoom') ?? 'world';
  const mix: Array<[HullClass, Role]> = [['cruiser', 'tug'], ['scout', 'probe'], ['capital', 'command'], ['cruiser', 'survey'], ['scout', 'probe'], ['cruiser', 'tug'], ['capital', 'tug'], ['longrange', 'tug'], ['default', 'plain'], ['scout', 'tug']];
  const R = zoom === 'system' ? 900 : zoom === 'world' ? 95 : 60;
  placeLight(68, 26);
  backdrop();
  for (let i = 0; i < n; i++) {
    const y = 1 - ((i + 0.5) / n) * 2;
    const a = i * 2.39996;
    const q = Math.sqrt(1 - y * y);
    const p = new THREE.Vector3(Math.cos(a) * q * R, y * R * 0.5, Math.sin(a) * q * R);
    const [hull, role] = mix[i % mix.length]!;
    const size = i % 4 === 3 ? 'tender' : i % 9 === 8 ? 'bead' : 'vessel';
    const look = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
    draws.push(craft({ hull, role: size === 'bead' ? 'drone' : role, size }, p, look, STATES[i % STATES.length]!, { ring: 0.1, ...(zoom === 'close' && i === 0 ? { length: 10 } : {}) }));
  }
  if (zoom === 'close') {
    draws[0]!.kind = { hull: 'capital', role: 'tug', size: 'vessel' };
    draws[0]!.position.set(0, 0, 0);
    camera.fov = 24;
    camera.updateProjectionMatrix();
    aim(new THREE.Vector3(1.4, 0, 0), 38, 12, 8.5);
  } else {
    camera.fov = 26;
    camera.updateProjectionMatrix();
    aim(new THREE.Vector3(), 30, 22, zoom === 'system' ? 6000 : 300);
  }
}

let addCpu = 0;
let orbiting = false;
const frame = (): void => {
  camera.updateMatrixWorld();
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  meter.frameStart(renderer);
  const c0 = performance.now();
  layer.begin(camera, { w: innerWidth, h: innerHeight }, dpr);
  for (const d of draws) layer.add(d);
  layer.commit(renderer);
  addCpu = performance.now() - c0;
  composer.render();
  meter.frameEnd(renderer);
};

const lab = {
  set(next: Partial<typeof state> & { ring?: number; drive?: number; turn?: number }): void {
    const { ring, drive, turn, ...rest } = next;
    Object.assign(state, rest);
    if (view === 'hero') aim(new THREE.Vector3(state.px, state.py, 0), state.az, state.el, state.dist * craftLength(parseShip(params.get('ship')), layer.base));
    if (orbiting) aim(new THREE.Vector3(), state.az, state.el, 1800);
    if (next.light !== undefined || next.elight !== undefined) placeLight(state.light, state.elight);
    for (const d of draws) {
      if (ring !== undefined) d.ring = ring;
      if (drive !== undefined) d.drive = drive;
      if (turn !== undefined) d.quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), turn);
    }
    frame();
    frame();
  },
  /** Takes whole layers out of the render, for an A/B on one page. By render order: ships 15, marks 30, glints 45. */
  hide(names: string[]): void {
    const order: Record<number, string> = { 15: 'ships', 30: 'marks', 45: 'glints' };
    layer.group.traverse((o) => { o.layers.set(names.includes(order[o.renderOrder] ?? '') ? 1 : 0); });
  },
  tick: () => frame(),
  calls: () => meter.lastCalls,
  /** Puts a world on the line to the disk, or takes it away. */
  body(on: boolean | null): void {
    const d = layer.uniforms.uDisk.value;
    layer.uniforms.uBody.value.set(d.x * 0.2, d.y * 0.2, d.z * 0.2, on ? 400 : 0);
    frame();
    frame();
  },
  /** Mean light on the page right now, read back from the canvas. */
  light(): number {
    const gl = renderer.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) sum += px[i]! + px[i + 1]! + px[i + 2]!;
    return sum / (3 * 255 * w * h);
  },
  resize: undefined as undefined | ((s: number) => void),
  /** Mean light across a zoom, for each size asked. The fade is judged on this curve, in every pose. */
  sweep(from: number, to: number, step: number): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    for (let s = from; s < to; s *= step) {
      lab.resize!(s);
      out.push([Math.round(s * 100) / 100, lab.light()]);
    }
    return out;
  },
  stats: () => ({ ...layer.stats, cpuMs: Math.round(addCpu * 100) / 100 }),
  async measure(ms: number): Promise<unknown> {
    meter.reset();
    meter.recording = true;
    let cpuSum = 0;
    let n = 0;
    const end = performance.now() + ms;
    await new Promise<void>((done) => {
      const step = (): void => {
        for (const d of draws) if (d.ring !== undefined) d.ring += 0.01;
        frame();
        cpuSum += addCpu;
        n += 1;
        if (performance.now() < end) requestAnimationFrame(step); else done();
      };
      requestAnimationFrame(step);
    });
    meter.recording = false;
    await new Promise((r) => setTimeout(r, 200));
    meter.collect();
    const m = meter.summary();
    return {
      timer: meter.hasTimer, frames: m.rendered, gpuP50: m.gpu.p50, gpuP95: m.gpu.p95, pre: m.gpuPre.p95, scene: m.gpuScene.p95, post: m.gpuPost.p95,
      layerCpuMean: Math.round((cpuSum / Math.max(1, n)) * 100) / 100, calls: m.calls, triangles: m.triangles, layer: { ...layer.stats },
    };
  },
  parts: () => PART_IDS.map((id) => {
    const t0 = performance.now();
    const p = part(id);
    return { id, near: p.near.triangles, far: p.far.triangles, field: [p.field.nx, p.field.ny, p.field.nz], ms: Math.round((performance.now() - t0) * 10) / 10 };
  }),
};
(window as unknown as { lab: typeof lab }).lab = lab;

function run(): void {
  if (view === 'hero') {
    setupHero();
    aim(new THREE.Vector3(state.px, state.py, 0), state.az, state.el, state.dist * craftLength(parseShip(params.get('ship')), layer.base));
  } else if (view === 'sheet') setupSheet();
  else if (view === 'marks') setupMarks();
  else if (view === 'states') setupStates();
  else if (view === 'fade') setupFade();
  else if (view === 'one') setupOne();
  else if (view === 'bench') setupBench();
  else if (view === 'orbit') setupOrbit();
  frame();
  frame();
  (window as unknown as { labReady: boolean }).labReady = true;
}

run();
