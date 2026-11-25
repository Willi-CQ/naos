import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  craftKindOf, craftLength, HULL_LENGTH, HULLS, hullClassOf, KIND_COUNT, kindIndex, markLength, MARK_LENGTH, ROLES, roleOf, sizeOf,
} from '../../src/scene/craft/kind.ts';

test('model class sets the hull, in every spelling the disk has shown', () => {
  const rows: Array<[string | null | undefined, string]> = [
    ['claude-haiku-5-5', 'scout'], ['claude-haiku-4-5-20251001', 'scout'], ['claude-sonnet-5-5', 'cruiser'], ['claude-sonnet-5', 'cruiser'],
    ['claude-opus-5-5', 'capital'], ['claude-opus-5', 'capital'], ['opus[1m]', 'capital'], ['us.anthropic.claude-opus-5-5', 'capital'],
    ['claude-fable-5-5', 'longrange'], ['claude-fable-5-1', 'longrange'], ['CLAUDE-SONNET-5-5', 'cruiser'],
    ['<synthetic>', 'default'], ['gpt-9', 'default'], ['', 'default'], [null, 'default'], [undefined, 'default'],
  ];
  for (const [model, hull] of rows) assert.equal(hullClassOf(model), hull, String(model));
});

test('agent type sets the mission', () => {
  const rows: Array<[Parameters<typeof roleOf>[0], string]> = [
    [{ agentType: 'Explore', node: 'subagent' }, 'probe'],
    [{ agentType: 'Plan', node: 'subagent' }, 'survey'],
    [{ agentType: 'general-purpose', node: 'subagent' }, 'tug'],
    [{ agentType: 'code-reviewer', node: 'subagent' }, 'survey'],
    [{ profile: 'recon', node: 'main' }, 'probe'],
    [{ profile: 'plan', node: 'main' }, 'survey'],
    [{ profile: 'analyst', node: 'main' }, 'survey'],
    [{ profile: 'build', node: 'main' }, 'tug'],
    [{ profile: 'long', node: 'main' }, 'tug'],
    [{ profile: 'orchestrator', node: 'main' }, 'command'],
    [{ profile: 'scratch', node: 'main' }, 'plain'],
    [{ profile: 'world-designer', node: 'main' }, 'survey'],
  ];
  for (const [facts, role] of rows) assert.equal(roleOf(facts), role, JSON.stringify(facts));
});

test('a workflow agent is a drone whatever it was typed', () => {
  assert.equal(roleOf({ agentType: 'general-purpose', node: 'workflow-agent' }), 'drone');
  assert.equal(roleOf({ agentType: 'workflow-subagent', node: 'subagent' }), 'drone');
  assert.equal(roleOf({ agentType: 'Explore', node: 'workflow-agent' }), 'drone');
});

test('a main thread with no name is the general builder, and only an unknown name is plain', () => {
  assert.equal(roleOf({ node: 'main' }), 'tug');
  assert.equal(roleOf({}), 'tug');
  assert.equal(roleOf({ agentType: 'statusline-setup', node: 'subagent' }), 'plain');
  assert.equal(roleOf({ node: 'subagent' }), 'plain');
  assert.equal(roleOf({ profile: 'something-new', node: 'main' }), 'plain');
});

test('a profile outranks a type name, because the kernel chose it', () => {
  assert.equal(roleOf({ profile: 'orchestrator', agentType: 'Explore', node: 'main' }), 'command');
});

test('tenders and beads stay small', () => {
  assert.equal(sizeOf('main'), 'vessel');
  assert.equal(sizeOf('subagent'), 'tender');
  assert.equal(sizeOf('teammate'), 'tender');
  assert.equal(sizeOf('workflow-agent'), 'bead');
  assert.equal(sizeOf('something-new'), 'vessel');
  assert.equal(sizeOf(null), 'vessel');
  for (const hull of HULLS) {
    assert.ok(craftLength({ hull, size: 'bead' }, 1) < craftLength({ hull, size: 'tender' }, 1));
    assert.ok(craftLength({ hull, size: 'tender' }, 1) < craftLength({ hull, size: 'vessel' }, 1));
  }
});

test('craftKindOf puts it together', () => {
  assert.deepEqual(craftKindOf({ model: 'claude-haiku-5-5', agentType: 'Explore', node: 'subagent' }), { hull: 'scout', role: 'probe', size: 'tender' });
  assert.deepEqual(craftKindOf({ model: 'claude-opus-5-5', profile: 'orchestrator', node: 'main' }), { hull: 'capital', role: 'command', size: 'vessel' });
  assert.deepEqual(craftKindOf({ model: 'claude-fable-5-5', node: 'main' }), { hull: 'longrange', role: 'tug', size: 'vessel' });
  assert.deepEqual(craftKindOf({ model: null }), { hull: 'default', role: 'tug', size: 'vessel' });
});

test('every pair has a distinct index', () => {
  const seen = new Set<number>();
  for (const h of HULLS) for (const r of ROLES) seen.add(kindIndex(h, r));
  assert.equal(seen.size, KIND_COUNT);
  assert.deepEqual([...seen].sort((a, b) => a - b), Array.from({ length: KIND_COUNT }, (_, i) => i));
});

test('no vessel mark is under 15 CSS px, and class order holds in both tables', () => {
  for (const hull of HULLS) assert.ok(markLength({ hull, size: 'vessel' }) >= 15, hull);
  assert.ok(MARK_LENGTH.scout < MARK_LENGTH.cruiser && MARK_LENGTH.cruiser < MARK_LENGTH.capital);
  assert.ok(HULL_LENGTH.scout < HULL_LENGTH.cruiser && HULL_LENGTH.cruiser < HULL_LENGTH.capital);
  assert.ok(markLength({ hull: 'capital', size: 'tender' }) < markLength({ hull: 'scout', size: 'vessel' }));
});
