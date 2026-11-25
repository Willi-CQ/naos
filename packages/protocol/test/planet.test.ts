import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  archetypeDefaults, extractGenome, genomeFromFacts, hashName, parseDesignerOutput, PLANET_ARCHETYPES, PLANET_GENOME_VERSION,
  planetGenomeGuide, validateGenome,
} from '../src/index.ts';
import type { PlanetGenome, RepoFacts } from '../src/index.ts';

const HEX = /^#[0-9a-f]{6}$/;

function assertWellFormed(g: PlanetGenome, label: string): void {
  assert.equal(g.version, PLANET_GENOME_VERSION, label);
  assert.ok(PLANET_ARCHETYPES.includes(g.archetype), label);
  assert.ok(Number.isInteger(g.seed) && g.seed >= 0 && g.seed < 2 ** 32, `${label} seed ${g.seed}`);
  for (const h of Object.values(g.palette)) assert.match(h, HEX, label);
  for (const h of [g.oceans.deep, g.oceans.shallow, g.clouds.color, g.atmosphere.color]) assert.match(h, HEX, label);
  for (const v of Object.values(g.terrain)) assert.ok(v >= 0 && v <= 1, `${label} terrain ${v}`);
  for (const v of [g.oceans.coverage, g.oceans.shelf, g.oceans.glint, g.clouds.coverage, g.clouds.scale, g.clouds.storms, g.clouds.wisps]) assert.ok(v >= 0 && v <= 1, label);
  assert.ok(g.clouds.drift >= -1 && g.clouds.drift <= 1, label);
  assert.ok(g.bands.count >= 2 && g.bands.count <= 16, label);
  assert.ok(g.axialTilt >= 0 && g.axialTilt <= 180, label);
  assert.ok(g.rotation.rate >= 0.25 && g.rotation.rate <= 4, label);
  assert.ok(g.rationale.length <= 240, label);
  if (g.rings) {
    assert.ok(g.rings.inner >= 1.15, label);
    assert.ok(g.rings.outer >= g.rings.inner + 0.09, `${label} rings ${g.rings.inner} ${g.rings.outer}`);
  }
}

test('every archetype default survives the validator unchanged', () => {
  for (const a of PLANET_ARCHETYPES) {
    const g = archetypeDefaults(a, 7);
    g.rationale = 'x';
    const { genome, fixes } = validateGenome(g);
    assert.deepEqual(genome, g, a);
    assert.deepEqual(fixes, [], a);
  }
});

test('the validator takes anything at all and never throws', () => {
  const junk: unknown[] = [
    undefined, null, 0, 1, '', 'planet', [], [1, 2], true, () => 1, Symbol.iterator, new Date(0), NaN, Infinity,
    {}, { archetype: 'nonsense' }, { archetype: 7 }, { seed: 'x' }, { seed: NaN }, { seed: -5.5 }, { seed: Number.MAX_SAFE_INTEGER },
    { palette: 3 }, { palette: { low: 3, mid: '#zzzzzz', high: '#12345', accent: null } },
    { terrain: { relief: 'high', craters: Infinity, scale: -1, caps: 99 } },
    { rings: 7 }, { rings: [] }, { rings: { inner: 3, outer: 1 } }, { rings: { inner: NaN } }, { axialTilt: 900 }, { axialTilt: -40 },
    { rotation: null }, { rotation: { rate: 0 } }, { rationale: 12 }, { version: 99 },
    JSON.parse('{"__proto__": {"polluted": true}, "archetype": "gas"}'),
  ];
  for (const input of junk) {
    const { genome } = validateGenome(input);
    assertWellFormed(genome, String(input));
  }
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
});

test('out of range values clamp, and the designer is told', () => {
  const { genome, fixes } = validateGenome({
    version: 1, seed: 1, archetype: 'terran', rationale: 'r',
    terrain: { relief: 3, craters: -2 },
    axialTilt: 400,
    bands: { count: 99 },
  });
  assert.equal(genome.terrain.relief, 1);
  assert.equal(genome.terrain.craters, 0);
  assert.equal(genome.axialTilt, 180);
  assert.equal(genome.bands.count, 16);
  assert.ok(fixes.some((f) => f.includes('terrain.relief')));
  assert.ok(fixes.some((f) => f.includes('axialTilt')));
});

