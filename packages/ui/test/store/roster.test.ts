import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyState } from '@naos/protocol';
import type { FleetState } from '@naos/protocol';
import { rosterKey, rosterOf } from '../../src/scene/roster.ts';
import type { RosterRow } from '../../src/scene/roster.ts';

const row = (id: string, over: Partial<RosterRow> = {}): RosterRow => ({
  id, worldId: 'w', kind: 'main', owned: false, agentId: null, state: 'writing', altitude: 0.5, tps: 10, outputTokens: 40, tier: 6, danger: false, queued: 0, acked: false, parentId: null, live: true, waitingSince: 5, ...over,
});

const node = (nodeId: string, activity: object, over: object = {}) => ({ nodeId, sessionId: 's', parentNodeId: null, childNodeIds: [], spawnDepth: 0, activity, workflow: null, ...over });

const fleet = (over: Partial<FleetState>): FleetState => ({ ...emptyState(), ...over });

test('the roster carries structure and no text at all', () => {
  const state = fleet({
    nodes: { a: node('a', { state: 'tool_running', since: 1, tools: [{ toolUseId: 't1', name: 'mcp__os__agent_status', family: 'mcp', startedAt: 9 }, { toolUseId: 't2', name: 'Read', family: 'read', startedAt: 8 }] }) } as unknown as FleetState['nodes'],
  });
  const r = rosterOf({ a: row('a', { state: 'tool' }) }, state);
  const c = r.crafts[0]!;
  assert.deepEqual(c.tools.map((t) => [t.family, t.toStar]), [['mcp', true], ['read', false]]);
  assert.equal(c.role, 'vessel');
  assert.equal(c.since, 1);
  const text = JSON.stringify(r);
  for (const leak of ['title', 'name', 'path', 'target', 'summary']) assert.ok(!text.includes(`"${leak}"`), leak);
});

test('a role follows the kind, and an unknown kind flies as a tender rather than failing', () => {
  const rows = { a: row('a'), b: row('b', { kind: 'subagent', parentId: 'a' }), c: row('c', { kind: 'workflow-agent' }), d: row('d', { kind: 'something-new' }) };
  const r = rosterOf(rows, fleet({}));
  assert.deepEqual(r.crafts.map((c) => c.role), ['vessel', 'tender', 'bead', 'tender']);
});

test('a countdown comes from the retry, or from the limit', () => {
  const state = fleet({
    nodes: {
      a: node('a', { state: 'retrying', since: 100, attempt: 1, maxRetries: 3, nextAttemptAt: 900 }),
      b: node('b', { state: 'errored', since: 200, kind: 'rate_limit', resetsAt: 800 }),
      c: node('c', { state: 'retrying', since: 100, attempt: 1, maxRetries: 3 }),
    } as unknown as FleetState['nodes'],
  });
  const r = rosterOf({ a: row('a', { state: 'retrying' }), b: row('b', { state: 'rate-limited' }), c: row('c', { state: 'retrying' }) }, state);
  assert.deepEqual(r.crafts[0]!.countdown, { from: 100, to: 900 });
  assert.deepEqual(r.crafts[1]!.countdown, { from: 200, to: 800 });
  assert.equal(r.crafts[2]!.countdown, null, 'nothing to count down to');
});

test('fuel is what is left of the budget, a Pad seat is the queue order', () => {
  const managed = { x: { agentId: 'x', budgetUsd: 4, spentUsd: 1, worktree: null }, y: { agentId: 'y', budgetUsd: 2, spentUsd: 9, worktree: { path: '/t', name: 't', branch: 'b' } } };
  const state = fleet({ managed: managed as unknown as FleetState['managed'], admission: { ...emptyState().admission, queued: ['y', 'x'] } });
  const r = rosterOf({ x: row('x', { agentId: 'x', owned: true }), y: row('y', { agentId: 'y', owned: true }) }, state);
  assert.equal(r.crafts[0]!.fuel, 0.75);
  assert.equal(r.crafts[1]!.fuel, 0, 'never below empty');
  assert.deepEqual(r.crafts.map((c) => c.pad), [1, 0]);
  assert.equal(r.crafts[1]!.moon, '/t');
});

test('a bead knows its hoop, and a closed run draws none', () => {
  const run = (status: string) => ({ runId: 'r', sessionId: 's', status, phases: [{ index: 0, title: 'survey' }, { index: 1, title: 'audit' }] });
  const nodes = { b: node('b', { state: 'generating', since: 0 }, { workflow: { runId: 'r', key: 'k', label: null, phase: 'audit', attempt: 2 } }) };
  const sessions = { s: { worldId: 'w' } };
  const open = rosterOf({ b: row('b', { kind: 'workflow-agent' }) }, fleet({ nodes, workflows: { r: run('running') }, sessions } as unknown as Partial<FleetState>));
  assert.deepEqual(open.crafts[0]!.workflow, { runId: 'r', phase: 1, attempt: 2 });
  assert.equal(open.hoops.length, 2);
  const closed = rosterOf({}, fleet({ workflows: { r: run('completed') }, sessions } as unknown as Partial<FleetState>));
  assert.equal(closed.hoops.length, 0);
});

test('the key moves with what the picture shows at rest, not with tokens', () => {
  const a = rosterOf({ a: row('a') }, fleet({}));
  const b = rosterOf({ a: row('a', { tps: 99, outputTokens: 12345 }) }, fleet({}));
  const c = rosterOf({ a: row('a', { state: 'idle' }) }, fleet({}));
  assert.equal(rosterKey(a), rosterKey(b));
  assert.notEqual(rosterKey(a), rosterKey(c));
});
