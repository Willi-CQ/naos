// The default timeline: a pure function of its start time. Each craft has a lane written below in time order. t = 60 is the
// reference scene. Set pieces, in seconds: the Bend 19, tender launch 55, API 529 at 56, tender landing 58, serial next call
// 73.5, Salvo 76, Pad 80, spawns 84 and 90, plan window 90 and 120, compaction 95, danger 100, crash 110, refused spawn 118,
// AskUserQuestion 124, lost 134, budget out 136, ExitPlanMode 140, a stop 140, landing 144, Totality 150, workflow closes 160,
// Diamond ring 165, exit 172, no signal 169 to 176.
import { DEFAULT_LIMITS, emptyState, reduce, toolFamily } from '@naos/protocol';
import type {
  Activity, AdmissionState, AgentId, ApprovalDecision, ApprovalView, EpochMs, FleetState, HistoryDigest, ManagedAgentView, NaosEvent, NodeId,
  ObservedAgentNode, ObservedSession, ObservedWorkflow, ObservedWorkflowPhase, PlanState, Salvo, TokenUsage, ToolDenial, ToolFamily, TurnOrigin,
  World, WorldId,
} from '@naos/protocol';
import type { History } from './history.ts';
import {
  CRAFT, DURATION_S, FIXTURE_EPOCH, MODEL, PROFILES, WORLDS, cost, makeAgentNode, makeManaged, makeSession, makeWorld, usage,
} from './scene.ts';
import type { CraftDef } from './scene.ts';

export interface Step {
  /** Milliseconds from the start of the loop. */
  t: number;
  event: NaosEvent;
}

interface Segment {
  t: number;
  tps: number;
  block: 'thinking' | 'text' | null;
  /** Output tokens up to this segment. */
  tokens: number;
}

export interface Lane {
  nodeId: NodeId;
  worldId: WorldId;
  source: 'live' | 'derived';
  phase: number;
  segments: Segment[];
}

export interface Timeline {
  base: EpochMs;
  durationMs: number;
  /** What a replay starts from: the burned spokes of past fan-outs, which never happened on this timeline. */
  initial: FleetState;
  steps: Step[];
  lanes: Lane[];
}

export interface LaneRate {
  tps: number;
  block: 'thinking' | 'text' | null;
  outputTokens: number;
}

/** The rate of one lane at a time. Deterministic: a small wobble so plumes breathe, and no clock but `tMs`. */
export function rateAt(lane: Lane, tMs: number): LaneRate {
  let segment: Segment | undefined;
  for (const candidate of lane.segments) {
    if (candidate.t > tMs) break;
    segment = candidate;
  }
  if (!segment) return { tps: 0, block: null, outputTokens: 0 };
  const outputTokens = Math.round(segment.tokens + (segment.tps * (tMs - segment.t)) / 1000);
  const tps = segment.tps === 0 ? 0 : Math.round(segment.tps * (1 + 0.05 * Math.sin(tMs / 700 + lane.phase)));
  return { tps, block: segment.block, outputTokens };
}

/** Replays the steps up to `tMs` into a state. Nothing else decides what a seek shows. */
export function stateAt(timeline: Timeline, tMs: number): { state: FleetState; cursor: number } {
  let cursor = 0;
  while (cursor < timeline.steps.length && timeline.steps[cursor]!.t <= tMs) cursor += 1;
  const events = timeline.steps.slice(0, cursor).map((step) => step.event);
  const state = reduce({ ...timeline.initial, lastTickAt: timeline.base + tMs }, events);
  return { state, cursor };
}

type Body = NaosEvent extends infer E ? (E extends unknown ? Omit<E, 'id' | 'at' | 'observedAt'> : never) : never;

interface Craft {
  key: string;
  nodeId: NodeId;
  sessionId: string;
  worldId: WorldId;
  owned: boolean;
  lagS: number;
  main: boolean;
  root: string | null;
  tokens: TokenUsage;
  usd: number;
  contextTokens: number;
  agent: ManagedAgentView | null;
  session: ObservedSession | null;
}

interface ToolOptions {
  target?: string;
  shape?: string;
  plus?: number;
  minus?: number;
  isError?: boolean;
  decision?: 'accept' | 'reject';
  denial?: ToolDenial;
  /** A tool in the background: the craft keeps generating, so its activity does not move. */
  background?: boolean;
}

const BY = 'fixture-operator';

/** Views and worlds are folded in time order at the end, because a lane may write a late event before an earlier one. */
interface Fold {
  agents: Map<AgentId, ManagedAgentView>;
  worlds: Map<WorldId, World>;
}

type AgentPatch = Partial<ManagedAgentView> | ((view: ManagedAgentView) => Partial<ManagedAgentView> | null);
type Deferred = (fold: Fold) => Body | null;

class Script {
  readonly base: EpochMs;
  readonly steps: Array<{ t: number; order: number; body: Body | Deferred; lagS: number }> = [];
  readonly lanes = new Map<NodeId, Lane>();
  private order = 0;
  private uses = 0;
  private requests = 0;

  constructor(base: EpochMs) {
    this.base = base;
  }

  ms(t: number): EpochMs {
    return this.base + Math.round(t * 1000);
  }

  emit(t: number, body: Body | Deferred, lagS = 0): void {
    this.steps.push({ t: Math.round(t * 1000), order: this.order++, body, lagS });
  }

  private on(c: Craft): { nodeId: NodeId; sessionId: string } {
    return { nodeId: c.nodeId, sessionId: c.sessionId };
  }

  rate(t: number, c: Craft, tps: number, block: 'thinking' | 'text' | null = null): void {
    let lane = this.lanes.get(c.nodeId);
    if (!lane) {
      lane = { nodeId: c.nodeId, worldId: c.worldId, source: c.owned && c.main ? 'live' : 'derived', phase: this.lanes.size * 1.7, segments: [] };
      this.lanes.set(c.nodeId, lane);
    }
    const ms = Math.round(t * 1000);
    const last = lane.segments.at(-1);
    const tokens = last ? last.tokens + (last.tps * (ms - last.t)) / 1000 : 0;
    lane.segments.push({ t: ms, tps, block: c.owned ? block : null, tokens });
  }

  activity(t: number, c: Craft, activity: Activity): void {
    // Pid status reaches the kernel in well under a second, whatever the transcript's lag.
    this.emit(t, { type: 'activity.changed', activity, ...this.on(c) }, Math.min(c.lagS, 0.15));
  }

  gen(t: number, c: Craft, block: 'thinking' | 'text' | null, tps: number): void {
    this.emit(t, { type: 'request.started', model: c.session?.model ?? MODEL.haiku, querySource: null, ...this.on(c) }, Math.min(c.lagS, 0.4));
    this.activity(t, c, c.owned && block ? { state: 'generating', since: this.ms(t), lastBlock: block } : { state: 'generating', since: this.ms(t) });
    this.rate(t, c, tps, block);
    if (c.agent) this.manage(t, c, (view) => (view.state === 'running' || view.state === 'awaiting_approval' ? null : { state: 'running' }));
  }

