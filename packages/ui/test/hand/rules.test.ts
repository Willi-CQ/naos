import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ApprovalDecision, ApprovalView } from '@naos/protocol';
import { ARM_MS, LONG_ARM_MS, armDelay, focusIn, focusOut, gate, isArmed, neighbour, newRequests, nextAfter, restart, unarmed } from '../../src/hud/docket/arm.ts';
import type { GateInput } from '../../src/hud/docket/arm.ts';
import {
  activeQuestion, allAnswered, answersOf, applyEdit, bodyKind, canAlways, canAlwaysProject, canEdit, canWiden, diffLines, editableOf, escapeUntrusted, isDanger, markdown, mcpParts, pick, previewOf,
  questionsOf, serverTrusted,
} from '../../src/hud/docket/card.ts';
import { createHold } from '../../src/hud/docket/hold.ts';
import type { HoldTimers } from '../../src/hud/docket/hold.ts';

const approval = (over: Partial<ApprovalView> = {}): ApprovalView => ({
  requestId: 'r1', agentId: 'a1', nodeId: 'n1', worldId: 'w1', toolUseID: 't1', toolName: 'Bash', toolFamily: 'shell', input: {}, displayName: null, description: null, title: null, blockedPath: null,
  decisionReason: null, danger: false, defaultToNo: false, canRememberForSession: true, canRememberForProject: true, subagentId: null, subagentType: null, mcpServer: null, callIndex: 1, callCount: 1,
  createdAt: 0, status: 'open', answeredAt: null, answeredBy: null, outcome: null, ...over,
});

const armedAt = (now: number): GateInput['arm'] => focusIn(unarmed(), now - ARM_MS, ARM_MS);
const gateInput = (over: Partial<GateInput> = {}): GateInput => ({ arm: armedAt(1000), now: 1000, status: 'open', linkUp: true, pending: false, danger: false, held: false, ...over });
const APPROVE: ApprovalDecision = { kind: 'approve' };

test('arm: keys work only 350 ms after focus, never one tick before', () => {
  const arm = focusIn(unarmed(), 100, ARM_MS);
  assert.equal(isArmed(arm, 100), false);
  assert.equal(isArmed(arm, 449), false);
  assert.equal(isArmed(arm, 450), true);
  assert.equal(armDelay(false), 350);
  assert.equal(armDelay(true), 1000);
  assert.equal(LONG_ARM_MS, 1000);
});

test('arm: an armed docket that loses focus is not armed, and coming back re-arms from zero', () => {
  let arm = focusIn(unarmed(), 0, ARM_MS);
  assert.equal(isArmed(arm, 500), true);
  arm = focusOut(arm);
  assert.equal(isArmed(arm, 500), false);
  arm = focusIn(arm, 600, ARM_MS);
  assert.equal(isArmed(arm, 900), false);
  assert.equal(isArmed(arm, 950), true);
});

test('arm: moving focus inside the docket does not restart it, a new request does', () => {
  const arm = focusIn(unarmed(), 0, ARM_MS);
  assert.equal(focusIn(arm, 200, ARM_MS), arm);
  const again = restart(arm, 500, ARM_MS);
  assert.equal(isArmed(again, 500), false);
  assert.equal(isArmed(again, 850), true);
  assert.notEqual(again.epoch, arm.epoch);
});

test('arm: a restart with no focus stays unarmed', () => {
  const arm = restart(unarmed(), 500, ARM_MS);
  assert.equal(isArmed(arm, 2000), false);
});

test('gate: every refusal, in order of what is wrong first', () => {
  assert.equal(gate(gateInput(), APPROVE), null);
  assert.equal(gate(gateInput({ status: null }), APPROVE), 'no-card');
  assert.equal(gate(gateInput({ status: 'answered' }), APPROVE), 'settled');
  assert.equal(gate(gateInput({ status: 'withdrawn' }), APPROVE), 'settled');
  assert.equal(gate(gateInput({ status: 'expired' }), APPROVE), 'settled');
  assert.equal(gate(gateInput({ linkUp: false }), APPROVE), 'link-lost');
  assert.equal(gate(gateInput({ arm: unarmed() }), APPROVE), 'unfocused');
  assert.equal(gate(gateInput({ arm: focusIn(unarmed(), 900, ARM_MS) }), APPROVE), 'arming');
  assert.equal(gate(gateInput({ pending: true }), APPROVE), 'pending');
});

