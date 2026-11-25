// Where the fine ground goes in low orbit. Pure, so the tests can hold it to the pixels it serves.
export type V3 = readonly [number, number, number];

export interface RegionLevel {
  /** Unit vector in the body frame. */
  centre: V3;
  /** Half width of the patch, as a tangent: a gnomonic projection, like one cube face. */
  width: number;
}

export const PATCH_SIZE = 1024;
export const PATCH_LEVELS = 3;
/** Below this altitude, in radii, a cube is too coarse for the ground in front of the camera, whatever its size. */
export const REGION_ALTITUDE = 1;

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const blend = (a: V3, b: V3, t: number): V3 => unit([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);

/** Distance along a unit ray to the unit sphere, or null. */
export function hitSphere(cam: V3, ray: V3): number | null {
  const b = dot(cam, ray);
  const disc = b * b - dot(cam, cam) + 1;
  if (disc <= 0) return null;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : null;
}

/**
 * Three patches, coarse first, nested around the ground the camera can see. The finest has one texel to a pixel on the nearest visible ground,
 * and the coarsest reaches the horizon. rays are unit rays through the frame, its centre first, in the body frame. px is radians per pixel.
 * Returns null when no ground is in view.
 */
export function planRegion(cam: V3, rays: readonly V3[], px: number): RegionLevel[] | null {
  const r = Math.hypot(cam[0], cam[1], cam[2]);
  if (r <= 1) return null;
  let near = Infinity;
  let closest: V3 | null = null;
  for (const ray of rays) {
    const t = hitSphere(cam, ray);
    if (t === null || t >= near) continue;
    near = t;
    closest = unit([cam[0] + ray[0] * t, cam[1] + ray[1] * t, cam[2] + ray[2] * t]);
  }
  if (!closest) return null;
  const middle = rays[0]!;
  const t = hitSphere(cam, middle);
  // A centre ray that misses looks past the horizon, and the ground it stands for is the horizon in that direction.
  const toHorizon = Math.sqrt(r * r - 1);
  const aim = unit([cam[0] + middle[0] * (t ?? toHorizon), cam[1] + middle[1] * (t ?? toHorizon), cam[2] + middle[2] * (t ?? toHorizon)]);

  const fine = Math.min(0.3, Math.max(0.004, (PATCH_SIZE / 2) * 1.2 * near * px));
  const horizon = Math.tan(Math.min(Math.acos(1 / r), 1.05));
  const coarse = Math.max(fine * 2.4, Math.min(0.62, horizon * 0.9));
  const middling = Math.sqrt(fine * coarse);
  return [
    { centre: blend(closest, aim, 0.6), width: coarse },
    { centre: blend(closest, aim, 0.4), width: middling },
    { centre: blend(closest, aim, 0.2), width: fine },
  ];
}

/** How far a patch has fallen behind what is wanted of it, where 1 means bake it again. A patch that does not exist is always behind. */
export function staleness(have: RegionLevel | null, want: RegionLevel): number {
  if (!have) return Infinity;
  const off = Math.acos(Math.min(1, dot(have.centre, want.centre)));
  return Math.max(off / (have.width * 0.3), Math.abs(Math.log(want.width / have.width)) / 0.25);
}

/** The matrix that takes a face corner, -1 to 1 in x and y and 1 in z, to a direction, column by column, and its inverse, for three's fromArray. */
export function patchMatrices(level: RegionLevel): { face: number[]; inverse: number[] } {
  const c = level.centre;
  const w = level.width;
  const seed: V3 = Math.abs(c[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const t = unit([c[1] * seed[2] - c[2] * seed[1], c[2] * seed[0] - c[0] * seed[2], c[0] * seed[1] - c[1] * seed[0]]);
  const b: V3 = [c[1] * t[2] - c[2] * t[1], c[2] * t[0] - c[0] * t[2], c[0] * t[1] - c[1] * t[0]];
  return {
    face: [t[0] * w, t[1] * w, t[2] * w, b[0] * w, b[1] * w, b[2] * w, c[0], c[1], c[2]],
    inverse: [t[0] / w, b[0] / w, c[0], t[1] / w, b[1] / w, c[1], t[2] / w, b[2] / w, c[2]],
  };
}
