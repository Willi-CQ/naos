// The selector layer. One pure function turns the contract into what the HUD prints, four times a second. The Veil acts here,
// so a component only ever receives strings that are safe to show, and no component reads FleetState at all.
import type {
  ApprovalView, ChannelRow, EpochMs, FleetRate, FleetState, HistoryDigest, ManagedAgentView, NodeId, NodeRate, ObservedAgentNode,
  ObservedSession, ObservedWorkflow, TapeEntry, ToolFamily, WorldId,
} from '@naos/protocol';
import { MANAGED_TITLE_PREFIX, WORLD_DESIGNER_PROFILE, makeNodeId, sessionSource } from '@naos/protocol';
import type { SessionClient, SessionCapability } from '@naos/protocol';
import { altitude } from '../core/laws.ts';
import {
  attentionOrder, attentionTier, factsOf, isAnswerable, isEnded, isFault, LOW_CONTEXT, markOf, toneOf, visualState,
} from '../core/state.ts';
import type { AttentionTier, MarkKind, Tone, VisualState } from '../core/state.ts';
import { ageClock, ageFine, ageSpoken, ageWords, clock, money, moneyBare, shortTarget, tokens } from './format.ts';
import { COPY, FAMILY_WORD, STATE_SPOKEN, STATE_WORD } from './strings.ts';
import { approvalPreview, hash32, titleShape, toolTarget, veilNames, veilTool } from './veil.ts';

const GREEK = [
  ['alpha', 'α'], ['beta', 'β'], ['gamma', 'γ'], ['delta', 'δ'], ['epsilon', 'ε'], ['zeta', 'ζ'], ['eta', 'η'], ['theta', 'θ'],
  ['iota', 'ι'], ['kappa', 'κ'], ['lambda', 'λ'], ['mu', 'μ'], ['nu', 'ν'], ['xi', 'ξ'], ['omicron', 'ο'], ['pi', 'π'],
  ['rho', 'ρ'], ['sigma', 'σ'], ['tau', 'τ'], ['upsilon', 'υ'], ['phi', 'φ'], ['chi', 'χ'], ['psi', 'ψ'], ['omega', 'ω'],
] as const;

/** The Belt's row in the Manifest. A real world id is 16 hex digits, so this cannot be one. */
export const BELT_GROUP = 'belt';
export const BELT_NAME = 'Belt';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** Section 6.4: DONE for 10 s, then the row leaves. */
const LINGER_MS = 10_000;
/** RF 2.3: a 175 ms wait was seen. */
const SOURCE_DEBOUNCE_MS = 400;
/** A settled decision stays on its row this long, with its end state. */
const SETTLED_SHOWN_MS = 6_000;
const SENSOR_LIT_MS = 60_000;
const TAPE_SHOWN = 48;
const STALE_PLAN_MS = 600_000;
/** Section 6.3: the tag of a compaction stays 8 s. */
const FLAG_MS = 8_000;

export interface Rates {
  at: EpochMs;
  fleet: FleetRate | null;
  nodes: Record<NodeId, NodeRate>;
}

export type TapeFilter = 'all' | 'writes-damage' | 'needs';
export const TAPE_FILTERS: readonly TapeFilter[] = ['all', 'writes-damage', 'needs'];

export interface ModelInput {
  clientFilter?: SessionClient | 'all';
  fleet: FleetState;
  rates: Rates;
  now: EpochMs;
  veil: boolean;
  tapeFilter: TapeFilter;
  history: readonly HistoryDigest[];
  clientId: string | null;
  linkUp: boolean;
  sensorChangedAt: EpochMs | null;
  /** Per-world tokens per second, oldest first, for the wide sparkline. */
  burns: Readonly<Record<WorldId, readonly number[]>>;
}

export interface CraftVM {
  id: NodeId;
  client: SessionClient;
  capabilities: SessionCapability[];
  visible: boolean;
  sessionId: string | null;
  worldId: WorldId;
  worldName: string;
  kind: ObservedAgentNode['kind'];
  owned: boolean;
  agentId: string | null;
  /** `beta`, for assistive text. */
  letter: string;
  /** `β`, or a Flamsteed number past 24. */
  glyph: string;
  /** `kestrel β`, in the tender's case `kestrel β t2`. */
  name: string;
  title: string;
  state: VisualState;
  word: string;
  metric: string;
  tone: Tone;
  mark: MarkKind;
  danger: boolean;
  tier: AttentionTier;
  spoken: string;
  inManifest: boolean;
  live: boolean;
  acked: boolean;
  parentId: NodeId | null;
  childIds: NodeId[];
  dashedLink: boolean;
  contextFrac: number | null;
  contextUsed: string;
  altitude: number;
  outputTokens: number;
  tps: number;
  rateSource: NodeRate['source'] | null;
  activeTools: string[];
  waitingSince: number;
  lastActiveAt: number;
  model: string;
  stellar: string;
  effort: string;
  mode: string;
  branch: string;
  owner: string;
  budget: string;
  turn: string;
  toolsLine: string;
  queued: number;
  lag: string;
  agentType: string;
  linkOwner: string;
  standing: Array<{ rule: string; scope: string }>;
  /** A tag that lasts a few seconds, such as a compaction's `630k to 15k`. */
  flag: string | null;
}

export interface WorkflowVM {
  id: string;
  parentId: NodeId;
  title: string;
  metric: string;
  live: boolean;
  status: ObservedWorkflow['status'];
  phases: Array<{ title: string; line: string }>;
  statusWord: string;
}

export type ManifestRow = { type: 'craft'; craft: CraftVM } | { type: 'workflow'; workflow: WorkflowVM };

export interface WorldVM {
  worldId: WorldId;
  /** 0 in the Belt, which holds no slot. */
  slot: number;
  name: string;
  belt: boolean;
  renamed: boolean;
  path: string;
  branch: string;
  git: boolean;
  cost: string;
  observedOnly: boolean;
  burn: string;
  burns: readonly number[];
  rows: ManifestRow[];
  craftCount: number;
  tenderCount: number;
  bestTier: AttentionTier;
  landed: number;
  mass: number;
  ageDays: number;
  massLine: string;
  today: string;
  lights: string;
  moons: string;
  moonNames: string[];
  designed: boolean;
  rationale: string;
  designing: boolean;
}

