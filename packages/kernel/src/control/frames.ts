// Agent SDK frames to the same events the Observer publishes, with origin `control`, so the UI needs no second path.
// Structure only. Text goes to pushText, which drops it unless someone watches this craft. The live rate follows AC 2.3.
// `command_lifecycle`, `subagent_stats` and `unifiedWindows` are not in sdk.d.ts, so all of it is read defensively.
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type {
  Activity, ActiveTool, CostEstimate, NodeRate, SubagentStats, TokenUsage, ToolDenial, ToolSummary, TurnOrigin, WaitReason,
} from '@naos/protocol';
import { toolFamily } from '@naos/protocol';
import path from 'node:path';
import type { EventInit } from '../context.ts';
import { isSynthetic } from './driver.ts';

export const emptyUsage = (): TokenUsage => ({
  input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, webSearchRequests: 0, messages: 0, partialOutputMessages: 0,
});

export const costOf = (usd: number): CostEstimate => ({
  usd, estimateUsd: usd, costStateUsd: null, isEstimate: true, isLowerBound: false, unpricedModels: [],
});

const clip = (s: string, n = 160): string => (s.length > n ? s.slice(0, n) : s);
const lines = (s: string): number => (s === '' ? 0 : s.split(/\r?\n/).length);
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

const relative = (cwd: string, file: string): string => {
  const rel = path.win32.relative(cwd, file);
  return rel && !rel.startsWith('..') && !path.win32.isAbsolute(rel) ? rel.replaceAll('\\', '/') : file;
};

/** `target` is sensitive and goes through the Veil. `shape` is always safe. */
export function summarize(name: string, input: Record<string, unknown>, cwd: string): ToolSummary {
  const text = (key: string): string | null => (typeof input[key] === 'string' ? input[key] : null);
  const command = text('command');
  if (command !== null) {
    const first = command.split(/\r?\n/, 1)[0] ?? '';
    return { target: clip(first), shape: `${name}, ${plural(lines(command), 'line')}, ${command.length} chars` };
  }
  const file = text('file_path') ?? text('notebook_path') ?? text('path');
  if (file !== null) {
    const out: ToolSummary = { target: clip(relative(cwd, file)), shape: name };
    const content = text('content');
    const added = text('new_string');
    const removed = text('old_string');
    if (content !== null) {
      out.plus = lines(content);
      out.shape = `${name}, ${plural(out.plus, 'line')}`;
    } else if (added !== null || removed !== null) {
      out.plus = lines(added ?? '');
      out.minus = lines(removed ?? '');
      out.shape = `${name}, +${out.plus} -${out.minus}`;
    }
    return out;
  }
  const pattern = text('pattern') ?? text('query') ?? text('url');
  if (pattern !== null) return { target: clip(pattern), shape: `${name}, ${pattern.length} chars` };
  return { target: null, shape: `${name}, ${plural(Object.keys(input).length, 'field')}` };
}

const CHARS_PER_TOKEN = 3.5; // Content dependent, digits ran at 1.82 (AC 2.3). The estimate only lasts until message_delta.
const WINDOW_MS = 1000;

