// The state machine, the send queue, admission, budgets and restart, against a scripted SDK. No model and no processes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import type { AgentState, ApprovalView, ManagedAgentView, PlanState, SpawnSpec } from '@naos/protocol';
import { DEFAULT_LIMITS, FIRST_FLIGHT_SPEC, WORLD_DESIGNER_PROFILE, emptyState, reduce } from '@naos/protocol';
import { CommandError } from '../../src/context.ts';
import { DENY_TEXT, rememberRules, resultFor } from '../../src/control/approvals.ts';
import { rulePath } from '../../src/control/options.ts';
import { toFiletime, type Proc } from '../../src/control/procs.ts';
import { TRANSITIONS } from '../../src/control/supervisor.ts';
import { fakeTranscript, frames, hold, makeRig, reply, tick, tmpDir, until, type FakeProcess, type Rig, type Script } from './harness.ts';

const rigs: Rig[] = [];
const rig = async (o: Parameters<typeof makeRig>[0] = {}): Promise<Rig> => {
  const r = await makeRig(o);
  rigs.push(r);
  return r;
};
afterEach(async () => {
  for (const r of rigs.splice(0)) {
    for (const p of r.sdk.processes) p.exit();
    await tick(5);
    await r.stop();
  }
});

const spec = (r: Rig, over: Partial<SpawnSpec> = {}): SpawnSpec => ({ cwd: r.repo, profile: 'plain', prompt: 'do it', ...over });
const ui = { kind: 'ui' } as const;

const spawn = async (r: Rig, over: Partial<SpawnSpec> = {}): Promise<string> => {
  const receipt = await r.control.supervisor.spawn(spec(r, over), ui);
  return receipt.agentIds[0]!;
};
const view = (r: Rig, id: string): ManagedAgentView => r.control.supervisor.status(id);
const reach = (r: Rig, id: string, state: AgentState): Promise<void> => until(() => view(r, id).state === state);
const states = (r: Rig, id: string): AgentState[] => {
  const out: AgentState[] = [];
  for (const e of r.of('managed.upserted')) if (e.agent.agentId === id && out.at(-1) !== e.agent.state) out.push(e.agent.state);
  return out;
};
const processOf = (r: Rig, id: string): FakeProcess => r.sdk.processes.find((p) => p.options.title === `naos:${id}` || p.options.resume === view(r, id).sessionId || p.options.sessionId === view(r, id).sessionId)!;

describe('state machine', () => {
  it('walks queued, spawning, ready, running, idle, with a row before query()', async () => {
    const r = await rig();
    let rowAtQuery: unknown = null;
    r.sdk.beforeQuery = (o) => {
      rowAtQuery = r.db.get('SELECT agentId, sessionId, cwd FROM managed_sessions WHERE sessionId = ?', o.sessionId!);
      assert.equal(r.control.registry.lookup({ sessionId: o.sessionId! }) !== null, true);
    };
    const id = await spawn(r);
    await reach(r, id, 'idle');
    assert.deepEqual(states(r, id), ['queued', 'spawning', 'ready', 'running', 'idle']);
    assert.ok(rowAtQuery);
    const v = view(r, id);
    assert.equal(v.turn, 1);
    assert.equal(v.spentUsd, 0.001);
    assert.equal(v.nodeId, v.sessionId);
    assert.equal(v.pid, r.sdk.last.pid);
    assert.equal(r.control.registry.lookup({ pid: v.pid! }), id);
    assert.equal(r.control.registry.lookup({ title: `naos:${id}` }), id);
    assert.equal(r.sdk.last.options.title, `naos:${id}`);
    assert.equal(r.sdk.last.options.sessionId, v.sessionId);
    assert.equal(r.sdk.last.sent[0]?.origin?.kind, 'human');
    const session = r.bus.state().sessions[v.sessionId!];
    assert.equal(session?.origin, 'control');
    assert.equal(r.bus.state().nodes[v.nodeId]?.kind, 'main');
    assert.equal(r.bus.state().managed[id]?.state, 'idle');
  });

  it('events replay through the reducer into the same state', async () => {
    const r = await rig();
    const id = await spawn(r);
    await reach(r, id, 'idle');
    const replay = reduce(emptyState(), r.events);
    assert.deepEqual(replay.managed, r.bus.state().managed);
    assert.deepEqual(replay.sessions, r.bus.state().sessions);
  });

  it('text reaches only the text sink', async () => {
    const r = await rig();
    const id = await spawn(r);
    await reach(r, id, 'idle');
    assert.deepEqual(r.texts.map((t) => t.delta), ['private']);
    assert.ok(!JSON.stringify(r.events).includes('private'));
  });

  it('the table never lets a closed agent move', () => {
    assert.deepEqual(TRANSITIONS.closed, []);
    for (const next of TRANSITIONS.stopping) assert.ok(['exited', 'crashed', 'lost'].includes(next));
  });

  it('a missing folder fails plainly, before any spawn', async () => {
    const r = await rig();
    await assert.rejects(r.control.supervisor.spawn(spec(r, { cwd: path.join(r.repo, 'nope') }), ui), /does not exist/);
    assert.equal(r.sdk.processes.length, 0);
  });

  it('an unknown profile is refused', async () => {
    const r = await rig();
    await assert.rejects(r.control.supervisor.spawn(spec(r, { profile: 'nope' }), ui), /No profile/);
  });

  it('terminal_reason decides, never subtype', async () => {
    const r = await rig();
    r.sdk.script = hold;
    const id = await spawn(r);
    await reach(r, id, 'running');
    const p = r.sdk.last;
    const uuid = p.sent[0]!.uuid!;
    p.emit(frames.result({ uuids: [uuid], cost: 0.001, reason: 'aborted_streaming', subtype: 'success' }));
    await reach(r, id, 'idle');
    assert.equal(view(r, id).lastTurnAborted, true);
    assert.equal(view(r, id).failure, null);

    r.control.supervisor.send(id, 'again', 'queue', ui);
    await until(() => p.sent.length === 2);
    p.emit(frames.result({ uuids: [p.sent[1]!.uuid!], cost: 0.002, reason: 'something_new', subtype: 'success' }));
    await until(() => view(r, id).lastTerminalReason === 'something_new');
    assert.equal(view(r, id).state, 'idle');
    assert.equal(view(r, id).failure, 'Turn ended: something_new');

    r.control.supervisor.send(id, 'again', 'queue', ui);
    await until(() => p.sent.length === 3);
    p.emit(frames.result({ uuids: [p.sent[2]!.uuid!], cost: 0.003, reason: 'tool_deferred' }));
    await reach(r, id, 'parked');
  });
});

