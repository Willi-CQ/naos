// Parts that need no agent: profiles, base options, frames, process parsing, the registry, worktrees on real git.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { NodeRate } from '@naos/protocol';
import type { EventInit } from '../../src/context.ts';
import { agentEnv } from '../../src/control/driver.ts';
import { FrameMapper, LiveRate, summarize, type FrameSignal } from '../../src/control/frames.ts';
import { BASE_DISALLOWED, UNKNOWN_WORLD_TOOLS, composeOptions, kernelDenyRules, rulePath } from '../../src/control/options.ts';
import { descendants, killPlan, orphanedShells, parseSnapshot, sameStart, shellTrees, toFiletime } from '../../src/control/procs.ts';
import { DEFAULTS, Profiles, parseFrontmatter, parseProfile } from '../../src/control/profiles.ts';
import { Registry } from '../../src/control/registry.ts';
import type { Profile } from '../../src/control/types.ts';
import { branchFor, createWorktree, excludeWorktrees, gitInfo, removeWorktree, worktreePath } from '../../src/control/worktree.ts';
import { frames, quiet, tick, tmpDir } from './harness.ts';

const REPO_AGENTS = path.resolve(import.meta.dirname, '../../../../agents');

describe('profiles', () => {
  it('reads the seven shipped roles and skips the README', () => {
    const bus = { published: [] as EventInit[], publish(e: EventInit) { this.published.push(e); } };
    const profiles = new Profiles(REPO_AGENTS, bus, quiet);
    profiles.reload();
    assert.deepEqual(profiles.list().map((p) => p.name).sort(), ['analyst', 'build', 'long', 'orchestrator', 'plan', 'recon', 'scratch']);
    assert.equal(bus.published[0]?.type, 'profiles.changed');
    assert.equal(profiles.get('analyst')?.permissionMode, 'dontAsk');
    assert.deepEqual(profiles.get('analyst')?.tools, ['Read', 'Glob', 'Grep']);
    assert.equal(profiles.get('long')?.permissionMode, 'auto');
    assert.equal(profiles.get('plan')?.permissionMode, 'plan');
    assert.ok(profiles.get('plan')?.tools?.includes('ExitPlanMode'));
    assert.equal(profiles.get('orchestrator')?.orchestrator, true);
    assert.equal(profiles.get('scratch')?.persist, false);
    assert.equal(profiles.get('recon')?.settings, 'none');
    assert.equal(profiles.get('build')?.worktree, true);
    assert.ok(profiles.get('build')?.prompt.length);
    assert.ok(!('prompt' in profiles.list()[0]!));
  });

  it('parses both list forms, null and quotes', () => {
    const parsed = parseFrontmatter('---\nname: "x"\ntools: [A, B]\nmore:\n  - C\n  - D\neffort: null\nblank:\nn: 2.5\nyes: true\n# note\n---\nbody\n')!;
    assert.deepEqual(parsed.fields, { name: 'x', tools: ['A', 'B'], more: ['C', 'D'], effort: null, blank: null, n: 2.5, yes: true });
    assert.equal(parsed.body, 'body');
    assert.equal(parseFrontmatter('no frontmatter'), null);
  });

  it('refuses bypassPermissions and other bad values, and fills defaults', () => {
    assert.ok('error' in parseProfile('---\npermissionMode: bypassPermissions\n---\n', 'agents/x.md'));
    assert.ok('error' in parseProfile('---\nname: Bad Name\n---\n', 'agents/x.md'));
    assert.ok('error' in parseProfile('---\ndefaultBudgetUsd: -1\n---\n', 'agents/x.md'));
    const ok = parseProfile('---\ndescription: d\n---\n', 'agents/role.md');
    assert.ok('profile' in ok);
    assert.equal(ok.profile.name, 'role');
    assert.equal(ok.profile.model, DEFAULTS.model);
    assert.equal(ok.profile.tools, null);
    assert.equal(ok.profile.persist, true);
  });

  it('hot reloads, keeps the last good version of a broken file, and drops a deleted one', async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'role.md'), '---\ndefaultBudgetUsd: 1\n---\none\n');
    const seen: string[][] = [];
    const bus = { publish(e: EventInit) { if (e.type === 'profiles.changed') seen.push(e.profiles.map((p) => `${p.name}:${p.defaultBudgetUsd}`)); } };
    const profiles = new Profiles(dir, bus, quiet);
    profiles.start();
    assert.deepEqual(seen.at(-1), ['role:1']);

    fs.writeFileSync(path.join(dir, 'role.md'), '---\ndefaultBudgetUsd: 2\n---\ntwo\n');
    for (let i = 0; i < 200 && profiles.get('role')?.defaultBudgetUsd !== 2; i += 1) await tick(10);
    assert.equal(profiles.get('role')?.prompt, 'two');

    fs.writeFileSync(path.join(dir, 'role.md'), 'not a profile');
    fs.writeFileSync(path.join(dir, 'other.md'), '---\n---\n');
    for (let i = 0; i < 200 && !profiles.get('other'); i += 1) await tick(10);
    assert.equal(profiles.get('role')?.defaultBudgetUsd, 2);

    fs.rmSync(path.join(dir, 'role.md'));
    for (let i = 0; i < 200 && profiles.get('role'); i += 1) await tick(10);
    assert.equal(profiles.get('role'), undefined);
    profiles.stop();
  });
});

