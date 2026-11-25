// Camera flights, DESIGN 7.3 and 9.3. Pure numbers. A path is a Catmull-Rom through a bent midpoint, GSAP drives one parameter, and the
// camera reads this. Paths curve around bodies, and the camera never rolls, because `up` is never part of a pose.
import type { EaseName } from './ease.ts';
import { ease } from './ease.ts';
import { UP } from './space.ts';

export type Vec = [number, number, number];
export type Level = 'system' | 'world' | 'craft';

export interface Pose { position: Vec; target: Vec; fov: number }
export interface Sphere { c: readonly [number, number, number]; r: number; /** The world this is, when it is one a zoom can hand over to. */ id?: string }
export interface Xyz { x: number; y: number; z: number }

export interface FlightSpec { ms: number; ease: EaseName; key: string; star: boolean }

/** 9.2: a move repeated within 60 s plays at under a third of its length. */
export const REPEAT_WINDOW_MS = 60_000;
const REPEAT_SCALE = 0.3;

export function flightSpec(from: { level: Level; worldId: string | null }, to: { level: Level; worldId: string | null }): FlightSpec {
  const key = `${from.level}:${to.level}`;
  if (from.level === 'system' && to.level === 'world') return { ms: 1000, ease: 'slingshot', key, star: false };
  if (from.level === 'system' && to.level === 'craft') return { ms: 1000, ease: 'slingshot', key, star: false };
  if (from.level === 'world' && to.level === 'world') return { ms: 1100, ease: 'slingshot', key, star: true };
  if (from.level === 'world' && to.level === 'craft') return { ms: 800, ease: 'settle', key, star: false };
  if (from.level === 'craft' && to.level === 'craft') return { ms: 800, ease: 'settle', key, star: from.worldId !== to.worldId };
  if (from.level === 'craft' && to.level === 'world' && from.worldId !== to.worldId) return { ms: 1100, ease: 'slingshot', key, star: true };
  return { ms: 700, ease: 'slingshot', key, star: false };
}

/** Remembers when each move last played, so a repeat comes out short. */
export class RepeatMemory {
  private readonly seen = new Map<string, number>();

  scale(key: string, now: number): number {
    const last = this.seen.get(key);
    this.seen.set(key, now);
    return last !== undefined && now - last < REPEAT_WINDOW_MS ? REPEAT_SCALE : 1;
  }
}

const add = (a: readonly number[], b: readonly number[], k = 1): Vec => [a[0]! + b[0]! * k, a[1]! + b[1]! * k, a[2]! + b[2]! * k];
const sub = (a: readonly number[], b: readonly number[]): Vec => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const len = (a: readonly number[]): number => Math.hypot(a[0]!, a[1]!, a[2]!);
const lerp3 = (a: readonly number[], b: readonly number[], k: number): Vec => [a[0]! + (b[0]! - a[0]!) * k, a[1]! + (b[1]! - a[1]!) * k, a[2]! + (b[2]! - a[2]!) * k];
const cross = (a: readonly number[], b: readonly number[]): Vec => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
const dot3 = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const unit = (a: readonly number[]): Vec => { const l = len(a) || 1; return [a[0]! / l, a[1]! / l, a[2]! / l]; };

/** Catmull-Rom through three points with mirrored ends, at u in 0..1. */
export function pathPoint(a: readonly number[], m: readonly number[], b: readonly number[], u: number, out: Vec = [0, 0, 0]): Vec {
  const first = u < 0.5;
  const t = first ? u * 2 : (u - 0.5) * 2;
  const t2 = t * t;
  const t3 = t2 * t;
  for (let i = 0; i < 3; i++) {
    const p1 = first ? a[i]! : m[i]!;
    const p2 = first ? m[i]! : b[i]!;
    const p0 = first ? 2 * a[i]! - m[i]! : a[i]!;
    const p3 = first ? b[i]! : 2 * b[i]! - m[i]!;
    out[i] = 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3);
  }
  return out;
}

const CLEARANCE = 1.25;

/**
 * The bent midpoint. Sideways off the straight line, so a move reads as a flight and not a zoom. A swing passes the hole on the side of
 * the disk the camera is on, wherever the camera started. Then the point climbs away from the disk until no sample goes through a body.
 */