describe('send queue', () => {
  it('holds follow-ups in the kernel and sends one per turn', async () => {
    const r = await rig();
    r.sdk.script = hold;
    const id = await spawn(r);
    await reach(r, id, 'running');
    const sup = r.control.supervisor;
    sup.send(id, 'two', 'queue', ui);
    sup.send(id, 'three', 'queue', ui);
    assert.equal(view(r, id).queuedSends, 2);
    assert.equal(r.sdk.last.sent.length, 1);
    const p = r.sdk.last;
    p.emit(frames.result({ uuids: [p.sent[0]!.uuid!], cost: 0.001 }));
    await until(() => p.sent.length === 2);
    assert.equal(view(r, id).queuedSends, 1);
    assert.equal(view(r, id).state, 'running');
    p.emit(frames.result({ uuids: [p.sent[1]!.uuid!], cost: 0.002 }));
    await until(() => p.sent.length === 3);
    p.emit(frames.result({ uuids: [p.sent[2]!.uuid!], cost: 0.003 }));
    await reach(r, id, 'idle');
    assert.equal(view(r, id).turn, 3);
    assert.equal(view(r, id).spentUsd, 0.003);
  });

  it('priority now reaches the CLI at once and an older result does not end the new turn', async () => {
    const r = await rig();
    r.sdk.script = hold;
    const id = await spawn(r);
    await reach(r, id, 'running');
    const p = r.sdk.last;
    r.control.supervisor.send(id, 'now', 'now', ui);
    await until(() => p.sent.length === 2);
    assert.equal(p.sent[1]?.priority, 'now');
    p.emit(frames.result({ uuids: [p.sent[0]!.uuid!], cost: 0.001, reason: 'aborted_streaming' }));
    await until(() => view(r, id).lastTerminalReason === 'aborted_streaming');
    assert.equal(view(r, id).state, 'running');
    p.emit(frames.result({ uuids: [p.sent[1]!.uuid!], cost: 0.002 }));
    await reach(r, id, 'idle');
  });

  it('a merged turn answers every send it consumed', async () => {
    const r = await rig();
    r.sdk.script = hold;
    const id = await spawn(r);
    await reach(r, id, 'running');
    const p = r.sdk.last;
    r.control.supervisor.send(id, 'now', 'now', ui);
    await until(() => p.sent.length === 2);
    p.emit(frames.result({ uuids: [p.sent[0]!.uuid!, p.sent[1]!.uuid!], cost: 0.001 }));
    await reach(r, id, 'idle');
  });

  it('a synthetic result on resume changes nothing', async () => {
    const r = await rig();
    r.sdk.script = hold;
    const id = await spawn(r);
    await reach(r, id, 'running');
    const synthetic = frames.result({ uuids: [], cost: 0, numTurns: 0 });
    delete (synthetic as unknown as Record<string, unknown>).user_message_uuid;
    r.sdk.last.emit(synthetic);
    await tick(10);
    assert.equal(view(r, id).state, 'running');
  });

  it('sends are refused where they can never run', async () => {
    const r = await rig();
    const id = await spawn(r);
    await reach(r, id, 'idle');
    await r.control.supervisor.stop(id);
    assert.throws(() => r.control.supervisor.send(id, 'x', 'queue', ui), /Resume it first/);
  });
});

describe('stop', () => {
  it('runs interrupt, end of input, and never close', async () => {
    const r = await rig();
    r.sdk.script = hold;
    const id = await spawn(r);
    await reach(r, id, 'running');
    const p = r.sdk.last;
    p.onInterrupt = () => p.emit(frames.result({ uuids: [p.sent[0]!.uuid!], cost: 0.001, reason: 'aborted_streaming' }));
    assert.equal(await r.control.supervisor.stop(id), 'graceful');
    assert.equal(p.interrupts, 1);
    assert.equal(p.ended, true);
    assert.equal(p.closed, false);
    assert.equal(view(r, id).state, 'exited');
    const steps = r.of('managed.upserted').filter((e) => e.agent.agentId === id).map((e) => e.agent.stopStep).filter(Boolean);
    assert.deepEqual([...new Set(steps)], ['interrupt', 'end of input']);
    assert.equal(view(r, id).pid, null);
    assert.equal(r.control.registry.lookup({ pid: p.pid }), null);
    assert.equal(await r.control.supervisor.stop(id), 'already-stopped');
  });

  it('falls back to the tree kill when the process will not leave', { timeout: 15000 }, async () => {
    const r = await rig();
    const id = await spawn(r);
    await reach(r, id, 'idle');
    const p = r.sdk.last;
    p.exitOnEof = false;
    assert.equal(await r.control.supervisor.stop(id), 'forced');
    assert.deepEqual(r.kills, [p.pid]);
    assert.equal(view(r, id).state, 'exited');
  });

  it('stops an idle agent without waiting for a result that will not come', async () => {
    const r = await rig();
    const id = await spawn(r);
    await reach(r, id, 'idle');
    const t = Date.now();
    await r.control.supervisor.stop(id);
    assert.ok(Date.now() - t < 1000);
  });

  it('a queued agent leaves the Pad', async () => {
    const r = await rig();
    r.sdk.script = hold;
    r.control.supervisor.freeze(true);
    const receipt = await r.control.supervisor.spawn(spec(r, { queue: true }), ui);
    const id = receipt.agentIds[0]!;
    assert.deepEqual(r.control.supervisor.admission().queued, [id]);
    assert.equal(await r.control.supervisor.stop(id), 'graceful');
    assert.deepEqual(r.control.supervisor.admission().queued, []);
    assert.equal(r.sdk.processes.length, 0);
  });

  it('an error exit after an error result is not a crash, an unexplained one is', async () => {
    const r = await rig();
    r.sdk.script = hold;
    const a = await spawn(r);
    await reach(r, a, 'running');
    const p = r.sdk.last;
    p.emit(frames.result({ uuids: [p.sent[0]!.uuid!], cost: 0.001, reason: 'aborted_tools', subtype: 'error_during_execution', isError: true }));
    await reach(r, a, 'idle');
    p.exit('Claude Code process exited with code 1');
    await reach(r, a, 'exited');

    const b = await spawn(r);
    await reach(r, b, 'running');
    r.sdk.last.exit('Claude Code process exited with code 1');
    await reach(r, b, 'crashed');
    assert.match(view(r, b).failure!, /unexpectedly/);
  });

  it('stopAll stops everything owned and counts what it cannot reach', async () => {
    const r = await rig();
    const a = await spawn(r);
    const b = await spawn(r);
    await reach(r, a, 'idle');
    await reach(r, b, 'idle');
    assert.deepEqual(await r.control.supervisor.stopAll(), { stopped: 2, outOfReach: 0 });
    assert.equal(view(r, a).state, 'exited');
  });
});

