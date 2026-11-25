// `.meta.json` of an agent, and the context window catalog. `cache/model-catalog` files also carry account ids, so only model
// ids and limits are taken from them.
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { AgentId, ToolUseId } from '@naos/protocol';
import type { Raw } from './parse.ts';
import { arr, num, obj, str } from './parse.ts';
import { baseModel } from './prices.ts';

export interface AgentMeta {
  agentType: string | null;
  description: string | null;
  toolUseId: ToolUseId | null;
  parentAgentId: AgentId | null;
  spawnDepth: number | null;
  name: string | null;
  model: string | null;
  effort: string | null;
  cwd: string | null;
  worktreePath: string | null;
  worktreeBranch: string | null;
  finished: boolean;
  stoppedByUser: boolean;
}

export function parseMeta(r: Raw): AgentMeta {
  return {
    agentType: str(r.customAgentType) ?? str(r.agentType),
    description: str(r.description),
    toolUseId: str(r.toolUseId),
    parentAgentId: str(r.parentAgentId),
    spawnDepth: num(r.spawnDepth),
    name: str(r.name),
    model: str(r.model),
    effort: str(r.effort),
    cwd: str(r.cwd),
    worktreePath: str(r.worktreePath) ?? str(r.inheritedWorktreePath),
    worktreeBranch: str(r.worktreeBranch),
    finished: Boolean(r.finished),
    stoppedByUser: Boolean(r.stoppedByUser),
  };
}

export async function readMeta(file: string): Promise<AgentMeta | null> {
  try {
    const raw: unknown = JSON.parse(await fsp.readFile(file, 'utf8'));
    const r = obj(raw);
    return r ? parseMeta(r) : null;
  } catch {
    return null;
  }
}

export type ContextCatalog = ReadonlyMap<string, number>;

/** Newest file wins per model. Absent or odd files leave the map short, and a craft then shows `context unknown`. */
export async function readCatalog(claudeHome: string): Promise<Map<string, number>> {
  const dir = path.join(claudeHome, 'cache', 'model-catalog');
  const out = new Map<string, number>();
  let names: string[];
  try {
    names = (await fsp.readdir(dir)).filter((n) => n.endsWith('.json'));
  } catch {
    return out;
  }
  const dated = await Promise.all(names.map(async (name) => {
    const file = path.join(dir, name);
    const st = await fsp.stat(file).catch(() => null);
    return { file, mtimeMs: st?.mtimeMs ?? 0 };
  }));
  dated.sort((a, b) => a.mtimeMs - b.mtimeMs);
  for (const { file } of dated) {
    try {
      const raw = JSON.parse(await fsp.readFile(file, 'utf8')) as Raw;
      for (const item of arr(obj(obj(raw.catalog)?.config)?.models)) {
        const m = obj(item);
        const id = str(m?.id);
        const limit = num(obj(m?.runtime)?.max_input_tokens);
        if (id && limit !== null) out.set(baseModel(id), limit);
      }
    } catch {
      // A catalog being rewritten is read again in an hour.
    }
  }
  return out;
}

/** `[1m]` on a requested model states the window outright. */
export function contextWindow(catalog: ContextCatalog, model: string | null, requested: string | null): number | null {
  if (requested?.endsWith('[1m]')) return 1_000_000;
  const id = model ?? requested;
  return id ? catalog.get(baseModel(id)) ?? null : null;
}
