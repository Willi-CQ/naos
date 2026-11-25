import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChannelRow, FleetState, HistoryDigest, NodeRate } from '@naos/protocol';
import { BELT_GROUP, buildModel, channelRowVM, foldBelt, veiledApproval } from '../../src/store/model.ts';
import type { ModelInput, TapeFilter } from '../../src/store/model.ts';
import { ageClock, ageFine, ageWords, money, shortTarget, tokens } from '../../src/store/format.ts';
import { hash32, titleShape, veilNames } from '../../src/store/veil.ts';
import { ingest, publish, resetForTest, select, useNaos } from '../../src/store/store.ts';

// The fixture is the one source of a whole fleet, so these tests run the real timeline. The specifier is built at run time because the
// kernel sits outside this package's tsconfig. Only structure and placeholder names exist in it.
globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, result: { rows: [], salvos: [] } }))) as typeof fetch;

const fixture = async (): Promise<{ at(t: number): { state: FleetState; history: HistoryDigest[] }; words: string[] }> => {
  const path = '../../../kernel/src/fixture/';
  const { buildHistory } = await import(`${path}history.ts`);
  const { buildTimeline, stateAt } = await import(`${path}timeline.ts`);
  const { FIXTURE_EPOCH, WORLDS, CRAFT } = await import(`${path}scene.ts`);
  const history = buildHistory(FIXTURE_EPOCH);
  const timeline = buildTimeline(history, FIXTURE_EPOCH);
  const words: string[] = [
    ...WORLDS.map((w: { name: string }) => w.name),
    ...CRAFT.map((c: { title: string }) => c.title),
    ...CRAFT.flatMap((c: { branch?: string }) => (c.branch && c.branch !== 'main' ? [c.branch] : [])),
    '/fixture/',
    'npm install',
    'npm test',
    'repo-audit',
    'Placeholder descript',
  ];
  return { at: (t) => ({ state: stateAt(timeline, t * 1000).state, history: history.rows }), words };
};

const input = (state: FleetState, history: HistoryDigest[], over: Partial<ModelInput> = {}): ModelInput => ({
  fleet: state,
  rates: { at: state.lastTickAt ?? 0, fleet: null, nodes: {} },
  now: state.lastTickAt ?? 0,
  veil: false,
  tapeFilter: 'all',
  history,
  clientId: null,
  linkUp: true,
  sensorChangedAt: null,
  burns: {},
  ...over,
});

test('the docket names a tender by its number, and the Veil keeps only that', async () => {
  const f = await fixture();
  const { state, history } = f.at(60);
  const parent = Object.values(state.nodes).find((n) => n.kind === 'main' && n.childNodeIds.length > 0)!;
  const childId = parent.childNodeIds[0]!;
  const agentId = childId.slice(childId.lastIndexOf('/') + 1);
  const approval = Object.values(state.approvals)[0]!;
  const fleet: FleetState = { ...state, approvals: { [approval.requestId]: { ...approval, status: 'open', nodeId: parent.nodeId, subagentId: agentId, subagentType: 'Explore' } } };
  assert.equal(buildModel(input(fleet, history)).decisions[0]?.tag, 'tender t1, Explore');
  assert.equal(buildModel(input(fleet, history, { veil: true })).decisions[0]?.tag, 'tender t1');
});

test('a plan reading hours old says so, and a window that rolled over reads as unknown', async () => {
  const f = await fixture();
  const { state, history } = f.at(60);
  const now = new Date(2026, 9, 31, 11, 0).getTime();
  const reading = (over: Partial<NonNullable<FleetState['plan']>>) => buildModel(input({ ...state, plan: { ...state.plan!, ...over } }, history, { now }));
  const old = reading({ fiveHourLeft: 0.9, sevenDayLeft: 0.8, asOf: now - 12 * 3_600_000, resetsAt: { fiveHour: now - 8 * 3_600_000, sevenDay: now + 3_600_000 } });
  assert.equal(old.sun.stale, true);
  assert.match(old.sun.asOf ?? '', /^yesterday /);
  assert.equal(old.sun.fiveLeft, null);
  assert.equal(old.sun.sevenLeft, 0.8);
  assert.equal(old.sun.resets, 'passed');
  const fresh = reading({ fiveHourLeft: 0.9, asOf: now - 120_000, resetsAt: { fiveHour: now + 3_600_000, sevenDay: null } });
  assert.equal(fresh.sun.stale, false);
  assert.equal(fresh.sun.fiveLeft, 0.9);
  assert.doesNotMatch(fresh.sun.asOf ?? '', /yesterday/);
  assert.notEqual(fresh.sun.resets, 'passed');
});

