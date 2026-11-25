// Everything about a planet that is cheaper to decide on the CPU: band layouts, ring profiles, storms and craters. Pure and seeded, so the
// tests can hold it to the genome and a planet stays the same across a reload.
import type { Hex, PlanetGenome } from '@naos/protocol';

export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export type Rgb = readonly [number, number, number];

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

/** `#rrggbb` to linear light. */
export function linearOf(hex: Hex): Rgb {
  return [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255)) as unknown as Rgb;
}

/** A direction on the unit sphere from two numbers in 0..1, uniform over the area. */
export function sphereDir(u: number, v: number): Rgb {
  const y = 1 - 2 * u;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const a = v * Math.PI * 2;
  return [r * Math.cos(a), y, r * Math.sin(a)];
}

/** Zones and belts as one texture: colour in RGB, and in A the zonal wind of that band. */
export const BAND_LUT_SIZE = 512;

export interface BandLayout {
  /** Band edges in sine of latitude, from -1 to 1. */
  edges: number[];
  /** Wind of each band, -1 to 1. One number per band and no gradient inside it: see planet.frag, deck(). */
  winds: number[];
}

/** Edges irregular, so no two giants share a layout. Winds alternate from band to band, as real jets do, with a stronger one on the equator. */
export function bandLayout(g: PlanetGenome): BandLayout {
  const rnd = mulberry(g.seed ^ 0x5bd1e995);
  const bandCount = Math.round(g.bands.count) * 2;
  const edges: number[] = [-1];
  for (let i = 1; i < bandCount; i++) edges.push(-1 + (2 * (i + (rnd() - 0.5) * 0.62)) / bandCount);
  edges.push(1);
  const blow = mulberry(g.seed ^ 0x3c6ef372);
  const winds = Array.from({ length: bandCount }, (_, i) => {
    const centre = (edges[i]! + edges[i + 1]!) / 2;
    const jet = (i % 2 === 0 ? 1 : -0.7) * (0.55 + 0.45 * blow());
    return clamp(jet * (1 - smooth(0.7, 0.92, Math.abs(centre))) + 0.5 * Math.exp(-centre * centre * 30), -1, 1);
  });
  return { edges, winds };
}

const bandAt = (edges: readonly number[], y: number): number => {
  let i = 0;
  while (i < edges.length - 2 && y > edges[i + 1]!) i++;
  return i;
};

/** Oval storms are wider than tall. This is how far one reaches in sine of latitude, for its radius. */
const stormHeight = (radius: number): number => (radius / 1.55) * 1.15;

/** A storm rides one wind. Where a large one spans several bands, they all take its band's wind, or the slide would tear it in two. */
function windsUnderStorms(g: PlanetGenome, layout: BandLayout): number[] {
  const winds = [...layout.winds];
  const storms = buildStorms(g);
  for (let k = 0; k < storms.count; k++) {
    const y = storms.place[k * 4 + 1]!;
    const reach = stormHeight(storms.place[k * 4 + 3]!);
    const own = winds[bandAt(layout.edges, y)]!;
    const lo = bandAt(layout.edges, y - reach);
    const hi = bandAt(layout.edges, y + reach);
    for (let i = lo; i <= hi; i++) winds[i] = own;
  }
  return winds;
}

