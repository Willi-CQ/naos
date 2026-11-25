// The app lifecycle, the parts that need no process of their own. scripts/e2e-app.mjs runs the whole of it with a stub browser.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, mock, test } from 'node:test';
import type { ApprovalView, FleetState } from '@naos/protocol';
import { OpenFailure, needsUiBuild, openApp, takeLock, tellUser } from '../../src/app/launch.ts';
import { createIdleWatch, liveCraft, openDecisions, quietSince } from '../../src/app/lifetime.ts';
import { probePort } from '../../src/app/probe.ts';
import { shortcutSpec, writeShortcuts } from '../../src/app/shortcut.ts';
import { appUrl, findAppBrowser, openWindow, windowArgs, windowCommand } from '../../src/app/window.ts';
import { loadConfig } from '../../src/config.ts';
import type { Plane } from '../../src/context.ts';
import { toastXml } from '../../src/notify/toast.ts';
import { startKernel } from '../../src/main.ts';
import { identityProof, openSignature } from '../../src/server/auth.ts';
import { createRateGate, openLink, refuseOpen, validDocket } from '../../src/server/open.ts';
import { boot, post, sleep } from './helpers.ts';
import type { TestKernel } from './helpers.ts';

const fleet = (states: string[], approvals: string[] = []): FleetState => ({
  managed: Object.fromEntries(states.map((state, index) => [`a${index}`, { state }])),
  approvals: Object.fromEntries(approvals.map((status, index) => [`r${index}`, { status }])),
} as unknown as FleetState);

/** What a browser sends for a navigation that a person started. */
const USER_NAVIGATION = { 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'sec-fetch-user': '?1' };

/** The same with no user activation, which is what a browser may send for a toast click. */
const { 'sec-fetch-user': _activation, ...TOAST_NAVIGATION } = USER_NAVIGATION;

describe('idle exit', () => {
  test('a craft counts until it has ended', () => {
    assert.equal(liveCraft(fleet(['exited', 'crashed', 'lost', 'closed'])), 0);
    for (const state of ['queued', 'spawning', 'ready', 'running', 'awaiting_approval', 'idle', 'parked', 'budget_exhausted', 'rate_limited', 'stopping']) {
      assert.equal(liveCraft(fleet([state])), 1, state);
    }
  });

  test('only open decisions count', () => {
    assert.equal(openDecisions(fleet([], ['answered', 'open', 'withdrawn', 'open'])), 2);
  });

  test('anything on the kernel ends the quiet stretch, and it keeps its start while nothing is', () => {
    const none = { clients: 0, craft: 0, decisions: 0 };
    assert.equal(quietSince(null, none, 5), 5);
    assert.equal(quietSince(5, none, 9), 5);
    for (const busy of [{ ...none, clients: 1 }, { ...none, craft: 1 }, { ...none, decisions: 1 }]) assert.equal(quietSince(5, busy, 9), null);
  });

  function watch(occupancy: { clients: number; craft: number; decisions: number }) {
    let clock = 0;
    let fired = 0;
    const idle = createIdleWatch({ limitMs: 60_000, read: () => occupancy, onIdle: () => { fired += 1; }, now: () => clock });
    const pass = (ms: number): void => { clock += ms; mock.timers.tick(ms); };
    return { idle, pass, fired: () => fired };
  }

  test('it fires once, after the whole limit', () => {
    mock.timers.enable({ apis: ['setInterval'] });
    try {
      const { pass, fired } = watch({ clients: 0, craft: 0, decisions: 0 });
      pass(55_000);
      assert.equal(fired(), 0);
      pass(5000);
      assert.equal(fired(), 1);
      pass(600_000);
      assert.equal(fired(), 1);
    } finally {
      mock.timers.reset();
    }
  });

  test('it never fires while a craft is alive, and the limit starts over when the craft is gone', () => {
    mock.timers.enable({ apis: ['setInterval'] });
    try {
      const occupancy = { clients: 0, craft: 1, decisions: 0 };
      const { idle, pass, fired } = watch(occupancy);
      pass(3_600_000);
      assert.equal(fired(), 0);
      occupancy.craft = 0;
      pass(30_000);
      assert.equal(fired(), 0);
      pass(60_000);
      assert.equal(fired(), 1);
      idle.stop();
    } finally {
      mock.timers.reset();
    }
  });

  test('in a live kernel an open decision holds it, and it goes once that is settled', async () => {
    const reasons: string[] = [];
    // From a plane, because a slow boot can outlast the limit before a test gets to publish anything.
    const decision: Plane = {
      name: 'decision',
      async start({ bus }) {
        bus.publish({ type: 'approval.requested', approval: { requestId: 'r1', agentId: 'a1', status: 'open' } as unknown as ApprovalView });
      },
      async stop() {},
    };
    const kernel = await boot('live', { exit: (reason) => reasons.push(reason), idleExitMs: 300, planes: [decision] });
    try {
      await sleep(900);
      assert.deepEqual(reasons, [], 'nobody is connected and no craft is alive, so only the decision holds it');
      kernel.bus.publish({ type: 'approval.expired', requestId: 'r1' });
      await sleep(900);
      assert.deepEqual(reasons, ['idle']);
    } finally {
      await kernel.close();
    }
  });

  test('a probe and a click each hold it off, because a window is on its way', async () => {
    const reasons: string[] = [];
    const kernel = await boot('live', { exit: (reason) => reasons.push(reason), idleExitMs: 800, openWindow: () => {} });
    const click = (): Promise<unknown> => new Promise((resolve, reject) => {
      http.request({ host: '127.0.0.1', port: kernel.port, path: openLink('', kernel.tokens.ui, 'r1'), headers: USER_NAVIGATION }, (reply) => {
        reply.resume();
        reply.once('end', resolve);
      }).on('error', reject).end();
    });
    try {
      for (const poke of [() => probePort(kernel.port, kernel.tokens.ui), click]) {
        for (let turn = 0; turn < 5; turn += 1) {
          await poke();
          await sleep(300);
        }
        assert.deepEqual(reasons, []);
      }
    } finally {
      await kernel.close();
    }
  });

  test('an attach starts the stretch again', () => {
    mock.timers.enable({ apis: ['setInterval'] });
    try {
      const { idle, pass, fired } = watch({ clients: 0, craft: 0, decisions: 0 });
      pass(55_000);
      idle.touch();
      pass(55_000);
      assert.equal(fired(), 0);
      pass(10_000);
      assert.equal(fired(), 1);
    } finally {
      mock.timers.reset();
    }
  });
});

