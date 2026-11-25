#!/usr/bin/env node
// The whole app lifecycle on a scratch home, with real kernels, a stub in place of the browser and no window at any point. The stub
// only records its arguments, which hold the UI token, so nothing here prints them. The one real browser is headless, through shot.mjs.
//   node scripts/e2e-app.mjs [--tmp <dir>] [--only <text>] [--build]
//   --build  also runs a fresh clone's first start, a real vite build into a scratch folder, about a minute
import { execFile, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { createServer as netServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { WebSocket } from 'ws';
import { openLink } from '../packages/kernel/src/server/open.ts';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values: o } = parseArgs({ options: { tmp: { type: 'string', default: tmpdir() }, only: { type: 'string' }, build: { type: 'boolean', default: false } } });

const RUN_LIMIT_MS = 300_000;
const root = path.join(o.tmp, `naos e2e app ${process.pid}`);
const stub = path.join(root, 'stub-browser.mjs');
mkdirSync(root, { recursive: true });
writeFileSync(stub, "import { appendFileSync } from 'node:fs';\nappendFileSync(process.env.NAOS_STUB_LOG, `${JSON.stringify(process.argv.slice(2))}\\n`);\n");

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : `  (${detail})`}`);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve, reject) => {
  const s = netServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(test, ms = 15_000) {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await test()) return true;
    if (Date.now() > deadline) return false;
    await sleep(100);
  }
}

const powershell = (script, env = {}) => promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
  encoding: 'utf8', windowsHide: true, env: { ...process.env, ...env },
}).then(({ stdout }) => stdout.trim());

/** Pids only: a command line here can hold a token. */
async function processesUnder(folder) {
  const out = await powershell("Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:NAOS_E2E_ROOT) -and $_.ProcessId -ne $PID } | ForEach-Object { $_.ProcessId }", { NAOS_E2E_ROOT: folder });
  return out.split(/\s+/).filter(Boolean).map(Number).filter((pid) => pid !== process.pid);
}

function caseFolder(name) {
  const home = path.join(root, name);
  mkdirSync(home, { recursive: true });
  return { home, stubLog: path.join(home, 'stub.log') };
}

function environment({ stubLog, home }, over = {}) {
  const env = { ...process.env, NAOS_APP_BROWSER: stub, NAOS_STUB_LOG: stubLog, NAOS_NO_TOAST: '1', NAOS_HOME: home, ...over };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

function collect(child) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => { stdout += d; });
    child.stderr?.on('data', (d) => { stderr += d; });
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

const CLI = ['--disable-warning=ExperimentalWarning', 'packages/kernel/src/cli.ts'];
const naos = (kase, ...args) => collect(spawn(process.execPath, [...CLI, ...args.map(String)], { cwd: repo, env: environment(kase), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }));
const stubCalls = ({ stubLog }) => (existsSync(stubLog) ? readFileSync(stubLog, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
const runFile = ({ home }) => { try { return JSON.parse(readFileSync(path.join(home, 'kernel.json'), 'utf8')); } catch { return null; } };
const tokenOf = ({ home }, name = 'ui') => readFileSync(path.join(home, `${name}.token`), 'utf8').trim();
const said = (result) => { try { return JSON.parse(result.stdout.trim().split('\n').at(-1)); } catch { return {}; } };

function killHard(pid) {
  return promisify(execFile)('taskkill', ['/PID', String(pid), '/F'], { windowsHide: true }).catch(() => {});
}

function raw(port, route, headers, method = 'GET') {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: route, method, headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('error', reject);
    request.end();
  });
}

const NAVIGATION = { 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'sec-fetch-user': '?1' };
const { 'sec-fetch-user': activation, ...TOAST_NAVIGATION } = NAVIGATION;

/** A plain HTTP server on a free port. Its `port` is free for the caller to give, so an impostor can sit where a kernel was. */
async function listen(answer, port = 0) {
  const server = http.createServer(answer);
  await new Promise((resolve) => { server.listen(port, '127.0.0.1', resolve); });
  return {
    port: server.address().port,
    close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }),
  };
}

async function lifecycle() {
  const kase = caseFolder('lifecycle');
  const port = await freePort();

  const first = await naos(kase, 'open', '--port', port, '--home', kase.home);
  const run = runFile(kase);
  check('start: exits 0 and says it started', first.code === 0 && said(first).how === 'started', `code ${first.code}`);
  check('start: the kernel outlives the click that started it', run !== null && alive(run.pid));
  check('start: the kernel listens on the asked port', run?.port === port);
  check('start: the window opened once', await until(() => stubCalls(kase).length === 1, 5000));

  const [args] = stubCalls(kase);
  check('window: --app points at /auth on this port', typeof args?.[0] === 'string' && args[0].startsWith(`--app=http://127.0.0.1:${port}/auth?token=`));
  check('window: a profile of its own under the home', args?.[1] === `--user-data-dir=${path.join(kase.home, 'app-profile')}`);
  check('window: the flags', ['--no-first-run', '--no-default-browser-check', '--disable-sync', '--start-maximized'].every((flag) => args?.includes(flag)));

  const second = await naos(kase, 'open', '--port', port, '--home', kase.home);
  check('attach: same kernel, a second window', said(second).how === 'attached' && runFile(kase)?.pid === run?.pid && await until(() => stubCalls(kase).length === 2, 5000));

  const noOpen = await naos(kase, 'open', '--no-open', '--port', port, '--home', kase.home);
  await sleep(300);
  check('attach: --no-open opens nothing', noOpen.code === 0 && stubCalls(kase).length === 2);

  const token = tokenOf(kase);
  const logs = readdirSync(path.join(kase.home, 'logs')).map((name) => readFileSync(path.join(kase.home, 'logs', name), 'utf8')).join('\n');
  check('logs: the token is in no log', logs.length > 0 && !logs.includes(token));

  const quit = await naos(kase, 'quit', '--home', kase.home);
  check('quit: allowed with nothing alive, and the process is gone', quit.code === 0 && run !== null && !alive(run.pid), `code ${quit.code}`);
  check('quit: the run file is gone', runFile(kase) === null);
  const again = await naos(kase, 'quit', '--home', kase.home);
  check('quit: with no kernel it says so', again.code === 1 && /no kernel is running/.test(again.stderr));
}

