#!/usr/bin/env node
// The `naos` command. Stdout carries one JSON line when the kernel listens and nothing else, because scripts parse it.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { Command, CommandResult, SpawnSpec } from '@naos/protocol';
import { OpenFailure, openApp, tellUser } from './app/launch.ts';
import { alive, isKernel, probePort, runningKernel } from './app/probe.ts';
import { shortcutSpec, writeShortcuts } from './app/shortcut.ts';
import { appUrl, openWindow } from './app/window.ts';
import { REPO_ROOT, loadConfig } from './config.ts';
import { startKernel } from './main.ts';
import type { RunningKernel } from './main.ts';

const USAGE = `naos <command>

  open      the app, what a click runs  --port <n> --home <dir> --no-open --idle-exit <minutes>
  quit      stop the kernel, refused while a craft is alive  --home <dir>
  shortcut  NAOS.lnk in the Start menu and on the desktop    --dir <folder> --remove
  up        kernel on real sessions   --port <n> --home <dir> --no-open --idle-exit <minutes>
  fixture   scripted fleet, no calls  --port <n> --home <dir> --no-open --idle-exit <minutes>
  status    what the kernel is doing  --home <dir>
  stop-all  stop every owned craft    --home <dir>
  launch    spawn one craft           --world <id> | --cwd <dir>, --profile <name>, --budget <usd>, --copies <n>, --title <text>, <prompt...>
  mcp       stdio MCP shim for agents
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: 'string' },
    home: { type: 'string' },
    'no-open': { type: 'boolean', default: false },
    'idle-exit': { type: 'string' },
    dir: { type: 'string' },
    remove: { type: 'boolean', default: false },
    world: { type: 'string' },
    cwd: { type: 'string' },
    profile: { type: 'string' },
    budget: { type: 'string' },
    copies: { type: 'string' },
    title: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

function parsePort(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error(`--port must be 0 to 65535, not ${value}`);
  return port;
}

/** Minutes with nobody and nothing on the kernel. 0 means it never leaves by itself. */
const IDLE_EXIT_MINUTES = 30;

function parseMinutes(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes < 0) throw new Error(`--idle-exit must be a number of minutes, not ${value}`);
  return minutes;
}

async function run(mode: 'live' | 'fixture'): Promise<void> {
  const port = parsePort(values.port);
  const idleMinutes = parseMinutes(values['idle-exit']);
  const config = loadConfig({ mode, ...(port === undefined ? {} : { port }), ...(values.home === undefined ? {} : { home: values.home }) });

  let kernel: RunningKernel | undefined;
  let closing = false;
  const close = (): void => {
    if (closing) return;
    closing = true;
    (kernel?.stop() ?? Promise.resolve()).then(() => process.exit(0), () => process.exit(1));
  };
  kernel = await startKernel({ config, exit: close, ...(idleMinutes ? { idleExitMs: idleMinutes * 60_000 } : {}) });
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
  process.on('SIGBREAK', close);

  process.stdout.write(`${JSON.stringify({ event: 'ready', url: kernel.url })}\n`);
  if (mode === 'live' && !values['no-open']) openWindow(kernel.url, config.home, kernel.log);
}

/** A failure exits with 3, so the shortcut's launcher knows the user has already been told. */
const REPORTED = 3;

async function open(): Promise<void> {
  const port = parsePort(values.port);
  const config = loadConfig({ mode: 'live', ...(port === undefined ? {} : { port }), ...(values.home === undefined ? {} : { home: values.home }) });
  try {
    const opened = await openApp({
      config,
      idleMinutes: parseMinutes(values['idle-exit']) ?? IDLE_EXIT_MINUTES,
      tell: (text) => tellUser(config.home, text),
    });
    if (opened.how !== 'joined' && !values['no-open']) {
      const token = readFileSync(path.join(config.home, 'ui.token'), 'utf8').trim();
      openWindow(appUrl(opened.port, token), config.home, { warn: (msg) => tellUser(config.home, msg) });
    }
    process.stdout.write(`${JSON.stringify({ event: 'open', ...opened })}\n`);
  } catch (error) {
    // An unknown error's message can quote anything, so only a failure written for the user reaches the toast.
    tellUser(config.home, error instanceof OpenFailure ? error.message : 'NAOS could not start. See the logs in its home folder.');
    if (!(error instanceof OpenFailure)) process.stderr.write(`${String(error)}\n`);
    process.exitCode = REPORTED;
  }
}

/** Stopping the planes can take seconds, and an agent may have been working a moment ago. */
const QUIT_WAIT_MS = 20_000;

async function quit(): Promise<void> {
  const { home } = loadConfig({ mode: 'live', ...(values.home === undefined ? {} : { home: values.home }) });
  const running = runningKernel(home);
  await command({ type: 'kernel.quit' });
  const deadline = Date.now() + QUIT_WAIT_MS;
  while (running && alive(running.pid)) {
    if (Date.now() > deadline) throw new Error(`kernel ${running.pid} is still stopping`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  process.stdout.write(`${JSON.stringify({ event: 'quit' })}\n`);
}

async function shortcut(): Promise<void> {
  const spec = shortcutSpec({ nodePath: process.execPath, repoRoot: REPO_ROOT, windowsDir: process.env.SystemRoot ?? 'C:\\Windows' });
  process.stdout.write(`${await writeShortcuts({ spec, dir: values.dir, remove: values.remove })}\n`);
}

/** A running kernel of this home, reached with the UI token. The CLI is the operator, so it has UI scope. */
async function connection(): Promise<{ base: string; token: string }> {
  const { home } = loadConfig({ mode: 'live', ...(values.home === undefined ? {} : { home: values.home }) });
  const running = runningKernel(home);
  if (!running) throw new Error('no kernel is running for this home');
  const token = readFileSync(path.join(home, 'ui.token'), 'utf8').trim();
  // The run file can name a port that has since gone to someone else, and the token must not go there.
  if (!isKernel(await probePort(running.port, token))) throw new Error(`no kernel of this home answers on port ${running.port}`);
  return { base: `http://127.0.0.1:${running.port}`, token };
}

