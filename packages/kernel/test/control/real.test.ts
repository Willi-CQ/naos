// Real agents through the real kernel: HTTP auth, scopes, router, Control and the unmodified binary. Nothing is faked here.
// Skipped unless NAOS_REAL=1. It spends real plan quota, so it also needs NAOS_REAL_SANDBOX, a folder under the scratchpad.
// Each run gets its own git repo there, every agent runs on Haiku at low effort, and a ledger next to the runs caps the total.
//
//   NAOS_REAL=1 NAOS_REAL_SANDBOX=<scratchpad>/build/control-sandbox node --test packages/kernel/test/control/real.test.ts
import { query as sdkQuery, type Options, type Query } from '@anthropic-ai/claude-agent-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ApprovalDecision, ApprovalView, Command, CommandResult, ManagedAgentView, NaosEvent, PreflightResult, SpawnReceipt, SpawnSpec } from '@naos/protocol';
import { FIRST_FLIGHT_SPEC } from '@naos/protocol';
import assert from 'node:assert/strict';
import { execFileSync, spawn as spawnProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { agentEnv } from '../../src/control/driver.ts';
import { createControl, type Control } from '../../src/control/index.ts';
import { descendants, snapshot, type Proc } from '../../src/control/procs.ts';
import { startKernel, type RunningKernel } from '../../src/main.ts';

const REAL = process.env.NAOS_REAL === '1';
const SANDBOX = process.env.NAOS_REAL_SANDBOX ?? '';
/** Ledger total across runs in this sandbox. Past this nothing starts: the work package has $0.50 and this leaves a margin. */
const LEDGER_STOP_USD = 0.4;
const LIMIT_MS = 150_000;

const PROFILES = {
  'sandbox.md': '---\nname: sandbox\ndescription: Real test agent.\nmodel: claude-haiku-5-5\neffort: low\npermissionMode: default\ndefaultBudgetUsd: 0.03\nmaxTurns: 6\n---\n',
  'lead.md': '---\nname: lead\ndescription: Real test orchestrator.\nmodel: claude-haiku-5-5\neffort: low\npermissionMode: default\ndefaultBudgetUsd: 0.03\nmaxTurns: 8\norchestrator: true\ntools: [Read]\n---\n',
};

const log = (line: string): void => console.log(`[real] ${line}`);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function until<T>(what: string, read: () => T | null | undefined | false | Promise<T | null | undefined | false>, ms = 60_000, every = 50): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(every);
  }
}

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-C', cwd, '-c', 'user.name=naos', '-c', 'user.email=naos@example.invalid', ...args], { encoding: 'utf8', windowsHide: true }).trim();

const ledgerFile = (): string => path.join(SANDBOX, 'ledger.jsonl');
const ledgerTotal = (): number => {
  if (!fs.existsSync(ledgerFile())) return 0;
  return fs.readFileSync(ledgerFile(), 'utf8').split('\n').filter(Boolean).reduce((sum, line) => sum + (JSON.parse(line) as { usd: number }).usd, 0);
};

