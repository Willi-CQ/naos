// `naos open`, what a click runs. It attaches to the kernel of this home, or starts one with no console. There is nobody at a
// terminal here, so every way this can fail ends in a sentence the user can read.
import { spawn } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { toastsAllowed } from '../config.ts';
import type { KernelConfig } from '../context.ts';
import { raiseToast } from '../notify/toast.ts';
import { ensureTokens } from '../server/auth.ts';
import { alive, probePort, runningKernel } from './probe.ts';

const START_WAIT_MS = 45_000;
const BUILD_WAIT_MS = 300_000;
const POLL_MS = 150;
/** A holder that died leaves the lock behind. This covers a pid that has been reused since. */
const LOCK_STALE_MS = 2 * BUILD_WAIT_MS;
/** A lock is empty for a moment while its taker writes it. */
const LOCK_WRITE_MS = 2000;

export class OpenFailure extends Error {}

export interface OpenRequest {
  config: KernelConfig;
  idleMinutes: number;
  /** Says something on the way, for a wait the user would otherwise take for a dead click. */
  tell(text: string): void;
}

export interface Opened {
  /** `joined`: another open started this kernel at the same moment and is opening the window for both. */
  how: 'attached' | 'started' | 'joined';
  port: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function readToken(home: string): string | null {
  try {
    return readFileSync(path.join(home, 'ui.token'), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

async function findKernel(home: string, requested: number): Promise<number | null> {
  const token = readToken(home);
  const port = runningKernel(home)?.port ?? requested;
  if (token === null || port === 0) return null;
  const holder = await probePort(port, token);
  if (holder === 'fixture') throw new OpenFailure(`The scripted fixture holds this home on port ${port}. Stop it, then open NAOS again.`);
  return holder === 'live' ? port : null;
}

interface LockBody {
  pid: number;
  at: number;
}

function lockIsStale(file: string, now: number): boolean {
  try {
    const { pid, at } = JSON.parse(readFileSync(file, 'utf8')) as LockBody;
    return !alive(pid) || now - at > LOCK_STALE_MS;
  } catch {
    try {
      return now - statSync(file).mtimeMs > LOCK_WRITE_MS;
    } catch {
      return false;
    }
  }
}

/** `wx` is atomic, so of two opens at the same moment exactly one gets to start a kernel. */
function claim(file: string, now: number): boolean {
  try {
    writeFileSync(file, JSON.stringify({ pid: process.pid, at: now } satisfies LockBody), { flag: 'wx' });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
}

/**
 * Two opens can both find a lock stale, and the later remove would then delete the fresh lock of the earlier one. So one at a time
 * decides, behind a guard, and looks again once it holds that.
 */
function takeStaleLock(file: string, now: number): boolean {
  const guard = `${file}.stale`;
  if (!claim(guard, now)) {
    if (lockIsStale(guard, now)) rmSync(guard, { force: true });
    return false;
  }
  try {
    if (!lockIsStale(file, now)) return false;
    rmSync(file, { force: true });
    return claim(file, now);
  } finally {
    rmSync(guard, { force: true });
  }
}

export function takeLock(file: string, now = Date.now()): boolean {
  return claim(file, now) || (lockIsStale(file, now) && takeStaleLock(file, now));
}

const logFile = (home: string, name: string): string => path.join(home, 'logs', name);

export const needsUiBuild = (dist: string): boolean => !existsSync(path.join(dist, 'index.html'));

/** A fresh clone has no build, and a click must still end in the real app. It runs vite itself, so PATH and npm do not matter. */
async function buildUi(request: OpenRequest): Promise<void> {
  const { repoRoot, home, uiDist } = request.config;
  const vite = path.join(repoRoot, 'node_modules/vite/bin/vite.js');
  if (!existsSync(vite)) throw new OpenFailure(`The UI is not built and its tools are missing. Run npm install in ${repoRoot}.`);
  request.tell('Building the NAOS window. This happens once and takes about a minute.');
  const log = openSync(logFile(home, 'ui-build.log'), 'a');
  const child = spawn(process.execPath, [vite, 'build', '--outDir', uiDist, '--emptyOutDir'], {
    cwd: path.join(repoRoot, 'packages/ui'), stdio: ['ignore', log, log], windowsHide: true, timeout: BUILD_WAIT_MS,
  });
  closeSync(log);
  const code = await new Promise<number>((resolve) => {
    child.once('error', () => resolve(-1));
    child.once('exit', (exit) => resolve(exit ?? -1));
  });
  if (code !== 0 || needsUiBuild(uiDist)) throw new OpenFailure(`The UI build failed. See ${logFile(home, 'ui-build.log')}.`);
}

function portTaken(home: string, port: number): OpenFailure {
  const own = runningKernel(home);
  if (own?.port === port) return new OpenFailure(`NAOS is on port ${port} but does not answer. End process ${own.pid} in Task Manager, then open it again.`);
  return new OpenFailure(`Port ${port} is taken by another program, so NAOS cannot start there. Close that program, or use naos open --port <n>.`);
}

async function startDetached(request: OpenRequest): Promise<number> {
  const { config, idleMinutes } = request;
  const { home, port: requested } = config;
  const token = ensureTokens(home).ui;
  if (requested !== 0 && await probePort(requested, token) === 'stranger') throw portTaken(home, requested);
  if (needsUiBuild(config.uiDist)) await buildUi(request);

  // Stdout carries the ready line with the token in it, so it goes nowhere. Stderr is what a crash leaves behind.
  const stderrFile = logFile(home, 'kernel-stderr.log');
  const stderr = openSync(stderrFile, 'a');
  const child = spawn(process.execPath, [
    '--disable-warning=ExperimentalWarning', path.join(config.repoRoot, 'packages/kernel/src/cli.ts'),
    'up', '--no-open', '--idle-exit', String(idleMinutes), '--port', String(requested), '--home', home,
  ], { cwd: config.repoRoot, detached: true, stdio: ['ignore', 'ignore', stderr], windowsHide: true });
  closeSync(stderr);

  let exited: number | null = null;
  child.once('error', () => { exited = -1; });
  child.once('exit', (code) => { exited = code ?? -1; });

  const deadline = Date.now() + START_WAIT_MS;
  while (Date.now() < deadline) {
    const port = runningKernel(home)?.port ?? requested;
    // This comes first: a child that lost a race for the port has exited, and the kernel that won it is the one we want.
    if (port !== 0 && await probePort(port, token) === 'live') {
      child.removeAllListeners();
      child.unref();
      return port;
    }
    if (exited !== null) {
      if (requested !== 0 && await probePort(requested, token) === 'stranger') throw portTaken(home, requested);
      throw new OpenFailure(`The kernel stopped while starting, with code ${String(exited)}. See ${stderrFile}.`);
    }
    await sleep(POLL_MS);
  }
  child.kill();
  throw new OpenFailure(`The kernel did not answer within ${START_WAIT_MS / 1000} s. See ${stderrFile}.`);
}

export async function openApp(request: OpenRequest): Promise<Opened> {
  const { home, port: requested } = request.config;
  mkdirSync(path.join(home, 'logs'), { recursive: true });
  const lock = path.join(home, 'open.lock');
  const deadline = Date.now() + BUILD_WAIT_MS;
  let waited = false;

  while (Date.now() < deadline) {
    const found = await findKernel(home, requested);
    if (found !== null) return { how: waited ? 'joined' : 'attached', port: found };

    if (takeLock(lock)) {
      try {
        const late = await findKernel(home, requested);
        if (late !== null) return { how: 'attached', port: late };
        return { how: 'started', port: await startDetached(request) };
      } finally {
        rmSync(lock, { force: true });
      }
    }
    waited = true;
    await sleep(POLL_MS);
  }
  throw new OpenFailure('Another start of NAOS never finished.');
}

/**
 * With no console, stderr reaches nobody, so the reason goes to a log the toast opens on click. A toast with no launch target
 * would start PowerShell when clicked, because the toast borrows its app id. Never under test, whatever the environment says.
 */
export function tellUser(home: string, text: string, raise: typeof raiseToast = raiseToast): void {
  const file = logFile(home, 'open.log');
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, `${new Date().toISOString()} ${text}\n`);
  } catch {
    // A home that cannot be written is often the failure itself, and the toast below still carries it.
  }
  process.stderr.write(`naos: ${text}\n`);
  if (toastsAllowed('live')) raise({ text, url: pathToFileURL(file).href }, { info() {}, warn() {}, error() {} });
}
