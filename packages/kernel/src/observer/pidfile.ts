// `sessions/<pid>.json` and liveness. `updatedAt` is not a heartbeat (RF 0), so it is never read for that. Only names that
// pass isPidFileName are opened: the same folder holds per-session keys.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Liveness, PidStatus, SessionKind } from '@naos/protocol';
import { isPidFileName } from './paths.ts';
import { num, str } from './parse.ts';

const READ_CAP = 262_144;
const RETRY_MS = 20;
const PIPE_ROOT = '\\\\.\\pipe\\';
const PIPE_PREFIX = /^\\\\\.\\pipe\\/;

export interface PidRecord {
  pid: number;
  sessionId: string;
  cwd: string | null;
  startedAt: number | null;
  version: string | null;
  kind: SessionKind;
  entrypoint: string | null;
  pidDomain: string | null;
  messagingSocketPath: string | null;
  name: string | null;
  nameSource: string | null;
  status: PidStatus | string | null;
  waitingFor: string | null;
  statusUpdatedAt: number | null;
  bridgeSessionId: string | null;
  mtimeMs: number;
}

const KINDS = new Set<string>(['interactive', 'bg', 'daemon', 'daemon-worker']);

export function pidRecord(raw: unknown, mtimeMs: number): PidRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const pid = num(r.pid);
  const sessionId = str(r.sessionId);
  if (pid === null || !sessionId) return null;
  const kind = str(r.kind);
  return {
    pid,
    sessionId,
    cwd: str(r.cwd),
    startedAt: num(r.startedAt),
    version: str(r.version),
    kind: kind !== null && KINDS.has(kind) ? (kind as SessionKind) : 'unknown',
    entrypoint: str(r.entrypoint),
    pidDomain: str(r.pidDomain),
    messagingSocketPath: str(r.messagingSocketPath),
    name: str(r.name),
    nameSource: str(r.nameSource),
    status: str(r.status),
    waitingFor: str(r.waitingFor),
    statusUpdatedAt: num(r.statusUpdatedAt),
    bridgeSessionId: str(r.bridgeSessionId),
    mtimeMs,
  };
}

/** Writes are a plain read-modify-write, so a torn read retries once (RF 2.3). */
async function readRecord(file: string, mtimeMs: number): Promise<PidRecord | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt === 1) await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    let fh;
    try {
      fh = await fsp.open(file, 'r');
    } catch {
      return null;
    }
    try {
      const buf = Buffer.allocUnsafe(READ_CAP);
      const { bytesRead } = await fh.read(buf, 0, READ_CAP, 0);
      return pidRecord(JSON.parse(buf.toString('utf8', 0, bytesRead)), mtimeMs);
    } catch {
      // Falls through to the retry.
    } finally {
      await fh.close();
    }
  }
  return null;
}

interface Cached { mtimeMs: number; size: number; record: PidRecord | null }

/** Stat first: a changed pid file is rare and an open costs 30 stats. */
export class PidReader {
  private readonly dir: string;
  private readonly cache = new Map<string, Cached>();

  constructor(sessionsDir: string) {
    this.dir = sessionsDir;
  }

  async read(): Promise<PidRecord[]> {
    let names: string[];
    try {
      names = await fsp.readdir(this.dir);
    } catch {
      return [];
    }
    const seen = new Set<string>();
    const out: PidRecord[] = [];
    for (const name of names) {
      if (!isPidFileName(name)) continue;
      seen.add(name);
      const file = path.join(this.dir, name);
      let st;
      try {
        st = await fsp.stat(file);
      } catch {
        continue;
      }
      let entry = this.cache.get(name);
      if (!entry || entry.mtimeMs !== st.mtimeMs || entry.size !== st.size) {
        entry = { mtimeMs: st.mtimeMs, size: st.size, record: await readRecord(file, st.mtimeMs) };
        this.cache.set(name, entry);
      }
      if (entry.record) out.push(entry.record);
    }
    for (const name of this.cache.keys()) if (!seen.has(name)) this.cache.delete(name);
    return out;
  }

  /** A write inside the same millisecond can keep size and mtime, so a wait being debounced reads the file again. */
  forget(pid: number): void {
    this.cache.delete(`${pid}.json`);
  }
}

/** Enumerates names without connecting to anything. null where the root cannot be listed: not Windows. */
export function listPipes(): Set<string> | null {
  if (process.platform !== 'win32') return null;
  try {
    return new Set(fs.readdirSync(PIPE_ROOT));
  } catch {
    return null;
  }
}

export const hostDomain = (): string => `${process.platform === 'win32' ? 'win32' : process.platform}:${os.hostname().toLowerCase()}`;

/** RF 2.4. A killed process leaves its file, and a reused pid answers `kill(0)`, so the pipe name settles it. */
export function classify(rec: PidRecord, pipes: Set<string> | null, domain: string): Liveness {
  if (rec.pidDomain && rec.pidDomain !== domain) return 'foreign';
  try {
    process.kill(rec.pid, 0);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EPERM') return 'dead';
  }
  if (!rec.messagingSocketPath || !pipes) return 'unknown';
  const leaf = rec.messagingSocketPath.replace(PIPE_PREFIX, '');
  return pipes.has(leaf) ? 'alive' : 'recycled';
}
