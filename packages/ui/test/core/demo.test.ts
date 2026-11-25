import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEMO_END, DEMO_IDS, demoPhase, demoRoster } from '../../src/core/demo.ts';

test('the preview covers staggered departures, docking, undocking and landing with fixed identities', () => {
  const ships = (t: number) => demoRoster('repo', t).crafts.filter((c) => c.state !== 'finished');
  assert.equal(ships(0).length, 1);
  assert.equal(ships(4).length, 2);
  assert.equal(ships(6).length, 3);
  assert.deepEqual(ships(10).map((s) => s.id), [...DEMO_IDS]);
  assert.equal(ships(15)[0]!.state, 'idle');
  assert.equal(ships(19)[0]!.state, 'writing');
  assert.equal(ships(25).length, 2);
  assert.equal(ships(DEMO_END).length, 0);
  assert.equal(demoPhase(DEMO_END), 'Complete');
  assert.ok(demoRoster('repo', 10).crafts.every((c) => c.id.startsWith('demo:')));
});
