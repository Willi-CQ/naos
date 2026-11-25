import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  COMMAND_SCOPES, SALVO_LIMIT, SETTLED_APPROVAL_LIMIT, TAPE_LIMIT, emptyState, makeNodeId, reduce,
} from '../src/index.ts';
import type {
  Activity, ApprovalView, AuthScope, CommandType, CostEstimate, FleetState, HistoryDigest, ManagedAgentView, NaosEvent,
  ObservedAgentNode, ObservedSession, ObservedWorkflow, Salvo, TokenUsage, World,
} from '../src/index.ts';

const T0 = 1_800_000_000_000;

const usage = (over: Partial<TokenUsage> = {}): TokenUsage => ({
  input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, webSearchRequests: 0, messages: 0, partialOutputMessages: 0, ...over,
});
const cost = (usd = 0): CostEstimate => ({ usd, estimateUsd: usd, costStateUsd: null, isEstimate: true, isLowerBound: false, unpricedModels: [] });

function session(sessionId: string, over: Partial<ObservedSession> = {}): ObservedSession {
  return {
    sessionId, origin: 'observer', worldId: 'w1', title: null, titleSource: null, displayName: null, projectRoot: 'C:/w1',
    startCwd: 'C:/w1', currentCwd: 'C:/w1', worktree: null, gitBranch: null, slugs: [], transcriptPath: null, transcriptBytes: 0,
    pid: 1000, liveness: 'alive', kind: 'interactive', entrypoint: 'cli', version: '2.1.314', pidStatus: 'busy',
    remoteControlled: false, acceptsPeerMessages: null, activity: { state: 'starting', since: T0 }, queuedInputs: 0, model: 'm',
    requestedModel: null, effort: null, permissionMode: 'default', startedAt: T0, lastRecordAt: null, lastWriteAt: null,
    endedAt: null, usage: usage(), usageTree: usage(), cost: cost(), contextTokens: 5000, contextWindow: 1_000_000, blockedMs: 0,
    rootNodeId: makeNodeId(sessionId), agentCount: 0, runningAgentCount: 0, workflowRunIds: [], lastRateLimit: null, ...over,
  };
}

function agent(sessionId: string, agentId: string, over: Partial<ObservedAgentNode> = {}): ObservedAgentNode {
  return {
    nodeId: makeNodeId(sessionId, agentId), sessionId, kind: 'subagent', agentId, parentNodeId: sessionId, childNodeIds: [],
    linkedBy: 'parentAgentId', parentToolUseId: null, spawnDepth: 1, agentType: 'Explore', name: null, description: null,
    model: 'm', effort: null, cwd: null, worktreePath: null, worktreeBranch: null, background: null, workflow: null,
    transcriptPath: null, metaPath: null, transcriptBytes: 0, status: 'running', activity: { state: 'starting', since: T0 },
    flushLagMs: null, startedAt: T0, lastRecordAt: null, endedAt: null, usage: usage(), cost: cost(), toolCalls: 0, errors: 0,
    lastToolName: null, ...over,
  };
}

function managed(agentId: string, over: Partial<ManagedAgentView> = {}): ManagedAgentView {
  return {
    agentId, sessionId: 's1', nodeId: 's1', worldId: 'w1', projectRoot: 'C:/w1', cwd: 'C:/w1', profile: 'build', title: 'naos:x',
    model: 'm', effort: null, permissionMode: 'default', parentAgentId: null, rootAgentId: agentId, depth: 0, missionId: null,
    state: 'queued', stopStep: null, openApprovals: 0, failure: null, budgetUsd: 1, spentUsd: 0, treeBudgetUsd: null,
    treeSpentUsd: null, turn: 0, maxTurns: null, toolCalls: 0, toolErrors: 0, queuedSends: 0, lastTerminalReason: null,
    lastTurnAborted: false, ttftMs: null, subagentStats: null, contextTokens: null, contextWindow: null, worktree: null, pid: null,
    createdAt: T0, startedAt: null, endedAt: null, resumable: false, ...over,
  };
}

function approval(requestId: string, over: Partial<ApprovalView> = {}): ApprovalView {
  return {
    requestId, agentId: 'a1', nodeId: 's1', worldId: 'w1', toolUseID: `tu-${requestId}`, toolName: 'Bash', toolFamily: 'shell',
    input: {}, displayName: null, description: null, title: null, blockedPath: null, decisionReason: null, danger: false,
    defaultToNo: false, canRememberForSession: true, canRememberForProject: true, subagentId: null, subagentType: null,
    mcpServer: null, callIndex: 1, callCount: 1, createdAt: T0, status: 'open', answeredAt: null, answeredBy: null, outcome: null, ...over,
  };
}

const salvo = (salvoId: string, over: Partial<Salvo> = {}): Salvo => ({
  salvoId, parentNodeId: 's1', sessionId: 's1', worldId: 'w1', source: 'subagent', openedAt: T0, closedAt: null,
  nodeIds: ['s1/a', 's1/b', 's1/c'], ...over,
});

const world = (worldId: string, over: Partial<World> = {}): World => ({
  worldId, projectRoot: `C:/${worldId}`, name: worldId, slot: 1, kind: 'repo', isGit: true, trusted: false, massBytes: 0,
  massUsd30d: null, spendTodayUsd: null, lightsTotal: 0, lightsFailed: 0, lastActiveAt: null, worktrees: [], ...over,
});

const workflow = (runId: string, over: Partial<ObservedWorkflow> = {}): ObservedWorkflow => ({
  runId, sessionId: 's1', parentNodeId: 's1', parentToolUseId: null, taskId: null, name: null, status: 'running',
  statusSource: 'journal+liveness', journalPath: 'j', statePath: null, scriptPath: null, transcriptDir: 'd', phases: [],
  counts: { started: 0, completed: 0, failed: 0, open: 0, retried: 0, cached: null }, startedAt: T0, endedAt: null,
  durationMs: null, totalTokens: null, totalToolCalls: null, cost: cost(), ...over,
});

let counter = 0;
type Body<E> = E extends unknown ? Omit<E, 'id' | 'at' | 'observedAt'> : never;
/** One event, with a unique id and the record's time. */
function ev(body: Body<NaosEvent>, at = T0 + 1000): NaosEvent {
  return { id: `e${counter++}`, at, observedAt: at, ...body } as NaosEvent;
}
const onNode = (nodeId: string, sessionId = nodeId.split('/')[0]!) => ({ nodeId, sessionId });