async function raceAndStale() {
  const kase = caseFolder('race');
  const port = await freePort();

  const both = await Promise.all([1, 2, 3].map(() => naos(kase, 'open', '--port', port, '--home', kase.home)));
  check('race: every open exits 0', both.every((one) => one.code === 0), both.map((one) => one.code).join());
  const hows = both.map((one) => said(one).how).sort();
  check('race: one started, the others joined or attached', hows.filter((how) => how === 'started').length === 1, hows.join());
  const kernels = await processesUnder(kase.home);
  check('race: one kernel', kernels.length === 1, `${kernels.length}`);
  check('race: no error left in the log', !existsSync(path.join(kase.home, 'logs', 'open.log')));
  check('race: the lock is gone', !existsSync(path.join(kase.home, 'open.lock')));
  await until(() => stubCalls(kase).length > 0, 5000);
  check('race: the joiners left the window to the winner', stubCalls(kase).length === hows.filter((how) => how !== 'joined').length, `${stubCalls(kase).length}`);

  const crashed = runFile(kase).pid;
  await killHard(crashed);
  await until(() => !alive(crashed));
  check('stale: a hard kill leaves the run file behind', runFile(kase)?.pid === crashed);
  const after = await naos(kase, 'open', '--no-open', '--port', port, '--home', kase.home);
  check('stale: the next open starts a new kernel', after.code === 0 && said(after).how === 'started' && runFile(kase)?.pid !== crashed, `code ${after.code}`);

  const second = runFile(kase).pid;
  await killHard(second);
  await until(() => !alive(second));
  // This script is a live process, which is what a pid reused after the crash looks like.
  writeFileSync(path.join(kase.home, 'kernel.json'), JSON.stringify({ pid: process.pid, port: await freePort(), mode: 'live', startedAt: 0 }));
  const reused = await naos(kase, 'open', '--no-open', '--port', port, '--home', kase.home);
  check('stale: a reused pid does not block it', reused.code === 0 && said(reused).how === 'started', `code ${reused.code}`);
  await naos(kase, 'quit', '--home', kase.home);

  const deadLock = () => writeFileSync(path.join(kase.home, 'open.lock'), JSON.stringify({ pid: 2 ** 22 + 1, at: Date.now() }));
  deadLock();
  const locked = await naos(kase, 'open', '--no-open', '--port', port, '--home', kase.home);
  check('stale: a lock whose holder died does not block it', locked.code === 0 && said(locked).how === 'started', `code ${locked.code}`);
  await naos(kase, 'quit', '--home', kase.home);

  for (let round = 1; round <= 3; round += 1) {
    deadLock();
    const crowd = await Promise.all([1, 2, 3, 4, 5].map(() => naos(kase, 'open', '--no-open', '--port', port, '--home', kase.home)));
    const started = crowd.filter((one) => said(one).how === 'started').length;
    check(`stale: five opens at a dead lock start one kernel, round ${round}`, crowd.every((one) => one.code === 0) && started === 1 && (await processesUnder(kase.home)).length === 1, `started ${started}`);
    await naos(kase, 'quit', '--home', kase.home);
  }
}

