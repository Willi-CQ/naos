// The two checks every request and every upgrade passes before anything else runs. DNS rebinding fails on Host, a web page
// fails on Origin. A request without Origin is not from a browser page: browsers always send it on POST and on upgrade.
import type { IncomingMessage } from 'node:http';

export interface Guard {
  /** null when allowed, otherwise the reason. */
  refuse(req: IncomingMessage): string | null;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost']);

export function createGuard(port: () => number, devOrigins: readonly string[]): Guard {
  const dev = devOrigins.flatMap((origin) => {
    try {
      return [new URL(origin)];
    } catch {
      return [];
    }
  });
  // Vite keeps its own Host on the proxied WebSocket, so a dev origin counts as a host too, but only on loopback.
  const devHosts = dev.filter((url) => LOOPBACK.has(url.hostname)).map((url) => url.host);
  const devOriginSet = new Set(dev.map((url) => url.origin));

  return {
    refuse(req) {
      const own = [`127.0.0.1:${port()}`, `localhost:${port()}`];
      const host = req.headers.host?.toLowerCase();
      if (host === undefined || !(own.includes(host) || devHosts.includes(host))) return 'host';
      const origin = req.headers.origin;
      if (origin === undefined) return null;
      const allowed = own.some((name) => origin === `http://${name}`) || devOriginSet.has(origin);
      return allowed ? null : 'origin';
    },
  };
}
