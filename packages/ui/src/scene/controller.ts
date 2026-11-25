// The scene outside React. It reads the store's state, never a component's: `sync` runs four times a second and when the view or the
// model changes, `beforeFrame` on every rendered frame. Between them they fill SceneState and the buffers. No setState on the frame
// path. Worlds and wells come from the same chart as the Plate, so the two cannot disagree on where anything is. The fleet flies in
// scene/fleet.ts and the camera in scene/rig.ts: this file feeds them, and turns the events of the stream and the hand into their moves.
// `worldStates()` is the seam for the planet renderer: where each world stands, how it turns, and where its moons are.
import type { NaosEvent } from '@naos/protocol';
import * as THREE from 'three';
import { chooseCadence, EVENT_HOLD_MS } from '../core/cadence.ts';
import type { Sphere } from '../core/flight.ts';
import { placeLabels, type Anchor, type CraftLabelIn } from '../core/labels.ts';
import { orbitCss, streamLoad } from '../core/laws.ts';
import { freshStart } from '../core/lifecycle.ts';
import type { Rect } from '../core/layout.ts';
import type { OrbitPlane } from '../core/orbit.ts';
import { HOLE_RADIUS, moonRadius, moonRate, moonReach, spinAxis, spinRate, type OrbitRing, type Vec3 } from '../core/space.ts';
import type { Cadence, Tier } from '../core/tiers.ts';
import { almanacTop, chartOf, CHAR_PX, craftTag, LABEL_ALL_BELOW, labelText, setAngleSource, type Chart } from '../plate/chart.ts';
import type { CraftVM } from '../store/model.ts';
import { skySpokes, skyStars } from '../store/sky.ts';
import { registerKeys, unregisterKeys, type KeyBinding } from '../store/registry.ts';
import { flyHome, flyToSelection, onFleetEvents, openOverlay, select, selectWorld, setScene, useNaos } from '../store/store.ts';
import type { NaosState } from '../store/store.ts';
import { hash32 } from '../store/veil.ts';
import { cssPerUnit, skyFrame, systemCamera, toCanvasPx, type SkyFrame } from './camera.ts';
import { FleetEngine, TENDERS_DRAWN } from './fleet.ts';
import { cityLights, exposuresOf, type CityLight, type Exposure } from './history.ts';
import { ArcBuffer, BeamBuffer, CityBuffer, HullBuffer, WorldBuffer } from './layers/buffers.ts';
import { Meter, timedRenderPass } from './meter.ts';
import { CameraRig, type SteerAxis } from './rig.ts';
import { onCameraCommand } from '../core/cinema.ts';
import { rosterKey, rosterOf, type Roster } from './roster.ts';
import { buildSky, type SkyData } from './sky.ts';
import { createSceneState, MAX_STREAMS, MAX_WELLS, type SceneState, type WellInput } from './state.ts';
import { linear } from './tokens.ts';

const MASS_MS = 1_200;
const WAKE_MS = 1_400;
const SUN_MS = 600;
const SKY_EVERY_MS = 5_000;
const LOSS_WINDOW_MS = 600_000;
const RESTORE_LIMIT_MS = 15_000;
const STREAM_TAU_S = 0.45;
const STREAM_EPSILON = 0.004;
const CUT_RATES_MS = 600;
/** Long exposures, 7.5 gives 0.05. With no craft in front of them they are the picture, and the stills let them rise. */
const EXPOSURE_GAIN = { live: 0.012, rest: 0.045 } as const;
/** A drag across the whole free rect turns the view this far. */
const ORBIT_PER_FRAME = Math.PI;
const PINCH_GAIN = 1;
const WHEEL_GAIN = 0.0013;
/** A pinch on a trackpad arrives as a wheel with Ctrl down, in much smaller steps. */
const PINCH_WHEEL_GAIN = 0.011;
const DRAG_SLOP_PX = 4;
/** While the camera moves, labels look for a better place this often. */
const LABEL_MOVING_MS = 420;
/** How much a waking limb overshoots its rest. */
const WAKE_GLOW = 0.9;
const DOCKET_DIM = 0.45;
const DIM_MS = 180;
/** A label stays where it is put, or it dances. A moving hull carries it, and it looks for a better place this often. */
const LABEL_EVERY_MS = 1_500;
/** Screen distance a click reaches for a craft. They move, so this is well past the hull. */
const PICK_PX = 24;
/** The kernel's clock arrives four times a second. Past this it has stopped, as a paused fixture does. */
const CLOCK_COAST_MS = 400;
const BEACON_OFF_MS = 130;
/** The hull mesh is this much of the chase distance, so it reads the same at any world. */
const HULL_MESH = 1 / 15;
const CHASE_LABEL_REACH = 86;

const NO_LIGHTS: readonly CityLight[] = [];

/** `fall` of DESIGN 9.2 reads wrong for a body that arrives. This is `settle` over a longer run. */
const settle = (t: number): number => 1 - (1 - t) ** 3;

interface Spot { x: number; y: number; z: number; r: number }

interface Moon {
  key: string;
  phase: number;
  rate: number;
  reach: number;
  radius: number;
  position: THREE.Vector3;
  /** A moon that carries a still craft waits for it, or the craft would travel without a token flowing. */
  held: boolean;
}

interface Body {
  worldId: string;
  index: number;
  belt: boolean;
  plane: OrbitPlane;
  ring: OrbitRing;
  to: Spot;
  from: Spot;
  shown: Spot;
  t0: number;
  ms: number;
  position: THREE.Vector3;
  radius: number;
  rCss: number;
  perUnit: number;
  a: THREE.Vector3;
  b: THREE.Vector3;
  load: number;
  moons: Moon[];
  wakes: boolean;
  glow: number;
  axis: THREE.Vector3;
  spin: number;
  moonAt(key: string, out: THREE.Vector3): boolean;
}

/** What a planet renderer reads, every frame. All of it lives; nothing here is a copy. */
export interface WorldState {
  worldId: string;
  slot: number;
  belt: boolean;
  position: THREE.Vector3;
  radius: number;
  axis: THREE.Vector3;
  /** Radians around the axis. */
  spin: number;
  /** 0..1, from the world's tokens per second. */
  load: number;
  /** 1 at rest, more while a world wakes. */
  glow: number;
  moons: ReadonlyArray<{ position: THREE.Vector3; radius: number }>;
}

export interface LabelRow {
  key: string;
  kind: 'world' | 'craft';
  worldId: string | null;
  glyph: string;
  text: string;
  x: number;
  y: number;
  anchor: Anchor;
  tone: string;
  /** Where the thing it names stood when the label was placed, from the centre of the free rect. The label keeps that offset. */
  ax: number;
  ay: number;
}

export interface LabelShift { x: number; y: number; hidden: boolean; /** Its target stands behind a body. The label fades. */ behind: boolean }
export type LabelSink = (rows: readonly LabelRow[], free: Rect, shift: (row: LabelRow) => LabelShift) => void;

const reducedQuery = (): MediaQueryList | null => (typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null);

export class SceneController {
  harbor: THREE.Group | null = null;
  demoFleet: FleetEngine | null = null;
  readonly isHidden = (point: THREE.Vector3): boolean => this.occluded(point);
  animate(ms = 120): void { this.pulse(ms); this.redraw(2); }
  readonly state: SceneState = createSceneState();
  readonly camera: THREE.PerspectiveCamera;
  readonly frame: SkyFrame;
  readonly meter = new Meter();
  readonly renderPass = timedRenderPass(this.meter);
  readonly buffers = {
    worlds: new WorldBuffer(64),
    cities: new CityBuffer(8192),
    arcs24: new ArcBuffer(512, 24),
    arcs48: new ArcBuffer(1024, 48),
    arcs96: new ArcBuffer(512, 96),
    wakes: new ArcBuffer(1024, 48),
    rings: new ArcBuffer(512, 96),
    hulls: new HullBuffer(1024),
    beams: new BeamBuffer(64),
    /** The faint path of each world around the hole: what makes depth readable from any angle. */
    paths: new ArcBuffer(64, 128),
    uWorld: new Float32Array(32 * 4),
    /** Per world: spin axis and angle. The planet renderer reads the same two numbers from `worldStates`. */
    uSpin: new Float32Array(32 * 4),
    beltTurn: { value: 0 },
  };
  /** Stage sets this, and the controller calls it when a frame is due sooner than the driver's next look. */
  readonly wake: { current: (() => void) | null } = { current: null };
  /** Counts for the tooling. Nothing in the page reads them. */
  readonly stats = { frames: 0, startedAt: 0, firstFrameAt: 0 };

