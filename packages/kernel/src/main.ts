// Composition. The server listens first, then the planes start. A plane that fails is logged and the kernel keeps running,
// because the operator's view of the fleet must not depend on the part that steers it.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PROTOCOL_VERSION } from '@naos/protocol';
import type { KernelInfo } from '@naos/protocol';
import { createIdleWatch, liveCraft, openDecisions } from './app/lifetime.ts';
import type { IdleWatch } from './app/lifetime.ts';
import { isKernel, probePort, runFilePath, runningKernel } from './app/probe.ts';
import type { RunFile } from './app/probe.ts';
import { appUrl, openWindow } from './app/window.ts';
import { createBus } from './bus.ts';
import type { KernelBus } from './bus.ts';
import { SERVER_LIMITS, kernelVersion, toastsAllowed } from './config.ts';
import type { KernelConfig, KernelContext, Logger, ManagedRegistry, Plane } from './context.ts';
import { openDb } from './db.ts';
import { createFixture } from './fixture/index.ts';
import type { FixturePlane } from './fixture/index.ts';
import { FIXTURE_EPOCH, VEIL_SALT } from './fixture/scene.ts';
import { createLog } from './log.ts';
import { createNotifier } from './notify/notifier.ts';
import { raiseToast } from './notify/toast.ts';
import { ensureTokens } from './server/auth.ts';
import type { Tokens } from './server/auth.ts';
import { registerCoreCommands } from './server/commands.ts';
import type { HubLimits } from './server/hub.ts';
import { createServer } from './server/index.ts';
import type { KernelServer } from './server/index.ts';
import { openLink } from './server/open.ts';
import { createRouter } from './server/router.ts';
import type { KernelRouter } from './server/router.ts';
import { createWorlds } from './worlds.ts';
import { ExternalSources } from './sources/index.ts';

export interface StartOptions {
  config: KernelConfig;
  /** Replaces Observer and Control in live mode. Tests pass `[]`, so they touch nothing on this machine. */
  planes?: Plane[];
  /** Quiet stderr for tests that exercise refusals. */
  logToStderr?: boolean;
  limits?: HubLimits;
  /** Ends the process. The CLI gives this. Without it the kernel cannot quit or idle out, because a library has nothing to exit. */
  exit?: (reason: 'quit' | 'idle') => void;
  /** With `exit`, how long a kernel with nobody and nothing on it stays. `naos open` sets this, `up` does not. */
  idleExitMs?: number;
  /** Opens the app window from GET /open. Replaces the real one in tests. */
  openWindow?: (docket: string | null) => void;
}

export interface RunningKernel {
  config: KernelConfig;
  bus: KernelBus;
  router: KernelRouter;
  server: KernelServer;
  tokens: Tokens;
  log: Logger;
  fixture: FixturePlane | null;
  /** `/auth?token=<ui token>`. */
  url: string;
  /** Live planes start behind the ready line. This settles when they are up or have failed. */
  planesReady: Promise<void>;
  stop(): Promise<void>;
}

/** Kernels of this process. The run file cannot tell one of these from a recycled pid, so they are named here. */
const homesInProcess = new Set<string>();

const noRegistry: ManagedRegistry = { lookup: () => null, register: () => {}, unregister: () => {} };

/** Paths held in variables, so this file compiles and fixture mode starts while the planes are still being built. */
async function loadPlanes(log: Logger): Promise<{ observer: Plane | null; control: (Plane & { registry: ManagedRegistry }) | null }> {
  const observerPath = './observer/index.ts';
  const controlPath = './control/index.ts';
  let observer: Plane | null = null;
  let control: (Plane & { registry: ManagedRegistry }) | null = null;
  try {
    const module = (await import(observerPath)) as { createObserver(): Plane };
    observer = module.createObserver();
  } catch (error) {
    log.error('observer plane did not load', { error: String(error) });
  }
  try {
    const module = (await import(controlPath)) as { createControl(overrides?: { autoDesign?: boolean }): Plane & { registry: ManagedRegistry } };
    // A native-client workflow must not consume a Claude subscription in the background.
    control = module.createControl({ autoDesign: process.env.NAOS_AUTO_CLAUDE_DESIGN === '1' });
  } catch (error) {
    log.error('control plane did not load', { error: String(error) });
  }
  return { observer, control };
}

