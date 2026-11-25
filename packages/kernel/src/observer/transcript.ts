// One state machine per transcript file. Records go in, in file order, and structure comes out: events, joins, usage and the
// tail state that activity is derived from. No I/O and no bus, so synthetic records can drive it. Text never leaves here.
import type { ObservedEvent, ToolFamily, ToolSummary, ToolUseId, TurnOrigin } from '@naos/protocol';
import { toolFamily } from '@naos/protocol';
import { dayKey } from './paths.ts';
import type { Raw } from './parse.ts';
import { arr, epochMs, num, obj, str, timeOf } from './parse.ts';
import type { ApiUsage } from './prices.ts';
import { SYNTHETIC_MODEL, UsageBook, contextTokensOf, tokenUsage } from './prices.ts';
import { summarizeTool } from './toolSummary.ts';

type Body<E> = E extends unknown ? Omit<E, 'id' | 'at' | 'observedAt' | 'sessionId' | 'nodeId'> : never;
export type NodeEvent = Body<ObservedEvent>;

export type Link =
  /** A launch-family tool call, so a child can find the transcript that holds its `toolUseId` (RF 4.3). */
  | { kind: 'launch'; toolUseId: ToolUseId; name: string }
  | { kind: 'agent'; toolUseId: ToolUseId; agentId: string; status: string | null; isError: boolean }
  | { kind: 'workflow'; toolUseId: ToolUseId; runId: string; taskId: string | null; name: string | null; scriptPath: string | null; transcriptDir: string | null }
  | { kind: 'notification'; toolUseId: ToolUseId | null; taskId: string | null; status: string | null };

export interface MachineSink {
  event(e: NodeEvent, at: number, offset: number): void;
  link(l: Link, at: number): void;
}

export interface OpenTool {
  toolUseId: ToolUseId;
  name: string;
  family: ToolFamily;
  startedAt: number;
  summary: ToolSummary;
}

/** The last record that says anything about what the craft is doing. Metadata re-appends never change it. */
export type LastKind =
  | 'none' | 'user' | 'assistant' | 'tool-result' | 'api-request' | 'api-error' | 'errored' | 'interrupted' | 'turn-end' | 'cost-state';

export interface ErrorState { kind: 'rate_limit' | 'api' | 'unknown'; httpStatus?: number; resetsAt?: number }

interface Pending {
  id: string;
  model: string;
  at: number;
  offset: number;
  blocks: Array<'thinking' | 'text' | 'tool_use'>;
  sizes: number[];
  usage: ApiUsage;
  stop: string | null;
  reopened: boolean;
}

const INTERRUPTED = new Set(['[Request interrupted by user]', '[Request interrupted by user for tool use]']);
const NOTIFICATION = /^\s*<task-notification>/;
const TITLE_LIMIT = 120;

const NOOP_SINK: MachineSink = { event() {}, link() {} };

const tag = (content: string, name: string): string | null => {
  const m = new RegExp(`<${name}>([^<]*)</${name}>`).exec(content);
  return m?.[1]?.trim() || null;
};

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim().slice(0, TITLE_LIMIT);

function turnOrigin(r: Raw): TurnOrigin {
  const explicit = str(r.turnOrigin);
  if (explicit) return explicit;
  const kind = str(obj(r.origin)?.kind);
  if (kind) return kind === 'task-notification' ? 'task_notification' : kind;
  return str(r.promptSource) === 'sdk' ? 'sdk' : 'unknown';
}

function userText(content: unknown): string | null {
  if (typeof content === 'string') return content;
  let text: string | null = null;
  for (const block of arr(content)) {
    const b = obj(block);
    if (b?.type === 'text' && typeof b.text === 'string') text = text === null ? b.text : `${text}\n${b.text}`;
  }
  return text;
}

export class TranscriptMachine {
  readonly book = new UsageBook();
  readonly openTools = new Map<ToolUseId, OpenTool>();
  private readonly sink: MachineSink;
  private readonly now: () => number;
  /** While true, state advances and no event leaves. Links still do, because the tree needs them. */
  silent: boolean;

  costStateUsd: number | null = null;
  last: LastKind = 'none';
  lastBlock: 'thinking' | 'text' | 'tool_use' | undefined;
  firstAt: number | null = null;
  lastAt: number | null = null;
  requestAt: number | null = null;
  retry: { attempt: number; maxRetries: number; nextAttemptAt?: number; at: number } | null = null;
  error: ErrorState | null = null;
  errorAt: number | null = null;

