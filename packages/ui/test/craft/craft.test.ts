import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { apparentLength, MARK_FROM, MARK_TO, markBasis, markFade, markPlanar, markPose, MESH_FROM, MESH_TO, meshFade, NEAR_FROM, screenLength, SHADOW_FROM, shadowStrength, shadowTile, smoothstep, stateBody, surfaceDetail } from '../../src/scene/craft/fade.ts';
import { buildField } from '../../src/scene/craft/field.ts';
import { shipFrame } from '../../src/scene/craft/frame.ts';
import { Forge, MAT, mul, move, octagon, roundSegments, scaled, stationAt, turnZ } from '../../src/scene/craft/forge.ts';
import { coverage, difference, glyph, outlineCoverage, sdf, buildAtlas, ATLAS_COLS, ATLAS_ROWS, TILE } from '../../src/scene/craft/glyphs.ts';
import { buildCrumple, buildGrain } from '../../src/scene/craft/grain.ts';
import { HULLS, MARK_LENGTH, ROLES, type HullClass, type Role } from '../../src/scene/craft/kind.ts';
import { assembly, assemblyReady, part, PART_IDS, plumeAnchor } from '../../src/scene/craft/parts.ts';
import { shardOf, SHARDS } from '../../src/scene/craft/shards.ts';

const kinds = (): Array<{ hull: HullClass; role: Role }> => {
  const out: Array<{ hull: HullClass; role: Role }> = [];
  for (const hull of HULLS) for (const role of ROLES) if (role !== 'drone') out.push({ hull, role });
  out.push({ hull: 'default', role: 'drone' });
  return out;
};

test('at true size any two kinds differ by a fifth of their ink, a test the eye can trust', () => {
  // 15 CSS px at the panel's DPR of 1.5. Every kind at the smallest size any mark is ever drawn, which is harder than the real table.
  const px = 22;
  const list = kinds().map((k) => ({ ...k, raster: coverage(glyph(k.hull, k.role), px) }));
  let worst = { d: 1, a: '', b: '' };
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const d = difference(list[i]!.raster, list[j]!.raster);
      if (d < worst.d) worst = { d, a: `${list[i]!.hull}:${list[i]!.role}`, b: `${list[j]!.hull}:${list[j]!.role}` };
    }
  }
  assert.ok(worst.d >= 0.2, `${worst.a} against ${worst.b}: ${worst.d.toFixed(3)}`);
});

test('a mission reads the same across hulls: the feature survives in every row', () => {
  const px = 22;
  for (const role of ROLES.filter((r) => r !== 'plain' && r !== 'drone')) {
    for (const hull of HULLS) {
      const with_ = coverage(glyph(hull, role), px);
      const without = coverage(glyph(hull, 'plain'), px);
      assert.ok(difference(with_, without) > 0.3, `${hull}:${role}`);
    }
  }
});

test('no stroke in a mark is thinner than a device pixel at 15 CSS px', () => {
  // 22 device px over 2.2 units: anything under 0.1 units vanishes between pixels.
  const unit = 22 / 2.2;
  for (const k of kinds()) {
    for (const q of glyph(k.hull, k.role)) {
      if (q.k === 'bar') assert.ok(q.w * unit >= 1.09, `${k.hull}:${k.role} bar ${q.w}`);
      if (q.k === 'ring') assert.ok(q.w * unit >= 1.09, `${k.hull}:${k.role} ring`);
    }
  }
});

test('marks are symmetric across the hull and fit the tile', () => {
  for (const k of kinds()) {
    const p = glyph(k.hull, k.role);
    for (const [x, y] of [[0.3, 0.4], [-0.5, 0.2], [0.8, 0.1], [0, 0.62]] as const) assert.ok(Math.abs(sdf(p, x, y) - sdf(p, x, -y)) < 1e-6, `${k.hull}:${k.role}`);
    assert.ok(sdf(p, 1.2, 1.2) > 0 && sdf(p, -1.2, 0) > 0 && sdf(p, 0, 1.22) > 0, `${k.hull}:${k.role} reaches the edge`);
  }
});

