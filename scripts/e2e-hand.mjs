#!/usr/bin/env node
// The docket is where a wrong key costs real damage, so its rules run here through headless Edge, against the fixture kernel, with real
// key events and two real tabs. Vite serves the source on a free port. Until main.tsx calls registerHand(), this script adds that one
// call to the page and says so: everything else on the page is the shipped code.
//   node scripts/e2e-hand.mjs [--out <dir>] [--tmp <dir>] [--only <text>]
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as netServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values: o } = parseArgs({ options: { out: { type: 'string', default: path.join(repo, '.shots', 'hand') }, tmp: { type: 'string', default: tmpdir() }, only: { type: 'string' } } });
mkdirSync(o.out, { recursive: true });

const RUN_LIMIT_MS = 300_000;
const kernelHome = path.join(o.tmp, `naos-e2e-hand-${process.pid}`);
const viteCache = path.join(o.tmp, `naos-e2e-vite-${process.pid}`);
const hardStop = setTimeout(() => { console.error('e2e-hand: run limit reached'); process.exit(2); }, RUN_LIMIT_MS);
hardStop.unref();

const freePort = () => new Promise((resolve, reject) => {
  const s = netServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

async function startFixture(vitePort) {
  const port = await freePort();
  const env = { ...process.env, NAOS_DEV_ORIGINS: `http://127.0.0.1:${vitePort}` };
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'packages/kernel/src/cli.ts', 'fixture', '--port', String(port), '--home', kernelHome, '--no-open'], {
    cwd: repo, env, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true,
  });
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
  return { child, port, token: new URL(url).searchParams.get('token') };
}

const wired = readFileSync(path.join(repo, 'packages/ui/src/main.tsx'), 'utf8').includes('registerHand');

async function startVite(port, kernelPort) {
  process.env.NAOS_KERNEL = `http://127.0.0.1:${kernelPort}`;
  const { createServer } = await import('vite');
  const inject = {
    name: 'naos-e2e-hand',
    transformIndexHtml: () => (wired ? [] : [{
      tag: 'script', attrs: { type: 'module' }, injectTo: 'body', children: "import { registerHand } from '/src/hud/sheets/hand.tsx'; registerHand();",
    }]),
  };
  const server = await createServer({
    root: path.join(repo, 'packages/ui'), configFile: path.join(repo, 'packages/ui/vite.config.ts'), cacheDir: viteCache,
    server: { port, strictPort: true, host: '127.0.0.1', hmr: false }, plugins: [inject], logLevel: 'error',
  });
  await server.listen();
  return server;
}

const vitePort = await freePort();
const kernel = await startFixture(vitePort);
const vite = await startVite(vitePort, kernel.port);
const base = `http://127.0.0.1:${vitePort}`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });

const results = [];
const consoleErrors = [];
const sent = [];

function watch(page, name) {
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(`${name} ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => consoleErrors.push(`${name} pageerror: ${e}`));
  page.on('request', (r) => {
    if (!r.url().endsWith('/api/cmd')) return;
    const body = r.postDataJSON();
    sent.push({ page: name, ...body });
  });
}

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5 });
const page = await ctx.newPage();
watch(page, 'tab1');
await page.goto(`${base}/auth?token=${kernel.token}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__naos?.getState().link.status === 'up', undefined, { timeout: 30_000 });
await page.waitForSelector('.shell');

const fixture = (action, value, p = page) => p.evaluate(async ([a, v]) => (await fetch('/api/cmd', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'fixture.control', action: a, value: v }),
})).json(), [action, value]);

const openList = (p = page) => p.evaluate(() => Object.values(window.__naos.getState().fleet.approvals).filter((a) => a.status === 'open').sort((a, b) => a.createdAt - b.createdAt)
  .map((a) => ({ id: a.requestId, tool: a.toolName, call: a.callIndex })));
const approval = (id, p = page) => p.evaluate((rid) => {
  const a = window.__naos.getState().fleet.approvals[rid];
  return a ? { status: a.status, outcome: a.outcome, answeredBy: a.answeredBy } : null;
}, id);
const answers = () => sent.filter((c) => c.type === 'approval.answer');
const assert = (ok, what) => { if (!ok) throw new Error(what); };
const armed = (p = page) => p.waitForSelector('.dk-arm[data-armed="true"]', { timeout: 3000 });
const docket = (p = page) => p.locator('.docket');
const docketOpen = (p = page) => p.evaluate(() => window.__naos.getState().view.overlays.some((o) => o.id === 'docket'));
const refusal = (p = page) => p.evaluate(() => document.querySelector('.docket')?.getAttribute('data-refusal'));
const active = (p = page) => p.evaluate(() => { const e = document.activeElement; return { tag: e?.tagName, cls: e?.className ?? '', text: e?.textContent?.slice(0, 30) ?? '', inDocket: !!e?.closest?.('.docket') }; });
const shot = (name, p = page) => p.screenshot({ path: path.join(o.out, `${name}.png`) });

/** Clean view, fixture parked at second `t`, and a wait until the store holds the state of that second. */
async function at(t, ready, p = page) {
  await p.evaluate(() => {
    const s = window.__naos.getState();
    if (s.view.settings.veil) localStorage.removeItem('naos.settings');
    document.activeElement?.blur?.();
  });
  for (let i = 0; i < 4; i += 1) {
    if (await p.evaluate(() => window.__naos.getState().view.overlays.length === 0)) break;
    await p.keyboard.press('Escape');
    await p.waitForTimeout(40);
  }
  await fixture('seek', t, p);
  await fixture('pause', undefined, p);
  await p.waitForTimeout(240);
  if (ready) await p.waitForFunction(ready, undefined, { timeout: 5000 });
  await p.waitForTimeout(220);
  sent.length = 0;
}

