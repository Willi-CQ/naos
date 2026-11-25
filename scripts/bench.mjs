#!/usr/bin/env node
// Slice 0. Builds the bench page, serves it on a free port, drives it in headless Edge on the real GPU, and writes the numbers
// and the look shots to docs/bench. Headless composites differently from a visible window, so rAF numbers carry that caveat,
// while the timer queries measure the GPU itself. Read the PNGs afterwards: a shot nobody saw proves nothing.
import { createReadStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer as createHttp } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { inflateSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { build } from 'vite';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { values: o } = parseArgs({
  options: {
    help: { type: 'boolean' },
    out: { type: 'string' },
    date: { type: 'string', default: new Date().toISOString().slice(0, 10) },
    only: { type: 'string', default: 'frames,corona,uncapped,look,auto,loss' },
    ms: { type: 'string', default: '12000' },
    quick: { type: 'boolean', default: false },
    'all-shots': { type: 'boolean', default: false },
  },
});

if (o.help) {
  console.log(`node scripts/bench.mjs [options]
  --out <dir>     output folder, default docs/bench, or a temp folder with --quick
  --date <name>   name of the JSON file, default today
  --only <list>   any of frames,corona,uncapped,look,auto,loss
  --ms <n>        measurement span per run, default 12000
  --quick         Umbra only, 4 s spans, for a smoke run
  --all-shots     keep every PNG, not only the ones docs/bench/README.md cites`);
  process.exit(0);
}

const parts = new Set(o.only.split(','));
// A smoke run must never land on the record of a full run. There is no copy of that file anywhere else.
o.out ??= o.quick ? path.join(tmpdir(), 'naos-bench-quick') : path.join(repo, 'docs', 'bench');
const spanMs = o.quick ? 4000 : Number(o.ms);
const tiers = o.quick ? ['Umbra'] : ['Umbra', 'Corona', 'Penumbra'];
const shots = path.join(o.out, 'shots');
mkdirSync(shots, { recursive: true });

// ---- build and serve -------------------------------------------------------
const dist = path.join(tmpdir(), `naos-bench-${process.pid}`);
await build({
  root: path.join(repo, 'packages', 'ui'),
  configFile: path.join(repo, 'packages', 'ui', 'vite.config.ts'),
  logLevel: 'error',
  build: { outDir: dist, emptyOutDir: true, rolldownOptions: { input: path.join(repo, 'packages', 'ui', 'bench.html') } },
});

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.map': 'application/json' };
const server = createHttp((req, res) => {
  const url = new URL(req.url, 'http://x');
  const file = path.join(dist, decodeURIComponent(url.pathname));
  if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/bench.html`;

// ---- browser ---------------------------------------------------------------
const ANGLE = ['--use-angle=d3d11', '--ignore-gpu-blocklist'];
const launch = (extra = []) => chromium.launch({ channel: 'msedge', headless: true, args: [...ANGLE, ...extra] });

const ALLOWED = [/THREE\.Clock: This module has been deprecated/];
const problems = [];

async function open(browser, query, { viewport = [1280, 800], dpr = 1.5, allow = [] } = {}) {
  const context = await browser.newContext({ viewport: { width: viewport[0], height: viewport[1] }, deviceScaleFactor: dpr });
  const page = await context.newPage();
  const note = (kind, text) => {
    if ([...ALLOWED, ...allow].some((re) => re.test(text))) return;
    problems.push({ query, kind, text: text.slice(0, 600) });
  };
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') note(m.type(), m.text()); });
  page.on('pageerror', (e) => note('pageerror', String(e)));
  page.on('requestfailed', (r) => note('requestfailed', r.url()));
  page.on('response', (r) => { if (r.status() >= 400) note('http', `${r.status()} ${r.url()}`); });
  await page.goto(`${base}?${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__bench?.rendered() > 0 || window.__bench?.canvasSize().width > 2, null, { timeout: 30_000 });
  return { context, page };
}

// ---- png probes ------------------------------------------------------------
function decodePng(file) {
  const b = readFileSync(file);
  let at = 8, w = 0, h = 0, type = 0;
  const idat = [];
  while (at < b.length) {
    const len = b.readUInt32BE(at);
    const t = b.toString('latin1', at + 4, at + 8);
    if (t === 'IHDR') { w = b.readUInt32BE(at + 8); h = b.readUInt32BE(at + 12); type = b[at + 17]; }
    if (t === 'IDAT') idat.push(b.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const n = type === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const s = w * n;
  const px = new Uint8Array(w * h * n);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (s + 1)];
    const row = y * (s + 1) + 1;
    for (let x = 0; x < s; x++) {
      const a = x >= n ? px[y * s + x - n] : 0;
      const u = y ? px[(y - 1) * s + x] : 0;
      const c = x >= n && y ? px[(y - 1) * s + x - n] : 0;
      const p = a + u - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - u), pc = Math.abs(p - c);
      px[y * s + x] = (raw[row + x] + [0, a, u, (a + u) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? u : c][f]) & 255;
    }
  }
  return { w, h, n, px, at: (x, y) => { const i = (y * w + x) * n; return [px[i], px[i + 1], px[i + 2]]; } };
}

const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Hue in degrees, chroma 0..1. */
function hue([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return { h: 0, c: 0 };
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: Math.round(((h * 60) + 360) % 360), c: Math.round((d / max) * 100) / 100 };
}

/** Star at free-rect centre, in screenshot px. `disc` and the ring radius come from the same layout the page uses. */
function lookMetrics(file, ref) {
  const img = decodePng(file);
  const cx = 915, cy = 594, disc = 0.082 * 720 * 1.5;
  // Well inside the occluder. The compositor upscales a low tier, and that softens the last two px of the edge.
  let maxDisc = 0;
  for (let y = cy - disc * 0.94 | 0; y < cy + disc * 0.94; y++) {
    for (let x = cx - disc * 0.94 | 0; x < cx + disc * 0.94; x++) {
      if (Math.hypot(x - cx, y - cy) < disc * 0.94) maxDisc = Math.max(maxDisc, Math.max(...img.at(x, y)));
    }
  }
  // The rail is opaque void. If the curve does not hold void, the canvas shows as a rectangle against it.
  const box = (x0, y0, x1, y1) => {
    const s = [0, 0, 0];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const c = img.at(x, y); s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; }
    return s.map((v) => Math.round((v / ((x1 - x0) * (y1 - y0))) * 10) / 10);
  };
  const seam = { rail: box(1500, 1000, 1540, 1040), canvas: box(1436, 1090, 1472, 1130) };
  // Sodium ring: the saturated warm pixels near the well. Hue of nad is about 27 degrees.
  const warm = [];
  for (let y = 480; y < 840; y++) {
    for (let x = 900; x < 1260; x++) {
      const c = img.at(x, y);
      const { h, c: chroma } = hue(c);
      if (luma(c) > 90 && h > 12 && h < 45 && chroma > 0.3) warm.push(c);
    }
  }
  const mean = warm.reduce((a, c) => [a[0] + c[0], a[1] + c[1], a[2] + c[2]], [0, 0, 0]).map((v) => Math.round(v / (warm.length || 1)));
  // Corona energy in rings around the disc.
  const ring = (r0, r1) => {
    let s = 0, n = 0;
    for (let y = cy - r1; y < cy + r1; y++) for (let x = cx - r1; x < cx + r1; x++) { const r = Math.hypot(x - cx, y - cy); if (r >= r0 && r < r1) { s += luma(img.at(x, y)); n++; } }
    return Math.round((s / n) * 10) / 10;
  };
  // Distance to the reference, low passed so a star in a different place does not count.
  let rmse = null;
  if (ref) {
    const r = decodePng(ref);
    const cell = 8;
    let s = 0, n = 0;
    for (let y = 54; y + cell < 1134; y += cell) {
      for (let x = 355; x + cell < 1476; x += cell) {
        let a = 0, b = 0;
        for (let j = 0; j < cell; j++) for (let i = 0; i < cell; i++) { a += luma(img.at(x + i, y + j)); b += luma(r.at(x + i, y + j)); }
        s += ((a - b) / (cell * cell)) ** 2;
        n++;
      }
    }
    rmse = Math.round(Math.sqrt(s / n) * 100) / 100;
  }
  return { discMaxChannel: maxDisc, seam, ringPixels: warm.length, ringMeanRgb: mean, ringHue: hue(mean), corona: { r100_140: ring(100, 140), r140_200: ring(140, 200), r200_280: ring(200, 280), r280_400: ring(280, 400) }, rmseToReference: rmse };
}

