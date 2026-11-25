// Where the kernel lives and the numbers of its transport. Plane limits stay with their owners in observer/ and control/.
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORT } from '@naos/protocol';
import type { KernelMode } from '@naos/protocol';
import type { KernelConfig } from './context.ts';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export const SERVER_LIMITS = {
  /** DESIGN 7.10: events reach a client at most once per this many ms. */
  batchMs: 16,
  ratesMs: 250,
  tickMs: 1000,
  /** Over this much unsent data a client is dropped from the stream until it drains. */
  bufferedHighBytes: 4 * 1024 * 1024,
  /** A fresh snapshot goes out once it has drained to here. */
  bufferedLowBytes: 256 * 1024,
  /** A client that never drains is closed, and its reconnect gets a snapshot. */
  staleCloseMs: 30_000,
  pingMs: 20_000,
  /** Enough for a Slice 0 report, far more than any command needs. */
  bodyBytes: 4 * 1024 * 1024,
  /** A plane that will not stop in this time is left behind on shutdown. */
  planeStopMs: 5000,
} as const;

/** Vite's address from CLAUDE.md. Trusted without configuration only by the fixture kernel, which can start nothing. */
const FIXTURE_DEV_ORIGINS = ['http://127.0.0.1:5173', 'http://localhost:5173'];

export interface ConfigInput {
  mode: KernelMode;
  port?: number;
  home?: string;
  devOrigins?: string[];
}

const splitList = (value: string | undefined): string[] =>
  (value ?? '').split(',').map((part) => part.trim()).filter(Boolean);

export function loadConfig(input: ConfigInput, env: NodeJS.ProcessEnv = process.env): KernelConfig {
  const configured = splitList(env.NAOS_DEV_ORIGINS);
  return {
    mode: input.mode,
    port: input.port ?? (Number(env.NAOS_PORT) || DEFAULT_PORT),
    home: path.resolve(input.home ?? env.NAOS_HOME ?? path.join(REPO_ROOT, '.naos')),
    claudeHome: path.join(os.homedir(), '.claude'),
    uiDist: path.resolve(env.NAOS_UI_DIST ?? path.join(REPO_ROOT, 'packages/ui/dist')),
    repoRoot: REPO_ROOT,
    devOrigins: input.devOrigins ?? (configured.length > 0 ? configured : input.mode === 'fixture' ? FIXTURE_DEV_ORIGINS : []),
  };
}

export function kernelVersion(): string {
  const manifest = JSON.parse(readFileSync(path.join(REPO_ROOT, 'packages/kernel/package.json'), 'utf8')) as { version: string };
  return manifest.version;
}

/** The toast, and any browser the kernel might open, stay off under the test runner whatever else is configured. */
export const underTest = (env: NodeJS.ProcessEnv = process.env): boolean => env.NODE_TEST_CONTEXT !== undefined;

export const toastsAllowed = (mode: KernelMode, env: NodeJS.ProcessEnv = process.env): boolean =>
  mode === 'live' && env.NAOS_NO_TOAST === undefined && !underTest(env);