const profile = (over: Partial<Profile> = {}): Profile => ({
  name: 'p', description: '', model: 'claude-haiku-5-5', effort: 'low', permissionMode: 'default', defaultBudgetUsd: 1, worktree: false, tools: null,
  orchestrator: false, source: 'x', prompt: '', maxTurns: null, settings: 'world', persist: true, ...over,
});

const compose = (over: Partial<Parameters<typeof composeOptions>[0]> = {}) => composeOptions({
  agentId: 'n1', profile: profile(), model: 'claude-haiku-5-5', effort: 'low', permissionMode: 'default', tools: null, cwd: 'C:/repo', maxBudgetUsd: 0.05,
  maxTurns: 5, sessionId: '00000000-0000-4000-8000-000000000000', trusted: false, canUseTool: async () => ({ behavior: 'allow' }),
  audit: { pre: async () => ({}), post: async () => ({}) }, denyRules: ['Read(x)'], stderr: () => {}, ...over,
});

describe('base options, AC 8', () => {
  it('every agent gets the whole base block', () => {
    for (const permissionMode of ['default', 'plan', 'dontAsk', 'auto'] as const) {
      const o = compose({ permissionMode, profile: profile({ permissionMode }) });
      assert.equal(o.permissionMode, permissionMode);
      assert.equal(o.includePartialMessages, true);
      assert.equal(o.title, 'naos:n1');
      assert.equal(o.sessionId, '00000000-0000-4000-8000-000000000000');
      assert.equal(o.maxBudgetUsd, 0.05);
      assert.equal(o.maxTurns, 5);
      assert.equal(o.model, 'claude-haiku-5-5');
      assert.equal(o.effort, 'low');
      assert.ok(o.canUseTool && o.stderr);
      assert.equal(o.hooks?.PreToolUse?.length, 1);
      assert.deepEqual(o.disallowedTools, [...BASE_DISALLOWED]);
      const settings = o.settings as Record<string, unknown>;
      assert.equal(settings.disableClaudeAiConnectors, true);
      assert.equal(settings.crossSessionInbound, 'refuse');
      assert.deepEqual((settings.permissions as { deny: string[] }).deny, ['Read(x)']);
      assert.equal(o.env?.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH, '2');
      assert.equal(o.env?.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS, '5');
      assert.notEqual(o.permissionMode, 'bypassPermissions');
      assert.equal('allowDangerouslySkipPermissions' in o, false);
    }
  });

  it('an unknown world gets no settings, strict MCP and tighter tools', () => {
    const o = compose({ trusted: false });
    assert.deepEqual(o.settingSources, []);
    assert.equal(o.strictMcpConfig, true);
    assert.deepEqual(o.tools, [...UNKNOWN_WORLD_TOOLS]);
    assert.equal(o.env?.CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1');
  });

  it('a trusted world loads all three sources, unless the profile says none', () => {
    const o = compose({ trusted: true });
    assert.deepEqual(o.settingSources, ['user', 'project', 'local']);
    assert.equal(o.strictMcpConfig, undefined);
    assert.equal(o.pluginDelivery, 'initialize');
    assert.equal(o.tools, undefined);
    const none = compose({ trusted: true, profile: profile({ settings: 'none' }) });
    assert.deepEqual(none.settingSources, []);
    assert.equal(none.strictMcpConfig, true);
  });

  it('the hybrid worktree adopts on spawn and only keeps the config root on resume', () => {
    const o = compose({ worktree: { name: 'n1', repoRoot: 'C:/repo' } });
    assert.deepEqual(o.extraArgs, { worktree: 'n1' });
    assert.equal(o.projectConfigRoot, 'C:/repo');
    const resumed = compose({ worktree: { name: 'n1', repoRoot: 'C:/repo' }, resume: 'abc' });
    assert.equal(resumed.extraArgs, undefined);
    assert.equal(resumed.projectConfigRoot, 'C:/repo');
    assert.equal(resumed.resume, 'abc');
    assert.equal(resumed.sessionId, undefined);
    assert.equal(resumed.title, undefined);
  });

  it('a fork names its own session', () => {
    const o = compose({ resume: 'abc', fork: true });
    assert.equal(o.forkSession, true);
    assert.equal(o.sessionId, '00000000-0000-4000-8000-000000000000');
    assert.equal(o.title, 'naos:n1');
  });

  it('analyst mode, orchestrator tools, auto watchdog, scratch', () => {
    const analyst = compose({ permissionMode: 'dontAsk', tools: ['Read', 'Glob', 'Grep'] });
    assert.deepEqual(analyst.allowedTools, ['Read', 'Glob', 'Grep']);
    const orchestrator = compose({ os: { type: 'stdio', command: 'x' }, tools: ['Read'] });
    assert.deepEqual(orchestrator.allowedTools, ['mcp__os__*']);
    assert.ok(orchestrator.mcpServers?.os);
    assert.equal(compose({ permissionMode: 'auto' }).env?.CLAUDE_CODE_RETRY_WATCHDOG, '1');
    assert.equal(compose({ profile: profile({ persist: false }) }).persistSession, false);
    assert.equal(compose({ resumeInterruptedTurn: true }).env?.CLAUDE_CODE_RESUME_INTERRUPTED_TURN, '1');
    assert.deepEqual(compose({ profile: profile({ prompt: 'role' }) }).systemPrompt, { type: 'preset', preset: 'claude_code', append: 'role' });
  });

  it('kernel data is denied, and the rule path is the absolute form', () => {
    assert.equal(rulePath('C:\\dev\\x\\.naos'), '//c/dev/x/.naos');
    const rules = kernelDenyRules('C:\\dev\\x\\.naos');
    assert.ok(rules.includes('Read(//c/dev/x/.naos/**)'));
    assert.ok(rules.includes('Edit(//c/dev/x/.naos/**)'));
    assert.ok(rules.includes('Bash(*.naos*)'));
    const scratch = kernelDenyRules('C:\\dev\\x\\.naos', { scratchInside: true });
    assert.ok(scratch.includes('Read(//c/dev/x/.naos/*.token)'));
    assert.ok(!scratch.some((r) => r.endsWith('.naos/**)')));
  });

  it('the environment is scrubbed and holds no NAOS secret', () => {
    const env = agentEnv({ KEEP: '1' }, { CLAUDECODE: '1', CLAUDE_PID: '2', CLAUDE_EFFORT: 'x', CLAUDE_CODE_SSE_PORT: '3', CLAUDE_AGENT_SDK_X: '4', NAOS_TOKEN: 'secret', naos_other: 's', PATH: 'p' });
    assert.deepEqual(env, { PATH: 'p', KEEP: '1' });
  });
});

const mapper = () => {
  const events: EventInit[] = [];
  const texts: string[] = [];
  const rates: NodeRate[] = [];
  const cleared: string[] = [];
  let now = 1000;
  const m = new FrameMapper({
    sessionId: 's1', cwd: 'C:\\repo', publish: (e) => events.push(e), pushText: (_n, d) => texts.push(d), setRate: (r) => rates.push(r),
    clearRate: (n) => cleared.push(n), now: () => now,
  });
  return { m, events, texts, rates, cleared, advance: (ms: number) => { now += ms; }, types: () => events.map((e) => e.type) };
};

describe('frames to events', () => {
  it('a turn becomes the Observer event types, and text goes only to pushText', () => {
    const { m, events, texts, types } = mapper();
    m.beginTurn('human');
    assert.equal(m.handle(frames.init('s1'))?.kind, 'init');
    assert.equal(m.handle(frames.requesting())?.kind, 'requesting');
    m.handle(frames.messageStart('m1'));
    m.handle(frames.blockStart('text'));
    m.handle(frames.textDelta('SECRET-TEXT'));
    m.handle(frames.assistantText('m1', 'SECRET-TEXT'));
    m.handle(frames.messageDelta(9));
    const signal = m.handle(frames.result({ uuids: ['u1'], cost: 0.002, text: 'SECRET-RESULT' })) as Extract<FrameSignal, { kind: 'result' }>;

    assert.deepEqual(types(), ['turn.started', 'request.started', 'activity.changed', 'activity.changed', 'message.completed', 'turn.ended', 'usage.changed', 'activity.changed']);
    assert.deepEqual(texts, ['SECRET-TEXT']);
    assert.ok(!JSON.stringify(events).includes('SECRET'));
    assert.deepEqual(events.every((e) => 'sessionId' in e && e.sessionId === 's1'), true);
    assert.equal(signal.result.text, 'SECRET-RESULT');
    assert.equal(signal.result.terminalReason, 'completed');
    assert.deepEqual(signal.result.uuids, ['u1']);
    assert.equal(signal.result.contextWindow, 200000);
    assert.deepEqual(signal.result.subagentStats, { spawned: 2, maxDepth: 1, completed: 1, failed: 0, killed: 0, refused: { depthLimit: 1, concurrencyLimit: 0, budget: 0 } });
    const message = events.find((e) => e.type === 'message.completed');
    assert.ok(message?.type === 'message.completed');
    assert.deepEqual(message.blocks, ['text']);
    assert.deepEqual(message.blockSizes, [11]);
    assert.equal(message.usage.output, 9);
    assert.equal(message.usage.input, 100);
    assert.equal(m.contextTokens, 110);
    assert.equal(m.ttftMs, 900);
    assert.equal(m.contextWindow, 200000);
  });

  it('tools: started, summarized, finished, with the human decision', () => {
    const { m, events } = mapper();
    m.beginTurn('human');
    m.handle(frames.messageStart('m1'));
    m.handle(frames.assistantTool('m1', 't1', 'Bash', { command: 'touch one.txt\necho two' }));
    m.handle(frames.assistantTool('m1', 't2', 'Write', { file_path: 'C:\\repo\\src\\a.ts', content: 'x\ny' }));
    assert.deepEqual(m.callPosition('t2'), { index: 2, count: 2 });
    const state = (): string => m.activity.state;
    m.setWaiting(true);
    assert.equal(state(), 'waiting');
    m.markDecision('t1', 'reject', { kind: 'user', source: 'human' });
    m.setWaiting(false);
    assert.equal(state(), 'tool_running');
    m.handle(frames.toolResult('t1', true));
    m.handle(frames.toolResult('t2'));
    const started = events.filter((e) => e.type === 'tool.started');
    assert.deepEqual(started.map((e) => e.type === 'tool.started' && e.summary), [
      { target: 'touch one.txt', shape: 'Bash, 2 lines, 22 chars' },
      { target: 'src/a.ts', shape: 'Write, 2 lines', plus: 2 },
    ]);
    const finished = events.filter((e) => e.type === 'tool.finished');
    assert.ok(finished[0]?.type === 'tool.finished');
    assert.equal(finished[0].isError, true);
    assert.equal(finished[0].decision, 'reject');
    assert.deepEqual(finished[0].denial, { kind: 'user', source: 'human' });
    assert.ok(finished[1]?.type === 'tool.finished');
    assert.equal(finished[1].decision, null);
    assert.equal(m.toolCalls, 2);
    assert.equal(m.toolErrors, 1);
    assert.ok(!JSON.stringify(events).includes('private tool output'));
  });

  it('a rule denial never fires a beam twice', () => {
    const { m, events } = mapper();
    m.beginTurn('human');
    m.handle({ type: 'system', subtype: 'permission_denied', tool_name: 'Edit', tool_use_id: 'gone', decision_reason_type: 'rule' } as never);
    m.handle(frames.assistantTool('m1', 't1', 'Bash', { command: 'x' }));
    m.handle({ type: 'system', subtype: 'permission_denied', tool_name: 'Bash', tool_use_id: 't1', decision_reason_type: 'rule' } as never);
    assert.ok(events.some((e) => e.type === 'tool.denied' && e.toolUseId === 'gone'));
    const finished = events.find((e) => e.type === 'tool.finished');
    assert.ok(finished?.type === 'tool.finished');
    assert.equal(finished.decision, 'reject');
  });

  it('subagent frames stay with the Observer, and a synthetic result is ignored', () => {
    const { m, events } = mapper();
    m.handle({ ...frames.assistantTool('m9', 't9', 'Bash', { command: 'x' }), parent_tool_use_id: 'task' } as never);
    assert.equal(events.length, 0);
    const synthetic = frames.result({ uuids: [], cost: 0, numTurns: 0 });
    delete (synthetic as unknown as Record<string, unknown>).user_message_uuid;
    assert.equal(m.handle(synthetic), null);
  });

  it('unknown frames are counted and never throw', () => {
    const { m } = mapper();
    assert.equal(m.handle({ type: 'from_the_future', x: 1 } as never), null);
    assert.equal(m.handle({ type: 'system', subtype: 'new_thing' } as never), null);
    assert.equal(m.handle({ type: 'assistant' } as never), null);
    assert.equal(m.handle({ type: 'user', message: { content: 'plain' } } as never), null);
    assert.equal(m.handle({ type: 'stream_event', event: { type: 'nope' } } as never), null);
    assert.equal(m.unknownFrames, 2);
  });

  it('retry, compaction and rate limit frames', () => {
    const { m, events } = mapper();
    const state = (): string => m.activity.state;
    m.beginTurn('human');
    m.handle({ type: 'system', subtype: 'api_retry', attempt: 2, max_retries: 10, retry_delay_ms: 500 } as never);
    assert.equal(state(), 'retrying');
    m.handle(frames.messageStart('m1'));
    assert.equal(state(), 'generating');
    m.handle({ type: 'system', subtype: 'status', status: 'compacting' } as never);
    assert.equal(state(), 'compacting');
    m.handle({ type: 'system', subtype: 'status', status: null } as never);
    m.handle({ type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'auto', pre_tokens: 10, post_tokens: 4, duration_ms: 7 } } as never);
    assert.equal(m.contextTokens, 4);
    assert.ok(events.some((e) => e.type === 'compacted' && e.trigger === 'auto' && e.postTokens === 4));
    const limit = m.handle(frames.rateLimit('rejected', 1, 100));
    assert.ok(limit?.kind === 'rate-limit');
    assert.equal(limit.info.fiveHour?.utilization, 1);
    assert.equal(limit.info.resetsAt, 100_000);
    assert.ok(events.some((e) => e.type === 'rate_limit.hit' && e.resetsAt === 100_000));
  });

  it('aborted and failed turns show in the activity', () => {
    const a = mapper();
    a.m.beginTurn('human');
    a.m.handle(frames.result({ uuids: ['u'], cost: 0, reason: 'aborted_streaming' }));
    assert.equal(a.m.activity.state, 'interrupted');
    const b = mapper();
    b.m.beginTurn('human');
    b.m.handle(frames.result({ uuids: ['u'], cost: 0, reason: 'api_error' }));
    assert.equal(b.m.activity.state, 'errored');
    const c = mapper();
    c.m.beginTurn('human');
    c.m.handle(frames.result({ uuids: ['u'], cost: 0, reason: 'max_turns' }));
    assert.equal(c.m.activity.state, 'idle');
  });

  it('text and thinking feed the live rate, real tokens replace the estimate', () => {
    const { m, rates, cleared, advance } = mapper();
    m.beginTurn('human');
    m.handle(frames.messageStart('m1'));
    m.handle(frames.textDelta('x'.repeat(35)));
    assert.equal(rates.at(-1)?.source, 'live');
    assert.equal(rates.at(-1)?.liveBlock, 'text');
    assert.equal(rates.at(-1)?.tps, 10);
    advance(200);
    m.handle(frames.thinkingTokens(40, 40));
    assert.equal(rates.at(-1)?.liveBlock, 'thinking');
    assert.equal(rates.at(-1)?.tps, 50);
    m.handle(frames.messageDelta(77));
    advance(1500);
    m.tick();
    assert.equal(rates.at(-1)?.tps, 0);
    assert.equal(rates.at(-1)?.outputTokens, 77);
    m.handle(frames.result({ uuids: ['u'], cost: 0 }));
    assert.deepEqual(cleared, ['s1']);
  });

  it('the window forgets old samples', () => {
    const rate = new LiveRate();
    rate.addThinking(0, 100);
    assert.equal(rate.read(500).tps, 100);
    assert.deepEqual(rate.read(2000), { tps: 0, liveBlock: null });
  });

  it('summaries keep the shape safe', () => {
    assert.deepEqual(summarize('Grep', { pattern: 'abc' }, 'C:\\r'), { target: 'abc', shape: 'Grep, 3 chars' });
    assert.deepEqual(summarize('Edit', { file_path: 'C:\\r\\a.ts', old_string: 'x', new_string: 'y\nz' }, 'C:\\r'), { target: 'a.ts', shape: 'Edit, +2 -1', plus: 2, minus: 1 });
    assert.deepEqual(summarize('mcp__x__y', { a: 1 }, 'C:\\r'), { target: null, shape: 'mcp__x__y, 1 field' });
    assert.ok((summarize('Bash', { command: 'y'.repeat(500) }, 'C:\\r').target ?? '').length <= 160);
    assert.ok(!summarize('Bash', { command: 'SECRET' }, 'C:\\r').shape.includes('SECRET'));
  });
});