export function buildBandLut(g: PlanetGenome): Uint8Array {
  const low = linearOf(g.palette.low);
  const mid = linearOf(g.palette.mid);
  const high = linearOf(g.palette.high);
  const pole = linearOf(g.palette.pole);
  const accent = linearOf(g.palette.accent);

  const layout = bandLayout(g);
  const { edges } = layout;
  const winds = windsUnderStorms(g, layout);
  const bandCount = edges.length - 1;
  const rnd = mulberry(g.seed ^ 0x1b873593);

  const tone: number[] = [];
  const tint: number[] = [];
  for (let i = 0; i < bandCount; i++) {
    const belt = i % 2 === 1;
    tone.push(belt ? 0.02 + rnd() * 0.3 : 0.62 + rnd() * 0.38);
    tint.push(rnd() < 0.2 ? 0.25 + rnd() * 0.3 : 0);
  }

  const size = BAND_LUT_SIZE;
  const data = new Uint8Array(size * 4);
  const contrast = g.bands.contrast;
  for (let x = 0; x < size; x++) {
    const s = -1 + (2 * (x + 0.5)) / size;
    let i = 0;
    while (i < bandCount - 1 && s > edges[i + 1]!) i++;
    const a = edges[i]!;
    const b = edges[i + 1]!;
    const t = (s - a) / (b - a);
    // Sharp on the band edges, a little fine banding inside, as a stack of thin jets would be.
    const edge = 0.14 * (bandCount / 12) + 0.04;
    const next = Math.min(bandCount - 1, i + 1);
    const prev = Math.max(0, i - 1);
    const k = t > 0.5 ? smooth(1 - edge, 1, t) * 0.5 : smooth(edge, 0, t) * 0.5;
    let v = mix(tone[i]!, tone[t > 0.5 ? next : prev]!, k);
    const hue = mix(tint[i]!, tint[t > 0.5 ? next : prev]!, k);
    v += Math.sin(s * 170 + i * 2.1) * 0.012 + Math.sin(s * 71 + i) * 0.03;
    // A thin dark lane where a belt meets a zone, the sharpest line on a real giant.
    if (i % 2 === 1) v -= 0.3 * (Math.exp(-(((t - 0.04) / 0.07) ** 2)) + Math.exp(-(((t - 0.96) / 0.07) ** 2)));
    v = 0.5 + (v - 0.5) * (0.28 + 0.9 * contrast);
    const lo = v < 0.5 ? low : mid;
    const hi = v < 0.5 ? mid : high;
    const local = v < 0.5 ? v * 2 : v * 2 - 1;
    const polar = smooth(0.72, 0.98, Math.abs(s));
    for (let c = 0; c < 3; c++) {
      let value = mix(lo[c]!, hi[c]!, clamp(local, 0, 1));
      value = mix(value, accent[c]!, hue * 0.5);
      value = mix(value, pole[c]!, polar * 0.8);
      data[x * 4 + c] = Math.round(clamp(toSrgb(value), 0, 1) * 255);
    }
    data[x * 4 + 3] = Math.round(clamp(0.5 + 0.5 * winds[i]!, 0, 1) * 255);
  }
  return data;
}

/** Optical depth stored in 8 bits runs up to this. */
export const RING_TAU_MAX = 3;
export const RING_LUT_SIZE = 1024;

/** Colour in RGB, optical depth in A, from the inner edge to the outer one. */
export function buildRingLut(g: PlanetGenome): Uint8Array {
  const data = new Uint8Array(RING_LUT_SIZE * 4);
  if (!g.rings) return data;
  const { color, density, gaps } = g.rings;
  const rnd = mulberry(g.seed ^ 0x2f0b4a87);
  const c = linearOf(color);
  const n = RING_LUT_SIZE;

  // Several sine stacks and one random walk make the ringlets. A few hard gaps sit on top, resonances in a real system.
  const phases = Array.from({ length: 7 }, () => rnd() * Math.PI * 2);
  const freqs = [9, 23, 61, 137, 271, 547, 1021].map((f) => f * (0.8 + rnd() * 0.4));
  const walk = new Float64Array(n);
  let w = 0;
  for (let i = 0; i < n; i++) { w = w * 0.985 + (rnd() - 0.5) * 0.11; walk[i] = w; }

  const gapCount = Math.round(1 + gaps * 6);
  const gapList = Array.from({ length: gapCount }, (_, i) => {
    // The first is the big division, about two thirds out.
    const at = i === 0 ? 0.56 + rnd() * 0.12 : 0.1 + rnd() * 0.85;
    const width = i === 0 ? 0.018 + 0.03 * gaps : 0.002 + rnd() * rnd() * 0.012;
    const depth = i === 0 ? 0.04 : 0.08 + rnd() * 0.3;
    return { at, width, depth };
  });

  const phase = rnd() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    // A broad profile: a faint inner ring, a dense middle, a soft outer edge.
    let tau = 0.12 + 1.5 * smooth(0.12, 0.3, t) - 0.65 * smooth(0.6, 0.72, t);
    tau *= 1 - smooth(0.965, 1, t) * 0.9;
    tau *= smooth(0, 0.035, t);
    let fine = 0;
    for (let k = 0; k < phases.length; k++) fine += Math.sin(t * freqs[k]! + phases[k]!) * (0.34 / (1 + k * 0.45));
    // In the exponent, because real ring opacity spans two orders of magnitude from ringlet to ringlet.
    tau *= Math.exp((fine + walk[i]! * 2.2) * (0.5 + 1.3 * gaps));
    for (const gap of gapList) tau *= 1 - (1 - gap.depth) * smooth(gap.width, gap.width * 0.45, Math.abs(t - gap.at));
    tau *= 0.08 + 0.72 * density;

    // Inner ring dirtier, outer ice cleaner, the way Saturn's are.
    const dirt = (0.72 + 0.28 * smooth(0.1, 0.5, t) + Math.sin(t * 19 + phase) * 0.05) * (1 + clamp(fine * 0.4, -0.25, 0.25));
    for (let ch = 0; ch < 3; ch++) {
      const warm = ch === 0 ? 1.02 : ch === 2 ? 0.96 : 1;
      data[i * 4 + ch] = Math.round(clamp(toSrgb(c[ch]! * dirt * mix(warm, 1, smooth(0.2, 0.7, t))), 0, 1) * 255);
    }
    data[i * 4 + 3] = Math.round(clamp(tau / RING_TAU_MAX, 0, 1) * 255);
  }
  return data;
}

