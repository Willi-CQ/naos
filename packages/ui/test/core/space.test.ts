/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BAND_RADII, BELT_RADIUS, DISK_OUTER, dot, FRONT, HOLE_RADIUS, HOME, homeDistance, homeLens, homeOrbit, lensOf, moonRate, orbitBasis, orbitOf, placeSpace, planetRadius, see, SIDE, spinAxis,
  spinRate, UP, WORLD_R_MAX, WORLD_R_MIN, worldOrbit, type SpaceSeed, type Vec3, type WorldSpot,
} from '../../src/core/space.ts';

const DEG = Math.PI / 180;

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

const distance = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const seed = (slot: number, mass = 1000, ageDays = 0): SpaceSeed => ({ key: `w${slot}`, slot, mass, ageDays });

function clearance(spots: readonly WorldSpot[]): { space: number; home: number } {
  const lens = homeLens({ w: 748, h: 720 });
  let space = Infinity;
  let home = Infinity;
  for (let i = 0; i < spots.length; i++) {
    const a = spots[i]!;
    const s = see(lens, a.position);
    for (let j = 0; j < i; j++) {
      const b = spots[j]!;
      const q = see(lens, b.position);
      space = Math.min(space, distance(a.position, b.position) - a.radius - b.radius);
      home = Math.min(home, Math.hypot(s.x - q.x, s.y - q.y) - a.radius * s.scale - b.radius * q.scale);
    }
  }
  return { space, home };
}

test('the three axes are orthonormal and the Home lean puts the disk on a slant', () => {
  for (const [a, b] of [[UP, SIDE], [UP, FRONT], [SIDE, FRONT]] as const) assert.ok(Math.abs(dot(a, b)) < 1e-12);
  assert.ok(Math.abs(dot(UP, UP) - 1) < 1e-12);
  const lens = homeLens({ w: 748, h: 720 });
  const right = see(lens, [300, 0, 0]);
  const left = see(lens, [-300, 0, 0]);
  assert.ok(right.y < left.y, 'the disk rises to the right, as in the reference');
});

test('the orbit basis is orthonormal everywhere, a pole included, and right never leaves the plane under up', () => {
  for (const az of [-3, -1, 0, 0.17, 2, 5]) {
    for (const el of [-90, -60, 0, 20, 89.9, 90]) {
      const { right, up, back } = orbitBasis(az, el * DEG);
      assert.ok(Math.abs(dot(right, right) - 1) < 1e-9 && Math.abs(dot(up, up) - 1) < 1e-9 && Math.abs(dot(back, back) - 1) < 1e-9);
      assert.ok(Math.abs(dot(right, up)) < 1e-9 && Math.abs(dot(right, back)) < 1e-9 && Math.abs(dot(up, back)) < 1e-9);
      assert.ok(Math.abs(dot(right, UP)) < 1e-9, 'no roll');
    }
  }
});

test('orbitOf inverts a pose, wherever it stands', () => {
  for (const az of [-2.8, -1, 0.17, 2.5]) {
    for (const el of [-80, -20, 20, 80]) {
      const { back } = orbitBasis(az, el * DEG);
      const focus: Vec3 = [30, -20, 12];
      const o = orbitOf([focus[0] + back[0] * 500, focus[1] + back[1] * 500, focus[2] + back[2] * 500], focus);
      assert.ok(Math.abs(o.az - az) < 1e-9 && Math.abs(o.el - el * DEG) < 1e-9 && Math.abs(o.dist - 500) < 1e-9);
    }
  }
});

test('the same world stands at the same place in any window', () => {
  const seeds = Array.from({ length: 12 }, (_, i) => seed(i, 10 ** (i % 5), i));
  assert.deepEqual(placeSpace(seeds), placeSpace([...seeds].reverse()));
});

test('Home holds the disk and every world at every layout class', () => {
  const sets = [7, 15, 32].map((n) => placeSpace(Array.from({ length: n }, (_, slot) => seed(slot, 10 ** (slot % 6), (slot * 7) % 30))));
  for (const free of [{ w: 748, h: 720 }, { w: 748, h: 605 }, { w: 1300, h: 992 }, { w: 1840, h: 1344 }, { w: 1040, h: 720 }]) {
    const lens = lensOf(homeOrbit(free), [0, 0, 0], HOME.fov, free.h);
    assert.ok(homeDistance(free) > 0);
    for (const az of [0, 90, 180, 270]) {
      const s = see(lens, [Math.cos(az * DEG) * DISK_OUTER, 0, Math.sin(az * DEG) * DISK_OUTER]);
      assert.ok(Math.abs(s.x) < free.w / 2 && Math.abs(s.y) < free.h / 2, `${free.w}x${free.h} disk at ${az}: ${s.x} ${s.y}`);
    }
    for (const spots of sets) {
      for (const w of spots) {
        const s = see(lens, w.position);
        const r = w.radius * s.scale;
        assert.ok(Math.abs(s.x) + r < free.w / 2 && Math.abs(s.y) + r < free.h / 2, `${free.w}x${free.h} ${w.key}: ${s.x} ${s.y} r ${r}`);
      }
    }
  }
});

