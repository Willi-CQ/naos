// The canvas, the two offscreen passes, the cadence driver, the context guard and the post chain. DESIGN 7.1, 7.8 and 11.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type ReactNode, type Ref } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, wrapEffect } from '@react-three/postprocessing';
import { BloomEffect, EffectPass, type EffectComposer as Composer, type RenderPass } from 'postprocessing';
import * as THREE from 'three';
import type { Rect } from '../core/layout.ts';
import { HOLE_RADIUS } from '../core/space.ts';
import { BATTERY_CAP_HZ, CADENCE_HZ, type Cadence, type Tier } from '../core/tiers.ts';
import { cssPerUnit, toCanvasPx, type SkyFrame } from './camera.ts';
import { StageContext, useStage, type StageUniforms } from './context.ts';
import { FinishEffect } from './Finish.ts';
import { Hole, prepareHole, stageSky } from './hole/hole.ts';
import { HoleFinishEffect } from './hole/HoleFinish.ts';
import { HoleLayer } from './hole/HoleLayer.tsx';
import { fullscreenTriangle, shader } from './materials.ts';
import { buildNoiseTexture } from './noise.ts';
import { RA_NOW, RA_STEP, type SkyData, type SkyPoints } from './sky.ts';
import { createFrameUniforms, MAX_WAVES, MAX_WELLS, type SceneState } from './state.ts';
import { HEX, linear } from './tokens.ts';
import skyDirVert from './shaders/sky-dir.vert?raw';
import skyFillFrag from './shaders/sky-fill.frag?raw';
import skyGlowFrag from './shaders/sky-glow.frag?raw';
import skyLineFrag from './shaders/sky-line.frag?raw';
import skyLineVert from './shaders/sky-line.vert?raw';
import skyPointFrag from './shaders/sky-point.frag?raw';
import skyPointVert from './shaders/sky-point.vert?raw';
import skyLandmarkFrag from './shaders/sky-landmark.frag?raw';
import { landmarkStars } from './landmarks.ts';

/** Radius of the stand-in disc, world units. It no longer depends on the window. */
export const discRadius = (_free?: Rect): number => HOLE_RADIUS;

/** The environment cube's face at Umbra, px. Packed floats, four bytes a texel: 33.5 MiB with its mips, 18.8 at Corona, 8.4 at Penumbra. */
const CUBE_FACE = 1024;
const GLOW_FACE = 256;
/** A month can only change this often. Six faces of 40,000 points are not worth redrawing for every landing. */
const CUBE_EVERY_MS = 30_000;

/** Half width of a meridian in CSS px. uWidthPx turns it into sky target px. */
const LINE_HALF_WIDTH_CSS = 0.62;

// Intensity is 0.5, not the 0.6 of DESIGN 7.8: the library sums its levels to 1, the stills to 0.35, and 0.5 lands nearest.
export const BLOOM = { intensity: 0.5, radius: 0.7, luminanceThreshold: 1, luminanceSmoothing: 0.2 };
export type BloomSettings = typeof BLOOM;

const px = new THREE.Vector2();
const buffer = new THREE.Vector2();

// R3F 9.8 still builds a THREE.Clock it never needs from us, and three 0.186 warns about that once per root. Everything else passes.
THREE.setConsoleFunction((type, message: string, ...rest: unknown[]) => {
  if (!message.startsWith('THREE.Clock:')) console[type as 'log' | 'warn' | 'error'](message, ...rest);
});