async function command(body: Command): Promise<unknown> {
  const { base, token } = await connection();
  const response = await fetch(`${base}/api/cmd`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as CommandResult;
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.result;
}

async function status(): Promise<void> {
  const { base, token } = await connection();
  const response = await fetch(`${base}/api/status`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`kernel answered ${response.status}`);
  process.stdout.write(`${JSON.stringify(await response.json())}\n`);
}

async function launch(): Promise<void> {
  const prompt = positionals.slice(1).join(' ');
  if (!prompt) throw new Error('launch needs a prompt');
  const spec: SpawnSpec = {
    profile: values.profile ?? 'recon',
    prompt,
    ...(values.world === undefined ? {} : { worldId: values.world }),
    ...(values.cwd === undefined ? {} : { cwd: path.resolve(values.cwd) }),
    ...(values.budget === undefined ? {} : { budgetUsd: Number(values.budget) }),
    ...(values.copies === undefined ? {} : { copies: Number(values.copies) }),
    ...(values.title === undefined ? {} : { title: values.title }),
  };
  process.stdout.write(`${JSON.stringify(await command({ type: 'agent.spawn', spec }))}\n`);
}

async function mcp(): Promise<void> {
  const shimPath = './control/mcp-shim.ts';
  const shim = (await import(shimPath)) as { main?: () => Promise<void>; runShim?: () => Promise<void> };
  await (shim.main ?? shim.runShim)?.();
}

async function main(): Promise<void> {
  const verb = positionals[0];
  if (values.help || verb === undefined) {
    process.stdout.write(USAGE);
    return;
  }
  switch (verb) {
    case 'open': return open();
    case 'quit': return quit();
    case 'shortcut': return shortcut();
    case 'up': return run('live');
    case 'fixture': return run('fixture');
    case 'status': return status();
    case 'stop-all':
      process.stdout.write(`${JSON.stringify(await command({ type: 'agent.stopAll' }))}\n`);
      return;
    case 'launch': return launch();
    case 'mcp': return mcp();
    default:
      throw new Error(`unknown command ${verb}`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`naos: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