/** Over the free rect only: the rail prints a live readout, which would count as a change. */
function pixelDiff(a, b) {
  const A = decodePng(a), B = decodePng(b);
  let max = 0, sum = 0, changed = 0, n = 0;
  for (let y = 54; y < 1134; y++) {
    for (let x = (355 * A.n); x < 1476 * A.n; x++) {
      const d = Math.abs(A.px[y * A.w * A.n + x] - B.px[y * A.w * A.n + x]);
      max = Math.max(max, d);
      sum += d;
      n++;
      if (d > 8) changed++;
    }
  }
  return { maxChannelDelta: max, meanChannelDelta: Math.round((sum / n) * 1000) / 1000, channelsOver8: changed };
}

// ---- runs ------------------------------------------------------------------
const report = {
  date: o.date,
  caveat: 'Headless Edge. rAF intervals here do not include a visible window\'s compositor and display path. Timer query numbers are GPU time and do not depend on that. Other builders were using the machine at the same time, so treat p99 and max as upper bounds.',
  panel: { viewport: '1280x800', dpr: 1.5, free: '748x720' },
  spanMs,
  browser: null,
  renderer: null,
  timer: null,
  stageSeconds: {},
  failures: [],
  frames: [],
  uncapped: [],
  corona: [],
  look: [],
  auto: null,
  loss: null,
  problems,
};

