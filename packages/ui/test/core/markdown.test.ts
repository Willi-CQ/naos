import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, inlineMarkdown } from '../../src/core/markdown.ts';

test('renders common response structure without interpreting HTML', () => {
  const blocks = parseMarkdown('# Summary\n\nA **clear** answer with `inline code`.\n\n- first\n- second\n\n> Important\n\n---');
  assert.deepEqual(blocks.map((block) => block.kind), ['heading', 'paragraph', 'list', 'quote', 'rule']);
  assert.deepEqual(blocks[1], { kind: 'paragraph', parts: [
    { kind: 'text', text: 'A ' }, { kind: 'strong', text: 'clear' }, { kind: 'text', text: ' answer with ' }, { kind: 'code', text: 'inline code' }, { kind: 'text', text: '.' },
  ] });
  assert.deepEqual(blocks[2], { kind: 'list', ordered: false, items: [[{ kind: 'text', text: 'first' }], [{ kind: 'text', text: 'second' }]] });
});

test('keeps fenced code intact and limits links to http protocols', () => {
  const blocks = parseMarkdown('```ts\nconst answer = 42;\n```\n\n[docs](https://example.com) [unsafe](javascript:alert(1))');
  assert.deepEqual(blocks[0], { kind: 'code', language: 'ts', text: 'const answer = 42;' });
  assert.deepEqual(inlineMarkdown('[docs](https://example.com) [unsafe](javascript:alert(1))'), [
    { kind: 'link', text: 'docs', href: 'https://example.com' }, { kind: 'text', text: ' ' }, { kind: 'text', text: 'unsafe' },
  ]);
});

test('renders simple Markdown tables as structured rows', () => {
  assert.deepEqual(parseMarkdown('| File | State |\n| --- | :---: |\n| app.ts | ready |'), [{
    kind: 'table', header: [[{ kind: 'text', text: 'File' }], [{ kind: 'text', text: 'State' }]],
    rows: [[[{ kind: 'text', text: 'app.ts' }], [{ kind: 'text', text: 'ready' }]]],
  }]);
});
