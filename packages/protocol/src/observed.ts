// Normalized view of every Claude session on the machine. Types come from docs/research/runtime-formats.md section 9,
// plus the additions in docs/DESIGN.md Appendix A. No type here carries message text. Text fetches are explicit calls.

import type { SessionSource } from './source.ts';

export type EpochMs = number;
export type SessionId = string;      // UUID
export type AgentId = string;        // Opaque. Workflow agents: 17 hex today. Managed agents: kernel-assigned
export type WorkflowRunId = string;  // Opaque, "wf_xxxxxxxx-xxx" today
export type ToolUseId = string;
export type NodeId = string;         // sessionId, or `${sessionId}/${agentId}`
export type WorldId = string;        // Stable hash of the normalized project root
export type RequestId = string;
export type SalvoId = string;

export const makeNodeId = (sessionId: SessionId, agentId?: AgentId): NodeId =>
  agentId ? `${sessionId}/${agentId}` : sessionId;

export type Liveness = 'alive' | 'dead' | 'recycled' | 'foreign' | 'unknown';
export type SessionKind = 'interactive' | 'bg' | 'daemon' | 'daemon-worker' | 'unknown';
export type PidStatus = 'busy' | 'shell' | 'idle' | 'waiting';
export type WaitReason =
  | 'permission prompt' | 'input needed' | 'sandbox request'
  | 'worker request' | 'dialog open' | 'unknown';

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  webSearchRequests: number;
  messages: number;
  /** Messages whose final record has stop_reason null, so output is a lower bound. */
  partialOutputMessages: number;
}

export interface CostEstimate {
  /** max(estimateUsd, costStateUsd ?? 0) */
  usd: number;
  estimateUsd: number;
  /** Highest non-zero cost-state value, null while the session has none. */
  costStateUsd: number | null;
  isEstimate: boolean;
  isLowerBound: boolean;
  unpricedModels: string[];
}

export interface ActiveTool {
  toolUseId: ToolUseId;
  name: string;
  family: ToolFamily;
  startedAt: EpochMs;
}

export type Activity =
  | { state: 'starting'; since: EpochMs }
  /** A model call is in flight. Thinking and text cannot be told apart on disk. */
  | { state: 'generating'; since: EpochMs; lastBlock?: 'thinking' | 'text' | 'tool_use' }
  | { state: 'tool_running'; since: EpochMs; tools: ActiveTool[] }
  | { state: 'waiting'; since: EpochMs; reason: WaitReason }
  | { state: 'retrying'; since: EpochMs; attempt: number; maxRetries: number; nextAttemptAt?: EpochMs }
  /** Only for sessions the OS owns. On disk, compaction is known after it ended. */
  | { state: 'compacting'; since: EpochMs }
  | { state: 'idle'; since: EpochMs; backgroundShell: boolean }
  | { state: 'interrupted'; since: EpochMs }
  | { state: 'errored'; since: EpochMs; kind: 'rate_limit' | 'api' | 'unknown'; httpStatus?: number; resetsAt?: EpochMs }
  | { state: 'finished'; since: EpochMs; outcome: 'clean' | 'abandoned' | 'unknown' }
  | { state: 'unknown'; since: EpochMs };

export interface ObservedSession {
  sessionId: SessionId;
  /** Absent on older Claude snapshots. Client identity is independent of the model it runs. */
  source?: SessionSource;
  /** 'observer' for sessions NAOS only reads, 'control' for those it spawned. */
  origin: 'observer' | 'control';
  worldId: WorldId;

  title: string | null;
  titleSource: 'custom' | 'ai' | 'lastPrompt' | 'summary' | 'firstPrompt' | null;
  displayName: string | null;

  /** Normalized main repo root, or start cwd outside git. The grouping key for projects. */
  projectRoot: string | null;
  startCwd: string | null;
  currentCwd: string | null;
  worktree: { path: string; name?: string; branch?: string } | null;
  gitBranch: string | null;

  /** All slugs holding this session. There can be several. */
  slugs: string[];
  transcriptPath: string | null;
  transcriptBytes: number;

  pid: number | null;
  liveness: Liveness;
  kind: SessionKind;
  entrypoint: string | null;
  version: string | null;
  pidStatus: PidStatus | null;
  remoteControlled: boolean;
  /** True when a broker session could reach it. */
  acceptsPeerMessages: boolean | null;

