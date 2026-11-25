// One pure function decides what a craft shows. Every view reads it, so the scene, the rails and the Plate can never disagree.
// Order follows the priority in RF 3.5, with the control plane first, because its frames are live and outrank the transcript.
import type {
  ApprovalView, ManagedAgentView, NodeRate, ObservedAgentNode, ObservedSession, ToolFamily,
} from '@naos/protocol';

export type VisualState =
  | 'queued' | 'spawning' | 'starting' | 'ready'
  | 'thinking' | 'writing' | 'generating' | 'tool'
  | 'approve' | 'answer' | 'plan' | 'source' | 'parked'
  | 'idle' | 'idle-shell' | 'interrupted' | 'compacting' | 'retrying' | 'no-signal'
  | 'rate-limited' | 'errored' | 'no-budget' | 'stopping' | 'crashed' | 'orphaned' | 'lost'
  | 'finished' | 'exited' | 'abandoned' | 'failed' | 'stopped' | 'unknown';

export interface CraftFacts {
  owned: boolean;
  /** AC 5.1, owned craft only. */
  control?: 'queued' | 'spawning' | 'ready' | 'running' | 'awaiting_approval' | 'idle' | 'parked' | 'budget_exhausted'
    | 'rate_limited' | 'stopping' | 'exited' | 'crashed' | 'lost' | 'closed';
  /** Activity from RF 9. */
  activity: 'starting' | 'generating' | 'tool_running' | 'waiting' | 'retrying' | 'compacting' | 'idle'
    | 'interrupted' | 'errored' | 'finished' | 'unknown';
  backgroundShell?: boolean;
  errorKind?: 'rate_limit' | 'api' | 'unknown';
  outcome?: 'clean' | 'abandoned' | 'unknown';
  agentStatus?: 'running' | 'completed' | 'failed' | 'stopped' | 'orphaned' | 'unknown';
  /** Tool of the oldest open decision, owned craft only. */
  decisionTool?: string;
  /** Kind of the newest live delta within the last second, owned craft only. */
  liveBlock?: 'thinking' | 'text';
  /** Since the last record, while generating. */
  silentMs: number;
  /** A stale pid file: the process is gone and nobody wrote an end. */
  dead?: boolean;
}

const FROM_CONTROL: Partial<Record<NonNullable<CraftFacts['control']>, VisualState>> = {
  queued: 'queued', spawning: 'spawning', ready: 'ready', parked: 'parked', budget_exhausted: 'no-budget',
  rate_limited: 'rate-limited', stopping: 'stopping', exited: 'exited', crashed: 'crashed', lost: 'lost',
};

export function visualState(c: CraftFacts): VisualState {
  const fromControl = c.control && FROM_CONTROL[c.control];
  if (fromControl) return fromControl;
  if (c.decisionTool) return c.decisionTool === 'AskUserQuestion' ? 'answer' : c.decisionTool === 'ExitPlanMode' ? 'plan' : 'approve';
  if (c.agentStatus === 'orphaned' || c.dead) return 'orphaned';
  if (c.agentStatus === 'stopped') return 'stopped';
  if (c.agentStatus === 'failed') return 'failed';
  if (c.agentStatus === 'completed') return 'finished';
  switch (c.activity) {
    case 'starting': return 'starting';
    case 'waiting': return c.owned ? 'approve' : 'source';
    case 'tool_running': return 'tool';
    case 'retrying': return 'retrying';
    case 'compacting': return 'compacting';
    case 'interrupted': return 'interrupted';
    case 'idle': return c.backgroundShell ? 'idle-shell' : 'idle';
    case 'errored': return c.errorKind === 'rate_limit' ? 'rate-limited' : 'errored';
    case 'finished': return c.outcome === 'abandoned' ? 'abandoned' : 'finished';
    case 'generating':
      if (c.owned && c.liveBlock === 'thinking') return 'thinking';
      if (c.owned && c.liveBlock === 'text') return 'writing';
      return c.silentMs >= 120_000 ? 'no-signal' : 'generating';
    default: return 'unknown';
  }
}

/** The facts of one craft, read off the contract. A node id can be `pending:` with no node yet, so `node` is optional. */
export function factsOf(input: {
  node?: ObservedAgentNode | undefined;
  session?: ObservedSession | undefined;
  managed?: ManagedAgentView | undefined;
  /** Open decisions of this craft, oldest first. */
  approvals?: readonly ApprovalView[] | undefined;
  rate?: NodeRate | undefined;
  now: number;
}): CraftFacts {
  const { node, session, managed, approvals, rate, now } = input;
  const activity = node?.activity ?? session?.activity ?? { state: 'unknown' as const, since: now };
  const owned = managed !== undefined;
  const lastRecord = node?.lastRecordAt ?? session?.lastRecordAt ?? activity.since;
  const facts: CraftFacts = {
    owned,
    activity: activity.state,
    silentMs: Math.max(0, now - Math.max(lastRecord, activity.since)),
  };
  if (managed) facts.control = managed.state;
  if (node) facts.agentStatus = node.status;
  if (activity.state === 'idle') facts.backgroundShell = activity.backgroundShell;
  if (activity.state === 'errored') facts.errorKind = activity.kind;
  if (activity.state === 'finished') facts.outcome = activity.outcome;
  const decision = owned ? approvals?.[0] : undefined;
  if (decision) facts.decisionTool = decision.toolName;
  if (owned && rate?.liveBlock) facts.liveBlock = rate.liveBlock;
  if (session?.liveness === 'dead' && node?.kind === 'main' && session.endedAt === null) facts.dead = true;
  return facts;
}

