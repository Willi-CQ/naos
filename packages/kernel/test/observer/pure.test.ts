import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { ledgerReport, rollup } from '../../src/observer/ledger.ts';
import { classifyProjectPath, configJsonPath, dayKey, isPidFileName, normalizePath } from '../../src/observer/paths.ts';
import { classify, pidRecord } from '../../src/observer/pidfile.ts';
import { fractionLeft, normalisePlan, readPlan } from '../../src/observer/plan.ts';
import { UsageBook, baseModel, makeCost, requestCostUsd, tokenUsage } from '../../src/observer/prices.ts';
import { clearProjectCache, projectOf, resolveProject } from '../../src/observer/project.ts';
import { RateTracker } from '../../src/observer/rates.ts';
import { SALVO_RULE, SalvoDetector, replaySalvos } from '../../src/observer/salvo.ts';
import type { Launch } from '../../src/observer/salvo.ts';
import { contextWindow } from '../../src/observer/tree.ts';
import { WorkflowRun, parseFinalState } from '../../src/observer/workflows.ts';

const close = (a: number | null, b: number, eps = 1e-9): void => {
  assert.ok(a !== null && Math.abs(a - b) < eps, `${a} !== ${b}`);
};

describe('cost arithmetic, RF 3.4', () => {
  it('prices each token class at the model rate', () => {
    close(requestCostUsd('claude-opus-5-5', { input_tokens: 1e6 }), 4);
    close(requestCostUsd('claude-opus-5-5', { input_tokens: 0, output_tokens: 1e6 }), 20);
    close(requestCostUsd('claude-opus-5-5', { cache_read_input_tokens: 1e6 }), 0.2);
    close(requestCostUsd('claude-opus-5-5', { cache_creation_input_tokens: 1e6 }), 5, 1e-9);
    close(requestCostUsd('claude-sonnet-5-5', { cache_read_input_tokens: 1e6 }), 0.1);
    close(requestCostUsd('claude-fable-5-1', { cache_read_input_tokens: 1e6 }), 0.25);
  });

  it('splits cache writes between the 5 minute and 1 hour rates', () => {
    close(requestCostUsd('claude-opus-5-5', {
      cache_creation_input_tokens: 1e6,
      cache_creation: { ephemeral_1h_input_tokens: 250_000, ephemeral_5m_input_tokens: 750_000 },
    }), 0.75 * 5 + 0.25 * 8);
    close(requestCostUsd('claude-opus-5-5', {
      cache_creation_input_tokens: 100,
      cache_creation: { ephemeral_1h_input_tokens: 9e9 },
    }), (100 * 8) / 1e6, 1e-12);
  });

  it('switches haiku-5-5 to the long prompt tier per request, above 100,000 only', () => {
    close(requestCostUsd('claude-haiku-5-5', { input_tokens: 100_000, output_tokens: 1000 }), (100_000 * 0.1 + 1000 * 0.5) / 1e6);
    close(requestCostUsd('claude-haiku-5-5', { input_tokens: 50_000, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 1, output_tokens: 1000 }),
      (50_000 * 0.5 + 50_000 * 0.05 + 1 * 0.625 + 1000 * 2.5) / 1e6);
  });

  it('adds the us geo multiplier to tokens only, then web search at a flat rate', () => {
    close(requestCostUsd('claude-opus-5-5', {
      input_tokens: 1e6, inference_geo: 'us', server_tool_use: { web_search_requests: 3 },
    }), 4 * 1.1 + 0.03);
  });

  it('resolves suffixes and rejects unknown models in the plain formula', () => {
    assert.equal(baseModel('claude-opus-5-5[1m]'), 'claude-opus-5-5');
    assert.equal(baseModel('claude-haiku-4-5-20251001'), 'claude-haiku-4-5');
    assert.equal(requestCostUsd('some-future-model', { input_tokens: 1 }), null);
  });

  it('books per message: a repeat replaces, totals are not re-priced', () => {
    const book = new UsageBook();
    book.record('m1', 'claude-haiku-5-5', { input_tokens: 60_000, output_tokens: 10 }, true, 'd');
    book.record('m1', 'claude-haiku-5-5', { input_tokens: 60_000, output_tokens: 100 }, false, 'd');
    book.record('m2', 'claude-haiku-5-5', { input_tokens: 60_000, output_tokens: 100 }, false, 'd');
    assert.equal(book.total.messages, 2);
    assert.equal(book.total.output, 200);
    assert.equal(book.total.partialOutputMessages, 0);
    // Two requests of 60k stay on the base tier. Priced on the total of 120k they would not.
    close(book.estimateUsd, 2 * (60_000 * 0.1 + 100 * 0.5) / 1e6, 1e-12);
    close(book.byDay.get('d') ?? 0, book.estimateUsd, 1e-12);
    assert.equal(book.byModel.get('claude-haiku-5-5')?.usage.messages, 2);
  });

  it('prices an unknown model at the fallback and names it', () => {
    const book = new UsageBook();
    book.record('m', 'mystery-model', { input_tokens: 1e6 }, false, 'd');
    close(book.estimateUsd, 5);
    assert.deepEqual([...book.unpriced], ['mystery-model']);
  });

  it('skips <synthetic>', () => {
    const book = new UsageBook();
    book.record('m', '<synthetic>', { input_tokens: 99 }, false, 'd');
    assert.equal(book.total.messages, 0);
  });

  it('applies the display rule: max of estimate and cost-state, zero is absent', () => {
    assert.deepEqual(makeCost(5, 7, [], false), { usd: 7, estimateUsd: 5, costStateUsd: 7, isEstimate: false, isLowerBound: false, unpricedModels: [] });
    assert.equal(makeCost(5, 3, [], false).usd, 5);
    assert.deepEqual(makeCost(5, 0, ['a', 'a'], true), { usd: 5, estimateUsd: 5, costStateUsd: null, isEstimate: true, isLowerBound: true, unpricedModels: ['a'] });
  });

  it('splits write tokens into 5m and 1h in TokenUsage', () => {
    const u = tokenUsage({ cache_creation_input_tokens: 100, cache_creation: { ephemeral_1h_input_tokens: 30 } }, false);
    assert.equal(u.cacheWrite5m, 70);
    assert.equal(u.cacheWrite1h, 30);
  });
});

