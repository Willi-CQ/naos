// A scripted stand-in for the Agent SDK, plus the real bus, router and database around it. No model calls and no processes.
// Frame shapes follow what the spikes recorded (AC 2). Everything in them is made up: no transcript content lives in this repo.
import type { Options, PermissionResult, Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { NaosEvent } from '@naos/protocol';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBus, type KernelBus } from '../../src/bus.ts';
import type { KernelConfig, KernelContext, Logger } from '../../src/context.ts';
import { createControl, type Control, type ControlOverrides } from '../../src/control/index.ts';
import type { Proc } from '../../src/control/procs.ts';
import { openDb, type KernelDb } from '../../src/db.ts';
import { createRouter, type KernelRouter } from '../../src/server/router.ts';
import { createWorlds, type KernelWorlds } from '../../src/worlds.ts';

export const quiet: Logger = { info() {}, warn() {}, error() {} };

export const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function until(check: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('condition not reached');
    await tick(2);
  }
}

export function tmpDir(prefix = 'naos-control-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const frame = (m: Record<string, unknown>): SDKMessage => m as unknown as SDKMessage;

export const frames = {
  init: (sessionId: string, cwd = 'C:/x'): SDKMessage => frame({
    type: 'system', subtype: 'init', session_id: sessionId, cwd, model: 'claude-haiku-5-5', permissionMode: 'default',
    tools: ['Read'], mcp_servers: [{ name: 'os', status: 'connected' }], skills: ['one', 'two'], claude_code_version: '2.1.314',
  }),
  requesting: (): SDKMessage => frame({ type: 'system', subtype: 'status', status: 'requesting' }),
  messageStart: (id: string, input = 100): SDKMessage => frame({
    type: 'stream_event', parent_tool_use_id: null, ttft_ms: 900,
    event: { type: 'message_start', message: { id, model: 'claude-haiku-5-5', usage: { input_tokens: input, cache_read_input_tokens: 7, cache_creation_input_tokens: 3, output_tokens: 1 } } },
  }),
  blockStart: (kind: 'text' | 'thinking'): SDKMessage => frame({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_start', content_block: { type: kind } } }),
  textDelta: (text: string): SDKMessage => frame({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } }),
  messageDelta: (output: number): SDKMessage => frame({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'message_delta', usage: { output_tokens: output } } }),
  thinkingTokens: (total: number, delta: number): SDKMessage => frame({ type: 'system', subtype: 'thinking_tokens', estimated_tokens: total, estimated_tokens_delta: delta }),
  assistantText: (id: string, text: string): SDKMessage => frame({
    type: 'assistant', parent_tool_use_id: null, message: { id, model: 'claude-haiku-5-5', content: [{ type: 'text', text }], usage: { input_tokens: 100, output_tokens: 1 } },
  }),
  assistantTool: (id: string, toolUseId: string, name: string, input: Record<string, unknown>): SDKMessage => frame({
    type: 'assistant', parent_tool_use_id: null, message: { id, model: 'claude-haiku-5-5', content: [{ type: 'tool_use', id: toolUseId, name, input }], usage: { input_tokens: 100, output_tokens: 1 } },
  }),
  toolResult: (toolUseId: string, isError = false): SDKMessage => frame({
    type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, is_error: isError, content: 'private tool output' }] },
  }),
  result: (o: { uuids: string[]; cost: number; reason?: string; subtype?: string; isError?: boolean; text?: string; numTurns?: number }): SDKMessage => frame({
    type: 'result', subtype: o.subtype ?? 'success', is_error: o.isError ?? false, num_turns: o.numTurns ?? 1, stop_reason: 'end_turn',
    terminal_reason: o.reason ?? 'completed', total_cost_usd: o.cost, result: o.text ?? 'private final text',
    user_message_uuid: o.uuids.at(-1), user_message_uuids: o.uuids, permission_denials: [],
    modelUsage: { 'claude-haiku-5-5': { contextWindow: 200000 } },
    subagent_stats: { spawned: 2, max_depth: 1, completed: 1, failed: 0, killed: 0, refused: { depth_limit: 1, concurrency_limit: 0, budget: 0 } },
  }),
  rateLimit: (status: string, utilization = 0.1, resetsAt = 1893456000): SDKMessage => frame({
    type: 'rate_limit_event',
    rate_limit_info: { status, resetsAt, rateLimitType: 'five_hour', unifiedWindows: { five_hour: { utilization, resetsAt, status }, seven_day: { utilization: 0.03, resetsAt, status } } },
  }),
};