export interface DecisionVM {
  requestId: string;
  nodeId: NodeId;
  agentId: string;
  who: string;
  worldName: string;
  letter: string;
  glyph: string;
  tool: string;
  age: string;
  ageMs: number;
  createdAt: EpochMs;
  preview: string;
  danger: boolean;
  status: ApprovalView['status'];
  /** End state, or the reason it cannot be answered. */
  note: string | null;
  tag: string | null;
}

export interface SourceVM { nodeId: NodeId; who: string; age: string; since: EpochMs; reason: string; owner: string }
export interface TroubleVM { nodeId: NodeId; who: string; line: string; state: VisualState; mark: MarkKind; tone: Tone }
export interface LowVM { nodeId: NodeId; who: string; line: string }
export interface LandedVM { worldId: WorldId; name: string; lit: number; failed: number; line: string }
export interface TapeVM { id: string; at: EpochMs; time: string; who: string; what: string; times: number; kind: TapeEntry['kind']; nodeId: NodeId | null }
export interface AwayVM { kind: 'resume' | 'salvage' | 'review'; line: string; nodeId: NodeId | null }
export interface LampVM { id: LampId; count: number; lit: boolean; note: string | null }
export type LampId = 'you' | 'source' | 'fault' | 'retry' | 'low' | 'limit' | 'sensor';

export interface SunVM {
  known: boolean;
  fiveLeft: number | null;
  sevenLeft: number | null;
  asOf: string | null;
  stale: boolean;
  resets: string;
  status: string;
}

export interface EphemerisVM {
  tps: number;
  burn: number;
  today: number | null;
  resets: string;
  ownedRun: number;
  ownedLimit: number;
  ownedAlive: number;
  aliveLimit: number;
  lagMs: number;
}

export interface Model {
  /** The Manifest: worlds with craft, then one row for the Belt if anything there is live. */
  worlds: WorldVM[];
  /** Every planet, also those with no craft. Slot order. */
  allWorlds: WorldVM[];
  /** Rubble: sandboxes, roots that are gone, stray sessions. No slot and no planet, and their craft still count. */
  beltWorlds: WorldVM[];
  crafts: Record<NodeId, CraftVM>;
  /** The J and K walk. */
  walk: NodeId[];
  decisions: DecisionVM[];
  sources: SourceVM[];
  trouble: TroubleVM[];
  low: LowVM[];
  landed: LandedVM[];
  landedTotal: number;
  tape: TapeVM[];
  lamps: LampVM[];
  sun: SunVM;
  ephemeris: EphemerisVM;
  craftCount: number;
  run: number;
  idle: number;
  pad: number;
  derelict: number;
  ownedLine: string;
  ownedCount: number;
  /** Row of the world with no craft yet, and the Almanac when the sky is empty. */
  almanac: string[];
  away: AwayVM[];
  /** Spoken, one line per craft. */
  mirror: string[];
  /** Document title. */
  title: string;
  /** Owned, answerable: what may bend the meridians. */
  badge: number;
  veil: boolean;
  now: EpochMs;
  kernelMode: string | null;
  observerOnly: boolean;
  sessionsEnded: CraftVM[];
}

/** The managed prefix is how the Observer recognises a session, not part of its name (AC 13). */
const plainTitle = (title: string | null): string | null =>
  title?.startsWith(MANAGED_TITLE_PREFIX) ? title.slice(MANAGED_TITLE_PREFIX.length).trimStart() : title;

const glyphOf = (index: number): { letter: string; glyph: string } => {
  const greek = GREEK[index];
  return greek ? { letter: greek[0], glyph: greek[1] } : { letter: String(index + 1), glyph: String(index + 1) };
};

const shortModel = (model: string | null): string => (model ?? 'unknown').replace(/^claude-/, '').replace(/-\d+-\d+$/, (m) => m.replace(/-/g, '.').replace(/^\./, ' '));

/** By input price, read from the name until the price table reaches the UI. Open set: an unknown model is a plain G. */
const stellar = (model: string | null): string => {
  if (!model) return '';
  if (model.includes('fable')) return 'class O';
  if (model.includes('opus')) return 'class A';
  if (model.includes('haiku')) return 'class M';
  return 'class G';
};

const activeTools = (activity: ObservedAgentNode['activity']): Array<{ id: string; family: ToolFamily; startedAt: EpochMs }> =>
  activity.state === 'tool_running' ? activity.tools.map((t) => ({ id: t.toolUseId, family: t.family, startedAt: t.startedAt })) : [];

function metricOf(input: {
  state: VisualState;
  node: ObservedAgentNode | undefined;
  activity: ObservedAgentNode['activity'] | undefined;
  managed: ManagedAgentView | undefined;
  decision: ApprovalView | undefined;
  rate: NodeRate | undefined;
  session: ObservedSession | undefined;
  now: number;
}): { word: string; metric: string } {
  const { state, activity, managed, decision, rate, session, now } = input;
  const word = STATE_WORD[state];
  const since = activity ? now - activity.since : 0;
  switch (state) {
    case 'approve': case 'answer': case 'plan':
      return { word, metric: ageClock(decision ? now - decision.createdAt : since) };
    case 'source': return { word, metric: ageClock(since) };
    case 'thinking': return { word, metric: ageWords(since) };
    case 'writing': return { word, metric: `${Math.round(rate?.tps ?? 0)}/s` };
    case 'generating': return { word, metric: ageFine(since) };
    case 'idle': return { word, metric: ageWords(since) };
    case 'no-signal': return { word, metric: ageWords(since) };
    case 'tool': {
      const tools = activity?.state === 'tool_running' ? activity.tools : [];
      const first = tools[0];
      if (!first) return { word, metric: '' };
      const label = FAMILY_WORD[first.family];
      if (tools.length > 1) return { word: label, metric: `+${tools.length - 1}` };
      const ms = now - first.startedAt;
      switch (first.family) {
        case 'shell': return { word: label, metric: ageWords(ms) };
        case 'web': return { word: label, metric: ageFine(ms) };
        case 'launch': return { word: label, metric: String(tools.length) };
        case 'send': return { word: label, metric: '' };
        default: return { word: label, metric: ageClock(ms) };
      }
    }
    case 'retrying':
      return { word, metric: activity?.state === 'retrying' ? `${activity.attempt}/${activity.maxRetries}` : '' };
    case 'errored':
      return { word, metric: activity?.state === 'errored' && activity.httpStatus ? String(activity.httpStatus) : '' };
    case 'rate-limited': {
      const resetsAt = activity?.state === 'errored' ? activity.resetsAt : session?.lastRateLimit?.resetsAt;
      return { word, metric: resetsAt ? ageWords(resetsAt - now) : '' };
    }
    case 'stopping': return { word: managed?.stopStep ? `${word}, ${managed.stopStep}` : word, metric: '' };
    default: return { word, metric: '' };
  }
}

