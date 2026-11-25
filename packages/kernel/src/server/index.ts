// HTTP and upgrade. Every request passes Host and Origin first. POST /api/cmd is the only route that changes anything, and
// GET /open the only one that starts something, see open.ts. GET /identity answers a challenge, see app/probe.ts.
import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import type { AuthScope, CommandResult } from '@naos/protocol';
import type { KernelBus } from '../bus.ts';
import { SERVER_LIMITS } from '../config.ts';
import type { KernelConfig, Logger } from '../context.ts';
import { authenticate, identityProof, safeEqual, sessionCookie } from './auth.ts';
import type { Tokens } from './auth.ts';
import { createGuard } from './guard.ts';
import { createHub } from './hub.ts';
import type { Hub, HubLimits } from './hub.ts';
import { createOpenRoute } from './open.ts';
import { STATUS_OF } from './router.ts';
import type { KernelRouter } from './router.ts';
import { serveStatic } from './static.ts';

export interface ServerOptions {
  config: KernelConfig;
  bus: KernelBus;
  router: KernelRouter;
  tokens: Tokens;
  log: Logger;
  /** Fields for GET /api/status, which the CLI reads. */
  status(): Record<string, unknown>;
  limits?: HubLimits;
  /** GET /open exists only where this is given, on a live kernel. */
  openWindow?: (docket: string | null) => void;
  /** Someone asked who this is, so a window may be on its way. */
  onIdentity?: () => void;
}

export interface KernelServer {
  readonly hub: Hub;
  listen(port: number): Promise<number>;
  close(): Promise<void>;
}

const CLIENT_ID = /^[\w-]{1,64}$/;
const NONCE = /^[\w-]{16,128}$/;

const HARDENING = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cross-origin-resource-policy': 'same-origin',
};

function text(res: ServerResponse, status: number, message: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(`${message}\n`);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function reply(res: ServerResponse, result: CommandResult): void {
  json(res, result.ok ? 200 : STATUS_OF[result.error.code], result);
}

const isJson = (req: IncomingMessage): boolean =>
  req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() === 'application/json';

/** How far past the limit a body is drained. An answer sent mid upload reaches the client as a reset, not as a 413. */
const DRAIN_FACTOR = 16;

function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        chunks.length = 0;
        if (size > limit * DRAIN_FACTOR) req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(size > limit ? null : Buffer.concat(chunks).toString('utf8')));
    req.on('close', () => resolve(null));
    req.on('error', reject);
  });
}

