// Rollups for `ledger.get`, and the per-world numbers behind mass and city lights. Pure over what the plane hands in.
import type { LedgerReport, TokenUsage, WorldId } from '@naos/protocol';
import { dayKey } from './paths.ts';
import type { ModelBucket } from './prices.ts';
import { addUsage, zeroUsage } from './prices.ts';

export interface Spend {
  worldId: WorldId;
  byDay: Record<string, number> | ReadonlyMap<string, number>;
  byModel: Record<string, ModelBucket> | ReadonlyMap<string, ModelBucket>;
}

const DAY_MS = 86_400_000;

export const lastDays = (now: number, n: number): Set<string> => {
  const out = new Set<string>();
  for (let i = 0; i < n; i += 1) out.add(dayKey(now - i * DAY_MS));
  return out;
};

const entries = <V>(m: Record<string, V> | ReadonlyMap<string, V>): Iterable<[string, V]> =>
  m instanceof Map ? (m as ReadonlyMap<string, V>).entries() : Object.entries(m as Record<string, V>);

export interface Rollup {
  todayUsd: number;
  days30Usd: number;
  byWorld: Map<WorldId, { usd30: number; today: number }>;
  byModel: Map<string, { usage: TokenUsage; usd: number }>;
}

export function rollup(spends: Iterable<Spend>, now: number): Rollup {
  const today = dayKey(now);
  const window = lastDays(now, 30);
  const out: Rollup = { todayUsd: 0, days30Usd: 0, byWorld: new Map(), byModel: new Map() };
  for (const s of spends) {
    let world = out.byWorld.get(s.worldId);
    if (!world) out.byWorld.set(s.worldId, (world = { usd30: 0, today: 0 }));
    for (const [day, usd] of entries(s.byDay)) {
      if (!window.has(day)) continue;
      out.days30Usd += usd;
      world.usd30 += usd;
      if (day === today) {
        out.todayUsd += usd;
        world.today += usd;
      }
    }
    for (const [model, bucket] of entries(s.byModel)) {
      let m = out.byModel.get(model);
      if (!m) out.byModel.set(model, (m = { usage: zeroUsage(), usd: 0 }));
      addUsage(m.usage, bucket.usage);
      m.usd += bucket.usd;
    }
  }
  return out;
}

export function ledgerReport(r: Rollup, opts: {
  partial: boolean; burnUsdPerHour: number; blockedTodayMs: number; trees: LedgerReport['trees'];
}): LedgerReport {
  return {
    partial: opts.partial,
    todayUsd: r.todayUsd,
    burnUsdPerHour: opts.burnUsdPerHour,
    days30Usd: r.days30Usd,
    blockedTodayMs: opts.blockedTodayMs,
    byWorld: [...r.byWorld].map(([worldId, w]) => ({ worldId, usd: w.usd30 })).sort((a, b) => b.usd - a.usd),
    byModel: [...r.byModel].map(([model, m]) => ({
      model,
      inputTokens: m.usage.input + m.usage.cacheRead + m.usage.cacheWrite5m + m.usage.cacheWrite1h,
      outputTokens: m.usage.output,
      usd: m.usd,
    })).sort((a, b) => b.usd - a.usd),
    trees: opts.trees,
  };
}
