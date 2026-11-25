import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  B_MAX, BC, bOfRow, buildCameraTable, buildOrbitTables, CAMERA_TEXELS, impact, lensFade, orbitU, ORBIT_ROWS, psiAtCamera, rowLength, rowOf, shadowAngle, traceStart,
} from '../../src/scene/hole/geodesic.ts';

const tables = buildOrbitTables();

/** Ground truth: u'' = 3u^2 - u by RK4, from the camera, stopping when the ray escapes or falls in. */
function march(rc: number, alpha: number, step = 2e-4, maxPhi = 40) {
  let u = 1 / rc;
  // du/dphi at the start, from the angle the camera measures.
  let v = (u * Math.sqrt(1 - 2 * u) * Math.cos(alpha)) / Math.sin(alpha);
  let phi = 0;
  const acc = (x: number) => 3 * x * x - x;
  const out: { phi: number; u: number }[] = [{ phi, u }];
  while (phi < maxPhi) {
    const k1u = v; const k1v = acc(u);
    const k2u = v + 0.5 * step * k1v; const k2v = acc(u + 0.5 * step * k1u);
    const k3u = v + 0.5 * step * k2v; const k3v = acc(u + 0.5 * step * k2u);
    const k4u = v + step * k3v; const k4v = acc(u + step * k3u);
    u += (step / 6) * (k1u + 2 * k2u + 2 * k3u + k4u);
    v += (step / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
    phi += step;
    out.push({ phi, u });
    if (u <= 0 || u >= 0.5) return { path: out, end: phi, captured: u >= 0.5 };
  }
  return { path: out, end: phi, captured: u >= 0.5 };
}

const at = (path: { phi: number; u: number }[], phi: number, step = 2e-4) => path[Math.min(path.length - 1, Math.round(phi / step))]!.u;

test('rows run from a radial ray through the shadow edge to B_MAX, and rowOf inverts bOfRow', () => {
  assert.ok(bOfRow(0) < 0.01);
  assert.ok(bOfRow(ORBIT_ROWS / 2 - 1) < BC);
  assert.ok(bOfRow(ORBIT_ROWS / 2) > BC);
  assert.ok(Math.abs(bOfRow(ORBIT_ROWS - 1) - B_MAX) < 1e-6);
  for (const row of [10, 200, 511, 512, 700, 1000]) assert.ok(Math.abs(rowOf(bOfRow(row)) - row) < 1e-6, `row ${row}`);
});

test('a row ends at the turning point of the known cubic, or at the horizon', () => {
  for (const b of [6, 8, 20, 90]) {
    const row = Math.round(rowOf(b));
    const end = tables.u[(row + 1) * 512 - 1]!;
    const f = 1 / (bOfRow(row) ** 2) - end * end + 2 * end ** 3;
    assert.ok(Math.abs(f) < 1e-5, `b ${b}: f(u_t) = ${f}`);
  }
  assert.ok(Math.abs(tables.u[100 * 512 - 1]! - 0.5) < 1e-6);
});

test('the deflection matches the strong and weak field limits', () => {
  // Weak field: 4/b + 15 pi / 4 b^2 + ...
  const b = 80;
  const deflection = 2 * rowLength(tables, b) - Math.PI;
  assert.ok(Math.abs(deflection - (4 / b + (15 * Math.PI) / 4 / (b * b) + 128 / 3 / b ** 3)) < 1e-5, `weak ${deflection}`);
  // Strong field, Bozza 2002: -ln(b / bc - 1) + ln(216 (7 - 4 sqrt 3)) - pi.
  for (const e of [1e-5, 1e-4, 1e-3]) {
    const d = 2 * rowLength(tables, BC * (1 + e)) - Math.PI;
    const want = -Math.log(e) + Math.log(216 * (7 - 4 * Math.sqrt(3))) - Math.PI;
    assert.ok(Math.abs(d - want) < 3 * Math.sqrt(e) + 1e-4, `e ${e}: ${d} against ${want}`);
  }
});

test('table lookups agree with a direct integration of the ray, for every kind of ray', () => {
  let worst = 0;
  for (const rc of [4, 6, 10, 30, 100, 400]) {
    const camera = buildCameraTable(rc, new Float32Array(CAMERA_TEXELS));
    const shadow = shadowAngle(rc);
    const alphas = [0.3, 0.7, 0.95, 0.995, 1.005, 1.05, 1.5, 2.5].map((k) => k * shadow).filter((a) => a < Math.PI * 0.98);
    alphas.push(1.2, 1.5707, 1.8, 2.6);
    for (const alpha of alphas) {
      const truth = march(rc, alpha, 2e-4);
      const trace = traceStart(tables, camera, rc, alpha);
      assert.equal(trace.captured, truth.captured, `rc ${rc} alpha ${alpha}`);
      assert.ok(Math.abs(trace.sweep - truth.end) < 2e-3 + 1e-3 * truth.end, `rc ${rc} alpha ${alpha}: sweep ${trace.sweep} against ${truth.end}`);
      for (const f of [0.1, 0.35, 0.6, 0.85, 0.97]) {
        const phi = f * truth.end;
        const u = at(truth.path, phi);
        if (u < 1 / 70) continue;            // the disk ends inside this
        const got = orbitU(tables, trace.b, trace.start + phi);
        const dr = Math.abs(1 / got - 1 / u);
        worst = Math.max(worst, dr / (1 / u));
        assert.ok(dr < 0.02 + 0.002 / u, `rc ${rc} alpha ${alpha} at ${phi}: r ${1 / got} against ${1 / u}`);
      }
    }
  }
  assert.ok(worst < 0.01, `worst relative radius error ${worst}`);
});

test('the shadow has its true size, and its edge sits where the table says', () => {
  assert.ok(Math.abs(impact(1e7, shadowAngle(1e7)) - BC) < 1e-6);
  for (const rc of [6, 20, 200]) {
    const camera = buildCameraTable(rc, new Float32Array(CAMERA_TEXELS));
    const a = shadowAngle(rc);
    assert.equal(traceStart(tables, camera, rc, a * 0.999).captured, true);
    assert.equal(traceStart(tables, camera, rc, a * 1.001).captured, false);
  }
});

test('the camera table is continuous through the turning point of the ray at 90 degrees', () => {
  const rc = 12;
  const a = psiAtCamera(rc, impact(rc, Math.sin(Math.PI / 2 - 1e-4)));
  assert.ok(Math.abs(a - rowLength(tables, impact(rc, 1))) < 1e-3, `${a}`);
});

test('building the tables is cheap enough', () => {
  const t0 = performance.now();
  buildOrbitTables();
  const orbit = performance.now() - t0;
  const out = new Float32Array(CAMERA_TEXELS);
  const t1 = performance.now();
  for (let i = 0; i < 100; i++) buildCameraTable(20 + i, out);
  const camera = (performance.now() - t1) / 100;
  assert.ok(orbit < 400 && camera < 3, `orbit ${orbit} ms, camera ${camera} ms`);
  console.log(`orbit tables ${orbit.toFixed(1)} ms, camera table ${camera.toFixed(2)} ms`);
});

test('a body stands in full view everywhere but behind the hole', () => {
  assert.equal(lensFade(80, -30, 0, 2), 1, 'in front of the hole');
  assert.equal(lensFade(80, 30, 40, 2), 1, 'far off to the side');
  assert.equal(lensFade(80, 30, 0, 2), 0, 'straight behind');
  // A world at 26 M behind, seen from 80 M: the Einstein radius is about 8.9 M.
  assert.equal(lensFade(80, 26, 5, 2), 0, 'inside the ring');
  let last = 0;
  for (let b = 6; b < 20; b += 0.5) {
    const fade = lensFade(80, 26, b, 2);
    assert.ok(fade >= last, `monotonic at ${b}`);
    last = fade;
  }
  assert.equal(last, 1);
});

test('a body fades in smoothly as it passes the plane of the hole', () => {
  for (const b of [0.5, 2, 4, 8]) assert.ok(Math.abs(lensFade(80, 1e-3, b, 0) - 1) < 1e-6, `at offset ${b}`);
  let last = lensFade(80, 0.01, 3, 0);
  for (let behind = 0.5; behind < 30; behind += 0.5) {
    const fade = lensFade(80, behind, 3, 0);
    assert.ok(Math.abs(fade - last) < 0.8, `no pop at ${behind}`);
    last = fade;
  }
});
