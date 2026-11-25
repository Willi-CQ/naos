// The Observer plane: every Claude session on this machine, read only. Timers and watchers feed one set of tracks, and every
// publish happens here, so dedupe, ids and ordering live in one place. Timing rules come from RF 5.5.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type {
  Activity, AgentId, AgentNodeKind, AgentStatus, CostEstimate, HistoryDigest, IndexProgress, Liveness, LedgerReport, NodeId,
  ManagedAgentView, ObservedAgentNode, ObservedSession, PlanState, Salvo, SessionId, TokenUsage, ToolUseId, World, WorkflowRunId, WorldId,
} from '@naos/protocol';
import { MANAGED_TITLE_PREFIX, makeNodeId } from '@naos/protocol';
import type { EventInit, KernelContext, Plane } from '../context.ts';
import { CommandError } from '../context.ts';
import { agentActivity, sameActivity, sessionActivity } from './activity.ts';
import { readChannel, readText } from './channel.ts';
import { ledgerReport, rollup } from './ledger.ts';
import type { Spend } from './ledger.ts';
import { classifyProjectPath, configJsonPath, dayKey, normalizePath } from './paths.ts';
import type { ProjectPath } from './paths.ts';
import { Sensor, parseJournalLine, parseLine } from './parse.ts';
import { PidReader, classify, hostDomain, listPipes } from './pidfile.ts';
import type { PidRecord } from './pidfile.ts';
import { readPlan, samePlan } from './plan.ts';
import { addUsage, makeCost, sumUsage, zeroUsage } from './prices.ts';
import { projectOf, resolveProject } from './project.ts';
import type { ProjectInfo } from './project.ts';
import { RateTracker } from './rates.ts';
import { SalvoDetector, replaySalvos } from './salvo.ts';
import type { Launch } from './salvo.ts';
import { shallowWalk, walkSessionTree } from './scan.ts';
import type { AgentFile, RunFiles, SessionFiles } from './scan.ts';
import { drain, newCursor, readHeadTail, scanLines } from './tail.ts';
import type { Cursor } from './tail.ts';
import { TranscriptMachine } from './transcript.ts';
import type { Link, MachineSink, NodeEvent } from './transcript.ts';
import { contextWindow, readCatalog, readMeta } from './tree.ts';
import type { AgentMeta, ContextCatalog } from './tree.ts';
import { UsageIndex } from './usageIndex.ts';
import type { FileSummary, JournalSummary, WorkerResult, WorkerTask } from './usageScan.ts';
import { WorkflowRun, parseFinalState } from './workflows.ts';
import type { RunAgent } from './workflows.ts';

const WAIT_DEBOUNCE_MS = 400;
const MANAGED_LAUNCH_FRESH_MS = 5_000;
const PATH_DEBOUNCE_MS = 25;
const TICK_MS = 1_000;
const SHALLOW_MS = 5_000;
const FULL_WALK_MS = 60_000;
const PLAN_MS = 30_000;
const CATALOG_MS = 3_600_000;
const INDEX_FLUSH_MS = 250;
const TODAY_MS = 5_000;
const HOT_MS = 10 * 60_000;
const RETAIN_MS = 3_600_000;
const EVICT_CHECK_MS = 30_000;
const STALE_NO_PID_MS = 10 * 60_000;
const END_SETTLE_MS = 250;
const RECYCLED_HOLD_MS = 1_500;
/** Up to here a new file is replayed as live events, so a session just born loses nothing. */
const FRESH_BIRTH_MS = 30_000;
const MAIN_HEAD = 8 * 1024;
const MAIN_TAIL = 64 * 1024;
const AGENT_HEAD = 8 * 1024;
const AGENT_TAIL = 256 * 1024;
const DIGEST_BATCH = 256;
const HEAD_POOL = 8;

interface NodeTrack {
  nodeId: NodeId;
  agentId: AgentId | null;
  kind: AgentNodeKind;
  session: SessionTrack;
  path: string | null;
  metaPath: string | null;
  cursor: Cursor | null;
  /** The one read of a main transcript's start. Callers share it, because who the session is comes out of it. */
  attaching: Promise<void> | null;
  machine: TranscriptMachine;
  draining: boolean;
  again: boolean;
  /** Bytes before this offset belong to the worker. 0 means the tail has seen everything. */
  tailStart: number;
  baseline: FileSummary | null;
  baselineDone: boolean;
  baselineQueued: boolean;
  lastUsd: number;
  lastEventOffset: number;
  eventsAtOffset: number;

  status: AgentStatus;
  activity: Activity;
  startedAt: number | null;
  endedAt: number | null;
  parentNodeId: NodeId | null;
  linkedBy: ObservedAgentNode['linkedBy'];
  parentToolUseId: ToolUseId | null;
  spawnDepth: number;
  background: boolean | null;
  meta: AgentMeta | null;
  runId: WorkflowRunId | null;
  workflow: ObservedAgentNode['workflow'];
  sent: Map<string, string>;
}

interface RunTrack {
  run: WorkflowRun;
  session: SessionTrack;
  cursor: Cursor | null;
  draining: boolean;
  statePath: string | null;
  sent: string;
  dirty: boolean;
}

interface SessionTrack {
  sessionId: SessionId;
  rootNodeId: NodeId;
  pid: PidRecord | null;
  liveness: Liveness;
  recycledSince: number | null;
  project: ProjectInfo | null;
  worldId: WorldId;
  main: NodeTrack;
  agents: Map<AgentId, NodeTrack>;
  runs: Map<WorkflowRunId, RunTrack>;
  toolOwners: Map<ToolUseId, NodeId>;
  /** A run named in the transcript before its folder is seen. Which comes first is a race on every launch. */
  earlyRunLinks: Map<WorkflowRunId, Extract<Link, { kind: 'workflow' }>>;
  slugs: Set<string>;
  activity: Activity;
  blockedMs: number;
  waitSeenAt: number | null;
  waitTimer: NodeJS.Timeout | null;
  endedAt: number | null;
  ending: boolean;
  managed: boolean;
  discovered: boolean;
  treeDirty: boolean;
  sent: Map<string, string>;
  /** Set while who this session is gets read. Its events and children wait, because the bus has not heard of it yet. */
  settling: Promise<void> | null;
}

interface Indexed { files: SessionFiles; machine: TranscriptMachine; sink: NodeSink; cursor: Cursor; tailStart: number }

interface SessionRef { worldId: WorldId; root: string | null; startedAt: number | null }

interface FileEntry {
  path: string;
  nodeId: NodeId;
  sid: SessionId;
  agentId: AgentId | null;
  runId: WorkflowRunId | null;
  size: number;
  mtimeMs: number;
  birthMs: number;
}

interface WorldRoll { root: string | null; bytes: number; lights: number; failed: number; lastActive: number }

export interface ObserverTimings {
  pidMs: number;
  shallowMs: number;
  headMs: number;
  headFiles: number;
  bootMs: number;
  statMs: number;
  usageMs: number;
  usageFiles: number;
  usageCached: number;
}

class NodeSink implements MachineSink {
  node: NodeTrack | null = null;
  readonly held: Array<[Link, number]> = [];
  private readonly plane: Observer;

  constructor(plane: Observer) {
    this.plane = plane;
  }

  event(e: NodeEvent, at: number, offset: number): void {
    if (this.node) this.plane.nodeEvent(this.node, e, at, offset);
  }

  link(l: Link, at: number): void {
    if (this.node) this.plane.nodeLink(this.node, l, at);
    else this.held.push([l, at]);
  }
}

async function pool<T>(items: readonly T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}

const SESSION_SYNC = [
  'title', 'titleSource', 'displayName', 'worldId', 'projectRoot', 'startCwd', 'currentCwd', 'worktree', 'gitBranch', 'slugs',
  'transcriptPath', 'transcriptBytes', 'pid', 'liveness', 'kind', 'entrypoint', 'version', 'pidStatus', 'remoteControlled',
  'acceptsPeerMessages', 'queuedInputs', 'model', 'requestedModel', 'effort', 'permissionMode', 'startedAt', 'lastWriteAt',
  'usageTree', 'cost', 'contextTokens', 'contextWindow',
] as const satisfies ReadonlyArray<keyof ObservedSession>;

const AGENT_SYNC = [
  'parentNodeId', 'linkedBy', 'parentToolUseId', 'spawnDepth', 'agentType', 'name', 'description', 'model', 'effort', 'cwd',
  'worktreePath', 'worktreeBranch', 'background', 'workflow', 'transcriptPath', 'metaPath', 'transcriptBytes', 'startedAt',
] as const satisfies ReadonlyArray<keyof ObservedAgentNode>;

export class Observer implements Plane {
  readonly name = 'observer';
  readonly timings: ObserverTimings = {
    pidMs: 0, shallowMs: 0, headMs: 0, headFiles: 0, bootMs: 0, statMs: 0, usageMs: 0, usageFiles: 0, usageCached: 0,
  };

  private ctx!: KernelContext;
  private projectsDir = '';
  private sessionsDir = '';
  private configPath = '';
  private pids!: PidReader;
  private usage!: UsageIndex;
  private rates!: RateTracker;
  private readonly domain = hostDomain();
  private readonly sensor = new Sensor();
  /** A head is read twice when its file is young, and a tail repeats what a head saw, so head reads never count. */
  private readonly headSensor = new Sensor();
  private readonly salvos = new SalvoDetector();
  private readonly launchedManaged = new Set<AgentId>();
  private unsubscribe: (() => void) | null = null;
  private stopped = false;
  private booted = false;

  private readonly sessions = new Map<SessionId, SessionTrack>();
  private readonly aliases = new Map<SessionId, SessionId>();
  private readonly byPid = new Map<number, SessionTrack>();
  private readonly byPath = new Map<string, NodeTrack>();
  private files = new Map<SessionId, SessionFiles>();
  private readonly indexed = new Map<SessionId, Indexed>();
  private readonly refs = new Map<SessionId, SessionRef>();
  private readonly known = new Map<string, FileEntry>();
  private readonly nodeFile = new Map<NodeId, string>();
  private readonly rows = new Map<NodeId, HistoryDigest>();
  private readonly dirtyRows = new Set<NodeId>();
  private readonly failedNodes = new Set<NodeId>();
  private readonly completedNodes = new Set<NodeId>();
  private readonly staleSeen = new Set<string>();
  private readonly pastSalvos: Salvo[] = [];
  private catalog: ContextCatalog = new Map();
  private plan: PlanState | null = null;
  private planMtime = 0;

  private scanning: Promise<void> | null = null;
  private rescan = false;
  private usageQueued = false;
  private usageDone = false;
  private refreshing = false;
  private usageTotal = 0;
  private usageSeen = 0;
  private usageT0 = 0;
  private lastIndexFlush = 0;
  private lastTick = 0;
  private todayUsd: number | null = null;
  private todayAt = 0;

  private readonly watchers: fs.FSWatcher[] = [];
  private watchBroken = false;
  private readonly working = new Set<Promise<void>>();
  private readonly timers = new Set<NodeJS.Timeout>();
  private readonly pathTimers = new Map<string, NodeJS.Timeout>();
  private pidTimer: NodeJS.Timeout | null = null;
  private worldSent = new Map<WorldId, string>();

