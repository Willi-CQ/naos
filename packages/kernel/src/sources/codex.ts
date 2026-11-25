import fs from 'node:fs/promises';
import path from 'node:path';
import { toolFamily, type Activity, type ActiveTool, type PlanState } from '@naos/protocol';
import { drain, newCursor, type Cursor } from '../observer/tail.ts';
import { blankSnapshot, type SourceSnapshot } from './session.ts';

type Obj = Record<string, unknown>;
const object = (value: unknown): Obj => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Obj : {};
const text = (value: unknown): string | null => typeof value === 'string' && value.length < 2048 ? value : null;
const identifier = (value: unknown): string | null => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value) ? value : null;
const count = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

export function codexPlan(value: unknown, at: number): PlanState | null {
  const limits = object(value);
  if (!limits.primary && !limits.secondary) return null;
  const windows = [object(limits.primary), object(limits.secondary)];
  const window = (minutes: number) => windows.find((w) => w.window_minutes === minutes);
  const left = (w: Obj | undefined): number | null => w && typeof w.used_percent === 'number' && Number.isFinite(w.used_percent)
    ? Math.max(0, Math.min(1, 1 - w.used_percent / 100)) : null;
  const reset = (w: Obj | undefined): number | null => typeof w?.resets_at === 'number' && Number.isFinite(w.resets_at)
    ? w.resets_at * (w.resets_at < 1e12 ? 1000 : 1) : null;
  const five = window(300), seven = window(10080);
  const f = left(five), s = left(seven);
  return { fiveHourLeft: f, sevenDayLeft: s, asOf: at, resetsAt: { fiveHour: reset(five), sevenDay: reset(seven) },
    status: f === 0 || s === 0 ? 'rejected' : f === null && s === null ? 'unknown' : (f ?? 1) < 0.1 || (s ?? 1) < 0.1 ? 'allowed_warning' : 'allowed' };
}

export class CodexLog {
  readonly stats = { parseErrors: 0, unknownRecords: 0 };
  snapshot: SourceSnapshot;
  readonly cursor: Cursor;
  private readonly tools = new Map<string, ActiveTool>();

  constructor(file: string, at: number) {
    this.cursor = newCursor(file);
    this.snapshot = blankSnapshot('', at);
    this.snapshot.path = file;
    this.snapshot.capabilities = ['activity', 'tools', 'tokens', 'context', 'hierarchy'];
  }

  accept(line: string): void {
    let record: Obj;
    try { record = object(JSON.parse(line)); } catch { this.stats.parseErrors += 1; return; }
    const p = object(record.payload);
    const time = typeof record.timestamp === 'number' ? record.timestamp : typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : Number.NaN;
    const at = Number.isFinite(time) ? time : this.snapshot.updatedAt;
    const s = this.snapshot;
    // Fork rollouts include their parent's earlier history. Its metadata must never replace this thread's identity.
    if (s.nativeId && (record.type === 'session_meta' || at < s.startedAt)) return;
    s.updatedAt = Math.max(s.updatedAt, at);
    const state = (activity: Activity) => { s.activity = activity; };
    if (record.type === 'session_meta') {
      s.nativeId = identifier(p.id) ?? identifier(p.session_id) ?? s.nativeId;
      s.cwd = text(p.cwd);
      s.startedAt = at;
      s.parentId = identifier(p.parent_thread_id) ?? identifier(object(object(object(p.source).subagent).thread_spawn).parent_thread_id);
      s.agentType = text(p.agent_nickname);
      s.version = text(p.cli_version);
      s.contextWindow = count(p.context_window) || null;
      s.branch = text(object(p.git).branch);
    } else if (record.type === 'turn_context') {
      s.model = text(p.model) ?? s.model;
      s.effort = text(p.effort) ?? s.effort;
      s.cwd = text(p.cwd) ?? s.cwd;
    } else if (record.type === 'event_msg') {
      switch (p.type) {
        case 'task_started': case 'turn_started':
          this.tools.clear(); state({ state: 'generating', since: at }); s.contextWindow = count(p.model_context_window) || s.contextWindow; break;
        case 'task_complete': case 'task_completed': case 'turn_complete':
          this.tools.clear(); state({ state: 'idle', since: at, backgroundShell: false }); break;
        case 'turn_aborted':
          this.tools.clear(); state({ state: 'interrupted', since: at }); break;
        case 'token_count': {
          s.plan = codexPlan(p.rate_limits, at) ?? s.plan;
          const info = object(p.info);
          const usage = object(info.total_token_usage);
          if (Object.keys(usage).length > 0) {
            const cached = count(usage.cached_input_tokens);
            s.usage = { ...s.usage, input: Math.max(0, count(usage.input_tokens) - cached), cacheRead: cached,
              output: count(usage.output_tokens), messages: s.usage.messages + 1 };
          }
          const last = object(info.last_token_usage);
          s.contextTokens = count(last.total_tokens) || count(last.input_tokens) + count(last.output_tokens) || s.contextTokens;
          s.contextWindow = count(info.model_context_window) || s.contextWindow;
          break;
        }
        case 'thread_settings_applied': {
          const settings = object(p.thread_settings);
          s.model = text(settings.model) ?? s.model;
          s.effort = text(settings.reasoning_effort) ?? s.effort;
          break;
        }
        default: break;
      }
    } else if (record.type === 'response_item') {
      const id = text(p.call_id) ?? text(p.id);
      if ((p.type === 'function_call' || p.type === 'custom_tool_call') && id) {
        const name = text(p.name) ?? 'tool';
        const familyName = p.namespace === 'web' && name === 'run' ? 'web.run' : name;
        this.tools.set(id, { toolUseId: id, name, family: toolFamily(familyName), startedAt: at });
        s.toolCalls += 1;
        state({ state: 'tool_running', since: at, tools: [...this.tools.values()] });
      } else if ((p.type === 'function_call_output' || p.type === 'custom_tool_call_output') && id) {
        this.tools.delete(id);
        state(this.tools.size ? { state: 'tool_running', since: at, tools: [...this.tools.values()] } : { state: 'generating', since: at });
      }
    } else if (typeof record.type !== 'string' || !['token_usage_record', 'world_state', 'inter_agent_communication_metadata'].includes(record.type)) this.stats.unknownRecords += 1;
  }

  async read(): Promise<void> {
    const result = await drain(this.cursor, (line) => this.accept(line.toString('utf8')));
    if (result.state === 'reset') {
      // A rewritten rollout must not add old tool counts to its new contents.
      const next = new CodexLog(this.cursor.path, this.cursor.mtimeMs);
      await next.read();
      this.snapshot = next.snapshot;
      this.tools.clear();
      for (const [id, tool] of next.tools) this.tools.set(id, tool);
      Object.assign(this.cursor, next.cursor);
      return;
    }
    this.snapshot.bytes = this.cursor.size;
  }
}

/** Only dated session folders are traversed. Credentials and arbitrary paths cannot enter this walk. */
export async function codexFiles(root: string, now: number): Promise<Array<{ file: string; at: number }>> {
  const found: Array<{ file: string; at: number }> = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (found.length >= 512) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && depth < 3 && /^\d{2,4}$/.test(entry.name)) await walk(full, depth + 1);
      else if (entry.isFile() && /^rollout-.*\.jsonl$/.test(entry.name)) {
        const stat = await fs.stat(full).catch(() => null);
        if (stat && now - stat.mtimeMs < 24 * 60 * 60_000) found.push({ file: full, at: stat.mtimeMs });
      }
    }
  };
  await walk(root, 0);
  return found.sort((a, b) => b.at - a.at);
}