describe('the window', () => {
  const env = { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\a b\\AppData\\Local' };
  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const chrome = 'C:\\Users\\a b\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';

  test('Edge first, then Chrome, then nothing', () => {
    assert.equal(findAppBrowser(env, () => true), edge);
    assert.equal(findAppBrowser(env, (file) => file === chrome), chrome);
    assert.equal(findAppBrowser(env, () => false), null);
  });

  test('its arguments give it an app frame and a profile of its own', () => {
    assert.deepEqual(windowArgs('http://x/', path.join('h', 'o me')), [
      '--app=http://x/', `--user-data-dir=${path.join('h', 'o me', 'app-profile')}`,
      '--no-first-run', '--no-default-browser-check', '--disable-sync', '--start-maximized',
    ]);
  });

  test('the default browser gets the bare address, with nothing it could not use', () => {
    assert.deepEqual(windowCommand('http://x/', 'h', env, () => false, 'win32'), { command: 'rundll32', args: ['url.dll,FileProtocolHandler', 'http://x/'] });
    assert.equal(windowCommand('http://x/', 'h', env, () => true, 'win32').command, edge);
  });

  test('NAOS_APP_BROWSER wins, and a script runs on this Node', () => {
    const stub = windowCommand('http://x/', 'h', { ...env, NAOS_APP_BROWSER: 'C:\\s\\stub.mjs' }, () => true, 'win32');
    assert.equal(stub.command, process.execPath);
    assert.equal(stub.args[0], 'C:\\s\\stub.mjs');
    assert.equal(stub.args[1], '--app=http://x/');
    assert.equal(windowCommand('u', 'h', { NAOS_APP_BROWSER: 'C:\\b.exe' }, () => true, 'win32').command, 'C:\\b.exe');
  });

  test('under the test runner nothing opens, whatever the environment says', async () => {
    const before = process.env.NAOS_APP_BROWSER;
    const dir = mkdtempSync(path.join(os.tmpdir(), 'naos-window-'));
    const ran = path.join(dir, 'ran');
    process.env.NAOS_APP_BROWSER = path.join(dir, 'stub.mjs');
    writeFileSync(process.env.NAOS_APP_BROWSER, `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(ran)}, '');\n`);
    try {
      openWindow('http://127.0.0.1:1/', dir, { warn() {} });
      // Time for a Node to start and write the file, had one been spawned.
      await sleep(1500);
      assert.equal(existsSync(ran), false);
    } finally {
      if (before === undefined) delete process.env.NAOS_APP_BROWSER;
      else process.env.NAOS_APP_BROWSER = before;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the docket travels in the fragment, which a server never sees', () => {
    assert.equal(appUrl(7, 'tok'), 'http://127.0.0.1:7/auth?token=tok');
    assert.equal(appUrl(7, 'tok', 'toolu_1'), 'http://127.0.0.1:7/auth?token=tok#docket=toolu_1');
  });
});

describe('GET /open', () => {
  let kernel: TestKernel;
  const opened: Array<string | null> = [];

  before(async () => {
    kernel = await boot('live', { openWindow: (docket) => opened.push(docket) });
  });
  after(() => kernel.close());

  const NAVIGATION = USER_NAVIGATION;
  /** The link a toast carries, as a path. */
  const link = (id: string): string => openLink('', kernel.tokens.ui, id);

  function get(route: string, headers: Record<string, string>, method = 'GET', port = kernel.port): Promise<{ status: number; text: string; headers: http.IncomingHttpHeaders }> {
    return new Promise((resolve, reject) => {
      const request = http.request({ host: '127.0.0.1', port, path: route, method, headers }, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, text: Buffer.concat(chunks).toString('utf8') }));
      });
      request.on('error', reject);
      request.end();
    });
  }

  test('a link the kernel did not write gets no window, however good the navigation looks', async () => {
    const forged = [
      '/open',
      '/open?docket=r1',
      '/open?docket=r1&sig=',
      '/open?docket=r1&sig=AAAA',
      `/open?docket=r1&sig=${openSignature('the token of another home', 'r1')}`,
      `/open?docket=r2&sig=${openSignature(kernel.tokens.ui, 'r1')}`,
      `/open?sig=${openSignature(kernel.tokens.ui, 'r1')}`,
      `/open?docket=r1&sig=${identityProof(kernel.tokens.ui, kernel.port, 'live', 'r1')}`,
    ];
    for (const route of forged) {
      assert.equal((await get(route, NAVIGATION)).status, 403, route);
      assert.equal((await get(route, TOAST_NAVIGATION)).status, 403, route);
    }
    assert.deepEqual(opened, []);
  });

  test('neither a page nor a speculation gets one, even holding a real link, and neither uses up a real click', async () => {
    const pages: Array<Record<string, string>> = [
      {},
      { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' },
      { 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'navigate' },
      { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' },
      { 'sec-fetch-site': 'none', 'sec-fetch-mode': 'no-cors' },
      { ...NAVIGATION, 'sec-purpose': 'prefetch' },
      { ...NAVIGATION, 'sec-purpose': 'prefetch;prerender' },
      { ...NAVIGATION, purpose: 'prefetch' },
      { ...TOAST_NAVIGATION, 'sec-purpose': 'prefetch' },
      { ...TOAST_NAVIGATION, 'sec-purpose': 'prefetch;prerender' },
      { ...TOAST_NAVIGATION, purpose: 'prefetch' },
    ];
    for (let round = 0; round < 3; round += 1) {
      for (const headers of pages) assert.equal((await get(link('r1'), headers)).status, 403, JSON.stringify(headers));
    }
    assert.equal((await get(link('r1'), { ...NAVIGATION, host: 'evil.example' })).status, 403);
    assert.equal((await get(link('r1'), { ...NAVIGATION, origin: 'http://evil.example' })).status, 403);
    assert.equal((await get(link('r1'), NAVIGATION, 'POST')).status, 405);
    assert.deepEqual(opened, []);
  });

  test('a bad id is refused before anything opens', async () => {
    for (const id of ['', '%2e%2e%2f', 'a%20b', '<script>', `${'x'.repeat(129)}`, '%23docket%3Dx']) {
      assert.equal((await get(`/open?docket=${id}`, NAVIGATION)).status, 400, id);
    }
    assert.deepEqual(opened, []);
  });

  test('a click opens the window, and the answer holds nothing of the fleet', async () => {
    const reply = await get(link('toolu_01ab-c'), NAVIGATION);
    assert.equal(reply.status, 200);
    assert.equal(reply.headers['set-cookie'], undefined);
    assert.equal(reply.headers['cache-control'], 'no-store');
    assert.ok(!reply.text.includes('toolu_01ab-c'), 'it does not even repeat the id');
    assert.ok(!reply.text.includes(kernel.tokens.ui));
    assert.deepEqual(opened, ['toolu_01ab-c']);
  });

  test('an id the kernel has never heard of looks the same, so the route answers no question', async () => {
    assert.equal((await get(link('nobody'), NAVIGATION)).status, 200);
    assert.equal((await get(link('not/a/plain/id'), NAVIGATION)).status, 200);
    assert.deepEqual(opened.slice(1), ['nobody', null]);
  });

  test('a toast click with no user activation opens the window, because the signature is the guard', async () => {
    assert.equal((await get(link('toast'), TOAST_NAVIGATION)).status, 200);
    assert.equal(opened.at(-1), 'toast');
  });

  test('it is rate limited', async () => {
    assert.equal((await get(link('a'), NAVIGATION)).status, 200);
    assert.equal((await get(link('b'), NAVIGATION)).status, 429);
    assert.equal(opened.length, 5);
  });

  test('a fixture kernel has no such route', async () => {
    const asked: Array<string | null> = [];
    const fixture = await boot('fixture', { openWindow: (docket) => asked.push(docket) });
    try {
      const reply = await get(openLink('', fixture.tokens.ui, 'x'), { ...NAVIGATION, host: `127.0.0.1:${fixture.port}` }, 'GET', fixture.port);
      assert.doesNotMatch(reply.text, /own window/);
      assert.deepEqual(asked, []);
    } finally {
      await fixture.close();
    }
  });
});