const discovered = (s: ObservedSession): NaosEvent => ev({ type: 'session.discovered', session: s, ...onNode(s.sessionId) });
const started = (n: ObservedAgentNode): NaosEvent => ev({ type: 'agent.started', node: n, ...onNode(n.nodeId, n.sessionId) });

/** Two sessions in two worlds, s1 with one running agent. */
function fleet(): FleetState {
  return reduce(emptyState(), [
    discovered(session('s1')),
    discovered(session('s2', { worldId: 'w2' })),
    started(agent('s1', 'a1')),
    ev({ type: 'world.upserted', world: world('w1') }),
    ev({ type: 'world.upserted', world: world('w2') }),
  ]);
}

const kinds = (state: FleetState): string[] => state.tape.map((row) => row.kind);
const last = (state: FleetState) => state.tape.at(-1)!;

test('an empty batch returns the same state', () => {
  const state = fleet();
  assert.equal(reduce(state, []), state);
});

test('reduce does not mutate its input or the events', () => {
  const state = fleet();
  const frozen = structuredClone(state);
  const event = ev({ type: 'session.changed', patch: { title: 'x' }, ...onNode('s1') });
  const frozenEvent = structuredClone(event);
  reduce(state, [event, ev({ type: 'agent.ended', status: 'completed', ...onNode('s1/a1') })]);
  assert.deepEqual(state, frozen);
  assert.deepEqual(event, frozenEvent);
});

test('an event object placed into state is never written through by a later event in the batch', () => {
  const s = session('s9');
  const snapshot = structuredClone(s);
  const out = reduce(emptyState(), [discovered(s), ev({ type: 'session.changed', patch: { title: 'later' }, ...onNode('s9') })]);
  assert.deepEqual(s, snapshot);
  assert.equal(out.sessions.s9?.title, 'later');
});

test('untouched entities and maps keep their identity', () => {
  const state = fleet();
  const out = reduce(state, [ev({ type: 'session.changed', patch: { title: 'x' }, ...onNode('s1') })]);
  assert.notEqual(out, state);
  assert.notEqual(out.sessions, state.sessions);
  assert.notEqual(out.sessions.s1, state.sessions.s1);
  assert.equal(out.sessions.s2, state.sessions.s2);
  assert.equal(out.nodes, state.nodes, 'a title touches no node');
  assert.equal(out.worlds, state.worlds);
  assert.equal(out.managed, state.managed);
  assert.equal(out.approvals, state.approvals);
  assert.equal(out.salvos, state.salvos);
  assert.equal(out.tape, state.tape);
  assert.equal(out.admission, state.admission);
  assert.equal(out.sensor, state.sensor);
});

test('a touched map keeps the identity of its untouched entries', () => {
  const state = fleet();
  const out = reduce(state, [ev({ type: 'turn.started', origin: 'human', ...onNode('s1/a1') })]);
  assert.notEqual(out.nodes['s1/a1'], state.nodes['s1/a1']);
  assert.equal(out.nodes.s1, state.nodes.s1);
  assert.equal(out.nodes.s2, state.nodes.s2);
});

test('a patch that changes nothing keeps the entity', () => {
  const state = fleet();
  const out = reduce(state, [ev({ type: 'session.changed', patch: { title: null, model: 'm' }, ...onNode('s1') })]);
  assert.equal(out.sessions, state.sessions);
  assert.equal(out.sessions.s1, state.sessions.s1);
});

test('undefined in a patch does not overwrite, so the state matches what JSON would carry', () => {
  const state = fleet();
  const out = reduce(state, [ev({ type: 'session.changed', patch: { title: 'x', model: undefined }, ...onNode('s1') })]);
  assert.equal(out.sessions.s1?.model, 'm');
});

/** Counts how often `target` is enumerated, which is how a spread copies it. */
function countingCopies<T extends object>(target: T): { proxy: T; copies: () => number } {
  let copies = 0;
  const proxy = new Proxy(target, {
    ownKeys(t) {
      copies += 1;
      return Reflect.ownKeys(t);
    },
  });
  return { proxy, copies: () => copies };
}

test('a batch copies the old map and the old entity once, however many events touch them', () => {
  const state = fleet();
  const map = countingCopies(state.nodes);
  const entity = countingCopies(state.nodes['s1/a1']!);
  const input: FleetState = { ...state, nodes: { ...map.proxy, 's1/a1': entity.proxy } };
  const nodes = countingCopies(input.nodes);
  input.nodes = nodes.proxy;

  const batch: NaosEvent[] = [];
  for (let i = 0; i < 50; i++) batch.push(ev({ type: 'tool.started', toolUseId: `t${i}`, name: 'Read', toolFamily: 'read', summary: { target: null, shape: 'Read' }, ...onNode('s1/a1') }, T0 + 2000 + i));
  const out = reduce(input, batch);

  assert.equal(nodes.copies(), 1);
  assert.equal(entity.copies(), 1);
  assert.equal(out.nodes['s1/a1']?.toolCalls, 50);
  assert.equal(out.nodes['s1/a1']?.lastRecordAt, T0 + 2049);
  assert.equal(out.seq, state.seq + 50);
});

test('seq counts the batch, and an explicit seq wins', () => {
  const state = fleet();
  const tick = ev({ type: 'kernel.tick', uptimeMs: 1 });
  assert.equal(reduce(state, [tick, tick]).seq, state.seq + 2);
  assert.equal(reduce(state, [tick], 900).seq, 900);
});

test('kernel.tick updates lastTickAt and nothing else', () => {
  const state = fleet();
  const out = reduce(state, [ev({ type: 'kernel.tick', uptimeMs: 5 }, T0 + 9)]);
  assert.equal(out.lastTickAt, T0 + 9);
  const { lastTickAt: _a, seq: _b, ...rest } = out;
  const { lastTickAt: _c, seq: _d, ...before } = state;
  for (const key of Object.keys(rest) as Array<keyof typeof rest>) assert.equal(rest[key], before[key], key);
});