  firstCwd: string | null = null;
  lastCwd: string | null = null;
  relocatedCwd: string | null = null;
  gitBranch: string | null = null;
  version: string | null = null;
  entrypoint: string | null = null;
  model: string | null = null;
  requestedModel: string | null = null;
  effort: string | null = null;
  permissionMode: string | null = null;
  contextTokens: number | null = null;
  worktree: { path: string; name?: string; branch?: string; originalCwd?: string } | null = null;
  remote = false;

  customTitle: string | null = null;
  aiTitle: string | null = null;
  lastPrompt: string | null = null;
  summaryTitle: string | null = null;
  firstPrompt: string | null = null;

  queued = 0;
  turns = 0;
  toolCalls = 0;
  errors = 0;
  lastToolName: string | null = null;

  private pending: Pending | null = null;
  private lastClosedId: string | null = null;
  private turnStop: string | null = null;
  /** A message completed with no new usage flushed yet. Reads as a transition for one drain. */
  usageDirty = false;
  metaDirty = false;

  constructor(sink: MachineSink = NOOP_SINK, opts: { silent?: boolean; now?: () => number } = {}) {
    this.sink = sink;
    this.silent = opts.silent ?? false;
    this.now = opts.now ?? Date.now;
  }

  private emit(e: NodeEvent, at: number, offset: number): void {
    if (!this.silent) this.sink.event(e, at, offset);
  }

  /** Records in file order, never timestamp order (RF 3.2). */
  feed(r: Raw, offset: number): void {
    const at = timeOf(r.timestamp);
    if (at !== null) {
      if (this.firstAt === null) this.firstAt = at;
      this.lastAt = this.lastAt === null ? at : Math.max(this.lastAt, at);
    }
    const when = at ?? this.now();

    const cwd = str(r.cwd);
    if (cwd) {
      this.firstCwd ??= cwd;
      this.lastCwd = cwd;
    }
    this.gitBranch = str(r.gitBranch) ?? this.gitBranch;
    this.version = str(r.version) ?? this.version;
    this.entrypoint = str(r.entrypoint) ?? this.entrypoint;

    switch (r.type) {
      case 'assistant': return this.assistant(r, when, offset);
      case 'user': return this.user(r, when, offset);
      case 'system': return this.system(r, when, offset);
      case 'api-request': return this.apiRequest(r, when, offset);
      case 'queue-operation': return this.queue(r, when);
      case 'cost-state': {
        this.closeMessage(when, offset);
        const usd = num(r.totalCostUSD);
        if (usd !== null && usd > 0) this.costStateUsd = Math.max(this.costStateUsd ?? 0, usd);
        this.last = 'cost-state';
        this.usageDirty = true;
        return;
      }
      case 'ai-title': return this.setTitle('aiTitle', str(r.aiTitle));
      case 'custom-title': return this.setTitle('customTitle', str(r.customTitle));
      case 'summary': return this.setTitle('summaryTitle', str(r.summary));
      case 'last-prompt': {
        const text = str(r.lastPrompt);
        return this.setTitle('lastPrompt', text === null ? null : oneLine(text));
      }
      case 'bridge-session':
        this.remote = true;
        this.metaDirty = true;
        return;
      case 'permission-mode':
        this.permissionMode = str(r.permissionMode) ?? str(r.mode) ?? this.permissionMode;
        this.metaDirty = true;
        return;
      case 'relocated':
        this.relocatedCwd = str(r.relocatedCwd) ?? this.relocatedCwd;
        this.metaDirty = true;
        return;
      case 'worktree-state': {
        const w = obj(r.worktreeSession);
        const path = str(w?.worktreePath);
        if (path) {
          this.worktree = {
            path,
            ...(str(w?.worktreeName) ? { name: str(w?.worktreeName) as string } : {}),
            ...(str(w?.worktreeBranch) ? { branch: str(w?.worktreeBranch) as string } : {}),
            ...(str(w?.originalCwd) ? { originalCwd: str(w?.originalCwd) as string } : {}),
          };
          this.metaDirty = true;
        }
        return;
      }
      default:
    }
  }

  /**
   * A record of a file's head when the body between head and tail is never replayed. It says where and when the
   * transcript began. Nothing here touches usage, tools or tail state, so head and tail cannot count anything twice.
   */
  head(r: Raw): void {
    const at = timeOf(r.timestamp);
    if (at !== null && this.firstAt === null) this.firstAt = at;
    const cwd = str(r.cwd);
    if (cwd) this.firstCwd ??= cwd;
    this.gitBranch ??= str(r.gitBranch);
    this.version ??= str(r.version);
    this.entrypoint ??= str(r.entrypoint);
    if (r.type === 'custom-title') this.setTitle('customTitle', str(r.customTitle));
    if (r.type === 'ai-title') this.setTitle('aiTitle', str(r.aiTitle));
    if (r.type === 'user' && this.firstPrompt === null && r.isMeta !== true && r.isCompactSummary !== true) {
      const text = userText(obj(r.message)?.content);
      if (text !== null) this.firstPrompt = oneLine(text);
    }
  }

