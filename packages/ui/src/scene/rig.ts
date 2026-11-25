// The camera, INTERSTELLAR 21. One space, and a level is only a focus in it: the hole, a world, a hull. The user orbits, zooms and pans around
// the focus, damped, and the view stays where it was left. A flight is one GSAP parameter that the frame reads, from wherever the camera
// stands, and any input jumps it to the end: rails and dockets never wait for the camera, and the camera never waits for them.
import * as THREE from 'three';
import {
  chaseBack, chasePose, flightSpec, flightVia, FOV, HULL_SCALE, poseAt, RepeatMemory, worldDistance, type FlightSpec, type Level, type Pose, type Sphere, type Vec,
} from '../core/flight.ts';
import type { Rect } from '../core/layout.ts';
import { dot, HOLE_RADIUS, homeOrbit, orbitBasis, orbitOf, UP, worldOrbit, type Orbit } from '../core/space.ts';
import { registerEases } from './motion.ts';
import { tourOrbit, type CameraAngle } from '../core/cinema.ts';

export interface RigView { level: Level; worldId: string | null; craftId: string | null }

export interface RigHost {
  touring?(active: boolean, journey?: boolean): void;
  worldSphere(worldId: string): Sphere | null;
  /** The outermost orbit of a world, world units. */
  outerOrbit(worldId: string): number;
  /** Hull, tangent of flight and outward radial, each unit but the hull. Null when the craft has no place. */
  chase(craftId: string, hull: THREE.Vector3, tangent: THREE.Vector3, outward: THREE.Vector3): Sphere | null;
  /** Everything a camera must not enter or fly through. The hole is one of them. */
  bodies(): readonly Sphere[];
  now(): number;
  /** A frame is needed for this many ms. */
  hold(ms: number): void;
  reduced(): boolean;
  /** The idle drift is allowed right now. */
  drifts(): boolean;
  /** A zoom reached a world, or left one. The store takes the level. The next `go` carries the camera instead of flying it. */
  enter(worldId: string): void;
  leave(): void;
}

interface Flight {
  from: Pose;
  via: Vec;
  fromScale: number;
  toScale: number;
  tween: { kill(): void };
  state: { k: number };
}

/** An orbit plus how far the user panned off the focus. At Craft level the three numbers are offsets from the chase, and `dist` a factor. */
interface Stance extends Orbit { pan: Vec }

export type SteerAxis = 'az' | 'el' | 'zoom' | 'panX' | 'panY';
const AXES: readonly SteerAxis[] = ['az', 'el', 'zoom', 'panX', 'panY'];

const DEG = Math.PI / 180;
const blank = (): Pose => ({ position: [0, 0, 0], target: [0, 0, 0], fov: FOV.system });
const copyStance = (s: Stance): Stance => ({ az: s.az, el: s.el, dist: s.dist, pan: [s.pan[0], s.pan[1], s.pan[2]] });
const ORIGIN: readonly [number, number, number] = [0, 0, 0];

const hull = new THREE.Vector3();
const tangent = new THREE.Vector3();
const outward = new THREE.Vector3();
const forward = new THREE.Vector3();
const across = new THREE.Vector3();
const lift = new THREE.Vector3();
const basis = new THREE.Matrix4();

const SMOOTH_TAU_S = 0.45;
const LENS_TAU_S = 0.3;
/** How fast what is shown catches what was asked for. Short enough to feel held, long enough to feel like mass. */
const DAMP_TAU_S = 0.09;
/** On release the view coasts as far as it would in this long at the speed it was thrown. */
const THROW_S = 0.28;
/** A hand that stopped before letting go threw nothing. */
const THROW_STALE_MS = 70;
const POLE = Math.PI / 2;
const SETTLED = 1e-4;
const KEY_RATE: Record<SteerAxis, number> = { az: 58 * DEG, el: 42 * DEG, zoom: 0.9, panX: 0.55, panY: 0.55 };
/** One tap moves at least this far of a second. */
const KEY_TAP_S = 0.14;
const ZOOM_OUT_LIMIT = 2.4;
/** Low orbit: the limb fills the frame and the camera still stands clear of it. */
const LOW_ORBIT = 1.32;
/** At this many radii the horizon has risen all the way. */
const HORIZON_FULL = 1.9;
const PAN_LIMIT = 1700;
/** A wheel gesture is one gesture until the hand rests this long. */
const GESTURE_MS = 500;
/** A zoom hands over to a world at this many of its World distances, and back at the second. The gap keeps it from flickering. */
const HAND_IN = 1.25;
const HAND_OUT = 2.8;
/** A zoom stops this many radii off whatever is on its ray. */
const ZOOM_STOP = 1.1;
const IDLE_MS = 24_000;
const DRIFT_RATE = 0.7 * DEG;
const HOME_MS = 1100;
/** No camera stands closer to a body than this many radii. */
const SKIN = 1.06;

