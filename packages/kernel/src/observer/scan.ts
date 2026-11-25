// Stat walks over `projects/`. Costs from RF 5.4: shallow 3 ms, full async 120 ms. Nothing here opens a file.
import type { Dirent } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { AgentId, SessionId, WorkflowRunId } from '@naos/protocol';
import { classifyProjectPath, isSessionId } from './paths.ts';

export interface MainFile { path: string; slug: string; size: number; mtimeMs: number; birthMs: number }

export interface SessionFiles {
  sid: SessionId;
  main: MainFile | null;
  slugs: Set<string>;
  /** Every `<slug>/<sid>` folder. A session can span slugs (RF 0). */
  dirs: Map<string, string>;
}

export interface AgentFile {
  sid: SessionId;
  agentId: AgentId;
  runId: WorkflowRunId | null;
  path: string;
  metaPath: string | null;
  size: number;
  mtimeMs: number;
  birthMs: number;
}

export interface RunFiles {
  sid: SessionId;
  runId: WorkflowRunId;
  dir: string;
  journalPath: string | null;
  statePath: string | null;
  scriptPath: string | null;
}

export interface TreeFiles { agents: AgentFile[]; runs: RunFiles[] }

const readDir = async (dir: string): Promise<Dirent[]> => {
  try {
    return await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};

/** `projects/*` and the entries one level below, so `<sid>.jsonl` and `<sid>/` come in one pass. */
export async function shallowWalk(projectsDir: string): Promise<Map<SessionId, SessionFiles>> {
  const out = new Map<SessionId, SessionFiles>();
  const of = (sid: SessionId): SessionFiles => {
    let f = out.get(sid);
    if (!f) out.set(sid, (f = { sid, main: null, slugs: new Set(), dirs: new Map() }));
    return f;
  };
  for (const slug of await readDir(projectsDir)) {
    if (!slug.isDirectory()) continue;
    const slugDir = path.join(projectsDir, slug.name);
    for (const entry of await readDir(slugDir)) {
      if (entry.isDirectory()) {
        if (isSessionId(entry.name)) {
          const f = of(entry.name);
          f.slugs.add(slug.name);
          f.dirs.set(slug.name, path.join(slugDir, entry.name));
        }
        continue;
      }
      const c = entry.isFile() ? classifyProjectPath(`${slug.name}/${entry.name}`) : null;
      if (c?.kind !== 'main') continue;
      const file = path.join(slugDir, entry.name);
      const st = await fsp.stat(file).catch(() => null);
      if (!st) continue;
      const f = of(c.sid);
      f.slugs.add(slug.name);
      // The same id in two slugs: the larger file is the conversation, the other a stub.
      if (!f.main || st.size > f.main.size) {
        f.main = { path: file, slug: slug.name, size: st.size, mtimeMs: st.mtimeMs, birthMs: st.birthtimeMs };
      }
    }
  }
  return out;
}

async function collectAgents(dir: string, sid: SessionId, runId: WorkflowRunId | null, out: AgentFile[]): Promise<void> {
  const entries = await readDir(dir);
  const names = new Set(entries.map((e) => e.name));
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith('agent-') || !entry.name.endsWith('.jsonl')) continue;
    const agentId = entry.name.slice('agent-'.length, -'.jsonl'.length);
    const file = path.join(dir, entry.name);
    const st = await fsp.stat(file).catch(() => null);
    if (!st) continue;
    const meta = `agent-${agentId}.meta.json`;
    out.push({
      sid, agentId, runId, path: file, metaPath: names.has(meta) ? path.join(dir, meta) : null,
      size: st.size, mtimeMs: st.mtimeMs, birthMs: st.birthtimeMs,
    });
  }
}

/** Agent files, journals and state files of one session, across all its slugs. */
export async function walkSessionTree(files: SessionFiles): Promise<TreeFiles> {
  const agents: AgentFile[] = [];
  const runs = new Map<WorkflowRunId, RunFiles>();
  for (const dir of files.dirs.values()) {
    const subagents = path.join(dir, 'subagents');
    await collectAgents(subagents, files.sid, null, agents);
    const workflows = path.join(subagents, 'workflows');
    for (const run of await readDir(workflows)) {
      if (!run.isDirectory()) continue;
      const runDir = path.join(workflows, run.name);
      await collectAgents(runDir, files.sid, run.name, agents);
      const journal = path.join(runDir, 'journal.jsonl');
      const has = await fsp.stat(journal).catch(() => null);
      const entry = runs.get(run.name) ?? { sid: files.sid, runId: run.name, dir: runDir, journalPath: null, statePath: null, scriptPath: null };
      if (has) entry.journalPath = journal;
      runs.set(run.name, entry);
    }
    const stateDir = path.join(dir, 'workflows');
    for (const f of await readDir(stateDir)) {
      if (!f.isFile() || !f.name.endsWith('.json')) continue;
      const runId = f.name.slice(0, -'.json'.length);
      const entry = runs.get(runId) ?? { sid: files.sid, runId, dir: path.join(dir, 'subagents', 'workflows', runId), journalPath: null, statePath: null, scriptPath: null };
      entry.statePath = path.join(stateDir, f.name);
      runs.set(runId, entry);
    }
  }
  return { agents, runs: [...runs.values()] };
}
