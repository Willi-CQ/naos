import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import type { CommandMap, CommandType, NativeClient, SpawnSpec } from '@naos/protocol';
import type { Obj, RpcTransport } from '../../src/control/native/rpc.ts';
import { makeRig, until, type Rig } from './harness.ts';
import type { RpcFactory } from '../../src/control/native/bridge.ts';
import { NativeAgents } from '../../src/control/native/agents.ts';

class FakeRpc implements RpcTransport {
  onMessage: RpcTransport['onMessage'] = null;
  onExit: RpcTransport['onExit'] = null;
  calls: Array<{ method: string; params: Obj }> = [];
  responses: Array<{ id: string | number; result: unknown }> = [];
  closed = false;
  client: NativeClient;
  id: string;
  prompts: Array<(value: Obj) => void> = [];
  constructor(client: NativeClient, id: string) { this.client = client; this.id = id; }
  async request(method: string, params: Obj): Promise<Obj> {
    this.calls.push({ method, params });
    if (method === 'initialize') return { protocolVersion: 1 };
    if (method === 'account/read') return { account: { type: 'chatgpt' }, requiresOpenaiAuth: true };
    if (method === 'model/list') return { data: [{ id: 'fixture-model', displayName: 'Fixture model', isDefault: true }] };
    if (method === 'thread/start' || method === 'thread/resume') return { thread: { id: String(params.threadId ?? this.id) }, model: params.model ?? 'fixture-model', instructionSources: ['AGENTS.md', 'packages/ui/AGENTS.md'] };
    if (method === 'session/new' || method === 'session/load') return { sessionId: params.sessionId ?? this.id };
    if (method === 'turn/start') return { turn: { id: `turn-${this.calls.filter((c) => c.method === 'turn/start').length}` } };
    if (method === 'session/prompt') return new Promise((resolve) => this.prompts.push(resolve));
    return {};
  }
  notify(method: string, params: Obj) { this.calls.push({ method, params }); }
  respond(id: string | number, result: unknown) { this.responses.push({ id, result }); }
  reject(id: string | number, message: string) { this.responses.push({ id, result: { error: message } }); }
  async close() { this.closed = true; for (const done of this.prompts.splice(0)) done({ stopReason: 'cancelled' }); }
  emit(method: string, params: Obj, id?: string | number) { this.onMessage?.(method, params, id); }
}

const rigs: Rig[] = [];
afterEach(async () => { for (const rig of rigs.splice(0)) await rig.stop(); });
async function setup() {
  const peers: FakeRpc[] = [];
  const rpc: RpcFactory = (_exe, args) => { const peer = new FakeRpc(args[0] === 'acp' ? 'cursor' : 'codex', `thread-${peers.length + 1}`); peers.push(peer); return peer; };
  const rig = await makeRig({ overrides: { native: { locate: () => ({ file: 'fixture-cli', args: [] }), rpc } } }); rigs.push(rig);
  const world = rig.worlds.ensure(rig.repo, { kind: 'repo', isGit: true });
  const spec = (client: NativeClient, extra: Partial<SpawnSpec> = {}): SpawnSpec => ({ worldId: world.worldId, client, profile: client, prompt: 'Fixture task', ...extra });
  async function cmd<K extends CommandType>(type: K, input: CommandMap[K]['in']): Promise<CommandMap[K]['out']> {
    const result = await rig.router.dispatch({ type, ...input }, 'ui');
    if (!result.ok) throw new Error(result.error.message);
    return result.result as CommandMap[K]['out'];
  }
  return { rig, peers, spec, cmd };
}

test('Codex uses its official handshake and user approvals, without a Claude query or shell prompt', async () => {
  const { rig, peers, spec, cmd } = await setup();
  const receipt = await cmd('agent.spawn', { spec: spec('codex', { model: 'fixture-model' }) }), id = receipt.agentIds[0]!;
  await until(() => rig.bus.state().managed[id]?.state === 'running');
  const peer = peers[0]!, view = rig.bus.state().managed[id]!;
  assert.equal(rig.sdk.processes.length, 0);
  assert.equal(view.client, 'codex'); assert.ok(view.nodeId.startsWith('codex:'));
  assert.equal(view.instructionFilesLoaded, 2);
  assert.equal(rig.bus.state().sessions[view.nodeId]?.origin, 'control');
  assert.deepEqual(peer.calls.slice(0, 2).map((c) => c.method), ['initialize', 'initialized']);
  const start = peer.calls.find((c) => c.method === 'thread/start')!;
  assert.equal(start.params.approvalPolicy, 'on-request'); assert.equal(start.params.approvalsReviewer, 'user'); assert.equal(start.params.sandbox, 'workspace-write');
  assert.ok(peer.calls.some((c) => c.method === 'turn/start' && Array.isArray(c.params.input)));
  peer.emit('item/agentMessage/delta', { threadId: peer.id, itemId: 'reply-1', delta: 'Fixture answer' });
  peer.emit('item/completed', { threadId: peer.id, item: { type: 'agentMessage', id: 'reply-1', text: 'Fixture answer' } });
  assert.equal(rig.texts.at(-1)?.delta, 'Fixture answer');
  assert.equal(rig.ctx.nativeText!.textRows(view.nodeId).rows.at(-1)?.text, 'Fixture answer');
  assert.ok(!JSON.stringify(rig.events).includes('Fixture answer'));
  assert.ok(!peer.calls.some((c) => /login|logout/.test(c.method)));
});

