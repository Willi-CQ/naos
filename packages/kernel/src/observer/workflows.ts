// One workflow run: its journal, final state file and liveness (RF 4.4). `result` and the state file's `script`, `args` and
// previews hold private content, so only structure is copied out of them. The state file overrides the journal once it exists.
import type {
  AgentId, CostEstimate, NodeId, ObservedWorkflow, ObservedWorkflowPhase, SessionId, ToolUseId, WorkflowRunId, WorkflowStatus,
} from '@naos/protocol';
import { makeNodeId } from '@naos/protocol';
import type { Raw } from './parse.ts';
import { arr, num, obj, str, timeOf } from './parse.ts';
import { zeroCost } from './prices.ts';

export type AgentRunState = 'running' | 'completed' | 'failed' | 'stopped';

export interface RunAgent {
  agentId: AgentId;
  key: string;
  label: string | null;
  phase: string | null;
  attempt: number;
  state: AgentRunState;
}

export interface FinalState {
  status: WorkflowStatus;
  startedAt: number | null;
  endedAt: number | null;
  durationMs: number | null;
  totalTokens: number | null;
  totalToolCalls: number | null;
  taskId: string | null;
  name: string | null;
  cached: number;
  /** agentId to its final state, from `workflowProgress`. */
  agents: Map<AgentId, { state: AgentRunState; attempt: number | null }>;
  phaseTitles: string[];
}

const STATUS: Readonly<Record<string, WorkflowStatus>> = {
  running: 'running', completed: 'completed', failed: 'failed', killed: 'killed',
};

export function parseFinalState(raw: Raw): FinalState {
  const agents = new Map<AgentId, { state: AgentRunState; attempt: number | null }>();
  const phaseTitles: string[] = [];
  let cached = 0;
  for (const item of arr(raw.workflowProgress)) {
    const p = obj(item);
    if (!p) continue;
    if (p.type === 'workflow_phase') {
      const title = str(p.title);
      if (title) phaseTitles.push(title);
      continue;
    }
    if (p.cached === true) cached += 1;
    const agentId = str(p.agentId);
    if (!agentId) continue;
    const state = str(p.state);
    agents.set(agentId, {
      state: state === 'done' ? 'completed' : state === 'error' ? 'failed' : 'stopped',
      attempt: num(p.attempt),
    });
  }
  for (const item of arr(raw.phases)) {
    const title = str(obj(item)?.title);
    if (title && !phaseTitles.includes(title)) phaseTitles.push(title);
  }
  const status = STATUS[str(raw.status) ?? ''] ?? 'failed';
  const startedAt = timeOf(raw.startTime);
  const endedAt = timeOf(raw.timestamp);
  return {
    status,
    startedAt,
    endedAt,
    durationMs: num(raw.durationMs),
    totalTokens: num(raw.totalTokens),
    totalToolCalls: num(raw.totalToolCalls),
    taskId: str(raw.taskId),
    name: str(raw.workflowName),
    cached,
    agents,
    phaseTitles,
  };
}

export class WorkflowRun {
  readonly runId: WorkflowRunId;
  readonly journalPath: string;
  readonly transcriptDir: string;
  sessionId: SessionId;
  parentNodeId: NodeId;
  parentToolUseId: ToolUseId | null = null;
  taskId: string | null = null;
  name: string | null = null;
  scriptPath: string | null = null;
  statePath: string | null = null;

  launched = false;
  startedAt: number | null = null;
  final: FinalState | null = null;
  readonly agents = new Map<AgentId, RunAgent>();
  private readonly phaseOrder: string[] = [];
  private readonly keyCounts = new Map<string, number>();
  private readonly failedKeys = new Set<string>();

  constructor(opts: { runId: WorkflowRunId; sessionId: SessionId; parentNodeId: NodeId; journalPath: string; transcriptDir: string }) {
    this.runId = opts.runId;
    this.sessionId = opts.sessionId;
    this.parentNodeId = opts.parentNodeId;
    this.journalPath = opts.journalPath;
    this.transcriptDir = opts.transcriptDir;
  }