async function stranger() {
  const kase = caseFolder('stranger');
  const server = http.createServer((_req, res) => res.end('{}'));
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address();
  try {
    const result = await naos(kase, 'open', '--port', port, '--home', kase.home);
    check('stranger: a plain sentence, on exit code 3', result.code === 3 && new RegExp(`Port ${port} is taken by another program`).test(result.stderr), `code ${result.code}`);
    check('stranger: the reason is in a log in the home', /is taken by another program/.test(readFileSync(path.join(kase.home, 'logs', 'open.log'), 'utf8')));
    check('stranger: no kernel, no window', (await processesUnder(kase.home)).length === 0 && stubCalls(kase).length === 0);
    check('stranger: no lock left behind', !existsSync(path.join(kase.home, 'open.lock')));
  } finally {
    server.close();
  }
}

/** A listener where a kernel was must never get the token, and must never get a window. */
async function impostor() {
  const kase = caseFolder('impostor');
  const port = await freePort();
  await naos(kase, 'open', '--no-open', '--port', port, '--home', kase.home);
  await naos(kase, 'quit', '--home', kase.home);
  const token = tokenOf(kase);

  for (const [name, body] of [['a plain server', '{}'], ['one shaped like a kernel', '{"kernel":{"pid":1}}']]) {
    const seen = [];
    const fake = await listen((req, res) => {
      seen.push(JSON.stringify([req.url, req.rawHeaders]));
      res.end(body);
    }, port);
    try {
      const result = await naos(kase, 'open', '--port', port, '--home', kase.home);
      check(`impostor: ${name} ends in a plain sentence, on exit code 3`, result.code === 3 && /taken by another program/.test(result.stderr), `code ${result.code}`);
      check(`impostor: ${name} gets no window`, stubCalls(kase).length === 0);
      check(`impostor: ${name} never sees the token`, seen.length > 0 && !seen.some((row) => row.includes(token)));
    } finally {
      await fake.close();
    }
  }

  const seen = [];
  const fake = await listen((req, res) => {
    seen.push(JSON.stringify([req.url, req.rawHeaders]));
    res.end('{}');
  }, port);
  // This script is a live process, so the run file looks believable: a pid reused after a crash, a port gone to someone else.
  writeFileSync(path.join(kase.home, 'kernel.json'), JSON.stringify({ pid: process.pid, port, mode: 'live', startedAt: 0 }));
  try {
    const status = await naos(kase, 'status', '--home', kase.home);
    const stop = await naos(kase, 'stop-all', '--home', kase.home);
    check('impostor: the CLI commands refuse it too', status.code === 1 && stop.code === 1 && /no kernel of this home answers/.test(status.stderr), `code ${status.code}`);
    check('impostor: and they never hand it the token', seen.length > 0 && !seen.some((row) => row.includes(token)));
  } finally {
    await fake.close();
    rmSync(path.join(kase.home, 'kernel.json'), { force: true });
  }
}