describe('admission', () => {
  it('refuses past the running limit, or queues on request, and drains in order', async () => {
    const r = await rig();
    r.sdk.script = hold;
    const ids: string[] = [];
    for (let i = 0; i < DEFAULT_LIMITS.runningGlobal; i += 1) ids.push(await spawn(r));
    await until(() => ids.every((id) => view(r, id).state === 'running'));
    assert.equal(r.control.supervisor.admission().running, 6);

    await assert.rejects(r.control.supervisor.spawn(spec(r), ui), (e: CommandError) => e.code === 'limit' && /6 of 6/.test(e.message));
    assert.deepEqual(r.of('spawn.refused').map((e) => e.limit), ['admission']);

    const receipt = await r.control.supervisor.spawn(spec(r, { queue: true }), ui);
    assert.equal(receipt.queued, 1);
    const waiting = receipt.agentIds[0]!;
    assert.equal(view(r, waiting).state, 'queued');
    assert.deepEqual(r.bus.state().admission.queued, [waiting]);

    const p = processOf(r, ids[0]!);
    p.emit(frames.result({ uuids: [p.sent[0]!.uuid!], cost: 0.001 }));
    await reach(r, waiting, 'running');
    assert.deepEqual(r.bus.state().admission.queued, []);
  });

  it('freezes at 80 percent of the plan window and opens again when it drops', async () => {
    const r = await rig();
    const plan = (left: number): PlanState => ({ fiveHourLeft: left, sevenDayLeft: 0.5, asOf: Date.now(), resetsAt: { fiveHour: Date.now() + 3_600_000, sevenDay: null }, status: 'allowed' });
    r.bus.publish({ type: 'plan.changed', plan: plan(0.15) });
    assert.equal(r.control.supervisor.admission().frozen, 'plan-window');
    await assert.rejects(r.control.supervisor.spawn(spec(r), ui), /five-hour window/);
    const queued = await r.control.supervisor.spawn(spec(r, { queue: true }), ui);
    const id = queued.agentIds[0]!;
    assert.equal(r.bus.state().admission.frozen, 'plan-window');
    r.bus.publish({ type: 'plan.changed', plan: plan(0.5) });
    await reach(r, id, 'idle');
    assert.equal(r.control.supervisor.admission().frozen, null);
  });

  it('a rejected rate limit freezes, marks the agent, and clears at the reset', async () => {
    const r = await rig();
    r.sdk.script = hold;
    const id = await spawn(r);
    await reach(r, id, 'running');
    const resetsAt = Math.ceil(Date.now() / 1000) + 1;
    r.sdk.last.emit(frames.rateLimit('rejected', 1, resetsAt));
    await reach(r, id, 'rate_limited');
    assert.equal(r.control.supervisor.admission().frozen, 'rate-limited');
    assert.equal(r.bus.state().plan?.status, 'rejected');
    assert.equal(r.bus.state().plan?.fiveHourLeft, 0);
    await until(() => view(r, id).state === 'idle', 2500);
    assert.equal(r.control.supervisor.admission().frozen, null);
  });

  it('a plain rate limit event updates the plan on both scales', async () => {
    const r = await rig();
    r.sdk.script = hold;
    const id = await spawn(r);
    await reach(r, id, 'running');
    r.sdk.last.emit(frames.rateLimit('allowed', 0.08));
    await until(() => r.bus.state().plan !== null);
    assert.equal(r.bus.state().plan?.fiveHourLeft, 0.92);
    assert.equal(r.bus.state().plan?.sevenDayLeft, 0.97);
  });

  it('copies launch together', async () => {
    const r = await rig();
    const receipt = await r.control.supervisor.spawn(spec(r, { copies: 3 }), ui);
    assert.equal(receipt.agentIds.length, 3);
    const lead = view(r, receipt.agentIds[0]!).nodeId;
    assert.deepEqual(receipt.agentIds.map((id) => view(r, id).copyOf), [lead, lead, lead], 'the salvo gathers on the first copy');
    await until(() => receipt.agentIds.every((id) => view(r, id).state === 'idle'));
  });
});

