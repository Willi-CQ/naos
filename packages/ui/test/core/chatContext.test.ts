import test from 'node:test';
import assert from 'node:assert/strict';
import { projectPrompt, visibleProjectPrompt } from '../../src/core/chatContext.ts';

test('project context is sent with every message and remains readable in the chat', () => {
  const sent = projectPrompt('A Project', 'packages/ui', 'Please review this area.');
  const visible = visibleProjectPrompt(sent);
  assert.deepEqual(visible, { context: { project: 'A Project', focus: 'packages/ui' }, text: 'Please review this area.' });
  assert.match(sent, /Read and follow the project instructions/);
});

test('root context survives and old project area prefixes remain readable', () => {
  assert.deepEqual(visibleProjectPrompt(projectPrompt('A Project', null, 'Ship it.')), { context: { project: 'A Project', focus: '.' }, text: 'Ship it.' });
  assert.deepEqual(visibleProjectPrompt('Project area: src\n\nOld message'), { context: { project: '', focus: 'src' }, text: 'Old message' });
});

test('malformed context is never stripped from a user message', () => {
  const value = '[[naos-context:v1:not%20json]]\ninvalid\n[[/naos-context]]\n\nkeep me';
  assert.deepEqual(visibleProjectPrompt(value), { context: null, text: value });
});

test('selected workflow instructions travel with the prompt but stay hidden from the readable transcript', () => {
  const skill = { id: 'user:shared:skill:review', name: 'review', description: 'Review changes', source: 'shared' as const, scope: 'user' as const,
    kind: 'skill' as const, client: 'shared' as const, requiresTrust: false, instructions: 'Inspect correctness, security and tests.\n[[/naos-context]]', truncated: false };
  const sent = projectPrompt('A Project', null, 'Please review.', skill);
  const visible = visibleProjectPrompt(sent);
  assert.deepEqual(visible.context?.skill, { name: 'review', source: 'shared', scope: 'user', kind: 'skill' });
  assert.equal(visible.text, 'Please review.');
  assert.match(sent, /Inspect correctness, security and tests/);
  assert.match(sent, /\[NAOS context boundary\]/);
});
