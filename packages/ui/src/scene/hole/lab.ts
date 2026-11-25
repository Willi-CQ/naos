// The hole on its own page, through the same bloom and finish as the Stage. Drag to orbit, wheel to zoom. window.__hole drives it from
// headless Edge: scripts/shot.mjs --url http://127.0.0.1:<port>/lab-hole.html --eval "..."
import { BloomEffect, EffectComposer, EffectPass } from 'postprocessing';
import * as THREE from 'three';
import { Meter, timedRenderPass } from '../meter.ts';
import { buildNoiseTexture } from '../noise.ts';
import { cubeSky } from '../skyChunk.ts';
import { FLARE_LIFE, type Arc, type Flare } from './disk.ts';
import { BC, shadowAngle } from './geodesic.ts';
import { Hole, HOLE_DEFINES, lensChunk, prepareHole, stageSky } from './hole.ts';
import { HoleFinishEffect } from './HoleFinish.ts';
import { fullscreenTriangle } from '../materials.ts';
import labSky from './shaders/lab-sky.glsl?raw';
import labMarch from './shaders/lab-march.frag?raw';
import holeVert from './shaders/hole.vert?raw';

// The numbers of Stage.tsx. Copied, because the lab must load while others rework the Stage. Keep them in step.
const BLOOM = { intensity: 0.5, radius: 0.7, luminanceThreshold: 1, luminanceSmoothing: 0.2 };

await prepareHole();

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => { const v = q.get(k); return v === null ? d : Number(v); };

const view = {
  az: num('az', 0), el: num('el', 8), dist: num('dist', 150), fov: num('fov', 18), roll: num('roll', 20),
  quota: num('q', 1), clock: num('clock', 2), turbulence: num('turb', 1), doppler: num('doppler', 0.3), images: num('images', 4),
  sky: num('sky', 0), spin: num('spin', 0.12), orbitR: num('orbitR', 0), ballAz: 0,
};
const arcs: Arc[] = [];
const flares: Flare[] = [];
const bead = { azimuth: 0.9, strength: 0 };
const dpr = num('dpr', Math.min(devicePixelRatio, 2));

const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
renderer.setPixelRatio(dpr);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.NoToneMapping;
document.getElementById('root')!.append(renderer.domElement);

const camera = new THREE.PerspectiveCamera(view.fov, innerWidth / innerHeight, 1, 1e5);
const scene = new THREE.Scene();
const noise = buildNoiseTexture();
const starDir = new THREE.Vector3(0, 0, -1);
const skyMode = { value: view.sky };
const direct = { sky: labSky, skyUniforms: { uSkyMode: skyMode, uStarDir: { value: starDir }, uSkyNoise: { value: noise } } };