describe('salvo rule', () => {
  const launch = (i: number, at: number, group = 'wf_1'): Launch => ({
    parentNodeId: 'p', group, nodeId: `n${i}`, sessionId: 's', worldId: 'w', source: 'workflow', observedAt: at,
  });

  it('opens at the third launch within 1 s, not before', () => {
    const d = new SalvoDetector();
    assert.equal(d.launch(launch(1, 0)), null);
    assert.equal(d.launch(launch(2, 400)), null);
    const out = d.launch(launch(3, 1000));
    assert.equal(out?.type, 'opened');
    assert.deepEqual(out?.type === 'opened' ? out.salvo.nodeIds : [], ['n1', 'n2', 'n3']);
  });

  it('does not open when the three span more than 1 s', () => {
    const d = new SalvoDetector();
    d.launch(launch(1, 0));
    d.launch(launch(2, 600));
    assert.equal(d.launch(launch(3, 1100)), null);
    assert.equal(d.launch(launch(4, 1500))?.type, 'opened');
  });

  it('keeps launches under different parents and runs apart', () => {
    const d = new SalvoDetector();
    d.launch(launch(1, 0));
    d.launch(launch(2, 1, 'wf_2'));
    assert.equal(d.launch({ ...launch(3, 2), parentNodeId: 'q' }), null);
  });

  it('later launches join, each within 10 s of the last, then it closes', () => {
    const d = new SalvoDetector();
    d.launch(launch(1, 0));
    d.launch(launch(2, 1));
    d.launch(launch(3, 2));
    assert.equal(d.launch(launch(4, 9_000))?.type, 'joined');
    assert.equal(d.launch(launch(5, 18_000))?.type, 'joined');
    assert.deepEqual(d.closeExpired(27_000), []);
    const [closed] = d.closeExpired(18_000 + SALVO_RULE.joinWindowMs + 1);
    assert.equal(closed?.nodeIds.length, 5);
    assert.ok(closed?.closedAt);
  });

  it('a repeat of the same node does not count twice', () => {
    const d = new SalvoDetector();
    d.launch(launch(1, 0));
    d.launch(launch(1, 1));
    assert.equal(d.launch(launch(2, 2)), null);
  });

  it('after closing, a new fan-out opens a new salvo', () => {
    const d = new SalvoDetector();
    for (let i = 0; i < 3; i += 1) d.launch(launch(i, i));
    d.closeExpired(20_000);
    for (let i = 3; i < 5; i += 1) d.launch(launch(i, 30_000 + i));
    assert.equal(d.launch(launch(5, 30_010))?.type, 'opened');
  });

  it('replays birth times into closed salvos', () => {
    const list = [launch(1, 0), launch(2, 3), launch(3, 6), launch(4, 2000), launch(5, 100_000), launch(6, 100_001), launch(7, 100_002), launch(8, 500_000)];
    const out = replaySalvos(list);
    assert.equal(out.length, 2);
    assert.deepEqual(out[0]?.nodeIds, ['n1', 'n2', 'n3', 'n4']);
    assert.equal(out[0]?.closedAt, 2000 + SALVO_RULE.joinWindowMs);
    assert.equal(out[1]?.nodeIds.length, 3);
  });
});