describe('budgets', () => {
  it('the cap goes to the binary, and the cost is read, never summed', async () => {
    const r = await rig();
    const id = await spawn(r, { budgetUsd: 0.03 });
    await reach(r, id, 'idle');
    assert.equal(r.sdk.last.options.maxBudgetUsd, 0.03);
    r.control.supervisor.send(id, 'more', 'queue', ui);
    await until(() => view(r, id).turn === 2 && view(r, id).state === 'idle');
    assert.equal(view(r, id).spentUsd, 0.002);
  });

  it('budget_exhausted blocks sends until budget is added, then a new process runs', async () => {
    const r = await rig();
    r.sdk.script = hold;
    const id = await spawn(r, { budgetUsd: 0.01 });
    await reach(r, id, 'running');
    const p = r.sdk.last;
    fakeTranscript(r.claudeHome, r.repo, view(r, id).sessionId!);
    p.emit(frames.result({ uuids: [p.sent[0]!.uuid!], cost: 0.011, reason: 'budget_exhausted', subtype: 'error_max_budget_usd', isError: true }));
    await reach(r, id, 'budget_exhausted');
    assert.throws(() => r.control.supervisor.send(id, 'x', 'queue', ui), (e: CommandError) => e.code === 'limit');
    r.sdk.script = reply;
    await r.control.supervisor.addBudget(id, 0.02);
    await until(() => r.sdk.processes.length === 2 && view(r, id).state === 'ready');
    const fresh = r.sdk.last;
    assert.equal(fresh.options.resume, view(r, id).sessionId);
    assert.ok(Math.abs(fresh.options.maxBudgetUsd! - 0.019) < 1e-9, 'only the free budget goes to the new process');
  });

  it('a mission tree stops at 100 percent and refuses further spawns', async () => {
    const r = await rig();
    r.sdk.script = hold;
    const root = await spawn(r, { profile: 'orchestrator', mission: { treeBudgetUsd: 0.05, childLimit: 4, depth: 2 } });
    await reach(r, root, 'running');
    const child = (await r.control.supervisor.spawnChild(root, { prompt: 'x', profile: 'plain', budget_usd: 1 })).agent_id;
    await reach(r, child, 'running');
    assert.equal(view(r, child).budgetUsd, 0.05, 'min(requested, remaining)');
    const childProcess = processOf(r, child);
    childProcess.emit(frames.result({ uuids: [childProcess.sent[0]!.uuid!], cost: 0.03 }));
    await until(() => view(r, root).treeSpentUsd === 0.03);
    assert.equal(view(r, child).treeSpentUsd, 0.03);
    const rootProcess = processOf(r, root);
    rootProcess.emit(frames.result({ uuids: [rootProcess.sent[0]!.uuid!], cost: 0.025 }));
    await until(() => view(r, root).state === 'exited' && view(r, child).state === 'exited');
    await assert.rejects(r.control.supervisor.spawnChild(root, { prompt: 'x', profile: 'plain' }), /tree budget/);
  });

  it('resumed totals are not added twice', async () => {
    const r = await rig();
    const id = await spawn(r);
    await reach(r, id, 'idle');
    fakeTranscript(r.claudeHome, r.repo, view(r, id).sessionId!);
    await r.control.supervisor.stop(id);
    r.sdk.script = (p, m) => {
      p.costUsd = 0.0015; // Restored, as the CLI does: 0.001 before plus 0.0005 now.
      p.emit(frames.result({ uuids: [m.uuid!], cost: p.costUsd }));
    };
    await r.control.supervisor.resume(id, 'go on');
    await reach(r, id, 'idle');
    assert.equal(view(r, id).spentUsd, 0.0015);
  });

  it('a restart that lost the restored total still counts what was known', async () => {
    const r = await rig();
    const id = await spawn(r);
    await reach(r, id, 'idle');
    fakeTranscript(r.claudeHome, r.repo, view(r, id).sessionId!);
    await r.control.supervisor.stop(id);
    r.sdk.script = (p, m) => {
      p.costUsd = 0.0004; // No cost-state after a hard kill.
      p.emit(frames.result({ uuids: [m.uuid!], cost: p.costUsd }));
    };
    await r.control.supervisor.resume(id, 'go on');
    await reach(r, id, 'idle');
    assert.equal(view(r, id).spentUsd, 0.0014);
  });
});

describe('fork, resume, close', () => {
  it('resume needs a transcript, and keeps the session id with a new pid', async () => {
    const r = await rig();
    const id = await spawn(r);
    await reach(r, id, 'idle');
    const { sessionId, pid } = view(r, id);
    await r.control.supervisor.stop(id);
    await assert.rejects(r.control.supervisor.resume(id, 'x'), /no transcript/);
    fakeTranscript(r.claudeHome, r.repo, sessionId!);
    await r.control.supervisor.resume(id, 'go on');
    await until(() => view(r, id).state === 'idle' && view(r, id).turn === 2);
    const v = view(r, id);
    assert.equal(v.sessionId, sessionId);
    assert.notEqual(v.pid, pid);
    assert.equal(r.sdk.last.options.resume, sessionId);
    assert.equal(r.sdk.last.options.sessionId, undefined);
    assert.equal(r.control.registry.lookup({ pid: v.pid! }), id);
    assert.equal(r.bus.state().sessions[sessionId!]?.endedAt, null);
  });

  it('a scratch agent keeps nothing to resume', async () => {
    const r = await rig();
    const id = await spawn(r, { profile: 'scratch' });
    await reach(r, id, 'idle');
    assert.equal(r.sdk.last.options.persistSession, false);
    await r.control.supervisor.stop(id);
    await until(() => view(r, id).state === 'exited');
    assert.equal(view(r, id).resumable, false);
    await assert.rejects(r.control.supervisor.fork(id), /no transcript/);
  });

  it('fork adds a row with a new session, and does not count the source twice', async () => {
    const r = await rig();
    const id = await spawn(r);
    await reach(r, id, 'idle');
    const source = view(r, id);
    fakeTranscript(r.claudeHome, r.repo, source.sessionId!);
    r.sdk.script = (p, m) => {
      p.costUsd = 0.0013;
      p.emit(frames.result({ uuids: [m.uuid!], cost: p.costUsd }));
    };
    const receipt = await r.control.supervisor.fork(id);
    const forked = receipt.agentIds[0]!;
    await reach(r, forked, 'ready');
    const v = view(r, forked);
    assert.notEqual(v.sessionId, source.sessionId);
    assert.equal(r.sdk.last.options.forkSession, true);
    assert.equal(r.sdk.last.options.resume, source.sessionId);
    assert.equal(r.sdk.last.options.sessionId, v.sessionId);
    assert.equal(r.db.all('SELECT agentId FROM managed_sessions').length, 2);
    r.control.supervisor.send(forked, 'hello', 'queue', ui);
    await reach(r, forked, 'idle');
    assert.equal(view(r, forked).spentUsd, 0.0003);
  });

  it('close is terminal and refuses later moves', async () => {
    const r = await rig();
    const id = await spawn(r);
    await reach(r, id, 'idle');
    assert.deepEqual(await r.control.supervisor.close(id), { closed: true });
    assert.equal(view(r, id).state, 'closed');
    await assert.rejects(r.control.supervisor.resume(id), /still running/);
    assert.deepEqual(await r.control.supervisor.close(id), { closed: true });
  });

  it('wait returns at the deadline, or with the result when done', async () => {
    const r = await rig();
    r.sdk.script = hold;
    const id = await spawn(r);
    await reach(r, id, 'running');
    const early = await r.control.supervisor.wait(id, 0.05);
    assert.equal(early.done, false);
    const p = r.sdk.last;
    setTimeout(() => p.emit(frames.result({ uuids: [p.sent[0]!.uuid!], cost: 0.001, text: 'the answer' })), 20);
    const late = await r.control.supervisor.wait(id, 5);
    assert.equal(late.done, true);
    assert.equal(late.result, 'the answer');
  });
});

