import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { DEFAULT_PORT } from '@naos/protocol';
import type { ServerFrame } from '@naos/protocol';
import { createBus } from '../../src/bus.ts';
import { loadConfig, toastsAllowed } from '../../src/config.ts';
import type { Logger, Plane } from '../../src/context.ts';
import { openDb } from '../../src/db.ts';
import { startKernel } from '../../src/main.ts';
import { ensureTokens } from '../../src/server/auth.ts';
import { createWorlds, normalizeRoot } from '../../src/worlds.ts';
import { boot, connect, post, run } from './helpers.ts';
import type { TestKernel } from './helpers.ts';

const silent: Logger = { info() {}, warn() {}, error() {} };
const info = { version: 't', protocol: 1, pid: 1, startedAt: 0, mode: 'live' as const, veilSalt: 's', controlPlane: false };
const cliPath = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));

const tempHome = (): string => mkdtempSync(path.join(os.tmpdir(), 'naos-core-'));

describe('config', () => {
  test('home defaults under the repo, NAOS_HOME overrides, --home overrides that', () => {
    assert.ok(loadConfig({ mode: 'live' }, {}).home.endsWith(`${path.sep}.naos`));
    assert.equal(loadConfig({ mode: 'live' }, { NAOS_HOME: path.resolve('/a') }).home, path.resolve('/a'));
    assert.equal(loadConfig({ mode: 'live', home: path.resolve('/b') }, { NAOS_HOME: path.resolve('/a') }).home, path.resolve('/b'));
  });

  test('the default port comes from the contract, and 0 stays 0', () => {
    assert.equal(loadConfig({ mode: 'live' }, {}).port, DEFAULT_PORT);
    assert.equal(loadConfig({ mode: 'live', port: 0 }, {}).port, 0);
  });

  test('only the fixture trusts the Vite origin without being told', () => {
    assert.deepEqual(loadConfig({ mode: 'live' }, {}).devOrigins, []);
    assert.equal(loadConfig({ mode: 'fixture' }, {}).devOrigins.length, 2);
    assert.deepEqual(loadConfig({ mode: 'live' }, { NAOS_DEV_ORIGINS: 'http://127.0.0.1:9000, http://x:1' }).devOrigins, ['http://127.0.0.1:9000', 'http://x:1']);
  });
});

describe('the toast gate', () => {
  test('open only on a live kernel, with no opt-out, outside the test runner', () => {
    assert.equal(toastsAllowed('live', {}), true);
    assert.equal(toastsAllowed('fixture', {}), false);
    assert.equal(toastsAllowed('live', { NAOS_NO_TOAST: '1' }), false);
    assert.equal(toastsAllowed('live', { NODE_TEST_CONTEXT: 'child-v8' }), false);
    assert.equal(toastsAllowed('live'), false, 'and shut right here, in this very process');
  });
});

describe('tokens', () => {
  test('are created once and kept', () => {
    const home = tempHome();
    const first = ensureTokens(home);
    const second = ensureTokens(home);
    assert.deepEqual(second, first);
    assert.notEqual(first.ui, first.mcp);
    assert.ok(first.ui.length >= 40);
    assert.equal(readFileSync(path.join(home, 'ui.token'), 'utf8').trim(), first.ui);
    rmSync(home, { recursive: true, force: true });
  });
});

describe('db', () => {
  test('runs, gets and lists with parameters, and persists', () => {
    const home = tempHome();
    const file = path.join(home, 'naos.db');
    const db = openDb(file);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, blob BLOB)');
    db.run('INSERT INTO t (name, blob) VALUES (?, ?)', 'a', new Uint8Array([1, 2]));
    db.run('INSERT INTO t (name, blob) VALUES (?, ?)', 'b', null);
    assert.equal(db.get<{ name: string }>('SELECT name FROM t WHERE id = ?', 2)?.name, 'b');
    assert.equal(db.get('SELECT name FROM t WHERE id = ?', 99), undefined);
    assert.deepEqual(db.all<{ id: number }>('SELECT id FROM t ORDER BY id').map((row) => row.id), [1, 2]);
    db.close();
    const again = openDb(file);
    assert.equal(again.all('SELECT id FROM t').length, 2);
    again.close();
    rmSync(home, { recursive: true, force: true });
  });
});

