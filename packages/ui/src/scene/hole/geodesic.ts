// Null geodesics of a Schwarzschild hole, in units of M. A ray stays in the plane through camera, hole and pixel, and its shape
// depends only on the impact parameter b. So one static table of u = 1/r over (b, angle) serves every camera, and a small second
// table says where on that orbit a camera at this distance sits. Moving the camera rebuilds only the small one.
//
// Along an orbit, psi is the angle swept from infinity. With f(u) = 1/b^2 - u^2 + 2u^3, psi(u) = integral du / sqrt(f). The cubic f
// factors, and the substitutions below turn that integral into one with no singularity, even for a ray that winds around the
// photon sphere. That is why this is quadrature and not an ODE: an ODE started near the unstable orbit loses its digits.

export const BC = 3 * Math.sqrt(3);
/** Radius of the photon sphere. */
export const R_PHOTON = 3;
/** The tables answer for cameras farther out than this. */
export const MIN_CAMERA_R = 3.4;

export const ORBIT_ROWS = 1024;
export const ORBIT_COLS = 512;
// Odd, so alpha = pi / 2, where the table has a kink, falls on a texel.
export const CAMERA_TEXELS = 1025;

/** Largest b in the orbit table. Past it a ray cannot reach the disk and weak field series gives its deflection. */
export const B_MAX = 96;
const EPS_MIN = 1e-6;
export const S_MIN = Math.log(EPS_MIN);
export const S_ESC = Math.log((B_MAX - BC) / BC);
const HALF = ORBIT_ROWS / 2;

/** Row of the orbit table, fractional. Captured rays use the lower half, and the two halves never blend across the shadow edge. */
export function rowOf(b: number): number {
  const e = Math.abs(b - BC) / BC;
  const s = Math.max(Math.log(Math.max(e, EPS_MIN)), S_MIN);
  if (b < BC) return (HALF - 1) * (s / S_MIN);
  return HALF + (HALF - 1) * Math.min(1, (s - S_MIN) / (S_ESC - S_MIN));
}

/** Inverse of rowOf at texel centres. */
export function bOfRow(row: number): number {
  if (row < HALF) return Math.max(BC * (1 - Math.exp(S_MIN * (row / (HALF - 1)))), 1e-3);
  return BC * (1 + Math.exp(S_MIN + (S_ESC - S_MIN) * ((row - HALF) / (HALF - 1))));
}

/** Smallest positive root of f, the turning point of a ray with b > BC, and the root above it. */
function escapeRoots(b: number): { ut: number; u3: number; u1: number } {
  const c = 1 / (b * b);
  const w = Math.acos(Math.max(-1, Math.min(1, 1 - 54 * c))) / 3;
  const root = (shift: number) => 1 / 6 + Math.cos(w + shift) / 3;
  return { ut: root((-2 * Math.PI) / 3), u3: root(0), u1: root((2 * Math.PI) / 3) };
}

/** For b < BC, f has one real root u1 and a pair p +- iq. */
function captureRoots(b: number): { u1: number; p: number; q: number } {
  const c = 1 / (b * b);
  const k = c / 2 - 1 / 108;
  const d = Math.sqrt(Math.max(0, (k * k) / 4 - 1 / 46656));
  const t = Math.cbrt(-k / 2 + d) + Math.cbrt(-k / 2 - d);
  const u1 = t + 1 / 6;
  const p = (0.5 - u1) / 2;
  const q = Math.sqrt(Math.max(1e-30, -c / (2 * u1) - p * p));
  return { u1, p, q };
}

const G2 = 1 / (2 * Math.sqrt(3));
// 16 point Gauss-Legendre on 0..1.
const GX: number[] = [];
const GW: number[] = [];
{
  const x = [0.0950125098376374, 0.2816035507792589, 0.4580167776572274, 0.6178762444026438, 0.755404408355003, 0.8656312023878318, 0.9445750230732326, 0.9894009349916499];
  const w = [0.1894506104550685, 0.1826034150449236, 0.1691565193950025, 0.1495959888165767, 0.1246289712555339, 0.0951585116824928, 0.0622535239386479, 0.0271524594117541];
  for (let i = 0; i < 8; i++) {
    GX.push(0.5 - x[i]! / 2, 0.5 + x[i]! / 2);
    GW.push(w[i]! / 2, w[i]! / 2);
  }
}

