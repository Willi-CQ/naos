import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import type { CommandResult, ServerFrame } from '@naos/protocol';
import { loadConfig } from '../../src/config.ts';
import { startKernel } from '../../src/main.ts';
import type { RunningKernel, StartOptions } from '../../src/main.ts';

// A second lock on top of the test runner check in main.ts: no test may raise a real notification.
process.env.NAOS_NO_TOAST = '1';

export interface TestKernel extends RunningKernel {
  port: number;
  origin: string;
  cookie: string;
  close(): Promise<void>;
}

/** Live mode with no planes unless told otherwise, so nothing on this machine is read. */
export async function boot(mode: 'live' | 'fixture' = 'live', over: Partial<StartOptions> & { devOrigins?: string[] } = {}): Promise<TestKernel> {
  const home = mkdtempSync(path.join(os.tmpdir(), 'naos-test-'));
  const { devOrigins, ...options } = over;
  const config = loadConfig({ mode, port: 0, home, devOrigins: devOrigins ?? [] }, {});
  const kernel = await startKernel({ config, logToStderr: false, ...(mode === 'live' ? { planes: [] } : {}), ...options });
  await kernel.planesReady;
  const origin = `http://127.0.0.1:${config.port}`;
  const auth = await fetch(kernel.url, { redirect: 'manual' });
  const cookie = auth.headers.get('set-cookie')?.split(';')[0] ?? '';
  return {
    ...kernel,
    port: config.port,
    origin,
    cookie,
    async close() {
      await kernel.stop();
      rmSync(home, { recursive: true, force: true });
    },
  };
}

export async function post(kernel: TestKernel, body: unknown, headers: Record<string, string> = { cookie: kernel.cookie }): Promise<{ status: number; body: CommandResult }> {
  const response = await fetch(`${kernel.origin}/api/cmd`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as CommandResult };
}

/** The result of a command that must succeed. */
export async function run<T = unknown>(kernel: TestKernel, body: unknown): Promise<T> {
  const reply = await post(kernel, body);
  if (!reply.body.ok) throw new Error(`${JSON.stringify(body)}: ${reply.body.error.code} ${reply.body.error.message}`);
  return reply.body.result as T;
}

export class Client {
  readonly frames: ServerFrame[] = [];
  private waiters: Array<() => void> = [];
  readonly ws: WebSocket;

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', (data: Buffer) => {
      this.frames.push(JSON.parse(data.toString('utf8')) as ServerFrame);
      for (const wake of this.waiters.splice(0)) wake();
    });
  }

  /** Resolves with the first frame from `from` on that passes the test. */
  async until(test: (frame: ServerFrame) => boolean, timeoutMs = 5000, from = 0): Promise<ServerFrame> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.frames.slice(from).find(test);
      if (found) return found;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`no matching frame in ${timeoutMs} ms, saw ${this.frames.length}`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.waiters.push(() => { clearTimeout(timer); resolve(); });
      });
    }
  }

  close(): void {
    this.ws.terminate();
  }
}

export function connect(kernel: TestKernel, headers: Record<string, string> = { cookie: kernel.cookie }, query = ''): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${kernel.port}/ws${query}`, { headers });
    const client = new Client(ws);
    ws.once('open', () => resolve(client));
    ws.once('unexpected-response', (_request, response) => reject(new Error(`upgrade refused: ${response.statusCode}`)));
    ws.once('error', reject);
  });
}

/** The status a refused upgrade answered with, or throws when it was accepted. */
export function refusedStatus(url: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    ws.once('open', () => { ws.terminate(); reject(new Error('upgrade was accepted')); });
    ws.once('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0));
    ws.once('error', reject);
  });
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
