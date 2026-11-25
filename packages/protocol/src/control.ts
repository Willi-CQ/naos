// The Control plane: agents NAOS spawned through the Agent SDK. States follow docs/research/agent-control.md 5.1,
// approvals follow its section 9, orchestrator limits its section 12.
import type { AgentId, EpochMs, NodeId, RequestId, SessionId, ToolFamily, WorldId } from './observed.ts';
import type { SessionClient } from './source.ts';

/** Marks a managed session in a pid file `name` or a transcript `custom-title`, the fallback match of AC 13. */
export const MANAGED_TITLE_PREFIX = 'naos:';

export type AgentState =
  | 'queued' | 'spawning' | 'ready' | 'running' | 'awaiting_approval' | 'idle' | 'parked' | 'budget_exhausted'
  | 'rate_limited' | 'stopping' | 'exited' | 'crashed' | 'lost' | 'closed';

/** Steps shown while stopping, AC 2.4: `STOPPING, interrupt`, `end of input`, `tree kill`. */
export type StopStep = 'interrupt' | 'end of input' | 'tree kill';

/** A file in agents/*.md, hot reloaded. Claude writes these, the launch grammar names them with `#name`. */
export interface ProfileView {
  name: string;
  description: string;
  model: string;
  effort: string | null;
  permissionMode: 'default' | 'plan' | 'dontAsk' | 'auto';
  defaultBudgetUsd: number;
  worktree: boolean;
  /** Tool allow list for read-only roles, null when the base set applies. */
  tools: string[] | null;
  orchestrator: boolean;
  source: string;
}

/** `result.subagent_stats`, AC 2.3. Row counts, refused shows as fallback ticks. */
export interface SubagentStats {
  spawned: number;
  maxDepth: number;
  completed: number;
  failed: number;
  killed: number;
  refused: { depthLimit: number; concurrencyLimit: number; budget: number };
}

export interface ManagedAgentView {
  client?: SessionClient;
  agentId: AgentId;
  sessionId: SessionId | null;
  /** Equals sessionId once it is known. `pending:${agentId}` before that. */
  nodeId: NodeId;
  worldId: WorldId;
  projectRoot: string;
  cwd: string;
  profile: string;
  title: string;
  model: string;
  effort: string | null;
  permissionMode: string;

  parentAgentId: AgentId | null;
  rootAgentId: AgentId;
  /** Depth in the OS-spawned tree. Root is 0. */
  depth: number;
  /** Set for agents started by an orchestrator or mission. */
  missionId: string | null;
  /** The first craft of an `xN` launch, on every copy and on itself. A launch from the operator has no parent, so copies gather here. */
  copyOf?: NodeId;

  state: AgentState;
  stopStep: StopStep | null;
  /** A counter, not a flag: requests can overlap across subagents (AC 5.1). */
  openApprovals: number;
  /** Failure text shown in the row. Never model output. */
  failure: string | null;

  budgetUsd: number;
  /** Latest total_cost_usd. Never summed, restored on resume (AC 2.3). */
  spentUsd: number;
  treeBudgetUsd: number | null;
  treeSpentUsd: number | null;

  turn: number;
  maxTurns: number | null;
  toolCalls: number;
  toolErrors: number;
  /** Follow-ups held by the kernel until the turn ends. */
  queuedSends: number;
  lastTerminalReason: string | null;
  lastTurnAborted: boolean;
  ttftMs: number | null;
  /** Latest `subagent_stats`, null until a result carried it. */
  subagentStats: SubagentStats | null;

  contextTokens: number | null;
  contextWindow: number | null;
  /** Number of repository instruction files reported by the native provider; null when it is not exposed. */
  instructionFilesLoaded?: number | null;

  worktree: { path: string; name: string; branch: string } | null;
  pid: number | null;

  createdAt: EpochMs;
  startedAt: EpochMs | null;
  endedAt: EpochMs | null;
  /** True after the orphan sweep ran and the transcript still exists. */
  resumable: boolean;
}

export type ApprovalStatus = 'open' | 'answered' | 'withdrawn' | 'expired';

export interface ApprovalView {
  /** Some native protocols cannot edit a pending operation in place. */
  editable?: boolean;
  requestId: RequestId;
  agentId: AgentId;
  nodeId: NodeId;
  worldId: WorldId;
  toolUseID: string;
  toolName: string;
  toolFamily: ToolFamily;
  /** Needed to decide, so it is sent. The Veil hides it. Never logged outside the audit table. */
  input: Record<string, unknown>;
  displayName: string | null;
  description: string | null;
  title: string | null;
  blockedPath: string | null;
  decisionReason: string | null;
  /** `Path is outside allowed working directories` or defaultToNo. Opens on Deny, Approve becomes a hold. */
  danger: boolean;
  defaultToNo: boolean;
  /** suppressAlwaysAllowRule hides "always". */
  canRememberForSession: boolean;
  canRememberForProject: boolean;
  subagentId: string | null;
  subagentType: string | null;
  /** `name` is untrusted text unless `source` is 'sdk'. */
  mcpServer: { name: string; source: string } | null;
  /** 2 of 2 in a serial run of calls within one turn. */
  callIndex: number;
  callCount: number;
  createdAt: EpochMs;
  status: ApprovalStatus;
  /** When it settled, by any route. Withdrawn and expired requests set it too, so the UI can fade them. */
  answeredAt: EpochMs | null;
  /** Client id that answered, so another tab can show ANSWERED ELSEWHERE. */
  answeredBy: string | null;
  outcome: ApprovalDecision['kind'] | null;
}

