// The planet lab. One page, driven by the URL, because the camera, the post chain and the bake are the things under test.
//   ?mode=sheet&px=90       contact sheet, every genome once, at this CSS diameter
//   ?mode=one&i=0&px=700    one planet at World size
//   ?mode=limb&i=0          low orbit, the limb across the frame
//   ?mode=film&i=0&n=6      rotation filmstrip
//   ?mode=fleet&n=20        n planets at System size in a frame, measured
//   ?mode=focus&i=0         one planet in close-up, measured
//   ?mode=empty             the same frame with no planet, the control for both
//   ?mode=probe&i=0         what a bake really costs at each size, blocking on a readback
//   ?mode=coverage          what share of each bake is really water and cloud, against what the genome asked for
//   ?mode=api&i=0&to=2      the whole PlanetFleet surface: add, focus, a designer's genome spreading in, leave, remove
//   ?mode=depth&i=0         hulls in front of and behind a planet with depth written
// Add &size=1024 for the cube size, &t=30 to set the clock, &sun=-0.8,0.3,0.5 for the light, &live to let time run.
import { BloomEffect, EffectComposer, EffectPass, RenderPass } from 'postprocessing';
import * as THREE from 'three';
import { Baker } from './bake.ts';
import { PlanetFleet } from './fleet.ts';
import { PlanetBody, type PlanetFrame, type PlanetSource } from './body.ts';
import { validateGenome } from '@naos/protocol';
import { LAB_DEFAULTS, LAB_WORLDS, type LabWorld } from './lab-genomes.ts';
import { planCities as labCities } from './tables.ts';
import { FinishEffect } from '../Finish.ts';
import { Meter, timedRenderPass } from '../meter.ts';
import { HEX } from '../tokens.ts';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => { const v = q.get(k); return v === null ? d : Number(v); };
const mode = q.get('mode') ?? 'sheet';

interface Report {
  ready: boolean;
  bake?: { ms: number; jobs: number; tiles: number; bytes: number };
  perf?: unknown;
  hitch?: unknown;
  renderer?: string;
}
const report: Report = { ready: false };
(window as unknown as { __lab: Report }).__lab = report;

const canvas = document.createElement('canvas');
document.getElementById('root')!.append(canvas);
const W = innerWidth;
const H = innerHeight;
const dpr = devicePixelRatio;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(dpr);
renderer.setSize(W, H);
renderer.setClearColor(new THREE.Color(HEX.void), 1);
report.renderer = String((renderer.getContext() as WebGL2RenderingContext).getParameter((renderer.getContext() as WebGL2RenderingContext).VERSION));

const scene = new THREE.Scene();
// A long lens for the catalogue, so a planet at the edge of the sheet shows the same phase as one in the middle.
const fov = mode === 'limb' ? num('fov', 38) : num('fov', 3.5);
const camera = new THREE.PerspectiveCamera(fov, W / H, 0.05, 200000);
const D = H / 2 / Math.tan((fov * Math.PI) / 360);
const elevation = num('elev', 0);
camera.position.set(0, Math.sin(elevation) * D, Math.cos(elevation) * D);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld(true);

// The app's lens background covers the frame. Without one, the post chain's clear reuses the colour as last encoded for the screen, and the
// void of every frame past the first comes out too bright. So the void is drawn here too.
const voidColor = new THREE.Color(HEX.void);
const voidMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.9999, 1.0); }',
  fragmentShader: 'uniform vec3 uVoid; void main() { gl_FragColor = vec4(uVoid, 1.0); }',
  uniforms: { uVoid: { value: voidColor } },
  depthTest: false, depthWrite: false, transparent: true, toneMapped: false,
}));
voidMesh.frustumCulled = false;
voidMesh.renderOrder = -100;
scene.add(voidMesh);

const meter = new Meter();
meter.attach(renderer);
const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
composer.addPass(timedRenderPass(meter)(scene, camera));
const finish = new FinishEffect();
(finish.uniforms.get('uDisc')!.value as THREE.Vector3).set(0.5, 0.5, 1e-5);
composer.addPass(new EffectPass(camera, new BloomEffect({ mipmapBlur: true, levels: 6, intensity: 0.5, radius: 0.7, luminanceThreshold: 1, luminanceSmoothing: 0.2 }), finish));
composer.setSize(W, H);

const baker = new Baker(renderer);
const lightDir = (q.get('sun') ?? '-0.74,0.34,0.58').split(',').map(Number) as [number, number, number];
const sunWorld = new THREE.Vector3(...lightDir).normalize();
const source: PlanetSource = {
  position: sunWorld.clone().multiplyScalar(20000),
  normal: new THREE.Vector3(0, 1, 0),
  radius: 20000 * num('soft', 0.11),
  color: new THREE.Color(1.16, 1.09, 1.0),
};

