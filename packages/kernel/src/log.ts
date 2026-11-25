// JSON lines under <home>/logs. Stdout is reserved for the ready line, so warnings and errors go to stderr. Callers pass
// structure only: no message text, no tokens, no request URLs.
import { createWriteStream, mkdirSync } from 'node:fs';
import type { WriteStream } from 'node:fs';
import path from 'node:path';
import type { Logger } from './context.ts';

export interface KernelLog extends Logger {
  close(): Promise<void>;
}

type Level = 'info' | 'warn' | 'error';

export function createLog(home: string, options: { stderr?: boolean } = {}): KernelLog {
  const stderr = options.stderr ?? true;
  const dir = path.join(home, 'logs');
  mkdirSync(dir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  let file: WriteStream | null = createWriteStream(path.join(dir, `kernel-${day}.log`), { flags: 'a' });
  file.on('error', () => { file = null; });

  const write = (level: Level, msg: string, data?: Record<string, unknown>): void => {
    const line = JSON.stringify({ at: new Date().toISOString(), level, msg, ...data });
    file?.write(`${line}\n`);
    if (stderr && level !== 'info') process.stderr.write(`${line}\n`);
  };

  return {
    info: (msg, data) => write('info', msg, data),
    warn: (msg, data) => write('warn', msg, data),
    error: (msg, data) => write('error', msg, data),
    close: () => new Promise((resolve) => {
      if (!file) { resolve(); return; }
      const closing = file;
      file = null;
      closing.end(() => resolve());
    }),
  };
}
