import assert from 'node:assert/strict';
import os from 'node:os';
import { after, before, describe, test } from 'node:test';
import { COMMAND_SCOPES, reduce } from '@naos/protocol';
import type {
  ChannelRow, CommandMap, CommandType, FleetState, LedgerReport, ManagedAgentView, ObservedAgentNode, ServerFrames,
} from '@naos/protocol';
import { buildHistory } from '../../src/fixture/history.ts';
import { DURATION_S, FIXTURE_EPOCH, REFERENCE_T, WORLDS, worldIdOf } from '../../src/fixture/scene.ts';
import { buildIdleTimeline, buildTimeline, rateAt, stateAt } from '../../src/fixture/timeline.ts';
import type { Timeline } from '../../src/fixture/timeline.ts';
import { boot, connect, post, run, sleep } from './helpers.ts';
import type { Client, TestKernel } from './helpers.ts';

const history = buildHistory(FIXTURE_EPOCH);
const timeline = buildTimeline(history);

/** DESIGN section 6, copied here so this test does not wait for the UI's core/state.ts. */
function visualState(c: {
  owned: boolean; control?: string; activity: string; backgroundShell?: boolean; errorKind?: string; outcome?: string; agentStatus?: string; decisionTool?: string;
  liveBlock?: 'thinking' | 'text' | null; silentMs: number; dead?: boolean;
}): string {
  const fromControl: Record<string, string> = {
    queued: 'queued', spawning: 'spawning', ready: 'ready', parked: 'parked', budget_exhausted: 'no-budget', rate_limited: 'rate-limited', stopping: 'stopping',
    exited: 'exited', crashed: 'crashed', lost: 'lost',
  };
  const mapped = c.control && fromControl[c.control];
  if (mapped) return mapped;
  if (c.decisionTool) return c.decisionTool === 'AskUserQuestion' ? 'answer' : c.decisionTool === 'ExitPlanMode' ? 'plan' : 'approve';
  if (c.agentStatus === 'orphaned' || c.dead) return 'orphaned';
  if (c.agentStatus === 'stopped') return 'stopped';
  if (c.agentStatus === 'failed') return 'failed';
  if (c.agentStatus === 'completed') return 'finished';
  switch (c.activity) {
    case 'starting': return 'starting';
    case 'waiting': return c.owned ? 'approve' : 'source';
    case 'tool_running': return 'tool';
    case 'retrying': return 'retrying';
    case 'compacting': return 'compacting';
    case 'interrupted': return 'interrupted';
    case 'idle': return c.backgroundShell ? 'idle-shell' : 'idle';
    case 'errored': return c.errorKind === 'rate_limit' ? 'rate-limited' : 'errored';
    case 'finished': return c.outcome === 'abandoned' ? 'abandoned' : 'finished';
    case 'generating':
      if (c.owned && c.liveBlock === 'thinking') return 'thinking';
      if (c.owned && c.liveBlock === 'text') return 'writing';
      return c.silentMs >= 120_000 ? 'no-signal' : 'generating';
    default: return 'unknown';
  }
}

function visualOf(state: FleetState, node: ObservedAgentNode, at: number, source: Timeline): string {
  const session = state.sessions[node.sessionId];
  const isRoot = session?.rootNodeId === node.nodeId;
  const owner = isRoot ? Object.values(state.managed).find((agent) => agent.nodeId === node.nodeId) : undefined;
  const decisions = Object.values(state.approvals)
    .filter((row) => row.status === 'open' && row.nodeId === node.nodeId)
    .sort((a, b) => a.createdAt - b.createdAt);
  const lane = source.lanes.find((row) => row.nodeId === node.nodeId);
  const activity = node.activity;
  return visualState({
    owned: owner !== undefined,
    ...(owner ? { control: owner.state } : {}),
    activity: activity.state,
    ...(activity.state === 'idle' ? { backgroundShell: activity.backgroundShell } : {}),
    ...(activity.state === 'errored' ? { errorKind: activity.kind } : {}),
    ...(activity.state === 'finished' ? { outcome: activity.outcome } : {}),
    agentStatus: node.status,
    ...(decisions[0] ? { decisionTool: decisions[0].toolName } : {}),
    liveBlock: lane ? rateAt(lane, at).block : null,
    silentMs: Math.max(0, source.base + at - (node.lastRecordAt ?? 0)),
    dead: isRoot && session?.liveness === 'dead',
  });
}

const ALL_STATES = [
  'queued', 'spawning', 'starting', 'ready', 'thinking', 'writing', 'generating', 'tool', 'approve', 'answer', 'plan', 'source', 'parked', 'idle', 'idle-shell',
  'interrupted', 'compacting', 'retrying', 'no-signal', 'rate-limited', 'errored', 'no-budget', 'stopping', 'crashed', 'orphaned', 'lost', 'finished', 'exited',
  'abandoned', 'failed', 'stopped', 'unknown',
];

