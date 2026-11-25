// Fleet-wide entities and events that belong to no single session. See DESIGN Appendix A.
import type { AdmissionState, ApprovalDecision, ApprovalView, ManagedAgentView, ProfileView, StandingGrant } from './control.ts';
import type {
  AgentId, AgentNodeKind, EpochMs, NodeId, ObservedEvent, RequestId, SalvoId, SessionId, WorldId,
} from './observed.ts';
import type { PlanetGenome } from './planet.ts';
import type { SessionClient } from './source.ts';

export type KernelMode = 'live' | 'fixture';

export interface KernelInfo {
  version: string;
  protocol: number;
  pid: number;
  startedAt: EpochMs;
  mode: KernelMode;
  /** Per-install salt for the Veil. World names hash to star names with it. */
  veilSalt: string;
  /** False when the SDK cannot start here, so the UI shows an observer-only build. */
  controlPlane: boolean;
}

/** `belt` is rubble: a sandbox under the temp folder, a root that is gone, or stray sessions with no root. It has no planet. */
export type WorldKind = 'repo' | 'folder' | 'rogue' | 'offworld' | 'belt';

export interface World {
  identity?: import('./appearance.ts').RepoIdentity;
  worldId: WorldId;
  /** null for stray sessions outside any repo. */
  projectRoot: string | null;
  /** The name the user knows, or the one they gave it. The Veil replaces this at the selector layer. */
  name: string;
  /** True when `name` came from `world.rename`. */
  renamed?: boolean;
  /** Persisted in layout.json, and a real repo keeps its slot. 0 in the Belt, which holds no slot. */
  slot: number;
  kind: WorldKind;
  isGit: boolean;
  /** Settings sources are a trust decision (AC 1.2). Unknown repos stay untrusted. */
  trusted: boolean;
  /** Law 1: stands in for mass until the usage index ends. */
  massBytes: number;
  /** Spend over the retained 30 days. null until the usage index ends. */
  massUsd30d: number | null;
  spendTodayUsd: number | null;
  lightsTotal: number;
  lightsFailed: number;
  lastActiveAt: EpochMs | null;
  /** Moons. */
  worktrees: Array<{ path: string; name: string; branch: string | null }>;
  /** The planet its world designer wrote, already validated. Absent until one has run, and until then the UI makes one from the facts. */
  genome?: PlanetGenome;
  /** When that designer finished. A new value is a new planet, worth showing as one. */
  designedAt?: EpochMs;
}

export type PlanStatus = 'allowed' | 'allowed_warning' | 'rejected' | 'unknown';

/** Fractions of the window left, 0 to 1. Both source scales are normalised (AC 6). */
export interface PlanState {
  fiveHourLeft: number | null;
  sevenDayLeft: number | null;
  /** fetchedAtMs. Stale after 10 minutes. */
  asOf: EpochMs | null;
  resetsAt: { fiveHour: EpochMs | null; sevenDay: EpochMs | null };
  status: PlanStatus;
}

export type SalvoSource = 'workflow' | 'subagent' | 'spawn';

/** DESIGN 2.5: 3 launches under one parent within 1 s open it, later ones join for 10 s. Times are on observedAt. */
export interface Salvo {
  salvoId: SalvoId;
  parentNodeId: NodeId;
  sessionId: SessionId;
  worldId: WorldId;
  source: SalvoSource;
  openedAt: EpochMs;
  closedAt: EpochMs | null;
  nodeIds: NodeId[];
}

export type IndexStage = 'stat' | 'head' | 'usage';

export interface IndexProgress {
  stage: IndexStage | 'done';
  done: number;
  total: number;
}

/** SENSOR lamp. Unknown records are counted, never fatal. */
export interface SensorState {
  unknownRecords: number;
  unknownFields: number;
  tailResets: number;
  parseErrors: number;
}

/** One row per transcript or agent. `usd` is null until the usage index reaches it. No text. */
export interface HistoryDigest {
  nodeId: NodeId;
  sessionId: SessionId;
  worldId: WorldId;
  projectRoot: string | null;
  kind: AgentNodeKind;
  parentNodeId: NodeId | null;
  startedAt: EpochMs;
  endedAt: EpochMs | null;
  model: string | null;
  bytes: number;
  usd: number | null;
  /** Estimate, the `~` of the Sky's day panel. null when nothing could be inferred. */
  blockedMs: number | null;
  outcome: 'clean' | 'abandoned' | 'failed' | 'unknown';
}

