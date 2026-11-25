import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chooseCadence, EVENT_HOLD_MS } from '../../src/core/cadence.ts';
import { LABEL_CAP, placeLabels } from '../../src/core/labels.ts';
import type { LabelIn } from '../../src/core/labels.ts';
import { streamLoad } from '../../src/core/laws.ts';
import { craftAngle, onOrbit, orbitEllipse, orbitPlane } from '../../src/core/orbit.ts';
import { dot, homeLens } from '../../src/core/space.ts';
import { BATTERY_CAP_HZ, CADENCE_HZ } from '../../src/core/tiers.ts';

const facts = { now: 1000, hidden: false, linkUp: true, covered: false, burning: false, observed: false, holdUntil: 0, still: false };

test('cadence follows the table of 11.1 and ruling 22', () => {
  assert.equal(chooseCadence(facts), 'alive');
  assert.equal(chooseCadence({ ...facts, observed: true }), 'drift');
  assert.equal(chooseCadence({ ...facts, observed: true, burning: true }), 'cruise');
  assert.equal(chooseCadence({ ...facts, burning: true, holdUntil: 1200 }), 'event');
  assert.equal(chooseCadence({ ...facts, holdUntil: 1000 }), 'alive', 'the hold has ended');
  assert.ok(EVENT_HOLD_MS === 400);
});

test('ruling 22: 30 Hz at rest and 60 in events on mains, the old rest rule on battery, nothing hidden', () => {
  assert.equal(CADENCE_HZ.alive, 30);
  assert.equal(CADENCE_HZ.event, 60);
  assert.equal(CADENCE_HZ.drift, 30, 'never under 30 while the window shows');
  assert.equal(CADENCE_HZ.rest, 0);
  assert.equal(BATTERY_CAP_HZ.alive, 0);
  assert.equal(BATTERY_CAP_HZ.rest, 0);
  assert.equal(BATTERY_CAP_HZ.event, 30);
});

test('a hidden tab, a lost link and a covered canvas are all rest, whatever flies', () => {
  const busy = { ...facts, burning: true, observed: true, holdUntil: 9000 };
  assert.equal(chooseCadence({ ...busy, hidden: true }), 'rest');
  assert.equal(chooseCadence({ ...busy, linkUp: false }), 'rest');
  assert.equal(chooseCadence({ ...busy, covered: true }), 'rest');
});

test('reduced motion: nothing travels, so tokens alone draw nothing', () => {
  assert.equal(chooseCadence({ ...facts, burning: true, observed: true, still: true }), 'rest');
});

test('streamer load: nothing at rest, one busy craft shows, a fleet tops out below 1', () => {
  assert.equal(streamLoad(0), 0);
  assert.ok(streamLoad(388) > 0.55 && streamLoad(388) < 0.7);
  assert.ok(streamLoad(5000) > 0.99 && streamLoad(5000) <= 1);
});

test('orbit planes tilt 14 to 30 degrees, each on its own node', () => {
  for (let k = 0; k < 32; k += 1) {
    const p = orbitPlane(k);
    const n = [p.a[1] * p.b[2] - p.a[2] * p.b[1], p.a[2] * p.b[0] - p.a[0] * p.b[2], p.a[0] * p.b[1] - p.a[1] * p.b[0]];
    const tilt = (Math.acos(Math.abs(n[1]!)) * 180) / Math.PI;
    assert.ok(tilt >= 13.9 && tilt <= 30.1, `slot ${k}: ${tilt}`);
    assert.ok(Math.abs(Math.hypot(...p.a) - 1) < 1e-9 && Math.abs(Math.hypot(...p.b) - 1) < 1e-9);
  }
});

test('the ellipse the Plate draws goes through the points the scene projects', () => {
  const plane = orbitPlane(3);
  const lens = homeLens({ w: 748, h: 720 });
  const { rx, ry, tilt } = orbitEllipse(plane, lens);
  assert.ok(rx >= ry && ry > 0);
  for (let th = 0; th < 6.3; th += 0.4) {
    const p = onOrbit(plane, [0, 0, 0], 1, th);
    const x = dot(p, lens.right);
    const y = -dot(p, lens.up);
    const u = (x * Math.cos(tilt) + y * Math.sin(tilt)) / rx;
    const v = (-x * Math.sin(tilt) + y * Math.cos(tilt)) / ry;
    assert.ok(Math.abs(u * u + v * v - 1) < 1e-6);
  }
});

test('law 3: the angle moves only with tokens', () => {
  assert.equal(craftAngle('a', 500), craftAngle('a', 500));
  assert.ok(craftAngle('a', 600) > craftAngle('a', 0));
});