describe('worlds', () => {
  const setup = (home: string) => {
    const bus = createBus({ kernel: info, log: silent });
    // These roots are made up, and the Belt has its own tests in worlds.test.ts.
    return { bus, worlds: createWorlds({ home, bus, log: silent, tempRoots: [], disk: { lookNow: () => 'here', look: async () => 'here' } }) };
  };

  test('a slot is assigned on first sight and persists across a restart', () => {
    const home = tempHome();
    const first = setup(home);
    const a = first.worlds.ensure('/fixture/alpha');
    const b = first.worlds.ensure('/fixture/beta');
    assert.equal(a.slot, 1);
    assert.equal(b.slot, 2);
    assert.equal(first.bus.state().worlds[a.worldId]?.name, 'Alpha');

    const second = setup(home);
    assert.equal(second.worlds.veilSalt, first.worlds.veilSalt);
    assert.equal(second.worlds.ensure('/fixture/beta').slot, 2);
    assert.equal(second.worlds.ensure('/fixture/gamma').slot, 3, 'the next slot is new, because nothing gave one back');
    second.worlds.publishAll();
    assert.equal(Object.keys(second.bus.state().worlds).length, 3, 'known worlds show even with no session today');
    rmSync(home, { recursive: true, force: true });
  });

  test('a repeat publishes nothing, a real change publishes once', () => {
    const home = tempHome();
    const { bus, worlds } = setup(home);
    const a = worlds.ensure('/fixture/alpha');
    const seq = bus.state().seq;
    worlds.ensure('/fixture/alpha');
    assert.equal(bus.state().seq, seq);
    worlds.ensure('/fixture/alpha', { massBytes: 100 });
    assert.equal(bus.state().seq, seq + 1);
    assert.equal(bus.state().worlds[a.worldId]?.massBytes, 100);
    rmSync(home, { recursive: true, force: true });
  });

  test('a patch cannot move identity', () => {
    const home = tempHome();
    const { worlds } = setup(home);
    const a = worlds.ensure('/fixture/alpha');
    const moved = worlds.ensure('/fixture/alpha', { slot: 99, worldId: 'x', projectRoot: '/y' });
    assert.equal(moved.slot, a.slot);
    assert.equal(moved.worldId, a.worldId);
    assert.equal(moved.projectRoot, a.projectRoot);
    rmSync(home, { recursive: true, force: true });
  });

  test('find assigns nothing', () => {
    const home = tempHome();
    const { worlds } = setup(home);
    assert.equal(worlds.find('/fixture/unknown'), undefined);
    assert.equal(worlds.ensure('/fixture/first').slot, 1);
    assert.ok(worlds.find('/fixture/first'));
    rmSync(home, { recursive: true, force: true });
  });

  test('roots normalise, on Windows without regard to case', () => {
    assert.equal(normalizeRoot('c:\\dev\\thing\\'), 'C:/dev/thing');
    assert.equal(normalizeRoot('C:/'), 'C:/');
    const home = tempHome();
    const { worlds } = setup(home);
    const a = worlds.ensure('C:\\Dev\\Thing');
    if (process.platform === 'win32') assert.equal(worlds.ensure('c:/dev/thing/').worldId, a.worldId);
    rmSync(home, { recursive: true, force: true });
  });

  test('a null root is one body in the Belt, with no slot', () => {
    const home = tempHome();
    const { worlds } = setup(home);
    const a = worlds.ensure(null);
    assert.equal(a.kind, 'belt');
    assert.equal(a.slot, 0);
    assert.equal(a.projectRoot, null);
    assert.equal(worlds.ensure(null).worldId, a.worldId);
    rmSync(home, { recursive: true, force: true });
  });

  test('trust persists and publishes', () => {
    const home = tempHome();
    const first = setup(home);
    const a = first.worlds.ensure('/fixture/alpha');
    first.worlds.setTrusted(a.worldId, true);
    assert.equal(first.bus.state().worlds[a.worldId]?.trusted, true);
    assert.equal(setup(home).worlds.get(a.worldId)?.trusted, true);
    rmSync(home, { recursive: true, force: true });
  });

  test('a corrupt layout.json is set aside, and the kernel still starts', () => {
    const home = tempHome();
    writeFileSync(path.join(home, 'layout.json'), '{ not json');
    const { worlds } = setup(home);
    assert.equal(worlds.ensure('/fixture/alpha').slot, 1);
    rmSync(home, { recursive: true, force: true });
  });

  test('an ephemeral instance writes nothing', () => {
    const home = tempHome();
    const bus = createBus({ kernel: info, log: silent });
    const worlds = createWorlds({ home, bus, log: silent, ephemeral: { veilSalt: 'fixed' } });
    worlds.ensure('/fixture/alpha');
    assert.equal(worlds.veilSalt, 'fixed');
    assert.equal(existsSync(path.join(home, 'layout.json')), false);
    rmSync(home, { recursive: true, force: true });
  });
});

