import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crowdDim, crowdWorld, FREE_CRAFT, neverMerges, seatTurn, SOLO_CAP, spreadRing } from '../../src/core/crowd.ts';
import type { CrowdCraft } from '../../src/core/crowd.ts';
import { BEZIER, cssEase, cubicBezier, ease, easePath } from '../../src/core/ease.ts';
import { FlashGate, FLASHES_PER_SECOND } from '../../src/core/flash.ts';
import {
  chaseBack, chasePose, clearOf, flightSpec, flightVia, FOV, pathPoint, poseAt, RepeatMemory, REPEAT_WINDOW_MS, worldDistance,
} from '../../src/core/flight.ts';
import type { Pose, Sphere } from '../../src/core/flight.ts';
import { orbitCss } from '../../src/core/laws.ts';
import { beamVisible, lookOf, orbitsShown, plumeStyle } from '../../src/core/look.ts';
import type { Look } from '../../src/core/look.ts';
import { orbitBasis, orbitOf, UP } from '../../src/core/space.ts';
import type { VisualState } from '../../src/core/state.ts';

const STATES: VisualState[] = [
  'queued', 'spawning', 'starting', 'ready', 'thinking', 'writing', 'generating', 'tool', 'approve', 'answer', 'plan', 'source', 'parked', 'idle', 'idle-shell', 'interrupted',
  'compacting', 'retrying', 'no-signal', 'rate-limited', 'errored', 'no-budget', 'stopping', 'crashed', 'orphaned', 'lost', 'finished', 'exited', 'abandoned', 'failed', 'stopped', 'unknown',
];

test('named easings run from 0 to 1 and follow their curve', () => {
  for (const [name, fn] of Object.entries(ease)) {
    assert.equal(fn(0), 0, name);
    assert.equal(fn(1), 1, name);
    let last = -1;
    for (let x = 0; x <= 1; x += 0.05) {
      const y = fn(x);
      assert.ok(y >= last - 1e-6, `${name} is monotonic at ${x}`);
      last = y;
    }
  }
  // Against the closed form at a point: for x1 = y1 = 0, x2 = y2 = 1 the curve is smoothstep-shaped and hits 0.5 at 0.5.
  assert.ok(Math.abs(cubicBezier([0.42, 0, 0.58, 1])(0.5) - 0.5) < 1e-4);
  assert.ok(ease.settle(0.2) > 0.5, 'settle is fast out of the gate');
  assert.ok(ease.reentry(0.5) < 0.3, 'reentry starts slow and falls late');
});

test('the same numbers reach CSS and CustomEase', () => {
  assert.equal(cssEase('settle'), 'cubic-bezier(0.22, 1, 0.36, 1)');
  assert.equal(cssEase('filament'), 'cubic-bezier(0.1, 0.9, 0.2, 1)');
  assert.equal(easePath('burn'), `M0,0 C${BEZIER.burn[0]},${BEZIER.burn[1]} ${BEZIER.burn[2]},${BEZIER.burn[3]} 1,1`);
});

test('every state has a row, and a row reads with the colour taken away', () => {
  const shapeOf = (l: Look) => JSON.stringify({ ...l, tone: 0, gain: 0 });
  const bySignature = new Map<string, VisualState[]>();
  for (const state of STATES) {
    const key = shapeOf(lookOf(state, true));
    bySignature.set(key, [...(bySignature.get(key) ?? []), state]);
  }
  // Only rows the table itself gives one shape: three decisions told apart by their word, a hull present with no drive, and the endings that hand over to a landing.
  const allowed = new Set(['approve,answer,plan', 'starting,ready,unknown', 'finished,exited,abandoned,failed,stopped', 'tool,compacting']);
  for (const group of bySignature.values()) {
    if (group.length > 1) assert.ok(allowed.has(group.join()), `${group.join()} look the same without colour`);
  }
});