describe('workflow lifecycle', () => {
  const make = (): WorkflowRun => new WorkflowRun({ runId: 'wf_1', sessionId: 's', parentNodeId: 's', journalPath: 'j', transcriptDir: 'd' });

  it('runs from journal plus liveness, retries by repeated key, ends by state file', () => {
    const run = make();
    assert.equal(run.journal({ type: 'launched' }), null);
    assert.equal(run.journal({ type: 'started', key: 'k1', agentId: 'a1', label: 'one', phase: 'Build' })?.started?.attempt, 1);
    run.journal({ type: 'started', key: 'k2', agentId: 'a2', label: 'two', phase: 'Check' });
    run.journal({ type: 'failed', key: 'k1', agentId: 'a1' });
    assert.equal(run.journal({ type: 'started', key: 'k1', agentId: 'a3', label: 'one', phase: 'Build' })?.started?.attempt, 2);
    run.journal({ type: 'result', key: 'k1', agentId: 'a3', result: 'private' });

    const live = run.view(true);
    assert.equal(live.status, 'running');
    assert.equal(live.statusSource, 'journal+liveness');
    assert.deepEqual(live.counts, { started: 3, completed: 1, failed: 1, open: 1, retried: 1, cached: null });
    assert.deepEqual(live.phases.map((p) => [p.title, p.running, p.completed, p.failed]), [['Build', 0, 1, 1], ['Check', 1, 0, 0]]);
    assert.equal(run.view(false).status, 'orphaned');
    assert.ok(!JSON.stringify(live).includes('private'));

    const final = parseFinalState({
      status: 'completed', startTime: '2026-10-30T10:00:00.000Z', timestamp: '2026-10-30T10:05:00.000Z', durationMs: 300000,
      totalTokens: 42, totalToolCalls: 7, taskId: 'tk', workflowName: 'name', script: 'private', result: 'private',
      workflowProgress: [
        { type: 'workflow_phase', index: 0, title: 'Build' },
        { type: 'workflow_agent', agentId: 'a2', state: 'done', attempt: 1, promptPreview: 'private' },
        { type: 'workflow_agent', cached: true },
      ],
    });
    const ended = run.applyFinal(final, 'state.json');
    assert.deepEqual(ended.map((a) => [a.agentId, a.state]), [['a2', 'completed']]);
    const done = run.view(false);
    assert.equal(done.status, 'completed', 'a state file outranks a dead owner');
    assert.equal(done.statusSource, 'state-file');
    assert.equal(done.counts.cached, 1);
    assert.equal(done.totalTokens, 42);
    assert.equal(done.taskId, 'tk');
    assert.ok(!JSON.stringify(done).includes('private'));
  });

  it('a failed line with an empty agentId resolves through its key', () => {
    const run = make();
    run.journal({ type: 'started', key: 'k1', agentId: 'a1' });
    assert.equal(run.journal({ type: 'failed', key: 'k1', agentId: '' })?.ended?.state, 'failed');
  });

  it('a killed run stops its open agents, and unknown journal types pass', () => {
    const run = make();
    run.journal({ type: 'restoring' });
    run.journal({ type: 'started', key: 'k1', agentId: 'a1' });
    const ended = run.applyFinal(parseFinalState({ status: 'killed' }), 's');
    assert.equal(ended[0]?.state, 'stopped');
    assert.equal(run.view(true).status, 'killed');
  });
});