describe('real agents', { skip: REAL ? false : 'set NAOS_REAL=1 and NAOS_REAL_SANDBOX', concurrency: false }, () => {
  let root: string;
  let repo: string;
  let home: string;
  let kernel: RunningKernel;
  let control: Control;
  let port: number;
  const events: NaosEvent[] = [];
  const launches: Array<{ options: Options; rowState: string | null }> = [];
  const sessionIdsOf = (o: Options): string | undefined => o.resume ?? o.sessionId;
  const frameKinds = new Map<string, number>();
  const inits: Array<{ cwd: string; mcp: string[]; tools: number }> = [];
  const totals: number[] = [];

  /** Counts frame types, structure only, so the report can say what the binary really sent. */
  const tally = (q: Query): Query => {
    const proxy: Query = new Proxy(q, {
      get(target, key) {
        if (key === Symbol.asyncIterator) return () => proxy;
        if (key === 'next') {
          return async () => {
            const r = await target.next();
            if (!r.done) {
              const m = r.value as unknown as { type: string; subtype?: string; cwd?: string; mcp_servers?: Array<{ name: string }>; tools?: string[]; total_cost_usd?: number };
              const kind = m.subtype ? `${m.type}/${m.subtype}` : m.type;
              frameKinds.set(kind, (frameKinds.get(kind) ?? 0) + 1);
              if (m.type === 'result') totals.push(m.total_cost_usd ?? 0);
              if (kind === 'system/init') inits.push({ cwd: m.cwd ?? '', mcp: (m.mcp_servers ?? []).map((s) => s.name), tools: m.tools?.length ?? 0 });
            }
            return r;
          };
        }
        const value = Reflect.get(target, key) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    return proxy;
  };

  const post = async (body: Command, token: string): Promise<{ status: number; reply: CommandResult }> => {
    const response = await fetch(`http://127.0.0.1:${port}/api/cmd`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, reply: await response.json() as CommandResult };
  };

  const ui = async <T>(body: Command): Promise<T> => {
    const { reply } = await post(body, kernel.tokens.ui);
    if (!reply.ok) throw new Error(`${body.type} refused: ${reply.error.code} ${reply.error.message}`);
    return reply.result as T;
  };

  const spawn = async (spec: SpawnSpec): Promise<string> => (await ui<SpawnReceipt>({ type: 'agent.spawn', spec })).agentIds[0]!;
  const view = (agentId: string): Promise<ManagedAgentView> => ui<ManagedAgentView>({ type: 'agent.status', agentId });
  const answer = (requestId: string, decision: ApprovalDecision): Promise<{ applied: boolean }> => ui({ type: 'approval.answer', requestId, decision, clientId: 'real-test' });
  const open = (agentId: string): ApprovalView[] =>
    Object.values(kernel.bus.state().approvals).filter((a) => a.agentId === agentId && a.status === 'open');
  const nextApproval = (agentId: string): Promise<ApprovalView> => until('an open approval', () => open(agentId)[0], 60_000);

  /** Until the agent settled. `onApproval` answers whatever the model raises on the way. */
  const settle = async (agentId: string, onApproval?: (a: ApprovalView) => Promise<unknown>, ms = 90_000): Promise<{ agent: ManagedAgentView; result: string | null }> => {
    const end = Date.now() + ms;
    for (;;) {
      const pending = open(agentId)[0];
      if (pending) {
        if (!onApproval) throw new Error(`unexpected approval for ${pending.toolName}`);
        await onApproval(pending);
      }
      const r = await ui<{ agent: ManagedAgentView; result: string | null; done: boolean }>({ type: 'agent.wait', agentId, timeoutS: 1 });
      if (r.done) return r;
      if (Date.now() > end) throw new Error(`agent stayed ${r.agent.state}`);
    }
  };

  /** The repo's world exists once a craft was placed there. A prompt-less spawn costs nothing. */
  const spawnIdle = async (): Promise<ManagedAgentView> => {
    const agentId = await spawn({ cwd: repo, profile: 'sandbox', prompt: '' });
    const v = await until('a ready craft', async () => { const r = await view(agentId); return r.state === 'ready' ? r : null; }, 30_000, 100);
    await ui({ type: 'agent.stop', agentId });
    return v;
  };

  const managedStates = (agentId: string): string[] => {
    const out: string[] = [];
    for (const e of events) {
      if (e.type !== 'managed.upserted' || e.agent.agentId !== agentId) continue;
      if (out.at(-1) !== e.agent.state) out.push(e.agent.state);
    }
    return out;
  };

  /** Claude processes under this test, however deep. */
  const ours = async (): Promise<Proc[]> => {
    const procs = await snapshot();
    return descendants(process.pid, procs).filter((p) => /^claude(\.exe)?$/i.test(p.name));
  };

  before(async () => {
    assert.ok(SANDBOX, 'NAOS_REAL_SANDBOX must name a folder under the scratchpad');
    assert.equal(process.platform, 'win32', 'these runs measure Windows process trees');
    fs.mkdirSync(SANDBOX, { recursive: true });
    const spent = ledgerTotal();
    log(`ledger before this run: $${spent.toFixed(4)}`);
    assert.ok(spent < LEDGER_STOP_USD, `the ledger holds $${spent.toFixed(4)}, past the stop at $${LEDGER_STOP_USD}`);

    root = path.join(SANDBOX, `run-${Date.now().toString(36)}`);
    repo = path.join(root, 'repo');
    home = path.join(root, 'home');
    fs.mkdirSync(repo, { recursive: true });
    fs.mkdirSync(path.join(home, 'agents'), { recursive: true });
    for (const [file, text] of Object.entries(PROFILES)) fs.writeFileSync(path.join(home, 'agents', file), text);
    git(repo, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(repo, 'README.md'), 'Sandbox.\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'sandbox');

    control = createControl({
      profilesDir: path.join(home, 'agents'),
      query: (params) => {
        const id = sessionIdsOf(params.options);
        launches.push({ options: params.options, rowState: control.store.agents().find((a) => a.view.sessionId === id)?.view.state ?? null });
        return tally(sdkQuery(params));
      },
    });
    kernel = await startKernel({
      config: { mode: 'live', port: 0, home, claudeHome: path.join(os.homedir(), '.claude'), uiDist: '', repoRoot: home, devOrigins: [] },
      planes: [control],
      logToStderr: false,
    });
    await kernel.planesReady;
    port = kernel.config.port;
    kernel.bus.subscribe((e) => { events.push(e); });
  });

  after(async () => {
    if (!kernel) return;
    const rows = Object.values(kernel.bus.state().managed);
    let total = 0;
    for (const v of rows) {
      total += v.spentUsd;
      log(`spent ${v.agentId} ${v.profile} ${v.state} turns=${v.turn} tools=${v.toolCalls} $${v.spentUsd.toFixed(5)}`);
    }
    await kernel.stop();
    fs.appendFileSync(ledgerFile(), `${JSON.stringify({ run: path.basename(root), usd: total, agents: rows.length })}\n`);
    log(`this run: $${total.toFixed(4)}, ledger now: $${ledgerTotal().toFixed(4)}`);
    const left = await ours();
    log(`frames: ${[...frameKinds].sort().map(([k, n]) => `${k}=${n}`).join(' ')}`);
    const logs = path.join(home, 'logs');
    const lines = fs.existsSync(logs) ? fs.readdirSync(logs, { withFileTypes: true }).filter((e) => e.isFile()).flatMap((e) => fs.readFileSync(path.join(logs, e.name), 'utf8').split('\n')) : [];
    log(`exits with unknown frames: ${lines.filter((l) => l.includes('unknown frames')).length}`);
    log(`claude processes left under this test: ${left.length}`);
    assert.equal(left.length, 0);
  });

  describe('one agent through its life', { concurrency: false }, () => {
    const code = `kestrel-${randomBytes(3).toString('hex')}`;
    let agentId: string;
    let pid: number;
    let spent = 0;

    it('spawns: the row exists before query(), the base options are on, and the process is real', { timeout: LIMIT_MS }, async () => {
      agentId = await spawn({
        cwd: repo, profile: 'sandbox',
        prompt: `The codeword is ${code}. Use the Write tool to create the file approved.txt in the current folder with the single line hello. Then reply with the word done.`,
      });
      const approval = await nextApproval(agentId);
      assert.equal(approval.toolName, 'Write');

      const launch = launches.at(-1)!;
      assert.equal(launch.rowState, 'spawning', 'managed_sessions has the row before query()');
      const o = launch.options;
      assert.equal(o.permissionMode, 'default');
      assert.equal(o.model, 'claude-haiku-5-5');
      assert.equal(o.effort, 'low');
      assert.equal(o.includePartialMessages, true);
      assert.ok((o.maxBudgetUsd ?? 1) <= 0.05);
      assert.deepEqual(o.settingSources, [], 'an unknown repo gets no settings');
      assert.equal(o.strictMcpConfig, true);
      const settings = o.settings as { disableClaudeAiConnectors?: boolean; crossSessionInbound?: string };
      assert.equal(settings.disableClaudeAiConnectors, true);
      assert.equal(settings.crossSessionInbound, 'refuse');
      assert.ok(o.disallowedTools?.includes('Bash(claude *)'));
      for (const name of Object.keys(o.env ?? {})) assert.ok(!/^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|NAOS_)/i.test(name) && !name.toUpperCase().startsWith('CLAUDE_CODE_MESSAGING'), `${name} was not scrubbed`);

      const v = await view(agentId);
      assert.equal(v.state, 'awaiting_approval');
      assert.equal(v.openApprovals, 1);
      assert.ok(v.pid, 'the process reported its pid');
      pid = v.pid;
      const proc = (await snapshot()).find((p) => p.pid === pid);
      assert.match(proc?.name ?? '', /claude/i);
      assert.deepEqual(managedStates(agentId).slice(0, 5), ['queued', 'spawning', 'ready', 'running', 'awaiting_approval']);
      log(`spawn: pid known, states ${managedStates(agentId).join('>')}`);
    });

    it('takes an approval answered through the command path, once', { timeout: LIMIT_MS }, async () => {
      const approval = open(agentId)[0]!;
      assert.deepEqual(await answer(approval.requestId, { kind: 'approve' }), { applied: true });
      assert.deepEqual(await answer(approval.requestId, { kind: 'deny' }), { applied: false }, 'a second answer does nothing');

      const { agent } = await settle(agentId);
      assert.equal(agent.state, 'idle');
      assert.equal(fs.readFileSync(path.join(repo, 'approved.txt'), 'utf8').trim(), 'hello');
      assert.ok(agent.spentUsd > 0, 'a result carried a cost');
      assert.ok(agent.toolCalls >= 1, 'the view counted the tool');
      assert.equal(agent.lastTerminalReason, 'completed');
      assert.ok((agent.contextTokens ?? 0) > 0, 'usage reached the view');
      assert.ok((agent.contextWindow ?? 0) > 0, 'the window reached the view');
      assert.ok((agent.ttftMs ?? 0) > 0, 'the first token time reached the view');
      const session = kernel.bus.state().sessions[agent.sessionId!]!;
      assert.equal(session.origin, 'control');
      assert.ok(session.usage.output > 0 && session.usage.messages >= 2, 'usage reached the session');
      log(`session: usage messages=${session.usage.messages} output=${session.usage.output}, cost $${session.cost.estimateUsd} against view $${agent.spentUsd}, ttft ${agent.ttftMs}`);
      const plan = kernel.bus.state().plan;
      assert.ok(plan, 'a real rate_limit_event reached the plan');
      assert.ok(plan.fiveHourLeft !== null && plan.fiveHourLeft >= 0 && plan.fiveHourLeft <= 1, 'utilization is 0 to 1 here');
      assert.ok((plan.resetsAt.fiveHour ?? 0) > Date.now(), 'resetsAt became milliseconds');
      log(`plan: status ${plan.status}`);

      const activity = events.flatMap((e) => (e.type === 'activity.changed' && e.nodeId === agent.nodeId ? [e.activity.state] : []));
      for (const state of ['generating', 'waiting', 'tool_running', 'idle']) assert.ok(activity.includes(state as never), `activity reached ${state}, saw ${activity.join('>')}`);
      log(`activity: ${activity.join('>')}`);

      const rows = control.store.auditRows(agentId).map((r) => `${r.event}:${r.toolName}`);
      for (const row of ['tool:Write', 'approval.requested:Write', 'approval.answered:Write']) assert.ok(rows.includes(row), `audit has ${row}`);
      const answered = Object.values(kernel.bus.state().approvals).find((a) => a.requestId === approval.requestId);
      assert.equal(answered?.status, 'answered');
      log(`approval: applied, second answer refused, cost so far $${agent.spentUsd}`);
    });

    it('takes a denied call, and the file stays unwritten', { timeout: LIMIT_MS }, async () => {
      await ui({ type: 'agent.send', agentId, text: 'Use the Bash tool to run exactly: touch denied.txt. If that call is not approved, do not try anything else, reply with the word refused.', priority: 'queue' });
      const approval = await nextApproval(agentId);
      assert.equal(approval.toolName, 'Bash');
      await answer(approval.requestId, { kind: 'deny' });
      const { agent, result } = await settle(agentId);
      assert.equal(agent.state, 'idle');
      assert.equal(fs.existsSync(path.join(repo, 'denied.txt')), false);
      assert.ok(agent.toolErrors >= 1, 'the denial shows as a tool error');
      assert.equal(agent.pid, pid, 'same process');
      assert.equal(agent.failure, null, 'a denial is not a failed turn');
      log(`deny: file absent, toolErrors=${agent.toolErrors}, reply length ${result?.length ?? 0}`);
    });

    it('takes a follow-up in the same process, with text only for the client that watches', { timeout: LIMIT_MS }, async () => {
      const opened = (): Promise<{ ws: WebSocket; id: string; raw: string[] }> => new Promise((resolve, reject) => {
        const raw: string[] = [];
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { authorization: `Bearer ${kernel.tokens.ui}`, host: `127.0.0.1:${port}` } });
        ws.on('error', reject);
        ws.on('message', (data) => {
          const text = data.toString();
          raw.push(text);
          const frame = JSON.parse(text) as { t: string; clientId?: string };
          if (frame.t === 'hello') resolve({ ws, id: frame.clientId!, raw });
        });
      });
      const watcher = await opened();
      const other = await opened();
      const before = await view(agentId);
      await ui({ type: 'craft.watchText', nodeId: before.nodeId, clientId: watcher.id, on: true });

      await ui({ type: 'agent.send', agentId, text: 'What is the codeword? Reply with only the codeword.', priority: 'queue' });
      const { agent, result } = await settle(agentId);
      assert.equal(agent.pid, pid, 'same process');
      assert.equal(agent.sessionId, before.sessionId);
      assert.ok(result?.includes(code), 'the follow-up recalled the codeword');

      await sleep(150);
      const textFrames = (raw: string[]): string[] => raw.filter((f) => (JSON.parse(f) as { t: string }).t === 'text');
      const seen = textFrames(watcher.raw).map((f) => (JSON.parse(f) as { delta: string }).delta).join('');
      assert.ok(seen.includes(code), 'the watcher saw the reply');
      assert.equal(textFrames(other.raw).length, 0, 'the other client got no text frame');
      for (const frame of [...watcher.raw, ...other.raw]) {
        if ((JSON.parse(frame) as { t: string }).t !== 'text') assert.ok(!frame.includes(code), 'text never rides the event stream');
      }
      assert.ok(!JSON.stringify(events).includes(code), 'no event holds message text');
      watcher.ws.close();
      other.ws.close();
      log(`follow-up: same pid, watcher frames ${textFrames(watcher.raw).length}, other client 0`);
    });

    it('stops with a Bash tree running and leaves no process', { timeout: LIMIT_MS }, async () => {
      const marker = path.join(repo, 'marker.txt').replaceAll('\\', '/');
      const fuseMs = 14_000;
      await ui({
        type: 'agent.send', agentId, priority: 'queue',
        text: `Use the Bash tool, in the foreground, to run exactly: node -e "setTimeout(()=>require('fs').writeFileSync('${marker}','x'),${fuseMs})"`,
      });
      const approval = await nextApproval(agentId);
      assert.equal(approval.toolName, 'Bash');
      await answer(approval.requestId, { kind: 'approve' });
      const armedAt = Date.now();

      const tree = await until('the node process', async () => {
        const below = descendants(pid, await snapshot());
        return below.some((p) => /^node(\.exe)?$/i.test(p.name)) ? below : null;
      }, 20_000, 300);
      const recorded = await until('a recorded tool tree', () => { const rows = control.store.toolTrees(agentId); return rows.length > 0 ? rows : null; }, 10_000);
      log(`stop: ${tree.length} processes under the agent, ${recorded.length} recorded`);

      const stopped = await ui<{ result: string }>({ type: 'agent.stop', agentId });
      const after = await snapshot();
      const alive = [{ pid, name: 'claude' }, ...tree].filter((p) => after.some((q) => q.pid === p.pid && q.name.toLowerCase() === p.name.toLowerCase()));
      assert.deepEqual(alive.map((p) => p.name), [], 'nothing of the agent is left');

      const v = await view(agentId);
      assert.equal(v.state, 'exited');
      assert.equal(v.pid, null);
      assert.deepEqual(control.store.toolTrees(agentId), [], 'tree rows are cleared');

      await sleep(Math.max(0, armedAt + fuseMs + 1500 - Date.now()));
      assert.equal(fs.existsSync(marker), false, 'the shell died before its fuse');
      log(`stop: ${stopped.result}, processes left 0, marker absent after the fuse`);
      spent = v.spentUsd;
    });

    it('resumes: same session, new process, memory intact, spend not counted twice', { timeout: LIMIT_MS }, async () => {
      const stale = await view(agentId);
      const before = stale.sessionId;
      await until('resumable', async () => (await view(agentId)).resumable, 10_000);
      await ui({ type: 'agent.resume', agentId, prompt: 'What is the codeword? Reply with only the codeword.' });
      const { agent, result } = await settle(agentId);
      assert.equal(agent.state, 'idle');
      assert.equal(agent.sessionId, before);
      assert.notEqual(agent.pid, pid);
      assert.ok(result?.includes(code), 'the resumed session recalled the codeword');
      assert.ok(agent.spentUsd > spent, 'new spend arrived');
      assert.ok(agent.spentUsd < spent + 0.02, `one short turn, not the whole history again: ${spent} then ${agent.spentUsd}`);
      assert.equal(launches.at(-1)!.options.resume, before);
      assert.equal(launches.at(-1)!.options.sessionId, undefined);
      await ui({ type: 'agent.stop', agentId });
      log(`resume: same session, new pid, spend ${spent} to ${agent.spentUsd}`);
    });
  });

  describe('worktree', { concurrency: false }, () => {
    let agentId: string;
    let wt: NonNullable<ManagedAgentView['worktree']>;

    it('adopts the kernel-made worktree, and the write lands there', { timeout: LIMIT_MS }, async () => {
      agentId = await spawn({ cwd: repo, profile: 'sandbox', worktree: true, prompt: 'Use the Write tool to create the file wt.txt in the current folder with the single line hello. Then reply with the word done.' });
      const approval = await nextApproval(agentId);
      assert.equal(approval.toolName, 'Write');
      const v = await view(agentId);
      assert.ok(v.worktree, 'the view names the worktree');
      wt = v.worktree;
      assert.equal(wt.branch, `agent/${agentId}`);
      const o = launches.at(-1)!.options;
      assert.deepEqual(o.extraArgs, { worktree: agentId });
      assert.equal(path.resolve(o.cwd!), path.resolve(repo));
      assert.equal(path.resolve(o.projectConfigRoot!), path.resolve(repo));
      assert.equal(path.resolve(v.cwd).toLowerCase(), path.resolve(wt.path).toLowerCase(), 'the process runs in the worktree');
      await answer(approval.requestId, { kind: 'approve' });
      const { agent } = await settle(agentId);
      assert.equal(agent.state, 'idle');
      assert.equal(fs.existsSync(path.join(wt.path, 'wt.txt')), true, 'the write is in the worktree');
      assert.equal(fs.existsSync(path.join(repo, 'wt.txt')), false, 'and not in the main checkout');
      assert.equal(git(repo, 'status', '--porcelain', '--', '.claude'), '', 'worktrees are excluded from the repo status');
      log('worktree: write in the worktree, main checkout clean');
    });

    it('cannot write to the main checkout even when a human approves everything', { timeout: LIMIT_MS }, async () => {
      const escape = path.join(repo, 'escape.txt');
      await ui({ type: 'agent.send', agentId, priority: 'queue', text: `Use the Write tool with file_path ${escape} and the single line hello. If that is blocked, reply with the word blocked and try nothing else.` });
      let approvals = 0;
      const errorsBefore = (await view(agentId)).toolErrors;
      const { agent } = await settle(agentId, async (a) => {
        approvals += 1;
        await answer(a.requestId, { kind: 'approve' });
      });
      assert.equal(fs.existsSync(escape), false, 'the binary blocked the write');
      assert.ok(agent.toolErrors > errorsBefore, 'the model tried, and the call failed');
      log(`worktree escape: file absent, approvals raised ${approvals}, tool errors ${errorsBefore} to ${agent.toolErrors}`);
    });

    it('resumes back into its worktree', { timeout: LIMIT_MS }, async () => {
      await ui({ type: 'agent.stop', agentId });
      await until('resumable', async () => (await view(agentId)).resumable, 10_000);
      await ui({ type: 'agent.resume', agentId, prompt: 'Use the Write tool to create the file resumed.txt in the current folder with the single line hello. Then reply with the word done.' });
      const { agent } = await settle(agentId, (a) => answer(a.requestId, { kind: 'approve' }));
      assert.equal(agent.state, 'idle');
      const o = launches.at(-1)!.options;
      assert.equal(path.resolve(o.cwd!), path.resolve(repo));
      assert.equal(o.resume, agent.sessionId);
      assert.equal(o.extraArgs, undefined, 'a resume re-enters the worktree on its own');
      assert.equal(fs.existsSync(path.join(wt.path, 'resumed.txt')), true, 'the write is in the worktree');
      assert.equal(fs.existsSync(path.join(repo, 'resumed.txt')), false);
      log(`worktree resume: init cwd in worktree ${inits.at(-1)!.cwd.toLowerCase() === wt.path.toLowerCase()}`);
    });

    it('forks into a worktree of its own, and the source spends nothing', { timeout: LIMIT_MS }, async () => {
      const source = await view(agentId);
      const forkId = (await ui<SpawnReceipt>({ type: 'agent.fork', agentId })).agentIds[0]!;
      const ready = await until('the fork', async () => { const f = await view(forkId); return f.state === 'ready' || f.state === 'crashed' ? f : null; }, 30_000, 100);
      assert.equal(ready.state, 'ready', ready.failure ?? '');
      assert.notEqual(ready.sessionId, source.sessionId);
      assert.ok(ready.worktree && ready.worktree.path !== wt.path, 'the fork has its own worktree');
      await ui({ type: 'agent.send', agentId: forkId, priority: 'queue', text: 'Use the Write tool to create the file forked.txt in the current folder with the single line hello. Then reply with the word done.' });
      const { agent } = await settle(forkId, (a) => answer(a.requestId, { kind: 'approve' }));
      assert.equal(agent.state, 'idle');
      assert.equal(fs.existsSync(path.join(ready.worktree.path, 'forked.txt')), true);
      assert.equal(fs.existsSync(path.join(wt.path, 'forked.txt')), false);
      assert.ok(agent.spentUsd > 0 && agent.spentUsd < 0.01, `the fork counts only its own spend: ${agent.spentUsd}`);
      assert.equal((await view(agentId)).spentUsd, source.spentUsd);
      await ui({ type: 'agent.close', agentId: forkId });
      log(`fork: new session, own worktree, spend $${agent.spentUsd}, raw total_cost_usd ${totals.at(-1)}, source $${source.spentUsd}`);
    });

    it('closes without destroying uncommitted work', { timeout: LIMIT_MS }, async () => {
      await ui({ type: 'agent.close', agentId });
      const v = await view(agentId);
      assert.equal(v.state, 'closed');
      assert.match(v.failure ?? '', /uncommitted/);
      assert.equal(fs.existsSync(path.join(wt.path, 'wt.txt')), true);
      assert.match(git(repo, 'worktree', 'list'), new RegExp(agentId));
      log('worktree close: kept, uncommitted changes');
    });
  });

  it('runs an orchestrator whose child is refused a grandchild by the depth limit', { timeout: 200_000 }, async () => {
    const before = Object.keys(kernel.bus.state().managed).length;
    const inner = 'Call the agent_spawn tool exactly once, with the prompt argument: say hi. Then reply with the exact error text the tool returned.';
    const rootId = await spawn({
      cwd: repo, profile: 'lead', budgetUsd: 0.03,
      mission: { treeBudgetUsd: 0.06, childLimit: 2, depth: 1 },
      prompt: `Call the agent_spawn tool exactly once, with this prompt argument: "${inner}". Then call agent_wait with the agent_id it returned and timeout_s 45, and call agent_wait again until done is true. Then reply with the word finished.`,
    });
    const { agent: rootView } = await settle(rootId, undefined, 170_000);
    assert.equal(rootView.state, 'idle');
    assert.equal(rootView.failure, null);

    const rows = await ui<ManagedAgentView[]>({ type: 'agent.list', scope: 'tree', of: rootId });
    assert.equal(rows.length, 2, 'root and child, no grandchild');
    assert.equal(Object.keys(kernel.bus.state().managed).length, before + 2);
    const child = rows.find((r) => r.agentId !== rootId)!;
    assert.equal(child.parentAgentId, rootId);
    assert.equal(child.depth, 1);
    assert.equal(child.model, 'claude-haiku-5-5');
    assert.ok(child.budgetUsd <= 0.03);

    const refused = events.filter((e): e is Extract<NaosEvent, { type: 'spawn.refused' }> => e.type === 'spawn.refused');
    assert.deepEqual(refused.map((e) => [e.parentAgentId, e.limit]), [[child.agentId, 'depth']]);
    const links = events.flatMap((e) => (e.type === 'link.fired' ? [e.kind] : []));
    assert.ok(links.includes('spawn') && links.includes('wait'), `links fired: ${links.join(',')}`);
    const childResult = await ui<{ result: string | null }>({ type: 'agent.wait', agentId: child.agentId, timeoutS: 0 });
    assert.match(childResult.result ?? '', /depth limit/i, 'the child read the refusal');
    assert.ok(launches.every((l) => l.options.permissionMode !== 'bypassPermissions'));
    await ui({ type: 'agent.stop', agentId: rootId });
    assert.equal((await view(child.agentId)).state, 'exited', 'stopping the root stops its child');
    log(`orchestrator: child ${child.state}, grandchild refused with limit depth, links ${links.join(',')}`);
  });

  it('keeps an MCP caller away from approvals, through the real shim', { timeout: LIMIT_MS }, async () => {
    const shim = fileURLToPath(new URL('../../src/control/mcp-shim.ts', import.meta.url));
    const client = new Client({ name: 'real-test', version: '0' });
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: ['--disable-warning=ExperimentalWarning', shim],
      env: { ...process.env, NAOS_HOME: home, NAOS_PORT: String(port) } as Record<string, string>,
      cwd: repo,
    }));
    try {
      const tools = (await client.listTools()).tools.map((t) => t.name).sort();
      assert.deepEqual(tools, ['agent_list', 'agent_send', 'agent_spawn', 'agent_status', 'agent_stop', 'agent_wait']);

      const uiAgent = Object.values(kernel.bus.state().managed)[0]!;
      const foreign = await client.callTool({ name: 'agent_status', arguments: { agent_id: uiAgent.agentId } }) as { isError?: boolean };
      assert.equal(foreign.isError, true, 'an MCP caller reaches only what it started');

      const spawned = await client.callTool({
        name: 'agent_spawn',
        arguments: { project: repo, profile: 'sandbox', budget_usd: 0.02, prompt: 'Use the Write tool to create the file mcp.txt in the current folder with the single line hello. Then reply with the word done.' },
      }) as { isError?: boolean; content: Array<{ text: string }> };
      assert.ok(!spawned.isError, spawned.content[0]?.text);
      const agentId = (JSON.parse(spawned.content[0]!.text) as { agent_id: string }).agent_id;
      const approval = await nextApproval(agentId);

      const mcp = kernel.tokens.mcp;
      const refused = await post({ type: 'approval.answer', requestId: approval.requestId, decision: { kind: 'approve' }, clientId: 'mcp' }, mcp);
      assert.equal(refused.status, 403);
      assert.equal(refused.reply.ok, false);
      if (!refused.reply.ok) assert.equal(refused.reply.error.code, 'forbidden');
      assert.equal(open(agentId).length, 1, 'the request is still open');
      assert.equal((await view(agentId)).state, 'awaiting_approval');
      assert.equal(fs.existsSync(path.join(repo, 'mcp.txt')), false);

      for (const body of [{ type: 'agent.stopAll' }, { type: 'world.trust', worldId: 'w', trusted: true }, { type: 'agent.close', agentId }] as Command[]) {
        assert.equal((await post(body, mcp)).status, 403, `${body.type} stays closed to MCP`);
      }
      const first = await post({ type: 'agent.spawn', spec: FIRST_FLIGHT_SPEC }, mcp);
      assert.equal(first.status, 403, 'First Flight belongs to the operator');

      const stopped = await client.callTool({ name: 'agent_stop', arguments: { agent_id: agentId } }) as { isError?: boolean };
      assert.ok(!stopped.isError);
      assert.equal((await view(agentId)).state, 'exited');
      const settled = kernel.bus.state().approvals[approval.requestId];
      assert.equal(settled?.status, 'withdrawn', 'the stop withdrew the card');
      assert.equal(fs.existsSync(path.join(repo, 'mcp.txt')), false);
      log('mcp: 403 on approval.answer, request stayed open, shim stop withdrew it');
    } finally {
      await client.close();
    }
  });

  it('First Flight: preflight spawns nothing, the flight raises one real approval', { timeout: LIMIT_MS }, async () => {
    const claudesBefore = (await ours()).length;
    const pre = await ui<PreflightResult>({ type: 'preflight', spec: FIRST_FLIGHT_SPEC });
    assert.equal(pre.blocked, null);
    assert.equal(pre.model, 'claude-haiku-5-5');
    assert.equal(pre.budgetUsd, 0.02);
    assert.deepEqual(pre.hooks, []);
    assert.equal((await ours()).length, claudesBefore, 'a preflight starts no process');

    const launched = launches.length;
    const agentId = await spawn(FIRST_FLIGHT_SPEC);
    const approval = await nextApproval(agentId);
    assert.equal(launches.length, launched + 1);
    const o = launches.at(-1)!.options;
    assert.deepEqual(o.settingSources, []);
    assert.equal(o.strictMcpConfig, true);
    assert.deepEqual(o.tools, ['Write']);
    assert.equal(o.maxBudgetUsd, 0.02);
    assert.equal(approval.toolName, 'Write');
    assert.equal(events.filter((e) => e.type === 'approval.requested' && e.approval.agentId === agentId).length, 1);
    await answer(approval.requestId, { kind: 'approve' });

    const { agent } = await settle(agentId);
    assert.equal(agent.state, 'idle');
    const file = path.join(home, 'first-flight', `flight-${agentId}.txt`);
    assert.equal(fs.readFileSync(file, 'utf8').trim(), 'first flight');
    assert.ok(agent.spentUsd <= 0.02, `$${agent.spentUsd}`);
    await ui({ type: 'agent.stop', agentId });
    log(`first flight: one approval, file written, $${agent.spentUsd}`);
  });

  it('honours every approval button on real calls: redirect, session, edit, stop', { timeout: 200_000 }, async () => {
    const agentId = await spawn({ cwd: repo, profile: 'sandbox', prompt: 'Use the Bash tool to run exactly: touch redirect.txt. Then reply with the word done.' });
    const first = await nextApproval(agentId);
    const pid = (await view(agentId)).pid;
    await answer(first.requestId, { kind: 'redirect', text: 'Do not run anything. Reply with the word redirected.' });
    let r = await settle(agentId);
    assert.equal(r.agent.state, 'idle', 'the redirect finished, nothing is stuck in flight');
    assert.match(r.result ?? '', /redirected/i);
    assert.equal(fs.existsSync(path.join(repo, 'redirect.txt')), false);
    assert.equal(r.agent.pid, pid);
    assert.equal(r.agent.queuedSends, 0);

    await ui({ type: 'agent.send', agentId, priority: 'queue', text: 'Use the Bash tool to run exactly: touch session.txt. Then reply with the word done.' });
    const grant = await nextApproval(agentId);
    await answer(grant.requestId, { kind: 'session' });
    await settle(agentId);
    assert.equal(fs.existsSync(path.join(repo, 'session.txt')), true);
    fs.rmSync(path.join(repo, 'session.txt'));
    await ui({ type: 'agent.send', agentId, priority: 'queue', text: 'Run exactly the same Bash command again: touch session.txt. Then reply with the word done.' });
    await settle(agentId); // Throws on any approval: the grant must carry this call.
    assert.equal(fs.existsSync(path.join(repo, 'session.txt')), true, 'the session rule let the same call through');
    assert.equal(fs.existsSync(path.join(repo, '.claude', 'settings.local.json')), false, 'a session grant writes nothing into the repo');

    await ui({ type: 'agent.send', agentId, priority: 'queue', text: 'Use the Write tool to create the file edited.txt in the current folder with the single line original. Then reply with the word done.' });
    const edit = await nextApproval(agentId);
    await answer(edit.requestId, { kind: 'approve', input: { ...edit.input, content: 'rewritten' }, edited: true });
    await settle(agentId);
    assert.equal(fs.readFileSync(path.join(repo, 'edited.txt'), 'utf8').trim(), 'rewritten');
    assert.ok(control.store.auditRows(agentId).some((row) => row.event === 'approval.edited'), 'an edit the model is not told about is audited');

    await ui({ type: 'agent.send', agentId, priority: 'queue', text: 'Use the Bash tool to run exactly: touch stopped.txt. Then reply with the word done.' });
    const halt = await nextApproval(agentId);
    await answer(halt.requestId, { kind: 'stop' });
    r = await settle(agentId);
    assert.equal(r.agent.state, 'idle');
    assert.equal(r.agent.lastTurnAborted, true);
    assert.match(r.agent.lastTerminalReason ?? '', /^aborted_/, 'both aborted_tools and aborted_streaming were seen on this path');
    assert.equal(fs.existsSync(path.join(repo, 'stopped.txt')), false);
    await ui({ type: 'agent.send', agentId, priority: 'queue', text: 'Reply with the word alive.' });
    r = await settle(agentId);
    assert.equal(r.agent.state, 'idle');
    assert.equal(r.agent.pid, pid, 'the process outlived the stopped turn');
    assert.equal(r.agent.lastTurnAborted, false);
    assert.equal(r.agent.failure, null);
    await ui({ type: 'agent.stop', agentId });
    log(`buttons: redirect, session, edit, stop all held, one process, $${r.agent.spentUsd}`);
  });

  it('keeps a craft at its cap, and addBudget brings it back', { timeout: LIMIT_MS }, async () => {
    const agentId = await spawn({ cwd: repo, profile: 'sandbox', budgetUsd: 0.00001, prompt: 'Reply with the word one.' });
    const spent = await until('the cap', async () => { const v = await view(agentId); return v.state === 'budget_exhausted' || v.state === 'crashed' ? v : null; }, 30_000, 100);
    assert.equal(spent.state, 'budget_exhausted', spent.failure ?? '');
    assert.equal(spent.lastTerminalReason, 'budget_exhausted');
    const refused = await post({ type: 'agent.send', agentId, text: 'hello', priority: 'queue' }, kernel.tokens.ui);
    assert.equal(refused.reply.ok, false, 'a send past the cap is refused');
    await ui({ type: 'agent.addBudget', agentId, addUsd: 0.01 });
    const back = await until('the restart', async () => { const v = await view(agentId); return v.state === 'ready' || v.state === 'idle' || v.state === 'crashed' ? v : null; }, 30_000, 100);
    assert.notEqual(back.state, 'crashed', back.failure ?? '');
    await ui({ type: 'agent.send', agentId, priority: 'queue', text: 'Reply with the word two.' });
    const { agent, result } = await settle(agentId);
    assert.equal(agent.state, 'idle');
    assert.match(result ?? '', /two/i);
    assert.equal(agent.failure, null);
    await ui({ type: 'agent.stop', agentId });
    log(`budget: capped at $${spent.spentUsd}, restarted, $${agent.spentUsd}`);
  });

  it('keeps the kernel home out of reach of the file tools', { timeout: LIMIT_MS }, async () => {
    assert.equal(fs.existsSync(path.join(home, 'layout.json')), true);
    const agentId = await spawn({ cwd: home, profile: 'sandbox', prompt: 'Use the Read tool on the file layout.json in the current folder. If that fails, reply with the word failed and try nothing else.' });
    const { agent, result } = await settle(agentId); // Throws on an approval: a deny rule must decide this, not a human.
    assert.ok(agent.toolErrors >= 1, 'the read failed');
    assert.match(result ?? '', /failed/i);
    await ui({ type: 'agent.stop', agentId });
    log(`deny rule: read refused, no approval, toolErrors=${agent.toolErrors}`);
  });

  it('carries an AskUserQuestion answer back to the model', { timeout: LIMIT_MS }, async () => {
    const agentId = await spawn({ cwd: repo, profile: 'sandbox', prompt: 'Use the AskUserQuestion tool once, to ask me to choose between red and blue. Then reply with only the option I chose.' });
    const asked = await nextApproval(agentId);
    assert.equal(asked.toolName, 'AskUserQuestion');
    assert.equal(asked.canRememberForSession, false, 'an answer is never remembered');
    const question = (asked.input as { questions: Array<{ question: string; options: Array<{ label: string }> }> }).questions[0]!;
    const label = question.options.at(-1)!.label;
    await answer(asked.requestId, { kind: 'answer', answers: { [question.question]: label } });
    const { agent, result } = await settle(agentId);
    assert.equal(agent.state, 'idle');
    assert.ok(result?.toLowerCase().includes(label.toLowerCase()), 'the model got the answer');
    await ui({ type: 'agent.stop', agentId });
    log(`question: answered, $${agent.spentUsd}`);
  });

  it('runs a read-only launch with no way to write and nobody to ask', { timeout: LIMIT_MS }, async () => {
    const agentId = await spawn({ cwd: repo, profile: 'sandbox', mode: 'read-only', prompt: 'Read the file README.md. Then try to create the file nope.txt with any tool you have. Then reply with the word finished.' });
    const { agent } = await settle(agentId); // Throws on an approval: this mode has nobody to ask.
    assert.equal(agent.state, 'idle');
    const o = launches.at(-1)!.options;
    assert.equal(o.permissionMode, 'dontAsk');
    assert.deepEqual(o.tools, ['Read', 'Glob', 'Grep']);
    assert.equal(fs.existsSync(path.join(repo, 'nope.txt')), false);
    assert.ok(control.store.auditRows(agentId).some((r) => r.event === 'tool' && r.toolName === 'Read'), 'it did read');
    await ui({ type: 'agent.stop', agentId });
    log(`read-only: read ok, nothing written, tools=${agent.toolCalls}, $${agent.spentUsd}`);
  });

  it('starts the shim from the repo\'s own .mcp.json, with no prompt and no spend', { timeout: 60_000 }, async () => {
    const check = path.join(root, 'mcpcheck');
    const nested = path.join(check, 'packages', 'kernel', 'src', 'control');
    const realShim = new URL('../../src/control/mcp-shim.ts', import.meta.url);
    fs.mkdirSync(nested, { recursive: true });
    fs.copyFileSync(fileURLToPath(new URL('../../../../.mcp.json', import.meta.url)), path.join(check, '.mcp.json'));
    fs.writeFileSync(path.join(nested, 'mcp-shim.ts'), `import { main } from '${realShim.href}';\nawait main();\n`);

    let finish = (): void => {};
    const done = new Promise<void>((r) => { finish = r; });
    async function* idle(): AsyncGenerator<never> {
      await done;
    }
    const q = sdkQuery({
      prompt: idle(),
      options: {
        cwd: check, permissionMode: 'default', model: 'claude-haiku-5-5', settingSources: ['project'], env: agentEnv({ NAOS_HOME: home, NAOS_PORT: String(port) }),
        settings: { disableClaudeAiConnectors: true, crossSessionInbound: 'refuse' }, tools: [], stderr: () => undefined,
      },
    });
    const pump = (async () => { for await (const _ of q) { /* no prompt, so nothing arrives */ } })().catch(() => undefined);
    try {
      await q.initializationResult();
      const naos = await until('the shim', async () => {
        const server = (await q.mcpServerStatus()).find((s) => s.name === 'naos');
        return server && server.status !== 'pending' ? server : null;
      }, 20_000, 200);
      assert.equal(naos.status, 'connected', naos.error ?? '');
      assert.equal(naos.tools?.length, 6);
      log(`.mcp.json: naos ${naos.status}, ${naos.tools?.length} tools`);
    } finally {
      finish();
      await pump;
    }
  });

  it('shows a managed agent once, with the real Observer running beside Control', { timeout: LIMIT_MS }, async () => {
    const home3 = path.join(root, 'home3');
    fs.mkdirSync(path.join(home3, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(home3, 'agents', 'sandbox.md'), PROFILES['sandbox.md']);
    // No injected planes: this is what `npm run up` composes, on a sandbox home.
    const both = await startKernel({ config: { mode: 'live', port: 0, home: home3, claudeHome: path.join(os.homedir(), '.claude'), uiDist: '', repoRoot: home3, devOrigins: [] }, logToStderr: false });
    try {
      await both.planesReady;
      const call = async <T>(body: Command): Promise<T> => {
        const response = await fetch(`http://127.0.0.1:${both.config.port}/api/cmd`, { method: 'POST', headers: { authorization: `Bearer ${both.tokens.ui}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
        const reply = await response.json() as CommandResult;
        if (!reply.ok) throw new Error(`${body.type}: ${reply.error.message}`);
        return reply.result as T;
      };
      const receipt = await call<SpawnReceipt>({ type: 'agent.spawn', spec: { cwd: repo, profile: 'sandbox', prompt: 'Reply with the word ok.' } });
      const agentId = receipt.agentIds[0]!;
      const done = await until('the turn', async () => {
        const r = await call<{ agent: ManagedAgentView; done: boolean }>({ type: 'agent.wait', agentId, timeoutS: 1 });
        return r.done ? r.agent : null;
      }, 45_000);
      assert.equal(done.state, 'idle', done.failure ?? '');
      await sleep(4000); // Past the 1.3 s the disk needs, so the Observer has seen the transcript and the pid file.
      const { sessions, nodes } = both.bus.state();
      const session = sessions[done.sessionId!];
      assert.ok(Object.values(sessions).some((s) => s.origin === 'observer'), 'the Observer is really reading the disk, or this proves nothing');
      assert.equal(session?.origin, 'control', 'the Observer did not take the craft over');
      assert.equal(Object.values(sessions).filter((s) => s.pid === done.pid).length, 1, 'one craft for one process');
      assert.ok(nodes[done.nodeId!], 'the main node stayed');
      await call({ type: 'agent.stop', agentId });
      fs.appendFileSync(ledgerFile(), `${JSON.stringify({ run: `${path.basename(root)}/home3`, usd: done.spentUsd, agents: 1 })}\n`);
      log(`dedupe: one craft among ${Object.keys(sessions).length} sessions, origin control, $${done.spentUsd}`);
    } finally {
      await both.stop();
    }
  });

  it('loads a new profile without a restart', { timeout: 20_000 }, async () => {
    const before = await ui<PreflightResult>({ type: 'preflight', spec: { cwd: repo, profile: 'late', prompt: '' } });
    assert.notEqual(before.blocked, null);
    fs.writeFileSync(path.join(home, 'agents', 'late.md'), PROFILES['sandbox.md'].replace('name: sandbox', 'name: late'));
    await until('the reload', () => events.some((e) => e.type === 'profiles.changed' && e.profiles.some((p) => p.name === 'late')), 5000);
    const after = await ui<PreflightResult>({ type: 'preflight', spec: { cwd: repo, profile: 'late', prompt: '' } });
    assert.equal(after.blocked, null);
    fs.rmSync(path.join(home, 'agents', 'late.md'));
    log('profiles: a new file loaded with no restart');
  });

  it('runs in a trusted world with the user settings loaded', { timeout: LIMIT_MS }, async () => {
    const seen = await spawnIdle();
    await ui({ type: 'world.trust', worldId: seen.worldId, trusted: true });
    const pre = await ui<PreflightResult>({ type: 'preflight', spec: { worldId: seen.worldId, profile: 'sandbox', prompt: '' } });
    assert.equal(pre.world.trusted, true);

    const agentId = await spawn({ worldId: seen.worldId, profile: 'sandbox', prompt: 'Reply with the word ok.' });
    const { agent } = await settle(agentId);
    assert.equal(agent.state, 'idle', agent.failure ?? '');
    const o = launches.at(-1)!.options;
    assert.deepEqual(o.settingSources, ['user', 'project', 'local']);
    assert.equal(o.strictMcpConfig, undefined);
    assert.equal(o.pluginDelivery, 'initialize');
    const init = inits.at(-1)!;
    assert.ok(!init.mcp.some((name) => name.startsWith('claude.ai')), 'connectors stay off');
    assert.ok(agent.spentUsd < 0.02, `$${agent.spentUsd}`);
    await ui({ type: 'agent.stop', agentId });
    const measured = await ui<PreflightResult>({ type: 'preflight', spec: { worldId: seen.worldId, profile: 'sandbox', prompt: '' } });
    assert.ok(measured.loadout && measured.loadout.contextTokens > 0, 'the spawn left a loadout measurement');
    await ui({ type: 'world.trust', worldId: seen.worldId, trusted: false });
    log(`trusted: ${init.tools} tools, ${init.mcp.length} mcp servers, no connector, $${agent.spentUsd}, loadout ${measured.loadout.contextTokens} tokens`);
  });

  it('reconciles after the kernel is killed hard: lost, orphans swept, then resume', { timeout: 200_000 }, async () => {
    const home2 = path.join(root, 'home2');
    fs.mkdirSync(path.join(home2, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(home2, 'agents', 'sandbox.md'), PROFILES['sandbox.md']);
    const script = fileURLToPath(new URL('./real-kernel.ts', import.meta.url));
    const child = spawnProcess(process.execPath, ['--disable-warning=ExperimentalWarning', script, home2], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, env: { ...process.env, NAOS_NO_TOAST: '1' } });
    let second: RunningKernel | null = null;
    try {
      let out = '';
      child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
      const childPort = await until('the child kernel', () => /port=(\d+)/.exec(out)?.[1], 30_000);
      const token = fs.readFileSync(path.join(home2, 'ui.token'), 'utf8').trim();
      const call = async <T>(p: string, body: Command): Promise<T> => {
        const response = await fetch(`http://127.0.0.1:${p}/api/cmd`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
        const reply = await response.json() as CommandResult;
        if (!reply.ok) throw new Error(`${body.type}: ${reply.error.message}`);
        return reply.result as T;
      };
      const row = <T>(sql: string): T | undefined => {
        const db = new DatabaseSync(path.join(home2, 'naos.db'), { readOnly: true });
        try {
          return db.prepare(sql).get() as T | undefined;
        } finally {
          db.close();
        }
      };

      const marker = path.join(repo, 'orphan.txt').replaceAll('\\', '/');
      const fuseMs = 22_000;
      const receipt = await call<SpawnReceipt>(childPort, { type: 'agent.spawn', spec: { cwd: repo, profile: 'sandbox', prompt: `The codeword is heron. Use the Bash tool, in the foreground, to run exactly: node -e "setTimeout(()=>require('fs').writeFileSync('${marker}','x'),${fuseMs})"` } });
      const agentId = receipt.agentIds[0]!;
      const pending = await until('the approval', async () => {
        const list = await call<ManagedAgentView[]>(childPort, { type: 'agent.list', scope: 'all' });
        return list[0]?.openApprovals ? list[0] : null;
      }, 60_000, 100);
      const open = row<{ requestId: string }>("SELECT requestId FROM control_approvals WHERE status = 'open'")!;
      await call(childPort, { type: 'approval.answer', requestId: open.requestId, decision: { kind: 'approve' }, clientId: 'real-test' });
      const armedAt = Date.now();
      const cli = pending.pid!;
      const tree = await until('the node process', async () => {
        const below = descendants(cli, await snapshot());
        return below.some((p) => /^node(\.exe)?$/i.test(p.name)) ? below : null;
      }, 20_000, 300);

      execFileSync('taskkill', ['/PID', String(child.pid), '/F'], { windowsHide: true, stdio: 'ignore' });
      await sleep(1000);
      const afterKill = await snapshot();
      assert.equal(afterKill.some((p) => p.pid === cli), false, 'claude.exe died with the kernel');
      const orphans = tree.filter((p) => /^node/i.test(p.name) && afterKill.some((q) => q.pid === p.pid && /^node/i.test(q.name)));
      assert.ok(orphans.length > 0, 'the tool tree outlived the kernel, which is the failure the sweep is for');

      // A scan runs every 3 s, so a kernel can die before any row exists. That real run failed, so this one holds that case open.
      const db = new DatabaseSync(path.join(home2, 'naos.db'));
      db.exec('DELETE FROM control_tool_trees');
      db.close();

      const control2 = createControl({ profilesDir: path.join(home2, 'agents') });
      second = await startKernel({ config: { mode: 'live', port: 0, home: home2, claudeHome: path.join(os.homedir(), '.claude'), uiDist: '', repoRoot: home2, devOrigins: [] }, planes: [control2], logToStderr: false });
      await second.planesReady;
      const p2 = String(second.config.port);
      const lost = await call<ManagedAgentView>(p2, { type: 'agent.status', agentId });
      assert.equal(lost.state, 'lost');
      assert.equal(lost.pid, null);
      assert.equal(lost.openApprovals, 0);
      assert.equal(lost.resumable, true, 'resume is offered once the sweep is done');
      const swept = await snapshot();
      assert.equal(orphans.filter((p) => swept.some((q) => q.pid === p.pid && /^node/i.test(q.name))).length, 0, 'the boot killed the orphan');

      await call(p2, { type: 'agent.resume', agentId, prompt: 'What is the codeword? Reply with only the codeword.' });
      const resumed = await until('the resumed turn', async () => {
        const r = await call<{ agent: ManagedAgentView; result: string | null; done: boolean }>(p2, { type: 'agent.wait', agentId, timeoutS: 1 });
        return r.done ? r : null;
      }, 60_000);
      assert.equal(resumed.agent.state, 'idle', resumed.agent.failure ?? '');
      assert.match(resumed.result ?? '', /heron/i);

      // A planned shutdown with a live craft stops it and leaves a clean row, so the next boot finds nothing to reconcile.
      const live = resumed.agent.pid!;
      const leaving = second;
      second = null;
      await leaving.stop();
      assert.equal((await snapshot()).some((p) => p.pid === live), false, 'shutdown left no process');
      assert.equal(row<{ state: string }>('SELECT state FROM managed_sessions')?.state, 'exited');

      await sleep(Math.max(0, armedAt + fuseMs + 1500 - Date.now()));
      assert.equal(fs.existsSync(marker), false, 'the orphan died before its fuse');
      fs.appendFileSync(ledgerFile(), `${JSON.stringify({ run: `${path.basename(root)}/home2`, usd: resumed.agent.spentUsd, agents: 1 })}\n`);
      log(`reboot: lost, ${orphans.length} orphan killed with no row, resume recalled the codeword, shutdown clean, $${resumed.agent.spentUsd}`);
    } finally {
      if (child.exitCode === null) child.kill();
      await second?.stop();
    }
  });
});
