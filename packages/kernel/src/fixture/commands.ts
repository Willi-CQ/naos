// Every command a client can send, played plausibly. A command writes to the same bus the timeline drives, so the UI cannot
// tell them apart. Nothing here survives a seek or a loop: the timeline alone decides what a time shows.
import type {
  ChannelRow, CommandMap, ManagedAgentView, NaosEvent, NodeId, PreflightResult, SpawnSpec, TextRow, World,
} from '@naos/protocol';
import { FIRST_FLIGHT_PROFILE, WORLD_DESIGNER_PROFILE, sessionKey, validateGenome } from '@naos/protocol';
import { CommandError } from '../context.ts';
import type { Router } from '../context.ts';
import type { KernelBus } from '../bus.ts';
import { cleanWorldName } from '../worlds.ts';
import type { History } from './history.ts';
import { MODEL, PROFILES, makeManaged, makeSession, rootOf, uuidOf } from './scene.ts';

const SPAWN_FLIGHT_S = 1.26;
const TURN_S = 25;

/** What the commands need from the engine. */
export interface CommandHost {
  bus: KernelBus;
  history: History;
  /** Runs `fn` this many timeline seconds from now, unless the agent is cancelled first. Dropped by a seek. */
  after(delayS: number, fn: () => void, agentId?: string): void;
  cancelFor(agentId: string): void;
  /** Stops the timeline writing to this craft, because an operator took it over. */
  mute(nodeId: NodeId): void;
  /** Rate of a craft the timeline no longer drives. */
  override(nodeId: NodeId, rate: { tps: number; block: 'thinking' | 'text' | null } | null): void;
  /** Events applied so far on this timeline. */
  applied(): readonly NaosEvent[];
  watch(nodeId: NodeId, on: boolean): void;
  control(input: CommandMap['fixture.control']['in']): CommandMap['fixture.control']['out'];
  today(): { usd: number; burn: number };
}

const need = <T>(value: T | undefined | null, what: string): T => {
  if (value === undefined || value === null) throw new CommandError('not-found', `${what} is not known`);
  return value;
};

const asText = (value: unknown, name: string, limit = 100_000): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > limit) throw new CommandError('bad-request', `${name} must be text`);
  return value;
};

const LIVE: ReadonlySet<ManagedAgentView['state']> = new Set(['queued', 'spawning', 'ready', 'running', 'awaiting_approval', 'idle', 'parked', 'rate_limited', 'budget_exhausted']);