describe('commands the kernel answers itself', () => {
  let kernel: TestKernel;

  before(async () => {
    kernel = await boot('live');
  });
  after(() => kernel.close());

  test('a command with no handler is unavailable, not an error', async () => {
    const reply = await post(kernel, { type: 'agent.status', agentId: 'x' });
    assert.equal(reply.status, 503);
    assert.ok(!reply.body.ok && reply.body.error.code === 'unavailable');
  });

  test('fixture.control is refused in live mode', async () => {
    assert.equal((await post(kernel, { type: 'fixture.control', action: 'pause' })).status, 503);
  });

  test('a handler that throws answers internal, and its message stays private', async () => {
    kernel.router.register('agent.list', () => { throw new Error('C:/secret/path'); });
    const reply = await post(kernel, { type: 'agent.list', scope: 'all' });
    assert.equal(reply.status, 500);
    assert.ok(!JSON.stringify(reply.body).includes('secret'));
  });

  test('bench.record writes into docs/bench under the repo root, keeping earlier entries', async () => {
    const repo = tempHome();
    const original = kernel.config.repoRoot;
    kernel.config.repoRoot = repo;
    try {
      const first = await run<{ path: string }>(kernel, { type: 'bench.record', name: 'S0', data: { p95: 11.2 } });
      await run(kernel, { type: 'bench.record', name: 'S20', data: { p95: 14 } });
      assert.match(first.path, /^docs\/bench\/\d{4}-\d{2}-\d{2}\.json$/);
      const saved = JSON.parse(readFileSync(path.join(repo, first.path), 'utf8')) as Record<string, { p95: number }>;
      assert.equal(saved.S0?.p95, 11.2);
      assert.equal(saved.S20?.p95, 14);
      assert.equal((await post(kernel, { type: 'bench.record', name: '../../evil', data: 1 })).status, 400);
    } finally {
      kernel.config.repoRoot = original;
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test('a watch needs no plane, so pushed text reaches the client that asked', async () => {
    const client = await connect(kernel, { cookie: kernel.cookie }, '?clientId=watcher');
    await client.until((frame) => frame.t === 'snapshot');
    await run(kernel, { type: 'craft.watchText', nodeId: 'n1', on: true, clientId: 'watcher' });
    kernel.bus.pushText('n1', 'delta');
    assert.equal((await client.until((frame) => frame.t === 'text')).t, 'text');
    client.close();
  });

  test('/api/status reports the kernel', async () => {
    const reply = await fetch(`${kernel.origin}/api/status`, { headers: { cookie: kernel.cookie } });
    const body = (await reply.json()) as { port: number; kernel: { mode: string } };
    assert.equal(body.port, kernel.port);
    assert.equal(body.kernel.mode, 'live');
  });
});

describe('the run file', () => {
  test('a stale file left by a hard kill does not block a start, even with a live pid in it', async () => {
    const home = tempHome();
    writeFileSync(path.join(home, 'kernel.json'), JSON.stringify({ pid: process.ppid, port: 9, mode: 'live', startedAt: 0 }));
    const config = loadConfig({ mode: 'live', port: 0, home }, {});
    const kernel = await startKernel({ config, planes: [], logToStderr: false });
    await kernel.stop();
    assert.equal(existsSync(path.join(home, 'kernel.json')), false, 'a clean stop removes it');
    rmSync(home, { recursive: true, force: true });
  });

  test('a second live kernel on one home is refused', async () => {
    const first = await boot('live');
    try {
      await assert.rejects(startKernel({ config: first.config, planes: [], logToStderr: false }), /already running/);
    } finally {
      await first.close();
    }
  });
});

describe('planes', () => {
  test('a plane that fails is logged, and the kernel keeps serving', async () => {
    const broken: Plane = { name: 'broken', start: () => Promise.reject(new Error('no')), stop: () => Promise.resolve() };
    const kernel = await boot('live', { planes: [broken] });
    try {
      assert.equal((await fetch(`${kernel.origin}/api/status`, { headers: { cookie: kernel.cookie } })).status, 200);
      const client = await connect(kernel);
      const hello = await client.until((frame) => frame.t === 'hello');
      assert.ok(hello.t === 'hello' && hello.kernel.controlPlane === false);
      client.close();
    } finally {
      await kernel.close();
    }
  });
});

describe('the CLI, as a real process', () => {
  const start = (args: string[]) => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', cliPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, NAOS_NO_TOAST: '1' },
    });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    const ready = new Promise<{ event: string; url: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ready line: ${stdout}`)), 20_000);
      child.stdout.on('data', () => {
        const line = stdout.split('\n')[0]!;
        if (!stdout.includes('\n')) return;
        clearTimeout(timer);
        resolve(JSON.parse(line) as { event: string; url: string });
      });
      child.once('exit', (code) => reject(new Error(`exited with ${code}`)));
    });
    return { child, ready, stdout: () => stdout };
  };

  test('fixture --port 0 --no-open prints one ready line, and a WebSocket client gets 20 craft', { timeout: 30_000 }, async () => {
    const home = tempHome();
    const kernel = start(['fixture', '--port', '0', '--no-open', '--home', home]);
    try {
      const ready = await kernel.ready;
      assert.equal(ready.event, 'ready');
      const url = new URL(ready.url);
      assert.equal(url.hostname, '127.0.0.1');
      assert.notEqual(url.port, '0');
      assert.equal(url.pathname, '/auth');

      const auth = await fetch(ready.url, { redirect: 'manual' });
      const cookie = auth.headers.get('set-cookie')!.split(';')[0]!;
      const snapshot = await new Promise<ServerFrame>((resolve, reject) => {
        const ws = new WebSocket(`ws://${url.host}/ws`, { headers: { cookie } });
        ws.on('message', (data: Buffer) => {
          const frame = JSON.parse(data.toString('utf8')) as ServerFrame;
          if (frame.t === 'snapshot') { ws.terminate(); resolve(frame); }
        });
        ws.once('error', reject);
      });
      assert.ok(snapshot.t === 'snapshot');
      assert.equal(Object.keys(snapshot.state.nodes).length, 20);
      assert.equal(kernel.stdout().trim().split('\n').length, 1, 'exactly one line on stdout');
    } finally {
      kernel.child.kill();
      await new Promise((resolve) => kernel.child.once('exit', resolve));
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('status and stop-all reach a running kernel through its run file', { timeout: 30_000 }, async () => {
    const home = tempHome();
    const kernel = start(['fixture', '--port', '0', '--no-open', '--home', home]);
    const call = (args: string[]): Promise<{ code: number | null; out: string; err: string }> => new Promise((resolve) => {
      const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', cliPath, ...args, '--home', home], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let out = '';
      let err = '';
      child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString('utf8'); });
      child.stderr.on('data', (chunk: Buffer) => { err += chunk.toString('utf8'); });
      child.once('exit', (code) => resolve({ code, out, err }));
    });
    try {
      await kernel.ready;
      const status = await call(['status']);
      assert.equal(status.code, 0, status.err);
      assert.equal((JSON.parse(status.out) as { nodes: number }).nodes, 20);
      const stopped = await call(['stop-all']);
      assert.equal(stopped.code, 0, stopped.err);
      assert.ok((JSON.parse(stopped.out) as { stopped: number }).stopped >= 7);
    } finally {
      kernel.child.kill();
      await new Promise((resolve) => kernel.child.once('exit', resolve));
    }
    const dead = await call(['status']);
    assert.notEqual(dead.code, 0, 'no kernel, no success');
    rmSync(home, { recursive: true, force: true });
  });

  test('an unknown verb fails with a message, and --help prints usage', { timeout: 20_000 }, async () => {
    const run = (args: string[]): Promise<{ code: number | null; out: string; err: string }> => new Promise((resolve) => {
      const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', cliPath, ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let out = '';
      let err = '';
      child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString('utf8'); });
      child.stderr.on('data', (chunk: Buffer) => { err += chunk.toString('utf8'); });
      child.once('exit', (code) => resolve({ code, out, err }));
    });
    const bad = await run(['nope']);
    assert.equal(bad.code, 1);
    assert.match(bad.err, /unknown command/);
    assert.match((await run(['--help'])).out, /naos <command>/);
  });
});