async function stopWithin(plane: Plane, log: Logger): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      log.warn('plane did not stop in time', { plane: plane.name });
      resolve();
    }, SERVER_LIMITS.planeStopMs);
  });
  await Promise.race([plane.stop().catch((error: unknown) => log.error('plane stop failed', { plane: plane.name, error: String(error) })), late]);
  clearTimeout(timer);
}

export async function startKernel(options: StartOptions): Promise<RunningKernel> {
  const { config } = options;
  mkdirSync(config.home, { recursive: true });

  if (config.mode === 'live') {
    if (homesInProcess.has(path.resolve(config.home))) throw new Error(`a kernel is already running for this home on port ${config.port} (this process)`);
    const running = runningKernel(config.home);
    // A pid alone can be recycled after a hard kill, so a stale file is only believed if this home's kernel answers there.
    if (running && running.pid !== process.pid && isKernel(await probePort(running.port, ensureTokens(config.home).ui))) {
      throw new Error(`a kernel is already running for this home on port ${running.port} (pid ${running.pid})`);
    }
  }

  const fixtureMode = config.mode === 'fixture';
  const log = createLog(config.home, { stderr: options.logToStderr ?? true });
  const tokens = ensureTokens(config.home);
  // The fixture leaves the real database and layout alone, and needs neither to survive it.
  const db = openDb(fixtureMode ? ':memory:' : path.join(config.home, 'naos.db'));
  db.exec('CREATE TABLE IF NOT EXISTS kernel_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');

  const kernel: KernelInfo = {
    version: kernelVersion(),
    protocol: PROTOCOL_VERSION,
    pid: process.pid,
    startedAt: fixtureMode ? FIXTURE_EPOCH : Date.now(),
    mode: config.mode,
    veilSalt: '',
    controlPlane: fixtureMode,
  };
  const bus = createBus({ kernel, log });
  const worlds = createWorlds({ home: config.home, bus, log, selfRoot: config.repoRoot, ...(fixtureMode ? { ephemeral: { veilSalt: VEIL_SALT } } : {}) });
  let info: KernelInfo = { ...kernel, veilSalt: worlds.veilSalt };
  bus.setKernel(info);

  const router = createRouter(log);
  const fixture = fixtureMode ? createFixture(bus) : null;
  let server: KernelServer | null = null;

  const notifier = createNotifier({
    bus,
    log,
    enabled: toastsAllowed(config.mode),
    raise: (toast) => raiseToast(toast, log),
    link: (requestId) => openLink(`http://127.0.0.1:${config.port}`, tokens.ui, requestId),
    connected: (clientId) => server?.hub.connected(clientId) ?? false,
    load: () => db.get<{ value: string }>("SELECT value FROM kernel_settings WHERE key = 'notifications'")?.value !== 'off',
    save: (on) => db.run(
      "INSERT INTO kernel_settings (key, value) VALUES ('notifications', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", on ? 'on' : 'off',
    ),
  });
  const { exit } = options;
  // The fixture answers `world.rename` itself, because its worlds live only on its timeline.
  registerCoreCommands(router, { bus, config, notifier, ...(fixtureMode ? {} : { worlds }), ...(exit ? { quit: () => exit('quit') } : {}) });
  let idle: IdleWatch | null = null;
  const openApp = options.openWindow ?? ((docket: string | null): void => openWindow(appUrl(config.port, tokens.ui, docket), config.home, log));

  const startedAt = Date.now();
  const context: KernelContext = { config, bus, router, db, log, worlds, managed: noRegistry };
  server = createServer({
    config,
    bus,
    router,
    tokens,
    log,
    ...(options.limits ? { limits: options.limits } : {}),
    // A fixture kernel starts nothing and opens nothing, and a toast never points at it.
    ...(fixtureMode ? {} : { openWindow: (docket: string | null) => { idle?.touch(); openApp(docket); } }),
    // `naos open` asks this before it opens a window, so a kernel about to idle out waits for that window.
    onIdentity: () => idle?.touch(),
    status: () => {
      const state = bus.state();
      return {
        kernel: state.kernel,
        port: config.port,
        uptimeMs: Date.now() - startedAt,
        seq: state.seq,
        sessions: Object.keys(state.sessions).length,
        nodes: Object.keys(state.nodes).length,
        managed: Object.keys(state.managed).length,
        openApprovals: Object.values(state.approvals).filter((approval) => approval.status === 'open').length,
        clients: server?.hub.stats().clients ?? 0,
      };
    },
  });
  server.hub.onClientGone((clientId) => notifier.drop(clientId));
  if (exit && options.idleExitMs) {
    const hub = server.hub;
    idle = createIdleWatch({
      limitMs: options.idleExitMs,
      read: () => ({ clients: hub.stats().clients, craft: liveCraft(bus.state()), decisions: openDecisions(bus.state()) }),
      onIdle: () => {
        log.info('idle exit', {});
        exit('idle');
      },
    });
  }

  let port: number;
  try {
    port = await server.listen(config.port);
  } catch (error) {
    // The hub's timers would keep a kernel alive that can never serve, and started detached nobody would see it.
    idle?.stop();
    notifier.stop();
    await server.close();
    db.close();
    await log.close();
    throw error;
  }
  log.info('listening', { port, mode: config.mode });
  if (config.mode === 'live') homesInProcess.add(path.resolve(config.home));
  worlds.publishAll();
  worlds.start();

  const planes: Plane[] = [];
  const startPlane = async (plane: Plane): Promise<boolean> => {
    try {
      await plane.start(context);
      planes.push(plane);
      log.info('plane started', { plane: plane.name });
      return true;
    } catch (error) {
      log.error('plane failed to start', { plane: plane.name, error: String(error) });
      return false;
    }
  };

  const startLive = async (): Promise<void> => {
    const injected = options.planes;
    const loaded = injected ? null : await loadPlanes(log);
    if (loaded?.control) context.managed = loaded.control.registry;
    for (const plane of injected ?? []) if ('registry' in plane) context.managed = plane.registry as ManagedRegistry;
    // Control first: the Observer must see which sessions are managed before it reports them.
    const controlUp = loaded?.control ? await startPlane(loaded.control) : false;
    if (loaded?.observer) await startPlane(loaded.observer);
    if (loaded) await startPlane(new ExternalSources());
    for (const plane of injected ?? []) await startPlane(plane);
    // Who watches is the hub's to know. A plane only pushes text, so nothing is lost when none registers this.
    if (!router.has('craft.watchText')) router.register('craft.watchText', () => ({}));
    if (!router.has('history.get')) router.register('history.get', () => ({ rows: context.externalHistory?.() ?? [], salvos: [] }));
    if (controlUp) {
      info = { ...info, controlPlane: true };
      bus.setKernel(info);
      server?.hub.resyncAll();
    }
  };

  let planesReady: Promise<void> = Promise.resolve();
  if (fixture) await startPlane(fixture);
  else planesReady = startLive().catch((error: unknown) => log.error('planes failed', { error: String(error) }));

  const tick = setInterval(() => bus.publish({ type: 'kernel.tick', uptimeMs: Date.now() - startedAt }), SERVER_LIMITS.tickMs);

  // A fixture started beside a live kernel must not take `naos stop-all` away from it.
  const other = runningKernel(config.home);
  const ownsRunFile = other === null || other.pid === process.pid || config.mode === 'live' || other.mode === 'fixture';
  if (ownsRunFile) {
    writeFileSync(runFilePath(config.home), `${JSON.stringify({ pid: process.pid, port, mode: config.mode, startedAt } satisfies RunFile)}\n`);
  }

  let stopping: Promise<void> | null = null;
  const stop = (): Promise<void> => {
    stopping ??= (async () => {
      clearInterval(tick);
      idle?.stop();
      await planesReady;
      notifier.stop();
      await worlds.stop();
      for (const plane of planes.slice().reverse()) await stopWithin(plane, log);
      await server?.close();
      if (ownsRunFile) rmSync(runFilePath(config.home), { force: true });
      db.close();
      await log.close();
      if (config.mode === 'live') homesInProcess.delete(path.resolve(config.home));
    })();
    return stopping;
  };

  return {
    config, bus, router, server, tokens, log, fixture, planesReady, stop,
    url: appUrl(port, tokens.ui),
  };
}