function buildCrafts(input: ModelInput, names: (id: WorldId) => string): Record<NodeId, CraftVM> {
  const { fleet, rates, now, veil } = input;
  const out: Record<NodeId, CraftVM> = {};

  const byNode = new Map<NodeId, ManagedAgentView>();
  for (const m of Object.values(fleet.managed)) byNode.set(m.nodeId, m);
  const openByNode = new Map<NodeId, ApprovalView[]>();
  const openByAgent = new Map<string, ApprovalView[]>();
  const open = Object.values(fleet.approvals).filter((a) => a.status === 'open').sort((a, b) => a.createdAt - b.createdAt);
  for (const a of open) {
    openByNode.set(a.nodeId, [...(openByNode.get(a.nodeId) ?? []), a]);
    openByAgent.set(a.agentId, [...(openByAgent.get(a.agentId) ?? []), a]);
  }

  // Letters follow launch order within a world, so the rails and the sky agree on who is who.
  const perWorld = new Map<WorldId, Array<{ key: string; at: number }>>();
  const addLetter = (worldId: WorldId, key: string, at: number) => {
    const row = perWorld.get(worldId) ?? [];
    row.push({ key, at });
    perWorld.set(worldId, row);
  };
  for (const s of Object.values(fleet.sessions)) addLetter(s.worldId, s.rootNodeId, s.startedAt ?? Number.MAX_SAFE_INTEGER);
  const pending = Object.values(fleet.managed).filter((m) => !fleet.nodes[m.nodeId] && (m.state === 'queued' || m.state === 'spawning' || m.state === 'crashed'));
  for (const m of pending) addLetter(m.worldId, m.nodeId, m.createdAt);
  const index = new Map<string, number>();
  for (const rows of perWorld.values()) {
    rows.sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : 1)).forEach((row, i) => index.set(row.key, i));
  }

  const make = (id: NodeId, node: ObservedAgentNode | undefined, session: ObservedSession | undefined, managed: ManagedAgentView | undefined): CraftVM | null => {
    const worldId = session?.worldId ?? managed?.worldId;
    if (worldId === undefined) return null;
    const approvals = openByNode.get(id) ?? (managed ? openByAgent.get(managed.agentId) : undefined);
    const rate = rates.nodes[id];
    const facts = factsOf({ node, session, managed, approvals, rate, now });
    const state = visualState(facts);
    const activity = node?.activity ?? session?.activity;
    const decision = approvals?.[0];
    const danger = decision?.danger ?? false;
    const { word, metric } = metricOf({ state, node, activity, managed, decision, rate, session, now });
    const tools = activity ? activeTools(activity) : [];
    const kind = node?.kind ?? 'main';
    const main = kind === 'main';
    const rootId = session?.rootNodeId ?? id;
    const { letter, glyph } = glyphOf(index.get(rootId) ?? 0);
    const worldName = names(worldId);
    const tenderOf = main ? '' : ` t${(fleet.nodes[node?.parentNodeId ?? '']?.childNodeIds.indexOf(id) ?? 0) + 1}`;
    const name = `${worldName} ${glyph}${tenderOf}`;

    // A prompt is private text, so it never stands in for a title in a default view (RF 3.1). The same goes for a model-written description.
    const named = session && session.titleSource !== 'lastPrompt' && session.titleSource !== 'firstPrompt' ? session.title : null;
    const realTitle = main ? plainTitle(managed?.title ?? session?.displayName ?? named) : (node?.workflow?.label ?? node?.name ?? null);
    const title = veil ? titleShape(realTitle) : (realTitle ?? (main ? COPY.untitled : (node?.agentType ?? kind)));

    const contextTokens = main ? (session?.contextTokens ?? managed?.contextTokens ?? null) : null;
    const contextWindow = main ? (session?.contextWindow ?? managed?.contextWindow ?? null) : null;
    const contextFrac = contextTokens !== null && contextWindow ? contextTokens / contextWindow : session?.contextUsageFraction ?? null;
    const contextUsed = contextTokens !== null && contextWindow ? `${tokens(contextTokens)} of ${tokens(contextWindow)} used` : contextFrac === null ? 'context unknown' : `${Math.round(contextFrac * 100)} % used`;

    const acked = fleet.acked[id] !== undefined;
    const endedAt = node?.endedAt ?? session?.endedAt ?? managed?.endedAt ?? null;
    const lastActiveAt = node?.lastRecordAt ?? session?.lastRecordAt ?? managed?.createdAt ?? 0;
    const waitingSince = decision?.createdAt ?? activity?.since ?? now;
    const tier = attentionTier({ state, acked, contextFrac });

    const lingers = !isEnded(state) || (isFault(state) && !acked) || (endedAt !== null && now - endedAt < LINGER_MS);
    const inManifest = main && state !== 'orphaned' && lingers;

    const worktree = session?.worktree?.branch ?? managed?.worktree?.branch ?? node?.worktreeBranch ?? null;
    const branch = session?.gitBranch ?? worktree ?? '';
    const spokenAge = state === 'approve' || state === 'answer' || state === 'plan' ? `, ${ageSpoken(decision ? now - decision.createdAt : 0)}`
      : state === 'source' && activity ? `, ${ageSpoken(now - activity.since)}` : '';

    const standing = (managed ? fleet.standing[managed.agentId] : undefined) ?? [];
    const lagMs = node?.flushLagMs ?? null;
    const budget = managed?.client && managed.client !== 'claude-code' ? 'provider account limits' : managed ? `${moneyBare(managed.spentUsd)} of ${moneyBare(managed.budgetUsd)}` : session && !sessionSource(session).capabilities.includes('cost') ? 'cost unavailable' : money(node?.cost.usd ?? 0, node?.cost.isLowerBound);

    return {
      id,
        client: session ? sessionSource(session).client : managed?.client ?? 'claude-code',
      capabilities: session ? sessionSource(session).capabilities : ['activity', 'tools', 'tokens', 'context', 'cost', 'steer', 'stop', 'approve'],
        visible: !input.clientFilter || input.clientFilter === 'all' || input.clientFilter === (session ? sessionSource(session).client : managed?.client ?? 'claude-code'),
      sessionId: session?.sessionId ?? null,
      worldId,
      worldName,
      kind,
      owned: managed !== undefined,
      agentId: managed?.agentId ?? null,
      letter,
      glyph,
      name,
      title,
      state,
      word,
      metric,
      tone: toneOf(state),
      mark: markOf(state, tools[0]?.family ?? null, danger),
      danger,
      tier,
      spoken: `${worldName} ${letter}${main ? '' : ' tender'}, ${STATE_SPOKEN[state]}${spokenAge}`,
      inManifest,
      live: endedAt === null,
      acked,
      parentId: node?.parentNodeId ?? null,
      childIds: node?.childNodeIds ?? [],
      dashedLink: node?.linkedBy === 'inferred',
      contextFrac,
      contextUsed,
      altitude: contextFrac !== null ? altitude(contextFrac, 1) : 0.8,
      outputTokens: rate?.outputTokens ?? 0,
      tps: rate?.tps ?? 0,
      rateSource: rate?.source ?? null,
      activeTools: tools.map((t) => t.id),
      waitingSince,
      lastActiveAt,
      model: shortModel(node?.model ?? session?.model ?? managed?.model ?? null),
      stellar: stellar(node?.model ?? session?.model ?? managed?.model ?? null),
      effort: node?.effort ?? session?.effort ?? managed?.effort ?? 'default',
      mode: session?.permissionMode ?? managed?.permissionMode ?? 'unknown',
      branch: veil ? (branch ? 'branch hidden' : '') : `${branch}${worktree ? '  moon' : ''}`,
      owner: managed ? 'owned, live link' : `observed, ${session?.entrypoint ?? (session?.pid ? `pid ${session.pid}` : 'no pid')}`,
      budget,
      turn: managed ? `${managed.turn}${managed.maxTurns ? ` of ${managed.maxTurns}` : ''}` : '',
      toolsLine: session && !sessionSource(session).capabilities.includes('tools') ? 'not available' : `${node?.toolCalls ?? managed?.toolCalls ?? 0}, ${node?.errors ?? managed?.toolErrors ?? 0} failed`,
      queued: session?.queuedInputs ?? managed?.queuedSends ?? 0,
      lag: managed ? '0, live link' : lagMs === null ? 'unknown' : `lag ${ageFine(lagMs)}`,
      agentType: veil ? 'tender' : (node?.agentType ?? kind),
      linkOwner: session?.entrypoint ?? (session?.pid ? `pid ${session.pid}` : 'unknown owner'),
      standing: standing.map((g) => ({ rule: veil ? 'grant' : g.rule, scope: g.scope === 'session' ? 'this session' : 'this project' })),
      flag: null,
    };
  };

  for (const node of Object.values(fleet.nodes)) {
    const session = fleet.sessions[node.sessionId];
    const managed = node.kind === 'main' ? byNode.get(node.nodeId) : undefined;
    const vm = make(node.nodeId, node, session, managed);
    if (vm) out[vm.id] = vm;
  }
  for (const m of pending) {
    const vm = make(m.nodeId, undefined, undefined, m);
    if (vm) out[vm.id] = vm;
  }
  for (let i = fleet.tape.length - 1; i >= 0; i -= 1) {
    const t = fleet.tape[i]!;
    if (now - t.at > FLAG_MS) break;
    if (t.kind !== 'compact' || t.nodeId === null) continue;
    const [pre, post] = (t.detail ?? '').split('>').map(Number);
    const craft = out[t.nodeId];
    if (craft && pre !== undefined && post !== undefined && Number.isFinite(pre) && Number.isFinite(post)) craft.flag = `${tokens(pre)} to ${tokens(post)}`;
  }
  return out;
}