const base: LabelIn = { worlds: [], crafts: [], dots: [], discR: 59, w: 748, h: 720, almanacTop: Number.POSITIVE_INFINITY };

test('a world label sits on the outward side from the star', () => {
  const [label] = placeLabels({ ...base, worlds: [{ id: 'w', x: 200, y: 0, r: 30, width: 60 }] });
  assert.equal(label!.anchor, 'start');
  assert.ok(label!.x === 240, String(label!.x));
});

test('a craft on that spot pushes the label round the world', () => {
  const free = placeLabels({ ...base, worlds: [{ id: 'w', x: 200, y: 0, r: 30, width: 60 }] })[0]!;
  const moved = placeLabels({ ...base, worlds: [{ id: 'w', x: 200, y: 0, r: 30, width: 60 }], dots: [{ x: 262, y: 0 }] })[0]!;
  assert.notDeepEqual([free.x, free.y], [moved.x, moved.y]);
});

test('a label keeps off a plume, and off a tag already placed', () => {
  const world = { id: 'w', x: 200, y: 0, r: 30, width: 60 };
  const free = placeLabels({ ...base, worlds: [world] })[0]!;
  const moved = placeLabels({ ...base, worlds: [world], plumes: [{ x: free.x + 20, y: free.y - 4 }] })[0]!;
  assert.notDeepEqual([free.x, free.y], [moved.x, moved.y], 'a world name walks off a drive');
  const craft = { id: 'c', x: free.x - 13, y: free.y, width: 60 };
  const out = placeLabels({ ...base, worlds: [world], crafts: [craft] });
  const tag = out.find((l) => l.id === 'c')!;
  const name = out.find((l) => l.id === 'w')!;
  assert.ok(Math.abs(tag.y - name.y) > 12 || Math.abs(tag.x - name.x) > 60, 'the tag is placed first and the name walks');
});

test('a label holds its spot while the camera moves, and leaves it only when that spot goes bad', () => {
  const world = { id: 'w', x: 200, y: 0, r: 30, width: 60 };
  const first = placeLabels({ ...base, worlds: [world], held: new Map([['w', 2]]) })[0]!;
  assert.equal(first.turn, 2, 'a clean held spot stays, though the first turn is clean too');
  const moved = placeLabels({ ...base, worlds: [world, { id: 'x', x: first.x + 20, y: first.y, r: 30, width: 60 }], held: new Map([['w', 2]]) }).find((l) => l.id === 'w')!;
  assert.notEqual(moved.turn, 2, 'a world on that spot moves it');
});

test('a craft label never lies on a world, the gap the Plate had', () => {
  const worlds = [{ id: 'w', x: 100, y: 100, r: 46, width: 60 }];
  const near = { id: 'c', x: 100 + 46 + 4, y: 100, width: 40 };
  const out = placeLabels({ ...base, worlds, crafts: [near] }).find((l) => l.id === 'c')!;
  // The label is a box 40 wide and 16 high. Its nearest point to the world centre must lie outside the limb.
  const left = out.anchor === 'start' ? out.x : out.anchor === 'end' ? out.x - 40 : out.x - 20;
  const dx = Math.max(left - 100, 0, 100 - (left + 40));
  const dy = Math.max(out.y - 12 - 100, 0, 100 - (out.y + 4));
  assert.ok(Math.hypot(dx, dy) > 46, JSON.stringify(out));
});

test('a world label steps off the Almanac, and hides only when it has nowhere to go', () => {
  const moved = placeLabels({ ...base, almanacTop: 215, worlds: [{ id: 'w', x: 0, y: 190, r: 20, width: 60 }] })[0]!;
  assert.equal(moved.hidden, false);
  assert.ok(moved.y + 4 <= 215, String(moved.y));
  const stuck = placeLabels({ ...base, almanacTop: -400, worlds: [{ id: 'w', x: 0, y: 300, r: 20, width: 60 }] })[0]!;
  assert.equal(stuck.hidden, true);
});

test('30 labels at most, and attention order keeps the first ones', () => {
  const crafts = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, x: i * 8 - 150, y: 200, width: 30 }));
  const out = placeLabels({ ...base, crafts, worlds: [{ id: 'w', x: 0, y: -200, r: 20, width: 60 }] });
  assert.equal(out.filter((l) => !l.hidden).length, LABEL_CAP);
  assert.equal(out.find((l) => l.id === 'c0')!.hidden, false);
  assert.equal(out.find((l) => l.id === 'c39')!.hidden, true);
});