/** Live rate, AC 2.3: a 1 s window of text characters and thinking tokens. Deltas come in bursts, so it must be smoothed. */
export class LiveRate {
  #samples: Array<{ at: number; tokens: number; block: 'thinking' | 'text' }> = [];
  addText(at: number, chars: number): void { this.#add(at, chars / CHARS_PER_TOKEN, 'text'); }
  addThinking(at: number, tokens: number): void { this.#add(at, tokens, 'thinking'); }
  #add(at: number, tokens: number, block: 'thinking' | 'text'): void {
    this.#samples.push({ at, tokens, block });
  }
  read(now: number): { tps: number; liveBlock: 'thinking' | 'text' | null } {
    const from = now - WINDOW_MS;
    while (this.#samples.length > 0 && this.#samples[0]!.at <= from) this.#samples.shift();
    const newest = this.#samples.at(-1);
    let tokens = 0;
    for (const s of this.#samples) tokens += s.tokens;
    return { tps: tokens / (WINDOW_MS / 1000), liveBlock: newest?.block ?? null };
  }
}

/** What the supervisor must act on. Everything else the mapper publishes itself. */
export type FrameSignal =
  | { kind: 'init'; sessionId: string; model: string; cwd: string; permissionMode: string; skills: number; mcpServers: number; version: string | null }
  | { kind: 'requesting' }
  | { kind: 'result'; result: ResultFacts }
  | { kind: 'rate-limit'; info: RateLimitFacts }
  | { kind: 'cancelled'; uuid: string };

export interface ResultFacts {
  uuids: string[];
  costUsd: number;
  isError: boolean;
  terminalReason: string | null;
  text: string | null;
  contextWindow: number | null;
  subagentStats: SubagentStats | null;
  denials: number;
}

export interface RateLimitFacts {
  status: string;
  resetsAt: number | null;
  type: string | null;
  fiveHour: { utilization: number | null; resetsAt: number | null } | null;
  sevenDay: { utilization: number | null; resetsAt: number | null } | null;
}

export interface FrameDeps {
  sessionId: string;
  cwd: string;
  publish(event: EventInit): void;
  pushText(nodeId: string, delta: string): void;
  setRate(rate: NodeRate): void;
  clearRate(nodeId: string): void;
  now?: () => number;
}

/** Ends that are failures of the turn rather than a normal stop. Unknown reasons also get a badge (AC 5.2). */
const QUIET_ENDS = new Set(['completed', 'aborted_streaming', 'aborted_tools', 'max_turns', 'budget_exhausted', 'tool_deferred']);
export const isAborted = (reason: string | null): boolean => reason === 'aborted_streaming' || reason === 'aborted_tools';
export const isTurnFailure = (reason: string | null): boolean => reason !== null && !QUIET_ENDS.has(reason);

interface Block { kind: 'thinking' | 'text' | 'tool_use'; size: number }
interface PendingMessage { id: string; model: string; blocks: Block[]; usage: TokenUsage; thinkingTokens: number; finished: boolean }
type ToolEntry = ActiveTool & { order: number };
type Obj = Record<string, unknown>;

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const obj = (v: unknown): Obj | null => (v !== null && typeof v === 'object' ? (v as Obj) : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function subagentStatsOf(v: unknown): SubagentStats | null {
  const s = obj(v);
  if (!s) return null;
  const refused = obj(s.refused);
  return {
    spawned: num(s.spawned), maxDepth: num(s.max_depth), completed: num(s.completed), failed: num(s.failed), killed: num(s.killed),
    refused: { depthLimit: num(refused?.depth_limit), concurrencyLimit: num(refused?.concurrency_limit), budget: num(refused?.budget) },
  };
}

function usageFrom(u: Obj): Partial<TokenUsage> {
  const cache = obj(u.cache_creation);
  const creation = num(u.cache_creation_input_tokens);
  const w5 = num(cache?.ephemeral_5m_input_tokens);
  const w1 = num(cache?.ephemeral_1h_input_tokens);
  return {
    input: num(u.input_tokens),
    cacheRead: num(u.cache_read_input_tokens),
    cacheWrite5m: cache ? w5 : creation,
    cacheWrite1h: w1,
  };
}

export class FrameMapper {
  sessionId: string;
  /** Tool targets are shown relative to this. A worktree agent's cwd arrives with init. */
  cwd: string;
  readonly #d: FrameDeps;
  readonly #now: () => number;
  readonly #rate = new LiveRate();
  readonly #tools = new Map<string, ToolEntry>();
  readonly #decisions = new Map<string, { decision: 'accept' | 'reject'; denial: ToolDenial | null }>();
  /** tool_use ids per API message, for "2 of 2" on a serial run of approvals. */
  readonly #calls = new Map<string, string[]>();
  readonly #subagents = new Map<string, string>();
  #message: PendingMessage | null = null;
  #order = 0;
  #generating: Activity & { state: 'generating' } | null = null;
  #waiting = false;
  #retry: { attempt: number; maxRetries: number; nextAttemptAt: number } | null = null;
  #compacting = false;
  #activity: Activity;
  #settledOutput = 0;
  #estimatedOutput = 0;
  #lastRateAt = 0;
  #turnOpen = false;

  usage = emptyUsage();
  costUsd = 0;
  toolCalls = 0;
  toolErrors = 0;
  contextTokens: number | null = null;
  contextWindow: number | null = null;
  ttftMs: number | null = null;
  /** The view needs a new upsert. Text deltas never set this. */
  dirty = false;
  /** Frames no case handled. They are ignored, never fatal. */
  unknownFrames = 0;

  constructor(deps: FrameDeps) {
    this.#d = deps;
    this.sessionId = deps.sessionId;
    this.cwd = deps.cwd;
    this.#now = deps.now ?? Date.now;
    this.#activity = { state: 'starting', since: this.#now() };
  }

  get activity(): Activity { return this.#activity; }

  #event<T extends object>(e: T): void {
    this.#d.publish({ ...e, sessionId: this.sessionId, nodeId: this.sessionId } as unknown as EventInit);
  }

  #setActivity(next: Activity): void {
    const prev = this.#activity;
    if (prev.state === next.state && JSON.stringify({ ...prev, since: 0 }) === JSON.stringify({ ...next, since: 0 })) return;
    this.#activity = next;
    this.#event({ type: 'activity.changed', activity: next });
  }

  /** Precedence: a human wait outranks everything, then the states the CLI announces, then tools, then the model. */
  #refreshActivity(): void {
    const since = this.#now();
    if (this.#waiting) return this.#setActivity({ state: 'waiting', since, reason: 'permission prompt' satisfies WaitReason });
    if (this.#compacting) return this.#setActivity({ state: 'compacting', since });
    if (this.#retry) return this.#setActivity({ state: 'retrying', since, ...this.#retry });
    if (this.#tools.size > 0) {
      const tools = [...this.#tools.values()].sort((a, b) => a.order - b.order).map(({ order: _order, ...tool }) => tool);
      return this.#setActivity({ state: 'tool_running', since, tools });
    }
    if (this.#turnOpen) return this.#setActivity(this.#generating ?? { state: 'generating', since });
  }

  /** A send went in. The turn is real from here, even if the CLI says nothing for a second. */
  beginTurn(origin: TurnOrigin): void {
    this.#turnOpen = true;
    this.#generating = null;
    this.#event({ type: 'turn.started', origin });
    this.#setActivity({ state: 'starting', since: this.#now() });
  }

  setWaiting(waiting: boolean): void {
    if (this.#waiting === waiting) return;
    this.#waiting = waiting;
    this.#refreshActivity();
  }

  /** The human's answer, so `tool.finished` can say who decided. */
  markDecision(toolUseId: string, decision: 'accept' | 'reject', denial: ToolDenial | null = null): void {
    this.#decisions.set(toolUseId, { decision, denial });
  }

  callPosition(toolUseId: string): { index: number; count: number } {
    for (const ids of this.#calls.values()) {
      const at = ids.indexOf(toolUseId);
      if (at >= 0) return { index: at + 1, count: ids.length };
    }
    return { index: 1, count: 1 };
  }

  subagentType(taskId: string | undefined): string | null {
    return taskId === undefined ? null : this.#subagents.get(taskId) ?? null;
  }

  tick(now = this.#now()): void {
    const { tps, liveBlock } = this.#rate.read(now);
    if (tps === 0 && this.#lastRateAt === 0) return;
    this.#d.setRate({
      nodeId: this.sessionId, tps, source: 'live', liveBlock, outputTokens: Math.round(this.#settledOutput + this.#estimatedOutput),
    });
    this.#lastRateAt = tps === 0 ? 0 : now;
  }

  #burst(now: number): void {
    if (now - this.#lastRateAt >= 100) this.tick(now);
  }

  handle(frame: SDKMessage): FrameSignal | null {
    const m = frame as unknown as Obj & { type: string };
    switch (m.type) {
      case 'stream_event': return this.#stream(m);
      case 'assistant': return this.#assistant(m);
      case 'user': return this.#user(m);
      case 'system': return this.#system(m);
      case 'result': return this.#result(frame);
      case 'rate_limit_event': return this.#rateLimit(m);
      case 'command_lifecycle': {
        // Unstable and undocumented (AC 2.1). Used for the one fact nothing else carries.
        const uuid = str(m.command_uuid);
        return m.state === 'cancelled' && uuid ? { kind: 'cancelled', uuid } : null;
      }
      case 'tool_progress':
      case 'tool_use_summary':
      case 'auth_status':
      case 'prompt_suggestion':
        return null;
      default:
        this.unknownFrames += 1;
        return null;
    }
  }

  #stream(m: Obj): FrameSignal | null {
    if (m.parent_tool_use_id) return null; // Subagents belong to the Observer, only the disk knows them whole.
    const event = obj(m.event);
    if (!event) return null;
    const now = this.#now();
    if (typeof m.ttft_ms === 'number') {
      this.ttftMs = m.ttft_ms;
      this.dirty = true;
    }
    switch (event.type) {
      case 'message_start': {
        const message = obj(event.message);
        const usage = obj(message?.usage) ?? {};
        this.#flushMessage();
        const model = str(message?.model) ?? '';
        this.#message = {
          id: str(message?.id) ?? `m${this.#order}`, model, blocks: [], thinkingTokens: 0, finished: false,
          usage: { ...emptyUsage(), ...usageFrom(usage), messages: 1 },
        };
        const u = this.#message.usage;
        this.contextTokens = u.input + u.cacheRead + u.cacheWrite5m + u.cacheWrite1h;
        this.#estimatedOutput = 0;
        this.dirty = true;
        this.#event({ type: 'request.started', model, querySource: null });
        this.#retry = null;
        this.#generating = { state: 'generating', since: now };
        this.#refreshActivity();
        return null;
      }
      case 'content_block_start': {
        const block = obj(event.content_block);
        if (block?.type === 'thinking' || block?.type === 'text') {
          this.#generating = { state: 'generating', since: now, lastBlock: block.type };
          this.#refreshActivity();
        }
        return null;
      }
      case 'content_block_delta': {
        const delta = obj(event.delta);
        if (delta?.type === 'text_delta') {
          const text = str(delta.text) ?? '';
          this.#d.pushText(this.sessionId, text);
          this.#rate.addText(now, text.length);
          this.#estimatedOutput += text.length / CHARS_PER_TOKEN;
          this.#burst(now);
        } else if (delta?.type === 'thinking_delta') {
          const chars = (str(delta.thinking) ?? '').length;
          this.#rate.addThinking(now, chars / CHARS_PER_TOKEN);
          this.#burst(now);
        }
        return null;
      }
      case 'message_delta': {
        const usage = obj(event.usage);
        const output = num(usage?.output_tokens);
        if (this.#message) {
          this.#message.usage.output = output;
          this.#message.usage.webSearchRequests = num(obj(usage?.server_tool_use)?.web_search_requests);
          this.#message.finished = true;
        }
        // Real numbers replace the estimate here (AC 2.3).
        this.#settledOutput += output;
        this.#estimatedOutput = 0;
        return null;
      }
      default:
        return null;
    }
  }

  #assistant(m: Obj): FrameSignal | null {
    if (m.parent_tool_use_id) return null;
    const message = obj(m.message);
    if (!message) return null;
    if (typeof m.error === 'string') this.#event({ type: 'api.error', httpStatus: null, kind: m.error });
    const id = str(message.id) ?? '';
    if (!this.#message || (id && this.#message.id !== id)) {
      this.#flushMessage();
      this.#message = {
        id, model: str(message.model) ?? '', blocks: [], thinkingTokens: 0, finished: false,
        usage: { ...emptyUsage(), ...usageFrom(obj(message.usage) ?? {}), messages: 1 },
      };
    }
    const pending = this.#message;
    for (const raw of Array.isArray(message.content) ? message.content : []) {
      const block = obj(raw);
      if (block?.type === 'text') pending.blocks.push({ kind: 'text', size: (str(block.text) ?? '').length });
      else if (block?.type === 'thinking') pending.blocks.push({ kind: 'thinking', size: pending.thinkingTokens });
      else if (block?.type === 'tool_use') {
        const input = obj(block.input) ?? {};
        pending.blocks.push({ kind: 'tool_use', size: JSON.stringify(input).length });
        this.#toolStarted(str(block.id) ?? '', str(block.name) ?? 'unknown', input, id);
      }
    }
    return null;
  }

  #toolStarted(toolUseId: string, name: string, input: Obj, messageId: string): void {
    const family = toolFamily(name);
    const startedAt = this.#now();
    this.#tools.set(toolUseId, { toolUseId, name, family, startedAt, order: this.#order++ });
    const ids = this.#calls.get(messageId) ?? [];
    ids.push(toolUseId);
    this.#calls.set(messageId, ids);
    this.toolCalls += 1;
    this.dirty = true;
    this.#event({ type: 'tool.started', toolUseId, name, toolFamily: family, summary: summarize(name, input, this.cwd) });
    this.#refreshActivity();
  }

  #toolFinished(toolUseId: string, isError: boolean): void {
    const tool = this.#tools.get(toolUseId);
    if (!tool) return;
    this.#tools.delete(toolUseId);
    const human = this.#decisions.get(toolUseId);
    this.#decisions.delete(toolUseId);
    if (isError) {
      this.toolErrors += 1;
      this.dirty = true;
    }
    this.#event({
      type: 'tool.finished', toolUseId, name: tool.name, toolFamily: tool.family, isError,
      decision: human?.decision ?? null, denial: human?.denial ?? null, durationMs: this.#now() - tool.startedAt,
    });
  }