test('section 6: the rows that decide a state', () => {
  assert.equal(lookOf('writing', true).moves, true, 'law 3');
  assert.equal(lookOf('generating', false).moves, false, 'observed: still, then a burn');
  assert.equal(lookOf('tool', true).moves, false);
  assert.equal(lookOf('generating', false).fill, 0, 'observed is an outline');
  assert.equal(lookOf('tool', true).fill, 1, 'owned is filled');
  assert.equal(lookOf('tool', false).fill, 0);
  assert.equal(lookOf('errored', true).tumble > 0, true);
  assert.ok(Math.abs((2 * Math.PI) / lookOf('errored', true).tumble - 6) < 1e-9, '6 s per turn');
  assert.equal(lookOf('retrying', true).tumble, 0, 'retrying never tumbles');
  assert.ok(Math.abs(lookOf('retrying', true).turn - Math.PI / 6) < 1e-9, 'tilted 30 degrees');
  assert.equal(lookOf('stopping', true).turn, Math.PI, 'turned 180 degrees');
  assert.equal(lookOf('source', false).ring, 'broken');
  assert.equal(lookOf('parked', true).ring, 'hollow');
  assert.equal(lookOf('parked', true).holding, true);
  assert.equal(lookOf('lost', true).dashed, true);
  assert.equal(lookOf('orphaned', false).drift, true);
  assert.equal(lookOf('orphaned', false).beacon, false, 'a derelict has no beacon');
  assert.equal(lookOf('idle', false).beacon, true);
  assert.equal(lookOf('idle-shell', false).shellLance, true);
  assert.equal(lookOf('crashed', true).hull, 'shards');
  assert.equal(lookOf('finished', true).hull, 'none');
  assert.equal(lookOf('queued', true).pad, true);
  assert.equal(lookOf('spawning', true).transfer, true);
  assert.equal(lookOf('no-budget', true).ring, 'fuel');
  assert.equal(lookOf('no-budget', true).tumble, 0, 'no tumble');
});

test('2.4: the two highest base rates stay off the System view', () => {
  assert.equal(beamVisible('shell', 'system'), false);
  assert.equal(beamVisible('read', 'system'), false);
  assert.equal(beamVisible('edit', 'system'), true);
  assert.equal(beamVisible('send', 'system'), true);
  assert.equal(beamVisible('shell', 'world'), true);
  assert.equal(beamVisible('web', 'craft'), true);
  assert.equal(beamVisible('ask', 'craft'), false, 'no beam: a well');
  assert.equal(orbitsShown('system', false, true), false);
  assert.equal(orbitsShown('system', true, false), true);
  assert.equal(orbitsShown('world', false, true), true);
  assert.equal(orbitsShown('world', false, false), false);
  assert.equal(orbitsShown('craft', false, true), false);
});

test('plumes follow the 6.1 rows', () => {
  assert.equal(plumeStyle('writing', 0, 0, false).length, 30, 'a generating craft is never below 30');
  assert.ok(Math.abs(plumeStyle('writing', 396, 0, false).length - 67) < 1);
  assert.equal(plumeStyle('writing', 100, 0, false).width, 4.6);
  assert.equal(plumeStyle('thinking', 100, 0, false).width, 3.4);
  const lengths = Array.from({ length: 40 }, (_, i) => plumeStyle('thinking', 100, i * 0.05, false).length);
  const full = plumeStyle('writing', 100, 0, false).length;
  assert.ok(Math.max(...lengths) <= full + 1e-6 && Math.min(...lengths) >= full * 0.7 - 1e-6, 'pulses 70 to 100 %');
  assert.equal(plumeStyle('thinking', 100, 0.3, true).length, full, 'reduced motion holds the length');
  const observed = plumeStyle('observed', 900, 0, false);
  assert.deepEqual([observed.length, observed.dashes, observed.flow], [30, 9, 1.5]);
  assert.equal(plumeStyle('observed', 0, 0, true).flow, 0, 'static under reduced motion');
  const flicks = new Set(Array.from({ length: 8 }, (_, i) => plumeStyle('flicker', 0, i * 0.25, false).gain));
  assert.equal(flicks.size, 2, 'stepped, 2 Hz');
});

