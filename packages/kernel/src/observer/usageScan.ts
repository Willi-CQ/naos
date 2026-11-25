// Full parse for usage, run in the worker. 2.2 GB of transcript is mostly tool output and prompts, so a line is parsed only
// when a byte search says it matters. Shares UsageBook with the live tail, so both price a message the same way.
import fsp from 'node:fs/promises';
import type { NodeId, TokenUsage } from '@naos/protocol';
import { toolFamily } from '@naos/protocol';
import { dayKey } from './paths.ts';
import { isApiRequestBody, isApiRequestLine, Sensor, parseLine, arr, num, obj, str, timeOf } from './parse.ts';
import type { ApiUsage, ModelBucket } from './prices.ts';
import { UsageBook, SYNTHETIC_MODEL } from './prices.ts';
import { newCursor, scanLines } from './tail.ts';

const READ_CHUNK = 1024 * 1024;
const ASSISTANT = Buffer.from('"type":"assistant"');
const USER = Buffer.from('"type":"user"');
const COST_STATE = Buffer.from('{"type":"cost-state"');
const TOOL_USE_ID = Buffer.from('"tool_use_id":"');
const IS_ERROR = Buffer.from('"is_error":true');
const HUMAN_MARKS = ['"user_temporary"', '"user_abort"', '"user-rejected"'].map((s) => Buffer.from(s));
const JOIN_MARKS = ['"runId"', '"canContinueAgent"'].map((s) => Buffer.from(s));
const QUOTE = 0x22;
/** One wait left overnight should not read as hours of blocking. */
const BLOCK_CAP_MS = 4 * 3_600_000;

export interface FileSummary {
  path: string;
  size: number;
  mtimeMs: number;
  /** Bytes covered. Less than `size` for a live file, whose tail reads the rest. */
  parsedTo: number;
  complete: boolean;
  usage: TokenUsage;
  estimateUsd: number;
  byModel: Record<string, ModelBucket>;
  byDay: Record<string, number>;
  unpriced: string[];
  costStateUsd: number | null;
  firstAt: number | null;
  lastAt: number | null;
  model: string | null;
  toolCalls: number;
  errors: number;
  /** Estimate from tool calls a human decided. null when none was found. */
  blockedMs: number | null;
  outcome: 'clean' | 'abandoned' | 'unknown';
  lastMessage: { id: string; usage: TokenUsage; usd: number } | null;
  agentLinks: Array<{ agentId: string; toolUseId: string }>;
  runLinks: Array<{ runId: string; toolUseId: string; taskId: string | null; name: string | null }>;
}

export interface JournalSummary { path: string; size: number; mtimeMs: number; failedAgentIds: string[]; completedAgentIds: string[] }

export type Pace = () => Promise<void>;

interface OpenCall { at: number | null; name: string }

interface Message { id: string; model: string; usage: ApiUsage; stop: string | null; at: number }

