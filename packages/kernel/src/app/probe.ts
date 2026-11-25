// Whose kernel is this. A pid can be reused and any program can answer on a port, so the listener has to show that it holds this
// home's UI token, and it has to do so without the token ever being sent: the port may belong to anyone, and that token approves.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import path from 'node:path';
import { identityProof, safeEqual } from '../server/auth.ts';

const PROBE_MS = 3000;
const KERNEL_MODES = ['live', 'fixture'] as const;

export interface RunFile {
  pid: number;
  port: number;
  mode: string;
  startedAt: number;
}

export const runFilePath = (home: string): string => path.join(home, 'kernel.json');

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The kernel of this home, if its process is still there. A kill on Windows leaves the file behind. */
export function runningKernel(home: string): RunFile | null {
  try {
    const run = JSON.parse(readFileSync(runFilePath(home), 'utf8')) as RunFile;
    return alive(run.pid) ? run : null;
  } catch {
    return null;
  }
}

const portHeld = (port: number): Promise<boolean> => new Promise((resolve) => {
  const socket = connect({ host: '127.0.0.1', port });
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', () => resolve(false));
});

export type PortHolder = (typeof KERNEL_MODES)[number] | 'stranger' | 'free';

export const isKernel = (holder: PortHolder): boolean => holder === 'live' || holder === 'fixture';

export async function probePort(port: number, token: string): Promise<PortHolder> {
  const nonce = randomBytes(24).toString('base64url');
  try {
    const reply = await fetch(`http://127.0.0.1:${port}/identity?nonce=${nonce}`, { redirect: 'error', signal: AbortSignal.timeout(PROBE_MS) });
    if (reply.ok) {
      const { proof } = (await reply.json()) as { proof?: unknown };
      if (typeof proof === 'string') {
        const mode = KERNEL_MODES.find((candidate) => safeEqual(proof, identityProof(token, port, candidate, nonce)));
        if (mode) return mode;
      }
    }
  } catch {
    // Refused, not HTTP, or too slow. The socket below tells these apart.
  }
  return await portHeld(port) ? 'stranger' : 'free';
}
