// The marks: what each ship is when it is 15 px long. Drawn by hand from data, on a grid that gives every stroke at least one and a half device
// pixels, because a shape that is true to the ship and vanishes tells nobody anything. They are plan views with their features overstated.
// A signed distance field carries them, so fill, outline and dashes all come from one drawing. An outline runs around the drawing, never inside
// it: these limbs are two pixels wide, so hollowing one leaves nothing, and filled and outlined would be the same picture.
import { HULLS, ROLES, type HullClass, type Role } from './kind.ts';

type P = readonly [number, number];
export type Prim =
  | { k: 'poly'; p: readonly P[] }
  | { k: 'bar'; a: P; b: P; w: number }
  | { k: 'ring'; c: P; r: number; w: number }
  /** A ring open at the bow and at the stern, by half angles measured from +x and from -x. */
  | { k: 'arc'; c: P; r: number; w: number; bow: number; stern: number }
  | { k: 'disc'; c: P; r: number };

/** Device px, as mark.frag draws it: half the outline's width, and the clear gap between it and the drawing's edge. */
export const OUTLINE_HALF = 0.62;
export const OUTLINE_GAP = 0.3;

const hullBody = (hull: HullClass): Prim[] => {
  switch (hull) {
    case 'scout': return [{ k: 'poly', p: [[1, 0], [0.2, 0.13], [-0.42, 0.17], [-0.84, 0.48], [-0.84, -0.48], [-0.42, -0.17], [0.2, -0.13]] }];
    case 'cruiser': return [
      { k: 'poly', p: [[0.98, 0], [0.62, 0.17], [-0.92, 0.17], [-0.92, -0.17], [0.62, -0.17]] },
      { k: 'bar', a: [-0.62, 0.48], b: [0.28, 0.48], w: 0.21 },
      { k: 'bar', a: [-0.62, -0.48], b: [0.28, -0.48], w: 0.21 },
      { k: 'bar', a: [-0.34, -0.48], b: [-0.34, 0.48], w: 0.16 },
    ];
    case 'capital': return [
      { k: 'poly', p: [[1, 0.13], [0.8, 0.3], [0.3, 0.32], [0.3, -0.32], [0.8, -0.3], [1, -0.13]] },
      { k: 'bar', a: [-0.8, 0], b: [0.3, 0], w: 0.26 },
      { k: 'poly', p: [[-0.42, 0.66], [-0.2, 0.66], [-0.14, 0.13], [-0.72, 0.13], [-0.72, 0.66]] },
      { k: 'poly', p: [[-0.42, -0.66], [-0.2, -0.66], [-0.14, -0.13], [-0.72, -0.13], [-0.72, -0.66]] },
      { k: 'poly', p: [[-0.74, 0.34], [-1, 0.25], [-1, -0.25], [-0.74, -0.34]] },
    ];
    case 'longrange': return [
      { k: 'bar', a: [-0.96, 0], b: [0.76, 0], w: 0.11 },
      { k: 'poly', p: [[0.98, 0.54], [0.76, 0.58], [0.76, -0.58], [0.98, -0.54]] },
      { k: 'poly', p: [[-0.68, 0.1], [-1, 0.26], [-1, -0.26], [-0.68, -0.1]] },
      { k: 'disc', c: [0.2, 0], r: 0.13 },
      { k: 'disc', c: [-0.16, 0], r: 0.13 },
    ];
    default: return [{ k: 'poly', p: [[1, 0], [-0.62, 0.46], [-0.24, 0], [-0.62, -0.46]] }];
  }
};

const transform = (ps: readonly Prim[], scale: number, dx: number): Prim[] => {
  const at = (p: P): P => [p[0] * scale + dx, p[1] * scale];
  return ps.map((q): Prim => {
    switch (q.k) {
      case 'poly': return { k: 'poly', p: q.p.map(at) };
      case 'bar': return { k: 'bar', a: at(q.a), b: at(q.b), w: Math.max(q.w * scale, 0.11) };
      case 'ring': return { k: 'ring', c: at(q.c), r: q.r * scale, w: q.w };
      case 'arc': return { ...q, c: at(q.c), r: q.r * scale };
      default: return { k: 'disc', c: at(q.c), r: q.r * scale };
    }
  });
};