export class CameraRig {
  private tour: { base: Stance; seconds: number } | null = null;
  private journey: { legs: Array<{ from: Pose; to: Pose; via: Vec }>; seconds: number } | null = null;
  get touring(): boolean { return this.tour !== null || this.journey !== null; }
  readonly view: RigView = { level: 'system', worldId: null, craftId: null };
  /** Eases along a flight, for the engine. */
  hullScale = 1;
  /** Half the chased hull fits this, so a ship reads the same on a small world as on a large one. */
  chaseRange = chaseBack(46);
  private readonly camera: THREE.PerspectiveCamera;
  private readonly host: RigHost;
  private free: Rect;
  private flight: Flight | null = null;
  private readonly repeat = new RepeatMemory();
  private readonly to: Pose = blank();
  private readonly at: Pose = blank();
  private readonly seen: Pose = blank();
  private readonly last: Pose = blank();
  private smooth = false;
  private fresh = true;
  private readonly look = new THREE.Vector3();
  private readonly right = new THREE.Vector3(1, 0, 0);
  private readonly lens = { near: 0 };
  /** What the input asked for, and what the frame shows on its way there. */
  private goal: Stance;
  private shown: Stance;
  private readonly saved = new Map<string, Stance>();
  private touched = false;
  private readonly speed = { az: 0, el: 0, at: 0 };
  private readonly steering: Record<SteerAxis, number> = { az: 0, el: 0, zoom: 0, panX: 0, panY: 0 };
  private lastInput = 0;
  private drifting = false;
  /** How long a camera sits still before it may drift. The tooling shortens it. */
  idleMs = IDLE_MS;
  /** Set just before a zoom hands the level over. */
  private carrying = false;
  private zoomAt = -Infinity;
  /** Where the camera stood when the wheel started, which is where Esc returns to. */
  private zoomBase: Stance | null = null;
  /** A carried level keeps its lens for a moment, so a handover has no pop. */
  private fovNow: number = FOV.system;

  constructor(camera: THREE.PerspectiveCamera, free: Rect, host: RigHost) {
    this.camera = camera;
    this.free = free;
    this.host = host;
    this.goal = this.defaultStance(this.view);
    this.shown = copyStance(this.goal);
    this.lastInput = host.now();
    this.settle();
  }

  get flying(): boolean { return this.flight !== null; }

  private keyOf(view: RigView): string { return view.level === 'system' ? 'system' : view.level === 'world' ? `w:${view.worldId}` : `c:${view.craftId}`; }

  private defaultStance(view: RigView): Stance {
    if (view.level === 'craft') return { az: 0, el: 0, dist: 1, pan: [0, 0, 0] };
    if (view.level === 'world' && view.worldId) {
      const world = this.host.worldSphere(view.worldId);
      if (world) return { ...worldOrbit(world.c, worldDistance(this.host.outerOrbit(view.worldId), this.free)), pan: [0, 0, 0] };
    }
    return { ...homeOrbit(this.free), pan: [0, 0, 0] };
  }

  private stanceOf(view: RigView): Stance { return copyStance(this.saved.get(this.keyOf(view)) ?? this.defaultStance(view)); }

  resize(free: Rect): void {
    this.free = free;
    this.finish();
    if (!this.touched && !this.saved.has(this.keyOf(this.view))) {
      this.goal = this.defaultStance(this.view);
      this.shown = copyStance(this.goal);
    }
    this.settle();
  }

  private focusOf(view: RigView): readonly [number, number, number] {
    if ((view.level === 'world' || view.level === 'craft') && view.worldId) return this.host.worldSphere(view.worldId)?.c ?? ORIGIN;
    return ORIGIN;
  }