describe('approvals', () => {
  const asking = async (r: Rig, extra: Record<string, unknown> = {}, tool = 'Bash', input: Record<string, unknown> = { command: 'touch x' }): Promise<{ id: string; answer: ReturnType<FakeProcess['ask']>; approval: ApprovalView; p: FakeProcess }> => {
    r.sdk.script = hold;
    const id = await spawn(r);
    await reach(r, id, 'running');
    const p = r.sdk.last;
    const answer = p.ask(tool, input, extra);
    await reach(r, id, 'awaiting_approval');
    const approval = Object.values(r.bus.state().approvals).at(-1)!;
    return { id, answer, approval, p };
  };

  it('asks, publishes, and answers once', async () => {
    const r = await rig();
    const { id, answer, approval } = await asking(r);
    assert.equal(approval.status, 'open');
    assert.equal(approval.toolFamily, 'shell');
    assert.equal(view(r, id).openApprovals, 1);
    assert.equal(r.bus.state().sessions[view(r, id).sessionId!]?.activity.state, 'waiting');

    assert.deepEqual(r.control.supervisor.answer(approval.requestId, { kind: 'approve' }, 'tab-1'), { applied: true });
    assert.deepEqual(r.control.supervisor.answer(approval.requestId, { kind: 'deny' }, 'tab-2'), { applied: false });
    assert.deepEqual(await answer, { behavior: 'allow', updatedInput: { command: 'touch x' } });
    assert.equal(view(r, id).state, 'running');
    assert.equal(view(r, id).openApprovals, 0);
    const settled = r.bus.state().approvals[approval.requestId]!;
    assert.equal(settled.status, 'answered');
    assert.equal(settled.answeredBy, 'tab-1');
    assert.equal(settled.outcome, 'approve');
  });

  it('the signal cancels: the card leaves and approval.cancelled fires', async () => {
    const r = await rig();
    const { id, answer, approval, p } = await asking(r);
    p.controllers[0]!.abort();
    assert.equal((await answer).behavior, 'deny');
    assert.equal(r.bus.state().approvals[approval.requestId]?.status, 'withdrawn');
    assert.deepEqual(r.of('approval.cancelled').map((e) => e.requestId), [approval.requestId]);
    assert.equal(view(r, id).openApprovals, 0);
    assert.deepEqual(r.control.supervisor.answer(approval.requestId, { kind: 'approve' }, 't'), { applied: false });
  });

  it('a signal already aborted never opens a card', async () => {
    const r = await rig();
    r.sdk.script = hold;
    const id = await spawn(r);
    await reach(r, id, 'running');
    const controller = new AbortController();
    controller.abort();
    const out = await r.sdk.last.options.canUseTool!('Bash', {}, { signal: controller.signal, toolUseID: 'x', requestId: 'y' } as never);
    assert.equal(out?.behavior, 'deny');
    assert.equal(r.of('approval.requested').length, 0);
  });

  it('two overlapping requests count, and the state waits for both', async () => {
    const r = await rig();
    const { id, approval, p } = await asking(r);
    const second = p.ask('Write', { file_path: 'x' }, { agentID: 'sub1' });
    await until(() => view(r, id).openApprovals === 2);
    r.control.supervisor.answer(approval.requestId, { kind: 'approve' }, 't');
    assert.equal(view(r, id).state, 'awaiting_approval');
    const other = Object.values(r.bus.state().approvals).find((a) => a.status === 'open')!;
    assert.equal(other.subagentId, 'sub1');
    r.control.supervisor.answer(other.requestId, { kind: 'deny' }, 't');
    await second;
    assert.equal(view(r, id).state, 'running');
  });

  it('decisions map to the return values of AC 9.2', () => {
    const base = { input: { a: 1 }, toolName: 'Bash' } as unknown as ApprovalView;
    const rule: PermissionUpdate = { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'touch x' }], behavior: 'allow', destination: 'localSettings' };
    const setMode: PermissionUpdate = { type: 'setMode', mode: 'acceptEdits', destination: 'session' };

    assert.deepEqual(resultFor({ kind: 'approve' }, base, []), { behavior: 'allow', updatedInput: { a: 1 } });
    assert.deepEqual(resultFor({ kind: 'approve', input: { a: 2 }, edited: true }, base, []), { behavior: 'allow', updatedInput: { a: 2 } });
    assert.deepEqual(resultFor({ kind: 'deny' }, base, []), { behavior: 'deny', message: DENY_TEXT });
    assert.equal(DENY_TEXT, 'Not approved for this call.');
    assert.deepEqual(resultFor({ kind: 'deny', message: 'Use ls.' }, base, []), { behavior: 'deny', message: 'Use ls.' });
    assert.deepEqual(resultFor({ kind: 'stop' }, base, []), { behavior: 'deny', message: DENY_TEXT, interrupt: true });
    assert.deepEqual(resultFor({ kind: 'answer', answers: { q: 'blue' } }, { ...base, input: { questions: [] } }, []), { behavior: 'allow', updatedInput: { questions: [], answers: { q: 'blue' } } });

    const session = resultFor({ kind: 'session' }, base, [rule, setMode]);
    assert.ok(session.behavior === 'allow');
    assert.deepEqual(session.updatedPermissions, [{ ...rule, destination: 'session' }]);

    const write = resultFor({ kind: 'session' }, { ...base, toolName: 'Write' }, [setMode]);
    assert.ok(write.behavior === 'allow');
    assert.deepEqual(write.updatedPermissions, [{ type: 'addRules', rules: [{ toolName: 'Write' }], behavior: 'allow', destination: 'session' }]);

    assert.deepEqual(rememberRules('Bash', [rule], 'localSettings'), [rule]);
  });

  it('never passes a localSettings suggestion on an approve or a session grant', async () => {
    const r = await rig();
    const local = { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'touch x' }], behavior: 'allow', destination: 'localSettings' };
    const { answer, approval, id } = await asking(r, { suggestions: [local] });
    r.control.supervisor.answer(approval.requestId, { kind: 'session' }, 't');
    const out = await answer;
    assert.ok(out.behavior === 'allow');
    assert.ok(out.updatedPermissions?.every((u) => 'destination' in u && u.destination === 'session'));
    assert.deepEqual(r.bus.state().standing[id]?.map((g) => [g.rule, g.scope]), [['Bash(touch x)', 'session']]);
  });

  it('danger comes from the reason and from defaultToNo, and suppress hides always', async () => {
    const r = await rig();
    const outside = await asking(r, { decisionReason: 'Path is outside allowed working directories' });
    assert.equal(outside.approval.danger, true);
    r.control.supervisor.answer(outside.approval.requestId, { kind: 'deny' }, 't');
    const asked = outside.p.ask('Bash', {}, { defaultToNo: true, suppressAlwaysAllowRule: true });
    await until(() => r.of('approval.requested').length === 2);
    const flagged = r.of('approval.requested').at(-1)!.approval;
    assert.equal(flagged.danger, true);
    assert.equal(flagged.defaultToNo, true);
    assert.equal(flagged.canRememberForSession, false);
    assert.throws(() => r.control.supervisor.answer(flagged.requestId, { kind: 'session' }, 't'), /cannot be remembered/);
    assert.equal(r.control.supervisor.approvals.get(flagged.requestId)?.status, 'open');
    r.control.supervisor.answer(flagged.requestId, { kind: 'approve' }, 't');
    await asked;
  });

  it('an edit is written to the audit log, because the model is not told', async () => {
    const r = await rig();
    const { id, answer, approval } = await asking(r, {}, 'Write', { file_path: 'a', content: 'one' });
    r.control.supervisor.answer(approval.requestId, { kind: 'approve', input: { file_path: 'a', content: 'two' }, edited: true }, 't');
    assert.deepEqual(await answer, { behavior: 'allow', updatedInput: { file_path: 'a', content: 'two' } });
    assert.ok(r.control.store.auditRows(id).some((row) => row.event === 'approval.edited'));
  });

  it('redirect sends with priority now and settles the card', async () => {
    const r = await rig();
    const { answer, approval, p } = await asking(r);
    p.script = (q, m) => { if (m.priority === 'now') q.controllers[0]!.abort(); };
    r.control.supervisor.answer(approval.requestId, { kind: 'redirect', text: 'do this instead' }, 't');
    await until(() => p.sent.length === 2);
    assert.equal(p.sent[1]?.priority, 'now');
    assert.equal(r.bus.state().approvals[approval.requestId]?.outcome, 'redirect');
    assert.equal(p.controllers[0]?.signal.aborted, true);
    assert.equal((await answer).behavior, 'deny');
  });

  it('input stays out of the approvals table and the logs', async () => {
    const r = await rig();
    const { approval, answer } = await asking(r, {}, 'Bash', { command: 'SECRET-COMMAND' });
    const row = r.db.get<{ view: string }>('SELECT view FROM control_approvals WHERE requestId = ?', approval.requestId);
    assert.ok(!row?.view.includes('SECRET-COMMAND'));
    r.control.supervisor.answer(approval.requestId, { kind: 'approve' }, 't');
    await answer;
  });

  it('the audit hook sees calls that never reach canUseTool, and any throw stays inside', async () => {
    const r = await rig();
    const id = await spawn(r);
    await reach(r, id, 'idle');
    const pre = r.sdk.last.options.hooks!.PreToolUse![0]!.hooks[0]!;
    const out = await pre({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'echo hi' }, tool_use_id: 'tu', session_id: 's', transcript_path: '', cwd: '' } as never, 'tu', { signal: new AbortController().signal });
    assert.deepEqual(out, {});
    const rows = r.control.store.auditRows(id);
    assert.equal(rows.at(-1)?.toolName, 'Bash');
    assert.match(rows.at(-1)?.detail ?? '', /echo hi/);
    r.control.supervisor.trees.shellFinished(id);
  });
});