test('gate: danger takes a held approve, denies and a redirect, and nothing that would skip the hold', () => {
  const danger = gateInput({ danger: true });
  assert.equal(gate(danger, APPROVE), 'needs-hold');
  assert.equal(gate({ ...danger, held: true }, APPROVE), null);
  assert.equal(gate(danger, { kind: 'deny' }), null);
  assert.equal(gate(danger, { kind: 'stop' }), null);
  assert.equal(gate(danger, { kind: 'redirect', text: 'x' }), null);
  assert.equal(gate(danger, { kind: 'session' }), 'not-in-danger');
  assert.equal(gate(danger, { kind: 'project' }), 'not-in-danger');
  assert.equal(gate({ ...danger, held: true }, { kind: 'approve', input: {}, edited: true }), 'not-in-danger');
  assert.equal(gate(danger, { kind: 'answer', answers: {} }), 'needs-hold');
});

test('queue: only unseen ids are new, and a repeat of known ones is not', () => {
  assert.deepEqual(newRequests(new Set(['a', 'b']), ['a', 'b', 'c']), ['c']);
  assert.deepEqual(newRequests(new Set(['a', 'b']), ['b']), []);
});

test('queue: J and K wrap, and next prefers the card after the current one', () => {
  assert.equal(neighbour(['a', 'b', 'c'], 'b', 1), 'c');
  assert.equal(neighbour(['a', 'b', 'c'], 'c', 1), 'a');
  assert.equal(neighbour(['a', 'b', 'c'], 'a', -1), 'c');
  assert.equal(neighbour(['a', 'b'], 'gone', 1), 'a');
  assert.equal(neighbour([], 'a', 1), null);
  assert.equal(nextAfter(['a', 'b'], 'a'), 'b');
  assert.equal(nextAfter(['a', 'b'], 'b'), 'a');
  assert.equal(nextAfter(['b'], 'a'), 'b');
  assert.equal(nextAfter(['a'], 'a'), null);
  assert.equal(nextAfter([], 'a'), null);
});

test('hold: fires once after its time, and key repeat cannot restart or finish it', () => {
  const pending: Array<{ fn: () => void; ms: number }> = [];
  const timers: HoldTimers = { set: (fn, ms) => { pending.push({ fn, ms }); return pending.length; }, clear: () => { pending.length = 0; } };
  const seen: boolean[] = [];
  let done = 0;
  const hold = createHold(700, () => { done += 1; }, (on) => seen.push(on), timers);
  assert.equal(hold.start(), true);
  assert.equal(hold.start(), false);
  assert.equal(pending.length, 1);
  assert.equal(pending[0]!.ms, 700);
  pending[0]!.fn();
  assert.equal(done, 1);
  assert.deepEqual(seen, [true, false]);
  assert.equal(hold.active, false);
});

test('hold: a release before the time fires nothing', () => {
  let cleared = 0;
  const timers: HoldTimers = { set: () => 1, clear: () => { cleared += 1; } };
  let done = 0;
  const hold = createHold(700, () => { done += 1; }, undefined, timers);
  hold.start();
  hold.cancel();
  hold.cancel();
  assert.equal(cleared, 1);
  assert.equal(done, 0);
  assert.equal(hold.active, false);
});

test('danger: the flag, defaultToNo, or the path reason. S and E are gone there', () => {
  assert.equal(isDanger(approval()), false);
  assert.equal(isDanger(approval({ danger: true })), true);
  assert.equal(isDanger(approval({ defaultToNo: true })), true);
  assert.equal(isDanger(approval({ decisionReason: 'Path is outside allowed working directories' })), true);
  const danger = approval({ danger: true, canRememberForSession: true, canRememberForProject: true });
  assert.equal(canAlways(danger), false);
  assert.equal(canAlwaysProject(danger), false);
  assert.equal(canEdit(danger), false);
});

test('suppressAlwaysAllowRule hides S, and a plan or a question never offers it', () => {
  assert.equal(canAlways(approval()), true);
  assert.equal(canAlways(approval({ canRememberForSession: false })), false);
  assert.equal(canAlways(approval({ toolName: 'ExitPlanMode' })), false);
  assert.equal(canAlways(approval({ toolName: 'AskUserQuestion' })), false);
  assert.equal(canAlwaysProject(approval({ canRememberForProject: false })), false);
});

test('tool kinds and what opens wide', () => {
  const kinds = ['Bash', 'PowerShell', 'Write', 'Edit', 'ExitPlanMode', 'AskUserQuestion', 'mcp__docs__search', 'WebFetch'].map((toolName) => bodyKind({ toolName, mcpServer: null }));
  assert.deepEqual(kinds, ['bash', 'bash', 'write', 'edit', 'plan', 'question', 'mcp', 'other']);
  assert.equal(bodyKind({ toolName: 'odd', mcpServer: { name: 's', source: 'sdk' } }), 'mcp');
  assert.equal(canWiden(approval({ toolName: 'Edit' })), true);
  assert.equal(canWiden(approval({ toolName: 'Bash' })), false);
});