  private poseOf(view: RigView, stance: Stance, out: Pose): boolean {
    if (view.level === 'craft' && view.craftId) {
      const world = this.host.chase(view.craftId, hull, tangent, outward);
      if (world) {
        this.chaseRange = chaseBack(world.r);
        chasePose(hull, tangent, outward, world, out);
        out.target[0] = hull.x + (out.target[0] - hull.x) * 0.3;
        out.target[1] = hull.y + (out.target[1] - hull.y) * 0.3;
        out.target[2] = hull.z + (out.target[2] - hull.z) * 0.3;
        this.turnChase(out, stance);
        return true;
      }
    }
    const focus = this.focusOf(view);
    const b = orbitBasis(stance.az, stance.el);
    const rise = view.level === 'world' && view.worldId ? this.horizon(view.worldId, stance.dist) : 0;
    for (let i = 0; i < 3; i++) {
      const at = focus[i]! + stance.pan[i]!;
      out.position[i] = at + b.back[i]! * stance.dist;
      out.target[i] = at + b.up[i]! * rise;
    }
    this.right.fromArray(b.right);
    out.fov = FOV[view.level];
    return true;
  }

  /**
   * How far the aim lifts off the planet. From far away a world sits in the middle of the frame. Past the point where it stops fitting, a
   * camera that kept looking at its centre would see nothing but ground, so the aim rises with the zoom until the limb lies across the lower
   * part of the frame and the sky stands above it. That is what low orbit looks like.
   */
  private horizon(worldId: string, dist: number): number {
    const r = this.host.worldSphere(worldId)?.r ?? 0;
    if (r <= 0 || dist <= r) return 0;
    const half = (FOV.world * Math.PI) / 360;
    const k = Math.max(0, Math.min(1, (r / Math.sin(half) - dist) / (r / Math.sin(half) - HORIZON_FULL * r)));
    const ease = k * k * (3 - 2 * k);
    return dist * Math.tan(ease * (Math.asin(r / dist) + half * 0.42));
  }

  /** The chase is a place that moves with the hull. What the user did is kept as offsets from it, so the hull stays held while they look around. */
  private turnChase(p: Pose, s: Stance): void {
    if (s.az === 0 && s.el === 0 && s.dist === 1) return;
    const o = orbitOf(p.position, p.target);
    const el = Math.max(-POLE, Math.min(POLE, o.el + s.el));
    const b = orbitBasis(o.az + s.az, el);
    const d = o.dist * s.dist;
    for (let i = 0; i < 3; i++) p.position[i] = p.target[i]! + b.back[i]! * d;
    this.right.fromArray(b.right);
  }

  /** The near plane follows the nearest thing there is, so a low orbit does not clip and a system view keeps its depth. */
  private write(p: Pose): void {
    const c = this.camera;
    let x = p.position[0];
    let y = p.position[1];
    let z = p.position[2];
    let nearest = Infinity;
    for (const s of this.host.bodies()) {
      const dx = x - s.c[0];
      const dy = y - s.c[1];
      const dz = z - s.c[2];
      const d = Math.hypot(dx, dy, dz) || 1;
      const skin = s.r * SKIN;
      if (d < skin) {
        // Never inside a body, however the pan and the zoom added up.
        const k = skin / d;
        x = s.c[0] + dx * k;
        y = s.c[1] + dy * k;
        z = s.c[2] + dz * k;
      }
      nearest = Math.min(nearest, Math.max(1, d - s.r));
    }
    c.position.set(x, y, z);
    forward.set(p.target[0] - x, p.target[1] - y, p.target[2] - z).normalize();
    across.set(forward.y * UP[2] - forward.z * UP[1], forward.z * UP[0] - forward.x * UP[2], forward.x * UP[1] - forward.y * UP[0]);
    // Right comes from up, except at a pole, where there is no such thing and the last right holds, so the view never flips.
    if (across.lengthSq() > 1e-7) this.right.copy(across).normalize();
    else this.right.addScaledVector(forward, -this.right.dot(forward)).normalize();
    lift.crossVectors(this.right, forward);
    c.quaternion.setFromRotationMatrix(basis.makeBasis(this.right, lift, forward.negate()));
    const near = Math.max(0.5, Math.min(40, nearest * 0.3));
    if (c.fov !== p.fov || Math.abs(near - this.lens.near) > this.lens.near * 0.1) {
      c.fov = p.fov;
      c.near = this.lens.near = near;
      c.updateProjectionMatrix();
    }
    c.updateMatrixWorld(true);
    for (let i = 0; i < 3; i++) { this.last.position[i] = p.position[i]!; this.last.target[i] = p.target[i]!; }
    this.last.fov = p.fov;
    this.fresh = false;
  }