/** Structured so the Veil can act at the selector layer. Text is composed in the UI. */
export type TapeKind =
  | 'launch' | 'land' | 'need' | 'answered' | 'fault' | 'retry' | 'write' | 'response' | 'tool' | 'salvo' | 'limit'
  | 'compact' | 'stop' | 'gap' | 'spark' | 'denied';

export interface TapeEntry {
  id: string;
  at: EpochMs;
  kind: TapeKind;
  nodeId: NodeId | null;
  worldId: WorldId | null;
  /** Tool name, status code or count. Never model text. */
  detail: string | null;
  /** Second value where a row has one: denial source, salvo id, compaction trigger. Never model text. */
  note: string | null;
}

export interface NodeRate {
  nodeId: NodeId;
  tps: number;
  /** 'live' from stream deltas, 'derived' from flushed responses. */
  source: 'live' | 'derived';
  /** Kind of the newest live delta within the last second, owned craft only. */
  liveBlock: 'thinking' | 'text' | null;
  outputTokens: number;
}

export interface FleetRate {
  tps: number;
  /** Advances the corona flow. Law 3. */
  outputTokens: number;
  /** World load for the streamers. */
  perWorld: Record<WorldId, number>;
  burnUsdPerHour: number;
  /** Ephemeris `TODAY`. null until the usage index ends. */
  todayUsd: number | null;
  lagMaxMs: number;
}

interface KernelEventBase {
  id: string;
  at: EpochMs;
  observedAt: EpochMs;
}

export type KernelEvent = KernelEventBase & (
  | { type: 'kernel.tick'; uptimeMs: number }
  | { type: 'world.upserted'; world: World }
  | { type: 'plan.changed'; plan: PlanState }
  | { type: 'source.plan.changed'; client: SessionClient; plan: PlanState }
  | { type: 'admission.changed'; admission: AdmissionState }
  | { type: 'profiles.changed'; profiles: ProfileView[] }
  | { type: 'salvo.opened'; salvo: Salvo }
  | { type: 'salvo.joined'; salvoId: SalvoId; nodeId: NodeId }
  | { type: 'salvo.closed'; salvoId: SalvoId }
  | { type: 'index.progress'; progress: IndexProgress }
  | { type: 'sensor.changed'; sensor: SensorState }
  | { type: 'history.digest'; rows: HistoryDigest[] }
  /** ENOENT by retention: star and city light go out. */
  | { type: 'history.expired'; nodeIds: NodeId[] }
  /** Ended over an hour ago. They leave the live state and stay as history rows. */
  | { type: 'fleet.evicted'; sessionIds: SessionId[] }
  | { type: 'managed.upserted'; agent: ManagedAgentView }
  | { type: 'managed.removed'; agentId: AgentId }
  | { type: 'approval.requested'; approval: ApprovalView }
  /** Fires from the abort signal. The card shows WITHDRAWN and leaves. */
  | { type: 'approval.cancelled'; requestId: RequestId; agentId: AgentId; reason: string }
  | { type: 'approval.answered'; requestId: RequestId; agentId: AgentId; outcome: ApprovalDecision['kind']; by: string }
  /** Kernel restarted with a request open. The resumed model asks again. */
  | { type: 'approval.expired'; requestId: RequestId }
  | { type: 'standing.changed'; agentId: AgentId; grants: StandingGrant[] }
  /** A spawn hit a limit: the arc falls back into the star. */
  | { type: 'spawn.refused'; parentAgentId: AgentId | null; worldId: WorldId | null; limit: string }
  /** Claude to Claude, for the line between craft. */
  | { type: 'link.fired'; kind: 'spawn' | 'send' | 'wait' | 'status' | 'stop'; from: NodeId; to: NodeId | null }
  | { type: 'fault.acked'; nodeId: NodeId }
);

export type NaosEvent = ObservedEvent | KernelEvent;