export const MAX_STORMS = 24;

/** place: unit axis and angular radius. look: spin sign, tone, tint. */
export interface Storms { place: Float32Array; look: Float32Array; count: number }

export function buildStorms(g: PlanetGenome): Storms {
  const rnd = mulberry(g.seed ^ 0x9e3779b9);
  const place = new Float32Array(MAX_STORMS * 4);
  const look = new Float32Array(MAX_STORMS * 4);
  let count = 0;
  const add = (lat: number, lon: number, radius: number, spin: number, tone: number, tint: number) => {
    if (count >= MAX_STORMS) return;
    const y = Math.sin(lat);
    const r = Math.cos(lat);
    place.set([r * Math.cos(lon), y, r * Math.sin(lon), radius], count * 4);
    look.set([spin, tone, tint, 0], count * 4);
    count++;
  };
  const giant = g.archetype === 'gas' || g.archetype === 'ice-giant';
  if (giant) {
    // Real storms sit inside a band and ride its wind, so they are moved clear of the edges.
    const { edges } = bandLayout(g);
    const inBand = (lat: number, radius: number): number => {
      const y = Math.sin(lat);
      const i = bandAt(edges, y);
      const margin = stormHeight(radius);
      const lo = edges[i]! + margin;
      const hi = edges[i + 1]! - margin;
      return Math.asin(lo > hi ? (edges[i]! + edges[i + 1]!) / 2 : clamp(y, lo, hi));
    };
    const oval = (lat: number, lon: number, radius: number, spin: number, tone: number, tint: number) => add(inBand(lat, radius), lon, radius, spin, tone, tint);
    if (g.bands.spot > 0) {
      const lat = (rnd() < 0.5 ? -1 : 1) * (0.25 + rnd() * 0.25);
      add(lat, rnd() * Math.PI * 2, 0.1 + 0.2 * g.bands.spot, lat < 0 ? 1 : -1, 0.5, 1);
    }
    // A string of pearls: small ovals at one latitude, evenly spaced, which is how they sit on Jupiter.
    const strings = Math.round(g.bands.storms * 4);
    for (let s = 0; s < strings; s++) {
      const lat = (rnd() < 0.5 ? -1 : 1) * (0.3 + rnd() * 0.6);
      const n = 3 + Math.floor(rnd() * 5);
      const lon = rnd() * Math.PI * 2;
      const gap = 0.32 + rnd() * 0.06;
      for (let i = 0; i < n; i++) oval(lat + (rnd() - 0.5) * 0.02, lon + (i + rnd() * 0.3) * gap, 0.022 + rnd() * 0.03, lat < 0 ? 1 : -1, 0.9, 0);
    }
    const scattered = Math.round(g.bands.storms * 8);
    for (let i = 0; i < scattered; i++) oval(Math.asin(-1 + 2 * rnd()) * 0.9, rnd() * Math.PI * 2, 0.015 + rnd() * rnd() * 0.05, rnd() < 0.5 ? 1 : -1, rnd(), 0);
    return { place, look, count };
  }
  // Weather: cyclones in the storm tracks near 50 degrees, a few hurricanes near 18. Spin follows the hemisphere.
  const fronts = Math.round(2 + g.clouds.coverage * 6);
  for (let i = 0; i < fronts; i++) {
    const sign = i % 2 === 0 ? 1 : -1;
    add(sign * (0.72 + rnd() * 0.42), rnd() * Math.PI * 2, 0.1 + rnd() * 0.12, sign, 0.5 + rnd() * 0.5, 0);
  }
  const hurricanes = Math.round(g.clouds.storms * 7);
  for (let i = 0; i < hurricanes; i++) {
    const sign = rnd() < 0.5 ? 1 : -1;
    add(sign * (0.2 + rnd() * 0.25), rnd() * Math.PI * 2, 0.045 + rnd() * 0.05, sign, 1, 1);
  }
  return { place, look, count };
}

