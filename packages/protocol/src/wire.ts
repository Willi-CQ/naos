// How the kernel and its clients talk. All mutations go through one route, POST /api/cmd, so Host, Origin, auth and
// scope are checked in one place. The WebSocket at /ws is push only, and it needs the same checks at upgrade.
import type {
  AdmissionState, ApprovalDecision, ManagedAgentView, PreflightResult, SpawnReceipt, SpawnSpec,
} from './control.ts';
import type { FleetRate, HistoryDigest, KernelInfo, NaosEvent, NodeRate, Salvo } from './fleet.ts';
import type { AgentId, EpochMs, NodeId, RequestId, ToolFamily, ToolSummary, TurnOrigin, WorldId } from './observed.ts';
import type { FleetState } from './state.ts';
import type { KnowledgeGraph, ProjectSurvey } from './survey.ts';
import type { AgentProvider, NativeClient } from './providers.ts';
import type { ProjectSkill, SkillInstructions } from './skills.ts';
import type { ProjectChanges, ProjectDiff } from './changes.ts';

export const PROTOCOL_VERSION = 1;
export const DEFAULT_PORT = 4317;

/** Structure of one row in the Channel. Text stays out. `W` fetches it through `craft.text`. */
export type ChannelRow =
  | { kind: 'turn'; at: EpochMs; n: number; origin: TurnOrigin }
  | { kind: 'thinking'; at: EpochMs; tokens: number; block?: number }
  | { kind: 'text'; at: EpochMs; messageId: string; chars: number; tokens: number | null }
  | { kind: 'tool'; at: EpochMs; toolUseId: string; name: string; family: ToolFamily; summary: ToolSummary;
      durationMs: number | null; isError: boolean; decision: 'accept' | 'reject' | null; status?: 'running' | 'completed' | 'failed' }
  | { kind: 'tender'; at: EpochMs; nodeId: NodeId; agentType: string | null; status: string }
  | { kind: 'error'; at: EpochMs; label: string };

export interface TextRow {
  messageId: string;
  at: EpochMs;
  role: 'assistant' | 'user';
  text: string;
  truncated: boolean;
}

export interface LedgerReport {
  /** True while the usage index runs. */
  partial: boolean;
  todayUsd: number;
  burnUsdPerHour: number;
  days30Usd: number;
  blockedTodayMs: number;
  byWorld: Array<{ worldId: WorldId; usd: number }>;
  byModel: Array<{ model: string; inputTokens: number; outputTokens: number; usd: number }>;
  trees: Array<{ rootAgentId: AgentId; spentUsd: number; budgetUsd: number }>;
}

export interface ServerFrames {
  /**
   * Comes again before a snapshot when KernelInfo changes or a fixture seeks. `clientId` names this socket: use it for
   * `ui.presence`, `craft.watchText` and `approval.answer`. Pass `/ws?clientId=<id>` to keep the same one across reconnects.
   */
  hello: { t: 'hello'; kernel: KernelInfo; clientId: string };
  snapshot: { t: 'snapshot'; seq: number; state: FleetState };
  /** Batched at most once per 16 ms. `seq` is that of the last event. A gap means resync with a snapshot. */
  events: { t: 'events'; seq: number; events: NaosEvent[] };
  /**
   * 4 Hz. Kept out of the event log: plumes and the corona read this directly. `at` is the kernel's clock: a client takes
   * `now` from here and never from Date.now(), because a paused fixture stops this clock, and that is what makes a shot repeat.
   */
  rates: { t: 'rates'; at: EpochMs; fleet: FleetRate; nodes: NodeRate[] };
  /** Only for a client that asked with `craft.watchText`. */
  text: { t: 'text'; nodeId: NodeId; delta: string };
}
export type ServerFrame = ServerFrames[keyof ServerFrames];

/** A command with no fields. `Record<string, never>` would forbid `type` itself once it is intersected into `Command`. */
export type NoInput = Record<never, never>;