test('unknown event types pass through, and events for unknown nodes are ignored', () => {
  const state = fleet();
  const unknown = { id: 'x', at: T0, observedAt: T0, type: 'from.the.future', nodeId: 's1' } as unknown as NaosEvent;
  const out = reduce(state, [unknown]);
  assert.equal(out.seq, state.seq + 1);
  assert.equal(out.sessions, state.sessions);
  assert.equal(out.nodes, state.nodes);
  assert.equal(out.tape, state.tape);

  const ghost = onNode('nope/nope', 'nope');
  const ignored = reduce(state, [
    ev({ type: 'session.changed', patch: { title: 'x' }, ...ghost }),
    ev({ type: 'session.ended', outcome: 'clean', reason: 'exit', ...ghost }),
    ev({ type: 'activity.changed', activity: { state: 'unknown', since: T0 }, ...ghost }),
    ev({ type: 'agent.changed', patch: { name: 'x' }, ...ghost }),
    ev({ type: 'agent.ended', status: 'failed', ...ghost }),
    ev({ type: 'turn.started', origin: 'human', ...ghost }),
    ev({ type: 'turn.ended', stopReason: 'end_turn', ...ghost }),
    ev({ type: 'request.started', model: 'm', querySource: null, ...ghost }),
    ev({ type: 'message.completed', messageId: 'm', model: 'm', blocks: ['text'], blockSizes: [1], usage: usage(), ...ghost }),
    ev({ type: 'tool.started', toolUseId: 't', name: 'Read', toolFamily: 'read', summary: { target: null, shape: '' }, ...ghost }),
    ev({ type: 'tool.finished', toolUseId: 't', name: 'Read', toolFamily: 'read', isError: true, decision: 'reject', denial: null, durationMs: 1, ...ghost }),
    ev({ type: 'tool.denied', toolUseId: null, name: 'Read', toolFamily: 'read', denial: { kind: null, source: null }, ...ghost }),
    ev({ type: 'usage.changed', usage: usage(), cost: cost(), ...ghost }),
    ev({ type: 'workflow.changed', workflow: workflow('wf', { sessionId: 'nope' }), ...ghost }),
    ev({ type: 'compacted', trigger: 'auto', preTokens: 2, postTokens: 1, durationMs: 1, ...ghost }),
    ev({ type: 'api.retry', attempt: 1, maxRetries: 3, retryInMs: 1, ...ghost }),
    ev({ type: 'api.error', httpStatus: 529, kind: null, ...ghost }),
    ev({ type: 'rate_limit.hit', limit: 'five_hour', resetsAt: null, ...ghost }),
    ev({ type: 'tail.reset', path: 'p', reason: 'shrunk', ...ghost }),
    ev({ type: 'salvo.joined', salvoId: 'none', nodeId: 'x' }),
    ev({ type: 'salvo.closed', salvoId: 'none' }),
    ev({ type: 'approval.answered', requestId: 'none', agentId: 'a', outcome: 'approve', by: 'c' }),
    ev({ type: 'approval.cancelled', requestId: 'none', agentId: 'a', reason: 'r' }),
    ev({ type: 'approval.expired', requestId: 'none' }),
    ev({ type: 'fault.acked', nodeId: 'nope' }),
    ev({ type: 'fleet.evicted', sessionIds: ['nope'] }),
    ev({ type: 'managed.removed', agentId: 'none' }),
  ]);
  assert.equal(ignored.sessions, state.sessions);
  assert.equal(ignored.nodes, state.nodes);
  assert.equal(ignored.workflows, state.workflows);
  assert.equal(ignored.salvos, state.salvos);
  assert.equal(ignored.approvals, state.approvals);
  assert.equal(ignored.managed, state.managed);
  assert.equal(ignored.acked, state.acked);
  assert.equal(ignored.tape, state.tape);
  assert.equal(ignored.sensor, state.sensor);
});

test('an inherited property name is not a known id', () => {
  const state = fleet();
  const out = reduce(state, [ev({ type: 'agent.ended', status: 'failed', ...onNode('constructor', 'constructor') })]);
  assert.equal(out.nodes, state.nodes);
});

test('session lifecycle: discovered, patched, ended, with a main node from the start', () => {
  let state = reduce(emptyState(), [discovered(session('s1', { startedAt: T0 + 500 }))]);
  assert.equal(state.sessions.s1?.activity.state, 'starting');
  assert.equal(state.nodes.s1?.kind, 'main', 'a session owns a main node');
  assert.equal(state.nodes.s1?.linkedBy, 'root');
  assert.deepEqual(kinds(state), ['launch']);

  const working: Activity = { state: 'generating', since: T0 + 1000 };
  state = reduce(state, [ev({ type: 'session.changed', patch: { title: 'kestrel', model: 'opus', activity: working }, ...onNode('s1') })]);
  assert.equal(state.sessions.s1?.title, 'kestrel');
  assert.equal(state.nodes.s1?.model, 'opus', 'main fields follow the session');
  assert.equal(state.nodes.s1?.activity, working);

  state = reduce(state, [ev({ type: 'session.ended', outcome: 'clean', reason: 'exit', ...onNode('s1') }, T0 + 2000)]);
  assert.deepEqual(state.sessions.s1?.activity, { state: 'finished', since: T0 + 2000, outcome: 'clean' });
  assert.equal(state.sessions.s1?.endedAt, T0 + 2000);
  assert.equal(state.nodes.s1?.status, 'completed');
  assert.equal(state.sessions.s1?.liveness, 'alive', 'liveness stays with the probe, dead would read as a derelict');
  assert.equal(last(state).kind, 'land');
  assert.equal(last(state).detail, 'clean');
});

test('session.discovered upserts', () => {
  const state = fleet();
  const out = reduce(state, [discovered(session('s1', { title: 'again', blockedMs: 0 }))]);
  assert.equal(out.sessions.s1?.title, 'again');
  assert.equal(out.sessions.s1?.agentCount, 1, 'a rediscovery keeps the count of known agents');
  assert.equal(out.tape.length, state.tape.length, 'a rediscovery is no launch');
});

test('a boot does not fill the tape with launches, and an owned session is taped by its control state', () => {
  const old = session('old', { startedAt: T0 - 3_600_000 });
  assert.deepEqual(kinds(reduce(emptyState(), [discovered(old)])), []);
  assert.deepEqual(kinds(reduce(emptyState(), [discovered(session('own', { origin: 'control' }))])), []);
});

