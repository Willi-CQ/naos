// The Slice 0 page: S0, S20, S20e, S60, LOOK and LOSS on one page. Rails hold controls and numbers, the canvas is the free rect.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { hud } from '../core/layout.ts';
import { renderDpr, TIERS, type Cadence, type Tier } from '../core/tiers.ts';
import { aimSystem, skyFrame, systemCamera } from '../scene/camera.ts';
import { Arcs, Beams, Cities, Hulls, Worlds } from '../scene/layers/Layers.tsx';
import { useTier } from '../scene/useTier.ts';
import { buildSky } from '../scene/sky.ts';
import { discRadius, Stage } from '../scene/Stage.tsx';
import { createSceneState, type SceneState } from '../scene/state.ts';
import { HEX } from '../scene/tokens.ts';
import { AgXEffect } from './agx.ts';
import { Fleet } from './fleet.ts';
import { Meter, percentiles, timedRenderPass } from '../scene/meter.ts';
import { SPOKES, syntheticSky } from './synthetic.ts';

export type SceneName = 'S0' | 'S20' | 'S20e' | 'S60' | 'S120' | 'LOOK' | 'LOSS';

interface SceneSpec { cadence: Cadence; active: boolean; extraCraft: number; wells: number; streaks: number; sunLeft: number }

const SCENES: Record<SceneName, SceneSpec> = {
  S0: { cadence: 'rest', active: false, extraCraft: 0, wells: 0, streaks: 0, sunLeft: 0.88 },
  S20: { cadence: 'cruise', active: true, extraCraft: 0, wells: 1, streaks: 0, sunLeft: 0.58 },
  S20e: { cadence: 'event', active: true, extraCraft: 0, wells: 1, streaks: 0, sunLeft: 0.58 },
  S60: { cadence: 'cruise', active: true, extraCraft: 40, wells: 8, streaks: 16, sunLeft: 0.58 },
  // No shoals yet, so this is 120 separate craft, which costs more than the merged bands of DESIGN 12.5.
  S120: { cadence: 'cruise', active: true, extraCraft: 100, wells: 8, streaks: 16, sunLeft: 0.58 },
  LOOK: { cadence: 'rest', active: true, extraCraft: 0, wells: 1, streaks: 0, sunLeft: 0.58 },
  LOSS: { cadence: 'cruise', active: true, extraCraft: 0, wells: 1, streaks: 0, sunLeft: 0.58 },
};

export interface BenchOptions {
  scene: SceneName;
  tier: Tier;
  curve: 'finish' | 'agx';
  levels: number | null;
  /** Corona flare toward world 3, the salvo still. */
  salvo: boolean;
  /** Crest radius of a frozen wavefront in CSS px, 0 for none. */
  wave: number;
  /** Bloom overrides, for tuning. */
  intensity: number | null;
  radius: number | null;
  coronaScale: number | null;
  /** Hands the tier to the monitor, as the app will. `tier` is then only where it starts. */
  auto: boolean;
  /** Renders on every rAF, ignoring the cadence. With vsync off in the browser this reads throughput. */
  uncapped: boolean;
  /** Overrides the wells of the scene, so the fleet can be read without eight lenses over it. */
  wells: number | null;
}

export function readOptions(q: URLSearchParams): BenchOptions {
  const name = q.get('scene') as SceneName | null;
  const num = (k: string) => (q.get(k) === null ? null : Number(q.get(k)));
  return {
    scene: name && name in SCENES ? name : 'S20',
    tier: TIERS.find((t) => t.name === q.get('tier')) ?? TIERS[0]!,
    curve: q.get('curve') === 'agx' ? 'agx' : 'finish',
    levels: num('levels'),
    salvo: q.get('salvo') === '1',
    wave: num('wave') ?? 0,
    intensity: num('intensity'),
    radius: num('radius'),
    coronaScale: num('coronaScale'),
    auto: q.get('auto') === '1',
    uncapped: q.get('uncapped') === '1',
    wells: num('wells'),
  };
}

const LOSS_WINDOW_MS = 600_000;

interface Shared {
  meter: Meter;
  state: SceneState;
  fleet: Fleet;
  spec: SceneSpec;
  options: BenchOptions;
  camera: THREE.PerspectiveCamera;
  free: ReturnType<typeof hud>['free'];
  armed: { current: boolean };
}