  turn(t: number, c: Craft, origin: TurnOrigin): void {
    this.emit(t, { type: 'turn.started', origin, ...this.on(c) }, c.lagS);
  }

  /** One response reaches the record. Observed craft show it late, which is the whole point of `lag`. */
  reply(t: number, c: Craft, tokens: number, thinking = 0, lagS = c.lagS): void {
    const blocks: Array<'thinking' | 'text'> = thinking > 0 ? ['thinking', 'text'] : ['text'];
    const sizes = thinking > 0 ? [thinking, tokens * 4] : [tokens * 4];
    const added = usage({ input: 900, output: tokens + thinking, cacheRead: 24_000, messages: 1 });
    c.tokens = {
      ...c.tokens,
      input: c.tokens.input + added.input,
      output: c.tokens.output + added.output,
      cacheRead: c.tokens.cacheRead + added.cacheRead,
      messages: c.tokens.messages + 1,
    };
    c.usd = Math.round((c.usd + (tokens + thinking) * 0.000_03) * 1000) / 1000;
    c.contextTokens += tokens + thinking + 900;
    const model = c.session?.model ?? MODEL.sonnet;
    this.emit(t, { type: 'message.completed', messageId: `msg_${c.key}_${this.order}`, model, blocks, blockSizes: sizes, usage: added, ...this.on(c) }, lagS);
    this.emit(t, { type: 'usage.changed', usage: c.tokens, cost: cost(c.usd, c.tokens.partialOutputMessages > 0), ...this.on(c) }, lagS);
    if (c.main) this.emit(t, { type: 'session.changed', patch: { contextTokens: c.contextTokens }, ...this.on(c) }, lagS);
    if (c.agent) this.manage(t, c, { spentUsd: c.usd, contextTokens: c.contextTokens });
  }

  private summary(name: string, options: ToolOptions): { target: string | null; shape: string; plus?: number; minus?: number } {
    const target = options.target ?? null;
    const shape = options.shape ?? (target === null ? name : `${name}, 1 line, ${target.length} chars`);
    return { target, shape, ...(options.plus === undefined ? {} : { plus: options.plus }), ...(options.minus === undefined ? {} : { minus: options.minus }) };
  }

  private use(c: Craft, name: string): { toolUseId: string; family: ToolFamily } {
    return { toolUseId: `toolu_${c.key}_${this.uses++}`, family: toolFamily(name) };
  }

  private finished(t: number, c: Craft, name: string, id: string, family: ToolFamily, durationS: number, options: ToolOptions): void {
    this.emit(t, {
      type: 'tool.finished', toolUseId: id, name, toolFamily: family, isError: options.isError ?? false, decision: options.decision ?? null,
      denial: options.denial ?? null, durationMs: Math.round(durationS * 1000), ...this.on(c),
    }, c.lagS);
    if (c.agent) {
      this.manage(t, c, (view) => ({ toolCalls: view.toolCalls + 1, toolErrors: view.toolErrors + (options.isError ? 1 : 0) }));
    }
  }

  /** One call. Returns when it ended, so a lane reads as a sequence. */
  tool(t: number, c: Craft, name: string, durationS: number, options: ToolOptions = {}): number {
    const { toolUseId, family } = this.use(c, name);
    this.emit(t, { type: 'tool.started', toolUseId, name, toolFamily: family, summary: this.summary(name, options), ...this.on(c) }, c.lagS);
    if (!options.background) {
      this.activity(t, c, { state: 'tool_running', since: this.ms(t), tools: [{ toolUseId, name, family, startedAt: this.ms(t) }] });
      this.rate(t, c, 0);
    }
    this.finished(t + durationS, c, name, toolUseId, family, durationS, options);
    return t + durationS;
  }

  /** Parallel calls: one activity, one beam each, `SHELL +2`. */
  tools(t: number, c: Craft, names: string[], durationS: number): number {
    const open = names.map((name) => ({ name, ...this.use(c, name) }));
    for (const { name, toolUseId, family } of open) {
      this.emit(t, { type: 'tool.started', toolUseId, name, toolFamily: family, summary: this.summary(name, { target: 'src' }), ...this.on(c) }, c.lagS);
    }
    this.activity(t, c, {
      state: 'tool_running', since: this.ms(t),
      tools: open.map(({ name, toolUseId, family }) => ({ toolUseId, name, family, startedAt: this.ms(t) })),
    });
    this.rate(t, c, 0);
    for (const { name, toolUseId, family } of open) this.finished(t + durationS, c, name, toolUseId, family, durationS, {});
    return t + durationS;
  }

  denied(t: number, c: Craft, name: string, denial: ToolDenial): void {
    this.emit(t, { type: 'tool.denied', toolUseId: `toolu_${c.key}_${this.uses++}`, name, toolFamily: toolFamily(name), denial, ...this.on(c) }, c.lagS);
  }

  rest(t: number, c: Craft, backgroundShell = false): void {
    this.emit(t, { type: 'turn.ended', stopReason: 'end_turn', ...this.on(c) }, c.lagS);
    this.activity(t, c, { state: 'idle', since: this.ms(t), backgroundShell });
    this.rate(t, c, 0);
    if (c.agent) this.manage(t, c, { state: 'idle', lastTerminalReason: 'completed' });
  }

  wait(t: number, c: Craft, reason: Extract<Activity, { state: 'waiting' }>['reason']): void {
    this.activity(t, c, { state: 'waiting', since: this.ms(t), reason });
    this.rate(t, c, 0);
  }

  manage(t: number, c: Craft, patch: AgentPatch): void {
    if (!c.agent) throw new Error(`${c.key} is not owned`);
    const { agentId } = c.agent;
    this.emit(t, (fold) => {
      const view = fold.agents.get(agentId)!;
      const change = typeof patch === 'function' ? patch(view) : patch;
      if (!change) return null;
      const agent = { ...view, ...change };
      fold.agents.set(agentId, agent);
      return { type: 'managed.upserted', agent };
    });
  }

  ask(t: number, c: Craft, name: string, over: Partial<ApprovalView> = {}): ApprovalView {
    const agent = c.agent!;
    this.requests += 1;
    const approval: ApprovalView = {
      requestId: `req_fixture_${this.requests}`, agentId: agent.agentId, nodeId: c.nodeId, worldId: c.worldId, toolUseID: `toolu_ask_${this.requests}`,
      toolName: name, toolFamily: toolFamily(name), input: {}, displayName: null, description: null, title: null, blockedPath: null,
      decisionReason: null, danger: false, defaultToNo: false, canRememberForSession: true, canRememberForProject: true, subagentId: null,
      subagentType: null, mcpServer: null, callIndex: 1, callCount: 1, createdAt: this.ms(t), status: 'open', answeredAt: null, answeredBy: null,
      outcome: null, ...over,
    };
    this.emit(t, { type: 'approval.requested', approval });
    this.manage(t, c, (view) => ({ state: 'awaiting_approval', openApprovals: view.openApprovals + 1 }));
    this.wait(t, c, 'permission prompt');
    return approval;
  }

