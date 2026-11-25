// Who is calling. A per-install token is exchanged at /auth for a cookie that holds an HMAC of it, so the token itself is
// never in a cookie. Bearer tokens serve the CLI and the MCP shim, which have no cookie jar.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import type { AuthScope } from '@naos/protocol';

export interface Tokens {
  ui: string;
  mcp: string;
}

function readOrCreate(file: string): string {
  try {
    const token = readFileSync(file, 'utf8').trim();
    if (token) return token;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const token = randomBytes(32).toString('base64url');
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  return token;
}

export function ensureTokens(home: string): Tokens {
  mkdirSync(home, { recursive: true });
  return { ui: readOrCreate(path.join(home, 'ui.token')), mcp: readOrCreate(path.join(home, 'mcp.token')) };
}

/** Hashing first gives both sides one length, which timingSafeEqual requires. */
export function safeEqual(a: string, b: string): boolean {
  const digest = (value: string): Buffer => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}

const mac = (uiToken: string, message: string): string => createHmac('sha256', uiToken).update(message).digest('base64url');

const sessionValue = (uiToken: string): string => mac(uiToken, 'naos.session.v1');

/**
 * Shows that a listener holds the UI token, with nobody sending it. Bound to the port, so a listener elsewhere cannot relay the
 * real kernel's answer, and to the mode, so a fixture cannot pass for a live kernel.
 */
export const identityProof = (uiToken: string, port: number, mode: string, nonce: string): string =>
  mac(uiToken, `naos.identity.v1:${port}:${mode}:${nonce}`);

/** Only the kernel can write a link to GET /open. The prefixes keep these three apart, so one can never stand in for another. */
export const openSignature = (uiToken: string, docket: string): string => mac(uiToken, `naos.open.v1:${docket}`);

/** Two kernels on 127.0.0.1 share a cookie jar, because cookies ignore the port. */
const cookieName = (port: number): string => `naos_session_${port}`;

export const sessionCookie = (uiToken: string, port: number): string =>
  `${cookieName(port)}=${sessionValue(uiToken)}; Path=/; HttpOnly; SameSite=Strict`;

function readCookie(header: string | undefined, name: string): string | null {
  for (const part of header?.split(';') ?? []) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** The scope of a request, or null. The cookie and the UI token are scope `ui`, the MCP token is scope `mcp`. */
export function authenticate(req: IncomingMessage, tokens: Tokens, port: number): AuthScope | null {
  const cookie = readCookie(req.headers.cookie, cookieName(port));
  if (cookie !== null && safeEqual(cookie, sessionValue(tokens.ui))) return 'ui';
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '');
  if (!match) return null;
  const bearer = match[1]!;
  if (safeEqual(bearer, tokens.ui)) return 'ui';
  if (safeEqual(bearer, tokens.mcp)) return 'mcp';
  return null;
}