  async start(ctx: KernelContext): Promise<void> {
    this.ctx = ctx;
    const home = ctx.config.claudeHome;
    this.projectsDir = path.join(home, 'projects');
    this.sessionsDir = path.join(home, 'sessions');
    this.configPath = configJsonPath(home);
    this.pids = new PidReader(this.sessionsDir);
    this.rates = new RateTracker(ctx.bus);
    this.usage = new UsageIndex(ctx.db, ctx.log);
    this.usage.createTables();
    this.usage.load();
    this.usage.onResult = (r) => this.usageResult(r);
    this.usage.onDrained = () => this.usageDrained();
    ctx.db.exec('CREATE TABLE IF NOT EXISTS obs_salvo (salvo_id TEXT PRIMARY KEY, opened_at REAL NOT NULL, data TEXT NOT NULL)');
    ctx.db.exec('CREATE TABLE IF NOT EXISTS obs_blocked (key TEXT PRIMARY KEY, ms REAL NOT NULL)');
    this.registerHandlers();
    this.unsubscribe = ctx.bus.subscribe((e) => {
      if (e.type === 'managed.upserted') this.managedLaunch(e.agent);
    });
    await this.boot();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.unsubscribe?.();
    for (const t of this.timers) clearTimeout(t);
    for (const t of this.pathTimers.values()) clearTimeout(t);
    if (this.pidTimer) clearTimeout(this.pidTimer);
    for (const s of this.sessions.values()) if (s.waitTimer) clearTimeout(s.waitTimer);
    this.timers.clear();
    this.pathTimers.clear();
    for (const w of this.watchers) w.close();
    this.watchers.length = 0;
    // What is mid-flight touches the database next, and the kernel closes that as soon as this returns.
    while (this.working.size > 0) await Promise.allSettled(this.working);
    await this.usage?.stop();
  }

  /** Work no caller waits for. It may fail, which must not end the kernel, and stop has to see it finish. */
  private detach(work: () => Promise<void>): void {
    const task: Promise<void> = work().catch((e: unknown) => {
      this.ctx.log.error('observer task failed', { message: e instanceof Error ? e.message : 'unknown' });
    }).finally(() => this.working.delete(task));
    this.working.add(task);
  }

  private every(ms: number, fn: () => Promise<void> | void): void {
    const run = async (): Promise<void> => {
      this.timers.delete(timer);
      if (this.stopped) return;
      try {
        await fn();
      } catch (e) {
        this.ctx.log.error('observer loop failed', { message: e instanceof Error ? e.message : 'unknown' });
      }
      if (this.stopped) return;
      timer = setTimeout(() => this.detach(run), ms);
      timer.unref();
      this.timers.add(timer);
    };
    let timer = setTimeout(() => this.detach(run), ms);
    timer.unref();
    this.timers.add(timer);
  }

