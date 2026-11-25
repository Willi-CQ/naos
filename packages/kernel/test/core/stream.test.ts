import assert from 'node:assert/strict';
import net from 'node:net';
import { after, before, describe, test } from 'node:test';
import { emptyState, reduce } from '@naos/protocol';
import type { FleetState, NaosEvent, ServerFrame, ServerFrames, World } from '@naos/protocol';
import { createBus } from '../../src/bus.ts';
import type { KernelBus } from '../../src/bus.ts';
import type { EventInit, Logger } from '../../src/context.ts';
import { createHub } from '../../src/server/hub.ts';
import { SERVER_LIMITS } from '../../src/config.ts';
import { boot, connect, sleep } from './helpers.ts';
import type { TestKernel } from './helpers.ts';

const silent: Logger = { info() {}, warn() {}, error() {} };

const world = (name: string, slot = 1): World => ({
  worldId: name, projectRoot: `/w/${name}`, name, slot, kind: 'repo', isGit: true, trusted: false, massBytes: 0, massUsd30d: null, spendTodayUsd: null,
  lightsTotal: 0, lightsFailed: 0, lastActiveAt: null, worktrees: [],
});

const upsert = (name: string, slot = 1): EventInit => ({ type: 'world.upserted', world: world(name, slot) });

const info = { version: 't', protocol: 1, pid: 1, startedAt: 0, mode: 'live' as const, veilSalt: 's', controlPlane: false };

function testBus(now?: () => number): KernelBus {
  return createBus({ kernel: info, log: silent, ...(now ? { now } : {}) });
}

describe('bus', () => {
  test('stamps id, at and observedAt when absent, and numbers events', () => {
    const bus = testBus(() => 5000);
    const seen: Array<[NaosEvent, number]> = [];
    bus.subscribe((event, seq) => seen.push([event, seq]));
    bus.publish(upsert('a'));
    bus.publish({ ...upsert('b'), id: 'mine', at: 1000 } as EventInit);
    assert.equal(seen[0]![1], 1);
    assert.equal(seen[1]![1], 2);
    assert.equal(seen[0]![0].at, 5000);
    assert.equal(seen[0]![0].observedAt, 5000);
    assert.ok(seen[0]![0].id.length > 0);
    assert.equal(seen[1]![0].id, 'mine');
    assert.equal(seen[1]![0].at, 1000);
    assert.equal(seen[1]![0].observedAt, 5000);
    assert.equal(bus.state().seq, 2);
  });

  test('a subscriber sees the event already reduced', () => {
    const bus = testBus();
    bus.subscribe((event) => {
      if (event.type === 'world.upserted') assert.ok(bus.state().worlds[event.world.worldId]);
    });
    bus.publish(upsert('a'));
  });

  test('a subscriber that publishes keeps the order for everyone', () => {
    const bus = testBus();
    const later: number[] = [];
    bus.subscribe((event) => {
      if (event.type === 'world.upserted' && event.world.name === 'a') bus.publish(upsert('b'));
    });
    bus.subscribe((_event, seq) => later.push(seq));
    bus.publish(upsert('a'));
    assert.deepEqual(later, [1, 2]);
  });

  test('a throwing subscriber costs one log line and stops nothing', () => {
    const errors: string[] = [];
    const bus = createBus({ kernel: info, log: { ...silent, error: (message) => errors.push(message) } });
    const seen: number[] = [];
    bus.subscribe(() => { throw new Error('no'); });
    bus.subscribe((_event, seq) => seen.push(seq));
    bus.publish(upsert('a'));
    assert.deepEqual(seen, [1]);
    assert.equal(errors.length, 1);
  });

  test('text is dropped when nobody listens, and it never reaches the state', () => {
    const bus = testBus();
    const before = bus.state();
    bus.pushText('n', 'secret text');
    assert.equal(bus.state(), before);
    assert.ok(!JSON.stringify(bus.state()).includes('secret text'));
  });

  test('reset replaces the state and keeps seq rising', () => {
    const bus = testBus();
    bus.publish(upsert('a'));
    bus.publish(upsert('b'));
    let resets = 0;
    bus.onReset(() => { resets += 1; });
    bus.reset({ ...emptyState(), seq: 0 });
    assert.equal(bus.state().seq, 3);
    assert.deepEqual(bus.state().worlds, {});
    assert.deepEqual(bus.state().kernel, info, 'kernel info survives');
    assert.equal(resets, 1);
  });

  test('fleet rate sums the craft, and a plane can set what only it knows', () => {
    const bus = testBus();
    bus.setRate({ nodeId: 'a', tps: 100, source: 'live', liveBlock: 'text', outputTokens: 50 });
    bus.setRate({ nodeId: 'b', tps: 40, source: 'derived', liveBlock: null, outputTokens: 10 });
    bus.setRate({ nodeId: 'a', tps: 120, source: 'live', liveBlock: 'text', outputTokens: 80 });
    bus.setFleetRate({ burnUsdPerHour: 3 });
    const frame = bus.ratesFrame();
    assert.equal(frame.fleet.tps, 160);
    assert.equal(frame.fleet.outputTokens, 90);
    assert.equal(frame.fleet.burnUsdPerHour, 3);
    bus.clearRate('b');
    assert.equal(bus.ratesFrame().fleet.tps, 120);
    assert.equal(bus.ratesFrame().nodes.length, 1);
  });
});