  private free: Rect;
  private craftK: number;
  private readonly bodies = new Map<string, Body>();
  private readonly hotArcs = Array.from({ length: MAX_STREAMS }, () => ({ azimuth: 0, strength: 0 }));
  private chart: Chart | null = null;
  private epoch = -1;
  private current: Cadence = 'rest';
  private holdUntil = 0;
  private reduced = false;
  private invalidate: ((frames?: number) => void) | null = null;
  private gl: THREE.WebGLRenderer | null = null;
  private clock = 0;
  private last = 0;
  private metering = false;

  private sky: SkyData;
  private readonly skyWatchers = new Set<() => void>();
  private skyAt = -Infinity;
  private seen: { history: unknown; salvos: unknown; closed: number; count: number } = { history: null, salvos: null, closed: 0, count: 0 };
  private exposures: readonly Exposure[] = [];
  private exposuresDirty = false;
  private lights: readonly CityLight[] = [];
  private lightsByWorld = new Map<string, CityLight[]>();
  /** Worlds the planet renderer draws. Their stand-in discs and city points go, their moons stay. */
  private drawnElsewhere = new Set<string>();
  private exposureGain: number = EXPOSURE_GAIN.rest;

  private sunFrom = 1;
  private sunTo = 1;
  private sunAt = 0;
  private fiveLeft: number | null = null;
  private sevenLeft: number | null = null;
  private stale = false;
  private system = true;
  private arcsKey = '';

  private settling = false;
  private dimFrom = 1;
  private dimTo = 1;
  private dimAt = 0;

  private tokens: number | null = null;
  private cutUntil = 0;

  private labels: LabelRow[] = [];
  private labelsAt = 0;
  private labelsKey = '';
  private sink: LabelSink | null = null;

  readonly fleet: FleetEngine;
  readonly rig: CameraRig;
  private rosterSeen = '';
  private rosterFrom: unknown = null;
  private roster: Roster = { crafts: [], hoops: [] };
  private viewSeen = '';
  private wellIds: string[] = [];
  private departures = new Map<string, { parent: string | null; at: number }>();
  private kernelBase = 0;
  private wallBase = 0;
  private kernelLast = 0;
  private exposuresOff = false;
  private readonly sphere: { c: [number, number, number]; r: number } = { c: [0, 0, 0], r: 1 };

  private drag: { x: number; y: number; ox: number; oy: number; pan: boolean; moved: boolean } | null = null;
  private readonly touches = new Map<number, { x: number; y: number }>();
  private pinch: { gap: number; x: number; y: number } | null = null;
  private cameraMoved = false;
  private readonly spheres: Sphere[] = [];
  private readonly labelTurns = new Map<string, number>();
  private stillMoons = new Set<string>();

  private shown = false;
  private retired = false;
  private displayEpoch = 0;
  private losses: number[] = [];
  private restoreTimer: ReturnType<typeof setTimeout> | undefined;
  private tier: Tier | null = null;

  constructor(free: Rect, craftK: number) {
    this.free = free;
    this.craftK = craftK;
    this.camera = systemCamera(free);
    this.frame = skyFrame();
    this.sky = buildSky([], [], this.frame);
    const { arcs24: plumes, wakes, rings, hulls, beams } = this.buffers;
    this.fleet = new FleetEngine({ plumes, wakes, rings, hulls, beams }, (id) => this.bodies.get(id));
    this.rig = new CameraRig(this.camera, free, {
      touring: (touring, journey = false) => setScene({ camera: { angle: null, touring, journey } }),
      worldSphere: (id) => this.sphereOf(id),
      outerOrbit: (id) => this.fleet.outerOrbit(id),
      chase: (id, hull, tangent, outward) => {
        const body = this.fleet.frameOf(id, tangent, outward);
        if (!body || !this.fleet.positionOf(id, hull)) return null;
        return this.sphereOf(body.worldId);
      },
      bodies: () => this.spheres,
      now: () => performance.now(),
      hold: (ms) => this.pulse(ms),
      reduced: () => this.reduced,
      drifts: () => !this.reduced && !this.onBattery && useNaos.getState().view.settings.idleDrift,
      enter: (id) => { selectWorld(id); flyToSelection(); },
      leave: () => flyHome(),
    });
  }

  /** The rig's and the labels' list of what stands in the way, the hole first. */
  private rebuildSpheres(): void {
    this.spheres.length = 0;
    this.spheres.push({ c: [0, 0, 0], r: HOLE_RADIUS });
    for (const [id, b] of this.bodies) this.spheres.push({ c: [b.position.x, b.position.y, b.position.z], r: b.radius, id });
  }

  private sphereOf(id: string): Sphere | null {
    const body = this.bodies.get(id);
    if (!body) return null;
    this.sphere.c[0] = body.position.x;
    this.sphere.c[1] = body.position.y;
    this.sphere.c[2] = body.position.z;
    this.sphere.r = body.radius;
    return this.sphere;
  }

  // ---- what React and the Stage hold ---------------------------------------------------------------------------------------

  /** The month for the sky pass. Its identity changes only when a digest landed. */
  readonly currentSky = (): SkyData => this.sky;
  readonly onSky = (fn: () => void): (() => void) => { this.skyWatchers.add(fn); return () => this.skyWatchers.delete(fn); };
  readonly cadence = (): Cadence => this.current;
  /** Set by Live from the same battery reading the driver uses. */
  onBattery = false;

  /** Every world as it stands now. The seam the planet renderer plugs into, stand-in limbs read the same numbers. */
  worldStates(): WorldState[] {
    return [...this.bodies.values()].map((b) => ({
      worldId: b.worldId, slot: b.index + 1, belt: b.belt, position: b.position, radius: b.radius, axis: b.axis, spin: b.spin, load: b.load, glow: 1 + b.glow, moons: b.moons,
    }));
  }

  /** The lights of finished agents on one world, oldest first, so a planet only ever has to add the new ones. A new list when they change. */
  lightsOf(worldId: string): readonly CityLight[] { return this.lightsByWorld.get(worldId) ?? NO_LIGHTS; }
  worldBody(worldId: string): { position: THREE.Vector3; radius: number; a: THREE.Vector3; b: THREE.Vector3 } | undefined { return this.bodies.get(worldId); }

  /** The planet renderer has these worlds on screen. Until then the stand-in keeps showing, so no world is ever missing for a frame. */
  handOver(ids: ReadonlySet<string>): void {
    if (ids.size === this.drawnElsewhere.size && [...ids].every((id) => this.drawnElsewhere.has(id))) return;
    this.drawnElsewhere = new Set(ids);
    this.writeWorlds();
    this.writeCities();
    this.redraw();
  }

  attach(invalidate: (frames?: number) => void, gl: THREE.WebGLRenderer): void {
    this.invalidate = invalidate;
    this.gl = gl;
    this.redraw(2);
  }

  setTier(tier: Tier): void {
    this.tier = tier;
    this.buffers.cities.cap(tier.cities);
    setScene({ tier });
    this.redraw();
  }

  bindLabels(sink: LabelSink | null): void {
    this.sink = sink;
    this.writeLabels();
  }

  start(): () => void {
    const media = reducedQuery();
    const motion = () => { this.reduced = media?.matches ?? false; this.sync(); };
    this.reduced = media?.matches ?? false;
    media?.addEventListener('change', motion);
    setAngleSource((id) => this.fleet.angleOf(id));
    const finish = () => { this.rig.noteInput(); this.rig.finish(); };
    window.addEventListener('keydown', finish, true);
    const off = () => this.rig.steerOff();
    window.addEventListener('keyup', off, true);
    window.addEventListener('blur', off);
    registerKeys(this.cameraKeys());
    const stops = [
      onCameraCommand((command) => {
        if (command.type === 'angle') {
          this.rig.angle(command.angle);
          setScene({ camera: { angle: command.angle, touring: false } });
        } else if (command.type === 'journey') this.rig.startJourney();
        else if (command.enabled) this.rig.startTour();
        else this.rig.stopTour();
        this.redraw(2);
      }),
      onFleetEvents(this.onEvents),
      useNaos.subscribe((s) => s.scene.demo, (demo, previous) => { if (demo?.active && !previous?.active) this.rig.stopTour(); this.animate(); }),
      useNaos.subscribe((s) => s.view.settings, (settings, previous) => {
        if (settings.signalRoutes !== previous.signalRoutes || settings.auroras !== previous.auroras) this.redraw(2);
      }),
      useNaos.subscribe((s) => s.rates.at, (at) => { this.kernelBase = at; this.wallBase = performance.now(); }),
      useNaos.subscribe((s) => s.model, () => this.sync()),
      useNaos.subscribe((s) => s.view, () => this.sync()),
      useNaos.subscribe((s) => s.shell, () => this.sync()),
    ];
    const timer = setInterval(() => this.sync(), 250);
    const visible = () => { this.redraw(); this.sync(); };
    document.addEventListener('visibilitychange', visible);
    const handle = (window as unknown as { __naosScene?: unknown });
    handle.__naosScene = this;
    this.stats.startedAt = performance.now();
    this.sync();
    return () => {
      if (this.losses.length > 0) this.loseQuietly();
      window.removeEventListener('keydown', finish, true);
      window.removeEventListener('keyup', off, true);
      window.removeEventListener('blur', off);
      unregisterKeys(CAMERA_KEY_IDS);
      setAngleSource(null);
      this.rig.finish();
      clearInterval(timer);
      clearTimeout(this.restoreTimer);
      for (const stop of stops) stop();
      media?.removeEventListener('change', motion);
      document.removeEventListener('visibilitychange', visible);
      if (handle.__naosScene === this) delete handle.__naosScene;
      setScene({ mounted: false, context: 'none', cadence: 'rest', tier: null });
    };
  }