/** What one fake process does with a message. The default answers with one short turn. */
export type Script = (p: FakeProcess, message: SDKUserMessage) => void | Promise<void>;

export const reply: Script = (p, m) => {
  p.costUsd += 0.001;
  const id = `msg_${p.sent.length}`;
  p.emit(frames.init(p.sessionId, p.cwd));
  p.emit(frames.requesting());
  p.emit(frames.messageStart(id));
  p.emit(frames.blockStart('text'));
  p.emit(frames.textDelta('private'));
  p.emit(frames.assistantText(id, 'private'));
  p.emit(frames.messageDelta(5));
  p.emit(frames.result({ uuids: [m.uuid!], cost: p.costUsd }));
};

/** Takes a send and answers nothing, so a test can hold a turn open. */
export const hold: Script = () => {};

export class FakeProcess {
  readonly options: Options;
  readonly sent: SDKUserMessage[] = [];
  readonly pid: number;
  readonly controllers: AbortController[] = [];
  sessionId: string;
  costUsd = 0;
  script: Script;
  interrupts = 0;
  closed = false;
  ended = false;
  /** Exit by itself at end of input. Off: the process hangs, so stop must reach the tree kill. */
  exitOnEof = true;
  #frames: SDKMessage[] = [];
  #wake: (() => void) | null = null;
  #done = false;
  #error: Error | null = null;

  constructor(options: Options, prompt: AsyncIterable<SDKUserMessage>, script: Script, pid: number) {
    this.options = options;
    this.script = script;
    this.pid = pid;
    this.sessionId = options.sessionId ?? options.resume ?? randomUUID();
    void this.#readInput(prompt);
  }

  get cwd(): string { return options(this); }