/** A socket that only records, with bufferedAmount in the test's hands. */
function fakeSocket(): { sent: ServerFrame[]; bufferedAmount: number; readyState: number; send(payload: string, cb?: (e?: Error) => void): void; on(): void; ping(): void; terminate(): void } {
  return {
    sent: [],
    bufferedAmount: 0,
    readyState: 1,
    send(payload, cb) { this.sent.push(JSON.parse(payload) as ServerFrame); cb?.(); },
    on() {},
    ping() {},
    terminate() { this.readyState = 3; },
  };
}

const limits = { ...SERVER_LIMITS, ratesMs: 5, batchMs: 1, bufferedHighBytes: 1000, bufferedLowBytes: 100, staleCloseMs: 60_000 };

describe('hub', () => {
  test('hello, then snapshot, in that order', () => {
    const bus = testBus();
    bus.publish(upsert('a'));
    const hub = createHub(bus, silent, limits);
    const socket = fakeSocket();
    hub.attach(socket as never, 'tab-1');
    assert.equal(socket.sent[0]?.t, 'hello');
    assert.equal(socket.sent[1]?.t, 'snapshot');
    assert.equal((socket.sent[0] as ServerFrames['hello']).clientId, 'tab-1');
    assert.equal((socket.sent[1] as ServerFrames['snapshot']).seq, 1);
    hub.close();
  });

  test('a client that joins inside a batch gets only what its snapshot lacks', async () => {
    const bus = testBus();
    const hub = createHub(bus, silent, { ...limits, batchMs: 30 });
    const early = fakeSocket();
    hub.attach(early as never, null);
    bus.publish(upsert('a'));
    bus.publish(upsert('b'));
    const late = fakeSocket();
    hub.attach(late as never, null);
    bus.publish(upsert('c'));
    await sleep(80);
    const framesOf = (socket: typeof early) => socket.sent.filter((frame): frame is ServerFrames['events'] => frame.t === 'events');
    assert.deepEqual(framesOf(early).map((frame) => [frame.seq, frame.events.length]), [[3, 3]]);
    assert.deepEqual(framesOf(late).map((frame) => [frame.seq, frame.events.length]), [[3, 1]]);
    assert.equal((late.sent[1] as ServerFrames['snapshot']).seq, 2);
    hub.close();
  });

  test('a client over the limit gets no replay: the stream stops, and a snapshot follows the drain', async () => {
    const bus = testBus();
    const hub = createHub(bus, silent, limits);
    const socket = fakeSocket();
    hub.attach(socket as never, null);
    bus.publish(upsert('a'));
    await sleep(20);
    const before = socket.sent.length;

    socket.bufferedAmount = 5000;
    for (let index = 0; index < 50; index += 1) bus.publish(upsert(`w${index}`, index));
    await sleep(30);
    assert.equal(socket.sent.length, before, 'nothing is added to a client that is behind, rates included');
    assert.equal(hub.stats().stale, 1);
    assert.ok(hub.stats().dropped >= 50);

    socket.bufferedAmount = 500;
    await sleep(30);
    assert.equal(socket.sent.length, before, 'still above the low mark');

    socket.bufferedAmount = 0;
    await sleep(30);
    const after = socket.sent.slice(before);
    const snapshot = after.find((frame) => frame.t === 'snapshot');
    assert.ok(snapshot, 'a fresh snapshot arrives');
    assert.equal(snapshot.seq, bus.state().seq);
    assert.equal(after.filter((frame) => frame.t === 'events').length, 0, 'the backlog is never replayed');
    assert.equal(hub.stats().stale, 0);

    bus.publish(upsert('next'));
    await sleep(20);
    const events = socket.sent.filter((frame): frame is ServerFrames['events'] => frame.t === 'events').at(-1)!;
    assert.equal(events.seq, bus.state().seq, 'the stream continues from the snapshot, with no gap');
    assert.equal(events.events.length, 1);
    hub.close();
  });

  test('a client that never drains is closed, so its reconnect gets a snapshot', async () => {
    const bus = testBus();
    const hub = createHub(bus, silent, { ...limits, staleCloseMs: 10 });
    const socket = fakeSocket();
    hub.attach(socket as never, null);
    socket.bufferedAmount = 5000;
    bus.publish(upsert('a'));
    await sleep(40);
    assert.equal(socket.readyState, 3);
    hub.close();
  });

  test('text reaches only the client that watches that craft', () => {
    const bus = testBus();
    const hub = createHub(bus, silent, limits);
    const watcher = fakeSocket();
    const other = fakeSocket();
    hub.attach(watcher as never, 'a');
    hub.attach(other as never, 'b');
    bus.pushText('n1', 'dropped');
    hub.watch('a', 'n1', true);
    bus.pushText('n1', 'delta');
    bus.pushText('n2', 'other craft');
    hub.watch('a', 'n1', false);
    bus.pushText('n1', 'after');
    assert.deepEqual(watcher.sent.filter((frame) => frame.t === 'text').map((frame) => frame.delta), ['delta']);
    assert.equal(other.sent.filter((frame) => frame.t === 'text').length, 0);
    hub.close();
  });
});