function buildWorkflow(w: ObservedWorkflow, veil: boolean): WorkflowVM {
  const live = w.status === 'running';
  const current = [...w.phases].reverse().find((p) => p.running > 0) ?? w.phases.at(-1);
  const label = veil ? 'workflow' : (w.name ?? 'workflow');
  const phaseNo = current ? current.index + 1 : 0;
  const open = w.counts.started;
  return {
    // Run ids are opaque today, but nothing promises they stay free of a name.
    id: veil ? String(hash32(w.runId)) : w.runId,
    parentId: w.parentNodeId,
    title: phaseNo ? `${label}, phase ${phaseNo}` : label,
    // No percent, because no total exists until the run ends.
    metric: `${w.counts.completed} of ${open}`,
    live,
    status: w.status,
    statusWord: w.status === 'running' ? 'live' : w.status,
    phases: w.phases.map((p) => {
      const total = p.agentNodeIds.length;
      const done = p.completed + p.failed;
      const name = veil ? `phase ${p.index + 1}` : `phase ${p.index + 1} ${p.title}`;
      return { title: name, line: total === 0 ? 'none yet' : p.failed > 0 ? `${done} of ${total}, ${p.failed} failed` : `${done} of ${total}` };
    }),
  };
}

function tapeWhat(t: TapeEntry, tender: boolean, veil: boolean): string {
  const noun = tender ? 'tender' : 'craft';
  const detail = veilTool(t.detail ?? '', veil);
  switch (t.kind) {
    case 'launch': return `${noun} launched`;
    case 'land': return `${noun} landed`;
    case 'need': return t.detail === null ? 'needs you' : /\s/.test(detail) ? `waiting, ${detail}` : `needs approval, ${detail}`;
    case 'answered': return detail === 'withdrawn' || detail === 'expired' ? detail : `answered, ${detail}`;
    case 'fault': return /^\d+$/.test(detail) ? `API ${detail}` : detail || 'fault';
    case 'retry': return `retry ${detail}`;
    case 'write': return detail;
    case 'tool': return detail;
    case 'response': return 'response';
    case 'salvo': return `salvo of ${detail}`;
    case 'limit': return `limit, ${detail}`;
    case 'compact': {
      const [a, b] = detail.split('>').map(Number);
      return a !== undefined && b !== undefined && Number.isFinite(a) && Number.isFinite(b) ? `compacted, ${tokens(a)} to ${tokens(b)}` : 'compacted';
    }
    case 'stop': return detail === 'interrupted' ? 'interrupted' : 'turn ended';
    case 'gap': return t.note === null && t.detail === null ? 'link gap' : `log reset, ${detail}`;
    case 'spark': return `tool failed, ${detail}`;
    case 'denied': return `denied, ${detail}`;
    default: return detail;
  }
}