test('mcp: parts, and an untrusted name cannot pose as something else', () => {
  assert.deepEqual(mcpParts('mcp__my_docs__search_all'), { server: 'my_docs', tool: 'search_all' });
  assert.deepEqual(mcpParts('plain'), { server: '', tool: 'plain' });
  const rlo = String.fromCharCode(0x202e);
  const lf = String.fromCharCode(10);
  const slash = String.fromCharCode(92);
  assert.equal(escapeUntrusted(`docs${rlo}gnp.exe${lf}next`), `docs${slash}u202egnp.exe${slash}u000anext`);
  assert.equal(escapeUntrusted('x'.repeat(200)).length, 80);
  assert.equal(serverTrusted({ name: 'n', source: 'sdk' }), true);
  assert.equal(serverTrusted({ name: 'n', source: 'project' }), false);
  assert.equal(serverTrusted(null), false);
});

test('diff: keeps context, shows the changed middle', () => {
  const rows = diffLines('a\nb\nc\nd\ne', 'a\nb\nX\nd\ne');
  assert.deepEqual(rows, [
    { kind: 'same', text: 'a' }, { kind: 'same', text: 'b' }, { kind: 'del', text: 'c' }, { kind: 'add', text: 'X' }, { kind: 'same', text: 'd' }, { kind: 'same', text: 'e' },
  ]);
  assert.deepEqual(diffLines('same', 'same'), [{ kind: 'same', text: 'same' }]);
  assert.deepEqual(diffLines('', 'new'), [{ kind: 'del', text: '' }, { kind: 'add', text: 'new' }]);
});

test('markdown: plain blocks only, so markup in a plan stays text', () => {
  const blocks = markdown('# Plan\n\nFirst <b>line</b>\nsecond\n\n1. one\n- two\n\n```\ncode\n```\n');
  assert.deepEqual(blocks, [
    { kind: 'heading', level: 1, text: 'Plan' }, { kind: 'para', text: 'First <b>line</b> second' }, { kind: 'item', marker: '1.', text: 'one' }, { kind: 'item', marker: '-', text: 'two' },
    { kind: 'code', text: 'code' },
  ]);
});

test('questions: a form fills top to bottom, multi toggles, answers key on the question', () => {
  const input = { questions: [
    { question: 'Q1', header: 'One', options: [{ label: 'a', description: 'x' }, { label: 'b' }] },
    { question: 'Q2', header: 'Two', multiSelect: true, options: ['c', 'd'] },
  ] };
  const qs = questionsOf(input);
  assert.equal(qs.length, 2);
  let picks = {};
  assert.equal(activeQuestion(qs, picks), 0);
  assert.equal(allAnswered(qs, picks), false);
  picks = pick(picks, qs[0]!, 0, 1);
  assert.equal(activeQuestion(qs, picks), 1);
  picks = pick(picks, qs[1]!, 1, 0);
  picks = pick(picks, qs[1]!, 1, 1);
  assert.equal(allAnswered(qs, picks), true);
  assert.deepEqual(answersOf(qs, picks), { Q1: 'b', Q2: 'c, d' });
  picks = pick(picks, qs[1]!, 1, 0);
  assert.deepEqual(answersOf(qs, picks), { Q1: 'b', Q2: 'd' });
  assert.deepEqual(pick(picks, qs[0]!, 0, 3), picks);
});

test('questions: malformed input gives no form and never throws', () => {
  assert.deepEqual(questionsOf({}), []);
  assert.deepEqual(questionsOf({ questions: 'x' }), []);
  assert.deepEqual(questionsOf({ questions: [null, 3] }), []);
  assert.equal(allAnswered([], {}), false);
});

test('edit: the main field of a tool, or the whole JSON, and bad JSON refuses', () => {
  const bash = approval({ input: { command: 'ls', description: 'list' } });
  const edit = editableOf(bash);
  assert.equal(edit.value, 'ls');
  assert.deepEqual(applyEdit(bash, edit, 'pwd'), { command: 'pwd', description: 'list' });
  const other = approval({ toolName: 'WebFetch', input: { url: 'u' } });
  const json = editableOf(other);
  assert.equal(json.field, null);
  assert.deepEqual(applyEdit(other, json, '{"url":"v"}'), { url: 'v' });
  assert.equal(applyEdit(other, json, '{nope'), null);
  assert.equal(applyEdit(other, json, '[1]'), null);
});

test('preview: first lines and a count of the rest', () => {
  assert.deepEqual(previewOf('a\nb\nc', 2), { shown: 'a\nb', more: 1, total: 3 });
  assert.deepEqual(previewOf('a', 2), { shown: 'a', more: 0, total: 1 });
});
