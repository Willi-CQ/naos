// One orbital plane per world, DESIGN 7.4. Pure, so the Plate and the scene draw the same circle.
import { hash32 } from '../store/veil.ts';
import { dot, type Lens, type Vec3 } from './space.ts';

const DEG = Math.PI / 180;

export type V3 = Vec3;

export interface OrbitPlane {
  /** Unit vectors in the plane, world space. */
  a: V3;
  b: V3;
}

const cross = (u: V3, v: V3): V3 => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const unit = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

/** A plane through two angles in radians. Hoops use it too, with their own table. */
export function planeOf(incl: number, node: number): OrbitPlane {
  const n: V3 = [Math.sin(incl) * Math.cos(node), Math.cos(incl), Math.sin(incl) * Math.sin(node)];
  const a = unit(cross(n, [0.31, 0.2, 0.93]));
  return { a, b: cross(n, a) };
}

/** Inclined 14 to 30 degrees by slot, because an inclination per orbit was unreadable scribble. `k` counts slots from 0. */
export const orbitPlane = (k: number): OrbitPlane => planeOf((14 + ((k * 37) % 17)) * DEG, ((k * 83 + 20) % 360) * DEG);

export function onOrbit(plane: OrbitPlane, centre: V3, r: number, th: number): V3 {
  const c = Math.cos(th) * r;
  const s = Math.sin(th) * r;
  return [centre[0] + plane.a[0] * c + plane.b[0] * s, centre[1] + plane.a[1] * c + plane.b[1] * s, centre[2] + plane.a[2] * c + plane.b[2] * s];
}

/** The ellipse a circle of radius 1 in this plane draws through a lens: the principal axes of its two projected vectors, y down. */
export function orbitEllipse(plane: OrbitPlane, lens: Pick<Lens, 'right' | 'up'>): { rx: number; ry: number; tilt: number } {
  const ax = dot(plane.a, lens.right);
  const ay = -dot(plane.a, lens.up);
  const bx = dot(plane.b, lens.right);
  const by = -dot(plane.b, lens.up);
  const t = 0.5 * Math.atan2(2 * (ax * bx + ay * by), ax * ax + ay * ay - bx * bx - by * by);
  const c = Math.cos(t);
  const s = Math.sin(t);
  const mx = ax * c + bx * s;
  const my = ay * c + by * s;
  return { rx: Math.hypot(mx, my), ry: Math.hypot(-ax * s + bx * c, -ay * s + by * c), tilt: Math.atan2(my, mx) };
}

/** Law 3: a craft moves along its orbit only as its tokens flow. The hash only spreads them out. */
export const craftAngle = (id: string, outputTokens: number): number => (hash32(id) % 628) / 100 + outputTokens / 6000;
