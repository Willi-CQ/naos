// One tiling 3D gradient noise, value and analytic gradient in one texel. A bake runs ten octaves per pixel, so the point is that an octave
// costs one texture read, and that the HLSL compiler sees no noise maths to unroll. Pure, so the tests can read it.
export const VOLUME_SIZE = 64;
/** Lattice cells across the tile. The texture holds 4 texels per cell. */
export const VOLUME_PERIOD = 16;
/** GLSL multiplies the stored gradient by this. It keeps almost all gradients inside 8 bits. */
export const GRADIENT_RANGE = 3.2;
/** Stored value is noise times this, so a typical octave uses the whole of -1..1. */
const VALUE_GAIN = 1.7;

const GRADIENTS: readonly (readonly [number, number, number])[] = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1], [1, 1, 0], [-1, 1, 0], [0, -1, 1], [0, -1, -1],
];

function permutation(salt: number): Uint8Array {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = salt >>> 0;
  for (let i = 255; i > 0; i--) {
    s = (Math.imul(s ^ (s >>> 15), 2246822519) + 3266489917) | 0;
    const j = (s >>> 0) % (i + 1);
    const t = p[i]!;
    p[i] = p[j]!;
    p[j] = t;
  }
  return p;
}

const PERM = permutation(0x4e414f53);

function gradientAt(x: number, y: number, z: number, period: number): readonly [number, number, number] {
  const wrap = (n: number) => ((n % period) + period) % period;
  const h = PERM[(PERM[(PERM[wrap(x)]! + wrap(y)) & 255]! + wrap(z)) & 255]! & 15;
  return GRADIENTS[h]!;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const fadeD = (t: number) => 30 * t * t * (t * (t - 2) + 1);

/** Perlin noise with its analytic gradient, periodic in all three axes. Out: value, d/dx, d/dy, d/dz. */
export function gradientNoise(x: number, y: number, z: number, period: number, out: Float64Array): void {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fy = y - yi;
  const fz = z - zi;
  const u = fade(fx);
  const v = fade(fy);
  const w = fade(fz);
  const du = fadeD(fx);
  const dv = fadeD(fy);
  const dw = fadeD(fz);
  const g = (i: number, j: number, k: number) => gradientAt(xi + i, yi + j, zi + k, period);
  const dot = (c: readonly [number, number, number], dx: number, dy: number, dz: number) => c[0] * dx + c[1] * dy + c[2] * dz;
  const g000 = g(0, 0, 0); const g100 = g(1, 0, 0); const g010 = g(0, 1, 0); const g110 = g(1, 1, 0);
  const g001 = g(0, 0, 1); const g101 = g(1, 0, 1); const g011 = g(0, 1, 1); const g111 = g(1, 1, 1);
  const a = dot(g000, fx, fy, fz); const b = dot(g100, fx - 1, fy, fz);
  const c = dot(g010, fx, fy - 1, fz); const d = dot(g110, fx - 1, fy - 1, fz);
  const e = dot(g001, fx, fy, fz - 1); const f = dot(g101, fx - 1, fy, fz - 1);
  const h = dot(g011, fx, fy - 1, fz - 1); const i = dot(g111, fx - 1, fy - 1, fz - 1);
  const k1 = b - a; const k2 = c - a; const k3 = e - a; const k4 = a - b - c + d;
  const k5 = a - c - e + h; const k6 = a - b - e + f; const k7 = -a + b + c - d + e - f - h + i;
  out[0] = a + u * k1 + v * k2 + w * k3 + u * v * k4 + v * w * k5 + w * u * k6 + u * v * w * k7;
  const axisGradient = (axis: 0 | 1 | 2) => {
    const lx = (p: number, q: number) => p + u * (q - p);
    const ly = (p: number, q: number) => p + v * (q - p);
    const near = ly(lx(g000[axis], g100[axis]), lx(g010[axis], g110[axis]));
    const far = ly(lx(g001[axis], g101[axis]), lx(g011[axis], g111[axis]));
    return near + w * (far - near);
  };
  out[1] = axisGradient(0) + du * (k1 + v * k4 + w * k6 + v * w * k7);
  out[2] = axisGradient(1) + dv * (k2 + u * k4 + w * k5 + u * w * k7);
  out[3] = axisGradient(2) + dw * (k3 + v * k5 + u * k6 + u * v * k7);
}

/** RGBA8: gradient in RGB, value in A, both around 0.5. */
export function buildNoiseVolume(size = VOLUME_SIZE, period = VOLUME_PERIOD): Uint8Array {
  const data = new Uint8Array(size * size * size * 4);
  const n = new Float64Array(4);
  const cells = period / size;
  const byte = (v: number) => Math.round(Math.min(1, Math.max(0, v * 0.5 + 0.5)) * 255);
  let at = 0;
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        gradientNoise(x * cells, y * cells, z * cells, period, n);
        data[at++] = byte((n[1]! * VALUE_GAIN) / GRADIENT_RANGE);
        data[at++] = byte((n[2]! * VALUE_GAIN) / GRADIENT_RANGE);
        data[at++] = byte((n[3]! * VALUE_GAIN) / GRADIENT_RANGE);
        data[at++] = byte(n[0]! * VALUE_GAIN);
      }
    }
  }
  return data;
}
