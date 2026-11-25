// The whole plane against a fake ~/.claude on real timers and real fs.watch. Records are synthetic, text is placeholder.
import assert from 'node:assert/strict';
import { truncateSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { afterEach, describe, it, mock } from 'node:test';
import { makeNodeId } from '@naos/protocol';
import type { ManagedAgentView, ObservedSession } from '@naos/protocol';
import { Observer } from '../../src/observer/observer.ts';
import { FakeClaude, makeHarness, sid, until } from './harness.ts';
import type { Harness } from './harness.ts';
import { apiRequest, assistant, costState, toolResult, toolUse, usage, userPrompt } from './records.ts';

interface Rig { fake: FakeClaude; h: Harness; obs: Observer }

const open: Rig[] = [];
/** Opened before the plane stops, or a failed assertion with a gate shut would hang the file instead of failing it. */
const gates: Array<() => void> = [];

async function rig(prepare?: (fake: FakeClaude) => void, dbFile?: string): Promise<Rig> {
  const fake = new FakeClaude();
  prepare?.(fake);
  const h = makeHarness(fake.home, dbFile);
  const obs = new Observer();
  const r = { fake, h, obs };
  open.push(r);
  await obs.start(h.ctx);
  return r;
}

afterEach(async () => {
  mock.restoreAll();
  for (const release of gates.splice(0)) release();
  for (const r of open.splice(0)) {
    await r.obs.stop();
    r.h.close();
    r.fake.cleanup();
  }
});

/** The plane's own record of a session. A session it keeps quiet publishes nothing, so a test has no event to wait on. */
interface Track {
  managed: boolean;
  settling: Promise<void> | null;
  waitSeenAt: number | null;
  main: { path: string | null; machine: { toolCalls: number } };
}

interface Inside {
  sessions: Map<string, Track>;
  files: Map<string, object>;
  pids: { read(): Promise<object[]> };
  findFiles(id: string): Promise<unknown>;
  handlePath(rel: string, c: object): Promise<void>;
  drainNode(n: unknown): Promise<void>;
  pidScan(): Promise<void>;
}

const inside = (r: Rig): Inside => r.obs as unknown as Inside;
const settledManaged = (r: Rig, id: string): boolean => {
  const s = inside(r).sessions.get(id);
  return s?.managed === true && s.settling === null;
};

const live = { status: 'idle', sessionId: '', kind: 'interactive', entrypoint: 'sdk-ts', version: '2.1.314', startedAt: 1 };
const liveRecord = (id: string, cwd: string, over: object = {}): object => ({ ...live, sessionId: id, cwd, ...over });

/** A pid that is certainly dead on this machine, above what Windows hands out. */
const DEAD_PID = 0x7ffffff0;

describe('sessions', () => {
  it('discovers a pid file within a second, attaches its transcript, and maps records to events', async () => {
    const r = await rig();
    const { fake, h } = r;
    const id = sid(1);
    const repo = fake.repo('alpha');
    const t0 = Date.now();
    fake.pidFile(process.pid, liveRecord(id, repo, { status: 'busy', name: 'alpha-1' }));
    await until(() => h.of('session.discovered').length === 1);
    assert.ok(Date.now() - t0 < 1000, `discovery took ${Date.now() - t0} ms`);
    const session = h.state().sessions[id];
    assert.equal(session?.displayName, 'alpha-1');
    assert.equal(session?.pid, process.pid);
    assert.equal(session?.activity.state, 'generating');

    const file = fake.mainPath(id);
    fake.append(file,
      userPrompt('placeholder', { cwd: repo, session: id, at: 0 }),
      apiRequest({ at: 1 }),
      assistant({ id: 'm1', stop: 'tool_use', content: [toolUse('t1', 'Read', { file_path: `${repo}/a.ts` })], usage: usage(100, 20) }, { cwd: repo, at: 2 }),
    );
    await until(() => h.of('tool.started').length === 1);
    assert.equal(h.state().sessions[id]?.transcriptPath, file);
    await until(() => h.state().sessions[id]?.activity.state === 'tool_running');
    assert.equal(h.of('turn.started').length, 1);
    assert.equal(h.of('request.started').length, 1);
    assert.equal(h.of('message.completed').length, 1);

    fake.append(file, toolResult('t1', { at: 3 }), assistant({ id: 'm2', stop: 'end_turn', usage: usage(200, 30) }, { at: 4 }));
    await until(() => h.of('turn.ended').length === 1);
    const usageEvent = h.of('usage.changed').at(-1);
    assert.equal(usageEvent?.usage.output, 50);
    assert.equal(usageEvent?.usage.messages, 2);
    const event = h.of('tool.started')[0];
    assert.match(event?.id ?? '', /\.jsonl:\d+\.\d+$/, 'ids are stable: path, byte offset, index');

    const ids = h.events.filter((e) => 'nodeId' in e && e.id.includes('.jsonl:')).map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length, 'one record can give several events, and ids stay unique');
  });

  it('publishes no message text and logs none', async () => {
    const SECRET = 'zebra-placeholder-word';
    const r = await rig();
    const { fake, h } = r;
    const id = sid(2);
    fake.pidFile(process.pid, liveRecord(id, fake.repo('beta'), { status: 'busy' }));
    await until(() => h.of('session.discovered').length === 1);
    fake.append(fake.mainPath(id),
      { ...(userPrompt(SECRET) as object), isMeta: true },
      assistant({ id: 'm1', stop: 'tool_use', content: [{ type: 'thinking', thinking: SECRET }, { type: 'text', text: SECRET }, toolUse('t1', 'mcp__x__y', { value: SECRET })] }),
      toolResult('t1', {}, { toolUseResult: { stdout: SECRET } }),
    );
    await until(() => h.of('tool.finished').length === 1);
    assert.ok(!JSON.stringify(h.events).includes(SECRET));
    assert.ok(!JSON.stringify(h.state()).includes(SECRET));
    assert.ok(!h.logs.join('\n').includes(SECRET));
    const text = await h.call('craft.text', { nodeId: id });
    assert.equal(text.available, true);
    assert.ok(JSON.stringify(text.rows).includes(SECRET), 'text leaves only by this explicit call');
    assert.ok(!JSON.stringify(h.events).includes(SECRET), 'and that call published nothing');
  });

  it('holds a 175 ms wait back, and shows a real one with its true start and blocked time', async () => {
    const r = await rig();
    const { fake, h } = r;
    const id = sid(3);
    const repo = fake.repo('gamma');
    fake.pidFile(process.pid, liveRecord(id, repo, { status: 'busy' }));
    await until(() => h.of('session.discovered').length === 1);

    const waits = (): number => h.of('activity.changed').filter((e) => e.activity.state === 'waiting').length;
    const seen = (): number | null | undefined => inside(r).sessions.get(id)?.waitSeenAt;
    // Dated ahead, it stays inside the 400 ms however slowly this machine runs, which sleeping for 175 ms under load would not.
    fake.pidFile(process.pid, liveRecord(id, repo, { status: 'waiting', waitingFor: 'permission prompt', statusUpdatedAt: Date.now() + 60_000 }));
    await until(() => typeof seen() === 'number');
    fake.pidFile(process.pid, liveRecord(id, repo, { status: 'busy', statusUpdatedAt: Date.now() }));
    await until(() => seen() === null);
    assert.equal(waits(), 0, 'a flicker under 400 ms never shows');
    assert.equal(h.state().sessions[id]?.blockedMs, 0);

    const at = Date.now();
    fake.pidFile(process.pid, liveRecord(id, repo, { status: 'waiting', waitingFor: 'permission prompt', statusUpdatedAt: at }));
    await until(() => waits() === 1);
    const wait = h.of('activity.changed').at(-1)?.activity;
    assert.equal(wait?.state === 'waiting' ? wait.reason : '', 'permission prompt');
    assert.equal(wait?.since, at);
    await new Promise((resolve) => setTimeout(resolve, 300));
    fake.pidFile(process.pid, liveRecord(id, repo, { status: 'busy', statusUpdatedAt: Date.now() }));
    await until(() => (h.state().sessions[id]?.blockedMs ?? 0) > 0);
    const blocked = h.state().sessions[id]?.blockedMs ?? 0;
    assert.ok(blocked >= 500 && blocked <= Date.now() - at, `blocked ${blocked} ms`);
    const ledger = await h.call('ledger.get', {});
    assert.equal(ledger.blockedTodayMs, blocked);
  });

  it('ends a session when its pid file goes, reading the final cost-state first', async () => {
    const id = sid(4);
    const r = await rig((fake) => {
      const repo = fake.repo('delta');
      fake.append(fake.mainPath(id), assistant({ id: 'm1', stop: 'end_turn', usage: usage(1000, 100) }, { cwd: repo }));
      fake.pidFile(process.pid, liveRecord(id, repo));
    });
    const { fake, h } = r;
    await until(() => h.state().sessions[id]?.activity.state === 'idle');
    const file = fake.mainPath(id);
    unlinkSync(path.join(fake.sessions, `${process.pid}.json`));
    fake.append(file, costState(7.5));
    await until(() => h.of('session.ended').length === 1);
    assert.equal(h.of('session.ended')[0]?.outcome, 'clean');
    assert.equal(h.of('session.ended')[0]?.reason, 'exit');
    assert.equal(h.state().sessions[id]?.cost.costStateUsd, 7.5);
    assert.equal(h.state().sessions[id]?.cost.usd, 7.5);
    assert.equal(h.state().sessions[id]?.cost.isEstimate, false);
    assert.equal(h.state().nodes[id]?.status, 'completed');
  });

  it('marks a stale pid file dead and never trusts its status', async () => {
    const id = sid(5);
    const r = await rig((fake) => {
      fake.append(fake.mainPath(id), apiRequest({}));
      fake.pidFile(DEAD_PID, liveRecord(id, fake.repo('eps'), { status: 'busy' }));
    });
    const s = r.h.state().sessions[id];
    assert.ok(s, 'a recent stale file is shown');
    assert.equal(s.liveness, 'dead');
    assert.equal(s.activity.state, 'finished');
    assert.ok(s.endedAt !== null);
    assert.equal(s.pid, DEAD_PID);
  });

  it('a recycled pid ends only after it held, because a new session may not be listening yet', async () => {
    const pipe = '\\\\.\\pipe\\LOCAL\\cc-msg-naos-test-gone';
    const id = sid(6);
    const r = await rig((fake) => fake.pidFile(process.pid, liveRecord(id, fake.repo('zeta'), { messagingSocketPath: pipe })));
    const { h } = r;
    assert.notEqual(h.state().sessions[id]?.liveness, 'recycled');
    assert.equal(h.of('session.ended').length, 0);
    await until(() => h.of('session.ended').length === 1);
    assert.equal(h.of('session.ended')[0]?.reason, 'pid-recycled');
    assert.equal(h.state().sessions[id]?.liveness, 'recycled');

    // The file outlives the session, and each scan that reads it must leave the ending alone.
    await inside(r).pidScan();
    await inside(r).pidScan();
    assert.equal(h.of('session.ended').length, 1);
    assert.equal(h.of('session.discovered').length, 1);
    assert.equal(h.state().sessions[id]?.liveness, 'recycled');
  });

  it('a listening pipe reads alive', { skip: process.platform !== 'win32' }, async () => {
    const leaf = `LOCAL\\cc-msg-naos-test-${process.pid}`;
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(`\\\\.\\pipe\\${leaf}`, resolve));
    try {
      const id = sid(7);
      const r = await rig((fake) => fake.pidFile(process.pid, liveRecord(id, fake.repo('eta'), { messagingSocketPath: `\\\\.\\pipe\\${leaf}` })));
      assert.equal(r.h.state().sessions[id]?.liveness, 'alive');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('follows /clear: same pid, same hull, new conversation', async () => {
    const a = sid(8);
    const b = sid(9);
    const r = await rig((fake) => {
      const repo = fake.repo('theta');
      fake.append(fake.mainPath(a), assistant({ id: 'm1' }, { cwd: repo }));
      fake.append(path.join(fake.dir(a), 'subagents', 'agent-keep.jsonl'), userPrompt('x'));
      fake.pidFile(process.pid, liveRecord(a, repo));
    });
    const { fake, h } = r;
    await until(() => Object.keys(h.state().nodes).includes(makeNodeId(a, 'keep')));
    fake.append(fake.mainPath(b), assistant({ id: 'm2', stop: 'end_turn', usage: usage(5, 6) }, { cwd: 'c:/x' }));
    fake.pidFile(process.pid, liveRecord(b, 'c:/x'));
    await until(() => h.state().sessions[b] !== undefined);
    assert.equal(h.state().sessions[a], undefined, 're-keyed, not a second hull');
    assert.equal(h.state().nodes[b]?.kind, 'main');
    assert.equal(h.state().nodes[makeNodeId(a, 'keep')]?.sessionId, b);
    fake.append(fake.mainPath(b), assistant({ id: 'm3', stop: 'end_turn', usage: usage(5, 6) }));
    await until(() => (h.of('usage.changed').filter((e) => e.sessionId === b).at(-1)?.usage.messages ?? 0) === 2);
  });

  it('resets on a shrink and says so', async () => {
    const id = sid(10);
    const r = await rig((fake) => {
      fake.append(fake.mainPath(id), ...Array.from({ length: 50 }, (_, i) => assistant({ id: `m${i}` })));
      fake.pidFile(process.pid, liveRecord(id, fake.repo('iota')));
    });
    const { fake, h } = r;
    truncateSync(fake.mainPath(id), 100);
    await until(() => h.of('tail.reset').length === 1);
    assert.equal(h.of('tail.reset')[0]?.reason, 'shrunk');
    assert.equal(h.state().sensor.tailResets >= 1, true);
    fake.append(fake.mainPath(id), '\n' as never, assistant({ id: 'after', stop: 'end_turn' }));
    await until(() => h.of('message.completed').some((e) => e.messageId === 'after'));
  });

  it('counts unknown records on the sensor and keeps going', async () => {
    const id = sid(11);
    const r = await rig((fake) => fake.pidFile(process.pid, liveRecord(id, fake.repo('kappa'))));
    const { fake, h } = r;
    const file = fake.mainPath(id);
    fake.append(file, { type: 'future-record', a: 1 }, assistant({ id: 'm1' }, {}, { aFutureField: 1 }));
    writeFileSync(file, 'this is not json\n', { flag: 'a' });
    fake.append(file, assistant({ id: 'm2', stop: 'end_turn' }));
    await until(() => h.of('message.completed').length === 2);
    await until(() => h.state().sensor.unknownRecords === 1);
    assert.equal(h.state().sensor.unknownFields, 1);
    assert.equal(h.state().sensor.parseErrors, 1);
  });

  it('evicts a session ended over an hour ago, and the row stays as history', async () => {
    const id = sid(12);
    const r = await rig((fake) => {
      fake.append(fake.mainPath(id), assistant({ id: 'm1', stop: 'end_turn' }, { cwd: fake.repo('lambda') }));
    });
    const { h, obs } = r;
    assert.ok(h.state().sessions[id], 'recent sessions are shown after a boot');
    await until(() => h.state().index.stage === 'done');
    const track = (obs as unknown as { sessions: Map<string, { endedAt: number | null }> }).sessions.get(id);
    assert.ok(track);
    track.endedAt = Date.now() - 2 * 3_600_000;
    (obs as unknown as { evict(): void }).evict();
    assert.deepEqual(h.of('fleet.evicted')[0]?.sessionIds, [id]);
    assert.equal(h.state().sessions[id], undefined);
    assert.equal(h.state().nodes[id], undefined);
    const history = await h.call('history.get', {});
    assert.ok(history.rows.some((row) => row.nodeId === id));
  });

  it('an old transcript with no pid stays history, it does not become a craft', async () => {
    const id = sid(13);
    const r = await rig((fake) => {
      const file = fake.mainPath(id);
      fake.append(file, assistant({ id: 'm1', stop: 'end_turn', usage: usage(1000, 100) }, { cwd: fake.repo('mu') }));
      const old = new Date(Date.now() - 3 * 86_400_000);
      utimesSync(file, old, old);
    });
    const { h } = r;
    assert.equal(h.state().sessions[id], undefined);
    await until(() => h.state().index.stage === 'done');
    const history = await h.call('history.get', {});
    const row = history.rows.find((x) => x.nodeId === id);
    assert.ok(row);
    assert.ok((row.usd ?? 0) > 0);
    assert.equal(row.outcome, 'clean');
  });
});

describe('agent tree', () => {
  const session = sid(20);

  it('links subagents by toolUseId, finds them in another slug, and ends them on a notification', async () => {
    const r = await rig((fake) => {
      const repo = fake.repo('nu');
      fake.append(fake.mainPath(session), assistant({ id: 'm1', stop: 'tool_use', content: [toolUse('tool-1', 'Agent', { description: 'placeholder' })] }, { cwd: repo }));
      fake.pidFile(process.pid, liveRecord(session, repo, { status: 'busy' }));
    });
    const { fake, h } = r;
    await until(() => h.of('session.discovered').length === 1);
    const dir = fake.dir(session, 'other-slug');
    fake.append(path.join(dir, 'subagents', 'agent-a1.jsonl'), userPrompt('task', { at: 0 }, { agentId: 'a1' }), apiRequest({ at: 1 }));
    writeFileSync(path.join(dir, 'subagents', 'agent-a1.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'looks', toolUseId: 'tool-1', spawnDepth: 1 }));
    const nodeId = makeNodeId(session, 'a1');
    await until(() => h.state().nodes[nodeId]?.agentType === 'Explore');
    const node = h.state().nodes[nodeId];
    assert.equal(node?.kind, 'subagent');
    assert.equal(node?.parentNodeId, session);
    assert.equal(node?.linkedBy, 'toolUseId');
    assert.equal(node?.parentToolUseId, 'tool-1');
    await until(() => h.state().sessions[session]?.slugs.includes('other-slug') === true);
    assert.equal(h.state().sessions[session]?.agentCount, 1);
    assert.equal(h.state().nodes[nodeId]?.activity.state, 'generating');

    fake.append(fake.mainPath(session), {
      type: 'queue-operation', operation: 'enqueue',
      content: '<task-notification><task-id>x</task-id><tool-use-id>tool-1</tool-use-id><status>completed</status></task-notification>',
    });
    await until(() => h.state().nodes[nodeId]?.status === 'completed');
    assert.equal(h.of('agent.ended').length, 1);
    assert.equal(h.state().sessions[session]?.runningAgentCount, 0);
  });

  it('links a nested agent by parentAgentId and by the transcript that holds the call', async () => {
    const r = await rig((fake) => {
      const repo = fake.repo('xi');
      fake.append(fake.mainPath(session), assistant({ id: 'm1' }, { cwd: repo }));
      fake.pidFile(process.pid, liveRecord(session, repo, { status: 'busy' }));
    });
    const { fake, h } = r;
    await until(() => h.of('session.discovered').length === 1);
    const dir = path.join(fake.dir(session), 'subagents');
    fake.append(path.join(dir, 'agent-p.jsonl'), assistant({ id: 'p1', stop: 'tool_use', content: [toolUse('deep-1', 'Agent')] }));
    await until(() => h.state().nodes[makeNodeId(session, 'p')] !== undefined);
    writeFileSync(path.join(dir, 'agent-c1.meta.json'), JSON.stringify({ parentAgentId: 'p', spawnDepth: 2 }));
    writeFileSync(path.join(dir, 'agent-c2.meta.json'), JSON.stringify({ toolUseId: 'deep-1', spawnDepth: 2 }));
    await until(() => h.state().nodes[makeNodeId(session, 'c2')]?.linkedBy === 'toolUseId' && h.state().nodes[makeNodeId(session, 'c1')]?.linkedBy === 'parentAgentId');
    const c1 = h.state().nodes[makeNodeId(session, 'c1')];
    const c2 = h.state().nodes[makeNodeId(session, 'c2')];
    assert.equal(c1?.parentNodeId, makeNodeId(session, 'p'));
    assert.equal(c1?.linkedBy, 'parentAgentId');
    assert.equal(c2?.parentNodeId, makeNodeId(session, 'p'));
    assert.ok(h.state().nodes[makeNodeId(session, 'p')]?.childNodeIds.includes(makeNodeId(session, 'c1')));
  });

  it('follows a workflow from journal to state file, and fires a salvo on observedAt', async () => {
    const runId = 'wf_abc-123';
    const r = await rig((fake) => {
      const repo = fake.repo('omicron');
      fake.append(fake.mainPath(session), assistant({ id: 'm1', stop: 'tool_use', content: [toolUse('wf-tool', 'Workflow')] }, { cwd: repo }));
      fake.pidFile(process.pid, liveRecord(session, repo, { status: 'busy' }));
    });
    const { fake, h } = r;
    await until(() => h.of('session.discovered').length === 1);
    fake.append(fake.mainPath(session), toolResult('wf-tool', {}, {
      toolUseResult: { runId, taskId: 'task-1', workflowName: 'demo', scriptPath: 'x.js', status: 'async_launched', transcriptDir: 'd' },
    }));
    const dir = path.join(fake.dir(session), 'subagents', 'workflows', runId);
    const journal = path.join(dir, 'journal.jsonl');
    fake.append(journal, { type: 'launched' });
    await until(() => h.state().workflows[runId] !== undefined);
    assert.equal(h.state().workflows[runId]?.status, 'running');
    assert.equal(h.state().workflows[runId]?.statusSource, 'journal+liveness');

    fake.append(journal,
      { type: 'started', key: 'v1:a', agentId: 'w1', label: 'one', phase: 'Build' },
      { type: 'started', key: 'v1:b', agentId: 'w2', label: 'two', phase: 'Build' },
      { type: 'started', key: 'v1:c', agentId: 'w3', label: 'three', phase: 'Check' },
    );
    await until(() => h.of('salvo.opened').length === 1);
    const salvo = h.of('salvo.opened')[0]?.salvo;
    assert.equal(salvo?.source, 'workflow');
    assert.equal(salvo?.parentNodeId, session);
    assert.equal(salvo?.nodeIds.length, 3);
    fake.append(journal, { type: 'started', key: 'v1:d', agentId: 'w4', label: 'four', phase: 'Check' });
    await until(() => h.of('salvo.joined').length === 1);

    const w1 = makeNodeId(session, 'w1');
    assert.equal(h.state().nodes[w1]?.kind, 'workflow-agent');
    assert.equal(h.state().nodes[w1]?.linkedBy, 'workflowRun');
    assert.equal(h.state().nodes[w1]?.workflow?.label, 'one');
    assert.equal(h.state().nodes[w1]?.workflow?.phase, 'Build');

    fake.append(path.join(dir, 'agent-w1.jsonl'), assistant({ id: 'x1', model: 'claude-haiku-5-5', stop: 'end_turn', usage: usage(1000, 100) }));
    await until(() => h.state().nodes[w1]?.model === 'claude-haiku-5-5');
    fake.append(journal, { type: 'result', key: 'v1:a', agentId: 'w1', result: { private: 'placeholder' } }, { type: 'failed', key: 'v1:b', agentId: 'w2' });
    await until(() => h.state().nodes[makeNodeId(session, 'w2')]?.status === 'failed');
    assert.equal(h.state().nodes[w1]?.status, 'completed');
    await until(() => h.state().workflows[runId]?.counts.completed === 1);
    assert.equal(h.state().workflows[runId]?.counts.open, 2);
    assert.equal(h.state().workflows[runId]?.parentToolUseId, 'wf-tool');
    assert.equal(h.state().workflows[runId]?.name, 'demo');
    assert.equal(h.state().workflows[runId]?.taskId, 'task-1');
    await until(() => (h.state().workflows[runId]?.cost.estimateUsd ?? 0) > 0);

    const state = path.join(fake.dir(session), 'workflows', `${runId}.json`);
    fake.append(state, {
      status: 'completed', workflowName: 'demo', durationMs: 100, totalTokens: 500, totalToolCalls: 2, script: 'private', args: 'private',
      workflowProgress: [{ type: 'workflow_agent', agentId: 'w3', state: 'done' }],
    });
    await until(() => h.state().workflows[runId]?.status === 'completed');
    assert.equal(h.state().workflows[runId]?.statusSource, 'state-file');
    assert.equal(h.state().nodes[makeNodeId(session, 'w3')]?.status, 'completed');
    assert.equal(h.state().nodes[makeNodeId(session, 'w4')]?.status, 'stopped');
    assert.equal(h.state().workflows[runId]?.totalTokens, 500);
    assert.ok(!JSON.stringify(h.events).includes('private'));
  });

  it('marks a run and its open agents orphaned when the owner dies', async () => {
    const runId = 'wf_orphan-1';
    const r = await rig((fake) => {
      const repo = fake.repo('pi');
      fake.append(fake.mainPath(session), assistant({ id: 'm1' }, { cwd: repo }));
      const dir = path.join(fake.dir(session), 'subagents', 'workflows', runId);
      fake.append(path.join(dir, 'journal.jsonl'), { type: 'launched' }, { type: 'started', key: 'k', agentId: 'o1', phase: 'P' });
      fake.append(path.join(dir, 'agent-o1.jsonl'), apiRequest({}));
      fake.pidFile(process.pid, liveRecord(session, repo, { status: 'busy' }));
    });
    const { fake, h } = r;
    assert.equal(h.state().workflows[runId]?.status, 'running');
    assert.equal(h.state().nodes[makeNodeId(session, 'o1')]?.status, 'running');
    unlinkSync(path.join(fake.sessions, `${process.pid}.json`));
    await until(() => h.state().workflows[runId]?.status === 'orphaned');
    assert.equal(h.state().nodes[makeNodeId(session, 'o1')]?.status, 'orphaned');
  });

  it('rebuilds a finished tree at boot without replaying launches onto the tape', async () => {
    const runId = 'wf_done-1';
    const r = await rig((fake) => {
      const repo = fake.repo('rho');
      fake.append(fake.mainPath(session), assistant({ id: 'm1' }, { cwd: repo }));
      const dir = path.join(fake.dir(session), 'subagents', 'workflows', runId);
      fake.append(path.join(dir, 'journal.jsonl'), { type: 'launched' }, { type: 'started', key: 'k', agentId: 'd1', phase: 'P' }, { type: 'result', key: 'k', agentId: 'd1', result: 'x' });
      fake.append(path.join(dir, 'agent-d1.jsonl'), assistant({ id: 'x', stop: 'end_turn' }));
      fake.append(path.join(fake.dir(session), 'workflows', `${runId}.json`), { status: 'killed' });
      fake.pidFile(process.pid, liveRecord(session, repo));
    });
    const { h } = r;
    assert.equal(h.state().workflows[runId]?.status, 'killed');
    assert.equal(h.state().nodes[makeNodeId(session, 'd1')]?.status, 'completed');
    assert.equal(h.of('agent.ended').length, 0);
    assert.equal(h.of('salvo.opened').length, 0);
  });
});

describe('dedupe, AC 13', () => {
  const session = sid(30);

  it('does not count the transcript tails read at boot as burn, and counts what arrives after', async () => {
    const { fake, h } = await rig((fake) => {
      const repo = fake.repo('burnhome');
      fake.append(fake.mainPath(session), assistant({ id: 'old', model: 'claude-opus-5-5', stop: 'end_turn', usage: usage(200_000, 20_000) }, { cwd: repo }));
      fake.pidFile(process.pid, liveRecord(session, repo, { status: 'busy' }));
    });
    await until(() => h.fleet.burnUsdPerHour !== undefined);
    assert.equal(h.fleet.burnUsdPerHour, 0, 'old money is no burn');
    fake.append(fake.mainPath(session), assistant({ id: 'new', model: 'claude-opus-5-5', stop: 'end_turn', usage: usage(200_000, 20_000) }));
    await until(() => (h.fleet.burnUsdPerHour ?? 0) > 0);
  });

  it('a known craft with no transcript has an empty Channel, and an unknown one is not found', async () => {
    const { h } = await rig();
    h.ctx.bus.publish({ type: 'session.discovered', sessionId: 'young', nodeId: 'young', session: { sessionId: 'young', rootNodeId: 'young', worldId: 'w' } as ObservedSession });
    assert.deepEqual(await h.call('craft.channel', { nodeId: 'young', limit: 10 }), { rows: [], complete: false });
    await assert.rejects(h.call('craft.channel', { nodeId: 'nobody', limit: 10 }), /No transcript/);
  });

  it('counts control spawns and copies toward a salvo, and a restored craft not at all', async () => {
    const { h } = await rig();
    const view = (agentId: string, over: Partial<ManagedAgentView>): ManagedAgentView => ({
      agentId, nodeId: `node-${agentId}`, sessionId: `node-${agentId}`, worldId: 'w', parentAgentId: null, createdAt: Date.now(), ...over,
    }) as ManagedAgentView;
    const up = (agent: ManagedAgentView) => h.ctx.bus.publish({ type: 'managed.upserted', agent });

    up(view('lead', {}));
    for (const id of ['a', 'b']) up(view(id, { parentAgentId: 'lead' }));
    assert.equal(h.of('salvo.opened').length, 0, 'two launches are no salvo');
    up(view('a', { parentAgentId: 'lead', state: 'running' }));
    assert.equal(h.of('salvo.opened').length, 0, 'a later upsert of one craft is no launch');
    up(view('c', { parentAgentId: 'lead' }));
    const spawned = h.of('salvo.opened')[0]?.salvo;
    assert.equal(spawned?.source, 'spawn');
    assert.equal(spawned?.parentNodeId, 'node-lead');
    assert.deepEqual(spawned?.nodeIds, ['node-a', 'node-b', 'node-c']);
    up(view('d', { parentAgentId: 'lead' }));
    assert.equal(h.of('salvo.joined').length, 1);

    for (const id of ['x', 'y', 'z']) up(view(id, { copyOf: 'node-x' }));
    const copies = h.of('salvo.opened')[1]?.salvo;
    assert.equal(copies?.parentNodeId, 'node-x', 'copies have no parent, so the first one carries the salvo');
    assert.equal(copies?.nodeIds.length, 3);

    for (const id of ['r1', 'r2', 'r3']) up(view(id, { copyOf: 'node-r1', createdAt: Date.now() - 60_000 }));
    assert.equal(h.of('salvo.opened').length, 2, 'a craft restored at boot is no launch');
  });

  it('stays quiet on a managed main node and still reports its agents', async () => {
    const r = await rig();
    const { fake, h } = r;
    h.managed.set(session, 'agent-1');
    const repo = fake.repo('sigma');
    fake.pidFile(process.pid, liveRecord(session, repo, { status: 'busy' }));
    fake.append(fake.mainPath(session), assistant({ id: 'm1', stop: 'tool_use', content: [toolUse('t', 'Read')] }, { cwd: repo }));
    fake.append(path.join(fake.dir(session), 'subagents', 'agent-s1.jsonl'), apiRequest({}));
    await until(() => h.of('agent.started').length === 1);
    await until(() => inside(r).sessions.get(session)?.main.machine.toolCalls === 1);
    assert.equal(h.of('session.discovered').length, 0);
    assert.equal(h.of('tool.started').length, 0);
    assert.equal(h.of('activity.changed').filter((e) => e.nodeId === session).length, 0);
    assert.equal(h.of('usage.changed').filter((e) => e.nodeId === session).length, 0);
    assert.equal(h.of('agent.started')[0]?.node.parentNodeId, session);
  });

  it('falls back to the naos: title, in the pid file and in the transcript', async () => {
    const r = await rig();
    const { fake, h } = r;
    const repo = fake.repo('tau');
    fake.pidFile(process.pid, liveRecord(session, repo, { name: 'naos: build', nameSource: 'auto' }));
    await until(() => settledManaged(r, session));
    assert.equal(h.of('session.discovered').length, 0);

    const other = sid(31);
    const pid = process.ppid;
    fake.append(fake.mainPath(other), { type: 'custom-title', customTitle: 'naos: scout' }, assistant({ id: 'm1' }, { cwd: repo }));
    fake.pidFile(pid, liveRecord(other, repo));
    await until(() => settledManaged(r, other));
    assert.equal(h.of('session.discovered').length, 0);
  });
});

// Each of these holds one interleaving open with gates, so it fails the same way on any machine at any load.
describe('races', () => {
  const session = sid(100);
  const tool = (): object => assistant({ id: 'm1', stop: 'tool_use', content: [toolUse('t1', 'Read')] });
  const managedTitle = { type: 'custom-title', customTitle: 'naos: scout' };

  const gate = (): { wait: Promise<void>; open: () => void } => {
    const { promise, resolve } = Promise.withResolvers<void>();
    const open = (): void => resolve();
    gates.push(open);
    return { wait: promise, open };
  };

  /** Parks `discover` on its walk, which only a session missing from the last walk reaches. */
  const parkWalk = async (r: Rig): Promise<{ entered: () => boolean; walked: () => boolean; open: () => void }> => {
    await until(() => r.h.state().index.stage === 'done');
    const plane = inside(r);
    const real = plane.findFiles.bind(r.obs);
    const g = gate();
    let entered = false;
    let walked = false;
    plane.findFiles = async (id) => {
      entered = true;
      await g.wait;
      const files = await real(id);
      walked = true;
      return files;
    };
    return { entered: () => entered, walked: () => walked, open: g.open };
  };

  /** Parks the first open of one file, which is the read that says who a session is. Drains after it pass. */
  const parkFirstOpen = (file: string): { hit: () => boolean; opens: () => number; open: () => void } => {
    const real = fsp.open;
    const g = gate();
    let opens = 0;
    mock.method(fsp, 'open', async (...args: Parameters<typeof fsp.open>) => {
      if (String(args[0]) === file) {
        opens += 1;
        if (opens === 1) await g.wait;
      }
      return real(...args);
    });
    return { hit: () => opens > 0, opens: () => opens, open: g.open };
  };

  /** What the watcher does for a main transcript, called directly so the test picks the moment. */
  const seeMain = (r: Rig, id: string): Promise<void> =>
    inside(r).handlePath(path.relative(r.fake.projects, r.fake.mainPath(id)), { kind: 'main', slug: 'slug-a', sid: id });

  it('publishes a transcript path before any event read from that transcript', async () => {
    const r = await rig();
    const { fake, h } = r;
    const repo = fake.repo('order-main');
    fake.pidFile(process.pid, liveRecord(session, repo, { status: 'busy' }));
    await until(() => h.of('session.discovered').length === 1);
    fake.append(fake.mainPath(session), userPrompt('placeholder', { cwd: repo, session }), tool());
    await until(() => h.of('tool.started').length === 1);
    const first = h.events.findIndex((e) => e.id.includes('.jsonl:'));
    const told = h.events.findIndex((e) => e.type === 'session.changed' && e.patch.transcriptPath != null);
    assert.ok(told >= 0 && told < first, `path at ${told}, first event at ${first}`);
  });

  it('publishes an agent transcript path before any event read from it', async () => {
    const r = await rig();
    const { fake, h } = r;
    const repo = fake.repo('order-agent');
    fake.append(fake.mainPath(session), assistant({ id: 'm0' }, { cwd: repo }));
    fake.pidFile(process.pid, liveRecord(session, repo, { status: 'busy' }));
    await until(() => h.of('session.discovered').length === 1);
    fake.append(path.join(fake.dir(session), 'subagents', 'agent-a1.jsonl'), tool());
    await until(() => h.of('tool.started').length === 1);
    const started = h.events.findIndex((e) => e.type === 'tool.started');
    const told = h.events.findIndex((e) => e.type === 'agent.changed' && e.patch.transcriptPath != null);
    assert.ok(told >= 0 && told < started, `path at ${told}, tool at ${started}`);
  });

  it('a transcript that reaches a session mid-discovery does not get ahead of what it says', async () => {
    const r = await rig();
    const { fake, h } = r;
    const walk = await parkWalk(r);
    const file = fake.mainPath(session);
    const head = parkFirstOpen(file);
    fake.append(file, managedTitle, tool());
    fake.pidFile(process.pid, liveRecord(session, fake.repo('mid')));
    await until(walk.entered);
    const late = seeMain(r, session);
    walk.open();
    await until(() => walk.walked() && head.hit());
    // Lets discover run on if nothing holds it, which is the failure this exists to catch.
    await new Promise((resolve) => setTimeout(resolve, 20));
    head.open();
    await late;
    await until(() => settledManaged(r, session) && inside(r).sessions.get(session)?.main.machine.toolCalls === 1);
    assert.equal(h.of('session.discovered').length, 0, 'a managed title showed as an observed session');
    assert.equal(h.of('tool.started').length, 0);
  });

  it('a drain during the first read cannot beat the managed check', async () => {
    const r = await rig();
    const { fake, h } = r;
    await until(() => h.state().index.stage === 'done');
    h.managed.set(session, 'agent-1');
    const file = fake.mainPath(session);
    const head = parkFirstOpen(file);
    fake.append(file, tool());
    await until(head.hit);
    const s = inside(r).sessions.get(session);
    assert.ok(s, 'the transcript alone made the track');
    // What the one-second reconcile does to every hot file.
    await inside(r).drainNode(s.main);
    head.open();
    await until(() => settledManaged(r, session) && s.main.machine.toolCalls === 1);
    assert.equal(h.of('tool.started').length, 0, 'a managed session leaked a tool event');
  });

  it('a transcript seen during a pid scan waits for that scan, so a pid name counts', async () => {
    const r = await rig();
    const { fake, h } = r;
    const plane = inside(r);
    const read = plane.pids.read.bind(plane.pids);
    const g = gate();
    let parked = false;
    plane.pids.read = async () => {
      const records = await read();
      if (!parked) {
        parked = true;
        await g.wait;
      }
      return records;
    };
    const scan = plane.pidScan();
    await until(() => parked);
    const repo = fake.repo('scan');
    fake.append(fake.mainPath(session), assistant({ id: 'm1' }, { cwd: repo }));
    fake.pidFile(process.pid, liveRecord(session, repo, { name: 'naos: build', nameSource: 'auto' }));
    const late = seeMain(r, session);
    await new Promise((resolve) => setTimeout(resolve, 50));
    g.open();
    await Promise.all([scan, late]);
    assert.equal(h.of('session.discovered').length, 0, 'the transcript beat the pid name');
    assert.equal(settledManaged(r, session), true);
  });

  it('an agent file seen mid-discovery waits for its session', async () => {
    const r = await rig();
    const { fake, h } = r;
    const walk = await parkWalk(r);
    fake.pidFile(process.pid, liveRecord(session, fake.repo('child')));
    await until(walk.entered);
    const file = path.join(fake.dir(session), 'subagents', 'agent-a1.jsonl');
    fake.append(file, apiRequest({}));
    const late = inside(r).handlePath(path.relative(fake.projects, file), { kind: 'agent', slug: 'slug-a', sid: session, agentId: 'a1', runId: null });
    await new Promise((resolve) => setTimeout(resolve, 20));
    walk.open();
    await late;
    await until(() => h.of('agent.started').length === 1);
    const parent = h.events.findIndex((e) => e.type === 'session.discovered');
    const child = h.events.findIndex((e) => e.type === 'agent.started');
    assert.ok(parent >= 0 && parent < child, `session at ${parent}, agent at ${child}`);
  });

  it('an agent keeps its events back while /clear renames the session', async () => {
    const before = sid(101);
    const after = sid(102);
    const agentFile = { path: '' };
    const r = await rig((fake) => {
      const repo = fake.repo('rename');
      fake.append(fake.mainPath(before), assistant({ id: 'm1' }, { cwd: repo }));
      agentFile.path = path.join(fake.dir(before), 'subagents', 'agent-keep.jsonl');
      fake.append(agentFile.path, userPrompt('x'));
      fake.pidFile(process.pid, liveRecord(before, repo, { status: 'busy' }));
    });
    const { fake, h } = r;
    const keep = makeNodeId(before, 'keep');
    await until(() => h.state().nodes[keep] !== undefined);
    const walk = await parkWalk(r);
    fake.append(fake.mainPath(after), assistant({ id: 'm2' }, { cwd: 'c:/x' }));
    fake.pidFile(process.pid, liveRecord(after, 'c:/x'));
    await until(walk.entered);
    fake.append(agentFile.path, tool());
    const s = inside(r).sessions.get(after) as unknown as { agents: Map<string, unknown> };
    await inside(r).drainNode(s.agents.get('keep'));
    assert.equal(h.of('tool.started').length, 0, 'the bus does not know the new id yet');
    walk.open();
    await until(() => h.of('tool.started').length === 1);
    const renamed = h.events.findIndex((e) => e.type === 'session.changed' && e.patch.sessionId === after);
    const started = h.events.findIndex((e) => e.type === 'tool.started');
    assert.ok(renamed >= 0 && renamed < started, `renamed at ${renamed}, tool at ${started}`);
  });

  it('two callers attaching a resumed transcript seed it once, silently', async () => {
    const r = await rig();
    const { fake, h } = r;
    const repo = fake.repo('twice');
    fake.pidFile(process.pid, liveRecord(session, repo, { status: 'busy' }));
    await until(() => h.of('session.discovered').length === 1);
    const file = fake.mainPath(session);
    const head = parkFirstOpen(file);
    fake.append(file, userPrompt('placeholder', { cwd: repo, session }), assistant({ id: 'm1', stop: 'end_turn' }, { cwd: repo }));
    // A file past the young limit reads as a resume, and what a resume replays is history.
    const now = Date.now;
    mock.method(Date, 'now', () => now() + 60_000);
    await until(head.hit);
    const late = seeMain(r, session);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(head.opens(), 1, 'a second reader would clear silent while the first still feeds');
    head.open();
    await late;
    assert.equal(inside(r).sessions.get(session)?.main.path, file);
    assert.equal(h.of('turn.started').length, 0, 'a seed went out as live events');
    assert.equal(h.of('message.completed').length, 0);
  });

  it('a walk that saw the folder before the transcript does not hide the transcript', async () => {
    const r = await rig();
    const { fake, h } = r;
    await until(() => h.state().index.stage === 'done');
    inside(r).files.set(session, { sid: session, main: null, slugs: new Set(), dirs: new Map() });
    fake.append(fake.mainPath(session), managedTitle, assistant({ id: 'm1' }, { cwd: fake.repo('walk') }));
    fake.pidFile(process.pid, liveRecord(session, fake.repo('walk')));
    await until(() => settledManaged(r, session));
    assert.equal(h.of('session.discovered').length, 0);
  });

  it('finds a title in the first record of a young transcript past the head size', async () => {
    const r = await rig();
    const { fake, h } = r;
    const repo = fake.repo('long');
    const records = Array.from({ length: 40 }, (_, i) => assistant({ id: `m${i}`, stop: 'end_turn', content: [{ type: 'text', text: 'x'.repeat(800) }] }, { cwd: repo }));
    fake.append(fake.mainPath(session), managedTitle, ...records);
    await until(() => settledManaged(r, session));
    assert.equal(h.of('session.discovered').length, 0);
  });

  it('a managed title found after the session showed sends no event of that transcript', async () => {
    const r = await rig();
    const { fake, h } = r;
    const repo = fake.repo('late');
    fake.pidFile(process.pid, liveRecord(session, repo));
    await until(() => h.of('session.discovered').length === 1);
    const file = fake.mainPath(session);
    const head = parkFirstOpen(file);
    fake.append(file, managedTitle, tool());
    await until(head.hit);
    const s = inside(r).sessions.get(session);
    assert.ok(s);
    // The one-second reconcile, while the read that holds the title is still out.
    await inside(r).drainNode(s.main);
    head.open();
    await until(() => settledManaged(r, session) && s.main.machine.toolCalls === 1);
    assert.equal(h.of('tool.started').length, 0);
  });

  it('stop waits for work in flight, because the kernel closes the database next', async () => {
    const r = await rig();
    const { fake } = r;
    const walk = await parkWalk(r);
    fake.pidFile(process.pid, liveRecord(session, fake.repo('stop')));
    await until(walk.entered);
    let stopped = false;
    const stopping = r.obs.stop().then(() => {
      stopped = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(stopped, false, 'stop returned with a scan still running');
    walk.open();
    await stopping;
  });

  it('a failed scan on a timer is logged, and it does not end the process', async () => {
    const r = await rig();
    const { fake, h } = r;
    const plane = inside(r);
    let failed = false;
    plane.pids.read = async () => {
      failed = true;
      throw new Error('simulated');
    };
    fake.pidFile(process.pid, liveRecord(session, fake.repo('fail')));
    await until(() => failed && h.logs.some((line) => line.includes('simulated')));
  });
});

describe('worlds', () => {
  it('groups by repo root, makes worktrees moons and puts stray sessions on a rogue body', async () => {
    const a = sid(40);
    const b = sid(41);
    const c = sid(42);
    let repo = '';
    const r = await rig((fake) => {
      repo = fake.repo('upsilon').replace(/\\/g, '/');
      fake.append(fake.mainPath(a), assistant({ id: 'm' }, { cwd: `${repo}/deep/down` }));
      fake.append(fake.mainPath(b), assistant({ id: 'm' }, { cwd: `${repo}/.claude/worktrees/feat` , extra: { gitBranch: 'agent/feat' } }));
      fake.append(fake.mainPath(c), assistant({ id: 'm' }, { cwd: path.join(fake.root, 'stray') }));
    });
    const { h } = r;
    const sa = h.state().sessions[a];
    const sb = h.state().sessions[b];
    const sc = h.state().sessions[c];
    assert.ok(sa && sb && sc);
    assert.equal(sa.worldId, sb.worldId, 'a worktree belongs to its repo');
    assert.equal(sb.worktree?.name, 'feat');
    assert.equal(sb.worktree?.branch, 'agent/feat');
    const world = h.state().worlds[sa.worldId];
    assert.equal(world?.kind, 'repo');
    assert.deepEqual(world?.worktrees.map((w) => [w.name, w.branch]), [['feat', 'agent/feat']]);
    assert.equal(sc.projectRoot, null);
    assert.equal(h.state().worlds[sc.worldId]?.kind, 'rogue');
  });

  it('an off-host pid record is off-world, with no liveness check', async () => {
    const id = sid(43);
    const r = await rig((fake) => fake.pidFile(DEAD_PID, liveRecord(id, '/home/x/repo', { pidDomain: 'linux:other-host' })));
    const s = r.h.state().sessions[id];
    assert.equal(s?.liveness, 'foreign');
    assert.equal(s?.endedAt, null);
    assert.equal(r.h.state().worlds[s?.worldId ?? '']?.kind, 'offworld');
  });
});

describe('index', () => {
  /** Enough records to push a transcript past head plus tail, so the worker owns its start. */
  const big = (count: number, tag: string): object[] => Array.from({ length: count }, (_, i) => assistant({
    id: `${tag}${i}`, stop: 'end_turn', usage: usage(1000, 100),
    content: [{ type: 'text', text: 'x'.repeat(800) }],
  }, { at: i * 1000 }));

  it('live sessions do not wait: usage starts as a lower bound, then the worker completes it, and it adds up', async () => {
    const id = sid(50);
    const r = await rig((fake) => {
      fake.append(fake.mainPath(id), ...big(400, 'a'));
      fake.pidFile(process.pid, liveRecord(id, fake.repo('phi')));
    });
    const { fake, h } = r;
    const start = h.state().sessions[id];
    assert.ok(start, 'the session is in the state when start() returns');
    assert.ok(start.usage.messages < 400);
    assert.equal(start.cost.isLowerBound, true);
    await until(() => h.state().index.stage === 'done');
    await until(() => h.state().sessions[id]?.usage.messages === 400);
    const expected = (400 * (1000 * 4 + 100 * 20)) / 1e6;
    const done = h.state().sessions[id];
    assert.ok(Math.abs((done?.usage.output ?? 0) - 40_000) === 0);
    assert.ok(Math.abs((done?.cost.estimateUsd ?? 0) - expected) < 1e-6, `${done?.cost.estimateUsd} vs ${expected}`);
    assert.equal(done?.cost.isLowerBound, false);

    fake.append(fake.mainPath(id), assistant({ id: 'new', stop: 'end_turn', usage: usage(1000, 100) }));
    await until(() => h.state().sessions[id]?.usage.messages === 401);
  });

  it('reports progress in order, partial then whole, and history rows get their usd', async () => {
    const r = await rig((fake) => {
      for (let i = 0; i < 6; i += 1) {
        const file = fake.mainPath(sid(60 + i));
        fake.append(file, ...big(5, `s${i}-`));
        const old = new Date(Date.now() - 2 * 86_400_000);
        utimesSync(file, old, old);
      }
    });
    const { h } = r;
    await until(() => h.state().index.stage === 'done');
    const stages = h.of('index.progress').map((e) => e.progress.stage);
    assert.equal(stages[0], 'stat');
    assert.ok(stages.indexOf('head') < stages.indexOf('usage'));
    assert.equal(stages.at(-1), 'done');
    const digests = h.of('history.digest').flatMap((e) => e.rows);
    assert.ok(digests.some((row) => row.usd === null), 'a row can come before its usage');
    assert.ok(digests.some((row) => row.usd !== null));
    const history = await h.call('history.get', {});
    assert.equal(history.rows.length, 6);
    assert.ok(history.rows.every((row) => row.usd !== null && row.outcome === 'clean'));
    const ledger = await h.call('ledger.get', {});
    assert.equal(ledger.partial, false);
    assert.ok(ledger.days30Usd > 0);
    assert.equal(h.state().worlds[history.rows[0]?.worldId ?? '']?.lightsTotal, 6);
  });

  it('caches by path, size and mtime, so a restart parses nothing that did not change', async () => {
    const fake = new FakeClaude();
    const dbFile = path.join(fake.root, 'obs.db');
    const file = fake.mainPath(sid(70));
    fake.append(file, ...big(10, 'c'));
    const old = new Date(Date.now() - 2 * 86_400_000);
    utimesSync(file, old, old);
    try {
      const first = makeHarness(fake.home, dbFile);
      const a = new Observer();
      await a.start(first.ctx);
      await until(() => first.state().index.stage === 'done');
      assert.equal(a.timings.usageFiles, 1);
      await a.stop();
      first.close();

      const second = makeHarness(fake.home, dbFile);
      const b = new Observer();
      await b.start(second.ctx);
      await until(() => second.state().index.stage === 'done');
      assert.equal(b.timings.usageFiles, 0);
      assert.equal(b.timings.usageCached, 1);
      const ledger = await second.call('ledger.get', {});
      assert.ok(ledger.days30Usd > 0);
      await b.stop();
      second.close();
    } finally {
      fake.cleanup();
    }
  });

  it('replays past fan-outs from file birth times into history salvos', async () => {
    const id = sid(80);
    const r = await rig((fake) => {
      const dir = path.join(fake.dir(id), 'subagents', 'workflows', 'wf_old-1');
      for (const agent of ['a', 'b', 'c', 'd']) fake.append(path.join(dir, `agent-${agent}.jsonl`), assistant({ id: agent }));
    });
    const { h } = r;
    await until(() => h.state().index.stage === 'done');
    const history = await h.call('history.get', {});
    assert.equal(history.salvos.length, 1);
    assert.equal(history.salvos[0]?.source, 'workflow');
    assert.equal(history.salvos[0]?.nodeIds.length, 4);
    assert.ok(history.salvos[0]?.closedAt);
    assert.equal(h.of('salvo.opened').length, 0, 'the past never fires the hero');
  });

  it('reports a transcript retention took', async () => {
    const id = sid(81);
    const r = await rig((fake) => {
      const file = fake.mainPath(id);
      fake.append(file, assistant({ id: 'm' }));
      const old = new Date(Date.now() - 2 * 86_400_000);
      utimesSync(file, old, old);
    });
    const { fake, h, obs } = r;
    await until(() => h.state().index.stage === 'done');
    unlinkSync(fake.mainPath(id));
    await (obs as unknown as { refreshFiles(): Promise<void> }).refreshFiles();
    assert.deepEqual(h.of('history.expired')[0]?.nodeIds, [id]);
    assert.equal((await h.call('history.get', {})).rows.length, 0);
  });
});

describe('commands and plan', () => {
  it('craft.channel gives structure only, with tool durations, and refuses an unknown craft', async () => {
    const id = sid(90);
    const r = await rig((fake) => {
      fake.append(fake.mainPath(id),
        userPrompt('private prompt', { at: 0 }),
        assistant({ id: 'm1', stop: 'tool_use', content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text: 'private text' }, toolUse('t1', 'Bash', { command: 'ls' })], usage: usage(10, 10, { output_tokens_details: { thinking_tokens: 4 } }) }, { at: 1000 }),
        toolResult('t1', { at: 2500 }),
        assistant({ id: 'm2', stop: 'end_turn' }, { at: 3000 }),
      );
      fake.pidFile(process.pid, liveRecord(id, fake.repo('chi')));
    });
    const { h } = r;
    const { rows, complete } = await h.call('craft.channel', { nodeId: id });
    assert.equal(complete, true);
    assert.deepEqual(rows.map((row) => row.kind), ['turn', 'thinking', 'text', 'tool', 'text']);
    const tool = rows.find((row) => row.kind === 'tool');
    assert.equal(tool?.kind === 'tool' ? tool.durationMs : null, 1500);
    assert.equal(tool?.kind === 'tool' ? tool.summary.shape : null, 'Bash, 1 line, 2 chars');
    assert.ok(!JSON.stringify(rows).includes('private'));
    await assert.rejects(h.call('craft.channel', { nodeId: 'no-such-node' }), /No transcript/);
    assert.deepEqual(await h.call('craft.text', { nodeId: 'no-such-node' }), { rows: [], available: false });
  });

  it('craft.text returns user and assistant text, without tool output or harness records', async () => {
    const id = sid(91);
    const r = await rig((fake) => {
      fake.append(fake.mainPath(id),
        userPrompt('hello', { at: 0 }),
        userPrompt('harness', { at: 1 }, { isMeta: true }),
        assistant({ id: 'm1', stop: 'tool_use', content: [{ type: 'thinking', thinking: 'hidden' }, { type: 'text', text: 'part one' }, toolUse('t', 'Read')] }, { at: 2 }),
        toolResult('t', { at: 3 }),
        assistant({ id: 'm2', stop: 'end_turn', content: [{ type: 'text', text: 'done' }] }, { at: 4 }),
      );
      fake.pidFile(process.pid, liveRecord(id, fake.repo('psi')));
    });
    const { rows, available } = await r.h.call('craft.text', { nodeId: id });
    assert.equal(available, true);
    assert.deepEqual(rows.map((row) => [row.role, row.text]), [['user', 'hello'], ['assistant', 'part one'], ['assistant', 'done']]);
    assert.deepEqual((await r.h.call('craft.text', { nodeId: id, limit: 1 })).rows.map((row) => row.text), ['done']);
  });

  it('publishes plan.changed from the one key of .claude.json', async () => {
    const r = await rig((fake) => {
      writeFileSync(path.join(fake.root, '.claude.json'), JSON.stringify({
        oauthAccount: { private: 'private-value' },
        cachedUsageUtilization: {
          fetchedAtMs: 5,
          utilization: { five_hour: { utilization: 25, resets_at: '2026-10-31T00:00:00+00:00' }, seven_day: { utilization: 50, resets_at: null }, limits: [] },
        },
      }));
    });
    const [e] = r.h.of('plan.changed');
    assert.equal(e?.plan.fiveHourLeft, 0.75);
    assert.equal(e?.plan.sevenDayLeft, 0.5);
    assert.ok(!JSON.stringify(r.h.events).includes('private-value'));
    assert.ok(!r.h.logs.join('\n').includes('private-value'));
  });

  it('derives rates through the bus and sets the context window from the catalog', async () => {
    const r = await rig((fake) => {
      const dir = path.join(fake.home, 'cache', 'model-catalog');
      fake.append(path.join(dir, 'x.json'), { catalog: { config: { models: [{ id: 'claude-opus-5-5', runtime: { max_input_tokens: 1234 } }] } } });
    });
    const { fake, h } = r;
    const id = sid(92);
    fake.pidFile(process.pid, liveRecord(id, fake.repo('omega'), { status: 'busy' }));
    await until(() => h.of('session.discovered').length === 1);
    fake.append(fake.mainPath(id),
      apiRequest({ at: 0 }),
      assistant({ id: 'm1', stop: 'end_turn', usage: usage(100, 500, { cache_read_input_tokens: 50, cache_creation_input_tokens: 25 }) }, { at: 10_000 }),
    );
    await until(() => h.rates.has(id));
    assert.equal(h.rates.get(id)?.tps, 50);
    assert.equal(h.rates.get(id)?.source, 'derived');
    await until(() => h.state().sessions[id]?.contextWindow === 1234);
    assert.equal(h.state().sessions[id]?.contextTokens, 175);
    await until(() => h.fleet.tps !== undefined);
  });

  it('stops clean: no timers, no watchers, no worker left', async () => {
    const r = await rig();
    await r.obs.stop();
    const before = r.h.events.length;
    r.fake.pidFile(process.pid, liveRecord(sid(93), r.fake.repo('end')));
    await new Promise((resolve) => setTimeout(resolve, 1300));
    assert.equal(r.h.events.length, before);
  });
});