  private setTitle(key: 'aiTitle' | 'customTitle' | 'summaryTitle' | 'lastPrompt', value: string | null): void {
    if (value === null || this[key] === value) return;
    this[key] = value;
    this.metaDirty = true;
  }

  /** The SDK's title rule (RF 3.3). */
  title(): { title: string | null; source: 'custom' | 'ai' | 'lastPrompt' | 'summary' | 'firstPrompt' | null } {
    if (this.customTitle) return { title: this.customTitle, source: 'custom' };
    if (this.aiTitle) return { title: this.aiTitle, source: 'ai' };
    if (this.lastPrompt) return { title: this.lastPrompt, source: 'lastPrompt' };
    if (this.summaryTitle) return { title: this.summaryTitle, source: 'summary' };
    if (this.firstPrompt) return { title: this.firstPrompt, source: 'firstPrompt' };
    return { title: null, source: null };
  }

  private assistant(r: Raw, at: number, offset: number): void {
    const m = obj(r.message);
    if (r.isApiErrorMessage === true) {
      this.closeMessage(at, offset);
      return this.apiError(r, at, offset);
    }
    if (!m) return;
    const id = str(m.id) ?? str(r.uuid) ?? `@${offset}`;
    if (this.pending && this.pending.id !== id) this.closeMessage(at, offset);

    const model = str(m.model) ?? this.pending?.model ?? '';
    const p = (this.pending ??= {
      id, model, at, offset, blocks: [], sizes: [], usage: {}, stop: null, reopened: id === this.lastClosedId,
    });
    p.model = model;
    p.at = at;
    p.usage = (obj(m.usage) as ApiUsage | null) ?? p.usage;
    p.stop = str(m.stop_reason);

    if (model && model !== SYNTHETIC_MODEL) this.model = model;
    this.requestedModel = str(r.requestedModel) ?? this.requestedModel;
    this.effort = str(r.effort) ?? this.effort;
    this.last = 'assistant';
    this.error = null;
    this.retry = null;

    for (const raw of arr(m.content)) {
      const b = obj(raw);
      if (!b) continue;
      if (b.type === 'thinking') {
        p.blocks.push('thinking');
        p.sizes.push(Math.ceil((str(b.thinking)?.length ?? 0) / 4));
      } else if (b.type === 'text') {
        p.blocks.push('text');
        p.sizes.push(str(b.text)?.length ?? 0);
      } else if (b.type === 'tool_use') {
        const input = obj(b.input) ?? {};
        p.blocks.push('tool_use');
        p.sizes.push(JSON.stringify(input)?.length ?? 0);
        this.startTool(str(b.id) ?? `${id}:${p.blocks.length}`, str(b.name) ?? 'unknown', input, at, offset);
      }
    }
  }

  private startTool(toolUseId: ToolUseId, name: string, input: Raw, at: number, offset: number): void {
    if (this.openTools.has(toolUseId)) return;
    const family = toolFamily(name);
    const summary = summarizeTool(name, input, this.lastCwd);
    this.openTools.set(toolUseId, { toolUseId, name, family, startedAt: at, summary });
    this.toolCalls += 1;
    this.lastToolName = name;
    this.emit({ type: 'tool.started', toolUseId, name, toolFamily: family, summary }, at, offset);
    if (family === 'launch') this.sink.link({ kind: 'launch', toolUseId, name }, at);
  }

  private apiError(r: Raw, at: number, offset: number): void {
    const status = num(r.apiErrorStatus);
    const errorName = str(r.error);
    const kind = str(r.apiError) ?? errorName;
    this.emit({ type: 'api.error', httpStatus: status, kind }, at, offset);
    this.errors += 1;
    const quota = obj(r.quotaLimits) ?? obj(obj(r.apiErrorParams)?.rate_limit_info);
    const resetsAt = epochMs(quota?.resetsAt);
    if (quota) {
      this.emit({ type: 'rate_limit.hit', limit: str(quota.rateLimitType) ?? 'unknown', resetsAt }, at, offset);
    }
    const limited = errorName === 'rate_limit' || status === 429 || quota !== null;
    this.error = {
      kind: limited ? 'rate_limit' : kind ? 'api' : 'unknown',
      ...(status !== null ? { httpStatus: status } : {}),
      ...(resetsAt !== null ? { resetsAt } : {}),
    };
    this.errorAt = at;
    this.last = 'errored';
  }

