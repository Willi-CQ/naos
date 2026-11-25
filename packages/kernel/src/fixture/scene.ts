// The cast of docs/design/naos-system.png. Every name here is a placeholder, and every time hangs off one fixed epoch, so
// a state at time t is the same in every process. Seek to REFERENCE_T for the reference scene.
import { createHash } from 'node:crypto';
import { identityForRepo, makeNodeId } from '@naos/protocol';
import type {
  CostEstimate, EpochMs, ManagedAgentView, ObservedAgentNode, ObservedSession, ProfileView, TokenUsage, World, WorldId,
} from '@naos/protocol';

/** 14:05:23 in Europe/Berlin on the day the fixture was written, so t = 60 reads 14:06:23 like the reference. */
export const FIXTURE_EPOCH: EpochMs = Date.UTC(2026, 9, 31, 13, 5, 23);
export const DURATION_S = 180;
export const REFERENCE_T = 60;
export const VEIL_SALT = 'fixture-veil-salt';

export const MODEL = { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5' } as const;

const hex = (seed: string): string => createHash('sha256').update(`naos-fixture:${seed}`).digest('hex');

export function uuidOf(seed: string): string {
  const h = hex(seed);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Workflow agent ids are 17 hex on disk. */
export const agentIdOf = (seed: string): string => hex(seed).slice(0, 17);

export const worldIdOf = (name: string): WorldId => hex(`world:${name}`).slice(0, 16);

export const usage = (over: Partial<TokenUsage> = {}): TokenUsage => ({
  input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, webSearchRequests: 0, messages: 0, partialOutputMessages: 0, ...over,
});

export const cost = (usd: number, lowerBound = false): CostEstimate => ({
  usd, estimateUsd: usd, costStateUsd: null, isEstimate: true, isLowerBound: lowerBound, unpricedModels: [],
});

export interface WorldDef {
  description?: string;
  name: string;
  slot: number;
  spendTodayUsd: number;
  lastActiveMinAgo: number;
  trusted: boolean;
  worktrees?: Array<{ name: string; branch: string }>;
}

export const WORLDS: WorldDef[] = [
  { name: 'kestrel', slot: 1, spendTodayUsd: 4.2, lastActiveMinAgo: 0, trusted: true, worktrees: [{ name: 'types', branch: 'naos/migrate-types' }] },
  { name: 'tundra', description: 'Benchmark evaluation and analytics observatory', slot: 2, spendTodayUsd: 1.1, lastActiveMinAgo: 0, trusted: false },
  { name: 'harbor', slot: 3, spendTodayUsd: 5.3, lastActiveMinAgo: 0, trusted: true },
  { name: 'mosaic', description: 'Creative visual design and shader rendering studio', slot: 4, spendTodayUsd: 0.7, lastActiveMinAgo: 0, trusted: true },
  { name: 'lumen', description: 'Knowledge retrieval and document memory', slot: 5, spendTodayUsd: 0.1, lastActiveMinAgo: 0, trusted: false },
  { name: 'quill', slot: 6, spendTodayUsd: 0, lastActiveMinAgo: 2880, trusted: false },
  { name: 'ferro', description: 'Construction and architectural engineering', slot: 7, spendTodayUsd: 0, lastActiveMinAgo: 8640, trusted: false },
];

export const rootOf = (name: string): string => `/fixture/${name}`;

export function makeWorld(def: WorldDef, mass: { usd: number; bytes: number; lit: number; failed: number }, base: EpochMs): World {
  return {
    worldId: worldIdOf(def.name),
    projectRoot: rootOf(def.name),
    name: def.name,
    identity: identityForRepo(def.name, def.description),
    slot: def.slot,
    kind: 'repo',
    isGit: true,
    trusted: def.trusted,
    massBytes: mass.bytes,
    massUsd30d: Math.round(mass.usd * 100) / 100,
    spendTodayUsd: def.spendTodayUsd,
    lightsTotal: mass.lit + mass.failed,
    lightsFailed: mass.failed,
    lastActiveAt: base - def.lastActiveMinAgo * 60_000,
    worktrees: (def.worktrees ?? []).map((tree) => ({ path: `${rootOf(def.name)}/.claude/worktrees/${tree.name}`, ...tree })),
  };
}

export interface CraftDef {
  key: string;
  world: string;
  title: string;
  owned: boolean;
  /** Seconds before t = 0. Launch order inside a world gives the Greek letter. */
  ageS: number;
  model: string;
  effort?: string;
  profile?: string;
  budgetUsd?: number;
  usd: number;
  contextTokens: number;
  branch?: string;
  worktree?: string;
  /** Seconds of flush lag on records. Owned craft have none. */
  lagS?: number;
  liveness?: ObservedSession['liveness'];
  version?: string;
  entrypoint?: string;
  client?: 'claude-code' | 'codex' | 'cursor';
}

/** The fourteen hulls with a session at t = 0. Five beads and one tender make twenty. */
export const CRAFT: CraftDef[] = [
  { key: 'k.a', world: 'kestrel', title: 'rate limiter', owned: true, ageS: 1800, model: MODEL.opus, effort: 'high', profile: 'build', budgetUsd: 4, usd: 1.42, contextTokens: 214_000, branch: 'naos/rate-limiter' },
  { key: 'k.b', world: 'kestrel', title: 'fix flaky queue', owned: true, ageS: 1500, model: MODEL.sonnet, effort: 'medium', profile: 'build', budgetUsd: 3, usd: 0.91, contextTokens: 356_000, branch: 'naos/flaky-queue' },
  { key: 'k.c', world: 'kestrel', title: 'docs sweep', owned: true, ageS: 1100, model: MODEL.sonnet, effort: 'high', profile: 'plan', budgetUsd: 2, usd: 0.77, contextTokens: 148_000, branch: 'main' },
  { key: 'k.d', world: 'kestrel', title: 'migrate types', owned: true, ageS: 900, model: MODEL.opus, effort: 'high', profile: 'long', budgetUsd: 6, usd: 1.1, contextTokens: 812_000, branch: 'naos/migrate-types', worktree: 'types' },
  { key: 't.a', world: 'tundra', title: 'ledger pass', owned: false, ageS: 2400, model: 'gpt-6.1-sol', client: 'codex', usd: 0.64, contextTokens: 304_000, branch: 'main', lagS: 1.3 },
  { key: 't.b', world: 'tundra', title: 'audit callers', owned: false, ageS: 2100, model: MODEL.sonnet, client: 'cursor', usd: 0.38, contextTokens: 192_000, branch: 'audit', lagS: 1.1 },
  { key: 't.c', world: 'tundra', title: 'changelog', owned: false, ageS: 1900, model: MODEL.haiku, usd: 0.08, contextTokens: 61_000, branch: 'main', lagS: 0.8 },
  { key: 'h.a', world: 'harbor', title: 'invoice migrate', owned: true, ageS: 2600, model: MODEL.opus, effort: 'high', profile: 'orchestrator', budgetUsd: 8, usd: 3.05, contextTokens: 503_000, branch: 'naos/invoices' },
  { key: 'm.a', world: 'mosaic', title: 'tile cache', owned: true, ageS: 1400, model: MODEL.sonnet, effort: 'medium', profile: 'build', budgetUsd: 0.8, usd: 0.34, contextTokens: 128_000, branch: 'naos/tile-cache' },
  { key: 'm.b', world: 'mosaic', title: 'shader pass', owned: true, ageS: 1300, model: MODEL.sonnet, effort: 'medium', profile: 'build', budgetUsd: 2, usd: 0.21, contextTokens: 88_000, branch: 'naos/shader-pass' },
  { key: 'm.c', world: 'mosaic', title: 'bundle size', owned: true, ageS: 1200, model: MODEL.haiku, effort: 'low', profile: 'scratch', budgetUsd: 1, usd: 0.15, contextTokens: 42_000, branch: 'naos/bundle-size' },
  { key: 'l.a', world: 'lumen', title: 'offline sync', owned: false, ageS: 1000, model: 'gpt-6-astra', client: 'cursor', usd: 0.06, contextTokens: 36_000, branch: 'main', lagS: 1.2, entrypoint: 'Cursor' },
  { key: 'l.b', world: 'lumen', title: 'lint fixes', owned: false, ageS: 800, model: 'gpt-6-luna', client: 'codex', usd: 0.03, contextTokens: 24_000, branch: 'lint', lagS: 0.9 },
  { key: 'l.x', world: 'lumen', title: 'old probe', owned: false, ageS: 700, model: MODEL.haiku, usd: 0.01, contextTokens: 9_000, branch: 'main', lagS: 0.5, liveness: 'dead' },
];

export function makeSession(def: CraftDef, base: EpochMs, activity: ObservedSession['activity']): ObservedSession {
  const sessionId = uuidOf(def.key);
  const root = rootOf(def.world);
  const startedAt = base - def.ageS * 1000;
  const spent = cost(def.usd);
  const tokens = usage({ input: Math.round(def.usd * 90_000), output: Math.round(def.usd * 18_000), messages: Math.ceil(def.usd * 40) });
  const worktree = def.worktree ? { path: `${root}/.claude/worktrees/${def.worktree}`, name: def.worktree, branch: def.branch } : null;
  return {
    sessionId,
    origin: def.owned ? 'control' : 'observer',
    source: { client: def.client ?? 'claude-code', nativeSessionId: sessionId, transport: def.owned ? 'stream' : 'disk',
      capabilities: def.owned ? ['activity', 'tools', 'tokens', 'context', 'cost', 'hierarchy', 'text', 'steer', 'stop', 'approve'] : ['activity', 'tools', 'tokens', 'context', 'hierarchy'] },
    worldId: worldIdOf(def.world),
    title: def.title,
    titleSource: def.owned ? 'custom' : 'ai',
    displayName: null,
    projectRoot: root,
    startCwd: worktree?.path ?? root,
    currentCwd: worktree?.path ?? root,
    worktree,
    gitBranch: def.branch ?? null,
    slugs: [`fixture-${def.world}`],
    transcriptPath: `/fixture/transcripts/${sessionId}.jsonl`,
    transcriptBytes: Math.round(def.usd * 2_400_000),
    pid: 40_000 + (parseInt(sessionId.slice(0, 4), 16) % 20_000),
    liveness: def.liveness ?? 'alive',
    kind: def.owned ? 'bg' : 'interactive',
    entrypoint: def.entrypoint ?? (def.owned ? 'sdk' : 'cli'),
    version: def.version ?? '2.1.314',
    pidStatus: def.liveness === 'dead' ? null : 'busy',
    remoteControlled: false,
    acceptsPeerMessages: false,
    activity,
    queuedInputs: 0,
    model: def.model,
    requestedModel: def.model,
    effort: def.effort ?? null,
    permissionMode: 'default',
    startedAt,
    lastRecordAt: base - 400,
    lastWriteAt: base - 400,
    endedAt: null,
    usage: tokens,
    usageTree: tokens,
    cost: spent,
    contextTokens: def.contextTokens,
    contextWindow: 1_000_000,
    blockedMs: 0,
    rootNodeId: makeNodeId(sessionId),
    agentCount: 0,
    runningAgentCount: 0,
    workflowRunIds: [],
    lastRateLimit: null,
  };
}

export function makeManaged(def: CraftDef, base: EpochMs): ManagedAgentView {
  const sessionId = uuidOf(def.key);
  const root = rootOf(def.world);
  const worktree = def.worktree ? { path: `${root}/.claude/worktrees/${def.worktree}`, name: def.worktree, branch: def.branch ?? 'main' } : null;
  const startedAt = base - def.ageS * 1000;
  return {
    agentId: `ag_${def.key.replace('.', '')}`,
    sessionId,
    nodeId: sessionId,
    worldId: worldIdOf(def.world),
    projectRoot: root,
    cwd: worktree?.path ?? root,
    profile: def.profile ?? 'build',
    title: `naos:${def.title}`,
    model: def.model,
    effort: def.effort ?? null,
    permissionMode: 'default',
    parentAgentId: null,
    rootAgentId: `ag_${def.key.replace('.', '')}`,
    depth: 0,
    missionId: null,
    state: 'running',
    stopStep: null,
    openApprovals: 0,
    failure: null,
    budgetUsd: def.budgetUsd ?? 2,
    spentUsd: def.usd,
    treeBudgetUsd: null,
    treeSpentUsd: null,
    turn: 3,
    maxTurns: null,
    toolCalls: Math.ceil(def.usd * 30),
    toolErrors: 0,
    queuedSends: 0,
    lastTerminalReason: null,
    lastTurnAborted: false,
    ttftMs: 840,
    subagentStats: null,
    contextTokens: def.contextTokens,
    contextWindow: 1_000_000,
    worktree,
    pid: 40_000 + (parseInt(sessionId.slice(0, 4), 16) % 20_000),
    createdAt: startedAt - 1260,
    startedAt,
    endedAt: null,
    resumable: false,
  };
}

export interface AgentNodeDef {
  key: string;
  parent: ObservedSession;
  kind: 'subagent' | 'workflow-agent';
  agentType: string;
  name: string | null;
  model: string;
  startedAt: EpochMs;
  linkedBy: ObservedAgentNode['linkedBy'];
  workflow?: ObservedAgentNode['workflow'];
}

export function makeAgentNode(def: AgentNodeDef): ObservedAgentNode {
  const agentId = agentIdOf(def.key);
  return {
    nodeId: makeNodeId(def.parent.sessionId, agentId),
    sessionId: def.parent.sessionId,
    kind: def.kind,
    agentId,
    parentNodeId: def.parent.rootNodeId,
    childNodeIds: [],
    linkedBy: def.linkedBy,
    parentToolUseId: `toolu_${agentIdOf(`${def.key}:use`)}`,
    spawnDepth: 1,
    agentType: def.agentType,
    name: def.name,
    description: `Placeholder description for ${def.key}`,
    model: def.model,
    effort: null,
    cwd: def.parent.currentCwd,
    worktreePath: null,
    worktreeBranch: null,
    background: def.kind === 'workflow-agent',
    workflow: def.workflow ?? null,
    transcriptPath: null,
    metaPath: null,
    transcriptBytes: 40_000,
    status: 'running',
    activity: { state: 'starting', since: def.startedAt },
    flushLagMs: null,
    startedAt: def.startedAt,
    lastRecordAt: def.startedAt,
    endedAt: null,
    usage: usage(),
    cost: cost(0),
    toolCalls: 0,
    errors: 0,
    lastToolName: null,
  };
}

export const PROFILES: ProfileView[] = [
  { name: 'build', description: 'Placeholder role: makes the change', model: MODEL.sonnet, effort: 'medium', permissionMode: 'default', defaultBudgetUsd: 2, worktree: true, tools: null, orchestrator: false, source: 'agents/build.md' },
  { name: 'recon', description: 'Placeholder role: reads and reports', model: MODEL.haiku, effort: 'low', permissionMode: 'dontAsk', defaultBudgetUsd: 0.5, worktree: false, tools: ['Read', 'Glob', 'Grep'], orchestrator: false, source: 'agents/recon.md' },
  { name: 'analyst', description: 'Placeholder role: read only analysis', model: MODEL.opus, effort: 'high', permissionMode: 'plan', defaultBudgetUsd: 1, worktree: false, tools: ['Read', 'Glob', 'Grep'], orchestrator: false, source: 'agents/analyst.md' },
  { name: 'long', description: 'Placeholder role: long running work', model: MODEL.opus, effort: 'high', permissionMode: 'default', defaultBudgetUsd: 6, worktree: true, tools: null, orchestrator: false, source: 'agents/long.md' },
  { name: 'plan', description: 'Placeholder role: plans first', model: MODEL.sonnet, effort: 'high', permissionMode: 'plan', defaultBudgetUsd: 1, worktree: false, tools: null, orchestrator: false, source: 'agents/plan.md' },
  { name: 'orchestrator', description: 'Placeholder role: prompts other agents', model: MODEL.opus, effort: 'high', permissionMode: 'default', defaultBudgetUsd: 8, worktree: false, tools: null, orchestrator: true, source: 'agents/orchestrator.md' },
  { name: 'scratch', description: 'Placeholder role: throwaway work', model: MODEL.haiku, effort: 'low', permissionMode: 'default', defaultBudgetUsd: 0.25, worktree: false, tools: null, orchestrator: false, source: 'agents/scratch.md' },
];
