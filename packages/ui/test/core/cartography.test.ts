import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ProjectRegion } from '@naos/protocol';
import { mapRegions, territoryCells } from '../../src/core/cartography.ts';

const folders = (count: number): ProjectRegion[] => Array.from({ length: count }, (_, i) => ({
  path: `packages/area-${i}`, name: `area-${i}`, kind: 'source', files: (i + 1) * 13, entries: [],
}));

test('folder territories partition the map without gaps or overlapping interiors', () => {
  for (const count of [1, 2, 6, 12]) {
    const regions = mapRegions(folders(count), 913), cells = territoryCells(regions);
    const polygons = cells.map(cell => cell.split(' ').map(pair => pair.split(',').map(Number)));
    const area = polygons.reduce((sum, polygon) => sum + Math.abs(polygon.reduce((n, p, i) => {
      const next = polygon[(i + 1) % polygon.length]!;
      return n + p[0]! * next[1]! - next[0]! * p[1]!;
    }, 0)) / 2, 0);
    assert.ok(Math.abs(area - 660000) < 10, `partition area for ${count} territories: ${area}`);
    for (let i = 0; i < regions.length; i++) {
      for (const point of polygons[i]!) {
        assert.ok(point.every(Number.isFinite));
        assert.ok(point[0]! >= 0 && point[0]! <= 1000 && point[1]! >= 0 && point[1]! <= 660);
        const distance = Math.hypot(point[0]! - regions[i]!.x, point[1]! - regions[i]!.y);
        for (const other of regions) assert.ok(distance <= Math.hypot(point[0]! - other.x, point[1]! - other.y) + .03);
      }
    }
  }
});

test('selecting a folder beyond the map limit preserves its project identity and existing anchors', () => {
  const regions = folders(48), original = JSON.stringify(regions);
  const initial = mapRegions(regions, 17), selected = mapRegions(regions, 17, 'packages/area-40');
  assert.equal(selected.length, 12);
  assert.equal(selected.at(-1)!.region.path, 'packages/area-40');
  assert.deepEqual(selected.slice(0, 11), initial.slice(0, 11));
  assert.equal(JSON.stringify(regions), original);
  assert.deepEqual(territoryCells(selected), territoryCells(mapRegions(regions, 17, 'packages/area-40')));
  assert.deepEqual(territoryCells([]), []);
});