// A run costs minutes and can be stopped at any time, so every stage leaves its numbers on disk. The file goes up in one step.
const reportFile = path.join(o.out, `${o.date}.json`);
function save() {
  writeFileSync(`${reportFile}.tmp`, JSON.stringify(report, null, 2));
  renameSync(`${reportFile}.tmp`, reportFile);
}

async function measure(browser, scene, tier, extra = '', options = {}) {
  const query = `scene=${scene}&tier=${tier}${extra}`;
  const { context, page } = await open(browser, query, options);
  await page.waitForTimeout(1500);
  report.renderer ??= await page.evaluate(() => __bench.renderer());
  report.timer ??= await page.evaluate(() => __bench.hasTimer());
  const size = await page.evaluate(() => __bench.canvasSize());
  const result = await page.evaluate((ms) => __bench.measure(ms), spanMs);
  const sync = options.tag === 'uncapped' ? null : await page.evaluate(async () => ({ one: await __bench.syncFrames(40, 1), ten: await __bench.syncFrames(20, 10) }));
  const name = `${scene}-${tier}${options.tag ? `-${options.tag}` : ''}`;
  await page.screenshot({ path: path.join(shots, `${name}.png`) });
  await context.close();
  const row = { scene, tier, tag: options.tag ?? null, canvas: size, ...result, sync };
  console.log(`${name.padEnd(22)} frames ${String(result.rendered).padStart(5)}  gpu p50 ${result.gpu.p50} p95 ${result.gpu.p95}  raf p95 ${result.raf.p95}  cpu p95 ${result.cpu.p95}  calls ${result.calls}  sync1 ${sync?.one?.p50}  sync10 ${sync?.ten?.p50}`);
  save();
  return row;
}

let browser = await launch();
report.browser = browser.version();

/** One part of the run. A failure is recorded and the next part still runs on a fresh browser, so one stall does not cost the rest. */
async function stage(name, run) {
  if (!parts.has(name)) return;
  const t0 = Date.now();
  try {
    await run();
  } catch (e) {
    const error = String(e?.message ?? e).slice(0, 1200);
    report.failures.push({ stage: name, error });
    console.log(`FAILED ${name}: ${error}`);
    await browser.close().catch(() => {});
    browser = await launch();
  }
  report.stageSeconds[name] = Math.round((Date.now() - t0) / 1000);
  save();
}

