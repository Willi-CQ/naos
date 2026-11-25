import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { emptyState } from '@naos/protocol';
import type { NaosEvent } from '@naos/protocol';
import { collapsedWorlds } from '../../src/store/collapse.ts';
import { backoffMs, createLink } from '../../src/store/link.ts';
import type { Link, SocketLike } from '../../src/store/link.ts';
import { attachLinkForTest, ingest, markLinkDownForTest, resetForTest, shellOf, useNaos } from '../../src/store/store.ts';

class FakeSocket implements SocketLike {
  onopen: SocketLike['onopen'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;
  onmessage: SocketLike['onmessage'] = null;
  closed = false;
  close() { this.closed = true; }
  fail() { this.onclose?.({} as never); }
  up() { this.onopen?.({} as never); }
}

function harness() {
  const sockets: FakeSocket[] = [];
  const delays: number[] = [];
  const timers: Array<() => void> = [];
  let ups = 0;
  const link = createLink({
    url: () => 'ws://x/ws',
    open: () => { const s = new FakeSocket(); sockets.push(s); return s; },
    onFrame: () => undefined,
    onUp: () => { ups += 1; },
    onDown: () => undefined,
    setTimer: (fn, ms) => { timers.push(fn); delays.push(ms); return timers.length; },
    clearTimer: () => undefined,
  });
  return { link, sockets, delays, timers, ups: () => ups };
}

test('reconnect at 1, 2, 4, 8 s, then every 10 s', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(backoffMs), [1000, 2000, 4000, 8000, 10_000, 10_000, 10_000]);
  const h = harness();
  h.link.connect();
  for (let i = 0; i < 6; i += 1) {
    h.sockets.at(-1)!.fail();
    h.timers.shift()!();
  }
  assert.deepEqual(h.delays, [1000, 2000, 4000, 8000, 10_000, 10_000]);
  assert.equal(h.sockets.length, 7);
});

test('a socket that opened resets the ladder', () => {
  const h = harness();
  h.link.connect();
  h.sockets[0]!.fail();
  h.timers.shift()!();
  h.sockets[1]!.up();
  h.sockets[1]!.fail();
  assert.deepEqual(h.delays, [1000, 1000]);
  assert.equal(h.ups(), 1);
});

test('resync drops the socket and comes straight back, close stops everything', () => {
  const h = harness();
  h.link.connect();
  h.sockets[0]!.up();
  h.link.resync();
  assert.equal(h.sockets[0]!.closed, true);
  assert.equal(h.sockets.length, 2);
  assert.equal(h.delays.length, 0);
  h.link.close();
  h.sockets[1]!.onclose?.({} as never);
  assert.equal(h.sockets.length, 2);
});

test('repeated watchdog resyncs allow a fresh handshake and still replace a stuck connection', () => {
  let now = 0;
  const sockets: Array<FakeSocket & { readyState: number }> = [];
  const link = createLink({ url: () => 'ws://fixture/ws', now: () => now,
    open: () => { const socket = Object.assign(new FakeSocket(), { readyState: 0 }); sockets.push(socket); return socket; },
    onFrame() {}, onUp() {}, onDown() {},
  });
  link.connect(); link.resync(); now = 5000; link.resync();
  assert.equal(sockets.length, 1); assert.equal(sockets[0]!.closed, false);
  now = 10001; link.resync();
  assert.equal(sockets.length, 2); assert.equal(sockets[0]!.closed, true);
  sockets[1]!.readyState = 1; link.resync();
  assert.equal(sockets.length, 3);
  link.close(); assert.equal(sockets[2]!.closed, true);
});

const tick = (id: string, at: number): NaosEvent => ({ type: 'kernel.tick', id, at, observedAt: at, uptimeMs: 1 });

// Commands go through fetch, and these tests have no kernel behind them.
globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, result: { rows: [], salvos: [] } }))) as typeof fetch;

beforeEach(() => resetForTest());

test('events reduce in with the same reducer as the kernel, and a repeat is ignored', () => {
  ingest({ t: 'snapshot', seq: 5, state: { ...emptyState(), seq: 5 } });
  ingest({ t: 'events', seq: 7, events: [tick('a', 100), tick('b', 200)] });
  assert.equal(useNaos.getState().fleet.seq, 7);
  assert.equal(useNaos.getState().fleet.lastTickAt, 200);
  ingest({ t: 'events', seq: 7, events: [tick('b', 200)] });
  assert.equal(useNaos.getState().fleet.lastTickAt, 200);
});