  activity: Activity;
  queuedInputs: number;

  model: string | null;
  requestedModel: string | null;
  effort: string | null;
  permissionMode: string | null;

  startedAt: EpochMs | null;
  lastRecordAt: EpochMs | null;
  lastWriteAt: EpochMs | null;
  endedAt: EpochMs | null;

  /** Main thread only. */
  usage: TokenUsage;
  /** Whole tree including all agents. */
  usageTree: TokenUsage;
  cost: CostEstimate;
  contextTokens: number | null;
  contextWindow: number | null;
  /** Some clients expose a fraction without revealing the absolute context size. */
  contextUsageFraction?: number | null;

  /**
   * Time spent blocked on a human, closed waits only. Exact while live, '~' estimate for history. Appendix A. The reducer
   * adds to it when `activity` leaves `waiting`, so a client adds `now - activity.since` for an open wait.
   */
  blockedMs: number;

  rootNodeId: NodeId;
  /** Agents under this session, main node excluded. The reducer recounts these from `nodes`. */
  agentCount: number;
  runningAgentCount: number;
  workflowRunIds: WorkflowRunId[];
  lastRateLimit: { type: string; status: string; resetsAt: EpochMs | null } | null;
}

export type AgentNodeKind = 'main' | 'subagent' | 'workflow-agent' | 'teammate';
export type AgentStatus =
  | 'running' | 'completed' | 'failed' | 'stopped' | 'orphaned' | 'unknown';

export interface ObservedAgentNode {
  nodeId: NodeId;
  sessionId: SessionId;
  kind: AgentNodeKind;
  /** null for the main node. */
  agentId: AgentId | null;

  /** null only for the main node. */
  parentNodeId: NodeId | null;
  childNodeIds: NodeId[];
  /** How the parent was found. 'inferred' means no join key resolved. */
  linkedBy: 'root' | 'parentAgentId' | 'toolUseId' | 'workflowRun' | 'inferred';
  parentToolUseId: ToolUseId | null;
  spawnDepth: number;

  agentType: string | null;
  name: string | null;
  /** From meta.json. Written by the model, so treat it as private text. */
  description: string | null;
  model: string | null;
  effort: string | null;
  cwd: string | null;
  worktreePath: string | null;
  worktreeBranch: string | null;
  background: boolean | null;

  workflow: {
    runId: WorkflowRunId;
    key: string;
    label: string | null;
    phase: string | null;
    attempt: number;
  } | null;

  transcriptPath: string | null;
  metaPath: string | null;
  transcriptBytes: number;

  status: AgentStatus;
  activity: Activity;
  /** Age of the newest record when it reached disk. Agents can lag by a whole response. */
  flushLagMs: number | null;

  startedAt: EpochMs | null;
  lastRecordAt: EpochMs | null;
  endedAt: EpochMs | null;

  usage: TokenUsage;
  cost: CostEstimate;
  toolCalls: number;
  errors: number;
  /** Tender label: `last_tool_name` from task frames, or the newest `tool.started`. */
  lastToolName: string | null;
}

export type WorkflowStatus = 'running' | 'completed' | 'failed' | 'killed' | 'orphaned';

export interface ObservedWorkflowPhase {
  index: number;
  title: string;
  agentNodeIds: NodeId[];
  running: number;
  completed: number;
  failed: number;
}

export interface ObservedWorkflow {
  runId: WorkflowRunId;
  sessionId: SessionId;
  parentNodeId: NodeId;
  parentToolUseId: ToolUseId | null;
  taskId: string | null;
  name: string | null;

  status: WorkflowStatus;
  statusSource: 'state-file' | 'journal+liveness';

  journalPath: string;
  statePath: string | null;
  scriptPath: string | null;
  transcriptDir: string;

  phases: ObservedWorkflowPhase[];
  /** `cached` is null until the final state file, the only place it exists. */
  counts: { started: number; completed: number; failed: number; open: number; retried: number; cached: number | null };

  startedAt: EpochMs | null;
  endedAt: EpochMs | null;
  durationMs: number | null;
  /** From the state file when finished, otherwise summed from agent tails. */
  totalTokens: number | null;
  totalToolCalls: number | null;
  cost: CostEstimate;
}