test('an abandoned session is a fault, and a recycled pid is marked', () => {
  const state = fleet();
  const abandoned = reduce(state, [ev({ type: 'session.ended', outcome: 'abandoned', reason: 'exit', ...onNode('s1') })]);
  assert.equal(last(abandoned).kind, 'fault');
  assert.equal(abandoned.nodes.s1?.status, 'unknown', 'visualState reads abandoned from the activity');
  const recycled = reduce(state, [ev({ type: 'session.ended', outcome: 'unknown', reason: 'pid-recycled', ...onNode('s1') })]);
  assert.equal(recycled.sessions.s1?.liveness, 'recycled');
  assert.equal(last(recycled).detail, 'pid-recycled');
});

test('a repeated session.ended adds no second tape row', () => {
  const end = () => ev({ type: 'session.ended', outcome: 'clean', reason: 'exit', ...onNode('s1') });
  const once = reduce(fleet(), [end()]);
  assert.equal(reduce(once, [end()]).tape.length, once.tape.length);
});

test('a resumed session flies again', () => {
  const ended = reduce(fleet(), [ev({ type: 'session.ended', outcome: 'clean', reason: 'exit', ...onNode('s1') })]);
  const back = reduce(ended, [ev({ type: 'session.changed', patch: { endedAt: null, activity: { state: 'generating', since: T0 + 3000 } }, ...onNode('s1') })]);
  assert.equal(back.nodes.s1?.status, 'running');
  assert.equal(back.nodes.s1?.endedAt, null);
});

test('/clear re-keys one hull under the new session id', () => {
  const before = reduce(fleet(), [
    ev({ type: 'workflow.changed', workflow: workflow('wf1'), ...onNode('s1') }),
    ev({ type: 'fault.acked', nodeId: 's1' }),
  ]);
  const out = reduce(before, [ev({ type: 'session.changed', patch: { sessionId: 'n1', usage: usage() }, ...onNode('s1') })]);
  assert.equal(out.sessions.s1, undefined);
  assert.equal(out.nodes.s1, undefined);
  assert.equal(out.sessions.n1?.sessionId, 'n1');
  assert.equal(out.sessions.n1?.rootNodeId, 'n1');
  assert.equal(out.sessions.n1?.contextTokens, null, 'altitude resets');
  assert.equal(out.sessions.n1?.pid, 1000);
  assert.equal(out.nodes.n1?.sessionId, 'n1');
  assert.deepEqual(out.nodes.n1?.childNodeIds, ['s1/a1']);
  assert.equal(out.nodes['s1/a1']?.parentNodeId, 'n1');
  assert.equal(out.nodes['s1/a1']?.sessionId, 'n1');
  assert.equal(out.workflows.wf1?.sessionId, 'n1');
  assert.equal(out.acked.s1, undefined);
  assert.equal(out.sessions.n1?.agentCount, 1);

  const later = reduce(out, [ev({ type: 'turn.ended', stopReason: 'end_turn', ...onNode('s1/a1', 's1') })]);
  assert.equal(last(later).worldId, 'w1', 'a surviving agent still resolves its world');
  const evicted = reduce(later, [ev({ type: 'fleet.evicted', sessionIds: ['n1'] })]);
  assert.deepEqual(Object.keys(evicted.nodes).sort(), ['s2']);
});

test('agent lifecycle: links, counts, ends', () => {
  let state = reduce(emptyState(), [discovered(session('s1'))]);
  state = reduce(state, [started(agent('s1', 'a1')), started(agent('s1', 'a2'))]);
  assert.deepEqual(state.nodes.s1?.childNodeIds, ['s1/a1', 's1/a2']);
  assert.equal(state.sessions.s1?.agentCount, 2, 'the main node is not an agent');
  assert.equal(state.sessions.s1?.runningAgentCount, 2);
  assert.deepEqual(kinds(state), ['launch', 'launch', 'launch']);
  assert.equal(last(state).detail, 'Explore');

  state = reduce(state, [ev({ type: 'agent.changed', patch: { description: 'x', lastToolName: 'Grep' }, ...onNode('s1/a1') })]);
  assert.equal(state.nodes['s1/a1']?.lastToolName, 'Grep');

  state = reduce(state, [ev({ type: 'agent.ended', status: 'completed', ...onNode('s1/a1') }, T0 + 5000)]);
  assert.equal(state.nodes['s1/a1']?.status, 'completed');
  assert.equal(state.nodes['s1/a1']?.endedAt, T0 + 5000);
  assert.deepEqual(state.nodes['s1/a1']?.activity, { state: 'finished', since: T0 + 5000, outcome: 'clean' });
  assert.equal(state.sessions.s1?.runningAgentCount, 1);
  assert.equal(state.sessions.s1?.agentCount, 2);
  assert.equal(last(state).kind, 'land');

  state = reduce(state, [ev({ type: 'agent.ended', status: 'failed', ...onNode('s1/a2') })]);
  assert.equal(last(state).kind, 'fault');
  assert.equal(last(state).detail, 'failed');
  assert.equal(state.sessions.s1?.runningAgentCount, 0);
});

test('agent.started upserts without duplicating links or launches', () => {
  const state = fleet();
  const out = reduce(state, [started(agent('s1', 'a1', { description: 'again', childNodeIds: ['s1/x'] }))]);
  assert.equal(out.nodes['s1/a1']?.description, 'again');
  assert.deepEqual(out.nodes['s1/a1']?.childNodeIds, ['s1/x']);
  assert.deepEqual(out.nodes.s1?.childNodeIds, ['s1/a1']);
  assert.equal(out.tape.length, state.tape.length);
  assert.equal(out.sessions.s1?.agentCount, 1);
});

test('agent.started for a session not yet known still upserts', () => {
  const out = reduce(emptyState(), [started(agent('later', 'a1'))]);
  assert.equal(out.nodes['later/a1']?.agentId, 'a1');
  assert.equal(last(out).worldId, null);
  const joined = reduce(out, [discovered(session('later'))]);
  assert.equal(joined.sessions.later?.agentCount, 1);
});