test('the reference moment reads like the reference', async () => {
  const f = await fixture();
  const { state, history } = f.at(60);
  const m = buildModel(input(state, history));
  assert.equal(m.craftCount, 20);
  assert.equal(m.run, 13);
  assert.equal(m.idle, 1);
  assert.equal(m.derelict, 1);
  assert.deepEqual(m.worlds.map((w) => w.name), ['kestrel', 'tundra', 'harbor', 'mosaic', 'lumen']);
  assert.equal(m.worlds.reduce((n, w) => n + w.rows.length, 0), 14);
  assert.equal(m.lamps.find((l) => l.id === 'you')?.count, 1);
  assert.equal(m.lamps.find((l) => l.id === 'source')?.count, 1);
  assert.equal(m.lamps.find((l) => l.id === 'fault')?.count, 1);
  assert.equal(m.lamps.find((l) => l.id === 'retry')?.count, 1);
  assert.equal(m.lamps.find((l) => l.id === 'low')?.count, 1);
  assert.equal(m.lamps.find((l) => l.id === 'limit')?.lit, false);
  assert.equal(m.decisions[0]?.age, '0:41');
  assert.equal(m.decisions[0]?.preview, 'npm install --save-dev vitest@4');
  assert.equal(m.title, '(1) NAOS, kestrel needs approval');
  assert.equal(m.sources[0]?.reason, 'permission prompt');
  assert.equal(m.sources[0]?.owner, 'Cursor');
  assert.deepEqual(m.trouble.map((t) => t.state), ['errored', 'retrying']);
  const first = m.worlds[0]!.rows[0]!;
  assert.ok(first.type === 'craft' && first.craft.state === 'approve' && first.craft.title === 'fix flaky queue');
  assert.equal(m.walk[0], m.decisions[0]?.nodeId);
  assert.equal(m.worlds[2]!.rows[1]!.type, 'workflow');
});

test('Veil hides every name at every point of the timeline', async () => {
  const f = await fixture();
  for (const t of [0, 19, 60, 76, 100, 124, 140, 150, 172]) {
    const { state, history } = f.at(t);
    const veiled = JSON.stringify(buildModel(input(state, history, { veil: true })));
    const open = JSON.stringify(buildModel(input(state, history)));
    for (const word of f.words) {
      assert.ok(!veiled.includes(word), `t=${t}: "${word}" leaked through the Veil`);
    }
    assert.ok(open.includes('kestrel'), 'the control: names do show without the Veil');
  }
});

test('Veil covers the channel, and a veiled approval holds no input', async () => {
  const row: ChannelRow = {
    kind: 'tool', at: 0, toolUseId: 'x', name: 'Bash', family: 'shell', durationMs: 100, isError: false, decision: null,
    summary: { target: 'cat /secret/project/file', shape: 'Bash, 1 line, 24 chars' },
  };
  const opts = { wide: true, now: 0, openTools: [], crafts: {} };
  assert.equal(channelRowVM(row, { ...opts, veil: true }).body, 'Bash, 1 line, 24 chars');
  assert.equal(channelRowVM(row, { ...opts, veil: false }).body, 'cat /secret/project/file');
  const safe = veiledApproval({ input: { command: 'secret' }, description: 'secret', title: 'secret', blockedPath: 'secret', mcpServer: { name: 'secret', source: 'x' } } as never);
  assert.ok(!JSON.stringify(safe).includes('secret'));
});