/** Replays what a store does, and fails on a seq that does not follow. */
function follow(frames: readonly ServerFrame[]): FleetState | null {
  let state: FleetState | null = null;
  for (const frame of frames) {
    if (frame.t === 'snapshot') {
      state = frame.state;
    } else if (frame.t === 'events') {
      assert.ok(state, 'events before any snapshot');
      assert.equal(frame.seq - frame.events.length, state.seq, 'a gap with no snapshot before it');
      state = reduce(state, frame.events, frame.seq);
    }
  }
  return state;
}

describe('a real WebSocket', () => {
  let kernel: TestKernel;

  before(async () => {
    kernel = await boot('live');
  });
  after(() => kernel.close());

  test('snapshot, then events, and a replay equals the kernel\'s own state', async () => {
    const client = await connect(kernel);
    await client.until((frame) => frame.t === 'snapshot');
    assert.equal(client.frames[0]?.t, 'hello');
    assert.equal(client.frames[1]?.t, 'snapshot');
    for (let index = 0; index < 40; index += 1) kernel.bus.publish(upsert(`w${index}`, index));
    await client.until((frame) => frame.t === 'events' && frame.seq >= kernel.bus.state().seq);
    const replayed = follow(client.frames);
    assert.deepEqual(replayed?.worlds, kernel.bus.state().worlds);
    assert.equal(replayed?.seq, kernel.bus.state().seq);
    client.close();
  });

  test('events batch: a burst does not become a frame per event', async () => {
    const client = await connect(kernel);
    await client.until((frame) => frame.t === 'snapshot');
    const start = client.frames.length;
    for (let index = 0; index < 500; index += 1) kernel.bus.publish(upsert(`burst${index}`, index));
    await client.until((frame) => frame.t === 'events' && frame.seq >= kernel.bus.state().seq, 5000, start);
    const frames = client.frames.slice(start).filter((frame) => frame.t === 'events');
    assert.ok(frames.length <= 3, `500 events in one tick came as ${frames.length} frames`);
    client.close();
  });

  test('a steady stream stays under one frame per 16 ms', async () => {
    const client = await connect(kernel);
    await client.until((frame) => frame.t === 'snapshot');
    const start = client.frames.length;
    const began = performance.now();
    let sent = 0;
    while (performance.now() - began < 400) {
      kernel.bus.publish(upsert(`steady${sent}`, sent));
      sent += 1;
      await new Promise((resolve) => setImmediate(resolve));
    }
    const elapsed = performance.now() - began;
    await sleep(40);
    const frames = client.frames.slice(start).filter((frame) => frame.t === 'events').length;
    assert.ok(sent > frames, 'it batched');
    assert.ok(frames <= Math.ceil(elapsed / 16) + 2, `${frames} frames in ${Math.round(elapsed)} ms`);
    client.close();
  });

  test('rates at about 4 Hz and kernel.tick at 1 Hz', async () => {
    const client = await connect(kernel);
    await client.until((frame) => frame.t === 'snapshot');
    const start = client.frames.length;
    await sleep(2100);
    const frames = client.frames.slice(start);
    const rates = frames.filter((frame) => frame.t === 'rates').length;
    const ticks = frames.flatMap((frame) => (frame.t === 'events' ? frame.events : [])).filter((event) => event.type === 'kernel.tick').length;
    assert.ok(rates >= 6 && rates <= 10, `${rates} rates frames in 2.1 s`);
    assert.ok(ticks >= 1 && ticks <= 3, `${ticks} ticks in 2.1 s`);
    assert.ok(kernel.bus.state().lastTickAt !== null);
    client.close();
  });

  test('a reconnect is a fresh snapshot at the current seq', async () => {
    const first = await connect(kernel);
    await first.until((frame) => frame.t === 'snapshot');
    first.close();
    for (let index = 0; index < 10; index += 1) kernel.bus.publish(upsert(`gone${index}`, index));
    const second = await connect(kernel);
    const snapshot = await second.until((frame) => frame.t === 'snapshot') as ServerFrames['snapshot'];
    assert.ok(snapshot.seq >= kernel.bus.state().seq - 1);
    assert.equal(snapshot.state.worlds.gone9?.name, 'gone9');
    second.close();
  });

  test('the client id from the URL comes back in hello, and a bad one is replaced', async () => {
    const named = await connect(kernel, { cookie: kernel.cookie }, '?clientId=tab-7');
    assert.equal((await named.until((frame) => frame.t === 'hello') as ServerFrames['hello']).clientId, 'tab-7');
    named.close();
    const bad = await connect(kernel, { cookie: kernel.cookie }, '?clientId=%3Cscript%3E');
    assert.match((await bad.until((frame) => frame.t === 'hello') as ServerFrames['hello']).clientId, /^[\da-f-]{36}$/);
    bad.close();
  });
});

