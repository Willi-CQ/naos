// The month as numbers, for the Sky strip, the day panel, the Plate and the Almanac Sky. Pure: history rows in, what the sky holds
// out. Rows carry no text. One star lands on the same spot in ink and in light, because both draw it from here.
import type { EpochMs, HistoryDigest, Salvo, WorldId } from '@naos/protocol';
import { hash32 } from './veil.ts';

const DAY_MS = 86_400_000;
const BYTES_MB = 1_048_576;

export type StarClass = 'starO' | 'starA' | 'starG' | 'starM';

export interface SkyStar {
  /** Seeds its own scatter, so a redraw lays the same grain and the Plate never shimmers. */
  seed: number;
  ageDays: number;
  /** Declination lane of its project, degrees within plus or minus 15. */
  laneDeg: number;
  agent: boolean;
  mb: number;
  /** Stellar class by input price. */
  star: StarClass;
}

/** One burned spoke: a closed salvo on its day's meridian. */
export interface SkySpoke { ageDays: number; count: number; laneDeg: number }

/** A seeded gaussian, the only source of scatter in the sky. */
export function jitter(seed: number): () => number {
  let s = seed >>> 0 || 1;
  const next = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  return () => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());
}

export const laneOf = (worldId: WorldId): number => -15 + (hash32(worldId) % 301) / 10;

/** By input price, read from the name until the price table reaches the UI. Open set: an unknown model is a plain G. */
export function starClass(model: string | null): StarClass {
  if (model?.includes('fable')) return 'starO';
  if (model?.includes('opus')) return 'starA';
  if (model?.includes('haiku')) return 'starM';
  return 'starG';
}

/** The month's stars: one per transcript that ended inside the 30 days. */
export function skyStars(rows: readonly HistoryDigest[], now: EpochMs): SkyStar[] {
  const out: SkyStar[] = [];
  for (const row of rows) {
    const ageDays = (now - (row.endedAt ?? row.startedAt)) / DAY_MS;
    if (ageDays < 0 || ageDays > 30) continue;
    out.push({ seed: hash32(row.nodeId), ageDays, laneDeg: laneOf(row.worldId), agent: row.kind !== 'main', mb: row.bytes / BYTES_MB, star: starClass(row.model) });
  }
  return out;
}

/** History and the live state both hold salvos. One spoke per closed fan-out, however many lists it is in. */
export function skySpokes(lists: ReadonlyArray<readonly Salvo[]>, now: EpochMs): SkySpoke[] {
  const seen = new Set<string>();
  const out: SkySpoke[] = [];
  for (const list of lists) {
    for (const salvo of list) {
      if (salvo.closedAt === null || seen.has(salvo.salvoId)) continue;
      seen.add(salvo.salvoId);
      const ageDays = (now - salvo.openedAt) / DAY_MS;
      if (ageDays >= 0 && ageDays <= 30) out.push({ ageDays, count: Math.max(1, salvo.nodeIds.length), laneDeg: laneOf(salvo.worldId) });
    }
  }
  return out;
}

export const spokeHalfDeg = (count: number): number => 1.6 + 0.9 * Math.log2(count);

/** Calendar days back from `now`, so a meridian is a day on the wall, not a sliding 24 hours. */
export function ageOf(at: EpochMs, now: EpochMs): number {
  const a = new Date(at);
  const b = new Date(now);
  const startA = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const startB = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((startB - startA) / DAY_MS);
}

export interface DayStats {
  date: string;
  sessions: number;
  agents: number;
  fanouts: number;
  largest: number;
  usd: number;
  blockedMs: number;
  failed: number;
  worlds: Array<{ worldId: WorldId; sessions: number }>;
}

export function skyDay(rows: readonly HistoryDigest[], salvos: readonly Salvo[], now: EpochMs, day: number): DayStats {
  const when = new Date(now - day * DAY_MS);
  const stats: DayStats = {
    date: when.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
    sessions: 0, agents: 0, fanouts: 0, largest: 0, usd: 0, blockedMs: 0, failed: 0, worlds: [],
  };
  const perWorld = new Map<WorldId, number>();
  for (const row of rows) {
    if (ageOf(row.endedAt ?? row.startedAt, now) !== day) continue;
    if (row.kind === 'main') {
      stats.sessions += 1;
      perWorld.set(row.worldId, (perWorld.get(row.worldId) ?? 0) + 1);
    } else {
      stats.agents += 1;
    }
    stats.usd += row.usd ?? 0;
    stats.blockedMs += row.blockedMs ?? 0;
    if (row.outcome === 'failed' || row.outcome === 'abandoned') stats.failed += 1;
  }
  for (const salvo of salvos) {
    if (ageOf(salvo.openedAt, now) !== day) continue;
    stats.fanouts += 1;
    stats.largest = Math.max(stats.largest, salvo.nodeIds.length);
  }
  stats.worlds = [...perWorld.entries()].map(([worldId, sessions]) => ({ worldId, sessions })).sort((a, b) => b.sessions - a.sessions);
  return stats;
}

/** Work per day, age 0 first, for the strip's ticks. */
export function dayHeights(rows: readonly HistoryDigest[], now: EpochMs): number[] {
  const out = new Array<number>(31).fill(0);
  for (const row of rows) {
    const age = ageOf(row.endedAt ?? row.startedAt, now);
    if (age >= 0 && age <= 30) out[age]! += 1;
  }
  return out;
}
