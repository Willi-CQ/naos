// What a world keeps of its past: cities and long exposures. Pure: digest rows in, numbers out. Rows carry no text.
import type { EpochMs, HistoryDigest, WorldId } from '@naos/protocol';
import { jitter } from '../store/sky.ts';
import { hash32 } from '../store/veil.ts';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const TAU = Math.PI * 2;

export interface CityLight { worldId: WorldId; dir: [number, number, number]; fail: boolean }

const unit = (x: number, y: number, z: number): [number, number, number] => {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
};

function scatter(seed: number): [number, number, number] {
  const g = jitter(seed);
  return [g(), g(), g()];
}

/**
 * One light per finished agent, one cluster per session (DESIGN 7.5). A world gathers its sessions into a few continents, the way the
 * stills did. The hash decides which, so a light never moves between two redraws. Oldest first, so a smaller tier keeps the newest.
 */
export function cityLights(rows: readonly HistoryDigest[]): CityLight[] {
  const perWorld = new Map<WorldId, number>();
  for (const row of rows) perWorld.set(row.worldId, (perWorld.get(row.worldId) ?? 0) + 1);
  const ended = rows.filter((r) => r.endedAt !== null).sort((a, b) => a.endedAt! - b.endedAt!);
  return ended.map((row) => {
    const n = perWorld.get(row.worldId) ?? 1;
    const continents = Math.max(5, Math.round(9 + 2.4 * Math.log2(1 + n)));
    const pick = hash32(`${row.worldId}:${row.sessionId}`) / 4294967296;
    const index = Math.floor(continents * pick ** 1.4);
    const [cx, cy, cz] = unit(...scatter(hash32(`${row.worldId}:continent:${index}`)));
    const spread = 0.05 + 0.17 * (hash32(`${row.worldId}:spread:${index}`) / 4294967296);
    const [sx, sy, sz] = scatter(hash32(row.sessionId));
    const [lx, ly, lz] = scatter(hash32(row.nodeId));
    return {
      worldId: row.worldId,
      dir: unit(cx + spread * (sx + 0.45 * lx), cy + spread * (sy + 0.45 * ly), cz + spread * (sz + 0.45 * lz)),
      fail: row.outcome === 'failed' || row.outcome === 'abandoned',
    };
  });
}

export interface Exposure { worldId: WorldId; altitude: number; start: number; sweep: number }

/** One arc per craft of the last 24 hours. Altitude is not in a digest, so the hash spreads them. A longer session draws a longer arc. */
export function exposuresOf(rows: readonly HistoryDigest[], now: EpochMs): Exposure[] {
  const out: Exposure[] = [];
  for (const row of rows) {
    if (row.kind !== 'main' || row.endedAt === null) continue;
    if (row.endedAt > now || now - row.endedAt > DAY_MS) continue;
    const h = hash32(row.nodeId);
    const minutes = Math.max(0, row.endedAt - row.startedAt) / 60_000;
    out.push({
      worldId: row.worldId,
      altitude: ((h >>> 8) % 1000) / 1000,
      start: ((h % 628) / 628) * TAU,
      sweep: Math.min(4.4, 0.8 + 0.8 * Math.log2(1 + minutes / 6)),
    });
  }
  return out;
}
