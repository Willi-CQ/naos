// List prices and the per-request formula of RF 3.4. Prices change between CLI versions, so this file is the one place
// that holds them. "Over 100,000" compares one request's prompt, which is why totals can never be priced.
import type { CostEstimate, TokenUsage } from '@naos/protocol';

export interface Rate { in: number; out: number; write5m: number; write1h: number; read: number }
export interface Price extends Rate { longPrompt?: Rate & { above: number } }

/** USD per MTok. Writes of the older tiers are not in RF, so they carry the same 1.25x and 2x as the tiers that are. */
export const PRICES: Readonly<Record<string, Price>> = {
  'claude-opus-5-5': { in: 4, out: 20, write5m: 5, write1h: 8, read: 0.2 },
  'claude-sonnet-5-5': { in: 2, out: 10, write5m: 2.5, write1h: 4, read: 0.1 },
  'claude-fable-5-1': { in: 10, out: 50, write5m: 12.5, write1h: 20, read: 0.25 },
  'claude-haiku-5-5': {
    in: 0.1, out: 0.5, write5m: 0.125, write1h: 0.2, read: 0.01,
    longPrompt: { above: 100_000, in: 0.5, out: 2.5, write5m: 0.625, write1h: 1, read: 0.05 },
  },
  'claude-opus-5': { in: 5, out: 25, write5m: 6.25, write1h: 10, read: 0.5 },
  'claude-sonnet-5': { in: 2, out: 10, write5m: 2.5, write1h: 4, read: 0.2 },
  'claude-fable-5': { in: 10, out: 50, write5m: 12.5, write1h: 20, read: 1 },
  'claude-haiku-4-5': { in: 1, out: 5, write5m: 1.25, write1h: 2, read: 0.1 },
};

/** The CLI prices an unknown model at 5/25 (RF 3.4). The estimate still counts it and names it in `unpricedModels`. */
export const FALLBACK_PRICE: Price = { in: 5, out: 25, write5m: 6.25, write1h: 10, read: 0.5 };

export const SYNTHETIC_MODEL = '<synthetic>';

export interface ApiUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
  server_tool_use?: { web_search_requests?: number };
  output_tokens_details?: { thinking_tokens?: number };
  inference_geo?: string | null;
}

/** `claude-opus-5-5[1m]` and `claude-haiku-4-5-20251001` price as their base id. */
export const baseModel = (model: string): string => model.replace(/\[[^\]]*\]$/, '').replace(/-\d{8}$/, '');

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

export function requestCostUsd(model: string, u: ApiUsage, table: Readonly<Record<string, Price>> = PRICES): number | null {
  const base = table[baseModel(model)];
  return base ? priceWith(base, u) : null;
}

function priceWith(base: Price, u: ApiUsage): number {
  const input = count(u.input_tokens);
  const read = count(u.cache_read_input_tokens);
  const write = count(u.cache_creation_input_tokens);
  const prompt = input + read + write;
  const p = base.longPrompt && prompt > base.longPrompt.above ? base.longPrompt : base;
  const write1h = Math.min(count(u.cache_creation?.ephemeral_1h_input_tokens), write);
  const tokens = (input * p.in + count(u.output_tokens) * p.out + read * p.read + (write - write1h) * p.write5m + write1h * p.write1h) / 1e6;
  const geo = u.inference_geo === 'us' ? 1.1 : 1;
  return tokens * geo + count(u.server_tool_use?.web_search_requests) * 0.01;
}

export const zeroUsage = (): TokenUsage => ({
  input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, webSearchRequests: 0, messages: 0, partialOutputMessages: 0,
});

export function addUsage(into: TokenUsage, u: TokenUsage, sign: 1 | -1 = 1): TokenUsage {
  into.input += sign * u.input;
  into.output += sign * u.output;
  into.cacheRead += sign * u.cacheRead;
  into.cacheWrite5m += sign * u.cacheWrite5m;
  into.cacheWrite1h += sign * u.cacheWrite1h;
  into.webSearchRequests += sign * u.webSearchRequests;
  into.messages += sign * u.messages;
  into.partialOutputMessages += sign * u.partialOutputMessages;
  return into;
}

