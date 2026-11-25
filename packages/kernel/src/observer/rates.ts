// Derived rates. Disk gives whole responses, not deltas, so a response's own tokens over its own duration is the honest
// number. It holds for the length of that response, capped, then decays, so a plume fades rather than cuts out.
import type { FleetRate, NodeId, NodeRate, WorldId } from '@naos/protocol';

const HOLD_MAX_MS = 15_000;
const DECAY_TAU_MS = 3_000;
const FLOOR_TPS = 0.5;
const MIN_DURATION_MS = 1_000;
const MAX_TPS = 2_000;
const BURN_WINDOW_MS = 15 * 60_000;
const BURN_BUCKET_MS = 60_000;
const LAG_WINDOW_MS = 10_000;

export interface RateSink {
  setRate(rate: NodeRate): void;
  clearRate(nodeId: NodeId): void;
  setFleetRate(patch: Partial<FleetRate>): void;
}

interface NodeState {
  worldId: WorldId;
  tps: number;
  holdUntil: number;
  tokens: number;
}

export class RateTracker {
  private readonly sink: RateSink;
  private readonly nodes = new Map<NodeId, NodeState>();
  private readonly burn = new Map<number, number>();
  private outputTokens = 0;
  private lagMaxMs = 0;
  private lagAt = 0;

  constructor(sink: RateSink) {
    this.sink = sink;
  }

  message(nodeId: NodeId, worldId: WorldId, outputTokens: number, durationMs: number, now: number): void {
    const n = this.nodes.get(nodeId) ?? { worldId, tps: 0, holdUntil: 0, tokens: 0 };
    n.worldId = worldId;
    n.tokens += outputTokens;
    n.tps = Math.min(MAX_TPS, (outputTokens * 1000) / Math.max(MIN_DURATION_MS, durationMs));
    n.holdUntil = now + Math.min(HOLD_MAX_MS, Math.max(MIN_DURATION_MS, durationMs));
    this.nodes.set(nodeId, n);
    this.outputTokens += outputTokens;
    this.sink.setRate({ nodeId, tps: n.tps, source: 'derived', liveBlock: null, outputTokens: n.tokens });
  }

  cost(deltaUsd: number, now: number): void {
    if (deltaUsd <= 0) return;
    const bucket = Math.floor(now / BURN_BUCKET_MS);
    this.burn.set(bucket, (this.burn.get(bucket) ?? 0) + deltaUsd);
  }

  lag(ms: number, now: number): void {
    if (ms >= this.lagMaxMs || now - this.lagAt > LAG_WINDOW_MS) {
      this.lagMaxMs = Math.max(0, ms);
      this.lagAt = now;
    }
  }

  burnUsdPerHour(now: number): number {
    const oldest = Math.floor((now - BURN_WINDOW_MS) / BURN_BUCKET_MS);
    let sum = 0;
    for (const [bucket, usd] of this.burn) {
      if (bucket < oldest) this.burn.delete(bucket);
      else sum += usd;
    }
    return (sum * 3_600_000) / BURN_WINDOW_MS;
  }

  /** One Hz, so decay stays cheap. Rates of quiet craft are cleared, not published as zero forever. */
  tick(now: number, todayUsd: number | null, dtMs: number): void {
    const perWorld: Record<WorldId, number> = {};
    let tps = 0;
    for (const [nodeId, n] of this.nodes) {
      if (now > n.holdUntil) {
        n.tps *= Math.exp(-dtMs / DECAY_TAU_MS);
        if (n.tps < FLOOR_TPS) {
          n.tps = 0;
          this.nodes.delete(nodeId);
          this.sink.clearRate(nodeId);
          continue;
        }
        this.sink.setRate({ nodeId, tps: n.tps, source: 'derived', liveBlock: null, outputTokens: n.tokens });
      }
      tps += n.tps;
      perWorld[n.worldId] = (perWorld[n.worldId] ?? 0) + n.tps;
    }
    if (now - this.lagAt > LAG_WINDOW_MS) this.lagMaxMs = 0;
    this.sink.setFleetRate({
      tps,
      outputTokens: this.outputTokens,
      perWorld,
      burnUsdPerHour: this.burnUsdPerHour(now),
      todayUsd,
      lagMaxMs: this.lagMaxMs,
    });
  }
}
