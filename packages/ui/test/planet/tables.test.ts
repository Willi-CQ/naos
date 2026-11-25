import assert from 'node:assert/strict';
import { test } from 'node:test';
import { archetypeDefaults, genomeFromFacts, validateGenome } from '@naos/protocol';
import type { PlanetGenome } from '@naos/protocol';
import { airOf, cloudRate, cubeBytes, hasClouds, hasOcean, heightRange, isFluid, reliefAmplitude, seaLevel, spinRate } from '../../src/scene/planet/params.ts';
import {
  BAND_LUT_SIZE, buildBandLut, buildRayCraters, buildRingLut, buildStorms, linearOf, MAX_RAY_CRATERS, MAX_STORMS, normalQuantile, packCities, RING_LUT_SIZE, RING_TAU_MAX, sphereDir,
} from '../../src/scene/planet/tables.ts';
import { buildNoiseVolume, gradientNoise, GRADIENT_RANGE, VOLUME_PERIOD, VOLUME_SIZE } from '../../src/scene/planet/volume.ts';

const ringed = (over: Partial<NonNullable<PlanetGenome['rings']>> = {}): PlanetGenome => validateGenome({
  version: 1, seed: 41, archetype: 'gas', rationale: 'r', rings: { inner: 1.3, outer: 2.3, density: 0.8, gaps: 0.7, color: '#d8ccb8', ...over },
}).genome;

test('noise is periodic in all three axes, so the volume tiles', () => {
  const a = new Float64Array(4);
  const b = new Float64Array(4);
  for (const [x, y, z] of [[0.3, 1.7, 9.1], [5.5, 0.25, 15.9], [12.1, 12.2, 12.3]] as const) {
    gradientNoise(x, y, z, VOLUME_PERIOD, a);
    gradientNoise(x + VOLUME_PERIOD, y, z - VOLUME_PERIOD, VOLUME_PERIOD, b);
    for (let i = 0; i < 4; i++) assert.ok(Math.abs(a[i]! - b[i]!) < 1e-9);
  }
});

test('the analytic gradient is the real gradient', () => {
  const at = new Float64Array(4);
  const hi = new Float64Array(4);
  const lo = new Float64Array(4);
  const e = 1e-5;
  for (let i = 0; i < 40; i++) {
    const p = [(i * 0.617) % 16, (i * 0.371 + 2) % 16, (i * 1.13 + 5) % 16] as [number, number, number];
    gradientNoise(...p, VOLUME_PERIOD, at);
    for (let axis = 0; axis < 3; axis++) {
      const up = [...p] as [number, number, number];
      const down = [...p] as [number, number, number];
      up[axis]! += e;
      down[axis]! -= e;
      gradientNoise(...up, VOLUME_PERIOD, hi);
      gradientNoise(...down, VOLUME_PERIOD, lo);
      const numeric = (hi[0]! - lo[0]!) / (2 * e);
      assert.ok(Math.abs(numeric - at[axis + 1]!) < 1e-5, `axis ${axis} at ${p}: ${numeric} against ${at[axis + 1]}`);
    }
  }
});

test('the volume uses its 8 bits and centres on zero', () => {
  const v = buildNoiseVolume(32, 8);
  assert.equal(v.length, 32 ** 3 * 4);
  let value = 0;
  let spread = 0;
  let clipped = 0;
  for (let i = 3; i < v.length; i += 4) {
    const n = v[i]! / 127.5 - 1;
    value += n;
    spread += n * n;
    if (v[i] === 0 || v[i] === 255) clipped++;
  }
  const count = v.length / 4;
  assert.ok(Math.abs(value / count) < 0.03, `mean ${value / count}`);
  assert.ok(Math.sqrt(spread / count) > 0.25, `rms ${Math.sqrt(spread / count)}`);
  // A little clipping buys range for every other texel, and the extremes it flattens are single peaks.
  assert.ok(clipped / count < 0.03, `clipped ${clipped / count}`);
  assert.ok(GRADIENT_RANGE > 1);
  assert.ok(VOLUME_SIZE % VOLUME_PERIOD === 0, 'whole lattice cells across the tile');
});

test('a band table has zones and belts, and wind that changes sign', () => {
  const lut = buildBandLut(archetypeDefaults('gas', 9));
  assert.equal(lut.length, BAND_LUT_SIZE * 4);
  let lightest = 0;
  let darkest = 255;
  let east = 0;
  let west = 0;
  for (let i = 0; i < BAND_LUT_SIZE; i++) {
    const v = lut[i * 4 + 1]!;
    lightest = Math.max(lightest, v);
    darkest = Math.min(darkest, v);
    if (lut[i * 4 + 3]! > 150) east++;
    if (lut[i * 4 + 3]! < 105) west++;
  }
  assert.ok(lightest - darkest > 40, `range ${lightest - darkest}`);
  assert.ok(east > 20 && west > 20, `east ${east}, west ${west}`);
});