  answer(t: number, c: Craft, approval: ApprovalView, outcome: ApprovalDecision['kind']): void {
    this.emit(t, { type: 'approval.answered', requestId: approval.requestId, agentId: approval.agentId, outcome, by: BY });
    this.manage(t, c, (view) => ({ state: 'running', openApprovals: Math.max(0, view.openApprovals - 1) }));
  }

  digest(t: number, c: Craft, outcome: HistoryDigest['outcome'], startedAt: EpochMs): void {
    const row: HistoryDigest = {
      nodeId: c.nodeId, sessionId: c.sessionId, worldId: c.worldId, projectRoot: c.root, kind: c.main ? 'main' : 'subagent',
      parentNodeId: c.main ? null : c.sessionId, startedAt, endedAt: this.ms(t), model: c.session?.model ?? null, bytes: 900_000,
      usd: c.usd, blockedMs: 0, outcome,
    };
    this.emit(t, { type: 'history.digest', rows: [row] });
    const failed = outcome === 'failed' || outcome === 'abandoned';
    this.emit(t, (fold) => {
      const world = fold.worlds.get(c.worldId)!;
      const next = { ...world, lightsTotal: world.lightsTotal + 1, lightsFailed: world.lightsFailed + (failed ? 1 : 0), lastActiveAt: this.ms(t) };
      fold.worlds.set(c.worldId, next);
      return { type: 'world.upserted', world: next };
    });
  }

  ended(t: number, c: Craft, outcome: 'clean' | 'abandoned' | 'unknown'): void {
    this.emit(t, { type: 'session.ended', outcome, reason: 'exit', ...this.on(c) });
    this.rate(t, c, 0);
    this.digest(t, c, outcome === 'clean' ? 'clean' : outcome, this.ms(t) - 600_000);
  }

  agent(t: number, key: string, parent: Craft, kind: 'subagent' | 'workflow-agent', agentType: string, startedAt: EpochMs, workflow?: ObservedAgentNode['workflow'], lagS = 0): Craft {
    const node = makeAgentNode({
      key, parent: parent.session!, kind, agentType, name: null, model: MODEL.haiku, startedAt, linkedBy: kind === 'subagent' ? 'parentAgentId' : 'workflowRun',
      ...(workflow ? { workflow } : {}),
    });
    this.emit(t, { type: 'agent.started', node, nodeId: node.nodeId, sessionId: node.sessionId }, lagS);
    return {
      key, nodeId: node.nodeId, sessionId: node.sessionId, worldId: parent.worldId, owned: false, lagS, main: false, root: parent.root, tokens: usage(), usd: 0,
      contextTokens: 0, agent: null, session: null,
    };
  }

  agentEnded(t: number, c: Craft, status: 'completed' | 'failed' | 'stopped' | 'orphaned'): void {
    this.emit(t, { type: 'agent.ended', status, ...this.on(c) }, c.lagS);
    this.rate(t, c, 0);
    if (status === 'completed' || status === 'failed') this.digest(t, c, status === 'completed' ? 'clean' : 'failed', this.ms(t) - 30_000);
  }

  plan(t: number, plan: PlanState): void {
    this.emit(t, { type: 'plan.changed', plan });
  }

  admission(t: number, running: number, alive: number, over: Partial<AdmissionState> = {}): void {
    this.emit(t, {
      type: 'admission.changed',
      admission: {
        running, runningLimit: DEFAULT_LIMITS.runningGlobal, alive, aliveLimit: DEFAULT_LIMITS.aliveGlobal, frozen: null, queued: [], ...over,
      },
    });
  }
}

function mainCraft(s: Script, def: CraftDef, activity: Activity): Craft {
  const session = makeSession(def, s.base, activity);
  const agent = def.owned ? makeManaged(def, s.base) : null;
  s.emit(0, { type: 'session.discovered', session, nodeId: session.rootNodeId, sessionId: session.sessionId });
  if (agent) s.emit(0, { type: 'managed.upserted', agent });
  return {
    key: def.key, nodeId: session.rootNodeId, sessionId: session.sessionId, worldId: session.worldId, owned: def.owned, lagS: def.lagS ?? 0,
    main: true, root: session.projectRoot, tokens: session.usage, usd: def.usd, contextTokens: def.contextTokens, agent, session,
  };
}

/** A spawn by the book: pending node id, about 1.26 s in flight (AC 2.1), then orbit insertion. */
function spawned(s: Script, t: number, def: CraftDef, pad = 0): Craft {
  const session = makeSession({ ...def, ageS: 0 }, s.ms(t + pad + 1.26), { state: 'starting', since: s.ms(t + pad + 1.26) });
  const agentId = `ag_${def.key.replace('.', '')}`;
  const nodeId = `pending:${agentId}`;
  const agent: ManagedAgentView = {
    ...makeManaged({ ...def, ageS: 0 }, s.ms(t + pad + 1.26)), agentId, rootAgentId: agentId, sessionId: null, nodeId, state: pad > 0 ? 'queued' : 'spawning',
    createdAt: s.ms(t), startedAt: null, pid: null, turn: 0, toolCalls: 0, spentUsd: 0, contextTokens: null,
  };
  const craft: Craft = {
    key: def.key, nodeId: session.rootNodeId, sessionId: session.sessionId, worldId: session.worldId, owned: true, lagS: 0, main: true,
    root: session.projectRoot, tokens: usage(), usd: 0, contextTokens: 14_000, agent, session,
  };
  s.emit(t, { type: 'managed.upserted', agent });
  if (pad > 0) s.manage(t + pad, craft, { state: 'spawning' });
  const insertion = t + pad + 1.26;
  s.emit(insertion, { type: 'session.discovered', session, nodeId: session.rootNodeId, sessionId: session.sessionId });
  s.manage(insertion, craft, { state: 'ready', sessionId: session.sessionId, nodeId: session.rootNodeId, startedAt: s.ms(insertion), pid: session.pid });
  return craft;
}

interface Bead {
  id: string;
  phase: number;
  start: number;
  end: number;
  status: 'completed' | 'failed' | 'stopped';
  tps: number;
  attempt?: number;
}

const PHASES = ['survey', 'audit', 'report'];

