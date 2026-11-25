// What the fleet engine is told, four times a second. Pure, free of three and of every name: the store's model gives the state, and
// FleetState gives the structure a row does not hold. The bench writes the same shape by hand, so both draw through one engine.
import { sessionSource, type EpochMs, type FleetState, type SessionClient, type ToolFamily } from '@naos/protocol';
import type { VisualState } from '../core/state.ts';

export type CraftRole = 'vessel' | 'tender' | 'bead';

export interface RosterTool { id: string; family: ToolFamily; /** A call to the kernel's own server beams at the star. */ toStar: boolean; startedAt: EpochMs }

export interface RosterCraft {
  id: string;
  client?: SessionClient;
  model?: string | null;
  agentType?: string | null;
  profile?: string | null;
  worldId: string;
  role: CraftRole;
  parentId: string | null;
  /** Place among the parent's children. */
  order: number;
  depth: number;
  owned: boolean;
  state: VisualState;
  altitude: number;
  tps: number;
  /** Output tokens so far: the craft's place on its orbit before any motion was seen. */
  tokens: number;
  tier: number;
  danger: boolean;
  /** When the activity began. */
  since: EpochMs;
  tools: RosterTool[];
  /** Start and end of the countdown arc of a retry or a rate limit. */
  countdown: { from: EpochMs; to: EpochMs } | null;
  /** Budget left, 0..1. Owned only. */
  fuel: number | null;
  queued: number;
  /** Moon path, for a craft in a worktree. */
  moon: string | null;
  acked: boolean;
  /** Bead: run, phase index, attempt. */
  workflow: { runId: string; phase: number; attempt: number } | null;
  /** Index on the Pad. */
  pad: number | null;
}

export interface RosterHoop { worldId: string; runId: string; index: number; status: 'running' | 'orphaned' }

export interface Roster {
  crafts: RosterCraft[];
  hoops: RosterHoop[];
}

/** The part of a row the engine reads. `CraftVM` has more, and the rest stays out of the scene on purpose. */
export interface RosterRow {
  client?: SessionClient;
  visible?: boolean;
  id: string; worldId: string; kind: string; owned: boolean; agentId: string | null; state: VisualState; altitude: number; tps: number; outputTokens: number;
  tier: number; danger: boolean; queued: number; acked: boolean; parentId: string | null; live: boolean; waitingSince: number;
}

const ROLE: Record<string, CraftRole> = { main: 'vessel', subagent: 'tender', teammate: 'tender', 'workflow-agent': 'bead' };

export function rosterOf(rows: Readonly<Record<string, RosterRow>>, fleet: FleetState): Roster {
  const crafts: RosterCraft[] = [];
  const padAt = new Map(fleet.admission.queued.map((id, i) => [id, i]));
  for (const row of Object.values(rows)) {
    if (row.visible === false) continue;
    const node = fleet.nodes[row.id];
    const session = node ? fleet.sessions[node.sessionId] : undefined;
    const managed = row.agentId ? fleet.managed[row.agentId] : undefined;
    const activity = node?.activity ?? session?.activity;
    const tools: RosterTool[] = activity?.state === 'tool_running'
      ? activity.tools.map((t) => ({ id: t.toolUseId, family: t.family, toStar: /^mcp__(os|naos)__/.test(t.name), startedAt: t.startedAt }))
      : [];
    const since = activity?.since ?? row.waitingSince;
    let countdown: RosterCraft['countdown'] = null;
    if (activity?.state === 'retrying' && activity.nextAttemptAt) countdown = { from: since, to: activity.nextAttemptAt };
    if (row.state === 'rate-limited') {
      const to = activity?.state === 'errored' ? activity.resetsAt : session?.lastRateLimit?.resetsAt;
      if (to) countdown = { from: since, to };
    }
    const wf = node?.workflow;
    const run = wf ? fleet.workflows[wf.runId] : undefined;
    const parent = node?.parentNodeId ? fleet.nodes[node.parentNodeId] : undefined;
    crafts.push({
      id: row.id,
      client: row.client ?? (session ? sessionSource(session).client : 'claude-code'),
      model: node?.model ?? session?.model ?? managed?.model,
      agentType: node?.agentType,
      profile: managed?.profile,
      worldId: row.worldId,
      role: ROLE[row.kind] ?? 'tender',
      parentId: row.parentId,
      order: Math.max(0, parent?.childNodeIds.indexOf(row.id) ?? 0),
      depth: node?.spawnDepth ?? 0,
      owned: row.owned,
      state: row.state,
      altitude: row.altitude,
      tps: row.tps,
      tokens: row.outputTokens,
      tier: row.tier,
      danger: row.danger,
      since,
      tools,
      countdown,
      fuel: managed && managed.budgetUsd > 0 ? Math.max(0, 1 - managed.spentUsd / managed.budgetUsd) : null,
      queued: row.queued,
      moon: session?.worktree?.path ?? managed?.worktree?.path ?? null,
      acked: row.acked,
      workflow: wf && run ? { runId: wf.runId, phase: Math.max(0, run.phases.findIndex((p) => p.title === wf.phase)), attempt: wf.attempt } : null,
      pad: managed ? padAt.get(managed.agentId) ?? null : null,
    });
  }
  const hoops: RosterHoop[] = [];
  for (const run of Object.values(fleet.workflows)) {
    if (run.status !== 'running' && run.status !== 'orphaned') continue;
    const session = fleet.sessions[run.sessionId];
    if (!session) continue;
    if (rows[session.rootNodeId]?.visible === false) continue;
    for (const phase of run.phases) hoops.push({ worldId: session.worldId, runId: run.runId, index: phase.index, status: run.status });
  }
  return { crafts, hoops };
}

/** What changes the picture when it rests. Tokens and rates are out of it: while those move, the cadence is already drawing. */
export function rosterKey(r: Roster): string {
  let key = '';
  for (const c of r.crafts) key += `${c.id}:${c.state}:${c.tools.length}:${c.queued}:${c.acked ? 1 : 0}|`;
  return key + r.hoops.length;
}