describe('process facts', () => {
  const snap = parseSnapshot('10|4|134378702327497010|claude.exe\r\n11|10|134378702327497020|conhost.exe\n12|10|134378702327497030|bash.exe\n13|12|134378702327497040|bash.exe\n14|13|134378702327497050|node.exe\n15|10|134378702327497060|node.exe\n\nbad line\n');

  it('a stranger whose dead parent had a pid we now hold is never part of a tree', () => {
    const at = (created: number) => String(133_000_000_000_000_000 + created);
    const snap = [
      { pid: 10, ppid: 1, name: 'claude.exe', created: at(100) },
      { pid: 12, ppid: 10, name: 'bash.exe', created: at(110) },
      { pid: 13, ppid: 12, name: 'node.exe', created: at(120) },
      // Started long before this pid 12 existed, under some process that held the number then. Its own child comes along.
      { pid: 50, ppid: 12, name: 'Discord.exe', created: at(5) },
      { pid: 51, ppid: 50, name: 'Discord.exe', created: at(6) },
    ];
    assert.deepEqual(descendants(10, snap).map((p) => p.pid), [12, 13]);
    assert.deepEqual(shellTrees(10, snap).map((p) => p.pid), [12, 13]);
    assert.deepEqual(killPlan(10, snap), { kind: 'each', pids: [13, 12, 10] }, '/T would have reached it');
    assert.deepEqual(killPlan(10, snap.filter((p) => p.pid < 50)), { kind: 'tree' }, 'the plain case keeps taskkill /T');
    assert.deepEqual(killPlan(999, snap), { kind: 'tree' }, 'an unknown root, as when a snapshot failed');
  });

  it('parses lines and walks only the shell trees', () => {
    assert.equal(snap.length, 6);
    assert.deepEqual(shellTrees(10, snap).map((p) => p.pid), [12, 13, 14]);
  });

  it('compares creation time within 10 ticks, and refuses the old format', () => {
    assert.equal(sameStart('134378702327497017', '134378702327497010'), true);
    assert.equal(sameStart('134378702327497030', '134378702327497010'), false);
    assert.equal(sameStart('639000000000000000', '639000000000000000'), false);
    assert.equal(sameStart('junk', '1'), false);
  });

  it('finds the shells of a dead CLI inside its lifetime, and none while the pid has a live holder', () => {
    const [from, to] = ['134378702327497025', '134378702327497035'];
    const orphans = snap.filter((p) => p.pid !== 10);
    assert.deepEqual(orphanedShells(10, from, to, orphans).map((p) => p.pid), [12], 'by parent pid, a shell, in the window');
    assert.deepEqual(orphanedShells(10, '134378702327497031', to, orphans), [], 'older than the CLI');
    assert.deepEqual(orphanedShells(10, from, '134378702327497029', orphans), [], 'newer than its last step');
    assert.deepEqual(orphanedShells(10, from, to, snap), [], 'a live pid means the parent is someone else, or the CLI itself');
  });

  it('turns epoch milliseconds into a FILETIME', () => {
    assert.equal(toFiletime(0), '116444736000000000');
    assert.equal(toFiletime(1), '116444736000010000');
  });
});

