// Layer 3 in the real app, against a fixture kernel, in headless Edge on the real GPU: rest on each kind of power, cadence, the Plate swap
// both ways, the lazy chunk, the Veil on the labels, reduced motion, the sky as a place. Prints pass or fail per check, plus the frame
// numbers. Kills what it starts. The power state is set per page, so a run proves both rules whatever the laptop is doing.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values: o } = parseArgs({ options: { out: { type: 'string' }, only: { type: 'string', default: 'all' } } });
const parts = new Set(o.only.split(','));
const includes = (name) => parts.has('all') || parts.has(name);
const home = mkdtempSync(path.join(tmpdir(), 'naos-e2e-scene-'));
const shots = o.out ?? path.join(home, 'shots');
mkdirSync(shots, { recursive: true });

const freePort = () => new Promise((res) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
const port = await freePort();
const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'packages/kernel/src/cli.ts', 'fixture', '--port', String(port), '--home', home, '--no-open'], { cwd: repo, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
const url = await new Promise((resolve, reject) => {
  let buf = '';
  child.stdout.on('data', (d) => { buf += d; for (const l of buf.split('\n')) { try { const m = JSON.parse(l); if (m.event === 'ready') resolve(m.url); } catch { /* still printing */ } } });
  setTimeout(() => reject(new Error('no ready')), 20_000).unref();
});

let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra === '' ? '' : `  [${extra}]`}`); if (!ok) fails += 1; };
const numbers = {};

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const errors = [];
const watch = (page) => {
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`page: ${e}`));
};

/** `charging` stands a page on mains or on battery, whichever the laptop is really on, because ruling 22 makes rest depend on it. */
async function open(options = {}, settings = null, charging = true) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5, ...options });
  if (settings) await ctx.addInitScript((s) => localStorage.setItem('naos.settings', JSON.stringify(s)), settings);
  await ctx.addInitScript((on) => { Object.defineProperty(navigator, 'getBattery', { value: async () => ({ charging: on, addEventListener() {}, removeEventListener() {} }) }); }, charging);
  const page = await ctx.newPage();
  watch(page);
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto(url, { waitUntil: 'load' });
  return { ctx, page, requests };
}

const fixture = (page, action, value) => page.evaluate(async ([a, v]) => (await fetch('/api/cmd', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'fixture.control', action: a, value: v }) })).json(), [action, value]);
const mounted = async (page) => {
  await page.waitForFunction(() => {
    const s = window.__naos.getState().scene;
    return s.mounted || s.retired;
  }, null, { timeout: 30_000 });
  const s = await page.evaluate(() => window.__naos.getState().scene);
  if (!s.mounted) throw new Error(`scene retired while mounting: ${s.why ?? 'no reason recorded'}`);
};
const scene = (page) => page.evaluate(() => { const s = window.__naos.getState().scene; return { mounted: s.mounted, context: s.context, cadence: s.cadence, retired: s.retired, tier: s.tier?.name ?? null }; });
const worldsReady = (page) => page.waitForFunction(() => {
  const p = window.__naos.getState().scene.planets;
  return p && p.ready === p.total && !p.baking;
}, null, { timeout: 30_000 });
const frames = (page) => page.evaluate(() => window.__naosScene?.stats.frames ?? -1);
const shot = (page, name) => page.screenshot({ path: path.join(shots, `${name}.png`) });
const has = (page, sel) => page.evaluate((s) => document.querySelector(s) !== null, sel);
const slotVisible = (page) => page.evaluate(() => { const e = document.getElementById('scene-slot'); const c = getComputedStyle(e); return c.visibility === 'visible' && Number(c.opacity) > 0.99; });
const quietPeriod = (page, ms) => page.waitForTimeout(ms);

/** Pixels of one PNG against another, in the page, over the free rect only. Returns the largest channel difference and how many channels moved. */
const compare = (page, a, b) => page.evaluate(async ([ua, ub]) => {
  const load = async (u) => { const i = new Image(); i.src = u; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const g = c.getContext('2d'); g.drawImage(i, 0, 0); return g.getImageData(354, 54, 1122, 1080).data; };
  const [x, y] = await Promise.all([load(ua), load(ub)]);
  let changed = 0; let max = 0;
  for (let i = 0; i < x.length; i += 1) { const d = Math.abs(x[i] - y[i]); if (d > 3) changed += 1; if (d > max) max = d; }
  return { changed, max };
}, [a, b]);
const dataUrl = async (page) => `data:image/png;base64,${(await page.screenshot()).toString('base64')}`;

const words = ['kestrel', 'tundra', 'harbor', 'mosaic', 'lumen', 'quill', 'ferro'];

try {
  // ---- S0 on battery: nothing moves, nothing renders -----------------------------------------------------------------------------
  if (includes('battery')) {
    const { page, ctx, requests } = await open({}, null, false);
    const t0 = Date.now();
    await mounted(page);
    numbers.firstSceneFrameMs = await page.evaluate(() => Math.round(window.__naosScene.stats.firstFrameAt));
    check('the three chunk loads when the scene is on', requests.some((u) => /three-.*\.js/.test(u)));
    numbers.mountedAfterMs = Date.now() - t0;
    await fixture(page, 'idle');
    await fixture(page, 'pause');
    await page.waitForFunction(() => window.__naos.getState().model.craftCount === 0);
    await page.waitForTimeout(6500);
    check('idle on battery: cadence is alive, which battery runs at 0 Hz', (await scene(page)).cadence === 'alive', JSON.stringify(await scene(page)));
    const a = await frames(page);
    await quietPeriod(page, 12_000);
    const b = await frames(page);
    numbers.S0 = { frames: b - a, spanMs: 12_000 };
    check('S0: zero canvas frames in 12 s', b - a === 0, `${b - a} frames`);
    // The page itself: no rAF held open by the scene at rest.
    const wakeups = await page.evaluate(() => new Promise((resolve) => {
      const real = window.requestAnimationFrame;
      let n = 0;
      window.requestAnimationFrame = (f) => { n += 1; return real.call(window, f); };
      setTimeout(() => { window.requestAnimationFrame = real; resolve(n); }, 3000);
    }));
    check('rest parks the scheduler: no rAF in 3 s', wakeups === 0, `${wakeups} rAF calls`);
    await shot(page, 'S0-idle');
    check('Almanac shows', await has(page, '.almanac'));
    check('the rail is the away list', (await page.textContent('.right')).includes('WHILE YOU WERE AWAY'));
    const labels = await page.evaluate(() => [...document.querySelectorAll('.labels .lbl[data-on=true]')].map((e) => e.textContent));
    check('30 pooled nodes, 7 world labels on', (await page.locator('.labels .lbl').count()) === 30 && labels.length >= 6, labels.join(' | '));

    // World positions: the scene against the chart the Plate draws.
    const placed = await page.evaluate(() => {
      const c = window.__naosScene;
      const canvas = document.querySelector('#scene-slot canvas');
      const box = canvas.getBoundingClientRect();
      const free = window.__naos.getState().shell.free;
      return { worlds: c.worldsOnCanvas(), canvas: [box.left, box.top, box.width, box.height], free };
    });
    check('the canvas is exactly the free rect', placed.canvas[0] === placed.free.x && placed.canvas[1] === placed.free.y && placed.canvas[2] === placed.free.w && placed.canvas[3] === placed.free.h, JSON.stringify(placed.canvas));
    await ctx.close();
  }

  // ---- Ruling 22 on mains: alive at 30 Hz, nothing hidden, physics moves and a craft does not --------------------------------------
  if (includes('mains')) {
    const { page, ctx } = await open();
    await mounted(page);
    await fixture(page, 'idle');
    await fixture(page, 'pause');
    await page.waitForFunction(() => window.__naos.getState().model.craftCount === 0);
    await page.waitForTimeout(2500);
    check('idle on mains: cadence is alive', (await scene(page)).cadence === 'alive', JSON.stringify(await scene(page)));
    const a = await frames(page);
    const spinA = await page.evaluate(() => window.__naosScene.worldStates().map((w) => w.spin));
    await page.waitForTimeout(4000);
    const b = await frames(page);
    const spinB = await page.evaluate(() => window.__naosScene.worldStates().map((w) => w.spin));
    numbers.alive = { frames: b - a, spanMs: 4000 };
    check('ruling 22: 30 Hz at rest on mains', b - a > 96 && b - a < 136, `${b - a} frames in 4 s`);
    check('ruling 22: planets turn while nothing else happens', spinA.length > 0 && spinA.every((v, i) => v !== spinB[i]));
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(500);
    const c = await frames(page);
    await page.waitForTimeout(2000);
    check('ruling 22: a hidden window is 0 Hz', (await frames(page)) === c, `${(await frames(page)) - c} frames`);
    await ctx.close();
  }

  // ---- The sky as a place -----------------------------------------------------------------------------------------------------------
  if (includes('sky')) {
    const { page, ctx } = await open({}, { idleDrift: false });
    await mounted(page);
    await fixture(page, 'seek', 60);
    await page.waitForTimeout(1500);
    // The brightest stars of the month, looked up in the environment cube. A face the wrong way around would find black there.
    const probe = await page.evaluate(() => {
      const c = window.__naosScene;
      const sky = c.currentSky();
      const order = Array.from({ length: sky.stars.count }, (_, i) => i).sort((a, b) => sky.stars.color[b * 3] - sky.stars.color[a * 3]).slice(0, 24);
      const at = (d) => { const v = c.state.probeSky(d); return v ? v[0] + v[1] + v[2] : -1; };
      const on = []; const off = [];
      for (const i of order) {
        const d = [sky.stars.dir[i * 3], sky.stars.dir[i * 3 + 1], sky.stars.dir[i * 3 + 2]];
        on.push(at(d));
        off.push(at([-d[0], d[2], -d[1]]));
      }
      return { on, off, count: sky.stars.count };
    });
    const hit = probe.on.filter((v) => v > 0.02).length;
    numbers.cube = { hit, of: probe.on.length, stars: probe.count };
    check('environment cube: the month stands where the sky says, every face the right way around', probe.count > 0 && hit >= probe.on.length * 0.8, `${hit} of ${probe.on.length} brightest stars found`);
    const mips = await page.evaluate(() => { const gl = document.querySelector('#scene-slot canvas').getContext('webgl2'); return { err: gl.getError(), ext: !!gl.getExtension('EXT_color_buffer_float') }; });
    check('environment cube: drawn with no GL error', mips.err === 0, JSON.stringify(mips));
    // A sky that is a place: turn the camera, and a star keeps its direction, so the picture slides by the same angle the camera turned.
    const stars = await page.evaluate(async () => {
      const c = window.__naosScene;
      const at0 = c.flightNow().stance;
      const d = [c.currentSky().stars.dir[0], c.currentSky().stars.dir[1], c.currentSky().stars.dir[2]];
      const seen = () => { const v = c.camera.position.clone(); const m = c.camera.matrixWorldInverse.elements; const x = m[0] * d[0] + m[4] * d[1] + m[8] * d[2]; const y = m[1] * d[0] + m[5] * d[1] + m[9] * d[2]; const z = m[2] * d[0] + m[6] * d[1] + m[10] * d[2]; return [x, y, z, v.x]; };
      const before = seen();
      c.rig.stand(at0.az + 0.5, at0.el, at0.dist);
      const after = seen();
      c.rig.stand(at0.az, at0.el, at0.dist);
      return { dot: before[0] * after[0] + before[1] * after[1] + before[2] * after[2] };
    });
    check('the sky is at infinity: a star turns by exactly what the camera turned', Math.abs(stars.dot - Math.cos(0.5)) < 0.45 && stars.dot < 0.98, String(stars.dot));
    await ctx.close();
  }

  // ---- The Plate swap, in both directions -----------------------------------------------------------------------------------------
  if (includes('swap')) {
    // Reduced motion and battery, so nothing turns between the two pictures this compares. Physics would move the city lights.
    const { page, ctx } = await open({ reducedMotion: 'reduce' }, { idleDrift: false }, false);
    await mounted(page);
    await fixture(page, 'idle');
    await fixture(page, 'pause');
    await page.waitForFunction(() => window.__naos.getState().model.craftCount === 0);
    await page.waitForTimeout(1200);
    await worldsReady(page);
    const before = await dataUrl(page);
    await shot(page, 'swap-scene');
    const manifest = await page.evaluateHandle(() => document.querySelector('.manifest'));

    // First loss. The Plate must be the picture on the very next frame, without waiting for React.
    const first = await page.evaluate(() => new Promise((resolve) => {
      const slot = document.getElementById('scene-slot');
      const t0 = performance.now();
      window.__naosScene.lose();
      const look = () => {
        const c = getComputedStyle(slot);
        if (c.visibility === 'hidden') resolve({ ms: performance.now() - t0, banner: document.querySelector('[data-kind=scene-lost]') !== null });
        else requestAnimationFrame(look);
      };
      look();
    }));
    numbers.lossPlateMs = first.ms;
    check('loss: the canvas is off the screen at once', first.ms < 100, `${first.ms.toFixed(1)} ms`);
    await page.waitForSelector('.banner[data-kind=scene-lost]', { timeout: 2000 });
    check('loss: banner reads Scene lost, recovering', (await page.textContent('.banner[data-kind=scene-lost]')) === 'Scene lost, recovering');
    check('loss: Plate is the picture', await has(page, '.plate svg') && !(await slotVisible(page)));
    check('loss: the DOM is the same node', await page.evaluate((m) => m === document.querySelector('.manifest'), manifest));
    await shot(page, 'swap-plate');
    await page.keyboard.press('?');
    await page.waitForTimeout(150);
    check('loss: the keyboard still works', await has(page, '.dialog'));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    await page.evaluate(() => window.__naosScene.restore());
    await mounted(page);
    await worldsReady(page);
    await page.waitForTimeout(500);
    check('restored: scene back, banner gone', (await slotVisible(page)) && !(await has(page, '.banner[data-kind=scene-lost]')), JSON.stringify(await scene(page)));
    const after = await dataUrl(page);
    await shot(page, 'swap-restored');
    const delta = await compare(page, before, after);
    numbers.lossRebuild = delta;
    check('restored: same picture as before the loss', delta.changed < 400, JSON.stringify(delta));

    // Second loss inside 10 minutes: stays on the Plate until reload, DESIGN 11.7.
    await page.evaluate(() => window.__naosScene.lose());
    await page.waitForFunction(() => window.__naos.getState().scene.context === 'lost');
    await page.waitForTimeout(200);
    await page.evaluate(() => window.__naosScene.restore());
    await page.waitForFunction(() => window.__naos.getState().scene.retired, null, { timeout: 5000 });
    await page.waitForTimeout(900);
    check('second loss: on the Plate until reload', !(await has(page, '#scene-slot canvas')) && !(await has(page, '.banner[data-kind=scene-lost]')), JSON.stringify(await scene(page)));
    check('second loss: the caption says so', await has(page, '.free-caption'));
    await page.reload({ waitUntil: 'load' });
    await mounted(page);
    check('reload brings the scene back', true);
    await ctx.close();
  }

  // ---- settings.scene and the lazy chunk ------------------------------------------------------------------------------------------
  if (includes('settings')) {
    const { page, ctx, requests } = await open({}, { scene: false });
    await page.waitForTimeout(1500);
    check('scene off: the three chunk never loads', !requests.some((u) => /(three|r3f|Live)-.*\.js/.test(u)), requests.filter((u) => /assets/.test(u)).map((u) => u.split('/').pop()).join(' '));
    check('scene off: no canvas in the slot, the Plate shows', !(await has(page, '#scene-slot canvas')) && await has(page, '.plate svg'));
    check('scene off: caption', await has(page, '.free-caption'));
    await page.evaluate(() => {
      const naos = window.__naos; const s = naos.getState();
      naos.setState({ view: { ...s.view, settings: { ...s.view.settings, scene: true } } });
    });
    await mounted(page);
    check('scene on: the chunk arrives on demand', requests.some((u) => /three-.*\.js/.test(u)));
    await page.waitForTimeout(300);
    check('scene on: visible', await slotVisible(page));
    await page.evaluate(() => {
      const naos = window.__naos; const s = naos.getState();
      naos.setState({ view: { ...s.view, settings: { ...s.view.settings, scene: false } } });
    });
    const during = await page.evaluate(() => new Promise((resolve) => {
      const slot = document.getElementById('scene-slot');
      const t0 = performance.now();
      const seen = [];
      const look = () => { seen.push(Number(getComputedStyle(slot).opacity)); if (performance.now() - t0 < 300) requestAnimationFrame(look); else resolve(seen); };
      look();
    }));
    check('scene off at run time: it fades, it does not cut', during.some((v) => v > 0.1 && v < 0.9), during.slice(0, 6).map((v) => v.toFixed(2)).join(' '));
    await page.waitForTimeout(900);
    check('scene off at run time: the canvas is gone', !(await has(page, '#scene-slot canvas')));
    await ctx.close();
  }

  // ---- Cruise, the Sky, the Veil, the fleet at the reference moment ---------------------------------------------------------------
  if (includes('fleet')) {
    const { page, ctx } = await open();
    await mounted(page);
    await fixture(page, 'seek', 60);
    await page.waitForFunction(() => window.__naos.getState().model.craftCount === 20);
    await page.waitForTimeout(1500);
    check('t=60: cadence is cruise', (await scene(page)).cadence === 'cruise', JSON.stringify(await scene(page)));
    await shot(page, 'S20-t60');
    const m = await page.evaluate(() => window.__naosScene.measure(12_000));
    numbers.t60 = { frames: m.frames, spanMs: Math.round(m.spanMs), gpu: m.gpu, gpuPre: m.gpuPre, gpuScene: m.gpuScene, gpuPost: m.gpuPost, cpu: m.cpu, calls: m.calls, triangles: m.triangles, points: m.points, disjoint: m.disjoint };
    // Holds for a mains cadence. A busier fixture moment can only raise it toward the event rate.
    check('t=60: 30 Hz and up on mains', m.frames > 30 * 10 && m.frames < 60 * 13, `${m.frames} in ${Math.round(m.spanMs)} ms`);
    check('t=60: GPU p95 under the 16.7 ms of an event frame', m.gpu.p95 > 0 && m.gpu.p95 < 16.7, `${m.gpu.p95} ms over ${m.gpu.count} samples`);

    await page.keyboard.press('Space');
    await page.waitForSelector('.dk-btns');
    await page.waitForTimeout(500);
    const dimmed = await page.evaluate(() => ({ dim: window.__naosScene.state.dim, opacity: getComputedStyle(document.getElementById('scene-slot')).opacity }));
    check('docket: the scene dims in its own shader, the Plate never shows through', dimmed.dim === 0.45 && dimmed.opacity === '1', JSON.stringify(dimmed));
    await shot(page, 'docket');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    check('docket closed: the dim lifts', (await page.evaluate(() => window.__naosScene.state.dim)) === 1);

    await page.keyboard.press('t');
    const fade = await page.evaluate(() => new Promise((resolve) => setTimeout(() => resolve(Number(getComputedStyle(document.getElementById('scene-slot')).opacity)), 200)));
    check('Sky: a crossfade, not a cut', fade > 0.05 && fade < 0.95, String(fade));
    await page.waitForTimeout(700);
    check('Sky: canvas hidden, cadence rest', !(await slotVisible(page)) && (await scene(page)).cadence === 'rest');
    const f1 = await frames(page);
    await page.waitForTimeout(2000);
    check('Sky: the canvas rests', (await frames(page)) === f1, `${(await frames(page)) - f1} frames`);
    await shot(page, 'sky');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
    check('Sky closed: the scene is back', await slotVisible(page));

    // Hit targets: the canvas covers the Plate, so the scene answers for it.
    const world = await page.evaluate(() => { const c = window.__naosScene; const w = c.worldsOnCanvas()[0]; const f = window.__naos.getState().shell.free; return { x: f.x + f.w / 2 + w.x, y: f.y + f.h / 2 + w.y, id: w.id }; });
    await page.mouse.click(world.x, world.y);
    await page.waitForTimeout(100);
    check('a click on a world selects it', (await page.evaluate(() => window.__naos.getState().view.selectedWorld)) === world.id);

    await page.keyboard.press('v');
    await page.waitForTimeout(350);
    const leak = await page.evaluate((list) => {
      const text = document.querySelector('.labels').outerHTML.toLowerCase();
      return list.filter((w) => text.includes(w));
    }, words);
    const veiled = await page.evaluate(() => [...document.querySelectorAll('.labels .lbl[data-on=true]')].map((e) => e.textContent));
    check('Veil: no real name in the labels', leak.length === 0 && veiled.length > 0, `${leak.join(',')} shown: ${veiled.join(' | ')}`);
    await page.keyboard.press('v');
    await page.waitForTimeout(350);
    check('Veil off: names return', (await page.textContent('.labels')).includes('harbor'));

    // Tier by setting, on the running canvas.
    await page.evaluate(() => {
      const naos = window.__naos; const s = naos.getState();
      naos.setState({ view: { ...s.view, settings: { ...s.view.settings, quality: 'Penumbra' } } });
    });
    await page.waitForTimeout(800);
    const penumbra = await page.evaluate(() => { const c = document.querySelector('#scene-slot canvas'); return [c.width, c.height, window.__naos.getState().scene.tier?.name]; });
    check('settings.quality reaches the canvas', penumbra[2] === 'Penumbra' && penumbra[0] === 785, penumbra.join(' '));
    await ctx.close();
  }

  // ---- Reduced motion ---------------------------------------------------------------------------------------------------------
  if (includes('reduced')) {
    const { page, ctx } = await open({ reducedMotion: 'reduce' });
    await mounted(page);
    await fixture(page, 'seek', 60);
    await page.waitForFunction(() => window.__naos.getState().model.craftCount === 20);
    await page.waitForTimeout(800);
    const a = await page.evaluate(() => window.__naosScene.state.tokenClock);
    await page.waitForTimeout(1500);
    const b = await page.evaluate(() => window.__naosScene.state.tokenClock);
    check('reduced motion: corona flow frozen', a === b && !(await page.evaluate(() => window.__naosScene.state.tokensMoving)), `${a} ${b}`);
    const spin = await page.evaluate(() => window.__naosScene.worldStates().map((w) => w.spin).join());
    const f0 = await frames(page);
    await page.waitForTimeout(1500);
    // Two frames per kernel tick for a beacon are the old rest rule, and they stay.
    check('reduced motion: no physics, and nothing but beacons draws', spin === await page.evaluate(() => window.__naosScene.worldStates().map((w) => w.spin).join()) && (await frames(page)) - f0 <= 8, `${(await frames(page)) - f0} frames`);
    await ctx.close();
  }

  // ---- Link lost: the scene freezes, 40 % desaturated, and stops --------------------------------------------------------------------
  if (includes('link')) {
    const { page, ctx } = await open();
    await mounted(page);
    await fixture(page, 'seek', 60);
    await page.waitForFunction(() => window.__naos.getState().model.craftCount === 20);
    await page.waitForTimeout(800);
    child.kill();
    await page.waitForFunction(() => window.__naos.getState().link.status === 'lost', null, { timeout: 8000 });
    await page.waitForTimeout(800);
    const a = await frames(page);
    await page.waitForTimeout(2000);
    check('link lost: the canvas stops', (await frames(page)) === a && (await scene(page)).cadence === 'rest', `${(await frames(page)) - a} frames`);
    check('link lost: 40 % desaturated', (await page.evaluate(() => window.__naosScene.state.desat)) === 0.4);
    await shot(page, 'link-lost');
    await ctx.close();
  }

  const lostNoise = /ERR_CONNECTION_REFUSED|WebSocket connection/;
  const real = errors.filter((e) => !/404 \(Not Found\)/.test(e) && !lostNoise.test(e) && !/Failed to load resource/.test(e));
  check('no console errors', real.length === 0, real.slice(0, 5).join(' | '));
  console.log('404s from a Channel fetch that raced the fixture reset:', errors.length - real.length);
} catch (e) {
  check('run finished', false, String(e).split('\n')[0]);
  for (const ctx of browser.contexts()) for (const page of ctx.pages()) {
    const state = await page.evaluate(() => {
      const s = window.__naos?.getState();
      return s ? { scene: s.scene, settings: s.view.settings, shell: { instrument: s.shell.instrument, free: s.shell.free },
        controller: !!window.__naosScene, canvas: !!document.querySelector('#scene-slot canvas'),
        slot: document.getElementById('scene-slot')?.innerHTML.slice(0, 400),
        modules: performance.getEntriesByType('resource').filter((r) => /assets\/(Live|three|r3f)-/.test(r.name)).map((r) => r.name.split('/').pop()) } : null;
    }).catch(() => null);
    console.log('scene at failure:', JSON.stringify(state));
  }
  console.log('recent browser errors:', errors.slice(-6));
} finally {
  await browser.close();
  child.kill();
}
writeFileSync(path.join(shots, 'numbers.json'), JSON.stringify(numbers, null, 2));
console.log(JSON.stringify(numbers, null, 2));
rmSync(home, { recursive: true, force: true, maxRetries: 5 });
console.log(fails === 0 ? 'ALL PASS' : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