  /** Asks for frames now. Rest means no frames, so anything that changes the picture at rest comes through here. The Sky covers the canvas, so it rests. */
  private redraw(frames = 1): void {
    if (useNaos.getState().view.sky) return;
    this.invalidate?.(frames);
  }

  /** An event: 60 Hz until `ms` from now, and its hold. */
  private pulse(ms: number): void {
    this.holdUntil = Math.max(this.holdUntil, performance.now() + ms + EVENT_HOLD_MS);
    this.updateCadence(useNaos.getState());
  }

  // ---- four times a second ---------------------------------------------------------------------------------------------------

  private readonly updateCadence = (s: NaosState): void => {
    const { fleet, rates, link, view } = s;
    if (document.hidden || link.status !== 'up' || view.sky || view.overlays.length > 0 || s.scene.context === 'lost') this.rig.stopTour();
    const managed = new Set(Object.values(fleet.managed).map((m) => m.nodeId));
    let burning = false;
    let observed = false;
    for (const id in rates.nodes) {
      if ((rates.nodes[id]?.tps ?? 0) <= 0) continue;
      if (managed.has(id)) burning = true; else observed = true;
    }
    if (this.settling) burning = true;
    for (const session of Object.values(fleet.sessions)) {
      if (session.endedAt !== null || managed.has(session.rootNodeId)) continue;
      const state = session.activity.state;
      if (state === 'generating' || state === 'tool_running' || state === 'starting' || state === 'retrying') observed = true;
    }
    if (this.fleet.animated) observed = true;
    const next = chooseCadence({
      now: performance.now(),
      hidden: document.hidden,
      linkUp: link.status === 'up',
      covered: view.sky || s.scene.context === 'lost',
      burning,
      observed,
      holdUntil: this.holdUntil,
      still: this.reduced,
    });
    if (next === this.current) return;
    this.current = next;
    setScene({ cadence: next });
    if (next !== 'rest') this.wake.current?.();
  };

  private sync(): void {
    const s = useNaos.getState();
    this.state.still = this.reduced;
    if (this.reduced) this.state.diskFlares.length = 0;
    const cut = s.epoch !== this.epoch;
    this.epoch = s.epoch;
    if (cut) { this.cutUntil = performance.now() + CUT_RATES_MS; this.tokens = null; this.kernelLast = 0; this.departures.clear(); this.state.diskFlares.length = 0; }
    this.syncStreams(s);

    const { free, craftK } = s.shell;
    let resized = false;
    if (free.w !== this.free.w || free.h !== this.free.h || craftK !== this.craftK) {
      this.free = free;
      this.craftK = craftK;
      this.camera.aspect = free.w / free.h;
      this.camera.updateProjectionMatrix();
      this.state.skyDirty = this.state.coronaDirty = true;
      this.rig.resize(free);
      resized = true;
    }

    const chart = chartOf(s.model, free, craftK, s.view.selected);
    if (chart !== this.chart || resized) this.applyChart(chart, cut || resized, s);

    this.syncFleet(s, resized);
    this.syncPlan(s, cut);
    this.syncHistory(s);
    this.syncWells(s, chart);

    this.syncDim(s);

    const desat = s.link.status === 'up' ? 0 : 0.4;
    if (desat !== this.state.desat) { this.state.desat = desat; this.redraw(); }

    this.updateCadence(s);
  }

  /**
   * The rates of a new fleet land a moment after its snapshot, and a seek is not a decay, so for that moment the corona cuts. After
   * it, a change wakes the frames that ease it in, which also covers a corona settling after the last token.
   */
  private syncStreams(s: NaosState): void {
    // A lost link freezes the scene as it stood, DESIGN 12.3. Silence is not a fleet at rest.
    if (s.link.status !== 'up') { this.settling = false; return; }
    const perWorld = s.rates.fleet?.perWorld;
    const cutting = performance.now() < this.cutUntil;
    let moved = false;
    for (const body of this.bodies.values()) {
      const target = streamLoad(perWorld?.[body.worldId] ?? 0);
      if (Math.abs(target - body.load) <= STREAM_EPSILON) continue;
      moved = true;
      if (cutting) body.load = target;
    }
    // Easing is motion, so it runs at a cadence like any other and never as a chain of redraws at the full rAF rate.
    this.settling = moved && !cutting;
    if (moved) { this.state.coronaDirty = true; this.redraw(); }
  }

  private applyChart(chart: Chart, cut: boolean, s: NaosState): void {
    this.chart = chart;
    const now = performance.now();
    let moved = false;
    for (const mark of chart.worlds) {
      const id = mark.world.worldId;
      const to = { x: mark.at[0], y: mark.at[1], z: mark.at[2], r: mark.radius };
      const paths = (s.fleet.worlds[id]?.worktrees ?? []).map((t) => t.path);
      let body = this.bodies.get(id);
      if (!body) {
        const created: Body = {
          worldId: id, index: mark.belt ? 99 : Math.max(0, mark.world.slot - 1), belt: mark.belt, plane: mark.plane, ring: mark.ring, to, from: to, shown: { ...to }, t0: 0, ms: 0,
          position: new THREE.Vector3(to.x, to.y, to.z), radius: to.r, a: new THREE.Vector3().fromArray(mark.plane.a), b: new THREE.Vector3().fromArray(mark.plane.b),
          load: 0, moons: [], wakes: false, glow: 0, rCss: to.r, perUnit: 1,
          axis: new THREE.Vector3().fromArray(spinAxis(Math.max(0, mark.world.slot - 1))), spin: (hash32(id) % 628) / 100,
          moonAt: (key, out) => {
            for (let i = 0; i < created.moons.length; i++) {
              if (created.moons[i]!.key === key) { out.copy(created.moons[i]!.position); return true; }
            }
            return false;
          },
        };
        body = created;
        this.bodies.set(id, body);
        moved = true;
      }
      body.ring = mark.ring;
      const changed = Math.hypot(to.x - body.to.x, to.y - body.to.y, to.z - body.to.z) > 0.25 || Math.abs(to.r - body.to.r) > 0.1;
      if (paths.length !== body.moons.length || paths.some((p, i) => p !== body.moons[i]?.key)) { this.fitMoons(body, paths); moved = true; }
      if (changed && !cut && !this.reduced) {
        // A jump in place is a world waking, a change of size is the usage index landing.
        body.wakes = Math.hypot(to.x - body.to.x, to.y - body.to.y, to.z - body.to.z) > 12;
        body.from = { ...body.shown };
        body.t0 = now;
        body.ms = body.wakes ? WAKE_MS : MASS_MS;
        this.pulse(body.ms);
      } else if (changed || cut) {
        body.ms = 0;
        body.shown = { ...to };
      }
      if (changed) moved = true;
      body.to = to;
    }
    for (const id of this.bodies.keys()) {
      if (!chart.worlds.some((w) => w.world.worldId === id)) { this.bodies.delete(id); moved = true; }
    }
    if (moved || cut) this.placeBodies();
    const off = s.view.level === 'craft';
    if (off !== this.exposuresOff) { this.exposuresOff = off; this.exposuresDirty = true; moved = true; }
    const gain = s.model.craftCount === 0 ? EXPOSURE_GAIN.rest : EXPOSURE_GAIN.live;
    if (gain !== this.exposureGain) { this.exposureGain = gain; this.exposuresDirty = true; }
    const dirty = this.exposuresDirty;
    if (dirty) this.writeExposures();
    // The model is rebuilt four times a second whatever happens, and most of those change nothing on the canvas.
    if (moved || cut || dirty) this.redraw();
  }