  /** Returns what changed for an agent, so the caller can publish `agent.started` and `agent.ended`. */
  journal(r: Raw): { started?: RunAgent; ended?: RunAgent } | null {
    switch (r.type) {
      case 'launched':
        this.launched = true;
        return null;
      case 'started': {
        const agentId = str(r.agentId);
        const key = str(r.key) ?? '';
        if (!agentId) return null;
        const existing = this.agents.get(agentId);
        if (existing) return null;
        const attempt = (this.keyCounts.get(key) ?? 0) + 1;
        this.keyCounts.set(key, attempt);
        const phase = str(r.phase);
        if (phase !== null && !this.phaseOrder.includes(phase)) this.phaseOrder.push(phase);
        const agent: RunAgent = { agentId, key, label: str(r.label), phase, attempt, state: 'running' };
        this.agents.set(agentId, agent);
        return { started: agent };
      }
      case 'result':
      case 'failed': {
        const agentId = str(r.agentId);
        const key = str(r.key);
        let agent = agentId ? this.agents.get(agentId) : undefined;
        // `failed` can carry an empty agentId (RF 4.4). Then the key says who.
        if (!agent && key) {
          for (const candidate of this.agents.values()) if (candidate.key === key && candidate.state === 'running') agent = candidate;
        }
        if (r.type === 'failed' && key) this.failedKeys.add(key);
        if (!agent || agent.state !== 'running') return null;
        agent.state = r.type === 'result' ? 'completed' : 'failed';
        return { ended: agent };
      }
      default:
        return null;
    }
  }

  /** Open agents of a finished run end here, from `workflowProgress` when it names them. */
  applyFinal(final: FinalState, statePath: string): RunAgent[] {
    this.final = final;
    this.statePath = statePath;
    this.taskId = final.taskId ?? this.taskId;
    this.name = final.name ?? this.name;
    this.startedAt = final.startedAt ?? this.startedAt;
    for (const title of final.phaseTitles) if (!this.phaseOrder.includes(title)) this.phaseOrder.push(title);
    const ended: RunAgent[] = [];
    for (const agent of this.agents.values()) {
      if (agent.state !== 'running') continue;
      const known = final.agents.get(agent.agentId);
      agent.state = known?.state ?? (final.status === 'failed' ? 'failed' : 'stopped');
      ended.push(agent);
    }
    return ended;
  }

  status(ownerAlive: boolean): WorkflowStatus {
    if (this.final) return this.final.status;
    return ownerAlive ? 'running' : 'orphaned';
  }

  view(ownerAlive: boolean, cost: CostEstimate = zeroCost(), tokens: number | null = null, toolCalls: number | null = null): ObservedWorkflow {
    const started = this.agents.size;
    let completed = 0;
    let failed = 0;
    let open = 0;
    for (const a of this.agents.values()) {
      if (a.state === 'completed') completed += 1;
      else if (a.state === 'failed') failed += 1;
      else if (a.state === 'running') open += 1;
    }
    let retried = 0;
    for (const n of this.keyCounts.values()) if (n > 1) retried += 1;

    const phases: ObservedWorkflowPhase[] = this.phaseOrder.map((title, index) => {
      const members = [...this.agents.values()].filter((a) => a.phase === title);
      return {
        index,
        title,
        agentNodeIds: members.map((a) => makeNodeId(this.sessionId, a.agentId)),
        running: members.filter((a) => a.state === 'running').length,
        completed: members.filter((a) => a.state === 'completed').length,
        failed: members.filter((a) => a.state === 'failed').length,
      };
    });

    const final = this.final;
    return {
      runId: this.runId,
      sessionId: this.sessionId,
      parentNodeId: this.parentNodeId,
      parentToolUseId: this.parentToolUseId,
      taskId: this.taskId,
      name: this.name,
      status: this.status(ownerAlive),
      statusSource: final ? 'state-file' : 'journal+liveness',
      journalPath: this.journalPath,
      statePath: this.statePath,
      scriptPath: this.scriptPath,
      transcriptDir: this.transcriptDir,
      phases,
      counts: { started, completed, failed, open, retried, cached: final ? final.cached : null },
      startedAt: this.startedAt,
      endedAt: final?.endedAt ?? null,
      durationMs: final?.durationMs ?? null,
      totalTokens: final?.totalTokens ?? tokens,
      totalToolCalls: final?.totalToolCalls ?? toolCalls,
      cost,
    };
  }
}
