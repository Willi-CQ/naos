import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { sessionKey } from '@naos/protocol';
import { CodexLog, codexFiles, codexPlan } from '../../src/sources/codex.ts';
import { cursorSnapshot, readCursor } from '../../src/sources/cursor.ts';
import { blankSnapshot, SourcePublisher } from '../../src/sources/session.ts';
import { makeHarness as harness, FakeClaude } from '../observer/harness.ts';

const at = Date.UTC(2026, 10, 1, 12);
const record = (type: string, payload: object, offset = 0): string => JSON.stringify({ type, payload, timestamp: new Date(at + offset).toISOString() });

test('Codex keeps overlapping tools, cumulative usage and turn completion without copying private text', () => {
  const log = new CodexLog('unused.jsonl', at);
  const activityState = () => log.snapshot.activity.state;
  log.accept(record('session_meta', { id: 'root', cwd: '/fixture/repo', base_instructions: 'PRIVATE_INSTRUCTIONS', cli_version: '1' }));
  log.accept(record('turn_context', { model: 'gpt-6.1-sol', effort: 'xhigh', summary: 'PRIVATE_SUMMARY' }));
  log.accept(record('event_msg', { type: 'task_started', model_context_window: 500000 }));
  log.accept(record('response_item', { type: 'function_call', call_id: 'a', name: 'exec_command', arguments: 'PRIVATE_COMMAND' }, 1));
  log.accept(record('response_item', { type: 'function_call', call_id: 'b', name: 'read_file', arguments: 'PRIVATE_PATH' }, 2));
  log.accept(record('response_item', { type: 'function_call_output', call_id: 'a', output: 'PRIVATE_OUTPUT' }, 3));
  assert.equal(activityState(), 'tool_running');
  if (log.snapshot.activity.state === 'tool_running') assert.deepEqual(log.snapshot.activity.tools.map((t) => t.toolUseId), ['b']);
  log.accept(record('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 1000, cached_input_tokens: 400, output_tokens: 200 }, last_token_usage: { total_tokens: 1200 }, model_context_window: 500000 } }, 4));
  log.accept(record('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 1500, cached_input_tokens: 700, output_tokens: 300 } } }, 5));
  assert.equal(log.snapshot.usage.input, 800);
  assert.equal(log.snapshot.usage.output, 300);
  assert.equal(log.snapshot.usage.cacheRead, 700);
  assert.equal(log.snapshot.contextTokens, 1200);
  log.accept(record('event_msg', { type: 'task_complete', last_agent_message: 'PRIVATE_FINAL' }, 6));
  assert.equal(activityState(), 'idle');
  log.accept(record('session_meta', { id: 'inherited-parent', parent_thread_id: 'wrong', cwd: '/private/inherited' }, -1000));
  log.accept(record('event_msg', { type: 'task_started' }, -500));
  assert.equal(log.snapshot.nativeId, 'root');
  assert.equal(activityState(), 'idle');
  assert.ok(!JSON.stringify(log.snapshot).includes('PRIVATE_'));
  for (const line of ['garbage', '{}', 'null', record('future_record', { text: 'PRIVATE_FUTURE' })]) assert.doesNotThrow(() => log.accept(line));
});

test('Codex reads appended complete records and restricts discovery to dated rollout folders', async () => {
  const fake = new FakeClaude();
  try {
    const sessions = path.join(fake.root, 'sessions');
    const dir = path.join(sessions, '2026', '11', '01');
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'rollout-fixture.jsonl');
    const meta = record('session_meta', { id: 'append', cwd: fake.root });
    writeFileSync(file, meta + '\n' + '{"type":');
    writeFileSync(path.join(sessions, 'auth.json'), 'PRIVATE_TOKEN');
    const log = new CodexLog(file, at);
    await log.read();
    assert.equal(log.snapshot.nativeId, 'append');
    appendFileSync(file, '"event_msg","timestamp":"2026-11-01T12:00:01Z","payload":{"type":"task_started"}}\n');
    await log.read();
    assert.equal(log.snapshot.activity.state, 'generating');
    const found = await codexFiles(sessions, Date.now());
    assert.deepEqual(found.map((f) => f.file), [file]);
  } finally { fake.cleanup(); }
});

test('source identity avoids collisions and explicit Codex children share their parent session and repo', () => {
  const fake = new FakeClaude();
  const h = harness(fake.home, path.join(fake.root, 'sources.db'));
  try {
    const pub = new SourcePublisher(h.ctx, 'codex');
    const root = { ...blankSnapshot('same-id', at), cwd: fake.root, model: 'gpt-6.1-sol', capabilities: ['activity' as const, 'tokens' as const] };
    const child = { ...blankSnapshot('child', at), parentId: root.nativeId, cwd: fake.root, model: 'gpt-6-luna' };
    const grandchild = { ...blankSnapshot('grandchild', at + 1), parentId: child.nativeId, cwd: fake.root };
    pub.publish([grandchild, child, root], at + 1);
    const state = h.state();
    assert.equal(Object.keys(state.sessions).length, 1);
    assert.equal(Object.keys(state.worlds).length, 1);
    const sessionId = sessionKey('codex', 'same-id');
    assert.equal(state.nodes[`${sessionId}/child`]?.parentNodeId, sessionId);
    assert.equal(state.sessions[sessionId]?.agentCount, 2);
    assert.deepEqual(state.nodes[`${sessionId}/child`]?.childNodeIds, [`${sessionId}/grandchild`]);
    assert.notEqual(sessionId, sessionKey('cursor', 'same-id'));
    assert.notEqual(sessionId, sessionKey('claude-code', 'same-id'));
    const before = h.of('session.changed').length;
    pub.publish([root, child, grandchild], at + 1000);
    assert.equal(h.of('session.changed').length, before);
    assert.equal(h.ctx.db.all('SELECT node_id FROM source_history').length, 3);
    child.toolCalls = 1;
    pub.publish([root, child, grandchild], at + 2000);
    assert.deepEqual(h.state().nodes[`${sessionId}/child`]?.childNodeIds, [`${sessionId}/grandchild`]);
    root.activity = { state: 'generating', since: at };
    root.updatedAt = at + 2001;
    pub.publish([root, child, grandchild], at + 3000);
    assert.equal(h.state().sessions[sessionId]?.activity.state, 'generating');
    pub.publish([], at + 133000);
    assert.equal(h.state().sessions[sessionId]?.activity.state, 'unknown');
    assert.equal(h.state().sessions[sessionId]?.liveness, 'unknown');
  } finally { h.close(); fake.cleanup(); }
});

test('Cursor metadata preserves the client independently of its model and treats stale work as unknown', () => {
  const header = { composerId: 'cursor-1', createdAt: at - 2000, lastUpdatedAt: at, contextUsagePercent: 61,
    workspaceIdentifier: { uri: { fsPath: 'C:\\fixture\\project' } }, name: 'PRIVATE_TITLE' };
  const s = cursorSnapshot(header, { status: 'generating', modelConfig: { modelName: 'claude-sonnet-5-5' }, text: 'PRIVATE_PROMPT' }, at + 1000)!;
  assert.equal(s.model, 'claude-sonnet-5-5');
  assert.equal(s.cwd, 'C:\\fixture\\project');
  assert.equal(s.contextFraction, 0.61);
  assert.equal(s.activity.state, 'generating');
  assert.ok(!s.capabilities.includes('tokens'));
  assert.ok(!JSON.stringify(s).includes('PRIVATE_'));
  assert.equal(cursorSnapshot(header, { status: 'generating' }, at + 130000)?.activity.state, 'unknown');
  assert.equal(cursorSnapshot({ ...header, isDraft: true }, {}, at), null);
});

test('Cursor uses read-only SQLite projection and ignores unsupported stores', () => {
  const fake = new FakeClaude();
  try {
    const file = path.join(fake.root, 'cursor.db');
    const db = new DatabaseSync(file);
    db.exec('CREATE TABLE composerHeaders (composerId TEXT, value TEXT, lastUpdatedAt REAL, isArchived INTEGER); CREATE TABLE cursorDiskKV (key TEXT, value TEXT)');
    db.prepare('INSERT INTO composerHeaders VALUES (?, ?, ?, 0)').run('c1', JSON.stringify({ composerId: 'c1', lastUpdatedAt: at, workspaceIdentifier: { uri: { fsPath: fake.root } } }), at);
    db.prepare('INSERT INTO cursorDiskKV VALUES (?, ?)').run('composerData:c1', JSON.stringify({ status: 'completed', modelConfig: { modelName: 'gpt-6.1-sol' }, subagentComposerIds: [], blobEncryptionKey: 'PRIVATE_KEY', text: 'PRIVATE_TEXT' }));
    db.close();
    const rows = readCursor(file, at + 1000);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.activity.state, 'idle');
    assert.equal(rows[0]?.model, 'gpt-6.1-sol');
    assert.ok(!JSON.stringify(rows).includes('PRIVATE_'));
    assert.deepEqual(readCursor(path.join(fake.root, 'missing.db'), at), []);
  } finally { fake.cleanup(); }
});

test('a Codex limit stays separate from Claude admission and older readings cannot replace it', () => {
  const fake = new FakeClaude();
  const h = harness(fake.home);
  try {
    const plan = codexPlan({ primary: { used_percent: 100, window_minutes: 300, resets_at: at / 1000 + 60 }, secondary: { used_percent: 20, window_minutes: 10080 } }, at)!;
    assert.equal(plan.status, 'rejected');
    assert.equal(plan.sevenDayLeft, 0.8);
    assert.equal(plan.resetsAt.fiveHour, at + 60000);
    h.ctx.bus.publish({ type: 'source.plan.changed', client: 'codex', plan });
    h.ctx.bus.publish({ type: 'source.plan.changed', client: 'codex', plan: { ...plan, asOf: at - 1000, status: 'allowed' } });
    assert.equal(h.state().clientPlans?.codex?.status, 'rejected');
    assert.equal(h.state().plan, null);
    assert.equal(h.state().admission.frozen, null);
    assert.equal(codexPlan({}, at), null);
  } finally { h.close(); fake.cleanup(); }
});