  /** A moon keeps its phase while the list around it changes. */
  private fitMoons(body: Body, paths: readonly string[]): void {
    const was = new Map(body.moons.map((m) => [m.key, m]));
    body.moons = paths.map((key, i) => was.get(key) ?? {
      key, phase: (hash32(key) % 628) / 100, rate: moonRate(i), reach: moonReach(body.shown.r, i), radius: moonRadius(body.shown.r), position: new THREE.Vector3(), held: false,
    });
  }

  private writeWorlds(): void {
    const { worlds, uWorld, uSpin } = this.buffers;
    worlds.clear();
    for (const body of this.bodies.values()) {
      const focused = useNaos.getState().view.level === 'system' || useNaos.getState().view.worldId === body.worldId;
      if (focused && !this.drawnElsewhere.has(body.worldId)) worlds.add(body.position, body.radius, 1 + body.glow);
      if (body.index < 32) {
        const i = body.index * 4;
        uWorld[i] = body.position.x;
        uWorld[i + 1] = body.position.y;
        uWorld[i + 2] = body.position.z;
        uWorld[i + 3] = body.radius;
        uSpin[i] = body.axis.x;
        uSpin[i + 1] = body.axis.y;
        uSpin[i + 2] = body.axis.z;
        uSpin[i + 3] = body.spin;
      }
      for (const m of body.moons) {
        m.position.copy(body.position).addScaledVector(body.a, Math.cos(m.phase) * m.reach).addScaledVector(body.b, Math.sin(m.phase) * m.reach);
        if (focused) worlds.add(m.position, m.radius);
      }
    }
  }

  /** Radius and place from what is shown. */
  private placeBodies(): void {
    const { paths } = this.buffers;
    paths.clear();
    for (const body of this.bodies.values()) {
      body.position.set(body.shown.x, body.shown.y, body.shown.z);
      body.radius = body.rCss = body.shown.r;
      for (const m of body.moons) { m.reach = m.reach * (body.shown.r / (body.to.r || 1)) || m.reach; m.radius = moonRadius(body.shown.r); }
      if (body.belt || useNaos.getState().view.level !== 'system') continue;
      paths.add({
        center: ORIGIN, a: spanA.fromArray(body.ring.u).multiplyScalar(body.ring.radius), b: spanB.fromArray(body.ring.v).multiplyScalar(body.ring.radius), start: 0, sweep: Math.PI * 2,
        color: linear('pearl'), gain: PATH_GAIN, width: 0.6, taper: 0,
      });
    }
    paths.commit();
    this.rebuildSpheres();
    this.writeWorlds();
    this.exposuresDirty = true;
  }

  /** Physics, INTERSTELLAR 22. It runs on the wall clock and never reaches zero while the window shows. Reduced motion holds it. */
  private stepPhysics(dt: number): void {
    if (this.reduced || dt <= 0) return;
    for (const body of this.bodies.values()) {
      body.spin = (body.spin + spinRate(body.load) * dt) % (Math.PI * 2);
      for (const m of body.moons) {
        m.held = this.stillMoons.has(m.key);
        if (!m.held) m.phase += m.rate * dt;
      }
    }
    this.buffers.beltTurn.value = (this.buffers.beltTurn.value + BELT_RATE * dt) % (Math.PI * 2);
    this.writeWorlds();
  }

  private writeExposures(): void {
    this.exposuresDirty = false;
    const arcs = this.buffers.arcs48;
    arcs.clear();
    const city = linear('city');
    // 7.9: a long exposure is a System and World thing. In the chase view it is a line across the sky.
    if (this.exposuresOff || !useNaos.getState().view.sky) return;
    for (const e of this.exposures) {
      const body = this.bodies.get(e.worldId);
      if (!body || (useNaos.getState().view.level !== 'system' && body.worldId !== useNaos.getState().view.worldId)) continue;
      const r = orbitCss(body.shown.r, e.altitude, 1);
      arcs.add({
        center: body.position, a: spanA.copy(body.a).multiplyScalar(r), b: spanB.copy(body.b).multiplyScalar(r),
        start: e.start, sweep: e.sweep, color: city, gain: this.exposureGain, width: 0.6, taper: 1,
      });
    }
  }

  private syncPlan(s: NaosState, cut: boolean): void {
    const { model, view } = s;
    const left = model.sun.fiveLeft;
    const target = 0.58 + 0.2 * streamLoad(s.rates.fleet?.tps ?? 0);
    if (target !== this.sunTo) {
      this.sunFrom = this.state.sunLeft;
      this.sunTo = target;
      this.sunAt = performance.now();
      if (cut || this.reduced) this.sunFrom = target;
      else this.pulse(SUN_MS);
      this.state.sunLeft = this.sunFrom;
      this.redraw();
    }
    this.sevenLeft = model.sun.sevenLeft;
    const key = `${left}|${this.sevenLeft}|${model.sun.stale}|${this.free.w}x${this.free.h}|${view.level}`;
    if (key !== this.arcsKey) {
      this.arcsKey = key;
      this.fiveLeft = left;
      this.stale = model.sun.stale;
      this.system = view.level === 'system';
      this.writeRimArcs();
      this.redraw();
    }
  }

  /** The gauge: five hour outside, seven day inside, from one o'clock clockwise, as on the Plate. System level only. */
  private writeRimArcs(): void {
    const arcs = this.buffers.arcs96;
    const { fiveLeft: left, sevenLeft: seven, stale } = this;
    arcs.clear();
    if (!this.system || Object.values(useNaos.getState().fleet.sessions).some((session) => session.source?.client !== undefined && session.source.client !== 'claude-code')) return;
    const discR = HOLE_RADIUS;
    const start = Math.PI / 3;
    this.camera.matrixWorld.extractBasis(rimRight, rimUp, rimBack);
    const arc = (r: number, fraction: number, token: 'pearl' | 'bone', gain: number, width: number) => {
      const sweep = Math.min(0.999, Math.max(0.001, fraction)) * Math.PI * 2;
      arcs.add({
        center: ORIGIN, a: rimA.copy(rimRight).multiplyScalar(r), b: rimB.copy(rimUp).multiplyScalar(r), start: start - sweep, sweep,
        color: linear(token), gain, width, ...(stale ? { dashCycles: Math.round((sweep * r) / 7) } : {}),
      });
    };
    if (left !== null) arc(discR + 7, left, 'pearl', 0.22, 0.42);
    if (seven !== null) arc(discR + 3, seven, 'bone', 0.16, 0.36);
  }

  private syncHistory(s: NaosState): void {
    const { history, salvos, fleet, model } = s;
    let closed = 0;
    for (const id in fleet.salvos) if (fleet.salvos[id]?.closedAt !== null) closed += 1;
    if (history === this.seen.history && salvos === this.seen.salvos && closed === this.seen.closed) return;
    const now = performance.now();
    // A landing changes the month. Rebuilding 36,000 points for each one is not worth it, the first load is.
    if (now - this.skyAt < SKY_EVERY_MS && this.seen.count > 0) return;
    this.seen = { history, salvos, closed, count: history.length };
    this.skyAt = now;
    this.sky = buildSky(skyStars(history, model.now), skySpokes([salvos, Object.values(fleet.salvos)], model.now), this.frame);
    for (const fn of this.skyWatchers) fn();

    this.lights = cityLights(history);
    this.lightsByWorld = new Map();
    for (const light of this.lights) {
      const list = this.lightsByWorld.get(light.worldId);
      if (list) list.push(light);
      else this.lightsByWorld.set(light.worldId, [light]);
    }
    this.writeCities();
    this.exposures = exposuresOf(history, model.now);
    this.exposuresDirty = true;
    this.writeExposures();
    this.redraw(2);
  }

  /** City points on the stand-in discs. A world the planet renderer has carries its lights in its own bake. */
  private writeCities(): void {
    const { cities, uWorld } = this.buffers;
    cities.clear();
    for (const light of this.lights) {
      if (this.drawnElsewhere.has(light.worldId)) continue;
      const k = this.bodies.get(light.worldId)?.index ?? 99;
      if (k < uWorld.length / 4 && cities.count < 8192) cities.add(light.dir[0], light.dir[1], light.dir[2], k, light.fail);
    }
    if (this.tier) cities.cap(this.tier.cities);
  }

  /** Static strength by age. The forming, the wavefront and the rebound are Layer 6. Answerable only, the chart has already seen to that. */
  private syncWells(s: NaosState, chart: Chart): void {
    const wells = chart.wells.slice(0, MAX_WELLS);
    const list = this.state.wells;
    this.wellIds.length = 0;
    let changed = list.length !== wells.length;
    for (let i = 0; i < wells.length; i++) {
      const w = wells[i]!;
      const ring = w.danger ? 1 : 0;
      const row: WellInput = list[i] ?? { position: new THREE.Vector3(), thetaCss: 0, ring };
      list[i] = row;
      if (Math.abs(row.thetaCss - w.theta) > 0.2 || row.ring !== ring) changed = true;
      this.wellIds.push(w.id ?? '');
      if (!this.fleet.positionOf(w.id ?? '', row.position) && w.at) row.position.fromArray(w.at);
      row.thetaCss = w.theta;
      row.ring = ring;
    }
    list.length = wells.length;
    if (changed && !s.view.sky) this.redraw();
  }