test('the atlas has one tile per kind and carries an edge in each', () => {
  const { data, width, height } = buildAtlas();
  assert.equal(width, ATLAS_COLS * TILE);
  assert.equal(height, ATLAS_ROWS * TILE);
  for (let r = 0; r < ATLAS_ROWS; r++) {
    for (let c = 0; c < ATLAS_COLS; c++) {
      let inside = 0;
      for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) if (data[(r * TILE + j) * width + c * TILE + i]! > 127) inside++;
      assert.ok(inside > 40 && inside < TILE * TILE * 0.5, `tile ${r},${c}: ${inside}`);
    }
  }
});

test('marks come in class order, so size says the class too', () => {
  const ink = (h: HullClass) => coverage(glyph(h, 'plain'), 44).reduce((s, v) => s + v, 0) * MARK_LENGTH[h] ** 2;
  assert.ok(ink('scout') < ink('cruiser') && ink('cruiser') < ink('capital'));
});

test('the crossfade has no jump, and something is always on the screen', () => {
  for (const m of [11, 15, 22]) {
    let lastMesh = 0, lastMark = 1;
    for (let s = 0.5; s < m * 4; s += 0.05) {
      const mesh = meshFade(s, m), mark = markFade(s, m);
      assert.ok(mesh >= lastMesh - 1e-9, 'mesh only comes in');
      assert.ok(mark <= lastMark + 1e-9, 'mark only goes out');
      assert.ok(Math.abs(mesh - lastMesh) < 0.04 && Math.abs(mark - lastMark) < 0.04, `step at ${s}`);
      assert.ok(mesh + mark >= 0.99, `gap at ${s}: ${mesh} + ${mark}`);
      lastMesh = mesh;
      lastMark = mark;
    }
    assert.equal(meshFade(m * MESH_FROM, m), 0);
    assert.equal(meshFade(m * MESH_TO, m), 1);
    assert.equal(markFade(m * MARK_FROM, m), 1);
    assert.equal(markFade(m * MARK_TO, m), 0);
  }
});

test('the state stays on the screen across the handover: the hull is all state while the mark leaves', () => {
  assert.ok(MARK_FROM >= MESH_FROM && MARK_TO > MESH_TO, 'the hull arrives before the mark goes');
  for (const m of [15, 22]) assert.equal(stateBody(m * MARK_TO), 1);
  assert.equal(stateBody(1000), 0);
});

test('a free camera turns a mark, and foreshortens it, and a nose-on ship keeps its heading', () => {
  const out = { heading: 0, squash: 0 };
  assert.ok(Math.abs(markPose(1, 0, 0, 9, out).heading) < 1e-9);
  assert.equal(out.squash, 1);
  assert.ok(Math.abs(markPose(0, 1, 0, 9, out).heading - Math.PI / 2) < 1e-9);
  markPose(0.001, 0.001, 1, 1.25, out);
  assert.equal(out.heading, 1.25);
  assert.ok(out.squash >= 0.66 && out.squash < 0.7, 'still a shape');
  markPose(0.4, 0, 0.9, 0, out);
  assert.ok(out.squash > 0.66 && out.squash < 1);
});

test('screen length follows the lens', () => {
  assert.equal(screenLength(2, 10, 500), 100);
  assert.equal(screenLength(2, -1, 500), 0);
  assert.equal(smoothstep(0, 1, 0.5), 0.5);
});

test('the state light backs off as the hull itself takes over', () => {
  assert.ok(stateBody(40) > stateBody(150) && stateBody(150) > stateBody(250));
  assert.ok(stateBody(130) > 0.5, 'at World zoom it still does most of the work');
  assert.equal(stateBody(400), 0);
  assert.equal(shadowStrength(100), 0);
  assert.equal(shadowStrength(1000), 1);
});

test('expensive things arrive in order, and only at a size that can show them', () => {
  assert.equal(surfaceDetail(60), 0);
  assert.equal(surfaceDetail(NEAR_FROM), 1);
  assert.ok(SHADOW_FROM >= NEAR_FROM, 'only the near level casts');
});