describe('the /open pieces', () => {
  test('the id allows what a tool use id or a uuid holds, and nothing that needs escaping', () => {
    for (const id of ['toolu_01ABCdef', '6f1c7e7e-3c1c-4e1b-9a55-0123456789ab', 'a.b:c']) assert.ok(validDocket(id), id);
    for (const id of ['', 'a b', 'a/b', 'a#b', 'a%20', 'a&b', 'x'.repeat(129), 'ä']) assert.ok(!validDocket(id), id);
  });

  test('the toast link falls back to the plain route', () => {
    assert.equal(openLink('http://o', 'tok', 'r_1'), `http://o/open?docket=r_1&sig=${openSignature('tok', 'r_1')}`);
    assert.equal(openLink('http://o', 'tok', 'r 1'), `http://o/open?sig=${openSignature('tok', '')}`);
  });

  test('a link holds no token, and a toast keeps it whole', () => {
    const url = openLink('http://o', 'the-ui-token', 'r_1');
    assert.ok(!url.includes('the-ui-token'));
    assert.match(toastXml({ text: 't', url }), /launch="http:\/\/o\/open\?docket=r_1&amp;sig=[\w-]+"/);
  });

  test('only a navigation no page began passes, with or without user activation', () => {
    const click = { 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate' };
    assert.equal(refuseOpen(click), null);
    assert.equal(refuseOpen({ ...click, 'sec-fetch-user': '?1' }), null);
    assert.equal(refuseOpen({}), 'sec-fetch-site');
    assert.equal(refuseOpen({ 'sec-fetch-site': 'none' }), 'sec-fetch-mode');
    assert.equal(refuseOpen({ ...click, 'sec-purpose': 'prefetch;prerender' }), 'sec-purpose');
    assert.equal(refuseOpen({ ...click, purpose: 'prefetch' }), 'sec-purpose');
  });

  test('the gate lets a burst through, then waits out its window', () => {
    let clock = 0;
    const gate = createRateGate(2, 1000, () => clock);
    assert.deepEqual([gate(), gate(), gate()], [true, true, false]);
    clock = 999;
    assert.equal(gate(), false);
    clock = 1000;
    assert.deepEqual([gate(), gate(), gate()], [true, true, false]);
  });
});

describe('kernel.quit', () => {
  test('the MCP token has no route to it', async () => {
    let quits = 0;
    const kernel = await boot('live', { exit: () => { quits += 1; } });
    try {
      const reply = await post(kernel, { type: 'kernel.quit' }, { authorization: `Bearer ${kernel.tokens.mcp}` });
      assert.equal(reply.status, 403);
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(quits, 0);
    } finally {
      await kernel.close();
    }
  });

  test('it refuses while a craft is alive, says how many, and goes once they are gone', async () => {
    const reasons: string[] = [];
    const kernel = await boot('fixture', { exit: (reason) => reasons.push(reason) });
    try {
      await post(kernel, { type: 'fixture.control', action: 'pause' });
      await post(kernel, { type: 'fixture.control', action: 'seek', value: 30 });
      const craft = liveCraft(kernel.bus.state());
      assert.ok(craft > 0, 'the scene has craft alive at t = 30');
      const refused = await post(kernel, { type: 'kernel.quit' });
      assert.equal(refused.status, 409);
      assert.ok(!refused.body.ok && refused.body.error.message.startsWith(`${craft} owned craft`));

      await post(kernel, { type: 'fixture.control', action: 'idle' });
      assert.equal(liveCraft(kernel.bus.state()), 0);
      assert.equal((await post(kernel, { type: 'kernel.quit' })).status, 200);
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.deepEqual(reasons, ['quit']);
    } finally {
      await kernel.close();
    }
  });

  test('a kernel with nothing to exit says so', async () => {
    const kernel = await boot('live');
    try {
      assert.equal((await post(kernel, { type: 'kernel.quit' })).status, 503);
    } finally {
      await kernel.close();
    }
  });
});

describe('finding the kernel', () => {
  /** An HTTP server on a free port that keeps each request as it arrived. */
  async function listener(answer: (req: http.IncomingMessage, res: http.ServerResponse) => unknown): Promise<{ port: number; seen: string[]; close(): Promise<void> }> {
    const seen: string[] = [];
    const server = http.createServer((req, res) => {
      seen.push(JSON.stringify([req.method, req.url, req.rawHeaders]));
      void answer(req, res);
    });
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    return {
      port: (server.address() as net.AddressInfo).port,
      seen,
      close: () => new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }),
    };
  }

  test('only this home\'s kernel is ours', async () => {
    const kernel = await boot('live');
    const stranger = net.createServer();
    await new Promise<void>((resolve) => { stranger.listen(0, '127.0.0.1', resolve); });
    const held = (stranger.address() as net.AddressInfo).port;
    try {
      assert.equal(await probePort(kernel.port, kernel.tokens.ui), 'live');
      assert.equal(await probePort(kernel.port, 'the token of another home'), 'stranger');
      await new Promise((resolve) => { stranger.close(resolve); });
      assert.equal(await probePort(held, 'any'), 'free');
    } finally {
      stranger.close();
      await kernel.close();
    }
  });

  test('a fixture says what it is, so it is never taken for the real fleet', async () => {
    const fixture = await boot('fixture');
    try {
      assert.equal(await probePort(fixture.port, fixture.tokens.ui), 'fixture');
    } finally {
      await fixture.close();
    }
  });

  test('a probe never sends the token, and a listener that merely looks like a kernel does not pass', async () => {
    const token = 'the-ui-token-of-this-home-0123456789';
    for (const body of ['{}', '{"kernel":{"pid":1}}', '{"proof":"AAAA"}', '{"proof":7}', 'hello']) {
      const fake = await listener((_req, res) => res.end(body));
      try {
        assert.equal(await probePort(fake.port, token), 'stranger', body);
        assert.ok(fake.seen.length > 0, 'it was asked');
        for (const request of fake.seen) assert.ok(!request.includes(token), 'the token stayed home');
      } finally {
        await fake.close();
      }
    }
  });

  test('a listener cannot pass by relaying the real kernel, or by replaying an old answer', async () => {
    const kernel = await boot('live');
    const relay = await listener(async (req, res) => {
      res.end(await (await fetch(`${kernel.origin}${req.url}`)).text());
    });
    const replay = await listener((_req, res) => res.end(JSON.stringify({ proof: identityProof(kernel.tokens.ui, replay.port, 'live', 'an-old-nonce-of-yesterday') })));
    try {
      assert.equal(await probePort(relay.port, kernel.tokens.ui), 'stranger');
      assert.equal(await probePort(replay.port, kernel.tokens.ui), 'stranger');
    } finally {
      await relay.close();
      await replay.close();
      await kernel.close();
    }
  });

  test('GET /identity gives a proof and nothing else, to anyone', async () => {
    const kernel = await boot('live');
    const identity = (query: string, init?: RequestInit): Promise<Response> => fetch(`${kernel.origin}/identity${query}`, init);
    try {
      const nonce = 'a-nonce-of-sixteen-or-more';
      const reply = await identity(`?nonce=${nonce}`);
      assert.equal(reply.status, 200);
      assert.deepEqual(await reply.json(), { proof: identityProof(kernel.tokens.ui, kernel.port, 'live', nonce) });
      for (const query of ['', '?nonce=short', '?nonce=not%20a%20plain%20nonce%20at%20all']) assert.equal((await identity(query)).status, 400, query);
      assert.equal((await identity(`?nonce=${nonce}`, { method: 'POST' })).status, 405);
    } finally {
      await kernel.close();
    }
  });

  test('a port that cannot be had leaves nothing running', async () => {
    const stranger = await listener((_req, res) => res.end());
    const home = mkdtempSync(path.join(os.tmpdir(), 'naos-taken-'));
    const timers = (): number => process.getActiveResourcesInfo().filter((name) => name === 'Timeout').length;
    const before = timers();
    try {
      await assert.rejects(startKernel({ config: loadConfig({ mode: 'live', port: stranger.port, home }, {}), planes: [], logToStderr: false }), /EADDRINUSE/);
      assert.equal(timers(), before, 'the hub took its timers with it');
    } finally {
      await stranger.close();
      // An open database would make this throw on Windows.
      rmSync(home, { recursive: true });
    }
  });

  describe('a click that cannot attach', () => {
    const request = (home: string, port: number) => ({ config: loadConfig({ mode: 'live', port, home }, {}), idleMinutes: 1, tell() {} });

    test('a fixture of this home is named as what it is', async () => {
      const fixture = await boot('fixture');
      try {
        await assert.rejects(openApp(request(fixture.config.home, fixture.port)), (error: Error) => error instanceof OpenFailure && /fixture holds this home/.test(error.message));
      } finally {
        await fixture.close();
      }
    });

    test('a hung kernel of this home is not called another program', async () => {
      const home = mkdtempSync(path.join(os.tmpdir(), 'naos-hung-'));
      const hung = await listener(() => {});
      writeFileSync(path.join(home, 'kernel.json'), JSON.stringify({ pid: process.pid, port: hung.port, mode: 'live', startedAt: 0 }));
      try {
        await assert.rejects(openApp(request(home, hung.port)), (error: Error) => error instanceof OpenFailure && error.message.includes(`End process ${process.pid}`));
      } finally {
        await hung.close();
        rmSync(home, { recursive: true, force: true });
      }
    });

    test('a stranger is called one', async () => {
      const home = mkdtempSync(path.join(os.tmpdir(), 'naos-strange-'));
      const stranger = await listener((_req, res) => res.end('{}'));
      try {
        await assert.rejects(openApp(request(home, stranger.port)), (error: Error) => error instanceof OpenFailure && /taken by another program/.test(error.message));
      } finally {
        await stranger.close();
        rmSync(home, { recursive: true, force: true });
      }
    });
  });

  test('a stale run file naming a stranger\'s port does not block a start', async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'naos-stale-'));
    const stranger = http.createServer((_req, res) => res.end('hello'));
    await new Promise<void>((resolve) => { stranger.listen(0, '127.0.0.1', resolve); });
    const port = (stranger.address() as net.AddressInfo).port;
    // Our own parent is a live pid, which is what a recycled pid looks like.
    writeFileSync(path.join(home, 'kernel.json'), JSON.stringify({ pid: process.ppid, port, mode: 'live', startedAt: 0 }));
    const kernel = await startKernel({ config: loadConfig({ mode: 'live', port: 0, home }, {}), planes: [], logToStderr: false });
    try {
      assert.notEqual(kernel.config.port, port);
    } finally {
      await kernel.stop();
      stranger.close();
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('the start lock', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'naos-lock-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const file = (name: string): string => path.join(dir, name);

  test('of two takers one wins, until it lets go', () => {
    assert.equal(takeLock(file('a')), true);
    assert.equal(takeLock(file('a')), false);
    rmSync(file('a'));
    assert.equal(takeLock(file('a')), true);
  });

  test('a lock whose holder died is taken over', () => {
    writeFileSync(file('b'), JSON.stringify({ pid: 2 ** 22 + 1, at: Date.now() }));
    assert.equal(takeLock(file('b')), true);
    assert.equal((JSON.parse(readFileSync(file('b'), 'utf8')) as { pid: number }).pid, process.pid);
  });

  test('a lock from long ago is taken over, a reused pid does not hold it for ever', () => {
    writeFileSync(file('c'), JSON.stringify({ pid: process.ppid, at: 0 }));
    assert.equal(takeLock(file('c')), true);
  });

  test('a lock that cannot be read is left alone for a moment, its taker may still be writing it', () => {
    writeFileSync(file('d'), '{');
    assert.equal(takeLock(file('d')), false);
    assert.equal(takeLock(file('d'), Date.now() + 60_000), true);
  });

  test('of two that find a lock stale only one decides, so nobody deletes the fresh lock of the other', () => {
    const dead = JSON.stringify({ pid: 2 ** 22 + 1, at: 0 });
    writeFileSync(file('e'), dead);
    writeFileSync(file('e.stale'), JSON.stringify({ pid: process.pid, at: Date.now() }));
    assert.equal(takeLock(file('e')), false);
    assert.equal(readFileSync(file('e'), 'utf8'), dead);
    rmSync(file('e.stale'));
    assert.equal(takeLock(file('e')), true);
    assert.equal(existsSync(file('e.stale')), false);
  });

  test('a guard whose holder died is cleared for the next try', () => {
    writeFileSync(file('f'), JSON.stringify({ pid: 2 ** 22 + 1, at: 0 }));
    writeFileSync(file('f.stale'), JSON.stringify({ pid: 2 ** 22 + 1, at: 0 }));
    assert.equal(takeLock(file('f')), false);
    assert.equal(takeLock(file('f')), true);
  });
});