  private user(r: Raw, at: number, offset: number): void {
    const m = obj(r.message);
    const content = m?.content;
    let hadResult = false;
    for (const raw of arr(content)) {
      const b = obj(raw);
      if (b?.type === 'tool_result') {
        hadResult = true;
        this.finishTool(b, r, at, offset);
      }
    }
    const result = obj(r.toolUseResult);
    const toolUseId = this.resultToolUseId(content);
    if (result && toolUseId) this.joinFromResult(result, toolUseId, content, at);

    this.permissionMode = str(r.permissionMode) ?? this.permissionMode;

    if (hadResult) {
      this.last = 'tool-result';
      this.maybeEndTurn(at, offset);
      return;
    }
    if (r.isMeta === true || r.isCompactSummary === true) return;
    const text = userText(content);
    if (text === null) return;

    this.closeMessage(at, offset);
    if (INTERRUPTED.has(text.trim())) {
      this.dropOpenTools(at, offset);
      this.last = 'interrupted';
      this.turnStop = null;
      return;
    }
    this.firstPrompt ??= oneLine(text);
    this.turns += 1;
    this.last = 'user';
    this.error = null;
    this.retry = null;
    this.turnStop = null;
    this.emit({ type: 'turn.started', origin: turnOrigin(r) }, at, offset);
  }

  private resultToolUseId(content: unknown): ToolUseId | null {
    for (const raw of arr(content)) {
      const b = obj(raw);
      if (b?.type === 'tool_result') return str(b.tool_use_id);
    }
    return null;
  }

  private joinFromResult(result: Raw, toolUseId: ToolUseId, content: unknown, at: number): void {
    const runId = str(result.runId);
    if (runId) {
      this.sink.link({
        kind: 'workflow', toolUseId, runId, taskId: str(result.taskId), name: str(result.workflowName),
        scriptPath: str(result.scriptPath), transcriptDir: str(result.transcriptDir),
      }, at);
      return;
    }
    const agentId = str(result.agentId);
    if (agentId) {
      const isError = arr(content).some((raw) => obj(raw)?.is_error === true);
      this.sink.link({ kind: 'agent', toolUseId, agentId, status: str(result.status), isError }, at);
    }
  }

  private finishTool(block: Raw, r: Raw, at: number, offset: number): void {
    const toolUseId = str(block.tool_use_id);
    const tool = toolUseId ? this.openTools.get(toolUseId) : undefined;
    if (!toolUseId || !tool) return;
    this.openTools.delete(toolUseId);

    const pd = obj(r.permissionDecision);
    const raw = str(pd?.decision);
    const decision = raw === 'accept' || raw === 'reject' ? raw : null;
    const kind = str(r.toolDenialKind);
    const denial = decision === 'reject' || kind ? { kind, source: str(pd?.source) } : null;
    const isError = block.is_error === true;
    if (isError) this.errors += 1;
    this.emit({
      type: 'tool.finished', toolUseId, name: tool.name, toolFamily: tool.family, isError, decision, denial,
      durationMs: Math.max(0, at - tool.startedAt),
    }, at, offset);
  }

  /** An interrupt leaves calls that will never resolve, and a beam must not burn on after the turn. */
  private dropOpenTools(at: number, offset: number): void {
    for (const tool of this.openTools.values()) {
      this.emit({
        type: 'tool.finished', toolUseId: tool.toolUseId, name: tool.name, toolFamily: tool.family, isError: true,
        decision: null, denial: null, durationMs: Math.max(0, at - tool.startedAt),
      }, at, offset);
    }
    this.openTools.clear();
  }