/** Seven of twelve done at t = 60, with five running: the row `repo-audit, phase 2, 7 of 12`. */
const BEADS: Bead[] = [
  { id: 'b01', phase: 0, start: -42, end: 6, status: 'completed', tps: 90 },
  { id: 'b02', phase: 0, start: -41, end: 10, status: 'completed', tps: 80 },
  { id: 'b03', phase: 0, start: -39, end: 14, status: 'completed', tps: 75 },
  { id: 'b04', phase: 0, start: -37, end: 18, status: 'completed', tps: 95 },
  { id: 'b05', phase: 0, start: -30, end: 22, status: 'completed', tps: 70 },
  { id: 'b06', phase: 1, start: 8, end: 46, status: 'completed', tps: 110 },
  { id: 'b07', phase: 1, start: 12, end: 52, status: 'completed', tps: 105 },
  { id: 'b08', phase: 1, start: 16, end: 70, status: 'completed', tps: 130 },
  { id: 'b09', phase: 1, start: 20, end: 78, status: 'failed', tps: 120 },
  { id: 'b10', phase: 1, start: 24, end: 88, status: 'completed', tps: 125 },
  { id: 'b11', phase: 1, start: 28, end: 96, status: 'stopped', tps: 110 },
  { id: 'b12', phase: 1, start: 32, end: 104, status: 'completed', tps: 115 },
  { id: 'b09r', phase: 1, start: 79, end: 118, status: 'completed', tps: 120, attempt: 2 },
  { id: 'b13', phase: 2, start: 106, end: 132, status: 'completed', tps: 140 },
  { id: 'b14', phase: 2, start: 108, end: 152, status: 'completed', tps: 130 },
];

function workflow(s: Script, owner: Craft): void {
  const runId = 'wf_fixture-repo-audit';
  const startedAt = s.ms(-48);
  const started = new Map<string, Craft>();
  const boundaries = [...new Set(BEADS.flatMap((bead) => [Math.max(0, bead.start), bead.end]))].sort((a, b) => a - b);

  const snapshot = (t: number, finished: boolean): ObservedWorkflow => {
    const live = BEADS.filter((bead) => bead.start <= t);
    const done = (bead: Bead, status: Bead['status']): boolean => bead.end <= t && bead.status === status;
    const phases: ObservedWorkflowPhase[] = PHASES.flatMap((title, index) => {
      const beads = live.filter((bead) => bead.phase === index);
      if (beads.length === 0) return [];
      return [{
        index, title, agentNodeIds: beads.map((bead) => started.get(bead.id)!.nodeId),
        running: beads.filter((bead) => bead.end > t).length,
        completed: beads.filter((bead) => done(bead, 'completed')).length,
        failed: beads.filter((bead) => done(bead, 'failed')).length,
      }];
    });
    return {
      runId, sessionId: owner.sessionId, parentNodeId: owner.nodeId, parentToolUseId: 'toolu_workflow', taskId: 'task_fixture', name: 'repo-audit',
      status: finished ? 'completed' : 'running', statusSource: finished ? 'state-file' : 'journal+liveness',
      journalPath: '/fixture/workflows/repo-audit/journal.jsonl', statePath: finished ? '/fixture/workflows/repo-audit/state.json' : null, scriptPath: null,
      transcriptDir: '/fixture/workflows/repo-audit',
      phases,
      counts: {
        started: live.length, completed: live.filter((bead) => done(bead, 'completed')).length, failed: live.filter((bead) => done(bead, 'failed')).length,
        open: live.filter((bead) => bead.end > t).length, retried: live.filter((bead) => bead.attempt).length, cached: finished ? 2 : null,
      },
      startedAt, endedAt: finished ? s.ms(t) : null, durationMs: finished ? s.ms(t) - startedAt : null,
      totalTokens: finished ? 214_000 : null, totalToolCalls: finished ? 96 : null, cost: cost(finished ? 1.84 : 0.2 + live.length * 0.1),
    };
  };

  for (const t of boundaries) {
    for (const bead of BEADS.filter((row) => Math.max(0, row.start) === t)) {
      const flow = { runId, key: bead.id, label: `audit ${bead.id}`, phase: PHASES[bead.phase]!, attempt: bead.attempt ?? 1 };
      const craft = s.agent(t, `wf:${bead.id}`, owner, 'workflow-agent', 'workflow', s.ms(bead.start), flow, 6);
      started.set(bead.id, craft);
      s.gen(t, craft, null, bead.tps);
      s.reply(Math.min(t + 7, bead.end - 1), craft, 300 + bead.tps);
    }
    for (const bead of BEADS.filter((row) => row.end === t)) s.agentEnded(t, started.get(bead.id)!, bead.status);
    s.emit(t, { type: 'workflow.changed', workflow: snapshot(t, false), nodeId: owner.nodeId, sessionId: owner.sessionId });
  }

  // The newest flush from a running workflow agent: the reference's LAG MAX 11.6 s.
  s.reply(56, started.get('b08')!, 640, 0, 11.6);
  s.emit(160, { type: 'workflow.changed', workflow: snapshot(160, true), nodeId: owner.nodeId, sessionId: owner.sessionId });
}

const craftOf = (key: string): CraftDef => {
  const def = CRAFT.find((row) => row.key === key);
  if (!def) throw new Error(`no craft ${key}`);
  return def;
};

