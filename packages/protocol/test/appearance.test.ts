import assert from 'node:assert/strict';
import { test } from 'node:test';
import { archetypeDefaults, identityForRepo, planetForRepo, validateGenome } from '../src/index.ts';

test('repo purpose gives measurement, construction, orchestration and knowledge distinct identities', () => {
  for (const [name, theme] of [['Benchmark-Agent', 'observatory'], ['ConstructQ', 'forge'], ['NAOS', 'intelligence'], ['Personal-agent knowledge', 'knowledge']]) {
    const id = identityForRepo(name!);
    if (name === 'Personal-agent knowledge') assert.equal(identityForRepo('Archive', 'Knowledge retrieval and document memory').theme, theme);
    else assert.equal(id.theme, theme);
  }
  assert.deepEqual(identityForRepo('  ConstructQ '), identityForRepo('constructq'));
  assert.equal(identityForRepo('Untitled', 'A construction planning tool', ['BIM']).theme, 'forge');
});

test('art direction keeps authored geography and never mutates a designer genome', () => {
  const base = archetypeDefaults('rock', 841);
  const before = structuredClone(base);
  const id = identityForRepo('ConstructQ');
  const authored = planetForRepo(base, id, true);
  assert.deepEqual(base, before);
  assert.equal(authored.archetype, base.archetype);
  assert.equal(authored.seed, base.seed);
  assert.deepEqual(authored.terrain, base.terrain);
  assert.notEqual(authored.palette.mid, base.palette.mid);
  assert.deepEqual(validateGenome(authored).fixes, []);
  assert.equal(planetForRepo(base, identityForRepo('Benchmark-Agent')).archetype, 'ice');
  assert.equal(planetForRepo(base, id).archetype, 'desert');
});
