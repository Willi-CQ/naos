// Plan window. `~/.claude.json` holds secrets beside this key, so it is parsed in memory, one key is taken, and the rest is
// dropped without a trace. Never logged, and the usage API is never called: credentials are off limits (RF 7).
import fsp from 'node:fs/promises';
import type { PlanState, PlanStatus } from '@naos/protocol';
import { arr, epochMs, num, obj, str } from './parse.ts';

const RETRY_MS = 50;

/** `~/.claude.json` is on a 0 to 100 scale, SDK frames on 0 to 1 (AC 6). */
export function fractionLeft(utilization: number | null, scale: 100 | 1 = 100): number | null {
  if (utilization === null) return null;
  const used = scale === 100 || utilization > 1 ? utilization / 100 : utilization;
  return Math.min(1, Math.max(0, 1 - used));
}

function statusFrom(limits: unknown): PlanStatus {
  let status: PlanStatus = 'unknown';
  for (const item of arr(limits)) {
    const l = obj(item);
    const severity = str(l?.severity);
    if (!severity) continue;
    if (severity === 'blocked' || severity === 'exceeded' || severity === 'rejected') return 'rejected';
    if (severity === 'normal') {
      if (status === 'unknown') status = 'allowed';
    } else {
      status = 'allowed_warning';
    }
  }
  return status;
}

/** Normalises the one key. `null` when the key is missing or holds no window. */
export function normalisePlan(cached: unknown): PlanState | null {
  const c = obj(cached);
  const u = obj(c?.utilization);
  const five = obj(u?.five_hour);
  const seven = obj(u?.seven_day);
  if (!five && !seven) return null;
  const fiveHourLeft = fractionLeft(num(five?.utilization));
  const sevenDayLeft = fractionLeft(num(seven?.utilization));
  const spent = fiveHourLeft === 0 || sevenDayLeft === 0;
  return {
    fiveHourLeft,
    sevenDayLeft,
    asOf: num(c?.fetchedAtMs),
    resetsAt: { fiveHour: epochMs(five?.resets_at), sevenDay: epochMs(seven?.resets_at) },
    status: spent ? 'rejected' : statusFrom(u?.limits),
  };
}

export async function readPlan(file: string): Promise<PlanState | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt === 1) await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    try {
      const parsed = JSON.parse(await fsp.readFile(file, 'utf8')) as Record<string, unknown>;
      return normalisePlan(parsed.cachedUsageUtilization);
    } catch {
      // It is rewritten often, so one retry covers a torn read. A missing file ends the same way.
    }
  }
  return null;
}

export const samePlan = (a: PlanState | null, b: PlanState | null): boolean => JSON.stringify(a) === JSON.stringify(b);
