/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { altitude, burnAngle, orbitCss, orbitRate, plumeCss, quotaLight, SALVO, thetaE, WAVE_AGES_S } from '../../src/core/laws.ts';

const near = (got: number, want: number, eps: number) => assert.ok(Math.abs(got - want) <= eps, `${got} is not within ${eps} of ${want}`);

// Every expected value below is the sample table in DESIGN 7.4.
test('altitude is logarithmic, and the 1M samples match the table', () => {
  const want: [number, number][] = [[14_600, 0.86], [71_000, 0.61], [245_000, 0.34], [500_000, 0.17], [800_000, 0.06]];
  for (const [used, alt] of want) near(altitude(used, 1_000_000), alt, 0.006);
  assert.equal(altitude(0, 1_000_000), 1);
  near(altitude(1_000_000, 1_000_000), 0, 1e-12);
  assert.equal(altitude(2_000_000, 1_000_000), 0);
});

test('orbit period matches the table', () => {
  const want: [number, number][] = [[10, 81], [25, 39], [50, 25], [100, 20], [396, 18]];
  for (const [tps, period] of want) near((2 * Math.PI) / orbitRate(tps), period, 0.6);
  assert.equal(orbitRate(0), 0);
});

test('speed at a 70 px radius matches the table', () => {
  near(orbitRate(50) * 70, 17, 0.6);
  near(orbitRate(396) * 70, 24, 0.6);
});

test('an observed burn matches the table at a 70 px radius, and never passes half an orbit', () => {
  const want: [number, number][] = [[66, 5], [578, 39], [2000, 107], [8000, 205]];
  for (const [tok, px] of want) near(burnAngle(tok) * 70, px, 0.6);
  assert.ok(burnAngle(1e9) <= Math.PI);
});

test('plume length matches the table and never falls below 30 px', () => {
  const want: [number, number][] = [[0, 30], [50, 43], [120, 54], [396, 67]];
  for (const [tps, px] of want) near(plumeCss(tps), px, 0.6);
});

test('thetaE matches the table, and the cap arrives at 347 s', () => {
  const want: [number, number][] = [[0, 56], [20, 78], [60, 101], [134, 122], [400, 150]];
  for (const [age, px] of want) near(thetaE(age, 720), px, 0.6);
  assert.ok(thetaE(346, 720) < 150);
  near(thetaE(348, 720), 150, 1e-9);
  near(thetaE(0, 1440), 112, 1e-9);
});

test('deflection at 400 px is thetaE squared over the distance, and matches the table', () => {
  const want: [number, number][] = [[0, 7.8], [20, 15], [60, 25], [134, 37], [400, 56]];
  for (const [age, px] of want) near(thetaE(age, 720) ** 2 / 400, px, 0.6);
});

test('orbit radius follows altitude, and the span is clamped', () => {
  near(orbitCss(10, 0, 1), 24, 1e-9);
  near(orbitCss(10, 1, 1), 10 + 14 + 34, 1e-9);
  near(orbitCss(100, 1, 1.4), 100 + 14 + 66 * 1.4, 1e-9);
});

test('the system dims with the window, and never below its floor', () => {
  near(quotaLight(0), 0.28, 1e-12);
  near(quotaLight(1), 1, 1e-12);
});

test('the fixed sequences match the design', () => {
  assert.deepEqual([...WAVE_AGES_S], [0, 30, 120, 600]);
  assert.deepEqual({ ...SALVO }, { openCount: 3, openWindowMs: 1000, joinWindowMs: 10_000, maxStreaks: 16 });
});