/** A hull with its mission. The body gives ground to the feature, and least of all on a tug, because most of a real fleet is tugs. */
export function glyph(hull: HullClass, role: Role): Prim[] {
  const body = hullBody(hull);
  switch (role) {
    case 'probe': return [
      ...transform(body, 0.66, -0.34),
      { k: 'bar', a: [0.2, 0], b: [0.92, 0], w: 0.11 },
      { k: 'bar', a: [0.8, -0.2], b: [0.8, 0.2], w: 0.13 },
    ];
    case 'survey': return [
      ...transform(body, 0.74, -0.26),
      { k: 'bar', a: [0.5, -0.92], b: [0.5, 0.92], w: 0.17 },
      { k: 'bar', a: [0.2, 0], b: [0.5, 0], w: 0.14 },
    ];
    case 'tug': return [
      ...transform(body, 0.86, -0.14),
      { k: 'bar', a: [0.6, -0.5], b: [0.6, 0.5], w: 0.13 },
      { k: 'bar', a: [0.6, 0.46], b: [1, 0.3], w: 0.13 },
      { k: 'bar', a: [0.6, -0.46], b: [1, -0.3], w: 0.13 },
    ];
    // Open wide at the bow and a little at the stern: a closed ring with a hull through it is a no-entry sign, and section 6 owns rings.
    case 'command': return [
      ...transform(body, 0.84, -0.02),
      { k: 'arc', c: [-0.14, 0], r: 0.82, w: 0.14, bow: 1.05, stern: 0.5 },
    ];
    // Arms swept back and a nose ahead of them. Four equal arms would be section 6's cross, with no front.
    case 'drone': return [
      { k: 'poly', p: [[0.98, 0], [0.34, 0.27], [-0.44, 0.27], [-0.44, -0.27], [0.34, -0.27]] },
      { k: 'bar', a: [-0.12, 0.2], b: [-0.84, 0.8], w: 0.19 },
      { k: 'bar', a: [-0.12, -0.2], b: [-0.84, -0.8], w: 0.19 },
      { k: 'bar', a: [0.2, 0.2], b: [0.26, 0.74], w: 0.17 },
      { k: 'bar', a: [0.2, -0.2], b: [0.26, -0.74], w: 0.17 },
    ];
    default: return body;
  }
}

function polySd(p: readonly P[], x: number, y: number): number {
  let d = Infinity;
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i]!, b = p[j]!;
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const wx = x - a[0], wy = y - a[1];
    const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
    d = Math.min(d, Math.hypot(wx - ex * t, wy - ey * t));
    if ((a[1] > y) !== (b[1] > y) && x < (ex * (y - a[1])) / ey + a[0]) inside = !inside;
  }
  return inside ? -d : d;
}

function primSd(q: Prim, x: number, y: number): number {
  switch (q.k) {
    case 'poly': return polySd(q.p, x, y);
    case 'disc': return Math.hypot(x - q.c[0], y - q.c[1]) - q.r;
    case 'ring': return Math.abs(Math.hypot(x - q.c[0], y - q.c[1]) - q.r) - q.w / 2;
    case 'arc': {
      const dx = x - q.c[0], dy = y - q.c[1];
      const a = Math.abs(Math.atan2(dy, dx));
      if (a >= q.bow && a <= Math.PI - q.stern) return Math.abs(Math.hypot(dx, dy) - q.r) - q.w / 2;
      const side = dy >= 0 ? 1 : -1;
      const end = (t: number): number => Math.hypot(dx - q.r * Math.cos(t), dy - side * q.r * Math.sin(t));
      return Math.min(end(q.bow), end(Math.PI - q.stern)) - q.w / 2;
    }
    default: {
      const ex = q.b[0] - q.a[0], ey = q.b[1] - q.a[1];
      const len = Math.hypot(ex, ey) || 1;
      const ux = ex / len, uy = ey / len;
      const wx = x - (q.a[0] + q.b[0]) / 2, wy = y - (q.a[1] + q.b[1]) / 2;
      const dx = Math.abs(wx * ux + wy * uy) - len / 2;
      const dy = Math.abs(-wx * uy + wy * ux) - q.w / 2;
      return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
    }
  }
}