test('more contrast in a genome means more contrast in its bands', () => {
  const range = (contrast: number) => {
    const g = archetypeDefaults('gas', 9);
    g.bands.contrast = contrast;
    const lut = buildBandLut(g);
    let hi = 0;
    let lo = 255;
    for (let i = BAND_LUT_SIZE * 0.2; i < BAND_LUT_SIZE * 0.8; i++) { hi = Math.max(hi, lut[Math.floor(i) * 4 + 1]!); lo = Math.min(lo, lut[Math.floor(i) * 4 + 1]!); }
    return hi - lo;
  };
  assert.ok(range(0.9) > range(0.15) + 20, `${range(0.9)} against ${range(0.15)}`);
});

test('ring opacity spans the range real rings do, with a clear division', () => {
  const lut = buildRingLut(ringed());
  assert.equal(lut.length, RING_LUT_SIZE * 4);
  const tau = Array.from({ length: RING_LUT_SIZE }, (_, i) => (lut[i * 4 + 3]! / 255) * RING_TAU_MAX);
  const sorted = [...tau].sort((a, b) => a - b);
  const median = sorted[RING_LUT_SIZE >> 1]!;
  assert.ok(sorted[Math.floor(RING_LUT_SIZE * 0.95)]! > median * 1.5, 'dense ringlets');
  assert.ok(sorted[Math.floor(RING_LUT_SIZE * 0.1)]! < median * 0.5, 'thin gaps');
  assert.ok(tau[RING_LUT_SIZE - 1]! < 0.25, 'the outer edge fades');
  assert.ok(tau[0]! < 0.1, 'the inner edge starts thin');
});

test('no rings, no ring table', () => {
  assert.ok(buildRingLut(archetypeDefaults('rock', 1)).every((v) => v === 0));
});

test('the same seed gives the same tables, another seed others', () => {
  const a = ringed();
  assert.deepEqual(buildRingLut(a), buildRingLut({ ...a }));
  assert.deepEqual(buildBandLut(a), buildBandLut({ ...a }));
  assert.notDeepEqual(buildBandLut(a), buildBandLut({ ...a, seed: 42 }));
  assert.notDeepEqual(buildStorms(a).place, buildStorms({ ...a, seed: 42 }).place);
});

test('storms stay on the sphere and inside the shader array', () => {
  for (let seed = 0; seed < 20; seed++) {
    for (const archetype of ['gas', 'ice-giant', 'terran', 'ocean'] as const) {
      const g = archetypeDefaults(archetype, seed);
      g.bands.storms = 1;
      g.bands.spot = 1;
      g.clouds.storms = 1;
      g.clouds.coverage = 1;
      const s = buildStorms(g);
      assert.ok(s.count <= MAX_STORMS);
      for (let i = 0; i < s.count; i++) {
        const [x, y, z, r] = s.place.subarray(i * 4, i * 4 + 4) as unknown as [number, number, number, number];
        assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < 1e-5);
        assert.ok(r > 0 && r < 0.6);
      }
    }
  }
});

test('a great spot asked for is there, and first', () => {
  const g = archetypeDefaults('gas', 3);
  g.bands.spot = 0.8;
  const s = buildStorms(g);
  assert.ok(s.place[3]! >= 0.2, 'the largest storm');
  assert.equal(s.look[2], 1, 'tinted with the accent');
  g.bands.spot = 0;
  assert.ok(buildStorms(g).place[3]! < 0.1);
});

test('ray craters follow the crater amount and stay inside the array', () => {
  const g = archetypeDefaults('rock', 5);
  g.terrain.craters = 0;
  assert.equal(buildRayCraters(g).count, 0);
  g.terrain.craters = 1;
  const { count, list } = buildRayCraters(g);
  assert.ok(count > 0 && count <= MAX_RAY_CRATERS);
  assert.ok(Math.abs(Math.hypot(list[0]!, list[1]!, list[2]!) - 1) < 1e-5);
});

test('sea level rises with coverage', () => {
  const sea = (coverage: number) => { const g = archetypeDefaults('terran', 1); g.oceans.coverage = coverage; return seaLevel(g); };
  assert.ok(sea(0.3) < sea(0.5) && sea(0.5) < sea(0.7) && sea(0.7) < sea(0.95));
  assert.ok(Math.abs(sea(0.5)) < 1e-3);
  assert.equal(seaLevel(archetypeDefaults('rock', 1)), 0);
});

