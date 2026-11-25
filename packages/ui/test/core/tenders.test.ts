import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { FleetEngine, type FleetBody } from '../../src/scene/fleet.ts';
import { ArcBuffer, BeamBuffer, HullBuffer } from '../../src/scene/layers/buffers.ts';
import type { RosterCraft } from '../../src/scene/roster.ts';

const craft = (id: string, over: Partial<RosterCraft> = {}): RosterCraft => ({
  id, worldId: 'w', role: 'tender', parentId: 'lead', order: 0, depth: 1, owned: false,
  state: 'tool', altitude: .5, tps: 0, tokens: 0, tier: 6, danger: false, since: 100000,
  tools: [], countdown: null, fuel: null, queued: 0, moon: null, acked: false, workflow: null, pad: null, ...over,
});
const lead = () => craft('lead', { role: 'vessel', parentId: null, depth: 0 });
function harness() {
  const buffers = { plumes: new ArcBuffer(128, 24), wakes: new ArcBuffer(128, 24), rings: new ArcBuffer(128, 24), hulls: new HullBuffer(128), beams: new BeamBuffer(64) };
  const body: FleetBody = { worldId: 'w', position: new THREE.Vector3(250, 0, 0), radius: 40, rCss: 40, perUnit: 1, a: new THREE.Vector3(1, 0, 0), b: new THREE.Vector3(0, 0, 1) };
  const engine = new FleetEngine(buffers, (id) => id === 'w' ? body : undefined);
  const camera = new THREE.PerspectiveCamera(34, 800 / 600, .5, 10000);
  camera.position.set(250, 250, 1000); camera.lookAt(body.position); camera.updateMatrixWorld(true);
  let wall = 1000;
  const set = (crafts: RosterCraft[], level: 'system' | 'world' = 'system', selected: string | null = null, reduced = false) => engine.setRoster({ crafts, hoops: [] }, { level, worldId: level === 'world' ? 'w' : null, selected }, { free: { w: 800, h: 600 }, craftK: 1, discR: 72, reduced, cut: false }, 100000 + wall);
  const draw = () => { wall += 16; engine.draw({ wall, kernel: 100000 + wall, dt: .016, scene: wall / 1000 }, camera); };
  const visible = () => { const result: Array<{ id: string; x: number; y: number }> = []; engine.forEachSlot((s) => { if (s.drawn) result.push({ id: s.id, x: s.x, y: s.y }); }); return result; };
  const close = () => Object.values(buffers).forEach((b) => b.geometry.dispose());
  return { engine, set, draw, visible, close, body };
}

test('completed siblings do not hide later waves in Fleet or World, and raw order stays intact', () => {
  const h = harness();
  try {
    const history = Array.from({ length: 50 }, (_, order) => craft(`old-${order}`, { order, state: 'finished' }));
    for (const level of ['system', 'world'] as const) for (let wave = 0; wave < 3; wave++) {
      const live = Array.from({ length: 3 }, (_, i) => craft(`wave-${wave}-${i}`, { order: 50 + wave * 3 + i }));
      const rows = [lead(), ...history, ...live], before = JSON.stringify(rows);
      h.set(rows, level); h.draw();
      assert.equal(h.visible().filter((s) => s.id.startsWith('wave-')).length, 3);
      assert.equal(JSON.stringify(rows), before);
      for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
        const a = { ...h.engine.spot(live[i]!.id)! }, b = { ...h.engine.spot(live[j]!.id)! };
        assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 18, `each tender has a readable place: ${level}, wave ${wave}: ${JSON.stringify([a,b])}`);
      }
      history.push(...live.map((c) => ({ ...c, state: 'finished' as const })));
    }
  } finally { h.close(); }
});

test('selection and a fresh departure remain visible beyond the normal density cap', () => {
  const h = harness();
  try {
    const rows = [lead(), ...Array.from({ length: 12 }, (_, order) => craft(`child-${order}`, { order }))];
    h.set(rows, 'system', 'child-11'); h.draw();
    assert.ok(h.engine.spot('child-11'));
    h.set(rows, 'system');
    h.engine.launch('child-10', 'lead', 1016); h.draw();
    assert.ok(h.engine.spot('child-10'));
  } finally { h.close(); }
});

test('nested agents draw after their parents even without depth metadata; missing or landing parents leave a world anchor', () => {
  const h = harness();
  try {
    const nested = craft('a-child', { parentId: 'z-parent', depth: 0 });
    h.set([nested, craft('z-parent', { depth: 0 }), lead()]); h.draw();
    const p = new THREE.Vector3();
    assert.ok(h.engine.positionOf('a-child', p) && p.distanceTo(h.body.position) < 500);
    assert.ok(h.engine.spot('a-child'));
    h.set([craft('orphan', { parentId: 'missing' })]); h.draw();
    assert.ok(h.engine.spot('orphan'));
    h.set([lead(), craft('survivor')]); h.draw();
    h.engine.land('lead', false, 1032); h.draw();
    assert.ok(h.engine.spot('survivor'));
  } finally { h.close(); }
});

test('tokenless tenders hold their place; reduced motion and view switches keep finite ships', () => {
  const h = harness();
  try {
    const rows = [lead(), craft('one'), craft('two', { order: 1 }), craft('three', { order: 2 })];
    h.set(rows); h.draw(); const before = h.visible();
    h.draw(); assert.deepEqual(h.visible(), before);
    for (const level of ['world', 'system', 'world'] as const) {
      h.set(rows, level, null, true); h.draw();
      assert.equal(h.visible().length, 4);
      assert.ok(h.visible().every((s) => Number.isFinite(s.x) && Number.isFinite(s.y)));
    }
  } finally { h.close(); }
});