test('a re-parented agent moves between childNodeIds', () => {
  const state = reduce(fleet(), [started(agent('s1', 'a2'))]);
  const out = reduce(state, [ev({ type: 'agent.changed', patch: { parentNodeId: 's1/a1', linkedBy: 'toolUseId' }, ...onNode('s1/a2') })]);
  assert.deepEqual(out.nodes.s1?.childNodeIds, ['s1/a1']);
  assert.deepEqual(out.nodes['s1/a1']?.childNodeIds, ['s1/a2']);
});

test('activity on the main node reaches session and node, on an agent only the node', () => {
  const state = fleet();
  const activity: Activity = { state: 'tool_running', since: T0 + 1, tools: [] };
  const main = reduce(state, [ev({ type: 'activity.changed', activity, ...onNode('s1') })]);
  assert.equal(main.sessions.s1?.activity, activity);
  assert.equal(main.nodes.s1?.activity, activity);
  const sub = reduce(state, [ev({ type: 'activity.changed', activity, ...onNode('s1/a1') })]);
  assert.equal(sub.sessions.s1, state.sessions.s1);
  assert.equal(sub.nodes['s1/a1']?.activity, activity);
});

test('tool events never move activity, so a late transcript record cannot overrule a live wait', () => {
  const waiting: Activity = { state: 'waiting', since: T0 + 1, reason: 'permission prompt' };
  const state = reduce(fleet(), [ev({ type: 'activity.changed', activity: waiting, ...onNode('s1') })]);
  const out = reduce(state, [
    ev({ type: 'tool.started', toolUseId: 't', name: 'Bash', toolFamily: 'shell', summary: { target: null, shape: 'Bash' }, ...onNode('s1') }),
    ev({ type: 'api.retry', attempt: 1, maxRetries: 10, retryInMs: 1000, ...onNode('s1') }),
  ]);
  assert.equal(out.sessions.s1?.activity, waiting);
});

test('blocked time adds up when a wait closes', () => {
  let state = fleet();
  const wait = (since: number): NaosEvent => ev({ type: 'activity.changed', activity: { state: 'waiting', since, reason: 'input needed' }, ...onNode('s1') }, since);
  const run = (since: number): NaosEvent => ev({ type: 'activity.changed', activity: { state: 'generating', since }, ...onNode('s1') }, since);
  state = reduce(state, [wait(T0 + 1000), run(T0 + 4000)]);
  assert.equal(state.sessions.s1?.blockedMs, 3000);
  state = reduce(state, [wait(T0 + 5000), ev({ type: 'session.ended', outcome: 'abandoned', reason: 'exit', ...onNode('s1') }, T0 + 6000)]);
  assert.equal(state.sessions.s1?.blockedMs, 4000);
  assert.equal(state.tape.filter((row) => row.kind === 'need').length, 2, 'an observed wait reaches the Tape');
  assert.equal(state.tape.find((row) => row.kind === 'need')?.detail, 'input needed');
});

test('tape rows follow DESIGN 10', () => {
  const on = onNode('s1');
  const summary = { target: 'C:/secret/path.ts', shape: 'Edit, 1 file' };
  const state = reduce(reduce(emptyState(), [discovered(session('s1', { startedAt: T0 - 3_600_000 }))]), [
    ev({ type: 'turn.ended', stopReason: 'end_turn', ...on }),
    ev({ type: 'activity.changed', activity: { state: 'interrupted', since: T0 }, ...on }),
    ev({ type: 'message.completed', messageId: 'm1', model: 'opus', blocks: ['thinking', 'text'], blockSizes: [10, 20], usage: usage(), ...on }),
    ev({ type: 'tool.started', toolUseId: 't1', name: 'Edit', toolFamily: 'edit', summary, ...on }),
    ev({ type: 'tool.started', toolUseId: 't2', name: 'Read', toolFamily: 'read', summary, ...on }),
    ev({ type: 'tool.finished', toolUseId: 't2', name: 'Read', toolFamily: 'read', isError: false, decision: null, denial: null, durationMs: 1, ...on }),
    ev({ type: 'tool.finished', toolUseId: 't3', name: 'Bash', toolFamily: 'shell', isError: true, decision: null, denial: null, durationMs: 1, ...on }),
    ev({ type: 'tool.finished', toolUseId: 't4', name: 'Bash', toolFamily: 'shell', isError: true, decision: 'reject', denial: { kind: 'user-rejected', source: 'user_temporary' }, durationMs: 1, ...on }),
    ev({ type: 'tool.denied', toolUseId: null, name: 'Write', toolFamily: 'edit', denial: { kind: 'permission-rule', source: null }, ...on }),
    ev({ type: 'compacted', trigger: 'auto', preTokens: 630_000, postTokens: 15_000, durationMs: 9, ...on }),
    ev({ type: 'api.retry', attempt: 3, maxRetries: 10, retryInMs: 8000, ...on }),
    ev({ type: 'api.error', httpStatus: 529, kind: 'overloaded', ...on }),
    ev({ type: 'api.error', httpStatus: null, kind: 'network', ...on }),
    ev({ type: 'rate_limit.hit', limit: 'five_hour', resetsAt: T0 + 9, ...on }),
    ev({ type: 'tail.reset', path: 'p', reason: 'shrunk', ...on }),
  ]);
  const rows = state.tape.map((row) => [row.kind, row.detail, row.note]);
  assert.deepEqual(rows, [
    ['stop', 'end_turn', null],
    ['stop', 'interrupted', null],
    ['response', 'thinking text', null],
    ['write', 'Edit', null],
    ['tool', 'Read', null],
    ['spark', 'Bash', null],
    ['denied', 'Bash', 'user_temporary'],
    ['denied', 'Write', 'permission-rule'],
    ['compact', '630000>15000', 'auto'],
    ['retry', '3/10', null],
    ['fault', '529', null],
    ['fault', 'network', null],
    ['limit', 'five_hour', null],
    ['gap', 'shrunk', null],
  ]);
  for (const row of state.tape) {
    assert.equal(row.nodeId, 's1');
    assert.equal(row.worldId, 'w1');
  }
  assert.ok(!JSON.stringify(state.tape).includes('secret'), 'a tool target never reaches the Tape');
  assert.equal(new Set(state.tape.map((row) => row.id)).size, state.tape.length);

  const node = state.nodes.s1!;
  assert.equal(node.toolCalls, 2);
  assert.equal(node.errors, 4, 'two tool errors and two api errors');
  assert.equal(node.lastToolName, 'Read');
  assert.equal(node.model, 'opus');
  assert.equal(state.sessions.s1?.model, 'opus');
  assert.equal(state.sessions.s1?.contextTokens, 15_000, 'a compaction drops the altitude');
  assert.deepEqual(state.sessions.s1?.lastRateLimit, { type: 'five_hour', status: 'rejected', resetsAt: T0 + 9 });
  assert.equal(state.sensor.tailResets, 1);
});