export function registerCommands(router: Router, host: CommandHost): void {
  const { bus, history } = host;
  let spawns = 0;
  let sends = 0;
  const receipts = new Map<string, CommandMap['agent.spawn']['out']>();

  const managed = (agentId: string): ManagedAgentView => need(bus.state().managed[agentId], `agent ${agentId}`);
  const upsert = (agentId: string, patch: Partial<ManagedAgentView>): void => {
    const agent = bus.state().managed[agentId];
    if (agent) bus.publish({ type: 'managed.upserted', agent: { ...agent, ...patch } });
  };
  const bumpAdmission = (running: number, alive: number): void => {
    const { admission } = bus.state();
    bus.publish({
      type: 'admission.changed',
      admission: { ...admission, running: Math.max(0, admission.running + running), alive: Math.max(0, admission.alive + alive) },
    });
  };

  const setActivity = (view: ManagedAgentView, activity: Extract<NaosEvent, { type: 'activity.changed' }>['activity']): void => {
    const nodeId = view.nodeId;
    if (view.sessionId && bus.state().nodes[nodeId]) bus.publish({ type: 'activity.changed', activity, nodeId, sessionId: view.sessionId });
  };

  /** A follow-up, an approval or a spawn starts a turn: drive on, then back to idle. */
  const drive = (agentId: string, block: 'thinking' | 'text' = 'text'): void => {
    const view = managed(agentId);
    if (!view.sessionId) return;
    setActivity(view, { state: 'generating', since: bus.now(), lastBlock: block });
    host.override(view.nodeId, { tps: 210, block });
    upsert(agentId, { state: 'running', turn: view.turn + 1 });
    host.after(TURN_S, () => {
      const current = bus.state().managed[agentId];
      if (!current?.sessionId || current.state !== 'running') return;
      bus.publish({ type: 'turn.ended', stopReason: 'end_turn', nodeId: current.nodeId, sessionId: current.sessionId });
      setActivity(current, { state: 'idle', since: bus.now(), backgroundShell: false });
      host.override(current.nodeId, null);
      upsert(agentId, { state: 'idle', lastTerminalReason: 'completed' });
    }, agentId);
  };

  const worldFor = (spec: SpawnSpec): World => {
    const worlds = Object.values(bus.state().worlds);
    const world = spec.worldId !== undefined ? bus.state().worlds[spec.worldId] : worlds.find((row) => row.projectRoot === spec.cwd);
    return need(world, 'that world');
  };

  const launch = (spec: SpawnSpec, world: World): string => {
    const client = spec.client ?? 'claude-code';
    spawns += 1;
    const agentId = `ag_op${spawns}`;
    const key = `operator-${bus.state().seq}-${spawns}`;
    const def = {
      key, world: world.name, title: spec.title ?? `operator craft ${spawns}`, owned: true, ageS: 0, model: spec.model ?? MODEL.sonnet,
      effort: spec.effort ?? 'medium', profile: spec.profile, budgetUsd: spec.budgetUsd ?? 2, usd: 0, contextTokens: 14_000,
    };
    const insertion = bus.now() + SPAWN_FLIGHT_S * 1000;
    const view: ManagedAgentView = {
      ...makeManaged(def, insertion), client, agentId, rootAgentId: agentId, sessionId: null, nodeId: `pending:${agentId}`, worldId: world.worldId,
      projectRoot: world.projectRoot ?? rootOf(world.name), state: 'spawning', createdAt: bus.now(), startedAt: null, pid: null, turn: 0,
      toolCalls: 0, spentUsd: 0, contextTokens: null,
    };
    bus.publish({ type: 'managed.upserted', agent: view });
    bumpAdmission(1, 1);
    host.after(SPAWN_FLIGHT_S, () => {
      const sid = sessionKey(client, uuidOf(key));
      const session = { ...makeSession(def, bus.now(), { state: 'starting', since: bus.now() }), sessionId: sid, rootNodeId: sid, worldId: world.worldId,
        source: { client, nativeSessionId: uuidOf(key), transport: 'stream' as const, capabilities: ['activity', 'tools', 'text', 'steer', 'stop', 'approve'] as import('@naos/protocol').SessionCapability[] } };
      bus.publish({ type: 'session.discovered', session, nodeId: session.rootNodeId, sessionId: session.sessionId });
      upsert(agentId, { state: 'ready', sessionId: session.sessionId, nodeId: session.rootNodeId, startedAt: bus.now(), pid: session.pid });
    }, agentId);
    host.after(SPAWN_FLIGHT_S + 0.4, () => drive(agentId), agentId);
    return agentId;
  };

  const spawn = (spec: SpawnSpec): CommandMap['agent.spawn']['out'] => {
    const first = spec?.profile === FIRST_FLIGHT_PROFILE;
    if (spec?.profile === WORLD_DESIGNER_PROFILE) throw new CommandError('bad-request', 'A world designer is started with world.design, not by name.');
    if (!first) asText(spec?.prompt, 'prompt');
    if (!first && (!spec.client || spec.client === 'claude-code') && !PROFILES.some((profile) => profile.name === spec.profile)) throw new CommandError('bad-request', 'unknown profile');
    if (spec.idempotencyKey !== undefined) {
      const earlier = receipts.get(spec.idempotencyKey);
      if (earlier) return earlier;
    }
    const world = first ? need(Object.values(bus.state().worlds)[0], 'a world') : worldFor(spec);
    const { admission } = bus.state();
    if (admission.frozen !== null && !spec.queue) {
      bus.publish({ type: 'spawn.refused', parentAgentId: null, worldId: world.worldId, limit: admission.frozen });
      throw new CommandError('limit', `launches are frozen: ${admission.frozen}`);
    }
    const copies = Math.min(Math.max(1, Math.floor(spec.copies ?? 1)), 4);
    const agentIds = Array.from({ length: copies }, () => launch(spec, world));
    const receipt = { agentIds, queued: 0 };
    if (spec.idempotencyKey !== undefined) receipts.set(spec.idempotencyKey, receipt);
    return receipt;
  };

  const stop = (agentId: string): CommandMap['agent.stop']['out'] => {
    const view = managed(agentId);
    if (!LIVE.has(view.state)) return { result: 'already-stopped' };
    host.cancelFor(agentId);
    host.mute(view.nodeId);
    host.override(view.nodeId, null);
    for (const approval of Object.values(bus.state().approvals)) {
      if (approval.agentId === agentId && approval.status === 'open') {
        bus.publish({ type: 'approval.cancelled', requestId: approval.requestId, agentId, reason: 'stopped' });
      }
    }
    setActivity(view, { state: 'interrupted', since: bus.now() });
    upsert(agentId, { state: 'stopping', stopStep: 'interrupt', openApprovals: 0 });
    host.after(0.8, () => upsert(agentId, { stopStep: 'end of input' }), agentId);
    host.after(1.5, () => upsert(agentId, { stopStep: 'tree kill' }), agentId);
    host.after(2, () => {
      const current = bus.state().managed[agentId];
      upsert(agentId, { state: 'exited', stopStep: null, endedAt: bus.now(), resumable: true, lastTerminalReason: 'aborted_streaming' });
      if (current?.sessionId) bus.publish({ type: 'session.ended', outcome: 'clean', reason: 'exit', nodeId: current.nodeId, sessionId: current.sessionId });
      bumpAdmission(view.state === 'running' ? -1 : 0, -1);
    }, agentId);
    return { result: 'graceful' };
  };

  router.register('agent.spawn', (input) => spawn(input.spec));
  router.register('agent.providers', () => [
    { client: 'codex', installed: true, authenticated: true, auth: 'chatgpt', models: [{ id: 'fixture-codex', name: 'Codex fixture model', default: true }], message: null, loginCommand: 'codex login' },
    { client: 'cursor', installed: true, authenticated: true, auth: 'provider', models: [{ id: 'fixture-cursor', name: 'Cursor fixture model', default: true }], message: null, loginCommand: 'agent login' },
  ]);

  router.register('agent.send', (input) => {
    asText(input.text, 'text');
    const view = managed(input.agentId);
    if (!LIVE.has(view.state)) throw new CommandError('conflict', 'that agent has ended');
    sends += 1;
    const sendId = `send_${sends}`;
    if (!view.sessionId) return { sendId };
    host.mute(view.nodeId);
    const { nodeId, sessionId } = view;
    const queue = input.priority === 'queue' && view.state === 'running';
    if (queue) {
      upsert(input.agentId, { queuedSends: view.queuedSends + 1 });
      bus.publish({ type: 'session.changed', patch: { queuedInputs: view.queuedSends + 1 }, nodeId, sessionId });
    }
    host.after(queue ? 1.5 : 0.1, () => {
      const current = bus.state().managed[input.agentId];
      if (!current) return;
      if (queue) {
        upsert(input.agentId, { queuedSends: Math.max(0, current.queuedSends - 1) });
        bus.publish({ type: 'session.changed', patch: { queuedInputs: Math.max(0, current.queuedSends - 1) }, nodeId, sessionId });
      }
      bus.publish({ type: 'turn.started', origin: 'human', nodeId, sessionId });
      drive(input.agentId);
    }, input.agentId);
    return { sendId };
  });

  router.register('agent.stop', (input) => stop(input.agentId));

  router.register('agent.stopAll', () => {
    const state = bus.state();
    let stopped = 0;
    for (const agent of Object.values(state.managed)) {
      if (stop(agent.agentId).result !== 'already-stopped') stopped += 1;
    }
    const outOfReach = Object.values(state.sessions).filter((session) => session.origin === 'observer' && session.endedAt === null).length;
    return { stopped, outOfReach };
  });

  router.register('agent.addBudget', (input) => {
    if (typeof input.addUsd !== 'number' || !(input.addUsd > 0)) throw new CommandError('bad-request', 'addUsd must be positive');
    const view = managed(input.agentId);
    const budgetUsd = Math.round((view.budgetUsd + input.addUsd) * 100) / 100;
    upsert(input.agentId, { budgetUsd });
    if (view.state === 'budget_exhausted') {
      host.mute(view.nodeId);
      drive(input.agentId);
    }
    return { budgetUsd };
  });

  router.register('agent.fork', (input) => {
    const view = managed(input.agentId);
    return spawn({ worldId: view.worldId, profile: view.profile, prompt: 'fork', title: `${view.title.replace(/^naos:/, '')} fork`, model: view.model });
  });

  router.register('agent.resume', (input) => {
    const view = managed(input.agentId);
    if (view.state !== 'exited' && view.state !== 'lost' && view.state !== 'crashed') throw new CommandError('conflict', 'only an ended agent resumes');
    const { sessionId, nodeId } = view;
    if (!sessionId) throw new CommandError('conflict', 'that agent never started');
    host.mute(nodeId);
    upsert(input.agentId, {
      endedAt: null, resumable: false, failure: null, budgetUsd: view.budgetUsd + (input.addUsd ?? 0),
    });
    if (bus.state().sessions[sessionId]) bus.publish({ type: 'session.changed', patch: { endedAt: null }, nodeId, sessionId });
    bumpAdmission(1, 1);
    drive(input.agentId);
    return { agentId: input.agentId };
  });

  router.register('agent.close', (input) => {
    const view = managed(input.agentId);
    if (LIVE.has(view.state)) stop(input.agentId);
    upsert(input.agentId, { state: 'closed' });
    bus.publish({ type: 'managed.removed', agentId: input.agentId });
    return { closed: true };
  });

  router.register('agent.status', (input) => managed(input.agentId));

  router.register('agent.wait', (input) => {
    const agent = managed(input.agentId);
    const done = !LIVE.has(agent.state) || agent.state === 'idle';
    return { agent, result: done ? 'Placeholder result.' : null, done };
  });

  router.register('agent.list', (input) => {
    const all = Object.values(bus.state().managed);
    if (input.scope === 'all') return all;
    const of = need(input.of, 'of');
    return input.scope === 'tree' ? all.filter((agent) => agent.rootAgentId === of) : all.filter((agent) => agent.parentAgentId === of);
  });

  router.register('approval.answer', (input) => {
    const approval = need(bus.state().approvals[input.requestId], 'that request');
    const kind = input.decision?.kind;
    if (typeof kind !== 'string') throw new CommandError('bad-request', 'decision is required');
    // The first ending wins. A second tab learns it from `applied`.
    if (approval.status !== 'open') return { applied: false };
    bus.publish({ type: 'approval.answered', requestId: approval.requestId, agentId: approval.agentId, outcome: kind, by: input.clientId });
    const view = bus.state().managed[approval.agentId];
    if (!view) return { applied: true };
    const openApprovals = Math.max(0, view.openApprovals - 1);
    host.mute(view.nodeId);
    upsert(approval.agentId, { openApprovals });
    if (kind === 'stop') {
      setActivity(view, { state: 'interrupted', since: bus.now() });
      upsert(approval.agentId, { state: 'idle', lastTurnAborted: true });
      host.override(view.nodeId, null);
    } else if (openApprovals === 0) {
      drive(approval.agentId, kind === 'deny' ? 'thinking' : 'text');
    }
    return { applied: true };
  });

  router.register('preflight', (input) => {
    const spec = input.spec;
    const worlds = Object.values(bus.state().worlds);
    const world = spec?.worldId !== undefined ? bus.state().worlds[spec.worldId] : worlds.find((row) => row.projectRoot === spec?.cwd);
    const profile = PROFILES.find((row) => row.name === spec?.profile) ?? PROFILES[0]!;
    const { admission, plan } = bus.state();
    const fiveHourUsedPercent = plan?.fiveHourLeft == null ? null : Math.round((1 - plan.fiveHourLeft) * 100);
    const frozen = admission.frozen === null ? null : `Launches are frozen: ${admission.frozen}.`;
    const result: PreflightResult = {
      world: {
        worldId: world?.worldId ?? null, name: world?.name ?? 'unknown', root: world?.projectRoot ?? spec?.cwd ?? '', isGit: world?.isGit ?? false,
        trusted: world?.trusted ?? false,
      },
      profile: profile.name,
      model: spec?.model ?? profile.model,
      budgetUsd: spec?.budgetUsd ?? profile.defaultBudgetUsd,
      treeBudgetUsd: spec?.mission?.treeBudgetUsd ?? null,
      sources: world?.trusted ? ['user', 'project', 'local'] : [],
      hooks: [],
      cwd: { exists: world !== undefined, isGit: world?.isGit ?? false, worktreePossible: world?.isGit ?? false },
      admission,
      plan: { fiveHourUsedPercent, freezeAtPercent: 80 },
      connectors: 'off',
      loadout: world?.trusted ? { skills: 6, mcpServers: 1, contextTokens: 14_000, measuredAt: bus.now() - 3_600_000 } : null,
      warnings: world?.trusted === false ? ['Unknown repo: settings sources stay off.'] : [],
      blocked: world === undefined ? 'That folder is not known.' : frozen,
    };
    return result;
  });

  router.register('admission.get', () => bus.state().admission);

  router.register('world.trust', (input) => {
    const world = need(bus.state().worlds[input.worldId], 'that world');
    bus.publish({ type: 'world.upserted', world: { ...world, trusted: input.trusted } });
    return { trusted: input.trusted };
  });

  router.register('world.rename', (input) => {
    const world = need(bus.state().worlds[input.worldId], 'that world');
    const name = cleanWorldName(input.name ?? null);
    const shown = name || (world.projectRoot?.split('/').pop() ?? world.name);
    bus.publish({ type: 'world.upserted', world: { ...world, name: shown, renamed: name !== '' } });
    return { name: shown };
  });

  router.register('world.survey', ({ worldId }) => {
    need(bus.state().worlds[worldId], 'that world');
    const paths = ['src/interface', 'src/core', 'src/services', 'test', 'docs', 'public'];
    const kinds = ['interface', 'source', 'service', 'tests', 'docs', 'assets'] as const;
    return { files: 246, complete: true, languages: [{ name: 'TypeScript', files: 181 }, { name: 'CSS', files: 24 }, { name: 'Markdown', files: 41 }],
      regions: paths.map((p, i) => ({ path: p, name: p.split('/').at(-1)!, kind: kinds[i]!, files: [74, 61, 48, 28, 23, 12][i]!, entries: [`${p}/index.ts`, `${p}/README.md`] })) };
  });

  router.register('world.knowledge', ({ worldId }) => {
    need(bus.state().worlds[worldId], 'that world');
    const titles = ['Project vision', 'Architecture', 'Agent memory', 'Interface system', 'Next experiments', 'Research journal', 'Decisions', 'Tool registry', 'Knowledge index'];
    const nodes = titles.map((title, i) => ({ id: `brain/${i === 0 ? 'index' : title.toLowerCase().replaceAll(' ', '-')}.md`, title, folder: i < 5 ? 'brain' : 'brain/research' }));
    const pairs = [[0, 1], [0, 2], [0, 3], [1, 6], [1, 7], [2, 8], [3, 4], [4, 5], [5, 6], [8, 5]];
    return { nodes, edges: pairs.map(([a, b]) => ({ from: nodes[a!]!.id, to: nodes[b!]!.id, kind: 'link' as const })), complete: true };
  });

  router.register('world.skills', ({ worldId }) => {
    need(bus.state().worlds[worldId], 'that world');
    return { skills: [
      { id: 'user:shared:skill:project-tour', name: 'project-tour', description: 'Explain the project layout and the main implementation path.', source: 'shared' as const, scope: 'user' as const, kind: 'skill' as const, client: 'shared' as const, requiresTrust: false },
      { id: 'project:cursor:command:review', name: 'review', description: 'Review the current project changes and report actionable findings.', source: 'cursor' as const, scope: 'project' as const, kind: 'command' as const, client: 'cursor' as const, requiresTrust: false },
    ] };
  });
  router.register('world.skill.read', ({ worldId, skillId }) => {
    need(bus.state().worlds[worldId], 'that world');
    if (skillId === 'user:shared:skill:project-tour') return { id: skillId, name: 'project-tour', description: 'Explain the project layout and the main implementation path.', source: 'shared' as const, scope: 'user' as const, kind: 'skill' as const, client: 'shared' as const, requiresTrust: false, instructions: 'Inspect the project structure, identify its main entry points and explain how the pieces fit together.', truncated: false };
    if (skillId === 'project:cursor:command:review') return { id: skillId, name: 'review', description: 'Review the current project changes and report actionable findings.', source: 'cursor' as const, scope: 'project' as const, kind: 'command' as const, client: 'cursor' as const, requiresTrust: false, instructions: 'Review the current project changes. Prioritize correctness, regressions and security; report exact file paths and line numbers.', truncated: false };
    throw new Error('That workflow is unavailable.');
  });

  router.register('world.changes', ({ worldId }) => {
    need(bus.state().worlds[worldId], 'that world');
    return { available: true, branch: 'feature/workspace', files: [
      { path: 'packages/ui/src/hud/project/ProjectChat.tsx', status: 'modified' as const, staged: false, unstaged: true, additions: 28, deletions: 9 },
      { path: 'packages/kernel/src/projectChanges.ts', status: 'untracked' as const, staged: false, unstaged: true, additions: null, deletions: null },
    ], additions: 28, deletions: 9, updatedAt: Date.now() };
  });
  router.register('world.diff', ({ worldId, path }) => {
    need(bus.state().worlds[worldId], 'that world');
    if (path === 'packages/ui/src/hud/project/ProjectChat.tsx') return { path, status: 'modified' as const, truncated: false, binary: false, patch: 'diff --git a/packages/ui/src/hud/project/ProjectChat.tsx b/packages/ui/src/hud/project/ProjectChat.tsx\n--- a/packages/ui/src/hud/project/ProjectChat.tsx\n+++ b/packages/ui/src/hud/project/ProjectChat.tsx\n@@ -1,3 +1,8 @@\n+// Project conversation context stays attached to this session.\n+// Provider-native harness owns history and permissions.\n' };
    if (path === 'packages/kernel/src/projectChanges.ts') return { path, status: 'untracked' as const, truncated: false, binary: false, patch: 'diff --git a/packages/kernel/src/projectChanges.ts b/packages/kernel/src/projectChanges.ts\nnew file mode 100644\n+export async function projectChanges(root: string) {\n+  return inspectWorkspace(root);\n+}\n' };
    throw new Error('That file is no longer listed as changed.');
  });

  router.register('world.design', (input) => {
    const world = need(bus.state().worlds[input.worldId], 'that world');
    if (world.kind === 'belt' || world.projectRoot === null) throw new CommandError('bad-request', 'The Belt has no planet.');
    const { genome } = validateGenome({
      archetype: 'terran',
      terrain: { rifts: 0.42 },
      rationale: `The designer of ${world.name} gave this world its own weather.`,
    });
    bus.publish({ type: 'world.upserted', world: { ...world, genome, designedAt: bus.now() } });
    return { agentIds: [], queued: 0 };
  });

  router.register('craft.channel', (input) => {
    need(bus.state().nodes[input.nodeId], 'that craft');
    const rows = channelRows(host.applied(), input.nodeId);
    const limit = input.limit ?? 200;
    return { rows: rows.slice(-limit), complete: rows.length <= limit };
  });

  router.register('craft.text', (input) => {
    need(bus.state().nodes[input.nodeId], 'that craft');
    const rows: TextRow[] = host.applied().flatMap((event) => (
      event.type === 'message.completed' && event.nodeId === input.nodeId
        ? [{ messageId: event.messageId, at: event.at, role: 'assistant' as const, text: placeholder(event.blockSizes.at(-1) ?? 80), truncated: false }]
        : []));
    return { rows: rows.slice(-(input.limit ?? 50)), available: true };
  });

  router.register('craft.watchText', (input) => {
    host.watch(input.nodeId, input.on);
    return {};
  });

  router.register('ledger.get', () => {
    const state = bus.state();
    const { usd, burn } = host.today();
    const byModel = new Map<string, { model: string; inputTokens: number; outputTokens: number; usd: number }>();
    for (const row of history.rows) {
      const model = row.model ?? 'unknown';
      const entry = byModel.get(model) ?? { model, inputTokens: 0, outputTokens: 0, usd: 0 };
      entry.usd = Math.round((entry.usd + (row.usd ?? 0)) * 100) / 100;
      entry.inputTokens += Math.round(row.bytes / 8);
      entry.outputTokens += Math.round(row.bytes / 40);
      byModel.set(model, entry);
    }
    const roots = Object.values(state.managed).filter((agent) => agent.depth === 0);
    return {
      partial: state.index.stage !== 'done',
      todayUsd: usd,
      burnUsdPerHour: burn,
      days30Usd: Math.round(history.rows.reduce((sum, row) => sum + (row.usd ?? 0), 0) * 100) / 100,
      blockedTodayMs: Object.values(state.sessions).reduce((sum, session) => sum + session.blockedMs, 0),
      byWorld: Object.values(state.worlds).map((world) => ({ worldId: world.worldId, usd: world.massUsd30d ?? 0 })),
      byModel: [...byModel.values()],
      trees: roots.map((agent) => ({ rootAgentId: agent.agentId, spentUsd: agent.spentUsd, budgetUsd: agent.budgetUsd })),
    };
  });

  router.register('history.get', () => ({ rows: history.rows, salvos: history.salvos }));

  router.register('fixture.control', (input) => host.control(input));
}

