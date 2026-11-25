import assert from 'node:assert/strict';
import { test } from 'node:test';
import { composeLine, defaultProfile, parseLaunch, resolve, specOf, terminalLine } from '../../src/hud/launch/grammar.ts';
import type { LaunchContext } from '../../src/hud/launch/grammar.ts';

const words = { worlds: ['kestrel', 'harbor'], profiles: ['build', 'recon', 'orchestrator'] };
const profiles = [
  { name: 'build', worktree: true, defaultBudgetUsd: 2 },
  { name: 'recon', worktree: false, defaultBudgetUsd: 0.5 },
  { name: 'orchestrator', worktree: false, defaultBudgetUsd: 8 },
];
const ctx = (over: Partial<LaunchContext> = {}): LaunchContext => ({ world: { worldId: 'w1', name: 'kestrel', trusted: true }, profiles, mission: null, moonOverride: null, ...over });

test('the whole line of 3.8', () => {
  const p = parseLaunch('@kestrel #build $2 x2 moon  fix the flaky queue test', words);
  assert.equal(p.world, 'kestrel');
  assert.equal(p.worldKnown, true);
  assert.equal(p.profile, 'build');
  assert.equal(p.budgetUsd, 2);
  assert.equal(p.copies, 2);
  assert.equal(p.moon, true);
  assert.equal(p.prompt, 'fix the flaky queue test');
  assert.deepEqual(p.tokens.map((t) => t.kind), ['world', 'profile', 'budget', 'copies', 'moon', 'prompt']);
});

test('QWERTZ: a leading word that matches a world counts as @world, in any case', () => {
  const p = parseLaunch('Harbor audit the callers', words);
  assert.equal(p.world, 'harbor');
  assert.equal(p.worldKnown, true);
  assert.equal(p.prompt, 'audit the callers');
  assert.equal(p.tokens[0]!.kind, 'world');
});

test('a world word that is not leading stays in the prompt', () => {
  const p = parseLaunch('fix kestrel now', words);
  assert.equal(p.world, null);
  assert.equal(p.prompt, 'fix kestrel now');
  const q = parseLaunch('#build kestrel is broken', words);
  assert.equal(q.world, null);
  assert.equal(q.prompt, 'kestrel is broken');
});

test('directives end at the prompt, so a prompt keeps its $5, x2 and #tags', () => {
  const p = parseLaunch('@harbor add a $5 fee x2 #billing moon', words);
  assert.equal(p.budgetUsd, null);
  assert.equal(p.copies, null);
  assert.equal(p.moon, false);
  assert.equal(p.profile, null);
  assert.equal(p.prompt, 'add a $5 fee x2 #billing moon');
});

test('unknown @world and #profile are marked and block in plain words', () => {
  const p = parseLaunch('@nowhere #nope do it', words);
  assert.deepEqual(p.tokens.map((t) => t.kind), ['unknown', 'unknown', 'prompt']);
  assert.equal(p.worldKnown, false);
  assert.equal(p.profileKnown, false);
  assert.equal(resolve(p, ctx()).blocked, 'No world is named nowhere.');
  const q = parseLaunch('@kestrel #nope do it', words);
  assert.equal(resolve(q, ctx()).blocked, 'No profile is named nope.');
});

test('a bare @ or # is not a directive, and $0 or x0 is marked unknown', () => {
  assert.equal(parseLaunch('@ hello', words).prompt, '@ hello');
  assert.equal(parseLaunch('# hello', words).prompt, '# hello');
  assert.equal(parseLaunch('$0 hello', words).tokens[0]!.kind, 'unknown');
  assert.equal(parseLaunch('x0 hello', words).tokens[0]!.kind, 'unknown');
  assert.equal(parseLaunch('$1.5 hello', words).budgetUsd, 1.5);
});

test('token spans point into the line, for the underlines', () => {
  const line = '@kestrel  $2 hello world';
  for (const t of parseLaunch(line, words).tokens) assert.equal(line.slice(t.start, t.end), t.text);
});

test('defaults: build when trusted, recon otherwise, moon follows the profile', () => {
  assert.equal(defaultProfile(true, false), 'build');
  assert.equal(defaultProfile(false, false), 'recon');
  assert.equal(defaultProfile(false, true), 'orchestrator');
  const trusted = resolve(parseLaunch('do it', words), ctx());
  assert.equal(trusted.profile, 'build');
  assert.equal(trusted.budgetUsd, 2);
  assert.equal(trusted.moon, true);
  assert.equal(trusted.blocked, null);
  const unknown = resolve(parseLaunch('do it', words), ctx({ world: { worldId: 'w2', name: 'x', trusted: false } }));
  assert.equal(unknown.profile, 'recon');
  assert.equal(unknown.moon, false);
});