/** One lit place on the surface: where, how large in radians, how bright, and whether it is an ember from a failed run. */
export interface PlanetCity { x: number; y: number; z: number; size?: number; brightness?: number; ember?: boolean }

export interface PackedCities { point: Float32Array; kind: Float32Array; count: number }

export function packCities(cities: readonly PlanetCity[]): PackedCities {
  const count = cities.length;
  const point = new Float32Array(count * 4);
  const kind = new Float32Array(count * 2);
  cities.forEach((c, i) => {
    const length = Math.hypot(c.x, c.y, c.z) || 1;
    point.set([c.x / length, c.y / length, c.z / length, c.size ?? 0.012], i * 4);
    kind.set([c.ember ? 1 : 0, c.brightness ?? 1], i * 2);
  });
  return { point, kind, count };
}

/**
 * Where a repo's history lands on its planet, one point per entry and always in the same order, so a list that grows keeps its old cities and
 * the bake can stamp only the new tail. Old towns gather round a few hubs and the rest string out along the roads between them. The stamp then
 * moves each one to the nearest coast, so this needs no map.
 */
export function planCities(seed: number, count: number): PlanetCity[] {
  const rnd = mulberry(seed ^ 0x1234567);
  const hubs = Array.from({ length: 26 }, () => sphereDir(rnd() * 0.76 + 0.12, rnd()));
  const roads = hubs.map((a, i) => {
    let best = (i + 1) % hubs.length;
    let near = -2;
    hubs.forEach((b, j) => {
      const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      if (j !== i && d > near) { near = d; best = j; }
    });
    return [a, hubs[best]!] as const;
  });
  return Array.from({ length: count }, (_, i) => {
    const onRoad = rnd() < 0.4;
    const ember = i % 37 === 0;
    if (onRoad) {
      const [a, b] = roads[Math.floor(rnd() * rnd() * roads.length)]!;
      const t = rnd();
      // Towns gather near the ends of a road and thin out half way, and no road is a ruled line.
      const bow = Math.sin(t * Math.PI) * 0.1;
      const jitter = 0.03;
      return {
        x: mix(a[0], b[0], t) + bow * (a[1] - b[2]) + (rnd() - 0.5) * jitter,
        y: mix(a[1], b[1], t) + bow * (a[2] - b[0]) + (rnd() - 0.5) * jitter,
        z: mix(a[2], b[2], t) + bow * (a[0] - b[1]) + (rnd() - 0.5) * jitter,
        size: 0.004 + rnd() * rnd() * 0.01,
        brightness: 0.28 + rnd() * 0.3,
        ember,
      };
    }
    const hub = hubs[Math.floor(rnd() * rnd() * hubs.length)]!;
    const spread = 0.02 + rnd() * rnd() * 0.12;
    return {
      x: hub[0] + (rnd() - 0.5) * spread,
      y: hub[1] + (rnd() - 0.5) * spread,
      z: hub[2] + (rnd() - 0.5) * spread,
      size: 0.005 + rnd() * rnd() * rnd() * 0.03,
      brightness: 0.35 + rnd() * rnd() * 0.65,
      ember,
    };
  });
}

