// The one reducer. The kernel runs it to answer snapshots and the UI store runs the same code, so it is pure and does no
// I/O. Copy on write per batch: a touched map or entity is copied once per call, anything untouched keeps its identity,
// so a selector can compare by reference and a batch costs what it touches, not the size of the fleet.
import type { AgentState, ApprovalDecision, ApprovalStatus, ManagedAgentView } from './control.ts';
import type { NaosEvent, TapeEntry, TapeKind } from './fleet.ts';
import type {
  Activity, AgentStatus, EpochMs, NodeId, ObservedAgentNode, ObservedSession, RequestId, SessionId, ToolDenial,
} from './observed.ts';
import { makeNodeId } from './observed.ts';
import type { FleetState } from './state.ts';
import { SALVO_LIMIT, SETTLED_APPROVAL_LIMIT, TAPE_LIMIT } from './state.ts';

/** A boot discovers old sessions too. Only a start this recent reads as a launch. Workflow agents can lag by 46 s (RF 5.2). */
const LAUNCH_FRESH_MS = 120_000;

/** Fields a session and its main node both hold. A session patch keeps the node in step. */
const MAIN_FIELDS = [
  'activity', 'model', 'effort', 'startedAt', 'lastRecordAt', 'endedAt', 'usage', 'cost', 'transcriptPath', 'transcriptBytes',
] as const;

/** Owned craft land and fault through their control state, which outranks the session events behind it. */
const MANAGED_TAPE: Partial<Record<AgentState, TapeKind>> = {
  spawning: 'launch', stopping: 'stop', exited: 'land', crashed: 'fault', lost: 'fault', budget_exhausted: 'limit',
  rate_limited: 'limit',
};

type MapKey = 'worlds' | 'sessions' | 'nodes' | 'workflows' | 'managed' | 'approvals' | 'standing' | 'salvos' | 'acked';
// `acked` holds plain numbers, so it is written through `map()`, never through `put()`.
type Entity<K extends MapKey> = NonNullable<FleetState[K][string]>;