function points(data: SkyPoints, uniforms: Record<string, THREE.IUniform>, fragment = skyPointFrag): THREE.Points {
  const g = new THREE.BufferGeometry();
  const dir = new THREE.BufferAttribute(data.dir, 3);
  g.setAttribute('position', dir);
  g.setAttribute('aDir', dir);
  g.setAttribute('aColor', new THREE.BufferAttribute(data.color, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(data.size, 1));
  const object = new THREE.Points(g, shader(skyPointVert, fragment, uniforms));
  object.frustumCulled = false;
  return object;
}

function lines(data: SkyData['lines'], uniforms: Record<string, THREE.IUniform>): THREE.Mesh {
  const segments = 128;
  const position = new Float32Array((segments + 1) * 6);
  const index: number[] = [];
  for (let i = 0; i <= segments; i++) {
    position.set([i / segments, -1, 0, i / segments, 1, 0], i * 6);
    if (i < segments) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setIndex(index);
  g.setAttribute('iRa', new THREE.InstancedBufferAttribute(data.ra, 1));
  g.setAttribute('iDec', new THREE.InstancedBufferAttribute(data.dec, 2));
  g.setAttribute('iColor', new THREE.InstancedBufferAttribute(data.color, 4));
  g.setAttribute('iFade', new THREE.InstancedBufferAttribute(data.fade, 1));
  g.instanceCount = data.count;
  const object = new THREE.Mesh(g, shader(skyLineVert, skyLineFrag, uniforms));
  object.frustumCulled = false;
  return object;
}

/**
 * The sky as a place, INTERSTELLAR 21. Stars are directions, so a turn of the camera moves them and a flight does not. Three stores:
 * - the sky target, the size of the canvas, drawn only when the camera moved or the sky changed. Stars are points in it, so they stay crisp.
 * - a small cube of diffuse light, baked once a month, because six octaves of noise have no business running per pixel per frame.
 * - the environment cube, drawn when the month changes. The hole samples it along a bent ray, with mips for the squeezed images near the
 *   shadow, as `passes.skyCube`. A cube rendered by three needs no flip: sample it with the world direction as it is.
 */
function SkyPass({ data, frame, tier, free, camera }: { data: SkyData; frame: SkyFrame; tier: Tier; free: Rect; camera: THREE.Camera }) {
  const { state, passes } = useStage();
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const pass = useMemo(() => {
    const glow = new THREE.WebGLCubeRenderTarget(GLOW_FACE, { type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    glow.texture.name = 'SkyGlow';
    const uniforms = {
      uFrame: { value: frame.matrix },
      uRes: { value: new THREE.Vector2() },
      uPxScale: { value: 1 },
      uWidthPx: { value: 1 },
      uLineGain: { value: 1 },
      uGlow: { value: glow.texture },
    };
    const scene = new THREE.Scene();
    const fill = new THREE.Mesh(fullscreenTriangle(), shader(skyDirVert, skyFillFrag, uniforms));
    fill.frustumCulled = false;
    fill.renderOrder = -1;
    scene.add(fill);
    const target = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    target.texture.name = 'Sky';
    const glowScene = new THREE.Scene();
    const glowUniforms = {
      uToSky: { value: frame.matrix.clone().transpose() },
      uDay: { value: new Float32Array(31) },
      uRaNow: { value: RA_NOW },
      uRaStep: { value: RA_STEP },
      uWarm: { value: linear('dust').clone().multiplyScalar(0.026) },
      uCool: { value: linear('starA').clone().multiplyScalar(0.022) },
    };
    const glowMesh = new THREE.Mesh(fullscreenTriangle(), shader(skyDirVert, skyGlowFrag, glowUniforms, { blending: THREE.NoBlending }));
    glowMesh.frustumCulled = false;
    glowScene.add(glowMesh);
    return {
      uniforms, scene, target, fill, glow, glowScene, glowMesh, glowUniforms, glowCamera: new THREE.CubeCamera(0.1, 10, glow),
      env: null as THREE.WebGLCubeRenderTarget | null, envCamera: null as THREE.CubeCamera | null, envAt: -Infinity, envStars: -1,
      lastView: new THREE.Matrix4(), lastProjection: new THREE.Matrix4(),
    };
  }, [frame]);

  useEffect(() => () => {
    pass.target.dispose();
    pass.glow.dispose();
    pass.env?.dispose();
    (pass.fill.material as THREE.Material).dispose();
    (pass.glowMesh.material as THREE.Material).dispose();
  }, [pass]);

  // The month changes when a digest lands. The target stays, only what is drawn into it is replaced.
  useLayoutEffect(() => {
    const objects = [points(data.dust, pass.uniforms), points(data.stars, pass.uniforms), points(landmarkStars(), pass.uniforms, skyLandmarkFrag), lines(data.lines, pass.uniforms)];
    pass.scene.add(...objects);
    pass.glowUniforms.uDay.value.set(data.days);
    state.skyDirty = true;
    state.cubeDirty = true;
    invalidate();
    return () => {
      pass.scene.remove(...objects);
      for (const o of objects) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    };
  }, [data, invalidate, pass, state]);

  /** Six faces, as the renderer's own cube camera aims them, cleared by hand because the composer turned autoClear off. */
  const drawCube = (target: THREE.WebGLCubeRenderTarget, cube: THREE.CubeCamera, scene: THREE.Scene): void => {
    for (let face = 0; face < 6; face++) {
      gl.setRenderTarget(target, face);
      gl.clear();
    }
    cube.update(gl, scene);
    gl.setRenderTarget(null);
  };

  const drawEnvironment = (): void => {
    const size = Math.round(CUBE_FACE * tier.skyScale);
    if (!pass.env || pass.env.width !== size) {
      pass.env?.dispose();
      // Packed floats: half the memory of half floats, and the sky has no alpha to keep.
      pass.env = new THREE.WebGLCubeRenderTarget(size, { format: THREE.RGBFormat, type: THREE.UnsignedInt101111Type, depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
      pass.env.texture.name = 'SkyCube';
      pass.envCamera = new THREE.CubeCamera(0.1, 10, pass.env);
    }
    drawCube(pass.glow, pass.glowCamera, pass.glowScene);
    const u = pass.uniforms;
    u.uRes.value.set(size, size);
    // One CSS star is two texels here: small enough to stay a star, and large enough not to fall between texels.
    u.uPxScale.value = size / 512;
    u.uWidthPx.value = Math.max(1, (LINE_HALF_WIDTH_CSS * size) / 512);
    u.uLineGain.value = 1;
    drawCube(pass.env, pass.envCamera!, pass.scene);
    passes.skyCube.value = pass.env.texture;
    pass.envAt = performance.now();
    pass.envStars = data.stars.count;
    state.cubeDirty = state.cubeLost = false;
    state.skyDirty = true;
  };

  useEffect(() => {
    state.probeSky = (dir) => probeCube(gl, passes.skyCube.value as THREE.CubeTexture | null, dir);
    return () => { state.probeSky = null; };
  }, [gl, passes, state]);

  useFrame(() => {
    const size = Math.round(CUBE_FACE * tier.skyScale);
    const first = passes.skyCube.value === null || pass.env?.width !== size;
    // The first month usually lands just after the first frame, and a landing should not wait: only small changes are worth batching.
    const jump = Math.abs(data.stars.count - pass.envStars) > Math.max(32, pass.envStars * 0.02);
    if (first || state.cubeLost || (state.cubeDirty && (jump || performance.now() - pass.envAt >= CUBE_EVERY_MS))) drawEnvironment();
    gl.getDrawingBufferSize(buffer);
    const w = Math.max(2, Math.round(buffer.x * tier.skyScale));
    const h = Math.max(2, Math.round(buffer.y * tier.skyScale));
    if (pass.target.width !== w || pass.target.height !== h) {
      pass.target.setSize(w, h);
      state.skyDirty = true;
    }
    camera.updateMatrixWorld();
    if (!pass.lastView.equals(camera.matrixWorldInverse) || !pass.lastProjection.equals(camera.projectionMatrix)) {
      pass.lastView.copy(camera.matrixWorldInverse);
      pass.lastProjection.copy(camera.projectionMatrix);
      state.skyDirty = true;
    }
    passes.sky.value = pass.target.texture;
    if (!state.skyDirty) return;
    state.skyDirty = false;
    const u = pass.uniforms;
    const scale = w / free.w;
    u.uRes.value.set(w, h);
    u.uPxScale.value = scale;
    const width = LINE_HALF_WIDTH_CSS * scale;
    u.uWidthPx.value = Math.max(1, width);
    u.uLineGain.value = Math.min(1, width);
    gl.setRenderTarget(pass.target);
    gl.clear();
    gl.render(pass.scene, camera);
    gl.setRenderTarget(null);
  }, -1);
  return null;
}

/** What the environment cube holds in one direction, for the tooling. It proves the faces are the right way around. */
function probeCube(gl: THREE.WebGLRenderer, cube: THREE.CubeTexture | null, dir: readonly [number, number, number]): number[] | null {
  if (!cube) return null;
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, depthBuffer: false });
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    uniforms: { uCube: { value: cube }, uDir: { value: new THREE.Vector3().fromArray(dir) } },
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform samplerCube uCube; uniform vec3 uDir; out vec4 o; void main() { o = vec4(textureLod(uCube, uDir, 0.0).rgb, 1.0); }',
  });
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(fullscreenTriangle(), material);
  mesh.frustumCulled = false;
  scene.add(mesh);
  const out = new Float32Array(4);
  gl.setRenderTarget(target);
  gl.render(scene, new THREE.Camera());
  gl.readRenderTargetPixels(target, 0, 0, 1, 1, out);
  gl.setRenderTarget(null);
  target.dispose();
  material.dispose();
  return [out[0]!, out[1]!, out[2]!];
}

/** World units per M: the shadow's radius is sqrt(27) M, and it keeps the size of the old disc. */
const HOLE_SCALE = HOLE_RADIUS / Math.sqrt(27);
/** Radians a second at r = 6. The disk never stops while the window shows, and fleet tokens drive it faster, DESIGN law 7. */
const SPIN_REST = 0.04;
const SPIN_TOKENS = 0.12;

/** The black hole in place of the old disc, corona and lens background. It draws nothing until its tables are built off the main thread. */
function HoleMount({ tier, camera }: { tier: Tier; camera: THREE.Camera }) {
  const { state, passes } = useStage();
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const [hole, setHole] = useState<Hole | null>(null);
  const clock = useRef({ value: 2, at: -1 });

  useEffect(() => {
    let live = true;
    let made: Hole | null = null;
    void prepareHole().then(async () => {
      if (!live) return;
      made = new Hole(stageSky(passes.sky, passes.skyCube));
      made.scale = HOLE_SCALE;
      made.update(camera);
      await made.precompile(gl, camera).catch(() => undefined);
      if (!live) return;
      setHole(made);
      invalidate();
    });
    return () => { live = false; made?.dispose(); };
  }, [camera, gl, invalidate, passes]);

  useEffect(() => {
    if (!hole) return;
    hole.images = tier.name === 'Umbra' ? 4 : tier.name === 'Corona' ? 3 : 2;
    hole.graze = tier.name === 'Penumbra' ? 16 : 32;
    invalidate();
  }, [hole, invalidate, tier]);

  useFrame(() => {
    if (!hole) return;
    const c = clock.current;
    const dt = c.at < 0 || state.still ? 0 : Math.max(0, Math.min(0.25, state.now - c.at));
    c.at = state.now;
    c.value += (state.tokensMoving ? SPIN_TOKENS : SPIN_REST) * dt;
    for (const flare of state.diskFlares) {
      if (flare.clock < 0) flare.clock = c.value;
      flare.age = state.now - flare.born;
    }
    while (state.diskFlares.length && state.diskFlares[0]!.age >= 5) state.diskFlares.shift();
    hole.setLaws({ quota: state.sunLeft, clock: c.value, turbulence: 0.7, arcs: state.diskArcs, flares: state.diskFlares });
  }, -3);

  return hole ? <HoleLayer hole={hole} /> : null;
}

const STAR = new THREE.Vector3();

/** Writes every uniform that follows the frame: resolution, wells, waves, disc and the finish. */
function FrameDriver({ radius, free, camera, finish }: {
  radius: number; free: Rect; camera: THREE.Camera; finish: { current: FinishEffect | null };
}) {
  const stage = useStage();
  const gl = useThree((s) => s.gl);
  const sliverFull = useMemo(() => linear('sliverFull'), []);
  const sliverLow = useMemo(() => linear('sliverLow'), []);
  const pearl = useMemo(() => linear('pearl'), []);
  useFrame(() => {
    const { state, frame, lens, disc } = stage;
    gl.getDrawingBufferSize(buffer);
    const scale = buffer.x / free.w;
    frame.uRes.value.copy(buffer);
    frame.uPxPerCss.value = scale;
    frame.uNow.value = state.now;
    lens.res.value.copy(buffer);

    let wells = 0;
    for (const w of state.wells) {
      if (wells >= MAX_WELLS) break;
      if (!toCanvasPx(camera, w.position, buffer.x, buffer.y, px)) continue;
      lens.well.value.set([px.x, px.y, w.thetaCss * scale, w.ring], wells * 4);
      wells++;
    }
    lens.wellCount.value = wells;

    let waves = 0;
    for (const w of state.waves) {
      if (waves >= MAX_WAVES) break;
      if (!toCanvasPx(camera, w.position, buffer.x, buffer.y, px)) continue;
      lens.wave.value.set([px.x, px.y, w.radiusCss * scale, w.amplitudeCss * scale], waves * 4);
      waves++;
    }
    lens.waveCount.value = waves;
    lens.waveShape.value.set(state.waveShape[0] * scale, state.waveShape[1] * scale);

    disc.radius.value = radius;
    disc.sunLeft.value = state.sunLeft;
    // At gain 16 the sliver sets the colour of the whole bloom, and pure sliver-full turns the corona violet. Pearl keeps it
    // white, as the stills are, and enough of the token survives for the sun to cool as the window runs out.
    disc.sliver.value.copy(sliverLow).lerp(sliverFull, state.sunLeft).lerp(pearl, 0.72);
    disc.quota.value = 0.28 + 0.72 * state.sunLeft;

    const effect = finish.current;
    if (effect) {
      const front = toCanvasPx(camera, STAR, 1, 1, px);
      // Behind the camera there is no disc to keep black. A radius of nothing leaves the frame alone.
      // A body in front of it gets to stay: the shadow is only painted while nothing stands there.
      (effect.uniforms.get('uDisc')!.value as THREE.Vector3).set(px.x, px.y, front && !state.holeCovered ? (radius * cssPerUnit(camera as THREE.PerspectiveCamera, free, STAR)) / free.h : 1e-5);
      effect.uniforms.get('uDim')!.value = state.dim;
      const focus = effect.uniforms.get('uFocus')!.value as THREE.Vector4;
      if (state.focus && toCanvasPx(camera, state.focus.position, 1, 1, px)) focus.set(px.x, px.y, state.focus.inner / free.h, state.focus.outer / free.h);
      // No focus: a radius of nothing, so a dim reaches the whole frame.
      else focus.set(0.5, 0.5, 0, 0.0001);
      effect.uniforms.get('uDesat')!.value = state.desat;
    }
  }, -3);
  return null;
}

/**
 * One scheduler for the canvas. frameloop is demand, and this asks for frames at the rate the content needs. At rest it parks: no
 * rAF is pending at all, and a timer at the store's own 4 Hz, or `wake`, starts it again.
 */
function CadenceDriver({ cadence, onBattery, capHz, onFrame, onRest, wake }: {
  cadence: () => Cadence; onBattery: () => boolean; capHz: () => number; onFrame: (dtMs: number, hz: number, now: number) => void;
  onRest?: (() => void) | undefined; wake?: { current: (() => void) | null } | undefined;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const rate = useCallback(() => (document.hidden ? 0 : Math.min((onBattery() ? BATTERY_CAP_HZ : CADENCE_HZ)[cadence()], capHz())), [capHz, cadence, onBattery]);
  // R3F's loop stops after a frame unless that frame asked for the next one. Asked for from outside, as below, it can only start again a vsync
  // later, so the event cadence would run every other vsync. Asked for from inside a frame, the loop never stops.
  useFrame(() => { if (rate() > 45) invalidate(); }, 11);
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const step = (now: number) => {
      raf = 0;
      const hz = rate();
      if (hz <= 0) { onRest?.(); return; }
      raf = requestAnimationFrame(step);
      // A quarter of a vsync of slack. With less, rAF jitter skips a beat at 15 Hz, and the monitor reads 83 ms as a slow frame.
      if (now - last >= 1000 / hz - 4) {
        // The first frame after a park has no interval worth measuring.
        onFrame(last === 0 ? 1000 / hz : now - last, hz, now);
        last = now;
        invalidate();
      }
    };
    const start = () => {
      if (raf !== 0 || rate() <= 0) return;
      last = 0;
      raf = requestAnimationFrame(step);
    };
    if (wake) wake.current = start;
    start();
    const timer = setInterval(start, 250);
    document.addEventListener('visibilitychange', start);
    return () => {
      if (wake) wake.current = null;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', start);
      if (raf !== 0) cancelAnimationFrame(raf);
    };
  }, [invalidate, onFrame, onRest, rate, wake]);
  return null;
}

/** three rebuilds its own state on restore. The targets are empty then, so both passes must draw again. */
function ContextGuard({ onLost, onRestored }: { onLost: () => void; onRestored: () => void }) {
  const { state } = useStage();
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const canvas = gl.domElement;
    const lost = (e: Event) => { e.preventDefault(); onLost(); };
    const restored = () => {
      state.skyDirty = true;
      state.coronaDirty = true;
      onRestored();
      invalidate();
    };
    canvas.addEventListener('webglcontextlost', lost);
    canvas.addEventListener('webglcontextrestored', restored);
    return () => {
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', restored);
    };
  }, [gl, invalidate, onLost, onRestored, state]);
  return null;
}