describe('first start', () => {
  test('a folder without index.html needs a build', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'naos-dist-'));
    try {
      assert.equal(needsUiBuild(dir), true);
      writeFileSync(path.join(dir, 'index.html'), '');
      assert.equal(needsUiBuild(dir), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a failure lands in a log in the home, and under test it raises nothing', () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'naos-tell-'));
    const stderr = mock.method(process.stderr, 'write', () => true);
    // Off, so that the test runner alone has to hold it back. The raise here is a stub, so nothing real can fire if it does not.
    const noToast = process.env.NAOS_NO_TOAST;
    delete process.env.NAOS_NO_TOAST;
    const raised: string[] = [];
    try {
      tellUser(home, 'Port 1 is taken.', (toast) => raised.push(toast.text));
      assert.match(readFileSync(path.join(home, 'logs', 'open.log'), 'utf8'), /^\S+ Port 1 is taken\.\n$/);
      assert.deepEqual(raised, []);
    } finally {
      process.env.NAOS_NO_TOAST = noToast;
      stderr.mock.restore();
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('the shortcut', () => {
  const spec = shortcutSpec({ nodePath: 'C:\\Program Files\\nodejs\\node.exe', repoRoot: 'C:\\my dev\\naos', windowsDir: 'C:\\Windows' });

  test('it runs wscript, which has no console, and quotes every path', () => {
    assert.equal(spec.target, 'C:\\Windows\\System32\\wscript.exe');
    assert.equal(spec.args, '//nologo //E:jscript "C:\\my dev\\naos\\scripts\\naos-launch.js" "C:\\Program Files\\nodejs\\node.exe"');
    assert.equal(spec.workingDirectory, 'C:\\my dev\\naos');
    assert.equal(spec.icon, 'C:\\my dev\\naos\\packages\\ui\\public\\naos.ico,0');
  });

  test('a test may not reach the real Start menu or Desktop', async () => {
    await assert.rejects(writeShortcuts({ spec, remove: false }), /test/);
    await assert.rejects(writeShortcuts({ spec, remove: true }), /test/);
  });
});
