// The structure of the disk, baked once: a polar tile of real filaments, drawn as long strokes along the orbit. Noise stretched in
// one axis looks like noise. Strokes that start and end look like gas. x is azimuth, y is log radius, and both wrap.

export const STREAK_W = 1024;
export const STREAK_H = 512;
/** Mean of each channel of the bake, 0 to 1. Layers of the map blend around this, so that their mix keeps the contrast of one layer. */
export const STREAK_MEAN = [0.3057, 0.3327, 0.3835, 0.1039] as const;

function rng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Strokes { count: number; length: [number, number]; width: [number, number]; drift: number; shear: number; seed: number }

/** Adds strokes to one buffer of w x h. A stroke is thin, tapers at both ends, and wanders a little in radius. */
function strokes(buf: Float32Array, w: number, h: number, s: Strokes): void {
  const rand = rng(s.seed);
  for (let n = 0; n < s.count; n++) {
    const x0 = rand() * w;
    const y0 = rand() * h;
    const half = s.length[0] + (s.length[1] - s.length[0]) * rand() * rand();
    const wide = s.width[0] + (s.width[1] - s.width[0]) * rand() * rand();
    const amp = 0.35 + 0.65 * rand();
    // Everything leans the same way, as gas does in a shear, so lanes read as a tight spiral and not as circles.
    const lean = half * s.shear * (0.5 + rand()) + (rand() - 0.5) * s.drift;
    const wob = (rand() - 0.5) * s.drift * 0.7;
    const f = 1 + rand() * 3;
    const reach = Math.ceil(wide * 2.4);
    const i0 = Math.floor(-half);
    const i1 = Math.ceil(half);
    for (let i = i0; i <= i1; i++) {
      const t = i / half;
      const c = Math.cos(t * 1.5707963);
      const env = c * c * amp;
      const yc = y0 + lean * t + wob * Math.sin(t * f * 3.14159);
      const yi = Math.round(yc);
      const col = (((Math.round(x0) + i) % w) + w) % w;
      for (let d = -reach; d <= reach; d++) {
        const dy = (yi + d - yc) / wide;
        const row = (((yi + d) % h) + h) % h;
        buf[row * w + col] = buf[row * w + col]! + env * Math.exp(-0.5 * dy * dy);
      }
    }
  }
}

/** Bilinear lookup with wrap, for the coarse layers. */
function sampler(buf: Float32Array, w: number, h: number) {
  return (u: number, v: number): number => {
    const x = u * w - 0.5;
    const y = v * h - 0.5;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const at = (i: number, j: number) => buf[((j + h) % h) * w + ((i + w) % w)]!;
    const a = at(xi, yi) * (1 - fx) + at(xi + 1, yi) * fx;
    const b = at(xi, yi + 1) * (1 - fx) + at(xi + 1, yi + 1) * fx;
    return a * (1 - fy) + b * fy;
  };
}

const norm = (buf: Float32Array): number => {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i]!;
  return sum / buf.length;
};

export function bakeStreaks(): Uint8Array {
  const W = STREAK_W;
  const H = STREAK_H;
  const fine = new Float32Array(W * H);
  strokes(fine, W, H, { count: 2600, length: [60, 420], width: [0.7, 2.2], drift: 9, shear: 0.07, seed: 11 });

  // Coarse layers need no fine grid. They are upsampled below.
  const mw = W >> 1;
  const mh = H >> 1;
  const lanes = new Float32Array(mw * mh);
  strokes(lanes, mw, mh, { count: 760, length: [50, 380], width: [1, 4.5], drift: 7, shear: 0.07, seed: 23 });
  const bw = W >> 3;
  const bh = H >> 3;
  const bands = new Float32Array(bw * bh);
  strokes(bands, bw, bh, { count: 240, length: [8, 46], width: [1.2, 7], drift: 4, shear: 0.07, seed: 37 });
  const knots = new Float32Array(mw * mh);
  strokes(knots, mw, mh, { count: 340, length: [6, 44], width: [0.8, 2.6], drift: 2, shear: 0.07, seed: 51 });

  const lanesAt = sampler(lanes, mw, mh);
  const bandsAt = sampler(bands, bw, bh);
  const knotsAt = sampler(knots, mw, mh);
  const kFine = 1 / (norm(fine) * 2.6);
  const kLanes = 1 / (norm(lanes) * 2.4);
  const kBands = 1 / (norm(bands) * 2);
  const kKnots = 1 / (norm(knots) * 7);
  const curve = (x: number) => Math.round(255 * (1 - Math.exp(-x)));
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const at = (y * W + x) * 4;
      const u = (x + 0.5) / W;
      const v = (y + 0.5) / H;
      out[at] = curve(fine[y * W + x]! * kFine);
      out[at + 1] = curve(lanesAt(u, v) * kLanes);
      out[at + 2] = curve(bandsAt(u, v) * kBands);
      out[at + 3] = curve(knotsAt(u, v) * kKnots);
    }
  }
  return out;
}
