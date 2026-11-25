import assert from 'node:assert/strict';
import { test } from 'node:test';
import { atlasPoint, atlasWorlds } from '../../src/core/observatory.ts';
import { buildModel } from '../../src/store/model.ts';
import { buildHistory } from '../../../kernel/src/fixture/history.ts';
import { buildTimeline, stateAt } from '../../../kernel/src/fixture/timeline.ts';
import { FIXTURE_EPOCH } from '../../../kernel/src/fixture/scene.ts';
import { archetypeDefaults } from '@naos/protocol';

function fixture(veil = false, clientFilter: 'all' | 'codex' = 'all') {
  const history = buildHistory(FIXTURE_EPOCH), fleet = stateAt(buildTimeline(history, FIXTURE_EPOCH), 60000).state;
  const first = Object.values(fleet.worlds).find(w => w.kind === 'repo')!;
  first.genome = { ...archetypeDefaults('rock'), rationale: 'private project description that must stay behind the Veil' };
  const model = buildModel({ fleet, rates: { at: FIXTURE_EPOCH + 60000, fleet: null, nodes: {} }, now: FIXTURE_EPOCH + 60000,
    veil, clientFilter, tapeFilter: 'all', history: history.rows, clientId: null, linkUp: true, sensorChangedAt: null, burns: {} });
  return { fleet, model };
}

test('the atlas counts live main chats and children separately, follows client filters and leaves source data intact', () => {
  const { fleet, model } = fixture(false, 'codex'), before = JSON.stringify(fleet);
  const worlds = atlasWorlds(model.allWorlds, model.crafts, fleet.worlds);
  const live = Object.values(model.crafts).filter(c => c.live && c.visible);
  assert.ok(worlds.length > 0 && live.length > 0);
  assert.equal(worlds.reduce((n,w) => n+w.sessions,0), live.filter(c => c.kind === 'main').length);
  assert.equal(worlds.reduce((n,w) => n+w.tenders,0), live.filter(c => c.kind !== 'main').length);
  assert.ok(worlds.every(w => Object.keys(w.clients).every(client => client === 'codex')));
  assert.equal(JSON.stringify(fleet), before);
  assert.ok(model.decisions.some(d => d.status === 'open'));
});

test('the atlas keeps identity and numeric worktree counts under the Veil while discarding private descriptions', () => {
  const plain = fixture(), hidden = fixture(true);
  const before = atlasWorlds(plain.model.allWorlds, plain.model.crafts, plain.fleet.worlds);
  const after = atlasWorlds(hidden.model.allWorlds, hidden.model.crafts, hidden.fleet.worlds);
  assert.ok(!JSON.stringify(after).includes('private project description'));
  assert.ok(after.every(w => w.genome.rationale === '' && hidden.model.allWorlds.some(v => v.worldId === w.id && v.name === w.name)));
  assert.deepEqual(after.map(w => [w.id,w.sessions,w.moons,w.landed,w.genome.palette]), before.map(w => [w.id,w.sessions,w.moons,w.landed,w.genome.palette]));
});

test('the schematic map accommodates further rings with distinct finite positions and empty data', () => {
  for (const count of [1,3,8,9,24,80]) {
    const points = Array.from({length:count},(_,i) => atlasPoint(i,count));
    assert.ok(points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
    assert.equal(new Set(points.map(p => `${p.x},${p.y}`)).size,count);
    for (let i=0;i<points.length;i++) for(let j=i+1;j<points.length;j++) assert.ok(Math.hypot(points[i]!.x-points[j]!.x,points[i]!.y-points[j]!.y)>40);
  }
  assert.deepEqual(atlasWorlds([],{},{}),[]);
});