// ?cube=1024 paints the lab sky into a cube first and looks at it through the lens, exactly as the Stage does with passes.skyCube. With
// &crisp=1 a screen target of the same sky joins it, which is the whole of the Stage's sky path.
const skyCube = new THREE.WebGLCubeRenderTarget(num('cube', 1024), { type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
const cubeUniform = { value: skyCube.texture };
if (q.has('cube')) {
  const cubeScene = new THREE.Scene();
  const quad = new THREE.Mesh(fullscreenTriangle(), new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: 'out vec3 vDir; void main() { vDir = (inverse(projectionMatrix * mat4(mat3(viewMatrix))) * vec4(position.xy, 1.0, 1.0)).xyz; gl_Position = vec4(position.xy, 1.0, 1.0); }',
    fragmentShader: `${labSky}\nin vec3 vDir;\nout vec4 o;\nvoid main() { vec3 d = normalize(vDir); o = vec4(holeSky(d, dFdx(d), dFdy(d)), 1.0); }`,
    uniforms: direct.skyUniforms,
    depthTest: false, depthWrite: false, toneMapped: false,
  }));
  quad.frustumCulled = false;
  cubeScene.add(quad);
  const cubeCamera = new THREE.CubeCamera(0.1, 10, skyCube);
  const paint = () => {
    skyCube.texture.needsPMREMUpdate = false;
    cubeCamera.update(renderer, cubeScene);
  };
  paint();
}
const skyTarget = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
const targetUniform = { value: skyTarget.texture };
const skyScene = new THREE.Scene();
const skyRay = new THREE.Matrix3();
if (q.has('crisp')) {
  const quad = new THREE.Mesh(fullscreenTriangle(), new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: holeVert,
    fragmentShader: `${labSky}\nin vec3 vRay;\nout vec4 o;\nvoid main() { vec3 d = normalize(vRay); o = vec4(holeSky(d, dFdx(d), dFdy(d)), 1.0); }`,
    uniforms: { ...direct.skyUniforms, uHoleRay: { value: skyRay } },
    depthTest: false, depthWrite: false, toneMapped: false,
  }));
  quad.frustumCulled = false;
  skyScene.add(quad);
}
const hole = new Hole(q.has('crisp') ? stageSky(targetUniform, cubeUniform) : q.has('cube') ? cubeSky(cubeUniform) : direct);
scene.add(hole.group);

// ?march=128 swaps the shader for plain RK4 along every ray, to measure the road not taken.
if (q.has('march')) {
  hole.mesh.material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: holeVert,
    fragmentShader: `${lensChunk}\n${labMarch}`,
    defines: HOLE_DEFINES,
    uniforms: { ...hole.material.uniforms, uSteps: { value: num('march', 128) } },
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  hole.front.visible = false;
  hole.cap.visible = false;
}

// A plain lit ball, to see the disk pass in front of what is behind it. It writes depth, and it is drawn as a planet is, with no test.
const ball = new THREE.Mesh(new THREE.SphereGeometry(num('planetR', 2.2), 48, 32), new THREE.MeshLambertMaterial({ color: '#7f9fc4', transparent: true, depthFunc: THREE.AlwaysDepth, toneMapped: false }));
if (q.has('planet')) {
  ball.position.set(num('px', 7), num('py', -0.6), num('pz', -14)).applyAxisAngle(new THREE.Vector3(0, 0, 1), (view.roll * Math.PI) / 180);
  ball.renderOrder = 9;
  scene.add(ball);
  const sun = new THREE.DirectionalLight('#fff', 3);
  sun.position.set(-3, 2, 4);
  scene.add(sun, new THREE.AmbientLight('#fff', 0.4));
}

const meter = new Meter();
meter.attach(renderer);
const composer = new EffectComposer(renderer, { multisampling: 0, frameBufferType: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false });
composer.addPass(timedRenderPass(meter)(scene, camera));
const bloom = new BloomEffect({ mipmapBlur: true, levels: num('levels', 6), ...BLOOM });
const finish = new HoleFinishEffect();
const effects = new EffectPass(camera, bloom, finish);
effects.dithering = true;
composer.addPass(effects);
composer.setSize(innerWidth, innerHeight);

function place() {
  const az = (view.az * Math.PI) / 180;
  const el = (Math.max(-89.9, Math.min(89.9, view.el)) * Math.PI) / 180;
  camera.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(view.dist);
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 0, 0);
  camera.fov = view.fov;
  camera.updateProjectionMatrix();
  hole.tilt.setFromAxisAngle(new THREE.Vector3(0, 0, 1), (view.roll * Math.PI) / 180);
  hole.doppler = view.doppler;
  hole.images = view.images;
  skyMode.value = view.sky;
}

