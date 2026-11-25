interface Point { x: number; y: number; z: number }
export interface DeparturePose extends Point { tx: number; ty: number; tz: number }

/** A late discovery is history, not a launch. Reloads arrive as snapshots and never enter this path. */
export const freshStart = (startedAt: number | null, observedAt: number): boolean =>
  startedAt !== null && Number.isFinite(startedAt) && observedAt - startedAt >= -1000 && observedAt - startedAt <= 30_000;

/** Quarter ellipse with a lift above the system plane. It meets both ends exactly and carries its own tangent. */
export function departureAt(from: Point, to: Point, progress: number, bend: number, out: DeparturePose): void {
  const q = Math.max(0, Math.min(1, progress)) * Math.PI / 2;
  const c = Math.cos(q), s = Math.sin(q);
  const cx = (from.x + to.x) / 2, cy = (from.y + to.y) / 2 - bend, cz = (from.z + to.z) / 2;
  const ax = from.x - cx, ay = from.y - cy, az = from.z - cz;
  const bx = to.x - cx, by = to.y - cy, bz = to.z - cz;
  out.x = cx + ax * c + bx * s; out.y = cy + ay * c + by * s; out.z = cz + az * c + bz * s;
  out.tx = -ax * s + bx * c; out.ty = -ay * s + by * c; out.tz = -az * s + bz * c;
}
