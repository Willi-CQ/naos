import { CLIENT_NAME, sessionKey, type Activity, type CostEstimate, type HistoryDigest, type ObservedAgentNode, type ObservedSession, type PlanState, type SessionCapability, type SessionClient, type TokenUsage } from '@naos/protocol';
import type { KernelContext } from '../context.ts';
import { resolveProject } from '../observer/project.ts';
import { SalvoDetector } from '../observer/salvo.ts';

export const zeroUsage = (): TokenUsage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, webSearchRequests: 0, messages: 0, partialOutputMessages: 0 });
export const unknownCost = (model: string | null): CostEstimate => ({ usd: 0, estimateUsd: 0, costStateUsd: null, isEstimate: true, isLowerBound: true, unpricedModels: model ? [model] : [] });

export interface SourceSnapshot {
  plan?: PlanState;
  nativeId: string;
  parentId: string | null;
  cwd: string | null;
  model: string | null;
  effort: string | null;
  version: string | null;
  startedAt: number;
  updatedAt: number;
  activity: Activity;
  usage: TokenUsage;
  contextTokens: number | null;
  contextWindow: number | null;
  contextFraction?: number | null;
  branch: string | null;
  bytes: number;
  path: string | null;
  agentType: string | null;
  toolCalls: number;
  errors: number;
  capabilities: SessionCapability[];
}

export function blankSnapshot(nativeId: string, at: number): SourceSnapshot {
  return { nativeId, parentId: null, cwd: null, model: null, effort: null, version: null, startedAt: at, updatedAt: at,
    activity: { state: 'unknown', since: at }, usage: zeroUsage(), contextTokens: null, contextWindow: null, branch: null,
    bytes: 0, path: null, agentType: null, toolCalls: 0, errors: 0, capabilities: ['activity'] };
}

export class SourcePublisher {
  private readonly sent = new Map<string, { signature: string; output: number; at: number }>();
  private readonly owners = new Map<string, string>();
  private readonly salvos = new SalvoDetector();
  private readonly ctx: KernelContext;
  private readonly client: SessionClient;

  constructor(ctx: KernelContext, client: SessionClient) {
    this.ctx = ctx; this.client = client;
    ctx.db.exec('CREATE TABLE IF NOT EXISTS source_history (node_id TEXT PRIMARY KEY, client TEXT NOT NULL, last_at REAL NOT NULL, data TEXT NOT NULL)');
    ctx.db.exec('CREATE TABLE IF NOT EXISTS obs_salvo (salvo_id TEXT PRIMARY KEY, opened_at REAL NOT NULL, data TEXT NOT NULL)');
  }

