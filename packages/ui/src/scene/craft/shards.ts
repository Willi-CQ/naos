// A crashed hull, section 6: five sections that part slowly and hold the orbit. Pure, seeded by the piece, so debris lies the same way every frame.

export const SHARDS = 5;

export interface Shard { dx: number; dy: number; dz: number; ax: number; ay: number; az: number; angle: number }

const wave = (k: number, salt: number): number => Math.sin(k * 12.9898 + salt * 78.233) * 43758.5453 % 1;

/** `k` is the piece, `along` its place on the hull from 0 at the stern, `apart` how far it has gone, 0 to 1. Offsets are in hull lengths. */
export function shardOf(k: number, along: number, apart: number, out: Shard): Shard {
  const spread = 0.24 * apart;
  out.dx = (along - 0.5) * spread * 1.2;
  out.dy = wave(k, 1) * spread;
  out.dz = wave(k, 2) * spread;
  const x = wave(k, 3), y = wave(k, 4), z = wave(k, 5);
  const l = Math.hypot(x, y, z) || 1;
  out.ax = x / l;
  out.ay = y / l;
  out.az = z / l;
  out.angle = apart * (0.35 + 0.5 * Math.abs(wave(k, 6)));
  return out;
}