describe('registry', () => {
  it('finds by session, pid and title, and forgets a dead pid', () => {
    const r = new Registry();
    r.register('a', { sessionId: 's', title: 'naos:a' });
    r.register('a', { sessionId: 's', pid: 7 });
    assert.equal(r.lookup({ sessionId: 's' }), 'a');
    assert.equal(r.lookup({ pid: 7 }), 'a');
    assert.equal(r.lookup({ title: 'naos:a' }), 'a');
    assert.equal(r.lookup({ sessionId: 'x', pid: 8, title: 'y' }), null);
    r.dropPid('a', 7);
    assert.equal(r.lookup({ pid: 7 }), null);
    r.unregister('a');
    assert.equal(r.lookup({ sessionId: 's' }), null);
  });
});

const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim();

function makeRepo(): string {
  const repo = tmpDir('naos-git-');
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'test');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a');
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'first');
  return repo;
}

describe('worktrees, on real git', () => {
  it('creates on agent/<id>, excludes, and removes after unlocking', async () => {
    const repo = makeRepo();
    const wt = await createWorktree(repo, 'n1');
    assert.equal(wt.branch, 'agent/n1');
    assert.equal(wt.path, worktreePath(path.resolve(repo), 'n1'));
    assert.ok(fs.existsSync(path.join(wt.path, 'a.txt')));
    assert.match(fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8'), /^\.claude\/worktrees\/$/m);
    assert.equal(git(repo, 'status', '--porcelain'), '');

    git(repo, 'worktree', 'lock', wt.path, '--reason', 'claude session n1 (pid 1)');
    assert.deepEqual(await removeWorktree(repo, wt), { removed: true, branchRemoved: true, kept: null });
    assert.ok(!fs.existsSync(wt.path));
    assert.equal(git(repo, 'branch', '--list', branchFor('n1')), '');
  });

  it('adds the exclude line once', () => {
    const repo = makeRepo();
    const dir = path.join(repo, '.git');
    excludeWorktrees(dir);
    excludeWorktrees(dir);
    assert.equal(fs.readFileSync(path.join(dir, 'info', 'exclude'), 'utf8').split('.claude/worktrees/').length, 2);
  });

  it('never destroys work: dirty keeps the worktree, unmerged commits keep the branch', async () => {
    const repo = makeRepo();
    const dirty = await createWorktree(repo, 'n2');
    fs.writeFileSync(path.join(dirty.path, 'new.txt'), 'work');
    assert.deepEqual(await removeWorktree(repo, dirty), { removed: false, branchRemoved: false, kept: 'uncommitted changes' });
    assert.ok(fs.existsSync(path.join(dirty.path, 'new.txt')));

    const committed = await createWorktree(repo, 'n3');
    fs.writeFileSync(path.join(committed.path, 'b.txt'), 'b');
    git(committed.path, 'add', '.');
    git(committed.path, 'commit', '-qm', 'work');
    assert.deepEqual(await removeWorktree(repo, committed), { removed: true, branchRemoved: false, kept: 'unmerged commits' });
    assert.notEqual(git(repo, 'branch', '--list', 'agent/n3'), '');
  });

  it('finds the main checkout from inside a worktree', async () => {
    const repo = makeRepo();
    const wt = await createWorktree(repo, 'n4');
    const info = await gitInfo(wt.path);
    assert.equal(info.root.toLowerCase(), fs.realpathSync(repo).toLowerCase());
    assert.equal(info.isGit, true);
    assert.equal(info.hasCommit, true);
  });

  it('copies what .worktreeinclude names, and non-git folders are not repos', async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, '.gitignore'), '.env\n');
    fs.writeFileSync(path.join(repo, '.env'), 'X=1');
    fs.writeFileSync(path.join(repo, '.worktreeinclude'), '.env\n');
    git(repo, 'add', '.gitignore');
    git(repo, 'commit', '-qm', 'ignore');
    const wt = await createWorktree(repo, 'n5');
    assert.equal(fs.readFileSync(path.join(wt.path, '.env'), 'utf8'), 'X=1');

    const plain = tmpDir('naos-plain-');
    const info = await gitInfo(plain);
    assert.equal(info.isGit, false);
    await assert.rejects(createWorktree(plain, 'n6'), /not a git repository/);
  });

  it('a repo with no commits cannot have a worktree', async () => {
    const repo = tmpDir('naos-empty-');
    git(repo, 'init', '-q');
    assert.equal((await gitInfo(repo)).hasCommit, false);
    await assert.rejects(createWorktree(repo, 'n7'), /no commits/);
  });
});