  /** The docket dims the sky and leaves the ring alone. The lock, the brackets and the leader around it are Layer 6. */
  private syncDim(s: NaosState): void {
    const open = s.view.overlays.some((o) => o.id === 'docket');
    const target = open ? DOCKET_DIM : 1;
    const well = this.state.wells[0];
    this.state.focus = open && well ? { position: well.position, inner: well.thetaCss * 1.12, outer: well.thetaCss * 1.5 } : null;
    if (target === this.dimTo) return;
    this.dimFrom = this.state.dim;
    this.dimTo = target;
    this.dimAt = performance.now();
    if (this.reduced) { this.dimAt = 0; this.state.dim = target; this.redraw(); } else this.pulse(DIM_MS);
  }

  /** Four times a second, the same on every level: what stands where on this camera, then the collision search of 4.5. */
  private buildLabels(s: NaosState, force: boolean): void {
    const { model, view } = s;
    const { level, worldId, selected } = view;
    const free = this.free;
    const dots: Array<{ x: number; y: number }> = [];
    const crafts: Array<CraftLabelIn & { vm: CraftVM; text: string }> = [];
    const few = model.craftCount < LABEL_ALL_BELOW;
    const open = new Set(model.decisions.filter((d) => d.status === 'open').map((d) => d.nodeId));
    const shown: Array<{ c: CraftVM; x: number; y: number }> = [];
    this.fleet.forEachSlot((slot) => {
      if (!slot.drawn) return;
      dots.push({ x: slot.x, y: slot.y });
      const c = model.crafts[slot.id];
      if (!c || slot.role === 'bead') return;
      const wanted = level === 'world' ? c.worldId === worldId && c.kind === 'main'
        : level === 'craft' ? c.id === selected
        : (few && c.kind === 'main') || c.id === selected || open.has(c.id) || c.state === 'source' || c.state === 'parked' || c.state === 'errored' || c.state === 'crashed' || this.fleet.tenderCount(c.id) > TENDERS_DRAWN;
      if (wanted) shown.push({ c, x: slot.x, y: slot.y });
    });
    shown.sort((a, b) => a.c.tier - b.c.tier);
    for (const { c, x, y } of shown) {
      const past = this.fleet.tenderCount(c.id) - TENDERS_DRAWN;
      const tag = level === 'system' ? craftTag(c, open.has(c.id)) ?? '' : levelTag(c);
      // 7.9: past four tenders the System view draws a count on the parent.
      const text = level === 'system' && past > 0 ? `${tag} +${past}`.trim() : tag;
      const reach = level === 'craft' ? CHASE_LABEL_REACH : c.state === 'source' ? 33 * this.craftK : c.state === 'parked' ? 20 * this.craftK : undefined;
      crafts.push({ id: c.id, x, y, width: (c.glyph.length + (text ? text.length + 1 : 0)) * CHAR_PX, vm: c, text, ...(reach ? { reach } : {}) });
    }
    // The Veil is in the key: a label holds its place for a moment, but never its name.
    const key = `${model.veil}|${level}|${worldId}|${selected}|${model.almanac.length}|${free.w}x${free.h}|${model.allWorlds.length}|${crafts.map((c) => c.id).join()}`;
    const now = performance.now();
    const due = now - this.labelsAt >= (this.cameraMoved ? LABEL_MOVING_MS : LABEL_EVERY_MS);
    if (!force && key === this.labelsKey && !due) { this.refreshLabelText(crafts); return; }
    this.labelsKey = key;
    this.labelsAt = now;
    this.cameraMoved = false;

    const worlds = [];
    const scale = cssPerUnit(this.camera, free, ORIGIN);
    for (const w of model.allWorlds) {
      const body = this.bodies.get(w.worldId);
      if (!body || (level !== 'system' && body.worldId !== worldId) || !this.onScreen(body.position, seenFrom)) continue;
      const r = body.radius * cssPerUnit(this.camera, free, body.position);
      worlds.push({ id: w.worldId, x: seenFrom.x, y: seenFrom.y, r, width: labelText({ world: w }).length * CHAR_PX, w });
    }
    const star = this.onScreen(ORIGIN, seenHome) ? { x: seenHome.x, y: seenHome.y } : { x: 1e6, y: 1e6 };
    const plumes: Array<{ x: number; y: number }> = [];
    this.fleet.plumePoints(this.camera, plumes);
    const out = placeLabels({
      worlds, crafts, dots, plumes, held: this.labelTurns, discR: HOLE_RADIUS * scale, discX: star.x, discY: star.y, w: free.w, h: free.h, almanacTop: almanacTop(model.almanac.length, free.h),
    });
    this.labelTurns.clear();
    for (const l of out) this.labelTurns.set(l.id, l.turn);
    const placed = new Map(out.map((l) => [l.id, l]));
    const rows: LabelRow[] = [];
    for (const w of worlds) {
      const l = placed.get(w.id);
      if (l && !l.hidden) rows.push({ key: w.id, kind: 'world', worldId: w.id, glyph: '', text: labelText({ world: w.w }), x: l.x, y: l.y, anchor: l.anchor, tone: 'rest', ax: w.x, ay: w.y });
    }
    for (const c of crafts) {
      const l = placed.get(c.id);
      if (!l || l.hidden) continue;
      // A wait you can answer here is sodium. One you must answer elsewhere stays neutral, as it does on the rail.
      rows.push({ key: c.id, kind: 'craft', worldId: c.vm.worldId, glyph: c.vm.glyph, text: c.text, x: l.x, y: l.y, anchor: l.anchor, tone: open.has(c.id) ? 'need' : c.vm.state === 'source' ? 'wait' : c.vm.tone, ax: c.x, ay: c.y });
    }
    this.labels = rows;
    this.writeLabels();
  }

  /** A metric ticks every second. That is a text write, not a reason to move anything. */
  private refreshLabelText(crafts: ReadonlyArray<{ id: string; text: string }>): void {
    let changed = false;
    for (const row of this.labels) {
      if (row.kind !== 'craft') continue;
      const c = crafts.find((x) => x.id === row.key);
      if (c && c.text !== row.text) { row.text = c.text; changed = true; }
    }
    if (changed) this.writeLabels();
  }

  /** From the centre of the free rect, y down. False behind the camera or well outside the frame. */
  private onScreen(p: THREE.Vector3, out: THREE.Vector2): boolean {
    if (!toCanvasPx(this.camera, p, this.free.w, this.free.h, out)) return false;
    out.set(out.x - this.free.w / 2, this.free.h / 2 - out.y);
    return Math.abs(out.x) < this.free.w * 0.6 && Math.abs(out.y) < this.free.h * 0.6;
  }

  /** Called from `beforeFrame` while anything moves, and at once when the model changes: at rest there are no frames to wait for. */
  private writeLabels(): void {
    this.sink?.(this.labels, this.free, this.shiftOf);
  }

  private readonly shift: LabelShift = { x: 0, y: 0, hidden: false, behind: false };

  /** Whether a body stands between the camera and this point. `own` is the world a world's label belongs to: it cannot hide itself. */
  private readonly occluded = (p: THREE.Vector3, own: THREE.Vector3 | null = null): boolean => {
    const eye = this.camera.position;
    const dx = p.x - eye.x;
    const dy = p.y - eye.y;
    const dz = p.z - eye.z;
    const reach = Math.hypot(dx, dy, dz) || 1;
    for (const s of this.spheres) {
      if (s.id && useNaos.getState().view.level !== 'system' && s.id !== useNaos.getState().view.worldId) continue;
      if (own && s.c[0] === own.x && s.c[1] === own.y && s.c[2] === own.z) continue;
      const cx = s.c[0] - eye.x;
      const cy = s.c[1] - eye.y;
      const cz = s.c[2] - eye.z;
      const t = (cx * dx + cy * dy + cz * dz) / reach;
      if (t <= 0 || t >= reach) continue;
      if (cx * cx + cy * cy + cz * cz - t * t < s.r * s.r * 0.96) return true;
    }
    return false;
  };