test('usage goes to the node, and to the session only from the main node', () => {
  const state = fleet();
  const main = reduce(state, [ev({ type: 'usage.changed', usage: usage({ output: 9 }), cost: cost(2), ...onNode('s1') })]);
  assert.equal(main.sessions.s1?.usage.output, 9);
  assert.equal(main.sessions.s1?.cost.usd, 2);
  assert.equal(main.nodes.s1?.cost.usd, 2);
  const sub = reduce(state, [ev({ type: 'usage.changed', usage: usage({ output: 9 }), cost: cost(2), ...onNode('s1/a1') })]);
  assert.equal(sub.sessions.s1?.usage.output, 0);
  assert.equal(sub.nodes['s1/a1']?.usage.output, 9);
});

test('a transcript event records its flush lag and time', () => {
  const event = { ...ev({ type: 'turn.started', origin: 'human', ...onNode('s1') }, T0 + 1000), observedAt: T0 + 1400 } as NaosEvent;
  const out = reduce(fleet(), [event]);
  assert.equal(out.nodes.s1?.flushLagMs, 400);
  assert.equal(out.nodes.s1?.lastRecordAt, T0 + 1000);
  assert.equal(out.sessions.s1?.lastRecordAt, T0 + 1000);
});

test('the tape stays bounded across batches and inside one large batch', () => {
  let state = fleet();
  for (let i = 0; i < 400; i++) state = reduce(state, [ev({ type: 'turn.ended', stopReason: `r${i}`, ...onNode('s1') })]);
  assert.equal(state.tape.length, TAPE_LIMIT);
  assert.equal(last(state).detail, 'r399');
  assert.equal(state.tape[0]?.detail, `r${400 - TAPE_LIMIT}`);

  const batch: NaosEvent[] = [];
  for (let i = 0; i < 1000; i++) batch.push(ev({ type: 'turn.ended', stopReason: `b${i}`, ...onNode('s1') }));
  const big = reduce(state, batch);
  assert.equal(big.tape.length, TAPE_LIMIT);
  assert.equal(last(big).detail, 'b999');
  assert.equal(big.tape[0]?.detail, `b${1000 - TAPE_LIMIT}`);

  const few = reduce(state, [ev({ type: 'turn.ended', stopReason: 'one', ...onNode('s1') })]);
  assert.equal(few.tape.length, TAPE_LIMIT);
  assert.equal(few.tape[0]?.detail, state.tape[1]?.detail);
});

test('a large batch stays cheap on a large fleet', () => {
  const sessions = Array.from({ length: 200 }, (_, i) => session(`s${i}`));
  let state = reduce(emptyState(), sessions.map(discovered));
  const nodes: NaosEvent[] = [];
  for (const s of sessions) for (let a = 0; a < 10; a++) nodes.push(started(agent(s.sessionId, `a${a}`)));
  state = reduce(state, nodes);
  assert.equal(Object.keys(state.nodes).length, 2200);

  const batch: NaosEvent[] = [];
  for (let i = 0; i < 20_000; i++) {
    const s = `s${i % 200}`;
    batch.push(ev({ type: 'tool.started', toolUseId: `t${i}`, name: 'Read', toolFamily: 'read', summary: { target: null, shape: 'Read' }, ...onNode(`${s}/a${i % 10}`) }));
  }
  const started_ = performance.now();
  const out = reduce(state, batch);
  const ms = performance.now() - started_;
  assert.equal(out.tape.length, TAPE_LIMIT);
  assert.ok(ms < 200, `20,000 events took ${ms.toFixed(1)} ms`);
});

test('approval lifecycle: requested, answered, first ending wins', () => {
  let state = reduce(fleet(), [ev({ type: 'approval.requested', approval: approval('r1') })]);
  assert.equal(state.approvals.r1?.status, 'open');
  assert.equal(last(state).kind, 'need');
  assert.equal(last(state).detail, 'Bash');

  state = reduce(state, [ev({ type: 'approval.answered', requestId: 'r1', agentId: 'a1', outcome: 'deny', by: 'client-1' }, T0 + 5000)]);
  assert.equal(state.approvals.r1?.status, 'answered');
  assert.equal(state.approvals.r1?.outcome, 'deny');
  assert.equal(state.approvals.r1?.answeredBy, 'client-1');
  assert.equal(state.approvals.r1?.answeredAt, T0 + 5000);
  assert.equal(last(state).kind, 'answered');
  assert.equal(last(state).detail, 'deny');

  const after = reduce(state, [
    ev({ type: 'approval.answered', requestId: 'r1', agentId: 'a1', outcome: 'approve', by: 'client-2' }),
    ev({ type: 'approval.cancelled', requestId: 'r1', agentId: 'a1', reason: 'late' }),
  ]);
  assert.equal(after.approvals.r1, state.approvals.r1);
  assert.equal(after.tape, state.tape);
});

test('approval lifecycle: withdrawn and expired', () => {
  const state = reduce(fleet(), [
    ev({ type: 'approval.requested', approval: approval('r1') }),
    ev({ type: 'approval.requested', approval: approval('r2') }),
  ]);
  const out = reduce(state, [
    ev({ type: 'approval.cancelled', requestId: 'r1', agentId: 'a1', reason: 'aborted' }, T0 + 7),
    ev({ type: 'approval.expired', requestId: 'r2' }, T0 + 8),
  ]);
  assert.equal(out.approvals.r1?.status, 'withdrawn');
  assert.equal(out.approvals.r1?.answeredAt, T0 + 7);
  assert.equal(out.approvals.r1?.outcome, null);
  assert.equal(out.approvals.r2?.status, 'expired');
  assert.deepEqual(out.tape.slice(-2).map((row) => row.detail), ['withdrawn', 'expired']);
});

test('an approval for a node not yet known is kept, a decision must reach the rail', () => {
  const out = reduce(emptyState(), [ev({ type: 'approval.requested', approval: approval('r1', { nodeId: 'pending:a1' }) })]);
  assert.equal(out.approvals.r1?.status, 'open');
});