/** Bloom levels change on the running pass, so a tier step recompiles nothing. */
function BloomLevels({ bloom, levels }: { bloom: { current: BloomEffect | null }; levels: number }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const pass = bloom.current?.mipmapBlurPass;
    if (pass && pass.levels !== levels) { pass.levels = levels; invalidate(); }
  }, [bloom, invalidate, levels]);
  return null;
}

/** The wrapper has no prop for it. DESIGN 7.8: dither after encoding, on the one pass that writes to the screen. */
function DitherOn({ composer }: { composer: { current: Composer | null } }) {
  useFrame(() => {
    const pass = composer.current?.passes.find((p): p is EffectPass => p instanceof EffectPass);
    if (pass && !pass.dithering) pass.dithering = true;
  }, -4);
  return null;
}

export interface StageProps {
  free: Rect;
  tier: Tier;
  dpr: number;
  camera: THREE.PerspectiveCamera;
  state: SceneState;
  sky: SkyData;
  skyFrameBasis: SkyFrame;
  cadence: () => Cadence;
  onBattery: () => boolean;
  capHz: () => number;
  onFrame: (dtMs: number, hz: number, now: number) => void;
  onLost: () => void;
  onRestored: () => void;
  /** The cadence parked. The tier monitor forgets its window. */
  onRest?: () => void;
  /** Set by the driver: starts it at once, without waiting for its 4 Hz look. */
  wake?: { current: (() => void) | null };
  /** A subclass of FinishEffect, for the tone curve A/B. */
  finishEffect?: typeof FinishEffect;
  bloom?: Partial<BloomSettings>;
  /** Corona target size against the canvas. Default: full at Umbra, half below, from the A/B in docs/bench. */
  coronaScale?: number;
  /** Replaces the plain RenderPass. The bench uses it to time the scene apart from the post chain. */
  renderPass?: (scene: THREE.Scene, camera: THREE.Camera) => RenderPass;
  children: ReactNode;
}

