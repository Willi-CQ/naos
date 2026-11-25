// What the Observer may open under ~/.claude, and how a path maps to a session. Anything that does not match is never read.
import path from 'node:path';
import type { AgentId, SessionId, WorkflowRunId } from '@naos/protocol';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AGENT_FILE = /^agent-(.+?)\.(jsonl|meta\.json)$/;
const RUN = /^wf_[^/\\]+$/;

export const isSessionId = (name: string): boolean => UUID.test(name);

export type ProjectPath =
  | { kind: 'main'; slug: string; sid: SessionId }
  | { kind: 'agent' | 'meta'; slug: string; sid: SessionId; agentId: AgentId; runId: WorkflowRunId | null }
  | { kind: 'journal' | 'state'; slug: string; sid: SessionId; runId: WorkflowRunId };

/** Classifies a path relative to `projects/`. Set-aside transcripts, tool results and memory come back null. */
export function classifyProjectPath(rel: string): ProjectPath | null {
  const p = rel.split(/[\\/]/);
  const [slug, second, third, fourth, fifth, sixth] = p;
  if (!slug || !second) return null;

  if (p.length === 2) {
    const sid = second.endsWith('.jsonl') ? second.slice(0, -6) : '';
    return isSessionId(sid) ? { kind: 'main', slug, sid } : null;
  }
  if (!isSessionId(second)) return null;
  const sid = second;

  if (p.length === 4 && third === 'workflows' && fourth?.endsWith('.json')) {
    const runId = fourth.slice(0, -5);
    return RUN.test(runId) ? { kind: 'state', slug, sid, runId } : null;
  }
  if (third !== 'subagents') return null;
  if (p.length === 4 && fourth) {
    const m = AGENT_FILE.exec(fourth);
    return m?.[1] ? { kind: m[2] === 'jsonl' ? 'agent' : 'meta', slug, sid, agentId: m[1], runId: null } : null;
  }
  if (p.length === 6 && fourth === 'workflows' && fifth && RUN.test(fifth) && sixth) {
    if (sixth === 'journal.jsonl') return { kind: 'journal', slug, sid, runId: fifth };
    const m = AGENT_FILE.exec(sixth);
    return m?.[1] ? { kind: m[2] === 'jsonl' ? 'agent' : 'meta', slug, sid, agentId: m[1], runId: fifth } : null;
  }
  return null;
}

/** Pid file rule from RF 2.1: `<digits>.json` only, so `*.key` and `*.key.tmp*` can never reach an open. */
export const isPidFileName = (name: string): boolean => {
  if (!/^\d+\.json$/.test(name)) return false;
  const stem = name.slice(0, -5);
  return String(Number.parseInt(stem, 10)) === stem;
};

/** Forward slashes and a lowercase drive letter, because slugs exist as both `C--` and `c--` (RF 3.3). */
export function normalizePath(p: string): string {
  let s = p.replace(/\\/g, '/');
  if (/^[A-Za-z]:/.test(s)) s = s.charAt(0).toLowerCase() + s.slice(1);
  if (s.length > 3 && s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

/** `CLAUDE_CONFIG_DIR` moves `.claude.json` with it. The default lives beside `~/.claude`, not in it (RF 1). */
export const configJsonPath = (claudeHome: string): string =>
  path.basename(claudeHome) === '.claude'
    ? path.join(path.dirname(claudeHome), '.claude.json')
    : path.join(claudeHome, '.claude.json');

/** `<slug>/<sid>` to the folders the session owns, for building agent and journal paths. */
export const sessionDir = (projectsDir: string, slug: string, sid: SessionId): string => path.join(projectsDir, slug, sid);

export const runDir = (dir: string, runId: WorkflowRunId): string => path.join(dir, 'subagents', 'workflows', runId);

/** Local calendar day, the Ledger's TODAY. */
export function dayKey(at: number): string {
  const d = new Date(at);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${d.getFullYear()}-${m < 10 ? '0' : ''}${m}-${day < 10 ? '0' : ''}${day}`;
}