const craft = (id: string, over: Partial<CrowdCraft> = {}): CrowdCraft => ({ id, altitude: 0.5, state: 'writing', tier: 6, tps: 100, selected: false, ...over });
const radiusAt = (alt: number): number => orbitCss(40, alt, 1);
const span = Math.min(66, Math.max(34, 1.3 * 40));

test('a world with few craft keeps every exact altitude', () => {
  const c = crowdWorld(Array.from({ length: FREE_CRAFT }, (_, i) => craft(`c${i}`)), span, radiusAt, 1);
  assert.equal(c.lanes.length, 0);
  assert.equal(c.laneOf.size, 0);
});

test('a crowded world gathers into lanes, low altitude to low lanes, and caps its solo hulls', () => {
  const list = Array.from({ length: 40 }, (_, i) => craft(`c${String(i).padStart(2, '0')}`, { altitude: (i * 7 % 40) / 40, tps: i }));
  const c = crowdWorld(list, span, radiusAt, 1);
  assert.ok(c.lanes.length >= 2 && c.lanes.length <= 5);
  for (let i = 1; i < c.lanes.length; i++) assert.ok(c.lanes[i]!.radius > c.lanes[i - 1]!.radius, 'law 2 survives');
  for (const row of list) {
    const lane = c.laneOf.get(row.id)!;
    assert.equal(lane, Math.min(c.lanes.length - 1, Math.floor(row.altitude * c.lanes.length)));
  }
  assert.ok(list.length - c.shoaled.size <= SOLO_CAP, 'past 24 they merge');
  assert.ok(c.shoaled.size >= 16);
  assert.equal(c.lanes.reduce((a, l) => a + l.shoal, 0), c.shoaled.size);
});

test('waiting and failed craft never merge, and neither does the selected one, however full the world', () => {
  const quiet = Array.from({ length: 60 }, (_, i) => craft(`q${i}`, { altitude: 0.5 }));
  const loud = (['approve', 'source', 'errored', 'crashed', 'retrying', 'no-budget'] as VisualState[]).map((state, i) => craft(`z${i}`, { state, altitude: 0.5, tier: 3 }));
  const chosen = craft('chosen', { altitude: 0.5, selected: true, tier: 6, tps: 0 });
  const c = crowdWorld([...quiet, ...loud, chosen], span, radiusAt, 1);
  for (const row of loud) assert.equal(c.shoaled.has(row.id), false, row.state);
  assert.equal(c.shoaled.has('chosen'), false);
  assert.ok(neverMerges('source') && !neverMerges('writing'));
});

test('a small world holds fewer lanes than a large one', () => {
  const list = Array.from({ length: 12 }, (_, i) => craft(`c${i}`));
  const small = crowdWorld(list, 34, (a) => orbitCss(10, a, 1), 1);
  const large = crowdWorld(list, 66, radiusAt, 1);
  assert.ok(small.lanes.length < large.lanes.length);
});

test('spreadRing leaves no two closer than the gap, moves nothing it need not, and is stable', () => {
  const gap = 0.3;
  const angles = [0.1, 0.12, 0.13, 2, 2.05, 5];
  const moved = spreadRing(angles, gap);
  const out = angles.map((a, i) => (a + moved[i]! + Math.PI * 4) % (Math.PI * 2)).sort((a, b) => a - b);
  for (let i = 0; i < out.length; i++) {
    const d = i === 0 ? out[0]! + Math.PI * 2 - out[out.length - 1]! : out[i]! - out[i - 1]!;
    assert.ok(d >= gap - 1e-3, `gap ${d}`);
  }
  assert.ok(Math.abs(moved[5]!) < 1e-9, 'a craft with room stays');
  assert.deepEqual(spreadRing(angles, gap), moved);
  assert.deepEqual(spreadRing([1], gap), [0]);
  // More craft than fit: an even ring, not a pile.
  const full = spreadRing(Array.from({ length: 30 }, () => 1), 0.5).map((d) => 1 + d);
  assert.ok(new Set(full.map((a) => a.toFixed(3))).size === 30);
});

