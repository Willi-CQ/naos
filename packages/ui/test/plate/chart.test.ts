import assert from 'node:assert/strict';
import { test } from 'node:test';
import { thetaE } from '../../src/core/laws.ts';
import { arcPath, buildChart, lensBack, lensForward, meridians, raOf, skyPoint, skyRadius } from '../../src/plate/chart.ts';
import { ageOf, dayHeights, skyDay } from '../../src/store/sky.ts';
import type { Model } from '../../src/store/model.ts';

const free = { x: 236, y: 36, w: 748, h: 720 };

test('the sky scale and the month fit the free rect at class C', () => {
  assert.equal(skyRadius(free), 374);
  assert.equal(skyRadius({ x: 0, y: 0, w: 1840, h: 1344 }), 920);
  const now = skyPoint(raOf(0), 0, 374);
  const horizon = skyPoint(raOf(30), 0, 374);
  assert.ok(now.x > 0, 'now at the right');
  assert.ok(Math.abs(Math.hypot(now.x, now.y) - 374) < 0.5, 'psi 90 lands on the rim');
  assert.ok(horizon.x < now.x, 'the Horizon lies to the left of now');
  assert.ok(now.y < 0, 'tilted: the now meridian rises to the right');
});

test('the middle of the month sits on the view axis, stereographic', () => {
  const p = skyPoint(raOf(15), 0, 374);
  assert.ok(Math.hypot(p.x, p.y) < 1);
  assert.ok(Math.abs(Math.hypot(skyPoint(raOf(0), 0, 100).x, skyPoint(raOf(0), 0, 100).y) - 100) < 0.5);
});

test('forward lens agrees with the shader: back through it lands on the source', () => {
  const well = { x: 50, y: -20, theta: 92 };
  for (const s of [{ x: 300, y: 0 }, { x: 60, y: -10 }, { x: -200, y: 140 }]) {
    const image = lensForward(s, [well]);
    const back = lensBack(image, [well]);
    assert.ok(Math.hypot(back.x - s.x, back.y - s.y) < 0.2, JSON.stringify({ s, image, back }));
    assert.ok(Math.hypot(image.x - well.x, image.y - well.y) >= 92 - 0.01, 'the outer image lies outside the ring');
  }
});

test('deflection at 400 px follows the Bend table: 7.8 px on arrival, 25 px at 60 s', () => {
  const at = (ageS: number) => {
    const image = lensForward({ x: 400, y: 0 }, [{ x: 0, y: 0, theta: thetaE(ageS, 720) }]);
    return image.x - 400;
  };
  assert.ok(Math.abs(at(0) - 7.8) < 0.3, String(at(0)));
  assert.ok(Math.abs(at(60) - 25) < 1.5, String(at(60)));
});

test('no well, no bend: 31 meridians and nothing else moves', () => {
  const straight = meridians(374, []);
  assert.equal(straight.length, 31);
  assert.equal(straight[0]!.kind, 'now');
  assert.equal(straight[30]!.kind, 'horizon');
  assert.equal(straight[7]!.kind, 'week');
  assert.equal(straight[8]!.kind, 'day');
  const bent = meridians(374, [{ x: 100, y: 0, theta: 92 }]);
  assert.notEqual(straight[10]!.d, bent[10]!.d);
});

const world = (slot: number, rows: unknown[] = []) => ({ worldId: `w${slot}`, slot, mass: 100 * slot, ageDays: 0, rows, name: `w${slot}` });
const craft = (id: string, over: object = {}) => ({ id, kind: 'main', state: 'writing', altitude: 0.5, outputTokens: 0, live: true, parentId: null, tone: 'work', metric: '', glyph: 'α', tier: 6, ...over });

test('the chart follows layout.ts and rings follow state', () => {
  const asks = craft('asks', { state: 'approve', metric: '0:41' });
  const waits = craft('waits', { state: 'source', metric: '0:12' });
  const model = {
    now: 0,
    allWorlds: [world(1, [{ type: 'craft', craft: asks }, { type: 'craft', craft: waits }]), world(2)],
    crafts: { asks, waits, tender: craft('tender', { kind: 'subagent', parentId: 'asks' }) },
    decisions: [{ nodeId: 'asks', status: 'open', ageMs: 41_000 }],
  } as unknown as Pick<Model, 'allWorlds' | 'crafts' | 'decisions' | 'now'>;
  const chart = buildChart(model, free, 1);
  assert.ok(chart.discR > 30 && chart.discR < 90, String(chart.discR));
  assert.equal(chart.worlds.length, 2);
  for (const w of chart.worlds) assert.ok(Math.abs(w.x) < free.w / 2 && Math.abs(w.y) < free.h / 2, 'Home holds every world');
  const well = chart.crafts.find((c) => c.craft.id === 'asks')!;
  assert.equal(well.ring, 'well');
  assert.ok(Math.abs(well.ringR - thetaE(41, 720)) < 0.01);
  assert.equal(chart.crafts.find((c) => c.craft.id === 'waits')!.ring, 'broken');
  assert.equal(chart.crafts.find((c) => c.craft.id === 'waits')!.ringR, 30);
  assert.equal(chart.wells.length, 1, 'an observed wait bends nothing');
  assert.equal(chart.beads.length, 1);
});