/** Runs first in the frame, moves the content, and opens the GPU timers. */
function Driver({ shared }: { shared: Shared }) {
  const gl = useThree((s) => s.gl);
  const clock = useRef(0);
  useEffect(() => { shared.meter.attach(gl); gl.info.autoReset = false; }, [gl, shared]);
  useFrame((_, delta) => {
    const { meter, state, fleet, spec, options, camera, free } = shared;
    meter.frameStart(gl);
    const dt = spec.cadence === 'rest' ? 0 : Math.min(delta, 0.1);
    clock.current += dt;
    const t = clock.current;
    let multiplier = 1;
    state.waves.length = 0;
    if (spec.cadence === 'event') {
      // Flight, wavefront and rebound, on a loop. The camera sways, so the sky redraws every frame.
      aimSystem(camera, free, Math.sin(t * 0.8) * 0.1);
      const phase = t % 2.4;
      if (phase < 0.9) {
        const k = phase / 0.9;
        state.waves.push({ position: fleet.wellPosition(new THREE.Vector3()), radiusCss: (Math.hypot(free.w, free.h) / 0.9) * phase, amplitudeCss: 15 * (1 - k * k) });
      }
      if (phase > 1.2) {
        const k = (phase - 1.2) / 0.7;
        multiplier = k < 1 ? 1 - (1 + Math.exp(-5 * k) * Math.cos(11 * k)) : 1;
      }
      if (phase > 1.9) multiplier = (phase - 1.9) / 0.5;
    }
    if (options.wave > 0) state.waves.push({ position: fleet.wellPosition(new THREE.Vector3()), radiusCss: options.wave, amplitudeCss: 15 });
    fleet.arrange(dt);
    fleet.writeWells(state, multiplier);
    state.now = t;
    if (spec.streaks && Math.floor(t / 1.6) !== Math.floor((t - dt) / 1.6)) fleet.fireStreaks(t);
    // The salvo still: streaks frozen most of the way to their hoop.
    if (options.salvo && spec.cadence === 'rest') fleet.fireStreaks(-0.3);
    if (spec.cadence !== 'rest') state.tokenClock = (state.tokenClock + 1840 * dt * 1e-5) % 1;
  }, -5);
  useFrame(() => { shared.meter.frameEnd(gl); }, 10);
  return null;
}

function Bench3D({ shared }: { shared: Shared }) {
  const { fleet } = shared;
  return (
    <>
      <Driver shared={shared} />
      <Worlds buffer={fleet.worlds} />
      <Cities buffer={fleet.cities} world={fleet.uWorld} spin={NO_SPIN} px={2.3} />
      <Arcs buffer={fleet.arcs24} />
      <Arcs buffer={fleet.arcs48} />
      <Arcs buffer={fleet.arcs96} />
      <Arcs buffer={fleet.wakes} />
      <Arcs buffer={fleet.rings} />
      <Hulls buffer={fleet.hulls} />
      <Beams buffer={fleet.beams} />
    </>
  );
}