export const sumUsage = (...all: TokenUsage[]): TokenUsage => all.reduce((sum, u) => addUsage(sum, u), zeroUsage());

export function tokenUsage(u: ApiUsage, partial: boolean): TokenUsage {
  const write = count(u.cache_creation_input_tokens);
  const write1h = Math.min(count(u.cache_creation?.ephemeral_1h_input_tokens), write);
  return {
    input: count(u.input_tokens),
    output: count(u.output_tokens),
    cacheRead: count(u.cache_read_input_tokens),
    cacheWrite5m: write - write1h,
    cacheWrite1h: write1h,
    webSearchRequests: count(u.server_tool_use?.web_search_requests),
    messages: 1,
    partialOutputMessages: partial ? 1 : 0,
  };
}

/** Context size now, the status line's input-only formula (RF 3.3). */
export const contextTokensOf = (u: ApiUsage): number =>
  count(u.input_tokens) + count(u.cache_read_input_tokens) + count(u.cache_creation_input_tokens);

export interface ModelBucket { usage: TokenUsage; usd: number }

interface Booked { usage: TokenUsage; usd: number; model: string; day: string }

/** Enough to outlast tool rounds of one response. An older id arriving again would count twice, and the census saw none. */
const RECENT_MESSAGES = 256;

/**
 * Sums usage per message, never per record. One API message spans several records sharing `message.id`, and the last one
 * holds the final numbers, so a repeat replaces what was booked under that id (RF 3.3). The usage worker uses the same class.
 */
export class UsageBook {
  readonly total = zeroUsage();
  estimateUsd = 0;
  readonly byModel = new Map<string, ModelBucket>();
  readonly byDay = new Map<string, number>();
  readonly unpriced = new Set<string>();
  private readonly recent = new Map<string, Booked>();
  lastMessageId: string | null = null;

  record(messageId: string, model: string, u: ApiUsage, partial: boolean, day: string): void {
    if (model === SYNTHETIC_MODEL) return;
    const prev = this.recent.get(messageId);
    if (prev) this.book(prev, -1);
    else if (this.recent.size >= RECENT_MESSAGES) this.recent.delete(this.recent.keys().next().value as string);

    const known = PRICES[baseModel(model)];
    if (!known) this.unpriced.add(model);
    const entry: Booked = { usage: tokenUsage(u, partial), usd: priceWith(known ?? FALLBACK_PRICE, u), model, day: prev?.day ?? day };
    this.recent.delete(messageId);
    this.recent.set(messageId, entry);
    this.book(entry, 1);
    this.lastMessageId = messageId;
  }

  has(messageId: string): boolean {
    return this.recent.has(messageId);
  }

  /** The contribution of a message still in memory, so a baseline that ends inside it is not counted twice. */
  entry(messageId: string): { usage: TokenUsage; usd: number; model: string; day: string } | undefined {
    return this.recent.get(messageId);
  }

  private book(e: Booked, sign: 1 | -1): void {
    addUsage(this.total, e.usage, sign);
    this.estimateUsd += sign * e.usd;
    let bucket = this.byModel.get(e.model);
    if (!bucket) this.byModel.set(e.model, (bucket = { usage: zeroUsage(), usd: 0 }));
    addUsage(bucket.usage, e.usage, sign);
    bucket.usd += sign * e.usd;
    this.byDay.set(e.day, (this.byDay.get(e.day) ?? 0) + sign * e.usd);
  }
}

/** `costStateUsd` zero with real usage is treated as absent, because it reads falsely low (RF 3.4). */
export function makeCost(estimateUsd: number, costStateUsd: number | null, unpriced: Iterable<string>, lowerBound: boolean): CostEstimate {
  const state = costStateUsd !== null && costStateUsd > 0 ? costStateUsd : null;
  return {
    usd: Math.max(estimateUsd, state ?? 0),
    estimateUsd,
    costStateUsd: state,
    isEstimate: state === null,
    isLowerBound: lowerBound,
    unpricedModels: [...new Set(unpriced)],
  };
}

export const zeroCost = (): CostEstimate => makeCost(0, null, [], false);
