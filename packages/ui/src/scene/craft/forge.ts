// A small hard-surface kit. Ships are written in metres with +x forward, +y dorsal, +z starboard, like the sprite whose heading 0 points right.
// Pure on purpose, so a shape can be counted and proved in Node. Normals decide the winding, never the order of the points, which is what
// lets a recipe mirror itself without flipping a face. `detail` is the near level: the same recipe with it off is the far level, so both
// keep one silhouette and the only thing that changes is what you could not have seen anyway. `speck` is the smallest level, for a ship of a few
// dozen pixels: the same recipe again, and the forge itself drops whatever is too small to matter, so no recipe has to say it twice.
//
// Faces carry their own edges: every flat face knows how far each point is from its rim and how round that rim is, and the shader rolls the normal
// over at the edge. That is the bevel on every box and plate of the fleet, and it costs one attribute where real chamfers cost four times the triangles.

export type V3 = readonly [number, number, number];
/** Three axes then an origin, twelve numbers. */
export type M = readonly number[];

export const MAT = { WHITE: 0, DARK: 1, GOLD: 2, METAL: 3, SOLAR: 4, WINDOW: 5, THROAT: 6, SILVER: 7, STRIP: 8, RADIATOR: 9, PAINT: 10, GRAPHITE: 11 } as const;

export const IDENTITY: M = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

export function mul(a: M, b: M): M {
  const r = new Array<number>(12);
  for (let c = 0; c < 4; c++) {
    for (let i = 0; i < 3; i++) {
      r[c * 3 + i] = a[i]! * b[c * 3]! + a[3 + i]! * b[c * 3 + 1]! + a[6 + i]! * b[c * 3 + 2]! + (c === 3 ? a[9 + i]! : 0);
    }
  }
  return r;
}

export const move = (x: number, y = 0, z = 0): M => [1, 0, 0, 0, 1, 0, 0, 0, 1, x, y, z];
export const scaled = (x: number, y = x, z = x): M => [x, 0, 0, 0, y, 0, 0, 0, z, 0, 0, 0];
export const turnX = (r: number): M => { const c = Math.cos(r), s = Math.sin(r); return [1, 0, 0, 0, c, s, 0, -s, c, 0, 0, 0]; };
export const turnY = (r: number): M => { const c = Math.cos(r), s = Math.sin(r); return [c, 0, -s, 0, 1, 0, s, 0, c, 0, 0, 0]; };
export const turnZ = (r: number): M => { const c = Math.cos(r), s = Math.sin(r); return [c, s, 0, -s, c, 0, 0, 0, 1, 0, 0, 0]; };

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const NO_EDGE: readonly [number, number, number, number] = [0, 0, 0, 0];

/** A frame whose x axis runs from a to b, origin at a. The other axes keep close to ship up, so a row of parts lines up. */
export function along(a: V3, b: V3, roll = 0): M {
  const x = unit(sub(b, a));
  const near = Math.abs(x[1]) > 0.9 ? [0, 0, 1] as V3 : [0, 1, 0] as V3;
  const z = unit(cross(x, near));
  const y = cross(z, x);
  const frame: M = [...x, ...y, ...z, ...a];
  return roll ? mul(frame, turnX(roll)) : frame;
}

export interface Station { x: number; y?: number; z?: number; hw: number; hh: number }
export type Section = ReadonlyArray<readonly [number, number]>;

/** A rectangle with its corners cut, the section of nearly everything that holds pressure. `c` is how much of each side the cut takes. */
/** A section's scale at x on a run of stations, so a frame can be laid around a hull at any point. */
export function stationAt(stations: readonly Station[], x: number): Station {
  for (let i = 0; i + 1 < stations.length; i++) {
    const a = stations[i]!, b = stations[i + 1]!;
    if (x >= Math.min(a.x, b.x) && x <= Math.max(a.x, b.x)) {
      const t = (x - a.x) / (b.x - a.x || 1);
      const mix = (p: number, q: number): number => p + (q - p) * t;
      return { x, y: mix(a.y ?? 0, b.y ?? 0), z: mix(a.z ?? 0, b.z ?? 0), hw: mix(a.hw, b.hw), hh: mix(a.hh, b.hh) };
    }
  }
  return stations[stations.length - 1]!;
}