test('shadow tiles stay inside the atlas and never overlap', () => {
  const t = { x: 0, y: 0, size: 0 };
  shadowTile(0, 1, t);
  assert.deepEqual(t, { x: 0, y: 0, size: 1 });
  const seen = new Set<string>();
  for (let r = 0; r < 4; r++) {
    shadowTile(r, 4, t);
    assert.ok(t.x + t.size <= 1 && t.y + t.size <= 1);
    seen.add(`${t.x},${t.y}`);
  }
  assert.equal(seen.size, 4);
});

test('a crashed hull parts into five, and only as far as it has gone', () => {
  const s = { dx: 0, dy: 0, dz: 0, ax: 0, ay: 0, az: 0, angle: 0 };
  assert.equal(SHARDS, 5);
  shardOf(2, 0.5, 0, s);
  assert.deepEqual([s.dx, Math.abs(s.dy), Math.abs(s.dz), s.angle], [0, 0, 0, 0]);
  shardOf(4, 0.9, 1, s);
  assert.ok(Math.hypot(s.dx, s.dy, s.dz) > 0.05 && Math.hypot(s.dx, s.dy, s.dz) < 0.5);
  assert.ok(Math.abs(Math.hypot(s.ax, s.ay, s.az) - 1) < 1e-9);
});

test('the kit: winding follows the normal, even through a mirror', () => {
  for (const flip of [1, -1]) {
    const f = new Forge(1, true);
    f.at(scaled(1, 1, flip), () => {
      f.use(MAT.WHITE, 2).box([1, 2, 3], [4, 2, 2]);
      f.cyl([0, 0, 0], [3, 1, 1], 1, 0.5, 12);
      f.loft([{ x: 0, hw: 1, hh: 1 }, { x: 2, hw: 2, hh: 1 }], octagon());
      f.tube([[0, 0, 0], [1, 0, 0], [2, 1, 0]], 0.2);
    });
    checkMesh(f.build());
  }
});

test('frames compose left to right, and a station interpolates', () => {
  const f = new Forge(1, true);
  f.at(mul(move(5, 0, 0), turnZ(Math.PI / 2)), () => {
    const p = f.point([1, 0, 0]);
    assert.ok(Math.abs(p[0] - 5) < 1e-9 && Math.abs(p[1] - 1) < 1e-9);
  });
  const s = stationAt([{ x: 0, hw: 1, hh: 2 }, { x: 4, hw: 3, hh: 2 }], 1);
  assert.equal(s.hw, 1.5);
});

function checkMesh(m: ReturnType<Forge['build']>): void {
  const count = m.position.length / 3;
  assert.equal(m.normal.length, m.position.length);
  assert.equal(m.uv.length / 2, count);
  assert.equal(m.meta.length / 4, count);
  assert.equal(m.edge.length / 4, count);
  for (const v of m.position) assert.ok(Number.isFinite(v));
  for (const v of m.uv) assert.ok(Number.isFinite(v));
  let agree = 0, faces = 0;
  for (let t = 0; t < m.index.length; t += 3) {
    const [a, b, c] = [m.index[t]!, m.index[t + 1]!, m.index[t + 2]!];
    assert.ok(a < count && b < count && c < count);
    const P = (i: number) => [m.position[i * 3]!, m.position[i * 3 + 1]!, m.position[i * 3 + 2]!] as const;
    const pa = P(a), pb = P(b), pc = P(c);
    const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const g = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    const area = Math.hypot(g[0]!, g[1]!, g[2]!);
    if (area < 1e-9) continue;
    const n = [m.normal[a * 3]!, m.normal[a * 3 + 1]!, m.normal[a * 3 + 2]!];
    faces++;
    if (g[0]! * n[0]! + g[1]! * n[1]! + g[2]! * n[2]! > 0) agree++;
  }
  assert.ok(agree / Math.max(1, faces) > 0.995, `winding ${agree} of ${faces}`);
}