/** A kernel that cannot listen has to leave: started detached it would hide, with the database open, for as long as it lived. */
async function failedStart() {
  const winner = caseFolder('winner');
  const loser = caseFolder('loser');
  const port = await freePort();
  await naos(winner, 'open', '--no-open', '--port', port, '--home', winner.home);
  const up = await collect(spawn(process.execPath, [...CLI, 'up', '--no-open', '--port', String(port), '--home', loser.home], {
    cwd: repo, env: environment(loser), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 20_000,
  }));
  check('failed start: a kernel that cannot listen exits by itself, with code 1', up.code === 1 && /EADDRINUSE/.test(up.stderr), `code ${up.code}`);
  check('failed start: nothing of it stays', (await processesUnder(loser.home)).length === 0);
  await naos(winner, 'quit', '--home', winner.home);
}

async function openRoute() {
  const kase = caseFolder('route');
  const port = await freePort();
  await naos(kase, 'open', '--no-open', '--port', port, '--home', kase.home);
  const host = `127.0.0.1:${port}`;
  const link = (id) => openLink('', tokenOf(kase), id);
  const route = `http://127.0.0.1:${port}`;

  const crossSite = await raw(port, link('toolu_e2e'), { host, 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' });
  const noHeaders = await raw(port, link('toolu_e2e'), { host });
  const foreignHost = await raw(port, link('toolu_e2e'), { ...NAVIGATION, host: 'evil.example' });
  check('/open: refuses a web page, a bare client and a foreign Host', [crossSite, noHeaders, foreignHost].every((reply) => reply.status === 403));
  check('/open: refuses a link the kernel did not write', (await raw(port, '/open?docket=toolu_e2e', { ...NAVIGATION, host })).status === 403);
  check('/open: a bad id is a 400', (await raw(port, '/open?docket=a%2Fb', { ...NAVIGATION, host })).status === 400);
  await sleep(300);
  check('/open: nothing opened so far', stubCalls(kase).length === 0);

  const click = await raw(port, link('toolu_e2e'), { ...NAVIGATION, host });
  const data = /kernel|session|token|toolu|craft/i.test(click.text);
  check('/open: a click answers 200 with no data', click.status === 200 && !data);
  check('/open: the stub got the decision in the fragment', await until(() => stubCalls(kase).length === 1, 5000)
    && stubCalls(kase)[0][0].startsWith(`--app=http://127.0.0.1:${port}/auth?token=`) && stubCalls(kase)[0][0].endsWith('#docket=toolu_e2e'));

  // Headers typed by hand prove little, so the same two cases go through a real browser. Either page may end the shot by navigating away.
  const out = path.join(root, 'shot');
  const browser = (url, ...more) => collect(spawn(process.execPath, ['scripts/shot.mjs', '--url', url, '--no-shot', '--out', out, '--wait', '300', ...more], {
    cwd: repo, env: environment(kase), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  }));
  await browser(`${route}${link('toolu_browser')}`, '--name', 'navigation');
  check('/open: a navigation in a real browser gets through', await until(() => stubCalls(kase).length === 2, 5000) && stubCalls(kase)[1][0].endsWith('#docket=toolu_browser'));

  const refused = (reason) => readdirSync(path.join(kase.home, 'logs')).filter((name) => name.startsWith('kernel-2'))
    .some((name) => readFileSync(path.join(kase.home, 'logs', name), 'utf8').includes(`"msg":"open refused","reason":"${reason}"`));

  const anchor = `<a id="a" href="${route}${link('toolu_evil')}">x</a>`;
  await browser(`data:text/html,${encodeURIComponent(anchor)}`, '--name', 'cross-site', '--eval', "document.getElementById('a').click()");
  check('/open: a link clicked on a web page reached the kernel and was refused', await until(() => refused('sec-fetch-site'), 5000));
  check('/open: that click opened nothing', stubCalls(kase).length === 2);

  // The two ways the verifier got past the fetch metadata, each from a web server of their own, in the real browser.
  const speculation = JSON.stringify({ prefetch: [{ source: 'list', urls: [`${route}${link('toolu_prefetch')}`] }], prerender: [{ source: 'list', urls: [`${route}${link('toolu_prerender')}`] }] });
  const site = await listen((req, res) => {
    if (req.url === '/hop') {
      res.writeHead(302, { location: `${route}/open?docket=toolu_redirect` });
      res.end();
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><title>x</title><script type="speculationrules">${speculation}</script>`);
  });
  try {
    await browser(`http://localhost:${site.port}/hop`, '--name', 'redirect');
    check('/open: a redirect arrives looking like a click, and the missing signature stops it', await until(() => refused('signature'), 5000));
    await browser(`http://localhost:${site.port}/page`, '--name', 'speculation');
    check('/open: speculation rules reach the kernel and are refused, even holding a real link', await until(() => refused('sec-purpose'), 5000));
  } finally {
    await site.close();
  }
  check('/open: neither of those opened anything', stubCalls(kase).length === 2);

  check('/open: a forged link with no user activation is refused on its signature', (await raw(port, '/open?docket=toolu_e2e', { ...TOAST_NAVIGATION, host })).status === 403);
  const toast = await raw(port, link('toolu_toast'), { ...TOAST_NAVIGATION, host });
  check('/open: a toast click with no user activation opens the window', toast.status === 200 && await until(() => stubCalls(kase).length === 3, 5000) && stubCalls(kase)[2][0].endsWith('#docket=toolu_toast'));

  const burst = [];
  for (let n = 0; n < 6; n += 1) burst.push((await raw(port, link('toolu_e2e'), { ...NAVIGATION, host })).status);
  check('/open: rate limited', burst.at(-1) === 429 && burst.filter((status) => status === 200).length === 2, burst.join());
  await naos(kase, 'quit', '--home', kase.home);
}

async function idleExit() {
  const kase = caseFolder('idle');
  const port = await freePort();
  const IDLE = '0.03';
  const started = Date.now();
  await naos(kase, 'open', '--no-open', '--idle-exit', IDLE, '--port', port, '--home', kase.home);
  const quiet = runFile(kase).pid;
  check('idle: it leaves by itself', await until(() => !alive(quiet), 15_000));
  check('idle: not before its time', Date.now() - started >= 1800);
  check('idle: cleanly, the run file is gone', runFile(kase) === null);

  await naos(kase, 'open', '--no-open', '--idle-exit', IDLE, '--port', port, '--home', kase.home);
  const watched = runFile(kase).pid;
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { authorization: `Bearer ${tokenOf(kase)}` } });
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  await sleep(4000);
  check('idle: an open window keeps it', alive(watched));
  socket.terminate();
  check('idle: closing the window starts the clock, and it goes', await until(() => !alive(watched), 15_000));
}

/** The fixture has live craft and an open decision without a single model call. */
async function craftAlive() {
  const kase = caseFolder('craft');
  const port = await freePort();
  const child = spawn(process.execPath, [...CLI, 'fixture', '--port', String(port), '--home', kase.home, '--no-open', '--idle-exit', '0.03'], {
    cwd: repo, env: environment(kase), stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true, detached: true,
  });
  child.unref();
  await until(() => runFile(kase) !== null);
  const cmd = (body, token = tokenOf(kase)) => fetch(`http://127.0.0.1:${port}/api/cmd`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  });
  await cmd({ type: 'fixture.control', action: 'pause' });
  await cmd({ type: 'fixture.control', action: 'seek', value: 30 });

  const refused = await naos(kase, 'quit', '--home', kase.home);
  check('quit: refused while craft are alive, and it says how many', refused.code === 1 && /\d+ owned craft are still alive/.test(refused.stderr), `code ${refused.code}`);
  check('quit: the kernel is still there', alive(runFile(kase).pid));
  check('quit: MCP scope has no route to it', (await cmd({ type: 'kernel.quit' }, tokenOf(kase, 'mcp'))).status === 403);

  const adopted = await naos(kase, 'open', '--port', port, '--home', kase.home);
  check('fixture: a click is told so, and never shows the scripted fleet as the real one', adopted.code === 3 && /fixture holds this home/.test(adopted.stderr) && stubCalls(kase).length === 0, `code ${adopted.code}`);

  await sleep(3500);
  check('idle: it never leaves while a craft is alive', runFile(kase) !== null && alive(runFile(kase).pid));

  const state = await new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { authorization: `Bearer ${tokenOf(kase)}` } });
    socket.on('message', (data) => {
      const frame = JSON.parse(data.toString('utf8'));
      if (frame.t === 'snapshot') { socket.terminate(); resolve(frame.state); }
    });
    socket.once('error', reject);
  });
  const decision = Object.values(state.approvals).find((approval) => approval.status === 'open');
  check('fragment: the scene holds an open decision', decision !== undefined);

  const out = path.join(root, 'shot');
  const shot = await collect(spawn(process.execPath, [
    'scripts/shot.mjs', '--url', `http://127.0.0.1:${port}/auth?token=${tokenOf(kase)}#docket=${decision.requestId}`, '--no-shot', '--out', out, '--name', 'fragment',
    '--wait', '2500', '--eval', "({ hash: location.hash, path: location.pathname, docket: window.__naos.getState().view.overlays.some((row) => row.id === 'docket') })",
  ], { cwd: repo, env: environment(kase), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }));
  const page = (() => { try { return JSON.parse(readFileSync(path.join(out, 'fragment.json'), 'utf8')).eval; } catch { return null; } })();
  check('fragment: it survives the 302 at /auth in a real browser', shot.code === 0 && page?.path === '/' && page?.hash === `#docket=${decision.requestId}`, `code ${shot.code}`);
  check('fragment: main.tsx opens that docket', page?.docket === true);

  const pid = runFile(kase).pid;
  await cmd({ type: 'fixture.control', action: 'idle' });
  check('idle: with the craft gone it leaves by itself', await until(() => !alive(pid), 15_000));
}

