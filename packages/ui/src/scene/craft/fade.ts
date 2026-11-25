// How a craft moves between its two bodies as the camera comes in. `s` is what the hull measures on the screen in CSS px, and `m` is the
// length of its mark. All of it is a function of `s` alone, so the same zoom always looks the same, however you got there.

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The mesh grows up through a mark that holds still, and the mark leaves once the hull has covered it. Both are the same size at `s = m`, and
 * here `s` is what the ship really shows from this side, so a head-on hull stays a mark until there is enough of it to take over.
 */
export const MESH_FROM = 0.75;
export const MESH_TO = 1.5;
export const MARK_FROM = 1;
export const MARK_TO = 1.75;

export const meshFade = (s: number, m: number): number => smoothstep(MESH_FROM * m, MESH_TO * m, s);
export const markFade = (s: number, m: number): number => 1 - smoothstep(MARK_FROM * m, MARK_TO * m, s);

/** CSS px. Under it a hull is the smallest mesh, which is fine, because a triangle under a few pixels costs a whole shaded quad to draw. */
export const SPECK_TO = 110;
/** CSS px. Under it the far mesh is drawn, and the seam moves with the hull, so a plate that goes is one you were not reading. */
export const NEAR_FROM = 300;
/** Above it a ship casts a real shadow, in full by `SHADOW_FULL`. */
export const SHADOW_FROM = 340;
export const SHADOW_FULL = 560;
export const SHADOW_TILES = 4;

export const shadowStrength = (s: number): number => smoothstep(SHADOW_FROM, SHADOW_FULL, s);

/**
 * The length a hull shows from this side. `k` is how much of its axis lies across the view, 1 broadside and 0 end on, and `breadth` is its width
 * as a share of its length: a box seen at an angle shows some of each.
 */
export const apparentLength = (s: number, k: number, breadth: number): number => s * Math.min(1, k + breadth * Math.sqrt(Math.max(0, 1 - k * k)));

/**
 * How much of the hull is lit by its own state. Think of a second light on the ship: on a small hull it does most of the work, because there
 * is no surface to read, and by Craft zoom it has drawn back into the status section. Filled for an owned craft, and for an observed one it
 * reaches only the edges, which is an outline made of light.
 */
export const stateBody = (s: number): number => 1 - smoothstep(60, 260, s);

/** On top of that, past 1: how much of a blooming mark's light the hull takes over at the handover, gone once the ship stands on its own. */
export const stateHandover = (s: number, m: number): number => 1 - smoothstep(MARK_TO * m, MARK_TO * m + 44, s);

/** How much surface a hull can show. Worth nothing on a small one, and it is most of the cost, so it fades in on the way to World zoom. */
export const surfaceDetail = (s: number): number => smoothstep(70, 150, s);

/** Tile of a rank among `count` casters, as corner and size in 0..1. One gets the whole atlas, up to four share it. */
export function shadowTile(rank: number, count: number, out: { x: number; y: number; size: number }): void {
  if (count <= 1) { out.x = 0; out.y = 0; out.size = 1; return; }
  out.size = 0.5;
  out.x = rank % 2 === 0 ? 0 : 0.5;
  out.y = rank < 2 ? 0 : 0.5;
}

export interface MarkPose { heading: number; squash: number }

/**
 * The mark's pose from the ship's forward vector in view space, x right, y up. A mark is flat, so as a free camera swings to look along the
 * hull it foreshortens, and a ship coming straight at you keeps the last heading it had, where the projected vector has none to give.
 */
export function markPose(fx: number, fy: number, fz: number, held: number, out: MarkPose): MarkPose {
  const flat = Math.hypot(fx, fy);
  const whole = Math.hypot(flat, fz) || 1;
  const k = flat / whole;
  out.heading = k > 0.08 ? Math.atan2(fy, fx) : held;
  // Stops at two thirds: at 15 px a mark squeezed any further stops being a shape, and being read wins.
  out.squash = 0.66 + 0.34 * smoothstep(0.1, 0.8, k);
  return out;
}

export interface MarkBasis { ax: number; ay: number; bx: number; by: number; heading: number }

/**
 * The two axes of a mark on the screen, in CSS px per unit. A mark is drawn in plan, so it faces the camera while it is a mark, and it turns into
 * the hull's true plane as it hands over: `planar` runs 0 to 1, and the ring that a ship shows edge on has become that edge by the time it goes.
 * `zx, zy` is the ship's starboard axis in view space. A drawing is symmetric across the hull, so either sign of it will do.
 */
export function markBasis(fx: number, fy: number, fz: number, zx: number, zy: number, held: number, planar: number, half: number, pose: MarkPose, out: MarkBasis): MarkBasis {
  markPose(fx, fy, fz, held, pose);
  const c = Math.cos(pose.heading), s = Math.sin(pose.heading);
  const ax = c * pose.squash, ay = s * pose.squash;
  const bx = -s, by = c;
  const sign = bx * zx + by * zy < 0 ? -1 : 1;
  out.ax = (ax + (fx - ax) * planar) * half;
  out.ay = (ay + (fy - ay) * planar) * half;
  out.bx = (bx + (sign * zx - bx) * planar) * half;
  out.by = (by + (sign * zy - by) * planar) * half;
  out.heading = pose.heading;
  return out;
}

/** How far a mark has turned into the hull's plane, for `markBasis`. */
export const markPlanar = (s: number, m: number): number => smoothstep(MARK_FROM * m, MARK_TO * m, s);

/** CSS px a length covers at a depth, for a perspective camera. */
export const screenLength = (length: number, depth: number, focalCss: number): number => (depth <= 0 ? 0 : (length * focalCss) / depth);