export function octagon(c = 0.35): Section {
  const k = 1 - c;
  return [[1, k], [k, 1], [-k, 1], [-1, k], [-1, -k], [-k, -1], [k, -1], [1, -k]];
}

/** Flat top, wider belly, the shape of a thing that was once asked to fly through air. */
export function lifting(): Section {
  return [[1, 0.1], [0.72, 0.62], [0.34, 1], [-0.34, 1], [-0.72, 0.62], [-1, 0.1], [-0.82, -0.72], [-0.3, -1], [0.3, -1], [0.82, -0.72]];
}

export interface Spot { p: V3; kind: 'nav' | 'strobe' | 'dock'; size: number }
export interface Nozzle { p: V3; dir: V3; r: number }

export interface Mesh {
  position: Float32Array;
  normal: Int16Array;
  uv: Float32Array;
  /** Per vertex: material, seed, panel size at 16 per metre, bevel radius at 64 per metre. */
  meta: Uint8Array;
  /** Per vertex: place on the flat face from its centre along two sides, then the half size of the face along each, metres. */
  edge: Float32Array;
  index: Uint32Array;
  triangles: number;
  min: V3;
  max: V3;
}

/** Deterministic, small, and good enough to place a vent. */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pixels a chord may stand off a circle, on the largest size each level is drawn at. A round thing must never show its corners. */
const CHORD_PX = 0.3;
const FAR_PX = 300;
const SPECK_PX = 110;

export class Forge {
  readonly detail: boolean;
  /** Metres. On the smallest level anything shorter than this is left out. Zero on the other two. */
  readonly least: number;
  /** Metres: the part's longest reach, which turns a radius into pixels on the levels that spare segments. */
  readonly reach: number;
  readonly rand: () => number;
  readonly spots: Spot[] = [];
  readonly nozzles: Nozzle[] = [];
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly tex: number[] = [];
  private readonly met: number[] = [];
  private readonly edg: number[] = [];
  private readonly idx: number[] = [];
  private m: M = IDENTITY;
  private flip = 1;
  private mat: number = MAT.WHITE;
  private panel = 3;
  private seed = 0;
  private bevel = 0;
  private readonly seeds: () => number;

  constructor(seed: number, detail: boolean, least = 0, reach = 0) {
    this.detail = detail;
    this.least = least;
    this.reach = reach;
    this.rand = rng(seed);
    this.seeds = rng(seed ^ 0x51ed);
  }

  /** Runs `fn` inside a frame. */
  at(m: M, fn: () => void): void {
    const save = this.m;
    const flip = this.flip;
    this.m = mul(this.m, m);
    this.flip = determinant(this.m) < 0 ? -1 : 1;
    fn();
    this.m = save;
    this.flip = flip;
  }

  /** Once as written and once across the centre line. */
  both(fn: () => void): void {
    fn();
    this.at(scaled(1, 1, -1), fn);
  }

  /** Material and panel size for what follows. */
  use(mat: number, panel = this.panel): this {
    this.mat = mat;
    this.panel = panel;
    this.seed = Math.floor(this.seeds() * 256);
    return this;
  }

  point(p: V3): V3 {
    const m = this.m;
    return [m[0]! * p[0] + m[3]! * p[1] + m[6]! * p[2] + m[9]!, m[1]! * p[0] + m[4]! * p[1] + m[7]! * p[2] + m[10]!, m[2]! * p[0] + m[5]! * p[1] + m[8]! * p[2] + m[11]!];
  }

  private dir(v: V3): V3 {
    const m = this.m;
    // The cofactor matrix carries a normal through any scale: its columns are the cross products of the frame's axes. The mirror gives its sign back.
    const yz = [m[4]! * m[8]! - m[5]! * m[7]!, m[5]! * m[6]! - m[3]! * m[8]!, m[3]! * m[7]! - m[4]! * m[6]!];
    const zx = [m[7]! * m[2]! - m[8]! * m[1]!, m[8]! * m[0]! - m[6]! * m[2]!, m[6]! * m[1]! - m[7]! * m[0]!];
    const xy = [m[1]! * m[5]! - m[2]! * m[4]!, m[2]! * m[3]! - m[0]! * m[5]!, m[0]! * m[4]! - m[1]! * m[3]!];
    return unit([
      this.flip * (yz[0]! * v[0] + zx[0]! * v[1] + xy[0]! * v[2]),
      this.flip * (yz[1]! * v[0] + zx[1]! * v[1] + xy[1]! * v[2]),
      this.flip * (yz[2]! * v[0] + zx[2]! * v[1] + xy[2]! * v[2]),
    ]);
  }

