// Owns the worker and the (path, size, mtimeMs) cache, so a restart only touches files that changed. Summaries hold counts
// and ids only, never text, so they are safe to keep in the database.
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import type { Db, Logger } from '../context.ts';
import { PRICES } from './prices.ts';
import type { FileSummary, JournalSummary, WorkerResult, WorkerTask } from './usageScan.ts';

const COMMIT_EVERY = 64;
/** Raise when FileSummary or JournalSummary changes shape. */
const SUMMARY_SHAPE = 2;

interface Row { path: string; size: number; mtime_ms: number; data: string }

export class UsageIndex {
  private readonly db: Db;
  private readonly log: Logger;
  private worker: Worker | null = null;
  private outstanding = 0;
  private uncommitted = 0;
  readonly summaries = new Map<string, FileSummary>();
  readonly journals = new Map<string, JournalSummary>();
  onResult: (r: WorkerResult) => void = () => {};
  onDrained: () => void = () => {};

  constructor(db: Db, log: Logger) {
    this.db = db;
    this.log = log;
  }

  createTables(): void {
    this.db.exec(`CREATE TABLE IF NOT EXISTS obs_usage (
      path TEXT PRIMARY KEY, size INTEGER NOT NULL, mtime_ms REAL NOT NULL, data TEXT NOT NULL
    )`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS obs_journal (
      path TEXT PRIMARY KEY, size INTEGER NOT NULL, mtime_ms REAL NOT NULL, data TEXT NOT NULL
    )`);
  }

  /** Reads every cached row at once. A file whose stat no longer matches is simply parsed again. */
  load(): void {
    // Cached numbers embed the price table and the summary shape, so a change to either empties the cache.
    const version = createHash('sha256').update(`${SUMMARY_SHAPE}${JSON.stringify(PRICES)}`).digest('hex').slice(0, 16);
    this.db.exec('CREATE TABLE IF NOT EXISTS obs_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    const stored = this.db.get<{ value: string }>("SELECT value FROM obs_meta WHERE key = 'usage_version'")?.value;
    if (stored !== version) {
      this.db.exec('DELETE FROM obs_usage');
      this.db.exec('DELETE FROM obs_journal');
      this.db.run("INSERT OR REPLACE INTO obs_meta (key, value) VALUES ('usage_version', ?)", version);
    }
    for (const row of this.db.all<Row>('SELECT path, size, mtime_ms, data FROM obs_usage')) {
      try {
        this.summaries.set(row.path, JSON.parse(row.data) as FileSummary);
      } catch {
        this.db.run('DELETE FROM obs_usage WHERE path = ?', row.path);
      }
    }
    for (const row of this.db.all<Row>('SELECT path, size, mtime_ms, data FROM obs_journal')) {
      try {
        this.journals.set(row.path, JSON.parse(row.data) as JournalSummary);
      } catch {
        this.db.run('DELETE FROM obs_journal WHERE path = ?', row.path);
      }
    }
  }

  isFresh(path: string, size: number, mtimeMs: number): FileSummary | null {
    const s = this.summaries.get(path);
    return s && s.complete && s.size === size && s.mtimeMs === mtimeMs ? s : null;
  }

  isJournalFresh(path: string, size: number, mtimeMs: number): boolean {
    const j = this.journals.get(path);
    return j !== undefined && j.size === size && j.mtimeMs === mtimeMs;
  }

  forget(path: string): void {
    this.summaries.delete(path);
    this.db.run('DELETE FROM obs_usage WHERE path = ?', path);
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./usageWorker.ts', import.meta.url), {
      execArgv: ['--disable-warning=ExperimentalWarning'],
      name: 'naos-usage-index',
    });
    worker.unref();
    worker.on('message', (r: WorkerResult) => this.receive(r));
    worker.on('error', (e) => {
      this.log.error('usage index worker failed', { message: e.message });
      this.worker = null;
      this.outstanding = 0;
      this.onDrained();
    });
    this.worker = worker;
    return worker;
  }

  enqueue(tasks: WorkerTask[]): void {
    if (tasks.length === 0) return;
    this.outstanding += tasks.length;
    this.ensureWorker().postMessage(tasks);
  }

  get pending(): number {
    return this.outstanding;
  }

  private commit(): void {
    if (this.uncommitted === 0) return;
    this.uncommitted = 0;
    this.db.exec('COMMIT');
  }

  private store(table: 'obs_usage' | 'obs_journal', path: string, size: number, mtimeMs: number, data: string): void {
    if (this.uncommitted === 0) this.db.exec('BEGIN');
    this.db.run(`INSERT OR REPLACE INTO ${table} (path, size, mtime_ms, data) VALUES (?, ?, ?, ?)`, path, size, mtimeMs, data);
    this.uncommitted += 1;
    if (this.uncommitted >= COMMIT_EVERY) this.commit();
  }

  private receive(r: WorkerResult): void {
    this.outstanding = Math.max(0, this.outstanding - 1);
    if (r.kind === 'transcript') {
      if (r.summary) {
        this.summaries.set(r.path, r.summary);
        if (r.summary.complete) this.store('obs_usage', r.path, r.size, r.mtimeMs, JSON.stringify(r.summary));
      }
    } else if (r.summary) {
      this.journals.set(r.path, r.summary);
      this.store('obs_journal', r.path, r.summary.size, r.summary.mtimeMs, JSON.stringify(r.summary));
    }
    this.onResult(r);
    if (this.outstanding === 0) {
      this.commit();
      this.onDrained();
    }
  }

  async stop(): Promise<void> {
    this.commit();
    const worker = this.worker;
    this.worker = null;
    if (worker) await worker.terminate();
  }
}