export interface CommandMap {
  'agent.providers': { in: { inspect?: NativeClient }; out: AgentProvider[] };
  'agent.spawn':{ in: { spec: SpawnSpec }; out: SpawnReceipt };
  'agent.send': { in: { agentId: AgentId; text: string; priority: 'queue' | 'now' }; out: { sendId: string } };
  'agent.stop': { in: { agentId: AgentId }; out: { result: 'graceful' | 'forced' | 'already-stopped' } };
  'agent.stopAll': { in: NoInput; out: { stopped: number; outOfReach: number } };
  'agent.addBudget': { in: { agentId: AgentId; addUsd: number }; out: { budgetUsd: number } };
  'agent.fork': { in: { agentId: AgentId }; out: SpawnReceipt };
  'agent.resume': { in: { agentId: AgentId; prompt?: string; addUsd?: number }; out: { agentId: AgentId } };
  'agent.close': { in: { agentId: AgentId }; out: { closed: boolean } };
  'agent.status': { in: { agentId: AgentId }; out: ManagedAgentView };
  'agent.wait': { in: { agentId: AgentId; timeoutS: number }; out: { agent: ManagedAgentView; result: string | null; done: boolean } };
  'agent.list': { in: { scope: 'all' | 'tree' | 'children'; of?: AgentId }; out: ManagedAgentView[] };
  /** UI scope only. Approval stays with the human. */
  'approval.answer': { in: { requestId: RequestId; decision: ApprovalDecision; clientId: string }; out: { applied: boolean } };
  'preflight': { in: { spec: SpawnSpec }; out: PreflightResult };
  /** UI scope only. Trust lets a repo's hooks and MCP servers run at spawn. */
  'world.trust': { in: { worldId: WorldId; trusted: boolean }; out: { trusted: boolean } };
  /** UI scope only. Kept in layout.json. null or an empty name goes back to the name made from the folder. */
  'world.rename': { in: { worldId: WorldId; name: string | null }; out: { name: string } };
  /** UI scope only. Starts the world's designer, which reads the repo and writes its planet. One at a time per world. */
  'world.design': { in: { worldId: WorldId }; out: SpawnReceipt };
  'world.survey': { in: { worldId: WorldId }; out: ProjectSurvey };
  'world.knowledge': { in: { worldId: WorldId }; out: KnowledgeGraph };
  'world.skills': { in: { worldId: WorldId }; out: { skills: ProjectSkill[] } };
  'world.skill.read': { in: { worldId: WorldId; skillId: string }; out: SkillInstructions };
  'world.changes': { in: { worldId: WorldId }; out: ProjectChanges };
  'world.diff': { in: { worldId: WorldId; path: string }; out: ProjectDiff };
  'fault.ack': { in: { nodeId: NodeId }; out: Record<string, never> };
  'craft.channel': { in: { nodeId: NodeId; limit?: number }; out: { rows: ChannelRow[]; complete: boolean } };
  'craft.text': { in: { nodeId: NodeId; limit?: number }; out: { rows: TextRow[]; available: boolean } };
  'craft.watchText': { in: { nodeId: NodeId; on: boolean; clientId: string }; out: Record<string, never> };
  'ledger.get': { in: NoInput; out: LedgerReport };
  /** `salvos` are the closed fan-outs of the retained days: burned spokes, FAN-OUTS in the Sky. */
  'history.get': { in: NoInput; out: { rows: HistoryDigest[]; salvos: Salvo[] } };
  'admission.get': { in: NoInput; out: AdmissionState };
  /** Decides whether the kernel raises a Windows notification. `notifications` is the Settings switch. */
  /** `veiled`: a toast is a screen too, so a name stays out of it while any client holds the Veil. */
  'ui.presence': { in: { clientId: string; visible: boolean; focused: boolean; notifications: boolean; veiled?: boolean }; out: Record<string, never> };
  /** Writes Slice 0 numbers to docs/bench/<date>.json. */
  'bench.record': { in: { name: string; data: unknown }; out: { path: string } };
  /** UI scope only. Refused while an owned craft is alive, and the refusal says how many. */
  'kernel.quit': { in: NoInput; out: { stopping: boolean } };
  /** Fixture kernel only: refused in live mode. */
  'fixture.control': { in: { action: 'pause' | 'play' | 'seek' | 'speed' | 'idle'; value?: number }; out: { t: number; playing: boolean } };
}

export type CommandType = keyof CommandMap;
export type Command = { [K in CommandType]: { type: K } & CommandMap[K]['in'] }[CommandType];
export type CommandResult<K extends CommandType = CommandType> =
  | { ok: true; result: CommandMap[K]['out'] }
  | { ok: false; error: { code: CommandErrorCode; message: string } };

export type CommandErrorCode =
  | 'bad-request' | 'not-found' | 'forbidden' | 'conflict' | 'limit' | 'unavailable' | 'internal';

export type AuthScope = 'ui' | 'mcp';

/**
 * Which caller may run what, enforced in the server, tested in the protocol package. A Claude session talks to the kernel
 * with scope 'mcp', and that scope has no route to an approval, to trust, or to All stop.
 */
export const COMMAND_SCOPES: Record<CommandType, readonly AuthScope[]> = {
  'agent.providers': ['ui'],
  'agent.spawn': ['ui', 'mcp'],
  'agent.send': ['ui', 'mcp'],
  'agent.stop': ['ui', 'mcp'],
  'agent.stopAll': ['ui'],
  'agent.addBudget': ['ui'],
  'agent.fork': ['ui'],
  'agent.resume': ['ui'],
  'agent.close': ['ui'],
  'agent.status': ['ui', 'mcp'],
  'agent.wait': ['ui', 'mcp'],
  'agent.list': ['ui', 'mcp'],
  'approval.answer': ['ui'],
  'preflight': ['ui', 'mcp'],
  'world.trust': ['ui'],
  'world.rename': ['ui'],
  'world.design': ['ui'],
  'world.survey': ['ui'],
  'world.knowledge': ['ui'],
  'world.skills': ['ui'],
  'world.skill.read': ['ui'],
  'world.changes': ['ui'],
  'world.diff': ['ui'],
  'fault.ack': ['ui'],
  'craft.channel': ['ui', 'mcp'],
  'craft.text': ['ui'],
  'craft.watchText': ['ui'],
  'ledger.get': ['ui', 'mcp'],
  'history.get': ['ui'],
  'admission.get': ['ui', 'mcp'],
  'ui.presence': ['ui'],
  'bench.record': ['ui'],
  'kernel.quit': ['ui'],
  'fixture.control': ['ui'],
};