export function buildTimeline(history: History, base: EpochMs = FIXTURE_EPOCH): Timeline {
  const s = new Script(base);

  // Boot state. Slots, plan, profiles, then the fleet as a kernel would discover it.
  for (const def of WORLDS) s.emit(0, { type: 'world.upserted', world: makeWorld(def, history.mass[def.name]!, base) });
  s.emit(0, { type: 'profiles.changed', profiles: PROFILES });
  s.emit(0, { type: 'index.progress', progress: { stage: 'usage', done: 1320, total: 2177 } });
  s.emit(5, { type: 'index.progress', progress: { stage: 'done', done: 2177, total: 2177 } });
  s.plan(0, {
    fiveHourLeft: 0.58, sevenDayLeft: 0.82, asOf: base - 200_000, resetsAt: { fiveHour: base + 12_877_000, sevenDay: base + 345_600_000 }, status: 'allowed',
  });
  s.admission(0, 4, 9);

  const generating = (): Activity => ({ state: 'generating', since: base });
  const ka = mainCraft(s, craftOf('k.a'), generating());
  const kb = mainCraft(s, craftOf('k.b'), generating());
  const kc = mainCraft(s, craftOf('k.c'), generating());
  const kd = mainCraft(s, craftOf('k.d'), generating());
  const ta = mainCraft(s, craftOf('t.a'), generating());
  const tb = mainCraft(s, craftOf('t.b'), generating());
  const tc = mainCraft(s, craftOf('t.c'), { state: 'idle', since: s.ms(-660), backgroundShell: false });
  const ha = mainCraft(s, craftOf('h.a'), generating());
  const ma = mainCraft(s, craftOf('m.a'), generating());
  const mb = mainCraft(s, craftOf('m.b'), generating());
  const mc = mainCraft(s, craftOf('m.c'), generating());
  const la = mainCraft(s, craftOf('l.a'), generating());
  const lb = mainCraft(s, craftOf('l.b'), generating());
  mainCraft(s, craftOf('l.x'), { state: 'unknown', since: s.ms(-600) });

  workflow(s, ha);

  const standing = [{ agentId: ka.agent!.agentId, rule: 'Read', scope: 'session' as const, grantedAt: s.ms(40) }];

  // kestrel alpha: the Channel of the reference, then the Salvo.
  s.gen(0, ka, 'text', 388);
  s.reply(8, ka, 412);
  s.gen(s.tool(8, ka, 'Read', 0.2, { target: 'src/limiter.ts' }), ka, 'text', 388);
  s.gen(s.tool(14, ka, 'Grep', 0.4, { target: 'windowMs' }), ka, 'text', 388);
  s.emit(30, { type: 'session.changed', patch: { queuedInputs: 2 }, nodeId: ka.nodeId, sessionId: ka.sessionId });
  s.manage(30, ka, { queuedSends: 2 });
  s.emit(38, { type: 'session.changed', patch: { queuedInputs: 1 }, nodeId: ka.nodeId, sessionId: ka.sessionId });
  s.manage(38, ka, { queuedSends: 1, turn: 4 });
  s.turn(38, ka, 'human');
  s.emit(40, { type: 'standing.changed', agentId: ka.agent!.agentId, grants: standing });
  s.reply(41, ka, 210);
  s.gen(s.tool(43, ka, 'Read', 0.2, { target: 'timer.ts' }), ka, 'text', 388);
  s.emit(44, { type: 'session.changed', patch: { queuedInputs: 0 }, nodeId: ka.nodeId, sessionId: ka.sessionId });
  s.manage(44, ka, { queuedSends: 0, turn: 5 });
  s.turn(44, ka, 'human');
  s.gen(s.tool(46, ka, 'Edit', 1, { target: 'src/timer.ts', plus: 4, minus: 2, decision: 'accept' }), ka, 'text', 388);
  s.tool(48, ka, 'Bash', 16.4, { target: 'npm test -- limiter', background: true });
  s.tool(55, ka, 'Agent', 0.4, { target: 'Explore', background: true });
  const tender = s.agent(55, 'tender:k1', ka, 'subagent', 'Explore', s.ms(55));
  s.gen(55.2, tender, null, 70);
  s.tool(58, tender, 'Glob', 0.3, { target: '**/*.ts' });
  s.gen(58.4, tender, null, 70);
  s.reply(66, ka, 520);
  s.agentEnded(70, tender, 'completed');

  // The Salvo: three launches inside a second open it, two more join it, and it closes ten seconds after the last.
  const launched = ['s1', 's2', 's3', 's4', 's5'].map((name, index) => {
    const t = [76, 76.3, 76.6, 78, 80][index]!;
    s.tool(t, ka, 'Agent', 0.2, { target: 'Explore', background: true });
    const craft = s.agent(t, `salvo:${name}`, ka, 'subagent', 'Explore', s.ms(t));
    s.gen(t + 0.3, craft, null, 110 + index * 15);
    return craft;
  });
  const [s1, s2, s3, s4, s5] = launched as [Craft, Craft, Craft, Craft, Craft];
  const salvo: Salvo = {
    salvoId: 'salvo_fixture_1', parentNodeId: ka.nodeId, sessionId: ka.sessionId, worldId: ka.worldId, source: 'subagent', openedAt: s.ms(76.6),
    closedAt: null, nodeIds: [s1.nodeId, s2.nodeId, s3.nodeId],
  };
  s.emit(76.6, { type: 'salvo.opened', salvo });
  s.emit(78, { type: 'salvo.joined', salvoId: salvo.salvoId, nodeId: s4.nodeId });
  s.emit(80, { type: 'salvo.joined', salvoId: salvo.salvoId, nodeId: s5.nodeId });
  s.emit(90, { type: 'salvo.closed', salvoId: salvo.salvoId });
  s.activity(77, ka, { state: 'tool_running', since: s.ms(77), tools: [{ toolUseId: 'toolu_salvo', name: 'Agent', family: 'launch', startedAt: s.ms(77) }] });
  s.rate(77, ka, 0);
  s.gen(s.tool(82, s1, 'Read', 2, { target: 'src/index.ts' }), s1, null, 90);
  s.agentEnded(94, s1, 'completed');
  s.gen(s.tool(84, s2, 'WebFetch', 3, { target: 'https://example.com/spec' }), s2, null, 90);
  s.agentEnded(98, s2, 'completed');
  s.gen(s.tool(86, s3, 'mcp__docs__search', 2.5, { target: 'rate limit' }), s3, null, 80);
  s.agentEnded(101, s3, 'failed');
  s.gen(s.tool(88, s4, 'Bash', 4, { target: 'npm run lint' }), s4, null, 80);
  s.agentEnded(104, s4, 'completed');
  s.tool(92, s5, 'SendMessage', 0.5, { target: 'team-lead' });
  s.agentEnded(112, s5, 'orphaned');
  s.gen(84, ka, 'thinking', 260);
  s.reply(96, ka, 300, 2400);
  s.gen(96, ka, 'text', 388);
  s.reply(112, ka, 700);
  s.tool(112, ka, 'SendMessage', 0.6, { target: 'docs sweep' });
  s.emit(112.3, { type: 'link.fired', kind: 'send', from: ka.nodeId, to: kc.nodeId });
  s.gen(113, ka, 'text', 388);
  s.denied(116, ka, 'mcp__os__agent_spawn', { kind: 'limit', source: 'kernel' });
  s.emit(118, { type: 'spawn.refused', parentAgentId: ka.agent!.agentId, worldId: ka.worldId, limit: 'children per agent' });
  s.tool(122, ka, 'TodoWrite', 0.5, { shape: 'TodoWrite, 4 items' });
  s.gen(122.6, ka, 'text', 388);
  s.gen(s.tools(125, ka, ['Bash', 'Bash', 'Read'], 4), ka, 'text', 388);
  s.reply(149, ka, 880);

  // kestrel beta: every kind of decision. The reference's Bend opened at 19, so it reads 0:41 at t = 60.
  s.tool(0, kb, 'Bash', 9, { target: 'npx vitest run queue' });
  s.gen(9, kb, 'thinking', 240);
  s.reply(14, kb, 200, 1600);
  s.gen(14, kb, 'text', 180);
  s.reply(19, kb, 120);
  const first = s.ask(19, kb, 'Bash', {
    input: { command: 'npm install --save-dev vitest@4', description: 'Install the test runner' }, description: 'Install the test runner', callIndex: 1, callCount: 2,
  });
  s.answer(72, kb, first, 'approve');
  s.tool(72.2, kb, 'Bash', 1.2, { target: 'npm install --save-dev vitest@4', decision: 'accept' });
  const serial = s.ask(73.5, kb, 'Bash', { input: { command: 'npm test -- queue', description: 'Run the queue tests' }, description: 'Run the queue tests', callIndex: 2, callCount: 2 });
  s.answer(84, kb, serial, 'approve');
  s.gen(s.tool(84.2, kb, 'Bash', 3.4, { target: 'npm test -- queue', decision: 'accept' }), kb, 'text', 180);
  const danger = s.ask(100, kb, 'Bash', {
    input: { command: 'rm -rf ../shared/cache', description: 'Clear the shared cache' }, description: 'Clear the shared cache', blockedPath: '/fixture/shared/cache',
    decisionReason: 'Path is outside allowed working directories', danger: true, defaultToNo: true, canRememberForSession: false, canRememberForProject: false,
  });
  s.answer(116, kb, danger, 'deny');
  s.gen(116.2, kb, 'thinking', 220);
  const question = s.ask(124, kb, 'AskUserQuestion', {
    input: { questions: [{ question: 'Which backend should the queue use?', header: 'Backend', multiSelect: false, options: [
      { label: 'memory', description: 'Placeholder option one' }, { label: 'sqlite', description: 'Placeholder option two' }, { label: 'file', description: 'Placeholder option three' },
    ] }] },
  });
  s.answer(136, kb, question, 'answer');
  s.gen(136.2, kb, 'text', 180);
  const withdrawn = s.ask(145, kb, 'Write', {
    input: { file_path: 'src/queue.test.ts', content: 'placeholder\n' }, subagentId: 'fixture-sub', subagentType: 'Explore',
  });
  s.emit(150, { type: 'approval.cancelled', requestId: withdrawn.requestId, agentId: withdrawn.agentId, reason: 'turn ended' });
  s.manage(150, kb, { state: 'idle', openApprovals: 0 });
  s.rest(150.2, kb);
  s.gen(168, kb, 'text', 180);

  // kestrel gamma: thinking for 41 s at t = 60, then the plan decision.
  s.tool(0, kc, 'Glob', 0.5, { target: 'docs/**/*.md' });
  s.gen(0.6, kc, 'text', 240);
  s.reply(12, kc, 360);
  s.gen(s.tool(12, kc, 'Read', 3, { target: 'docs/guide.md' }), kc, 'text', 240);
  s.gen(19, kc, 'thinking', 300);
  s.reply(62, kc, 400, 12_300);
  s.gen(62, kc, 'text', 240);
  s.gen(s.tool(84, kc, 'WebSearch', 3, { target: 'placeholder query' }), kc, 'thinking', 280);
  s.turn(112.4, kc, 'peer');
  s.gen(130, kc, 'text', 240);
  const plan = s.ask(140, kc, 'ExitPlanMode', { input: { plan: '# Plan\n\n1. Placeholder step one\n2. Placeholder step two\n' } });
  s.answer(148, kc, plan, 'approve');
  s.gen(148.2, kc, 'text', 240);

  // kestrel delta: an edit at t = 60 with 0:06 on it, low context, then Reboost.
  s.gen(0, kd, 'text', 160);
  s.gen(s.tool(30, kd, 'Read', 1, { target: 'src/types.ts' }), kd, 'text', 160);
  s.reply(54, kd, 240);
  s.tool(54, kd, 'Edit', 12, { target: 'src/types.ts', plus: 31, minus: 18, decision: 'accept' });
  s.gen(66, kd, 'text', 160);
  s.activity(95, kd, { state: 'compacting', since: s.ms(95) });
  s.rate(95, kd, 0);
  s.emit(103, { type: 'compacted', trigger: 'auto', preTokens: 812_000, postTokens: 96_000, durationMs: 8000, nodeId: kd.nodeId, sessionId: kd.sessionId });
  kd.contextTokens = 96_000;
  s.manage(103, kd, { contextTokens: 96_000 });
  s.gen(103, kd, 'text', 160);
  s.gen(s.tool(125, kd, 'Edit', 1, { target: 'src/types.ts', isError: true }), kd, 'text', 160);
  s.gen(s.tool(128, kd, 'Edit', 0.5, { target: 'src/index.ts', decision: 'reject', denial: { kind: 'user', source: 'session' } }), kd, 'thinking', 180);

  // tundra: observed, read late.
  s.gen(0, ta, null, 120);
  s.reply(9, ta, 380);
  s.gen(s.tool(18, ta, 'Read', 2, { target: 'ledger/index.ts' }), ta, null, 120);
  s.reply(30, ta, 290);
  s.reply(39, ta, 412);
  s.gen(s.tool(42, ta, 'Grep', 1, { target: 'invoice' }), ta, null, 120);
  s.reply(55, ta, 340);
  s.gen(55.2, ta, null, 120);
  s.emit(74, { type: 'compacted', trigger: 'manual', preTokens: 304_000, postTokens: 41_000, durationMs: 6200, nodeId: ta.nodeId, sessionId: ta.sessionId }, 3);
  ta.contextTokens = 41_000;
  s.reply(80, ta, 510);
  s.emit(88, { type: 'tail.reset', path: '/fixture/transcripts/tundra-a.jsonl', reason: 'shrunk', nodeId: ta.nodeId, sessionId: ta.sessionId });
  s.emit(90, { type: 'sensor.changed', sensor: { unknownRecords: 3, unknownFields: 1, tailResets: 1, parseErrors: 0 } });
  s.reply(120, ta, 460);
  s.rest(143, ta);
  s.ended(144, ta, 'clean');

  s.gen(0, tb, null, 60);
  s.gen(s.tool(20, tb, 'Grep', 3, { target: 'parseInvoice' }), tb, null, 60);
  s.reply(47, tb, 310);
  s.tool(48, tb, 'Bash', 24, { target: 'rg --stats callers' });
  s.gen(72, tb, null, 60);
  s.activity(100, tb, { state: 'interrupted', since: s.ms(100) });
  s.rate(100, tb, 0);
  s.activity(104, tb, { state: 'idle', since: s.ms(104), backgroundShell: false });
  s.gen(110, tb, null, 60);
  s.emit(140, { type: 'api.error', httpStatus: 500, kind: 'api', nodeId: tb.nodeId, sessionId: tb.sessionId }, tb.lagS);
  s.activity(140, tb, { state: 'errored', since: s.ms(140), kind: 'api', httpStatus: 500 });
  s.rate(140, tb, 0);
  s.ended(160, tb, 'abandoned');

  s.activity(110, tc, { state: 'idle', since: s.ms(110), backgroundShell: true });
  s.gen(s.tool(132, tc, 'Read', 2, { target: 'CHANGELOG.md' }), tc, null, 40);
  s.emit(150, { type: 'api.error', httpStatus: 429, kind: 'rate_limit', nodeId: tc.nodeId, sessionId: tc.sessionId }, tc.lagS);
  s.activity(150, tc, { state: 'errored', since: s.ms(150), kind: 'rate_limit', httpStatus: 429, resetsAt: s.ms(165) });
  s.rate(150, tc, 0);
  s.activity(166, tc, { state: 'idle', since: s.ms(166), backgroundShell: false });
  s.activity(170, tc, { state: 'unknown', since: s.ms(170) });

  // harbor: the owner of the workflow, plus a tender that lands just before t = 60 and an owned craft that gets lost.
  const harborTender = s.agent(0, 'tender:h1', ha, 'subagent', 'Explore', s.ms(-20));
  s.gen(0, harborTender, null, 85);
  s.tool(30, harborTender, 'Read', 2, { target: 'invoices/schema.ts' });
  s.gen(32, harborTender, null, 85);
  s.agentEnded(58, harborTender, 'completed');
  s.gen(0, ha, 'text', 212);
  s.reply(25, ha, 640);
  s.gen(s.tool(25, ha, 'Edit', 2, { target: 'invoices/migrate.ts', plus: 12, minus: 3, decision: 'accept' }), ha, 'text', 212);
  s.reply(80, ha, 930);
  s.gen(s.tool(100, ha, 'mcp__os__agent_status', 2.4, { target: 'repo-audit' }), ha, 'text', 212);
  s.emit(100.2, { type: 'link.fired', kind: 'status', from: ha.nodeId, to: null });
  s.gen(s.tool(130, ha, 'Bash', 5, { target: 'npm run build' }), ha, 'text', 212);

  const hb = spawned(s, 90, { key: 'h.b', world: 'harbor', title: 'schema probe', owned: true, ageS: 0, model: MODEL.haiku, effort: 'low', profile: 'recon', budgetUsd: 0.5, usd: 0, contextTokens: 14_000, branch: 'main' });
  s.gen(91.7, hb, 'text', 90);
  const orphanAsk = s.ask(128, hb, 'mcp__docs__search', {
    input: { query: 'placeholder' }, mcpServer: { name: 'docs', source: 'project' }, displayName: 'Search docs', title: 'Search the docs server',
  });
  s.emit(134, { type: 'approval.expired', requestId: orphanAsk.requestId });
  s.manage(134, hb, { state: 'lost', openApprovals: 0 });
  s.rate(134, hb, 0);

  // A craft that waits on the Pad, spawns, parks and comes back.
  const ke = spawned(s, 80, { key: 'k.e', world: 'kestrel', title: 'retry budget', owned: true, ageS: 0, model: MODEL.sonnet, effort: 'medium', profile: 'build', budgetUsd: 1.5, usd: 0, contextTokens: 14_000, branch: 'naos/retry-budget' }, 4);
  s.gen(86, ke, 'thinking', 200);
  s.gen(100, ke, 'text', 170);
  s.manage(115, ke, { state: 'parked', lastTerminalReason: 'tool_deferred' });
  s.activity(115, ke, { state: 'idle', since: s.ms(115), backgroundShell: false });
  s.rate(115, ke, 0);
  s.gen(132, ke, 'text', 170);

  // Totality: the plan window hits zero. Owned craft stop on it, an observed one shows the error it hit at source.
  s.plan(90, { fiveHourLeft: 0.41, sevenDayLeft: 0.8, asOf: s.ms(88), resetsAt: { fiveHour: s.ms(165), sevenDay: base + 345_600_000 }, status: 'allowed' });
  s.plan(120, { fiveHourLeft: 0.18, sevenDayLeft: 0.78, asOf: s.ms(119), resetsAt: { fiveHour: s.ms(165), sevenDay: base + 345_600_000 }, status: 'allowed_warning' });
  s.plan(150, { fiveHourLeft: 0, sevenDayLeft: 0.76, asOf: s.ms(150), resetsAt: { fiveHour: s.ms(165), sevenDay: base + 345_600_000 }, status: 'rejected' });
  s.plan(165, { fiveHourLeft: 1, sevenDayLeft: 0.76, asOf: s.ms(165), resetsAt: { fiveHour: s.ms(18_165), sevenDay: base + 345_600_000 }, status: 'allowed' });
  for (const craft of [ka, kc, kd, ha, ke]) {
    s.emit(150, { type: 'rate_limit.hit', limit: 'five_hour', resetsAt: s.ms(165), nodeId: craft.nodeId, sessionId: craft.sessionId });
    s.manage(150, craft, { state: 'rate_limited' });
    s.activity(150, craft, { state: 'errored', since: s.ms(150), kind: 'rate_limit', httpStatus: 429, resetsAt: s.ms(165) });
    s.rate(150, craft, 0);
  }

  s.gen(165, ka, 'text', 388);
  s.gen(165.4, kd, 'text', 160);
  s.gen(165.2, kc, 'text', 240);
  s.rest(170, kc);
  s.gen(165.1, ha, 'text', 212);
  s.rest(168, ha);
  s.manage(172, ha, { state: 'exited', endedAt: s.ms(172), resumable: true, lastTerminalReason: 'completed' });
  s.ended(172, ha, 'clean');
  s.gen(165.6, ke, 'text', 170);
  s.rest(171, ke);
  s.rest(176, kd);

  // mosaic: the fault row, the retry row, and three ways to end.
  s.gen(0, ma, 'text', 140);
  s.reply(30, ma, 300);
  s.reply(58, ma, 260);
  s.reply(90, ma, 410);
  s.activity(122, ma, { state: 'interrupted', since: s.ms(122) });
  s.rate(122, ma, 0);
  s.manage(122, ma, { lastTurnAborted: true, lastTerminalReason: 'aborted_streaming' });
  s.activity(126, ma, { state: 'idle', since: s.ms(126), backgroundShell: false });
  s.manage(126, ma, { state: 'idle' });
  s.gen(128, ma, 'text', 140);
  s.manage(136, ma, { state: 'budget_exhausted', spentUsd: ma.agent!.budgetUsd, lastTerminalReason: 'budget_exhausted' });
  s.activity(136, ma, { state: 'idle', since: s.ms(136), backgroundShell: false });
  s.rate(136, ma, 0);
  s.manage(166, ma, { budgetUsd: 1.6 });
  s.gen(166.2, ma, 'text', 140);
  s.rest(174, ma);

  s.gen(0, mb, 'text', 110);
  s.reply(40, mb, 280);
  s.emit(56, { type: 'api.error', httpStatus: 529, kind: 'api', nodeId: mb.nodeId, sessionId: mb.sessionId });
  s.activity(56, mb, { state: 'errored', since: s.ms(56), kind: 'api', httpStatus: 529 });
  s.manage(56, mb, { state: 'idle', toolErrors: 1, lastTerminalReason: 'api_error', failure: 'API 529' });
  s.rate(56, mb, 0);
  s.manage(68, mb, { failure: null });
  s.gen(68, mb, 'text', 110);
  s.manage(110, mb, { state: 'crashed', failure: 'process exited with code 1', endedAt: s.ms(110) });
  s.activity(110, mb, { state: 'errored', since: s.ms(110), kind: 'unknown' });
  s.rate(110, mb, 0);

  s.gen(0, mc, 'text', 95);
  s.reply(35, mc, 180);
  for (const [t, attempt] of [[46, 1], [50, 2], [54, 3]] as const) {
    s.emit(t, { type: 'api.retry', attempt, maxRetries: 10, retryInMs: attempt === 3 ? 14_000 : 4000, nodeId: mc.nodeId, sessionId: mc.sessionId });
    s.activity(t, mc, { state: 'retrying', since: s.ms(t), attempt, maxRetries: 10, nextAttemptAt: s.ms(attempt === 3 ? 68 : t + 4) });
    s.rate(t, mc, 0);
  }
  s.gen(68, mc, 'text', 95);
  s.reply(120, mc, 340);
  s.manage(140, mc, { state: 'stopping', stopStep: 'interrupt' });
  s.activity(140, mc, { state: 'interrupted', since: s.ms(140) });
  s.rate(140, mc, 0);
  s.manage(140.9, mc, { stopStep: 'end of input' });
  s.manage(141.6, mc, { stopStep: 'tree kill' });
  s.manage(142, mc, { state: 'exited', stopStep: null, endedAt: s.ms(142), resumable: true, lastTerminalReason: 'aborted_streaming' });
  s.ended(142, mc, 'clean');

  // lumen: a wait at source that reads 0:12 at t = 60, every other wait reason, and a silence long enough for NO SIGNAL.
  s.gen(0, la, null, 55);
  s.reply(26, la, 210);
  s.wait(48, la, 'permission prompt');
  s.gen(85, la, null, 55);
  s.wait(100, la, 'input needed');
  s.gen(108, la, null, 55);
  s.wait(112, la, 'sandbox request');
  s.gen(118, la, null, 55);
  s.wait(120, la, 'worker request');
  s.gen(126, la, null, 55);
  s.wait(130, la, 'dialog open');
  s.rest(136, la);

  s.gen(0, lb, null, 65);
  s.reply(48, lb, 190);
  s.gen(49, lb, null, 65);
  s.reply(176, lb, 830);
  s.rest(177, lb);

  const lc = mainCraft2(s, 100, { key: 'l.c', world: 'lumen', title: 'cache notes', owned: false, ageS: 0, model: MODEL.haiku, usd: 0, contextTokens: 12_000, branch: 'main', lagS: 0.9 });
  s.gen(102, lc, null, 75);
  s.reply(124, lc, 260);
  s.rest(137, lc);
  s.ended(138, lc, 'clean');

  // Admission moves on its own table, so the bar reads OWNED 4 of 6 running and owned 9 of 16 alive at t = 60.
  const pad = [ke.agent!.agentId];
  s.admission(80, 4, 9, { queued: pad });
  s.admission(84, 4, 10);
  s.admission(90, 5, 11);
  s.admission(110, 4, 10);
  s.admission(115, 3, 10);
  s.admission(134, 3, 9);
  s.admission(142, 3, 8);
  s.admission(150, 0, 8, { frozen: 'plan-window' });
  s.admission(165, 4, 8);
  s.admission(172, 3, 7);

  const ordered = s.steps.slice().sort((a, b) => a.t - b.t || a.order - b.order);
  const loop = Math.round((base - FIXTURE_EPOCH) / (DURATION_S * 1000));
  const fold: Fold = { agents: new Map(), worlds: new Map() };
  const steps: Step[] = [];
  for (const { t, body, lagS } of ordered) {
    const resolved = typeof body === 'function' ? body(fold) : body;
    if (!resolved) continue;
    if (resolved.type === 'managed.upserted') fold.agents.set(resolved.agent.agentId, resolved.agent);
    if (resolved.type === 'world.upserted') fold.worlds.set(resolved.world.worldId, resolved.world);
    steps.push({
      t,
      event: { ...resolved, id: `fx${loop}-${steps.length}`, at: base + t - Math.round(lagS * 1000), observedAt: base + t } as NaosEvent,
    });
  }
  const salvos = Object.fromEntries(history.salvos.slice(-6).map((salvo) => [salvo.salvoId, salvo]));
  return { base, durationMs: DURATION_S * 1000, initial: { ...emptyState(), salvos }, steps, lanes: [...s.lanes.values()] };
}