export const MAX_RAY_CRATERS = 10;

/** The few large young impacts with ray systems. xyz: centre, w: angular radius. */
export function buildRayCraters(g: PlanetGenome): { list: Float32Array; count: number } {
  const rnd = mulberry(g.seed ^ 0x51ed270b);
  const list = new Float32Array(MAX_RAY_CRATERS * 4);
  const count = Math.min(MAX_RAY_CRATERS, Math.round(g.terrain.craters * 8));
  for (let i = 0; i < count; i++) {
    const [x, y, z] = sphereDir(rnd(), rnd());
    list.set([x, y, z, 0.012 + rnd() * rnd() * 0.05], i * 4);
  }
  return { list, count };
}

/** Where to cut a roughly normal height distribution so that a share p lies below. Good to a percent, which is all a sea level needs. */
export function normalQuantile(p: number): number {
  const q = clamp(p, 0.001, 0.999);
  const t = Math.sqrt(-2 * Math.log(q < 0.5 ? q : 1 - q));
  const z = t - (2.30753 + 0.27061 * t) / (1 + t * (0.99229 + 0.04481 * t));
  return q < 0.5 ? -z : z;
}

export const MAX_ARCS = 64;
export const ARC_CRACK = 0;
export const ARC_CANYON = 1;
export const ARC_FISSURE = 2;

/**
 * Real fractures are long arcs, not contours of a noise, which always close into loops. Each arc is a piece of a small circle on the sphere.
 * a: pole, then the offset of the circle along it. b: middle of the arc, then the cosine of its half length. c: width, strength, kind, a number of its own.
 */
export interface Arcs { a: Float32Array; b: Float32Array; c: Float32Array; count: number }

const cross = (u: Rgb, v: Rgb): Rgb => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const unit = (v: Rgb): Rgb => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const along = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + b[0] * t, a[1] + b[1] * t, a[2] + b[2] * t];

