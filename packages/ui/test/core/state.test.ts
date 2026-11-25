import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  attentionOrder, attentionTier, factsOf, isAnswerable, isFault, markOf, toneOf, visualState,
} from '../../src/core/state.ts';
import type { AttentionRow, CraftFacts, VisualState } from '../../src/core/state.ts';

const base: CraftFacts = { owned: false, activity: 'idle', silentMs: 0 };
const vs = (over: Partial<CraftFacts>): VisualState => visualState({ ...base, ...over });

test('control states outrank everything the transcript says', () => {
  assert.equal(vs({ owned: true, control: 'crashed', activity: 'generating' }), 'crashed');
  assert.equal(vs({ owned: true, control: 'budget_exhausted', decisionTool: 'Bash' }), 'no-budget');
  assert.equal(vs({ owned: true, control: 'parked', activity: 'tool_running' }), 'parked');
  assert.equal(vs({ owned: true, control: 'stopping' }), 'stopping');
  assert.equal(vs({ owned: true, control: 'lost' }), 'lost');
});

test('a decision names itself by tool', () => {
  assert.equal(vs({ owned: true, control: 'awaiting_approval', decisionTool: 'Bash', activity: 'waiting' }), 'approve');
  assert.equal(vs({ owned: true, decisionTool: 'AskUserQuestion', activity: 'waiting' }), 'answer');
  assert.equal(vs({ owned: true, decisionTool: 'ExitPlanMode', activity: 'waiting' }), 'plan');
});

test('waiting is a decision for an owned craft and a wait at source for an observed one', () => {
  assert.equal(vs({ owned: true, activity: 'waiting' }), 'approve');
  assert.equal(vs({ owned: false, activity: 'waiting' }), 'source');
});

test('thinking and writing exist only for owned craft, and silence becomes no signal at 120 s', () => {
  assert.equal(vs({ owned: true, activity: 'generating', liveBlock: 'thinking' }), 'thinking');
  assert.equal(vs({ owned: true, activity: 'generating', liveBlock: 'text' }), 'writing');
  assert.equal(vs({ owned: false, activity: 'generating', liveBlock: 'text' }), 'generating');
  assert.equal(vs({ activity: 'generating', silentMs: 119_999 }), 'generating');
  assert.equal(vs({ activity: 'generating', silentMs: 120_000 }), 'no-signal');
});

test('errors, retries and endings', () => {
  assert.equal(vs({ activity: 'errored', errorKind: 'api' }), 'errored');
  assert.equal(vs({ activity: 'errored', errorKind: 'rate_limit' }), 'rate-limited');
  assert.equal(vs({ activity: 'retrying' }), 'retrying');
  assert.equal(vs({ activity: 'finished', outcome: 'abandoned' }), 'abandoned');
  assert.equal(vs({ activity: 'finished', outcome: 'clean' }), 'finished');
  assert.equal(vs({ agentStatus: 'failed' }), 'failed');
  assert.equal(vs({ agentStatus: 'orphaned' }), 'orphaned');
  assert.equal(vs({ dead: true, activity: 'generating' }), 'orphaned');
  assert.equal(vs({ activity: 'idle', backgroundShell: true }), 'idle-shell');
  assert.equal(vs({ activity: 'unknown' }), 'unknown');
});

test('factsOf reads the contract, and a pending craft with no node still has a state', () => {
  const now = 1_000_000;
  const pending = factsOf({ managed: { state: 'spawning' } as never, now });
  assert.equal(visualState(pending), 'spawning');
  const live = factsOf({
    node: { status: 'running', activity: { state: 'generating', since: now - 5000 }, lastRecordAt: now - 2000, kind: 'main' } as never,
    session: { liveness: 'alive', endedAt: null } as never,
    managed: { state: 'running' } as never,
    rate: { liveBlock: 'text' } as never,
    now,
  });
  assert.equal(live.silentMs, 2000);
  assert.equal(visualState(live), 'writing');
  const stale = factsOf({
    node: { status: 'running', activity: { state: 'idle', since: 0, backgroundShell: false }, lastRecordAt: 0, kind: 'main' } as never,
    session: { liveness: 'dead', endedAt: null } as never,
    now,
  });
  assert.equal(visualState(stale), 'orphaned');
});