/** Fills one row with u at evenly spaced fractions of the row's own length, and returns that length. */
function fillRow(b: number, out: Float32Array, at: number, cols: number): number {
  const INTERVALS = 256;
  const q = new Float64Array(INTERVALS + 1);
  if (b >= BC) {
    const { ut, u3, u1 } = escapeRoots(b);
    const d = u3 - ut;
    const xMax = Math.asinh(Math.sqrt(ut / d));
    const g = (x: number) => { const s = Math.sinh(x); return Math.SQRT2 / Math.sqrt(ut - d * s * s - u1); };
    const h = xMax / INTERVALS;
    for (let i = 0; i < INTERVALS; i++) {
      const m = (i + 0.5) * h;
      q[i + 1] = q[i]! + (h / 2) * (g(m - G2 * h) + g(m + G2 * h));
    }
    const length = q[INTERVALS]!;
    for (let j = 0; j < cols; j++) {
      // Column j sits at psi = length * j / (cols - 1), which is length - psi past the turning point.
      const target = length * (1 - j / (cols - 1));
      const x = invert(q, target, h, g, 0);
      const s = Math.sinh(x);
      out[at + j] = Math.max(0, ut - d * s * s);
    }
    return length;
  }
  const { u1, p, q: im } = captureRoots(b);
  const x0 = Math.asinh(-p / im);
  const x1 = Math.asinh((0.5 - p) / im);
  const g = (x: number) => 1 / Math.sqrt(2 * (p + im * Math.sinh(x) - u1));
  const h = (x1 - x0) / INTERVALS;
  for (let i = 0; i < INTERVALS; i++) {
    const m = x0 + (i + 0.5) * h;
    q[i + 1] = q[i]! + (h / 2) * (g(m - G2 * h) + g(m + G2 * h));
  }
  const length = q[INTERVALS]!;
  for (let j = 0; j < cols; j++) {
    const x = invert(q, (length * j) / (cols - 1), h, g, x0);
    out[at + j] = Math.min(0.5, Math.max(0, p + im * Math.sinh(x)));
  }
  return length;
}

/** x with q(x) = target, from the cumulative integral on an even grid. One midpoint step lands within a part in 10^7. */
function invert(q: Float64Array, target: number, h: number, g: (x: number) => number, x0: number): number {
  let lo = 0;
  let hi = q.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (q[mid]! <= target) lo = mid; else hi = mid;
  }
  const xl = x0 + lo * h;
  const rest = target - q[lo]!;
  const first = rest / g(xl);
  return xl + rest / g(xl + first / 2);
}

export interface OrbitTables {
  /** ORBIT_ROWS rows of ORBIT_COLS u values. */
  u: Float32Array;
  /** Length of each row in radians: to the turning point, or to the horizon. */
  length: Float32Array;
}

export function buildOrbitTables(): OrbitTables {
  const u = new Float32Array(ORBIT_ROWS * ORBIT_COLS);
  const length = new Float32Array(ORBIT_ROWS);
  for (let row = 0; row < ORBIT_ROWS; row++) length[row] = fillRow(bOfRow(row), u, row * ORBIT_COLS, ORBIT_COLS);
  return { u, length };
}

/** The impact parameter of a ray leaving a static camera at angle alpha off the hole. */
export const impact = (rc: number, sinAlpha: number): number => (rc * sinAlpha) / Math.sqrt(1 - 2 / rc);

/** Angular radius of the shadow seen from rc, the true one. */
export function shadowAngle(rc: number): number {
  const s = (BC * Math.sqrt(1 - 2 / rc)) / rc;
  return s >= 1 ? Math.PI / 2 : rc > 3 ? Math.asin(s) : Math.PI - Math.asin(s);
}

/** psi from infinity down to the camera along the orbit with this b, on the inward branch. */
export function psiAtCamera(rc: number, b: number): number {
  const u0 = 1 / rc;
  if (b >= BC) {
    const { ut, u3, u1 } = escapeRoots(b);
    const d = u3 - ut;
    const xMax = Math.asinh(Math.sqrt(ut / d));
    const xc = Math.asinh(Math.sqrt(Math.max(0, (ut - u0) / d)));
    const w = xMax - xc;
    let sum = 0;
    for (let i = 0; i < 16; i++) {
      const s = Math.sinh(xc + GX[i]! * w);
      sum += GW[i]! / Math.sqrt(ut - d * s * s - u1);
    }
    return Math.SQRT2 * sum * w;
  }
  const { u1, p, q } = captureRoots(Math.max(b, 1e-4));
  const x0 = Math.asinh(-p / q);
  const x1 = Math.asinh((u0 - p) / q);
  const w = x1 - x0;
  let sum = 0;
  for (let i = 0; i < 16; i++) sum += GW[i]! / Math.sqrt(2 * (p + q * Math.sinh(x0 + GX[i]! * w) - u1));
  return sum * w;
}