test('every part builds clean at both levels', () => {
  for (const id of PART_IDS) {
    const p = part(id);
    checkMesh(p.near);
    checkMesh(p.far);
    checkMesh(p.speck);
    assert.ok(p.near.triangles > 0 && p.far.triangles > 0 && p.speck.triangles > 0, id);
    assert.ok(p.speck.triangles <= p.far.triangles * 0.95, `${id}: speck ${p.speck.triangles} of ${p.far.triangles}`);
    assert.ok(p.far.triangles <= p.near.triangles * 0.6, `${id}: ${p.far.triangles} of ${p.near.triangles}`);
    assert.ok(p.near.triangles < 60_000, `${id}: ${p.near.triangles}`);
    assert.ok(p.far.triangles < 9_000, `${id}: ${p.far.triangles}`);
    assert.ok(p.speck.triangles < 2_400, `${id}: speck ${p.speck.triangles}`);
  }
});

test('the far level keeps the silhouette: same reach on every axis, wire antennas apart', () => {
  for (const id of PART_IDS) {
    const { near, far, speck } = part(id);
    const span = Math.max(near.max[0] - near.min[0], near.max[1] - near.min[1], near.max[2] - near.min[2]);
    for (let i = 0; i < 3; i++) {
      assert.ok(Math.abs(near.min[i]! - far.min[i]!) < span * 0.1, `${id} axis ${i} min`);
      assert.ok(Math.abs(near.max[i]! - far.max[i]!) < span * 0.1, `${id} axis ${i} max`);
      assert.ok(Math.abs(near.min[i]! - speck.min[i]!) < span * 0.1, `${id} speck axis ${i} min`);
      assert.ok(Math.abs(near.max[i]! - speck.max[i]!) < span * 0.1, `${id} speck axis ${i} max`);
    }
  }
});

test('no module floats: each mount lands on its hull', () => {
  for (const hull of HULLS) {
    for (const role of ROLES) {
      if (role === 'plain' || role === 'drone') continue;
      const a = assembly(hull, role);
      const body = part(a.mounts[0]!.part).near;
      const mount = a.mounts[1]!;
      for (let i = 0; i < 3; i++) {
        const slack = (body.max[0] - body.min[0]) * 0.05;
        assert.ok(mount.at[i]! >= body.min[i]! - slack && mount.at[i]! <= body.max[i]! + slack, `${hull}:${role} axis ${i}`);
      }
    }
  }
});

test('a plume can attach: every hull has a nozzle, pointing aft', () => {
  for (const id of ['capital', 'cruiser', 'scout', 'longrange', 'plain', 'drone'] as const) {
    const p = part(id);
    assert.ok(p.nozzles.length > 0, id);
    for (const n of p.nozzles) {
      assert.ok(n.dir[0] < -0.9, `${id} points aft`);
      assert.ok(n.r > 0);
    }
  }
});

test('a plume knows where to start, on every hull', () => {
  for (const hull of HULLS) {
    for (const role of ROLES) {
      const { aft, width } = plumeAnchor(hull, role);
      assert.ok(aft > 0.2 && aft < 0.75, `${hull}:${role} aft ${aft}`);
      assert.ok(width > 0.02 && width < 1.2, `${hull}:${role} width ${width}`);
    }
  }
});

test('a ship flies nose first with its back to what it orbits', () => {
  const tangent = new THREE.Vector3(0, 0, 1);
  const outward = new THREE.Vector3(1, 0, 0);
  const q = shipFrame(tangent, outward, 0, 0, new THREE.Quaternion());
  const near = (a: THREE.Vector3, b: THREE.Vector3) => assert.ok(a.distanceTo(b) < 1e-6, `${a.toArray()} against ${b.toArray()}`);
  near(new THREE.Vector3(1, 0, 0).applyQuaternion(q), tangent);
  near(new THREE.Vector3(0, 1, 0).applyQuaternion(q), outward);
  const back = shipFrame(tangent, outward, Math.PI, 0, new THREE.Quaternion());
  near(new THREE.Vector3(1, 0, 0).applyQuaternion(back), tangent.clone().negate());
  near(new THREE.Vector3(0, 1, 0).applyQuaternion(back), outward);
  const slanted = shipFrame(new THREE.Vector3(0, 0.3, 0.95).normalize(), outward, 0, 0, new THREE.Quaternion());
  assert.ok(Math.abs(slanted.length() - 1) < 1e-9);
  const dead = shipFrame(tangent, outward, 0, 1.2, new THREE.Quaternion());
  assert.ok(new THREE.Vector3(1, 0, 0).applyQuaternion(dead).distanceTo(tangent) > 0.1, 'a tumble turns it');
});