test('native follow-ups queue, finish in order, and keep message IDs for transcript reconciliation', async () => {
  const { rig, peers, spec, cmd } = await setup();
  const id = (await cmd('agent.spawn', { spec: spec('codex') })).agentIds[0]!;
  await until(() => rig.bus.state().managed[id]?.state === 'running');
  const send = await cmd('agent.send', { agentId: id, text: 'Second fixture task', priority: 'queue' }), peer = peers[0]!;
  assert.equal(peer.calls.filter((c) => c.method === 'turn/start').length, 1);
  peer.emit('turn/completed', { threadId: peer.id, turn: { id: 'turn-1', status: 'completed' } });
  await until(() => peer.calls.filter((c) => c.method === 'turn/start').length === 2);
  assert.equal(peer.calls.filter((c) => c.method === 'turn/start')[1]!.params.clientUserMessageId, send.sendId);
  assert.ok(rig.ctx.nativeText!.textRows(rig.bus.state().managed[id]!.nodeId).rows.some((r) => r.messageId === send.sendId));
});

test('native tool approvals are human-only, one-time, and cannot be edited or remembered', async () => {
  const { rig, peers, spec, cmd } = await setup();
  const id = (await cmd('agent.spawn', { spec: spec('codex') })).agentIds[0]!;
  await until(() => rig.bus.state().managed[id]?.state === 'running');
  peers[0]!.emit('item/commandExecution/requestApproval', { threadId: peers[0]!.id, command: 'fixture-command', itemId: 'cmd-1' }, 42);
  const approval = Object.values(rig.bus.state().approvals).find((a) => a.agentId === id)!;
  assert.equal(approval.editable, false); assert.equal(approval.canRememberForSession, false); assert.equal(approval.danger, true);
  const refused = await rig.router.dispatch({ type: 'approval.answer', requestId: approval.requestId, decision: { kind: 'approve' }, clientId: 'fixture' }, 'mcp');
  assert.equal(refused.ok, false); assert.equal(peers[0]!.responses.length, 0);
  await cmd('approval.answer', { requestId: approval.requestId, decision: { kind: 'approve' }, clientId: 'fixture' });
  assert.deepEqual(peers[0]!.responses[0], { id: 42, result: { decision: 'accept' } });
  assert.equal((await cmd('approval.answer', { requestId: approval.requestId, decision: { kind: 'approve' }, clientId: 'fixture' })).applied, false);
});