describe('paths', () => {
  it('classifies everything the plane reads, and nothing else', () => {
    const sid = '00000000-0000-4000-8000-000000000001';
    assert.deepEqual(classifyProjectPath(`slug/${sid}.jsonl`), { kind: 'main', slug: 'slug', sid });
    assert.equal(classifyProjectPath(`slug/${sid}/subagents/agent-abc.jsonl`)?.kind, 'agent');
    assert.equal(classifyProjectPath(`slug\\${sid}\\subagents\\agent-abc.meta.json`)?.kind, 'meta');
    assert.equal(classifyProjectPath(`slug/${sid}/subagents/workflows/wf_1-2/agent-abc.jsonl`)?.kind, 'agent');
    assert.equal(classifyProjectPath(`slug/${sid}/subagents/workflows/wf_1-2/journal.jsonl`)?.kind, 'journal');
    assert.equal(classifyProjectPath(`slug/${sid}/workflows/wf_1-2.json`)?.kind, 'state');
    for (const other of [
      `slug/${sid}.orphaned-123.jsonl`, `slug/${sid}.jsonl.superseded-1`, 'slug/memory/x.md', `slug/${sid}/tool-results/a.txt`,
      `slug/${sid}/workflows/scripts/x-wf_1.js`, 'slug/bridge-pointer.json', `slug/${sid}/custom-title.json`, 'slug',
    ]) {
      assert.equal(classifyProjectPath(other), null, other);
    }
  });

  it('accepts pid files only, so a key file can never reach an open', () => {
    assert.equal(isPidFileName('10316.json'), true);
    for (const name of ['10316.abc.key', '10316.json.tmp', '010316.json', '.fleetview-heartbeat', 'pipe.key', '12.key.tmp1', 'x.json']) {
      assert.equal(isPidFileName(name), false, name);
    }
  });

  it('normalises drive letters and separators', () => {
    assert.equal(normalizePath('C:\\dev\\Repo\\'), 'c:/dev/Repo');
    assert.equal(normalizePath('c:/'), 'c:/');
  });

  it('finds .claude.json beside the default home, inside a custom one', () => {
    assert.equal(configJsonPath(path.join('C:', 'Users', 'me', '.claude')), path.join('C:', 'Users', 'me', '.claude.json'));
    assert.equal(configJsonPath(path.join('D:', 'cfg')), path.join('D:', 'cfg', '.claude.json'));
  });

  it('dayKey is the local calendar day', () => {
    const d = new Date(2026, 0, 5, 23, 59);
    assert.equal(dayKey(d.getTime()), '2026-01-05');
  });
});

describe('liveness', () => {
  const record = (over: Record<string, unknown>) => {
    const r = pidRecord({ pid: process.pid, sessionId: 's', ...over }, 0);
    assert.ok(r);
    return r;
  };
  const pipe = '\\\\.\\pipe\\LOCAL\\cc-msg-abc';

  it('classifies by kill(0) and the pipe list, never by updatedAt', () => {
    assert.equal(classify(record({ updatedAt: 1, messagingSocketPath: pipe }), new Set(['LOCAL\\cc-msg-abc']), 'd'), 'alive');
    assert.equal(classify(record({ messagingSocketPath: pipe }), new Set(['other']), 'd'), 'recycled');
    assert.equal(classify(record({}), new Set(), 'd'), 'unknown');
    assert.equal(classify(record({ pidDomain: 'win32:elsewhere' }), new Set(), 'win32:here'), 'foreign');
    assert.equal(classify({ ...record({}), pid: 0x7ffffffe }, new Set(), 'd'), 'dead');
  });

  it('rejects a record without a pid or session, and keeps unknown kinds open', () => {
    assert.equal(pidRecord({ pid: 'x' }, 0), null);
    assert.equal(pidRecord({ pid: 1 }, 0), null);
    assert.equal(pidRecord({ pid: 1, sessionId: 's', kind: 'new-kind' }, 0)?.kind, 'unknown');
  });
});