export const sdf = (prims: readonly Prim[], x: number, y: number): number => {
  let d = Infinity;
  for (const q of prims) d = Math.min(d, primSd(q, x, y));
  return d;
};

export const ATLAS_COLS = ROLES.length;
export const ATLAS_ROWS = HULLS.length;
export const TILE = 72;
/** A tile reaches this far from the centre, in unit coordinates. */
export const TILE_REACH = 1.25;
/** Distance that the 0..255 range of a texel covers either side of the edge. */
export const SDF_RANGE = 0.42;

/** One channel, `ATLAS_COLS * TILE` wide. Runs once, on the first mark, and takes a couple of milliseconds a tile. */
export function buildAtlas(): { data: Uint8Array; width: number; height: number } {
  const width = ATLAS_COLS * TILE;
  const height = ATLAS_ROWS * TILE;
  const data = new Uint8Array(width * height);
  HULLS.forEach((hull, row) => {
    ROLES.forEach((role, col) => {
      const prims = glyph(hull, role);
      for (let j = 0; j < TILE; j++) {
        for (let i = 0; i < TILE; i++) {
          const x = ((i + 0.5) / TILE * 2 - 1) * TILE_REACH;
          const y = ((j + 0.5) / TILE * 2 - 1) * TILE_REACH;
          const d = sdf(prims, x, y);
          data[(row * TILE + j) * width + col * TILE + i] = Math.round(Math.max(0, Math.min(1, 0.5 - (d / SDF_RANGE) * 0.5)) * 255);
        }
      }
    });
  });
  return { data, width, height };
}

/** Coverage on a pixel grid, as the eye gets it from a real mark. Lets a test ask whether two of them can be told apart at their true size. */
export function coverage(prims: readonly Prim[], px: number, samples = 4): Float32Array {
  const out = new Float32Array(px * px);
  for (let j = 0; j < px; j++) {
    for (let i = 0; i < px; i++) {
      let hits = 0;
      for (let v = 0; v < samples; v++) {
        for (let u = 0; u < samples; u++) {
          const x = ((i + (u + 0.5) / samples) / px * 2 - 1) * 1.1;
          const y = ((j + (v + 0.5) / samples) / px * 2 - 1) * 1.1;
          if (sdf(prims, x, y) <= 0) hits++;
        }
      }
      out[j * px + i] = hits / (samples * samples);
    }
  }
  return out;
}

/** The same raster for an outlined mark, as the shader draws it. `pxPerUnit` is device px per unit of the drawing. */
export function outlineCoverage(prims: readonly Prim[], px: number, pxPerUnit: number, samples = 4): Float32Array {
  const out = new Float32Array(px * px);
  const half = OUTLINE_HALF / pxPerUnit;
  const centre = OUTLINE_GAP / pxPerUnit + half;
  const reach = px / 2 / pxPerUnit;
  for (let j = 0; j < px; j++) {
    for (let i = 0; i < px; i++) {
      let hits = 0;
      for (let v = 0; v < samples; v++) {
        for (let u = 0; u < samples; u++) {
          const x = ((i + (u + 0.5) / samples) / px * 2 - 1) * reach;
          const y = ((j + (v + 0.5) / samples) / px * 2 - 1) * reach;
          if (Math.abs(sdf(prims, x, y) - centre) <= half) hits++;
        }
      }
      out[j * px + i] = hits / (samples * samples);
    }
  }
  return out;
}

/** Share of the inked area that differs between two rasters, 0 for the same and 1 for nothing in common. */
export function difference(a: Float32Array, b: Float32Array): number {
  let diff = 0;
  let ink = 0;
  for (let i = 0; i < a.length; i++) {
    diff += Math.abs(a[i]! - b[i]!);
    ink += Math.max(a[i]!, b[i]!);
  }
  return ink > 0 ? diff / ink : 0;
}