test('star names are stable, salted and unique', () => {
  const w = (slot: number, root: string) => ({ worldId: `w${slot}`, slot, projectRoot: root }) as never;
  const a = veilNames([w(1, '/a'), w(2, '/b'), w(3, '/c')], 'salt');
  const b = veilNames([w(1, '/a'), w(2, '/b'), w(3, '/c')], 'salt');
  assert.deepEqual([...a], [...b]);
  assert.equal(new Set(a.values()).size, 3);
  assert.notEqual(hash32('salt:/a'), hash32('other:/a'));
  // The largest list a star table can be asked about: every name stays distinct.
  const many = Array.from({ length: 60 }, (_, i) => w(i + 1, `/p${i}`));
  assert.equal(new Set(veilNames(many, 'salt').values()).size, 60);
});

test('rates drive the state word, and tool rows follow their family', async () => {
  const f = await fixture();
  const { state, history } = f.at(60);
  const nodes: Record<string, NodeRate> = {};
  for (const m of Object.values(state.managed)) nodes[m.nodeId] = { nodeId: m.nodeId, tps: 388, source: 'live', liveBlock: 'text', outputTokens: 10 };
  const model = buildModel(input(state, history, { rates: { at: state.lastTickAt!, fleet: null, nodes } }));
  const writing = Object.values(model.crafts).filter((c) => c.state === 'writing');
  assert.ok(writing.length > 0);
  assert.equal(writing[0]!.word, 'WRITE');
  assert.equal(writing[0]!.metric, '388/s');
  const shell = Object.values(model.crafts).find((c) => c.word === 'SHELL');
  assert.ok(shell);
  assert.equal(shell.mark, 'square');
});

test('the tape filter and the time order', async () => {
  const f = await fixture();
  const { state, history } = f.at(60);
  const of = (tapeFilter: TapeFilter) => buildModel(input(state, history, { tapeFilter })).tape;
  assert.ok(of('all').every((t) => t.kind !== 'tool'));
  assert.ok(of('needs').every((t) => t.kind === 'need' || t.kind === 'answered'));
  assert.ok(of('writes-damage').every((t) => !['response', 'land'].includes(t.kind)));
  const at = of('all').map((t) => t.at);
  assert.deepEqual(at, [...at].sort((a, b) => b - a));
});

test('tape coalesces with a count only past 8 events a second', () => {
  const entry = (i: number, at: number) => ({ id: String(i), at, kind: 'response', nodeId: null, worldId: null, detail: null, note: null }) as const;
  const state = { tape: Array.from({ length: 12 }, (_, i) => entry(i, 5000)), worlds: {}, sessions: {}, nodes: {}, managed: {}, approvals: {}, standing: {}, workflows: {}, acked: {}, admission: { queued: [], running: 0, runningLimit: 6, alive: 0, aliveLimit: 16, frozen: null }, plan: null, index: { stage: 'done', done: 0, total: 0 }, kernel: null, lastTickAt: 5000 } as unknown as FleetState;
  const burst = buildModel(input(state, [])).tape;
  assert.equal(burst.length, 1);
  assert.equal(burst[0]!.times, 12);
  const calm = buildModel(input({ ...state, tape: state.tape.slice(0, 3) }, [])).tape;
  assert.equal(calm.length, 3);
});

test('the sky at rest: Almanac and away list, built from counts', async () => {
  const f = await fixture();
  const { state, history } = f.at(60);
  const empty: FleetState = { ...state, sessions: {}, nodes: {}, managed: {}, approvals: {}, workflows: {} };
  const m = buildModel(input(empty, history));
  assert.equal(m.craftCount, 0);
  assert.ok(m.almanac.length >= 2);
  assert.ok(m.almanac.at(-1)!.endsWith('of the sun is showing.'));
  assert.equal(m.worlds.length, 0);
  assert.equal(m.allWorlds.length, 7);
});