describe('First Flight', () => {
  it('one Haiku craft, a scratch folder under home, 0.02, no settings, strict MCP, Write only', async () => {
    const r = await rig();
    const receipt = await r.control.supervisor.spawn(FIRST_FLIGHT_SPEC, ui);
    const id = receipt.agentIds[0]!;
    await reach(r, id, 'idle');
    const { options } = r.sdk.last;
    assert.equal(options.model, 'claude-haiku-5-5');
    assert.equal(options.effort, 'low');
    assert.equal(options.maxBudgetUsd, 0.02);
    assert.deepEqual(options.settingSources, []);
    assert.equal(options.strictMcpConfig, true);
    assert.deepEqual(options.tools, ['Write']);
    assert.equal(options.permissionMode, 'default');
    assert.ok(options.cwd?.startsWith(r.home));
    assert.ok(fs.statSync(options.cwd!).isDirectory());
    assert.match(String(r.sdk.last.sent[0]?.message.content), new RegExp(`flight-${id}\\.txt`));
    const { deny } = (options.settings as { permissions: { deny: string[] } }).permissions;
    assert.ok(!deny.includes(`Edit(${rulePath(r.home)}/**)`), 'the scratch folder is not denied');
    assert.ok(deny.includes(`Read(${rulePath(r.home)}/*.token)`), 'the tokens still are');
  });

  it('is the operator\'s alone', async () => {
    const r = await rig();
    await assert.rejects(r.control.supervisor.spawn(FIRST_FLIGHT_SPEC, { kind: 'mcp' }), /operator/);
  });
});

const planetJson = JSON.stringify({ archetype: 'ice', rationale: 'A frozen protocol that rarely changes.' });
const genomeReply: Script = (p, m) => {
  p.costUsd += 0.001;
  const id = `msg_${p.sent.length}`;
  p.emit(frames.init(p.sessionId, p.cwd));
  p.emit(frames.requesting());
  p.emit(frames.messageStart(id));
  p.emit(frames.blockStart('text'));
  p.emit(frames.assistantText(id, planetJson));
  p.emit(frames.messageDelta(8));
  p.emit(frames.result({ uuids: [m.uuid!], cost: p.costUsd, text: planetJson }));
};