/** Own keys only, so an id such as `constructor` reads as unknown. */
const read = <T>(map: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.hasOwn(map, key) ? map[key] : undefined;

const differs = (base: Record<string, unknown>, patch: Record<string, unknown>): boolean => {
  for (const key in patch) {
    if (patch[key] !== undefined && !Object.is(base[key], patch[key])) return true;
  }
  return false;
};

/** undefined never overwrites, or a kernel value and its JSON on the wire would reduce differently. */
const defined = <T extends object>(patch: T): T =>
  Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as T;

const union = <T>(a: readonly T[], b: readonly T[]): T[] => [...new Set([...a, ...b])];

class Draft {
  readonly next: FleetState;
  readonly recount = new Set<SessionId>();
  pruneSalvos = false;
  pruneApprovals = false;
  private readonly fresh = new Set<object>();
  private rows: TapeEntry[] | null = null;

  constructor(state: FleetState) {
    this.next = { ...state };
  }

  /** A copy this call may write to. Events are never written to, because subscribers hold them too. */
  private own<T extends object>(value: T): T {
    if (this.fresh.has(value)) return value;
    const copy = (Array.isArray(value) ? value.slice() : { ...value }) as T;
    this.fresh.add(copy);
    return copy;
  }

  map<K extends MapKey>(key: K): FleetState[K] {
    return (this.next[key] = this.own(this.next[key]));
  }

  /**
   * Merges over one entity. An equal patch copies nothing, so a repeat keeps the reference. Within a batch the entity may
   * already be this call's own copy and change in place, so read any old value you need before calling this.
   */
  put<K extends MapKey>(key: K, id: string, patch: Partial<Entity<K>>): void {
    const current = read(this.next[key] as unknown as Record<string, Record<string, unknown>>, id);
    const changes = patch as Record<string, unknown>;
    if (!current || !differs(current, changes)) return;
    const entity = this.own(current);
    for (const field in changes) if (changes[field] !== undefined) entity[field] = changes[field];
    (this.map(key) as Record<string, object>)[id] = entity;
  }

  /** Replaces one entity. The object stays read only from here on, and a later `put` copies it. */
  set<K extends MapKey>(key: K, id: string, entity: Entity<K>): void {
    (this.map(key) as Record<string, unknown>)[id] = entity;
  }

  tape(e: NaosEvent, kind: TapeKind, nodeId: NodeId | null, worldId: string | null, detail: string | null, note: string | null = null): void {
    (this.rows ??= []).push({ id: e.id, at: e.at, kind, nodeId, worldId, detail, note });
  }

  /** Bounds and counts run once here, so a large batch stays linear. */
  finish(): void {
    if (this.recount.size > 0) recount(this);
    if (this.pruneSalvos) pruneSalvos(this);
    if (this.pruneApprovals) pruneApprovals(this);
    if (this.rows) {
      const rows = this.rows.slice(-TAPE_LIMIT);
      const tape = this.next.tape;
      this.next.tape = tape.slice(Math.max(0, tape.length + rows.length - TAPE_LIMIT)).concat(rows);
    }
  }
}

/**
 * Folds events into a new state. `seq` is the number of the last event, as in the `events` frame. Without it the state
 * counts the batch. Unknown event types change nothing but `seq`, so a newer kernel never reads as a gap to an older client.
 */
export function reduce(state: FleetState, events: readonly NaosEvent[], seq?: number): FleetState {
  const lastSeq = seq ?? state.seq + events.length;
  if (events.length === 0 && lastSeq === state.seq) return state;
  const d = new Draft(state);
  for (const e of events) apply(d, e);
  d.finish();
  d.next.seq = lastSeq;
  return d.next;
}

function apply(d: Draft, e: NaosEvent): void {
  switch (e.type) {
    case 'session.discovered': return sessionDiscovered(d, e);
    case 'session.changed': return sessionChanged(d, e);
    case 'session.ended': return sessionEnded(d, e);
    case 'activity.changed': return activityChanged(d, e);
    case 'agent.started': return agentStarted(d, e);
    case 'agent.changed': return agentChanged(d, e);
    case 'agent.ended': return agentEnded(d, e);

    case 'turn.started':
    case 'request.started':
      touch(d, e);
      return;
    case 'turn.ended': {
      const node = touch(d, e);
      if (node) d.tape(e, 'stop', node.nodeId, worldOf(d, node), e.stopReason);
      return;
    }
    case 'message.completed': {
      const node = touch(d, e, { model: e.model });
      if (!node) return;
      if (isMain(d, node)) d.put('sessions', node.sessionId, { model: e.model });
      d.tape(e, 'response', node.nodeId, worldOf(d, node), e.blocks.join(' '));
      return;
    }
    case 'tool.started': {
      const node = read(d.next.nodes, e.nodeId);
      if (!node) return;
      touch(d, e, { toolCalls: node.toolCalls + 1, lastToolName: e.name });
      d.tape(e, e.toolFamily === 'edit' ? 'write' : 'tool', node.nodeId, worldOf(d, node), e.name);
      return;
    }
    case 'tool.finished': {
      const node = read(d.next.nodes, e.nodeId);
      if (!node) return;
      touch(d, e, e.isError ? { errors: node.errors + 1 } : {});
      if (e.decision === 'reject') d.tape(e, 'denied', node.nodeId, worldOf(d, node), e.name, denialNote(e.denial));
      else if (e.isError) d.tape(e, 'spark', node.nodeId, worldOf(d, node), e.name);
      return;
    }
    case 'tool.denied': {
      const node = touch(d, e);
      if (node) d.tape(e, 'denied', node.nodeId, worldOf(d, node), e.name, denialNote(e.denial));
      return;
    }
    case 'usage.changed': {
      const node = touch(d, e, { usage: e.usage, cost: e.cost });
      if (node && isMain(d, node)) d.put('sessions', node.sessionId, { usage: e.usage, cost: e.cost });
      return;
    }
    case 'workflow.changed': {
      const session = read(d.next.sessions, e.workflow.sessionId);
      if (!session) return;
      d.set('workflows', e.workflow.runId, e.workflow);
      if (!session.workflowRunIds.includes(e.workflow.runId)) {
        d.put('sessions', session.sessionId, { workflowRunIds: [...session.workflowRunIds, e.workflow.runId] });
      }
      return;
    }
    case 'compacted': {
      const node = touch(d, e);
      if (!node) return;
      if (isMain(d, node)) d.put('sessions', node.sessionId, { contextTokens: e.postTokens });
      d.tape(e, 'compact', node.nodeId, worldOf(d, node), `${e.preTokens}>${e.postTokens}`, e.trigger);
      return;
    }
    case 'api.retry': {
      const node = touch(d, e);
      if (node) d.tape(e, 'retry', node.nodeId, worldOf(d, node), `${e.attempt}/${e.maxRetries}`);
      return;
    }
    case 'api.error': {
      const node = read(d.next.nodes, e.nodeId);
      if (!node) return;
      touch(d, e, { errors: node.errors + 1 });
      d.tape(e, 'fault', node.nodeId, worldOf(d, node), e.httpStatus === null ? e.kind : String(e.httpStatus));
      return;
    }
    case 'rate_limit.hit': {
      const node = touch(d, e);
      if (!node) return;
      d.put('sessions', node.sessionId, { lastRateLimit: { type: e.limit, status: 'rejected', resetsAt: e.resetsAt } });
      d.tape(e, 'limit', node.nodeId, worldOf(d, node), e.limit);
      return;
    }
    case 'tail.reset': {
      const node = read(d.next.nodes, e.nodeId);
      if (!node) return;
      d.next.sensor = { ...d.next.sensor, tailResets: d.next.sensor.tailResets + 1 };
      d.tape(e, 'gap', node.nodeId, worldOf(d, node), e.reason);
      return;
    }

    case 'kernel.tick':
      d.next.lastTickAt = e.at;
      return;
    case 'world.upserted':
      d.set('worlds', e.world.worldId, e.world);
      return;
    case 'plan.changed':
      if (e.plan.status === 'rejected' && d.next.plan?.status !== 'rejected') d.tape(e, 'limit', null, null, 'plan');
      d.next.plan = e.plan;
      return;
    case 'source.plan.changed':
      if ((d.next.clientPlans?.[e.client]?.asOf ?? 0) > (e.plan.asOf ?? 0)) return;
      d.next.clientPlans = { ...d.next.clientPlans, [e.client]: e.plan };
      return;
    case 'admission.changed':
      d.next.admission = e.admission;
      return;
    case 'profiles.changed':
      d.next.profiles = e.profiles;
      return;
    case 'index.progress':
      d.next.index = e.progress;
      return;
    case 'sensor.changed':
      d.next.sensor = e.sensor;
      return;

    case 'salvo.opened':
      d.set('salvos', e.salvo.salvoId, e.salvo);
      d.pruneSalvos = true;
      d.tape(e, 'salvo', e.salvo.parentNodeId, e.salvo.worldId, String(e.salvo.nodeIds.length), e.salvo.salvoId);
      return;
    case 'salvo.joined': {
      const salvo = read(d.next.salvos, e.salvoId);
      if (salvo && !salvo.nodeIds.includes(e.nodeId)) d.put('salvos', e.salvoId, { nodeIds: [...salvo.nodeIds, e.nodeId] });
      return;
    }
    case 'salvo.closed':
      d.put('salvos', e.salvoId, { closedAt: e.observedAt });
      return;

    // Live state holds no history. The UI's sky slice takes these from the stream and from `history.get`.
    case 'history.digest':
    case 'history.expired':
    // A beam or line in the scene, gone by the next frame. Nothing to hold, so a snapshot cannot need it.
    case 'link.fired':
      return;

    case 'fleet.evicted': return evict(d, e.sessionIds);

    case 'managed.upserted': return managedUpserted(d, e);
    case 'managed.removed':
      if (read(d.next.managed, e.agentId)) delete d.map('managed')[e.agentId];
      if (read(d.next.standing, e.agentId)) delete d.map('standing')[e.agentId];
      return;
    case 'standing.changed':
      if (e.grants.length > 0) d.set('standing', e.agentId, e.grants);
      else if (read(d.next.standing, e.agentId)) delete d.map('standing')[e.agentId];
      return;

    case 'approval.requested':
      // Never dropped, even with its node unknown: a decision must always reach the rail.
      d.set('approvals', e.approval.requestId, e.approval);
      d.tape(e, 'need', e.approval.nodeId, e.approval.worldId, e.approval.toolName);
      return;
    case 'approval.answered': return settle(d, e, e.requestId, 'answered', e.outcome, e.by, e.outcome);
    case 'approval.cancelled': return settle(d, e, e.requestId, 'withdrawn', null, null, 'withdrawn');
    case 'approval.expired': return settle(d, e, e.requestId, 'expired', null, null, 'expired');

    case 'spawn.refused': {
      const parent = e.parentAgentId === null ? undefined : read(d.next.managed, e.parentAgentId);
      d.tape(e, 'limit', parent?.nodeId ?? null, e.worldId ?? parent?.worldId ?? null, e.limit);
      return;
    }
    case 'fault.acked':
      // A craft that crashed before its session began has a pending node id and no node.
      if (read(d.next.nodes, e.nodeId) || Object.values(d.next.managed).some((m) => m.nodeId === e.nodeId)) {
        d.map('acked')[e.nodeId] = e.at;
      }
      return;

    default:
      e satisfies never;
  }
}

type Of<T extends NaosEvent['type']> = Extract<NaosEvent, { type: T }>;

const worldOf = (d: Draft, node: ObservedAgentNode): string | null => read(d.next.sessions, node.sessionId)?.worldId ?? null;

const isMain = (d: Draft, node: ObservedAgentNode): boolean => read(d.next.sessions, node.sessionId)?.rootNodeId === node.nodeId;

const denialNote = (denial: ToolDenial | null): string | null => denial?.source ?? denial?.kind ?? null;

const isFresh = (startedAt: EpochMs | null, e: NaosEvent): boolean => startedAt === null || e.observedAt - startedAt < LAUNCH_FRESH_MS;

/** Records the newest record on a node, for `silentMs` and the `lag` tag. Returns the node as it was, or undefined if unknown. */
function touch(
  d: Draft,
  e: Extract<NaosEvent, { nodeId: NodeId; sessionId: SessionId }>,
  extra: Partial<ObservedAgentNode> = {},
): ObservedAgentNode | undefined {
  const node = read(d.next.nodes, e.nodeId);
  if (!node) return undefined;
  const lastRecordAt = Math.max(node.lastRecordAt ?? 0, e.at);
  d.put('nodes', e.nodeId, { ...extra, lastRecordAt, flushLagMs: Math.max(0, e.observedAt - e.at) });
  if (isMain(d, node)) d.put('sessions', node.sessionId, { lastRecordAt });
  return node;
}

/** Closed waits add up here, so the time a craft spent blocked survives a snapshot. */
const blockedAfter = (session: ObservedSession, next: Activity): number =>
  session.activity.state === 'waiting' && next.state !== 'waiting'
    ? session.blockedMs + Math.max(0, next.since - session.activity.since)
    : session.blockedMs;

function mainNodeOf(session: ObservedSession): ObservedAgentNode {
  return {
    nodeId: session.rootNodeId,
    sessionId: session.sessionId,
    kind: 'main',
    agentId: null,
    parentNodeId: null,
    childNodeIds: [],
    linkedBy: 'root',
    parentToolUseId: null,
    spawnDepth: 0,
    agentType: null,
    name: null,
    description: null,
    model: session.model,
    effort: session.effort,
    cwd: session.currentCwd ?? session.startCwd,
    worktreePath: session.worktree?.path ?? null,
    worktreeBranch: session.worktree?.branch ?? null,
    background: null,
    workflow: null,
    transcriptPath: session.transcriptPath,
    metaPath: null,
    transcriptBytes: session.transcriptBytes,
    status: session.endedAt === null ? 'running' : 'unknown',
    activity: session.activity,
    flushLagMs: null,
    startedAt: session.startedAt,
    lastRecordAt: session.lastRecordAt,
    endedAt: session.endedAt,
    usage: session.usage,
    cost: session.cost,
    toolCalls: 0,
    errors: 0,
    lastToolName: null,
  };
}

function mainPatch(patch: Partial<ObservedSession>): Partial<ObservedAgentNode> {
  const out: Record<string, unknown> = {};
  for (const key of MAIN_FIELDS) if (patch[key] !== undefined) out[key] = patch[key];
  // A resumed session flies again, and a stale `completed` would outrank its activity in visualState.
  if (patch.endedAt === null) out.status = 'running';
  return out as Partial<ObservedAgentNode>;
}

function sessionDiscovered(d: Draft, e: Of<'session.discovered'>): void {
  const session = e.session;
  const prev = read(d.next.sessions, session.sessionId);
  d.set('sessions', session.sessionId, prev
    ? { ...prev, ...defined(session), blockedMs: Math.max(prev.blockedMs, session.blockedMs) }
    : session);
  // Every session owns a main node, because the planes address its events by nodeId.
  if (read(d.next.nodes, session.rootNodeId)) d.put('nodes', session.rootNodeId, mainPatch(session));
  else d.set('nodes', session.rootNodeId, mainNodeOf(session));
  d.recount.add(session.sessionId);
  if (!prev && session.origin === 'observer' && isFresh(session.startedAt, e)) {
    d.tape(e, 'launch', session.rootNodeId, session.worldId, session.kind);
  }
}

function sessionChanged(d: Draft, e: Of<'session.changed'>): void {
  const session = read(d.next.sessions, e.sessionId);
  if (!session) return;
  if (e.patch.sessionId !== undefined && e.patch.sessionId !== session.sessionId) return rekey(d, session, e.patch.sessionId, e.patch);
  const activity = e.patch.activity;
  d.put('sessions', e.sessionId, activity ? { blockedMs: blockedAfter(session, activity), ...e.patch } : e.patch);
  d.put('nodes', session.rootNodeId, mainPatch(e.patch));
}

/** `/clear` and `/resume`: one hull, a new conversation. Stream subscribers see both ids on the event and move their hull. */
function rekey(d: Draft, session: ObservedSession, sessionId: SessionId, patch: Partial<ObservedSession>): void {
  const oldId = session.sessionId;
  const rootNodeId = patch.rootNodeId ?? makeNodeId(sessionId);
  const sessions = d.map('sessions');
  delete sessions[oldId];
  sessions[sessionId] = {
    ...read(sessions, sessionId),
    ...session,
    contextTokens: null,
    ...defined(patch),
    sessionId,
    rootNodeId,
  };

  const nodes = d.map('nodes');
  const root = read(nodes, session.rootNodeId);
  if (root) {
    delete nodes[session.rootNodeId];
    const childNodeIds = union(read(nodes, rootNodeId)?.childNodeIds ?? [], root.childNodeIds);
    nodes[rootNodeId] = { ...root, ...mainPatch(patch), nodeId: rootNodeId, sessionId, childNodeIds };
  }
  // Agents can outlive a /clear. Their node ids stay, so their later events still land.
  for (const node of Object.values(nodes)) {
    if (node.sessionId === oldId) {
      d.put('nodes', node.nodeId, { sessionId, parentNodeId: node.parentNodeId === session.rootNodeId ? rootNodeId : node.parentNodeId });
    }
  }
  for (const workflow of Object.values(d.next.workflows)) {
    if (workflow.sessionId === oldId) {
      d.put('workflows', workflow.runId, {
        sessionId,
        parentNodeId: workflow.parentNodeId === session.rootNodeId ? rootNodeId : workflow.parentNodeId,
      });
    }
  }
  if (read(d.next.acked, session.rootNodeId)) delete d.map('acked')[session.rootNodeId];
  d.recount.add(sessionId);
}

function sessionEnded(d: Draft, e: Of<'session.ended'>): void {
  const session = read(d.next.sessions, e.sessionId);
  if (!session) return;
  const repeat = session.activity.state === 'finished';
  const activity: Activity = { state: 'finished', since: e.at, outcome: e.outcome };
  d.put('sessions', e.sessionId, {
    activity,
    endedAt: e.at,
    blockedMs: blockedAfter(session, activity),
    // Other liveness values stay with the probe: `dead` would read as a stale pid file, a derelict.
    liveness: e.reason === 'pid-recycled' ? 'recycled' : session.liveness,
  });
  d.put('nodes', session.rootNodeId, { activity, endedAt: e.at, status: e.outcome === 'clean' ? 'completed' : 'unknown' });
  if (repeat || session.origin !== 'observer') return;
  if (e.outcome === 'abandoned') d.tape(e, 'fault', session.rootNodeId, session.worldId, 'abandoned');
  else d.tape(e, 'land', session.rootNodeId, session.worldId, e.reason === 'pid-recycled' ? e.reason : e.outcome);
}

function activityChanged(d: Draft, e: Of<'activity.changed'>): void {
  const node = read(d.next.nodes, e.nodeId);
  if (!node) return;
  const session = read(d.next.sessions, node.sessionId);
  const next = e.activity;
  const changed = next.state !== node.activity.state;
  d.put('nodes', e.nodeId, { activity: next });
  if (session?.rootNodeId === e.nodeId) {
    d.put('sessions', session.sessionId, { activity: next, blockedMs: blockedAfter(session, next) });
  }
  if (!changed) return;
  // An owned craft's need arrives as `approval.requested`, with the tool name.
  if (next.state === 'waiting' && session?.origin === 'observer') d.tape(e, 'need', e.nodeId, session.worldId, next.reason);
  if (next.state === 'interrupted') d.tape(e, 'stop', e.nodeId, session?.worldId ?? null, 'interrupted');
}

function link(d: Draft, parentId: NodeId | null, childId: NodeId): void {
  const parent = parentId === null ? undefined : read(d.next.nodes, parentId);
  if (parent && !parent.childNodeIds.includes(childId)) {
    d.put('nodes', parent.nodeId, { childNodeIds: [...parent.childNodeIds, childId] });
  }
}

function unlink(d: Draft, parentId: NodeId | null, childId: NodeId): void {
  const parent = parentId === null ? undefined : read(d.next.nodes, parentId);
  if (parent?.childNodeIds.includes(childId)) {
    d.put('nodes', parent.nodeId, { childNodeIds: parent.childNodeIds.filter((id) => id !== childId) });
  }
}

function agentStarted(d: Draft, e: Of<'agent.started'>): void {
  const node = e.node;
  const prev = read(d.next.nodes, node.nodeId);
  d.set('nodes', node.nodeId, prev
    ? { ...prev, ...defined(node), childNodeIds: union(prev.childNodeIds, node.childNodeIds) }
    : node);
  if (prev && prev.parentNodeId !== node.parentNodeId) unlink(d, prev.parentNodeId, node.nodeId);
  link(d, node.parentNodeId, node.nodeId);
  d.recount.add(node.sessionId);
  if (!prev && node.kind !== 'main' && isFresh(node.startedAt, e)) {
    d.tape(e, 'launch', node.nodeId, read(d.next.sessions, node.sessionId)?.worldId ?? null, node.agentType ?? node.kind);
  }
}

function agentChanged(d: Draft, e: Of<'agent.changed'>): void {
  const node = read(d.next.nodes, e.nodeId);
  if (!node) return;
  const parent = e.patch.parentNodeId;
  if (parent !== undefined && parent !== node.parentNodeId) {
    unlink(d, node.parentNodeId, e.nodeId);
    link(d, parent, e.nodeId);
  }
  d.put('nodes', e.nodeId, e.patch);
  if (e.patch.status !== undefined) d.recount.add(node.sessionId);
  const activity = e.patch.activity;
  const session = read(d.next.sessions, node.sessionId);
  if (activity && session?.rootNodeId === e.nodeId) {
    d.put('sessions', session.sessionId, { activity, blockedMs: blockedAfter(session, activity) });
  }
}

const finishedOutcome = (status: AgentStatus): 'clean' | 'abandoned' | 'unknown' =>
  status === 'completed' ? 'clean' : status === 'failed' ? 'abandoned' : 'unknown';

function agentEnded(d: Draft, e: Of<'agent.ended'>): void {
  const node = read(d.next.nodes, e.nodeId);
  if (!node) return;
  const repeat = node.endedAt !== null;
  d.put('nodes', e.nodeId, {
    status: e.status,
    endedAt: e.at,
    activity: { state: 'finished', since: e.at, outcome: finishedOutcome(e.status) },
  });
  d.recount.add(node.sessionId);
  if (repeat || node.kind === 'main') return;
  d.tape(e, e.status === 'failed' ? 'fault' : 'land', e.nodeId, worldOf(d, node), e.status);
}

function managedUpserted(d: Draft, e: Of<'managed.upserted'>): void {
  const agent: ManagedAgentView = e.agent;
  const prev = read(d.next.managed, agent.agentId);
  d.set('managed', agent.agentId, agent);
  const kind = MANAGED_TAPE[agent.state];
  if (kind && prev?.state !== agent.state) {
    d.tape(e, kind, agent.nodeId, agent.worldId, kind === 'launch' ? agent.profile : agent.state);
  }
}

function settle(
  d: Draft,
  e: NaosEvent,
  requestId: RequestId,
  status: ApprovalStatus,
  outcome: ApprovalDecision['kind'] | null,
  by: string | null,
  detail: string,
): void {
  const approval = read(d.next.approvals, requestId);
  // The first ending wins, as `answer()` does in the kernel (AC 9.1).
  if (!approval || approval.status !== 'open') return;
  d.put('approvals', requestId, { status, answeredAt: e.at, answeredBy: by, outcome });
  d.pruneApprovals = true;
  d.tape(e, 'answered', approval.nodeId, approval.worldId, detail);
}

/** Salvos stay: a burned spoke outlives its craft. Managed rows stay too, they leave with `managed.removed`. */
function evict(d: Draft, sessionIds: readonly SessionId[]): void {
  const gone = new Set(sessionIds.filter((id) => read(d.next.sessions, id)));
  if (gone.size === 0) return;
  const sessions = d.map('sessions');
  for (const id of gone) delete sessions[id];

  const removed = new Set<NodeId>();
  for (const node of Object.values(d.next.nodes)) if (gone.has(node.sessionId)) removed.add(node.nodeId);
  if (removed.size > 0) {
    const nodes = d.map('nodes');
    for (const id of removed) delete nodes[id];
  }
  for (const workflow of Object.values(d.next.workflows)) {
    if (gone.has(workflow.sessionId)) delete d.map('workflows')[workflow.runId];
  }
  for (const approval of Object.values(d.next.approvals)) {
    if (approval.status !== 'open' && removed.has(approval.nodeId)) delete d.map('approvals')[approval.requestId];
  }
  for (const id of Object.keys(d.next.acked)) if (removed.has(id)) delete d.map('acked')[id];
}

function recount(d: Draft): void {
  const counts = new Map<SessionId, { all: number; running: number }>();
  for (const id of d.recount) counts.set(id, { all: 0, running: 0 });
  for (const node of Object.values(d.next.nodes)) {
    const count = counts.get(node.sessionId);
    if (!count || node.kind === 'main') continue;
    count.all += 1;
    if (node.status === 'running') count.running += 1;
  }
  for (const [id, { all, running }] of counts) d.put('sessions', id, { agentCount: all, runningAgentCount: running });
}

/** Closed salvos go oldest first. An open one goes only if the whole set is open, which only a faulty kernel could cause. */
function pruneSalvos(d: Draft): void {
  const all = Object.values(d.next.salvos);
  if (all.length <= SALVO_LIMIT) return;
  const closed = (at: EpochMs | null): EpochMs => at ?? Number.MAX_SAFE_INTEGER;
  all.sort((a, b) => closed(a.closedAt) - closed(b.closedAt) || a.openedAt - b.openedAt);
  const salvos = d.map('salvos');
  for (const salvo of all.slice(0, all.length - SALVO_LIMIT)) delete salvos[salvo.salvoId];
}

function pruneApprovals(d: Draft): void {
  const settled = Object.values(d.next.approvals).filter((a) => a.status !== 'open');
  if (settled.length <= SETTLED_APPROVAL_LIMIT) return;
  settled.sort((a, b) => (a.answeredAt ?? 0) - (b.answeredAt ?? 0));
  const approvals = d.map('approvals');
  for (const approval of settled.slice(0, settled.length - SETTLED_APPROVAL_LIMIT)) delete approvals[approval.requestId];
}