test('every hull carries a status section, and it lies on the hull', () => {
  for (const id of ['capital', 'cruiser', 'scout', 'longrange', 'plain', 'drone'] as const) {
    const { near, belts } = part(id);
    assert.ok(belts.length >= 1 && belts.length <= 3, id);
    for (const b of belts) {
      assert.ok(b.at - b.half > near.min[0] && b.at + b.half < near.max[0], `${id} at ${b.at}`);
      assert.ok(b.half > 0 && b.spill > 0, id);
      let cut = 0;
      for (let t = 0; t < near.index.length; t += 3) {
        const xs = [near.index[t]!, near.index[t + 1]!, near.index[t + 2]!].map((i) => near.position[i * 3]!);
        if (Math.min(...xs) <= b.at && Math.max(...xs) >= b.at) cut++;
      }
      assert.ok(cut > 0, `${id} has nothing at ${b.at}`);
    }
  }
});

test('faces know their rim: a plate has a bevel, and a curved skin does not', () => {
  const f = new Forge(1, true);
  f.use(MAT.WHITE, 2).box([0, 0, 0], [4, 2, 1]);
  const box = f.build();
  for (let i = 0; i < box.meta.length; i += 4) assert.ok(box.meta[i + 3]! > 0);
  let max = 0;
  for (let i = 0; i < box.edge.length; i += 4) {
    assert.ok(Math.abs(box.edge[i]!) <= box.edge[i + 2]! + 1e-6 && Math.abs(box.edge[i + 1]!) <= box.edge[i + 3]! + 1e-6);
    max = Math.max(max, box.edge[i + 2]!, box.edge[i + 3]!);
  }
  assert.equal(max, 2);
  const g = new Forge(1, true);
  g.use(MAT.WHITE, 2).lathe([[0, 1], [2, 1]], 12);
  const round = g.build();
  for (let i = 0; i < round.meta.length; i += 4) assert.equal(round.meta[i + 3], 0);
});

test('a round thing never shows its corners on the level that draws it', () => {
  assert.equal(roundSegments(0), 6);
  assert.ok(roundSegments(10) >= 12 && roundSegments(10) < 25);
  assert.ok(roundSegments(80) > roundSegments(20));
  const chord = (n: number, r: number): number => r * (1 - Math.cos(Math.PI / n));
  for (const r of [3, 12, 40, 90]) assert.ok(chord(roundSegments(r), r) <= 0.3 + 1e-9, `${r}`);
  // The bow shield of the long range ship is all you see of it head on.
  const count = (m: { position: Float32Array; meta: Uint8Array }): number => {
    const seen = new Set<string>();
    for (let i = 0; i < m.position.length; i += 3) {
      if (m.meta[(i / 3) * 4] !== MAT.GRAPHITE || m.position[i]! < 69 || Math.hypot(m.position[i + 1]!, m.position[i + 2]!) < 18) continue;
      seen.add(`${m.position[i + 1]!.toFixed(2)},${m.position[i + 2]!.toFixed(2)}`);
    }
    return seen.size;
  };
  const { far, speck } = part('longrange');
  assert.ok(count(far) >= 20, `far ${count(far)}`);
  assert.ok(count(speck) >= 12, `speck ${count(speck)}`);
});