test('a salvo may outlive its craft, and a decision with no node still reaches the rail', async () => {
  const f = await fixture();
  const { state, history } = f.at(60);
  const approval = Object.values(state.approvals)[0]!;
  const lonely: FleetState = { ...state, approvals: { x: { ...approval, requestId: 'x', nodeId: 'gone', status: 'open' } } };
  const m = buildModel(input(lonely, history));
  assert.equal(m.decisions.length, 1);
  assert.equal(m.badge, 1);
});

test('a clock behind the event never makes a negative age', async () => {
  const f = await fixture();
  const { state, history } = f.at(60);
  const created = Object.values(state.approvals)[0]!.createdAt;
  const m = buildModel(input(state, history, { now: created - 5000 }));
  assert.equal(m.decisions[0]!.ageMs, 0);
});

test('/clear: the selection follows the hull to its new session id', async () => {
  const f = await fixture();
  const { state } = f.at(60);
  resetForTest();
  ingest({ t: 'snapshot', seq: state.seq, state });
  const old = Object.values(state.sessions)[0]!;
  select(old.rootNodeId);
  ingest({
    t: 'events', seq: state.seq + 1,
    events: [{ type: 'session.changed', id: 'x', at: 1, observedAt: 1, sessionId: old.sessionId, nodeId: old.rootNodeId, patch: { sessionId: 'fresh-id' } }],
  });
  assert.equal(useNaos.getState().view.selected, 'fresh-id');
  assert.ok(useNaos.getState().fleet.sessions['fresh-id']);
  publish();
  assert.ok(useNaos.getState().model.crafts['fresh-id'], 'the hull is there under its new id');
  resetForTest();
});

test('numbers', () => {
  assert.equal(ageClock(41_000), '0:41');
  assert.equal(ageClock(4_320_000), '1h 12m');
  assert.equal(ageWords(12_000), '12 s');
  assert.equal(ageWords(720_000), '12 m');
  assert.equal(ageFine(4_800), '4.8 s');
  assert.equal(ageFine(11_000), '11 s');
  assert.equal(tokens(812_000), '812k');
  assert.equal(tokens(1_000_000), '1M');
  assert.equal(money(4.2), '$4.20 est');
  assert.equal(money(4.2, true), '$4.20+ est');
  assert.equal(money(null), 'no index yet');
  assert.equal(shortTarget('src/queue/timer.ts'), 'timer.ts');
  assert.equal(shortTarget('npm test -- queue'), 'npm test -- queue');
  assert.equal(titleShape('fix flaky queue'), '3 words, 15 ch');
});

/** Slot 2 has live craft at t = 60 and slot 7 has none. Both become rubble, the way the kernel would publish them. */
const beltFixture = async (): Promise<{ fleet: FleetState; history: HistoryDigest[]; rubble: string; empty: string; before: ReturnType<typeof buildModel> }> => {
  const f = await fixture();
  const { state, history } = f.at(60);
  const bySlot = (slot: number) => Object.values(state.worlds).find((w) => w.slot === slot)!;
  const [rubble, empty] = [bySlot(2), bySlot(7)];
  const belted = { ...state.worlds, [rubble.worldId]: { ...rubble, kind: 'belt' as const, slot: 0 }, [empty.worldId]: { ...empty, kind: 'belt' as const, slot: 0 } };
  return { fleet: { ...state, worlds: belted }, history, rubble: rubble.worldId, empty: empty.worldId, before: buildModel(input(state, history)) };
};

test('the Belt: no planet, no slot, one group in the Manifest, and every craft still counted', async () => {
  const { fleet, history, rubble, empty, before } = await beltFixture();
  const m = buildModel(input(fleet, history));
  assert.ok(!m.allWorlds.some((w) => w.belt), 'nothing in the Belt reaches the scene or the Plate');
  assert.deepEqual(m.beltWorlds.map((w) => w.worldId).sort(), [rubble, empty].sort());
  const group = m.worlds.at(-1)!;
  assert.equal(group.worldId, BELT_GROUP);
  assert.equal(group.name, 'Belt');
  assert.equal(group.rows.length, before.worlds.find((w) => w.worldId === rubble)?.rows.length);
  assert.equal(m.worlds.filter((w) => w.belt).length, 1, 'one group, however many sandboxes');
  assert.equal(m.craftCount, before.craftCount);
  assert.equal(m.worlds.reduce((n, w) => n + w.rows.length, 0), before.worlds.reduce((n, w) => n + w.rows.length, 0));
  assert.equal(m.walk.length, before.walk.length, 'J and K still reach a craft out there');
});

