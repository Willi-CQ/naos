// The Control plane's one owner of agent state: AC 5.1's machine, the kernel-held send queue, admission, budgets and the
// limits of AC 12.3. Every limit is enforced here, in the handler. A prompt can only suggest one.
import type { SDKMessage, SDKMessageOrigin } from '@anthropic-ai/claude-agent-sdk';
import type {
  AdmissionState, AgentId, AgentState, ApprovalDecision, ManagedAgentView, ObservedSession, PlanState, SessionId, SpawnReceipt, SpawnSpec, TurnOrigin, WorldId,
} from '@naos/protocol';
import { DEFAULT_LIMITS, FIRST_FLIGHT_PROFILE, WORLD_DESIGNER_PROFILE } from '@naos/protocol';
import { randomBytes, randomUUID, type UUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CommandError, type KernelContext } from '../context.ts';
import { Approvals, type ApprovalAgent } from './approvals.ts';
import { Audit } from './audit.ts';
import { ManagedAgent, type QueryFn } from './driver.ts';
import { designerDeny, secretDenyRules, WORLD_DESIGNER_BUDGET_USD, worldDesignerProfile, worldDesignerPrompt } from './designer.ts';
import { FIRST_FLIGHT_BUDGET_USD, firstFlightFolder, firstFlightProfile, firstFlightPrompt } from './firstflight.ts';
import { FrameMapper, costOf, emptyUsage, isAborted, isTurnFailure, type FrameSignal, type RateLimitFacts, type ResultFacts } from './frames.ts';
import { composeOptions, kernelDenyRules, managedTitle, UNKNOWN_WORLD_TOOLS } from './options.ts';
import { osServer, type OsOps, type OsSpawnInput } from './orchestrator.ts';
import { sameStart, toFiletime, type Proc, type Snapshot, type TreeKill } from './procs.ts';
import type { Profiles } from './profiles.ts';
import type { Registry } from './registry.ts';
import type { Launch, Store, TreeRow } from './store.ts';
import { ToolTrees } from './trees.ts';
import type { Profile, Requester } from './types.ts';
import { createWorktree, gitInfo, removeWorktree, type Worktree } from './worktree.ts';

/** AC 5.1. Anything else is a bug or a late frame, and it is ignored rather than allowed to rewrite the state. */
export const TRANSITIONS: Readonly<Record<AgentState, readonly AgentState[]>> = {
  queued: ['spawning', 'exited', 'lost', 'closed'],
  spawning: ['ready', 'crashed', 'stopping', 'exited', 'lost'],
  ready: ['running', 'awaiting_approval', 'stopping', 'exited', 'crashed', 'lost'],
  running: ['awaiting_approval', 'idle', 'parked', 'budget_exhausted', 'rate_limited', 'stopping', 'exited', 'crashed', 'lost'],
  awaiting_approval: ['running', 'idle', 'parked', 'budget_exhausted', 'rate_limited', 'stopping', 'exited', 'crashed', 'lost'],
  idle: ['running', 'awaiting_approval', 'rate_limited', 'stopping', 'exited', 'crashed', 'lost'],
  parked: ['running', 'spawning', 'stopping', 'exited', 'crashed', 'lost'],
  budget_exhausted: ['stopping', 'exited', 'crashed', 'lost'],
  rate_limited: ['idle', 'running', 'awaiting_approval', 'stopping', 'exited', 'crashed', 'lost'],
  stopping: ['exited', 'crashed', 'lost'],
  exited: ['spawning', 'queued', 'closed'],
  crashed: ['spawning', 'queued', 'closed'],
  lost: ['spawning', 'queued', 'closed'],
  closed: [],
};

/** A process exists, or is about to. */
const LIVE: ReadonlySet<AgentState> = new Set(['spawning', 'ready', 'running', 'awaiting_approval', 'idle', 'parked', 'budget_exhausted', 'rate_limited', 'stopping']);
const COUNTS_AS_RUNNING: ReadonlySet<AgentState> = new Set(['spawning', 'running', 'awaiting_approval']);
const WORKING: ReadonlySet<AgentState> = new Set(['queued', 'spawning', 'running', 'awaiting_approval', 'stopping']);

/** The shim cannot carry a kernel-issued identity, so its callers get lower limits (AC 12.1). UNVERIFIED judgement, like AC 12.3. */
export const EXTERNAL_LIMITS = { live: 4, spawnsPerMinute: 10, budgetUsd: 1 } as const;

const WAIT_MAX_S = 60;
const MIN_CHILD_BUDGET_USD = 0.001;
const CLOSED_KEEP_MS = 3_600_000;
const ENDED_KEEP_MS = 86_400_000;
const STOP_EXIT_MS = 2000;

type Limits = typeof DEFAULT_LIMITS;

export interface SupervisorDeps {
  ctx: KernelContext;
  store: Store;
  registry: Registry;
  profiles: Profiles;
  snapshot: Snapshot;
  treeKill: TreeKill;
  query?: QueryFn;
  limits?: Limits;
  now?: () => number;
}

interface QueuedSend { uuid: UUID; text: string; origin: SDKMessageOrigin; composed: boolean }

interface Start { resume?: string; fork?: boolean; interrupted?: boolean }

interface Agent {
  view: ManagedAgentView;
  launch: Launch;
  frames: FrameMapper;
  driver: ManagedAgent | null;
  procStart: string | null;
  /** Follow-ups, held here so stop() never has to reach into the CLI's own queue (AC 3.1). */
  queue: QueuedSend[];
  /** Sends the CLI has and no result answered yet. A result binds by uuid, never as "the next result" (AC 5.2). */
  inFlight: Set<string>;
  lastResult: ResultFacts | null;
  /** Worktree still to create. */
  worktreeBase: string | null;
  /** `total_cost_usd` is cumulative and restored on resume or fork: `spent = total - offset`. */
  costOffset: number;
  /** Spend already known when this process started, for a restart that does not restore it. */
  costFloor: number;
  stopping: Promise<'graceful' | 'forced'> | null;
  exited: Promise<void> | null;
  markExited: (() => void) | null;
  /** No tree of this agent can still be running. Resume needs that (AC 5.3). */
  swept: boolean;
  sweeping: Promise<void> | null;
  /** The process died inside a turn, so a resume with no prompt may restart that turn. */
  turnCutOff: boolean;
  initSeen: boolean;
  firstInit: { skills: number; mcpServers: number } | null;
  waiters: Set<() => void>;
}

interface Tree extends TreeRow { spawns: number[]; stopped: boolean }

interface Place { cwd: string; root: string; isGit: boolean; hasCommit: boolean; worldId: WorldId; projectRoot: string }

const shortId = (): string => randomBytes(4).toString('hex');
const clampPercent = (v: number): number => Math.min(1, Math.max(0, v));
const round = (usd: number): number => Math.round(usd * 1e6) / 1e6;

const PERMISSION_RANK: Readonly<Record<string, number>> = { dontAsk: 0, plan: 1, default: 2, auto: 3 };

/** Launch modifiers, DESIGN 3.4: Shift+Enter plans first, Alt+Enter is the read-only analyst. */
function applyMode(profile: Profile, mode: SpawnSpec['mode']): { permissionMode: Profile['permissionMode']; tools: string[] | null } {
  if (mode === 'read-only') return { permissionMode: 'dontAsk', tools: ['Read', 'Glob', 'Grep'] };
  if (mode === 'plan-first') {
    const tools = profile.tools ?? [...UNKNOWN_WORLD_TOOLS];
    return { permissionMode: 'plan', tools: tools.includes('ExitPlanMode') ? tools : [...tools, 'ExitPlanMode'] };
  }
  return { permissionMode: profile.permissionMode, tools: profile.tools };
}

/** Message text never reaches a failure line, only what the kernel itself knows. */
const failureOf = (reason: string | null): string | null => (isTurnFailure(reason) ? `Turn ended: ${reason}` : null);

/** Every non-alphanumeric character of the absolute cwd becomes `-` (AC 2.6). */
const encodeCwd = (cwd: string): string => path.resolve(cwd).replace(/[^A-Za-z0-9]/g, '-');

export function transcriptExists(claudeHome: string, sessionId: SessionId, cwds: readonly string[]): boolean {
  const root = path.join(claudeHome, 'projects');
  for (const cwd of cwds) if (fs.existsSync(path.join(root, encodeCwd(cwd), `${sessionId}.jsonl`))) return true;
  // Long folder names are hashed (AC 7.19), so a miss is not yet proof.
  let dirs: string[] = [];
  try {
    dirs = fs.readdirSync(root);
  } catch {
    return false;
  }
  return dirs.some((dir) => fs.existsSync(path.join(root, dir, `${sessionId}.jsonl`)));
}