export function buildArcs(g: PlanetGenome): Arcs {
  const out: Arcs = { a: new Float32Array(MAX_ARCS * 4), b: new Float32Array(MAX_ARCS * 4), c: new Float32Array(MAX_ARCS * 4), count: 0 };
  const rnd = mulberry(g.seed ^ 0x6a09e667);
  const dir = () => sphereDir(rnd(), rnd());
  const put = (pole: Rgb, offset: number, mid: Rgb, half: number, width: number, strength: number, kind: number) => {
    if (out.count >= MAX_ARCS) return;
    const n = out.count++;
    out.a.set([pole[0], pole[1], pole[2], offset], n * 4);
    out.b.set([mid[0], mid[1], mid[2], Math.cos(half)], n * 4);
    out.c.set([width, strength, kind, rnd() * 16], n * 4);
  };
  const onCircle = (pole: Rgb, offset: number, azimuth: number): Rgb => {
    const side = unit(cross(pole, Math.abs(pole[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    const up = cross(pole, side);
    const r = Math.sqrt(Math.max(0, 1 - offset * offset));
    return unit(along(along(along([0, 0, 0], pole, offset), side, r * Math.cos(azimuth)), up, r * Math.sin(azimuth)));
  };
  const add = (pole: Rgb, offset: number, azimuth: number, half: number, width: number, strength: number, kind: number) =>
    put(pole, offset, onCircle(pole, offset, azimuth), half, width, strength, kind);

  const { rifts, fractures, volcanism } = g.terrain;
  if (rifts > 0.01) {
    // One great trough, a shorter one beside it, and side canyons cut in from its walls.
    const pole = dir();
    const offset = (rnd() - 0.5) * 0.5;
    const azimuth = rnd() * Math.PI * 2;
    const half = 0.32 + 1.3 * rifts;
    const width = 0.016 + 0.028 * rifts;
    add(pole, offset, azimuth, half, width, 1, ARC_CANYON);
    add(pole, clamp(offset + (rnd() < 0.5 ? -1 : 1) * width * 2.4, -0.9, 0.9), azimuth + (rnd() - 0.5) * half, half * 0.5, width * 0.62, 0.8, ARC_CANYON);
    const sides = Math.round(3 + 11 * rifts);
    const span = half / Math.max(0.3, Math.sqrt(1 - offset * offset));
    for (let i = 0; i < sides; i++) {
      const point = onCircle(pole, offset, azimuth + (rnd() - 0.5) * 2 * span);
      const tangent = unit(cross(pole, point));
      const outward = cross(tangent, point);
      // Turned a little off the square, so the side canyons do not read as a comb.
      const skew = (rnd() - 0.5) * 0.9;
      const sidePole = unit(along(tangent, outward, Math.sin(skew)));
      const length = width * (1.4 + rnd() * 3);
      const mid = unit(along(point, outward, (rnd() < 0.5 ? 1 : -1) * length * 0.9));
      put(sidePole, sidePole[0] * mid[0] + sidePole[1] * mid[1] + sidePole[2] * mid[2], mid, length, width * (0.22 + rnd() * 0.25), 0.7, ARC_CANYON);
    }
  }
  if (volcanism > 0.01) {
    const n = Math.round(1 + 4 * volcanism);
    for (let i = 0; i < n; i++) add(dir(), (rnd() - 0.5) * 0.9, rnd() * Math.PI * 2, 0.12 + rnd() * 0.42, 0.0016 + rnd() * 0.002, 0.6 + rnd() * 0.4, ARC_FISSURE);
  }
  if (fractures > 0.01) {
    // Two or three families of stress. Within a family arcs run side by side, and the families cross, the oldest under the youngest.
    const families = Array.from({ length: 2 + Math.floor(rnd() * 2) }, dir);
    const fill = (count: number, halfLo: number, halfHi: number, widthLo: number, widthHi: number, strength: number) => {
      for (let i = 0; i < count; i++) {
        const family = families[i % families.length]!;
        const jitter = 0.16;
        const pole = unit([family[0] + (rnd() - 0.5) * jitter, family[1] + (rnd() - 0.5) * jitter, family[2] + (rnd() - 0.5) * jitter]);
        add(pole, (rnd() - 0.5) * 1.5, rnd() * Math.PI * 2, mix(halfLo, halfHi, rnd()), mix(widthLo, widthHi, rnd() * rnd()), strength, ARC_CRACK);
      }
    };
    // Fine ones first, so the great arcs are drawn last and cut across them.
    fill(Math.round(4 + 22 * fractures), 0.18, 0.6, 0.0011, 0.0024, 0.55);
    fill(Math.round(2 + 12 * fractures), 0.5, 1.1, 0.0018, 0.0042, 0.8);
    fill(Math.round(1 + 6 * fractures), 1.0, 1.75, 0.003, 0.0075, 1);
  }
  return out;
}

export const MAX_VENTS = 28;

/** Volcanoes. place: axis and radius of the shield. look: heat 0 to 1, how far its flows run, a number of its own, 1 for a lava lake in the caldera. */
export interface Vents { place: Float32Array; look: Float32Array; count: number }

export function buildVents(g: PlanetGenome): Vents {
  const v = g.terrain.volcanism;
  const out: Vents = { place: new Float32Array(MAX_VENTS * 4), look: new Float32Array(MAX_VENTS * 4), count: 0 };
  if (v <= 0.01) return out;
  const rnd = mulberry(g.seed ^ 0xbb67ae85);
  const n = Math.min(MAX_VENTS, Math.round(4 + 24 * v));
  for (let i = 0; i < n; i++) {
    const [x, y, z] = sphereDir(rnd(), rnd());
    const size = rnd();
    // A few big paterae and many small cones, as a power law gives.
    const radius = i === 0 ? 0.05 + 0.05 * v : i < 3 ? 0.03 + rnd() * 0.03 : 0.007 + size * size * size * 0.028;
    const lake = i < 3 || size > 0.8 ? 1 : 0;
    out.place.set([x, y, z, radius], i * 4);
    out.look.set([0.35 + 0.65 * rnd(), 0.35 + 0.65 * rnd(), rnd() * 16, lake], i * 4);
    out.count++;
  }
  return out;
}