const FILTERS: Record<TapeFilter, ReadonlySet<TapeEntry['kind']> | null> = {
  // The strip is short, and shell and read calls would wash the rest off it. Loud means rare.
  all: null,
  'writes-damage': new Set(['write', 'fault', 'spark', 'denied', 'retry', 'limit', 'compact', 'gap']),
  needs: new Set(['need', 'answered']),
};

function buildTape(input: ModelInput, crafts: Record<NodeId, CraftVM>, names: (id: WorldId) => string): TapeVM[] {
  const { fleet, tapeFilter } = input;
  const set = FILTERS[tapeFilter];
  const rows: TapeVM[] = [];
  const perSecond = new Map<number, number>();
  for (const t of fleet.tape) perSecond.set(Math.floor(t.at / 1000), (perSecond.get(Math.floor(t.at / 1000)) ?? 0) + 1);
  // Sorted by the record's own time: a flush that lands late still reads where it happened.
  const sorted = [...fleet.tape].sort((a, b) => a.at - b.at);
  for (let i = sorted.length - 1; i >= 0 && rows.length < TAPE_SHOWN; i -= 1) {
    const t = sorted[i]!;
    if (set ? !set.has(t.kind) : t.kind === 'tool') continue;
    const craft = t.nodeId ? crafts[t.nodeId] : undefined;
    const who = t.worldId ? names(t.worldId) : '';
    const what = tapeWhat(t, craft !== undefined && craft.kind !== 'main', input.veil);
    const last = rows.at(-1);
    // Coalesced only past 8 events a second, so a normal row is never hidden in a count.
    if (last && last.who === who && last.what === what && Math.floor(last.at / 1000) === Math.floor(t.at / 1000) && (perSecond.get(Math.floor(t.at / 1000)) ?? 0) > 8) {
      last.times += 1;
      continue;
    }
    rows.push({ id: t.id, at: t.at, time: clock(t.at, true), who, what, times: 1, kind: t.kind, nodeId: t.nodeId });
  }
  return rows;
}

function buildAlmanac(input: ModelInput, names: (id: WorldId) => string): string[] {
  const { history, now, fleet } = input;
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const lastNightFrom = dayStart.getTime() - 6 * HOUR_MS;
  const lastNightTo = dayStart.getTime() + 8 * HOUR_MS;
  const counts = new Map<WorldId, number>();
  let held = 0;
  for (const row of history) {
    // A morning sentence about a test sandbox tells nobody anything.
    const rubble = fleet.worlds[row.worldId]?.kind === 'belt';
    if (!rubble && row.endedAt !== null && row.endedAt >= lastNightFrom && row.endedAt < lastNightTo) counts.set(row.worldId, (counts.get(row.worldId) ?? 0) + 1);
    if (row.startedAt >= dayStart.getTime()) held += row.blockedMs ?? 0;
  }
  const out: string[] = [];
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top) out.push(`Last night ${top[1]} craft landed on ${names(top[0])}.`);
  const minutes = Math.round(held / 60_000);
  if (minutes > 0) out.push(`You held the fleet for ~${minutes} minutes today.`);
  const left = fleet.plan?.fiveHourLeft ?? null;
  if (left !== null) out.push(`${Math.round(left * 100)} % of the sun is showing.`);
  return out;
}

const passed = (at: number | null | undefined, now: number): boolean => typeof at === 'number' && at > 0 && at <= now;
const resetsLabel = (at: number | null | undefined, now: number): string => (!at ? 'unknown' : passed(at, now) ? 'passed' : clock(at));

/** A plan reading can be hours old, because only Claude refreshes it. A bare clock time would read as today. */
function asOfLabel(asOf: number, now: number): string {
  const day = new Date(asOf).toDateString();
  if (day === new Date(now).toDateString()) return clock(asOf);
  const yesterday = new Date(now - 86_400_000).toDateString() === day;
  return `${yesterday ? 'yesterday' : new Date(asOf).toLocaleDateString('en-US', { weekday: 'short' })} ${clock(asOf)}`;
}

/** `tender t2, Explore`. The number is its place under the parent, the same one the craft name carries. */
function tenderTag(fleet: FleetState, a: ApprovalView, veil: boolean): string {
  const main = fleet.nodes[a.nodeId];
  const nodeId = main ? makeNodeId(main.sessionId, a.subagentId!) : null;
  const parent = nodeId ? fleet.nodes[fleet.nodes[nodeId]?.parentNodeId ?? ''] : undefined;
  const at = nodeId && parent ? parent.childNodeIds.indexOf(nodeId) + 1 : 0;
  const tender = at > 0 ? `tender t${at}` : 'tender';
  return veil ? tender : `${tender}, ${a.subagentType ?? 'agent'}`;
}

function buildSun(fleet: FleetState, now: number): SunVM {
  const plan = fleet.plan;
  const asOf = plan?.asOf ?? null;
  return {
    known: plan !== null && (plan.fiveHourLeft !== null || plan.sevenDayLeft !== null),
    // A reading of a window that has since rolled over says nothing about this one.
    fiveLeft: passed(plan?.resetsAt.fiveHour, now) ? null : plan?.fiveHourLeft ?? null,
    sevenLeft: passed(plan?.resetsAt.sevenDay, now) ? null : plan?.sevenDayLeft ?? null,
    asOf: asOf !== null && now - asOf > 60_000 ? asOfLabel(asOf, now) : null,
    stale: asOf !== null && now - asOf > STALE_PLAN_MS,
    resets: resetsLabel(plan?.resetsAt.fiveHour, now),
    status: plan?.status ?? 'unknown',
  };
}

