// The scheduling is real, the raise is a stub. No test here or anywhere may raise a real notification.
import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import type { ApprovalView, ObservedSession } from '@naos/protocol';
import { createBus } from '../../src/bus.ts';
import { underTest } from '../../src/config.ts';
import type { Logger } from '../../src/context.ts';
import { createNotifier } from '../../src/notify/notifier.ts';
import type { Notifier } from '../../src/notify/notifier.ts';
import { toastXml } from '../../src/notify/toast.ts';
import type { Toast } from '../../src/notify/toast.ts';

const silent: Logger = { info() {}, warn() {}, error() {} };
const info = { version: 't', protocol: 1, pid: 1, startedAt: 0, mode: 'live' as const, veilSalt: 's', controlPlane: true };

const approval = (requestId = 'r1', over: Partial<ApprovalView> = {}): ApprovalView => ({
  requestId, agentId: 'a1', nodeId: 's2', worldId: 'w1', toolUseID: 'tu', toolName: 'Bash', toolFamily: 'shell', input: { command: 'SECRET COMMAND' }, displayName: null,
  description: 'SECRET DESCRIPTION', title: null, blockedPath: null, decisionReason: null, danger: false, defaultToNo: false, canRememberForSession: true,
  canRememberForProject: true, subagentId: null, subagentType: null, mcpServer: null, callIndex: 1, callCount: 1, createdAt: 0, status: 'open', answeredAt: null, answeredBy: null,
  outcome: null, ...over,
});

function setup(options: { enabled?: boolean; connected?: (id: string) => boolean; switched?: boolean } = {}) {
  const bus = createBus({ kernel: info, log: silent });
  const session = (sessionId: string, startedAt: number): ObservedSession => ({
    sessionId, origin: 'control', worldId: 'w1', rootNodeId: sessionId, startedAt, activity: { state: 'starting', since: 0 }, workflowRunIds: [],
  } as unknown as ObservedSession);
  bus.publish({
    type: 'world.upserted',
    world: {
      worldId: 'w1', projectRoot: '/w', name: 'kestrel', slot: 1, kind: 'repo', isGit: true, trusted: false, massBytes: 0, massUsd30d: null, spendTodayUsd: null, lightsTotal: 0,
      lightsFailed: 0, lastActiveAt: null, worktrees: [],
    },
  });
  for (const [id, at] of [['s1', 1], ['s2', 2]] as const) {
    bus.publish({ type: 'session.discovered', session: session(id, at), sessionId: id, nodeId: id });
  }
  const raised: Toast[] = [];
  const saved: boolean[] = [];
  const notifier: Notifier = createNotifier({
    bus, log: silent, enabled: options.enabled ?? true, raise: (toast) => raised.push(toast), link: (id) => `link:${id}`,
    connected: options.connected ?? (() => true), load: () => options.switched ?? true, save: (on) => saved.push(on),
  });
  return { bus, raised, saved, notifier };
}

const MIN = 60_000;