export class Supervisor implements OsOps {
  readonly approvals: Approvals;
  readonly audit: Audit;
  readonly trees: ToolTrees;
  readonly #d: SupervisorDeps;
  readonly #ctx: KernelContext;
  readonly #limits: Limits;
  readonly #now: () => number;
  readonly #agents = new Map<AgentId, Agent>();
  readonly #tree = new Map<AgentId, Tree>();
  readonly #externalSpawns: number[] = [];
  #pad: Array<{ agent: Agent; start: Start }> = [];
  #rateLimitedUntil = 0;
  #operatorFrozen = false;
  #releaseTimer: NodeJS.Timeout | null = null;
  #tick: NodeJS.Timeout | null = null;
  #unsubscribe: (() => void) | null = null;
  #lastAdmission = '';
  #shuttingDown = false;

  constructor(deps: SupervisorDeps) {
    this.#d = deps;
    this.#ctx = deps.ctx;
    this.#limits = deps.limits ?? DEFAULT_LIMITS;
    this.#now = deps.now ?? Date.now;
    this.trees = new ToolTrees({
      store: deps.store, snapshot: deps.snapshot, treeKill: deps.treeKill, log: deps.ctx.log, now: this.#now,
      pidOf: (agentId) => this.#agents.get(agentId)?.view.pid ?? null,
    });
    this.audit = new Audit(deps.store, this.trees, this.#now);
    this.approvals = new Approvals({
      bus: deps.ctx.bus, store: deps.store, audit: this.audit, log: deps.ctx.log, now: this.#now,
      openChanged: (agentId, delta) => this.#openChanged(agentId, delta),
      redirect: (agentId, text) => void this.send(agentId, text, 'now', { kind: 'ui' }),
    });
  }

  // Boot and shutdown ------------------------------------------------------------------------------------------------

  /** AC 5.3: mark lost, sweep orphans, and only then offer resume. Approvals that were pending are gone. */
  async boot(): Promise<void> {
    for (const row of this.#d.store.trees()) this.#tree.set(row.rootAgentId, { ...row, spawns: [], stopped: false });

    const orphans: Array<{ agentId: AgentId; pid: number; procStart: string | null; startedAt: number | null }> = [];
    const restored: Agent[] = [];
    const now = this.#now();
    for (const row of this.#d.store.agents()) {
      const { view, launch } = row;
      const wasLive = LIVE.has(view.state) || view.state === 'queued';
      if (view.state === 'closed' || (!wasLive && view.endedAt !== null && now - view.endedAt > ENDED_KEEP_MS)) continue;
      const agent = this.#agent(view, launch);
      agent.procStart = row.procStart;
      this.#agents.set(view.agentId, agent);
      this.#d.registry.register(view.agentId, { sessionId: view.sessionId!, title: managedTitle(view.agentId) });
      if (wasLive && row.pid !== null) orphans.push({ agentId: view.agentId, pid: row.pid, procStart: row.procStart, startedAt: view.startedAt });
      if (wasLive) {
        agent.turnCutOff = view.state === 'running' || view.state === 'awaiting_approval';
        agent.view = {
          ...view, state: 'lost', pid: null, openApprovals: 0, queuedSends: 0, stopStep: null, endedAt: now, resumable: false,
          failure: 'Kernel restarted while this craft was live.',
        };
      }
      agent.swept = !wasLive;
      restored.push(agent);
      this.#announce(agent, wasLive ? 'abandoned' : 'known');
      this.#commit(agent);
    }

    this.approvals.expireAll();

    if (orphans.length > 0) {
      const procs = await this.#d.snapshot().catch(() => []);
      for (const orphan of orphans) {
        // A pid alone proves nothing, Windows reuses them (AC 7.12).
        const proc = procs.find((p) => p.pid === orphan.pid);
        if (proc && orphan.procStart && sameStart(proc.created, orphan.procStart)) await this.#d.treeKill(orphan.pid);
        else await this.#sweepShells(orphan, procs);
      }
    }
    await this.trees.sweep().catch((e) => this.#ctx.log.error('control: orphan sweep failed', { error: String(e) }));

    for (const agent of restored) {
      if (agent.swept) continue;
      agent.swept = true;
      agent.view = { ...agent.view, resumable: this.#canResume(agent) };
      this.#commit(agent);
    }

    this.#publishAdmission();
    this.#unsubscribe = this.#ctx.bus.subscribe((event) => {
      if (event.type === 'plan.changed') this.#pumpAdmission();
    });
    this.#tick = setInterval(() => this.#onTick(), 250);
    this.#tick.unref();
  }

  async #sweepShells(cli: { agentId: AgentId; pid: number; procStart: string | null; startedAt: number | null }, procs: Proc[]): Promise<void> {
    const from = cli.procStart ?? (cli.startedAt === null ? null : toFiletime(cli.startedAt));
    if (from !== null) await this.trees.sweepDeadCli(cli.agentId, cli.pid, from, procs);
  }

  /** Planned shutdown: stop everything and leave clean rows, so the next boot has nothing to reconcile. */
  async shutdown(): Promise<void> {
    this.#shuttingDown = true;
    this.#pad = [];
    if (this.#tick) clearInterval(this.#tick);
    if (this.#releaseTimer) clearTimeout(this.#releaseTimer);
    this.#unsubscribe?.();
    await Promise.all([...this.#agents.values()].filter((a) => LIVE.has(a.view.state)).map((a) => this.stop(a.view.agentId).catch(() => undefined)));
    this.trees.stop();
  }

  #onTick(): void {
    const now = this.#now();
    for (const agent of this.#agents.values()) {
      if (agent.driver) agent.frames.tick(now);
      const { state, endedAt } = agent.view;
      const keep = state === 'closed' ? CLOSED_KEEP_MS : ENDED_KEEP_MS;
      if ((state === 'closed' || state === 'exited' || state === 'crashed' || state === 'lost') && endedAt !== null && now - endedAt > keep) this.#forget(agent);
    }
  }

  #forget(agent: Agent): void {
    const { agentId } = agent.view;
    this.#agents.delete(agentId);
    this.#d.registry.unregister(agentId);
    this.#ctx.bus.publish({ type: 'managed.removed', agentId });
  }

  // State ------------------------------------------------------------------------------------------------------------

  #agent(view: ManagedAgentView, launch: Launch): Agent {
    const { bus } = this.#ctx;
    return {
      view,
      launch,
      frames: new FrameMapper({
        sessionId: view.sessionId!, cwd: view.cwd, now: this.#now,
        publish: (e) => bus.publish(e),
        pushText: (nodeId, delta) => bus.pushText(nodeId, delta),
        setRate: (rate) => bus.setRate(rate),
        clearRate: (nodeId) => bus.clearRate(nodeId),
      }),
      driver: null, procStart: null, queue: [], inFlight: new Set(), lastResult: null, worktreeBase: null, costOffset: 0, costFloor: view.spentUsd,
      stopping: null, exited: null, markExited: null, swept: true, sweeping: null, turnCutOff: false, initSeen: false, firstInit: null, waiters: new Set(),
    };
  }

  #must(agentId: AgentId): Agent {
    const agent = this.#agents.get(agentId);
    if (!agent) throw new CommandError('not-found', 'No such agent.');
    return agent;
  }

  #commit(agent: Agent): void {
    agent.view = { ...agent.view, queuedSends: agent.queue.length };
    this.#d.store.saveAgent(agent.view, agent.launch, agent.procStart);
    this.#ctx.bus.publish({ type: 'managed.upserted', agent: agent.view });
    for (const wake of agent.waiters) wake();
    agent.waiters.clear();
    this.#publishAdmission();
  }

  #set(agent: Agent, next: AgentState, patch: Partial<ManagedAgentView> = {}): boolean {
    const current = agent.view.state;
    if (current !== next && !TRANSITIONS[current].includes(next)) {
      this.#ctx.log.warn('control: ignored transition', { agentId: agent.view.agentId, from: current, to: next });
      return false;
    }
    agent.view = { ...agent.view, ...patch, state: next };
    this.#commit(agent);
    if (this.#pad.length > 0) this.#pumpAdmission();
    return true;
  }