async function shortcut() {
  const kase = caseFolder('shortcut');
  const folder = path.join(root, 'Start Menu Test');
  const made = await naos(kase, 'shortcut', '--dir', folder);
  const lnk = path.join(folder, 'NAOS.lnk');
  check('shortcut: created in the given folder', made.code === 0 && existsSync(lnk), made.stderr.trim());

  const link = JSON.parse(await powershell('$l = (New-Object -ComObject WScript.Shell).CreateShortcut($env:NAOS_E2E_LNK); @{ target = $l.TargetPath; args = $l.Arguments; cwd = $l.WorkingDirectory; icon = $l.IconLocation; style = $l.WindowStyle } | ConvertTo-Json -Compress', { NAOS_E2E_LNK: lnk }));
  const launcher = path.join(repo, 'scripts', 'naos-launch.js');
  check('shortcut: the target is wscript, which has no console', /\\System32\\wscript\.exe$/i.test(link.target) && existsSync(link.target), link.target);
  check('shortcut: the arguments name the launcher and this node', link.args === `//nologo //E:jscript "${launcher}" "${process.execPath}"`, link.args);
  check('shortcut: the working folder is the repo', link.cwd.toLowerCase() === repo.toLowerCase(), link.cwd);
  check('shortcut: the icon exists', link.icon.toLowerCase() === `${path.join(repo, 'packages', 'ui', 'public', 'naos.ico')},0`.toLowerCase() && existsSync(link.icon.replace(/,0$/, '')), link.icon);

  // The link's own command, on cscript: wscript would answer a failure with a message box, and cscript prints the same words.
  const runLauncher = (file, ...args) => collect(spawn('cscript.exe', ['//nologo', '//E:jscript', file, ...args], {
    cwd: repo, env: environment(kase, { NAOS_PORT: String(port) }), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  }));
  const script = (...args) => runLauncher(launcher, ...args);
  const port = await freePort();
  const click = await script(process.execPath);
  check('launcher: runs node at the stored path and starts the kernel, silently', click.code === 0 && click.stdout.trim() === '' && runFile(kase) !== null, `code ${click.code}`);
  check('launcher: the window opened', await until(() => stubCalls(kase).length === 1, 5000));
  await naos(kase, 'quit', '--home', kase.home);

  const gone = await script('C:\\nowhere\\node.exe');
  check('launcher: a node that moved gets a plain sentence', /could not find Node/.test(gone.stdout), gone.stdout.trim());

  const held = netServer();
  await new Promise((resolve) => { held.listen(port, '127.0.0.1', resolve); });
  const refused = await script(process.execPath);
  held.close();
  check('launcher: leaves a reported failure to the toast', refused.code === 3 && refused.stdout.trim() === '', `code ${refused.code}`);

  // A repo in a folder that reads like a variable, with a stand-in cli.ts that leaves a mark.
  const odd = path.join(root, 'pct 100%TEMP%x');
  const mark = path.join(kase.home, 'odd folder ran');
  mkdirSync(path.join(odd, 'scripts'), { recursive: true });
  mkdirSync(path.join(odd, 'packages', 'kernel', 'src'), { recursive: true });
  copyFileSync(launcher, path.join(odd, 'scripts', 'naos-launch.js'));
  writeFileSync(path.join(odd, 'packages', 'kernel', 'src', 'cli.ts'), `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(mark)}, '');\n`);
  const oddRun = await runLauncher(path.join(odd, 'scripts', 'naos-launch.js'), process.execPath);
  check('launcher: a % in the repo path stays what it is', oddRun.code === 0 && existsSync(mark), `code ${oddRun.code}`);

  const removed = await naos(kase, 'shortcut', '--dir', folder, '--remove');
  check('shortcut: --remove takes it away', removed.code === 0 && !existsSync(lnk));
}