  /** Where the camera stands now. Its aim sits as far out as the place it is going to aim at, so a turn stays a turn. */
  private capture(out: Pose, reach: number): void {
    const c = this.camera;
    out.position[0] = c.position.x;
    out.position[1] = c.position.y;
    out.position[2] = c.position.z;
    c.getWorldDirection(this.look).multiplyScalar(reach).add(c.position);
    out.target[0] = this.look.x;
    out.target[1] = this.look.y;
    out.target[2] = this.look.z;
    out.fov = c.fov;
  }

  private start(spec: FlightSpec, ms: number, toScale: number): void {
    const from = blank();
    this.poseOf(this.view, this.goal, this.to);
    const c = this.camera.position;
    this.capture(from, Math.hypot(this.to.target[0] - c.x, this.to.target[1] - c.y, this.to.target[2] - c.z) || 1);
    const via = flightVia(from.position, this.to.position, this.host.bodies(), spec.star);
    const state = { k: 0 };
    const gsap = registerEases();
    const flight: Flight = {
      from, via, fromScale: this.hullScale, toScale, state,
      tween: gsap.to(state, { k: 1, duration: ms / 1000, ease: spec.ease, onComplete: () => this.land(flight) }),
    };
    this.flight = flight;
    this.smooth = false;
    this.host.hold(ms);
  }

  /** Goes to a view. `cut` is a seek, a reload, or reduced motion: there is no motion to show. */
  go(next: RigView, cut: boolean): void {
    const prev = { ...this.view };
    const same = prev.level === next.level && prev.worldId === next.worldId && (next.level !== 'craft' || prev.craftId === next.craftId);
    if (same) { Object.assign(this.view, next); return; }
    this.finish();
    if (this.carrying) { this.carry(next); return; }
    if (this.touched && prev.level !== 'craft') this.saved.set(this.keyOf(prev), copyStance(this.goal));
    this.touched = false;
    Object.assign(this.view, next);
    this.goal = this.stanceOf(this.view);
    this.shown = copyStance(this.goal);
    this.halt();
    const toScale = HULL_SCALE[next.level];
    if (cut || this.host.reduced()) {
      this.hullScale = toScale;
      this.smooth = false;
      this.settle();
      this.host.hold(0);
      return;
    }
    const spec = flightSpec(prev, next);
    this.start(spec, spec.ms * this.repeat.scale(`${spec.key}:${next.worldId ?? ''}`, this.host.now()), toScale);
  }

  /**
   * A zoom crossed into another level. The camera does not move: only what it turns around changes, so the two stances are the same pose. A
   * world then pulls the focus onto itself with the usual damping. The system keeps the pan, and zooming further out takes it home.
   */
  private carry(next: RigView): void {
    this.carrying = false;
    const shownAt = blank();
    const goalAt = blank();
    this.poseOf(this.view, this.shown, shownAt);
    this.poseOf(this.view, this.goal, goalAt);
    if (this.view.level === 'system' && this.zoomBase) this.saved.set('system', this.zoomBase);
    Object.assign(this.view, next);
    this.steerOff();
    const focus = this.focusOf(this.view);
    const lay = (eye: Vec, s: Stance): void => {
      const { back } = orbitBasis(s.az, s.el);
      s.dist = Math.hypot(eye[0] - focus[0], eye[1] - focus[1], eye[2] - focus[2]);
      for (let i = 0; i < 3; i++) s.pan[i] = eye[i]! - back[i]! * s.dist - focus[i]!;
    };
    lay(shownAt.position, this.shown);
    lay(goalAt.position, this.goal);
    if (next.level === 'world') this.goal.pan = [0, 0, 0];
    this.touched = true;
    if (this.host.reduced()) this.snap();
    this.host.hold(400);
  }

  /** Home: the composed view, the poster. Forgets where the user left System. From another level the store's flight home starts next, and lands here. */
  compose(): void {
    this.saved.delete('system');
    this.touched = false;
    if (this.view.level !== 'system') return;
    this.finish();
    this.halt();
    this.goal = this.defaultStance(this.view);
    this.shown = copyStance(this.goal);
    if (this.host.reduced()) { this.settle(); this.host.hold(0); return; }
    const spec: FlightSpec = { ms: HOME_MS, ease: 'slingshot', key: 'home', star: false };
    this.start(spec, spec.ms * this.repeat.scale('home', this.host.now()), this.hullScale);
  }