  async #readInput(prompt: AsyncIterable<SDKUserMessage>): Promise<void> {
    for await (const m of prompt) {
      this.sent.push(m);
      await this.script(this, m);
    }
    this.ended = true;
    if (this.exitOnEof) this.exit();
  }

  emit(m: SDKMessage): void {
    this.#frames.push(m);
    this.#wake?.();
  }

  exit(error?: string): void {
    this.#done = true;
    if (error) this.#error = new Error(error);
    this.#wake?.();
  }

  /** What the CLI does for a call nothing else approved. */
  ask(toolName: string, input: Record<string, unknown>, extra: Record<string, unknown> = {}): Promise<PermissionResult> {
    const controller = new AbortController();
    this.controllers.push(controller);
    return this.options.canUseTool!(toolName, input, {
      signal: controller.signal, toolUseID: `tu_${randomUUID().slice(0, 8)}`, requestId: randomUUID(), suggestions: [], ...extra,
    } as never) as Promise<PermissionResult>;
  }

  [Symbol.asyncIterator](): this { return this; }

  async next(): Promise<IteratorResult<SDKMessage, void>> {
    for (;;) {
      if (this.#frames.length > 0) return { value: this.#frames.shift()!, done: false };
      if (this.#done) {
        if (this.#error) throw this.#error;
        return { value: undefined, done: true };
      }
      await new Promise<void>((r) => { this.#wake = r; });
      this.#wake = null;
    }
  }

  async return(): Promise<IteratorResult<SDKMessage, void>> { return { value: undefined, done: true }; }
  async throw(e: unknown): Promise<IteratorResult<SDKMessage, void>> { throw e; }
  async initializationResult(): Promise<unknown> { return { pid: this.pid }; }

  async interrupt(): Promise<undefined> {
    this.interrupts += 1;
    for (const c of this.controllers) c.abort();
    this.onInterrupt?.();
    return undefined;
  }

  onInterrupt: (() => void) | null = null;

  close(): void {
    this.closed = true;
    this.exit();
  }
}

const options = (p: FakeProcess): string => p.options.cwd ?? '';

export class FakeSdk {
  readonly processes: FakeProcess[] = [];
  script: Script = reply;
  /** Runs when query() is called, before anything else. */
  beforeQuery: ((o: Options) => void) | null = null;
  #pid = 40_000;

  query = (params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }): Query => {
    this.beforeQuery?.(params.options);
    const p = new FakeProcess(params.options, params.prompt, this.script, (this.#pid += 4));
    this.processes.push(p);
    return p as unknown as Query;
  };

  get last(): FakeProcess {
    return this.processes.at(-1)!;
  }
}

export interface Rig {
  sdk: FakeSdk;
  control: Control;
  ctx: KernelContext;
  bus: KernelBus;
  db: KernelDb;
  router: KernelRouter;
  worlds: KernelWorlds;
  events: NaosEvent[];
  texts: Array<{ nodeId: string; delta: string }>;
  home: string;
  repo: string;
  claudeHome: string;
  kills: number[];
  procs: Proc[];
  stop(): Promise<void>;
  /** A folder that is already a known world. */
  of<T extends NaosEvent['type']>(type: T): Array<Extract<NaosEvent, { type: T }>>;
}

const PROFILES = {
  'build.md': '---\nname: build\ndescription: b\nmodel: claude-haiku-5-5\neffort: low\npermissionMode: default\ndefaultBudgetUsd: 0.05\nmaxTurns: 8\n---\nBody of build.\n',
  'plain.md': '---\nname: plain\nmodel: claude-haiku-5-5\npermissionMode: default\ndefaultBudgetUsd: 0.05\n---\n',
  'orchestrator.md': '---\nname: orchestrator\nmodel: claude-haiku-5-5\npermissionMode: default\ndefaultBudgetUsd: 0.05\norchestrator: true\ntools: [Read]\n---\nLead.\n',
  'long.md': '---\nname: long\nmodel: claude-haiku-5-5\npermissionMode: auto\ndefaultBudgetUsd: 0.05\n---\n',
  'scratch.md': '---\nname: scratch\nmodel: claude-haiku-5-5\npermissionMode: default\ndefaultBudgetUsd: 0.05\npersist: false\nsettings: none\n---\n',
};

export async function makeRig(o: { home?: string; overrides?: ControlOverrides; sdk?: FakeSdk; procs?: Proc[]; boot?: boolean; claudeHome?: string; tempRoots?: readonly string[] } = {}): Promise<Rig> {
  const home = o.home ?? tmpDir();
  const repo = tmpDir('naos-repo-');
  const claudeHome = o.claudeHome ?? tmpDir('naos-claude-');
  const profilesDir = path.join(home, 'agents');
  fs.mkdirSync(profilesDir, { recursive: true });
  for (const [file, text] of Object.entries(PROFILES)) fs.writeFileSync(path.join(profilesDir, file), text);

  const config: KernelConfig = { mode: 'live', port: 0, home, claudeHome, uiDist: '', repoRoot: home, devOrigins: [] };
  const bus = createBus({ kernel: { version: 't', protocol: 1, pid: process.pid, startedAt: 0, mode: 'live', veilSalt: '', controlPlane: true }, log: quiet });
  const db = openDb(path.join(home, 'naos.db'));
  const router = createRouter(quiet);
  const worlds = createWorlds({ home, bus, log: quiet, tempRoots: o.tempRoots ?? ['C:/__naos_not_temp__'] });
  const events: NaosEvent[] = [];
  bus.subscribe((e) => { events.push(e); });
  const texts: Rig['texts'] = [];
  bus.onText((nodeId, delta) => texts.push({ nodeId, delta }));

  const sdk = o.sdk ?? new FakeSdk();
  const kills: number[] = [];
  const procs = o.procs ?? [];
  const control = createControl({
    query: sdk.query,
    snapshot: async () => procs,
    treeKill: async (pid) => { kills.push(pid); return true; },
    resolveSettings: async () => ({ effective: { hooks: { PostToolUse: [] } }, provenance: {}, sources: [{ source: 'user', settings: {} }] }) as never,
    profilesDir,
    ...o.overrides,
  });
  const ctx: KernelContext = { config, bus, router, db, log: quiet, worlds, managed: control.registry };
  if (o.boot !== false) await control.start(ctx);
  let stopped = false;
  return {
    sdk, control, ctx, bus, db, router, worlds, events, texts, home, repo, claudeHome, kills, procs,
    of: <T extends NaosEvent['type']>(type: T) => events.filter((e): e is Extract<NaosEvent, { type: T }> => e.type === type),
    async stop() {
      if (stopped) return;
      stopped = true;
      await control.stop();
      db.close();
    },
  };
}

/** Writes the file a resume looks for, as the CLI would have. */
export function fakeTranscript(claudeHome: string, cwd: string, sessionId: string): void {
  const dir = path.join(claudeHome, 'projects', path.resolve(cwd).replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${sessionId}.jsonl`), '');
}