test('the worlds stand in the foreground, and none outgrows the shadow at Home', () => {
  const lens = homeLens({ w: 748, h: 720 });
  const shadow = HOLE_RADIUS * see(lens, [0, 0, 0]).scale;
  for (const n of [1, 4, 7, 32]) {
    const seen = placeSpace(Array.from({ length: n }, (_, slot) => seed(slot, 10 ** (slot % 6), slot))).map((w) => w.radius * see(lens, w.position).scale);
    for (const r of seen) assert.ok(r < shadow * 1.1, `${r} px against a shadow of ${shadow}`);
    if (n <= 7) assert.ok(Math.max(...seen) > shadow * 0.75, `the heaviest of ${n} is ${Math.max(...seen)} px against a shadow of ${shadow}`);
  }
});

test('placement stays clear in space and at Home under four mass distributions', () => {
  const masses: ((r: () => number) => number)[] = [(r) => 10 ** (r() * 9), (r) => r() ** 8 * 1e9, () => 1e6, () => 1];
  const r = rng(7);
  let space = Infinity;
  let home = Infinity;
  for (let run = 0; run < 240; run++) {
    const n = [7, 15, 19, 32][run % 4]!;
    const m = masses[(run >> 2) % 4]!;
    const spots = placeSpace(Array.from({ length: n }, (_, slot) => seed(slot, m(r), r() * 30)));
    const c = clearance(spots);
    space = Math.min(space, c.space);
    home = Math.min(home, c.home);
    for (const s of spots) {
      assert.ok(Math.hypot(s.position[0], s.position[1], s.position[2]) - s.radius > DISK_OUTER, 'no world touches the disk');
      assert.ok(Math.abs(s.position[1]) < 80, 'close to the disk plane');
    }
  }
  assert.ok(space > 0, `gap in space ${space}`);
  assert.ok(home > 0, `gap at Home ${home}`);
});

test('a new world moves nobody', () => {
  const seeds = Array.from({ length: 8 }, (_, slot) => seed(slot, slot === 0 ? 1e6 : 100));
  const before = placeSpace(seeds);
  const after = placeSpace([...seeds, seed(8, 100)]);
  for (let i = 0; i < before.length; i++) assert.ok(distance(before[i]!.position, after[i]!.position) < 1e-9);
});

test('a world keeps its slot from one day to the next: mass may change its size and never its azimuth', () => {
  const az = (s: WorldSpot) => Math.atan2(s.position[2], s.position[0]);
  const a = placeSpace([seed(0, 10), seed(1, 1000)])[1]!;
  const b = placeSpace([seed(0, 10), seed(1, 1500)])[1]!;
  assert.ok(Math.abs(az(a) - az(b)) < 1e-9);
});

test('a world that wakes falls inward along its azimuth', () => {
  const cold = placeSpace([seed(0, 1000, 20)])[0]!;
  const warm = placeSpace([seed(0, 1000, 0)])[0]!;
  assert.equal(cold.band, 2);
  assert.equal(warm.band, 0);
  assert.ok(Math.hypot(...warm.position) < Math.hypot(...cold.position));
});

test('the Belt lies past every world, and a rock holds no slot', () => {
  const spots = placeSpace([seed(0), seed(1), { key: 'a', slot: -1, mass: 5, ageDays: 0, belt: true }, { key: 'b', slot: -1, mass: 5, ageDays: 0, belt: true }]);
  const rocks = spots.filter((s) => s.belt);
  assert.equal(rocks.length, 2);
  for (const r of rocks) assert.ok(Math.abs(Math.hypot(...r.position) - BELT_RADIUS) < 40);
  assert.ok(distance(rocks[0]!.position, rocks[1]!.position) > 100, 'two sandboxes are two rocks');
  assert.equal(spots.filter((s) => !s.belt).length, 2);
});

test('law 1 in units: light worlds keep a body, the heaviest tops out', () => {
  assert.equal(planetRadius(0, 0), WORLD_R_MIN);
  assert.equal(planetRadius(0, 100), WORLD_R_MIN);
  assert.ok(Math.abs(planetRadius(1000, 1000) - WORLD_R_MAX) < 1e-9);
});

test('rotation rises with activity and never reaches zero', () => {
  assert.ok(spinRate(0) > 0);
  assert.ok(spinRate(1) > 1.5 * spinRate(0));
  assert.ok(spinRate(0.5) > spinRate(0.1));
  assert.ok(moonRate(0) > 0 && moonRate(4) > 0);
});

test('spin axes are unit and differ by slot', () => {
  const axes = Array.from({ length: 8 }, (_, i) => spinAxis(i));
  for (const a of axes) assert.ok(Math.abs(Math.hypot(...a) - 1) < 1e-9);
  assert.ok(new Set(axes.map((a) => a.map((v) => v.toFixed(2)).join())).size > 4);
});

test('World view approaches the lit hemisphere and leaves the hole behind the focus', () => {
  const position: Vec3 = [300, 10, 100];
  const o = worldOrbit(position, 240);
  const { back } = orbitBasis(o.az, o.el);
  assert.ok(dot(back, position) < 0, 'the camera approaches the hemisphere facing the light');
  const lens = lensOf(o, position, 30, 720);
  const hole = see(lens, [0, 0, 0]);
  assert.ok(hole.depth < 240, 'the hole does not dominate the background behind the world');
});