test('the Belt with nothing live has no row, and the rail stays quiet', async () => {
  const { fleet, history, empty } = await beltFixture();
  const worlds = Object.fromEntries(Object.entries(fleet.worlds).map(([id, w]) => [id, id === empty ? w : { ...w, kind: 'repo' as const, slot: w.slot || 2 }]));
  const m = buildModel(input({ ...fleet, worlds }, history));
  assert.equal(m.beltWorlds.length, 1);
  assert.equal(m.worlds.some((w) => w.belt), false);
});

test('the Veil: a renamed world and a sandbox show a star, and the group shows only the word Belt', async () => {
  const { fleet, history, rubble } = await beltFixture();
  const secret = 'Secret-Name-9';
  const named = Object.values(fleet.worlds).find((w) => w.slot === 1)!;
  const veiled: FleetState = { ...fleet, worlds: { ...fleet.worlds, [named.worldId]: { ...named, name: secret, renamed: true }, [rubble]: { ...fleet.worlds[rubble]!, name: secret } } };
  const m = buildModel(input(veiled, history, { veil: true }));
  assert.equal(JSON.stringify(m).includes(secret), false);
  assert.equal(m.worlds.at(-1)?.name, 'Belt');
  assert.equal(buildModel(input(veiled, history)).allWorlds[0]?.renamed, true);
});

test('rubble never takes a star from a repo, and any order gives the same stars', async () => {
  const { fleet } = await beltFixture();
  const worlds = Object.values(fleet.worlds);
  const once = veilNames(worlds, 'salt');
  assert.deepEqual([...veilNames([...worlds].reverse(), 'salt')].sort(), [...once].sort());
  for (const [id, star] of veilNames(worlds.filter((w) => w.kind !== 'belt'), 'salt')) assert.equal(once.get(id), star);
});

test('the Ledger and the Sky count the Belt as one line', () => {
  const rows = [{ worldId: 'a', usd: 1 }, { worldId: 'b', usd: 2 }, { worldId: 'c', usd: 4 }];
  const belt = [{ worldId: 'a' }, { worldId: 'c' }];
  assert.deepEqual(foldBelt(rows, belt, (x, y) => ({ ...x, usd: x.usd + y.usd })), [{ worldId: 'b', usd: 2 }, { worldId: BELT_GROUP, usd: 5 }]);
  assert.deepEqual(foldBelt(rows, [], (x) => x), rows);
});

test('rubble lands as one line in the rail, and never in the morning sentence', async () => {
  const { fleet, history, rubble } = await beltFixture();
  const planet = Object.values(fleet.worlds).find((w) => w.slot === 1)!;
  const now = new Date(2026, 9, 31, 7, 0).getTime();
  const row = history[0]!;
  const landing = (worldId: string, outcome: HistoryDigest['outcome'] = 'clean'): HistoryDigest => ({ ...row, worldId, startedAt: now - 7_200_000, endedAt: now - 1_800_000, outcome, blockedMs: 0 });
  const rows = [landing(rubble), landing(rubble), landing(rubble, 'failed'), landing(planet.worldId)];
  const quiet = { ...fleet, sessions: {}, nodes: {}, workflows: {} };
  const m = buildModel(input(quiet, rows, { now }));
  const belt = m.landed.find((l) => l.worldId === BELT_GROUP);
  assert.equal(belt?.name, 'Belt');
  assert.equal(belt?.line, '2 lit, 1 failed');
  assert.equal(m.almanac[0], `Last night 1 craft landed on ${planet.name}.`);
});