  private readonly shiftOf = (row: LabelRow): LabelShift => {
    const out = this.shift;
    out.hidden = false;
    out.behind = false;
    if (row.kind === 'craft') {
      const spot = this.fleet.spot(row.key);
      if (spot) {
        out.x = spot.x - row.ax;
        out.y = spot.y - row.ay;
        if (this.fleet.positionOf(row.key, moon)) out.behind = this.occluded(moon);
      } else out.hidden = true;
      return out;
    }
    const body = row.worldId === null ? undefined : this.bodies.get(row.worldId);
    if (body && this.onScreen(body.position, seenFrom)) {
      out.x = seenFrom.x - row.ax;
      out.y = seenFrom.y - row.ay;
      out.behind = this.occluded(body.position, body.position);
    } else out.hidden = true;
    return out;
  };

  // ---- the fleet -----------------------------------------------------------------------------------------------------------------

  private kernelClock(wall: number): number {
    return this.kernelBase + Math.min(CLOCK_COAST_MS, wall - this.wallBase);
  }

  private syncFleet(s: NaosState, resized: boolean): void {
    const { model, view, fleet } = s;
    const wall = performance.now();
    const cutting = wall < this.cutUntil;
    const craftId = view.level === 'craft' ? view.selected : null;
    const viewKey = `${view.level}|${view.worldId}|${view.selected}|${view.sky}`;
    const viewChanged = viewKey !== this.viewSeen;
    if (viewChanged) { this.placeBodies(); this.writeExposures(); }
    if (model !== this.rosterFrom || viewChanged || resized || cutting) {
      this.rosterFrom = model;
      this.viewSeen = viewKey;
      this.roster = rosterOf(model.crafts, fleet);
      const discR = HOLE_RADIUS;
      this.stillMoons.clear();
      for (const c of this.roster.crafts) if (c.moon && c.tps <= 0) this.stillMoons.add(c.moon);
      this.fleet.setRoster(this.roster, { level: view.level, worldId: view.worldId, selected: view.selected }, { free: this.free, craftK: this.craftK, discR, reduced: this.reduced, cut: cutting, hidden: (point) => this.occluded(point) }, this.kernelClock(wall));
      const key = rosterKey(this.roster) + viewKey;
      if (key !== this.rosterSeen) { this.rosterSeen = key; this.redraw(2); }
    }
    this.fleet.meshOf = craftId;
    for (const [id, launch] of this.departures) {
      if (cutting || wall - launch.at > 10_000 || this.fleet.launch(id, launch.parent, launch.at)) this.departures.delete(id);
    }
    this.rig.go({ level: view.level, worldId: view.worldId, craftId }, cutting || !this.shown);
    this.buildLabels(s, resized || viewChanged);
  }

  /** Transient effects come only from here. A snapshot carries none, so a seek shows the right state and never replays one. */
  private readonly onEvents = (events: readonly NaosEvent[]): void => {
    const { fleet } = this;
    const { fleet: state } = useNaos.getState();
    const wall = performance.now();
    let hold = 0;
    const owned = (id: string): boolean => Object.values(state.managed).some((m) => m.nodeId === id);
    for (const e of events) {
      switch (e.type) {
        case 'kernel.tick':
          if (fleet.hasBeacons()) {
            fleet.beacon(wall);
            this.redraw();
            setTimeout(() => this.redraw(), BEACON_OFF_MS);
          }
          break;
        case 'tool.started':
          fleet.toolStarted(e.nodeId, e.toolFamily, wall);
          if (e.toolFamily === 'other' || e.toolFamily === 'launch') hold = Math.max(hold, 200);
          break;
        case 'tool.finished':
          if (e.isError) { fleet.spark(e.nodeId, wall); hold = Math.max(hold, 300); } else if (e.toolFamily === 'edit' && e.decision !== 'reject') { fleet.scorch(e.nodeId, wall); hold = Math.max(hold, 100); }
          break;
        case 'message.completed':
          if (!owned(e.nodeId)) { fleet.burn(e.nodeId, e.usage.output, wall); hold = Math.max(hold, 2400); }
          break;
        case 'session.ended':
          fleet.land(e.nodeId, e.outcome === 'abandoned', wall);
          hold = Math.max(hold, 1800);
          break;
        case 'agent.ended':
          if (e.status === 'completed' || e.status === 'failed') { fleet.land(e.nodeId, e.status === 'failed', wall); hold = Math.max(hold, 1800); }
          break;
        case 'session.discovered':
          if (freshStart(e.session.startedAt, e.observedAt)) {
            this.departures.set(e.session.rootNodeId, { parent: null, at: wall });
            const body = this.bodies.get(e.session.worldId);
            if (body && !this.reduced && this.state.diskFlares.length < 8) this.state.diskFlares.push({ azimuth: Math.atan2(body.position.z, body.position.x), strength: 0.4, age: 0, clock: -1, born: this.state.now });
            hold = Math.max(hold, 3000);
          }
          break;
        case 'agent.started':
          if (e.node.parentNodeId && e.node.kind !== 'workflow-agent' && freshStart(e.node.startedAt, e.observedAt)) {
            this.departures.set(e.nodeId, { parent: e.node.parentNodeId, at: wall });
            hold = Math.max(hold, 1500);
          }
          break;
        case 'salvo.opened': {
          const body = this.bodies.get(e.salvo.worldId);
          if (body && !this.reduced) {
            if (this.state.diskFlares.length >= 8) this.state.diskFlares.shift();
            this.state.diskFlares.push({ azimuth: Math.atan2(body.position.z, body.position.x), strength: 0.6, age: 0, clock: -1, born: this.state.now });
            hold = Math.max(hold, 5000);
          }
          break;
        }
        case 'compacted':
          fleet.compacted(e.nodeId, wall);
          hold = Math.max(hold, 1000);
          break;
        case 'turn.ended':
          fleet.tick(e.nodeId, 'oiii', 1.6, 4, 180, wall);
          hold = Math.max(hold, 200);
          break;
        case 'link.fired':
          if (e.kind === 'send' && e.to) { fleet.line(e.from, e.to, wall); hold = Math.max(hold, 1200); }
          break;
        default:
      }
    }
    if (hold > 0) this.pulse(hold);
  };

  // ---- every rendered frame --------------------------------------------------------------------------------------------------

  beforeFrame(gl: THREE.WebGLRenderer): void {
    if (this.metering) this.meter.frameStart(gl);
    const t = performance.now();
    const dt = Math.min(0.25, (t - (this.last || t)) / 1000);
    this.last = t;
    this.clock += dt;
    const { state } = this;
    state.now = this.clock;

    if (this.sunAt > 0) {
      const k = Math.min(1, (t - this.sunAt) / SUN_MS);
      state.sunLeft = this.sunFrom + (this.sunTo - this.sunFrom) * settle(k);
      if (k >= 1) { this.sunAt = 0; state.coronaDirty = true; }
    } else state.sunLeft = this.sunTo;

    if (this.dimAt > 0) {
      const k = Math.min(1, (t - this.dimAt) / DIM_MS);
      state.dim = k >= 1 ? this.dimTo : this.dimFrom + (this.dimTo - this.dimFrom) * settle(k);
      if (k >= 1) this.dimAt = 0;
    }

    let moving = false;
    for (const body of this.bodies.values()) {
      if (body.ms === 0) continue;
      moving = true;
      const k = Math.min(1, (t - body.t0) / body.ms);
      const e = settle(k);
      body.shown.x = body.from.x + (body.to.x - body.from.x) * e;
      body.shown.y = body.from.y + (body.to.y - body.from.y) * e;
      body.shown.z = body.from.z + (body.to.z - body.from.z) * e;
      body.shown.r = body.from.r + (body.to.r - body.from.r) * e;
      body.glow = body.wakes ? WAKE_GLOW * Math.sin(Math.PI * k) : 0;
      if (k >= 1) body.ms = 0;
    }
    if (moving) {
      this.placeBodies();
      this.writeExposures();
    }
    this.stepPhysics(dt);
    const kernel = this.kernelClock(t);
    const kernelDt = this.kernelLast === 0 ? 0 : Math.max(0, Math.min(0.25, (kernel - this.kernelLast) / 1000));
    this.kernelLast = kernel;
    const flew = this.rig.step(dt);
    if (flew) {
      state.coronaDirty = true;
      this.cameraMoved = true;
      this.writeRimArcs();
    }
    this.checkHoleCovered();
    const { fleet } = this;
    fleet.hullScale = this.rig.hullScale;
    const busy = fleet.draw({ wall: t, kernel, dt: kernelDt, scene: this.clock }, this.camera);
    if (busy) this.pulse(100);
    for (let i = 0; i < state.wells.length; i++) {
      const well = state.wells[i];
      const id = this.wellIds[i];
      if (well && id) fleet.positionOf(id, well.position);
    }
    this.writeLabels();

    this.stepCorona(dt);
    const b = this.buffers;
    b.arcs48.commit();
    b.arcs96.commit();
  }