test('settled approvals stay bounded and open ones are never dropped', () => {
  const batch: NaosEvent[] = [ev({ type: 'approval.requested', approval: approval('open') })];
  for (let i = 0; i < 100; i++) {
    batch.push(ev({ type: 'approval.requested', approval: approval(`r${i}`) }));
    batch.push(ev({ type: 'approval.answered', requestId: `r${i}`, agentId: 'a1', outcome: 'approve', by: 'c' }, T0 + i));
  }
  const out = reduce(fleet(), batch);
  const rows = Object.values(out.approvals);
  assert.equal(rows.filter((a) => a.status !== 'open').length, SETTLED_APPROVAL_LIMIT);
  assert.equal(out.approvals.open?.status, 'open');
  assert.ok(out.approvals.r99);
  assert.equal(out.approvals.r0, undefined);
});

test('salvo lifecycle: opened, joined, closed', () => {
  let state = reduce(fleet(), [ev({ type: 'salvo.opened', salvo: salvo('sv1') })]);
  assert.deepEqual([last(state).kind, last(state).detail, last(state).note], ['salvo', '3', 'sv1']);
  assert.equal(last(state).worldId, 'w1');

  const untouched = state.salvos.sv1;
  state = reduce(state, [ev({ type: 'salvo.joined', salvoId: 'sv1', nodeId: 's1/d' })]);
  assert.deepEqual(state.salvos.sv1?.nodeIds, ['s1/a', 's1/b', 's1/c', 's1/d']);
  assert.deepEqual(untouched?.nodeIds, ['s1/a', 's1/b', 's1/c']);

  const same = reduce(state, [ev({ type: 'salvo.joined', salvoId: 'sv1', nodeId: 's1/d' })]);
  assert.equal(same.salvos, state.salvos);

  const closing = { ...ev({ type: 'salvo.closed', salvoId: 'sv1' }, T0 + 100), observedAt: T0 + 180 } as NaosEvent;
  state = reduce(state, [closing]);
  assert.equal(state.salvos.sv1?.closedAt, T0 + 180, 'salvo times are on observedAt');
});

test('salvos stay bounded, closed ones leave first and oldest first', () => {
  let state = reduce(fleet(), [ev({ type: 'salvo.opened', salvo: salvo('live', { openedAt: T0 - 5 }) })]);
  const batch: NaosEvent[] = [];
  for (let i = 0; i < SALVO_LIMIT + 10; i++) {
    batch.push(ev({ type: 'salvo.opened', salvo: salvo(`sv${i}`, { openedAt: T0 + i, closedAt: T0 + i }) }));
  }
  state = reduce(state, batch);
  assert.equal(Object.keys(state.salvos).length, SALVO_LIMIT);
  assert.ok(state.salvos.live, 'an open salvo outlives closed ones');
  assert.equal(state.salvos.sv0, undefined);
  assert.equal(state.salvos.sv10, undefined);
  assert.ok(state.salvos.sv11);
  assert.ok(state.salvos[`sv${SALVO_LIMIT + 9}`]);
});

test('eviction removes a session with its nodes, workflows, acks and settled approvals', () => {
  const before = reduce(fleet(), [
    ev({ type: 'workflow.changed', workflow: workflow('wf1'), ...onNode('s1') }),
    ev({ type: 'fault.acked', nodeId: 's1/a1' }),
    ev({ type: 'approval.requested', approval: approval('settled', { nodeId: 's1' }) }),
    ev({ type: 'approval.answered', requestId: 'settled', agentId: 'a1', outcome: 'approve', by: 'c' }),
    ev({ type: 'approval.requested', approval: approval('open', { nodeId: 's1' }) }),
    ev({ type: 'salvo.opened', salvo: salvo('sv1') }),
    ev({ type: 'managed.upserted', agent: managed('a1') }),
  ]);
  assert.deepEqual(before.sessions.s1?.workflowRunIds, ['wf1']);
  const out = reduce(before, [ev({ type: 'fleet.evicted', sessionIds: ['s1'] })]);
  assert.equal(out.sessions.s1, undefined);
  assert.equal(out.nodes.s1, undefined);
  assert.equal(out.nodes['s1/a1'], undefined);
  assert.equal(out.workflows.wf1, undefined);
  assert.equal(out.acked['s1/a1'], undefined);
  assert.equal(out.approvals.settled, undefined);
  assert.ok(out.approvals.open, 'an open decision is never evicted');
  assert.ok(out.salvos.sv1, 'a burned spoke outlives its craft');
  assert.ok(out.managed.a1, 'managed rows leave with managed.removed');
  assert.equal(out.sessions.s2, before.sessions.s2);
  assert.equal(out.nodes.s2, before.nodes.s2);
  assert.equal(out.worlds, before.worlds);
});

test('managed lifecycle: upsert, tape on transitions only, removal clears grants', () => {
  const grant = { agentId: 'a1', rule: 'Write', scope: 'session' as const, grantedAt: T0 };
  let state = reduce(emptyState(), [ev({ type: 'managed.upserted', agent: managed('a1', { state: 'queued' }) })]);
  assert.deepEqual(kinds(state), [], 'waiting on the Pad is no launch');

  const to = (s: ManagedAgentView['state']) => ev({ type: 'managed.upserted', agent: managed('a1', { state: s }) });
  state = reduce(state, [to('spawning'), to('spawning'), to('running'), to('stopping'), to('exited')]);
  assert.deepEqual(state.tape.map((row) => [row.kind, row.detail]), [['launch', 'build'], ['stop', 'stopping'], ['land', 'exited']]);
  assert.equal(state.managed.a1?.state, 'exited');
  assert.deepEqual(kinds(reduce(state, [to('crashed')])).at(-1), 'fault');
  assert.deepEqual(kinds(reduce(state, [to('budget_exhausted')])).at(-1), 'limit');

  state = reduce(state, [ev({ type: 'standing.changed', agentId: 'a1', grants: [grant] })]);
  assert.deepEqual(state.standing.a1, [grant]);
  const cleared = reduce(state, [ev({ type: 'standing.changed', agentId: 'a1', grants: [] })]);
  assert.equal(cleared.standing.a1, undefined);
  const removed = reduce(state, [ev({ type: 'managed.removed', agentId: 'a1' })]);
  assert.equal(removed.managed.a1, undefined);
  assert.equal(removed.standing.a1, undefined);
});

