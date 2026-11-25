// A small stub of what the kernel gives a plane: the real reducer, a real SQLite file, and recording in place of a server.
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { StatementSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import type { CommandMap, CommandType, FleetRate, FleetState, NaosEvent, NodeId, NodeRate, World, WorldId } from '@naos/protocol';
import { emptyState, reduce } from '@naos/protocol';
import type { Bus, CommandHandler, Db, EventInit, KernelContext, Logger, ManagedRegistry, Router, Worlds } from '../../src/context.ts';

export interface Harness {
  ctx: KernelContext;
  events: NaosEvent[];
  rates: Map<NodeId, NodeRate>;
  fleet: Partial<FleetRate>;
  managed: Map<string, string>;
  logs: string[];
  state(): FleetState;
  call<K extends CommandType>(type: K, input: CommandMap[K]['in']): Promise<CommandMap[K]['out']>;
  of<T extends NaosEvent['type']>(type: T): Array<Extract<NaosEvent, { type: T }>>;
  close(): void;
}

export function makeHarness(claudeHome: string, dbFile = ':memory:'): Harness {
  let state = emptyState();
  let seq = 0;
  const events: NaosEvent[] = [];
  const subscribers = new Set<(e: NaosEvent, seq: number) => void>();
  const rates = new Map<NodeId, NodeRate>();
  const fleet: Partial<FleetRate> = {};

  const bus: Bus = {
    publish(init: EventInit) {
      const observedAt = init.observedAt ?? Date.now();
      seq += 1;
      const event = { ...init, id: init.id ?? `t-${seq}`, at: init.at ?? observedAt, observedAt } as NaosEvent;
      events.push(event);
      state = reduce(state, [event], seq);
      for (const fn of subscribers) fn(event, seq);
    },
    state: () => state,
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    pushText() {},
    setRate(rate) {
      rates.set(rate.nodeId, rate);
    },
    clearRate(nodeId) {
      rates.delete(nodeId);
    },
    setFleetRate(patch) {
      Object.assign(fleet, patch);
    },
  };

  const handlers = new Map<string, CommandHandler<CommandType>>();
  const router: Router = {
    register(type, handler) {
      handlers.set(type, handler as unknown as CommandHandler<CommandType>);
    },
  };

  const sqlite = new DatabaseSync(dbFile);
  const cache = new Map<string, StatementSync>();
  const prepare = (sql: string): StatementSync => {
    let st = cache.get(sql);
    if (!st) cache.set(sql, (st = sqlite.prepare(sql)));
    return st;
  };
  const db: Db = {
    exec: (sql) => sqlite.exec(sql),
    run(sql, ...params) {
      prepare(sql).run(...params);
    },
    get: <T>(sql: string, ...params: Parameters<Db['run']>[1][]) => prepare(sql).get(...params) as T | undefined,
    all: <T>(sql: string, ...params: Parameters<Db['run']>[1][]) => prepare(sql).all(...params) as T[],
  };

  const byId = new Map<WorldId, World>();
  const byKey = new Map<string, WorldId>();
  let slot = 0;
  const worlds: Worlds = {
    ensure(root, patch = {}) {
      const key = root === null ? `null:${patch.kind ?? 'rogue'}` : root.toLowerCase();
      const known = byKey.get(key);
      const base: World = (known ? byId.get(known) : undefined) ?? {
        worldId: createHash('sha256').update(key).digest('hex').slice(0, 16),
        projectRoot: root,
        name: root === null ? 'rogue' : path.posix.basename(root),
        slot: (slot += 1),
        kind: root === null ? 'rogue' : 'folder',
        isGit: false,
        trusted: false,
        massBytes: 0,
        massUsd30d: null,
        spendTodayUsd: null,
        lightsTotal: 0,
        lightsFailed: 0,
        lastActiveAt: null,
        worktrees: [],
      };
      const world = { ...base, ...patch, worldId: base.worldId, slot: base.slot, projectRoot: base.projectRoot };
      byId.set(world.worldId, world);
      byKey.set(key, world.worldId);
      bus.publish({ type: 'world.upserted', world });
      return world;
    },
    get: (id) => byId.get(id),
    find: (root) => {
      const id = byKey.get(root.toLowerCase());
      return id ? byId.get(id) : undefined;
    },
    setTrusted() {},
    setGenome() {},
  };

  const managedMap = new Map<string, string>();
  const managed: ManagedRegistry = {
    lookup: (key) => (key.sessionId ? managedMap.get(key.sessionId) ?? null : null),
    register: (agentId, key) => void managedMap.set(key.sessionId, agentId),
    unregister() {},
  };

  const logs: string[] = [];
  const log: Logger = {
    info: (msg, data) => void logs.push(`${msg} ${JSON.stringify(data ?? {})}`),
    warn: (msg, data) => void logs.push(`${msg} ${JSON.stringify(data ?? {})}`),
    error: (msg, data) => void logs.push(`${msg} ${JSON.stringify(data ?? {})}`),
  };

  const ctx: KernelContext = {
    config: { mode: 'live', port: 0, home: path.dirname(claudeHome), claudeHome, uiDist: '', repoRoot: '', devOrigins: [] },
    bus, router, db, log, worlds, managed,
  };

  return {
    ctx,
    events,
    rates,
    fleet,
    managed: managedMap,
    logs,
    state: () => state,
    async call(type, input) {
      const handler = handlers.get(type);
      if (!handler) throw new Error(`no handler for ${type}`);
      return (await handler({ type, ...input } as never, { scope: 'ui' })) as never;
    },
    of: (type) => events.filter((e) => e.type === type) as never,
    close: () => sqlite.close(),
  };
}

export const sid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** A `~/.claude` under the temp folder. Everything in it is written by these tests, placeholder text only. */
export class FakeClaude {
  readonly root: string;
  readonly home: string;
  readonly projects: string;
  readonly sessions: string;

  constructor() {
    this.root = mkdtempSync(path.join(os.tmpdir(), 'naos-obs-'));
    this.home = path.join(this.root, '.claude');
    this.projects = path.join(this.home, 'projects');
    this.sessions = path.join(this.home, 'sessions');
    mkdirSync(this.projects, { recursive: true });
    mkdirSync(this.sessions, { recursive: true });
  }

  repo(name: string): string {
    const dir = path.join(this.root, 'work', name);
    mkdirSync(path.join(dir, '.git'), { recursive: true });
    return dir;
  }

  mainPath(session: string, slug = 'slug-a'): string {
    mkdirSync(path.join(this.projects, slug), { recursive: true });
    return path.join(this.projects, slug, `${session}.jsonl`);
  }

  dir(session: string, slug = 'slug-a'): string {
    const dir = path.join(this.projects, slug, session);
    mkdirSync(path.join(dir, 'subagents'), { recursive: true });
    return dir;
  }

  append(file: string, ...records: object[]): void {
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, records.map((r) => `${JSON.stringify(r)}\n`).join(''));
  }

  pidFile(pid: number, record: object): string {
    const file = path.join(this.sessions, `${pid}.json`);
    writeFileSync(file, JSON.stringify({ pid, ...record }));
    return file;
  }

  cleanup(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}

/**
 * Waits on real time, because the plane under test runs on real timers. The limit only says how long a failing test takes,
 * and a starved machine stalled past 3 seconds, so it sits far above that. A latency the product promises gets its own assert.
 */
export async function until(check: () => boolean, ms = 20_000, step = 10): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, step));
  }
}