  private land(flight: Flight): void {
    if (this.flight !== flight) return;
    // The last frame sampled a hair short of the end, and the camera must rest exactly on the view.
    this.flight = null;
    this.hullScale = flight.toScale;
    this.smooth = false;
    this.settle();
    this.host.hold(0);
  }

  private settle(): void {
    this.poseOf(this.view, this.shown, this.to);
    this.fovNow = this.to.fov;
    this.write(this.to);
  }

  /** Any input lands the flight now. Whatever the key was for then applies from the end state. */
  finish(): void {
    this.stopTour();
    const f = this.flight;
    if (!f) return;
    f.tween.kill();
    this.flight = null;
    this.hullScale = f.toScale;
    this.smooth = false;
    this.settle();
  }

  // ---- input ---------------------------------------------------------------------------------------------------------------------

  private halt(): void {
    this.speed.az = this.speed.el = 0;
    this.steerOff();
  }

  /** Any input at all ends the idle drift. It does not move the view back: the view stays where the drift left it. */
  noteInput(): void {
    this.stopTour();
    this.lastInput = this.host.now();
    this.drifting = false;
  }

  private range(): [number, number] {
    const out = homeOrbit(this.free).dist * ZOOM_OUT_LIMIT;
    if (this.view.level === 'system') return [HOLE_RADIUS * 1.6, out];
    if (this.view.level === 'world') return [(this.view.worldId ? this.host.worldSphere(this.view.worldId)?.r ?? 40 : 40) * LOW_ORBIT, out * 0.8];
    return [0.4, 4];
  }

  private touch(ms = 240): void {
    this.touched = true;
    this.noteInput();
    this.host.hold(ms);
  }

  /** Radians. Positive azimuth turns the camera toward its own right, positive elevation lifts it. */
  orbitBy(dAz: number, dEl: number): void {
    const g = this.goal;
    g.az += dAz;
    const limit = this.view.level === 'craft' ? Math.PI : POLE;
    g.el = Math.max(-limit, Math.min(limit, g.el + dEl));
    const now = this.host.now();
    const dt = Math.max(1, now - this.speed.at) / 1000;
    this.speed.az += (dAz / dt - this.speed.az) * 0.45;
    this.speed.el += (dEl / dt - this.speed.el) * 0.45;
    this.speed.at = now;
    if (this.host.reduced()) this.snap();
    this.touch();
  }

  /** The hand let go. The view coasts on what it was doing a moment ago, then rests where it lands. */
  release(): void {
    const late = this.host.now() - this.speed.at > THROW_STALE_MS;
    if (!late && !this.host.reduced()) {
      const g = this.goal;
      g.az += this.speed.az * THROW_S;
      const limit = this.view.level === 'craft' ? Math.PI : POLE;
      g.el = Math.max(-limit, Math.min(limit, g.el + this.speed.el * THROW_S));
      this.host.hold(700);
    }
    this.speed.az = this.speed.el = 0;
  }

  private cssToUnits(): number {
    const d = this.view.level === 'craft' ? this.chaseRange * this.goal.dist : this.goal.dist;
    return (2 * d * Math.tan((this.camera.fov * Math.PI) / 360)) / this.free.h;
  }

  /** CSS px on the screen. The focus follows the hand, so the scene stays under it. */
  panBy(dx: number, dy: number): void {
    if (this.view.level === 'craft') return;
    const u = this.cssToUnits();
    const b = orbitBasis(this.goal.az, this.goal.el);
    this.shift((dy * b.up[0] - dx * b.right[0]) * u, (dy * b.up[1] - dx * b.right[1]) * u, (dy * b.up[2] - dx * b.right[2]) * u);
    if (this.host.reduced()) this.snap();
    this.touch();
  }

  private shift(x: number, y: number, z: number): void {
    const p = this.goal.pan;
    p[0] += x;
    p[1] += y;
    p[2] += z;
    const l = Math.hypot(p[0], p[1], p[2]);
    if (l > PAN_LIMIT) { const k = PAN_LIMIT / l; p[0] *= k; p[1] *= k; p[2] *= k; }
  }

  /** The first body a ray meets, and how far off its surface that is. A camera already inside one is at distance 0. */
  private firstBody(eye: Vec, dir: Vec): { sphere: Sphere; t: number } | null {
    let best: { sphere: Sphere; t: number } | null = null;
    for (const sphere of this.host.bodies()) {
      const ox = sphere.c[0] - eye[0];
      const oy = sphere.c[1] - eye[1];
      const oz = sphere.c[2] - eye[2];
      const along = ox * dir[0] + oy * dir[1] + oz * dir[2];
      const off2 = ox * ox + oy * oy + oz * oz - along * along;
      const r2 = sphere.r * sphere.r;
      if (off2 > r2) continue;
      const half = Math.sqrt(r2 - off2);
      if (along + half < 0) continue;
      const t = Math.max(0, along - half);
      if (!best || t < best.t) best = { sphere, t };
    }
    return best;
  }