function refuseUpgrade(socket: Duplex, status: number, reason: string): void {
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

export function createServer(options: ServerOptions): KernelServer {
  const { config, bus, router, tokens, log, status } = options;
  const hub = createHub(bus, log, options.limits ?? SERVER_LIMITS);
  const guard = createGuard(() => config.port, config.devOrigins);
  const sockets = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 4096 });
  const openRoute = options.openWindow ? createOpenRoute(options.openWindow, tokens.ui, log) : null;

  router.afterSuccess((command) => {
    if (command.type === 'craft.watchText' && typeof command.clientId === 'string' && typeof command.nodeId === 'string') {
      hub.watch(command.clientId, command.nodeId, command.on === true);
    }
  });

  const handleCommand = async (req: IncomingMessage, res: ServerResponse, scope: AuthScope): Promise<void> => {
    if (req.method !== 'POST') {
      text(res, 405, 'method not allowed', { allow: 'POST' });
      return;
    }
    if (!isJson(req)) {
      json(res, 415, { ok: false, error: { code: 'bad-request', message: 'application/json only' } });
      return;
    }
    const raw = await readBody(req, SERVER_LIMITS.bodyBytes);
    if (raw === null) {
      res.setHeader('connection', 'close');
      json(res, 413, { ok: false, error: { code: 'limit', message: 'body too large' } });
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      reply(res, { ok: false, error: { code: 'bad-request', message: 'body is not JSON' } });
      return;
    }
    reply(res, await router.dispatch(body, scope));
  };

  const handleAuth = (req: IncomingMessage, res: ServerResponse, url: URL): void => {
    if (req.method !== 'GET') {
      text(res, 405, 'method not allowed', { allow: 'GET' });
      return;
    }
    const token = url.searchParams.get('token');
    if (token === null || !safeEqual(token, tokens.ui)) {
      text(res, 401, 'unauthorized');
      return;
    }
    res.writeHead(302, { location: '/', 'set-cookie': sessionCookie(tokens.ui, config.port), 'cache-control': 'no-store' });
    res.end();
  };

  const handleIdentity = (req: IncomingMessage, res: ServerResponse, url: URL): void => {
    if (req.method !== 'GET') {
      text(res, 405, 'method not allowed', { allow: 'GET' });
      return;
    }
    const nonce = url.searchParams.get('nonce');
    if (nonce === null || !NONCE.test(nonce)) {
      text(res, 400, 'bad request');
      return;
    }
    options.onIdentity?.();
    json(res, 200, { proof: identityProof(tokens.ui, config.port, config.mode, nonce) });
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    for (const [name, value] of Object.entries(HARDENING)) res.setHeader(name, value);
    const refusal = guard.refuse(req);
    if (refusal) {
      log.warn('request refused', { reason: refusal });
      text(res, 403, 'forbidden');
      return;
    }
    // Raw path, before URL parsing removes any `..`, so that static.ts sees what the client really sent.
    const rawPath = (req.url ?? '/').split('?', 1)[0]!;
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (rawPath === '/auth') {
      handleAuth(req, res, url);
      return;
    }
    if (rawPath === '/identity') {
      handleIdentity(req, res, url);
      return;
    }
    if (rawPath === '/open' && openRoute) {
      openRoute(req, res, url);
      return;
    }
    if (rawPath === '/api' || rawPath.startsWith('/api/') || rawPath === '/ws') {
      const scope = authenticate(req, tokens, config.port);
      if (!scope) {
        json(res, 401, { ok: false, error: { code: 'forbidden', message: 'unauthorized' } });
        return;
      }
      if (rawPath === '/api/cmd') await handleCommand(req, res, scope);
      else if (rawPath === '/api/status' && req.method === 'GET') json(res, 200, status());
      else if (rawPath === '/ws') text(res, 426, 'upgrade required', { upgrade: 'websocket' });
      else text(res, 404, 'not found');
      return;
    }
    serveStatic(req, res, rawPath, config.uiDist);
  };

  const http: Server = createHttpServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      log.error('request failed', { error: error instanceof Error ? error.name : 'unknown' });
      if (!res.headersSent) text(res, 500, 'internal error');
      else res.destroy();
    });
  });

  http.on('upgrade', (req, socket, head) => {
    socket.on('error', () => socket.destroy());
    const refusal = guard.refuse(req);
    if (refusal) {
      log.warn('upgrade refused', { reason: refusal });
      refuseUpgrade(socket, 403, 'Forbidden');
      return;
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/ws') {
      refuseUpgrade(socket, 404, 'Not Found');
      return;
    }
    // Approval input crosses this stream, so an MCP token does not open it.
    if (authenticate(req, tokens, config.port) !== 'ui') {
      refuseUpgrade(socket, 401, 'Unauthorized');
      return;
    }
    const clientId = url.searchParams.get('clientId');
    sockets.handleUpgrade(req, socket, head, (ws) => hub.attach(ws, clientId !== null && CLIENT_ID.test(clientId) ? clientId : null));
  });

  return {
    hub,
    listen(port) {
      return new Promise((resolve, reject) => {
        http.once('error', reject);
        http.listen(port, '127.0.0.1', () => {
          http.off('error', reject);
          const address = http.address();
          if (address === null || typeof address === 'string') {
            reject(new Error('no address after listen'));
            return;
          }
          // The Host allowlist needs the real port before the first request, so this runs inside the listen callback.
          config.port = address.port;
          resolve(address.port);
        });
      });
    },
    close() {
      hub.close();
      sockets.close();
      return new Promise((resolve) => {
        http.close(() => resolve());
        http.closeAllConnections();
      });
    },
  };
}