test('a sequence gap resyncs instead of applying, and the recovery marks a gap', () => {
  let resyncs = 0;
  attachLinkForTest({ connect() {}, close() {}, resync() { resyncs += 1; } } as Link);
  ingest({ t: 'snapshot', seq: 5, state: { ...emptyState(), seq: 5 } });
  assert.equal(useNaos.getState().fleet.tape.length, 0);
  ingest({ t: 'events', seq: 9, events: [tick('a', 100)] });
  assert.equal(resyncs, 1);
  assert.equal(useNaos.getState().fleet.seq, 5);
  ingest({ t: 'snapshot', seq: 9, state: { ...emptyState(), seq: 9 } });
  const tape = useNaos.getState().fleet.tape;
  assert.equal(tape.length, 1);
  assert.equal(tape[0]!.kind, 'gap');
  assert.equal(tape[0]!.note, null);
  attachLinkForTest(null);
});

test('a lost link shows, recovery marks one gap, and a seek snapshot marks none', () => {
  ingest({ t: 'snapshot', seq: 1, state: { ...emptyState(), seq: 1 } });
  markLinkDownForTest();
  assert.equal(useNaos.getState().link.status, 'lost');
  assert.notEqual(useNaos.getState().link.lostAt, null);
  ingest({ t: 'snapshot', seq: 2, state: { ...emptyState(), seq: 2 } });
  const s = useNaos.getState();
  assert.equal(s.link.status, 'up');
  assert.equal(s.fleet.tape.filter((t) => t.kind === 'gap').length, 1);
  assert.equal(s.fleet.tape.at(-1)!.kind, 'gap');
  ingest({ t: 'snapshot', seq: 3, state: { ...emptyState(), seq: 3 } });
  assert.equal(useNaos.getState().fleet.tape.length, 0);
});

test('a page that never reached the kernel does not claim a gap', () => {
  markLinkDownForTest();
  ingest({ t: 'snapshot', seq: 1, state: { ...emptyState(), seq: 1 } });
  assert.equal(useNaos.getState().fleet.tape.length, 0);
});

test('rates set the clock: a paused fixture stops time', () => {
  const fleetRate = { tps: 1, outputTokens: 1, perWorld: {}, burnUsdPerHour: 0, todayUsd: 0, lagMaxMs: 0 };
  ingest({ t: 'rates', at: 12_345, fleet: fleetRate, nodes: [] });
  assert.equal(useNaos.getState().rates.at, 12_345);
});

test('layout classes come from the same hud() as the scene', () => {
  const view = { railCollapsed: false, cinema: false };
  assert.deepEqual(shellOf(1280, 800, view).free, { x: 236, y: 36, w: 748, h: 720 });
  assert.deepEqual(shellOf(1280, 665, view).free, { x: 236, y: 36, w: 748, h: 605 });
  assert.deepEqual(shellOf(1920, 1080, view).free, { x: 280, y: 40, w: 1300, h: 992 });
  assert.deepEqual(shellOf(2560, 1440, view).free, { x: 320, y: 44, w: 1840, h: 1344 });
  assert.equal(shellOf(900, 700, view).instrument, true);
  const strip = shellOf(1100, 800, view);
  assert.equal(strip.strip, true);
  assert.equal(strip.left, 44);
  assert.equal(shellOf(1280, 800, { railCollapsed: false, cinema: true }).free.w, 1280);
});

test('the Manifest folds healthy worlds, calmest first, and never one that asks for attention', () => {
  const craftRow = { type: 'craft' } as never;
  const worlds = [
    { worldId: 'need', slot: 1, bestTier: 1, rows: Array(10).fill(craftRow) },
    { worldId: 'fine', slot: 2, bestTier: 6, rows: Array(10).fill(craftRow) },
    { worldId: 'parked', slot: 3, bestTier: 5, rows: Array(10).fill(craftRow) },
  ] as never[];
  assert.equal(collapsedWorlds(worlds, 1000, 20, {}).size, 0);
  assert.deepEqual([...collapsedWorlds(worlds, 500, 20, {})], ['fine']);
  assert.deepEqual([...collapsedWorlds(worlds, 300, 20, {})].sort(), ['fine', 'parked']);
  assert.ok(!collapsedWorlds(worlds, 10, 20, {}).has('need'));
  assert.deepEqual([...collapsedWorlds(worlds, 1000, 20, { need: true })], ['need']);
});