try {
  await stage('frames', async () => {
    for (const scene of ['S0', 'S20', 'S20e', 'S60']) {
      for (const tier of tiers) report.frames.push(await measure(browser, scene, tier));
    }
    if (o.quick) return;
    report.frames.push(await measure(browser, 'S120', 'Penumbra'));
    // S0 has no frames to time, so ask for a few on purpose. This is the cost of one redraw at rest.
    for (const tier of tiers) {
      const { context, page } = await open(browser, `scene=S0&tier=${tier}`);
      await page.waitForTimeout(800);
      const pulse = await page.evaluate(async () => {
        const run = __bench.measure(1300);
        for (let i = 0; i < 6; i++) { __bench.render(1); await new Promise((r) => setTimeout(r, 200)); }
        return run;
      });
      report.frames.push({ scene: 'S0-redraw', tier, tag: null, ...pulse });
      console.log(`S0-redraw ${tier}: gpu p50 ${pulse.gpu.p50}, ${pulse.gpu.count} samples`);
      await context.close();
    }
    report.frames.push(await measure(browser, 'S20', 'Corona', '', { viewport: [2560, 1440], dpr: 1, tag: 'W20' }));
  });

  await stage('corona', async () => {
    // Half against full resolution. DESIGN says half, and the ray detail near the limb says otherwise, so measure the price.
    for (const scale of [0.5, 1]) report.corona.push({ scale, ...await measure(browser, 'S20', 'Umbra', `&coronaScale=${scale}`, { tag: `corona${scale}` }) });
  });

  await stage('uncapped', async () => {
    await browser.close();
    browser = await launch(['--disable-gpu-vsync', '--disable-frame-rate-limit']);
    for (const tier of tiers) {
      for (const scene of ['S20', 'S20e']) report.uncapped.push(await measure(browser, scene, tier, '&uncapped=1', { tag: 'uncapped' }));
    }
    await browser.close();
    browser = await launch();
  });

  await stage('look', async () => {
    const salvo = path.join(repo, 'docs', 'design', 'naos-salvo.png');
    const idle = path.join(repo, 'docs', 'design', 'naos-idle.png');
    const variants = [
      { name: 'finish-umbra-6', q: 'tier=Umbra&curve=finish&levels=6' },
      { name: 'agx-umbra-6', q: 'tier=Umbra&curve=agx&levels=6' },
      { name: 'finish-penumbra-4', q: 'tier=Penumbra&curve=finish&levels=4' },
      { name: 'finish-penumbra-6', q: 'tier=Penumbra&curve=finish&levels=6' },
      { name: 'agx-penumbra-4', q: 'tier=Penumbra&curve=agx&levels=4' },
      { name: 'finish-corona-5', q: 'tier=Corona&curve=finish&levels=5' },
    ];
    for (const v of variants) {
      const { context, page } = await open(browser, `scene=LOOK&${v.q}`);
      await page.waitForTimeout(500);
      await page.evaluate(() => __bench.render(3));
      await page.waitForTimeout(500);
      const pulse = await page.evaluate(async () => {
        const run = __bench.measure(1300);
        for (let i = 0; i < 6; i++) { __bench.render(1); await new Promise((r) => setTimeout(r, 200)); }
        return run;
      });
      const file = path.join(shots, `LOOK-${v.name}.png`);
      await page.screenshot({ path: file });
      await context.close();
      const metrics = lookMetrics(file, salvo);
      report.look.push({ ...v, gpuP50: pulse.gpu.p50, gpuPost: pulse.gpuPost.p50, ...metrics });
      console.log(`LOOK ${v.name.padEnd(20)} disc ${metrics.discMaxChannel}  seam ${metrics.seam.canvas} vs ${metrics.seam.rail}  ring ${metrics.ringPixels} px ${JSON.stringify(metrics.ringHue)}  rmse ${metrics.rmseToReference}  gpu ${pulse.gpu.p50}`);
    }
    for (const [name, q, ref] of [['poster-idle', 'scene=S0&tier=Umbra', idle], ['poster-wave', 'scene=LOOK&tier=Umbra&wave=300', path.join(repo, 'docs', 'design', 'naos-wave.png')], ['poster-salvo', 'scene=LOOK&tier=Umbra&salvo=1', salvo]]) {
      const { context, page } = await open(browser, q);
      await page.waitForTimeout(500);
      await page.evaluate(() => __bench.render(3));
      await page.waitForTimeout(500);
      const file = path.join(shots, `${name}.png`);
      await page.screenshot({ path: file });
      await context.close();
      const metrics = lookMetrics(file, ref);
      report.look.push({ name, q, ...metrics });
      console.log(`LOOK ${name.padEnd(20)} disc ${metrics.discMaxChannel}  ring ${metrics.ringPixels} px  rmse ${metrics.rmseToReference}`);
    }
  });

  await stage('auto', async () => {
    // The real switch: start at Penumbra and let the monitor climb. A healthy machine reaches Corona near 61 s.
    const { context, page } = await open(browser, 'scene=S20&tier=Penumbra&auto=1');
    await page.waitForTimeout(o.quick ? 5000 : 66_000);
    const seen = await page.evaluate(() => ({ ...__bench.tierNow(), size: __bench.canvasSize() }));
    await page.screenshot({ path: path.join(shots, 'auto-after-climb.png') });
    report.auto = seen;
    console.log('AUTO', JSON.stringify(seen));
    await context.close();
  });

  await stage('loss', async () => {
    const lossAllow = [/CONTEXT_LOST_WEBGL/, /WebGL context was lost/, /GL_INVALID/];
    const { context, page } = await open(browser, 'scene=LOSS&tier=Umbra', { allow: lossAllow });
    await page.waitForTimeout(1500);
    await page.evaluate(() => { __bench.setCadence('rest'); window.__rail = document.querySelector('[data-rail]'); window.__railText = window.__rail.textContent.replace(/gpu p95.*/, ''); });
    await page.waitForTimeout(300);
    await page.evaluate(() => __bench.render(3));
    await page.waitForTimeout(400);
    const before = path.join(shots, 'LOSS-before.png');
    await page.screenshot({ path: before });
    const framesBefore = await page.evaluate(() => __bench.rendered());

    // Polled on a timer: the default polls on rAF, which stalls with the compositor while the GPU process rebuilds. The budget for
    // the Plate is the page's own plateMs, these limits only say when to give up. On a timeout, say what the page looked like.
    const until = async (what, fn, arg, timeout) => {
      try {
        await page.waitForFunction(fn, arg, { timeout, polling: 50 });
      } catch (e) {
        const seen = await page.evaluate(() => ({ plate: __bench.plate(), lost: document.querySelector('canvas')?.getContext('webgl2')?.isContextLost(), log: __bench.lossLog() })).catch((x) => String(x));
        throw new Error(`${what}: no result in ${timeout} ms, page ${JSON.stringify(seen)}, ${e.name}`);
      }
    };

    const cycle = async (label, n) => {
      await page.evaluate(() => __bench.lose());
      await until(`${label} loss, plate`, () => __bench.plate(), null, 10_000);
      await until(`${label} loss, plate logged`, (k) => __bench.lossLog().filter((e) => e.event === 'plate-up').length >= k, n, 10_000);
      const shot = path.join(shots, `LOSS-${label}-plate.png`);
      await page.screenshot({ path: shot });
      const dom = await page.evaluate(() => ({ same: document.querySelector('[data-rail]') === window.__rail, text: document.querySelector('[data-rail]').textContent.replace(/gpu p95.*/, '') === window.__railText }));
      const t0 = Date.now();
      await page.evaluate(() => __bench.restore());
      await until(`${label} restore`, (k) => __bench.lossLog().filter((e) => e.event === 'restored').length >= k, n, 10_000);
      return { dom, restoreMs: Date.now() - t0 };
    };

    const first = await cycle('first', 1);
    await until('plate down after first restore', () => !__bench.plate(), null, 5000);
    await page.evaluate(() => __bench.render(3));
    await page.waitForTimeout(600);
    const afterFirst = path.join(shots, 'LOSS-after-first.png');
    await page.screenshot({ path: afterFirst });
    const framesAfter = await page.evaluate(() => __bench.rendered());

    const second = await cycle('second', 2);
    await page.waitForTimeout(600);
    const stayedOnPlate = await page.evaluate(() => __bench.plate());
    await page.evaluate(() => { __bench.forceBack(); __bench.render(3); });
    await page.waitForTimeout(800);
    await page.evaluate(() => __bench.render(3));
    await page.waitForTimeout(600);
    const afterSecond = path.join(shots, 'LOSS-after-second.png');
    await page.screenshot({ path: afterSecond });

    report.loss = {
      log: await page.evaluate(() => __bench.lossLog()),
      first, second, stayedOnPlateAfterSecond: stayedOnPlate, framesBefore, framesAfter,
      restoredVsBefore: pixelDiff(before, afterFirst),
      secondRestoredVsBefore: pixelDiff(before, afterSecond),
      // The positive control: the same comparison has to see the Plate, or a zero above proves nothing.
      plateVsBefore: pixelDiff(before, path.join(shots, 'LOSS-first-plate.png')),
    };
    console.log('LOSS', JSON.stringify(report.loss));
    await context.close();
  });
} finally {
  await browser.close().catch(() => {});
  await new Promise((r) => server.close(r));
  rmSync(dist, { recursive: true, force: true });
}