  #openChanged(agentId: AgentId, delta: 1 | -1): void {
    const agent = this.#agents.get(agentId);
    if (!agent) return;
    const openApprovals = Math.max(0, agent.view.openApprovals + delta);
    agent.frames.setWaiting(openApprovals > 0);
    const { state } = agent.view;
    if (openApprovals > 0 && (state === 'running' || state === 'idle' || state === 'ready' || state === 'rate_limited')) this.#set(agent, 'awaiting_approval', { openApprovals });
    else if (openApprovals === 0 && state === 'awaiting_approval') this.#set(agent, 'running', { openApprovals });
    else {
      agent.view = { ...agent.view, openApprovals };
      this.#commit(agent);
    }
  }

  #running(): number {
    let n = 0;
    for (const a of this.#agents.values()) if (COUNTS_AS_RUNNING.has(a.view.state)) n += 1;
    return n;
  }

  #alive(): number {
    let n = 0;
    for (const a of this.#agents.values()) if (LIVE.has(a.view.state)) n += 1;
    return n;
  }

  /** The kernel never spends past the point the plan can pay for. Limits from AC 6, UNVERIFIED because no limit was ever hit. */
  #frozen(): AdmissionState['frozen'] {
    if (this.#operatorFrozen) return 'operator';
    const now = this.#now();
    const plan = this.#ctx.bus.state().plan;
    if (now < this.#rateLimitedUntil) return 'rate-limited';
    const reset = plan?.resetsAt.fiveHour ?? null;
    if (reset !== null && reset < now) return null;
    if (plan?.status === 'rejected') return 'rate-limited';
    const left = plan?.fiveHourLeft ?? null;
    return left !== null && (1 - left) * 100 >= this.#limits.admissionStopPercent ? 'plan-window' : null;
  }

  admission(): AdmissionState {
    return {
      running: this.#running(),
      runningLimit: this.#limits.runningGlobal,
      alive: this.#alive(),
      aliveLimit: this.#limits.aliveGlobal,
      frozen: this.#frozen(),
      queued: this.#pad.map((p) => p.agent.view.agentId),
    };
  }

  admissionBlock(copies = 1): string | null {
    const a = this.admission();
    if (a.frozen === 'plan-window') return `The five-hour window is past ${this.#limits.admissionStopPercent} percent, so new craft wait.`;
    if (a.frozen === 'rate-limited') return 'The plan limit was reached, so new craft wait for the reset.';
    if (a.frozen === 'operator') return 'Launches are paused.';
    if (a.running + copies > a.runningLimit) return `${a.running} of ${a.runningLimit} craft are running.`;
    if (a.alive + copies > a.aliveLimit) return `${a.alive} of ${a.aliveLimit} craft are alive.`;
    return null;
  }

  #publishAdmission(): void {
    const admission = this.admission();
    const key = JSON.stringify(admission);
    if (key === this.#lastAdmission) return;
    this.#lastAdmission = key;
    this.#ctx.bus.publish({ type: 'admission.changed', admission });
  }

  #pumpAdmission(): void {
    if (this.#shuttingDown) return;
    while (this.#pad.length > 0 && this.admissionBlock() === null) {
      const next = this.#pad.shift()!;
      if (next.agent.view.state !== 'queued') continue;
      void this.#launch(next.agent, next.start);
    }
    this.#publishAdmission();
  }

  // Spawning ---------------------------------------------------------------------------------------------------------

  #refuse(limit: string, message: string, parentAgentId: AgentId | null, worldId: WorldId | null): never {
    this.#ctx.bus.publish({ type: 'spawn.refused', parentAgentId, worldId, limit });
    throw new CommandError('limit', message);
  }

  async #place(spec: SpawnSpec, first: boolean, parent: Agent | null): Promise<Place> {
    const { worlds, config } = this.#ctx;
    const named = spec.worldId ? worlds.get(spec.worldId) : undefined;
    if (spec.worldId && !named) throw new CommandError('not-found', 'That world is not known.');
    const cwd = first ? firstFlightFolder(config.home) : spec.cwd ? path.resolve(spec.cwd) : named?.projectRoot ?? parent?.launch.repoRoot ?? null;
    if (!cwd) throw new CommandError('bad-request', 'Name a world or a folder.');
    // The real error misleads: `native binary ... failed to launch` (AC 7.7).
    if (!fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) throw new CommandError('bad-request', 'That folder does not exist.');
    const git = await gitInfo(cwd);
    const world = named ?? worlds.ensure(git.root);
    return { cwd: path.resolve(cwd), root: git.root, isGit: git.isGit, hasCommit: git.hasCommit, worldId: world.worldId, projectRoot: world.projectRoot ?? git.root };
  }

  /** A child's profile is the parent's or stricter. agent_spawn cannot widen it (AC 12.4). */
  #checkAuthority(parent: Agent, profile: Profile, spec: SpawnSpec, worldId: WorldId): void {
    const parentMode = parent.view.permissionMode;
    const { permissionMode } = applyMode(profile, spec.mode);
    if ((PERMISSION_RANK[permissionMode] ?? 9) > (PERMISSION_RANK[parentMode] ?? 0)) {
      this.#refuse('profile', `refused: profile ${profile.name} runs in ${permissionMode}, wider than this agent's ${parentMode}`, parent.view.agentId, worldId);
    }
    if (parent.launch.profile.settings === 'none' && profile.settings !== 'none') {
      this.#refuse('profile', `refused: profile ${profile.name} would load repo settings this agent does not have`, parent.view.agentId, worldId);
    }
  }

  #liveInTree(rootAgentId: AgentId): number {
    let n = 0;
    for (const a of this.#agents.values()) {
      if (a.view.rootAgentId === rootAgentId && (LIVE.has(a.view.state) || a.view.state === 'queued')) n += 1;
    }
    return n;
  }

  #treeSpent(rootAgentId: AgentId): number {
    let usd = 0;
    for (const a of this.#agents.values()) if (a.view.rootAgentId === rootAgentId) usd += a.view.spentUsd;
    return round(usd);
  }

  #checkChild(parent: Agent, worldId: WorldId): Tree {
    const { agentId, rootAgentId, depth } = parent.view;
    const tree = this.#tree.get(rootAgentId);
    if (!tree) this.#refuse('tree', 'refused: this agent has no tree', agentId, worldId);
    if (depth >= tree.depth) this.#refuse('depth', `refused: depth limit ${tree.depth} reached`, agentId, worldId);
    let children = 0;
    for (const a of this.#agents.values()) {
      if (a.view.parentAgentId === agentId && (LIVE.has(a.view.state) || a.view.state === 'queued')) children += 1;
    }
    if (children >= tree.childLimit) this.#refuse('children', `refused: child limit ${tree.childLimit} reached`, agentId, worldId);
    if (this.#liveInTree(rootAgentId) >= this.#limits.livePerTree) this.#refuse('live-per-tree', `refused: ${this.#limits.livePerTree} agents are live in this tree`, agentId, worldId);
    const now = this.#now();
    tree.spawns = tree.spawns.filter((at) => now - at < 60_000);
    if (tree.spawns.length >= this.#limits.spawnsPerTreePerMinute) this.#refuse('spawn-rate', `refused: ${this.#limits.spawnsPerTreePerMinute} spawns this minute`, agentId, worldId);
    if (tree.stopped) this.#refuse('tree-budget', 'refused: the tree budget is spent', agentId, worldId);
    return tree;
  }

  #checkExternal(worldId: WorldId): void {
    let live = 0;
    for (const a of this.#agents.values()) if (a.launch.external && (LIVE.has(a.view.state) || a.view.state === 'queued')) live += 1;
    if (live >= EXTERNAL_LIMITS.live) this.#refuse('external-live', `refused: ${EXTERNAL_LIMITS.live} external agents are live`, null, worldId);
    const now = this.#now();
    while (this.#externalSpawns.length > 0 && now - this.#externalSpawns[0]! >= 60_000) this.#externalSpawns.shift();
    if (this.#externalSpawns.length >= EXTERNAL_LIMITS.spawnsPerMinute) this.#refuse('spawn-rate', `refused: ${EXTERNAL_LIMITS.spawnsPerMinute} spawns this minute`, null, worldId);
    this.#externalSpawns.push(now);
  }

  async spawn(spec: SpawnSpec, by: Requester, builtin?: Profile): Promise<SpawnReceipt> {
    if (typeof spec?.profile !== 'string' || typeof spec.prompt !== 'string') throw new CommandError('bad-request', 'A spawn names a profile and a prompt.');
    const parent = by.kind === 'agent' ? this.#must(by.parentId) : null;
    const designer = builtin?.name === WORLD_DESIGNER_PROFILE;
    if (spec.profile === WORLD_DESIGNER_PROFILE && !designer) {
      throw new CommandError('bad-request', 'A world designer is started with world.design, not by name.');
    }
    const first = spec.profile === FIRST_FLIGHT_PROFILE;
    if (first && by.kind !== 'ui') throw new CommandError('forbidden', 'First Flight is started by the operator.');
    const profile = builtin ?? (first ? firstFlightProfile() : this.#d.profiles.get(spec.profile));
    if (!profile) throw new CommandError('bad-request', `No profile named ${spec.profile}.`);

    const scope = by.kind === 'agent' ? `agent:${parent!.view.rootAgentId}` : by.kind;
    if (spec.idempotencyKey) {
      const known = this.#d.store.idempotent(scope, spec.idempotencyKey);
      if (known && this.#agents.has(known)) return { agentIds: [known], queued: 0 };
    }

    const place = await this.#place(spec, first, parent);
    let tree: Tree | null = null;
    if (parent) {
      this.#checkAuthority(parent, profile, spec, place.worldId);
      tree = this.#checkChild(parent, place.worldId);
    }
    if (by.kind === 'mcp') {
      if (profile.permissionMode === 'auto') this.#refuse('profile', 'refused: an external caller cannot start an unattended agent', null, place.worldId);
      this.#checkExternal(place.worldId);
    }

    let budgetUsd = first ? FIRST_FLIGHT_BUDGET_USD : designer ? WORLD_DESIGNER_BUDGET_USD : spec.budgetUsd ?? profile.defaultBudgetUsd;
    if (!(budgetUsd > 0)) throw new CommandError('bad-request', 'A budget must be above zero.');
    if (by.kind === 'mcp') budgetUsd = Math.min(budgetUsd, EXTERNAL_LIMITS.budgetUsd);
    if (tree) {
      const free = (tree.budgetUsd ?? parent!.view.budgetUsd) - this.#treeSpent(tree.rootAgentId);
      if (free < MIN_CHILD_BUDGET_USD) this.#refuse('tree-budget', 'refused: the tree budget is spent', parent!.view.agentId, place.worldId);
      budgetUsd = round(Math.min(budgetUsd, free));
    }

    const copies = parent ? 1 : Math.min(Math.max(1, spec.copies ?? 1), this.#limits.aliveGlobal);
    const block = this.admissionBlock(copies);
    if (block && (!spec.queue || parent)) this.#refuse('admission', parent ? `refused: ${block}` : block, parent?.view.agentId ?? null, place.worldId);

    const agentIds: AgentId[] = [];
    let queued = 0;
    let lead: string | null = null;
    for (let i = 0; i < copies; i += 1) {
      const agent = this.#create(spec, by, parent, tree, profile, place, budgetUsd, first, designer);
      agentIds.push(agent.view.agentId);
      lead ??= agent.view.nodeId;
      if (copies > 1) agent.view = { ...agent.view, copyOf: lead };
      if (spec.prompt || first) {
        const text = first ? firstFlightPrompt(agent.view.agentId) : spec.prompt;
        agent.queue.push({ uuid: randomUUID(), text, ...this.#originOf(by), });
      }
      this.#commit(agent);
      if (this.admissionBlock() === null) void this.#launch(agent, {});
      else {
        this.#pad.push({ agent, start: {} });
        queued += 1;
      }
    }
    if (tree) tree.spawns.push(this.#now());
    if (spec.idempotencyKey) this.#d.store.saveIdempotent(scope, spec.idempotencyKey, agentIds[0]!);
    this.#publishAdmission();
    return { agentIds, queued };
  }

  /** INTERSTELLAR 23. Never reached through `agent.spawn`. One live designer per world. */
  async design(worldId: WorldId, by: Requester): Promise<SpawnReceipt> {
    if (by.kind !== 'ui') throw new CommandError('forbidden', 'A world designer is started by the operator.');
    const world = this.#ctx.worlds.get(worldId);
    if (!world) throw new CommandError('not-found', 'That world is not known.');
    if (world.kind === 'belt' || world.projectRoot === null) throw new CommandError('bad-request', 'The Belt has no planet.');
    const live = this.#designerOf(worldId);
    if (live) return { agentIds: [live], queued: 0 };
    const siblings = Object.values(this.#ctx.bus.state().worlds)
      .filter((row) => row.worldId !== worldId && row.genome)
      .map((row) => row.genome!);
    return this.spawn({
      worldId,
      profile: WORLD_DESIGNER_PROFILE,
      prompt: worldDesignerPrompt(world, siblings),
      title: 'design planet',
      worktree: false,
      queue: true,
      idempotencyKey: `world-design:${worldId}:${world.designedAt ?? 0}`,
    }, by, worldDesignerProfile());
  }

  #designerOf(worldId: WorldId): AgentId | null {
    for (const agent of this.#agents.values()) {
      if (agent.launch.worldDesigner && agent.view.worldId === worldId && (LIVE.has(agent.view.state) || agent.view.state === 'queued')) {
        return agent.view.agentId;
      }
    }
    return null;
  }

  #originOf(by: Requester): { origin: SDKMessageOrigin; composed: boolean } {
    if (by.kind === 'ui') return { origin: { kind: 'human' }, composed: false };
    if (by.kind === 'mcp') return { origin: { kind: 'peer', from: 'external', name: 'mcp' }, composed: true };
    const parent = this.#agents.get(by.parentId);
    return { origin: { kind: 'peer', from: parent?.view.sessionId ?? by.parentId, name: parent?.view.title ?? by.parentId }, composed: true };
  }

  #create(
    spec: SpawnSpec, by: Requester, parent: Agent | null, tree: Tree | null, profile: Profile,
    place: Place, budgetUsd: number, first: boolean, designer = false,
  ): Agent {
    const agentId = `n${shortId()}`;
    const sessionId = randomUUID();
    const { permissionMode, tools } = applyMode(profile, spec.mode);

    let root = tree;
    if (!root) {
      const orchestrates = profile.orchestrator || spec.mission !== undefined;
      root = {
        rootAgentId: agentId,
        budgetUsd: spec.mission?.treeBudgetUsd ?? (orchestrates ? budgetUsd : null),
        depth: spec.mission?.depth ?? this.#limits.depth,
        childLimit: spec.mission?.childLimit ?? this.#limits.childrenPerAgent,
        missionId: orchestrates ? `m${agentId.slice(1)}` : null,
        external: by.kind === 'mcp' ? 1 : 0,
        spawns: [],
        stopped: false,
      };
      this.#tree.set(agentId, root);
      this.#d.store.saveTree(root);
    }

    const wantsWorktree = !first && !designer && (spec.worktree ?? profile.worktree) && place.isGit && place.hasCommit;
    const view: ManagedAgentView = {
      agentId, sessionId, nodeId: sessionId, worldId: place.worldId, projectRoot: place.projectRoot, cwd: place.cwd,
      profile: profile.name, title: spec.title ?? `${profile.name} ${agentId}`, model: spec.model ?? profile.model,
      effort: spec.effort ?? profile.effort, permissionMode,
      parentAgentId: parent?.view.agentId ?? null, rootAgentId: root.rootAgentId, depth: parent ? parent.view.depth + 1 : 0, missionId: root.missionId,
      state: 'queued', stopStep: null, openApprovals: 0, failure: null,
      budgetUsd, spentUsd: 0, treeBudgetUsd: root.budgetUsd, treeSpentUsd: root.budgetUsd === null ? null : this.#treeSpent(root.rootAgentId),
      turn: 0, maxTurns: profile.maxTurns, toolCalls: 0, toolErrors: 0, queuedSends: 0, lastTerminalReason: null, lastTurnAborted: false,
      ttftMs: null, subagentStats: null, contextTokens: null, contextWindow: null, worktree: null, pid: null,
      createdAt: this.#now(), startedAt: null, endedAt: null, resumable: false,
    };
    const launch: Launch = {
      profile, tools, repoRoot: place.root, isGit: place.isGit,
      external: by.kind === 'mcp' || !!parent?.launch.external, firstFlight: first, worldDesigner: designer,
    };
    const agent = this.#agent(view, launch);
    if (wantsWorktree) agent.worktreeBase = 'HEAD';
    this.#agents.set(agentId, agent);
    // Before query(), so the Observer can never mistake it for a foreign session (AC 13).
    this.#d.registry.register(agentId, { sessionId, title: managedTitle(agentId) });
    return agent;
  }

  #session(agent: Agent, live: boolean): ObservedSession {
    const v = agent.view;
    const f = agent.frames;
    return {
      sessionId: f.sessionId, origin: 'control', worldId: v.worldId, title: v.title, titleSource: 'custom', displayName: v.title,
      projectRoot: v.projectRoot, startCwd: v.cwd, currentCwd: v.cwd,
      worktree: v.worktree ? { path: v.worktree.path, name: v.worktree.name, branch: v.worktree.branch } : null,
      gitBranch: v.worktree?.branch ?? null, slugs: [], transcriptPath: null, transcriptBytes: 0,
      pid: v.pid, liveness: live ? 'alive' : 'dead', kind: 'interactive', entrypoint: 'sdk-ts', version: null, pidStatus: null,
      remoteControlled: false, acceptsPeerMessages: false, activity: f.activity, queuedInputs: agent.queue.length,
      model: v.model, requestedModel: v.model, effort: v.effort, permissionMode: v.permissionMode,
      startedAt: v.startedAt, lastRecordAt: null, lastWriteAt: null, endedAt: v.endedAt,
      usage: emptyUsage(), usageTree: emptyUsage(), cost: costOf(v.spentUsd), contextTokens: v.contextTokens, contextWindow: v.contextWindow,
      blockedMs: 0, rootNodeId: f.sessionId, agentCount: 0, runningAgentCount: 0, workflowRunIds: [], lastRateLimit: null,
    };
  }

  /** Every managed craft is a session with a main node, because events address nodes. Restored ones arrive already ended. */
  #announce(agent: Agent, kind: 'live' | 'known' | 'abandoned'): void {
    const sessionId = agent.frames.sessionId;
    this.#ctx.bus.publish({ type: 'session.discovered', sessionId, nodeId: sessionId, session: this.#session(agent, kind === 'live') });
    if (kind === 'abandoned') this.#ctx.bus.publish({ type: 'session.ended', sessionId, nodeId: sessionId, outcome: 'abandoned', reason: 'exit' });
  }

  #trusted(agent: Agent): boolean {
    return !agent.launch.firstFlight && !agent.launch.worldDesigner && this.#ctx.worlds.get(agent.view.worldId)?.trusted === true;
  }

  async #prepareWorktree(agent: Agent): Promise<void> {
    if (agent.worktreeBase === null || agent.view.worktree) return;
    const { agentId } = agent.view;
    const wt: Worktree = await createWorktree(agent.launch.repoRoot, agentId, agent.worktreeBase);
    agent.worktreeBase = null;
    agent.view = { ...agent.view, worktree: wt, cwd: wt.path };
  }

  #stderrSink(agentId: AgentId): (data: string) => void {
    const dir = path.join(this.#ctx.config.home, 'logs', 'agents');
    let ready = false;
    return (data) => {
      if (!ready) {
        fs.mkdirSync(dir, { recursive: true });
        ready = true;
      }
      fs.appendFile(path.join(dir, `${agentId}.log`), data, () => undefined);
    };
  }

  #remaining(agent: Agent): number {
    return round(agent.view.budgetUsd - agent.view.spentUsd);
  }

  async #launch(agent: Agent, start: Start): Promise<void> {
    const { agentId } = agent.view;
    this.#set(agent, 'spawning', { startedAt: agent.view.startedAt ?? this.#now(), endedAt: null, stopStep: null, resumable: false });
    agent.exited = new Promise((resolve) => { agent.markExited = resolve; });
    try {
      await this.#prepareWorktree(agent);
      if (agent.view.state !== 'spawning') {
        this.#set(agent, 'exited', { endedAt: this.#now(), stopStep: null });
        agent.markExited?.();
        return;
      }
      const worktree = agent.view.worktree;
      // The CLI's worktree flag and a resume both start from the repo root, and the binary enters the worktree itself (AC 10).
      const cwd = worktree ? agent.launch.repoRoot : agent.view.cwd;
      const trusted = this.#trusted(agent);
      const options = composeOptions({
        agentId, profile: agent.launch.profile, model: agent.view.model, effort: agent.view.effort,
        permissionMode: agent.view.permissionMode as Profile['permissionMode'], tools: agent.launch.tools, cwd,
        maxBudgetUsd: this.#remaining(agent), maxTurns: agent.view.maxTurns, sessionId: agent.view.sessionId!,
        ...(start.resume ? { resume: start.resume } : {}),
        ...(start.fork ? { fork: true } : {}),
        ...(start.interrupted ? { resumeInterruptedTurn: true } : {}),
        trusted,
        ...(worktree ? { worktree: { name: worktree.name, repoRoot: agent.launch.repoRoot } } : {}),
        canUseTool: async (toolName, input, o) => {
          if (agent.launch.worldDesigner) {
            const denied = designerDeny(toolName, input as Record<string, unknown>);
            if (denied) return denied;
          }
          return this.approvals.ask(this.#approvalAgent(agent), toolName, input, o);
        },
        audit: this.audit.hooks(agentId),
        denyRules: [
          ...kernelDenyRules(this.#ctx.config.home, { scratchInside: agent.launch.firstFlight }),
          ...(agent.launch.worldDesigner ? secretDenyRules() : []),
        ],
        stderr: this.#stderrSink(agentId),
        ...(agent.launch.profile.orchestrator ? { os: osServer(this, agentId) } : {}),
      });
      agent.frames.revive(agent.view.cwd);
      this.#announce(agent, 'live');
      this.#d.store.saveAgent(agent.view, agent.launch, agent.procStart);
      agent.initSeen = false;
      agent.costFloor = agent.view.spentUsd;
      agent.turnCutOff = false;
      agent.driver = new ManagedAgent(agentId, options, {
        onFrame: (frame) => this.#onFrame(agent, frame),
        onExit: (info) => this.#onExit(agent, info),
      }, this.#d.query, this.#d.treeKill);
    } catch (e) {
      this.#failLaunch(agent, e);
      return;
    }

    try {
      await agent.driver.ready();
    } catch (e) {
      this.#ctx.log.warn('control: spawn failed', { agentId, error: String((e as Error).message).slice(0, 200) });
      if (agent.driver) await agent.driver.kill().catch(() => undefined);
      return;
    }
    const pid = agent.driver?.pid ?? null;
    if (agent.view.state === 'spawning' || agent.view.state === 'stopping') {
      if (pid !== null) {
        agent.procStart = this.#readProcStart(pid);
        this.#d.registry.register(agentId, { sessionId: agent.frames.sessionId, pid });
      }
    }
    if (agent.view.state === 'spawning') {
      const sessionId = agent.frames.sessionId;
      this.#ctx.bus.publish({ type: 'session.changed', sessionId, nodeId: sessionId, patch: { pid, liveness: 'alive' } });
      this.#set(agent, 'ready', { pid });
      this.#drain(agent);
    } else if (agent.view.state === 'stopping') {
      agent.view = { ...agent.view, pid };
      this.#commit(agent);
    }
  }

  #failLaunch(agent: Agent, e: unknown): void {
    const message = String((e as Error).message ?? e).slice(0, 200);
    this.#ctx.log.warn('control: launch failed', { agentId: agent.view.agentId, error: message });
    this.#set(agent, 'crashed', { failure: `Launch failed: ${message}`, endedAt: this.#now(), resumable: false });
    agent.markExited?.();
    this.#pumpAdmission();
  }

  /** Only the one field, from the CLI's own pid file. Read only, like everything under ~/.claude. */
  #readProcStart(pid: number): string | null {
    try {
      const text = fs.readFileSync(path.join(this.#ctx.config.claudeHome, 'sessions', `${pid}.json`), 'utf8');
      const value = (JSON.parse(text) as { procStart?: unknown }).procStart;
      return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
    } catch {
      return null;
    }
  }

  #approvalAgent(agent: Agent): ApprovalAgent {
    return {
      agentId: agent.view.agentId,
      sessionId: agent.frames.sessionId,
      nodeId: agent.frames.sessionId,
      worldId: agent.view.worldId,
      callPosition: (id) => agent.frames.callPosition(id),
      subagentType: (id) => agent.frames.subagentType(id),
      decided: (id, decision, source) => agent.frames.markDecision(id, decision, decision === 'reject' ? { kind: 'user', source } : null),
    };
  }

  // Frames -----------------------------------------------------------------------------------------------------------

  #onFrame(agent: Agent, frame: SDKMessage): void {
    let signal: FrameSignal | null = null;
    try {
      signal = agent.frames.handle(frame);
    } catch (e) {
      // The format can change on any release. A frame must never take the agent down.
      this.#ctx.log.warn('control: frame failed', { type: frame.type, error: String(e) });
    }
    if (signal) this.#onSignal(agent, signal);
    const f = agent.frames;
    if (f.dirty) {
      f.dirty = false;
      agent.view = { ...agent.view, toolCalls: f.toolCalls, toolErrors: f.toolErrors, contextTokens: f.contextTokens, contextWindow: f.contextWindow, ttftMs: f.ttftMs };
      this.#commit(agent);
    }
  }

  #onSignal(agent: Agent, signal: FrameSignal): void {
    switch (signal.kind) {
      case 'init': return this.#onInit(agent, signal);
      case 'requesting':
        // A turn nobody sent: a background task reporting back (AC 2.4).
        if (agent.view.state === 'idle' || agent.view.state === 'ready') {
          agent.frames.beginTurn('task_notification');
          this.#set(agent, 'running');
        }
        return;
      case 'result': return this.#onResult(agent, signal.result);
      case 'rate-limit': return this.#onRateLimit(agent, signal.info);
      case 'cancelled':
        agent.inFlight.delete(signal.uuid);
        return;
    }
  }

  #onInit(agent: Agent, init: Extract<FrameSignal, { kind: 'init' }>): void {
    const { agentId } = agent.view;
    const previous = agent.frames.sessionId;
    if (init.sessionId !== previous) {
      // `/clear` gives a new session id. Follow it, and keep the hull (AC 13).
      this.#d.registry.register(agentId, { sessionId: init.sessionId });
      this.#ctx.bus.publish({ type: 'session.changed', sessionId: previous, nodeId: previous, patch: { sessionId: init.sessionId } });
      agent.frames.sessionId = init.sessionId;
      agent.view = { ...agent.view, sessionId: init.sessionId, nodeId: init.sessionId };
    }
    if (agent.initSeen) return;
    agent.initSeen = true;
    agent.firstInit = { skills: init.skills, mcpServers: init.mcpServers };
    agent.view = { ...agent.view, cwd: init.cwd || agent.view.cwd, permissionMode: init.permissionMode || agent.view.permissionMode };
    agent.frames.cwd = agent.view.cwd;
    const sessionId = agent.frames.sessionId;
    this.#ctx.bus.publish({
      type: 'session.changed', sessionId, nodeId: sessionId,
      patch: { model: init.model || agent.view.model, currentCwd: agent.view.cwd, permissionMode: agent.view.permissionMode, version: init.version, pid: agent.view.pid, liveness: 'alive' },
    });
    this.#commit(agent);
  }

  #onResult(agent: Agent, r: ResultFacts): void {
    this.#applyResult(agent, r);
    // Last, so a stop this triggers sees the turn as over and does not wait for a result that already came.
    this.#enforceTree(agent);
  }

  #applyResult(agent: Agent, r: ResultFacts): void {
    for (const uuid of r.uuids) agent.inFlight.delete(uuid);
    agent.lastResult = r;
    // total_cost_usd is restored on resume. After a hard kill it may restart from nothing, and then the floor is what was known.
    if (r.costUsd + 1e-9 < agent.costFloor + agent.costOffset) agent.costOffset = -agent.costFloor;
    const spentUsd = round(Math.max(agent.view.spentUsd, r.costUsd - agent.costOffset));
    agent.view = {
      ...agent.view, spentUsd, lastTerminalReason: r.terminalReason, lastTurnAborted: isAborted(r.terminalReason),
      failure: failureOf(r.terminalReason), subagentStats: r.subagentStats ?? agent.view.subagentStats,
    };
    this.#saveLoadout(agent);
    this.#costChanged(agent);

    const { state } = agent.view;
    if (state === 'stopping' || state === 'rate_limited') return this.#commit(agent);
    // A send with priority 'now' overtook this turn. Its own result is still to come.
    if (agent.inFlight.size > 0) return this.#commit(agent);
    if (r.terminalReason === 'budget_exhausted') {
      this.#set(agent, 'budget_exhausted');
      this.#refillIfRaised(agent);
      return;
    }
    if (r.terminalReason === 'tool_deferred') {
      this.#set(agent, 'parked');
      return;
    }
    this.#set(agent, 'idle');
    this.#drain(agent);
  }

  /** Loadout numbers come from a real spawn, and a spawn in an unknown repo measures nothing worth keeping (DESIGN 3.8). */
  #saveLoadout(agent: Agent): void {
    if (!agent.firstInit || !this.#trusted(agent)) return;
    const { skills, mcpServers } = agent.firstInit;
    agent.firstInit = null;
    this.#d.store.saveLoadout(agent.view.projectRoot, { skills, mcpServers, contextTokens: agent.view.contextTokens ?? 0, measuredAt: this.#now() });
  }

  #costChanged(agent: Agent): void {
    const tree = this.#tree.get(agent.view.rootAgentId);
    if (!tree || tree.budgetUsd === null) return;
    const spent = this.#treeSpent(tree.rootAgentId);
    for (const member of this.#agents.values()) {
      if (member.view.rootAgentId !== tree.rootAgentId || member.view.treeSpentUsd === spent) continue;
      member.view = { ...member.view, treeSpentUsd: spent };
      if (member !== agent) this.#commit(member);
    }
  }

  /** At 100 percent of a tree budget: refuse spawns and stop the tree (AC 6). */
  #enforceTree(agent: Agent): void {
    const tree = this.#tree.get(agent.view.rootAgentId);
    if (!tree || tree.budgetUsd === null || tree.stopped || this.#treeSpent(tree.rootAgentId) < tree.budgetUsd) return;
    tree.stopped = true;
    this.#ctx.log.info('control: tree budget spent, stopping the tree', { rootAgentId: tree.rootAgentId });
    for (const member of this.#agents.values()) {
      if (member.view.rootAgentId === tree.rootAgentId && LIVE.has(member.view.state)) void this.stop(member.view.agentId).catch(() => undefined);
    }
  }

  #onRateLimit(agent: Agent, info: RateLimitFacts): void {
    const previous = this.#ctx.bus.state().plan;
    const status: PlanState['status'] = info.status === 'allowed' || info.status === 'allowed_warning' || info.status === 'rejected' ? info.status : 'unknown';
    const left = (w: RateLimitFacts['fiveHour']): number | null | undefined => (typeof w?.utilization === 'number' ? clampPercent(1 - w.utilization) : undefined);
    const plan: PlanState = {
      fiveHourLeft: left(info.fiveHour) ?? previous?.fiveHourLeft ?? null,
      sevenDayLeft: left(info.sevenDay) ?? previous?.sevenDayLeft ?? null,
      asOf: this.#now(),
      resetsAt: {
        fiveHour: info.fiveHour?.resetsAt ?? previous?.resetsAt.fiveHour ?? null,
        sevenDay: info.sevenDay?.resetsAt ?? previous?.resetsAt.sevenDay ?? null,
      },
      status,
    };
    this.#ctx.bus.publish({ type: 'plan.changed', plan });
    if (status !== 'rejected') return;
    const until = info.resetsAt ?? this.#now() + 60_000;
    this.#rateLimitedUntil = Math.max(this.#rateLimitedUntil, until);
    if (agent.view.state === 'running' || agent.view.state === 'idle') this.#set(agent, 'rate_limited');
    if (this.#releaseTimer) clearTimeout(this.#releaseTimer);
    this.#releaseTimer = setTimeout(() => this.#releaseRateLimit(), Math.min(2 ** 31 - 1, Math.max(0, this.#rateLimitedUntil - this.#now())));
    this.#releaseTimer.unref();
    this.#publishAdmission();
  }

  #releaseRateLimit(): void {
    this.#releaseTimer = null;
    for (const agent of this.#agents.values()) {
      if (agent.view.state !== 'rate_limited') continue;
      this.#set(agent, 'idle');
      this.#drain(agent);
    }
    this.#pumpAdmission();
  }

  #onExit(agent: Agent, info: { clean: boolean; error: string | null }): void {
    const { agentId, pid, state } = agent.view;
    // The CLI exits 1 after an error result, and the SDK throws. That is not a crash (AC 7.5).
    const expected = info.clean || state === 'stopping' || agent.lastResult?.isError === true;
    agent.driver = null;
    agent.inFlight.clear();
    agent.queue = [];
    if (pid !== null) this.#d.registry.dropPid(agentId, pid);
    agent.frames.finish(info.clean ? 'clean' : expected ? 'unknown' : 'abandoned');
    if (agent.frames.unknownFrames > 0) this.#ctx.log.info('control: unknown frames', { agentId, count: agent.frames.unknownFrames });
    this.approvals.clearGrants(agentId);
    const patch: Partial<ManagedAgentView> = { pid: null, endedAt: this.#now(), stopStep: null, openApprovals: 0, resumable: false };
    if (!expected) patch.failure = `Process ended unexpectedly: ${String(info.error).slice(0, 160)}`;
    agent.swept = false;
    agent.turnCutOff = !expected && (state === 'running' || state === 'awaiting_approval');
    this.#set(agent, expected ? 'exited' : 'crashed', patch);
    agent.sweeping = this.#afterExit(agent, expected ? null : pid);
    agent.markExited?.();
    agent.markExited = null;
    this.#pumpAdmission();
  }

  /** A background shell can outlive its agent. Resume is offered only once nothing is left to run twice (AC 2.4). */
  async #afterExit(agent: Agent, crashedPid: number | null): Promise<void> {
    const { agentId, startedAt } = agent.view;
    const clear = async (): Promise<void> => {
      await this.trees.sweep(agentId);
      if (crashedPid !== null) await this.#sweepShells({ agentId, pid: crashedPid, procStart: agent.procStart, startedAt }, await this.#d.snapshot());
    };
    await clear().catch((e) => this.#ctx.log.warn('control: sweep failed', { error: String(e) }));
    agent.swept = true;
    if (agent.view.state === 'closed') return;
    agent.view = { ...agent.view, resumable: this.#canResume(agent) };
    this.#commit(agent);
  }

  #canResume(agent: Agent): boolean {
    if (!agent.launch.profile.persist) return false;
    const cwds = [agent.view.cwd, agent.launch.repoRoot, ...(agent.view.worktree ? [agent.view.worktree.path] : [])];
    return transcriptExists(this.#ctx.config.claudeHome, agent.view.sessionId!, cwds);
  }

  // Commands ---------------------------------------------------------------------------------------------------------

  #drain(agent: Agent): void {
    const { state } = agent.view;
    if (!agent.driver || (state !== 'ready' && state !== 'idle')) return;
    const next = agent.queue.shift();
    if (!next) return;
    this.#deliver(agent, next);
    this.#set(agent, 'running');
  }

  #deliver(agent: Agent, send: QueuedSend, priority?: 'now'): void {
    agent.inFlight.add(send.uuid);
    agent.view = { ...agent.view, turn: agent.view.turn + 1, lastTurnAborted: false, failure: null };
    const origin: TurnOrigin = send.origin.kind === 'peer' ? 'peer' : send.origin.kind === 'human' ? 'human' : 'sdk';
    agent.frames.beginTurn(origin);
    agent.driver!.send({ uuid: send.uuid, text: send.text, origin: send.origin, composed: send.composed, ...(priority ? { priority } : {}) });
  }

  /** Prompts go through the SDK's input stream. Nothing is ever interpolated into a command line. */
  send(agentId: AgentId, text: string, priority: 'queue' | 'now', by: Requester): { sendId: string } {
    const agent = this.#must(agentId);
    if (typeof text !== 'string' || text === '') throw new CommandError('bad-request', 'Nothing to send.');
    this.#reach(agent, by);
    const { state } = agent.view;
    if (state === 'budget_exhausted') throw new CommandError('limit', 'The budget is spent. Add budget to go on.');
    if (state === 'parked') throw new CommandError('conflict', 'This craft is parked. Resume it with an answer.');
    if (state === 'stopping' || !(LIVE.has(state) || state === 'queued')) throw new CommandError('conflict', 'This craft is not running. Resume it first.');
    const send: QueuedSend = { uuid: randomUUID(), text, ...this.#originOf(by) };
    if (priority === 'now' && agent.driver && (state === 'running' || state === 'awaiting_approval')) {
      // Aborts the turn at once and cancels any open approval. The aborted turn is not retried (AC 2.1).
      this.#deliver(agent, send, 'now');
      this.#commit(agent);
      return { sendId: send.uuid };
    }
    if (priority === 'now') agent.queue.unshift(send);
    else agent.queue.push(send);
    this.#commit(agent);
    this.#drain(agent);
    return { sendId: send.uuid };
  }

  /** MCP callers reach what they started and nothing else. They hold a token, not an identity. */
  #reach(agent: Agent, by: Requester): void {
    if (by.kind === 'mcp' && !agent.launch.external) throw new CommandError('forbidden', 'This craft was not started through MCP.');
  }

  stop(agentId: AgentId, by: Requester = { kind: 'ui' }): Promise<'graceful' | 'forced' | 'already-stopped'> {
    const agent = this.#must(agentId);
    this.#reach(agent, by);
    if (agent.stopping) return agent.stopping;
    const { state } = agent.view;
    if (state === 'queued') {
      this.#pad = this.#pad.filter((p) => p.agent !== agent);
      agent.queue = [];
      this.#set(agent, 'exited', { endedAt: this.#now() });
      return Promise.resolve('graceful');
    }
    if (!LIVE.has(state)) return Promise.resolve('already-stopped');
    const stopping = this.#stopNow(agent).finally(() => { agent.stopping = null; });
    agent.stopping = stopping;
    return stopping;
  }

  async #stopNow(agent: Agent): Promise<'graceful' | 'forced'> {
    const busy = agent.view.state === 'running' || agent.view.state === 'awaiting_approval';
    agent.queue = [];
    this.#set(agent, 'stopping', { stopStep: null });
    // An orchestrator's children have nobody left to report to.
    const children = [...this.#agents.values()].filter((a) => a.view.parentAgentId === agent.view.agentId);
    await Promise.all(children.map((c) => this.stop(c.view.agentId).catch(() => undefined)));
    const driver = agent.driver;
    if (!driver) {
      // Still creating its worktree. #launch sees `stopping` and ends there.
      await agent.exited;
      return 'graceful';
    }
    const result = await driver.stop({
      busy,
      onStep: (stopStep) => {
        agent.view = { ...agent.view, stopStep };
        this.#commit(agent);
      },
    });
    const exited = agent.exited;
    if (exited) await Promise.race([exited, new Promise((r) => setTimeout(r, STOP_EXIT_MS))]);
    await agent.sweeping;
    return result;
  }

  async stopAll(): Promise<{ stopped: number; outOfReach: number }> {
    const owned = [...this.#agents.values()].filter((a) => LIVE.has(a.view.state) || a.view.state === 'queued');
    await Promise.all(owned.map((a) => this.stop(a.view.agentId).catch(() => undefined)));
    const outOfReach = Object.values(this.#ctx.bus.state().sessions).filter((s) => s.origin === 'observer' && s.liveness === 'alive').length;
    return { stopped: owned.length, outOfReach };
  }

  async addBudget(agentId: AgentId, addUsd: number): Promise<{ budgetUsd: number }> {
    if (!(addUsd > 0)) throw new CommandError('bad-request', 'Add a positive amount.');
    const agent = this.#must(agentId);
    const budgetUsd = round(agent.view.budgetUsd + addUsd);
    const tree = this.#tree.get(agentId);
    if (tree && tree.budgetUsd !== null) {
      tree.budgetUsd = round(tree.budgetUsd + addUsd);
      tree.stopped = false;
      this.#d.store.saveTree(tree);
      agent.view = { ...agent.view, treeBudgetUsd: tree.budgetUsd };
    }
    agent.view = { ...agent.view, budgetUsd };
    this.#commit(agent);
    this.#refillIfRaised(agent);
    return { budgetUsd };
  }

  /** The cap sits on the process's command line, so a raised budget only takes effect in a new process (AC 2.10). */
  #refillIfRaised(agent: Agent): void {
    if (agent.view.state !== 'budget_exhausted' || this.#remaining(agent) < MIN_CHILD_BUDGET_USD) return;
    void this.resume(agent.view.agentId).catch((e) => this.#ctx.log.warn('control: refill failed', { error: String(e) }));
  }

  async resume(agentId: AgentId, prompt?: string, addUsd?: number): Promise<{ agentId: AgentId }> {
    const agent = this.#must(agentId);
    const held = agent.queue;
    if (agent.view.state === 'budget_exhausted' || agent.view.state === 'parked') await this.stop(agentId);
    await agent.sweeping;
    const { state } = agent.view;
    if (state !== 'exited' && state !== 'crashed' && state !== 'lost') throw new CommandError('conflict', 'This craft is still running.');
    if (!agent.swept) throw new CommandError('conflict', 'The orphan sweep is still running.');
    agent.view = { ...agent.view, resumable: agent.view.resumable || this.#canResume(agent) };
    if (!agent.view.resumable) throw new CommandError('conflict', 'This craft has no transcript to resume.');
    if (addUsd !== undefined) {
      if (!(addUsd > 0)) throw new CommandError('bad-request', 'Add a positive amount.');
      agent.view = { ...agent.view, budgetUsd: round(agent.view.budgetUsd + addUsd) };
    }
    if (this.#remaining(agent) < MIN_CHILD_BUDGET_USD) throw new CommandError('limit', 'The budget is spent. Add budget to resume.');
    const block = this.admissionBlock();
    if (block) throw new CommandError('limit', block);

    agent.queue = held;
    if (prompt) agent.queue.unshift({ uuid: randomUUID(), text: prompt, origin: { kind: 'human' }, composed: false });
    const interrupted = !prompt && agent.turnCutOff;
    agent.lastResult = null;
    agent.view = { ...agent.view, failure: null, stopStep: null, openApprovals: 0 };
    await this.#launch(agent, { resume: agent.view.sessionId!, ...(interrupted ? { interrupted: true } : {}) });
    return { agentId };
  }

  async fork(agentId: AgentId): Promise<SpawnReceipt> {
    const source = this.#must(agentId);
    if (!source.launch.profile.persist) throw new CommandError('conflict', 'This craft keeps no transcript to fork.');
    if (!source.driver && !this.#canResume(source)) throw new CommandError('conflict', 'This craft has no transcript to fork.');
    const block = this.admissionBlock();
    if (block) this.#refuse('admission', block, null, source.view.worldId);

    const forkId = `n${shortId()}`;
    const sessionId = randomUUID();
    const view: ManagedAgentView = {
      ...source.view, agentId: forkId, sessionId, nodeId: sessionId, parentAgentId: null, rootAgentId: forkId, depth: 0, missionId: null,
      title: `${source.view.title} fork`, state: 'queued', stopStep: null, openApprovals: 0, failure: null, spentUsd: 0,
      treeBudgetUsd: null, treeSpentUsd: null, turn: 0, toolCalls: 0, toolErrors: 0, queuedSends: 0, lastTerminalReason: null, lastTurnAborted: false,
      ttftMs: null, subagentStats: null, worktree: null, pid: null, createdAt: this.#now(), startedAt: null, endedAt: null, resumable: false,
      cwd: source.view.worktree ? source.launch.repoRoot : source.view.cwd,
    };
    const fork = this.#agent(view, source.launch);
    // A fork's total_cost_usd starts from the source's, so without this the same dollars would count in two rows.
    fork.costOffset = source.view.spentUsd + source.costOffset;
    if (source.view.worktree) fork.worktreeBase = source.view.worktree.branch;
    this.#tree.set(forkId, { rootAgentId: forkId, budgetUsd: null, depth: this.#limits.depth, childLimit: this.#limits.childrenPerAgent, missionId: null, external: source.launch.external ? 1 : 0, spawns: [], stopped: false });
    this.#d.store.saveTree(this.#tree.get(forkId)!);
    this.#agents.set(forkId, fork);
    this.#d.registry.register(forkId, { sessionId, title: managedTitle(forkId) });
    this.#commit(fork);
    void this.#launch(fork, { resume: source.view.sessionId!, fork: true });
    return { agentIds: [forkId], queued: 0 };
  }

  async close(agentId: AgentId): Promise<{ closed: boolean }> {
    const agent = this.#must(agentId);
    if (agent.view.state === 'closed') return { closed: true };
    if (LIVE.has(agent.view.state) || agent.view.state === 'queued') await this.stop(agentId);
    let failure: string | null = agent.view.failure;
    const wt = agent.view.worktree;
    if (wt) {
      const removed = await removeWorktree(agent.launch.repoRoot, wt).catch((e) => ({ removed: false, branchRemoved: false, kept: String((e as Error).message).slice(0, 120) }));
      if (removed.kept) failure = `Worktree kept: ${removed.kept}`;
    }
    return { closed: this.#set(agent, 'closed', { failure, resumable: false, endedAt: agent.view.endedAt ?? this.#now() }) };
  }

  status(agentId: AgentId, by: Requester = { kind: 'ui' }): ManagedAgentView {
    const agent = this.#must(agentId);
    this.#reach(agent, by);
    return agent.view;
  }

  #settled(agent: Agent): boolean {
    return !WORKING.has(agent.view.state) && agent.queue.length === 0 && agent.inFlight.size === 0;
  }

  /** Bounded, because a long tool call can be moved to the background (AC 12.2). */
  async wait(agentId: AgentId, timeoutS: number, by: Requester = { kind: 'ui' }, signal?: AbortSignal): Promise<{ agent: ManagedAgentView; result: string | null; done: boolean }> {
    const agent = this.#must(agentId);
    this.#reach(agent, by);
    const deadline = this.#now() + Math.min(Math.max(0, timeoutS), WAIT_MAX_S) * 1000;
    while (!this.#settled(agent) && !signal?.aborted) {
      const left = deadline - this.#now();
      if (left <= 0) break;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        agent.waiters.add(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    return { agent: agent.view, result: agent.lastResult?.text ?? null, done: this.#settled(agent) };
  }

  list(scope: 'all' | 'tree' | 'children', of: AgentId | undefined, by: Requester = { kind: 'ui' }): ManagedAgentView[] {
    const all = [...this.#agents.values()].filter((a) => by.kind !== 'mcp' || a.launch.external).map((a) => a.view);
    if (scope === 'all' || !of) return all;
    const anchor = this.#must(of);
    return scope === 'children' ? all.filter((v) => v.parentAgentId === of) : all.filter((v) => v.rootAgentId === anchor.view.rootAgentId);
  }

  answer(requestId: string, decision: ApprovalDecision, clientId: string): { applied: boolean } {
    return this.approvals.answer(requestId, decision, clientId);
  }

  /** The contract has the state and no command yet. Launches wait while it holds. */
  freeze(frozen: boolean): void {
    this.#operatorFrozen = frozen;
    this.#publishAdmission();
  }

  // Tools of the os server. Identity comes from the closure, never from arguments (AC 12.1) ---------------------------

  #link(kind: 'spawn' | 'send' | 'wait' | 'status' | 'stop', from: Agent, to: Agent | null): void {
    this.#ctx.bus.publish({ type: 'link.fired', kind, from: from.view.nodeId, to: to?.view.nodeId ?? null });
  }

  #inTree(callerId: AgentId, targetId: AgentId): { caller: Agent; target: Agent } {
    const caller = this.#must(callerId);
    const target = this.#agents.get(targetId);
    if (!target || target.view.rootAgentId !== caller.view.rootAgentId) throw new CommandError('forbidden', 'That agent is not in your tree.');
    return { caller, target };
  }

  async spawnChild(callerId: AgentId, input: OsSpawnInput): Promise<{ agent_id: AgentId; status: AgentState }> {
    const caller = this.#must(callerId);
    const place: Pick<SpawnSpec, 'cwd' | 'worldId'> = {};
    if (input.project) {
      const world = this.#ctx.worlds.get(input.project) ?? this.#ctx.worlds.find(input.project);
      if (!world) {
        this.#ctx.bus.publish({ type: 'spawn.refused', parentAgentId: callerId, worldId: null, limit: 'project' });
        throw new CommandError('limit', 'refused: that project is not a known world');
      }
      place.worldId = world.worldId;
    } else if (!caller.view.worktree) {
      place.cwd = caller.view.cwd;
    } else {
      place.cwd = caller.launch.repoRoot;
    }
    // Same role, same engine. Without this a child of a Haiku-launched lead would fall back to the profile's dearer model.
    const model = input.model ?? (input.profile ? undefined : caller.view.model);
    const effort = input.profile ? null : caller.view.effort;
    const receipt = await this.spawn({
      ...place, profile: input.profile ?? caller.view.profile, prompt: input.prompt,
      ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(input.budget_usd !== undefined ? { budgetUsd: input.budget_usd } : {}),
      ...(input.worktree !== undefined ? { worktree: input.worktree } : {}), ...(input.title ? { title: input.title } : {}),
      ...(input.idempotency_key ? { idempotencyKey: input.idempotency_key } : {}),
    }, { kind: 'agent', parentId: callerId });
    const child = this.#must(receipt.agentIds[0]!);
    this.#link('spawn', caller, child);
    return { agent_id: child.view.agentId, status: child.view.state };
  }

  statusFor(callerId: AgentId, targetId: AgentId): ManagedAgentView {
    const { caller, target } = this.#inTree(callerId, targetId);
    this.#link('status', caller, target);
    return target.view;
  }

  async waitFor(callerId: AgentId, targetId: AgentId, timeoutS: number, signal?: AbortSignal): Promise<{ agent: ManagedAgentView; result: string | null; done: boolean }> {
    const { caller, target } = this.#inTree(callerId, targetId);
    this.#link('wait', caller, target);
    return this.wait(targetId, timeoutS, { kind: 'ui' }, signal);
  }

  sendFrom(callerId: AgentId, targetId: AgentId, text: string, interrupt: boolean): { sendId: string } {
    const { caller, target } = this.#inTree(callerId, targetId);
    this.#link('send', caller, target);
    return this.send(targetId, text, interrupt ? 'now' : 'queue', { kind: 'agent', parentId: callerId });
  }

  async stopFrom(callerId: AgentId, targetId: AgentId): Promise<ManagedAgentView> {
    const { caller, target } = this.#inTree(callerId, targetId);
    if (target === caller) throw new CommandError('forbidden', 'An agent does not stop itself through this tool.');
    this.#link('stop', caller, target);
    await this.stop(targetId);
    return target.view;
  }

  listFor(callerId: AgentId, scope: 'children' | 'tree'): ManagedAgentView[] {
    return this.list(scope, this.#must(callerId).view.agentId);
  }
}