/** One Manifest row for all the rubble with a live session. Its members have their own names, and this row needs none of them. */
function beltGroup(members: readonly WorldVM[], spend: (w: WorldVM) => number | null, tps: (w: WorldVM) => number): WorldVM | null {
  const busy = members.filter((w) => w.rows.length > 0);
  const first = busy[0];
  if (!first) return null;
  const costs = busy.map(spend).filter((usd): usd is number => usd !== null);
  const sum = (of: (w: WorldVM) => number): number => busy.reduce((total, w) => total + of(w), 0);
  return {
    ...first,
    worldId: BELT_GROUP,
    name: BELT_NAME,
    path: '',
    branch: '',
    git: false,
    cost: money(costs.length === 0 ? null : costs.reduce((a, b) => a + b, 0)),
    observedOnly: busy.every((w) => w.observedOnly),
    burn: `${Math.round(sum(tps))}/s`,
    burns: [],
    rows: busy.flatMap((w) => w.rows),
    craftCount: sum((w) => w.craftCount),
    tenderCount: sum((w) => w.tenderCount),
    bestTier: busy.reduce<AttentionTier>((best, w) => (w.bestTier < best ? w.bestTier : best), 6),
    landed: sum((w) => w.landed),
    moons: 'none',
    moonNames: [],
    designed: false,
    rationale: '',
    designing: false,
  };
}

/** The Ledger and the Sky count the Belt as one line, however many sandboxes it holds. */
export function foldBelt<R extends { worldId: WorldId }>(rows: readonly R[], belt: readonly Pick<WorldVM, 'worldId'>[], add: (a: R, b: R) => R): R[] {
  const ids = new Set(belt.map((w) => w.worldId));
  const out: R[] = [];
  let folded: R | null = null;
  for (const row of rows) {
    if (!ids.has(row.worldId)) out.push(row);
    else folded = folded === null ? { ...row, worldId: BELT_GROUP } : add(folded, row);
  }
  return folded === null ? out : [...out, folded];
}

