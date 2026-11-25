import type { CraftVM } from '../store/model.ts';

/** Preserve every observed descendant, including ended nodes, missing parents and cycles. */
export function agentTree(crafts: CraftVM[]): Array<{ craft: CraftVM; depth: number; parent: string | null }> {
  const all = new Map(crafts.map((c) => [c.id, c])), parents = new Map<string, string>();
  for (const c of crafts) if (c.parentId && all.has(c.parentId) && c.parentId !== c.id) parents.set(c.id, c.parentId);
  for (const c of crafts) for (const id of c.childIds) if (all.has(id) && id !== c.id && !parents.has(id)) parents.set(id, c.id);
  const children = new Map<string, CraftVM[]>();
  for (const c of crafts) { const p = parents.get(c.id); if (p) children.set(p, [...children.get(p) ?? [], c]); }
  const result: Array<{ craft: CraftVM; depth: number; parent: string | null }> = [], seen = new Set<string>();
  const walk = (root: CraftVM) => {
    const pending = [{ craft: root, depth: 0, parent: null as string | null }];
    while (pending.length) { const row = pending.pop()!; if (seen.has(row.craft.id)) continue; seen.add(row.craft.id); result.push(row); const kids = children.get(row.craft.id) ?? []; for (let i = kids.length - 1; i >= 0; i--) pending.push({ craft: kids[i]!, depth: row.depth + 1, parent: row.craft.id }); }
  };
  crafts.filter((c) => !parents.has(c.id)).forEach(walk);
  crafts.filter((c) => !seen.has(c.id)).forEach(walk);
  return result;
}