const bodies: PlanetBody[] = [];
// &set=terrain.rifts:1,clouds.coverage:0 changes one knob on every genome, to see what it does.
function overridden(w: LabWorld): LabWorld {
  const set = q.get('set');
  if (!set) return w;
  const g = JSON.parse(JSON.stringify(w.genome)) as Record<string, Record<string, unknown>>;
  for (const pair of set.split(',')) {
    const [path, value] = pair.split(':') as [string, string];
    const [group, key] = path.split('.') as [string, string | undefined];
    if (key === undefined) (g as Record<string, unknown>)[group] = Number(value);
    else g[group]![key] = Number.isNaN(Number(value)) ? value : Number(value);
  }
  return { ...w, genome: validateGenome(g).genome };
}
const WORLDS = (q.has('defaults') ? LAB_DEFAULTS : LAB_WORLDS).map(overridden);
const size = num('size', mode === 'sheet' ? (num('px', 90) > 200 ? 512 : 128) : mode === 'fleet' ? 128 : 1024);

function place(index: number, x: number, y: number, diameter: number, z = 0): PlanetBody {
  const w = WORLDS[index % WORLDS.length]!;
  const b = new PlanetBody(baker, w.genome, { activity: num('activity', 0.4) });
  b.position.set(x, y, z);
  b.radius = diameter / 2;
  b.sunOverride = sunWorld;
  if (q.has('noclouds')) b.debugClouds(false);
  b.setCities(labCities(w.genome.seed, num('cities', 1800)));
  b.request(size, index);
  scene.add(b.group);
  bodies.push(b);
  return b;
}

function caption(x: number, y: number, title: string, sub: string): void {
  const el = document.createElement('div');
  el.className = 'cap';
  el.style.left = `${x + W / 2}px`;
  el.style.top = `${H / 2 - y}px`;
  el.innerHTML = `<b>${title}</b><span>${sub}</span>`;
  document.getElementById('root')!.append(el);
}

if (mode === 'sheet') {
  const px0 = num('px', 90);
  const cols = num('cols', 5);
  const rows = Math.ceil(WORLDS.length / cols);
  const cellW = W / cols;
  const cellH = H / rows;
  WORLDS.forEach((w, i) => {
    const x = -W / 2 + cellW * ((i % cols) + 0.5);
    const y = H / 2 - cellH * (Math.floor(i / cols) + 0.44);
    // A ringed world keeps its rings inside the cell, so its globe is smaller.
    const px = w.genome.rings ? (px0 * 1.3) / w.genome.rings.outer : px0;
    place(i, x, y, px);
    if (!q.has('bare')) caption(x, y - Math.min(cellH * 0.46, px0 * 0.56 + 6), w.name, w.genome.archetype);
  });
} else if (mode === 'one') {
  place(num('i', 0), 0, 0, num('px', 700));
} else if (mode === 'film') {
  const n = num('n', 6);
  const px = num('px', 240);
  const i = num('i', 0);
  const cols = num('cols', n);
  const rows = Math.ceil(n / cols);
  for (let k = 0; k < n; k++) {
    place(i, -W / 2 + (W / cols) * ((k % cols) + 0.5), H / 2 - (H / rows) * (Math.floor(k / cols) + 0.5), px);
  }
} else if (mode === 'limb') {
  const b = place(num('i', 0), 0, 0, 2);
  // Low orbit: the camera a twentieth of a radius up, looking along the horizon with the limb across the frame.
  const altitude = num('alt', 0.14);
  const r = 1 + altitude;
  const pitch = num('pitch', -0.46);
  const lat = num('lat', 0.2);
  const lon = num('lon', 0.6);
  const up = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
  camera.position.copy(up).multiplyScalar(r);
  const forward = new THREE.Vector3(-Math.sin(lon), 0, Math.cos(lon)).applyAxisAngle(up, num('yaw', 0.4));
  camera.up.copy(up);
  camera.lookAt(camera.position.clone().add(forward).addScaledVector(up, pitch));
  camera.updateMatrixWorld(true);
  b.sunOverride = sunWorld;
  b.request(num('size', 1024), 0);
} else if (mode === 'fleet') {
  const n = num('n', 20);
  let seed = 12345;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < n; i++) {
    const px = 20 + rnd() * 70;
    place(i, (rnd() - 0.5) * (W - 100), (rnd() - 0.5) * (H - 100), px);
  }
} else if (mode === 'focus') {
  place(num('i', 0), 0, 0, num('px', 700));
} else if (mode === 'depth') {
  const b = new PlanetBody(baker, LAB_WORLDS[num('i', 0)]!.genome, { writeDepth: true });
  b.radius = num('px', 700) / 2;
  b.sunOverride = sunWorld;
  b.request(size, 0);
  scene.add(b.group);
  bodies.push(b);
  depthScene();
}

