// The one shape both sides hold. The kernel reduces every event into it to answer snapshots, and the UI store runs the
// same reducer, so a snapshot and a replay of events can never disagree.
import type { AdmissionState, ApprovalView, ManagedAgentView, ProfileView, StandingGrant } from './control.ts';
import { DEFAULT_LIMITS } from './control.ts';
import type { SessionClient } from './source.ts';
import type { IndexProgress, KernelInfo, PlanState, Salvo, SensorState, TapeEntry, World } from './fleet.ts';
import type {
  AgentId, EpochMs, NodeId, ObservedAgentNode, ObservedSession, ObservedWorkflow, RequestId, SalvoId, SessionId,
  WorkflowRunId, WorldId,
} from './observed.ts';

/** Oldest entries fall off. Reconnects resync from a snapshot, never by replaying a backlog (DESIGN 7.10). */
export const TAPE_LIMIT = 256;
/** Closed salvos kept for the burned spokes of the last day. Older ones live in the history. */
export const SALVO_LIMIT = 256;
/** Answered, withdrawn and expired requests kept for their end state. Open requests are never dropped. */
export const SETTLED_APPROVAL_LIMIT = 32;

export interface FleetState {
  /** Sequence number of the last event reduced in. */
  seq: number;
  kernel: KernelInfo | null;
  lastTickAt: EpochMs | null;
  worlds: Record<WorldId, World>;
  sessions: Record<SessionId, ObservedSession>;
  nodes: Record<NodeId, ObservedAgentNode>;
  workflows: Record<WorkflowRunId, ObservedWorkflow>;
  managed: Record<AgentId, ManagedAgentView>;
  /** Open and recently settled requests. The newest SETTLED_APPROVAL_LIMIT settled ones stay, and the UI fades them by age. */
  approvals: Record<RequestId, ApprovalView>;
  standing: Record<AgentId, StandingGrant[]>;
  profiles: ProfileView[];
  plan: PlanState | null;
  clientPlans?: Partial<Record<SessionClient, PlanState>>;
  admission: AdmissionState;
  salvos: Record<SalvoId, Salvo>;
  index: IndexProgress;
  sensor: SensorState;
  /** Node ids with a fault acknowledged, so the FAULT lamp can go dark. */
  acked: Record<NodeId, EpochMs>;
  /** Oldest first. */
  tape: TapeEntry[];
}

export const emptyState = (): FleetState => ({
  seq: 0,
  kernel: null,
  lastTickAt: null,
  worlds: {},
  sessions: {},
  nodes: {},
  workflows: {},
  managed: {},
  approvals: {},
  standing: {},
  profiles: [],
  plan: null,
  admission: {
    running: 0,
    runningLimit: DEFAULT_LIMITS.runningGlobal,
    alive: 0,
    aliveLimit: DEFAULT_LIMITS.aliveGlobal,
    frozen: null,
    queued: [],
  },
  salvos: {},
  index: { stage: 'stat', done: 0, total: 0 },
  sensor: { unknownRecords: 0, unknownFields: 0, tailResets: 0, parseErrors: 0 },
  acked: {},
  tape: [],
});
