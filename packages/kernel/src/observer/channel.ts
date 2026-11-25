// Explicit reads of one transcript. `craft.channel` is structure only. `craft.text` is the one route by which message text
// leaves this plane, and it returns to that caller alone: nothing here is published, stored or logged.
import fsp from 'node:fs/promises';
import type { ChannelRow, TextRow } from '@naos/protocol';
import type { Raw } from './parse.ts';
import { Sensor, arr, obj, parseLine, str, timeOf } from './parse.ts';
import { newCursor, scanLines } from './tail.ts';
import type { Link, MachineSink, NodeEvent } from './transcript.ts';
import { TranscriptMachine } from './transcript.ts';

const CHANNEL_WINDOW = 2 * 1024 * 1024;
const TEXT_WINDOW = 8 * 1024 * 1024;
const TEXT_ROW_LIMIT = 64 * 1024;
const DEFAULT_ROWS = 200;
const MAX_ROWS = 2_000;
const DEFAULT_TEXT_ROWS = 50;
const MAX_TEXT_ROWS = 500;

const INTERNAL_TEXT = /^\[Request interrupted by user/;

async function readWindow(file: string, window: number): Promise<{ data: Buffer; from: number } | null> {
  let fh;
  try {
    fh = await fsp.open(file, 'r');
  } catch {
    return null;
  }
  try {
    const { size } = await fh.stat();
    const from = Math.max(0, size - window);
    const data = Buffer.allocUnsafe(size - from);
    const { bytesRead } = await fh.read(data, 0, data.length, from);
    return { data: data.subarray(0, bytesRead), from };
  } catch {
    return null;
  } finally {
    await fh.close();
  }
}

type ToolRow = Extract<ChannelRow, { kind: 'tool' }>;

class ChannelSink implements MachineSink {
  readonly rows: ChannelRow[] = [];
  private readonly tools = new Map<string, ToolRow>();
  /** A tool starts on its record, the blocks around it arrive when the message closes. They go out together, in block order. */
  private waiting: ToolRow[] = [];
  private turn = 0;

  private flushTools(): void {
    this.rows.push(...this.waiting);
    this.waiting = [];
  }

  event(e: NodeEvent, at: number): void {
    switch (e.type) {
      case 'turn.started':
        this.flushTools();
        this.turn += 1;
        this.rows.push({ kind: 'turn', at, n: this.turn, origin: e.origin });
        return;
      case 'message.completed':
        e.blocks.forEach((block, i) => {
          if (block === 'thinking') this.rows.push({ kind: 'thinking', at, tokens: e.blockSizes[i] ?? 0, block: i });
          else if (block === 'text') this.rows.push({ kind: 'text', at, messageId: e.messageId, chars: e.blockSizes[i] ?? 0, tokens: null });
          else {
            const tool = this.waiting.shift();
            if (tool) this.rows.push(tool);
          }
        });
        return;
      case 'tool.started': {
        const row: ToolRow = {
          kind: 'tool', at, toolUseId: e.toolUseId, name: e.name, family: e.toolFamily, summary: e.summary,
          durationMs: null, isError: false, decision: null,
        };
        this.tools.set(e.toolUseId, row);
        this.waiting.push(row);
        return;
      }
      case 'tool.finished': {
        const row = this.tools.get(e.toolUseId);
        if (row) {
          row.durationMs = e.durationMs;
          row.isError = e.isError;
          row.decision = e.decision;
        }
        return;
      }
      case 'api.error':
        this.flushTools();
        this.rows.push({ kind: 'error', at, label: e.httpStatus === null ? (e.kind ?? 'error') : String(e.httpStatus) });
        return;
      case 'api.retry':
        this.flushTools();
        this.rows.push({ kind: 'error', at, label: `retry ${e.attempt}/${e.maxRetries}` });
        return;
      default:
    }
  }

  link(_l: Link): void {}

  finish(): void {
    this.flushTools();
  }
}

export async function readChannel(file: string, limit: number | undefined): Promise<{ rows: ChannelRow[]; complete: boolean } | null> {
  const window = await readWindow(file, CHANNEL_WINDOW);
  if (!window) return null;
  const sink = new ChannelSink();
  const sensor = new Sensor();
  const machine = new TranscriptMachine(sink);
  const cursor = newCursor(file, window.from, window.from > 0);
  scanLines(cursor, window.data, window.from, (line, offset) => {
    const r = parseLine(line, sensor);
    if (r) machine.feed(r, offset);
  });
  machine.close();
  sink.finish();
  const max = Math.min(MAX_ROWS, Math.max(1, limit ?? DEFAULT_ROWS));
  return { rows: sink.rows.slice(-max), complete: window.from === 0 };
}

function textOf(content: unknown): string | null {
  if (typeof content === 'string') return content;
  let out: string | null = null;
  for (const raw of arr(content)) {
    const b = obj(raw);
    if (b?.type === 'text' && typeof b.text === 'string') out = out === null ? b.text : `${out}\n${b.text}`;
  }
  return out;
}

function pushText(rows: TextRow[], r: Raw, messageId: string, role: 'assistant' | 'user', text: string): void {
  const last = rows.at(-1);
  if (last && last.messageId === messageId && last.role === role) {
    const merged = `${last.text}\n${text}`;
    last.text = merged.slice(0, TEXT_ROW_LIMIT);
    last.truncated ||= merged.length > TEXT_ROW_LIMIT;
    return;
  }
  rows.push({
    messageId,
    at: timeOf(r.timestamp) ?? 0,
    role,
    text: text.slice(0, TEXT_ROW_LIMIT),
    truncated: text.length > TEXT_ROW_LIMIT,
  });
}

export async function readText(file: string, limit: number | undefined): Promise<TextRow[] | null> {
  const window = await readWindow(file, TEXT_WINDOW);
  if (!window) return null;
  const rows: TextRow[] = [];
  const sensor = new Sensor();
  const cursor = newCursor(file, window.from, window.from > 0);
  scanLines(cursor, window.data, window.from, (line) => {
    const r = parseLine(line, sensor);
    if (!r) return;
    const m = obj(r.message);
    if (r.type === 'assistant' && r.isApiErrorMessage !== true) {
      const text = textOf(arr(m?.content).filter((b) => obj(b)?.type === 'text'));
      if (text) pushText(rows, r, str(m?.id) ?? str(r.uuid) ?? '', 'assistant', text);
    } else if (r.type === 'user' && r.isMeta !== true && r.isCompactSummary !== true) {
      const text = textOf(m?.content);
      if (text && !INTERNAL_TEXT.test(text)) pushText(rows, r, str(r.uuid) ?? '', 'user', text);
    }
  });
  const max = Math.min(MAX_TEXT_ROWS, Math.max(1, limit ?? DEFAULT_TEXT_ROWS));
  return rows.slice(-max);
}
