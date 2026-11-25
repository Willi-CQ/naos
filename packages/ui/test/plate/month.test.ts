// The month and what the worlds keep of it. The scene and the Plate read the same functions, so one test covers both.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HistoryDigest, Salvo } from '@naos/protocol';
import { cityLights, exposuresOf } from '../../src/scene/history.ts';
import { jitter, laneOf, skySpokes, skyStars, spokeHalfDeg, starClass } from '../../src/store/sky.ts';

const DAY = 86_400_000;
const now = Date.UTC(2026, 9, 31, 13, 0);

const row = (id: string, over: Partial<HistoryDigest> = {}): HistoryDigest => ({
  nodeId: id, sessionId: `s-${id}`, worldId: 'w1', projectRoot: null, kind: 'main', parentNodeId: null, startedAt: now - DAY, endedAt: now - DAY + 600_000,
  model: 'claude-sonnet-5-5', bytes: 1_048_576, usd: 1, blockedMs: 0, outcome: 'clean', ...over,
});

test('one star per transcript inside the 30 days', () => {
  const stars = skyStars([row('a'), row('old', { endedAt: now - 31 * DAY }), row('future', { endedAt: now + 1000 })], now);
  assert.equal(stars.length, 1);
  assert.ok(Math.abs(stars[0]!.ageDays - (DAY - 600_000) / DAY) < 1e-9);
  assert.equal(stars[0]!.mb, 1);
  assert.equal(stars[0]!.laneDeg, laneOf('w1'));
  assert.ok(stars[0]!.laneDeg >= -15 && stars[0]!.laneDeg <= 15);
});

test('stellar class comes from the input price', () => {
  assert.equal(starClass('claude-fable-5-5'), 'starO');
  assert.equal(starClass('claude-opus-5-5'), 'starA');
  assert.equal(starClass('claude-sonnet-5-5'), 'starG');
  assert.equal(starClass('claude-haiku-5-5'), 'starM');
  assert.equal(starClass(null), 'starG', 'an unknown model is a plain G');
});

test('a star keeps its scatter: the same seed lays the same grain', () => {
  const a = jitter(1234);
  const b = jitter(1234);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test('a closed salvo burns one spoke, once, however many lists hold it', () => {
  const salvo = { salvoId: 'x', worldId: 'w1', openedAt: now - DAY, closedAt: now - DAY + 11_000, nodeIds: ['a', 'b', 'c', 'd'] } as unknown as Salvo;
  const open = { ...salvo, salvoId: 'y', closedAt: null } as unknown as Salvo;
  const spokes = skySpokes([[salvo], [salvo, open]], now);
  assert.equal(spokes.length, 1);
  assert.equal(spokes[0]!.count, 4);
  assert.equal(spokeHalfDeg(4), 1.6 + 0.9 * 2);
});

test('a city per finished agent, unit length, stable, oldest first, embers marked', () => {
  const rows = [row('a', { endedAt: now - 5000 }), row('b', { endedAt: now - 9000, outcome: 'failed' }), row('c', { endedAt: null }), row('d', { outcome: 'abandoned', endedAt: now - 1000 })];
  const lights = cityLights(rows);
  assert.equal(lights.length, 3, 'one still running is no city');
  assert.deepEqual(lights.map((l) => l.fail), [true, false, true]);
  for (const l of lights) assert.ok(Math.abs(Math.hypot(...l.dir) - 1) < 1e-9);
  assert.deepEqual(cityLights(rows), lights);
});

test('agents of one session land close together, which is what makes a city', () => {
  const parent = 'session-one';
  const rows = Array.from({ length: 12 }, (_, i) => row(`agent-${i}`, { sessionId: parent, kind: 'subagent' }));
  const lights = cityLights(rows);
  const [cx, cy, cz] = lights.reduce<[number, number, number]>((sum, l) => [sum[0] + l.dir[0], sum[1] + l.dir[1], sum[2] + l.dir[2]], [0, 0, 0]);
  const len = Math.hypot(cx, cy, cz);
  for (const l of lights) assert.ok((l.dir[0] * cx + l.dir[1] * cy + l.dir[2] * cz) / len > 0.85);
});

test('a long exposure is one main craft of the last 24 hours', () => {
  const exposures = exposuresOf([
    row('a', { endedAt: now - 3_600_000, startedAt: now - 7_200_000 }),
    row('agent', { kind: 'subagent', endedAt: now - 1000 }),
    row('yesterday', { endedAt: now - 25 * 3_600_000 }),
    row('running', { endedAt: null }),
  ], now);
  assert.equal(exposures.length, 1);
  assert.ok(exposures[0]!.sweep >= 0.8 && exposures[0]!.sweep <= 4.4);
  assert.ok(exposures[0]!.altitude >= 0 && exposures[0]!.altitude < 1);
});