  /** The shadow stays black after bloom only while nothing stands in front of it. */
  private checkHoleCovered(): void {
    const star = cssPerUnit(this.camera, this.free, ORIGIN);
    const eye = this.camera.position.length();
    let covered = false;
    if (this.onScreen(ORIGIN, seenHome)) {
      for (const body of this.bodies.values()) {
        if (!this.onScreen(body.position, seenFrom) || this.camera.position.distanceTo(body.position) >= eye) continue;
        if (Math.hypot(seenFrom.x - seenHome.x, seenFrom.y - seenHome.y) < HOLE_RADIUS * star + body.radius * cssPerUnit(this.camera, this.free, body.position)) { covered = true; break; }
      }
    }
    this.state.holeCovered = covered;
  }

  private stepCorona(dt: number): void {
    const { state } = this;
    const { rates, link } = useNaos.getState();
    const fleet = rates.fleet;
    const tps = link.status === 'up' ? fleet?.tps ?? 0 : 0;
    state.tokensMoving = tps > 0 && !this.reduced;

    if (fleet) {
      if (this.tokens === null) this.tokens = fleet.outputTokens;
      if (state.tokensMoving) {
        // Rates arrive at 4 Hz. Between two frames the flow runs on the last rate, and the counter pulls it back so it cannot drift.
        this.tokens += tps * dt;
        this.tokens += (fleet.outputTokens - this.tokens) * Math.min(1, dt * 2);
        state.tokenClock = (this.tokens * 1e-5) % 1;
      }
    }

    const k = 1 - Math.exp(-dt / STREAM_TAU_S);
    let n = 0;
    let settling = false;
    state.diskArcs.length = 0;
    const up = link.status === 'up';
    for (const body of this.bodies.values()) {
      const target = up ? streamLoad(fleet?.perWorld[body.worldId] ?? 0) : body.load;
      body.load += (target - body.load) * (this.reduced ? 1 : k);
      if (Math.abs(target - body.load) > STREAM_EPSILON) settling = true; else body.load = target;
      if (body.load > 0.005 && n < MAX_STREAMS) {
        const arc = this.hotArcs[n]!;
        arc.azimuth = Math.atan2(body.position.z, body.position.x);
        arc.strength = body.load * 0.35;
        state.diskArcs.push(arc);
        toCanvasPx(this.camera, ORIGIN, this.free.w, this.free.h, seenHome);
        toCanvasPx(this.camera, body.position, this.free.w, this.free.h, seenFrom);
        state.streams[n * 2] = Math.atan2(seenFrom.y - seenHome.y, seenFrom.x - seenHome.x);
        state.streams[n * 2 + 1] = body.load;
        n += 1;
      }
    }
    state.streamCount = n;
    if (settling) state.coronaDirty = true;
    this.settling = settling;
  }

