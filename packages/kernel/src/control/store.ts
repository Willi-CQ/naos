// Control's tables in naos.db. Ids, state and structure, never conversations: the transcript is the conversation (AC 11).
import type { AgentId, ApprovalView, EpochMs, Loadout, ManagedAgentView } from '@naos/protocol';
import type { Db } from '../context.ts';
import type { Profile } from './types.ts';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS managed_sessions (
  agentId TEXT PRIMARY KEY,
  sessionId TEXT NOT NULL,
  pid INTEGER,
  procStart TEXT,
  cwd TEXT NOT NULL,
  worktree TEXT,
  parentAgentId TEXT,
  startedAt INTEGER,
  endedAt INTEGER,
  state TEXT NOT NULL,
  view TEXT NOT NULL,
  launch TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS managed_sessions_session ON managed_sessions(sessionId);
CREATE TABLE IF NOT EXISTS control_trees (
  rootAgentId TEXT PRIMARY KEY,
  budgetUsd REAL,
  depth INTEGER NOT NULL,
  childLimit INTEGER NOT NULL,
  missionId TEXT,
  external INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS control_tool_trees (
  pid INTEGER NOT NULL,
  created TEXT NOT NULL,
  agentId TEXT NOT NULL,
  name TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (pid, created)
);
CREATE TABLE IF NOT EXISTS control_audit (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  agentId TEXT NOT NULL,
  event TEXT NOT NULL,
  toolName TEXT,
  toolUseId TEXT,
  requestId TEXT,
  subagentId TEXT,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS control_audit_agent ON control_audit(agentId, seq);
CREATE TABLE IF NOT EXISTS control_approvals (
  requestId TEXT PRIMARY KEY,
  agentId TEXT NOT NULL,
  status TEXT NOT NULL,
  view TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  answeredAt INTEGER,
  answeredBy TEXT,
  outcome TEXT
);
CREATE INDEX IF NOT EXISTS control_approvals_status ON control_approvals(status);
CREATE TABLE IF NOT EXISTS control_loadouts (
  root TEXT PRIMARY KEY,
  skills INTEGER NOT NULL,
  mcpServers INTEGER NOT NULL,
  contextTokens INTEGER NOT NULL,
  measuredAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS control_idempotency (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  agentId TEXT NOT NULL,
  PRIMARY KEY (scope, key)
);
`;

/** What a resume needs and the view does not carry. The profile is frozen at spawn, so a later edit cannot widen a running tree. */
export interface Launch {
  profile: Profile;
  tools: string[] | null;
  repoRoot: string;
  isGit: boolean;
  /** Spawned through the shim, so limits are the external ones (AC 12.1). */
  external: boolean;
  firstFlight: boolean;
  /** Reads a real repo and writes its planet. Always untrusted, no worktree. */
  worldDesigner: boolean;
}

export interface TreeRow {
  rootAgentId: AgentId;
  budgetUsd: number | null;
  depth: number;
  childLimit: number;
  missionId: string | null;
  external: number;
}

export interface ToolTreeRow { pid: number; created: string; agentId: AgentId; name: string; at: EpochMs }

export interface StoredAgent { view: ManagedAgentView; launch: Launch; pid: number | null; procStart: string | null }

export interface AuditRow {
  seq: number;
  at: EpochMs;
  agentId: AgentId;
  event: string;
  toolName: string | null;
  toolUseId: string | null;
  requestId: string | null;
  subagentId: string | null;
  detail: string | null;
}

export class Store {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
    db.exec(SCHEMA);
  }

  /** Written before query(), so a crash in the very first frame still leaves a row to reconcile (AC 13). */
  saveAgent(view: ManagedAgentView, launch: Launch, procStart: string | null): void {
    this.#db.run(
      `INSERT INTO managed_sessions (agentId, sessionId, pid, procStart, cwd, worktree, parentAgentId, startedAt, endedAt, state, view, launch)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(agentId) DO UPDATE SET sessionId = excluded.sessionId, pid = excluded.pid, procStart = excluded.procStart,
         cwd = excluded.cwd, worktree = excluded.worktree, parentAgentId = excluded.parentAgentId, startedAt = excluded.startedAt,
         endedAt = excluded.endedAt, state = excluded.state, view = excluded.view, launch = excluded.launch`,
      view.agentId, view.sessionId ?? '', view.pid, procStart, view.cwd, view.worktree?.path ?? null, view.parentAgentId,
      view.startedAt, view.endedAt, view.state, JSON.stringify(view), JSON.stringify(launch),
    );
  }

  agents(): StoredAgent[] {
    const rows = this.#db.all<{ view: string; launch: string; pid: number | null; procStart: string | null }>(
      'SELECT view, launch, pid, procStart FROM managed_sessions',
    );
    return rows.map((r) => {
      const launch = JSON.parse(r.launch) as Launch;
      return {
        view: JSON.parse(r.view) as ManagedAgentView,
        launch: { ...launch, firstFlight: launch.firstFlight === true, worldDesigner: launch.worldDesigner === true },
        pid: r.pid, procStart: r.procStart,
      };
    });
  }

  saveTree(t: TreeRow): void {
    this.#db.run(
      `INSERT INTO control_trees (rootAgentId, budgetUsd, depth, childLimit, missionId, external) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(rootAgentId) DO UPDATE SET budgetUsd = excluded.budgetUsd`,
      t.rootAgentId, t.budgetUsd, t.depth, t.childLimit, t.missionId, t.external,
    );
  }

  trees(): TreeRow[] {
    return this.#db.all<TreeRow>('SELECT rootAgentId, budgetUsd, depth, childLimit, missionId, external FROM control_trees');
  }

  saveToolTree(row: ToolTreeRow): void {
    this.#db.run(
      'INSERT OR IGNORE INTO control_tool_trees (pid, created, agentId, name, at) VALUES (?, ?, ?, ?, ?)',
      row.pid, row.created, row.agentId, row.name, row.at,
    );
  }

  toolTrees(agentId?: AgentId): ToolTreeRow[] {
    return agentId === undefined
      ? this.#db.all<ToolTreeRow>('SELECT pid, created, agentId, name, at FROM control_tool_trees')
      : this.#db.all<ToolTreeRow>('SELECT pid, created, agentId, name, at FROM control_tool_trees WHERE agentId = ?', agentId);
  }

  clearToolTrees(agentId?: AgentId): void {
    if (agentId === undefined) this.#db.run('DELETE FROM control_tool_trees');
    else this.#db.run('DELETE FROM control_tool_trees WHERE agentId = ?', agentId);
  }

  audit(row: Omit<AuditRow, 'seq'>): void {
    this.#db.run(
      'INSERT INTO control_audit (at, agentId, event, toolName, toolUseId, requestId, subagentId, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      row.at, row.agentId, row.event, row.toolName, row.toolUseId, row.requestId, row.subagentId, row.detail,
    );
  }

  auditRows(agentId: AgentId): AuditRow[] {
    return this.#db.all<AuditRow>('SELECT * FROM control_audit WHERE agentId = ? ORDER BY seq', agentId);
  }

  /** `input` stays in the audit table, the only place it may be logged. */
  saveApproval(view: ApprovalView): void {
    const { input: _input, ...rest } = view;
    this.#db.run(
      `INSERT INTO control_approvals (requestId, agentId, status, view, createdAt, answeredAt, answeredBy, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(requestId) DO UPDATE SET status = excluded.status, answeredAt = excluded.answeredAt, answeredBy = excluded.answeredBy, outcome = excluded.outcome`,
      view.requestId, view.agentId, view.status, JSON.stringify(rest), view.createdAt, view.answeredAt, view.answeredBy, view.outcome,
    );
  }

  openApprovals(): ApprovalView[] {
    return this.#db
      .all<{ view: string }>("SELECT view FROM control_approvals WHERE status = 'open'")
      .map((r) => ({ input: {}, ...(JSON.parse(r.view) as Omit<ApprovalView, 'input'>) }));
  }

  saveLoadout(root: string, loadout: Loadout): void {
    this.#db.run(
      `INSERT INTO control_loadouts (root, skills, mcpServers, contextTokens, measuredAt) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(root) DO UPDATE SET skills = excluded.skills, mcpServers = excluded.mcpServers,
         contextTokens = excluded.contextTokens, measuredAt = excluded.measuredAt`,
      root, loadout.skills, loadout.mcpServers, loadout.contextTokens, loadout.measuredAt,
    );
  }

  loadout(root: string): Loadout | null {
    return this.#db.get<Loadout>('SELECT skills, mcpServers, contextTokens, measuredAt FROM control_loadouts WHERE root = ?', root) ?? null;
  }

  idempotent(scope: string, key: string): AgentId | null {
    return this.#db.get<{ agentId: AgentId }>('SELECT agentId FROM control_idempotency WHERE scope = ? AND key = ?', scope, key)?.agentId ?? null;
  }

  saveIdempotent(scope: string, key: string, agentId: AgentId): void {
    this.#db.run('INSERT OR REPLACE INTO control_idempotency (scope, key, agentId) VALUES (?, ?, ?)', scope, key, agentId);
  }
}