describe('World Designer', () => {
  it('reads the repo, writes a planet, and never loads its settings', async () => {
    const r = await rig();
    r.sdk.script = genomeReply;
    const world = r.worlds.ensure(r.repo, { kind: 'repo' });
    const receipt = await r.control.designers.request(world.worldId);
    const id = receipt.agentIds[0]!;
    await until(() => r.worlds.get(world.worldId)?.genome?.archetype === 'ice');
    const { options } = r.sdk.last;
    assert.equal(options.model, 'claude-haiku-5-5');
    assert.equal(options.effort, 'low');
    assert.equal(options.maxBudgetUsd, 0.05);
    assert.deepEqual(options.settingSources, []);
    assert.equal(options.strictMcpConfig, true);
    assert.deepEqual(options.tools, ['Read', 'Glob', 'Grep']);
    assert.equal(options.permissionMode, 'dontAsk');
    assert.equal(options.persistSession, false);
    assert.equal(options.cwd, path.resolve(r.repo));
    assert.match(String(r.sdk.last.sent[0]?.message.content), /README/);
    const { deny } = (options.settings as { permissions: { deny: string[] } }).permissions;
    assert.ok(deny.some((rule) => rule.includes('.env')));
    assert.equal(view(r, id).profile, WORLD_DESIGNER_PROFILE);
    assert.equal(r.worlds.get(world.worldId)?.genome?.rationale.includes('frozen protocol'), true);
    assert.equal(r.control.profiles.get(WORLD_DESIGNER_PROFILE), undefined);
  });

  it('is started with world.design, never by name, and not by MCP', async () => {
    const r = await rig();
    const world = r.worlds.ensure(r.repo, { kind: 'repo' });
    await assert.rejects(r.control.supervisor.spawn({ worldId: world.worldId, profile: WORLD_DESIGNER_PROFILE, prompt: 'x' }, ui), /world\.design/);
    await assert.rejects(r.control.supervisor.design(world.worldId, { kind: 'mcp' }), /operator/);
  });

  it('the Belt has no planet, and a second call while one is live returns the same craft', async () => {
    const r = await rig();
    r.sdk.script = hold;
    const belt = r.worlds.ensure(null);
    await assert.rejects(r.control.designers.request(belt.worldId), /Belt/);
    const world = r.worlds.ensure(r.repo, { kind: 'repo' });
    const first = await r.control.designers.request(world.worldId);
    const again = await r.control.designers.request(world.worldId);
    assert.deepEqual(again.agentIds, first.agentIds);
  });

  it('a Read of .env is refused before approval', async () => {
    const r = await rig();
    r.sdk.script = hold;
    const world = r.worlds.ensure(r.repo, { kind: 'repo' });
    await r.control.designers.request(world.worldId);
    await until(() => r.sdk.processes.length > 0);
    const result = await r.sdk.last.ask('Read', { file_path: path.join(r.repo, '.env') });
    assert.equal(result.behavior, 'deny');
  });
});