export function flightVia(from: readonly number[], to: readonly number[], bodies: readonly Sphere[], swing: boolean): Vec {
  const d = sub(to, from);
  const span = len(d) || 1;
  let side = cross(d, UP);
  const l = len(side);
  side = l < 1e-3 ? [1, 0, 0] : [side[0] / l, side[1] / l, side[2] / l];
  const mid = lerp3(from, to, 0.5);
  const above = mid[1] >= 0 ? 1 : -1;
  let via: Vec = swing ? [mid[0] * 0.25, above * Math.max(Math.abs(mid[1]), span * 0.3), mid[2] * 0.25] : add(mid, side, span * 0.16);
  for (let tries = 0; tries < 16; tries++) {
    if (clearOf(from, via, to, bodies)) break;
    via = add(via, [0, above, 0], Math.max(span * 0.12, 30));
  }
  return via;
}

export function clearOf(a: readonly number[], m: readonly number[], b: readonly number[], bodies: readonly Sphere[], skipEnds = true): boolean {
  const p: Vec = [0, 0, 0];
  for (let i = 0; i <= 32; i++) {
    const u = i / 32;
    pathPoint(a, m, b, u, p);
    for (const s of bodies) {
      if (len(sub(p, s.c)) >= s.r * CLEARANCE) continue;
      // A chase pose may start or end close to its own world. Only the middle of the path owes it clearance.
      if (skipEnds && (u < 0.12 || u > 0.88)) continue;
      return false;
    }
  }
  return true;
}

/** The aim leaves first and arrives early: a flight looks where it is going for most of the way, from any start. */
const AIM_LEAD = 1.55;

/** Turns unit `a` toward unit `b`. Shortest way, and a half turn picks a side rather than passing through nothing. */
function slerp(a: Vec, b: Vec, k: number, out: Vec): void {
  const c = Math.max(-1, Math.min(1, dot3(a, b)));
  const th = Math.acos(c);
  if (th < 1e-4) { out[0] = b[0]; out[1] = b[1]; out[2] = b[2]; return; }
  let far = b;
  if (Math.PI - th < 1e-3) far = unit(add(b, UP, 0.02));
  const s = Math.sin(th);
  const p = Math.sin((1 - k) * th) / s;
  const q = Math.sin(k * th) / s;
  out[0] = a[0] * p + far[0] * q;
  out[1] = a[1] * p + far[1] * q;
  out[2] = a[2] * p + far[2] * q;
}

const aimFrom: Vec = [0, 0, 0];
const aimNow: Vec = [0, 0, 0];

/**
 * One sample of a flight, into `out`. The place follows the path. The aim turns on the sphere from where the camera looked at the start to
 * the goal as seen from here, because a straight lerp between two aims passes through the camera when it started facing away.
 */
export function poseAt(from: Pose, via: readonly number[], to: Pose, k: number, out: Pose): void {
  pathPoint(from.position, via, to.position, k, out.position);
  const startAim = unit(sub(from.target, from.position));
  aimFrom[0] = startAim[0]; aimFrom[1] = startAim[1]; aimFrom[2] = startAim[2];
  const here = sub(to.target, out.position);
  const reach = len(here) || 1;
  slerp(aimFrom, unit(here), Math.min(1, k * AIM_LEAD), aimNow);
  out.target[0] = out.position[0] + aimNow[0] * reach;
  out.target[1] = out.position[1] + aimNow[1] * reach;
  out.target[2] = out.position[2] + aimNow[2] * reach;
  out.fov = from.fov + (to.fov - from.fov) * k;
}

export const FOV = { system: 34, world: 30, craft: 38 } as const;
/** Half a hull in CSS px at each level, DESIGN 7.9: 15 px at System, 20 at World and Craft. */
export const HULL_SCALE = { system: 1, world: 20 / 15, craft: 20 / 15 } as const;

/** Distance so the outermost orbit spans 0.8 of `min(free.w, free.h)`, at this fov. */
export function worldDistance(outerOrbit: number, free: { w: number; h: number }): number {
  const tan = Math.tan((FOV.world * Math.PI) / 360);
  return (outerOrbit * free.h) / (0.8 * Math.min(free.w, free.h) * tan);
}

export const HULL_LENGTH = 15;
const CHASE_BACK = 6;
const CHASE_MIN = 3;
/** Rear three quarters: mostly looking out from the world past the hull, a little along the flight. */
const CHASE_YAW = (34 * Math.PI) / 180;
/** The hull stands this far above the limb. The aim splits it, so the limb lies along the foot of the frame and the sky keeps the rest. */
const LIMB_GAP = (17 * Math.PI) / 180;
const HULL_SHARE = 0.42;
const PITCH_MIN = (6 * Math.PI) / 180;
const PITCH_MAX = (82 * Math.PI) / 180;
const PITCH_STEPS = 16;