test('an engine is hollow: the floor of the nozzle stands aft of the plate it is mounted on, and faces out', () => {
  const f = new Forge(1, true);
  f.bell(1, 2, 12);
  const m = f.build();
  let floor = -Infinity;
  for (let i = 0; i < m.position.length / 3; i++) if (m.meta[i * 4] === MAT.THROAT) floor = Math.max(floor, m.position[i * 3]!);
  assert.ok(floor < 0, `floor at ${floor}`);
  for (let t = 0; t < m.index.length; t += 3) {
    const a = m.index[t]!;
    if (m.meta[a * 4] !== MAT.THROAT) continue;
    assert.ok(m.normal[a * 3]! < 0, 'the inside looks aft');
  }
});

test('assembly is cached, bounded, and knows when its parts are in', () => {
  const a = assembly('capital', 'command');
  assert.equal(a, assembly('capital', 'command'));
  assert.ok(a.mounts.some((m) => m.spin));
  assert.ok(a.radius > a.length / 2 * 0.9);
  assert.ok(assemblyReady('capital', 'command'));
  assert.equal(assembly('scout', 'drone').mounts.length, 1);
  assert.equal(assembly('scout', 'plain').mounts.length, 1);
  assert.equal(assembly('cruiser', 'tug').mounts.length, 2);
});

test('baked grain spans its range, tiles, and each channel is its own', () => {
  const size = 16;
  const g = buildGrain(size);
  assert.equal(g.length, size ** 3 * 4);
  const mean = [0, 0, 0, 0];
  let lo = 255, hi = 0;
  for (let i = 0; i < g.length; i++) {
    mean[i % 4]! += g[i]! / (g.length / 4);
    lo = Math.min(lo, g[i]!);
    hi = Math.max(hi, g[i]!);
  }
  for (const m of mean) assert.ok(m > 90 && m < 165, `mean ${m}`);
  assert.ok(hi - lo > 80, 'has contrast');
  // Next to the seam of the tile, a step is no larger than a step anywhere else.
  let seam = 0, inner = 0;
  for (let j = 0; j < size; j++) for (let k = 0; k < size; k++) {
    const at = (x: number) => g[(x + size * (j + size * k)) * 4]!;
    seam = Math.max(seam, Math.abs(at(size - 1) - at(0)));
    inner = Math.max(inner, Math.abs(at(5) - at(6)));
  }
  assert.ok(seam <= inner * 2.5 + 8, `seam ${seam} against ${inner}`);
  let differs = 0;
  for (let i = 0; i < g.length; i += 4) if (Math.abs(g[i]! - g[i + 1]!) > 8) differs++;
  assert.ok(differs > g.length / 16);
});

test('foil facets are flat cells, and the cells wrap', () => {
  const size = 64;
  const c = buildCrumple(size, 9);
  const tones = new Set<number>();
  let same = 0;
  for (let i = 0; i < size * size; i++) {
    tones.add(c[i * 4]!);
    if (i % size < size - 1 && c[i * 4] === c[(i + 1) * 4]) same++;
  }
  assert.ok(tones.size >= 40 && tones.size <= 81, `${tones.size} cells`);
  assert.ok(same / (size * size) > 0.6, 'mostly flat');
});

test('the field is solid inside and clear outside', () => {
  const f = new Forge(1, true);
  f.use(MAT.WHITE, 2).box([0, 0, 0], [10, 10, 10], 0);
  const field = buildField(f.build(), 48);
  const at = (x: number, y: number, z: number, ch: number): number => {
    const ix = Math.floor((x - field.min[0]) / field.cell);
    const iy = Math.floor((y - field.min[1]) / field.cell);
    const iz = Math.floor((z - field.min[2]) / field.cell);
    return field.data[(ix + field.nx * (iy + field.ny * iz)) * 2 + ch]!;
  };
  assert.ok(at(0, 0, 0, 0) > 200, 'fine, inside');
  assert.ok(at(0, 0, 0, 1) > 200, 'coarse, inside');
  assert.ok(at(-5.6, -5.6, -5.6, 0) < 40, 'outside');
});