function InvalidateBridge({ api, advance, uncapped, meter }: {
  api: { current: ((frames: number) => void) | null }; advance: { current: ((timestamp: number) => void) | null }; uncapped: boolean; meter: Meter;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const advanceFrame = useThree((s) => s.advance);
  useEffect(() => { api.current = (frames) => invalidate(frames); advance.current = (t) => advanceFrame(t); }, [advance, advanceFrame, api, invalidate]);
  useEffect(() => {
    if (!uncapped) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      if (meter.recording) meter.raf.push(now - last);
      last = now;
      invalidate();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [invalidate, meter, uncapped]);
  return null;
}

const NO_SPIN = new Float32Array(32 * 4);

/** Stands in for the real Plate, which the Instrument owns. It only has to show that the DOM takes over. */
function PlateStandIn({ free }: { free: ReturnType<typeof hud>['free'] }) {
  const r = discRadius(free);
  return (
    <svg data-plate width={free.w} height={free.h} style={{ position: 'absolute', inset: 0, background: '#4A3518' }}>
      <circle cx={free.w / 2} cy={free.h / 2} r={r} fill="#120A04" />
      {Array.from({ length: 31 }, (_, i) => <ellipse key={i} cx={free.w / 2} cy={free.h / 2} rx={Math.abs(374 * Math.tan(((-90 + 6 * i) * Math.PI) / 360))} ry={374} fill="none" stroke="#120A04" strokeWidth={0.5} />)}
      <text x={free.w / 2} y={free.h / 2 + r + 32} fill="#120A04" textAnchor="middle" fontFamily="monospace" fontSize={13}>scene lost, plate up</text>
    </svg>
  );
}

const railStyle = { position: 'absolute', top: 36, bottom: 44, color: HEX.bone, font: '12px/16px monospace', padding: 10, overflow: 'hidden' } as const;

export function Bench({ options }: { options: BenchOptions }) {
  const spec = SCENES[options.scene];
  const viewport = useMemo(() => hud(innerWidth, innerHeight), []);
  const { free, craftK } = viewport;
  const auto = useTier(free, devicePixelRatio, TIERS.indexOf(options.tier), false);
  const chosen = options.auto ? auto.tier : options.tier;
  const tier = useMemo(() => (options.levels === null ? chosen : { ...chosen, bloomLevels: options.levels }), [chosen, options.levels]);
  const dpr = options.auto ? auto.dpr : renderDpr(tier, free, devicePixelRatio);

  const shared = useMemo<Shared>(() => {
    const camera = systemCamera(free);
    const meter = new Meter();
    const state = createSceneState();
    state.sunLeft = spec.sunLeft;
    state.tokensMoving = spec.cadence !== 'rest';
    state.tokenClock = 0.34;
    const fleet = new Fleet({ free, craftK, camera, active: spec.active, extraCraft: spec.extraCraft, wells: options.wells ?? spec.wells, streaks: options.salvo ? 4 : spec.streaks });
    if (spec.active) fleet.writeStreams(state, options.salvo ? 2 : -1);
    state.waveShape = [46, 15];
    return { meter, state, fleet, spec, options, camera, free, armed: { current: false } };
  }, [craftK, free, options, spec]);

  const frame = useMemo(() => skyFrame(), []);
  const sky = useMemo(() => buildSky(syntheticSky(), SPOKES, frame), [frame]);

  const tierRef = useRef(tier.name);
  tierRef.current = tier.name;
  const cadenceRef = useRef<Cadence>(spec.cadence);
  const [plate, setPlate] = useState(false);
  const plateRef = useRef(false);
  const losses = useRef<number[]>([]);
  const lossLog = useRef<{ event: string; at: number; plateMs?: number }[]>([]);
  const loseCalledAt = useRef(0);
  // Outlives re-renders: a context that is lost can no longer hand out this extension.
  const loseExt = useRef<WEBGL_lose_context | null>(null);
  const invalidateApi = useRef<((frames: number) => void) | null>(null);
  const advanceApi = useRef<((timestamp: number) => void) | null>(null);
  const [readout, setReadout] = useState('');

  const cadence = useCallback(() => (plateRef.current ? 'rest' : cadenceRef.current), []);
  const onBattery = useCallback(() => false, []);
  const capHz = useCallback(() => (options.auto ? auto.capHz() : 60), [auto, options.auto]);
  const onFrame = useCallback((dtMs: number, hz: number, now: number) => {
    if (shared.meter.recording) shared.meter.raf.push(dtMs);
    if (options.auto) auto.onFrame(dtMs, hz, now);
  }, [auto, options.auto, shared]);

  const onLost = useCallback(() => {
    const at = performance.now();
    losses.current = [...losses.current.filter((t) => at - t < LOSS_WINDOW_MS), at];
    plateRef.current = true;
    // Committed here, not whenever React gets to it. Under GPU load the next rAF can arrive first, and the check below then
    // reports a Plate that is on its way as missing.
    flushSync(() => setPlate(true));
    requestAnimationFrame(() => {
      const shown = document.querySelector('[data-plate]') !== null;
      lossLog.current.push({ event: shown ? 'plate-up' : 'plate-missing', at, plateMs: performance.now() - loseCalledAt.current });
    });
  }, []);

  const onRestored = useCallback(() => {
    lossLog.current.push({ event: 'restored', at: performance.now() });
    shared.meter.attach(rendererRef.current!);
    // Twice in 10 minutes: stay on the Plate until reload, DESIGN 11.7.
    if (losses.current.length < 2) { plateRef.current = false; setPlate(false); }
  }, [shared]);

  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  useEffect(() => {
    const canvas = () => document.querySelector('canvas');
    const context = () => (canvas()?.getContext('webgl2') ?? null);
    const api = {
      options: { ...options, tier: tier.name },
      rendered: () => shared.meter.rendered,
      tierNow: () => ({ name: tierRef.current, log: auto.log.current }),
      lastCalls: () => shared.meter.lastCalls,
      hasTimer: () => shared.meter.hasTimer,
      renderer: () => {
        const gl = context();
        const d = gl?.getExtension('WEBGL_debug_renderer_info');
        return d ? gl?.getParameter(d.UNMASKED_RENDERER_WEBGL) as string : null;
      },
      canvasSize: () => ({ width: canvas()?.width, height: canvas()?.height, dpr, cssW: free.w, cssH: free.h }),
      async measure(ms: number) {
        const m = shared.meter;
        m.reset();
        m.calls = m.triangles = m.points = 0;
        m.recording = true;
        const started = performance.now();
        await new Promise((r) => setTimeout(r, ms));
        m.recording = false;
        await new Promise((r) => setTimeout(r, 120));
        m.collect();
        return { ...m.summary(), spanMs: performance.now() - started - 120 };
      },
      render(frames = 2) { invalidateApi.current?.(frames); },
      /**
       * A third clock that shares nothing with the timer query: render synchronously, then block on readPixels, which cannot
       * return before the GPU has finished. `burst` frames per sample is the positive control: real time must scale with it.
       */
      async syncFrames(samples: number, burst: number) {
        const gl = context();
        if (!gl) return null;
        const pixel = new Uint8Array(4);
        const times: number[] = [];
        for (let i = 0; i < samples; i++) {
          await new Promise(requestAnimationFrame);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          const t0 = performance.now();
          for (let b = 0; b < burst; b++) advanceApi.current?.(t0 + b);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          times.push(performance.now() - t0);
        }
        return percentiles(times);
      },
      lose() {
        loseExt.current = context()?.getExtension('WEBGL_lose_context') ?? loseExt.current;
        loseCalledAt.current = performance.now();
        loseExt.current?.loseContext();
      },
      restore() { loseExt.current?.restoreContext(); },
      /** Takes the Plate down against the policy, so a screenshot can prove the second rebuild. */
      forceBack() { plateRef.current = false; setPlate(false); },
      lossLog: () => lossLog.current,
      plate: () => document.querySelector('[data-plate]') !== null,
      /** Stops the content too, so a shot before a context loss and a shot after it can be compared pixel for pixel. */
      setCadence(c: Cadence) {
        cadenceRef.current = c;
        shared.spec = { ...shared.spec, cadence: c };
        shared.state.tokensMoving = c !== 'rest';
      },
      domIntact: () => document.querySelector('[data-rail]') !== null,
    };
    (window as unknown as { __bench: typeof api }).__bench = api;
    const id = setInterval(() => {
      const m = shared.meter;
      if (m.gpu.length || m.raf.length) setReadout(`gpu p95 ${percentiles(m.gpu).p95} ms`);
    }, 1000);
    return () => clearInterval(id);
  }, [auto, dpr, free, options, shared, tier]);

  const links: SceneName[] = ['S0', 'S20', 'S20e', 'S60', 'S120', 'LOOK', 'LOSS'];
  return (
    <>
      <div data-rail style={{ ...railStyle, left: 0, width: free.x }}>
        <div style={{ color: HEX.pearl, letterSpacing: 2, marginBottom: 12 }}>NAOS SLICE 0</div>
        {links.map((s) => (
          <div key={s}><a href={`?scene=${s}&tier=${tier.name}`} style={{ color: s === options.scene ? HEX.nad : HEX.bone }}>{s}</a></div>
        ))}
        <div style={{ marginTop: 12 }}>{TIERS.map((t) => <a key={t.name} href={`?scene=${options.scene}&tier=${t.name}`} style={{ color: t.name === tier.name ? HEX.nad : HEX.bone, marginRight: 8 }}>{t.name}</a>)}</div>
        <div style={{ marginTop: 12 }}>{readout}</div>
      </div>
      <div style={{ position: 'absolute', left: free.x, top: free.y, width: free.w, height: free.h, overflow: 'hidden' }}>
        <Stage free={free} tier={tier} dpr={dpr} camera={shared.camera} state={shared.state} sky={sky} skyFrameBasis={frame}
               cadence={cadence} onBattery={onBattery} capHz={capHz} onFrame={onFrame} onLost={onLost} onRestored={onRestored}
               renderPass={useMemo(() => timedRenderPass(shared.meter), [shared])}
               {...(options.curve === 'agx' ? { finishEffect: AgXEffect } : {})}
               {...(options.coronaScale !== null ? { coronaScale: options.coronaScale } : {})}
               bloom={{ ...(options.intensity !== null ? { intensity: options.intensity } : {}), ...(options.radius !== null ? { radius: options.radius } : {}) }}>
          <RendererRef out={rendererRef} />
          <InvalidateBridge api={invalidateApi} advance={advanceApi} uncapped={options.uncapped} meter={shared.meter} />
          <Bench3D shared={shared} />
        </Stage>
        {plate ? <PlateStandIn free={free} /> : null}
      </div>
    </>
  );
}

function RendererRef({ out }: { out: { current: THREE.WebGLRenderer | null } }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => { out.current = gl; }, [gl, out]);
  return null;
}