describe('notifier', () => {
  test('the test runner is detected', () => {
    assert.equal(underTest(), true);
    assert.equal(underTest({}), false);
  });

  test('it raises at once, then at 2 and 10 minutes, at most 3 per decision', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const { bus, raised, notifier } = setup();
      bus.publish({ type: 'approval.requested', approval: approval() });
      mock.timers.tick(0);
      assert.equal(raised.length, 1);
      mock.timers.tick(2 * MIN - 1);
      assert.equal(raised.length, 1);
      mock.timers.tick(1);
      assert.equal(raised.length, 2);
      mock.timers.tick(8 * MIN);
      assert.equal(raised.length, 3);
      mock.timers.tick(120 * MIN);
      assert.equal(raised.length, 3);
      notifier.stop();
    } finally {
      mock.timers.reset();
    }
  });

  test('the text holds world, letter and tool, and no message text', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const { bus, raised, notifier } = setup();
      bus.publish({ type: 'approval.requested', approval: approval('toolu_01abc') });
      mock.timers.tick(0);
      assert.equal(raised[0]?.text, 'kestrel β needs approval: Bash');
      assert.equal(raised[0]?.url, 'link:toolu_01abc');
      assert.ok(!JSON.stringify(raised).includes('SECRET'));
      notifier.stop();
    } finally {
      mock.timers.reset();
    }
  });

  test('a toast carries no name while any client holds the Veil', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const { bus, raised, notifier } = setup();
      notifier.report('tab', { visible: false, focused: false, notifications: true, veiled: true });
      bus.publish({ type: 'approval.requested', approval: approval() });
      mock.timers.tick(0);
      assert.equal(raised[0]?.text, 'A craft needs approval: Bash');
      notifier.report('tab', { visible: false, focused: false, notifications: true, veiled: false });
      bus.publish({ type: 'approval.requested', approval: approval('r2') });
      mock.timers.tick(0);
      assert.match(raised[1]?.text ?? '', /^kestrel /);
    } finally {
      mock.timers.reset();
    }
  });

  test('a client visible and focused holds it back, a hidden one does not', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const { bus, raised, notifier } = setup();
      notifier.report('tab', { visible: true, focused: true, notifications: true });
      bus.publish({ type: 'approval.requested', approval: approval() });
      mock.timers.tick(0);
      assert.equal(raised.length, 0);
      notifier.report('tab', { visible: true, focused: false, notifications: true });
      mock.timers.tick(2 * MIN);
      assert.equal(raised.length, 1, 'the next slot finds nobody looking');
      notifier.stop();
    } finally {
      mock.timers.reset();
    }
  });

  test('a client that closes stops counting as looking', () => {
    const { notifier } = setup();
    notifier.report('tab', { visible: true, focused: true, notifications: true });
    assert.equal(notifier.watched(), true);
    notifier.drop('tab');
    assert.equal(notifier.watched(), false);
    notifier.stop();
  });

  test('a report with no socket behind it goes stale', () => {
    let clock = 0;
    const bus = createBus({ kernel: info, log: silent });
    const notifier = createNotifier({
      bus, log: silent, enabled: true, raise() {}, link: () => '', connected: () => false, load: () => true, save() {}, now: () => clock,
    });
    notifier.report('ghost', { visible: true, focused: true, notifications: true });
    assert.equal(notifier.watched(), true);
    clock = 61_000;
    assert.equal(notifier.watched(), false);
    notifier.stop();
  });

  for (const ending of ['answered', 'cancelled', 'expired'] as const) {
    test(`an approval ${ending} stops the repeats`, () => {
      mock.timers.enable({ apis: ['setTimeout'] });
      try {
        const { bus, raised, notifier } = setup();
        bus.publish({ type: 'approval.requested', approval: approval() });
        mock.timers.tick(0);
        if (ending === 'answered') bus.publish({ type: 'approval.answered', requestId: 'r1', agentId: 'a1', outcome: 'approve', by: 'tab' });
        if (ending === 'cancelled') bus.publish({ type: 'approval.cancelled', requestId: 'r1', agentId: 'a1', reason: 'x' });
        if (ending === 'expired') bus.publish({ type: 'approval.expired', requestId: 'r1' });
        mock.timers.tick(60 * MIN);
        assert.equal(raised.length, 1);
        notifier.stop();
      } finally {
        mock.timers.reset();
      }
    });
  }

  test('disabled, as in fixture mode, it never raises, and the Settings switch is honoured and saved', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const off = setup({ enabled: false });
      off.bus.publish({ type: 'approval.requested', approval: approval() });
      mock.timers.tick(60 * MIN);
      assert.equal(off.raised.length, 0);
      off.notifier.stop();

      const on = setup();
      on.notifier.report('tab', { visible: false, focused: false, notifications: false });
      assert.deepEqual(on.saved, [false]);
      on.bus.publish({ type: 'approval.requested', approval: approval() });
      mock.timers.tick(60 * MIN);
      assert.equal(on.raised.length, 0);
      on.notifier.stop();

      const remembered = setup({ switched: false });
      remembered.bus.publish({ type: 'approval.requested', approval: approval() });
      mock.timers.tick(60 * MIN);
      assert.equal(remembered.raised.length, 0);
      remembered.notifier.stop();
    } finally {
      mock.timers.reset();
    }
  });

  test('the XML opens the docket by protocol activation and escapes what it carries', () => {
    const xml = toastXml({ text: 'a<b>&"c\'', url: 'http://127.0.0.1:4317/#docket=r&1' });
    assert.match(xml, /activationType="protocol"/);
    assert.match(xml, /launch="http:\/\/127\.0\.0\.1:4317\/#docket=r&amp;1"/);
    assert.ok(xml.includes('a&lt;b&gt;&amp;&quot;c&apos;'));
  });
});