describe('the timeline', () => {
  test('t = 0 holds twenty craft on five worlds, plus two idle worlds', () => {
    const { state } = stateAt(timeline, 0);
    assert.equal(Object.keys(state.nodes).length, 20);
    assert.equal(Object.keys(state.sessions).length, 14);
    assert.equal(Object.keys(state.worlds).length, 7);
    const busy = new Set(Object.values(state.sessions).map((session) => state.worlds[session.worldId]?.name));
    assert.deepEqual([...busy].sort(), ['harbor', 'kestrel', 'lumen', 'mosaic', 'tundra']);
    assert.deepEqual(Object.values(state.worlds).sort((a, b) => a.slot - b.slot).map((world) => world.name), WORLDS.map((world) => world.name));
    assert.ok(Object.values(state.sessions).some((session) => session.origin === 'control'));
    assert.ok(Object.values(state.sessions).some((session) => session.origin === 'observer'));
  });

  test('t = 60 is the reference scene', () => {
    const at = REFERENCE_T * 1000;
    const { state } = stateAt(timeline, at);
    const base = timeline.base;
    const live = Object.values(state.nodes).filter((node) => node.endedAt === null);
    assert.equal(live.length, 20, '20 craft');

    const byTitle = (title: string) => Object.values(state.sessions).find((session) => session.title === title)!;
    const age = (since: number) => Math.round((base + at - since) / 1000);

    const open = Object.values(state.approvals).filter((row) => row.status === 'open');
    assert.equal(open.length, 1, 'YOU 1');
    assert.equal(open[0]!.toolName, 'Bash');
    assert.equal(open[0]!.input.command, 'npm install --save-dev vitest@4');
    assert.equal(age(open[0]!.createdAt), 41, 'APPROVE 0:41');

    assert.equal(age(byTitle('docs sweep').activity.since), 41, 'THINK 41 s');
    assert.equal(age(byTitle('migrate types').activity.since), 6, 'EDIT 0:06');
    assert.ok(byTitle('migrate types').contextTokens! >= 812_000, 'LOW 1');
    assert.equal(age(byTitle('audit callers').activity.since), 12, 'SHELL 12 s');
    assert.equal(age(byTitle('changelog').activity.since), 720, 'IDLE 12 m');
    assert.equal(byTitle('offline sync').activity.state, 'waiting');
    assert.equal(age(byTitle('offline sync').activity.since), 12, 'SOURCE 0:12');
    assert.equal(age(byTitle('lint fixes').activity.since), 11, 'MODEL 11 s');
    assert.equal(byTitle('shader pass').activity.state, 'errored');
    const retry = byTitle('bundle size').activity;
    assert.equal(retry.state, 'retrying');
    if (retry.state === 'retrying') {
      assert.equal(retry.attempt, 3);
      assert.equal(retry.maxRetries, 10);
      assert.equal((retry.nextAttemptAt! - (base + at)) / 1000, 8, 'next in 8 s');
    }

    const flow = Object.values(state.workflows)[0]!;
    assert.equal(flow.status, 'running');
    assert.equal(flow.counts.started, 12);
    assert.equal(flow.counts.completed, 7, '7 of 12');
    assert.equal(flow.phases.length, 2, 'phase 2');
    assert.equal(state.plan?.fiveHourLeft, 0.58);
    assert.equal(state.plan?.sevenDayLeft, 0.82);
    assert.equal(state.admission.running, 4);
    assert.equal(state.admission.alive, 9);

    const rates = timeline.lanes.reduce((sum, lane) => sum + rateAt(lane, at).tps, 0);
    assert.ok(rates > 1500 && rates < 2200, `RATE about 1,840, got ${rates}`);
  });

  test('launch order gives the Greek letters of the reference', () => {
    const { state } = stateAt(timeline, REFERENCE_T * 1000);
    const titles = (world: string): string[] => Object.values(state.sessions)
      .filter((session) => session.worldId === worldIdOf(world))
      .sort((a, b) => a.startedAt! - b.startedAt!)
      .map((session) => session.title!);
    assert.deepEqual(titles('kestrel'), ['rate limiter', 'fix flaky queue', 'docs sweep', 'migrate types']);
    assert.deepEqual(titles('tundra'), ['ledger pass', 'audit callers', 'changelog']);
    assert.deepEqual(titles('mosaic'), ['tile cache', 'shader pass', 'bundle size']);
    assert.deepEqual(titles('lumen').slice(0, 2), ['offline sync', 'lint fixes']);
  });

  test('every rate lane runs forward in time', () => {
    for (const lane of timeline.lanes) {
      for (let index = 1; index < lane.segments.length; index += 1) {
        assert.ok(lane.segments[index]!.t >= lane.segments[index - 1]!.t, `${lane.nodeId} at ${lane.segments[index]!.t}`);
      }
    }
  });

  test('no owned craft flies through Totality', () => {
    const { state } = stateAt(timeline, 158_000);
    const flying = Object.values(state.managed).filter((agent) => agent.state === 'running');
    const live = flying.filter((agent) => state.nodes[agent.nodeId]?.activity.state === 'generating');
    assert.deepEqual(live.map((agent) => agent.title), []);
  });

  test('every state of DESIGN section 6 occurs', () => {
    const seen = new Set<string>();
    const pending = new Set<string>();
    for (let t = 0; t < DURATION_S * 1000; t += 250) {
      const { state } = stateAt(timeline, t);
      for (const node of Object.values(state.nodes)) seen.add(visualOf(state, node, t, timeline));
      for (const agent of Object.values(state.managed)) {
        if (agent.nodeId.startsWith('pending:')) pending.add(agent.state);
      }
    }
    for (const state of pending) seen.add(state);
    const missing = ALL_STATES.filter((state) => !seen.has(state));
    assert.deepEqual(missing, []);
  });

  test('every tool family fires, and danger, serial and both special tools are asked', () => {
    const events = timeline.steps.map((step) => step.event);
    const families = new Set(events.flatMap((event) => (event.type === 'tool.started' ? [event.toolFamily] : [])));
    for (const family of ['shell', 'read', 'edit', 'web', 'mcp', 'launch', 'send', 'other']) assert.ok(families.has(family as never), family);
    const asked = events.flatMap((event) => (event.type === 'approval.requested' ? [event.approval] : []));
    assert.ok(asked.some((row) => row.toolFamily === 'ask' && row.toolName === 'AskUserQuestion'));
    assert.ok(asked.some((row) => row.toolName === 'ExitPlanMode'));
    assert.ok(asked.some((row) => row.danger && row.defaultToNo && row.decisionReason));
    assert.ok(asked.some((row) => row.callIndex === 2 && row.callCount === 2));
    assert.ok(asked.some((row) => row.subagentId !== null));
    assert.ok(asked.some((row) => row.mcpServer !== null));
  });

  test('the set pieces are all on the timeline', () => {
    const types = new Set(timeline.steps.map((step) => step.event.type));
    for (const type of ['salvo.opened', 'salvo.joined', 'salvo.closed', 'approval.requested', 'approval.answered', 'approval.cancelled', 'approval.expired', 'api.retry',
      'api.error', 'compacted', 'rate_limit.hit', 'spawn.refused', 'link.fired', 'tool.denied', 'tail.reset', 'sensor.changed', 'standing.changed', 'history.digest', 'workflow.changed'] as const) {
      assert.ok(types.has(type), type);
    }
    const plans = timeline.steps.flatMap((step) => (step.event.type === 'plan.changed' ? [step.event.plan.status] : []));
    assert.deepEqual(plans, ['allowed', 'allowed', 'allowed_warning', 'rejected', 'allowed']);
    const { state } = stateAt(timeline, 158_000);
    assert.equal(state.plan?.fiveHourLeft, 0, 'Totality');
    assert.equal(state.admission.frozen, 'plan-window');
    assert.equal(stateAt(timeline, 170_000).state.plan?.fiveHourLeft, 1, 'Diamond ring');
    const end = stateAt(timeline, 179_000).state;
    assert.equal(Object.values(end.workflows)[0]?.status, 'completed');
    assert.equal(Object.values(end.workflows)[0]?.counts.cached, 2);
  });

  test('managed views never go back in time', () => {
    const last = new Map<string, ManagedAgentView>();
    for (const { event } of timeline.steps) {
      if (event.type !== 'managed.upserted') continue;
      const previous = last.get(event.agent.agentId);
      if (previous) assert.ok(event.agent.toolCalls >= previous.toolCalls, `${event.agent.agentId} tool calls fell`);
      last.set(event.agent.agentId, event.agent);
    }
  });

  test('step times only rise, and event ids are unique', () => {
    const ids = new Set<string>();
    let previous = -1;
    for (const { t, event } of timeline.steps) {
      assert.ok(t >= previous);
      previous = t;
      assert.ok(!ids.has(event.id), event.id);
      ids.add(event.id);
      assert.ok(event.at <= event.observedAt, 'a record cannot arrive before it was written');
    }
  });

  test('replaying step by step equals replaying in one go', () => {
    const at = 137_000;
    const whole = stateAt(timeline, at).state;
    let stepped: FleetState = { ...timeline.initial, lastTickAt: timeline.base + at };
    for (const step of timeline.steps) {
      if (step.t > at) break;
      stepped = reduce(stepped, [step.event]);
    }
    assert.deepEqual(stepped, whole);
  });

  test('two builds are identical', () => {
    assert.deepEqual(buildTimeline(buildHistory(FIXTURE_EPOCH)).steps, timeline.steps);
  });

  test('the morning of naos-idle.png: no craft, the plan, two to resume', () => {
    const { state } = stateAt(buildIdleTimeline(history), 0);
    assert.equal(Object.keys(state.sessions).length, 0);
    assert.equal(Object.keys(state.worlds).length, 7);
    assert.equal(state.plan?.fiveHourLeft, 0.88);
    assert.equal(state.index.stage, 'done');
    assert.equal(Object.values(state.managed).filter((agent) => agent.resumable).length, 2);
  });

  test('the month has the heavy tail of the survey, so mass reads on a log scale', () => {
    const { kestrel, harbor, ferro } = history.mass;
    assert.ok(Math.abs(harbor!.bytes / 1_048_576 - 1154) < 1);
    assert.ok(Math.abs(harbor!.usd - 300) < 1 && Math.abs(kestrel!.usd - 240) < 1);
    assert.ok(ferro!.usd < 0.2 && ferro!.bytes > 0);
    assert.ok(history.rows.filter((row) => row.kind !== 'main').length > history.rows.length / 2, 'most transcripts are agents');
  });

  test('thirty days of history, placeholder only, and the shape of the reference rail', () => {
    assert.ok(history.rows.length > 300);
    const span = FIXTURE_EPOCH - history.rows[0]!.startedAt;
    assert.ok(span > 28 * 86_400_000 && span <= 30 * 86_400_000, `${span}`);
    assert.ok(history.salvos.length > 5);
    const hour = history.rows.filter((row) => row.endedAt !== null && row.endedAt >= FIXTURE_EPOCH - 3_600_000 && row.endedAt <= FIXTURE_EPOCH);
    const harbor = hour.filter((row) => row.worldId === worldIdOf('harbor'));
    assert.ok(harbor.filter((row) => row.outcome === 'failed').length >= 1);
    assert.ok(harbor.filter((row) => row.outcome === 'clean').length >= 11);
  });
});