  /**
   * `factor` below 1 goes in, along the ray through a point given from the centre in CSS px, so what lies under the hand stays under it and a zoom
   * can reach anything. It ends at the first body on that ray and never passes through. A world on the ray takes over the zoom: the level changes
   * under the camera and the zoom runs on to low orbit. Going out, System forgets the hand and the pan, so a zoom out always ends on the whole system.
   */
  zoomBy(factor: number, x = 0, y = 0): void {
    const g = this.goal;
    const now = this.host.now();
    if (now - this.zoomAt > GESTURE_MS) this.zoomBase = copyStance(g);
    this.zoomAt = now;
    const [min, max] = this.range();
    let next = Math.max(min, Math.min(max, g.dist * factor));
    const { level, worldId } = this.view;
    if (level === 'craft') {
      g.dist = next;
    } else if (factor > 1 && level === 'system') {
      const k = g.dist / next;
      for (let i = 0; i < 3; i++) g.pan[i] = g.pan[i]! * k * k;
      g.dist = next;
    } else {
      const u = this.cssToUnits();
      const b = orbitBasis(g.az, g.el);
      const focus = this.focusOf(this.view);
      const eye: Vec = [0, 0, 0];
      const ray: Vec = [0, 0, 0];
      for (let i = 0; i < 3; i++) {
        eye[i] = focus[i]! + g.pan[i]! + b.back[i]! * g.dist;
        ray[i] = (x * b.right[i]! - y * b.up[i]!) * u - b.back[i]! * g.dist;
      }
      const reach = Math.hypot(ray[0], ray[1], ray[2]) || 1;
      const hit = factor < 1 ? this.firstBody(eye, [ray[0] / reach, ray[1] / reach, ray[2] / reach]) : null;
      if (hit) next = Math.max(next, g.dist * (1 - Math.max(0, hit.t - hit.sphere.r * (ZOOM_STOP - 1)) / reach));
      const k = next / g.dist;
      this.shift((x * b.right[0] - y * b.up[0]) * u * (1 - k), (x * b.right[1] - y * b.up[1]) * u * (1 - k), (x * b.right[2] - y * b.up[2]) * u * (1 - k));
      g.dist = next;
      const id = hit?.sphere.id;
      if (level === 'system' && hit && id) {
        const at = (1 - k) * reach;
        if (hit.t - at + hit.sphere.r < worldDistance(this.host.outerOrbit(id), this.free) * HAND_IN) { this.carrying = true; this.host.enter(id); this.carrying = false; }
      } else if (level === 'world' && worldId && factor > 1 && next > worldDistance(this.host.outerOrbit(worldId), this.free) * HAND_OUT) {
        this.carrying = true;
        this.host.leave();
        this.carrying = false;
      }
    }
    if (this.host.reduced()) this.snap();
    this.touch();
  }

  /** A held key. -1, 0 or 1 per axis. A tap still moves: the press alone is worth a fraction of a second. */
  steer(axis: SteerAxis, direction: number, repeat = false): void {
    if (repeat) return;
    this.steering[axis] = direction;
    if (direction !== 0) { this.apply(axis, direction * KEY_TAP_S); this.touch(); }
  }

  steerOff(): void {
    for (const k of AXES) this.steering[k] = 0;
  }

  private apply(axis: SteerAxis, seconds: number): void {
    const amount = KEY_RATE[axis] * seconds;
    if (axis === 'az') { this.goal.az += amount; return; }
    if (axis === 'el') { const limit = this.view.level === 'craft' ? Math.PI : POLE; this.goal.el = Math.max(-limit, Math.min(limit, this.goal.el + amount)); return; }
    if (axis === 'zoom') { this.zoomBy(Math.exp(amount)); return; }
    if (this.view.level === 'craft') return;
    const b = orbitBasis(this.goal.az, this.goal.el);
    const u = amount * this.goal.dist;
    const v = axis === 'panX' ? b.right : b.up;
    this.shift(v[0] * u, v[1] * u, v[2] * u);
  }