  light(p: V3, kind: Spot['kind'], size: number): void { this.spots.push({ p: this.point(p), kind, size }); }

  /** Where a plume attaches: the exit plane of a nozzle. `dir` points out along the exhaust. */
  nozzle(p: V3, dir: V3, r: number): void { this.nozzles.push({ p: this.point(p), dir: this.dir(dir), r }); }

  /** Panels follow the ship's axes wherever a part is placed, by projecting on the plane the face mostly lies in. */
  private vertex(p: V3, n: V3, uv?: readonly [number, number], e: readonly [number, number, number, number] = NO_EDGE): number {
    const i = this.pos.length / 3;
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n[0], n[1], n[2]);
    if (uv) this.tex.push(uv[0], uv[1]);
    else {
      const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
      if (ay >= ax && ay >= az) this.tex.push(p[0], p[2]);
      else if (az >= ax) this.tex.push(p[0], p[1]);
      else this.tex.push(p[2], p[1]);
    }
    this.met.push(this.mat, this.seed, Math.min(255, Math.round(this.panel * 16)), e === NO_EDGE ? 0 : Math.min(255, Math.round(this.bevel * 64)));
    this.edg.push(e[0], e[1], e[2], e[3]);
    return i;
  }

  /** A convex polygon. `normal` is one vector, or one per point. */
  poly(points: readonly V3[], normal: V3 | readonly V3[], uv?: ReadonlyArray<readonly [number, number]>): void {
    const many = Array.isArray(normal[0]);
    const ps = points.map((p) => this.point(p));
    const ns = points.map((_, i) => this.dir(many ? (normal as readonly V3[])[i]! : normal as V3));
    let g: V3 = [0, 0, 0];
    for (let i = 1; i + 1 < ps.length; i++) {
      const c = cross(sub(ps[i]!, ps[0]!), sub(ps[i + 1]!, ps[0]!));
      g = [g[0] + c[0], g[1] + c[1], g[2] + c[2]];
    }
    const sum = ns.reduce<V3>((s, n) => [s[0] + n[0], s[1] + n[1], s[2] + n[2]], [0, 0, 0]);
    const reverse = dot(g, sum) < 0;
    // Four points on one normal is a plate, and a plate has a rim. Anything smooth runs into its neighbour and has none.
    const rim = ps.length === 4 && this.bevel > 0 && !many;
    const hu = rim ? (dist(ps[0]!, ps[1]!) + dist(ps[3]!, ps[2]!)) / 4 : 0;
    const hv = rim ? (dist(ps[0]!, ps[3]!) + dist(ps[1]!, ps[2]!)) / 4 : 0;
    const at = ps.map((p, i) => this.vertex(p, ns[i]!, uv?.[i], rim ? [i === 0 || i === 3 ? -hu : hu, i < 2 ? -hv : hv, hu, hv] : NO_EDGE));
    for (let i = 1; i + 1 < at.length; i++) {
      if (reverse) this.idx.push(at[0]!, at[i + 1]!, at[i]!);
      else this.idx.push(at[0]!, at[i]!, at[i + 1]!);
    }
  }

  /** A polygon whose normal comes from itself, turned to face `out`. */
  face(points: readonly V3[], out: V3): void {
    let g: V3 = [0, 0, 0];
    for (let i = 1; i + 1 < points.length; i++) {
      const c = cross(sub(points[i]!, points[0]!), sub(points[i + 1]!, points[0]!));
      g = [g[0] + c[0], g[1] + c[1], g[2] + c[2]];
    }
    const n = unit(g);
    this.poly(points, dot(n, out) < 0 ? [-n[0], -n[1], -n[2]] : n);
  }

  /** A raised frame around a hull. A ship's scale is mostly these: rings at even stations that say how far apart its bulkheads are. */
  frame(stations: readonly Station[], section: Section, x0: number, x1: number, grow: number, matOf?: (side: number, band: number) => number): void {
    const a = stationAt(stations, x0);
    const b = stationAt(stations, x1);
    const up = (s: Station, g: number): Station => ({ ...s, hw: s.hw + g, hh: s.hh + g });
    this.loft([up(a, 0), up(a, grow), up(b, grow), up(b, 0)], section, matOf, [false, false]);
  }

  /** A box. The rim the shader rolls is what catches the light on a hard surface. */
  box(c: V3, size: V3, bevel = -1): void {
    if (Math.max(size[0], size[1], size[2]) < this.least) return;
    // Every window is its own room, so a row of them is never lit in step.
    if (this.mat === MAT.WINDOW) this.seed = Math.floor(this.seeds() * 256);
    const h = [size[0] / 2, size[1] / 2, size[2] / 2] as const;
    const least = Math.min(h[0], h[1], h[2]);
    const pt = (s: readonly [number, number, number]): V3 => [c[0] + s[0] * h[0], c[1] + s[1] * h[1], c[2] + s[2] * h[2]];
    const save = this.bevel;
    this.bevel = bevel < 0 ? Math.min(0.14, least * 0.4) : Math.min(bevel, least * 0.6);
    for (let a = 0; a < 3; a++) {
      const d = (a + 1) % 3;
      const e = (a + 2) % 3;
      for (const s of [-1, 1]) {
        const n: [number, number, number] = [0, 0, 0];
        n[a] = s;
        const corner = (u: number, v: number): V3 => {
          const q: [number, number, number] = [0, 0, 0];
          q[a] = s; q[d] = u; q[e] = v;
          return pt(q);
        };
        this.poly([corner(1, 1), corner(-1, 1), corner(-1, -1), corner(1, -1)], n);
      }
    }
    this.bevel = save;
  }

  /** A skin through stations along x. Facets stay flat, as tiles and plates do. */
  loft(stations: readonly Station[], section: Section, matOf?: (side: number, band: number) => number, caps: readonly [boolean, boolean] = [true, true]): void {
    const at = (i: number, j: number): V3 => {
      const s = stations[i]!;
      const q = section[j]!;
      return [s.x, (s.y ?? 0) + s.hh * q[1], (s.z ?? 0) + s.hw * q[0]];
    };
    const n = section.length;
    const base = this.mat;
    for (let i = 0; i + 1 < stations.length; i++) {
      for (let j = 0; j < n; j++) {
        const k = (j + 1) % n;
        const s = stations[i]!;
        const centre: V3 = [s.x, s.y ?? 0, s.z ?? 0];
        const a = at(i, j), b = at(i, k), c = at(i + 1, k), d = at(i + 1, j);
        if (matOf) this.mat = matOf(j, i);
        this.bevel = Math.min(0.2, Math.max(0.05, Math.min(dist(a, b), dist(b, c)) * 0.05));
        this.face([a, b, c, d], sub(lerp3(a, c, 0.5), centre));
        this.bevel = 0;
      }
    }
    this.mat = base;
    const cap = (i: number, sign: number): void => {
      this.poly(section.map((_, j) => at(i, j)), [sign, 0, 0]);
    };
    if (caps[0]) cap(0, stations[0]!.x < stations[stations.length - 1]!.x ? -1 : 1);
    if (caps[1]) cap(stations.length - 1, stations[0]!.x < stations[stations.length - 1]!.x ? 1 : -1);
  }

  /** A frustum from a to b. */
  cyl(a: V3, b: V3, ra: number, rb = ra, segs = 16, caps: readonly [boolean, boolean] = [true, true]): void {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    this.at(along(a, b), () => {
      this.lathe(caps[0] ? [[0, 0], [0, ra], [len, rb]] : [[0, ra], [len, rb]], segs);
      if (caps[1]) this.lathe([[len, rb], [len, 0]], segs);
    });
  }

  /**
   * Turns a profile of [x, r] around x. Walk it so the surface lies on your left: +x with r above the axis faces outward, and -x faces
   * in, which is the inside of a nozzle. A joint sharper than 40 degrees stays a hard edge.
   */
  lathe(profile: ReadonlyArray<readonly [number, number]>, segs = 16, phase = 0): void {
    if (!this.detail) {
      let widest = 0;
      for (const p of profile) widest = Math.max(widest, p[1]);
      const onScreen = (widest * (this.least > 0 ? SPECK_PX : FAR_PX)) / (this.reach || widest * 8 || 1);
      segs = Math.min(segs, roundSegments(onScreen));
    }
    if (this.least > 0 && profile.length > 4) profile = profile.filter((_, i) => i % 2 === 0 || i === profile.length - 1);
    const normals: Array<readonly [number, number]> = [];
    for (let i = 0; i + 1 < profile.length; i++) {
      const dx = profile[i + 1]![0] - profile[i]![0];
      const dr = profile[i + 1]![1] - profile[i]![1];
      const l = Math.hypot(dx, dr) || 1;
      normals.push([-dr / l, dx / l]);
    }
    let v = 0;
    for (let i = 0; i + 1 < profile.length; i++) {
      const p = profile[i]!;
      const q = profile[i + 1]!;
      const here = normals[i]!;
      const blend = (o: readonly [number, number] | undefined): readonly [number, number] => {
        if (!o || here[0] * o[0] + here[1] * o[1] < 0.76) return here;
        const l = Math.hypot(here[0] + o[0], here[1] + o[1]);
        return [(here[0] + o[0]) / l, (here[1] + o[1]) / l];
      };
      const na = blend(normals[i - 1]);
      const nb = blend(normals[i + 1]);
      const step = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const rim = Math.max(p[1], q[1]);
      for (let j = 0; j < segs; j++) {
        const t0 = phase + (j / segs) * Math.PI * 2;
        const t1 = phase + ((j + 1) / segs) * Math.PI * 2;
        const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
        const u0 = t0 * rim, u1 = t1 * rim;
        this.poly(
          [[p[0], p[1] * c0, p[1] * s0], [p[0], p[1] * c1, p[1] * s1], [q[0], q[1] * c1, q[1] * s1], [q[0], q[1] * c0, q[1] * s0]],
          [[na[0], na[1] * c0, na[1] * s0], [na[0], na[1] * c1, na[1] * s1], [nb[0], nb[1] * c1, nb[1] * s1], [nb[0], nb[1] * c0, nb[1] * s0]],
          [[u0, v], [u1, v], [u1, v + step], [u0, v + step]],
        );
      }
      v += step;
    }
  }

  sphere(c: V3, r: number, segs = 16, rings = 8): void {
    const profile: Array<[number, number]> = [];
    for (let i = 0; i <= rings; i++) {
      const t = Math.PI - (i / rings) * Math.PI;
      profile.push([Math.cos(t) * r, Math.sin(t) * r]);
    }
    this.at(move(c[0], c[1], c[2]), () => this.lathe(profile, segs));
  }

  /** A pipe through a path of points. Corners are mitred, the way a formed line bends. */
  tube(path: readonly V3[], r: number, sides = 6): void {
    if (path.length < 2 || (this.least > 0 && r * 12 < this.least)) return;
    const dirs = path.slice(1).map((p, i) => unit(sub(p, path[i]!)));
    let side = unit(cross(dirs[0]!, Math.abs(dirs[0]![1]) > 0.9 ? [0, 0, 1] : [0, 1, 0]));
    const rings: Array<{ p: V3; a: V3; b: V3 }> = [];
    for (let i = 0; i < path.length; i++) {
      const t = unit(i === 0 ? dirs[0]! : i === path.length - 1 ? dirs[dirs.length - 1]! : [dirs[i - 1]![0] + dirs[i]![0], dirs[i - 1]![1] + dirs[i]![1], dirs[i - 1]![2] + dirs[i]![2]]);
      side = unit(sub(side, [t[0] * dot(side, t), t[1] * dot(side, t), t[2] * dot(side, t)]));
      rings.push({ p: path[i]!, a: side, b: cross(t, side) });
    }
    for (let i = 0; i + 1 < rings.length; i++) {
      const A = rings[i]!;
      const B = rings[i + 1]!;
      for (let j = 0; j < sides; j++) {
        const t0 = (j / sides) * Math.PI * 2, t1 = ((j + 1) / sides) * Math.PI * 2;
        const on = (R: typeof A, t: number): V3 => {
          const n: V3 = [R.a[0] * Math.cos(t) + R.b[0] * Math.sin(t), R.a[1] * Math.cos(t) + R.b[1] * Math.sin(t), R.a[2] * Math.cos(t) + R.b[2] * Math.sin(t)];
          return n;
        };
        const n0 = on(A, t0), n1 = on(A, t1), n2 = on(B, t1), n3 = on(B, t0);
        const p = (R: typeof A, n: V3): V3 => [R.p[0] + n[0] * r, R.p[1] + n[1] * r, R.p[2] + n[2] * r];
        this.poly([p(A, n0), p(A, n1), p(B, n2), p(B, n3)], [n0, n1, n2, n3]);
      }
    }
  }

  /** A thin square member with no ends. Struts are mostly seen as lines, so they earn eight triangles and no more. */
  beam(a: V3, b: V3, w: number): void {
    if (Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) < this.least * 2.5) return;
    const d = unit(sub(b, a));
    const s = unit(cross(d, Math.abs(d[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0]));
    const t = cross(d, s);
    const off = (x: number, y: number): V3 => [(s[0] * x + t[0] * y) * w, (s[1] * x + t[1] * y) * w, (s[2] * x + t[2] * y) * w];
    const q = [[1, 1], [-1, 1], [-1, -1], [1, -1]] as const;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const o0 = off(q[i]![0], q[i]![1]), o1 = off(q[j]![0], q[j]![1]);
      const n = unit([o0[0] + o1[0], o0[1] + o1[1], o0[2] + o1[2]]);
      this.poly([[a[0] + o0[0], a[1] + o0[1], a[2] + o0[2]], [a[0] + o1[0], a[1] + o1[1], a[2] + o1[2]], [b[0] + o1[0], b[1] + o1[1], b[2] + o1[2]], [b[0] + o0[0], b[1] + o0[1], b[2] + o0[2]]], n);
    }
  }

  /** An open truss. On the far level it is one member of the same reach, so a spine never vanishes. */
  truss(a: V3, b: V3, r: number, bays: number, sides = 3, member = r * 0.09): void {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    this.at(along(a, b), () => {
      if (this.least > 0) { this.beam([0, 0, 0], [len, 0, 0], r * 0.5); return; }
      if (!this.detail) {
        for (let k = 0; k < sides; k++) {
          const t = ((k + 0.5) / sides) * Math.PI * 2;
          const y = Math.cos(t) * r, z = Math.sin(t) * r;
          this.beam([0, y, z], [len, y, z], Math.max(member, r * 0.16));
        }
        return;
      }
      const on = (x: number, k: number): V3 => {
        const t = ((k + 0.5) / sides) * Math.PI * 2;
        return [x, Math.cos(t) * r, Math.sin(t) * r];
      };
      for (let k = 0; k < sides; k++) this.beam(on(0, k), on(len, k), member);
      for (let i = 0; i <= bays; i++) {
        const x = (i / bays) * len;
        for (let k = 0; k < sides; k++) {
          this.beam(on(x, k), on(x, k + 1), member * 0.8);
          if (i < bays) this.beam(on(x, i % 2 ? k : k + 1), on(x + len / bays, i % 2 ? k + 1 : k), member * 0.6);
        }
      }
    });
  }

  /** A quad a hair above a surface, for windows and paint. */
  decal(c: V3, n: V3, u: V3, w: number, h: number): void {
    const v = cross(n, u);
    const q = (x: number, y: number): V3 => [
      c[0] + u[0] * x + v[0] * y + n[0] * 0.015, c[1] + u[1] * x + v[1] * y + n[1] * 0.015, c[2] + u[2] * x + v[2] * y + n[2] * 0.015,
    ];
    this.poly([q(-w / 2, -h / 2), q(w / 2, -h / 2), q(w / 2, h / 2), q(-w / 2, h / 2)], n);
  }

  /** Four small nozzles in a cross on a block: what steers anything real in vacuum. */
  rcs(c: V3, n: V3, size: number): void {
    const f = this;
    if (f.least > 0) return;
    const save = f.mat;
    f.at(along(c, [c[0] + n[0], c[1] + n[1], c[2] + n[2]]), () => {
      f.use(MAT.METAL, 1).box([size * 0.5, 0, 0], [size, size * 1.5, size * 1.5]);
      if (!f.detail) return;
      f.use(MAT.GRAPHITE, 1);
      const r = size * 0.22;
      f.cyl([size * 0.9, size * 0.42, 0], [size * 1.25, size * 0.42, 0], r * 0.6, r, 8, [false, false]);
      f.cyl([size * 0.9, -size * 0.42, 0], [size * 1.25, -size * 0.42, 0], r * 0.6, r, 8, [false, false]);
      f.cyl([size * 0.5, size * 0.75, size * 0.35], [size * 0.5, size * 1.05, size * 0.35], r * 0.5, r * 0.85, 8, [false, false]);
      f.cyl([size * 0.5, -size * 0.75, size * 0.35], [size * 0.5, -size * 1.05, size * 0.35], r * 0.5, r * 0.85, 8, [false, false]);
    });
    f.mat = save;
  }

  /**
   * Bell nozzle along -x, mounted on a plate at the origin. The throat stands off that plate, because the inside runs on past the throat and
   * closes at the axis, so what you look into is a hollow with a floor. It is walked from that floor outward, so distance along the surface is
   * depth, and the shader burns hottest at the start.
   */
  bell(r: number, length: number, segs = 28): void {
    this.at(move(-r * 0.42), () => this.nozzleBody(r, length, segs));
  }

  private nozzleBody(r: number, length: number, segs: number): void {
    const f = this;
    const shape = (t: number): number => r * (0.36 + 0.64 * Math.pow(t, 0.58));
    const steps = f.detail ? 10 : 3;
    const wall: Array<[number, number]> = [];
    for (let i = 0; i <= steps; i++) wall.push([-length * (i / steps), shape(i / steps)]);
    const save = f.mat;
    const panel = f.panel;
    if (f.least === 0) {
      f.use(MAT.GRAPHITE, 0.6).lathe([...wall].reverse().map(([x, q]) => [x, q * 1.035] as const), segs);
      f.use(MAT.METAL, 0.6).lathe([[-length * 1.02, r * 1.07], [-length * 1.02, r * 0.97]], segs);
      f.lathe([[-length * 1.02 + r * 0.06, r * 1.035], [-length * 1.02, r * 1.07]], segs);
    }
    f.use(MAT.THROAT, r).lathe([[r * 0.34, 0], [r * 0.2, r * 0.16], [r * 0.06, r * 0.3], ...wall], segs);
    if (f.detail) {
      // Stiffening bands on the bell, and the gimbal block over the throat.
      f.use(MAT.METAL, 1);
      for (const t of [0.3, 0.56, 0.8]) {
        const x = -length * t;
        const q = shape(t) * 1.045;
        f.lathe([[x - 0.035 * length, q], [x - 0.035 * length, q * 1.02], [x + 0.035 * length, q * 1.02], [x + 0.035 * length, q]], segs);
      }
    }
    f.use(MAT.METAL, 1).cyl([0.5 * r, 0, 0], [0.02 * r, 0, 0], r * 0.6, r * 0.42, 16, [false, false]);
    f.mat = save;
    f.panel = panel;
    f.nozzle([-length, 0, 0], [-1, 0, 0], r);
  }

  build(): Mesh {
    const position = new Float32Array(this.pos);
    const normal = new Int16Array(this.nor.length);
    for (let i = 0; i < this.nor.length; i++) normal[i] = Math.round(this.nor[i]! * 32767);
    let min: V3 = [Infinity, Infinity, Infinity];
    let max: V3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < position.length; i += 3) {
      min = [Math.min(min[0], position[i]!), Math.min(min[1], position[i + 1]!), Math.min(min[2], position[i + 2]!)];
      max = [Math.max(max[0], position[i]!), Math.max(max[1], position[i + 1]!), Math.max(max[2], position[i + 2]!)];
    }
    return {
      position, normal, uv: new Float32Array(this.tex), meta: new Uint8Array(this.met), edge: new Float32Array(this.edg), index: new Uint32Array(this.idx),
      triangles: this.idx.length / 3, min, max,
    };
  }
}

/** Segments for a circle of this many pixels radius, so no chord stands off it by more than `CHORD_PX`. */
export function roundSegments(radiusPx: number): number {
  if (radiusPx <= CHORD_PX) return 6;
  return Math.max(6, Math.ceil(Math.PI / Math.acos(1 - CHORD_PX / radiusPx)));
}

function determinant(m: M): number {
  return m[0]! * (m[4]! * m[8]! - m[7]! * m[5]!) - m[3]! * (m[1]! * m[8]! - m[7]! * m[2]!) + m[6]! * (m[1]! * m[5]! - m[4]! * m[2]!);
}
