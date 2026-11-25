import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentTree } from '../../src/core/agentTree.ts';
import type { CraftVM } from '../../src/store/model.ts';

const craft = (id: string, parentId: string | null = null, childIds: string[] = []): CraftVM => ({ id, parentId, childIds } as CraftVM);
test('hierarchy preserves arbitrarily deep descendants and ended or filtered agents', () => {
  const nodes = Array.from({ length: 90 }, (_, i) => craft(`${i}`, i ? `${i - 1}` : null));
  const tree = agentTree(nodes.reverse());
  assert.equal(tree.length, 90); assert.equal(tree.at(-1)?.depth, 89); assert.equal(tree[0]?.craft.id, '0');
});
test('missing parents, child-only references and cycles retain every node exactly once', () => {
  const nodes = [craft('a', 'b'), craft('b', 'a'), craft('orphan', 'missing'), craft('root', null, ['child']), craft('child'), craft('self', 'self')];
  const tree = agentTree(nodes);
  assert.equal(tree.length, 6); assert.equal(new Set(tree.map((r) => r.craft.id)).size, 6);
  assert.equal(tree.find((r) => r.craft.id === 'child')?.parent, 'root');
  assert.equal(tree.find((r) => r.craft.id === 'orphan')?.depth, 0);
});
