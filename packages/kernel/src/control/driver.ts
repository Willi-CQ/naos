// One managed agent: one query(), one never-ending input stream, one stop that leaves no orphan. From AC 3.1, which ran.
// The state machine lives in the supervisor. This file only knows the process.
import { query as sdkQuery, type Options, type Query, type SDKMessage, type SDKMessageOrigin, type SDKResultMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { UUID } from 'node:crypto';
import type { StopStep } from '@naos/protocol';
import { treeKill as realTreeKill, type TreeKill } from './procs.ts';

export type QueryFn = (params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => Query;

/** Parent environment minus anything a surrounding Claude session exported, and minus every NAOS secret. Adds no auth of any kind. */
export function agentEnv(extra: Record<string, string> = {}, source: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...source };
  for (const k of Object.keys(env)) {
    const u = k.toUpperCase();
    if (u === 'CLAUDECODE' || u === 'CLAUDE_PID' || u === 'CLAUDE_EFFORT' || u.startsWith('CLAUDE_CODE_')
      || u.startsWith('CLAUDE_AGENT_SDK_') || u.startsWith('NAOS_')) delete env[k];
  }
  return { ...env, ...extra };
}

/** A finite iterable closes stdin when it ends, and the child exits (AC 1.6). */
class InputQueue {
  #q: SDKUserMessage[] = [];
  #wake: (() => void) | null = null;
  #ended = false;
  push(message: SDKUserMessage): void {
    this.#q.push(message);
    this.#wake?.();
  }
  end(): void {
    this.#ended = true;
    this.#wake?.();
  }
  async *stream(): AsyncGenerator<SDKUserMessage> {
    for (;;) {
      while (this.#q.length) yield this.#q.shift()!;
      if (this.#ended) return;
      await new Promise<void>((r) => { this.#wake = r; });
      this.#wake = null;
    }
  }
}

const within = <T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> => {
  let timer: NodeJS.Timeout | undefined;
  const clock = new Promise<'timeout'>((r) => { timer = setTimeout(() => r('timeout'), ms); });
  return Promise.race([p, clock]).finally(() => clearTimeout(timer));
};

export interface SendInput {
  uuid: UUID;
  text: string;
  /** 'now' aborts the running turn and jumps the queue. Everything else waits in the kernel's queue. */
  priority?: 'now';
  origin?: SDKMessageOrigin;
  /** Agent-composed text: no `@path` expansion, no slash commands. */
  composed?: boolean;
}

export interface DriverHooks {
  onFrame(frame: SDKMessage): void;
  onExit(info: { clean: boolean; error: string | null }): void;
}

export interface StopOptions {
  /** A turn is running, so an interrupt ends in a result. An idle agent emits none (AC 2.4). */
  busy: boolean;
  interruptMs?: number;
  exitMs?: number;
  onStep?: (step: StopStep) => void;
}

/** Resuming a session whose background task died yields a result with no uuid, no turns, no cost (AC 2.5). */
export const isSynthetic = (m: SDKResultMessage): boolean => m.num_turns === 0 && !m.user_message_uuid;

export class ManagedAgent {
  readonly id: string;
  pid: number | null = null;
  #input = new InputQueue();
  #q: Query;
  #done: Promise<void>;
  #resultSeen: (() => void) | null = null;
  #hooks: DriverHooks;
  #treeKill: TreeKill;

  constructor(id: string, options: Options, hooks: DriverHooks, query: QueryFn = sdkQuery as QueryFn, treeKill: TreeKill = realTreeKill) {
    this.id = id;
    this.#hooks = hooks;
    this.#treeKill = treeKill;
    this.#q = query({ prompt: this.#input.stream(), options });
    this.#done = this.#pump();
  }

  async #pump(): Promise<void> {
    let exit: { clean: boolean; error: string | null } = { clean: true, error: null };
    try {
      for await (const m of this.#q) {
        this.#hooks.onFrame(m);
        if (m.type === 'result' && !isSynthetic(m)) this.#resultSeen?.();
      }
    } catch (e) {
      exit = { clean: false, error: String((e as Error).message) };
    }
    this.#hooks.onExit(exit);
  }

  /** Resolves when the process answers. `pid` is not in the public type (AC 2.8). */
  async ready(): Promise<void> {
    const init = await this.#q.initializationResult();
    this.pid = (init as unknown as { pid?: number }).pid ?? null;
  }

  send(s: SendInput): void {
    this.#input.push({
      type: 'user',
      message: { role: 'user', content: s.text },
      parent_tool_use_id: null,
      uuid: s.uuid,
      ...(s.priority ? { priority: s.priority } : {}),
      ...(s.origin ? { origin: s.origin } : {}),
      ...(s.composed ? { client_composed: true as const } : {}),
    });
  }

  /**
   * Order matters on Windows. Interrupt kills the tool tree and stops the model, end of input lets the CLI write cost-state
   * and remove its session file, the tree kill is the last resort, close() only frees the SDK. close() or abort() first would
   * orphan the tool and keep spending (AC 1.3, 1.4).
   */
  async stop({ busy, interruptMs = 2000, exitMs = 6000, onStep }: StopOptions): Promise<'graceful' | 'forced'> {
    const result = new Promise<void>((r) => { this.#resultSeen = r; });
    onStep?.('interrupt');
    await within(this.#q.interrupt().catch(() => undefined), interruptMs);
    if (busy) await within(result, interruptMs);
    this.#resultSeen = null;
    onStep?.('end of input');
    this.#input.end();
    if ((await within(this.#done, exitMs)) !== 'timeout') return 'graceful';
    onStep?.('tree kill');
    await this.kill();
    return 'forced';
  }

  /** Last resort, and the only path that may call close(). */
  async kill(): Promise<void> {
    if (this.pid) await this.#treeKill(this.pid);
    this.#input.end();
    this.#q.close();
    await within(this.#done, 1500);
  }
}
