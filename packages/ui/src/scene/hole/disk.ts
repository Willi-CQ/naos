// What the laws do to the disk, INTERSTELLAR ruling 20. Pure numbers, so that the quota curve and the heat map can be tested in Node.

export const R_IN = 3.5;
/** The last trace of gas. Its light ends near 18 M, the DISK_OUTER of core/space.ts, and worlds start past this. */
export const R_OUT = 24;
/** The gas turns toward negative azimuth, seen in the hole frame. Doppler, the streak map and flares all follow this one sign. */
export const ROTATION = -1;
export const MAX_ARCS = 16;
export const MAX_FLARES = 8;
export const HEAT_W = 512;
export const HEAT_H = 24;

export interface Arc { azimuth: number; strength: number }
/** Age in seconds, a flare lives FLARE_LIFE. `clock` is the disk clock at its birth, because a flare rides the gas and the gas runs on that clock. */
export interface Flare { azimuth: number; strength: number; age: number; clock: number }

export const FLARE_LIFE = 5;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface DiskLaw {
  rIn: number;
  energy: number;
  /** 1 is the full disk, white gold where it is bright. Near 0.5 only ember is left, with a little gold at the inner edge. */
  temp: number;
  ring: number;
}

/** Full: hot and wide. Draining: it cools and thins from the inside. Empty: only the photon ring. */
export function diskLaw(quota: number): DiskLaw {
  const q = Math.min(1, Math.max(0, quota));
  const gone = smooth(0, 0.07, q);
  return {
    // Slow near full, so the poster lives through most of a window and does not end at the first few percent.
    rIn: R_IN + Math.pow(1 - q, 1.7) * 9.5,
    energy: gone * (0.05 + 0.95 * Math.pow(q, 1.4)),
    temp: 0.42 + 0.58 * Math.pow(q, 0.7),
    ring: 1.5 + 0.6 * q,
  };
}

/**
 * What the camera does to the disk's light. It stops down as it moves in, only far enough to keep a hot-to-dark range in the frame.
 * From above, the long bright band is gone from the frame and it opens up again. `view` is the sine of the camera's elevation over the disk.
 */
export function holeExposure(rc: number, view = 0): number {
  const near = Math.max(0.24, Math.min(1, Math.pow(rc / 45, 0.85)));
  return near * (1 + 0.75 * smooth(0.12, 0.85, Math.abs(view)));
}

/** Planets are lit by the disk: warm, soft, and dimmer with the quota. Linear RGB per unit of world brightness. */
export function diskLight(quota: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const { energy, temp } = diskLaw(quota);
  const warm = Math.min(1, Math.max(0, (temp - 0.42) / 0.58));
  out[0] = energy;
  out[1] = energy * (0.42 + 0.42 * warm);
  out[2] = energy * (0.12 + 0.5 * warm);
  return out;
}

/** Rotation clock in radians at r = 6. A small base rate, so the disk never freezes while the window shows, plus fleet tokens, 0 to 1. */
export const advanceClock = (clock: number, dtSeconds: number, flow: number): number => clock + dtSeconds * (0.07 + 0.5 * Math.min(1, Math.max(0, flow)));

/** Angular speed at r against the speed at r = 6. */
export const kepler = (r: number): number => Math.pow(6 / r, 1.5);

const ARC_WIDTH = 0.26;
const profile = new Float32Array(HEAT_W);
const flareRow = new Float32Array(HEAT_W);

/**
 * Paints the polar heat map: two bytes a texel, rows from rIn to R_OUT. Arcs sit still at their world's azimuth, because a world does
 * not orbit in a window's time. A flare starts as a knot near the inner edge and rides the gas, so the same clock that turns the disk
 * tears it along the orbit. Returns false when the map came out empty, so that a quiet disk uploads nothing. Fast enough for every
 * frame of a burning flare.
 */
export function paintHeat(out: Uint8Array, arcs: readonly Arc[], flares: readonly Flare[], rIn: number, clock: number, rotation = ROTATION): boolean {
  let any = false;
  const n = Math.min(arcs.length, MAX_ARCS);
  const m = Math.min(flares.length, MAX_FLARES);
  profile.fill(0);
  const reach = Math.ceil((ARC_WIDTH * 2.6 * HEAT_W) / (2 * Math.PI));
  for (let k = 0; k < n; k++) {
    const arc = arcs[k]!;
    const centre = (((arc.azimuth / (2 * Math.PI)) % 1) + 1) % 1 * HEAT_W - 0.5;
    const c = Math.round(centre);
    for (let i = c - reach; i <= c + reach; i++) {
      const d = ((i - centre) * 2 * Math.PI) / HEAT_W / ARC_WIDTH;
      profile[((i % HEAT_W) + HEAT_W) % HEAT_W]! += arc.strength * Math.exp(-d * d);
    }
  }
  for (let j = 0; j < HEAT_H; j++) {
    const x = (j + 0.5) / HEAT_H;
    const r = rIn * Math.pow(R_OUT / rIn, x);
    const arcBand = Math.exp(-(((x - 0.45) / 0.27) ** 2));
    flareRow.fill(0);
    let lit = false;
    for (let k = 0; k < m; k++) {
      const flare = flares[k]!;
      const life = flare.age / FLARE_LIFE;
      if (life < 0 || life >= 1) continue;
      const radial = Math.exp(-(((x - (0.08 + 0.75 * life)) / (0.14 + 0.22 * life)) ** 2));
      const fade = Math.min(1, flare.age / 0.25) * Math.pow(1 - life, 1.2);
      const gain = flare.strength * fade * radial;
      if (gain < 0.004) continue;
      // Inner parts run ahead, so the knot becomes a trailing arc. It travels out as it fades.
      const width = 0.16 + 0.7 * life;
      const az = flare.azimuth + rotation * kepler(r) * (clock - flare.clock);
      const centre = (((az / (2 * Math.PI)) % 1) + 1) % 1 * HEAT_W - 0.5;
      const c = Math.round(centre);
      const span = Math.ceil((width * 2.4 * HEAT_W) / (2 * Math.PI));
      for (let i = c - span; i <= c + span; i++) {
        const d = ((i - centre) * 2 * Math.PI) / HEAT_W / width;
        flareRow[((i % HEAT_W) + HEAT_W) % HEAT_W]! += gain * Math.exp(-d * d);
      }
      lit = true;
    }
    const row = j * HEAT_W * 2;
    for (let i = 0; i < HEAT_W; i++) {
      const ar = Math.round(Math.min(1, profile[i]! * arcBand) * 255);
      const fr = lit ? Math.round(Math.min(1, flareRow[i]!) * 255) : 0;
      out[row + i * 2] = ar;
      out[row + i * 2 + 1] = fr;
      if (ar > 0 || fr > 0) any = true;
    }
  }
  return any;
}