test('a crowd shortens plumes but never takes them to nothing', () => {
  assert.deepEqual(crowdDim(5), { plume: 1, gain: 1, wake: true });
  const packed = crowdDim(24);
  assert.ok(packed.plume < 1 && packed.plume > 0.5 && packed.gain > 0.5 && !packed.wake);
  assert.equal(crowdDim(24).plume, crowdDim(120).plume);
});

test('no second of any burst holds three bright flashes', () => {
  const gate = new FlashGate();
  const fired: number[] = [];
  const asks = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 500, 510, 900, 2000, 2001, 2002, 5000];
  for (const t of asks) fired.push(gate.book(t));
  fired.sort((a, b) => a - b);
  for (let i = FLASHES_PER_SECOND; i < fired.length; i++) assert.ok(fired[i]! - fired[i - FLASHES_PER_SECOND]! > 1000, `window at ${i}: ${fired.join()}`);
  assert.ok(FLASHES_PER_SECOND < 3);
  assert.equal(fired[0], 0, 'the first one is not delayed');
});

test('an effect that means nothing late is dropped, and leaves the gate as it was', () => {
  const gate = new FlashGate();
  assert.equal(gate.tryNow(0), true);
  assert.equal(gate.tryNow(10), true);
  assert.equal(gate.tryNow(20), false);
  assert.equal(gate.tryNow(1011), true);
  gate.clear();
  assert.equal(gate.tryNow(1012), true);
});

test('9.3: the flight table', () => {
  const sys = { level: 'system', worldId: null } as const;
  const w1 = { level: 'world', worldId: 'a' } as const;
  const w2 = { level: 'world', worldId: 'b' } as const;
  const c1 = { level: 'craft', worldId: 'a' } as const;
  assert.deepEqual([flightSpec(sys, w1).ms, flightSpec(sys, w1).ease], [1000, 'slingshot']);
  assert.equal(flightSpec(w1, c1).ms, 800);
  assert.equal(flightSpec(c1, w1).ms, 700);
  assert.equal(flightSpec(w1, sys).ms, 700);
  assert.equal(flightSpec(w1, w2).ms, 1100);
  assert.equal(flightSpec(w1, w2).star, true, 'swing past the star');
  assert.equal(flightSpec(sys, w1).star, false);
});

test('a move repeated within 60 s plays at under a third', () => {
  const r = new RepeatMemory();
  assert.equal(r.scale('a', 0), 1);
  assert.ok(r.scale('a', 1000) < 1 / 3);
  assert.equal(r.scale('b', 1000), 1, 'another move is not a repeat');
  assert.equal(r.scale('a', 1000 + REPEAT_WINDOW_MS + 1), 1);
});

test('a path passes through its ends, and its mirrored ends leave no kink', () => {
  const a = [0, 100, 300];
  const m = [50, 80, 200];
  const b = [200, 40, 10];
  assert.deepEqual(pathPoint(a, m, b, 0), [0, 100, 300]);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(pathPoint(a, m, b, 1)[i]! - b[i]!) < 1e-9);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(pathPoint(a, m, b, 0.5)[i]! - m[i]!) < 1e-9);
  const eps = 1e-4;
  const before = pathPoint(a, m, b, 0.5 - eps);
  const after = pathPoint(a, m, b, 0.5 + eps);
  assert.ok(Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]) < 1, 'smooth through the middle');
});

test('paths curve around bodies and never pass through a world', () => {
  const worlds: Sphere[] = [{ c: [0, 0, 0], r: 60 }, { c: [200, 0, 40], r: 46 }, { c: [-180, 0, -60], r: 30 }, { c: [40, 0, 240], r: 20 }];
  const from = [-400, 300, 500];
  for (const to of [[400, 120, 500], [200, 90, 300], [-180, 40, -20], [0, 300, -400]]) {
    for (const swing of [false, true]) {
      const via = flightVia(from, to, worlds, swing);
      assert.ok(clearOf(from, via, to, worlds), `${to} swing ${swing}`);
    }
  }
});