const row = (id: string, state: VisualState, over: Partial<AttentionRow> = {}): AttentionRow => ({
  id, state, acked: false, contextFrac: 0.1, waitingSince: 0, lastActiveAt: 0, ...over,
});

test('the six rungs of section 3.3', () => {
  assert.equal(attentionTier(row('a', 'approve')), 1);
  assert.equal(attentionTier(row('a', 'answer')), 1);
  assert.equal(attentionTier(row('a', 'source')), 2);
  assert.equal(attentionTier(row('a', 'errored')), 3);
  assert.equal(attentionTier(row('a', 'retrying')), 3);
  assert.equal(attentionTier(row('a', 'writing', { contextFrac: 0.8 })), 4);
  assert.equal(attentionTier(row('a', 'writing', { contextFrac: 0.79 })), 6);
  assert.equal(attentionTier(row('a', 'no-budget')), 5);
  assert.equal(attentionTier(row('a', 'parked')), 5);
  assert.equal(attentionTier(row('a', 'idle')), 6);
});

test('an acknowledged fault stops asking', () => {
  assert.equal(attentionTier(row('a', 'errored', { acked: true })), 6);
  assert.equal(attentionTier(row('a', 'no-budget', { acked: true })), 6);
});

test('attention order: answerable above read only, oldest first, faults before retries, recent activity last', () => {
  const rows = [
    row('idle-old', 'idle', { lastActiveAt: 10 }),
    row('idle-new', 'idle', { lastActiveAt: 20 }),
    row('retry', 'retrying'),
    row('fault', 'errored'),
    row('wait-new', 'source', { waitingSince: 50 }),
    row('wait-old', 'source', { waitingSince: 5 }),
    row('low', 'writing', { contextFrac: 0.9 }),
    row('ask-new', 'approve', { waitingSince: 300 }),
    row('ask-old', 'approve', { waitingSince: 100 }),
    row('parked', 'parked'),
  ];
  assert.deepEqual(attentionOrder(rows).map((r) => r.id), [
    'ask-old', 'ask-new', 'wait-old', 'wait-new', 'fault', 'retry', 'low', 'parked', 'idle-new', 'idle-old',
  ]);
});

test('a stale wait at source can never hold the top slot', () => {
  const rows = [row('stale', 'source', { waitingSince: 1 }), row('fresh', 'approve', { waitingSince: 9e9 })];
  assert.equal(attentionOrder(rows)[0]!.id, 'fresh');
});

test('every state has a tone and a mark, and the mark follows the tool', () => {
  const all: VisualState[] = [
    'queued', 'spawning', 'starting', 'ready', 'thinking', 'writing', 'generating', 'tool', 'approve', 'answer', 'plan', 'source', 'parked', 'idle',
    'idle-shell', 'interrupted', 'compacting', 'retrying', 'no-signal', 'rate-limited', 'errored', 'no-budget', 'stopping', 'crashed', 'orphaned', 'lost',
    'finished', 'exited', 'abandoned', 'failed', 'stopped', 'unknown',
  ];
  for (const s of all) {
    assert.ok(toneOf(s), s);
    assert.ok(markOf(s, null, false), s);
  }
  assert.equal(markOf('tool', 'shell', false), 'square');
  assert.equal(markOf('tool', 'edit', false), 'lance');
  assert.equal(markOf('tool', 'unknown-family' as never, false), undefined);
  assert.equal(markOf('approve', null, true), 'ringcross');
  assert.ok(isAnswerable('plan'));
  assert.ok(isFault('no-budget'));
  assert.ok(!isFault('retrying'));
});