test('an owned session taped by control state lands once', () => {
  const state = reduce(emptyState(), [
    discovered(session('s1', { origin: 'control' })),
    ev({ type: 'managed.upserted', agent: managed('a1', { state: 'spawning' }) }),
    ev({ type: 'managed.upserted', agent: managed('a1', { state: 'exited' }) }),
    ev({ type: 'session.ended', outcome: 'clean', reason: 'exit', ...onNode('s1') }),
  ]);
  assert.deepEqual(kinds(state), ['launch', 'land']);
});

test('fleet-wide events replace their slice', () => {
  const state = fleet();
  const plan = { fiveHourLeft: 0.5, sevenDayLeft: 0.8, asOf: T0, resetsAt: { fiveHour: null, sevenDay: null }, status: 'allowed' as const };
  const admission = { ...state.admission, running: 2, frozen: 'operator' as const };
  const progress = { stage: 'usage' as const, done: 3, total: 9 };
  const sensor = { unknownRecords: 1, unknownFields: 2, tailResets: 3, parseErrors: 4 };
  const out = reduce(state, [
    ev({ type: 'plan.changed', plan }),
    ev({ type: 'admission.changed', admission }),
    ev({ type: 'profiles.changed', profiles: [] }),
    ev({ type: 'index.progress', progress }),
    ev({ type: 'sensor.changed', sensor }),
    ev({ type: 'world.upserted', world: world('w3') }),
  ]);
  assert.equal(out.plan, plan);
  assert.equal(out.admission, admission);
  assert.equal(out.index, progress);
  assert.equal(out.sensor, sensor);
  assert.ok(out.worlds.w3);
  assert.equal(out.worlds.w1, state.worlds.w1);

  const rejected = { ...plan, status: 'rejected' as const };
  const limited = reduce(out, [ev({ type: 'plan.changed', plan: rejected })]);
  assert.deepEqual([last(limited).kind, last(limited).detail], ['limit', 'plan']);
  assert.equal(reduce(limited, [ev({ type: 'plan.changed', plan: rejected })]).tape.length, limited.tape.length);
});

test('a refused spawn names the limit on the Tape', () => {
  const state = reduce(fleet(), [ev({ type: 'managed.upserted', agent: managed('a1', { nodeId: 's1' }) })]);
  const out = reduce(state, [ev({ type: 'spawn.refused', parentAgentId: 'a1', worldId: null, limit: 'depth' })]);
  assert.deepEqual([last(out).kind, last(out).detail, last(out).nodeId, last(out).worldId], ['limit', 'depth', 's1', 'w1']);
  const noParent = reduce(state, [ev({ type: 'spawn.refused', parentAgentId: null, worldId: 'w2', limit: 'running' })]);
  assert.deepEqual([last(noParent).nodeId, last(noParent).worldId], [null, 'w2']);
});

test('fault.acked records the time, also for a craft with no node yet', () => {
  const state = reduce(fleet(), [ev({ type: 'managed.upserted', agent: managed('a9', { nodeId: 'pending:a9', sessionId: null }) })]);
  const out = reduce(state, [
    ev({ type: 'fault.acked', nodeId: 's1/a1' }, T0 + 3),
    ev({ type: 'fault.acked', nodeId: 'pending:a9' }, T0 + 4),
  ]);
  assert.equal(out.acked['s1/a1'], T0 + 3);
  assert.equal(out.acked['pending:a9'], T0 + 4);
});

test('stream-only events change nothing but seq', () => {
  const state = fleet();
  const row: HistoryDigest = {
    nodeId: 'x', sessionId: 'x', worldId: 'w1', projectRoot: null, kind: 'teammate', parentNodeId: null, startedAt: T0, endedAt: null,
    model: null, bytes: 0, usd: null, blockedMs: null, outcome: 'unknown',
  };
  const out = reduce(state, [
    ev({ type: 'history.digest', rows: [row] }),
    ev({ type: 'history.expired', nodeIds: ['x'] }),
    ev({ type: 'link.fired', kind: 'send', from: 's1', to: 's2' }),
  ]);
  assert.deepEqual({ ...out, seq: state.seq }, state);
  assert.equal(out.tape, state.tape);
});

test('batching does not change the result: one batch equals the same events one by one', () => {
  const events = [
    discovered(session('s1')),
    started(agent('s1', 'a1')),
    ev({ type: 'activity.changed', activity: { state: 'waiting', since: T0 + 1, reason: 'dialog open' }, ...onNode('s1') }),
    ev({ type: 'activity.changed', activity: { state: 'generating', since: T0 + 9 }, ...onNode('s1') }),
    ev({ type: 'tool.started', toolUseId: 't', name: 'Read', toolFamily: 'read', summary: { target: null, shape: '' }, ...onNode('s1/a1') }),
    ev({ type: 'salvo.opened', salvo: salvo('sv') }),
    ev({ type: 'approval.requested', approval: approval('r') }),
    ev({ type: 'approval.answered', requestId: 'r', agentId: 'a1', outcome: 'approve', by: 'c' }),
    ev({ type: 'agent.ended', status: 'completed', ...onNode('s1/a1') }),
    ev({ type: 'session.ended', outcome: 'clean', reason: 'exit', ...onNode('s1') }),
  ];
  const whole = reduce(emptyState(), events);
  const single = events.reduce((state, event) => reduce(state, [event]), emptyState());
  assert.deepEqual(whole, single);
  assert.deepEqual(JSON.parse(JSON.stringify(whole)), whole, 'a snapshot survives JSON unchanged');
});

test('COMMAND_SCOPES gives MCP no route to approvals, trust or All stop', () => {
  for (const command of ['approval.answer', 'world.trust', 'world.rename', 'world.design', 'agent.stopAll'] satisfies CommandType[]) {
    assert.ok(!COMMAND_SCOPES[command].includes('mcp' satisfies AuthScope), command);
    assert.deepEqual(COMMAND_SCOPES[command], ['ui']);
  }
});

test('every command names at least the ui scope', () => {
  for (const [command, scopes] of Object.entries(COMMAND_SCOPES)) assert.ok(scopes.includes('ui'), command);
});