/** How far behind the hull the chase stands. Close to a small world, or the limb is a dot. */
export const chaseBack = (worldR: number): number => Math.max(CHASE_MIN * HULL_LENGTH, Math.min(CHASE_BACK * HULL_LENGTH, 2 * worldR));

/** Angle at a camera between the hull and the limb under it. Negative when the world stands in the way or the camera is inside it. */
function limbGap(c: Vec, hull: Vec, world: Sphere): number {
  const toWorld = sub(world.c, c);
  const d = len(toWorld);
  if (d <= world.r * 1.08) return -1;
  const toHull = unit(sub(hull, c));
  return Math.acos(Math.max(-1, Math.min(1, dot3(toHull, unit(toWorld))))) - Math.asin(world.r / d);
}

/**
 * Behind and above, on the far side of the hull from the flight, looking out and down: the limb lies along the foot of the frame, the hull
 * above it, and the sky fills the rest, as in 4.7. The camera's `up` is the system's, and the orbit lies nearly flat, so the limb can only
 * be below the hull when the look runs outward. The pitch is the one free number: the lowest that lifts the hull clear of the limb by
 * LIMB_GAP. It rises with the orbit and is a smooth function of where the hull is, which the low pass in the rig then smooths further.
 */
export function chasePose(hull: Xyz, tangent: Xyz, outward: Xyz, world: Sphere, out: Pose): void {
  const h: Vec = [hull.x, hull.y, hull.z];
  const up = UP;
  const flat = (v: Xyz): Vec => { const k = v.x * up[0] + v.y * up[1] + v.z * up[2]; return [v.x - up[0] * k, v.y - up[1] * k, v.z - up[2] * k]; };
  const o = unit(flat(outward));
  const t = unit(flat(tangent));
  const cy = Math.cos(CHASE_YAW);
  const sy = Math.sin(CHASE_YAW);
  const look = unit([o[0] * cy + t[0] * sy, o[1] * cy + t[1] * sy, o[2] * cy + t[2] * sy]);
  const half = (FOV.craft * Math.PI) / 360;
  let back = chaseBack(world.r);
  let c: Vec = h;
  // A high orbit over a small world can hold the hull and the limb in one frame only from farther back.
  for (let tries = 0; tries < 6; tries++) {
    const place = (pitch: number): Vec => {
      const run = back * Math.cos(pitch);
      const rise = back * Math.sin(pitch);
      return [h[0] - look[0] * run + up[0] * rise, h[1] - look[1] * run + up[1] * rise, h[2] - look[2] * run + up[2] * rise];
    };
    let lo = PITCH_MIN;
    let hi = PITCH_MIN;
    let found = false;
    let most = -Infinity;
    let top = PITCH_MIN;
    for (let i = 0; i <= PITCH_STEPS && !found; i++) {
      const p = PITCH_MIN + ((PITCH_MAX - PITCH_MIN) * i) / PITCH_STEPS;
      const g = limbGap(place(p), h, world);
      if (g >= LIMB_GAP) { hi = p; found = true; } else lo = p;
      if (g > most) { most = g; top = p; }
    }
    let pitch = top;
    if (found) {
      for (let i = 0; i < 6; i++) {
        const m = (lo + hi) / 2;
        if (limbGap(place(m), h, world) >= LIMB_GAP) hi = m; else lo = m;
      }
      pitch = hi;
    }
    c = place(pitch);
    if (limbGap(c, h, world) <= half * 1.45) break;
    back *= 1.3;
  }
  const toHull = unit(sub(h, c));
  const toWorld = unit(sub(world.c, c));
  const span = Math.acos(Math.max(-1, Math.min(1, dot3(toHull, toWorld))));
  const gap = limbGap(c, h, world);
  // Split the gap, or turn further toward the world when the limb would otherwise fall out of the frame.
  const turn = Math.max(LIMB_GAP * HULL_SHARE, gap - half * 0.72);
  const axis: Vec = [0, 0, 0];
  slerp(toHull, toWorld, Math.min(0.9, turn / Math.max(1e-3, span)), axis);
  out.position[0] = c[0];
  out.position[1] = c[1];
  out.position[2] = c[2];
  out.target[0] = c[0] + axis[0] * back;
  out.target[1] = c[1] + axis[1] * back;
  out.target[2] = c[2] + axis[2] * back;
  out.fov = FOV.craft;
}

export { ease };
