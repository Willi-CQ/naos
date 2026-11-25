import assert from 'node:assert/strict';
import { test } from 'node:test';
import { departureAt, freshStart } from '../../src/core/lifecycle.ts';
import { craftKindOf } from '../../src/scene/craft/kind.ts';
import { Quaternion, Vector3 } from 'three';
import { shipFrame } from '../../src/scene/craft/frame.ts';

test('a delayed history discovery does not become a launch', () => {
  assert.equal(freshStart(5000, 6000), true);
  assert.equal(freshStart(5000, 16000), true);
  assert.equal(freshStart(5000, 36000), false);
  assert.equal(freshStart(null, 6000), false);
  assert.equal(freshStart(NaN, 6000), false);
  assert.equal(freshStart(8000, 6000), false);
});

test('departure reaches both ends exactly, lifts above the direct line and has a finite heading', () => {
  const from = { x: 145, y: 20, z: 0 }, to = { x: 450, y: 0, z: 130 };
  const out = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0 };
  departureAt(from, to, 0, 90, out);
  assert.deepEqual([out.x, out.y, out.z], [from.x, from.y, from.z]);
  departureAt(from, to, 1, 90, out);
  assert.ok(Math.hypot(out.x - to.x, out.y - to.y, out.z - to.z) < 1e-8);
  departureAt(from, to, 0.5, 90, out);
  assert.ok(out.y > 30);
  for (let t = 0; t <= 1; t += 0.01) {
    departureAt(from, to, t, 90, out);
    assert.ok(Object.values(out).every(Number.isFinite));
    assert.ok(Math.hypot(out.tx, out.ty, out.tz) > 1);
    assert.ok(Math.hypot(out.x, out.y, out.z) > 140);
  }
});

test('client silhouettes stay distinct even with the same model, and subagents stay smaller', () => {
  const base = { model: 'claude-sonnet-5-5', node: 'main' };
  const hulls = ['claude-code', 'codex', 'cursor'].map((client) => craftKindOf({ ...base, client }).hull);
  assert.equal(new Set(hulls).size, 3);
  assert.equal(craftKindOf({ ...base, client: 'codex', node: 'subagent' }).size, 'tender');
});

test('a radial departure still has a proper ship frame', () => {
  const q = new Quaternion(), direction = new Vector3(0, 1, 0);
  shipFrame(direction, direction, 0, 0, q);
  assert.ok(q.toArray().every(Number.isFinite));
  assert.ok(Math.abs(q.length() - 1) < 1e-8);
});