/** The screen of naos-idle.png: every world, the plan, and nothing in flight. The away list has two craft to resume. */
export function buildIdleTimeline(history: History, base: EpochMs = FIXTURE_EPOCH): Timeline {
  const steps: Step[] = [];
  const push = (body: Body): void => {
    steps.push({ t: 0, event: { ...body, id: `idle-${steps.length}`, at: base, observedAt: base } as NaosEvent });
  };
  for (const def of WORLDS) push({ type: 'world.upserted', world: makeWorld(def, history.mass[def.name]!, base) });
  push({ type: 'profiles.changed', profiles: PROFILES });
  push({ type: 'index.progress', progress: { stage: 'done', done: 2177, total: 2177 } });
  push({
    type: 'plan.changed',
    plan: { fiveHourLeft: 0.88, sevenDayLeft: 0.71, asOf: base - 200_000, resetsAt: { fiveHour: base + 12_877_000, sevenDay: base + 345_600_000 }, status: 'allowed' },
  });
  for (const [key, hours] of [['k.b', 11.8], ['h.a', 12.4]] as const) {
    const def = CRAFT.find((craft) => craft.key === key)!;
    const agent = makeManaged(def, base - hours * 3_600_000);
    push({ type: 'managed.upserted', agent: { ...agent, state: 'exited', endedAt: base - hours * 3_600_000, resumable: true } });
  }
  const salvos = Object.fromEntries(history.salvos.slice(-6).map((salvo) => [salvo.salvoId, salvo]));
  return { base, durationMs: DURATION_S * 1000, initial: { ...emptyState(), salvos }, steps, lanes: [] };
}

/** An observed session that appears mid-run: first light at its orbit. */
function mainCraft2(s: Script, t: number, def: CraftDef): Craft {
  const session = makeSession(def, s.ms(t), { state: 'starting', since: s.ms(t) });
  s.emit(t, { type: 'session.discovered', session, nodeId: session.rootNodeId, sessionId: session.sessionId });
  return {
    key: def.key, nodeId: session.rootNodeId, sessionId: session.sessionId, worldId: session.worldId, owned: false, lagS: def.lagS ?? 0, main: true,
    root: session.projectRoot, tokens: session.usage, usd: 0, contextTokens: def.contextTokens, agent: null, session,
  };
}