  afterFrame(gl: THREE.WebGLRenderer): void {
    if (this.metering) this.meter.frameEnd(gl);
    this.stats.frames += 1;
    if (this.shown || this.retired || gl.getContext().isContextLost()) return;
    const epoch = this.displayEpoch;
    this.shown = true;
    // Two rAFs: the frame has to be composited before the Plate stops being the picture.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (epoch !== this.displayEpoch || this.retired || gl.getContext().isContextLost()) return;
      if (!this.stats.firstFrameAt) this.stats.firstFrameAt = performance.now();
      document.getElementById('scene-slot')?.removeAttribute('data-lost');
      setScene({ mounted: true, context: 'ok' });
    }));
  }

  // ---- context ---------------------------------------------------------------------------------------------------------------

  readonly onLost = (): void => {
    if (this.retired) return;
    this.displayEpoch += 1;
    const at = performance.now();
    this.losses = [...this.losses.filter((t) => at - t < LOSS_WINDOW_MS), at];
    this.shown = false;
    // Before anything else: the canvas has no picture left, and the Plate under it must show this very frame.
    document.getElementById('scene-slot')?.setAttribute('data-lost', 'true');
    setScene({ mounted: false, context: 'lost' });
    clearTimeout(this.restoreTimer);
    this.restoreTimer = setTimeout(() => this.retire('the GPU context did not come back'), RESTORE_LIMIT_MS);
  };

  readonly onRestored = (): void => {
    clearTimeout(this.restoreTimer);
    if (this.losses.length >= 2) { this.retire('the GPU context was lost twice in 10 minutes'); return; }
    this.shown = false;
    this.state.skyDirty = this.state.coronaDirty = this.state.cubeLost = true;
    this.redraw(3);
  };

  readonly retire = (why: string): void => {
    if (this.retired) return;
    this.retired = true;
    clearTimeout(this.restoreTimer);
    this.loseQuietly();
    setScene({ retired: true, mounted: false, context: 'none', cadence: 'rest', why });
  };

  /**
   * After a restore some GPU objects still belong to the old context, and WebGL warns when the unmount frees them. A lost context
   * frees nothing, so it goes first. R3F then asks for the same thing, and that second call is the one to drop.
   */
  private loseQuietly(): void {
    const gl = this.gl;
    if (!gl) return;
    if (!gl.getContext().isContextLost()) gl.forceContextLoss();
    gl.forceContextLoss = () => undefined;
  }

  // ---- pointer ---------------------------------------------------------------------------------------------------------------

  /** What sits under a CSS point in the free rect, measured from its top left. The canvas covers the Plate's own hit targets. */
  private hit(x: number, y: number): { craft: string } | { world: string } | null {
    const px = x - this.free.w / 2;
    const py = y - this.free.h / 2;
    const craft = this.fleet.pick(px, py, PICK_PX, this.occluded);
    if (craft !== null) return { craft };
    // Nearest first: from behind, a far world may share the spot with a near one.
    let best: string | null = null;
    let bestDepth = Infinity;
    for (const body of this.bodies.values()) {
      // The Belt is a group, not a place: a rock is nothing to select.
      if (body.belt || (useNaos.getState().view.level !== 'system' && body.worldId !== useNaos.getState().view.worldId) || !this.onScreen(body.position, seenFrom)) continue;
      const r = body.radius * cssPerUnit(this.camera, this.free, body.position);
      if (Math.hypot(seenFrom.x - px, seenFrom.y - py) >= r + 6) continue;
      if (this.occluded(body.position, body.position)) continue;
      const depth = this.camera.position.distanceTo(body.position);
      if (depth < bestDepth) { bestDepth = depth; best = body.worldId; }
    }
    return best === null ? null : { world: best };
  }

  /** A press on the canvas: it ends a flight whatever comes next. `pan` is a right or middle button, or Shift held. */
  press(x: number, y: number, pointer: number, pan: boolean): void {
    this.rig.noteInput();
    this.rig.finish();
    this.touches.set(pointer, { x, y });
    if (this.touches.size === 2) {
      // A second finger: this is a pinch, and whatever the first finger was doing stops counting as a drag or a click.
      if (this.drag) this.drag.moved = true;
      this.pinch = this.pinchOf();
      return;
    }
    this.drag = { x, y, ox: x, oy: y, pan, moved: false };
  }

  private pinchOf(): { gap: number; x: number; y: number } | null {
    const [a, b] = [...this.touches.values()];
    return a && b ? { gap: Math.hypot(a.x - b.x, a.y - b.y) || 1, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null;
  }

  /** Orbit, pan, or a pinch. The camera answers at once, and the rig damps it. */
  move(x: number, y: number, pointer: number): void {
    if (this.touches.has(pointer)) this.touches.set(pointer, { x, y });
    if (this.touches.size >= 2 && this.pinch) {
      const now = this.pinchOf();
      if (!now) return;
      this.rig.zoomBy(((this.pinch.gap / now.gap) ** PINCH_GAIN), now.x - this.free.w / 2, now.y - this.free.h / 2);
      this.rig.panBy(now.x - this.pinch.x, now.y - this.pinch.y);
      this.pinch = now;
      return;
    }
    const d = this.drag;
    if (!d) return;
    if (!d.moved && Math.hypot(x - d.x, y - d.y) <= DRAG_SLOP_PX) return;
    d.moved = true;
    const dx = x - d.ox;
    const dy = y - d.oy;
    d.ox = x;
    d.oy = y;
    if (dx === 0 && dy === 0) return;
    if (d.pan) this.rig.panBy(dx, dy);
    else this.rig.orbitBy((-dx / this.free.w) * ORBIT_PER_FRAME, (dy / this.free.h) * ORBIT_PER_FRAME * 0.8);
  }

  /** Returns whether that was a drag, so the click that follows does not select what lies under it. */
  release(pointer: number): boolean {
    this.touches.delete(pointer);
    if (this.touches.size < 2) this.pinch = null;
    const d = this.drag;
    if (this.touches.size > 0) return d?.moved ?? false;
    this.drag = null;
    if (!d?.moved) return false;
    if (!d.pan) this.rig.release();
    return true;
  }

  wheel(deltaY: number, pinch: boolean, x: number, y: number): void {
    this.rig.finish();
    this.rig.zoomBy(Math.exp(deltaY * (pinch ? PINCH_WHEEL_GAIN : WHEEL_GAIN)), x - this.free.w / 2, y - this.free.h / 2);
  }

  /** Home, the key and the `0` at System level: the composed view. */
  private compose(): void {
    if (useNaos.getState().view.level !== 'system') flyHome();
    this.rig.compose();
  }

  /** QWERTZ, and nothing from 3.4. Arrow left and right, PageUp and PageDown orbit, plus and minus zoom, Shift and an arrow pans, Home composes. */
  private cameraKeys(): KeyBinding[] {
    const plain = (e: KeyboardEvent): boolean => !e.ctrlKey && !e.altKey && !e.metaKey;
    const canvas = (): boolean => !useNaos.getState().view.sky;
    const row = (id: string, key: string, shift: boolean, axis: SteerAxis, direction: number): KeyBinding => ({
      id, scope: 'global', when: canvas, match: (e) => plain(e) && e.key === key && (shift === e.shiftKey), run: (e) => this.rig.steer(axis, direction, e.repeat),
    });
    return [
      row('camera.left', 'ArrowLeft', false, 'az', -1),
      row('camera.right', 'ArrowRight', false, 'az', 1),
      row('camera.rise', 'PageUp', false, 'el', 1),
      row('camera.sink', 'PageDown', false, 'el', -1),
      { id: 'camera.in', scope: 'global', when: canvas, match: (e) => plain(e) && e.key === '+', run: (e) => this.rig.steer('zoom', -1, e.repeat) },
      { id: 'camera.out', scope: 'global', when: canvas, match: (e) => plain(e) && e.key === '-', run: (e) => this.rig.steer('zoom', 1, e.repeat) },
      row('camera.panLeft', 'ArrowLeft', true, 'panX', -1),
      row('camera.panRight', 'ArrowRight', true, 'panX', 1),
      row('camera.panUp', 'ArrowUp', true, 'panY', 1),
      row('camera.panDown', 'ArrowDown', true, 'panY', -1),
      { id: 'camera.home', scope: 'global', when: canvas, match: (e) => plain(e) && e.key === 'Home', run: () => this.compose() },
      { id: 'camera.zero', scope: 'global', when: () => canvas() && useNaos.getState().view.level === 'system', match: (e) => plain(e) && e.key === '0', run: () => this.compose() },
    ];
  }

  click(x: number, y: number): void {
    if (useNaos.getState().scene.demo?.active) return;
    const hit = this.hit(x, y);
    if (hit && 'craft' in hit) select(hit.craft);
    else if (hit) selectWorld(hit.world);
  }

  /** Planets open their surface workspace; craft retain their close-up flight. */
  open(x: number, y: number): void {
    if (useNaos.getState().scene.demo?.active) return;
    const hit = this.hit(x, y);
    if (!hit) return;
    if ('craft' in hit) select(hit.craft);
    else { selectWorld(hit.world); openOverlay('project', hit.world); }
    flyToSelection();
  }

  hoverable(x: number, y: number): boolean { return !useNaos.getState().scene.demo?.active && this.hit(x, y) !== null; }

  // ---- tooling ---------------------------------------------------------------------------------------------------------------

  /** GPU numbers from the real app, the same way the bench reads them. */
  async measure(ms: number): Promise<ReturnType<Meter['summary']> & { spanMs: number; frames: number }> {
    const gl = this.gl;
    if (!gl) throw new Error('no renderer');
    if (!this.metering) { this.meter.attach(gl); gl.info.autoReset = false; this.metering = true; }
    const m = this.meter;
    m.reset();
    m.calls = m.triangles = m.points = 0;
    m.recording = true;
    const started = performance.now();
    const before = this.stats.frames;
    await new Promise((r) => setTimeout(r, ms));
    m.recording = false;
    await new Promise((r) => setTimeout(r, 150));
    m.collect();
    return { ...m.summary(), spanMs: performance.now() - started - 150, frames: this.stats.frames - before };
  }

  /** Puts the hull mesh on the chased craft. Null hides it. */
  readonly placeMesh = (mesh: THREE.Mesh, color: THREE.Color): { fill: number; gain: number } | null => {
    const id = this.fleet.meshOf;
    const look = id ? this.fleet.lookOfCraft(id) : null;
    if (!id || !look || look.hull !== 'kite') return null;
    if (!this.fleet.positionOf(id, mesh.position) || !this.fleet.frameOf(id, spanA, spanB)) return null;
    meshBasis.makeBasis(spanA, rimUp.crossVectors(spanB, spanA).normalize(), spanB);
    mesh.quaternion.setFromRotationMatrix(meshBasis);
    mesh.scale.setScalar(this.rig.chaseRange * HULL_MESH);
    color.copy(linear(look.tone));
    return { fill: look.fill, gain: look.gain };
  };

  /** Where every drawn craft is, CSS px from the top left of the free rect. */
  craftsOnCanvas(): Array<{ id: string; x: number; y: number; state: string; role: string; shoaled: boolean; behind: boolean }> {
    const out: Array<{ id: string; x: number; y: number; state: string; role: string; shoaled: boolean; behind: boolean }> = [];
    this.fleet.forEachSlot((s) => {
      if (!s.drawn) return;
      this.fleet.positionOf(s.id, moon);
      out.push({ id: s.id, x: s.x + this.free.w / 2, y: s.y + this.free.h / 2, state: s.state, role: s.role, shoaled: s.shoaled, behind: this.occluded(moon) });
    });
    return out;
  }

  /** The camera, for the flight checks. */
  flightNow(): { flying: boolean; level: string; position: number[]; fov: number; stance: ReturnType<CameraRig['stance']>; near: number } {
    const p = this.camera.position;
    return { flying: this.rig.flying, level: this.rig.view.level, position: [p.x, p.y, p.z], fov: this.camera.fov, stance: this.rig.stance(), near: this.camera.near };
  }

  /** From the centre of the free rect on this camera, y down. Behind the camera a world has no spot. */
  worldsOnCanvas(): Array<{ id: string; x: number; y: number; r: number; hidden: boolean; onScreen: boolean }> {
    return [...this.bodies.values()].map((b) => {
      const on = this.onScreen(b.position, seenFrom);
      return { id: b.worldId, x: seenFrom.x, y: seenFrom.y, r: b.radius * cssPerUnit(this.camera, this.free, b.position), hidden: this.occluded(b.position, b.position), onScreen: on };
    });
  }

  /** Tooling: what the Label layer has placed, with who is faded. */
  worldSpots(): Array<{ id: string; position: number[]; radius: number }> {
    return [...this.bodies.values()].map((b) => ({ id: b.worldId, position: b.position.toArray(), radius: b.radius }));
  }

  lose(): void {
    const canvas = document.querySelector<HTMLCanvasElement>('#scene-slot canvas');
    this.loseExt = canvas?.getContext('webgl2')?.getExtension('WEBGL_lose_context') ?? this.loseExt;
    this.loseExt?.loseContext();
  }

  restore(): void { this.loseExt?.restoreContext(); }

  private loseExt: WEBGL_lose_context | null = null;
}

/** At World level and closer a label says what the rail says, and an observed craft says how late the light is. */
function levelTag(c: CraftVM): string {
  const lag = !c.owned && c.lag.startsWith('lag') ? `  ${c.lag}` : '';
  const flag = c.flag ? `  ${c.flag}` : '';
  return `${c.word}${c.metric ? ` ${c.metric}` : ''}${lag}${flag}`;
}

const ORIGIN = new THREE.Vector3();
const meshBasis = new THREE.Matrix4();
const rimRight = new THREE.Vector3();
const rimUp = new THREE.Vector3();
const rimBack = new THREE.Vector3();
const seenFrom = new THREE.Vector2();
const seenHome = new THREE.Vector2();
const moon = new THREE.Vector3();
/** One turn of the Belt in about an hour. */
const BELT_RATE = (Math.PI * 2) / 3600;
/** Just enough to read. A world's path is a place, not a line to look at. */
const PATH_GAIN = 0.018;
const CAMERA_KEY_IDS = ['camera.left', 'camera.right', 'camera.rise', 'camera.sink', 'camera.in', 'camera.out', 'camera.panLeft', 'camera.panRight', 'camera.panUp', 'camera.panDown', 'camera.home', 'camera.zero'];
const spanA = new THREE.Vector3();
const spanB = new THREE.Vector3();
const rimA = new THREE.Vector3();
const rimB = new THREE.Vector3();
