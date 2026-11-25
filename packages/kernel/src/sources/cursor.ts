import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { blankSnapshot, type SourceSnapshot } from './session.ts';

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Obj : {};
const parse = (value: unknown): Obj => { try { return obj(JSON.parse(String(value))); } catch { return {}; } };
const str = (value: unknown): string | null => typeof value === 'string' && value.length < 2048 ? value : null;
const num = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;

export function cursorSnapshot(header: Obj, data: Obj, now: number): SourceSnapshot | null {
  const id = str(header.composerId);
  const at = num(header.lastUpdatedAt) ?? num(header.createdAt);
  if (!id || !at || now - at > 24 * 60 * 60_000 || header.isDraft === true) return null;
  const s = blankSnapshot(id, at);
  const uri = obj(obj(header.workspaceIdentifier).uri);
  s.cwd = str(uri.fsPath) ?? str(uri.path);
  const rawUri = str(obj(header.workspaceIdentifier).uri);
  if (!s.cwd && rawUri?.startsWith('file:')) { try { s.cwd = fileURLToPath(rawUri); } catch { /* an unknown URI is no project */ } }
  const repos = Array.isArray(header.trackedGitRepos) ? header.trackedGitRepos : [];
  if (!s.cwd) { const repo = obj(repos[0]); s.cwd = str(repo.rootPath) ?? str(repo.path); }
  s.startedAt = num(header.createdAt) ?? at;
  s.model = str(obj(data.modelConfig).modelName);
  s.capabilities = ['activity', 'hierarchy'];
  const percent = num(header.contextUsagePercent);
  if (percent !== null && percent >= 0 && percent <= 100) { s.contextFraction = percent / 100; s.capabilities.push('context'); }
  const recent = now - at < 120_000;
  const status = str(data.status);
  if (header.hasBlockingPendingActions === true && recent) s.activity = { state: 'waiting', since: at, reason: 'unknown' };
  else if (status === 'generating' || status === 'running' || status === 'streaming') s.activity = { state: recent ? 'generating' : 'unknown', since: at };
  else if (status === 'completed' || status === 'none') s.activity = { state: 'idle', since: at, backgroundShell: false };
  else if (status === 'aborted' || status === 'cancelled') s.activity = { state: 'interrupted', since: at };
  else if (status === 'error' || status === 'failed') s.activity = { state: 'errored', since: at, kind: 'unknown' };
  return s;
}

/** The store is opened read-only. Only composer metadata is selected; no bubble, prompt or credential key is queried. */
export function readCursor(file: string, now: number): SourceSnapshot[] {
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(file, { readOnly: true, timeout: 150 });
    const columns = db.prepare('PRAGMA table_info(composerHeaders)').all();
    if (!columns.some((c) => c.name === 'value')) return [];
    const headers = db.prepare('SELECT composerId, value FROM composerHeaders WHERE lastUpdatedAt > ? AND isArchived = 0 ORDER BY lastUpdatedAt DESC LIMIT 256').all(now - 24 * 60 * 60_000);
    const composer = db.prepare("SELECT json_extract(value, '$.status') AS status, json_extract(value, '$.modelConfig.modelName') AS model, json_extract(value, '$.subagentComposerIds') AS children FROM cursorDiskKV WHERE key = ? AND json_valid(value)");
    const snapshots: SourceSnapshot[] = [];
    const parents = new Map<string, string>();
    for (const row of headers) {
      const header = parse(row.value);
      const projected = composer.get(`composerData:${String(row.composerId)}`);
      let children: unknown = [];
      try { children = JSON.parse(String(projected?.children ?? '[]')); } catch { /* unknown child lists stay empty */ }
      const data = { status: projected?.status, modelConfig: { modelName: projected?.model }, subagentComposerIds: children };
      const s = cursorSnapshot(header, data, now);
      if (!s) continue;
      s.bytes = Buffer.byteLength(String(row.value));
      for (const child of Array.isArray(children) ? children : []) { const id = str(child) ?? str(obj(child).composerId); if (id) parents.set(id, s.nativeId); }
      snapshots.push(s);
    }
    for (const s of snapshots) s.parentId = parents.get(s.nativeId) ?? null;
    return snapshots;
  } catch {
    // Missing, locked and newer stores leave this source unknown. They do not take the kernel down.
    return [];
  } finally { db?.close(); }
}