let t = num('t', 18);
const live = q.has('live') || mode === 'fleet' || mode === 'focus' || mode === 'empty';
const frame: PlanetFrame = { camera, source, time: t, height: H * dpr };

function present(): void {
  meter.frameStart(renderer);
  composer.render();
  meter.frameEnd(renderer);
}

function draw(dt: number): void {
  frame.time = t;
  bodies.forEach((b, i) => {
    if (mode === 'film') frame.time = t + i * num('step', 14);
    b.update(frame, dt);
  });
  frame.time = t;
  present();
}

// The GPU is shared on this machine, and a frame with nothing in it reads 13 ms on a timer query, because the first real work of a frame
// also pays for the wait in the queue. So a tiny draw and a flush go first and take that wait, and only the planets are timed after it.
function timedLoop(): void {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  if (!ext) return;
  const target = new THREE.WebGLRenderTarget(W * dpr, H * dpr, { type: THREE.HalfFloatType, depthBuffer: false });
  const fenceTarget = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false });
  const fenceScene = new THREE.Scene();
  const fence = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }', depthTest: false,
  }));
  fence.frustumCulled = false;
  fenceScene.add(fence);
  const pending: WebGLQuery[] = [];
  const planet: number[] = [];
  const cpu: number[] = [];
  const seconds = num('seconds', 6);
  let began = 0;
  let last = performance.now();
  const loop = (now: number) => {
    const dt = (now - last) / 1000;
    last = now;
    t += dt;
    while (pending.length && gl.getQueryParameter(pending[0]!, gl.QUERY_RESULT_AVAILABLE)) {
      const query = pending.shift()!;
      const ns = gl.getQueryParameter(query, gl.QUERY_RESULT) as number;
      gl.deleteQuery(query);
      if (began && !gl.getParameter(ext.GPU_DISJOINT_EXT)) planet.push(ns / 1e6);
    }
    const c0 = performance.now();
    frame.time = t;
    for (const b of bodies) b.update(frame, dt);
    renderer.setRenderTarget(fenceTarget);
    renderer.render(fenceScene, camera);
    gl.flush();
    const query = gl.createQuery()!;
    gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, camera);
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    gl.flush();
    renderer.setRenderTarget(null);
    pending.push(query);
    cpu.push(performance.now() - c0);
    if (!began && now - start > 800) began = now;
    if (began && now - began > seconds * 1000) {
      const sorted = [...planet].sort((a, b) => a - b);
      const at = (p: number) => Math.round(sorted[Math.floor(p * (sorted.length - 1))]! * 100) / 100;
      cpu.sort((a, b) => a - b);
      report.perf = { samples: sorted.length, min: at(0), p10: at(0.1), p25: at(0.25), p50: at(0.5), p75: at(0.75), p95: at(0.95), cpuP50: Math.round(cpu[cpu.length >> 1]! * 100) / 100, calls: renderer.info.render.calls, px: renderer.getContext().drawingBufferWidth + 'x' + renderer.getContext().drawingBufferHeight };
      return;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

function readBack(): void {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
}

/** Blocks on a pixel after each bake, so that what is timed is the GPU finishing, not the calls being queued. */
function probe(): void {
  const i = num('i', 0);
  const rows: Record<string, unknown>[] = [];
  readBack();
  for (const px of [128, 512, 1024]) {
    // Twice, because the first run also pays for compiling the programs.
    for (const pass of ['cold', 'warm']) {
      const b = new PlanetBody(baker, LAB_WORLDS[i]!.genome, {});
      b.setCities(labCities(LAB_WORLDS[i]!.genome.seed, 1800));
      b.request(px, 0);
      const t0 = performance.now();
      baker.flush();
      readBack();
      rows.push({ size: px, pass, ms: Math.round((performance.now() - t0) * 10) / 10, mb: Math.round(b.bytes / 1048576) });
      b.dispose();
    }
  }
  report.perf = rows;
}

/** Drives the fleet the way the app will, and shows the replacement half way across the globe. */
async function api(): Promise<void> {
  const fleet = new PlanetFleet(renderer, { writeDepth: true });
  await fleet.warm(camera);
  scene.add(fleet.group);
  const log: Record<string, unknown> = {};
  const from = LAB_WORLDS[num('i', 0)]!;
  const to = LAB_WORLDS[num('to', 2)]!;
  const body = fleet.add('w', from.genome, labCities(from.genome.seed, 400));
  fleet.add('other', LAB_WORLDS[7]!.genome);
  fleet.get('other')!.position.set(num('px', 500) * 2, 0, 0);
  body.radius = fleet.get('other')!.radius = num('px', 500) / 2;
  const f: PlanetFrame = { camera, source, time: 20, height: H * dpr };
  const pump = async (until: () => boolean) => {
    for (let n = 0; n < 900 && !until(); n++) {
      fleet.update(f, 1 / 60);
      present();
      await new Promise(requestAnimationFrame);
    }
  };
  await pump(() => !fleet.busy);
  log.afterAdd = fleet.stats;
  fleet.focus('w', 'world');
  log.focusBusy = fleet.busy;
  await pump(() => !fleet.busy);
  log.afterFocus = fleet.stats;
  fleet.focus('other', 'world');
  await pump(() => !fleet.busy);
  fleet.focus('w', 'world');
  await pump(() => !fleet.busy);
  log.twoClose = fleet.stats;
  fleet.add('third', LAB_WORLDS[3]!.genome);
  fleet.get('third')!.radius = 40;
  fleet.focus('third', 'world');
  await pump(() => !fleet.busy);
  log.closeLimit = fleet.stats;
  fleet.remove('third');
  fleet.remove('other');
  fleet.focus('w', 'world');
  await pump(() => !fleet.busy);
  if (q.has('loss')) {
    // A real loss, through the extension, with the page and the fleet left running.
    const ext = (renderer.getContext() as WebGL2RenderingContext).getExtension('WEBGL_lose_context')!;
    const canvasEvents = new Promise<void>((resolve) => canvas.addEventListener('webglcontextrestored', () => resolve(), { once: true }));
    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault(), { once: true });
    ext.loseContext();
    await new Promise((r) => setTimeout(r, 300));
    ext.restoreContext();
    await canvasEvents;
    meter.attach(renderer);
    fleet.restored();
    log.afterLoss = { ready: fleet.get('w')!.ready, busy: fleet.busy };
    await pump(() => !fleet.busy);
    fleet.update(f, 1 / 60);
    present();
    log.restored = { ready: fleet.get('w')!.ready, stats: fleet.stats };
    report.perf = log;
    report.ready = true;
    return;
  }
  fleet.replace('w', to.genome);
  log.replaceBusy = fleet.busy;
  const stopAt = num('at', 0.55);
  await pump(() => fleet.get('w')!.ready && fleet.get('w')!.reveal >= stopAt);
  log.reveal = fleet.get('w')!.reveal;
  fleet.update(f, 0);
  present();
  report.perf = log;
  report.ready = true;
}