/** The structure of a craft's work, built from the events that reached it. */
export function channelRows(events: readonly NaosEvent[], nodeId: NodeId): ChannelRow[] {
  const rows: ChannelRow[] = [];
  const open = new Map<string, Extract<ChannelRow, { kind: 'tool' }>>();
  let turn = 0;
  for (const event of events) {
    if (event.type === 'agent.started' && event.node.parentNodeId === nodeId) {
      rows.push({ kind: 'tender', at: event.at, nodeId: event.node.nodeId, agentType: event.node.agentType, status: 'started' });
      continue;
    }
    if (!('nodeId' in event) || event.nodeId !== nodeId) continue;
    switch (event.type) {
      case 'turn.started':
        turn += 1;
        rows.push({ kind: 'turn', at: event.at, n: turn, origin: event.origin });
        break;
      case 'message.completed':
        event.blocks.forEach((block, index) => {
          const size = event.blockSizes[index] ?? 0;
          if (block === 'thinking') rows.push({ kind: 'thinking', at: event.at, tokens: size });
          else if (block === 'text') rows.push({ kind: 'text', at: event.at, messageId: event.messageId, chars: size, tokens: Math.round(size / 4) });
        });
        break;
      case 'tool.started': {
        const row: Extract<ChannelRow, { kind: 'tool' }> = {
          kind: 'tool', at: event.at, toolUseId: event.toolUseId, name: event.name, family: event.toolFamily, summary: event.summary, durationMs: null,
          isError: false, decision: null,
        };
        open.set(event.toolUseId, row);
        rows.push(row);
        break;
      }
      case 'tool.finished': {
        const row = open.get(event.toolUseId);
        if (row) {
          row.durationMs = event.durationMs;
          row.isError = event.isError;
          row.decision = event.decision;
        }
        break;
      }
      case 'api.error':
        rows.push({ kind: 'error', at: event.at, label: event.httpStatus === null ? (event.kind ?? 'error') : `API ${event.httpStatus}` });
        break;
      default:
    }
  }
  return rows;
}

const WORDS = 'placeholder text for a fixture message with no real content in it at all'.split(' ');

export function placeholder(chars: number): string {
  let out = '';
  for (let index = 0; out.length < Math.min(chars, 2000); index += 1) out += `${WORDS[index % WORDS.length]} `;
  return out.trimEnd();
}