  #user(m: Obj): FrameSignal | null {
    if (m.parent_tool_use_id) return null;
    const content = obj(m.message)?.content;
    if (!Array.isArray(content)) return null;
    this.#flushMessage();
    for (const raw of content) {
      const block = obj(raw);
      if (block?.type === 'tool_result') this.#toolFinished(str(block.tool_use_id) ?? '', block.is_error === true);
    }
    this.#refreshActivity();
    return null;
  }

  #system(m: Obj): FrameSignal | null {
    switch (m.subtype) {
      case 'init': {
        const sessionId = str(m.session_id) ?? this.sessionId;
        return {
          kind: 'init', sessionId, model: str(m.model) ?? '', cwd: str(m.cwd) ?? '', permissionMode: str(m.permissionMode) ?? '',
          skills: Array.isArray(m.skills) ? m.skills.length : 0,
          mcpServers: Array.isArray(m.mcp_servers) ? m.mcp_servers.length : 0,
          version: str(m.claude_code_version),
        };
      }
      case 'status': {
        const compacting = m.status === 'compacting';
        if (compacting !== this.#compacting) {
          this.#compacting = compacting;
          this.#refreshActivity();
        }
        return m.status === 'requesting' ? { kind: 'requesting' } : null;
      }
      case 'thinking_tokens': {
        const delta = num(m.estimated_tokens_delta);
        const now = this.#now();
        this.#rate.addThinking(now, delta);
        this.#estimatedOutput += delta;
        if (this.#message) this.#message.thinkingTokens = num(m.estimated_tokens);
        this.#burst(now);
        return null;
      }
      case 'api_retry': {
        const retryInMs = num(m.retry_delay_ms);
        this.#retry = { attempt: num(m.attempt), maxRetries: num(m.max_retries), nextAttemptAt: this.#now() + retryInMs };
        this.#event({ type: 'api.retry', attempt: this.#retry.attempt, maxRetries: this.#retry.maxRetries, retryInMs });
        this.#refreshActivity();
        return null;
      }
      case 'compact_boundary': {
        const meta = obj(m.compact_metadata);
        const trigger = meta?.trigger === 'manual' || meta?.trigger === 'auto' ? meta.trigger : 'unknown';
        const postTokens = num(meta?.post_tokens);
        this.contextTokens = postTokens;
        this.dirty = true;
        this.#event({ type: 'compacted', trigger, preTokens: num(meta?.pre_tokens), postTokens, durationMs: num(meta?.duration_ms) });
        return null;
      }
      case 'permission_denied': {
        const toolUseId = str(m.tool_use_id);
        const name = str(m.tool_name) ?? 'unknown';
        const denial: ToolDenial = { kind: str(m.decision_reason_type), source: 'rule' };
        if (toolUseId && this.#tools.has(toolUseId)) {
          this.markDecision(toolUseId, 'reject', denial);
          this.#toolFinished(toolUseId, true);
          this.#refreshActivity();
        } else {
          this.#event({ type: 'tool.denied', toolUseId, name, toolFamily: toolFamily(name), denial });
        }
        return null;
      }
      case 'task_started': {
        const id = str(m.task_id);
        const type = str(m.subagent_type);
        if (id && type) this.#subagents.set(id, type);
        return null;
      }
      case 'task_progress':
      case 'task_updated':
      case 'task_notification':
      case 'hook_started':
      case 'hook_progress':
      case 'hook_response':
      case 'session_title_changed':
      case 'session_state_changed':
      case 'notification':
      case 'informational':
      case 'local_command_output':
      case 'commands_changed':
      case 'background_tasks_changed':
      case 'files_persisted':
      case 'memory_recall':
        return null;
      default:
        this.unknownFrames += 1;
        return null;
    }
  }

  #flushMessage(): void {
    const m = this.#message;
    this.#message = null;
    if (!m) return;
    const usage = { ...m.usage, partialOutputMessages: m.finished ? 0 : 1 };
    for (const key of Object.keys(usage) as Array<keyof TokenUsage>) this.usage[key] += usage[key];
    if (this.#calls.size > 8) this.#calls.delete(this.#calls.keys().next().value!);
    this.#event({
      type: 'message.completed', messageId: m.id, model: m.model, blocks: m.blocks.map((b) => b.kind),
      blockSizes: m.blocks.map((b) => b.size), usage,
    });
  }

  #result(frame: SDKMessage): FrameSignal | null {
    if (frame.type !== 'result') return null;
    if (isSynthetic(frame)) return null;
    const m = frame as unknown as Obj;
    this.#flushMessage();
    const terminalReason = str(m.terminal_reason);
    // A tool still open here was cut off with its turn. The frame that would have closed it will not come.
    for (const toolUseId of [...this.#tools.keys()]) this.#toolFinished(toolUseId, true);
    this.#retry = null;
    this.#compacting = false;
    this.#turnOpen = false;
    this.costUsd = num(m.total_cost_usd); // Cumulative for the query, read the latest, never sum (AC 2.3).

    const uuids = Array.isArray(m.user_message_uuids) ? m.user_message_uuids.filter((u): u is string => typeof u === 'string') : [];
    const single = str(m.user_message_uuid);
    if (single && !uuids.includes(single)) uuids.push(single);

    let contextWindow: number | null = null;
    const usageByModel = obj(m.modelUsage);
    if (usageByModel) for (const value of Object.values(usageByModel)) contextWindow = num(obj(value)?.contextWindow) || contextWindow;
    if (contextWindow !== null) this.contextWindow = contextWindow;

    this.#event({ type: 'turn.ended', stopReason: terminalReason ?? str(m.stop_reason) ?? str(m.subtype) ?? 'unknown' });
    this.#event({ type: 'usage.changed', usage: { ...this.usage }, cost: costOf(this.costUsd) });
    const since = this.#now();
    if (isAborted(terminalReason)) this.#setActivity({ state: 'interrupted', since });
    else if (isTurnFailure(terminalReason)) this.#setActivity({ state: 'errored', since, kind: 'api' });
    else this.#setActivity({ state: 'idle', since, backgroundShell: false });
    this.#d.clearRate(this.sessionId);
    this.#lastRateAt = 0;
    this.dirty = true;
    return {
      kind: 'result',
      result: {
        uuids, costUsd: this.costUsd, isError: m.is_error === true, terminalReason,
        text: str(m.result), contextWindow, subagentStats: subagentStatsOf(m.subagent_stats),
        denials: Array.isArray(m.permission_denials) ? m.permission_denials.length : 0,
      },
    };
  }

  #rateLimit(m: Obj): FrameSignal | null {
    const info = obj(m.rate_limit_info);
    if (!info) return null;
    const windows = obj(info.unifiedWindows);
    const window = (key: string): RateLimitFacts['fiveHour'] => {
      const w = obj(windows?.[key]);
      return w ? { utilization: typeof w.utilization === 'number' ? w.utilization : null, resetsAt: typeof w.resetsAt === 'number' ? w.resetsAt * 1000 : null } : null;
    };
    const resetsAt = typeof info.resetsAt === 'number' ? info.resetsAt * 1000 : null;
    const type = str(info.rateLimitType);
    const status = str(info.status) ?? 'unknown';
    if (status === 'rejected') this.#event({ type: 'rate_limit.hit', limit: type ?? 'unknown', resetsAt });
    return { kind: 'rate-limit', info: { status, resetsAt, type, fiveHour: window('five_hour'), sevenDay: window('seven_day') } };
  }

  /** The process is gone. Open blocks have no end frame coming. */
  finish(outcome: 'clean' | 'abandoned' | 'unknown'): void {
    this.#flushMessage();
    for (const toolUseId of [...this.#tools.keys()]) this.#toolFinished(toolUseId, true);
    this.#waiting = false;
    this.#turnOpen = false;
    this.#activity = { state: 'finished', since: this.#now(), outcome };
    this.#event({ type: 'session.ended', outcome, reason: 'exit' });
    this.#d.clearRate(this.sessionId);
    this.#lastRateAt = 0;
  }

  /** The same hull flies again after a resume. */
  revive(cwd: string): void {
    this.cwd = cwd;
    this.#activity = { state: 'starting', since: this.#now() };
  }
}