export type ApprovalDecision =
  | { kind: 'approve'; input?: Record<string, unknown>; edited?: boolean }
  /** Always, this session. Never passes localSettings suggestions through. */
  | { kind: 'session' }
  /** Always in this project. Explicit only, writes .claude/settings.local.json. */
  | { kind: 'project' }
  /** Default text names the one call: "Not approved for this call." A policy-like sentence poisons the session (AC 1.13). */
  | { kind: 'deny'; message?: string }
  /** Deny and interrupt the turn. The message is lost, so guidance goes in the next follow-up. */
  | { kind: 'stop' }
  /** Sends with priority 'now', which cancels the request. */
  | { kind: 'redirect'; text: string }
  /** AskUserQuestion: `updatedInput: { questions, answers }`. */
  | { kind: 'answer'; answers: Record<string, string> };

export interface StandingGrant {
  agentId: AgentId;
  rule: string;
  scope: 'session' | 'project';
  grantedAt: EpochMs;
}

export interface SpawnSpec {
  /** Omitted on legacy Claude launches. Native clients use their official local protocols. */
  client?: SessionClient;
  /** One of the two. `cwd` must exist, its real error misleads (AC 7.7). */
  worldId?: WorldId;
  cwd?: string;
  profile: string;
  prompt: string;
  model?: string;
  effort?: string;
  /** Soft cap per craft. It can overshoot by one API call. */
  budgetUsd?: number;
  copies?: number;
  worktree?: boolean;
  title?: string;
  /** Launch modifiers: Shift+Enter, Alt+Enter. */
  mode?: 'plan-first' | 'read-only';
  /** A mission adds these, with start values from AC 12.3. */
  mission?: { treeBudgetUsd: number; childLimit: number; depth: number };
  /** A retry after an error must not spawn twice. */
  idempotencyKey?: string;
  /** While admission is closed, wait on the Pad instead of being refused. Section 12.3: "can queue on request". */
  queue?: boolean;
}

/** The operator's first launch, DESIGN 12.1. The kernel fills in folder, model, cap and prompt, so the UI sends only this. */
export const FIRST_FLIGHT_PROFILE = 'first-flight';
export const FIRST_FLIGHT_SPEC: SpawnSpec = { profile: FIRST_FLIGHT_PROFILE, prompt: '' };

/** INTERSTELLAR 23: a read-only Haiku that reads one repo and writes its planet. Started with `world.design`, never by name. */
export const WORLD_DESIGNER_PROFILE = 'world-designer';

export interface SpawnReceipt {
  agentIds: AgentId[];
  queued: number;
}

export interface Loadout {
  skills: number;
  mcpServers: number;
  contextTokens: number;
  measuredAt: EpochMs;
}

/** No spawn, no model call. `sources` comes from resolveSettings, spawn-derived numbers only from `loadout`. */
export interface PreflightResult {
  world: { worldId: WorldId | null; name: string; root: string; isGit: boolean; trusted: boolean };
  profile: string;
  model: string;
  budgetUsd: number;
  treeBudgetUsd: number | null;
  sources: string[];
  hooks: string[];
  cwd: { exists: boolean; isGit: boolean; worktreePossible: boolean };
  admission: AdmissionState;
  plan: { fiveHourUsedPercent: number | null; freezeAtPercent: number };
  connectors: 'off' | 'provider';
  /** Trusted repos only. */
  loadout: Loadout | null;
  warnings: string[];
  /** Plain words, null when launch can go ahead. */
  blocked: string | null;
}

export interface AdmissionState {
  running: number;
  runningLimit: number;
  alive: number;
  aliveLimit: number;
  /** Why launches wait. null when open. */
  frozen: 'plan-window' | 'rate-limited' | 'operator' | null;
  queued: AgentId[];
}

export interface OrchestratorLimits {
  depth: number;
  childrenPerAgent: number;
  livePerTree: number;
  spawnsPerTreePerMinute: number;
}

/** AC 12.3 start values. Enforced in the handler, prompts only suggest. */
export const DEFAULT_LIMITS: OrchestratorLimits & { runningGlobal: number; aliveGlobal: number; admissionStopPercent: number } = {
  depth: 2,
  childrenPerAgent: 4,
  livePerTree: 8,
  spawnsPerTreePerMinute: 10,
  runningGlobal: 6,
  aliveGlobal: 16,
  admissionStopPercent: 80,
};