const hasOpen = (tool) => `Object.values(window.__naos.getState().fleet.approvals).some((a) => a.status === 'open' && a.toolName === ${JSON.stringify(tool)})`;

async function t(name, run) {
  if (o.only && !name.includes(o.only)) return;
  const started = Date.now();
  try {
    await run();
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(`ok   ${name}`);
  } catch (err) {
    results.push({ name, ok: false, error: String(err.message ?? err) });
    console.log(`FAIL ${name}\n     ${String(err.message ?? err).split('\n')[0]}`);
    await page.screenshot({ path: path.join(o.out, `fail-${name.replace(/\W+/g, '-').slice(0, 40)}.png`) }).catch(() => undefined);
  }
}

try {
  await t('a new decision steals no focus and opens nothing', async () => {
    await at(18.5);
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.id = 'e2e-field';
      document.body.append(input);
      input.focus();
    });
    await fixture('play');
    await page.waitForFunction(hasOpen('Bash'), undefined, { timeout: 4000 });
    await fixture('pause');
    const focus = await page.evaluate(() => document.activeElement?.id);
    assert(focus === 'e2e-field', `focus moved to ${focus}`);
    assert(!(await docketOpen()), 'docket opened by itself');
    await page.keyboard.type('adxsr');
    assert((await page.inputValue('#e2e-field')) === 'adxsr', 'typing did not stay in the field');
    assert(answers().length === 0, 'an answer was sent');
    await page.evaluate(() => document.getElementById('e2e-field').remove());
  });

  await t('double tap cannot approve an unread call', async () => {
    await at(30, hasOpen('Bash'));
    const [{ id }] = await openList();
    await page.keyboard.press('Space');
    await page.keyboard.press('a');
    await page.keyboard.press('a');
    await page.waitForTimeout(80);
    assert((await approval(id)).status === 'open', 'approved inside the arm');
    assert(answers().length === 0, 'an answer left the page');
    assert((await refusal()) === 'arming', `refusal was ${await refusal()}`);
  });

  await t('a double tap on the next card in the queue does nothing', async () => {
    await at(146, `${hasOpen('ExitPlanMode')} && ${hasOpen('Write')}`);
    const list = await openList();
    await page.keyboard.press('Space');
    await armed();
    await page.keyboard.press('a');
    await page.waitForTimeout(40);
    await page.keyboard.press('a');
    await page.waitForTimeout(40);
    await page.keyboard.press('a');
    await page.waitForFunction(() => document.querySelector('.docket')?.textContent.includes('Write'), undefined, { timeout: 2000 });
    await page.keyboard.press('a');
    const second = list.find((r) => r.tool === 'Write');
    await page.waitForTimeout(60);
    assert((await approval(second.id)).status === 'open', 'next card approved by the double tap');
    assert(answers().length === 1, `${answers().length} answers sent`);
    await armed();
    await page.keyboard.press('a');
    await page.waitForFunction((rid) => window.__naos.getState().fleet.approvals[rid]?.status === 'answered', second.id, { timeout: 2000 });
  });

  await t('a key inside the arm window does nothing', async () => {
    await at(30, hasOpen('Bash'));
    const [{ id }] = await openList();
    await page.keyboard.press('Space');
    for (const key of ['d', 'x', 's', 'e', 'r', 'j']) await page.keyboard.press(key);
    await page.waitForTimeout(60);
    assert((await approval(id)).status === 'open', 'a key decided inside the arm');
    assert(answers().length === 0, 'an answer left the page');
    assert(await page.locator('.dk-btns').isVisible(), 'a pane opened inside the arm');
  });

  await t('a click inside the arm obeys the same arm', async () => {
    await at(30, hasOpen('Bash'));
    const [{ id }] = await openList();
    await page.keyboard.press('Space');
    await page.locator('.dk-btn', { hasText: 'Approve' }).click({ force: true, delay: 0 });
    await page.waitForTimeout(40);
    assert((await approval(id)).status === 'open', 'click approved inside the arm');
    assert(answers().length === 0, 'an answer left the page');
  });

  await t('typing in another field never reaches a card', async () => {
    await at(30, hasOpen('Bash'));
    const [{ id }] = await openList();
    await page.keyboard.press('Space');
    await armed();
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.id = 'e2e-field';
      input.style.cssText = 'position:fixed;left:10px;top:60px;z-index:99';
      document.body.append(input);
      input.focus();
    });
    assert((await docket().getAttribute('data-focused')) === 'false', 'docket still says focused');
    await page.keyboard.type('adxsr');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(60);
    assert((await page.inputValue('#e2e-field')) === 'adxsr', 'text did not stay in the field');
    assert((await approval(id)).status === 'open', 'typing reached the card');
    assert(answers().length === 0, 'an answer left the page');
    await page.evaluate(() => document.getElementById('e2e-field').remove());
    // A letter with focus nowhere is outside the docket too, and global letters never reuse a docket letter.
    await page.keyboard.press('a');
    await page.keyboard.press('d');
    await page.waitForTimeout(40);
    assert(answers().length === 0, 'a global key reached the card');
  });

  await t('Enter on a focused button does nothing, Space works once armed', async () => {
    await at(30, hasOpen('Bash'));
    const [{ id }] = await openList();
    await page.keyboard.press('Space');
    await armed();
    const start = await active();
    assert(start.cls.includes('docket'), `focus entered on ${start.cls}, not the region`);
    await page.keyboard.press('Tab');
    const button = await active();
    assert(button.tag === 'BUTTON' && button.text.includes('Approve'), `tab reached ${button.text}`);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Control+Enter');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.press('NumpadEnter');
    await page.waitForTimeout(60);
    assert((await approval(id)).status === 'open', 'Enter approved');
    assert(answers().length === 0, 'Enter sent an answer');
    await page.keyboard.press('Space');
    await page.waitForFunction((rid) => window.__naos.getState().fleet.approvals[rid]?.status === 'answered', id, { timeout: 2000 });
    // Call 1 of 2 with nothing else open: the docket waits for the next call, then closes.
    await page.waitForFunction(() => document.querySelector('.docket')?.textContent.includes('is on its way'), undefined, { timeout: 1000 });
    await page.waitForFunction(() => !window.__naos.getState().view.overlays.some((o) => o.id === 'docket'), undefined, { timeout: 2500 });
  });

  await t('clicking a rail row opens the docket on that request, focused', async () => {
    await at(133.2, `${hasOpen('mcp__docs__search')} && ${hasOpen('AskUserQuestion')}`);
    await page.locator('.decision').nth(1).click();
    await armed();
    assert((await docket().textContent()).includes('mcp__docs__search'), 'the row did not open its own request');
    assert((await active()).cls.includes('docket'), 'focus is not on the region');
  });

  await t('long arm takes 1 s, and with single keys off only Ctrl+. opens, docket keys still work', async () => {
    await at(30, hasOpen('Bash'));
    const [{ id }] = await openList();
    const setting = (patch) => page.evaluate((p) => {
      const s = window.__naos.getState();
      window.__naos.setState({ view: { ...s.view, settings: { ...s.view.settings, ...p } } });
    }, patch);
    await setting({ longArm: true, singleKeys: false });
    await page.keyboard.press('Space');
    await page.waitForTimeout(80);
    assert(!(await docketOpen()), 'Space worked with single keys off');
    await page.keyboard.press('Control+.');
    await page.waitForTimeout(600);
    await page.keyboard.press('d');
    await page.waitForTimeout(40);
    assert((await refusal()) === 'arming', 'long arm did not hold at 600 ms');
    await armed();
    await page.keyboard.press('d');
    await page.waitForFunction((rid) => window.__naos.getState().fleet.approvals[rid]?.outcome === 'deny', id, { timeout: 2000 });
    await setting({ longArm: false, singleKeys: true });
  });

  await t('Esc leaves it undecided and focus goes back', async () => {
    await at(30, hasOpen('Bash'));
    const [{ id }] = await openList();
    await page.locator('.lamp').first().focus();
    await page.keyboard.press('Control+.');
    await armed();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(60);
    assert(!(await docketOpen()), 'docket stayed');
    assert((await approval(id)).status === 'open', 'Esc decided');
    assert(answers().length === 0, 'Esc sent an answer');
    assert((await active()).cls.includes('lamp'), 'focus did not return');
    assert((await page.evaluate(() => window.__naos.getState().view.keyScope)) === 'global', 'key scope stayed in the docket');
  });

  await t('focus is trapped while focused', async () => {
    await at(30, hasOpen('Bash'));
    await page.keyboard.press('Space');
    await armed();
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab');
      assert((await active()).inDocket, `tab ${i} left the docket`);
    }
    await page.evaluate(() => document.querySelector('.docket').focus());
    await page.keyboard.press('Shift+Tab');
    assert((await active()).inDocket, 'shift tab left the docket');
  });

  await t('a new request restarts the arm and never swaps the card', async () => {
    await at(127.4, hasOpen('AskUserQuestion'));
    await page.keyboard.press('Space');
    await armed();
    await page.waitForTimeout(40);
    assert((await docket().textContent()).includes('1 of 1'), 'expected one card');
    await fixture('play');
    await page.waitForFunction(() => document.querySelector('.docket')?.textContent.includes('1 of 2'), undefined, { timeout: 4000, polling: 10 });
    await page.keyboard.press('d');
    const refused = await refusal();
    await fixture('pause');
    assert(refused === 'arming', `key after a new request was ${refused}`);
    assert(answers().length === 0, 'an answer left the page');
    assert((await docket().textContent()).includes('AskUserQuestion'), 'the card swapped under the finger');
    await armed();
  });

  await t('a serial next call swaps the body and restarts the arm', async () => {
    await at(71.7, hasOpen('Bash'));
    await page.keyboard.press('Space');
    await armed();
    await fixture('play');
    await page.waitForFunction(() => document.querySelector('.docket')?.textContent.includes('ANSWERED ELSEWHERE'), undefined, { timeout: 3000 });
    await page.waitForFunction(() => document.querySelector('.docket')?.textContent.includes('call 2 of 2'), undefined, { timeout: 6000, polling: 10 });
    await page.keyboard.press('a');
    await fixture('pause');
    await page.waitForTimeout(40);
    assert(answers().length === 0, 'the next call was approved unread');
    const list = await openList();
    assert(list.length === 1 && list[0].call === 2, 'expected call 2 open');
    await armed();
    await shot('docket-serial');
  });

  await t('danger opens on Deny, a tap and key repeat fail, a 700 ms hold approves', async () => {
    await at(105, hasOpen('Bash'));
    const [{ id }] = await openList();
    await page.keyboard.press('Space');
    await armed();
    const text = await docket().textContent();
    assert(text.includes('DEFAULT DENY'), 'no DEFAULT DENY header');
    assert((await page.locator('.dk-btn[data-primary="true"]').textContent()).includes('Deny'), 'Deny is not preselected');
    assert(await page.locator('.dk-btn', { hasText: 'This session' }).count() === 0, 'S is offered in danger');
    assert(await page.locator('.dk-btn', { hasText: 'Edit first' }).count() === 0, 'E is offered in danger');
    await shot('docket-danger');
    await page.keyboard.press('s');
    await page.keyboard.press('a');
    await page.keyboard.down('a');
    await page.waitForTimeout(200);
    await page.keyboard.down('a');
    await page.keyboard.down('a');
    await page.keyboard.up('a');
    await page.waitForTimeout(650);
    assert((await approval(id)).status === 'open', 'a tap or a repeat approved');
    assert(answers().length === 0, 'an answer left the page');
    await page.keyboard.down('a');
    await page.waitForTimeout(780);
    await page.keyboard.up('a');
    await page.waitForFunction((rid) => window.__naos.getState().fleet.approvals[rid]?.status === 'answered', id, { timeout: 2000 });
    assert((await approval(id)).outcome === 'approve', 'hold did not approve');
  });

  await t('danger: a click takes the confirm route, armed again, and Deny needs no hold', async () => {
    await at(105, hasOpen('Bash'));
    const [{ id }] = await openList();
    await page.keyboard.press('Space');
    await armed();
    // Both clicks land inside one task and a frame, so this measures the arm and not the speed of the test driver.
    const twice = await page.evaluate(async () => {
      const button = (text) => [...document.querySelectorAll('.dk-btn')].find((b) => b.textContent.includes(text));
      button('Approve').click();
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r)));
      const confirm = button('Approve anyway');
      confirm?.click();
      return confirm !== undefined;
    });
    assert(twice, 'no confirm pane');
    await page.waitForTimeout(40);
    assert((await approval(id)).status === 'open', 'confirm passed inside its arm');
    assert((await refusal()) === 'arming', `confirm refusal ${await refusal()}`);
    await page.keyboard.press('Escape');
    await armed();
    await page.keyboard.press('d');
    await page.waitForFunction((rid) => window.__naos.getState().fleet.approvals[rid]?.outcome === 'deny', id, { timeout: 2000 });
  });

  await t('a new request during a danger hold cancels the hold', async () => {
    await at(105, hasOpen('Bash'));
    const [{ id }] = await openList();
    await page.keyboard.press('Space');
    await armed();
    await page.keyboard.down('a');
    await page.waitForTimeout(250);
    await page.evaluate((rid) => {
      const s = window.__naos.getState();
      const extra = { ...s.fleet.approvals[rid], requestId: 'e2e_new', createdAt: s.fleet.approvals[rid].createdAt + 1 };
      window.__naos.setState({ fleet: { ...s.fleet, approvals: { ...s.fleet.approvals, e2e_new: extra } } });
    }, id);
    await page.waitForTimeout(700);
    await page.keyboard.up('a');
    assert((await approval(id)).status === 'open', 'the hold survived a new request');
    assert(answers().length === 0, 'an answer left the page');
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      const s = window.__naos.getState();
      const { e2e_new: _, ...approvals } = s.fleet.approvals;
      window.__naos.setState({ fleet: { ...s.fleet, approvals } });
    });
  });

  await t('a second tab sees ANSWERED ELSEWHERE and cannot answer', async () => {
    await at(30, hasOpen('Bash'));
    const [{ id }] = await openList();
    const tab = await ctx.newPage();
    watch(tab, 'tab2');
    await tab.goto(base, { waitUntil: 'load' });
    await tab.waitForFunction(() => window.__naos?.getState().link.status === 'up', undefined, { timeout: 15_000 });
    await tab.waitForFunction(hasOpen('Bash'), undefined, { timeout: 5000 });
    await tab.bringToFront();
    await tab.keyboard.press('Space');
    await armed(tab);
    await page.bringToFront();
    await page.keyboard.press('Space');
    await armed();
    await page.keyboard.press('a');
    await tab.bringToFront();
    await tab.waitForFunction(() => document.querySelector('.docket')?.textContent.includes('ANSWERED ELSEWHERE'), undefined, { timeout: 3000 });
    await shot('docket-answered-elsewhere', tab);
    const before = answers().length;
    await tab.keyboard.press('a');
    await tab.waitForTimeout(80);
    assert(answers().length === before, 'the second tab sent an answer');
    assert((await tab.locator('.docket').getAttribute('data-refusal')) === 'settled', 'second tab was not refused as settled');
    await tab.close();
    await page.bringToFront();
  });

  await t('WITHDRAWN shows, then the card leaves', async () => {
    await at(149, hasOpen('Write'));
    await page.keyboard.press('Space');
    await armed();
    await shot('docket-write');
    await fixture('play');
    await page.waitForFunction(() => document.querySelector('.docket')?.textContent.includes('WITHDRAWN'), undefined, { timeout: 3000 });
    await fixture('pause');
    await page.waitForFunction(() => !window.__naos.getState().view.overlays.some((o) => o.id === 'docket'), undefined, { timeout: 4000 });
    assert(answers().length === 0, 'an answer left the page');
  });

  await t('J moves to the MCP card, its server is marked, and EXPIRED shows', async () => {
    await at(133.2, `${hasOpen('mcp__docs__search')} && ${hasOpen('AskUserQuestion')}`);
    await page.keyboard.press('Space');
    await armed();
    await shot('docket-question');
    await page.keyboard.press('j');
    await page.waitForFunction(() => document.querySelector('.docket')?.textContent.includes('name not verified'), undefined, { timeout: 2000 });
    await armed();
    await shot('docket-mcp');
    await fixture('play');
    await page.waitForFunction(() => document.querySelector('.docket')?.textContent.includes('EXPIRED'), undefined, { timeout: 3000 });
    await fixture('pause');
  });

  await t('question: keys pick, A sends the answers', async () => {
    await at(130, hasOpen('AskUserQuestion'));
    const id = (await openList()).find((r) => r.tool === 'AskUserQuestion').id;
    await page.keyboard.press('Space');
    await armed();
    await page.keyboard.press('a');
    await page.waitForTimeout(40);
    assert(answers().length === 0, 'A sent an unanswered form');
    await page.keyboard.press('2');
    await page.keyboard.press('a');
    await page.waitForFunction((rid) => window.__naos.getState().fleet.approvals[rid]?.status === 'answered', id, { timeout: 2000 });
    const body = answers()[0];
    assert(body.decision.kind === 'answer' && body.decision.answers['Which backend should the queue use?'] === 'sqlite', `wrong answer ${JSON.stringify(body.decision)}`);
  });

  await t('edit first sends an edited approve, redirect sends text, X moves to the follow-up box', async () => {
    await at(30, hasOpen('Bash'));
    await page.keyboard.press('Space');
    await armed();
    await page.keyboard.press('e');
    await page.waitForSelector('#dk-edit');
    await page.fill('#dk-edit', 'npm install --save-dev vitest@5');
    await page.keyboard.press('Control+Enter');
    await page.waitForTimeout(100);
    const sentEdit = answers()[0];
    assert(sentEdit?.decision.edited === true && sentEdit.decision.input.command.endsWith('vitest@5'), `edit sent ${JSON.stringify(sentEdit?.decision)}`);

    await at(30, hasOpen('Bash'));
    await page.keyboard.press('Space');
    await armed();
    await page.keyboard.press('r');
    await page.waitForSelector('#dk-redirect');
    await page.keyboard.type('use the other queue');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Control+Enter');
    await page.waitForTimeout(100);
    assert(answers()[0]?.decision.kind === 'redirect', 'redirect was not sent');

    await at(105, hasOpen('Bash'));
    await page.keyboard.press('Space');
    await armed();
    await page.keyboard.press('x');
    await page.waitForSelector('.hand-follow textarea', { timeout: 2000 });
    assert(answers()[0]?.decision.kind === 'stop', 'stop was not sent');
    assert((await active()).tag === 'TEXTAREA', 'focus did not move to the follow-up box');
    await page.keyboard.press('Escape');
  });

  await t('veil: structure only, V held reads, V released seals', async () => {
    await at(30, hasOpen('Bash'));
    await page.keyboard.press('v');
    await page.keyboard.press('Space');
    await armed();
    const veiled = await docket().textContent();
    assert(!veiled.includes('npm install'), 'veiled card shows the command');
    assert(veiled.includes('1 line'), 'no structure line');
    await shot('docket-veiled');
    await page.keyboard.down('v');
    await page.waitForTimeout(60);
    assert((await docket().textContent()).includes('npm install'), 'V hold did not read');
    await page.keyboard.up('v');
    await page.waitForTimeout(60);
    assert(!(await docket().textContent()).includes('npm install'), 'V release did not seal');
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
  });

  await t('edit diff and wide, through a store-injected request', async () => {
    await at(30, hasOpen('Bash'));
    await page.evaluate(() => {
      const s = window.__naos.getState();
      const base = Object.values(s.fleet.approvals).find((a) => a.status === 'open');
      const req = { ...base, requestId: 'e2e_edit', toolName: 'Edit', toolFamily: 'edit', blockedPath: null, createdAt: base.createdAt - 1000, callIndex: 1, callCount: 1, input: {
        file_path: 'src/queue.ts', old_string: 'const a = 1;\nconst b = 2;\nconst c = 3;', new_string: 'const a = 1;\nconst b = 20;\nconst c = 3;',
      } };
      window.__naos.setState({ fleet: { ...s.fleet, approvals: { ...s.fleet.approvals, e2e_edit: req } } });
    });
    await page.keyboard.press('Space');
    await armed();
    assert((await page.locator('.dk-diff [data-kind="add"]').textContent()).includes('b = 20'), 'no diff');
    await page.evaluate(() => {
      const s = window.__naos.getState();
      const { agentId } = s.fleet.approvals.e2e_edit;
      window.__naos.setState({ fleet: { ...s.fleet, standing: { ...s.fleet.standing, [agentId]: [{ agentId, rule: 'Bash(npm test)', scope: 'session', grantedAt: 0 }] } } });
    });
    await page.waitForFunction(() => document.querySelector('.docket')?.textContent.includes('Bash(npm test)'), undefined, { timeout: 2000 });
    await page.keyboard.press('o');
    await page.waitForTimeout(60);
    const box = await docket().boundingBox();
    assert(box.width === 720, `wide width ${box.width}`);
    await shot('docket-edit-wide');
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      const s = window.__naos.getState();
      const { e2e_edit: _, ...approvals } = s.fleet.approvals;
      window.__naos.setState({ fleet: { ...s.fleet, approvals } });
    });
  });

  await t('launch: leading world word, preflight, Ctrl+Enter spawns once', async () => {
    await at(30);
    await page.keyboard.press('l');
    await page.waitForSelector('.lx textarea');
    await page.keyboard.insertText('kestrel #build $2 x2 moon fix the flaky queue test');
    await page.waitForSelector('.lx-sec[data-state="ok"], .lx-sec[data-state="warn"]', { timeout: 3000 });
    assert((await page.locator('.lx-mirror [data-kind="world"]').textContent()) === 'kestrel', 'leading word is not the world');
    await page.waitForFunction(() => document.querySelector('.lx')?.textContent.includes('launch 2'));
    await shot('launch');
    sent.length = 0;
    await page.keyboard.press('Control+Enter');
    await page.keyboard.press('Control+Enter');
    await page.waitForFunction(() => !window.__naos.getState().view.overlays.some((o) => o.id === 'launch'), undefined, { timeout: 3000 });
    const spawns = sent.filter((c) => c.type === 'agent.spawn');
    assert(spawns.length >= 1, 'no spawn');
    assert(new Set(spawns.map((c) => c.spec.idempotencyKey)).size === 1, 'two keys for one launch');
    const { spec } = spawns[0];
    assert(spec.profile === 'build' && spec.budgetUsd === 2 && spec.copies === 2 && spec.worktree === true && spec.prompt === 'fix the flaky queue test', `spec ${JSON.stringify(spec)}`);
  });

  await t('launch: @ typed as text works, unknown tokens block in plain words, plan-first passes through', async () => {
    await at(30);
    await page.keyboard.press('l');
    await page.waitForSelector('.lx textarea');
    await page.keyboard.insertText('@nowhere #nope do it');
    await page.waitForSelector('.lx-blocked');
    assert((await page.locator('.lx-blocked').textContent()).includes('No world is named nowhere'), 'no plain reason');
    assert(await page.locator('.lx-mirror [data-kind="unknown"]').count() === 2, 'unknown tokens not marked');
    await page.keyboard.press('Control+Enter');
    await page.waitForTimeout(60);
    assert(sent.filter((c) => c.type === 'agent.spawn').length === 0, 'a blocked line spawned');
    await page.fill('.lx textarea', '@harbor audit the callers');
    await page.waitForFunction(() => !document.querySelector('.lx-blocked'), undefined, { timeout: 2000 });
    await page.waitForSelector('.lx-sec[data-state="ok"], .lx-sec[data-state="warn"]', { timeout: 3000 });
    await page.keyboard.press('Shift+Enter');
    await page.waitForFunction(() => !window.__naos.getState().view.overlays.some((o) => o.id === 'launch'), undefined, { timeout: 3000 });
    assert(sent.find((c) => c.type === 'agent.spawn')?.spec.mode === 'plan-first', 'plan first did not pass');
  });

  await t('mission mode sets the orchestrator and limits', async () => {
    await at(30);
    await page.keyboard.press('Shift+L');
    await page.waitForSelector('.lx textarea');
    assert((await page.inputValue('.lx textarea')).startsWith('#orchestrator'), 'no orchestrator token');
    await page.locator('.lx textarea').press('End');
    await page.keyboard.insertText('kestrel');
    await page.fill('.lx textarea', '@kestrel #orchestrator map the repo');
    await page.waitForSelector('text=TREE BUDGET');
    await page.waitForSelector('.lx-sec[data-state="ok"], .lx-sec[data-state="warn"]', { timeout: 3000 });
    await shot('launch-mission');
    await page.keyboard.press('Control+Enter');
    await page.waitForFunction(() => !window.__naos.getState().view.overlays.some((o) => o.id === 'launch'), undefined, { timeout: 3000 });
    const { spec } = sent.find((c) => c.type === 'agent.spawn');
    assert(spec.mission?.depth === 2 && spec.mission.childLimit === 4, `mission ${JSON.stringify(spec.mission)}`);
  });

  await t('trust: Alt+T held 700 ms trusts, a tap does not, AltGr+T does nothing', async () => {
    await at(30);
    const name = await page.evaluate(async () => {
      const world = Object.values(window.__naos.getState().fleet.worlds)[0];
      await fetch('/api/cmd', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'world.trust', worldId: world.worldId, trusted: false }) });
      return world.name;
    });
    await page.waitForTimeout(100);
    sent.length = 0;
    await page.keyboard.press('l');
    await page.waitForSelector('.lx textarea');
    await page.keyboard.insertText(`@${name} look around`);
    await page.waitForSelector('.lx-trust', { timeout: 3000 });
    await shot('launch-trust');
    await page.keyboard.down('Alt');
    await page.keyboard.press('KeyT');
    await page.keyboard.up('Alt');
    await page.waitForTimeout(800);
    assert(sent.filter((c) => c.type === 'world.trust').length === 0, 'a tap trusted');
    await page.keyboard.down('Control');
    await page.keyboard.down('Alt');
    await page.keyboard.down('KeyT');
    await page.waitForTimeout(800);
    await page.keyboard.up('KeyT');
    await page.keyboard.up('Alt');
    await page.keyboard.up('Control');
    assert(sent.filter((c) => c.type === 'world.trust').length === 0, 'AltGr trusted');
    await page.keyboard.down('Alt');
    await page.keyboard.down('KeyT');
    await page.waitForTimeout(780);
    await page.keyboard.up('KeyT');
    await page.keyboard.up('Alt');
    await page.waitForTimeout(60);
    assert(sent.filter((c) => c.type === 'world.trust').length === 1, 'hold did not trust');
    await page.keyboard.press('Escape');
  });

  await t('stop: a tap does nothing, a 600 ms hold stops, a click confirms', async () => {
    await at(30);
    const node = await page.evaluate(() => {
      const c = Object.values(window.__naos.getState().model.crafts).find((row) => row.owned && row.live && row.state !== 'approve');
      return c.id;
    });
    await page.evaluate((id) => { document.querySelector(`[data-node-id="${id}"]`)?.click(); }, node);
    await page.evaluate(() => window.__naos.setState({}));
    await page.evaluate((id) => {
      const s = window.__naos.getState();
      window.__naos.setState({ view: { ...s.view, selected: id } });
    }, node);
    await page.keyboard.press('.');
    await page.waitForTimeout(700);
    assert(sent.filter((c) => c.type === 'agent.stop').length === 0, 'a tap stopped');
    await page.keyboard.down('.');
    await page.waitForTimeout(160);
    assert(await page.locator('.hand-readout').isVisible(), 'no hold readout');
    await shot('stop-hold');
    await page.waitForTimeout(540);
    await page.keyboard.up('.');
    await page.waitForTimeout(60);
    assert(sent.filter((c) => c.type === 'agent.stop').length === 1, 'hold did not stop');
    await page.keyboard.down('Shift');
    await page.keyboard.press('Period');
    await page.keyboard.up('Shift');
    await page.waitForTimeout(100);
    assert(sent.filter((c) => c.type === 'agent.stopAll').length === 0, 'a tap stopped all');
    await page.locator('.allstop').click();
    await page.waitForSelector('[role="alertdialog"]');
    await shot('allstop-confirm');
    assert((await active()).text === 'Cancel', 'Cancel does not hold focus');
    await page.keyboard.press('Escape');
    await page.locator('.allstop').click();
    await page.waitForSelector('[role="alertdialog"]');
    await page.locator('[role="alertdialog"] .dk-btn', { hasText: 'Stop all' }).click();
    await page.waitForTimeout(100);
    assert(sent.filter((c) => c.type === 'agent.stopAll').length === 1, 'confirm did not stop all');
  });

  await t('All stop holds 1200 ms on the key, and releasing Shift cancels', async () => {
    await at(30);
    await page.keyboard.down('Shift');
    await page.keyboard.down('Period');
    await page.waitForTimeout(200);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(1200);
    await page.keyboard.up('Period');
    assert(sent.filter((c) => c.type === 'agent.stopAll').length === 0, 'released Shift still fired');
    await page.keyboard.down('Shift');
    await page.keyboard.down('Period');
    await page.waitForTimeout(1280);
    await page.keyboard.up('Period');
    await page.keyboard.up('Shift');
    await page.waitForTimeout(60);
    assert(sent.filter((c) => c.type === 'agent.stopAll').length === 1, 'hold did not stop all');
  });

  await t('follow-up, budget, fork and resume on a selected craft', async () => {
    await at(30);
    const node = await page.evaluate(() => Object.values(window.__naos.getState().model.crafts).find((row) => row.owned && row.live && row.state !== 'approve').id);
    await page.evaluate((id) => {
      const s = window.__naos.getState();
      window.__naos.setState({ view: { ...s.view, selected: id }, channel: { ...s.channel, nodeId: id } });
    }, node);
    await page.keyboard.press('i');
    await page.waitForSelector('.hand-follow textarea');
    await page.keyboard.type('add a regression test');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !window.__naos.getState().view.overlays.some((o) => o.id === 'followup'), undefined, { timeout: 2000 });
    const queued = sent.find((c) => c.type === 'agent.send');
    assert(queued?.priority === 'queue' && queued.text === 'add a regression test', `send ${JSON.stringify(queued)}`);
    await page.keyboard.press('i');
    await page.waitForSelector('.hand-follow textarea');
    await page.keyboard.type('stop that');
    await page.keyboard.press('Control+Enter');
    await page.waitForFunction(() => !window.__naos.getState().view.overlays.some((o) => o.id === 'followup'), undefined, { timeout: 2000 });
    assert(sent.filter((c) => c.type === 'agent.send').at(-1).priority === 'now', 'Ctrl+Enter did not send now');

    await page.keyboard.press('b');
    await page.waitForSelector('[aria-modal="true"] input');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(80);
    assert(sent.find((c) => c.type === 'agent.addBudget')?.addUsd === 1, 'budget not sent');
    await page.waitForFunction(() => !document.querySelector('[aria-modal="true"]'));

    await page.keyboard.press('o');
    await page.waitForSelector('[aria-modal="true"]');
    assert((await active()).text === 'Cancel', 'fork dialog does not start on Cancel');
    assert(sent.filter((c) => c.type === 'agent.fork').length === 0, 'O forked with one press');
    await page.locator('[aria-modal="true"] .dk-btn', { hasText: 'Fork' }).click();
    await page.waitForTimeout(80);
    assert(sent.filter((c) => c.type === 'agent.fork').length === 1, 'fork not sent');
    await page.waitForFunction(() => !document.querySelector('[aria-modal="true"]'));

    await page.keyboard.press('u');
    await page.waitForTimeout(60);
    assert(await page.locator('[aria-modal="true"]').count() === 0, 'resume opened on a live craft');
  });

  await t('at Craft level the Channel foot holds the box and STOP, and an ended craft resumes', async () => {
    await at(30);
    const node = await page.evaluate(() => Object.values(window.__naos.getState().model.crafts).find((row) => row.owned && row.live && row.state !== 'approve').id);
    await page.evaluate((id) => {
      const s = window.__naos.getState();
      window.__naos.setState({ view: { ...s.view, selected: id }, channel: { ...s.channel, nodeId: id } });
    }, node);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.hand-foot textarea');
    await page.keyboard.press('i');
    assert((await active()).tag === 'TEXTAREA', 'I did not focus the box');
    await page.keyboard.press('Escape');
    await shot('craft-foot');
    await page.locator('.hand-stop').click();
    await page.waitForSelector('[role="alertdialog"]');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[role="alertdialog"]'));
    const box = await page.locator('.hand-stop').boundingBox();
    await page.mouse.move(box.x + 4, box.y + 4);
    await page.mouse.down();
    await page.waitForTimeout(680);
    await page.mouse.up();
    await page.waitForTimeout(60);
    assert(sent.filter((c) => c.type === 'agent.stop').length === 1, 'pointer hold did not stop');
    assert(await page.locator('[role="alertdialog"]').count() === 0, 'a finished hold also opened the confirm');
    await fixture('play');
    await page.waitForFunction((id) => {
      const s = window.__naos.getState();
      return Object.values(s.fleet.managed).some((a) => a.nodeId === id && a.resumable);
    }, node, { timeout: 6000 });
    await fixture('pause');
    await page.waitForTimeout(300);
    await page.keyboard.press('u');
    await page.waitForSelector('[aria-modal="true"] input');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(80);
    assert(sent.filter((c) => c.type === 'agent.resume').length === 1, 'resume not sent');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  });

  await t('ledger: tiles, meters, bars with a readout, table views', async () => {
    await at(30);
    await page.keyboard.press('c');
    await page.waitForSelector('.lg-tile');
    await page.waitForSelector('.lg-bar');
    assert(await page.locator('.lg-tile').count() === 3, 'tiles');
    assert(await page.locator('.lg [role="meter"]').count() >= 2, 'meters');
    await page.locator('.lg-bar').first().hover();
    await page.waitForFunction(() => document.querySelector('.lg-readout')?.textContent.includes('est'));
    await page.locator('.lg-details summary').first().click();
    assert(await page.locator('.lg-details table').first().isVisible(), 'table view closed');
    await page.waitForTimeout(100);
    await shot('ledger');
    await page.keyboard.press('Escape');
  });

  await t('First Flight shows on an empty kernel, steps, launches and is done', async () => {
    await at(30);
    await page.evaluate(() => {
      localStorage.removeItem('naos.firstFlight');
      const s = window.__naos.getState();
      window.__naos.setState({ history: [], fleet: { ...s.fleet, nodes: {}, sessions: {}, managed: {}, approvals: {}, workflows: {} } });
    });
    await page.waitForSelector('.hand-first', { timeout: 4000 });
    await shot('first-flight');
    await page.locator('.hand-first .dk-btn', { hasText: 'Allow notifications' }).click();
    await page.locator('.hand-first .dk-btn', { hasText: 'Stay silent' }).click();
    await page.locator('.hand-first .dk-btn', { hasText: 'Launch test craft' }).click();
    await page.waitForTimeout(100);
    const spawn = sent.find((c) => c.type === 'agent.spawn');
    assert(spawn?.spec.profile === 'first-flight', `spawn ${JSON.stringify(spawn)}`);
    await page.waitForFunction(() => !document.querySelector('.hand-first'));
    assert((await page.evaluate(() => localStorage.getItem('naos.firstFlight'))) === 'done', 'First Flight is remembered as done');
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__naos?.getState().link.status === 'up', undefined, { timeout: 15_000 });
  });

  await t('the shot of the plain docket', async () => {
    await at(60, hasOpen('Bash'));
    await page.keyboard.press('Space');
    await page.waitForTimeout(120);
    await shot('docket-arming');
    await armed();
    await page.waitForTimeout(120);
    await shot('docket');
    await page.keyboard.press('Escape');
  });

  await t('kernel lost: buttons disabled, cannot be answered now, no key answers', async () => {
    await at(30, hasOpen('Bash'));
    await page.keyboard.press('Space');
    await armed();
    kernel.child.kill();
    await page.waitForFunction(() => document.querySelector('.docket')?.textContent.includes('cannot be answered now'), undefined, { timeout: 8000 });
    assert((await page.locator('.dk-btn[aria-disabled="true"]').count()) >= 5, 'buttons not disabled');
    await shot('docket-kernel-lost');
    await page.keyboard.press('a');
    await page.keyboard.press('d');
    await page.waitForTimeout(60);
    assert(answers().length === 0, 'a lost kernel took an answer');
    assert((await refusal()) === 'link-lost', `refusal ${await refusal()}`);
  });
} finally {
  await browser.close().catch(() => undefined);
  await vite.close().catch(() => undefined);
  kernel.child.kill();
  await new Promise((r) => { setTimeout(r, 300); });
  for (const dir of [kernelHome, viteCache]) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
}

clearTimeout(hardStop);
// A dead kernel is the point of the last test, so the browser's own lines about it are not faults.
const lostLines = /Failed to load resource|WebSocket connection to|net::ERR_CONNECTION_REFUSED|ECONNREFUSED|502|500 \(Internal/;
const faults = consoleErrors.filter((line) => !lostLines.test(line));
const failed = results.filter((r) => !r.ok);
const report = { wired, passed: results.length - failed.length, failed: failed.length, failures: failed, consoleErrors: faults, ignoredLinkLines: consoleErrors.length - faults.length };
writeFileSync(path.join(o.out, 'report.json'), JSON.stringify({ ...report, results }, null, 2));
console.log(JSON.stringify(report, null, 2));
if (failed.length > 0 || faults.length > 0) process.exitCode = 1;
process.exit();