test('Cursor uses ACP modes, streams text and returns only the permission option the human selected', async () => {
  const { rig, peers, spec, cmd } = await setup();
  const id = (await cmd('agent.spawn', { spec: spec('cursor', { mode: 'read-only' }) })).agentIds[0]!;
  await until(() => rig.bus.state().managed[id]?.state === 'running');
  const peer = peers[0]!;
  assert.equal(peer.client, 'cursor');
  assert.ok(peer.calls.some((c) => c.method === 'session/set_mode' && c.params.modeId === 'ask'));
  peer.emit('session/update', { sessionId: peer.id, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Cursor fixture answer' } } });
  peer.emit('session/request_permission', { sessionId: peer.id, toolCall: { toolCallId: 'tool-1', title: 'Fixture operation' }, options: [{ optionId: 'once', kind: 'allow_once' }, { optionId: 'deny', kind: 'reject_once' }] }, 50);
  const approval = Object.values(rig.bus.state().approvals).find((a) => a.agentId === id)!;
  await cmd('approval.answer', { requestId: approval.requestId, decision: { kind: 'deny' }, clientId: 'fixture' });
  assert.deepEqual(peer.responses[0], { id: 50, result: { outcome: { outcome: 'selected', optionId: 'deny' } } });
  peer.prompts.shift()!({ stopReason: 'end_turn' });
  await until(() => rig.bus.state().managed[id]?.state === 'idle');
  assert.equal(rig.ctx.nativeText!.textRows(rig.bus.state().managed[id]!.nodeId).rows.at(-1)?.text, 'Cursor fixture answer');
  assert.equal(rig.sdk.processes.length, 0);
});

test('concurrent native launch retries create one agent and MCP cannot steer it', async () => {
  const { rig, peers, spec, cmd } = await setup();
  const input = { spec: spec('codex', { idempotencyKey: 'one-launch' }) };
  const [a, b] = await Promise.all([cmd('agent.spawn', input), cmd('agent.spawn', input)]);
  assert.deepEqual(a, b); assert.equal(peers.length, 1);
  const id = a.agentIds[0]!;
  const denied = await rig.router.dispatch({ type: 'agent.send', agentId: id, text: 'No', priority: 'queue' }, 'mcp');
  assert.equal(denied.ok, false);
  const spawnDenied = await rig.router.dispatch({ type: 'agent.spawn', spec: spec('cursor') }, 'mcp');
  assert.equal(spawnDenied.ok, false);
});

test('stop cancels outstanding ACP requests and resume reconnects to the same native session', async () => {
  const { rig, peers, spec, cmd } = await setup();
  const id = (await cmd('agent.spawn', { spec: spec('cursor') })).agentIds[0]!;
  await until(() => rig.bus.state().managed[id]?.state === 'running');
  const nativeId = peers[0]!.id;
  peers[0]!.emit('session/request_permission', { sessionId: nativeId, toolCall: {}, options: [] }, 70);
  await cmd('agent.stop', { agentId: id });
  assert.ok(peers[0]!.closed); assert.deepEqual(peers[0]!.responses[0]?.result, { outcome: { outcome: 'cancelled' } });
  assert.equal(rig.bus.state().managed[id]!.state, 'exited');
  await cmd('agent.resume', { agentId: id });
  await until(() => rig.bus.state().managed[id]?.state === 'idle');
  assert.ok(peers[1]!.calls.some((c) => c.method === 'session/load' && c.params.sessionId === nativeId));
});

test('provider plan windows remain separate and a Claude limit cannot freeze a Codex launch', async () => {
  const { rig, spec, cmd } = await setup();
  rig.bus.publish({ type: 'admission.changed', admission: { ...rig.bus.state().admission, frozen: 'plan-window' } });
  assert.equal((await cmd('preflight', { spec: spec('codex') })).blocked, null);
  const receipt = await cmd('agent.spawn', { spec: spec('codex') }); assert.equal(receipt.agentIds.length, 1);
  rig.bus.publish({ type: 'source.plan.changed', client: 'cursor', plan: { fiveHourLeft: 0, sevenDayLeft: .5, asOf: Date.now(), status: 'rejected', resetsAt: { fiveHour: Date.now() + 60000, sevenDay: null } } });
  assert.match((await cmd('preflight', { spec: spec('cursor') })).blocked!, /limit/);
});

test('native conversation history survives a kernel restart without automatically restarting a model turn', async () => {
  const { rig, peers, spec, cmd } = await setup();
  const id = (await cmd('agent.spawn', { spec: spec('codex') })).agentIds[0]!;
  await until(() => rig.bus.state().managed[id]?.state === 'running');
  const nodeId = rig.bus.state().managed[id]!.nodeId;
  peers[0]!.emit('item/completed', { threadId: peers[0]!.id, item: { type: 'agentMessage', id: 'saved-reply', text: 'Saved fixture answer' } });
  await cmd('agent.stop', { agentId: id });
  const before = peers.length;
  const restarted = new NativeAgents(rig.ctx, { locate: () => null }); restarted.boot();
  assert.equal(peers.length, before);
  assert.equal(restarted.status(id, 'ui').state, 'exited');
  assert.equal(restarted.status(id, 'ui').resumable, true);
  assert.deepEqual(restarted.textRows(nodeId).rows.map((r) => r.role), ['user', 'assistant']);
  assert.equal(restarted.textRows(nodeId).rows[1]?.text, 'Saved fixture answer');
  await restarted.shutdown();
});

test('Cursor questions and plan decisions round-trip through the existing human docket', async () => {
  const { rig, peers, spec, cmd } = await setup();
  const id = (await cmd('agent.spawn', { spec: spec('cursor') })).agentIds[0]!;
  await until(() => rig.bus.state().managed[id]?.state === 'running');
  const peer = peers[0]!;
  peer.emit('cursor/ask_question', { toolCallId: 'question', questions: [{ id: 'q1', prompt: 'Fixture choice?', options: [{ id: 'one', label: 'First' }, { id: 'two', label: 'Second' }] }] }, 81);
  const ask = Object.values(rig.bus.state().approvals).find((a) => a.status === 'open')!;
  assert.equal((ask.input.questions as Array<{ question: string }>)[0]?.question, 'Fixture choice?');
  await cmd('approval.answer', { requestId: ask.requestId, clientId: 'fixture', decision: { kind: 'answer', answers: { 'Fixture choice?': 'Second' } } });
  assert.deepEqual(peer.responses.at(-1)?.result, { outcome: { outcome: 'answered', answers: [{ questionId: 'q1', selectedOptionIds: ['two'] }] } });
  peer.emit('cursor/create_plan', { toolCallId: 'plan', plan: 'Fixture plan' }, 82);
  const plan = Object.values(rig.bus.state().approvals).find((a) => a.status === 'open')!;
  assert.equal(plan.toolName, 'ExitPlanMode');
  await cmd('approval.answer', { requestId: plan.requestId, clientId: 'fixture', decision: { kind: 'deny' } });
  assert.deepEqual(peer.responses.at(-1)?.result, { outcome: { outcome: 'rejected' } });
});

test('Codex questions retain provider question IDs when the human answers', async () => {
  const { rig, peers, spec, cmd } = await setup();
  const id = (await cmd('agent.spawn', { spec: spec('codex') })).agentIds[0]!;
  await until(() => rig.bus.state().managed[id]?.state === 'running');
  peers[0]!.emit('item/tool/requestUserInput', { questions: [{ id: 'pick', header: 'Choice', question: 'Choose fixture', options: [{ label: 'First' }] }] }, 90);
  const ask = Object.values(rig.bus.state().approvals).find((a) => a.status === 'open')!;
  await cmd('approval.answer', { requestId: ask.requestId, clientId: 'fixture', decision: { kind: 'answer', answers: { 'Choose fixture': 'First' } } });
  assert.deepEqual(peers[0]!.responses.at(-1)?.result, { answers: { pick: { answers: ['First'] } } });
});

test('native tool traces record one lifecycle, real completion and project activity', async () => {
  for (const client of ['codex', 'cursor'] as const) {
    const { rig, peers, spec, cmd } = await setup();
    const id = (await cmd('agent.spawn', { spec: spec(client) })).agentIds[0]!;
    await until(() => rig.bus.state().managed[id]?.state === 'running');
    const peer = peers[0]!, nodeId = rig.bus.state().managed[id]!.nodeId;
    const target = `${rig.repo}/src/app.ts`;
    const start = () => client === 'codex'
      ? peer.emit('item/started', { threadId: peer.id, item: { id: 'tool-a', type: 'fileChange', status: 'inProgress', changes: [{ path: target, kind: 'modify' }] } })
      : peer.emit('session/update', { sessionId: peer.id, update: { sessionUpdate: 'tool_call', toolCallId: 'tool-a', title: 'Fixture operation', kind: 'edit', status: 'in_progress', rawInput: { path: target } } });
    start(); start();
    assert.equal(rig.bus.state().managed[id]!.toolCalls, 1);
    assert.equal(rig.bus.state().sessions[nodeId]?.activity.state, 'tool_running');
    if (client === 'codex') peer.emit('item/completed', { threadId: peer.id, item: { id: 'tool-a', type: 'commandExecution', status: 'failed' } });
    else peer.emit('session/update', { sessionId: peer.id, update: { sessionUpdate: 'tool_call_update', toolCallId: 'tool-a', status: 'failed' } });
    const trace = rig.ctx.nativeText!.channel(nodeId).rows.filter((r) => r.kind === 'tool');
    assert.equal(trace.length, 1); assert.equal(trace[0]!.status, 'failed'); assert.equal(trace[0]!.isError, true);
    assert.ok(trace[0]!.durationMs !== null && trace[0]!.durationMs >= 0);
    assert.equal(trace[0]!.family, 'edit'); assert.equal(trace[0]!.summary.target, 'src/app.ts'); assert.equal(rig.bus.state().sessions[nodeId]?.activity.state, 'generating');
    assert.ok(rig.bus.state().tape.some((entry) => entry.nodeId === nodeId && entry.kind === 'write'));
  }
});
