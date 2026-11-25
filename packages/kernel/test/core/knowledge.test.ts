import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import type { KnowledgeGraph } from '@naos/protocol';
import { projectKnowledge } from '../../src/knowledge.ts';
import { boot, post, run } from './helpers.ts';

const roots: string[] = [];
function scratch() { const root = mkdtempSync(path.join(os.tmpdir(), 'naos-knowledge-')); roots.push(root); return root; }
function file(root: string, name: string, body = '# A thought') { const target = path.join(root, name); mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, body); }
afterEach(() => { for (const root of roots.splice(0)) { assert.ok(root.startsWith(path.join(os.tmpdir(), 'naos-knowledge-'))); rmSync(root, { recursive: true, force: true }); } });

test('knowledge graph resolves real wiki and Markdown links, ignoring external and ambiguous references', async () => {
  const root = scratch();
  file(root, 'brain/index.md', '# Brain map\n[[Thought]] [[Idea]] [plan](./planning/Plan.md#next) [outside](https://example.com) [[Missing]]\nprivate body');
  file(root, 'brain/Thought.md', '# A thought\n[[index|home]]');
  file(root, 'brain/planning/Plan.md', '# Roadmap');
  file(root, 'brain/one/Idea.md'); file(root, 'brain/two/Idea.md');
  const graph = await projectKnowledge(root);
  assert.equal(graph.nodes.length, 5); assert.equal(graph.complete, true);
  assert.deepEqual(graph.edges.map((e) => [e.from, e.to]).sort(), [['brain/Thought.md', 'brain/index.md'], ['brain/index.md', 'brain/Thought.md'], ['brain/index.md', 'brain/planning/Plan.md']].sort());
  assert.equal(graph.nodes.find((n) => n.id === 'brain/planning/Plan.md')?.title, 'Roadmap');
  assert.ok(!JSON.stringify(graph).includes('private body')); assert.ok(!JSON.stringify(graph).includes(root));
});

test('code examples and malformed brackets do not fabricate document connections', async () => {
  const root = scratch();
  file(root, 'notes/One.md', '# One\n```md\n[[Two]]\n```\n`[[Two]]`\n' + '['.repeat(64000));
  file(root, 'notes/Two.md', '# Two');
  const graph = await projectKnowledge(root);
  assert.equal(graph.nodes.length, 2); assert.equal(graph.edges.length, 0);
});

test('knowledge reads are bounded and omit credentials, other source files and links outside the project', async () => {
  const root = scratch(), outside = scratch();
  file(root, '.brain/Entry.md', '# Entry\n[escape](../../outside.md)');
  file(root, 'notes/First.md'); file(root, 'notes/Large.md', 'x'.repeat(70000));
  file(root, '.secrets/key.md', '# Sensitive'); file(root, 'node_modules/docs/secret.md'); file(root, 'src/internal.md'); file(outside, 'outside.md');
  symlinkSync(outside, path.join(root, 'notes/linked'), 'junction');
  if (process.platform !== 'win32') symlinkSync(path.join(outside, 'outside.md'), path.join(root, 'notes/alias.md'));
  const graph = await projectKnowledge(root);
  assert.deepEqual(graph.nodes.map((n) => n.id).sort(), ['.brain/Entry.md', 'notes/First.md']);
  assert.equal(graph.complete, false); assert.equal(graph.edges.length, 0);
  const bounded = await projectKnowledge(root, { files: 1, entries: 1000, bytes: 100000, ms: 1800 });
  assert.equal(bounded.nodes.length, 1); assert.equal(bounded.complete, false);
});

test('knowledge endpoint resolves only a known world and refuses unauthenticated and MCP readers', async () => {
  const root = scratch(); file(root, 'brain/Idea.md'); let worldId = '';
  const kernel = await boot('live', { planes: [{ name: 'knowledge-test', async start(ctx) { const world = ctx.worlds.ensure(root); worldId = world.worldId; ctx.bus.publish({ type: 'world.upserted', world: { ...world, kind: 'repo', projectRoot: root } }); }, async stop() {} }] });
  try {
    assert.equal((await run<KnowledgeGraph>(kernel, { type: 'world.knowledge', worldId })).nodes.length, 1);
    assert.equal((await post(kernel, { type: 'world.knowledge', worldId: root })).status, 404);
    assert.equal((await post(kernel, { type: 'world.knowledge', worldId: '__proto__' })).status, 404);
    assert.equal((await post(kernel, { type: 'world.knowledge', worldId }, {})).status, 401);
    const result = await kernel.router.dispatch({ type: 'world.knowledge', worldId }, 'mcp');
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, 'forbidden');
  } finally { await kernel.close(); }
});
