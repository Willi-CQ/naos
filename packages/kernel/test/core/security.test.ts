import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { COMMAND_SCOPES } from '@naos/protocol';
import type { CommandType } from '@naos/protocol';
import { boot, connect, post, refusedStatus, run } from './helpers.ts';
import type { TestKernel } from './helpers.ts';

/** A raw request, because fetch forbids setting Host and normalises paths. */
function raw(kernel: TestKernel, options: http.RequestOptions, body?: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string }> {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port: kernel.port, ...options }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

describe('security model', () => {
  let kernel: TestKernel;
  const ping = { type: 'admission.get' };

  before(async () => {
    kernel = await boot('fixture');
  });
  after(() => kernel.close());

  test('it binds loopback only', async () => {
    const port = kernel.port;
    const wide = await new Promise<boolean>((resolve) => {
      const addresses = Object.values(os.networkInterfaces()).flat().filter((row) => row && row.family === 'IPv4' && !row.internal);
      const address = addresses[0]?.address;
      if (!address) { resolve(false); return; }
      const socket = net.connect({ host: address, port });
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => resolve(false));
    });
    assert.equal(wide, false, 'nothing may answer on a non-loopback address');
  });

  test('a foreign Host is refused on every route', async () => {
    for (const host of ['evil.example', 'evil.example:80', '127.0.0.1', `127.0.0.1:${kernel.port + 1}`, `naos.localhost:${kernel.port}`]) {
      for (const route of ['/', '/auth?token=x', '/api/status', '/assets/app.js']) {
        const reply = await raw(kernel, { path: route, headers: { host, cookie: kernel.cookie } });
        assert.equal(reply.status, 403, `${host} on ${route}`);
      }
    }
  });

  test('both loopback names are accepted as Host', async () => {
    for (const host of [`127.0.0.1:${kernel.port}`, `localhost:${kernel.port}`, `LOCALHOST:${kernel.port}`]) {
      assert.equal((await raw(kernel, { path: '/', headers: { host } })).status, 200, host);
    }
  });

  test('a foreign Origin is refused on POST, with a valid cookie', async () => {
    const reply = await raw(kernel, {
      path: '/api/cmd', method: 'POST',
      headers: { host: `127.0.0.1:${kernel.port}`, cookie: kernel.cookie, origin: 'http://evil.example', 'content-type': 'application/json' },
    }, JSON.stringify(ping));
    assert.equal(reply.status, 403);
  });

  test('Origin null and a different port are foreign too', async () => {
    for (const origin of ['null', `http://127.0.0.1:${kernel.port + 1}`, `https://127.0.0.1:${kernel.port}`]) {
      const direct = await raw(kernel, {
        path: '/api/cmd', method: 'POST',
        headers: { host: `127.0.0.1:${kernel.port}`, cookie: kernel.cookie, origin, 'content-type': 'application/json' },
      }, JSON.stringify(ping));
      assert.equal(direct.status, 403, origin);
    }
  });

  test('the kernel\'s own origin passes', async () => {
    const reply = await post(kernel, ping, { cookie: kernel.cookie, origin: kernel.origin });
    assert.equal(reply.status, 200);
  });

  test('a foreign Origin or Host is refused on upgrade, with a valid cookie', async () => {
    const url = `ws://127.0.0.1:${kernel.port}/ws`;
    assert.equal(await refusedStatus(url, { cookie: kernel.cookie, origin: 'http://evil.example' }), 403);
    assert.equal(await refusedStatus(url, { cookie: kernel.cookie, host: 'evil.example' }), 403);
  });

  test('an upgrade anywhere but /ws is refused', async () => {
    assert.equal(await refusedStatus(`ws://127.0.0.1:${kernel.port}/other`, { cookie: kernel.cookie }), 404);
  });

  test('missing auth is refused on commands, status and upgrade', async () => {
    assert.equal((await post(kernel, ping, {})).status, 401);
    assert.equal((await post(kernel, ping, { cookie: 'naos_session=forged' })).status, 401);
    assert.equal((await post(kernel, ping, { authorization: 'Bearer forged' })).status, 401);
    assert.equal((await fetch(`${kernel.origin}/api/status`)).status, 401);
    assert.equal(await refusedStatus(`ws://127.0.0.1:${kernel.port}/ws`, {}), 401);
  });

  test('/auth sets an HttpOnly SameSite=Strict cookie that is not the token, and redirects', async () => {
    const reply = await fetch(kernel.url, { redirect: 'manual' });
    assert.equal(reply.status, 302);
    assert.equal(reply.headers.get('location'), '/');
    const cookie = reply.headers.get('set-cookie') ?? '';
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    const value = cookie.split(';')[0]!.split('=')[1]!;
    assert.ok(value.length > 20);
    assert.ok(!cookie.includes(kernel.tokens.ui), 'the token itself is never in the cookie');
  });

  test('/auth refuses a wrong token and sets nothing', async () => {
    const reply = await fetch(`${kernel.origin}/auth?token=wrong`, { redirect: 'manual' });
    assert.equal(reply.status, 401);
    assert.equal(reply.headers.get('set-cookie'), null);
  });

  test('the MCP token cannot exchange for a cookie', async () => {
    const reply = await fetch(`${kernel.origin}/auth?token=${kernel.tokens.mcp}`, { redirect: 'manual' });
    assert.equal(reply.status, 401);
  });

  test('the MCP bearer is refused every UI-only command, and reaches none of them', async () => {
    const bearer = { authorization: `Bearer ${kernel.tokens.mcp}` };
    const uiOnly = (Object.keys(COMMAND_SCOPES) as CommandType[]).filter((type) => !COMMAND_SCOPES[type].includes('mcp'));
    assert.ok(uiOnly.includes('approval.answer') && uiOnly.includes('world.trust') && uiOnly.includes('agent.stopAll'));
    for (const type of uiOnly) {
      const reply = await post(kernel, { type }, bearer);
      assert.equal(reply.status, 403, type);
      assert.equal(reply.body.ok, false);
      if (!reply.body.ok) assert.equal(reply.body.error.code, 'forbidden', type);
    }
  });

  test('approval.answer over MCP leaves the request open', async () => {
    await run(kernel, { type: 'fixture.control', action: 'pause' });
    await run(kernel, { type: 'fixture.control', action: 'seek', value: 30 });
    const open = Object.values(kernel.bus.state().approvals).find((row) => row.status === 'open');
    assert.ok(open, 'the scene has an open approval at t = 30');
    const reply = await post(
      kernel,
      { type: 'approval.answer', requestId: open.requestId, decision: { kind: 'approve' }, clientId: 'agent' },
      { authorization: `Bearer ${kernel.tokens.mcp}` },
    );
    assert.equal(reply.status, 403);
    assert.equal(kernel.bus.state().approvals[open.requestId]?.status, 'open');
  });

  test('the MCP bearer reaches its own commands', async () => {
    assert.equal((await post(kernel, ping, { authorization: `Bearer ${kernel.tokens.mcp}` })).status, 200);
  });

  test('the MCP bearer does not open the stream, because approval input crosses it', async () => {
    assert.equal(await refusedStatus(`ws://127.0.0.1:${kernel.port}/ws`, { authorization: `Bearer ${kernel.tokens.mcp}` }), 401);
  });

  test('the UI bearer serves the CLI', async () => {
    assert.equal((await post(kernel, ping, { authorization: `Bearer ${kernel.tokens.ui}` })).status, 200);
    const client = await connect(kernel, { authorization: `Bearer ${kernel.tokens.ui}` });
    client.close();
  });

  test('POST /api/cmd takes application/json only', async () => {
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', 'application/json-patch+json']) {
      const reply = await post(kernel, ping, { cookie: kernel.cookie, 'content-type': type });
      assert.equal(reply.status, 415, type);
    }
    assert.equal((await post(kernel, ping, { cookie: kernel.cookie, 'content-type': 'Application/JSON; charset=utf-8' })).status, 200);
  });

  test('it is POST only', async () => {
    const reply = await fetch(`${kernel.origin}/api/cmd`, { headers: { cookie: kernel.cookie } });
    assert.equal(reply.status, 405);
  });

  test('bad bodies are refused, and an inherited property is not a command', async () => {
    const send = (text: string): Promise<Response> => fetch(`${kernel.origin}/api/cmd`, {
      method: 'POST', headers: { cookie: kernel.cookie, 'content-type': 'application/json' }, body: text,
    });
    assert.equal((await send('{nope')).status, 400);
    assert.equal((await send('[]')).status, 400);
    assert.equal((await send('"text"')).status, 400);
    for (const type of ['constructor', '__proto__', 'toString', 'nope']) {
      assert.equal((await post(kernel, { type })).status, 400, type);
    }
  });

  test('an oversized body is refused', async () => {
    const reply = await fetch(`${kernel.origin}/api/cmd`, {
      method: 'POST', headers: { cookie: kernel.cookie, 'content-type': 'application/json' }, body: 'x'.repeat(5 * 1024 * 1024),
    });
    assert.equal(reply.status, 413);
  });
});