  /** Stands the camera exactly there, for the tooling. */
  stand(az: number, el: number, dist: number): void {
    this.finish();
    this.halt();
    this.goal.az = az;
    this.goal.el = el;
    this.goal.dist = dist;
    this.shown = copyStance(this.goal);
    this.touched = true;
    this.noteInput();
    this.settle();
    this.fresh = true;
  }

  // ---- every frame --------------------------------------------------------------------------------------------------------------

  angle(angle: CameraAngle): void {
    if (angle === 'home' && this.view.level === 'system') { this.compose(); return; }
    this.finish();
    this.halt();
    const base = this.defaultStance(this.view);
    if (angle === 'atlas') {
      base.el = this.view.level === 'craft' ? 0.5 : 62 * DEG;
      if (this.view.level === 'system') {
        const reach = this.host.bodies().reduce((r, b) => Math.max(r, Math.hypot(...b.c) + b.r), 0);
        base.dist = Math.max(base.dist, reach * 1.15 / Math.sin(FOV.system * DEG / 2));
      }
    } else if (angle === 'horizon') { base.el = this.view.level === 'craft' ? -0.22 : 8 * DEG; base.dist *= 1.06; }
    this.goal = base;
    this.shown = copyStance(base);
    this.touched = true;
    this.noteInput();
    if (this.host.reduced()) { this.settle(); this.host.hold(0); return; }
    this.start({ ms: 1400, ease: 'slingshot', key: `angle:${angle}`, star: false }, 1400, this.hullScale);
  }

  startTour(): boolean {
    this.finish();
    if (this.host.reduced()) return false;
    this.halt();
    this.noteInput();
    this.tour = { base: copyStance(this.shown), seconds: 0 };
    this.host.touring?.(true);
    this.host.hold(300);
    return true;
  }

  /** A guided route uses the normal collision-aware flight path and leaves selection alone. */
  startJourney(): boolean {
    this.finish();
    if (this.host.reduced() || this.view.level !== 'system') return false;
    this.halt(); this.noteInput();
    const stops: Stance[] = [];
    const atlas = this.defaultStance(this.view); atlas.el = 0.85; atlas.dist *= 1.15;
    stops.push(atlas);
    for (const body of this.host.bodies().filter((b) => b.id && b.r > 15).slice(0, 4)) {
      const orbit = worldOrbit(body.c, worldDistance(this.host.outerOrbit(body.id!), this.free) * 1.3);
      stops.push({ ...orbit, pan: [...body.c] });
    }
    stops.push(this.defaultStance(this.view));
    const legs: Array<{ from: Pose; to: Pose; via: Vec }> = [];
    let from = blank();
    this.capture(from, this.shown.dist);
    for (const stance of stops) {
      const to = blank(); this.poseOf(this.view, stance, to);
      legs.push({ from, to, via: flightVia(from.position, to.position, this.host.bodies(), true) });
      from = to;
    }
    this.journey = { legs, seconds: 0 };
    this.host.touring?.(true, true); this.host.hold(200);
    return true;
  }

  stopTour(): void {
    if (!this.touring) return;
    if (this.journey) {
      const orbit = orbitOf(this.last.position, this.last.target);
      this.shown = { ...orbit, pan: [...this.last.target] };
      this.journey = null;
    }
    this.tour = null;
    this.goal = copyStance(this.shown);
    this.touched = true;
    this.host.touring?.(false);
  }

  private gap(): number {
    const g = this.goal;
    const s = this.shown;
    return Math.abs(g.az - s.az) + Math.abs(g.el - s.el) + Math.abs(Math.log(g.dist / s.dist)) + Math.hypot(g.pan[0] - s.pan[0], g.pan[1] - s.pan[1], g.pan[2] - s.pan[2]) / Math.max(1, g.dist);
  }

  private snap(): void { this.shown = copyStance(this.goal); }

  private ease(dt: number): void {
    if (this.gap() <= SETTLED) { this.snap(); return; }
    const k = 1 - Math.exp(-dt / DAMP_TAU_S);
    const g = this.goal;
    const s = this.shown;
    s.az += (g.az - s.az) * k;
    s.el += (g.el - s.el) * k;
    s.dist = Math.exp(Math.log(s.dist) + (Math.log(g.dist) - Math.log(s.dist)) * k);
    for (let i = 0; i < 3; i++) s.pan[i] = s.pan[i]! + (g.pan[i]! - s.pan[i]!) * k;
    this.host.hold(60);
  }