async function freshClone() {
  const kase = caseFolder('fresh');
  const dist = path.join(kase.home, 'no dist yet');
  const port = await freePort();
  const child = spawn(process.execPath, [...CLI, 'open', '--no-open', '--port', String(port), '--home', kase.home], {
    cwd: repo, env: environment(kase, { NAOS_UI_DIST: dist }), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  const result = await collect(child);
  check('fresh clone: the first open builds the UI, then starts', result.code === 0 && existsSync(path.join(dist, 'index.html')), `code ${result.code}`);
  check('fresh clone: the wait was announced', /Building the NAOS window/.test(readFileSync(path.join(kase.home, 'logs', 'open.log'), 'utf8')));
  await naos(kase, 'quit', '--home', kase.home);
}

const CASES = { lifecycle, raceAndStale, stranger, impostor, failedStart, openRoute, idleExit, craftAlive, shortcut, ...(o.build ? { freshClone } : {}) };

const hardStop = setTimeout(() => { console.error('e2e-app: run limit reached'); process.exit(2); }, RUN_LIMIT_MS);
hardStop.unref();

try {
  for (const [name, run] of Object.entries(CASES)) {
    if (o.only && !name.toLowerCase().includes(o.only.toLowerCase())) continue;
    console.log(`\n${name}`);
    await run();
  }
} catch (error) {
  check('the run finished', false, error instanceof Error ? error.message.replace(/token=[^#&\s]+/g, 'token=<redacted>') : 'unknown');
} finally {
  const left = await processesUnder(root);
  check('nothing is left running', left.length === 0, `${left.length} left`);
  for (const pid of left) await killHard(pid);
  await until(async () => (await processesUnder(root)).length === 0, 5000);
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

const failed = results.filter((row) => !row.ok);
console.log(`\n${results.length - failed.length} of ${results.length} passed`);
process.exitCode = failed.length > 0 ? 1 : 0;