  publish(snapshots: readonly SourceSnapshot[], now: number): void {
    const byId = new Map(snapshots.map((s) => [s.nativeId, s]));
    const rootOf = (s: SourceSnapshot): SourceSnapshot | null => {
      const seen = new Set<string>();
      let at = s;
      while (at.parentId) {
        if (seen.has(at.nativeId)) return null;
        seen.add(at.nativeId);
        const parent = byId.get(at.parentId);
        if (!parent) return at;
        at = parent;
      }
      return at;
    };
    const ordered = [...snapshots].sort((a, b) => Number(a.parentId !== null) - Number(b.parentId !== null) || a.startedAt - b.startedAt);
    for (const original of ordered) {
      const root = rootOf(original);
      if (!root) continue;
      const child = root.nativeId !== original.nativeId;
      const s = now - original.updatedAt > 120_000 && (original.activity.state === 'generating' || original.activity.state === 'tool_running')
        ? { ...original, activity: { state: 'unknown' as const, since: original.updatedAt } } : original;
      const project = resolveProject(root.cwd);
      const oldWorld = project.root ? this.ctx.worlds.find(project.root) : undefined;
      const world = this.ctx.worlds.ensure(project.root, { kind: project.kind, isGit: project.isGit,
        lastActiveAt: Math.max(oldWorld?.lastActiveAt ?? 0, s.updatedAt) });
      const sessionId = sessionKey(this.client, root.nativeId);
      const nodeId = child ? `${sessionId}/${s.nativeId}` : sessionId;
      // A native stream owns its main thread. Disk observations can still discover its children.
      if (!child && this.ctx.bus.state().sessions[sessionId]?.origin === 'control') continue;
      const former = this.owners.get(s.nativeId);
      if (former && former !== nodeId) {
        if (this.ctx.bus.state().sessions[former]) this.ctx.bus.publish({ type: 'fleet.evicted', sessionIds: [former] });
        this.ctx.bus.publish({ type: 'history.expired', nodeIds: [former] });
        this.ctx.bus.clearRate(former);
        this.ctx.db.run('DELETE FROM source_history WHERE node_id = ?', former);
        this.sent.delete(former);
      }
      this.owners.set(s.nativeId, nodeId);
      const signature = JSON.stringify(s);
      const was = this.sent.get(nodeId);
      if (was?.signature === signature) continue;
      const cost = unknownCost(s.model);
      const digest: HistoryDigest = { ...sourceDigest(this.client, s, world.worldId, project.root), nodeId, sessionId,
        kind: child ? 'subagent' : 'main',
        parentNodeId: child && s.parentId ? (byId.get(s.parentId)?.parentId ? `${sessionId}/${s.parentId}` : sessionId) : null,
        endedAt: child && s.activity.state === 'idle' ? s.updatedAt : null,
        outcome: child && s.activity.state === 'idle' ? 'clean' : 'unknown' };
      this.ctx.db.run('INSERT INTO source_history (node_id, client, last_at, data) VALUES (?, ?, ?, ?) ON CONFLICT(node_id) DO UPDATE SET last_at=excluded.last_at, data=excluded.data', nodeId, this.client, s.updatedAt, JSON.stringify(digest));
      this.ctx.bus.publish({ type: 'history.digest', rows: [digest] });
      if (s.plan) this.ctx.bus.publish({ type: 'source.plan.changed', client: this.client, plan: s.plan });
      if (!child) {
        const session: ObservedSession = {
          sessionId, source: { client: this.client, nativeSessionId: s.nativeId, transport: 'disk', capabilities: s.capabilities },
          origin: 'observer', worldId: world.worldId, title: `${CLIENT_NAME[this.client]} session`, titleSource: 'custom', displayName: null,
          projectRoot: project.root, startCwd: s.cwd, currentCwd: s.cwd, worktree: project.worktree, gitBranch: s.branch, slugs: [],
          transcriptPath: s.path, transcriptBytes: s.bytes, pid: null, liveness: 'unknown', kind: 'interactive', entrypoint: CLIENT_NAME[this.client],
          version: s.version, pidStatus: null, remoteControlled: false, acceptsPeerMessages: null, activity: s.activity, queuedInputs: 0,
          model: s.model, requestedModel: s.model, effort: s.effort, permissionMode: null, startedAt: s.startedAt, lastRecordAt: s.updatedAt,
          lastWriteAt: s.updatedAt, endedAt: null, usage: s.usage, usageTree: s.usage, cost, contextTokens: s.contextTokens,
          contextWindow: s.contextWindow, contextUsageFraction: s.contextFraction, blockedMs: 0, rootNodeId: nodeId,
          agentCount: 0, runningAgentCount: 0, workflowRunIds: [], lastRateLimit: null,
        };
        if (this.ctx.bus.state().sessions[sessionId]) this.ctx.bus.publish({ type: 'session.changed', sessionId, nodeId, patch: session, at: s.updatedAt });
        else this.ctx.bus.publish({ type: 'session.discovered', sessionId, nodeId, session, at: s.updatedAt });
        this.ctx.bus.publish({ type: 'agent.changed', sessionId, nodeId, at: s.updatedAt, patch: { toolCalls: s.toolCalls, errors: s.errors,
          flushLagMs: Math.max(0, now - s.updatedAt), lastToolName: s.activity.state === 'tool_running' ? s.activity.tools[0]?.name ?? null : null } });
      } else {
        if (!this.ctx.bus.state().sessions[sessionId]) continue;
        const parent = s.parentId ? byId.get(s.parentId) : undefined;
        const parentNodeId = parent?.parentId ? `${sessionId}/${parent.nativeId}` : sessionId;
        const previous = this.ctx.bus.state().nodes[nodeId];
        const node: ObservedAgentNode = {
          nodeId, sessionId, kind: 'subagent', agentId: s.nativeId, parentNodeId, childNodeIds: previous?.childNodeIds ?? [], linkedBy: 'parentAgentId', parentToolUseId: null,
          spawnDepth: this.depth(s, byId), agentType: s.agentType, name: null, description: null, model: s.model, effort: s.effort, cwd: s.cwd,
          worktreePath: project.worktree?.path ?? null, worktreeBranch: s.branch, background: true, workflow: null, transcriptPath: s.path,
          metaPath: null, transcriptBytes: s.bytes, status: s.activity.state === 'idle' ? 'completed' : 'running', activity: s.activity,
          flushLagMs: Math.max(0, now - s.updatedAt), startedAt: s.startedAt, lastRecordAt: s.updatedAt, endedAt: s.activity.state === 'idle' ? s.updatedAt : null,
          usage: s.usage, cost, toolCalls: s.toolCalls, errors: s.errors, lastToolName: s.activity.state === 'tool_running' ? s.activity.tools[0]?.name ?? null : null,
        };
        if (previous) this.ctx.bus.publish({ type: 'agent.changed', sessionId, nodeId, patch: node, at: s.updatedAt });
        else {
          this.ctx.bus.publish({ type: 'agent.started', sessionId, nodeId, node, at: s.startedAt });
          if (now - s.startedAt < 120_000) {
            const salvo = this.salvos.launch({ parentNodeId, group: this.client, nodeId, sessionId, worldId: world.worldId, source: 'subagent', observedAt: s.startedAt });
            if (salvo?.type === 'opened') this.ctx.bus.publish({ type: 'salvo.opened', salvo: salvo.salvo });
            else if (salvo?.type === 'joined') this.ctx.bus.publish({ type: 'salvo.joined', salvoId: salvo.salvoId, nodeId });
          }
        }
        if (previous && previous.endedAt === null && node.endedAt !== null) this.ctx.bus.publish({ type: 'agent.ended', sessionId, nodeId, status: 'completed', at: s.updatedAt });
      }
      this.ctx.bus.publish({ type: 'activity.changed', sessionId, nodeId, activity: s.activity, at: s.updatedAt });
      const delta = was ? Math.max(0, s.usage.output - was.output) : 0;
      const span = was ? Math.max(1, s.updatedAt - was.at) / 1000 : 1;
      this.ctx.bus.setRate({ nodeId, tps: delta > 0 && now - s.updatedAt < 5000 ? delta / span : 0, source: 'derived', liveBlock: null, outputTokens: s.usage.output });
      this.sent.set(nodeId, { signature, output: s.usage.output, at: s.updatedAt });
    }
    // A response flush is a sample, not a permanent streaming rate.
    for (const [nodeId, s] of this.sent) {
      if (now - s.at > 5000) this.ctx.bus.setRate({ nodeId, tps: 0, source: 'derived', liveBlock: null, outputTokens: s.output });
      const node = this.ctx.bus.state().nodes[nodeId];
      if (node && now - s.at > 120_000 && (node.activity.state === 'generating' || node.activity.state === 'tool_running')) {
        this.ctx.bus.publish({ type: 'activity.changed', sessionId: node.sessionId, nodeId, activity: { state: 'unknown', since: s.at }, at: s.at });
      }
    }
    for (const salvo of this.salvos.closeExpired(now)) {
      this.ctx.db.run('INSERT OR REPLACE INTO obs_salvo (salvo_id, opened_at, data) VALUES (?, ?, ?)', salvo.salvoId, salvo.openedAt, JSON.stringify(salvo));
      this.ctx.bus.publish({ type: 'salvo.closed', salvoId: salvo.salvoId });
    }
  }

  private depth(snapshot: SourceSnapshot, byId: ReadonlyMap<string, SourceSnapshot>): number {
    let depth = 0;
    let at: SourceSnapshot | undefined = snapshot;
    const seen = new Set<string>();
    while (at?.parentId && !seen.has(at.nativeId)) { seen.add(at.nativeId); at = byId.get(at.parentId); depth += 1; }
    return depth;
  }
}

export function sourceDigest(client: SessionClient, s: SourceSnapshot, worldId: string, projectRoot: string | null): HistoryDigest {
  const id = sessionKey(client, s.nativeId);
  return { nodeId: id, sessionId: id, worldId, projectRoot, kind: s.parentId ? 'subagent' : 'main', parentNodeId: s.parentId ? sessionKey(client, s.parentId) : null,
    startedAt: s.startedAt, endedAt: null, model: s.model, bytes: s.bytes, usd: null, blockedMs: null, outcome: 'unknown' };
}