  /** Only a carried level ever differs: a flight lands on both exactly. */
  private easeLens(dt: number): void {
    const { level } = this.view;
    const fov = FOV[level];
    const scale = HULL_SCALE[level];
    if (this.fovNow === fov && this.hullScale === scale) return;
    const k = 1 - Math.exp(-dt / LENS_TAU_S);
    this.fovNow += (fov - this.fovNow) * k;
    this.hullScale += (scale - this.hullScale) * k;
    if (Math.abs(this.fovNow - fov) < 0.01) this.fovNow = fov;
    if (Math.abs(this.hullScale - scale) < 0.002) this.hullScale = scale;
    this.host.hold(60);
  }

  private idle(dt: number): void {
    if (this.touring) { this.drifting = false; return; }
    const allowed = this.view.level === 'system' && this.host.drifts() && this.host.now() - this.lastInput > this.idleMs;
    this.drifting = allowed;
    if (!allowed) return;
    this.goal.az += DRIFT_RATE * dt;
    this.shown.az += DRIFT_RATE * dt;
  }

  private same(p: Pose): boolean {
    const l = this.last;
    if (this.fresh || p.fov !== l.fov) return false;
    for (let i = 0; i < 3; i++) if (Math.abs(p.position[i]! - l.position[i]!) > 1e-4 || Math.abs(p.target[i]! - l.target[i]!) > 1e-4) return false;
    return true;
  }

  /** Every frame. Returns whether the camera moved. */
  step(dt: number): boolean {
    if (this.journey) {
      if (this.host.reduced()) this.stopTour();
      else {
        const route = this.journey;
        route.seconds += Math.max(0, Math.min(0.25, dt));
        const index = Math.min(route.legs.length - 1, Math.floor(route.seconds / 8));
        const leg = route.legs[index]!;
        const p = Math.min(1, (route.seconds - index * 8) / 6.5);
        const u = p * p * (3 - 2 * p);
        poseAt(leg.from, leg.via, leg.to, u, this.at);
        this.write(this.at); this.host.hold(100);
        if (route.seconds >= route.legs.length * 8) this.stopTour();
        return true;
      }
    }
    if (this.tour) {
      if (this.host.reduced()) this.stopTour();
      else {
        this.tour.seconds += Math.max(0, Math.min(0.25, dt));
        Object.assign(this.goal, tourOrbit(this.tour.base, this.tour.seconds));
        this.snap();
        this.host.hold(100);
      }
    }
    const f = this.flight;
    if (f) {
      this.poseOf(this.view, this.goal, this.to);
      poseAt(f.from, f.via, this.to, f.state.k, this.at);
      this.write(this.at);
      this.hullScale = f.fromScale + (f.toScale - f.fromScale) * f.state.k;
      return true;
    }
    for (const axis of AXES) {
      const d = this.steering[axis];
      if (d !== 0) { this.apply(axis, d * dt); this.touched = true; this.host.hold(120); }
    }
    this.idle(dt);
    this.ease(dt);
    this.easeLens(dt);
    this.poseOf(this.view, this.shown, this.to);
    this.to.fov = this.fovNow;
    if (this.view.level !== 'craft') {
      if (this.same(this.to)) return false;
      this.write(this.to);
      return true;
    }
    // The chase follows a moving hull. A low pass keeps a tight orbit from swinging the whole sky around with every degree.
    if (!this.smooth) {
      this.smooth = true;
      for (let i = 0; i < 3; i++) { this.seen.position[i] = this.to.position[i]!; this.seen.target[i] = this.to.target[i]!; }
      this.seen.fov = this.to.fov;
    }
    const k = Math.min(1, dt / SMOOTH_TAU_S);
    for (let i = 0; i < 3; i++) {
      this.seen.position[i] = this.seen.position[i]! + (this.to.position[i]! - this.seen.position[i]!) * k;
      this.seen.target[i] = this.seen.target[i]! + (this.to.target[i]! - this.seen.target[i]!) * k;
    }
    this.seen.fov = this.to.fov;
    if (this.same(this.seen)) return false;
    this.write(this.seen);
    return true;
  }

  /** Where the camera stands, for the tooling. */
  stance(): { az: number; el: number; dist: number; goal: number; rolled: number } {
    this.camera.matrixWorld.extractBasis(across, lift, forward);
    return { az: this.shown.az, el: this.shown.el, dist: this.shown.dist, goal: this.gap(), rolled: Math.abs(dot([across.x, across.y, across.z], UP)) };
  }
}