test('the normal quantile is good enough to place a coast', () => {
  for (const [p, z] of [[0.5, 0], [0.84, 0.994], [0.975, 1.96], [0.16, -0.994]] as const) assert.ok(Math.abs(normalQuantile(p) - z) < 0.02, `${p}`);
  assert.ok(Number.isFinite(normalQuantile(0)) && Number.isFinite(normalQuantile(1)));
});

test('air: none gives none, more density gives more depth, colour steers it', () => {
  const none = archetypeDefaults('rock', 1);
  assert.equal(airOf(none).on, false);
  const g = archetypeDefaults('terran', 1);
  const thin = { ...g, atmosphere: { ...g.atmosphere, density: 0.1 } };
  assert.ok(airOf(g).tauR[2] > airOf(thin).tauR[2]);
  assert.ok(airOf(g).tauR[2] > airOf(g).tauR[0], 'blue air scatters blue');
  const dust = archetypeDefaults('desert', 1);
  assert.ok(airOf(dust).tauR[0] > airOf(dust).tauR[2], 'dust scatters red');
});

test('the classes of body agree with what the bake will allocate', () => {
  assert.ok(isFluid(archetypeDefaults('gas', 1)) && isFluid(archetypeDefaults('shrouded', 1)) && !isFluid(archetypeDefaults('ice', 1)));
  assert.ok(hasOcean(archetypeDefaults('terran', 1)) && !hasOcean(archetypeDefaults('gas', 1)) && !hasOcean(archetypeDefaults('rock', 1)));
  assert.ok(hasClouds(archetypeDefaults('terran', 1)) && !hasClouds(archetypeDefaults('rock', 1)) && !hasClouds(archetypeDefaults('volcanic', 1)));
});

test('the height range holds what the terrain can reach', () => {
  for (const relief of [0, 0.5, 1]) {
    const g = archetypeDefaults('desert', 1);
    g.terrain.relief = relief;
    assert.ok(heightRange(g) > reliefAmplitude(g) * 2);
  }
});

test('ruling 22: spin rises with activity and never reaches zero', () => {
  const g = archetypeDefaults('terran', 1);
  assert.ok(spinRate(g, 0) > 0);
  assert.ok(spinRate(g, 1) > spinRate(g, 0.5) && spinRate(g, 0.5) > spinRate(g, 0));
  assert.ok(Math.abs(spinRate(g, 5)) === Math.abs(spinRate(g, 1)), 'activity is clamped');
  assert.ok(spinRate({ ...g, axialTilt: 177 }, 0.5) < 0, 'past 90 degrees it turns backwards');
  assert.ok(Math.abs(cloudRate(g, 1, 0)) > Math.abs(cloudRate(g, 0, 0)));
  const still = { ...g, clouds: { ...g.clouds, drift: 0 } };
  assert.notEqual(cloudRate(still, 0.5, 1), 0, 'the high layer always moves');
});

test('colours decode to linear light', () => {
  assert.deepEqual(linearOf('#000000'), [0, 0, 0]);
  assert.deepEqual(linearOf('#ffffff'), [1, 1, 1]);
  assert.ok(Math.abs(linearOf('#808080')[0] - 0.2158) < 1e-3);
});

test('cities pack to unit directions and keep their kind', () => {
  const p = packCities([{ x: 2, y: 0, z: 0, size: 0.03, brightness: 0.5 }, { x: 0, y: 0, z: 0, ember: true }]);
  assert.equal(p.count, 2);
  assert.deepEqual([...p.point.subarray(0, 3)], [1, 0, 0]);
  assert.equal(p.kind[1], 0.5);
  assert.equal(p.kind[2], 1, 'ember');
  assert.ok(Number.isFinite(p.point[4]), 'a zero vector does not poison the buffer');
});

test('sphereDir is on the sphere and covers both hemispheres', () => {
  const north = sphereDir(0.1, 0.3);
  const south = sphereDir(0.9, 0.3);
  assert.ok(north[1] > 0 && south[1] < 0);
  assert.ok(Math.abs(Math.hypot(...north) - 1) < 1e-9);
});

test('a cube counts its six faces and its mips', () => {
  assert.equal(cubeBytes(128, 4), 128 * 128 * 6 * 4 * (4 / 3));
});

test('a real default genome reaches the tables without trouble', () => {
  for (let i = 0; i < 60; i++) {
    const g = genomeFromFacts({ name: `w${i}`, languages: { Rust: i, Python: 60 - i }, sizeBytes: 10 ** (3 + (i % 7)), ageDays: i * 20, activity: (i % 11) / 10 });
    buildBandLut(g);
    buildRingLut(g);
    assert.ok(buildStorms(g).count <= MAX_STORMS);
    assert.ok(Number.isFinite(seaLevel(g)));
    assert.ok(Number.isFinite(spinRate(g, 0.3)));
  }
});