export async function scanTranscript(file: string, size: number, mtimeMs: number, to: number | null, pace: Pace): Promise<FileSummary | null> {
  const limit = to ?? size;
  let fh;
  try {
    fh = await fsp.open(file, 'r');
  } catch {
    return null;
  }

  const sensor = new Sensor();
  const book = new UsageBook();
  const open = new Map<string, OpenCall>();
  let pending: Message | null = null;
  let firstAt: number | null = null;
  let lastAt: number | null = null;
  let model: string | null = null;
  let toolCalls = 0;
  let errors = 0;
  let costState: number | null = null;
  let blockedMs: number | null = null;
  const tail = { kind: 'none' as 'none' | 'request' | 'turn-end' | 'other' | 'cost' };
  let first = true;
  const agentLinks: FileSummary['agentLinks'] = [];
  const runLinks: FileSummary['runLinks'] = [];

  const closeMessage = (): void => {
    if (!pending) return;
    book.record(pending.id, pending.model, pending.usage, pending.stop === null, dayKey(pending.at));
    if (pending.model !== SYNTHETIC_MODEL) model = pending.model;
    if (pending.stop !== null && pending.stop !== 'tool_use') tail.kind = 'turn-end';
    pending = null;
  };

  const assistant = (r: Record<string, unknown>): void => {
    const at = timeOf(r.timestamp);
    if (at !== null) {
      firstAt ??= at;
      lastAt = lastAt === null ? at : Math.max(lastAt, at);
    }
    if (r.isApiErrorMessage === true) {
      closeMessage();
      errors += 1;
      tail.kind = 'other';
      return;
    }
    const m = obj(r.message);
    if (!m) return;
    const id = str(m.id) ?? str(r.uuid) ?? '';
    if (pending && pending.id !== id) closeMessage();
    pending = {
      id,
      model: str(m.model) ?? pending?.model ?? '',
      usage: (obj(m.usage) as ApiUsage | null) ?? pending?.usage ?? {},
      stop: str(m.stop_reason),
      at: at ?? pending?.at ?? 0,
    };
    tail.kind = 'other';
    for (const raw of arr(m.content)) {
      const b = obj(raw);
      if (b?.type !== 'tool_use') continue;
      const toolUseId = str(b.id);
      toolCalls += 1;
      if (toolUseId) open.set(toolUseId, { at, name: str(b.name) ?? 'unknown' });
    }
  };

  const decided = (r: Record<string, unknown>, id: string, call: OpenCall | undefined): void => {
    const at = timeOf(r.timestamp);
    if (at !== null) lastAt = lastAt === null ? at : Math.max(lastAt, at);
    const pd = obj(r.permissionDecision);
    const source = str(pd?.source);
    const human = source === 'user_temporary' || source === 'user_abort' || r.toolDenialKind === 'user-rejected'
      || (call !== undefined && toolFamily(call.name) === 'ask');
    if (human && call?.at !== undefined && call.at !== null && at !== null) {
      blockedMs = (blockedMs ?? 0) + Math.min(BLOCK_CAP_MS, Math.max(0, at - call.at));
    }
    const result = obj(r.toolUseResult);
    const runId = str(result?.runId);
    const agentId = str(result?.agentId);
    if (runId) runLinks.push({ runId, toolUseId: id, taskId: str(result?.taskId), name: str(result?.workflowName) });
    else if (agentId) agentLinks.push({ agentId, toolUseId: id });
  };

  const userLine = (line: Buffer): void => {
    let parsed = false;
    let r: Record<string, unknown> | null = null;
    const parse = (): Record<string, unknown> | null => {
      if (!parsed) {
        parsed = true;
        r = parseLine(line, sensor);
      }
      return r;
    };
    if (line.includes(IS_ERROR)) errors += 1;
    for (let i = line.indexOf(TOOL_USE_ID); i !== -1; i = line.indexOf(TOOL_USE_ID, i + 1)) {
      const start = i + TOOL_USE_ID.length;
      const end = line.indexOf(QUOTE, start);
      if (end === -1) break;
      const id = line.toString('latin1', start, end);
      const call = open.get(id);
      open.delete(id);
      const ask = call !== undefined && toolFamily(call.name) === 'ask';
      if (ask || HUMAN_MARKS.some((m) => line.includes(m)) || JOIN_MARKS.some((m) => line.includes(m))) {
        const rec = parse();
        if (rec) decided(rec, id, call);
      }
    }
    tail.kind = 'other';
  };

  const onLine = (line: Buffer): void => {
    if (first) {
      first = false;
      const r = parseLine(line, sensor);
      const at = timeOf(r?.timestamp);
      if (at !== null) firstAt = at;
    }
    if (isApiRequestLine(line)) {
      if (!isApiRequestBody(line)) {
        closeMessage();
        tail.kind = 'request';
      }
      return;
    }
    if (line.subarray(0, COST_STATE.length).equals(COST_STATE)) {
      const usd = num(parseLine(line, sensor)?.totalCostUSD);
      if (usd !== null && usd > 0) costState = Math.max(costState ?? 0, usd);
      closeMessage();
      tail.kind = 'cost';
      return;
    }
    if (line.includes(ASSISTANT)) {
      const r = parseLine(line, sensor);
      if (r?.type === 'assistant') {
        assistant(r);
        return;
      }
    }
    if (line.includes(USER)) userLine(line);
  };

  const cursor = newCursor(file);
  let offset = 0;
  try {
    const buf = Buffer.allocUnsafe(READ_CHUNK);
    while (offset < limit) {
      const { bytesRead } = await fh.read(buf, 0, Math.min(READ_CHUNK, limit - offset), offset);
      if (bytesRead === 0) break;
      scanLines(cursor, buf.subarray(0, bytesRead), offset, onLine);
      offset += bytesRead;
      await pace();
    }
  } catch {
    return null;
  } finally {
    await fh.close();
  }
  closeMessage();

  const last = book.lastMessageId;
  const lastEntry = last ? book.entry(last) : undefined;
  const outcome = open.size > 0 || tail.kind === 'request' ? 'abandoned'
    : tail.kind === 'turn-end' || tail.kind === 'cost' ? 'clean' : 'unknown';
  return {
    path: file,
    size,
    mtimeMs,
    parsedTo: offset,
    complete: to === null,
    usage: book.total,
    estimateUsd: book.estimateUsd,
    byModel: Object.fromEntries(book.byModel),
    byDay: Object.fromEntries(book.byDay),
    unpriced: [...book.unpriced],
    costStateUsd: costState,
    firstAt,
    lastAt,
    model,
    toolCalls,
    errors,
    blockedMs,
    outcome,
    lastMessage: last && lastEntry ? { id: last, usage: lastEntry.usage, usd: lastEntry.usd } : null,
    agentLinks,
    runLinks,
  };
}

/** Which agents of an old run failed, for the history row. `result` holds private content and is not kept. */
export async function scanJournal(file: string, size: number, mtimeMs: number): Promise<JournalSummary | null> {
  let text: string;
  try {
    text = await fsp.readFile(file, 'utf8');
  } catch {
    return null;
  }
  const failed = new Set<string>();
  const completed = new Set<string>();
  const sensor = new Sensor();
  for (const line of text.split('\n')) {
    if (!line) continue;
    let r: Record<string, unknown>;
    try {
      r = JSON.parse(line) as Record<string, unknown>;
    } catch {
      sensor.bump('parseErrors');
      continue;
    }
    const agentId = str(r.agentId);
    if (!agentId) continue;
    if (r.type === 'failed') failed.add(agentId);
    if (r.type === 'result') {
      failed.delete(agentId);
      completed.add(agentId);
    }
  }
  return { path: file, size, mtimeMs, failedAgentIds: [...failed], completedAgentIds: [...completed] };
}

export type WorkerTask =
  | { kind: 'transcript'; path: string; size: number; mtimeMs: number; to: number | null; nodeId: NodeId }
  | { kind: 'journal'; path: string; size: number; mtimeMs: number };

export type WorkerResult =
  | { kind: 'transcript'; nodeId: NodeId; summary: FileSummary | null; path: string; size: number; mtimeMs: number }
  | { kind: 'journal'; summary: JournalSummary | null; path: string };