// ---- verdicts --------------------------------------------------------------
const row = (scene, tier, tag = null) => report.frames.find((f) => f.scene === scene && f.tier === tier && f.tag === tag);
const passes = {};
const within = (r, ms) => (r?.raf.p95 ?? 1e9) < ms * 1.05;
if (report.frames.length) {
  const gpuP95 = (r) => r?.gpu.p95 ?? null;
  passes.S0 = { want: 'zero frames at rest', got: row('S0', 'Umbra')?.rendered, pass: row('S0', 'Umbra')?.rendered === 0 };
  passes.S20 = { want: 'rAF p95 under 33.3 ms at Umbra', raf: row('S20', 'Umbra')?.raf.p95, gpu: gpuP95(row('S20', 'Umbra')), pass: within(row('S20', 'Umbra'), 33.3) };
  passes.S20e = { want: 'rAF p95 under 16.7 ms at Corona', raf: row('S20e', 'Corona')?.raf.p95, gpu: gpuP95(row('S20e', 'Corona')), pass: within(row('S20e', 'Corona'), 16.7) };
  passes.S60 = { want: 'rAF p95 under 33.3 ms at Corona', raf: row('S60', 'Corona')?.raf.p95, gpu: gpuP95(row('S60', 'Corona')), pass: within(row('S60', 'Corona'), 33.3) };
  if (row('S120', 'Penumbra')) passes.S120 = { want: 'rAF p95 under 33.3 ms at Penumbra', raf: row('S120', 'Penumbra').raf.p95, gpu: gpuP95(row('S120', 'Penumbra')), pass: within(row('S120', 'Penumbra'), 33.3) };
  if (row('S20', 'Corona', 'W20')) passes.W20 = { want: 'rAF p95 under 33.3 ms at Corona, 2560 x 1440', raf: row('S20', 'Corona', 'W20').raf.p95, gpu: gpuP95(row('S20', 'Corona', 'W20')), pass: within(row('S20', 'Corona', 'W20'), 33.3) };
  // DESIGN 11.5 says what a failure means for the default. Umbra is the default where the canvas is 1.3 MP or less, and it is 1.21 here.
  report.defaultTier = !passes.S60.pass ? 'Penumbra' : !passes.S20.pass ? 'Corona' : 'Umbra';
}
if (report.look.length) {
  const v = (name) => report.look.find((l) => l.name === name);
  // A black disc on the void floor, and a sodium ring that stays sodium.
  const holds = (l) => !!l && l.discMaxChannel <= 12 && l.ringPixels >= 400 && l.ringHue.h >= 18 && l.ringHue.h <= 36;
  passes.LOOK = { want: 'sodium ring and black disc survive at Penumbra, 4 bloom levels', got: Object.fromEntries(report.look.filter((l) => l.q?.includes('curve=')).map((l) => [l.name, holds(l)])), pass: holds(v('finish-penumbra-4')) };
}
if (report.loss) {
  const l = report.loss;
  const ups = l.log.filter((e) => e.event === 'plate-up');
  passes.LOSS = {
    want: 'Plate in under 1 s, DOM untouched, restore rebuilds, stays on the Plate after the second loss',
    plateMs: ups.map((e) => Math.round(e.plateMs)),
    pass: ups.length === 2 && ups.every((e) => e.plateMs < 1000) && l.first.dom.same && l.first.dom.text && l.second.dom.same && l.second.dom.text
      && l.framesAfter > l.framesBefore && l.stayedOnPlateAfterSecond && l.restoredVsBefore.channelsOver8 === 0 && l.secondRestoredVsBefore.channelsOver8 === 0,
  };
}
report.passes = passes;
report.clean = problems.length === 0 && report.failures.length === 0;
save();

// A full run writes 45 MB of PNGs. These are the ones the README cites; compare-* are crops made from them by hand.
const CITED = new Set(['S20e-Umbra.png', 'S120-Penumbra.png', 'LOOK-finish-umbra-6.png', 'LOOK-agx-umbra-6.png', 'LOOK-finish-penumbra-4.png', 'poster-salvo.png', 'LOSS-first-plate.png', 'compare-corona.png', 'compare-hairlines.png']);
if (!o['all-shots']) for (const f of readdirSync(shots)) if (f.endsWith('.png') && !CITED.has(f)) rmSync(path.join(shots, f));

console.log(JSON.stringify({ stageSeconds: report.stageSeconds, defaultTier: report.defaultTier, passes, problems: problems.length, failures: report.failures }, null, 2));
if (problems.length) console.log(JSON.stringify(problems.slice(0, 12), null, 2));
process.exit(report.clean ? 0 : 1);