test('blocked: no world, no prompt, and the moon row beats the line', () => {
  assert.equal(resolve(parseLaunch('do it', words), ctx({ world: null })).blocked, 'Name a world with @world, or select one.');
  assert.equal(resolve(parseLaunch('@kestrel', words), ctx()).blocked, 'Write a prompt.');
  assert.equal(resolve(parseLaunch('moon do it', words), ctx({ moonOverride: false })).moon, false);
});

test('spec: the prompt goes as data, a mission carries its limits, modes pass through', () => {
  const parsed = parseLaunch('@kestrel $3 x2 ship it', words);
  const r = resolve(parsed, ctx());
  const spec = specOf(parsed, r, ctx(), { mode: 'plan-first', idempotencyKey: 'k' });
  assert.deepEqual(spec, { profile: 'build', prompt: 'ship it', copies: 2, worktree: true, title: 'ship it', mode: 'plan-first', idempotencyKey: 'k', worldId: 'w1', budgetUsd: 3 });
  const mission = { treeBudgetUsd: 8, childLimit: 4, depth: 2 };
  const m = ctx({ mission });
  const line = parseLaunch('map the repo', words);
  const rm = resolve(line, m);
  assert.equal(rm.profile, 'orchestrator');
  assert.deepEqual(specOf(line, rm, m).mission, mission);
});

test('compose: a row edit writes the line again, and it parses back', () => {
  const line = composeLine({ world: 'harbor', profile: 'recon', budgetUsd: 1.5, copies: 3, moon: true }, 'read it');
  assert.equal(line, '@harbor #recon $1.5 x3 moon read it');
  const p = parseLaunch(line, words);
  assert.equal(p.world, 'harbor');
  assert.equal(p.copies, 3);
  assert.equal(p.prompt, 'read it');
  assert.equal(composeLine({ world: null, profile: null, budgetUsd: null, copies: 1, moon: false }, 'x'), 'x');
});

test('terminal line names the flags the CLI really has and leaves the prompt out', () => {
  const r = resolve(parseLaunch('@kestrel $2 x2 secret words', words), ctx());
  assert.equal(terminalLine('kestrel', r), 'naos launch --world kestrel --profile build --budget 2 --copies 2 "..."');
});

const named = { worlds: ['ConstructQ', 'Benchmark Agent', 'Benchmark'], profiles: ['build'] };

test('a world name with a space is one world, and the longest name wins', () => {
  const p = parseLaunch('@Benchmark Agent #build fix it', named);
  assert.equal(p.world, 'Benchmark Agent');
  assert.equal(p.worldKnown, true);
  assert.equal(p.prompt, 'fix it');
  assert.deepEqual(p.tokens.map((t) => [t.kind, t.text]), [['world', '@Benchmark Agent'], ['profile', '#build'], ['prompt', 'fix it']]);
  assert.equal(parseLaunch('@benchmark fix it', named).world, 'Benchmark');
  assert.equal(parseLaunch('benchmark agent fix it', named).world, 'Benchmark Agent');
});

test('the folder spelling reaches the world too', () => {
  assert.equal(parseLaunch('@benchmark-agent fix it', named).world, 'Benchmark Agent');
  assert.equal(parseLaunch('@Benchmark_Agent fix it', named).prompt, 'fix it');
  assert.equal(parseLaunch('@benchmarkagent fix it', named).worldKnown, true);
});

test('a longer word is not a shorter world', () => {
  assert.equal(parseLaunch('@Benchmarks fix it', named).worldKnown, false);
  assert.equal(parseLaunch('Benchmarks are slow', named).world, null);
});

test('composing and reading a spaced name agree, and the terminal line quotes it', () => {
  const line = composeLine({ world: 'Benchmark Agent', profile: 'build', budgetUsd: null, copies: null, moon: false }, 'fix it');
  assert.equal(line, '@Benchmark Agent #build fix it');
  assert.equal(parseLaunch(line, named).prompt, 'fix it');
  const resolved = resolve(parseLaunch(line, named), ctx({ world: { worldId: 'w', name: 'Benchmark Agent', trusted: true } }));
  assert.match(terminalLine('Benchmark Agent', resolved), /--world "Benchmark Agent" /);
  assert.match(terminalLine('ConstructQ', resolved), /--world ConstructQ /);
});