describe('kernel restart', () => {
  it('marks lost, expires approvals, sweeps orphans, and only then offers resume', async () => {
    const home = tmpDir();
    const claudeHome = tmpDir('naos-claude-');
    const before = await makeRig({ home, claudeHome });
    before.sdk.script = hold;
    const id = await spawn(before);
    await reach(before, id, 'running');
    const { sessionId, pid } = view(before, id);
    const answer = before.sdk.last.ask('Bash', { command: 'touch x' });
    await reach(before, id, 'awaiting_approval');
    const requestId = Object.keys(before.bus.state().approvals)[0]!;
    void answer;
    before.control.store.saveToolTree({ pid: 900, created: '134378702327497010', agentId: id, name: 'bash.exe', at: 1 });
    before.control.store.saveToolTree({ pid: 901, created: '134378702327497010', agentId: id, name: 'node.exe', at: 1 });
    before.db.run('UPDATE managed_sessions SET procStart = ? WHERE agentId = ?', '134378702327497010', id);
    fakeTranscript(claudeHome, before.repo, sessionId!);
    // The kernel dies here: no stop, no cleanup.
    before.control.profiles.stop();
    before.db.close();

    let sweptWhenResumable: number | null = null;
    const after = await makeRig({
      home, claudeHome, boot: false,
      procs: [
        { pid: pid!, ppid: 1, name: 'claude.exe', created: '134378702327497015' },
        { pid: 900, ppid: 1, name: 'bash.exe', created: '134378702327497010' },
        { pid: 901, ppid: 1, name: 'node.exe', created: '999999999999999' }, // Same pid, another process.
      ],
    });
    after.bus.subscribe((e) => {
      if (e.type === 'managed.upserted' && e.agent.resumable && sweptWhenResumable === null) sweptWhenResumable = after.kills.length;
    });
    await after.control.start(after.ctx);
    rigs.push(after);

    const v = view(after, id);
    assert.equal(v.state, 'lost');
    assert.equal(v.resumable, true);
    assert.equal(v.pid, null);
    assert.deepEqual(after.kills.sort(), [900, pid!].sort(), 'the same pid with another start time is left alone');
    assert.equal(sweptWhenResumable, 2, 'resume was offered only after the sweep');
    assert.equal(after.control.store.toolTrees().length, 0);

    const approval = after.bus.state().approvals[requestId];
    assert.equal(approval?.status, 'expired');
    assert.equal(after.of('approval.requested')[0]?.approval.status, 'expired', 'a dead request never looks answerable');
    assert.equal(after.control.registry.lookup({ sessionId: sessionId! }), id);
    assert.equal(after.bus.state().sessions[sessionId!]?.activity.state, 'finished');

    await after.control.supervisor.resume(id);
    await reach(after, id, 'ready');
    assert.equal(after.sdk.last.options.resume, sessionId);
    assert.equal(after.sdk.last.options.env?.CLAUDE_CODE_RESUME_INTERRUPTED_TURN, '1', 'died inside a turn, no prompt given');
  });

  it('finds a shell that has no row from the dead CLI, and leaves look-alikes alone', async () => {
    const home = tmpDir();
    const claudeHome = tmpDir('naos-claude-');
    const before = await makeRig({ home, claudeHome });
    before.sdk.script = hold;
    const id = await spawn(before);
    await reach(before, id, 'running');
    const { pid } = view(before, id);
    void before.sdk.last.ask('Bash', { command: 'touch x' });
    await reach(before, id, 'awaiting_approval');
    before.db.run('UPDATE managed_sessions SET procStart = ? WHERE agentId = ?', '134378702327497010', id);
    before.control.profiles.stop();
    before.db.close();

    const inside = toFiletime(Date.now());
    const after = await makeRig({
      home, claudeHome, boot: false,
      procs: [
        { pid: 700, ppid: pid!, name: 'bash.exe', created: inside },
        { pid: 701, ppid: pid!, name: 'node.exe', created: inside }, // Not a shell: MCP servers die with the CLI.
        { pid: 702, ppid: pid!, name: 'bash.exe', created: toFiletime(Date.now() + 3_600_000) }, // The pid was reused later.
        { pid: 703, ppid: pid!, name: 'bash.exe', created: '134378702327497000' }, // Older than the CLI.
      ],
    });
    await after.control.start(after.ctx);
    rigs.push(after);
    assert.deepEqual(after.kills, [700]);
  });

  it('a crash sweeps a shell that has no row, and only then offers resume', async () => {
    const claudeHome = tmpDir('naos-claude-');
    const procs: Proc[] = [];
    const r = await makeRig({ claudeHome, procs });
    rigs.push(r);
    r.sdk.script = hold;
    const id = await spawn(r);
    await reach(r, id, 'running');
    const { pid, sessionId } = view(r, id);
    void r.sdk.last.ask('Bash', { command: 'touch x' });
    await reach(r, id, 'awaiting_approval');
    procs.push({ pid: 700, ppid: pid!, name: 'bash.exe', created: toFiletime(Date.now()) });
    fakeTranscript(claudeHome, r.repo, sessionId!);

    r.sdk.last.exit('Claude Code process exited with code 1');
    await reach(r, id, 'crashed');
    await until(() => view(r, id).resumable);
    assert.deepEqual(r.kills, [700]);
  });

  it('a clean exit runs no snapshot and kills nothing', async () => {
    const procs: Proc[] = [];
    const r = await makeRig({ procs });
    rigs.push(r);
    r.sdk.script = hold;
    const id = await spawn(r);
    await reach(r, id, 'running');
    procs.push({ pid: 700, ppid: view(r, id).pid!, name: 'bash.exe', created: toFiletime(Date.now()) });
    r.sdk.last.exit();
    await reach(r, id, 'exited');
    await tick(20);
    assert.deepEqual(r.kills, []);
  });

  it('a resume with a prompt does not restart the interrupted turn', async () => {
    const home = tmpDir();
    const claudeHome = tmpDir('naos-claude-');
    const before = await makeRig({ home, claudeHome });
    before.sdk.script = hold;
    const id = await spawn(before);
    await reach(before, id, 'running');
    fakeTranscript(claudeHome, before.repo, view(before, id).sessionId!);
    before.control.profiles.stop();
    before.db.close();
    const after = await rig({ home, claudeHome });
    await after.control.supervisor.resume(id, 'go on');
    await reach(after, id, 'idle');
    assert.equal(after.sdk.last.options.env?.CLAUDE_CODE_RESUME_INTERRUPTED_TURN, undefined);
  });

  it('a clean shutdown leaves nothing to reconcile', async () => {
    const home = tmpDir();
    const before = await makeRig({ home });
    const id = await spawn(before);
    await reach(before, id, 'idle');
    await before.stop();
    const after = await rig({ home });
    assert.equal(view(after, id).state, 'exited');
    assert.equal(after.of('approval.expired').length, 0);
  });
});

describe('real git through the supervisor', () => {
  const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim();

  it('a worktree agent starts from the repo root with the flag, and close removes a clean worktree', async () => {
    const r = await rig();
    git(r.repo, 'init', '-q');
    git(r.repo, 'config', 'user.email', 't@example.invalid');
    git(r.repo, 'config', 'user.name', 't');
    fs.writeFileSync(path.join(r.repo, 'a.txt'), 'a');
    git(r.repo, 'add', '.');
    git(r.repo, 'commit', '-qm', 'one');

    const id = await spawn(r, { worktree: true });
    await reach(r, id, 'idle');
    const v = view(r, id);
    assert.equal(v.worktree?.branch, `agent/${id}`);
    const { options } = r.sdk.last;
    assert.deepEqual(options.extraArgs, { worktree: id });
    assert.equal(options.cwd?.toLowerCase(), fs.realpathSync(r.repo).toLowerCase());
    assert.equal(options.projectConfigRoot?.toLowerCase(), fs.realpathSync(r.repo).toLowerCase());
    assert.deepEqual(await r.control.supervisor.close(id), { closed: true });
    assert.equal(view(r, id).failure, null);
    assert.ok(!fs.existsSync(v.worktree!.path));
  });

  it('a folder outside git gets none, silently', async () => {
    const r = await rig();
    const id = await spawn(r, { worktree: true });
    await reach(r, id, 'idle');
    assert.equal(view(r, id).worktree, null);
    assert.equal(r.sdk.last.options.extraArgs, undefined);
  });
});

describe('trust', () => {
  it('an unknown repo gets no settings, a trusted one gets all three', async () => {
    const r = await rig();
    const a = await spawn(r);
    await reach(r, a, 'idle');
    assert.deepEqual(r.sdk.last.options.settingSources, []);
    assert.equal(r.sdk.last.options.strictMcpConfig, true);

    const worldId = view(r, a).worldId;
    const denied = await r.router.dispatch({ type: 'world.trust', worldId, trusted: true }, 'mcp');
    assert.equal(denied.ok, false);
    const trusted = await r.router.dispatch({ type: 'world.trust', worldId, trusted: true }, 'ui');
    assert.ok(trusted.ok);

    const b = await spawn(r);
    await reach(r, b, 'idle');
    assert.deepEqual(r.sdk.last.options.settingSources, ['user', 'project', 'local']);
    assert.equal(r.sdk.last.options.strictMcpConfig, undefined);
    const key = r.worlds.get(worldId)!.projectRoot!;
    assert.equal(r.control.store.loadout(key)?.skills, 2);
    assert.equal(r.control.store.loadout(key)?.mcpServers, 1);
    assert.equal(r.control.store.loadout(key)?.contextTokens, 110);
  });
});