test('the camera never rolls: a pose holds no up, and a sample interpolates only place, aim and lens', () => {
  const from: Pose = { position: [0, 0, 100], target: [0, 0, 0], fov: 20 };
  const to: Pose = { position: [100, 0, 0], target: [50, 0, 0], fov: 34 };
  const out: Pose = { position: [0, 0, 0], target: [0, 0, 0], fov: 0 };
  poseAt(from, [60, 20, 60], to, 0.5, out);
  assert.deepEqual(Object.keys(out).sort(), ['fov', 'position', 'target']);
  assert.equal(out.fov, 27);
});

test('a flight turns toward its goal from any start, a camera facing the other way included', () => {
  const goal = [300, 40, 0];
  for (const look of [[0, 0, -1], [0, 0, 1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]]) {
    const from: Pose = { position: [-200, 50, 400], target: [-200 + look[0]! * 100, 50 + look[1]! * 100, 400 + look[2]! * 100], fov: 34 };
    const to: Pose = { position: [400, 80, 100], target: [goal[0]!, goal[1]!, goal[2]!], fov: 30 };
    const via = flightVia(from.position, to.position, [], false);
    const out: Pose = { position: [0, 0, 0], target: [0, 0, 0], fov: 0 };
    for (let k = 0; k <= 1.0001; k += 0.05) {
      poseAt(from, via, to, k, out);
      const d = [out.target[0] - out.position[0], out.target[1] - out.position[1], out.target[2] - out.position[2]];
      assert.ok(Math.hypot(d[0]!, d[1]!, d[2]!) > 1, 'the aim never passes through the camera');
      if (k > 0.66) {
        const g = [goal[0]! - out.position[0], goal[1]! - out.position[1], goal[2]! - out.position[2]];
        const c = (d[0]! * g[0]! + d[1]! * g[1]! + d[2]! * g[2]!) / (Math.hypot(d[0]!, d[1]!, d[2]!) * Math.hypot(g[0]!, g[1]!, g[2]!));
        assert.ok(c > 0.999, `on the goal for the last third of the way, ${c} at ${k}`);
      }
    }
  }
});

test('a flight from under the disk stays under it, and still clears the hole', () => {
  const hole: Sphere[] = [{ c: [0, 0, 0], r: 72 }];
  const from = [-400, -300, 200];
  const to = [420, -60, 100];
  const via = flightVia(from, to, hole, true);
  assert.ok(via[1] < 0);
  assert.ok(clearOf(from, via, to, hole));
});

test('World view: the outermost orbit spans 0.8 of the short side', () => {
  const free = { w: 748, h: 720 };
  const r = 120;
  const d = worldDistance(r, free);
  const pxPerUnit = free.h / 2 / (d * Math.tan((FOV.world * Math.PI) / 360));
  assert.ok(Math.abs(2 * r * pxPerUnit - 0.8 * 720) < 1e-6);
});