function draw() {
  place();
  hole.setLaws({ quota: view.quota, clock: view.clock, turbulence: view.turbulence, arcs, flares, ...(bead.strength > 0 ? { bead } : {}) });
  hole.update(camera);
  if (q.has('planet')) {
    if (view.orbitR > 0) ball.position.set(Math.sin(view.ballAz) * view.orbitR, 0, Math.cos(view.ballAz) * view.orbitR).applyAxisAngle(new THREE.Vector3(0, 0, 1), (view.roll * Math.PI) / 180);
    ball.material.opacity = q.has('nofade') ? 1 : hole.bodyFade(ball.position, num('planetR', 2.2), camera);
  }
  if (q.has('crisp')) {
    const w = renderer.domElement.width;
    const h = renderer.domElement.height;
    if (skyTarget.width !== w || skyTarget.height !== h) skyTarget.setSize(w, h);
    const turn = new THREE.Matrix4().extractRotation(camera.matrixWorld);
    const c = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(camera.projectionMatrixInverse).applyMatrix4(turn);
    const a = c(0, 0, 1);
    const b = c(1, 0, 1).sub(a);
    const d = c(0, 1, 1).sub(a);
    skyRay.set(b.x, d.x, a.x, b.y, d.y, a.y, b.z, d.z, a.z);
    renderer.setRenderTarget(skyTarget);
    renderer.render(skyScene, camera);
    renderer.setRenderTarget(null);
  }
  meter.frameStart(renderer);
  composer.render();
  meter.frameEnd(renderer);
}

// The worst stall on the main thread while the shader links.
let longest = 0;
new PerformanceObserver((list) => { for (const e of list.getEntries()) longest = Math.max(longest, e.duration); }).observe({ entryTypes: ['longtask'] });
const c0 = performance.now();
place();
hole.update(camera);
await hole.precompile(renderer, camera);
const linkMs = performance.now() - c0;
draw();
const drawMs = performance.now() - c0 - linkMs;
renderer.getContext().finish();
const firstDrawMs = performance.now() - c0;

let paused = q.has('pause');
let orbiting = num('orbit', 0);
let last = performance.now();
function loop(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!paused) view.clock += view.spin * dt;
  for (let i = flares.length - 1; i >= 0; i--) {
    flares[i]!.age += paused ? 0 : dt;
    if (flares[i]!.age >= FLARE_LIFE) flares.splice(i, 1);
  }
  view.az += orbiting * dt;
  if (live) draw();
  requestAnimationFrame(loop);
}
let live = true;
requestAnimationFrame(loop);

let drag: { x: number; y: number } | null = null;
addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; });
addEventListener('pointerup', () => { drag = null; });
addEventListener('pointermove', (e) => {
  if (!drag) return;
  view.az -= (e.clientX - drag.x) * 0.25;
  view.el = Math.max(-89.9, Math.min(89.9, view.el + (e.clientY - drag.y) * 0.25));
  drag = { x: e.clientX, y: e.clientY };
});
addEventListener('wheel', (e) => { view.dist = Math.max(4, view.dist * Math.exp(e.deltaY * 0.001)); }, { passive: true });
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

interface Sheet { views: Partial<typeof view>[]; cols: number; w: number; h: number }