test('what is left out falls back to the archetype, not to a generic value', () => {
  const { genome } = validateGenome({ version: 1, seed: 1, archetype: 'desert', rationale: 'r' });
  const defaults = archetypeDefaults('desert', 1);
  assert.deepEqual(genome.palette, defaults.palette);
  assert.deepEqual(genome.atmosphere, defaults.atmosphere);
  assert.notDeepEqual(genome.palette, archetypeDefaults('ocean', 1).palette);
});

test('neon is taken out of a palette, and hue stays', () => {
  const { genome, fixes } = validateGenome({ version: 1, seed: 1, archetype: 'terran', rationale: 'r', palette: { mid: '#ff00ff' } });
  assert.notEqual(genome.palette.mid, '#ff00ff');
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(genome.palette.mid.slice(i, i + 2), 16)) as [number, number, number];
  assert.equal(r, b, 'magenta stays magenta');
  assert.ok(g > 20, 'and is no longer pure');
  assert.ok(fixes.some((f) => f.includes('too saturated')));
  // The accent may burn: lava has to.
  assert.equal(validateGenome({ archetype: 'volcanic', palette: { accent: '#ff6a1f' } }).genome.palette.accent, '#ff6a1f');
});

test('rings are optional, and a broken pair is put in order', () => {
  assert.equal(validateGenome({ archetype: 'gas', rings: null }).genome.rings, null);
  assert.equal(validateGenome({ archetype: 'gas' }).genome.rings, null);
  const { genome, fixes } = validateGenome({ archetype: 'gas', rings: { inner: 2.2, outer: 1.4 } });
  assert.ok(genome.rings!.outer > genome.rings!.inner);
  assert.ok(fixes.some((f) => f.includes('rings.outer')));
});

test('a rationale is one clean line of bounded length, because repo content can end up in it', () => {
  const { genome } = validateGenome({ archetype: 'rock', rationale: `  line one\nline two\u0007${'x'.repeat(500)}` });
  assert.ok(genome.rationale.length <= 240);
  assert.ok(!/[\u0000-\u001f]/.test(genome.rationale));
  assert.ok(genome.rationale.startsWith('line one line two'));
});

test('a genome survives JSON, because that is how it travels', () => {
  const g = genomeFromFacts({ name: 'Benchmark-Agent', languages: { TypeScript: 9000 }, sizeBytes: 4e6, ageDays: 200, activity: 0.6 });
  assert.deepEqual(validateGenome(JSON.parse(JSON.stringify(g))).genome, g);
});

test('the same facts always give the same planet', () => {
  const facts: RepoFacts = { name: 'ConstructQ', languages: { Python: 400, Shell: 10 }, sizeBytes: 12e6, ageDays: 400, activity: 0.2 };
  assert.deepEqual(genomeFromFacts(facts), genomeFromFacts({ ...facts }));
  assert.deepEqual(genomeFromFacts({ name: 'x' }), genomeFromFacts({ name: 'x' }));
});

test('case and padding of a name do not change the planet', () => {
  assert.equal(genomeFromFacts({ name: 'Harbor' }).seed, genomeFromFacts({ name: '  harbor ' }).seed);
});

test('every world gets a planet, however little is known', () => {
  const sparse: RepoFacts[] = [
    { name: '' }, { name: 'a' }, { name: 'x'.repeat(4000) },
    { name: 'n', languages: {} }, { name: 'n', languages: { Brainfuck: 3 } },
    { name: 'n', languages: { TypeScript: -4, Go: NaN, Rust: Infinity } },
    { name: 'n', sizeBytes: -1, ageDays: -9, activity: 44 }, { name: 'n', sizeBytes: NaN, files: NaN, ageDays: Infinity },
    { name: 'n', sizeBytes: 1e15, ageDays: 1e6, activity: 1 },
  ];
  for (const facts of sparse) assertWellFormed(genomeFromFacts(facts), JSON.stringify(facts));
  assertWellFormed(genomeFromFacts({} as RepoFacts), 'no name at all');
});

