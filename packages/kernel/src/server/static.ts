// The built UI. Public, as the security model allows: it holds no data, and nothing works without the cookie.
import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
};

const PLACEHOLDER = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>NAOS</title></head>
<body style="background:#000;color:#ccc;font:16px/1.5 monospace;padding:2rem">
<p>NAOS kernel is running. The UI is not built yet: run <code>npm run build</code>.</p>
</body></html>
`;

function plain(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end(`${message}\n`);
}

/** The decoded path, or null when it tries to leave the folder. Checked before any file system call. */
export function safeRelative(rawPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  // `:` covers drive-relative paths and NTFS streams such as `index.html::$DATA`.
  if (/[\0\\:]/.test(decoded)) return null;
  const segments = decoded.split('/');
  if (segments.includes('..') || segments.includes('.')) return null;
  return segments.filter(Boolean).join('/');
}

function send(req: IncomingMessage, res: ServerResponse, file: string, cacheControl: string): void {
  const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'content-length': statSync(file).size, 'cache-control': cacheControl });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

export function serveStatic(req: IncomingMessage, res: ServerResponse, rawPath: string, dist: string): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    plain(res, 405, 'method not allowed');
    return;
  }
  const relative = safeRelative(rawPath);
  if (relative === null) {
    plain(res, 403, 'forbidden');
    return;
  }
  const index = path.join(dist, 'index.html');
  if (!existsSync(index)) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : PLACEHOLDER);
    return;
  }

  if (relative !== '') {
    const root = realpathSync(dist);
    const file = path.join(root, relative);
    if (existsSync(file) && statSync(file).isFile()) {
      // A link inside dist must not reach out of it either.
      const real = realpathSync(file);
      if (real !== root && !real.startsWith(root + path.sep)) {
        plain(res, 403, 'forbidden');
        return;
      }
      send(req, res, real, relative.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      return;
    }
    // A missing file is a 404, so a broken asset URL does not come back as HTML with a 200.
    if (path.extname(relative) !== '') {
      plain(res, 404, 'not found');
      return;
    }
  }
  send(req, res, index, 'no-cache');
}
