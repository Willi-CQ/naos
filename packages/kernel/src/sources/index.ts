import os from 'node:os';
import path from 'node:path';
import type { KernelContext, Plane } from '../context.ts';
import type { HistoryDigest } from '@naos/protocol';
import { CodexLog, codexFiles } from './codex.ts';
import { readCursor } from './cursor.ts';
import { SourcePublisher } from './session.ts';

export interface SourcePaths { codexSessions: string; cursorDatabase: string }

export const sourcePaths = (env: NodeJS.ProcessEnv = process.env): SourcePaths => ({
  codexSessions: path.join(env.CODEX_HOME ?? path.join(os.homedir(), '.codex'), 'sessions'),
  cursorDatabase: path.join(env.APPDATA ?? path.join(os.homedir(), 'AppData/Roaming'), 'Cursor/User/globalStorage/state.vscdb'),
});

export class ExternalSources implements Plane {
  readonly name = 'external sources';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private pending: Promise<void> = Promise.resolve();
  private readonly logs = new Map<string, CodexLog>();
  private readonly paths: SourcePaths;

  constructor(paths: SourcePaths = sourcePaths()) { this.paths = paths; }

  async start(ctx: KernelContext): Promise<void> {
    const codex = new SourcePublisher(ctx, 'codex');
    const cursor = new SourcePublisher(ctx, 'cursor');
    ctx.externalHistory = () => ctx.db.all<{ data: string }>('SELECT data FROM source_history WHERE last_at > ? ORDER BY last_at LIMIT 10000', Date.now() - 30 * 24 * 60 * 60_000)
      .flatMap((row) => { try { return [JSON.parse(row.data) as HistoryDigest]; } catch { return []; } });
    let scanAt = 0;
    let prunedAt = 0;
    const poll = async (): Promise<void> => {
      const now = Date.now();
      if (now - prunedAt >= 60 * 60_000) {
        ctx.db.run('DELETE FROM source_history WHERE last_at < ?', now - 30 * 24 * 60 * 60_000);
        prunedAt = now;
      }
      if (now - scanAt >= 10_000) {
        scanAt = now;
        for (const { file, at } of await codexFiles(this.paths.codexSessions, now)) {
          if (!this.logs.has(file)) this.logs.set(file, new CodexLog(file, at));
        }
      }
      for (const log of this.logs.values()) await log.read();
      codex.publish([...this.logs.values()].map((l) => l.snapshot).filter((s) => s.nativeId), now);
      cursor.publish(readCursor(this.paths.cursorDatabase, now), now);
    };
    const run = (): void => {
      if (this.stopped) return;
      this.pending = poll().catch(() => ctx.log.warn('external source read failed')).finally(() => {
        if (!this.stopped) { this.timer = setTimeout(run, 1500); this.timer.unref(); }
      });
    };
    run();
    await this.pending;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.pending;
  }
}
