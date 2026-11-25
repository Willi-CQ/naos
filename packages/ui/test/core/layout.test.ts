/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bandOf, hud, LAYOUT } from '../../src/core/layout.ts';
import { renderDpr, TIERS } from '../../src/core/tiers.ts';

const umbra = TIERS[0]!;

test('the free rect table in DESIGN 4.1 holds', () => {
  const rows: [number, number, number, 'C' | 'R' | 'W', number, number, number, number][] = [
    [1280, 800, 1.5, 'C', 748, 720, 1.21, 1],
    [1280, 665, 1.5, 'C', 748, 605, 1.02, 1],
    [1920, 1080, 1, 'R', 1300, 992, 1.29, 1.38],
    [2560, 1440, 1, 'W', 1840, 1344, 2.47, 1.4],
  ];
  for (const [vw, vh, dpr, cls, w, h, mp, k] of rows) {
    const u = hud(vw, vh);
    assert.equal(u.cls, cls);
    assert.equal(u.free.w, w);
    assert.equal(u.free.h, h);
    const d = renderDpr(umbra, u.free, dpr);
    assert.ok(Math.abs((u.free.w * d * u.free.h * d) / 1e6 - mp) < 0.01, `${vw}: ${mp} MP`);
    assert.ok(Math.abs(u.craftK - k) < 0.005, `${vw}: craftK ${u.craftK}`);
  }
});

test('class boundaries fall where the table says', () => {
  assert.equal(hud(1599, 900).cls, 'C');
  assert.equal(hud(1600, 900).cls, 'R');
  assert.equal(hud(2199, 900).cls, 'R');
  assert.equal(hud(2200, 900).cls, 'W');
});

test('a short window collapses the strip, a closed rail leaves 44 px', () => {
  assert.equal(hud(1280, 719).short, true);
  assert.equal(hud(1280, 720).short, false);
  assert.equal(hud(1280, 665).free.y, LAYOUT.C.top);
  assert.equal(hud(1280, 800, false).free.x, 44);
  assert.equal(hud(1280, 800, false).free.w, 1280 - 44 - 296);
});

test('a band follows recency', () => {
  assert.deepEqual([0, 1, 2, 7, 8, 30].map(bandOf), [0, 0, 1, 1, 2, 2]);
});