test('a hundred repos give a varied family with no twins', () => {
  const langs: RepoFacts['languages'][] = [{ TypeScript: 1 }, { Python: 1 }, { Rust: 1 }, { Go: 1 }, { Shell: 1 }, { Markdown: 1 }, { 'C++': 1 }, {}];
  const genomes = Array.from({ length: 100 }, (_, i) => genomeFromFacts({
    name: `repo-${i}`, languages: langs[i % langs.length]!, sizeBytes: 10 ** (4 + (i % 6)), ageDays: (i * 37) % 1200, activity: ((i * 13) % 10) / 10,
  }));
  genomes.forEach((g, i) => assertWellFormed(g, `repo-${i}`));
  const seen = new Set(genomes.map((g) => JSON.stringify({ ...g, rationale: '' })));
  assert.equal(seen.size, 100);
  const kinds = new Set(genomes.map((g) => g.archetype));
  assert.ok(kinds.size >= 7, `only ${kinds.size} archetypes in 100 repos`);
  const top = Math.max(...[...kinds].map((k) => genomes.filter((g) => g.archetype === k).length));
  assert.ok(top <= 45, `one archetype took ${top} of 100`);
});

test('facts steer the planet the way the table promises', () => {
  const count = (facts: (i: number) => RepoFacts, a: readonly string[]) => Array.from({ length: 300 }, (_, i) => genomeFromFacts(facts(i))).filter((g) => a.includes(g.archetype)).length;
  const big = count((i) => ({ name: `big-${i}`, languages: { Python: 1 }, sizeBytes: 5e9 }), ['gas', 'ice-giant']);
  const small = count((i) => ({ name: `small-${i}`, languages: { Python: 1 }, sizeBytes: 5e4 }), ['gas', 'ice-giant']);
  assert.ok(big > small * 2, `giants: ${big} big, ${small} small`);
  const hot = count((i) => ({ name: `hot-${i}`, languages: { Rust: 90, C: 10 } }), ['volcanic', 'desert', 'rock']);
  assert.ok(hot > 200, `metal gave ${hot} hard worlds`);
  const old = genomeFromFacts({ name: 'probe', languages: { Shell: 1 }, sizeBytes: 1e3, ageDays: 3000 });
  const young = genomeFromFacts({ name: 'probe', languages: { Shell: 1 }, sizeBytes: 1e3, ageDays: 3 });
  assert.ok(old.terrain.craters > young.terrain.craters, 'old surfaces collect craters');
});

test('the hash is stable across runs and machines', () => {
  assert.equal(hashName(''), 0x811c9dc5);
  assert.equal(hashName('a'), 0xe40c292c);
  assert.equal(hashName('foobar'), 0xbf9cf968);
});

test('the guide names every archetype and field a designer must fill in', () => {
  const guide = planetGenomeGuide();
  for (const a of PLANET_ARCHETYPES) assert.ok(guide.includes(`${a}:`), a);
  for (const path of ['palette.low', 'terrain.craters', 'oceans.coverage', 'clouds.drift', 'bands.spot', 'atmosphere.haze', 'rings.outer', 'axialTilt', 'rotation.rate', 'rationale']) {
    assert.ok(guide.includes(path), path);
  }
  const example = JSON.parse(guide.trim().split('\n').at(-1)!) as unknown;
  assert.deepEqual(validateGenome(example).fixes, []);
});

test('a designer\'s last message is the JSON, fenced or bare', () => {
  const body = { archetype: 'ice', rationale: 'A frozen protocol that rarely changes.' };
  assert.deepEqual(extractGenome(`Here.\n\`\`\`json\n${JSON.stringify(body)}\n\`\`\``), body);
  assert.deepEqual(extractGenome(`notes first ${JSON.stringify(body)} and nothing after`), body);
  assert.equal(extractGenome('no planet here'), null);
  assert.equal(extractGenome(''), null);
  const parsed = parseDesignerOutput(`\`\`\`\n${JSON.stringify(body)}\n\`\`\``);
  assert.ok(parsed);
  assert.equal(parsed.genome.archetype, 'ice');
  assert.equal(parsed.genome.rationale, body.rationale);
});