/** The six rungs of the attention order, section 3.3. */
export type AttentionTier = 1 | 2 | 3 | 4 | 5 | 6;

export const LOW_CONTEXT = 0.8;

const FAULT_STATES: ReadonlySet<VisualState> = new Set<VisualState>(['errored', 'crashed', 'abandoned', 'failed', 'no-budget']);
const TROUBLE_STATES: ReadonlySet<VisualState> = new Set<VisualState>([
  'errored', 'crashed', 'abandoned', 'failed', 'retrying', 'lost', 'rate-limited',
]);
const ANSWERABLE: ReadonlySet<VisualState> = new Set<VisualState>(['approve', 'answer', 'plan']);
const ENDED: ReadonlySet<VisualState> = new Set<VisualState>(['finished', 'exited', 'abandoned', 'failed', 'stopped', 'crashed']);

export const isAnswerable = (s: VisualState): boolean => ANSWERABLE.has(s);
/** Section 8.1: what lights FAULT, before an acknowledgement. */
export const isFault = (s: VisualState): boolean => FAULT_STATES.has(s);
export const isEnded = (s: VisualState): boolean => ENDED.has(s);

export interface AttentionInput {
  state: VisualState;
  /** A fault somebody acknowledged no longer asks for attention. */
  acked: boolean;
  /** Context used over window, null when unknown. */
  contextFrac: number | null;
}

export function attentionTier(c: AttentionInput): AttentionTier {
  if (ANSWERABLE.has(c.state)) return 1;
  if (c.state === 'source') return 2;
  if (TROUBLE_STATES.has(c.state) && !c.acked) return 3;
  if (c.contextFrac !== null && c.contextFrac >= LOW_CONTEXT && !ENDED.has(c.state)) return 4;
  if ((c.state === 'no-budget' && !c.acked) || c.state === 'parked') return 5;
  return 6;
}

/** Hard faults read before a craft that is still trying. */
const troubleRank = (s: VisualState): number => (s === 'retrying' || s === 'rate-limited' ? 1 : 0);

export interface AttentionRow extends AttentionInput {
  id: string;
  /** Since when it has been waiting, for tiers 1 and 2. */
  waitingSince: number;
  /** Most recent activity, for the last tier. */
  lastActiveAt: number;
}

/**
 * The one order behind the rail, J and K, and the Manifest highlight. Decisions and waits go oldest first, the last rung most
 * recently active first, and ties fall to the id, so the walk never reshuffles between two ticks.
 */
export function attentionOrder<T extends AttentionRow>(rows: readonly T[]): T[] {
  return rows
    .map((row) => ({ row, tier: attentionTier(row) }))
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      const by = a.tier <= 2 ? a.row.waitingSince - b.row.waitingSince
        : a.tier === 6 ? b.row.lastActiveAt - a.row.lastActiveAt
        : a.tier === 3 ? troubleRank(a.row.state) - troubleRank(b.row.state)
        : 0;
      return by || (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0);
    })
    .map(({ row }) => row);
}

export type Tone = 'work' | 'tool' | 'need' | 'fault' | 'rest' | 'idle' | 'done';

export type MarkKind =
  | 'dots' | 'kite' | 'dashes' | 'square' | 'triangle' | 'lance' | 'arrow' | 'arc' | 'fork' | 'joined' | 'dotsquare'
  | 'ringdot' | 'ringcross' | 'brokenring' | 'hollowring' | 'dot' | 'slash' | 'up' | 'dashedarc' | 'hollowdot'
  | 'hollowkite' | 'cross' | 'emptybar' | 'down';

const TOOL_MARK: Record<ToolFamily, MarkKind> = {
  shell: 'square', read: 'triangle', edit: 'lance', web: 'arrow', mcp: 'arc', launch: 'fork', send: 'joined', ask: 'dotsquare', other: 'dotsquare',
};

/** Colour of the mark, section 6. Text keeps its text tokens. */
export function toneOf(s: VisualState): Tone {
  switch (s) {
    case 'thinking': case 'writing': case 'generating': case 'spawning': return 'work';
    case 'tool': case 'compacting': case 'retrying': case 'rate-limited': return 'tool';
    case 'approve': case 'answer': case 'plan': case 'source': case 'parked': return 'need';
    case 'errored': case 'crashed': case 'abandoned': case 'failed': return 'fault';
    case 'finished': case 'exited': return 'done';
    case 'queued': case 'starting': case 'ready': case 'interrupted': case 'stopping': case 'no-budget': return 'rest';
    default: return 'idle';
  }
}

export function markOf(s: VisualState, tool: ToolFamily | null, danger: boolean): MarkKind {
  switch (s) {
    case 'thinking': return 'dots';
    case 'writing': case 'spawning': return 'kite';
    case 'generating': return 'dashes';
    case 'tool': return TOOL_MARK[tool ?? 'other'];
    case 'approve': case 'answer': case 'plan': return danger ? 'ringcross' : 'ringdot';
    case 'source': return 'brokenring';
    case 'parked': return 'hollowring';
    case 'idle': return 'dot';
    case 'idle-shell': return 'dotsquare';
    case 'interrupted': case 'stopping': case 'stopped': return 'slash';
    case 'compacting': return 'up';
    case 'retrying': case 'rate-limited': return 'dashedarc';
    case 'queued': case 'starting': case 'ready': return 'hollowkite';
    case 'errored': case 'crashed': case 'abandoned': case 'failed': return 'cross';
    case 'no-budget': return 'emptybar';
    case 'finished': case 'exited': return 'down';
    default: return 'hollowdot';
  }
}