test('a band falls inward at once and moves outward only at the next boot', () => {
  const at = (ageDays: number) => ({ now: 0, allWorlds: [{ ...world(1), ageDays }], crafts: {}, decisions: [] }) as unknown as Pick<Model, 'allWorlds' | 'crafts' | 'decisions' | 'now'>;
  const held = new Map<string, 0 | 1 | 2>();
  assert.equal(buildChart(at(20), free, 1, null, held).worlds[0]!.band, 2);
  assert.equal(buildChart(at(0), free, 1, null, held).worlds[0]!.band, 0, 'a world that wakes falls in');
  assert.equal(buildChart(at(20), free, 1, null, held).worlds[0]!.band, 0, 'and stays until the page boots again');
  assert.equal(buildChart(at(20), free, 1).worlds[0]!.band, 2, 'a fresh boot reads the real age');
});

test('the Belt: a rock holds no slot, and two sandboxes are two rocks past the last world', () => {
  const rock = (id: string) => ({ ...world(0), worldId: id, belt: true });
  const model = { now: 0, allWorlds: [world(1), world(2)], beltWorlds: [rock('a'), rock('b')], crafts: {}, decisions: [] } as unknown as Pick<Model, 'allWorlds' | 'beltWorlds' | 'crafts' | 'decisions' | 'now'>;
  const chart = buildChart(model, free, 1);
  assert.equal(chart.worlds.length, 4);
  const rocks = chart.worlds.filter((w) => w.belt);
  assert.equal(rocks.length, 2);
  assert.ok(Math.hypot(...rocks[0]!.at) > Math.hypot(...chart.worlds[0]!.at));
  assert.notDeepEqual(rocks[0]!.at, rocks[1]!.at);
});

test('a label never lands on a world, and the Almanac pushes world labels aside', () => {
  const near = craft('near', { state: 'errored', tag: 'API 529', metric: '529', altitude: 0 });
  const model = { now: 0, almanac: ['one', 'two', 'three'], allWorlds: [world(1, [{ type: 'craft', craft: near }]), world(2)], crafts: { near }, decisions: [] } as unknown as Pick<Model, 'allWorlds' | 'crafts' | 'decisions' | 'now' | 'almanac'>;
  const chart = buildChart(model, free, 1);
  const mark = chart.crafts[0]!;
  assert.ok(mark.label, 'a failed craft has a label');
  for (const w of chart.worlds) assert.ok(Math.hypot(mark.label.x - w.x, mark.label.y - w.y) > w.r);
});

test('past 8 wells: the newest, then the oldest 7', () => {
  const rows = Array.from({ length: 10 }, (_, i) => craft(`c${i}`, { state: 'approve' }));
  const model = {
    now: 0,
    allWorlds: [world(1, rows.map((c) => ({ type: 'craft', craft: c })))],
    crafts: Object.fromEntries(rows.map((c) => [c.id, c])),
    decisions: rows.map((c, i) => ({ nodeId: c.id, status: 'open', ageMs: i * 1000 })),
  } as unknown as Pick<Model, 'allWorlds' | 'crafts' | 'decisions' | 'now'>;
  const chart = buildChart(model, free, 1);
  assert.equal(chart.wells.length, 8);
  const ages = chart.crafts.filter((c) => c.ring === 'well').length;
  assert.equal(ages, 10, 'all ten keep their ring, only the lens is capped');
});

test('a well weaker than the unit softening still gives a finite path', () => {
  assert.ok(!meridians(374, [{ x: 0, y: 0, theta: 0 }])[15]!.d.includes('NaN'));
});

test('the arc gauge survives both ends', () => {
  assert.match(arcPath(60, 0), /^M/);
  assert.match(arcPath(60, 1), /^M/);
});

test('Sky days are calendar days', () => {
  const now = new Date(2026, 9, 31, 14, 0).getTime();
  assert.equal(ageOf(new Date(2026, 9, 31, 1, 0).getTime(), now), 0);
  assert.equal(ageOf(new Date(2026, 9, 30, 23, 0).getTime(), now), 1);
  const row = (at: number, over: object = {}) => ({ nodeId: String(at), worldId: 'w', kind: 'main', startedAt: at, endedAt: at, usd: 1, blockedMs: 60_000, outcome: 'clean', ...over });
  const rows = [row(now - 1000), row(now - 2000, { kind: 'subagent' }), row(now - 86_400_000, { outcome: 'failed' })] as never[];
  const stats = skyDay(rows, [{ openedAt: now - 500, nodeIds: ['a', 'b', 'c'] }] as never[], now, 0);
  assert.equal(stats.sessions, 1);
  assert.equal(stats.agents, 1);
  assert.equal(stats.fanouts, 1);
  assert.equal(stats.largest, 3);
  assert.equal(skyDay(rows, [], now, 1).failed, 1);
  assert.equal(dayHeights(rows, now)[0], 2);
});