/** Fills the camera table: psiAtCamera over alpha, evenly from 0 to pi. Cheap enough for every frame of a flight. */
export function buildCameraTable(rc: number, out: Float32Array = new Float32Array(CAMERA_TEXELS)): Float32Array {
  const r = Math.max(rc, MIN_CAMERA_R);
  const scale = r / Math.sqrt(1 - 2 / r);
  const last = out.length - 1;
  for (let i = 0; i <= last; i++) out[i] = psiAtCamera(r, scale * Math.sin((Math.PI * i) / last));
  return out;
}

/**
 * How much of a body may stand where its straight line of sight puts it, 0 to 1. A body is drawn unbent, and that holds except behind
 * the hole, inside about the Einstein radius of its own distance, where its light really arrives from somewhere else.
 * All in M: `rc` camera to hole, `behind` how far the body lies past the hole along the view, `b` offset from the hole at the hole's
 * distance, `radius` the body's radius at that same distance.
 */
export function lensFade(rc: number, behind: number, b: number, radius: number): number {
  if (behind <= 0) return 1;
  const einstein = Math.sqrt((4 * behind * rc) / (rc + behind));
  // A body that only just passes the plane of the hole must not pop.
  const reach = Math.max(einstein * 1.05, BC * 1.1) * Math.min(1, behind / 6);
  const t = Math.min(1, Math.max(0, (b - radius * 0.5 - reach) / (reach * 0.55 + 1e-6)));
  return t * t * (3 - 2 * t);
}

/** Row length past B_MAX, from the weak field series of the deflection. */
export const lengthFar = (b: number): number => Math.PI / 2 + 2 / b + (15 * Math.PI) / (8 * b * b) + 64 / (3 * b * b * b) + (3465 * Math.PI) / (128 * b * b * b * b);

export const clampCameraR = (rc: number): number => Math.max(rc, MIN_CAMERA_R);

/** Row length for any b, from the table. */
export function rowLength(t: OrbitTables, b: number): number {
  if (b >= B_MAX) return lengthFar(b);
  const row = rowOf(b);
  const side = b < BC ? [0, HALF - 1] : [HALF, ORBIT_ROWS - 1];
  const i = Math.min(side[1]! - 1, Math.max(side[0]!, Math.floor(row)));
  const f = Math.min(1, Math.max(0, row - i));
  return t.length[i]! * (1 - f) + t.length[i + 1]! * f;
}

/** u at psi along the orbit with this b, as the shader reads it: bilinear in the table, folded at the turning point. */
export function orbitU(t: OrbitTables, b: number, psi: number): number {
  const len = rowLength(t, b);
  const folded = b >= BC ? len - Math.abs(psi - len) : Math.abs(psi);
  const c = Math.min(1, Math.max(0, folded / len)) * (ORBIT_COLS - 1);
  const row = rowOf(b);
  const side = b < BC ? [0, HALF - 1] : [HALF, ORBIT_ROWS - 1];
  const i = Math.min(side[1]! - 1, Math.max(side[0]!, Math.floor(row)));
  const f = Math.min(1, Math.max(0, row - i));
  const j = Math.min(ORBIT_COLS - 2, Math.floor(c));
  const g = c - j;
  const at = (r: number, k: number) => t.u[r * ORBIT_COLS + k]!;
  const a = at(i, j) * (1 - g) + at(i, j + 1) * g;
  const d = at(i + 1, j) * (1 - g) + at(i + 1, j + 1) * g;
  return a * (1 - f) + d * f;
}

export interface Trace {
  /** Sweep available to this ray before it escapes or falls in. */
  sweep: number;
  captured: boolean;
  start: number;
  b: number;
}

/** Where a ray from a camera at rc, leaving at alpha off the hole, starts on its orbit. The same branch logic as hole-lens.glsl. */
export function traceStart(t: OrbitTables, camera: Float32Array, rc: number, alpha: number): Trace {
  const b = impact(rc, Math.sin(alpha));
  const i = (alpha / Math.PI) * (camera.length - 1);
  const k = Math.min(camera.length - 2, Math.floor(i));
  const psi0 = camera[k]! * (1 - (i - k)) + camera[k + 1]! * (i - k);
  const inward = alpha < Math.PI / 2;
  const len = rowLength(t, b);
  if (b >= BC) {
    const end = 2 * len;
    const start = inward ? psi0 : end - psi0;
    return { sweep: end - start, captured: false, start, b };
  }
  if (inward) return { sweep: len - psi0, captured: true, start: psi0, b };
  return { sweep: psi0, captured: false, start: -psi0, b };
}
