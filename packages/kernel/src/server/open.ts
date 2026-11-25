// GET /open?docket=<id>&sig=<mac>, the target of a toast click. The click lands in the default browser, which has no session,
// because the cookie lives in the app window's own profile. So this route holds no data and needs no auth: it asks the kernel to
// open that window. The signature is what guards it: only the kernel can write the link, and no request header can tell a redirect
// from a click. The fetch metadata is a second layer, for a link that got out of the toast.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Logger } from '../context.ts';
import { openSignature, safeEqual } from './auth.ts';

const DOCKET = /^[\w.:-]{1,128}$/;
const OPENS_PER_MINUTE = 5;

/** A request id needs no escaping in a fragment, so what reaches main.tsx is what the kernel sent. */
export const validDocket = (id: string): boolean => DOCKET.test(id);

export function openLink(origin: string, uiToken: string, requestId: string): string {
  const docket = validDocket(requestId) ? requestId : '';
  return `${origin}/open?${docket ? `docket=${docket}&` : ''}sig=${openSignature(uiToken, docket)}`;
}

/**
 * Null when this is a navigation no web page started. A missing header is not trusted, since browsers always send these two.
 * Speculation rules arrive as site `none` and mode `navigate` too, so `Sec-Purpose` is what tells them from a click.
 * `Sec-Fetch-User` is not asked for: it needs user activation, and whether a toast's protocol activation counts as that is up
 * to the default browser. Requiring it could turn every toast click into a bare 403, and the signature is the real guard.
 */
export function refuseOpen(headers: IncomingMessage['headers']): string | null {
  if (headers['sec-fetch-site'] !== 'none') return 'sec-fetch-site';
  if (headers['sec-fetch-mode'] !== 'navigate') return 'sec-fetch-mode';
  return headers['sec-purpose'] !== undefined || headers.purpose !== undefined ? 'sec-purpose' : null;
}

export function createRateGate(limit: number, windowMs: number, now: () => number = Date.now): () => boolean {
  const hits: number[] = [];
  return () => {
    const at = now();
    while (hits.length > 0 && at - hits[0]! >= windowMs) hits.shift();
    if (hits.length >= limit) return false;
    hits.push(at);
    return true;
  };
}

/** The tab has one history entry, which lets it close itself. If the browser declines, the sentence is what remains. */
const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="color-scheme" content="dark"><title>NAOS</title></head>
<body style="background:#060504;color:#bfb3a1;font:14px/1.5 monospace;padding:2rem">
<p>NAOS opened in its own window. You can close this tab.</p><script>window.close()</script>
</body></html>
`;

function plain(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end(`${message}\n`);
}

export type OpenRoute = (req: IncomingMessage, res: ServerResponse, url: URL) => void;

export function createOpenRoute(open: (docket: string | null) => void, uiToken: string, log: Logger): OpenRoute {
  const gate = createRateGate(OPENS_PER_MINUTE, 60_000);
  const forbid = (res: ServerResponse, reason: string): void => {
    log.warn('open refused', { reason });
    plain(res, 403, 'forbidden');
  };
  return (req, res, url) => {
    if (req.method !== 'GET') {
      res.setHeader('allow', 'GET');
      plain(res, 405, 'method not allowed');
      return;
    }
    const refusal = refuseOpen(req.headers);
    if (refusal) {
      forbid(res, refusal);
      return;
    }
    const docket = url.searchParams.get('docket');
    if (docket !== null && !validDocket(docket)) {
      plain(res, 400, 'bad request');
      return;
    }
    if (!safeEqual(url.searchParams.get('sig') ?? '', openSignature(uiToken, docket ?? ''))) {
      forbid(res, 'signature');
      return;
    }
    // Last, so that nothing the kernel did not write can use up the turns of a real click.
    if (!gate()) {
      plain(res, 429, 'too many requests');
      return;
    }
    open(docket);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(PAGE);
  };
}
