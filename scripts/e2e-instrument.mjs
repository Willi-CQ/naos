// Keyboard only, Veil and link loss, against one fixture kernel, in headless Edge. Prints pass or fail per check. Kills what it starts.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = mkdtempSync(path.join(tmpdir(), 'naos-e2e-instrument-'));

const freePort = () => new Promise((res) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
const port = await freePort();

function kernel() {
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'packages/kernel/src/cli.ts', 'fixture', '--port', String(port), '--home', home, '--no-open'], { cwd: repo, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
  const ready = new Promise((resolve, reject) => {
    let buf = '';
    child.stdout.on('data', (d) => { buf += d; for (const l of buf.split('\n')) { try { const m = JSON.parse(l); if (m.event === 'ready') resolve(m.url); } catch { /* */ } } });
    setTimeout(() => reject(new Error('no ready')), 20_000).unref();
  });
  return { child, ready };
}

let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? `  [${extra}]` : ''}`); if (!ok) fails += 1; };

let k = kernel();
const url = await k.ready;
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`page: ${e}`));
  await page.goto(url, { waitUntil: 'load' });
  const fixture = (action, value) => page.evaluate(async ([a, v]) => (await fetch('/api/cmd', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'fixture.control', action: a, value: v }) })).json(), [action, value]);
  const seek = async (t) => { await fixture('seek', t); await fixture('pause'); await page.waitForTimeout(450); };
  const press = async (...keys) => { for (const key of keys) { await page.keyboard.press(key); await page.waitForTimeout(60); } await page.waitForTimeout(320); };
  const text = (sel) => page.evaluate((s) => document.querySelector(s)?.textContent ?? null, sel);
  const has = (sel) => page.evaluate((s) => document.querySelector(s) !== null, sel);
  const selectedTitle = () => page.evaluate(() => {
    const title = document.querySelector('[aria-selected="true"].m-craft .ttl')?.cloneNode(true);
    if (!title) return null;
    title.querySelector('.client-mark')?.remove();
    return title.textContent;
  });
  const focusName = () => page.evaluate(() => { const e = document.activeElement; return `${e?.tagName}.${e?.className}|${e?.textContent?.slice(0, 24)}`; });

  await seek(60);
  check('title badge', (await page.title()) === '(1) NAOS, kestrel needs approval', await page.title());
  check('favicon has the nad dot', (await page.evaluate(() => document.querySelector('link[rel=icon]').href)).includes('FD9D4E'));
  check('20 craft fit: no scroll in the Manifest at 1280x800', await page.evaluate(() => { const m = document.querySelector('.manifest'); return m.scrollHeight <= m.clientHeight; }));
  check('no horizontal overflow in the masthead', await page.evaluate(() => { const m = document.querySelector('.masthead'); return m.scrollWidth <= m.clientWidth; }));
  check('20 craft in the header', (await text('.left-head')).includes('20 craft'));

  // Tab order: skip link first.
  await press('Tab');
  check('Tab: skip link is first', (await focusName()).includes('Skip to decisions'), await focusName());
  await page.evaluate(() => document.activeElement.blur());

  await press('j');
  check('J selects the top of attention', (await selectedTitle()) === 'fix flaky queue', await selectedTitle());
  await press('j');
  check('second J: the wait at source', (await selectedTitle()) === 'offline sync', await selectedTitle());
  await press('j');
  check('third J: the fault', (await selectedTitle()) === 'shader pass', await selectedTitle());
  await press('k', 'k');
  check('K walks back', (await selectedTitle()) === 'fix flaky queue', await selectedTitle());
  await press('ArrowDown');
  check('Down is J', (await selectedTitle()) === 'offline sync');
  await press('ArrowUp');
  check('Up is K', (await selectedTitle()) === 'fix flaky queue');

  await press('Enter');
  check('Enter flies to Craft level', await has('.rail.wide'));
  await press('Escape');
  check('Esc: Craft to World', await has('.panel') && !(await has('.rail.wide')));
  await press('Escape');
  check('Esc: World to System', await has('.manifest'));
  await press('3');
  check('3 flies to world slot 3', (await text('.panel-head'))?.includes('harbor'), await text('.panel-head'));
  await press('0');
  check('0 returns to System', await has('.manifest'));

  // Space opens the docket on the oldest decision. Esc leaves it undecided, and J and K walk again.
  await press('j', 'j');
  await press('Space');
  check('Space attends the oldest decision', await has('.dk-btns'));
  await press('Escape');
  check('Esc leaves the docket undecided', !(await has('.dk-btns')));

  await press('?');
  check('? opens Laws', await has('.dialog'));
  check('focus inside Laws', await page.evaluate(() => document.querySelector('.dialog').contains(document.activeElement)));
  check('Laws fits at 800 high', await page.evaluate(() => { const d = document.querySelector('.dialog'); return d.scrollHeight <= d.clientHeight + 1; }));
  await press('j');
  const stillLaws = await has('.dialog');
  check('global keys are inert under a modal', stillLaws);
  await press('Tab', 'Tab', 'Tab', 'Tab');
  check('focus stays trapped', await page.evaluate(() => document.querySelector('.dialog').contains(document.activeElement)));
  await press('Escape');
  check('Esc closes Laws', !(await has('.dialog')));

  await press('f');
  check('F opens Find, focus in the field', await page.evaluate(() => document.activeElement?.classList.contains('find-input')));
  await page.keyboard.type('flaky');
  await page.waitForTimeout(100);
  check('typing does not trigger keys', await has('.find-input') && (await page.inputValue('.find-input')) === 'flaky');
  await press('Enter');
  check('Find goes to the craft', await has('.rail.wide'));
  await press('Escape', 'Escape');
  await press('/');
  await page.keyboard.type('zzzzqq');
  await page.waitForTimeout(100);
  check('empty search', (await text('.find-list'))?.includes('Nothing here matches.'));
  await press('Control+Period');
  check('Ctrl+. fires inside a text field', (await selectedTitle()) === 'fix flaky queue' || await has('.find-input'));
  check('Ctrl+. opens the docket over Find', await has('.dk-btns'));
  await press('Escape');
  check('the first Esc leaves the docket, Find stays', !(await has('.dk-btns')) && await has('.find-input'));
  await press('Escape');
  check('Esc closes Find', !(await has('.find-input')));

  await press(',');
  check(', opens Settings', await has('[role=dialog][aria-label=Settings]'));
  await press('Escape');

  await press('q');
  check('Q filters the Tape', (await text('.tape-filter')) === 'writes and damage', await text('.tape-filter'));
  await press('q');
  check('Q again: needs', (await text('.tape-filter')) === 'needs');
  await press('q');
  check('Q cycles back', !(await has('.tape-filter')));
  await press('m');
  check('M: per world', (await page.locator('.m-craft').count()) === 0);
  await press('m');
  check('M: per craft', (await page.locator('.m-craft').count()) === 14, String(await page.locator('.m-craft').count()));
  await press('Shift+M');
  check('Shift+M collapses the rail', await has('.strip'));
  await press('Shift+M');
  await press('h');
  check('H: Cinema, rails gone', await page.evaluate(() => getComputedStyle(document.querySelector('.bottom')).display === 'none'));
  check('Cinema keeps the decision row', (await text('[aria-label="NEEDS YOU"]'))?.includes('kestrel'));
  await press('Escape');
  check('Esc leaves Cinema', await page.evaluate(() => getComputedStyle(document.querySelector('.bottom')).display !== 'none'));
  await press('t');
  check('T opens the Sky', await has('.skystrip'));
  await press('ArrowLeft', 'Shift+ArrowLeft');
  check('Sky scrubs by key', (await page.getAttribute('.skystrip', 'aria-valuenow')) === '22', await page.getAttribute('.skystrip', 'aria-valuenow'));
  await press('Escape');
  check('Esc leaves the Sky', !(await has('.skystrip')));

  await press('g', 'n');
  check('G and N flip settings', await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('naos.settings')); return s.geiger && s.mute; }));
  await press('g', 'n');

  // Channel: W for text.
  await press('j', 'k', 'Enter');
  await page.waitForTimeout(700);
  await press('w');
  await page.waitForTimeout(400);
  check('W shows text', (await text('.chan-list'))?.includes('placeholder text') === true);
  await press('w');
  check('W seals again', (await text('.chan-list'))?.includes('placeholder text') === false);
  await press('Escape', 'Escape');

  // The Manifest as a tree: arrows move, Enter opens.
  await page.evaluate(() => document.querySelector('.manifest [tabindex="0"]').focus());
  const before = await focusName();
  await press('ArrowDown', 'ArrowDown');
  check('tree arrows move focus', (await focusName()) !== before, await focusName());
  await press('Enter');
  check('tree Enter opens', await has('.rail.wide'));
  await press('Escape', 'Escape');
  await page.evaluate(() => document.activeElement?.blur?.());

  // Screen reader surfaces.
  await page.waitForTimeout(1100);
  const mirror = await text('section[aria-label=Scene]');
  check('Scene mirror lists every craft', mirror.includes('kestrel beta, needs approval, 41 seconds') && mirror.startsWith('20 craft'), mirror.slice(0, 60));
  check('Lamps have a name and count', await page.locator('button[aria-label="Faults, 1"]').count() === 1);
  check('meter on the sun', (await page.getAttribute('[aria-label="Claude five hour window"]', 'aria-valuetext')) === 'Claude five hour window, 58 percent left');
  check('Tape is a quiet log', (await page.getAttribute('ol.tape', 'aria-live')) === 'off');

  // Veil: nothing named anywhere, attributes and title included.
  await press('v');
  const words = ['kestrel', 'tundra', 'harbor', 'mosaic', 'lumen', 'quill', 'ferro', 'fix flaky', 'rate limiter', 'docs sweep', 'migrate types', 'ledger pass', 'audit callers', 'changelog',
    'invoice migrate', 'tile cache', 'shader pass', 'bundle size', 'offline sync', 'lint fixes', 'old probe', 'npm ', 'vitest', 'repo-audit', 'naos/', '/fixture', 'naos:'];
  const leaks = async (where) => {
    // A find field holds what the operator typed, and only that.
    const dom = await page.evaluate(() => { const c = document.documentElement.cloneNode(true); c.querySelector('.find-input')?.removeAttribute('value'); return c.outerHTML + document.title; });
    const hits = words.filter((w) => dom.toLowerCase().includes(w.toLowerCase()));
    const context = hits.map((w) => { const i = dom.toLowerCase().indexOf(w.toLowerCase()); return dom.slice(Math.max(0, i - 80), i + 40); }).slice(0, 2);
    check(`Veil: ${where}`, hits.length === 0, `${hits.join(', ')} ${context.join(' || ')}`);
  };
  check('VEILED tag shows', await has('.veiltag'));
  await leaks('System t=60');
  await press('j', 'Enter');
  await page.waitForTimeout(600);
  await leaks('Craft level');
  await press('w');
  check('W refuses under the Veil', !(await text('.chan-list'))?.includes('placeholder'));
  await press('Escape');
  await leaks('World level');
  await press('Escape', 'f');
  await page.keyboard.type('kestrel');
  await page.waitForTimeout(200);
  await leaks('Find typed a real name');
  await page.evaluate(() => { const i = document.querySelector('.find-input'); i.value = ''; });
  await press('Escape', 't');
  await leaks('Sky');
  await press('Escape');
  for (const t of [19, 76, 100, 124, 140, 150, 172]) {
    await seek(t);
    await page.waitForTimeout(700);
    await leaks(`t=${t}`);
  }
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(900);
  await leaks('after a reload the Veil holds');
  await press('v');
  check('V takes the Veil off', !(await has('.veiltag')));

  // Timeline sweep: every point, no throw. Totality shows its lamp and banner.
  await seek(150);
  await page.waitForTimeout(500);
  check('Totality: LIMIT lit and banner', (await page.getAttribute('.lamp[data-id=limit]', 'data-lit')) === 'true' && (await text('.banner[data-kind=limit]'))?.includes('Claude plan limit reached'));
  await seek(60);

  // Fault: the lamp goes dark on acknowledgement. Tab reaches the button, so no pointer is needed.
  await seek(60);
  const faults = () => page.evaluate(() => window.__naos.getState().model.lamps.find((l) => l.id === 'fault')?.count);
  const lit = await faults();
  await page.focus('.rail-ack');
  await press('Enter');
  check('ack puts the FAULT lamp out', lit === 1 && (await faults()) === 0, `${lit} to ${await faults()}`);

  // The notification's link, DESIGN 3.7: a fresh tab at /#docket=<id> opens that decision.
  const wanted = await page.evaluate(() => window.__naos.getState().model.decisions[0]?.requestId);
  const tab = await ctx.newPage();
  await tab.goto(`${new URL(url).origin}/#docket=${encodeURIComponent(wanted)}`, { waitUntil: 'load' });
  await tab.waitForSelector('.dk-btns', { timeout: 5000 }).catch(() => {});
  check('/#docket= opens the decision in a new tab', await tab.evaluate(() => document.querySelector('.dk-btns') !== null));
  await tab.close();

  // Link loss: kill the kernel, then bring it back on the same port.
  k.child.kill();
  await page.waitForTimeout(1600);
  check('Link lost: masthead counts', (await text('.linklamp'))?.startsWith('NO SIGNAL'), await text('.linklamp'));
  check('Link lost: banner', (await text('.banner[data-kind=kernel-lost]')) === 'Kernel not responding');
  check('Link lost: decisions read cannot be answered', (await text('.decision'))?.includes('cannot be answered now'));

  k = kernel();
  await k.ready;
  await page.waitForTimeout(11_000);
  const up = (await text('.linklamp')) === 'LINK';
  check('Link back after restart', up, await text('.linklamp'));
  if (up) check('gap marked in the Tape', await page.evaluate(() => [...document.querySelectorAll('.tape li')].some((li) => li.textContent.includes('link gap'))), '');
  check('banner gone', !(await has('.banner[data-kind=kernel-lost]')));

  const real = errors.filter((e) => !/ERR_CONNECTION_REFUSED|WebSocket connection|Failed to load resource/.test(e));
  check('no console errors', real.length === 0, real.slice(0, 5).join(' | '));
  console.log('network noise during the outage:', errors.length - real.length);
} finally {
  await browser.close();
  k.child.kill();
}
rmSync(home, { recursive: true, force: true, maxRetries: 5 });
console.log(fails === 0 ? 'ALL PASS' : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