  private system(r: Raw, at: number, offset: number): void {
    switch (r.subtype) {
      case 'api_error': {
        const attempt = num(r.retryAttempt) ?? 0;
        const maxRetries = num(r.maxRetries) ?? 0;
        const retryInMs = num(r.retryInMs) ?? 0;
        this.emit({ type: 'api.retry', attempt, maxRetries, retryInMs }, at, offset);
        this.retry = { attempt, maxRetries, nextAttemptAt: at + retryInMs, at };
        this.last = 'api-error';
        return;
      }
      case 'compact_boundary': {
        const c = obj(r.compactMetadata);
        const trigger = str(c?.trigger);
        const postTokens = num(c?.postTokens) ?? 0;
        this.emit({
          type: 'compacted',
          trigger: trigger === 'manual' || trigger === 'auto' ? trigger : 'unknown',
          preTokens: num(c?.preTokens) ?? 0,
          postTokens,
          durationMs: num(c?.durationMs) ?? 0,
        }, at, offset);
        this.contextTokens = postTokens;
        this.usageDirty = true;
        return;
      }
      case 'permission_denied': {
        const name = str(r.toolName) ?? str(r.tool_name) ?? 'unknown';
        const toolUseId = str(r.toolUseId) ?? str(r.tool_use_id);
        this.emit({
          type: 'tool.denied', toolUseId, name, toolFamily: toolFamily(name),
          denial: { kind: str(r.reasonType) ?? str(r.toolDenialKind), source: str(r.source) },
        }, at, offset);
        return;
      }
      default:
    }
  }

  private apiRequest(r: Raw, at: number, offset: number): void {
    this.closeMessage(at, offset);
    const model = str(obj(r.params)?.model) ?? '';
    this.emit({ type: 'request.started', model, querySource: str(r.querySource) }, at, offset);
    if (this.model === null && model) this.model = model;
    this.requestAt = at;
    this.last = 'api-request';
    this.error = null;
    this.retry = null;
  }

  private queue(r: Raw, at: number): void {
    const op = str(r.operation);
    if (op === 'enqueue') {
      this.queued += 1;
      const content = str(r.content);
      if (content && NOTIFICATION.test(content)) {
        this.sink.link({
          kind: 'notification', toolUseId: tag(content, 'tool-use-id'), taskId: tag(content, 'task-id'), status: tag(content, 'status'),
        }, at);
      }
    } else if (op === 'dequeue' || op === 'remove') {
      this.queued = Math.max(0, this.queued - 1);
    }
    this.metaDirty = true;
  }

  private maybeEndTurn(at: number, offset: number): void {
    if (this.turnStop === null || this.openTools.size > 0) return;
    this.emit({ type: 'turn.ended', stopReason: this.turnStop }, at, offset);
    this.turnStop = null;
    this.last = 'turn-end';
  }

  private closeMessage(at: number, offset: number): void {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    this.lastClosedId = p.id;

    const thinking = p.usage.output_tokens_details?.thinking_tokens;
    const thinkingBlocks = p.blocks.filter((b) => b === 'thinking').length;
    if (typeof thinking === 'number' && thinkingBlocks > 0) {
      const each = Math.round(thinking / thinkingBlocks);
      p.blocks.forEach((b, i) => { if (b === 'thinking') p.sizes[i] = each; });
    }

    const partial = p.stop === null;
    this.book.record(p.id, p.model, p.usage, partial, dayKey(p.at));
    this.usageDirty = true;
    if (p.model !== SYNTHETIC_MODEL) this.contextTokens = contextTokensOf(p.usage);
    const lastBlock = p.blocks.at(-1);
    if (lastBlock) this.lastBlock = lastBlock;

    if (!p.reopened && p.model !== SYNTHETIC_MODEL) {
      this.emit({
        type: 'message.completed', messageId: p.id, model: p.model, blocks: p.blocks, blockSizes: p.sizes,
        usage: tokenUsage(p.usage, partial),
      }, p.at, p.offset);
    }
    this.turnStop = p.stop !== null && p.stop !== 'tool_use' ? p.stop : null;
    this.maybeEndTurn(at, offset);
  }

  /**
   * All blocks of a response normally arrive in one flush, so a chunk end is the honest place to close a message whose
   * stop reason is final. A later record with the same id updates usage and adds tools, without a second `message.completed`.
   */
  endChunk(): void {
    const p = this.pending;
    if (p && p.stop !== null) this.closeMessage(p.at, p.offset);
  }

  /** The transcript ended, so a message that never got a stop reason closes as it is. */
  close(): void {
    const p = this.pending;
    if (p) this.closeMessage(p.at, p.offset);
  }

  /** Shrink or replacement: what was open may be gone from the file. Totals stay, nothing on disk can correct them. */
  resetTail(): void {
    this.pending = null;
    this.openTools.clear();
    this.turnStop = null;
    this.last = 'none';
  }

  /** How a finished transcript ended (RF 3.5). */
  outcome(): 'clean' | 'abandoned' | 'unknown' {
    if (this.openTools.size > 0 || this.last === 'api-request') return 'abandoned';
    if (this.last === 'cost-state' || this.last === 'turn-end') return 'clean';
    return 'unknown';
  }
}
