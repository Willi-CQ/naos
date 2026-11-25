import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { CommandError } from '../../context.ts';
import { agentEnv } from '../driver.ts';
import { treeKill } from '../procs.ts';

export type Obj = Record<string, unknown>;
export const object = (v: unknown): Obj => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
export interface NativeExecutable { file: string; args: string[] }
export interface RpcTransport {
  request(method: string, params: Obj, timeout?: number): Promise<Obj>;
  notify(method: string, params: Obj): void;
  respond(id: string | number, result: unknown): void;
  reject(id: string | number, message: string): void;
  close(): Promise<void>;
  onMessage: ((method: string, params: Obj, id?: string | number) => void) | null;
  onExit: (() => void) | null;
}

/** Official CLI subprocess only: prompts travel in JSON, never shell arguments or credential files. */
export class StdioRpc implements RpcTransport {
  onMessage: RpcTransport['onMessage'] = null;
  onExit: RpcTransport['onExit'] = null;
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, { resolve(v: Obj): void; reject(e: Error): void; timer?: NodeJS.Timeout }>();
  private next = 1;
  private ended = false;
  private readonly jsonrpc: boolean;
  constructor(executable: NativeExecutable, args: string[], cwd: string, jsonrpc: boolean) {
    this.jsonrpc = jsonrpc;
    this.child = spawn(executable.file, [...executable.args, ...args], { cwd, env: agentEnv({ NO_OPEN_BROWSER: '1' }), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdin.on('error', () => this.fail());
    this.child.stderr.resume();
    let buffer = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 16e6) { this.fail(); void this.close(); return; }
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let msg: Obj;
        try { msg = object(JSON.parse(line)); } catch { continue; }
        if (typeof msg.method === 'string') {
          const id = typeof msg.id === 'string' || typeof msg.id === 'number' ? msg.id : undefined;
          this.onMessage?.(msg.method, object(msg.params), id);
        } else if (typeof msg.id === 'number') {
          const call = this.pending.get(msg.id);
          if (!call) continue;
          this.pending.delete(msg.id); clearTimeout(call.timer);
          if (msg.error) call.reject(new CommandError('unavailable', String(object(msg.error).message ?? 'The provider rejected this request.').slice(0, 1000)));
          else call.resolve(object(msg.result));
        }
      }
    });
    this.child.on('error', () => this.fail());
    this.child.on('exit', () => { this.fail(); this.onExit?.(); });
  }
  private fail() {
    this.ended = true;
    for (const call of this.pending.values()) { clearTimeout(call.timer); call.reject(new CommandError('unavailable', 'The agent CLI connection closed. Check its installation and login.')); }
    this.pending.clear();
  }
  private write(value: Obj) {
    if (this.ended) throw new CommandError('unavailable', 'The agent CLI is no longer connected.');
    this.child.stdin.write(`${JSON.stringify(this.jsonrpc ? { jsonrpc: '2.0', ...value } : value)}\n`);
  }
  request(method: string, params: Obj, timeout = 25000): Promise<Obj> {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = timeout ? setTimeout(() => { this.pending.delete(id); reject(new CommandError('unavailable', 'The agent CLI did not answer in time.')); }, timeout) : undefined;
      this.pending.set(id, { resolve, reject, ...(timer ? { timer } : {}) });
      try { this.write({ id, method, params }); } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  notify(method: string, params: Obj) { this.write({ method, params }); }
  respond(id: string | number, result: unknown) { if (!this.ended) this.write({ id, result }); }
  reject(id: string | number, message: string) { if (!this.ended) this.write({ id, error: { code: -32601, message } }); }
  async close() {
    this.child.stdin.end();
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    await new Promise<void>((resolve) => { const timer = setTimeout(resolve, 600); this.child.once('exit', () => { clearTimeout(timer); resolve(); }); });
    if (this.child.exitCode === null && this.child.signalCode === null && this.child.pid) await treeKill(this.child.pid);
    this.fail();
  }
}
