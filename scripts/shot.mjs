#!/usr/bin/env node
// Real browser, real GPU, no window. Starts a fixture kernel (or uses --url), drives headless Edge, and writes PNGs plus a
// JSON report: renderer, console errors, failed requests, frame times. Read the PNG afterwards, a shot nobody saw proves nothing.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { values: o } = parseArgs({
  options: {
    help: { type: 'boolean' },
    url: { type: 'string' },
    name: { type: 'string', default: 'shot' },
    out: { type: 'string', default: path.join(repo, '.shots') },
    viewport: { type: 'string', default: '1280x800' },
    dpr: { type: 'string', default: '1.5' },
    seek: { type: 'string' },
    pause: { type: 'boolean', default: false },
    idle: { type: 'boolean', default: false },
    reduced: { type: 'boolean', default: false },
    keys: { type: 'string' },
    wait: { type: 'string', default: '1500' },
    frames: { type: 'string', default: '0' },
    eval: { type: 'string' },
    'no-shot': { type: 'boolean', default: false },
    veil: { type: 'boolean', default: false },
    mounted: { type: 'boolean', default: false },
    settled: { type: 'boolean', default: false },
  },
});

if (o.help) {
  console.log(`npm run shot -- [options]
  --url <url>        open this page instead of starting a fixture kernel. It is always veiled
  --veil             veil a fixture page too
  --name <name>      file name, default "shot"
  --out <dir>        output folder, default .shots
  --viewport WxH     CSS size, default 1280x800, the attached panel
  --dpr <n>          device pixel ratio, default 1.5, the attached panel
  --seek <seconds>   move the fixture timeline before the shot
  --pause            pause the fixture timeline after seeking
  --idle             the fixture's morning: 0 craft, the Almanac, nothing moving
  --reduced          prefers-reduced-motion: reduce
  --keys "a b c"     press these keys in order, with 120 ms between them
  --wait <ms>        wait before the shot, default 1500
  --frames <ms>      also measure requestAnimationFrame deltas for this long
  --eval <js>        evaluate this in the page and put the result in the report
  --mounted          wait until the scene has mounted and the Plate has crossfaded away, or report why it did not
  --settled          wait for the first procedural planet surfaces after navigation
  --no-shot          report only`);
  process.exit(0);
}

const freePort = () => new Promise((resolve, reject) => {
  const s = createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

/** The kernel prints one JSON line when it listens: { "event": "ready", "url": ".../auth?token=..." }. */
async function startFixture() {
  const port = await freePort();
  const home = path.join(tmpdir(), `naos-shot-${process.pid}`);
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'packages/kernel/src/cli.ts', 'fixture',
    '--port', String(port), '--home', home, '--no-open'], { cwd: repo, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
  const url = await new Promise((resolve, reject) => {
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d;
      for (const line of buf.split('\n')) {
        try { const m = JSON.parse(line); if (m.event === 'ready') resolve(m.url); } catch { /* still printing */ }
      }
    });
    child.once('exit', (c) => reject(new Error(`fixture kernel exited with ${c}`)));
    setTimeout(() => reject(new Error('fixture kernel did not report ready within 20 s')), 20_000).unref();
  });
  return { child, url };
}

const [w, h] = o.viewport.split('x').map(Number);
const kernel = o.url ? null : await startFixture();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const report = { name: o.name, viewport: o.viewport, dpr: Number(o.dpr), renderer: null, consoleErrors: [], pageErrors: [], failedRequests: [] };

try {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: Number(o.dpr), ...(o.reduced ? { reducedMotion: 'reduce' } : {}) });
  // Before any page script runs, so a real name never reaches a frame, not even the first one.
  if (o.veil || o.url) await ctx.addInitScript(() => localStorage.setItem('naos.settings', JSON.stringify({ veil: true })));
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') report.consoleErrors.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => report.pageErrors.push(String(e)));
  page.on('requestfailed', (r) => report.failedRequests.push(`${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) report.failedRequests.push(`${r.status()} ${r.url()} ${r.request().postData() ?? ''}`); });

  await page.goto(o.url ?? kernel.url, { waitUntil: 'load' });

  // On a cold start the Plate is the picture for a few seconds. A shot that means the scene has to wait for it, or it catches the crossfade.
  if (o.mounted) {
    const up = await page.waitForFunction(() => {
      const s = window.__naos?.getState().scene;
      if (s?.retired) return 'retired';
      const slot = document.getElementById('scene-slot');
      return s?.mounted && slot && Number(getComputedStyle(slot).opacity) > 0.99 ? 'mounted' : false;
    }, null, { timeout: 30_000 }).then((h) => h.jsonValue()).catch(() => 'timeout');
    report.scene = await page.evaluate((how) => ({ how, ...window.__naos?.getState().scene, tier: window.__naos?.getState().scene.tier?.name ?? null, why: window.__naos?.getState().scene.why ?? null }), up);
    if (up !== 'mounted') report.pageErrors.push(`scene did not mount: ${up}, ${report.scene.why ?? 'no reason recorded'}`);
  }

  const fixture = (action, value) => page.evaluate(async ([a, v]) => (await fetch('/api/cmd', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'fixture.control', action: a, value: v }),
  })).json(), [action, value]);
  if (o.seek !== undefined) await fixture('seek', Number(o.seek));
  if (o.idle) { await fixture('idle'); await fixture('pause'); }
  if (o.pause) await fixture('pause');

  for (const key of o.keys?.split(/\s+/).filter(Boolean) ?? []) {
    await page.keyboard.press(key);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(Number(o.wait));
  if (o.settled) {
    const ready = await page.waitForFunction(() => {
      const p = window.__naos?.getState().scene.planets;
      return p && p.ready === p.total;
    }, null, { timeout: 30_000 }).then(() => true).catch(() => false);
    report.planets = await page.evaluate(() => window.__naos?.getState().scene.planets ?? null);
    if (!ready) report.pageErrors.push('planet surfaces did not settle within 30 s');
  }

  report.renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const d = gl?.getExtension('WEBGL_debug_renderer_info');
    return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl ? 'webgl2, renderer hidden' : 'no webgl2';
  });

  const ms = Number(o.frames);
  if (ms > 0) {
    report.frames = await page.evaluate((span) => new Promise((resolve) => {
      const deltas = [];
      let last = performance.now();
      const end = last + span;
      const step = (now) => {
        deltas.push(now - last);
        last = now;
        if (now < end) { requestAnimationFrame(step); return; }
        deltas.sort((a, b) => a - b);
        const at = (q) => Math.round(deltas[Math.floor(q * (deltas.length - 1))] * 10) / 10;
        resolve({ count: deltas.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: at(1) });
      };
      requestAnimationFrame(step);
    }), ms);
  }
  if (o.eval) report.eval = await page.evaluate(o.eval);

  if (!o['no-shot']) {
    mkdirSync(o.out, { recursive: true });
    report.png = path.join(o.out, `${o.name}.png`);
    await page.screenshot({ path: report.png });
  }
} finally {
  await browser.close();
  kernel?.child.kill();
}

mkdirSync(o.out, { recursive: true });
writeFileSync(path.join(o.out, `${o.name}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.pageErrors.length) process.exitCode = 1;