test('the chase frames the limb under the hull at every point of an inclined orbit, with no roll', () => {
  const out: Pose = { position: [0, 0, 0], target: [0, 0, 0], fov: 0 };
  const half = (FOV.craft * Math.PI) / 360;
  for (const [R, r] of [[60, 90], [60, 150], [46, 75], [46, 125], [20, 55]] as const) {
    for (let th = 0; th < Math.PI * 2; th += 0.4) {
      const incl = 0.5;
      const outward = { x: Math.cos(th), y: Math.sin(th) * Math.sin(incl), z: Math.sin(th) * Math.cos(incl) };
      const tangent = { x: -Math.sin(th), y: Math.cos(th) * Math.sin(incl), z: Math.cos(th) * Math.cos(incl) };
      const hull = { x: outward.x * r, y: outward.y * r, z: outward.z * r };
      const c = [40, -3, 120];
      const h = { x: hull.x + c[0]!, y: hull.y + c[1]!, z: hull.z + c[2]! };
      chasePose(h, tangent, outward, { c: [c[0]!, c[1]!, c[2]!], r: R }, out);
      assert.equal(out.fov, FOV.craft);
      const [px, py, pz] = out.position;
      assert.ok(Math.hypot(px - c[0]!, py - c[1]!, pz - c[2]!) > R * 1.05, 'the camera is outside the world');
      const up = px * UP[0] + py * UP[1] + pz * UP[2] - (h.x * UP[0] + h.y * UP[1] + h.z * UP[2]);
      assert.ok(up > 0, 'behind and above');
      // Read the frame through the same basis the rig writes.
      const o = orbitOf(out.position, out.target);
      const { right, up: screenUp, back } = orbitBasis(o.az, o.el);
      const see = (p: readonly number[]): [number, number, number] => {
        const v = [p[0]! - px, p[1]! - py, p[2]! - pz];
        const depth = -(v[0]! * back[0] + v[1]! * back[1] + v[2]! * back[2]);
        return [(v[0]! * right[0] + v[1]! * right[1] + v[2]! * right[2]) / depth, (v[0]! * screenUp[0] + v[1]! * screenUp[1] + v[2]! * screenUp[2]) / depth, depth];
      };
      const t = Math.tan(half);
      const hullSeen = see([h.x, h.y, h.z]);
      assert.ok(hullSeen[2] > 0 && Math.abs(hullSeen[0]) < t && Math.abs(hullSeen[1]) < t, `hull in frame ${hullSeen}`);
      const world = see(c);
      const toWorld = Math.hypot(px - c[0]!, py - c[1]!, pz - c[2]!);
      const reach = Math.tan(Math.asin(R / toWorld));
      const beta = Math.asin(R / toWorld);
      const off = Math.atan(Math.hypot(world[0], world[1]));
      assert.ok(off - beta < half * 1.02, `the limb reaches into the frame, ${(off - beta) / half} of the half height`);
      // The hull stands clear of the limb, on the side away from the world.
      assert.ok(Math.hypot(hullSeen[0] - world[0], hullSeen[1] - world[1]) > reach * 0.98, 'the hull is in plain sight');
    }
  }
});

test('a chase on a small world stands closer, so the limb is still a limb', () => {
  assert.ok(chaseBack(15) < chaseBack(46));
  assert.equal(chaseBack(60), chaseBack(1000));
});

test('a seat: a craft clear of the others stays, one on top of another turns the least it can', () => {
  assert.equal(seatTurn([], { angle: 1, radius: 40, pitch: 30 }), 0);
  assert.equal(seatTurn([{ angle: 3, radius: 40, pitch: 30 }], { angle: 1, radius: 40, pitch: 30 }), 0);
  const turn = seatTurn([{ angle: 1, radius: 40, pitch: 30 }], { angle: 1.02, radius: 40, pitch: 30 });
  assert.notEqual(turn, 0);
  const chord = 2 * 40 * Math.sin(Math.abs(0.02 + turn) / 2);
  assert.ok(chord >= 30, `chord ${chord}`);
  assert.equal(seatTurn([{ angle: 1, radius: 40, pitch: 30 }], { angle: 1, radius: 90, pitch: 30 }), 0, 'another altitude is room enough');
  // Three still craft on a tiny orbit: all apart, and a ring asks for more.
  const seated = [{ angle: 0.5, radius: 34, pitch: 56 }];
  const second = { angle: 0.5, radius: 34, pitch: 30 };
  const a = seatTurn(seated, second);
  assert.ok(2 * 34 * Math.abs(Math.sin(a / 2)) >= 56 - 1e-6);
});

test('a first seat also clears hulls that overlap through a tilted Home projection', () => {
  const me = { angle: Math.PI / 2, radius: 40, pitch: 12 };
  const other = { angle: -Math.PI / 2, radius: 40, pitch: 12 };
  const clearance = (turn: number) => Math.hypot(40 * Math.cos(me.angle + turn), 4 * Math.sin(me.angle + turn) + 4) - 14;
  assert.equal(seatTurn([other], me), 0, 'the bodies are already separated in space');
  const turn = seatTurn([other], me, clearance);
  assert.notEqual(turn, 0);
  assert.ok(clearance(turn) >= 0);
  assert.equal(seatTurn([other], { ...me, angle: me.angle + turn }, (next) => clearance(turn + next)), 0, 'a clear seat stays fixed');
});