  private later(ms: number, fn: () => Promise<void> | void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.stopped) this.detach(async () => fn());
    }, ms);
    timer.unref();
    this.timers.add(timer);
  }

  private progress(progress: IndexProgress): void {
    this.ctx.bus.publish({ type: 'index.progress', progress });
  }

  // Boot, RF 5.5.

  private async boot(): Promise<void> {
    const t0 = performance.now();
    await this.pids.read();
    this.timings.pidMs = performance.now() - t0;

    const t1 = performance.now();
    this.files = await shallowWalk(this.projectsDir);
    this.timings.shallowMs = performance.now() - t1;
    const mains = [...this.files.values()].filter((f) => f.main);
    this.progress({ stage: 'stat', done: mains.length, total: mains.length });

    const t2 = performance.now();
    let done = 0;
    await pool(mains, HEAD_POOL, async (f) => {
      const entry = await this.indexMain(f);
      if (entry) this.indexed.set(f.sid, entry);
      done += 1;
      if (done % 16 === 0) this.progress({ stage: 'head', done, total: mains.length });
    });
    this.progress({ stage: 'head', done: mains.length, total: mains.length });
    this.timings.headMs = performance.now() - t2;
    this.timings.headFiles = mains.length;

    for (const [sid, entry] of this.indexed) this.refFor(sid, entry.machine);

    await this.loadCatalog();
    await this.pidScan();

    const now = Date.now();
    for (const [sid, entry] of this.indexed) {
      const main = entry.files.main;
      if (!main || this.sessions.has(sid) || now - main.mtimeMs >= RETAIN_MS) continue;
      await this.discover(sid, null, 'unknown', main.mtimeMs);
    }
    await this.planTick();
    this.booted = true;
    this.timings.bootMs = performance.now() - t0;

    this.indexed.clear();
    this.startWatchers();
    this.every(TICK_MS, () => this.tick());
    this.every(SHALLOW_MS, () => this.shallowTick());
    this.every(FULL_WALK_MS, () => this.refreshFiles());
    this.every(PLAN_MS, () => this.planTick());
    this.every(CATALOG_MS, () => this.loadCatalog());
    this.every(EVICT_CHECK_MS, () => this.evict());
    this.ctx.log.info('observer ready', { ...this.timings, sessions: this.sessions.size });
    this.later(0, () => this.refreshFiles());
  }

  private makeMachine(silent: boolean): { machine: TranscriptMachine; sink: NodeSink } {
    const sink = new NodeSink(this);
    return { machine: new TranscriptMachine(sink, { silent }), sink };
  }

  /** Reads head and tail silently, and returns a cursor that continues right where the tail ended. */
  private async seed(machine: TranscriptMachine, file: string, size: number, headBytes: number, tailBytes: number): Promise<{ cursor: Cursor; tailStart: number } | null> {
    const read = await readHeadTail(file, size, headBytes, tailBytes);
    if (!read) return null;
    this.feedHead(machine, read.head);
    const cursor = newCursor(file, read.tailFrom, read.tailFrom > 0);
    let first = -1;
    scanLines(cursor, read.tail, read.tailFrom, (line, offset) => {
      if (first < 0) first = offset;
      this.feed(machine, line, offset);
    });
    cursor.offset = read.tailFrom + read.tail.length;
    cursor.size = size;
    machine.endChunk();
    return { cursor, tailStart: first < 0 ? cursor.offset : first };
  }

  private feedHead(machine: TranscriptMachine, head: Buffer): void {
    let start = 0;
    for (let nl = head.indexOf(10); nl !== -1; start = nl + 1, nl = head.indexOf(10, start)) {
      if (nl === start) continue;
      const r = parseLine(head.subarray(start, nl), this.headSensor);
      if (r) machine.head(r);
    }
  }

  private feed(machine: TranscriptMachine, line: Buffer, offset: number): void {
    const r = parseLine(line, this.sensor);
    if (!r) return;
    try {
      machine.feed(r, offset);
    } catch {
      this.sensor.bump('parseErrors');
    }
  }

  private async indexMain(f: SessionFiles): Promise<Indexed | null> {
    const main = f.main;
    if (!main) return null;
    const { machine, sink } = this.makeMachine(true);
    const seeded = await this.seed(machine, main.path, main.size, MAIN_HEAD, MAIN_TAIL);
    if (!seeded) return null;
    seeded.cursor.mtimeMs = main.mtimeMs;
    return { files: f, machine, sink, cursor: seeded.cursor, tailStart: seeded.tailStart };
  }

  private ensureWorld(info: ProjectInfo): World {
    return this.ctx.worlds.ensure(info.root, { kind: info.kind, isGit: info.isGit });
  }

  private refFor(sid: SessionId, m: TranscriptMachine): SessionRef {
    const info = projectOf(m.relocatedCwd ?? m.firstCwd, m.worktree);
    const world = this.ensureWorld(info);
    if (info.worktree) this.addMoon(world, info.worktree.path, info.worktree.name, m.gitBranch);
    const ref: SessionRef = { worldId: world.worldId, root: world.projectRoot, startedAt: m.firstAt };
    this.refs.set(sid, ref);
    return ref;
  }

  private addMoon(world: World, wtPath: string, name: string, branch: string | null): void {
    if (world.worktrees.some((w) => w.path === wtPath)) return;
    const worktrees = [...world.worktrees, { path: wtPath, name, branch: branch === 'HEAD' ? null : branch }];
    this.ctx.worlds.ensure(world.projectRoot, { worktrees });
  }

  // Tracks.

  private newNode(session: SessionTrack, kind: AgentNodeKind, agentId: AgentId | null, machine: TranscriptMachine, sink: NodeSink): NodeTrack {
    const n: NodeTrack = {
      nodeId: makeNodeId(session.sessionId, agentId ?? undefined),
      agentId,
      kind,
      session,
      path: null,
      metaPath: null,
      cursor: null,
      attaching: null,
      machine,
      draining: false,
      again: false,
      tailStart: 0,
      baseline: null,
      baselineDone: true,
      baselineQueued: false,
      lastUsd: 0,
      lastEventOffset: -1,
      eventsAtOffset: 0,
      status: 'running',
      activity: { state: 'starting', since: Date.now() },
      startedAt: null,
      endedAt: null,
      parentNodeId: null,
      linkedBy: 'root',
      parentToolUseId: null,
      spawnDepth: 0,
      background: null,
      meta: null,
      runId: null,
      workflow: null,
      sent: new Map(),
    };
    sink.node = n;
    for (const [l, at] of sink.held.splice(0)) this.nodeLink(n, l, at);
    return n;
  }

  private newSession(sid: SessionId, entry: Indexed | undefined): SessionTrack {
    const { machine, sink } = entry ?? this.makeMachine(false);
    const s: SessionTrack = {
      sessionId: sid,
      rootNodeId: makeNodeId(sid),
      pid: null,
      liveness: 'unknown',
      recycledSince: null,
      project: null,
      worldId: '',
      main: undefined as unknown as NodeTrack,
      agents: new Map(),
      runs: new Map(),
      toolOwners: new Map(),
      earlyRunLinks: new Map(),
      slugs: new Set(),
      activity: { state: 'starting', since: Date.now() },
      blockedMs: 0,
      waitSeenAt: null,
      waitTimer: null,
      endedAt: null,
      ending: false,
      managed: false,
      discovered: false,
      treeDirty: false,
      sent: new Map(),
      settling: null,
    };
    s.main = this.newNode(s, 'main', null, machine, sink);
    this.sessions.set(sid, s);
    return s;
  }

  private adoptIndexed(s: SessionTrack, entry: Indexed): void {
    const n = s.main;
    const main = entry.files.main;
    if (!main) return;
    n.machine.silent = false;
    n.path = main.path;
    n.cursor = entry.cursor;
    this.setTail(n, entry.tailStart);
    this.byPath.set(main.path, n);
  }

  private setTail(n: NodeTrack, tailStart: number): void {
    n.tailStart = tailStart;
    n.baselineDone = tailStart === 0;
    n.lastUsd = n.machine.book.estimateUsd;
  }

  /** Keeps a session off the bus until it is known, so parents go first and a managed one never shows. */
  private hold(s: SessionTrack): () => void {
    const { promise, resolve } = Promise.withResolvers<void>();
    s.settling = promise;
    return () => {
      s.settling = null;
      resolve();
    };
  }

  /** A main transcript that appeared after boot. */
  private async attachMain(s: SessionTrack, file: string, drainNow: boolean): Promise<void> {
    const n = s.main;
    if (!n.cursor) {
      n.attaching ??= this.readMain(s, n, file).finally(() => {
        n.attaching = null;
      });
      await n.attaching;
    }
    if (drainNow) await this.drainNode(n);
  }

  /** Young means every line reads as live, old means a resume, seeded silently. The cursor comes last: nothing drains before it. */
  private async readMain(s: SessionTrack, n: NodeTrack, file: string): Promise<void> {
    const st = await fsp.stat(file).catch(() => null);
    if (!st) return;
    let cursor: Cursor;
    let seededFrom: number | null = null;
    if (Date.now() - st.birthtimeMs < FRESH_BIRTH_MS) {
      cursor = newCursor(file);
      // Who this session is must be known before it is published: its world, and a `naos:` title, which is the first record.
      const read = await readHeadTail(file, st.size, MAIN_HEAD, MAIN_HEAD);
      if (read) {
        this.feedHead(n.machine, read.head);
        this.feedHead(n.machine, read.tail);
      }
    } else {
      n.machine.silent = true;
      const seeded = await this.seed(n.machine, file, st.size, MAIN_HEAD, MAIN_TAIL);
      n.machine.silent = false;
      if (!seeded) return;
      cursor = seeded.cursor;
      cursor.mtimeMs = st.mtimeMs;
      seededFrom = seeded.tailStart;
    }
    // `/clear` can replace the node while this read was out.
    if (this.stopped || s.main !== n) return;
    n.path = file;
    n.cursor = cursor;
    this.byPath.set(file, n);
    if (seededFrom !== null) {
      this.setTail(n, seededFrom);
      if (seededFrom > 0) this.requestBaseline(n);
    }
    this.syncWorld(s);
    if (!s.managed && this.isManaged(s)) s.managed = true;
    // Parents first: the path goes out before any event read from it.
    this.syncSession(s);
  }

  private async discover(sid: SessionId, rec: PidRecord | null, liveness: Liveness, endedAt: number | null = null): Promise<SessionTrack> {
    const existing = this.sessions.get(sid);
    if (existing) return existing;
    const entry = this.indexed.get(sid);
    const s = this.newSession(sid, entry);
    s.pid = rec;
    s.liveness = liveness === 'recycled' ? 'unknown' : liveness;
    if (rec) this.byPid.set(rec.pid, s);

    const release = this.hold(s);
    let files: SessionFiles | null;
    try {
      // A walk can have caught the session's folder before its transcript, so only an entry with a transcript is an answer.
      const known = this.files.get(sid);
      files = known?.main ? known : await this.findFiles(sid);
      if (files) for (const slug of files.slugs) s.slugs.add(slug);
      if (entry) this.adoptIndexed(s, entry);
      else if (files?.main) await this.attachMain(s, files.main.path, false);
      if (this.stopped) return s;

      this.syncWorld(s);
      s.managed = this.isManaged(s);
      s.blockedMs = this.ctx.db.get<{ ms: number }>('SELECT ms FROM obs_blocked WHERE key = ?', `s:${sid}`)?.ms ?? 0;

      if (endedAt !== null) {
        s.endedAt = endedAt;
        s.main.status = 'unknown';
        s.main.endedAt = endedAt;
        s.activity = { state: 'finished', since: endedAt, outcome: s.main.machine.outcome() };
        s.main.activity = s.activity;
      } else {
        s.activity = this.initialActivity(s);
        s.main.activity = s.activity;
      }
      this.publishDiscovered(s);
    } finally {
      release();
    }
    await this.drainNode(s.main);
    if (this.stopped) return s;

    if (files) await this.attachTree(s, files);
    if (endedAt === null) this.applyMainActivity(s);
    return s;
  }

  private initialActivity(s: SessionTrack): Activity {
    const now = Date.now();
    const m = s.main.machine;
    const rec = s.pid;
    if (!rec) return agentActivity(m, s.activity, now);
    return sessionActivity({ status: rec.status, waitingFor: rec.waitingFor, statusAt: rec.statusUpdatedAt }, m, s.activity, now);
  }

  private publishDiscovered(s: SessionTrack): void {
    if (this.quiet(s)) return;
    const session = this.sessionView(s);
    s.discovered = true;
    for (const key of SESSION_SYNC) s.sent.set(key, JSON.stringify(session[key]));
    this.ctx.bus.publish({
      type: 'session.discovered', sessionId: s.sessionId, nodeId: s.rootNodeId, session,
      ...(s.main.machine.lastAt ? { at: s.main.machine.lastAt } : {}),
    });
    const m = s.main.machine;
    if (m.toolCalls > 0 || m.errors > 0) this.mainCounts(s);
    if (s.endedAt !== null) {
      // Published with its ending already known, so this only settles the main node's status, and adds no tape row.
      const outcome = s.activity.state === 'finished' ? s.activity.outcome : 'unknown';
      this.ctx.bus.publish({ type: 'session.ended', sessionId: s.sessionId, nodeId: s.rootNodeId, at: s.endedAt, outcome, reason: 'exit' });
    }
  }

  private mainCounts(s: SessionTrack): void {
    const n = s.main;
    const m = n.machine;
    this.ctx.bus.publish({
      type: 'agent.changed', sessionId: s.sessionId, nodeId: s.rootNodeId,
      patch: {
        toolCalls: (n.baseline?.toolCalls ?? 0) + m.toolCalls,
        errors: (n.baseline?.errors ?? 0) + m.errors,
        lastToolName: m.lastToolName,
      },
    });
  }

  private async findFiles(sid: SessionId): Promise<SessionFiles | null> {
    this.files = await shallowWalk(this.projectsDir);
    return this.files.get(sid) ?? null;
  }

  private quiet(s: SessionTrack): boolean {
    return s.managed;
  }

  /** AC 13. The registry first, the `naos:` title as the fallback for a kernel restart or a session it no longer knows. */
  private isManaged(s: SessionTrack): boolean {
    const name = s.pid?.name ?? undefined;
    const title = s.main.machine.customTitle ?? name;
    const key: { sessionId: SessionId; pid?: number; title?: string } = { sessionId: s.sessionId };
    if (s.pid) key.pid = s.pid.pid;
    if (title) key.title = title;
    if (this.ctx.managed.lookup(key) !== null) return true;
    return Boolean(title?.startsWith(MANAGED_TITLE_PREFIX)) || Boolean(name?.startsWith(MANAGED_TITLE_PREFIX));
  }

  private syncWorld(s: SessionTrack): void {
    const m = s.main.machine;
    const foreign = s.liveness === 'foreign';
    const start = m.relocatedCwd ?? m.firstCwd ?? s.pid?.cwd ?? null;
    const info: ProjectInfo = foreign
      ? { root: start ? normalizePath(start) : null, kind: 'offworld', isGit: false, worktree: null }
      : projectOf(start, m.worktree);
    const same = s.project && s.project.root?.toLowerCase() === info.root?.toLowerCase()
      && s.project.kind === info.kind && s.project.worktree?.path === info.worktree?.path;
    if (same) return;
    const world = this.ensureWorld(info);
    // Worlds owns the spelling of a root, so a session and its world compare as strings.
    s.project = { ...info, root: world.projectRoot };
    s.worldId = world.worldId;
    if (info.worktree) this.addMoon(world, info.worktree.path, info.worktree.name, m.gitBranch);
    this.refs.set(s.sessionId, { worldId: world.worldId, root: world.projectRoot, startedAt: m.firstAt });
  }

  private nodeUsage(n: NodeTrack): TokenUsage {
    const total = sumUsage(n.machine.book.total);
    if (n.baseline) {
      addUsage(total, n.baseline.usage);
      const edge = n.baseline.lastMessage;
      if (edge && n.machine.book.has(edge.id)) addUsage(total, edge.usage, -1);
    }
    return total;
  }

  private nodeEstimate(n: NodeTrack): number {
    let usd = n.machine.book.estimateUsd;
    if (n.baseline) {
      usd += n.baseline.estimateUsd;
      const edge = n.baseline.lastMessage;
      if (edge && n.machine.book.has(edge.id)) usd -= edge.usd;
    }
    return usd;
  }

  private nodeCost(n: NodeTrack): CostEstimate {
    const usage = this.nodeUsage(n);
    const unpriced = [...n.machine.book.unpriced, ...(n.baseline?.unpriced ?? [])];
    return makeCost(this.nodeEstimate(n), null, unpriced, !n.baselineDone || usage.partialOutputMessages > 0);
  }

  /** The whole tree, because `cost-state` covers subagents too (RF 3.4), and a session's cost is what it spent. */
  private sessionCost(s: SessionTrack): CostEstimate {
    let usd = this.nodeEstimate(s.main);
    const unpriced = [...s.main.machine.book.unpriced, ...(s.main.baseline?.unpriced ?? [])];
    let lower = !s.main.baselineDone;
    for (const n of s.agents.values()) {
      const c = this.nodeCost(n);
      usd += c.estimateUsd;
      unpriced.push(...c.unpricedModels);
      lower ||= c.isLowerBound;
    }
    lower ||= this.nodeUsage(s.main).partialOutputMessages > 0;
    const state = Math.max(s.main.machine.costStateUsd ?? 0, s.main.baseline?.costStateUsd ?? 0);
    return makeCost(usd, state > 0 ? state : null, unpriced, lower);
  }

  private treeUsage(s: SessionTrack): TokenUsage {
    const total = this.nodeUsage(s.main);
    for (const n of s.agents.values()) addUsage(total, this.nodeUsage(n));
    return total;
  }

  private sessionView(s: SessionTrack): ObservedSession {
    const n = s.main;
    const m = n.machine;
    const rec = s.pid;
    const alive = s.endedAt === null && rec !== null;
    const t = m.title();
    const wt = s.project?.worktree ?? null;
    const worktree = wt
      ? { path: wt.path, name: wt.name, ...(m.gitBranch ? { branch: m.gitBranch } : {}) }
      : null;
    const pidStatus = rec?.status;
    return {
      sessionId: s.sessionId,
      origin: 'observer',
      worldId: s.worldId,
      title: t.title,
      titleSource: t.source,
      displayName: rec?.name ?? null,
      projectRoot: s.project?.root ?? null,
      startCwd: m.relocatedCwd ?? m.firstCwd ?? rec?.cwd ?? null,
      currentCwd: alive ? rec?.cwd ?? m.lastCwd : m.lastCwd,
      worktree,
      gitBranch: m.gitBranch,
      slugs: [...s.slugs],
      transcriptPath: n.path,
      transcriptBytes: n.cursor?.size ?? 0,
      pid: rec?.pid ?? null,
      liveness: s.liveness,
      kind: rec?.kind ?? 'unknown',
      entrypoint: rec?.entrypoint ?? m.entrypoint,
      version: rec?.version ?? m.version,
      pidStatus: pidStatus === 'busy' || pidStatus === 'idle' || pidStatus === 'shell' || pidStatus === 'waiting' ? pidStatus : null,
      remoteControlled: m.remote || Boolean(rec?.bridgeSessionId),
      acceptsPeerMessages: rec ? rec.messagingSocketPath !== null : null,
      activity: s.activity,
      queuedInputs: m.queued,
      model: m.model,
      requestedModel: m.requestedModel,
      effort: m.effort,
      permissionMode: m.permissionMode,
      startedAt: rec?.startedAt ?? m.firstAt,
      lastRecordAt: m.lastAt,
      lastWriteAt: n.cursor?.mtimeMs || null,
      endedAt: s.endedAt,
      usage: this.nodeUsage(n),
      usageTree: this.treeUsage(s),
      cost: this.sessionCost(s),
      contextTokens: m.contextTokens,
      contextWindow: contextWindow(this.catalog, m.model, m.requestedModel),
      blockedMs: s.blockedMs,
      rootNodeId: s.rootNodeId,
      agentCount: 0,
      runningAgentCount: 0,
      workflowRunIds: [...s.runs.keys()],
      lastRateLimit: null,
    };
  }

  private syncSession(s: SessionTrack): void {
    if (!s.discovered || s.settling || this.quiet(s)) return;
    const view = this.sessionView(s);
    const patch: Record<string, unknown> = {};
    let any = false;
    for (const key of SESSION_SYNC) {
      const text = JSON.stringify(view[key]);
      if (s.sent.get(key) === text) continue;
      s.sent.set(key, text);
      patch[key] = view[key];
      any = true;
    }
    if (any) {
      this.ctx.bus.publish({
        type: 'session.changed', sessionId: s.sessionId, nodeId: s.rootNodeId, patch: patch as Partial<ObservedSession>,
      });
    }
  }

  private agentView(n: NodeTrack): ObservedAgentNode {
    const m = n.machine;
    const meta = n.meta;
    return {
      nodeId: n.nodeId,
      sessionId: n.session.sessionId,
      kind: n.kind,
      agentId: n.agentId,
      parentNodeId: n.parentNodeId,
      childNodeIds: [],
      linkedBy: n.linkedBy,
      parentToolUseId: n.parentToolUseId,
      spawnDepth: n.spawnDepth,
      agentType: meta?.agentType ?? null,
      name: meta?.name ?? null,
      description: meta?.description ?? null,
      model: meta?.model ?? m.model,
      effort: meta?.effort ?? m.effort,
      cwd: meta?.cwd ?? m.lastCwd,
      worktreePath: meta?.worktreePath ?? null,
      worktreeBranch: meta?.worktreeBranch ?? null,
      background: n.background,
      workflow: n.workflow,
      transcriptPath: n.path,
      metaPath: n.metaPath,
      transcriptBytes: n.cursor?.size ?? 0,
      status: n.status,
      activity: n.activity,
      flushLagMs: null,
      startedAt: n.startedAt ?? m.firstAt,
      lastRecordAt: m.lastAt,
      endedAt: n.endedAt,
      usage: this.nodeUsage(n),
      cost: this.nodeCost(n),
      toolCalls: (n.baseline?.toolCalls ?? 0) + m.toolCalls,
      errors: (n.baseline?.errors ?? 0) + m.errors,
      lastToolName: m.lastToolName,
    };
  }

  private syncAgent(n: NodeTrack): void {
    const view = this.agentView(n);
    const patch: Record<string, unknown> = {};
    let any = false;
    for (const key of AGENT_SYNC) {
      const text = JSON.stringify(view[key]);
      if (n.sent.get(key) === text) continue;
      n.sent.set(key, text);
      patch[key] = view[key];
      any = true;
    }
    if (any) {
      this.ctx.bus.publish({
        type: 'agent.changed', sessionId: n.session.sessionId, nodeId: n.nodeId, patch: patch as Partial<ObservedAgentNode>,
      });
    }
  }

  private publishAgentStarted(n: NodeTrack): void {
    const node = this.agentView(n);
    for (const key of AGENT_SYNC) n.sent.set(key, JSON.stringify(node[key]));
    this.ctx.bus.publish({
      type: 'agent.started', sessionId: n.session.sessionId, nodeId: n.nodeId, node,
      ...(node.startedAt ? { at: node.startedAt } : {}),
    });
  }

  // Tailing.

  /** Called by the machine's sink, once per event, with the file offset of the record behind it. */
  nodeEvent(n: NodeTrack, e: NodeEvent, at: number, offset: number): void {
    if (this.stopped) return;
    const s = n.session;
    const observedAt = Date.now();
    this.rates.lag(observedAt - at, observedAt);
    if (e.type === 'message.completed') {
      const started = n.machine.requestAt;
      const duration = started !== null && at >= started ? at - started : 0;
      if (!(n === s.main && this.quiet(s))) this.rates.message(n.nodeId, s.worldId, e.usage.output, duration, observedAt);
    }
    if (n === s.main && this.quiet(s)) return;
    if (offset !== n.lastEventOffset) {
      n.lastEventOffset = offset;
      n.eventsAtOffset = 0;
    }
    const id = `${n.path ?? n.nodeId}:${offset}.${n.eventsAtOffset}`;
    n.eventsAtOffset += 1;
    this.ctx.bus.publish({ ...e, id, at, observedAt, sessionId: s.sessionId, nodeId: n.nodeId } as EventInit);
  }

  /** Joins found in a transcript. They arrive in any order against the agent files, so each side looks for the other. */
  nodeLink(n: NodeTrack, l: Link, at: number): void {
    const s = n.session;
    switch (l.kind) {
      case 'launch':
        s.toolOwners.set(l.toolUseId, n.nodeId);
        for (const child of s.agents.values()) if (child.parentToolUseId === l.toolUseId) this.linkParent(child);
        return;
      case 'agent': {
        const child = s.agents.get(l.agentId);
        if (!child) return;
        child.parentToolUseId ??= l.toolUseId;
        if (l.status === 'async_launched') child.background = true;
        this.linkParent(child);
        if (l.status && l.status !== 'async_launched') {
          this.endAgent(child, l.isError ? 'failed' : 'completed', at);
        }
        return;
      }
      case 'workflow': {
        const rt = s.runs.get(l.runId);
        if (!rt) {
          s.toolOwners.set(l.runId, n.nodeId);
          s.earlyRunLinks.set(l.runId, l);
          return;
        }
        this.applyRunLink(rt, l);
        return;
      }
      case 'notification': {
        if (!l.toolUseId || !l.status) return;
        for (const child of s.agents.values()) {
          if (child.parentToolUseId !== l.toolUseId) continue;
          if (l.status === 'completed') this.endAgent(child, 'completed', at);
          else if (l.status === 'failed') this.endAgent(child, 'failed', at);
          else if (l.status === 'killed' || l.status === 'stopped') this.endAgent(child, 'stopped', at);
        }
        return;
      }
    }
  }

  private async drainNode(n: NodeTrack): Promise<void> {
    const cursor = n.cursor;
    // A settling session drains as soon as it is published, and a drain now would go out ahead of it.
    if (!cursor || this.stopped || n.session.settling) return;
    if (n.draining) {
      n.again = true;
      return;
    }
    n.draining = true;
    let moved = false;
    try {
      do {
        n.again = false;
        const res = await drain(cursor, (line, offset) => this.feed(n.machine, line, offset));
        if (res.oversized > 0) this.sensor.bump('parseErrors', res.oversized);
        if (res.state === 'reset') {
          this.sensor.bump('tailResets');
          n.machine.resetTail();
          if (!(n === n.session.main && this.quiet(n.session))) {
            this.ctx.bus.publish({
              type: 'tail.reset', sessionId: n.session.sessionId, nodeId: n.nodeId, path: cursor.path, reason: res.reason,
            });
          }
          moved = true;
        } else if (res.state === 'data') {
          moved = true;
        }
        n.machine.endChunk();
      } while (n.again && !this.stopped);
    } finally {
      n.draining = false;
    }
    if (moved && !this.stopped) this.afterDrain(n);
  }

  private afterDrain(n: NodeTrack): void {
    const s = n.session;
    const m = n.machine;
    if (m.usageDirty) {
      m.usageDirty = false;
      this.publishUsage(n);
      s.treeDirty = true;
      if (n.runId) {
        const rt = s.runs.get(n.runId);
        if (rt) rt.dirty = true;
      }
    }
    if (n === s.main) {
      if (m.metaDirty) {
        m.metaDirty = false;
        this.syncWorld(s);
        if (!s.managed && this.isManaged(s)) s.managed = true;
      }
      this.applyMainActivity(s);
      this.syncSession(s);
    } else {
      this.applyAgentActivity(n);
      this.syncAgent(n);
    }
  }

  private publishUsage(n: NodeTrack): void {
    const s = n.session;
    const m = n.machine;
    const delta = m.book.estimateUsd - n.lastUsd;
    n.lastUsd = m.book.estimateUsd;
    // Boot replays the tail of every transcript. That money was spent long ago, so it is no burn.
    if (this.booted) this.rates.cost(delta, Date.now());
    if (n === s.main && this.quiet(s)) return;
    const usage = this.nodeUsage(n);
    const cost = n === s.main ? this.sessionCost(s) : this.nodeCost(n);
    this.ctx.bus.publish({
      type: 'usage.changed', sessionId: s.sessionId, nodeId: n.nodeId, usage, cost,
      ...(m.lastAt ? { at: m.lastAt } : {}),
    });
  }

  private setMainActivity(s: SessionTrack, next: Activity): void {
    if (sameActivity(s.activity, next)) return;
    s.activity = next;
    s.main.activity = next;
    if (this.quiet(s) || !s.discovered) return;
    this.ctx.bus.publish({ type: 'activity.changed', sessionId: s.sessionId, nodeId: s.rootNodeId, activity: next, at: next.since });
  }

  /** A wait under 400 ms never shows: a 175 ms permission flicker was seen (RF 2.3). It still counts from when it began. */
  private applyMainActivity(s: SessionTrack): void {
    if (s.endedAt !== null || s.ending) return;
    const now = Date.now();
    const m = s.main.machine;
    const rec = s.pid;
    if (!rec) return this.setMainActivity(s, agentActivity(m, s.activity, now));

    if (rec.status === 'waiting' && s.activity.state !== 'waiting') {
      s.waitSeenAt ??= rec.statusUpdatedAt ?? now;
      const remain = WAIT_DEBOUNCE_MS - (now - s.waitSeenAt);
      if (remain > 0) {
        if (!s.waitTimer) {
          s.waitTimer = setTimeout(() => {
            s.waitTimer = null;
            this.pids.forget(rec.pid);
            this.detach(() => this.pidScan());
          }, remain);
          s.waitTimer.unref();
        }
        return;
      }
    } else if (rec.status !== 'waiting') {
      s.waitSeenAt = null;
    }
    let next = sessionActivity({ status: rec.status, waitingFor: rec.waitingFor, statusAt: s.waitSeenAt ?? rec.statusUpdatedAt }, m, s.activity, now);
    if (s.activity.state === 'waiting' && next.state !== 'waiting') {
      // A state's own `since` can predate the wait, and the reducer counts blocked time from it.
      next = { ...next, since: now };
      this.addBlocked(s, now - s.activity.since, now);
    }
    this.setMainActivity(s, next);
  }

  private addBlocked(s: SessionTrack, ms: number, now: number): void {
    if (ms <= 0) return;
    s.blockedMs += ms;
    const db = this.ctx.db;
    db.run('INSERT INTO obs_blocked (key, ms) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET ms = ?', `s:${s.sessionId}`, s.blockedMs, s.blockedMs);
    db.run('INSERT INTO obs_blocked (key, ms) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET ms = ms + ?', `d:${dayKey(now)}`, ms, ms);
  }

  private applyAgentActivity(n: NodeTrack): void {
    if (n.status !== 'running') return;
    const next = agentActivity(n.machine, n.activity, Date.now());
    if (sameActivity(n.activity, next)) return;
    n.activity = next;
    this.ctx.bus.publish({ type: 'activity.changed', sessionId: n.session.sessionId, nodeId: n.nodeId, activity: next, at: next.since });
  }

  // Pid files.

  private pidScanSoon(): void {
    if (this.pidTimer) return;
    this.pidTimer = setTimeout(() => {
      this.pidTimer = null;
      this.detach(() => this.pidScan());
    }, PATH_DEBOUNCE_MS);
    this.pidTimer.unref();
  }

  /** Callers share one scan and wait for it: a transcript seen now can belong to a pid file this scan has not reached. */
  private pidScan(): Promise<void> {
    this.rescan = true;
    this.scanning ??= this.scanPids().finally(() => {
      this.scanning = null;
    });
    return this.scanning;
  }

  private async scanPids(): Promise<void> {
    do {
      this.rescan = false;
      const records = await this.pids.read();
      if (this.stopped) return;
      const pipes = listPipes();
      const seen = new Set<number>();
      for (const rec of records) {
        seen.add(rec.pid);
        await this.applyPid(rec, pipes);
        if (this.stopped) return;
      }
      for (const [pid, s] of [...this.byPid]) {
        if (seen.has(pid)) continue;
        this.byPid.delete(pid);
        if (s.pid?.pid !== pid) continue;
        // `--resume` of a live session leaves two pids on one conversation (RF 8).
        const other = records.find((r) => r.sessionId === s.sessionId);
        if (other) s.pid = other;
        else this.beginEnd(s, 'gone');
      }
    } while (this.rescan && !this.stopped);
  }

  private async applyPid(rec: PidRecord, pipes: Set<string> | null): Promise<void> {
    const liveness = classify(rec, pipes, this.domain);
    let s = this.byPid.get(rec.pid);
    if (s && s.sessionId !== rec.sessionId) s = s.endedAt === null ? await this.rekey(s, rec) : undefined;
    s ??= this.sessions.get(rec.sessionId);

    if (liveness === 'dead') {
      if (s && s.endedAt === null) {
        s.pid = rec;
        this.beginEnd(s, 'stale');
        return;
      }
      const key = `${rec.pid}:${rec.sessionId}`;
      if (!s && !this.staleSeen.has(key)) {
        this.staleSeen.add(key);
        if (Date.now() - rec.mtimeMs < RETAIN_MS) await this.discover(rec.sessionId, rec, 'dead', rec.mtimeMs);
      }
      return;
    }

    // A recycled pid already ended this session and its file stays behind. A real resume reads alive once its pipe listens.
    if (s && s.endedAt !== null && liveness === 'recycled') return;
    if (!s) s = await this.discover(rec.sessionId, rec, liveness);
    else if (s.endedAt !== null) this.revive(s, rec, liveness);
    if (this.stopped) return;

    this.byPid.set(rec.pid, s);
    s.pid = rec;
    if (liveness === 'recycled') {
      const now = Date.now();
      s.recycledSince ??= now;
      if (now - s.recycledSince >= RECYCLED_HOLD_MS) {
        this.beginEnd(s, 'recycled');
        return;
      }
    } else {
      s.recycledSince = null;
      s.liveness = liveness;
    }
    if (!s.managed && this.isManaged(s)) s.managed = true;
    this.applyMainActivity(s);
    this.syncSession(s);
  }

  /** `--resume`: the same conversation under a new pid. The hull flies again. */
  private revive(s: SessionTrack, rec: PidRecord, liveness: Liveness): void {
    s.pid = rec;
    s.liveness = liveness === 'recycled' ? 'unknown' : liveness;
    s.endedAt = null;
    s.ending = false;
    s.main.endedAt = null;
    s.main.status = 'running';
    s.activity = { state: 'starting', since: Date.now() };
    s.main.activity = s.activity;
    this.publishDiscovered(s);
  }

  /** `/clear` and `/resume`: same pid, same hull, new conversation. Agents keep their node ids, their later events still land. */
  private async rekey(s: SessionTrack, rec: PidRecord): Promise<SessionTrack> {
    const oldId = s.sessionId;
    const oldRoot = s.rootNodeId;
    const newId = rec.sessionId;
    const clash = this.sessions.get(newId);
    if (clash && clash !== s) {
      for (const [id, agent] of clash.agents) {
        agent.session = s;
        s.agents.set(id, agent);
      }
      for (const [id, rt] of clash.runs) {
        rt.session = s;
        s.runs.set(id, rt);
      }
      if (clash.main.path) this.byPath.delete(clash.main.path);
    }
    this.sessions.delete(oldId);
    this.aliases.set(oldId, newId);
    if (s.main.path) this.byPath.delete(s.main.path);

    s.sessionId = newId;
    s.rootNodeId = makeNodeId(newId);
    s.pid = rec;
    const { machine, sink } = this.makeMachine(false);
    s.main = this.newNode(s, 'main', null, machine, sink);
    this.sessions.set(newId, s);
    for (const rt of s.runs.values()) {
      rt.run.sessionId = newId;
      if (rt.run.parentNodeId === oldRoot) rt.run.parentNodeId = s.rootNodeId;
    }
    for (const agent of s.agents.values()) if (agent.parentNodeId === oldRoot) agent.parentNodeId = s.rootNodeId;
    s.activity = { state: 'starting', since: Date.now() };
    s.main.activity = s.activity;
    s.sent.clear();

    // Until the patch below, the bus knows this hull by its old id.
    const release = this.hold(s);
    let files: SessionFiles | null;
    try {
      files = await this.findFiles(newId);
      if (files?.main) await this.attachMain(s, files.main.path, false);
      if (files) for (const slug of files.slugs) s.slugs.add(slug);
      if (!this.quiet(s)) {
        const view = this.sessionView(s);
        for (const key of SESSION_SYNC) s.sent.set(key, JSON.stringify(view[key]));
        this.ctx.bus.publish({
          type: 'session.changed', sessionId: oldId, nodeId: oldRoot,
          patch: { ...view, sessionId: newId, rootNodeId: s.rootNodeId, agentCount: undefined, runningAgentCount: undefined } as Partial<ObservedSession>,
        });
      }
    } finally {
      release();
    }
    await this.drainNode(s.main);
    if (files) await this.attachTree(s, files);
    return s;
  }

  private beginEnd(s: SessionTrack, why: 'gone' | 'stale' | 'recycled'): void {
    if (s.ending || s.endedAt !== null) return;
    s.ending = true;
    if (s.waitTimer) {
      clearTimeout(s.waitTimer);
      s.waitTimer = null;
    }
    // `cost-state` is written as the pid file vanishes, so the last read waits a moment for it (RF 3.4).
    this.later(END_SETTLE_MS, async () => {
      await s.settling;
      await this.drainNode(s.main);
      this.finishSession(s, why);
    });
  }

  private finishSession(s: SessionTrack, why: 'gone' | 'stale' | 'recycled'): void {
    if (s.endedAt !== null) return;
    const at = Date.now();
    const m = s.main.machine;
    m.close();
    if (m.usageDirty) {
      m.usageDirty = false;
      this.publishUsage(s.main);
    }
    const outcome = why === 'recycled' ? 'unknown' : m.outcome();
    if (s.activity.state === 'waiting') this.addBlocked(s, at - s.activity.since, at);
    s.endedAt = at;
    s.ending = false;
    s.main.endedAt = at;
    s.main.status = outcome === 'clean' ? 'completed' : 'unknown';
    s.activity = { state: 'finished', since: at, outcome };
    s.main.activity = s.activity;
    if (!this.quiet(s) && s.discovered) {
      if (why === 'stale') {
        s.liveness = 'dead';
        this.syncSession(s);
      }
      this.ctx.bus.publish({
        type: 'session.ended', sessionId: s.sessionId, nodeId: s.rootNodeId, at, outcome,
        reason: why === 'recycled' ? 'pid-recycled' : 'exit',
      });
    }
    for (const n of s.agents.values()) {
      if (n.status !== 'running') continue;
      n.machine.close();
      this.endAgent(n, n.machine.outcome() === 'clean' ? 'completed' : 'orphaned', at);
    }
    for (const rt of s.runs.values()) {
      rt.dirty = true;
      this.publishRun(rt);
    }
    this.syncSession(s);
    const row = this.rowFor(s.main);
    if (row) this.dirtyRows.add(row.nodeId);
    this.flushRows();
  }

  // Agent tree.

  private resolveLink(n: NodeTrack): void {
    const s = n.session;
    const meta = n.meta;
    const parentAgent = meta?.parentAgentId;
    if (parentAgent) {
      n.parentNodeId = s.agents.get(parentAgent)?.nodeId ?? makeNodeId(s.sessionId, parentAgent);
      n.linkedBy = 'parentAgentId';
      return;
    }
    if (n.runId) {
      n.parentNodeId = s.rootNodeId;
      n.linkedBy = 'workflowRun';
      return;
    }
    const owner = n.parentToolUseId ? s.toolOwners.get(n.parentToolUseId) : undefined;
    if (owner) {
      n.parentNodeId = owner;
      n.linkedBy = 'toolUseId';
      return;
    }
    n.parentNodeId = s.rootNodeId;
    // At depth 1 the only possible owner is the main thread, whose older records the tail has not read.
    n.linkedBy = n.parentToolUseId && n.spawnDepth <= 1 ? 'toolUseId' : 'inferred';
  }

  private linkParent(n: NodeTrack): void {
    const before = n.parentNodeId;
    const by = n.linkedBy;
    this.resolveLink(n);
    if (before !== n.parentNodeId || by !== n.linkedBy) this.syncAgent(n);
  }

  private applyMeta(n: NodeTrack, meta: AgentMeta): void {
    n.meta = meta;
    n.parentToolUseId = meta.toolUseId ?? n.parentToolUseId;
    n.spawnDepth = meta.spawnDepth ?? n.spawnDepth;
    this.resolveLink(n);
  }

  private newAgent(s: SessionTrack, agentId: AgentId, runId: WorkflowRunId | null, silent: boolean): NodeTrack {
    const { machine, sink } = this.makeMachine(silent);
    const n = this.newNode(s, runId ? 'workflow-agent' : 'subagent', agentId, machine, sink);
    n.spawnDepth = 1;
    n.runId = runId;
    const rt = runId ? s.runs.get(runId) : undefined;
    const ra = rt?.run.agents.get(agentId);
    if (ra && runId) n.workflow = { runId, key: ra.key, label: ra.label, phase: ra.phase, attempt: ra.attempt };
    s.agents.set(agentId, n);
    this.resolveLink(n);
    return n;
  }

  /** A session found at boot, or a resume: its agents are history until the journal or their tail says otherwise. */
  private async attachTree(s: SessionTrack, files: SessionFiles): Promise<void> {
    const tree = await walkSessionTree(files);
    for (const run of tree.runs) await this.bootRun(s, run);
    await pool(tree.agents, HEAD_POOL, (file) => this.bootAgent(s, file));
    for (const rt of s.runs.values()) {
      for (const ra of rt.run.agents.values()) {
        if (!s.agents.has(ra.agentId)) this.liveAgent(s, ra.agentId, rt.run.runId, false);
      }
      rt.dirty = true;
      this.publishRun(rt);
    }
  }

  private async bootAgent(s: SessionTrack, file: AgentFile): Promise<void> {
    if (s.agents.has(file.agentId)) return;
    const n = this.newAgent(s, file.agentId, file.runId, true);
    n.path = file.path;
    n.metaPath = file.metaPath;
    n.startedAt = file.birthMs;
    this.byPath.set(file.path, n);
    if (file.metaPath) {
      const meta = await readMeta(file.metaPath);
      if (meta) this.applyMeta(n, meta);
    }
    const now = Date.now();
    const ra = file.runId ? s.runs.get(file.runId)?.run.agents.get(file.agentId) : undefined;
    const open = ra ? ra.state === 'running' : true;
    const hot = now - file.mtimeMs < HOT_MS;
    if (hot || open) {
      const seeded = await this.seed(n.machine, file.path, file.size, AGENT_HEAD, AGENT_TAIL);
      if (seeded) {
        seeded.cursor.mtimeMs = file.mtimeMs;
        n.cursor = seeded.cursor;
        this.setTail(n, seeded.tailStart);
      }
    }
    n.machine.silent = false;
    if (!n.cursor) n.baselineDone = false;

    const status = this.bootStatus(n, ra, hot);
    n.status = status;
    if (status !== 'running') {
      n.endedAt = n.machine.lastAt ?? file.mtimeMs;
      n.activity = { state: 'finished', since: n.endedAt, outcome: status === 'completed' ? 'clean' : status === 'failed' ? 'abandoned' : 'unknown' };
    } else {
      n.activity = agentActivity(n.machine, n.activity, now);
    }
    this.publishAgentStarted(n);
    if (!this.usageQueued || n.baselineDone) return;
    const cached = n.cursor ? null : this.usage.isFresh(file.path, file.size, file.mtimeMs);
    if (cached) this.applyBaseline(n, cached);
    else if (n.cursor) this.requestBaseline(n);
    else this.usage.enqueue([{ kind: 'transcript', path: file.path, size: file.size, mtimeMs: file.mtimeMs, to: null, nodeId: n.nodeId }]);
  }

  private bootStatus(n: NodeTrack, ra: RunAgent | undefined, hot: boolean): AgentStatus {
    const alive = n.session.endedAt === null;
    if (ra) {
      if (ra.state !== 'running') return ra.state;
      return alive ? 'running' : 'orphaned';
    }
    if (n.meta?.stoppedByUser) return 'stopped';
    if (n.meta?.finished || n.machine.outcome() === 'clean') return 'completed';
    if (!alive) return 'orphaned';
    return hot ? 'running' : 'unknown';
  }

  /** An agent seen after boot. Published first, so a launch shows at once, and its meta follows as a patch. */
  private liveAgent(s: SessionTrack, agentId: AgentId, runId: WorkflowRunId | null, fresh: boolean): NodeTrack {
    const n = this.newAgent(s, agentId, runId, false);
    n.startedAt = Date.now();
    const ra = runId ? s.runs.get(runId)?.run.agents.get(agentId) : undefined;
    if (ra && ra.state !== 'running') {
      n.status = ra.state;
      n.endedAt = Date.now();
      n.activity = { state: 'finished', since: n.endedAt, outcome: ra.state === 'completed' ? 'clean' : 'unknown' };
    }
    this.publishAgentStarted(n);
    if (fresh) this.launch(n);
    return n;
  }

  private launch(n: NodeTrack): void {
    const s = n.session;
    if (!n.parentNodeId) return;
    const l: Launch = {
      parentNodeId: n.parentNodeId,
      group: n.runId ?? 'subagent',
      nodeId: n.nodeId,
      sessionId: s.sessionId,
      worldId: s.worldId,
      source: n.runId ? 'workflow' : 'subagent',
      observedAt: Date.now(),
    };
    this.feedSalvo(l);
  }

  /** `agent_spawn` and copies count toward a salvo (DESIGN 9.5), and only Control sees them leave. A restored craft is no launch. */
  private managedLaunch(agent: ManagedAgentView): void {
    if (this.launchedManaged.has(agent.agentId)) return;
    this.launchedManaged.add(agent.agentId);
    const now = Date.now();
    if (now - agent.createdAt > MANAGED_LAUNCH_FRESH_MS) return;
    const parentNodeId = agent.parentAgentId ? this.ctx.bus.state().managed[agent.parentAgentId]?.nodeId : agent.copyOf;
    if (!parentNodeId) return;
    this.feedSalvo({
      parentNodeId, group: 'spawn', nodeId: agent.nodeId, sessionId: parentNodeId, worldId: agent.worldId, source: 'spawn', observedAt: now,
    });
  }

  private feedSalvo(l: Launch): void {
    const out = this.salvos.launch(l);
    if (out?.type === 'opened') this.ctx.bus.publish({ type: 'salvo.opened', salvo: out.salvo });
    else if (out?.type === 'joined') this.ctx.bus.publish({ type: 'salvo.joined', salvoId: out.salvoId, nodeId: out.nodeId });
  }

  private endAgent(n: NodeTrack, status: AgentStatus, at: number): void {
    if (n.status !== 'running') return;
    n.status = status;
    n.endedAt = at;
    n.activity = { state: 'finished', since: at, outcome: status === 'completed' ? 'clean' : status === 'failed' ? 'abandoned' : 'unknown' };
    this.ctx.bus.publish({ type: 'agent.ended', sessionId: n.session.sessionId, nodeId: n.nodeId, status, at });
    if (status === 'failed') this.failedNodes.add(n.nodeId);
    const row = this.rowFor(n);
    if (row) this.dirtyRows.add(row.nodeId);
    n.session.treeDirty = true;
  }

  private applyRunLink(rt: RunTrack, l: Extract<Link, { kind: 'workflow' }>): void {
    rt.run.parentToolUseId = l.toolUseId;
    rt.run.taskId = l.taskId ?? rt.run.taskId;
    rt.run.name = l.name ?? rt.run.name;
    rt.run.scriptPath = l.scriptPath ?? rt.run.scriptPath;
    rt.dirty = true;
  }

  private ensureRun(s: SessionTrack, runId: WorkflowRunId, dir: string): RunTrack {
    let rt = s.runs.get(runId);
    if (rt) return rt;
    const journalPath = path.join(dir, 'journal.jsonl');
    const run = new WorkflowRun({ runId, sessionId: s.sessionId, parentNodeId: s.rootNodeId, journalPath, transcriptDir: dir });
    rt = { run, session: s, cursor: null, draining: false, statePath: null, sent: '', dirty: true };
    s.runs.set(runId, rt);
    const owner = s.toolOwners.get(runId);
    if (owner) run.parentNodeId = owner;
    const early = s.earlyRunLinks.get(runId);
    if (early) {
      s.earlyRunLinks.delete(runId);
      this.applyRunLink(rt, early);
    }
    return rt;
  }

  private async bootRun(s: SessionTrack, files: RunFiles): Promise<void> {
    const rt = this.ensureRun(s, files.runId, files.dir);
    const bySession = s.main.baseline?.runLinks.find((l) => l.runId === files.runId);
    if (bySession) {
      rt.run.parentToolUseId = bySession.toolUseId;
      rt.run.taskId = bySession.taskId;
      rt.run.name = bySession.name;
    }
    if (files.journalPath) {
      rt.cursor = newCursor(files.journalPath);
      await drain(rt.cursor, (line) => {
        const r = parseJournalLine(line, this.sensor);
        if (r) rt.run.journal(r);
      });
      rt.run.startedAt ??= (await fsp.stat(files.journalPath).catch(() => null))?.birthtimeMs ?? null;
    }
    if (files.statePath) await this.applyState(rt, files.statePath, true);
  }

  private async applyState(rt: RunTrack, statePath: string, quietly: boolean): Promise<void> {
    if (rt.run.final) return;
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(await fsp.readFile(statePath, 'utf8')) as Record<string, unknown>;
    } catch {
      return;
    }
    const final = parseFinalState(raw);
    const ended = rt.run.applyFinal(final, statePath);
    rt.statePath = statePath;
    rt.dirty = true;
    if (quietly) return;
    const at = final.endedAt ?? Date.now();
    for (const ra of ended) {
      const n = rt.session.agents.get(ra.agentId);
      if (n) this.endAgent(n, ra.state, at);
    }
    this.publishRun(rt);
  }

  private async drainRun(rt: RunTrack): Promise<void> {
    if (!rt.cursor || rt.draining) return;
    rt.draining = true;
    const s = rt.session;
    const events: Array<{ started?: RunAgent; ended?: RunAgent }> = [];
    try {
      const res = await drain(rt.cursor, (line) => {
        const r = parseJournalLine(line, this.sensor);
        const change = r ? rt.run.journal(r) : null;
        if (change) events.push(change);
      });
      if (res.state === 'data' || res.state === 'reset') rt.dirty = true;
    } finally {
      rt.draining = false;
    }
    const now = Date.now();
    for (const { started, ended } of events) {
      if (started) {
        const known = s.agents.get(started.agentId);
        if (known) {
          known.workflow = { runId: rt.run.runId, key: started.key, label: started.label, phase: started.phase, attempt: started.attempt };
          this.syncAgent(known);
        } else {
          this.liveAgent(s, started.agentId, rt.run.runId, true);
        }
      }
      if (ended) {
        const n = s.agents.get(ended.agentId);
        if (n) this.endAgent(n, ended.state, now);
      }
    }
    if (rt.dirty) this.publishRun(rt);
  }

  private publishRun(rt: RunTrack): void {
    const s = rt.session;
    rt.dirty = false;
    let usd = 0;
    let tokens = 0;
    let toolCalls = 0;
    let lower = false;
    const unpriced: string[] = [];
    for (const n of s.agents.values()) {
      if (n.runId !== rt.run.runId) continue;
      const cost = this.nodeCost(n);
      const u = this.nodeUsage(n);
      usd += cost.estimateUsd;
      tokens += u.input + u.output + u.cacheRead + u.cacheWrite5m + u.cacheWrite1h;
      toolCalls += (n.baseline?.toolCalls ?? 0) + n.machine.toolCalls;
      lower ||= cost.isLowerBound;
      unpriced.push(...cost.unpricedModels);
    }
    const workflow = rt.run.view(s.endedAt === null, makeCost(usd, null, unpriced, lower), tokens, toolCalls);
    const text = JSON.stringify(workflow);
    if (text === rt.sent) return;
    // A managed session may not be in the state yet, and the reducer drops a workflow without one. The tick tries again.
    if (!Object.hasOwn(this.ctx.bus.state().sessions, s.sessionId)) {
      rt.dirty = true;
      return;
    }
    rt.sent = text;
    this.ctx.bus.publish({ type: 'workflow.changed', sessionId: s.sessionId, nodeId: workflow.parentNodeId, workflow });
  }

  // Watchers.

  private startWatchers(): void {
    const arm = (dir: string, recursive: boolean, onName: (name: string | null) => void): void => {
      try {
        const w = fs.watch(dir, { recursive, persistent: false }, (_type, name) => onName(name === null ? null : String(name)));
        w.on('error', () => {
          this.watchBroken = true;
          w.close();
        });
        this.watchers.push(w);
      } catch {
        this.watchBroken = true;
      }
    };
    arm(this.sessionsDir, false, (name) => {
      if (name === null || /^\d+\.json$/.test(name)) this.pidScanSoon();
    });
    arm(this.projectsDir, true, (name) => this.onProjectEvent(name));
  }

  private onProjectEvent(rel: string | null): void {
    if (rel === null) {
      this.watchBroken = true;
      return;
    }
    const c = classifyProjectPath(rel);
    if (!c || this.pathTimers.has(rel)) return;
    const timer = setTimeout(() => {
      this.pathTimers.delete(rel);
      this.detach(() => this.handlePath(rel, c).catch((e: unknown) => {
        this.ctx.log.warn('observer path handler failed', { kind: c.kind, message: e instanceof Error ? e.message : 'unknown' });
      }));
    }, PATH_DEBOUNCE_MS);
    timer.unref();
    this.pathTimers.set(rel, timer);
  }

  private track(sid: SessionId): SessionTrack | undefined {
    return this.sessions.get(this.aliases.get(sid) ?? sid);
  }

  private async handlePath(rel: string, c: ProjectPath): Promise<void> {
    if (this.stopped) return;
    const abs = path.join(this.projectsDir, rel);
    let s = this.track(c.sid);
    if (!s) {
      await this.pidScan();
      s = this.track(c.sid);
      if (!s) {
        // A transcript moving with no pid file: bare mode, or a process this kernel cannot see. Still a live craft.
        const st = await fsp.stat(abs).catch(() => null);
        if (!st || Date.now() - st.mtimeMs > STALE_NO_PID_MS) return;
        s = await this.discover(c.sid, null, 'unknown');
      }
    }
    await s.settling;
    if (this.stopped) return;
    s.slugs.add(c.slug);
    switch (c.kind) {
      case 'main':
        if (s.main.cursor) await this.drainNode(s.main);
        else await this.attachMain(s, abs, true);
        return;
      case 'agent': {
        const n = s.agents.get(c.agentId) ?? this.liveAgent(s, c.agentId, c.runId, true);
        if (!n.cursor) this.startAgentTail(n, abs);
        await this.drainNode(n);
        return;
      }
      case 'meta': {
        const n = s.agents.get(c.agentId) ?? this.liveAgent(s, c.agentId, c.runId, true);
        n.metaPath = abs;
        const meta = await readMeta(abs);
        if (!meta) return;
        this.applyMeta(n, meta);
        this.syncAgent(n);
        if (meta.stoppedByUser) this.endAgent(n, 'stopped', Date.now());
        else if (meta.finished) this.endAgent(n, 'completed', Date.now());
        return;
      }
      case 'journal': {
        const dir = path.dirname(abs);
        const rt = this.ensureRun(s, c.runId, dir);
        rt.cursor ??= newCursor(abs);
        rt.run.startedAt ??= Date.now();
        await this.drainRun(rt);
        return;
      }
      case 'state': {
        const sessionDir = path.dirname(path.dirname(abs));
        const rt = this.ensureRun(s, c.runId, path.join(sessionDir, 'subagents', 'workflows', c.runId));
        await this.applyState(rt, abs, false);
        return;
      }
    }
  }

  private startAgentTail(n: NodeTrack, file: string): void {
    if (n.path && n.path !== file) this.byPath.delete(n.path);
    n.path = file;
    n.cursor = newCursor(file);
    n.tailStart = 0;
    n.baselineDone = true;
    this.byPath.set(file, n);
    // Parents first: the path goes out before any event read from it.
    this.syncAgent(n);
  }

  // Loops.

  private async tick(): Promise<void> {
    const now = Date.now();
    const dt = this.lastTick ? now - this.lastTick : TICK_MS;
    this.lastTick = now;
    await this.pidScan();
    await this.reconcile(now);
    if (this.stopped) return;
    for (const s of this.sessions.values()) {
      if (s.treeDirty) {
        s.treeDirty = false;
        this.syncSession(s);
        for (const rt of s.runs.values()) rt.dirty = true;
      }
      for (const rt of s.runs.values()) if (rt.dirty) this.publishRun(rt);
      if (!s.pid && s.endedAt === null && !s.ending) {
        const last = s.main.cursor?.mtimeMs ?? 0;
        if (now - last > STALE_NO_PID_MS) this.beginEnd(s, 'gone');
      }
    }
    for (const salvo of this.salvos.closeExpired(now)) {
      this.ctx.db.run('INSERT OR REPLACE INTO obs_salvo (salvo_id, opened_at, data) VALUES (?, ?, ?)', salvo.salvoId, salvo.openedAt, JSON.stringify(salvo));
      this.ctx.bus.publish({ type: 'salvo.closed', salvoId: salvo.salvoId });
    }
    if (this.usageDone && now - this.todayAt >= TODAY_MS) {
      this.todayAt = now;
      this.todayUsd = this.ledger(now).todayUsd;
    }
    this.rates.tick(now, this.todayUsd, dt);
    if (this.sensor.dirty) {
      this.sensor.dirty = false;
      this.ctx.bus.publish({ type: 'sensor.changed', sensor: { ...this.sensor.state } });
    }
  }

  /** Lost events are possible on Windows, so every hot file gets a stat each second. The stat is what `drain` does first. */
  private async reconcile(now: number): Promise<void> {
    for (const s of this.sessions.values()) {
      const alive = s.endedAt === null;
      if (s.main.cursor && (alive || now - s.main.cursor.mtimeMs < HOT_MS)) await this.drainNode(s.main);
      for (const n of s.agents.values()) {
        if (n.cursor && (n.status === 'running' || now - n.cursor.mtimeMs < HOT_MS)) await this.drainNode(n);
      }
      if (!alive) continue;
      for (const rt of s.runs.values()) {
        if (rt.run.final) continue;
        await this.drainRun(rt);
      }
    }
  }

  private async shallowTick(): Promise<void> {
    if (this.watchBroken) {
      this.watchBroken = false;
      for (const w of this.watchers) w.close();
      this.watchers.length = 0;
      this.startWatchers();
      this.later(0, () => this.refreshFiles());
    }
    this.files = await shallowWalk(this.projectsDir);
    for (const [sid, files] of this.files) {
      const s = this.track(sid);
      if (!s) {
        const main = files.main;
        if (main && Date.now() - main.mtimeMs < SHALLOW_MS) await this.handlePath(path.relative(this.projectsDir, main.path), { kind: 'main', slug: main.slug, sid });
        continue;
      }
      await s.settling;
      if (this.stopped) return;
      for (const slug of files.slugs) s.slugs.add(slug);
      if (!s.main.cursor && files.main) await this.attachMain(s, files.main.path, true);
      if (s.endedAt !== null) continue;
      const tree = await walkSessionTree(files);
      for (const file of tree.agents) {
        if (s.agents.has(file.agentId)) {
          const n = s.agents.get(file.agentId) as NodeTrack;
          if (!n.cursor && n.status === 'running') {
            this.startAgentTail(n, file.path);
            await this.drainNode(n);
          }
          continue;
        }
        const n = this.liveAgent(s, file.agentId, file.runId, true);
        this.startAgentTail(n, file.path);
        await this.drainNode(n);
      }
      for (const run of tree.runs) {
        const rt = this.ensureRun(s, run.runId, run.dir);
        if (run.journalPath && !rt.cursor) {
          rt.cursor = newCursor(run.journalPath);
          rt.run.startedAt ??= Date.now();
        }
        await this.drainRun(rt);
        if (run.statePath && !rt.run.final) await this.applyState(rt, run.statePath, false);
      }
    }
  }

  private async planTick(): Promise<void> {
    const st = await fsp.stat(this.configPath).catch(() => null);
    if (!st || st.mtimeMs === this.planMtime) return;
    this.planMtime = st.mtimeMs;
    const plan = await readPlan(this.configPath);
    if (!plan || samePlan(plan, this.plan)) return;
    this.plan = plan;
    this.ctx.bus.publish({ type: 'plan.changed', plan });
  }

  private async loadCatalog(): Promise<void> {
    this.catalog = await readCatalog(this.ctx.config.claudeHome);
  }

  private evict(): void {
    const now = Date.now();
    const gone: SessionId[] = [];
    for (const s of [...this.sessions.values()]) {
      if (s.endedAt === null || now - s.endedAt < RETAIN_MS) continue;
      if (!this.quiet(s) && s.discovered) gone.push(s.sessionId);
      this.sessions.delete(s.sessionId);
      if (s.pid) this.byPid.delete(s.pid.pid);
      for (const [oldId, newId] of this.aliases) if (newId === s.sessionId) this.aliases.delete(oldId);
      if (s.main.path) this.byPath.delete(s.main.path);
      for (const n of s.agents.values()) if (n.path) this.byPath.delete(n.path);
    }
    if (gone.length === 0) return;
    this.ctx.bus.publish({ type: 'fleet.evicted', sessionIds: gone });
    // Their live books are gone with them, so the ledger needs these files from the worker.
    this.later(0, () => this.refreshFiles());
  }

  // Index, history, ledger.

  private entryFor(sid: SessionId, agentId: AgentId | null, runId: WorkflowRunId | null, file: string, size: number, mtimeMs: number, birthMs: number): FileEntry {
    const nodeId = makeNodeId(sid, agentId ?? undefined);
    const entry: FileEntry = { path: file, nodeId, sid, agentId, runId, size, mtimeMs, birthMs };
    this.known.set(file, entry);
    this.nodeFile.set(nodeId, file);
    return entry;
  }

  /** Full stat walk: new files, changed cold files and files retention took. Live sessions never wait on this. */
  private async refreshFiles(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      await this.walkFiles();
    } finally {
      this.refreshing = false;
    }
  }

  private async walkFiles(): Promise<void> {
    const t0 = performance.now();
    this.files = await shallowWalk(this.projectsDir);
    const seen = new Set<string>();
    const fresh: FileEntry[] = [];
    const runs: RunFiles[] = [];
    const launches = new Map<string, Launch[]>();
    const firstPass = this.known.size === 0;

    await pool([...this.files.values()], HEAD_POOL, async (files) => {
      const sid = files.sid;
      const tree = await walkSessionTree(files);
      runs.push(...tree.runs);
      const add = (entry: FileEntry): void => {
        seen.add(entry.path);
        fresh.push(entry);
      };
      if (files.main) add(this.entryFor(sid, null, null, files.main.path, files.main.size, files.main.mtimeMs, files.main.birthMs));
      for (const a of tree.agents) {
        add(this.entryFor(sid, a.agentId, a.runId, a.path, a.size, a.mtimeMs, a.birthMs));
        if (!firstPass) continue;
        const key = `${sid}\n${a.runId ?? 'subagent'}`;
        const list = launches.get(key) ?? [];
        list.push({
          parentNodeId: sid, group: a.runId ?? 'subagent', nodeId: makeNodeId(sid, a.agentId), sessionId: sid,
          worldId: this.worldOf(sid), source: a.runId ? 'workflow' : 'subagent', observedAt: a.birthMs,
        });
        launches.set(key, list);
      }
    });
    if (this.stopped) return;
    if (firstPass) this.timings.statMs = performance.now() - t0;

    const expired: NodeId[] = [];
    for (const [file, entry] of this.known) {
      if (seen.has(file)) continue;
      this.known.delete(file);
      this.usage.forget(file);
      this.rows.delete(entry.nodeId);
      this.nodeFile.delete(entry.nodeId);
      expired.push(entry.nodeId);
    }
    if (expired.length > 0) this.ctx.bus.publish({ type: 'history.expired', nodeIds: expired });

    if (firstPass) {
      for (const list of launches.values()) this.pastSalvos.push(...replaySalvos(list));
    }
    this.queueUsage(fresh, runs, firstPass);
  }

  private worldOf(sid: SessionId): WorldId {
    const ref = this.refs.get(sid);
    if (ref) return ref.worldId;
    return this.ensureWorld(resolveProject(null)).worldId;
  }

  private queueUsage(entries: FileEntry[], runs: RunFiles[], firstPass: boolean): void {
    const tasks: WorkerTask[] = [];
    let cached = 0;
    for (const e of entries) {
      const node = this.byPath.get(e.path);
      if (node?.cursor) {
        if (node.tailStart > 0 && !node.baseline && !node.baselineQueued) {
          node.baselineQueued = true;
          tasks.push({ kind: 'transcript', path: e.path, size: e.size, mtimeMs: e.mtimeMs, to: node.tailStart, nodeId: e.nodeId });
        }
        continue;
      }
      const hit = this.usage.isFresh(e.path, e.size, e.mtimeMs);
      if (hit) {
        cached += 1;
        if (node && !node.baseline) this.applyBaseline(node, hit);
      } else {
        tasks.push({ kind: 'transcript', path: e.path, size: e.size, mtimeMs: e.mtimeMs, to: null, nodeId: e.nodeId });
      }
    }
    for (const e of entries) if (firstPass || !this.rows.has(e.nodeId)) this.dirtyRows.add(e.nodeId);
    for (const run of runs) {
      if (!run.journalPath) continue;
      const entry = this.journalStat.get(run.journalPath);
      if (entry === undefined) {
        void this.queueJournal(run.journalPath).catch((e: unknown) => {
          this.ctx.log.warn('observer journal scan failed', { message: e instanceof Error ? e.message : 'unknown' });
        });
      }
    }
    tasks.sort((a, b) => (b.kind === 'transcript' ? b.mtimeMs : 0) - (a.kind === 'transcript' ? a.mtimeMs : 0));

    if (firstPass) {
      this.usageQueued = true;
      this.usageT0 = performance.now();
      this.usageTotal = entries.length;
      this.usageSeen = cached + (entries.length - cached - tasks.length);
      this.timings.usageFiles = tasks.length;
      this.timings.usageCached = cached;
      this.progress({ stage: 'usage', done: this.usageSeen, total: this.usageTotal });
    }
    this.flushRows();
    this.publishWorlds();
    if (tasks.length > 0) {
      this.usage.enqueue(tasks);
    } else if (firstPass) {
      this.usageDrained();
    }
  }

  private readonly journalStat = new Map<string, number>();

  private async queueJournal(file: string): Promise<void> {
    const st = await fsp.stat(file).catch(() => null);
    if (!st || this.stopped) return;
    this.journalStat.set(file, st.mtimeMs);
    if (this.usage.isJournalFresh(file, st.size, st.mtimeMs)) {
      this.applyJournalSummary(this.usage.journals.get(file));
      return;
    }
    this.usage.enqueue([{ kind: 'journal', path: file, size: st.size, mtimeMs: st.mtimeMs }]);
  }

  private applyJournalSummary(j: JournalSummary | undefined): void {
    if (!j) return;
    const sid = path.basename(path.dirname(path.dirname(path.dirname(path.dirname(j.path)))));
    for (const agentId of j.failedAgentIds) {
      const nodeId = makeNodeId(sid, agentId);
      this.failedNodes.add(nodeId);
      this.dirtyRows.add(nodeId);
    }
    for (const agentId of j.completedAgentIds) {
      const nodeId = makeNodeId(sid, agentId);
      this.completedNodes.add(nodeId);
      this.dirtyRows.add(nodeId);
    }
  }

  private requestBaseline(n: NodeTrack): void {
    if (!n.path || n.baselineDone || n.baseline || n.baselineQueued) return;
    const cursor = n.cursor;
    if (!cursor) return;
    n.baselineQueued = true;
    this.usage.enqueue([{
      kind: 'transcript', path: n.path, size: cursor.size, mtimeMs: cursor.mtimeMs, to: n.tailStart, nodeId: n.nodeId,
    }]);
  }

  private applyBaseline(n: NodeTrack, summary: FileSummary): void {
    n.baseline = summary;
    n.baselineDone = true;
    const s = n.session;
    if (n === s.main) {
      if (!this.quiet(s) && s.discovered) this.mainCounts(s);
      for (const rt of s.runs.values()) {
        const link = summary.runLinks.find((l) => l.runId === rt.run.runId);
        if (!link) continue;
        rt.run.parentToolUseId ??= link.toolUseId;
        rt.run.taskId ??= link.taskId;
        rt.run.name ??= link.name;
        rt.dirty = true;
      }
    } else {
      this.ctx.bus.publish({
        type: 'agent.changed', sessionId: s.sessionId, nodeId: n.nodeId,
        patch: { toolCalls: summary.toolCalls + n.machine.toolCalls, errors: summary.errors + n.machine.errors, startedAt: summary.firstAt ?? n.startedAt },
      });
    }
    for (const link of summary.agentLinks) {
      const child = s.agents.get(link.agentId);
      if (child) {
        child.parentToolUseId ??= link.toolUseId;
        this.linkParent(child);
      }
    }
    this.publishUsage(n);
    s.treeDirty = true;
  }

  private usageResult(r: WorkerResult): void {
    if (this.stopped) return;
    if (r.kind === 'journal') {
      this.applyJournalSummary(r.summary ?? undefined);
      return;
    }
    this.usageSeen += 1;
    const node = this.byPath.get(r.path);
    if (r.summary && node && !node.baseline) this.applyBaseline(node, r.summary);
    this.dirtyRows.add(r.nodeId);
    const now = performance.now();
    if (now - this.lastIndexFlush >= INDEX_FLUSH_MS) {
      this.lastIndexFlush = now;
      this.flushRows();
      this.progress({ stage: 'usage', done: Math.min(this.usageSeen, this.usageTotal), total: this.usageTotal });
    }
  }

  private usageDrained(): void {
    if (this.stopped || !this.usageQueued) return;
    this.flushRows();
    if (!this.usageDone) {
      this.usageDone = true;
      this.timings.usageMs = performance.now() - this.usageT0;
      this.progress({ stage: 'done', done: this.usageTotal, total: this.usageTotal });
      this.ctx.log.info('observer usage index done', { ...this.timings });
    }
    this.publishWorlds();
  }

  private rowFor(n: NodeTrack): HistoryDigest | null {
    const file = n.path;
    const entry = file ? this.known.get(file) : undefined;
    if (!entry) return null;
    return this.buildRow(entry);
  }

  private buildRow(e: FileEntry): HistoryDigest {
    const ref = this.refs.get(e.sid);
    const summary = this.usage.summaries.get(e.path);
    const node = this.byPath.get(e.path);
    const usd = node
      ? (node.baselineDone ? this.nodeEstimate(node) : null)
      : summary?.complete ? summary.estimateUsd : null;
    const live = node !== undefined && node.endedAt === null;
    const outcome = this.failedNodes.has(e.nodeId) ? 'failed'
      : this.completedNodes.has(e.nodeId) ? 'clean'
      : node ? (node.status === 'completed' ? 'clean' : node.status === 'orphaned' ? 'abandoned' : node.machine.outcome())
      : summary?.outcome ?? 'unknown';
    const row: HistoryDigest = {
      nodeId: e.nodeId,
      sessionId: e.sid,
      worldId: this.worldOf(e.sid),
      projectRoot: ref?.root ?? null,
      kind: e.agentId === null ? 'main' : e.runId ? 'workflow-agent' : 'subagent',
      parentNodeId: e.agentId === null ? null : e.sid,
      startedAt: summary?.firstAt ?? (e.agentId === null ? ref?.startedAt : node?.startedAt) ?? e.birthMs,
      endedAt: live ? null : node?.endedAt ?? summary?.lastAt ?? e.mtimeMs,
      model: node?.machine.model ?? summary?.model ?? null,
      bytes: e.size,
      usd,
      blockedMs: summary?.blockedMs ?? null,
      outcome,
    };
    this.rows.set(e.nodeId, row);
    return row;
  }

  private flushRows(): void {
    if (this.dirtyRows.size === 0) return;
    const rows: HistoryDigest[] = [];
    for (const nodeId of this.dirtyRows) {
      const file = this.nodeFile.get(nodeId);
      const entry = file ? this.known.get(file) : undefined;
      if (entry) rows.push(this.buildRow(entry));
    }
    this.dirtyRows.clear();
    for (let i = 0; i < rows.length; i += DIGEST_BATCH) {
      this.ctx.bus.publish({ type: 'history.digest', rows: rows.slice(i, i + DIGEST_BATCH) });
    }
  }

  private spends(): Spend[] {
    const out: Spend[] = [];
    for (const s of this.usage.summaries.values()) {
      const entry = this.known.get(s.path);
      out.push({ worldId: entry ? this.worldOf(entry.sid) : '', byDay: s.byDay, byModel: s.byModel });
    }
    for (const s of this.sessions.values()) {
      out.push({ worldId: s.worldId, byDay: s.main.machine.book.byDay, byModel: s.main.machine.book.byModel });
      for (const n of s.agents.values()) {
        out.push({ worldId: s.worldId, byDay: n.machine.book.byDay, byModel: n.machine.book.byModel });
      }
    }
    return out;
  }

  private ledger(now: number): ReturnType<typeof rollup> {
    return rollup(this.spends(), now);
  }

  private blockedToday(now: number): number {
    let ms = this.ctx.db.get<{ ms: number }>('SELECT ms FROM obs_blocked WHERE key = ?', `d:${dayKey(now)}`)?.ms ?? 0;
    for (const s of this.sessions.values()) {
      if (s.activity.state === 'waiting') ms += now - s.activity.since;
    }
    return ms;
  }

  private publishWorlds(): void {
    const now = Date.now();
    const roll = this.ledger(now);
    const worlds = new Map<WorldId, WorldRoll>();
    for (const row of this.rows.values()) {
      let w = worlds.get(row.worldId);
      if (!w) worlds.set(row.worldId, (w = { root: row.projectRoot, bytes: 0, lights: 0, failed: 0, lastActive: 0 }));
      w.bytes += row.bytes;
      if (row.endedAt !== null) {
        w.lights += 1;
        if (row.outcome === 'failed' || row.outcome === 'abandoned') w.failed += 1;
        w.lastActive = Math.max(w.lastActive, row.endedAt);
      }
    }
    for (const [worldId, w] of worlds) {
      const spend = roll.byWorld.get(worldId);
      const patch: Partial<World> = {
        massBytes: w.bytes,
        lightsTotal: w.lights,
        lightsFailed: w.failed,
        lastActiveAt: w.lastActive || null,
        massUsd30d: this.usageDone ? spend?.usd30 ?? 0 : null,
        spendTodayUsd: this.usageDone ? spend?.today ?? 0 : null,
      };
      const text = JSON.stringify(patch);
      if (this.worldSent.get(worldId) === text) continue;
      this.worldSent.set(worldId, text);
      this.ctx.worlds.ensure(w.root, patch);
    }
  }

  // Commands.

  private fileOf(nodeId: NodeId): string {
    const [sid, agentId] = nodeId.split('/');
    const s = sid ? this.track(sid) : undefined;
    const live = agentId ? s?.agents.get(agentId) : s?.main;
    const file = live?.path ?? this.nodeFile.get(nodeId);
    if (!file) throw new CommandError('not-found', 'No transcript for that craft');
    return file;
  }

  private hasFile(nodeId: NodeId): boolean {
    try {
      return this.fileOf(nodeId).length > 0;
    } catch {
      return false;
    }
  }

  private registerHandlers(): void {
    const { router } = this.ctx;
    router.register('craft.channel', async ({ nodeId, limit }) => {
      if (this.ctx.nativeText?.ownsNode(nodeId)) return this.ctx.nativeText.channel(nodeId, limit);
      // A young craft has no transcript yet, and a `persist: false` one never will. Neither is an error.
      if (this.ctx.bus.state().nodes[nodeId] && !this.hasFile(nodeId)) return { rows: [], complete: false };
      const result = await readChannel(this.fileOf(nodeId), limit);
      if (!result) throw new CommandError('not-found', 'Transcript is gone');
      const [sid, agentId] = nodeId.split('/');
      if (!agentId && sid) {
        const s = this.track(sid);
        for (const n of s?.agents.values() ?? []) {
          if (n.parentNodeId !== nodeId || n.startedAt === null) continue;
          result.rows.push({ kind: 'tender', at: n.startedAt, nodeId: n.nodeId, agentType: n.meta?.agentType ?? null, status: n.status });
        }
        result.rows.sort((a, b) => a.at - b.at);
      }
      return result;
    });
    router.register('craft.text', async ({ nodeId, limit }) => {
      if (this.ctx.nativeText?.ownsNode(nodeId)) return this.ctx.nativeText.textRows(nodeId, limit);
      let file: string;
      try {
        file = this.fileOf(nodeId);
      } catch {
        return { rows: [], available: false };
      }
      const rows = await readText(file, limit);
      return { rows: rows ?? [], available: rows !== null };
    });
    router.register('ledger.get', (): LedgerReport => {
      const now = Date.now();
      const trees = Object.values(this.ctx.bus.state().managed)
        .filter((m) => m.agentId === m.rootAgentId && m.treeBudgetUsd !== null)
        .map((m) => ({ rootAgentId: m.agentId, spentUsd: m.treeSpentUsd ?? m.spentUsd, budgetUsd: m.treeBudgetUsd as number }));
      return ledgerReport(this.ledger(now), {
        partial: !this.usageDone,
        burnUsdPerHour: this.rates.burnUsdPerHour(now),
        blockedTodayMs: this.blockedToday(now),
        trees,
      });
    });
    router.register('history.get', () => {
      const stored: Salvo[] = this.ctx.db.all<{ data: string }>('SELECT data FROM obs_salvo ORDER BY opened_at').map((r) => JSON.parse(r.data) as Salvo);
      const covered = new Set(stored.flatMap((s) => s.nodeIds));
      const past = this.pastSalvos.filter((s) => !s.nodeIds.some((id) => covered.has(id)));
      const salvos = [...past, ...stored].sort((a, b) => a.openedAt - b.openedAt);
      return { rows: [...this.rows.values(), ...(this.ctx.externalHistory?.() ?? [])], salvos };
    });
  }

  /** Structure-only snapshot for tools that measure the plane. */
  debugCounts(): { sessions: number; live: number; agents: number; runs: number; hot: number; usagePending: number } {
    let agents = 0;
    let runs = 0;
    let live = 0;
    let hot = 0;
    for (const s of this.sessions.values()) {
      if (s.endedAt === null) live += 1;
      agents += s.agents.size;
      runs += s.runs.size;
      if (s.main.cursor) hot += 1;
      for (const n of s.agents.values()) if (n.cursor) hot += 1;
    }
    return { sessions: this.sessions.size, live, agents, runs, hot, usagePending: this.usage.pending };
  }
}