export function buildModel(input: ModelInput): Model {
  const { fleet, rates, now, veil, history, clientId, linkUp } = input;
  const worldList = Object.values(fleet.worlds);
  // Ruling 17: every world on one scale. Bytes until the usage index ends, spend after it.
  const spendBasis = fleet.index.stage === 'done' && worldList.every((w) => w.massUsd30d !== null);
  const star = veil ? veilNames(worldList, fleet.kernel?.veilSalt ?? '') : null;
  const names = (id: WorldId): string => star?.get(id) ?? (veil ? 'uncharted' : (fleet.worlds[id]?.name ?? 'uncharted'));

  const crafts = buildCrafts(input, names);
  const list = Object.values(crafts);

  const rowsOf = new Map<WorldId, ManifestRow[]>();
  const pushRow = (worldId: WorldId, row: ManifestRow) => rowsOf.set(worldId, [...(rowsOf.get(worldId) ?? []), row]);
  const order = (c: CraftVM) => {
    const n = GREEK.findIndex((g) => g[0] === c.letter);
    return n === -1 ? Number(c.letter) : n;
  };
  // A decision lifts its row to the top of its world. Everything else keeps its letter, so rows do not swap under the eye.
  const lifted = (c: CraftVM): number => (c.tier === 1 ? 0 : 1);
  for (const craft of list.filter((c) => c.inManifest && c.visible).sort((a, b) => lifted(a) - lifted(b) || order(a) - order(b))) {
    pushRow(craft.worldId, { type: 'craft', craft });
    for (const run of Object.values(fleet.workflows)) {
      if (run.status === 'running' && fleet.sessions[run.sessionId]?.rootNodeId === craft.id) {
        pushRow(craft.worldId, { type: 'workflow', workflow: buildWorkflow(run, veil) });
      }
    }
  }

  const lastHour = now - HOUR_MS;
  const landedBy = new Map<WorldId, { lit: number; failed: number }>();
  for (const row of history) {
    if (row.endedAt === null || row.endedAt < lastHour || row.endedAt > now) continue;
    const entry = landedBy.get(row.worldId) ?? { lit: 0, failed: 0 };
    if (row.outcome === 'failed' || row.outcome === 'abandoned') entry.failed += 1;
    else entry.lit += 1;
    landedBy.set(row.worldId, entry);
  }

  const worldVM = (id: WorldId): WorldVM | null => {
    const w = fleet.worlds[id];
    if (!w) return null;
    const rows = rowsOf.get(id) ?? [];
    const own = list.filter((c) => c.worldId === id);
    const manifest = own.filter((c) => c.inManifest && c.visible);
    const tps = rates.fleet?.perWorld[id] ?? 0;
    const landed = landedBy.get(id);
    const root = fleet.sessions[manifest[0]?.sessionId ?? '']?.gitBranch ?? null;
    return {
      worldId: id,
      slot: w.slot,
      name: names(id),
      belt: w.kind === 'belt',
      renamed: w.renamed === true,
      path: veil ? 'path hidden' : (w.projectRoot ?? 'no project'),
      branch: veil ? '' : (root ?? ''),
      git: w.isGit,
      cost: money(w.spendTodayUsd),
      observedOnly: manifest.length > 0 && manifest.every((c) => !c.owned),
      burn: `${Math.round(tps)}/s`,
      burns: input.burns[id] ?? [],
      rows,
      craftCount: manifest.length,
      tenderCount: own.filter((c) => c.kind !== 'main' && c.live).length,
      bestTier: manifest.reduce<AttentionTier>((best, c) => (c.tier < best ? c.tier : best), 6),
      landed: (landed?.lit ?? 0) + (landed?.failed ?? 0),
      // In MB, as the survey was: a log of raw bytes would flatten every world to nearly the same size.
      mass: spendBasis ? w.massUsd30d ?? 0 : w.massBytes / 1_048_576,
      ageDays: w.lastActiveAt === null ? 30 : Math.max(0, (now - w.lastActiveAt) / DAY_MS),
      massLine: w.massUsd30d === null ? `${(w.massBytes / 1_048_576).toFixed(0)} MB, 30 days` : `$${w.massUsd30d.toFixed(0)}, 30 days`,
      today: w.spendTodayUsd === null ? 'no index yet' : moneyBare(w.spendTodayUsd),
      lights: `${w.lightsTotal}, ${w.lightsFailed} failed`,
      moons: w.worktrees.length === 0 ? 'none' : `${w.worktrees.length} ${w.worktrees.length === 1 ? 'worktree' : 'worktrees'}`,
      moonNames: veil ? [] : w.worktrees.map((t) => t.branch ?? t.name),
      designed: w.genome !== undefined,
      rationale: veil ? '' : (w.genome?.rationale ?? ''),
      designing: Object.values(fleet.managed).some((a) => (
        a.worldId === id && a.profile === WORLD_DESIGNER_PROFILE && a.state !== 'exited' && a.state !== 'crashed' && a.state !== 'lost' && a.state !== 'closed'
      )),
    };
  };
  const ranked = worldList.sort((a, b) => a.slot - b.slot).map((w) => worldVM(w.worldId)).filter((w): w is WorldVM => w !== null);
  const allWorlds = ranked.filter((w) => !w.belt);
  const beltWorlds = ranked.filter((w) => w.belt);
  const beltRow = beltGroup(beltWorlds, (w) => fleet.worlds[w.worldId]?.spendTodayUsd ?? null, (w) => rates.fleet?.perWorld[w.worldId] ?? 0);
  const worlds = [...allWorlds.filter((w) => w.rows.length > 0), ...(beltRow ? [beltRow] : [])];

  const decisions: DecisionVM[] = Object.values(fleet.approvals)
    .filter((a) => (a.status === 'open' || (a.answeredAt !== null && now - a.answeredAt < SETTLED_SHOWN_MS && a.answeredBy !== clientId)))
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((a) => {
      const craft = crafts[a.nodeId] ?? list.find((c) => c.agentId === a.agentId);
      const worldName = names(a.worldId);
      const settled = a.status === 'answered' ? 'ANSWERED ELSEWHERE' : a.status === 'withdrawn' ? 'WITHDRAWN' : a.status === 'expired' ? 'EXPIRED' : null;
      return {
        requestId: a.requestId,
        nodeId: craft?.id ?? a.nodeId,
        agentId: a.agentId,
        who: craft?.name ?? worldName,
        worldName,
        letter: craft?.letter ?? '',
        glyph: craft?.glyph ?? '',
        tool: veilTool(a.toolName, veil),
        age: ageClock(now - a.createdAt),
        ageMs: Math.max(0, now - a.createdAt),
        createdAt: a.createdAt,
        preview: approvalPreview(a, veil),
        danger: a.danger,
        status: a.status,
        note: settled ?? (linkUp ? null : COPY.cannotAnswer),
        tag: a.subagentId ? tenderTag(fleet, a, veil) : null,
      };
    });

  const sources: SourceVM[] = list
    .filter((c) => c.state === 'source' && now - c.waitingSince >= SOURCE_DEBOUNCE_MS)
    .sort((a, b) => a.waitingSince - b.waitingSince)
    .map((c) => {
      const activity = fleet.nodes[c.id]?.activity;
      return {
        nodeId: c.id, who: c.name, since: c.waitingSince, age: ageClock(now - c.waitingSince),
        reason: activity?.state === 'waiting' ? activity.reason : 'input needed', owner: c.linkOwner,
      };
    });

  const troubleLine = (c: CraftVM): string => {
    const activity = fleet.nodes[c.id]?.activity;
    switch (c.state) {
      case 'errored': return activity?.state === 'errored' && activity.httpStatus ? `API ${activity.httpStatus}, read the error` : 'error, read it';
      case 'retrying': {
        if (activity?.state !== 'retrying') return 'retrying';
        const next = activity.nextAttemptAt ? `, next in ${ageWords(activity.nextAttemptAt - now)}` : '';
        return `retry ${activity.attempt} of ${activity.maxRetries}${next}`;
      }
      case 'no-budget': return 'out of budget';
      case 'parked': return 'parked';
      case 'crashed': return 'crashed';
      case 'lost': return 'lost, kernel restarted';
      case 'rate-limited': return c.metric ? `rate limited, ${c.metric}` : 'rate limited';
      default: return c.word.toLowerCase();
    }
  };
  const attentionRows = attentionOrder(list.filter((c) => c.inManifest || (c.tier < 6 && c.state !== 'orphaned')));
  const walkRows = attentionRows.filter((c) => c.visible);
  const trouble: TroubleVM[] = attentionRows
    .filter((c) => c.tier === 3 || c.tier === 5)
    .map((c) => ({ nodeId: c.id, who: c.name, line: troubleLine(c), state: c.state, mark: c.mark, tone: c.tone }));
  const low: LowVM[] = list
    .filter((c) => c.contextFrac !== null && c.contextFrac >= LOW_CONTEXT && c.live && c.tier !== 1)
    .sort((a, b) => (b.contextFrac ?? 0) - (a.contextFrac ?? 0))
    .map((c) => ({ nodeId: c.id, who: c.name, line: c.contextUsed }));

  const landedRows = [...landedBy.entries()].map(([worldId, entry]) => ({ worldId, ...entry }));
  const landed: LandedVM[] = foldBelt(landedRows, beltWorlds, (a, b) => ({ ...a, lit: a.lit + b.lit, failed: a.failed + b.failed }))
    .map(({ worldId, lit, failed }) => ({
      worldId, name: worldId === BELT_GROUP ? BELT_NAME : names(worldId), lit, failed, line: failed > 0 ? `${lit} lit, ${failed} failed` : `${lit} lit`,
    }))
    .sort((a, b) => b.lit + b.failed - a.lit - a.failed);

  const openCount = decisions.filter((d) => d.status === 'open').length;
  const manifestRows = worlds.flatMap((w) => w.rows);
  const idle = manifestRows.filter((r) => r.type === 'craft' && (r.craft.state === 'idle' || r.craft.state === 'idle-shell')).length;
  const faults = list.filter((c) => isFault(c.state) && !c.acked).length;
  const retry = list.filter((c) => c.state === 'retrying').length;
  const lowLit = list.filter((c) => c.contextFrac !== null && c.contextFrac >= LOW_CONTEXT && c.live).length;
  const limited = fleet.plan?.status === 'rejected' || fleet.admission.frozen !== null;
  const indexing = fleet.index.stage !== 'done' && fleet.index.total > 0;
  const sensorRecent = input.sensorChangedAt !== null && now - input.sensorChangedAt < SENSOR_LIT_MS;
  const lamps: LampVM[] = [
    { id: 'you', count: openCount, lit: openCount > 0, note: null },
    { id: 'source', count: sources.length, lit: sources.length > 0, note: null },
    { id: 'fault', count: faults, lit: faults > 0, note: null },
    { id: 'retry', count: retry, lit: retry > 0, note: null },
    { id: 'low', count: lowLit, lit: lowLit > 0, note: null },
    { id: 'limit', count: 0, lit: limited, note: null },
    { id: 'sensor', count: 0, lit: indexing || sensorRecent, note: indexing ? `ALMANAC ${Math.round((fleet.index.done / fleet.index.total) * 100)} %` : null },
  ];

  const open = decisions.find((d) => d.status === 'open');
  const openCraft = open ? crafts[open.nodeId] : undefined;
  const need = openCraft ? STATE_SPOKEN[openCraft.state] : 'needs approval';
  const title = open ? `(${openCount}) NAOS, ${open.worldName} ${need}` : 'NAOS';

  const live = list.filter((c) => c.live);
  const away: AwayVM[] = [];
  if (live.length === 0) {
    for (const m of Object.values(fleet.managed)) {
      if (m.resumable) {
        const craft = crafts[m.nodeId];
        away.push({ kind: 'resume', nodeId: m.nodeId, line: `${craft?.name ?? names(m.worldId)}, exited${m.endedAt ? ` ${clock(m.endedAt)}` : ''}` });
      }
    }
    for (const run of Object.values(fleet.workflows)) {
      if (run.status === 'orphaned') {
        const session = fleet.sessions[run.sessionId];
        away.push({ kind: 'salvage', nodeId: session?.rootNodeId ?? null, line: `${session ? names(session.worldId) : 'unknown'} run, owner gone` });
      }
    }
    for (const w of allWorlds) {
      for (const moon of w.moonNames) away.push({ kind: 'review', nodeId: null, line: `worktree ${moon}` });
    }
  }

  const rate = rates.fleet;
  const adm = fleet.admission;
  return {
    worlds,
    allWorlds,
    beltWorlds,
    crafts,
    walk: walkRows.map((c) => c.id),
    decisions,
    sources,
    trouble,
    low,
    landed,
    landedTotal: landed.reduce((a, l) => a + l.lit + l.failed, 0),
    tape: buildTape(input, crafts, names),
    lamps,
    sun: buildSun(fleet, now),
    ephemeris: {
      tps: rate?.tps ?? 0,
      burn: rate?.burnUsdPerHour ?? 0,
      today: rate?.todayUsd ?? null,
      resets: resetsLabel(fleet.plan?.resetsAt.fiveHour, now),
      ownedRun: adm.running,
      ownedLimit: adm.runningLimit,
      ownedAlive: adm.alive,
      aliveLimit: adm.aliveLimit,
      lagMs: rate?.lagMaxMs ?? 0,
    },
    craftCount: live.length,
    run: manifestRows.length - idle,
    idle,
    pad: adm.queued.length,
    derelict: list.filter((c) => c.state === 'orphaned').length,
    ownedLine: `owned ${adm.alive} of ${adm.aliveLimit} alive`,
    ownedCount: list.filter((c) => c.owned && c.live).length,
    almanac: live.length === 0 ? buildAlmanac(input, names) : [],
    away,
    mirror: live.map((c) => c.spoken),
    title,
    badge: openCount,
    veil,
    now,
    kernelMode: fleet.kernel?.mode ?? null,
    observerOnly: fleet.kernel?.controlPlane === false,
    sessionsEnded: list.filter((c) => !c.live && c.kind === 'main'),
  };
}