describe('plan', () => {
  it('normalises the 0 to 100 scale, and takes only what it names', () => {
    const plan = normalisePlan({
      fetchedAtMs: 1000,
      accountUuid: 'private-account',
      utilization: {
        five_hour: { utilization: 9, resets_at: '2026-10-31T02:39:59.816809+00:00' },
        seven_day: { utilization: 4, resets_at: '2026-11-05T14:59:59.816828+00:00' },
        limits: [{ kind: 'session', severity: 'normal' }],
        extra_usage: { used_credits: 123 },
      },
    });
    assert.deepEqual(plan, {
      fiveHourLeft: 0.91,
      sevenDayLeft: 0.96,
      asOf: 1000,
      resetsAt: { fiveHour: Date.parse('2026-10-31T02:39:59.816Z'), sevenDay: Date.parse('2026-11-05T14:59:59.816Z') },
      status: 'allowed',
    });
    assert.ok(!JSON.stringify(plan).includes('private'));
  });

  it('reads both scales through fractionLeft', () => {
    close(fractionLeft(80), 0.2);
    close(fractionLeft(0.8, 1), 0.2);
    close(fractionLeft(80, 1), 0.2);
    assert.equal(fractionLeft(null), null);
    assert.equal(fractionLeft(120), 0);
  });

  it('reports warnings and a spent window', () => {
    const utilization = (limits: object[]) => ({ utilization: { five_hour: { utilization: 50 }, limits } });
    assert.equal(normalisePlan(utilization([{ severity: 'warning' }]))?.status, 'allowed_warning');
    assert.equal(normalisePlan(utilization([]))?.status, 'unknown');
    assert.equal(normalisePlan({ utilization: { five_hour: { utilization: 100 } } })?.status, 'rejected');
  });

  it('is null with no window, and a missing or broken file is no error', async () => {
    assert.equal(normalisePlan(undefined), null);
    assert.equal(normalisePlan({ utilization: {} }), null);
    const dir = mkdtempSync(path.join(os.tmpdir(), 'naos-plan-'));
    const file = path.join(dir, '.claude.json');
    assert.equal(await readPlan(file), null);
    writeFileSync(file, '{broken');
    assert.equal(await readPlan(file), null);
    rmSync(dir, { recursive: true });
  });
});

describe('project grouping', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'naos-project-'));
  after(() => rmSync(root, { recursive: true, force: true }));
  const norm = normalizePath(root);

  it('walks up to a .git folder', () => {
    clearProjectCache();
    mkdirSync(path.join(root, 'repo', '.git'), { recursive: true });
    mkdirSync(path.join(root, 'repo', 'a', 'b'), { recursive: true });
    assert.deepEqual(resolveProject(path.join(root, 'repo', 'a', 'b')), { root: `${norm}/repo`, kind: 'repo', isGit: true, worktree: null });
  });

  it('a .git file is a worktree: the main repo is the world, the folder a moon', () => {
    const wt = path.join(root, 'elsewhere', 'wt1');
    mkdirSync(wt, { recursive: true });
    writeFileSync(path.join(wt, '.git'), `gitdir: ${norm}/repo/.git/worktrees/wt1\n`);
    const info = resolveProject(wt);
    assert.equal(info.root, `${norm}/repo`);
    assert.deepEqual(info.worktree, { path: `${norm}/elsewhere/wt1`, name: 'wt1' });
  });

  it('knows a Claude worktree path even after the folder is gone', () => {
    const info = resolveProject('c:/gone/repo/.claude/worktrees/feature-1/src');
    assert.equal(info.root, 'c:/gone/repo');
    assert.deepEqual(info.worktree, { path: 'c:/gone/repo/.claude/worktrees/feature-1', name: 'feature-1' });
  });

  it('a transcript worktree-state outranks the walk', () => {
    const info = projectOf(`${root}/somewhere`, { path: `${root}/w`, name: 'n', originalCwd: `${root}/repo` });
    assert.equal(info.root, `${norm}/repo`);
    assert.equal(info.worktree?.name, 'n');
  });

  it('a plain folder is a folder world, nothing known and temp are rogue', () => {
    assert.equal(resolveProject('c:/no-such-root-for-naos/plain').kind, 'folder');
    assert.equal(resolveProject('c:/no-such-root-for-naos/plain').root, 'c:/no-such-root-for-naos/plain');
    assert.equal(resolveProject(null).kind, 'rogue');
    assert.equal(resolveProject(null).root, null);
    assert.equal(resolveProject(path.join(os.tmpdir(), 'sandbox-x')).root, null);
    assert.equal(resolveProject(os.homedir()).root, null);
  });
});

