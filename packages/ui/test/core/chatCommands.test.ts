import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chatCommandQuery, literalChatMessage, matchChatChoices } from '../../src/core/chatCommands.ts';

test('configuration commands preserve the message following the command line', () => {
  assert.deepEqual(chatCommandQuery('  /MODEL model/family-v2\nInspect the project.\nKeep this second line.'), {
    name: 'model', argument: 'model/family-v2', hasArgument: true, rest: 'Inspect the project.\nKeep this second line.',
  });
  assert.deepEqual(chatCommandQuery('/'), { name: '', argument: '', hasArgument: false, rest: '' });
  assert.deepEqual(chatCommandQuery('/mode '), { name: 'mode', argument: '', hasArgument: true, rest: '' });
  assert.equal(chatCommandQuery('/unrecognized')?.name, 'unrecognized');
  assert.equal(chatCommandQuery('/__proto__')?.name, '__proto__');
});

test('provider and mode aliases resolve locally, with no prompt hidden in their arguments', () => {
  for (const [text, name, argument] of [['/codex', 'provider', 'codex'], ['/cursor', 'provider', 'cursor'], ['/plan', 'mode', 'plan'], ['/build', 'mode', 'build'], ['/read', 'mode', 'read']]) {
    const query = chatCommandQuery(text!);
    assert.equal(query?.name, name); assert.equal(query?.argument, argument); assert.equal(query?.hasArgument, true);
  }
  assert.equal(chatCommandQuery('/plan\nDo this next')?.rest, 'Do this next');
});

test('ordinary prompts and escaped provider commands retain their exact message semantics', () => {
  for (const text of ['Explain /model selection', 'Review this\n/provider cursor', '//review', '']) assert.equal(chatCommandQuery(text), null);
  assert.equal(literalChatMessage(' //review these changes '), '/review these changes');
  assert.equal(literalChatMessage('A path /src/file.ts'), 'A path /src/file.ts');
  assert.equal(literalChatMessage('line one\nline two'), 'line one\nline two');
});

test('an exact mode or model wins over words appearing in another option’s description', () => {
  const choices = [{ id: 'plan', label: 'Plan first', description: 'Read-only planning' }, { id: 'read', label: 'Read only', description: 'Explore without changes' }];
  assert.deepEqual(matchChatChoices(choices, 'read').map(choice => choice.id), ['read']);
  assert.deepEqual(matchChatChoices(choices, 'read-only').map(choice => choice.id), ['read']);
  assert.deepEqual(matchChatChoices(choices, 'plan first').map(choice => choice.id), ['plan']);
  assert.equal(matchChatChoices(choices, '').length, 2);
  assert.deepEqual(matchChatChoices(choices, 'nonexistent'), []);
});
