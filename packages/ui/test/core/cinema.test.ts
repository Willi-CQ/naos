import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tourOrbit } from '../../src/core/cinema.ts';
import { landmarkStars } from '../../src/scene/landmarks.ts';

test('the orbit tour closes smoothly, stays clear of the focus and respects the poles', () => {
  const base = { az: 0.2, el: 0.4, dist: 1000 };
  assert.deepEqual(tourOrbit(base, 0), base);
  const end = tourOrbit(base, 180);
  assert.ok(Math.abs(end.az - base.az - Math.PI * 2) < 1e-10);
  assert.equal(end.dist, base.dist);
  for (let t = 0; t <= 180; t++) {
    const at = tourOrbit(base, t);
    assert.ok(at.dist >= base.dist && at.dist <= base.dist * 1.05);
    assert.ok(Math.abs(at.el - base.el) <= 0.0551);
  }
  assert.ok(tourOrbit({ ...base, el: Math.PI / 2 }, 20).el < Math.PI / 2);
});

test('landmark stars form a deterministic sphere independent of repo history', () => {
  const a = landmarkStars();
  assert.deepEqual(a, landmarkStars());
  assert.equal(a.count, 105);
  for (let i = 0; i < a.count; i++) {
    assert.ok(Math.abs(Math.hypot(a.dir[i * 3]!, a.dir[i * 3 + 1]!, a.dir[i * 3 + 2]!) - 1) < 1e-6);
    assert.ok(a.size[i]! >= 12 && a.size[i]! <= 28);
  }
});