describe('fixture over the wire', () => {
  let kernel: TestKernel;
  let client: Client;

  const control = (action: string, value?: number) => run<CommandMap['fixture.control']['out']>(kernel, { type: 'fixture.control', action, ...(value === undefined ? {} : { value }) });
  const snapshotAfter = async (start: number): Promise<ServerFrames['snapshot']> =>
    (await client.until((frame) => frame.t === 'snapshot', 5000, start)) as ServerFrames['snapshot'];
  const seek = async (t: number): Promise<FleetState> => {
    const start = client.frames.length;
    await control('seek', t);
    return (await snapshotAfter(start)).state;
  };
  const comparable = (state: FleetState) => ({ ...state, seq: 0, kernel: { ...state.kernel!, pid: 0 } });

  before(async () => {
    kernel = await boot('fixture');
    await control('pause');
    client = await connect(kernel);
    await client.until((frame) => frame.t === 'snapshot');
  });
  after(async () => {
    client.close();
    await kernel.close();
  });

  test('a snapshot over a real WebSocket holds twenty craft', async () => {
    const state = await seek(0);
    assert.equal(Object.keys(state.nodes).length, 20);
  });

  test('every command in the contract has a handler', () => {
    for (const type of Object.keys(COMMAND_SCOPES) as CommandType[]) assert.ok(kernel.router.has(type), type);
  });

  test('a rename shows at once and clears back to its own name', async () => {
    const world = Object.values(kernel.bus.state().worlds)[0]!;
    assert.deepEqual(await run(kernel, { type: 'world.rename', worldId: world.worldId, name: ' The Bench ' }), { name: 'The Bench' });
    assert.equal(kernel.bus.state().worlds[world.worldId]?.renamed, true);
    assert.deepEqual(await run(kernel, { type: 'world.rename', worldId: world.worldId, name: null }), { name: world.name });
    assert.equal(kernel.bus.state().worlds[world.worldId]?.renamed, false);
  });

  test('world.design writes a planet, and the name is not a launch profile', async () => {
    const world = Object.values(kernel.bus.state().worlds)[0]!;
    const receipt = await run<CommandMap['world.design']['out']>(kernel, { type: 'world.design', worldId: world.worldId });
    assert.deepEqual(receipt, { agentIds: [], queued: 0 });
    const designed = kernel.bus.state().worlds[world.worldId];
    assert.equal(designed?.genome?.archetype, 'terran');
    assert.ok(designed?.designedAt);
    const named = await post(kernel, { type: 'agent.spawn', spec: { worldId: world.worldId, profile: 'world-designer', prompt: 'x' } });
    assert.equal(named.status, 400);
    const mcp = await post(kernel, { type: 'world.design', worldId: world.worldId }, { authorization: `Bearer ${kernel.tokens.mcp}` });
    assert.equal(mcp.status, 403);
  });

  test('hello says fixture, and the clock is the timeline\'s', async () => {
    const hello = client.frames.find((frame) => frame.t === 'hello') as ServerFrames['hello'];
    assert.equal(hello.kernel.mode, 'fixture');
    assert.equal(hello.kernel.controlPlane, true);
    await seek(45);
    const start = client.frames.length;
    const rates = (await client.until((frame) => frame.t === 'rates', 2000, start)) as ServerFrames['rates'];
    assert.equal(rates.at, FIXTURE_EPOCH + 45_000);
  });

  test('seek is deterministic: the same t gives the same state, whatever came before', async () => {
    const first = await seek(90);
    await seek(150);
    await seek(3);
    const second = await seek(90);
    assert.deepEqual(comparable(second), comparable(first));
  });

  test('another kernel gives the same state and the same rates at the same t', async () => {
    const other = await boot('fixture');
    try {
      await run(other, { type: 'fixture.control', action: 'pause' });
      await run(other, { type: 'fixture.control', action: 'seek', value: 120 });
      const peer = await connect(other);
      const snapshot = (await peer.until((frame) => frame.t === 'snapshot')) as ServerFrames['snapshot'];
      const rates = (await peer.until((frame) => frame.t === 'rates')) as ServerFrames['rates'];
      peer.close();
      const mine = await seek(120);
      const start = client.frames.length;
      const myRates = (await client.until((frame) => frame.t === 'rates', 2000, start)) as ServerFrames['rates'];
      assert.deepEqual(comparable(snapshot.state), comparable(mine));
      assert.deepEqual(rates, myRates);
    } finally {
      await other.close();
    }
  });

  test('a paused timeline stays still, ticks included', async () => {
    await seek(50);
    const before = kernel.bus.state();
    const start = client.frames.length;
    await sleep(1300);
    const events = client.frames.slice(start).flatMap((frame) => (frame.t === 'events' ? frame.events : []));
    assert.ok(events.length > 0 && events.every((event) => event.type === 'kernel.tick'), 'only ticks');
    assert.ok(events.every((event) => event.at === FIXTURE_EPOCH + 50_000), 'the tick reads the stopped clock');
    assert.deepEqual({ ...kernel.bus.state(), seq: 0 }, { ...before, seq: 0 });
  });

  test('playing reaches the state a seek gives, and an event stream replays to it', async () => {
    await seek(20);
    await control('speed', 16);
    const start = client.frames.length;
    await control('play');
    await sleep(1500);
    const { t } = await control('pause');
    await control('speed', 1);
    await sleep(50);
    assert.ok(t > 21, `it moved, to ${t}`);

    const played = kernel.bus.state();
    let replayed: FleetState = (client.frames.slice(0, start).reverse().find((frame) => frame.t === 'snapshot') as ServerFrames['snapshot']).state;
    for (const frame of client.frames.slice(start)) {
      if (frame.t === 'events') {
        assert.equal(frame.seq - frame.events.length, replayed.seq, 'no gap in the stream');
        replayed = reduce(replayed, frame.events, frame.seq);
      }
    }
    assert.deepEqual({ ...replayed, seq: 0, lastTickAt: 0 }, { ...played, seq: 0, lastTickAt: 0 }, 'the store and the kernel agree');

    const sought = await seek(t);
    assert.deepEqual({ ...sought, seq: 0, lastTickAt: 0 }, { ...played, seq: 0, lastTickAt: 0 }, 'play and seek agree');
  });

  test('the loop wraps to a fresh snapshot', async () => {
    await seek(179.5);
    await control('speed', 16);
    const start = client.frames.length;
    await control('play');
    const snapshot = await snapshotAfter(start);
    await control('pause');
    await control('speed', 1);
    assert.equal(Object.keys(snapshot.state.nodes).length, 20);
    assert.ok(snapshot.state.lastTickAt! >= FIXTURE_EPOCH + DURATION_S * 1000, 'the clock kept rising through the wrap');
    const rates = (await client.until((frame) => frame.t === 'rates', 2000, client.frames.length)) as ServerFrames['rates'];
    assert.ok(rates.fleet.outputTokens > 100_000, 'the corona counter rose through the wrap');
  });

  test('control refuses nonsense', async () => {
    assert.equal((await post(kernel, { type: 'fixture.control', action: 'seek' })).status, 400);
    assert.equal((await post(kernel, { type: 'fixture.control', action: 'seek', value: -1 })).status, 400);
    assert.equal((await post(kernel, { type: 'fixture.control', action: 'speed', value: 0 })).status, 400);
    assert.equal((await post(kernel, { type: 'fixture.control', action: 'dance' })).status, 400);
  });

  const managedOf = (title: string): ManagedAgentView =>
    Object.values(kernel.bus.state().managed).find((agent) => agent.title === `naos:${title}`)!;

  /** Lets the timeline run for a moment, so scheduled follow-ups fire. */
  const runFor = async (ms: number, speed = 8): Promise<void> => {
    await control('speed', speed);
    await control('play');
    await sleep(ms);
    await control('pause');
    await control('speed', 1);
  };

  test('approval.answer moves the craft on, and the second answer finds it settled', async () => {
    await seek(30);
    const open = Object.values(kernel.bus.state().approvals).find((row) => row.status === 'open')!;
    const answer = { type: 'approval.answer', requestId: open.requestId, decision: { kind: 'approve' }, clientId: 'tab-1' };
    assert.deepEqual(await run(kernel, answer), { applied: true });
    const state = kernel.bus.state();
    assert.equal(state.approvals[open.requestId]?.status, 'answered');
    assert.equal(state.approvals[open.requestId]?.answeredBy, 'tab-1');
    const agent = managedOf('fix flaky queue');
    assert.equal(agent.state, 'running');
    assert.equal(agent.openApprovals, 0);
    assert.equal(state.nodes[open.nodeId]?.activity.state, 'generating');
    assert.deepEqual(await run(kernel, { ...answer, clientId: 'tab-2' }), { applied: false });
  });

  test('a scripted event does not overwrite a craft an operator took over', async () => {
    await seek(70);
    const open = Object.values(kernel.bus.state().approvals).find((row) => row.status === 'open')!;
    await run(kernel, { type: 'approval.answer', requestId: open.requestId, decision: { kind: 'approve' }, clientId: 'tab-1' });
    await runFor(800, 8);
    assert.equal(kernel.bus.state().approvals[open.requestId]?.answeredBy, 'tab-1');
    const serial = Object.values(kernel.bus.state().approvals).find((row) => row.callIndex === 2 && row.status === 'open');
    assert.equal(serial, undefined, 'the script no longer drives that craft');
  });

  test('agent.spawn adds a craft with a spawn arc', async () => {
    await seek(20);
    const world = worldIdOf('quill');
    const before = Object.keys(kernel.bus.state().sessions).length;
    const receipt = await run<CommandMap['agent.spawn']['out']>(kernel, { type: 'agent.spawn', spec: { worldId: world, profile: 'build', prompt: 'placeholder', title: 'new craft' } });
    assert.equal(receipt.agentIds.length, 1);
    const id = receipt.agentIds[0]!;
    const flying = kernel.bus.state().managed[id]!;
    assert.equal(flying.state, 'spawning');
    assert.match(flying.nodeId, /^pending:/);
    await runFor(400, 8);
    const landed = kernel.bus.state().managed[id]!;
    assert.equal(landed.state, 'running');
    assert.equal(landed.nodeId, landed.sessionId);
    assert.equal(Object.keys(kernel.bus.state().sessions).length, before + 1);
    assert.equal(kernel.bus.state().sessions[landed.sessionId!]?.worldId, world);
  });

  test('agent.spawn honours copies and the idempotency key, and refuses a bad spec', async () => {
    await seek(20);
    const spec = { worldId: worldIdOf('ferro'), profile: 'scratch', prompt: 'placeholder', copies: 2, idempotencyKey: 'once' };
    const first = await run<CommandMap['agent.spawn']['out']>(kernel, { type: 'agent.spawn', spec });
    const second = await run<CommandMap['agent.spawn']['out']>(kernel, { type: 'agent.spawn', spec });
    assert.equal(first.agentIds.length, 2);
    assert.deepEqual(second, first);
    assert.equal((await post(kernel, { type: 'agent.spawn', spec: { ...spec, profile: 'nope', idempotencyKey: undefined } })).status, 400);
    assert.equal((await post(kernel, { type: 'agent.spawn', spec: { ...spec, worldId: 'nowhere', idempotencyKey: undefined } })).status, 404);
  });

  test('a spawn during Totality is refused with a limit, or queues on request', async () => {
    await seek(155);
    const spec = { worldId: worldIdOf('quill'), profile: 'scratch', prompt: 'placeholder' };
    const reply = await post(kernel, { type: 'agent.spawn', spec });
    assert.equal(reply.status, 429);
    assert.ok(kernel.bus.state().tape.at(-1)?.kind === 'limit');
  });

  test('a craft taken over leaves the script, while its workflow keeps running', async () => {
    await seek(100);
    const owner = managedOf('invoice migrate');
    await run(kernel, { type: 'agent.send', agentId: owner.agentId, text: 'placeholder', priority: 'now' });
    const before = Object.values(kernel.bus.state().workflows)[0]!.counts.completed;
    await runFor(600, 16);
    const after = Object.values(kernel.bus.state().workflows)[0]!.counts.completed;
    assert.ok(after > before, `the workflow moved on, ${before} to ${after}`);
  });

  test('a follow-up shows in the Channel of a craft', async () => {
    await seek(20);
    const agent = managedOf('rate limiter');
    await run(kernel, { type: 'agent.send', agentId: agent.agentId, text: 'placeholder', priority: 'now' });
    const before = (await run<{ rows: ChannelRow[] }>(kernel, { type: 'craft.channel', nodeId: agent.nodeId })).rows.filter((row) => row.kind === 'turn').length;
    await runFor(200, 8);
    const after = (await run<{ rows: ChannelRow[] }>(kernel, { type: 'craft.channel', nodeId: agent.nodeId })).rows.filter((row) => row.kind === 'turn').length;
    assert.equal(after, before + 1);
  });

  test('agent.send queues a follow-up, and the craft takes it', async () => {
    await seek(20);
    const agent = managedOf('rate limiter');
    const { sendId } = await run<CommandMap['agent.send']['out']>(kernel, { type: 'agent.send', agentId: agent.agentId, text: 'placeholder', priority: 'queue' });
    assert.ok(sendId);
    assert.equal(managedOf('rate limiter').queuedSends, 1);
    assert.equal(kernel.bus.state().sessions[agent.sessionId!]?.queuedInputs, 1);
    await runFor(400, 8);
    assert.equal(managedOf('rate limiter').queuedSends, 0);
    assert.equal(kernel.bus.state().sessions[agent.sessionId!]?.queuedInputs, 0);
  });

  test('agent.stop walks the three steps and lands', async () => {
    await seek(30);
    const agent = managedOf('tile cache');
    assert.deepEqual(await run(kernel, { type: 'agent.stop', agentId: agent.agentId }), { result: 'graceful' });
    assert.equal(managedOf('tile cache').state, 'stopping');
    assert.equal(managedOf('tile cache').stopStep, 'interrupt');
    await control('speed', 2);
    await control('play');
    const steps = new Set<string>();
    for (let wait = 0; wait < 400 && managedOf('tile cache').state !== 'exited'; wait += 1) {
      steps.add(String(managedOf('tile cache').stopStep));
      await sleep(5);
    }
    await control('pause');
    await control('speed', 1);
    assert.ok(steps.has('end of input') && steps.has('tree kill'), [...steps].join());
    assert.equal(managedOf('tile cache').state, 'exited');
    assert.deepEqual(await run(kernel, { type: 'agent.stop', agentId: agent.agentId }), { result: 'already-stopped' });
  });

  test('agent.stop withdraws an open request', async () => {
    await seek(30);
    const open = Object.values(kernel.bus.state().approvals).find((row) => row.status === 'open')!;
    await run(kernel, { type: 'agent.stop', agentId: open.agentId });
    assert.equal(kernel.bus.state().approvals[open.requestId]?.status, 'withdrawn');
  });

  test('agent.stopAll stops every owned craft and counts the ones out of reach', async () => {
    await seek(30);
    const live = Object.values(kernel.bus.state().managed).filter((agent) => agent.state !== 'crashed').length;
    const result = await run<CommandMap['agent.stopAll']['out']>(kernel, { type: 'agent.stopAll' });
    assert.equal(result.stopped, live);
    assert.equal(result.outOfReach, 6);
    assert.ok(Object.values(kernel.bus.state().managed).every((agent) => agent.state === 'stopping'));
  });

  test('the rest of agent.* answers', async () => {
    await seek(140);
    const agent = managedOf('tile cache');
    assert.equal((await run<ManagedAgentView>(kernel, { type: 'agent.status', agentId: agent.agentId })).agentId, agent.agentId);
    assert.equal(agent.state, 'budget_exhausted');
    assert.deepEqual(await run(kernel, { type: 'agent.addBudget', agentId: agent.agentId, addUsd: 1 }), { budgetUsd: 1.8 });
    assert.equal(managedOf('tile cache').state, 'running');
    assert.ok((await run<ManagedAgentView[]>(kernel, { type: 'agent.list', scope: 'all' })).length >= 8);
    const waited = await run<CommandMap['agent.wait']['out']>(kernel, { type: 'agent.wait', agentId: agent.agentId, timeoutS: 0 });
    assert.equal(waited.done, false);
    const fork = await run<CommandMap['agent.fork']['out']>(kernel, { type: 'agent.fork', agentId: agent.agentId });
    assert.equal(fork.agentIds.length, 1);
    const crashed = managedOf('shader pass');
    assert.deepEqual(await run(kernel, { type: 'agent.resume', agentId: crashed.agentId }), { agentId: crashed.agentId });
    assert.deepEqual(await run(kernel, { type: 'agent.close', agentId: fork.agentIds[0] }), { closed: true });
    assert.equal(kernel.bus.state().managed[fork.agentIds[0]!], undefined);
    assert.equal((await post(kernel, { type: 'agent.status', agentId: 'nobody' })).status, 404);
  });

  test('preflight, ledger, history, admission and trust return their structure', async () => {
    await seek(REFERENCE_T);
    const known = await run<CommandMap['preflight']['out']>(kernel, { type: 'preflight', spec: { worldId: worldIdOf('kestrel'), profile: 'build', prompt: 'x' } });
    assert.equal(known.world.name, 'kestrel');
    assert.equal(known.blocked, null);
    assert.equal(known.connectors, 'off');
    const unknown = await run<CommandMap['preflight']['out']>(kernel, { type: 'preflight', spec: { cwd: '/not/known', profile: 'build', prompt: 'x' } });
    assert.ok(unknown.blocked);
    assert.equal(kernel.bus.state().worlds.notknown, undefined, 'a preflight creates no world');

    const ledger = await run<LedgerReport>(kernel, { type: 'ledger.get' });
    assert.ok(ledger.days30Usd > 0);
    assert.equal(ledger.partial, false);
    assert.equal(ledger.byWorld.length, 7);
    assert.ok(ledger.byModel.length >= 3);
    assert.ok(ledger.trees.length >= 8);

    const past = await run<CommandMap['history.get']['out']>(kernel, { type: 'history.get' });
    assert.equal(past.rows.length, history.rows.length);
    assert.equal(past.salvos.length, history.salvos.length);

    assert.equal((await run<{ running: number }>(kernel, { type: 'admission.get' })).running, 4);
    await run(kernel, { type: 'world.trust', worldId: worldIdOf('quill'), trusted: true });
    assert.equal(kernel.bus.state().worlds[worldIdOf('quill')]?.trusted, true);
  });

  test('craft.channel and craft.text return placeholder structure', async () => {
    await seek(REFERENCE_T);
    const nodeId = managedOf('rate limiter').nodeId;
    const { rows } = await run<{ rows: ChannelRow[] }>(kernel, { type: 'craft.channel', nodeId });
    const kinds = new Set(rows.map((row) => row.kind));
    for (const kind of ['text', 'tool', 'tender', 'turn']) assert.ok(kinds.has(kind as never), kind);
    const edit = rows.find((row) => row.kind === 'tool' && row.name === 'Edit');
    assert.ok(edit?.kind === 'tool' && edit.summary.plus === 4 && edit.summary.minus === 2 && edit.decision === 'accept');
    const shell = rows.find((row) => row.kind === 'tool' && row.name === 'Bash');
    assert.ok(shell?.kind === 'tool' && shell.durationMs === null, 'still running at t = 60');
    const text = await run<CommandMap['craft.text']['out']>(kernel, { type: 'craft.text', nodeId });
    assert.equal(text.available, true);
    assert.match(text.rows[0]!.text, /placeholder/);
    assert.equal((await post(kernel, { type: 'craft.channel', nodeId: 'nobody' })).status, 404);
  });

  test('watched text reaches the client that asked', async () => {
    await seek(REFERENCE_T);
    const hello = client.frames.find((frame) => frame.t === 'hello') as ServerFrames['hello'];
    const nodeId = managedOf('rate limiter').nodeId;
    await run(kernel, { type: 'craft.watchText', nodeId, on: true, clientId: hello.clientId });
    const start = client.frames.length;
    await control('play');
    const frame = (await client.until((row) => row.t === 'text', 3000, start)) as ServerFrames['text'];
    await control('pause');
    await run(kernel, { type: 'craft.watchText', nodeId, on: false, clientId: hello.clientId });
    assert.equal(frame.nodeId, nodeId);
    assert.ok(frame.delta.length > 0);
  });

  test('First Flight starts here too, as it does on Control', async () => {
    const receipt = await run<{ agentIds: string[] }>(kernel, { type: 'agent.spawn', spec: { profile: 'first-flight', prompt: '' } });
    assert.equal(receipt.agentIds.length, 1);
    await run(kernel, { type: 'agent.stop', agentId: receipt.agentIds[0] });
  });

  test('fault.ack and ui.presence work, and a toast cannot fire', async () => {
    await seek(115);
    const crashed = managedOf('shader pass');
    await run(kernel, { type: 'fault.ack', nodeId: crashed.nodeId });
    assert.ok(kernel.bus.state().acked[crashed.nodeId]);
    assert.equal((await post(kernel, { type: 'fault.ack', nodeId: 'nobody' })).status, 404);
    await run(kernel, { type: 'ui.presence', clientId: 'tab-1', visible: true, focused: true, notifications: true });
  });

  test('nothing from this machine is in the stream', async () => {
    const state = await seek(REFERENCE_T);
    const text = JSON.stringify(state) + JSON.stringify(history);
    const { username, homedir } = os.userInfo();
    assert.ok(!text.toLowerCase().includes(username.toLowerCase()), 'user name');
    assert.ok(!text.includes(homedir.replace(/\\/g, '/')) && !text.includes(homedir), 'home folder');
    assert.ok(!text.includes('Claude_Agent_Manager'), 'this repo');
  });
});