export function Stage({
  free, tier, dpr, camera, state, sky, skyFrameBasis, cadence, onBattery, capHz, onFrame, onLost, onRestored, onRest, wake,
  finishEffect = HoleFinishEffect, bloom, renderPass, children,
}: StageProps) {
  const Finish = useMemo(() => wrapEffect(finishEffect) as unknown as ComponentType<{ ref: Ref<FinishEffect> }>, [finishEffect]);
  const finish = useRef<FinishEffect | null>(null);
  const bloomRef = useRef<BloomEffect | null>(null);
  const composer = useRef<Composer | null>(null);
  const firstLevels = useRef(tier.bloomLevels);
  const radius = discRadius(free);

  const uniforms = useMemo<StageUniforms>(() => ({
    state,
    frame: createFrameUniforms(),
    passes: { sky: { value: null }, corona: { value: null }, noise: { value: buildNoiseTexture() }, skyCube: { value: null } },
    lens: {
      well: { value: new Float32Array(MAX_WELLS * 4) },
      wellCount: { value: 0 },
      wave: { value: new Float32Array(MAX_WAVES * 4) },
      waveCount: { value: 0 },
      waveShape: { value: new THREE.Vector2(1, 1) },
      res: { value: new THREE.Vector2(2, 2) },
    },
    disc: { radius: { value: radius }, sunLeft: { value: 1 }, sliver: { value: new THREE.Color() }, quota: { value: 1 } },
  }), [state]); // eslint-disable-line react-hooks/exhaustive-deps -- the radius follows through the frame driver

  useEffect(() => () => uniforms.passes.noise.value?.dispose(), [uniforms]);

  return (
    <Canvas flat frameloop="demand" dpr={dpr} camera={camera}
            style={{ position: 'absolute', inset: 0, background: HEX.void }}
            gl={{ antialias: false, alpha: false, depth: false, powerPreference: 'high-performance', stencil: false }}>
      <StageContext value={uniforms}>
        <CadenceDriver cadence={cadence} onBattery={onBattery} capHz={capHz} onFrame={onFrame} onRest={onRest} wake={wake} />
        <ContextGuard onLost={onLost} onRestored={onRestored} />
        <FrameDriver radius={radius} free={free} camera={camera} finish={finish} />
        <SkyPass data={sky} frame={skyFrameBasis} tier={tier} free={free} camera={camera} />
        <DitherOn composer={composer} />
        <BloomLevels bloom={bloomRef} levels={tier.bloomLevels} />
        <HoleMount tier={tier} camera={camera} />
        {children}
        <EffectComposer ref={composer} multisampling={0} frameBufferType={THREE.HalfFloatType} {...(renderPass ? { renderPass } : {})}>
          <Bloom ref={bloomRef} mipmapBlur levels={firstLevels.current} {...BLOOM} {...bloom} />
          <Finish ref={finish} />
        </EffectComposer>
      </StageContext>
    </Canvas>
  );
}
