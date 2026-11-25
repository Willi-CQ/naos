import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildModel } from '../../src/store/model.ts';
import { rosterOf } from '../../src/scene/roster.ts';
import { shellOf } from '../../src/store/store.ts';

test('a client filter changes the visible fleet while keeping decisions accessible', async () => {
  const kernel = '../../../kernel/src/fixture/';
  const { buildHistory } = await import(`${kernel}history.ts`);
  const { buildTimeline, stateAt } = await import(`${kernel}timeline.ts`);
  const { FIXTURE_EPOCH } = await import(`${kernel}scene.ts`);
  const history = buildHistory(FIXTURE_EPOCH);
  const fleet = stateAt(buildTimeline(history, FIXTURE_EPOCH), 60_000).state;
  const m = buildModel({ fleet, rates: { at: FIXTURE_EPOCH + 60000, fleet: null, nodes: {} }, now: FIXTURE_EPOCH + 60000,
    veil: false, tapeFilter: 'all', history: history.rows, clientId: null, linkUp: true, sensorChangedAt: null, burns: {}, clientFilter: 'codex' });
  const visible = Object.values(m.crafts).filter((c) => c.visible);
  assert.ok(visible.length >= 2);
  assert.ok(visible.every((c) => c.client === 'codex'));
  assert.ok(m.worlds.flatMap((w) => w.rows).every((r) => r.type !== 'craft' || r.craft.client === 'codex'));
  const roster = rosterOf(m.crafts, fleet);
  assert.ok(roster.crafts.every((c) => m.crafts[c.id]?.client === 'codex'));
  assert.equal(m.decisions.filter((d) => d.status === 'open').length, 1);
  assert.equal(m.crafts[m.decisions[0]!.nodeId]?.client, 'claude-code');
  assert.equal(m.trouble.length, 2);
  assert.ok(visible.every((c) => c.budget === 'cost unavailable'));
});

test('the chase viewport reserves its full channel width', () => {
  const base = { railCollapsed: false, cinema: false };
  for (const width of [1280, 1600, 2560]) {
    const overview = shellOf(width, 1000, { ...base, level: 'system' });
    const chase = shellOf(width, 1000, { ...base, level: 'craft' });
    assert.equal(chase.free.x + chase.free.w + chase.right, width);
    assert.equal(chase.right, chase.channel);
    assert.equal(overview.free.w - chase.free.w, chase.right - overview.right);
  }
});