/** Frames off a raw socket that the test can stop reading. The server never masks, and the hub never fragments. */
function parseFrames(buffer: Buffer): { payloads: string[]; rest: Buffer } {
  const payloads: string[] = [];
  let offset = 0;
  for (;;) {
    if (buffer.length - offset < 2) break;
    const opcode = buffer[offset]! & 0x0f;
    let length = buffer[offset + 1]! & 0x7f;
    let header = 2;
    if (length === 126) {
      if (buffer.length - offset < 4) break;
      length = buffer.readUInt16BE(offset + 2);
      header = 4;
    } else if (length === 127) {
      if (buffer.length - offset < 10) break;
      length = Number(buffer.readBigUInt64BE(offset + 2));
      header = 10;
    }
    if (buffer.length - offset < header + length) break;
    if (opcode === 1) payloads.push(buffer.toString('utf8', offset + header, offset + header + length));
    offset += header + length;
  }
  return { payloads, rest: buffer.subarray(offset) };
}

describe('a real client that stops reading', () => {
  let kernel: TestKernel;

  before(async () => {
    kernel = await boot('live', {
      limits: { ...SERVER_LIMITS, bufferedHighBytes: 256 * 1024, bufferedLowBytes: 64 * 1024, ratesMs: 20, staleCloseMs: 60_000, pingMs: 600_000 },
    });
  });
  after(() => kernel.close());

  test('it falls behind, drains, gets a snapshot, and its stream has no gap', { timeout: 60_000 }, async () => {
    const socket = net.connect({ host: '127.0.0.1', port: kernel.port });
    await new Promise((resolve) => socket.once('connect', resolve));
    socket.write([
      'GET /ws HTTP/1.1', `Host: 127.0.0.1:${kernel.port}`, `Cookie: ${kernel.cookie}`, 'Upgrade: websocket', 'Connection: Upgrade',
      'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==', '', '',
    ].join('\r\n'));

    let buffer: Buffer = Buffer.alloc(0);
    const payloads: string[] = [];
    let upgraded = false;
    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!upgraded) {
        const end = buffer.indexOf('\r\n\r\n');
        if (end < 0) return;
        assert.match(buffer.toString('utf8', 0, end), /101 Switching Protocols/);
        buffer = buffer.subarray(end + 4);
        upgraded = true;
      }
      const parsed = parseFrames(buffer);
      payloads.push(...parsed.payloads);
      buffer = parsed.rest;
    };
    socket.on('data', onData);
    while (!payloads.some((payload) => payload.startsWith('{"t":"snapshot"'))) await sleep(10);

    socket.pause();
    const heavy = 'x'.repeat(32 * 1024);
    for (let round = 0; kernel.server.hub.stats().stale === 0; round += 1) {
      assert.ok(round < 20_000, 'the client never fell behind');
      for (let index = 0; index < 8; index += 1) kernel.bus.publish({ type: 'world.upserted', world: { ...world('heavy'), name: heavy } });
      await sleep(2);
    }
    const droppedBefore = kernel.server.hub.stats().dropped;
    for (let index = 0; index < 8; index += 1) kernel.bus.publish(upsert('skipped', index));
    await sleep(40);
    assert.ok(kernel.server.hub.stats().dropped > droppedBefore, 'the stream stopped for that client');

    kernel.bus.publish(upsert('last-before-resume'));
    socket.resume();
    const seqBefore = kernel.bus.state().seq;
    await sleep(0);
    for (let wait = 0; kernel.server.hub.stats().stale !== 0; wait += 1) {
      assert.ok(wait < 3000, 'the client never recovered');
      await sleep(10);
    }
    kernel.bus.publish(upsert('after-resume'));
    const lastSeq = kernel.bus.state().seq;
    for (let wait = 0; ; wait += 1) {
      assert.ok(wait < 1000, 'the stream never came back');
      if (payloads.some((payload) => payload.startsWith(`{"t":"events","seq":${lastSeq},`))) break;
      await sleep(10);
    }
    socket.destroy();

    const frames = payloads.map((payload) => JSON.parse(payload) as ServerFrame);
    const snapshots = frames.filter((frame) => frame.t === 'snapshot');
    assert.equal(snapshots.length, 2, 'the first, and one after the drain');
    assert.ok(snapshots[1]!.seq >= seqBefore, 'the second holds everything skipped');
    assert.equal(snapshots[1]!.state.worlds['last-before-resume']?.name, 'last-before-resume');
    const replayed = follow(frames);
    assert.equal(replayed?.worlds['after-resume']?.name, 'after-resume');
  });
});