/** DESIGN 2.4. Open set: anything unknown falls to 'other'. */
export type ToolFamily = 'shell' | 'read' | 'edit' | 'web' | 'mcp' | 'launch' | 'send' | 'ask' | 'other';

/**
 * Structure of one tool call for the Channel. `target` is a path relative to the working directory, a search pattern
 * or the first command line, cut to 160 chars. It is sensitive, so the Veil replaces it with `shape`.
 */
export interface ToolSummary {
  target: string | null;
  /** Always safe to show: `Bash, 1 line, 31 chars`. */
  shape: string;
  plus?: number;
  minus?: number;
}

interface EventBase {
  /** Stable: `${path}:${byteOffset}` for transcript events, so replays deduplicate. */
  id: string;
  /** The record's timestamp, or observedAt if it has none. */
  at: EpochMs;
  /** When the kernel saw it. observedAt - at shows the flush lag. */
  observedAt: EpochMs;
  sessionId: SessionId;
  nodeId: NodeId;
}

/** Why a call was refused. Open strings: `toolDenialKind` and `permissionDecision.source` on disk, deny rules on frames. */
export interface ToolDenial {
  kind: string | null;
  source: string | null;
}

export type TurnOrigin = 'human' | 'task_notification' | 'peer' | 'sdk' | 'scheduled' | 'unknown' | (string & {});

export type ObservedEvent = EventBase & (
  | { type: 'session.discovered'; session: ObservedSession }
  /**
   * A patch whose `sessionId` differs from the event's is `/clear` or `/resume`: same pid, same hull, new conversation. The
   * reducer re-keys the session and its nodes under the new id and clears `contextTokens` unless the patch sets it.
   */
  | { type: 'session.changed'; patch: Partial<ObservedSession> }
  | { type: 'session.ended'; outcome: 'clean' | 'abandoned' | 'unknown'; reason: 'exit' | 'pid-recycled' }
  /**
   * The only way `activity` moves, besides `session.ended` and `agent.ended`. Tool, retry and turn events never change it,
   * because a late transcript record must not overrule a live pid status. Planes publish every transition, full tool list included.
   */
  | { type: 'activity.changed'; activity: Activity }
  | { type: 'agent.started'; node: ObservedAgentNode }
  | { type: 'agent.changed'; patch: Partial<ObservedAgentNode> }
  | { type: 'agent.ended'; status: AgentStatus }
  | { type: 'turn.started'; origin: TurnOrigin }
  | { type: 'turn.ended'; stopReason: string }
  | { type: 'request.started'; model: string; querySource: string | null }
  | { type: 'message.completed'; messageId: string; model: string; blocks: Array<'thinking' | 'text' | 'tool_use'>;
      /** Parallel to blocks: chars of text or tool input, tokens for thinking. Sealed bars need true length. */
      blockSizes: number[]; usage: TokenUsage }
  | { type: 'tool.started'; toolUseId: ToolUseId; name: string; toolFamily: ToolFamily; summary: ToolSummary }
  | { type: 'tool.finished'; toolUseId: ToolUseId; name: string; toolFamily: ToolFamily; isError: boolean;
      decision: 'accept' | 'reject' | null; denial: ToolDenial | null; durationMs: number | null }
  /** Refused before it ran, so no `tool.started` came and the beam never fires: `system/permission_denied`, a `PreToolUse` deny. */
  | { type: 'tool.denied'; toolUseId: ToolUseId | null; name: string; toolFamily: ToolFamily; denial: ToolDenial }
  | { type: 'usage.changed'; usage: TokenUsage; cost: CostEstimate }
  | { type: 'workflow.changed'; workflow: ObservedWorkflow }
  | { type: 'compacted'; trigger: 'manual' | 'auto' | 'unknown'; preTokens: number; postTokens: number; durationMs: number }
  | { type: 'api.retry'; attempt: number; maxRetries: number; retryInMs: number }
  | { type: 'api.error'; httpStatus: number | null; kind: string | null }
  | { type: 'rate_limit.hit'; limit: string; resetsAt: EpochMs | null }
  | { type: 'tail.reset'; path: string; reason: 'shrunk' | 'replaced' | 'relocated' }
);