export interface ChannelRowVM {
  key: string;
  time: string;
  kind: ChannelRow['kind'];
  label: string;
  /** Right column in the rail, middle column when wide. */
  body: string;
  extra: string;
  /** Sealed text row: true length in chars. */
  sealedChars: number | null;
  error: boolean;
  messageId: string | null;
}

/** Text of a Channel row. Tool targets pass through the Veil, and the rail takes only the file name. */
export function channelRowVM(row: ChannelRow, opts: { veil: boolean; wide: boolean; now: number; openTools: readonly string[]; crafts: Model['crafts'] }): ChannelRowVM {
  const base = { time: clock(row.at, true), kind: row.kind, sealedChars: null, error: false, messageId: null, extra: '' };
  switch (row.kind) {
    case 'turn': return { ...base, key: `turn-${row.n}-${row.at}`, label: `turn ${row.n}`, body: row.origin === 'human' ? 'from you' : `from ${row.origin}` };
    case 'thinking': return { ...base, key: `think-${row.at}-${row.block ?? 0}`, label: 'thinking', body: opts.wide ? `~${row.tokens} tokens, text hidden` : `~${row.tokens} tok` };
    case 'text': return {
      ...base, key: `text-${row.messageId}`, label: 'text', messageId: row.messageId, sealedChars: row.chars,
      body: row.tokens === null ? `${row.chars} ch` : `~${row.tokens} tok`,
    };
    case 'tool': {
      const open = row.durationMs === null && opts.openTools.includes(row.toolUseId);
      const raw = toolTarget(row.summary, opts.veil);
      const target = opts.veil || opts.wide ? raw : shortTarget(raw);
      const delta = row.summary.plus !== undefined ? `+${row.summary.plus} -${row.summary.minus ?? 0}` : '';
      const time = open ? `running ${ageFine(opts.now - row.at)}` : row.durationMs !== null ? ageFine(row.durationMs) : '';
      const verdict = row.isError ? 'failed' : row.decision === 'accept' ? 'approved' : row.decision === 'reject' ? 'denied' : '';
      // The rail is narrow: a shell row keeps its time, and the command shows when the Channel is wide.
      const body = opts.wide ? target : delta || (row.family === 'shell' ? '' : target);
      return { ...base, key: `tool-${row.toolUseId}`, error: row.isError, label: veilTool(row.name, opts.veil), body, extra: [opts.wide ? delta : '', time, verdict].filter(Boolean).join('  ') };
    }
    case 'tender': return { ...base, key: `tender-${row.nodeId}-${row.status}`, label: 'tender', body: `${opts.veil ? 'tender' : (row.agentType ?? 'agent')} ${row.status}` };
    case 'error': return { ...base, key: `err-${row.at}`, label: 'error', body: row.label, error: true };
    default: return { ...base, key: 'unknown', label: 'row', body: '' };
  }
}

/** A copy that is safe for a veiled card. Docket code reads decisions only through this, so `V` hold is one deliberate call. */
export function veiledApproval(a: ApprovalView): ApprovalView {
  return { ...a, input: {}, displayName: null, description: null, title: null, blockedPath: null, decisionReason: null, mcpServer: a.mcpServer ? { name: 'server', source: a.mcpServer.source } : null };
}

export { isAnswerable };