describe('ledger', () => {
  it('rolls days and models up, and leaves anything over 30 days out of the window', () => {
    const now = new Date(2026, 9, 30, 12).getTime();
    const today = dayKey(now);
    const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, webSearchRequests: 0, messages: 0, partialOutputMessages: 0 };
    const r = rollup([
      { worldId: 'a', byDay: { [today]: 2, '2026-09-01': 100 }, byModel: { m1: { usage: { ...zero, input: 5, output: 1 }, usd: 102 } } },
      { worldId: 'b', byDay: new Map([[dayKey(now - 86_400_000), 3]]), byModel: new Map([['m1', { usage: { ...zero, cacheRead: 2, output: 1 }, usd: 3 }]]) },
    ], now);
    assert.equal(r.todayUsd, 2);
    assert.equal(r.days30Usd, 5);
    const report = ledgerReport(r, { partial: false, burnUsdPerHour: 1, blockedTodayMs: 2, trees: [] });
    assert.deepEqual(report.byWorld, [{ worldId: 'b', usd: 3 }, { worldId: 'a', usd: 2 }]);
    assert.deepEqual(report.byModel, [{ model: 'm1', inputTokens: 7, outputTokens: 2, usd: 105 }]);
  });
});

describe('rates', () => {
  it('derives a response rate, holds it, then decays and clears', () => {
    const nodes = new Map<string, { tps: number; source: string }>();
    const cleared: string[] = [];
    const fleet: Array<Record<string, unknown>> = [];
    const r = new RateTracker({
      setRate: (rate) => void nodes.set(rate.nodeId, rate),
      clearRate: (id) => void cleared.push(id),
      setFleetRate: (p) => void fleet.push(p),
    });
    r.message('n', 'w', 500, 10_000, 0);
    assert.equal(nodes.get('n')?.tps, 50);
    assert.equal(nodes.get('n')?.source, 'derived');
    r.tick(5_000, null, 1000);
    assert.equal(fleet.at(-1)?.tps, 50);
    assert.deepEqual(fleet.at(-1)?.perWorld, { w: 50 });
    assert.equal(fleet.at(-1)?.outputTokens, 500);
    for (let t = 11_000; t < 40_000; t += 1000) r.tick(t, 1, 1000);
    assert.deepEqual(cleared, ['n']);
    assert.equal(fleet.at(-1)?.tps, 0);
  });

  it('burn is a trailing window scaled to an hour', () => {
    const r = new RateTracker({ setRate() {}, clearRate() {}, setFleetRate() {} });
    r.cost(1, 0);
    r.cost(2, 60_000);
    close(r.burnUsdPerHour(120_000), 12);
    assert.equal(r.burnUsdPerHour(3_600_000), 0);
  });
});

describe('context window', () => {
  it('reads the catalog by base id, and the [1m] suffix states it outright', () => {
    const catalog = new Map([['claude-opus-5-5', 1_000_000], ['claude-haiku-4-5', 200_000]]);
    assert.equal(contextWindow(catalog, 'claude-haiku-4-5-20251001', null), 200_000);
    assert.equal(contextWindow(catalog, 'claude-opus-5-5', 'claude-opus-5-5'), 1_000_000);
    assert.equal(contextWindow(new Map(), 'x', 'claude-opus-5-5[1m]'), 1_000_000);
    assert.equal(contextWindow(catalog, 'unknown-model', null), null);
    assert.equal(contextWindow(catalog, null, null), null);
  });
});