function depthScene(): void {
  const b = bodies[0]!;
  const r = b.radius;
  const hull = (color: number, x: number, z: number) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r * 0.05, 24, 16), new THREE.MeshBasicMaterial({ color, depthTest: true, depthWrite: true, transparent: true }));
    m.position.set(x, 0, z);
    m.renderOrder = 20;
    scene.add(m);
  };
  hull(0x00ff66, 0, r * 1.2);
  hull(0xff2244, r * 0.4, -r * 1.2);
  hull(0x00ff66, r * 1.25, r * 0.1);
  hull(0xff2244, -r * 0.7, -r * 0.3);
}

/** Reads a bake back and measures it, so that a genome's coverage numbers mean what they say. */
function coverage(): void {
  const rows: string[] = [];
  const read = (t: THREE.WebGLCubeRenderTarget, channel: number, cut: number) => {
    const n = t.width;
    const px = new Uint8Array(n * n * 4);
    let hit = 0;
    for (let f = 0; f < 6; f++) {
      renderer.readRenderTargetPixels(t, 0, 0, n, n, px, f);
      for (let i = channel; i < px.length; i += 4) if (px[i]! > cut) hit++;
    }
    return hit / (6 * n * n);
  };
  const base = LAB_WORLDS[0]!.genome;
  for (const seed of [11, 222, 3333, 44444]) {
    for (const c of [0.2, 0.4, 0.6, 0.8]) {
      const g = { ...base, seed, oceans: { ...base.oceans, coverage: c }, clouds: { ...base.clouds, coverage: c } };
      const b = new PlanetBody(baker, g, {});
      b.request(128, 0);
      baker.flush();
      const t = b.bakeForLab!;
      rows.push(`${seed} ask ${c}: water ${read(t.albedo, 3, 127).toFixed(2)} cloud ${read(t.clouds!, 0, 90).toFixed(2)}`);
      b.dispose();
    }
  }
  report.perf = rows;
}

