/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hud } from '../../src/core/layout.ts';
import { BATTERY_CAP_HZ, CADENCE_HZ, renderDpr, TierMonitor, TIERS } from '../../src/core/tiers.ts';

test('the canvas table in DESIGN 11.2 holds on the attached panel', () => {
  const { free } = hud(1280, 800);
  const mp = TIERS.map((t) => (free.w * free.h * renderDpr(t, free, 1.5) ** 2) / 1e6);
  assert.ok(Math.abs(mp[0]! - 1.21) < 0.01);
  assert.ok(Math.abs(mp[1]! - 0.88) < 0.01);
  assert.ok(Math.abs(mp[2]! - 0.59) < 0.01);
});

test('the ceiling on the drawing buffer binds on a wide screen', () => {
  const { free } = hud(2560, 1440);
  const penumbra = TIERS[2]!;
  const d = renderDpr(penumbra, free, 2);
  assert.ok(Math.abs((free.w * free.h * d * d) / 1e6 - penumbra.maxMP) < 1e-9);
});

test('cadence tables match 11.1 and ruling 22', () => {
  assert.deepEqual(CADENCE_HZ, { rest: 0, alive: 30, drift: 30, cruise: 30, event: 60 });
  assert.deepEqual(BATTERY_CAP_HZ, { rest: 0, alive: 0, drift: 10, cruise: 20, event: 30 });
});

/** Drives a monitor with a machine that needs `ms(tier)` per frame, at the given cadence. */
function run(start: number, ms: (index: number) => number, hz: number, seconds: number) {
  const changes: { at: number; index: number }[] = [];
  let plateAt = -1;
  let now = 0;
  const m = new TierMonitor(start, (index) => changes.push({ at: now / 1000, index }), () => { plateAt = now / 1000; });
  while (now < seconds * 1000) {
    const h = Math.min(hz, m.capHz);
    const interval = Math.max(1000 / h, ms(m.index));
    now += interval;
    m.frame(interval, h, now);
  }
  return { changes, plateAt, m };
}

test('a fast machine climbs from Penumbra to Umbra, one probe a minute', () => {
  const { changes } = run(2, () => 5, 60, 200);
  assert.deepEqual(changes.map((c) => c.index), [1, 0]);
  assert.ok(Math.abs(changes[0]!.at - 61) < 2, `first step at ${changes[0]!.at}`);
  assert.ok(Math.abs(changes[1]!.at - 122) < 3, `second step at ${changes[1]!.at}`);
});

test('a very slow machine reaches the Plate once, after every tier and every cap', () => {
  const { changes, plateAt, m } = run(0, () => 140, 60, 200);
  assert.deepEqual(changes.map((c) => c.index), [1, 2]);
  assert.equal(m.capHz, 15);
  assert.ok(plateAt > 30 && plateAt < 100, `plate at ${plateAt}`);
});

test('a healthy session at drift never changes tier', () => {
  const { changes, plateAt } = run(1, () => 10, 15, 600);
  assert.deepEqual(changes, []);
  assert.equal(plateAt, -1);
});

test('three failed probes end the probing', () => {
  // Umbra is too slow for 60 Hz, Corona is fine, so every step up fails.
  const { changes } = run(1, (i) => (i === 0 ? 25 : 10), 60, 900);
  const ups = changes.filter((c) => c.index === 0).length;
  assert.equal(ups, 3);
  assert.equal(changes.at(-1)?.index, 1);
});

test('samples from two cadences never share a window', () => {
  const m = new TierMonitor(0, () => assert.fail('a mix of cadences must not step down'), () => assert.fail('no plate'));
  let now = 0;
  for (let i = 0; i < 400; i++) {
    const hz = i % 20 < 10 ? 60 : 15;
    now += 1000 / hz;
    m.frame(1000 / 15, hz, now);
  }
  assert.equal(m.index, 0);
});

test('frames after a rest are ignored', () => {
  const m = new TierMonitor(0, () => assert.fail('no change'), () => assert.fail('no plate'));
  m.rest();
  for (let i = 0; i < 3; i++) m.frame(5000, 60, i);
  for (let i = 0; i < 60; i++) m.frame(16.7, 60, 3 + i * 16.7);
  assert.equal(m.index, 0);
});
