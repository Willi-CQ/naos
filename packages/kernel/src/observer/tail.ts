// Tail reads from RF 5.5. Stat first, because an open costs 1.68 ms against 0.06 ms for a stat. Handles stay open only for
// one read, because the CLI renames and rewrites these files. Only complete lines are parsed, the rest waits as carry.
import fsp from 'node:fs/promises';

/** The largest real line was 1.9 MB. A longer one is dropped whole, and the cursor resynchronises on the next newline. */
export const MAX_LINE_BYTES = 2 * 1024 * 1024;
const READ_CHUNK = 4 * 1024 * 1024;
const RESET_TAIL = 64 * 1024;

export interface Cursor {
  path: string;
  offset: number;
  carry: Buffer | null;
  /** The cursor landed inside a line, so everything up to the next newline is not a record. */
  skipFirst: boolean;
  ino: bigint | undefined;
  size: number;
  mtimeMs: number;
}

export const newCursor = (path: string, offset = 0, skipFirst = false): Cursor => ({
  path, offset, carry: null, skipFirst, ino: undefined, size: 0, mtimeMs: 0,
});

export type DrainResult =
  | { state: 'none' | 'data' | 'gone'; oversized: number }
  | { state: 'reset'; reason: 'shrunk' | 'replaced'; oversized: number };

export type LineFn = (line: Buffer, byteOffset: number) => void;

const hasCode = (e: unknown, code: string): boolean => (e as NodeJS.ErrnoException | null)?.code === code;

/** Feeds complete lines of `data` to `onLine` and keeps the rest. Pure over the cursor, so torn input is easy to test. */
export function scanLines(c: Cursor, chunk: Buffer, chunkOffset: number, onLine: LineFn): number {
  let data = chunk;
  let base = chunkOffset;
  if (c.carry) {
    data = Buffer.concat([c.carry, chunk]);
    base = chunkOffset - c.carry.length;
    c.carry = null;
  }
  let oversized = 0;
  let start = 0;
  for (let nl = data.indexOf(10, start); nl !== -1; nl = data.indexOf(10, start)) {
    if (c.skipFirst) c.skipFirst = false;
    else if (nl - start > MAX_LINE_BYTES) oversized += 1;
    else if (nl > start) onLine(data.subarray(start, nl), base + start);
    start = nl + 1;
  }
  if (start < data.length) {
    if (data.length - start > MAX_LINE_BYTES) {
      // A runaway line must not pin memory. Its tail is skipped like a first partial line.
      oversized += c.skipFirst ? 0 : 1;
      c.skipFirst = true;
    } else {
      c.carry = Buffer.from(data.subarray(start));
    }
  }
  return oversized;
}

/** Reads what was appended since the last call. Never throws for a file that vanished, which retention makes normal. */
export async function drain(c: Cursor, onLine: LineFn, resetTail = RESET_TAIL): Promise<DrainResult> {
  let st;
  try {
    st = await fsp.stat(c.path, { bigint: true });
  } catch {
    return { state: 'gone', oversized: 0 };
  }
  const size = Number(st.size);
  c.size = size;
  c.mtimeMs = Number(st.mtimeMs);

  let reset: 'shrunk' | 'replaced' | null = null;
  if (size < c.offset) reset = 'shrunk';
  else if (c.ino !== undefined && st.ino !== c.ino) reset = 'replaced';
  c.ino = st.ino;
  if (reset) {
    c.offset = Math.max(0, size - resetTail);
    c.carry = null;
    c.skipFirst = c.offset > 0;
  }
  if (size === c.offset) return reset ? { state: 'reset', reason: reset, oversized: 0 } : { state: 'none', oversized: 0 };

  let oversized = 0;
  let fh;
  try {
    fh = await fsp.open(c.path, 'r');
  } catch (e) {
    if (hasCode(e, 'ENOENT')) return { state: 'gone', oversized };
    throw e;
  }
  try {
    while (c.offset < size) {
      const want = Math.min(size - c.offset, READ_CHUNK);
      const buf = Buffer.allocUnsafe(want);
      const { bytesRead } = await fh.read(buf, 0, want, c.offset);
      if (bytesRead === 0) break;
      const at = c.offset;
      c.offset += bytesRead;
      oversized += scanLines(c, buf.subarray(0, bytesRead), at, onLine);
    }
  } finally {
    await fh.close();
  }
  return reset ? { state: 'reset', reason: reset, oversized } : { state: 'data', oversized };
}

/**
 * Reads head and tail in one open. A small file comes back whole as `tail`, so no record is read twice or skipped.
 * `tailFrom` is the file offset of `tail`, which may start inside a line.
 */
export async function readHeadTail(
  path: string, size: number, headBytes: number, tailBytes: number,
): Promise<{ head: Buffer; tail: Buffer; tailFrom: number } | null> {
  let fh;
  try {
    fh = await fsp.open(path, 'r');
  } catch {
    return null;
  }
  try {
    const whole = size <= headBytes + tailBytes;
    const headLen = whole ? 0 : headBytes;
    const head = Buffer.allocUnsafe(headLen);
    const h = headLen > 0 ? await fh.read(head, 0, headLen, 0) : { bytesRead: 0 };
    const tailFrom = whole ? 0 : size - tailBytes;
    const tail = Buffer.allocUnsafe(size - tailFrom);
    const t = tail.length > 0 ? await fh.read(tail, 0, tail.length, tailFrom) : { bytesRead: 0 };
    return { head: head.subarray(0, h.bytesRead), tail: tail.subarray(0, t.bytesRead), tailFrom };
  } catch {
    return null;
  } finally {
    await fh.close();
  }
}