const start = performance.now();
if (mode === 'coverage') {
  coverage();
  report.ready = true;
} else if (mode === 'api') {
  void api();
} else if (mode === 'probe') {
  probe();
  report.ready = true;
} else if (q.has('slow')) {
  // A bake under the budget while frames run, the way the app does it. Longest gap between frames is the number that matters.
  void (async () => {
    const compile0 = performance.now();
    await baker.warm();
    await bodies[0]!.warmUp(camera);
    const compile = Math.round(performance.now() - compile0);
    // The post chain belongs to the app, which has it running long before a planet asks for anything.
    present();
    const deltas: number[] = [];
    const slow: string[] = [];
    let longTask = 0;
    try {
      new PerformanceObserver((list) => { for (const e of list.getEntries()) longTask = Math.max(longTask, e.duration); }).observe({ entryTypes: ['longtask'] });
    } catch { /* no long task API, the gaps still tell */ }
    let last = performance.now();
    const began = last;
    const loop = (now: number) => {
      deltas.push(now - last);
      last = now;
      const s0 = performance.now();
      const more = baker.step();
      const s1 = performance.now();
      draw(1 / 60);
      const s2 = performance.now();
      if (s1 - s0 > 30 || s2 - s1 > 30) slow.push(`frame ${deltas.length}: step ${Math.round(s1 - s0)} draw ${Math.round(s2 - s1)}`);
      if (more) { requestAnimationFrame(loop); return; }
      const total = Math.round(now - began);
      deltas.sort((a, b) => a - b);
      const at = (p: number) => Math.round(deltas[Math.floor(p * (deltas.length - 1))]! * 10) / 10;
      report.hitch = { slow, compileMs: compile, bakeMs: total, frames: deltas.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), maxGap: at(1), longTask: Math.round(longTask) };
      finished();
    };
    requestAnimationFrame(loop);
  })();
} else {
  baker.flush();
  finished();
}

/** What the scene pass cost, on its own, with the rest left out of the report. */
function summary() {
  const s = meter.summary();
  return { frames: s.gpu.count, gpu: s.gpu, scene: s.gpuScene, post: s.gpuPost, cpu: s.cpu.p95, disjoint: s.disjoint, raf: s.raf.p95 };
}

/** Low orbit over the brightest town, seen at night: where the lights of a repo's history are. */
function overCity(): void {
  const b = bodies[0]!;
  const town = [...b.currentCities].sort((x, y) => (y.size ?? 0) - (x.size ?? 0))[num('city', 0)]!;
  const up = b.worldOf(new THREE.Vector3(town.x, town.y, town.z).normalize());
  const side = new THREE.Vector3(0, 1, 0).cross(up).normalize();
  const forward = up.clone().cross(side);
  const altitude = num('alt', 0.1);
  camera.up.copy(up);
  camera.position.copy(up).multiplyScalar(1 + altitude).addScaledVector(forward, -altitude * 0.7);
  camera.lookAt(up);
  camera.updateMatrixWorld(true);
  sunWorld.copy(up).multiplyScalar(-0.5).addScaledVector(side, 0.8).normalize();
}

function finished(): void {
  draw(0);
  if (q.has('overcity')) { overCity(); draw(0); }
  // A body asks for its ground during update, so low orbit takes a few rounds. A shot of a still camera shows the finished region.
  for (let i = 0; i < 6 && baker.busy; i++) { baker.flush(); draw(1); }
  const bytes = bodies.reduce((sum, b) => sum + b.bytes, 0) + baker.region.bytes;
  report.bake = { ms: Math.round(performance.now() - start), jobs: baker.stats.jobs, tiles: baker.stats.tiles, bytes };
  draw(1);
  report.ready = true;
  if (q.has('timed')) { timedLoop(); return; }
  if (!live) return;
  const seconds = num('seconds', 10);
  let recorded = -1;
  let last = performance.now();
  const loop = (now: number) => {
    const dt = (now - last) / 1000;
    last = now;
    t += dt;
    draw(dt);
    meter.raf.push(dt * 1000);
    if (recorded < 0 && now - start > 500) { recorded = now; meter.reset(); meter.recording = true; }
    if (recorded > 0 && now - recorded > seconds * 1000) {
      meter.recording = false;
      report.perf = summary();
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
