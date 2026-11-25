import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advanceClock, diskLaw, diskLight, FLARE_LIFE, HEAT_H, HEAT_W, holeExposure, kepler, paintHeat, R_IN, R_OUT } from '../../src/scene/hole/disk.ts';
import { bakeStreaks, STREAK_H, STREAK_MEAN, STREAK_W } from '../../src/scene/hole/streaks.ts';

test('the disk cools, dims and thins from the inside as the quota drains', () => {
  let last = diskLaw(1);
  assert.equal(last.rIn, R_IN);
  for (const q of [0.8, 0.5, 0.3, 0.15, 0.05]) {
    const law = diskLaw(q);
    assert.ok(law.energy < last.energy, `energy at ${q}`);
    assert.ok(law.temp < last.temp, `temperature at ${q}`);
    assert.ok(law.rIn > last.rIn && law.rIn < R_OUT, `inner edge at ${q}`);
    last = law;
  }
});

test('at zero the disk is gone and only the photon ring stays', () => {
  const law = diskLaw(0);
  assert.equal(law.energy, 0);
  assert.ok(law.ring > 1, 'the ring still shines');
  assert.deepEqual(diskLight(0), [0, 0, 0]);
});

test('out of range quota is held at the ends', () => {
  assert.deepEqual(diskLaw(2), diskLaw(1));
  assert.deepEqual(diskLaw(-1), diskLaw(0));
});

test('light on the worlds is warm and follows the disk', () => {
  const [r, g, b] = diskLight(1);
  assert.ok(r > g && g > b);
  assert.ok(diskLight(0.5)[0] < r);
});

test('the disk never freezes, and tokens speed it up', () => {
  assert.ok(advanceClock(0, 1, 0) > 0);
  assert.ok(advanceClock(0, 1, 1) > advanceClock(0, 1, 0));
  assert.ok(kepler(6) === 1 && kepler(24) < kepler(12));
});

test('the camera stops down close to the hole, stays open far off, and opens up from above', () => {
  assert.equal(holeExposure(150), 1);
  assert.ok(holeExposure(10) < 0.6);
  assert.ok(holeExposure(5) >= 0.2, 'it never sinks the disk into the mid tones');
  assert.ok(holeExposure(60, 1) > 1.5 * holeExposure(60, 0));
  assert.equal(holeExposure(60, -0.7), holeExposure(60, 0.7));
});

const heat = () => new Uint8Array(HEAT_W * HEAT_H * 2);
const at = (m: Uint8Array, i: number, j: number, c: number) => m[(j * HEAT_W + i) * 2 + c]!;
const row = (m: Uint8Array, j: number, c: number) => Array.from({ length: HEAT_W }, (_, i) => at(m, i, j, c));
const peak = (a: number[]) => a.indexOf(Math.max(...a));

test('an empty map says so, and an arc lands at its azimuth', () => {
  const m = heat();
  assert.equal(paintHeat(m, [], [], 4, 0), false);
  assert.ok(m.every((v) => v === 0));
  assert.equal(paintHeat(m, [{ azimuth: Math.PI / 2, strength: 0.5 }], [], 4, 0), true);
  const j = Math.round(0.3 * HEAT_H);
  assert.ok(Math.abs(peak(row(m, j, 0)) - HEAT_W / 4) <= 6);
});

test('arcs wrap around the seam', () => {
  const m = heat();
  paintHeat(m, [{ azimuth: 0, strength: 1 }], [], 4, 0);
  const j = Math.round(0.3 * HEAT_H);
  assert.ok(Math.abs(at(m, 0, j, 0) - at(m, HEAT_W - 1, j, 0)) <= 2);
});

test('a flare rides the gas: it turns with the disk, at the rate of the gas, and its inner part runs ahead', () => {
  const m = heat();
  const flare = { azimuth: 3, strength: 1, age: 1, clock: 5 };
  paintHeat(m, [], [flare], 4, 5);
  const start = peak(row(m, 4, 1));
  paintHeat(m, [], [flare], 4, 6);
  const moved = (j: number) => {
    const texels = (HEAT_W + peak(row(m, j, 1)) - start) % HEAT_W;
    return texels > HEAT_W / 2 ? texels - HEAT_W : texels;
  };
  assert.ok(moved(4) < 0, `the disk turns toward negative azimuth, this flare moved ${moved(4)}`);
  assert.ok(moved(2) < moved(8), `inner ${moved(2)} against outer ${moved(8)}`);
  const r = 4 * Math.pow(R_OUT / 4, 4.5 / HEAT_H);
  const expected = (-kepler(r) * HEAT_W) / (2 * Math.PI);
  assert.ok(Math.abs(moved(4) - expected) < 4, `${moved(4)} against ${expected}`);
});

test('a flare dies at the end of its life', () => {
  const m = heat();
  assert.equal(paintHeat(m, [], [{ azimuth: 1, strength: 1, age: FLARE_LIFE, clock: 0 }], 4, 0), false);
});

test('at most 16 arcs count', () => {
  const list = Array.from({ length: 30 }, (_, i) => ({ azimuth: i * 0.5, strength: 0.2 }));
  const a = heat();
  const b = heat();
  paintHeat(a, list, [], 4, 0);
  paintHeat(b, list.slice(0, 16), [], 4, 0);
  assert.deepEqual(a, b);
});

test('the streak map is deterministic, full of contrast, and bakes in reasonable time', () => {
  const t0 = performance.now();
  const a = bakeStreaks();
  const ms = performance.now() - t0;
  assert.equal(a.length, STREAK_W * STREAK_H * 4);
  assert.deepEqual(a.subarray(0, 4000), bakeStreaks().subarray(0, 4000));
  for (let c = 0; c < 4; c++) {
    let lo = 255;
    let hi = 0;
    for (let i = c; i < a.length; i += 4) { lo = Math.min(lo, a[i]!); hi = Math.max(hi, a[i]!); }
    assert.ok(hi - lo > 120, `channel ${c}: ${lo} to ${hi}`);
  }
  for (let c = 0; c < 4; c++) {
    let sum = 0;
    for (let i = c; i < a.length; i += 4) sum += a[i]! / 255;
    assert.ok(Math.abs(sum / (a.length / 4) - STREAK_MEAN[c]!) < 1e-3, `mean of channel ${c}`);
  }
  assert.ok(ms < 800, `${ms} ms`);
  console.log(`streak bake ${ms.toFixed(0)} ms`);
});