const api = {
  view,
  hole,
  renderer,
  set(v: Partial<typeof view>) { Object.assign(view, v); draw(); },
  pause(p = true) { paused = p; },
  orbit(deg: number) { orbiting = deg; },
  flare(azimuth: number, strength = 1, age = 0) { flares.push({ azimuth, strength, age, clock: view.clock }); },
  bead(strength: number, azimuth = 0.9) { bead.strength = strength; bead.azimuth = azimuth; },
  arcs(list: Arc[]) { arcs.length = 0; arcs.push(...list); },
  flares(list: Flare[]) { flares.length = 0; flares.push(...list); },
  info() {
    const gl = renderer.getContext();
    const d = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      buffer: [renderer.domElement.width, renderer.domElement.height],
      mp: (renderer.domElement.width * renderer.domElement.height) / 1e6,
      linkMs,
      drawMs,
      firstDrawMs,
      longest,
      rc: hole.rc,
      shadowPx: (Math.tan(shadowAngle(hole.rc)) / Math.tan((view.fov * Math.PI) / 360)) * renderer.domElement.height / 2,
      bc: BC,
      renderer: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : null,
    };
  },
  /** Timer queries over a span at the page's rAF rate. */
  async gpu(ms: number) {
    meter.reset();
    meter.recording = true;
    await new Promise((r) => setTimeout(r, ms));
    meter.recording = false;
    await new Promise((r) => setTimeout(r, 150));
    const stats = (a: number[]) => {
      const v = [...a].sort((x, y) => x - y);
      const at = (p: number) => Math.round((v[Math.floor(p * (v.length - 1))] ?? 0) * 100) / 100;
      return { n: v.length, p10: at(0.1), p50: at(0.5), p95: at(0.95) };
    };
    return { hole: stats(meter.sceneMs), post: stats(meter.post), total: stats(meter.gpu), cpu: stats(meter.cpu), disjoint: meter.disjoint };
  },
  /**
   * Flicker in motion. Three frames a tiny step apart: a stable image changes smoothly, so the middle frame sits between its
   * neighbours. Returns the mean absolute excess over that, in 8 bit levels, and the share of pixels off by more than 6 levels.
   */
  flicker(step: Partial<typeof view>, stepCount = 8) {
    const gl = renderer.getContext();
    const w = renderer.domElement.width;
    const h = renderer.domElement.height;
    const read = () => {
      const px = new Uint8Array(w * h * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px;
    };
    live = false;
    const frames: Uint8Array[] = [];
    for (let i = 0; i <= stepCount; i++) {
      for (const k of Object.keys(step) as (keyof typeof view)[]) (view[k] as number) += step[k] as number;
      draw();
      frames.push(read());
    }
    live = true;
    let sum = 0;
    let bad = 0;
    let n = 0;
    for (let f = 1; f < frames.length - 1; f++) {
      const a = frames[f - 1]!;
      const b = frames[f]!;
      const c = frames[f + 1]!;
      for (let i = 0; i < b.length; i += 4) {
        const y0 = (a[i]! + 2 * a[i + 1]! + a[i + 2]!) / 4;
        const y1 = (b[i]! + 2 * b[i + 1]! + b[i + 2]!) / 4;
        const y2 = (c[i]! + 2 * c[i + 1]! + c[i + 2]!) / 4;
        const off = Math.abs(y1 - (y0 + y2) / 2);
        sum += off;
        if (off > 6) bad++;
        n++;
      }
    }
    return { mean: Math.round((sum / n) * 1000) / 1000, over6: Math.round((bad / n) * 1e5) / 1e5 };
  },
  /** Draws many views into one 2D canvas on top of the page. The screenshot then holds a filmstrip. */
  async sheet({ views, cols, w, h }: Sheet) {
    live = false;
    const scale = renderer.domElement.width / innerWidth;
    const sheet = document.createElement('canvas');
    const rows = Math.ceil(views.length / cols);
    sheet.width = cols * w;
    sheet.height = rows * h;
    const ctx = sheet.getContext('2d', { alpha: false })!;
    for (let i = 0; i < views.length; i++) {
      Object.assign(view, views[i]);
      draw();
      const sw = renderer.domElement.width;
      const sh = renderer.domElement.height;
      const k = Math.max(w / sw, h / sh);
      const cw = w / k;
      const ch = h / k;
      ctx.drawImage(renderer.domElement, (sw - cw) / 2, (sh - ch) / 2, cw, ch, (i % cols) * w, Math.floor(i / cols) * h, w, h);
      await new Promise((r) => requestAnimationFrame(r));
    }
    sheet.style.cssText = `position:fixed;left:0;top:0;width:${sheet.width / scale}px;height:${sheet.height / scale}px;z-index:10`;
    document.body.append(sheet);
    return { width: sheet.width, height: sheet.height };
  },
};
(window as unknown as { __hole: typeof api }).__hole = api;