describe('dev origin', () => {
  test('a configured origin passes, on POST and on upgrade, with its own Host for the Vite proxy', async () => {
    const kernel = await boot('fixture', { devOrigins: ['http://127.0.0.1:5173'] });
    try {
      assert.equal((await post(kernel, { type: 'admission.get' }, { cookie: kernel.cookie, origin: 'http://127.0.0.1:5173' })).status, 200);
      const client = await connect(kernel, { cookie: kernel.cookie, origin: 'http://127.0.0.1:5173', host: '127.0.0.1:5173' });
      client.close();
    } finally {
      await kernel.close();
    }
  });

  test('a dev origin off loopback never widens the Host list', async () => {
    const kernel = await boot('fixture', { devOrigins: ['http://evil.example:5173'] });
    try {
      assert.equal((await raw(kernel, { path: '/', headers: { host: 'evil.example:5173' } })).status, 403);
    } finally {
      await kernel.close();
    }
  });
});

describe('static files', () => {
  let kernel: TestKernel;
  let dir: string;

  before(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'naos-static-'));
    const dist = path.join(dir, 'dist');
    mkdirSync(path.join(dist, 'assets'), { recursive: true });
    writeFileSync(path.join(dist, 'index.html'), '<title>spa</title>');
    writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log(1)');
    writeFileSync(path.join(dir, 'secret.txt'), 'outside dist');
    kernel = await boot('fixture');
    kernel.config.uiDist = dist;
  });
  after(async () => {
    await kernel.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const get = (route: string) => raw(kernel, { path: route, headers: { host: `127.0.0.1:${kernel.port}` } });

  test('files are served without auth, with their type', async () => {
    const reply = await get('/assets/app.js');
    assert.equal(reply.status, 200);
    assert.match(String(reply.headers['content-type']), /javascript/);
    assert.equal(reply.text, 'console.log(1)');
  });

  test('a route with no file falls back to the SPA', async () => {
    assert.equal((await get('/docket/abc')).text, '<title>spa</title>');
    assert.equal((await get('/')).text, '<title>spa</title>');
  });

  test('a missing asset is a 404, not HTML', async () => {
    assert.equal((await get('/assets/missing.js')).status, 404);
  });

  test('path traversal is rejected in every spelling', async () => {
    for (const route of [
      '/../secret.txt', '/..%2fsecret.txt', '/%2e%2e/secret.txt', '/%2e%2e%2fsecret.txt', '/assets/../../secret.txt', '/..\\secret.txt', '/..%5csecret.txt',
      '/assets/%2e%2e/%2e%2e/secret.txt', '/%252e%252e/secret.txt/', '/index.html::$DATA', '/C:/Windows/win.ini', '/secret.txt%00.html',
    ]) {
      const reply = await get(route);
      assert.ok(!reply.text.includes('outside dist'), route);
      assert.notEqual(reply.text, '<title>spa</title>', `${route} must not fall through to the SPA unless it is a plain route`);
    }
  });

  test('a malformed escape does not crash the kernel', async () => {
    assert.equal((await get('/%E0%A4%A')).status, 403);
    assert.equal((await get('/')).status, 200);
  });

  test('a placeholder page answers while dist is missing', async () => {
    kernel.config.uiDist = path.join(dir, 'nowhere');
    const reply = await get('/anything');
    assert.equal(reply.status, 200);
    assert.match(reply.text, /not built/);
  });
});
