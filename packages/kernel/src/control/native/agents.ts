import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { AgentProvider, ApprovalDecision, ApprovalView, ChannelRow, ManagedAgentView, NativeClient, ObservedSession, PreflightResult, SpawnReceipt, SpawnSpec, TextRow, ToolSummary } from '@naos/protocol';
import { CLIENT_NAME, sessionKey } from '@naos/protocol';
import { CommandError, type KernelContext } from '../../context.ts';
import { unknownCost, zeroUsage } from '../../sources/session.ts';
import { NativeBridge, realRpc, type RpcFactory } from './bridge.ts';
import { findNative } from './executable.ts';
import { object, type NativeExecutable, type Obj } from './rpc.ts';
import { agentEnv } from '../driver.ts';
import { codexPlan } from '../../sources/codex.ts';

interface Agent {
  view: ManagedAgentView;
  spec: SpawnSpec;
  nativeId: string | null;
  bridge: NativeBridge | null;
  queue: Array<{ text: string; id: string }>;
  messages: TextRow[];
  channels: ChannelRow[];
  partials: Map<string, string>;
  output: number;
  starting?: Promise<void>;
}
interface PendingApproval { agent: Agent; rpcId: string | number; method: string; params: Obj }
const ENDED = new Set(['closed', 'exited', 'crashed', 'lost', 'stopping']);
const ACTIVE = new Set(['spawning', 'ready', 'running', 'awaiting_approval']);
const nativeClient = (s: SpawnSpec): NativeClient => {
  if (s.client !== 'codex' && s.client !== 'cursor') throw new CommandError('bad-request', 'Choose Codex or Cursor.');
  return s.client;
};

/** Local user-owned clients. No MCP caller may start, steer or approve a native conversation. */
export class NativeAgents {
  private readonly ctx: KernelContext;
  private readonly agents = new Map<string, Agent>();
  private readonly approvals = new Map<string, PendingApproval>();
  private readonly receipts = new Map<string, { fingerprint: string; receipt: SpawnReceipt }>();
  private readonly health = new Map<NativeClient, { at: number; value: AgentProvider }>();
  private readonly locate: (client: NativeClient) => NativeExecutable | null;
  private readonly rpc: RpcFactory;
  private closed = false;
  constructor(ctx: KernelContext, deps: { locate?: (client: NativeClient) => NativeExecutable | null; rpc?: RpcFactory } = {}) {
    this.ctx = ctx; this.locate = deps.locate ?? findNative; this.rpc = deps.rpc ?? realRpc;
    ctx.db.exec('CREATE TABLE IF NOT EXISTS native_agents (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
    ctx.db.exec('CREATE TABLE IF NOT EXISTS native_messages (agent_id TEXT NOT NULL, id TEXT NOT NULL, at REAL NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, truncated INTEGER NOT NULL, PRIMARY KEY (agent_id, id))');
  }
  boot() {
    for (const row of this.ctx.db.all<{ data: string }>('SELECT data FROM native_agents LIMIT 500')) {
      try {
        const saved = JSON.parse(row.data) as { view: ManagedAgentView; spec: SpawnSpec; nativeId: string | null };
        if (!saved.view.agentId || !['codex', 'cursor'].includes(saved.view.client ?? '')) continue;
        const view = { ...saved.view, state: saved.view.state === 'closed' ? 'closed' as const : 'exited' as const, openApprovals: 0, queuedSends: 0, endedAt: Date.now(), pid: null, resumable: saved.view.state !== 'closed' && !!saved.nativeId, failure: null };
        const messages = this.ctx.db.all<TextRow>('SELECT id AS messageId, at, role, text, truncated FROM native_messages WHERE agent_id = ? ORDER BY at DESC LIMIT 120', view.agentId).reverse();
        const a: Agent = { ...saved, view, messages, bridge: null, queue: [], channels: [], partials: new Map(), output: 0 };
        this.agents.set(view.agentId, a); this.publish(a);
        if (a.nativeId) this.announce(a);
      } catch { /* unknown saved records are left alone */ }
    }
  }
  owns(id: string) { return this.agents.has(id); }
  ownsNode(id: string) { return [...this.agents.values()].some((a) => a.view.nodeId === id); }
  ownsApproval(id: string) { return this.approvals.has(id); }
  views() { return [...this.agents.values()].map((a) => a.view); }
  private need(id: string) { const a = this.agents.get(id); if (!a) throw new CommandError('not-found', 'That native agent is not known.'); return a; }
  private ui(scope: string) { if (scope !== 'ui') throw new CommandError('forbidden', 'Native agent control belongs to the local user.'); }
  private publish(a: Agent, patch: Partial<ManagedAgentView> = {}) {
    a.view = { ...a.view, ...patch };
    this.ctx.db.run('INSERT OR REPLACE INTO native_agents (id, data) VALUES (?, ?)', a.view.agentId, JSON.stringify({ view: a.view, spec: { ...a.spec, prompt: '' }, nativeId: a.nativeId }));
    this.ctx.bus.publish({ type: 'managed.upserted', agent: a.view });
  }
  private announce(a: Agent) {
    const v = a.view, at = Date.now(), old = this.ctx.bus.state().sessions[v.nodeId];
    const session: ObservedSession = {
      sessionId: v.nodeId, source: { client: v.client!, nativeSessionId: a.nativeId!, transport: 'stream', capabilities: ['activity', 'tools', 'text', 'steer', 'stop', 'approve'] },
      origin: 'control', worldId: v.worldId, title: v.title, titleSource: 'custom', displayName: null,
      projectRoot: v.projectRoot, startCwd: v.cwd, currentCwd: v.cwd, worktree: null, gitBranch: null, slugs: [], transcriptPath: null, transcriptBytes: 0,
      pid: null, liveness: ENDED.has(v.state) ? 'dead' : 'alive', kind: 'interactive', entrypoint: CLIENT_NAME[v.client!], version: null, pidStatus: null,
      remoteControlled: true, acceptsPeerMessages: false, activity: { state: 'idle', since: at, backgroundShell: false }, queuedInputs: v.queuedSends,
      model: v.model || null, requestedModel: v.model || null, effort: v.effort, permissionMode: v.permissionMode, startedAt: v.startedAt ?? v.createdAt,
      lastRecordAt: at, lastWriteAt: at, endedAt: v.endedAt, usage: zeroUsage(), usageTree: zeroUsage(), cost: unknownCost(v.model), contextTokens: null, contextWindow: null,
      blockedMs: 0, rootNodeId: v.nodeId, agentCount: 0, runningAgentCount: 0, workflowRunIds: [], lastRateLimit: null,
    };
    if (old) this.ctx.bus.publish({ type: 'session.changed', sessionId: v.nodeId, nodeId: v.nodeId, patch: session });
    else this.ctx.bus.publish({ type: 'session.discovered', sessionId: v.nodeId, nodeId: v.nodeId, session });
  }
  async providers(inspect?: NativeClient): Promise<AgentProvider[]> {
    const output: AgentProvider[] = [];
    for (const client of ['codex', 'cursor'] as const) {
      const exe = this.locate(client), cached = this.health.get(client);
      if (cached && inspect !== client && Date.now() - cached.at < 45000 && !!exe === cached.value.installed) { output.push(cached.value); continue; }
      const loginCommand = client === 'cursor' && exe?.args.length ? `& ${[exe.file, ...exe.args].map((s) => `'${s.replaceAll("'", "''")}'`).join(' ')} login` : client === 'codex' ? 'codex login' : 'agent login';
      let value: AgentProvider = { client, installed: !!exe, authenticated: null, auth: 'unknown', models: [], message: exe ? null : `${CLIENT_NAME[client]} CLI is not installed.`, loginCommand };
      if (exe && inspect === client) {
        const probe = new NativeBridge(client, exe, this.ctx.config.repoRoot, { text() {}, tool() {}, approval() {}, finished() {}, failed() {} }, this.rpc);
        try {
          await probe.initialize(); value = { ...value, ...await probe.inspect() };
          if (client === 'cursor' && this.rpc === realRpc) {
            const status = await promisify(execFile)(exe.file, [...exe.args, 'status', '--format', 'json'], { windowsHide: true, env: agentEnv({ NO_OPEN_BROWSER: '1' }), timeout: 15000, maxBuffer: 1e6 }).then((r) => r.stdout, (e: { stdout?: string }) => e.stdout ?? '{}');
            const info = object(JSON.parse(status));
            if (typeof info.isAuthenticated === 'boolean') value.authenticated = info.isAuthenticated;
          }
          if (value.authenticated === false) value.message = 'Sign in to this provider’s CLI, then recheck.';
        }
        catch (error) { value.message = error instanceof Error ? error.message : 'The CLI could not be inspected.'; }
        finally { await probe.close(); }
        this.health.set(client, { at: Date.now(), value });
      }
      output.push(value);
    }
    return output;
  }
  async preflight(spec: SpawnSpec): Promise<PreflightResult> {
    const client = nativeClient(spec), world = spec.worldId ? this.ctx.worlds.get(spec.worldId) : undefined;
    if (!world?.projectRoot || world.kind === 'belt') throw new CommandError('bad-request', 'Select a project folder first.');
    const exists = await stat(world.projectRoot).then((s) => s.isDirectory(), () => false);
    const own = this.views().filter((v) => v.client === client && !ENDED.has(v.state));
    const running = own.filter((v) => ACTIVE.has(v.state)).length;
    const plan = this.ctx.bus.state().clientPlans?.[client];
    const limited = plan?.status === 'rejected' && (plan.resetsAt.fiveHour === null || plan.resetsAt.fiveHour > Date.now());
    const blocked = !this.locate(client) ? `Install the ${CLIENT_NAME[client]} CLI first.` : !exists ? 'This project folder is not available.' : limited ? `${CLIENT_NAME[client]} reports a usage limit. Wait for the provider reset.` : running >= 2 ? `Two ${CLIENT_NAME[client]} turns are already running. Wait for one to finish.` : own.length >= 8 ? `Eight ${CLIENT_NAME[client]} conversations are open. Stop one first.` : null;
    return { world: { worldId: world.worldId, name: world.name, root: world.projectRoot, isGit: world.isGit, trusted: world.trusted }, profile: client,
      model: spec.model || 'Provider default', budgetUsd: 0, treeBudgetUsd: null, sources: ['Provider CLI configuration'], hooks: [],
      cwd: { exists, isGit: world.isGit, worktreePossible: false }, admission: { running, runningLimit: 2, alive: own.length, aliveLimit: 8, frozen: limited ? 'plan-window' : null, queued: [] },
      plan: { fiveHourUsedPercent: plan?.fiveHourLeft == null ? null : (1 - plan.fiveHourLeft) * 100, freezeAtPercent: 100 }, connectors: 'provider', loadout: null,
      warnings: ['The provider’s local configuration applies. Usage is governed by its account limits; NAOS cannot impose a dollar cap.'], blocked };
  }
  async spawn(spec: SpawnSpec, scope: string): Promise<SpawnReceipt> {
    this.ui(scope);
    if (this.closed) throw new CommandError('unavailable', 'The kernel is shutting down.');
    const client = nativeClient(spec);
    if (typeof spec.prompt !== 'string' || !spec.prompt.trim() || spec.prompt.length > 100000) throw new CommandError('bad-request', 'Write a prompt of at most 100,000 characters.');
    if (spec.worktree || spec.mission || (spec.copies ?? 1) !== 1) throw new CommandError('bad-request', 'Native launches currently run one agent in the selected project folder.');
    const fingerprint = JSON.stringify([client, spec.worldId, spec.prompt, spec.mode, spec.model]);
    if (spec.idempotencyKey) {
      const saved = this.receipts.get(spec.idempotencyKey);
      if (saved) { if (saved.fingerprint !== fingerprint) throw new CommandError('conflict', 'That launch key already belongs to another prompt.'); return saved.receipt; }
    }
    const check = await this.preflight(spec);
    if (check.blocked) throw new CommandError('limit', check.blocked);
    // Preflight yields to disk I/O: recheck receipts and admission before reserving a slot.
    if (spec.idempotencyKey && this.receipts.has(spec.idempotencyKey)) {
      const saved = this.receipts.get(spec.idempotencyKey)!;
      if (saved.fingerprint !== fingerprint) throw new CommandError('conflict', 'That launch key already belongs to another prompt.');
      return saved.receipt;
    }
    if (this.views().filter((v) => v.client === client && ACTIVE.has(v.state)).length >= 2) throw new CommandError('limit', 'Wait for a running turn to finish.');
    if (this.views().filter((v) => v.client === client && !ENDED.has(v.state)).length >= 8) throw new CommandError('limit', 'Stop an open conversation first.');
    const id = `native_${randomUUID()}`, at = Date.now();
    const view: ManagedAgentView = { agentId: id, client, sessionId: null, nodeId: `pending:${id}`, worldId: spec.worldId!, projectRoot: check.world.root, cwd: check.world.root,
      profile: client, title: spec.title || spec.prompt.split('\n')[0]!.slice(0, 48), model: spec.model || '', effort: spec.effort ?? null, permissionMode: spec.mode ?? 'on-request',
      parentAgentId: null, rootAgentId: id, depth: 0, missionId: null, state: 'spawning', stopStep: null, openApprovals: 0, failure: null,
      budgetUsd: 0, spentUsd: 0, treeBudgetUsd: null, treeSpentUsd: null, turn: 0, maxTurns: null, toolCalls: 0, toolErrors: 0, queuedSends: 0,
      lastTerminalReason: null, lastTurnAborted: false, ttftMs: null, subagentStats: null, contextTokens: null, contextWindow: null, worktree: null, pid: null,
      instructionFilesLoaded: null, createdAt: at, startedAt: null, endedAt: null, resumable: false };
    const a: Agent = { view, spec: { ...spec }, nativeId: null, bridge: null, queue: [{ text: spec.prompt, id: randomUUID() }], messages: [], channels: [], partials: new Map(), output: 0 };
    this.agents.set(id, a); this.publish(a);
    const receipt = { agentIds: [id], queued: 0 };
    if (spec.idempotencyKey) { this.receipts.set(spec.idempotencyKey, { fingerprint, receipt }); if (this.receipts.size > 500) this.receipts.delete(this.receipts.keys().next().value!); }
    a.starting = this.connect(a).catch((e: unknown) => this.failed(a, e instanceof Error ? e.message : 'The agent could not start.'));
    return receipt;
  }
  private async connect(a: Agent, resume = false) {
    a.partials.clear();
    const exe = this.locate(a.view.client as NativeClient);
    if (!exe) throw new CommandError('unavailable', 'The provider CLI is not installed.');
    const bridge = new NativeBridge(a.view.client as NativeClient, exe, a.view.cwd, {
      limits: (value) => {
        const convert = (v: unknown) => { const w = object(v); return Object.keys(w).length ? { used_percent: w.usedPercent, window_minutes: w.windowDurationMins, resets_at: w.resetsAt } : null; };
        const plan = codexPlan({ primary: convert(value.primary), secondary: convert(value.secondary) }, Date.now());
        if (plan) this.ctx.bus.publish({ type: 'source.plan.changed', client: a.view.client!, plan });
      },
      text: (id, text, complete) => this.text(a, id, text, complete),
      tool: (id, name, family, done, isError = false, summary?: ToolSummary) => {
        if (ENDED.has(a.view.state)) return;
        const previous = a.channels.find((r): r is Extract<ChannelRow, { kind: 'tool' }> => r.kind === 'tool' && r.toolUseId === id);
        if (previous && previous.status !== 'running') return;
        const at = Date.now(), toolName = previous?.name ?? name, toolFamily = previous?.family ?? family;
        const durationMs = done && previous ? Math.max(0, at - previous.at) : null;
        const row: Extract<ChannelRow, { kind: 'tool' }> = { kind: 'tool', at: previous?.at ?? at, toolUseId: id, name: toolName, family: toolFamily, summary: summary ?? previous?.summary ?? { shape: toolName, target: null }, durationMs, isError, decision: null, status: done ? isError ? 'failed' : 'completed' : 'running' };
        if (previous) a.channels[a.channels.indexOf(previous)] = row; else {
          a.channels.push(row); this.publish(a, { toolCalls: a.view.toolCalls + 1 });
          this.ctx.bus.publish({ type: 'tool.started', nodeId: a.view.nodeId, sessionId: a.view.sessionId!, toolUseId: id, name: toolName, toolFamily, summary: row.summary });
        }
        if (done) this.ctx.bus.publish({ type: 'tool.finished', nodeId: a.view.nodeId, sessionId: a.view.sessionId!, toolUseId: id, name: toolName, toolFamily, durationMs, isError, decision: null, denial: null });
        a.channels = a.channels.slice(-200);
        const running = a.channels.filter((r): r is Extract<ChannelRow, { kind: 'tool' }> => r.kind === 'tool' && r.status === 'running');
        this.ctx.bus.publish({ type: 'activity.changed', nodeId: a.view.nodeId, sessionId: a.view.sessionId!, activity: running.length ? { state: 'tool_running', since: at, tools: running.map((r) => ({ toolUseId: r.toolUseId, name: r.name, family: r.family, startedAt: r.at })) } : { state: 'generating', since: at, lastBlock: 'tool_use' } });
      },
      approval: (method, id, p) => this.approve(a, method, id, p), finished: (reason) => this.finished(a, reason), failed: (message) => this.failed(a, message),
    }, this.rpc);
    a.bridge = bridge;
    await bridge.initialize();
    if (ENDED.has(a.view.state) || this.closed) { await bridge.close(); return; }
    const nativeId = await bridge.start(a.view.cwd, a.spec, resume ? a.nativeId ?? undefined : undefined);
    if (ENDED.has(a.view.state) || this.closed) { await bridge.close(); return; }
    a.nativeId = nativeId;
    const nodeId = sessionKey(a.view.client!, nativeId);
    this.publish(a, { sessionId: nodeId, nodeId, model: bridge.model || a.view.model, instructionFilesLoaded: bridge.instructionFilesLoaded, state: 'ready', startedAt: a.view.startedAt ?? Date.now(), endedAt: null, failure: null, resumable: true });
    this.announce(a);
    if (a.queue.length) await this.runNext(a); else this.publish(a, { state: 'idle' });
  }
  private remember(a: Agent, row: TextRow) {
    const index = a.messages.findIndex((r) => r.messageId === row.messageId);
    row = { ...row, at: index >= 0 ? a.messages[index]!.at : Math.max(row.at, (a.messages.at(-1)?.at ?? 0) + 1) };
    if (index < 0) a.messages.push(row); else a.messages[index] = row;
    a.messages = a.messages.slice(-120);
    this.ctx.db.run('INSERT OR REPLACE INTO native_messages (agent_id, id, at, role, text, truncated) VALUES (?, ?, ?, ?, ?, ?)', a.view.agentId, row.messageId, row.at, row.role, row.text, Number(row.truncated));
    this.ctx.db.run('DELETE FROM native_messages WHERE agent_id = ? AND id NOT IN (SELECT id FROM native_messages WHERE agent_id = ? ORDER BY at DESC LIMIT 120)', a.view.agentId, a.view.agentId);
  }
  private text(a: Agent, id: string, value: string, complete: boolean) {
    if (ENDED.has(a.view.state)) return;
    const previous = a.partials.get(id) ?? '', full = complete && value ? value : previous + value;
    a.partials.set(id, full.slice(0, 100000));
    if (!complete) { a.output += value.length; this.ctx.bus.pushText(a.view.nodeId, value); }
    if (complete) {
      this.remember(a, { messageId: id, at: Date.now(), role: 'assistant', text: full.slice(0, 16000), truncated: full.length > 16000 }); a.partials.delete(id);
      this.ctx.bus.publish({ type: 'message.completed', nodeId: a.view.nodeId, sessionId: a.view.sessionId!, messageId: id, model: a.view.model || 'provider-default', blocks: ['text'], blockSizes: [full.length], usage: zeroUsage() });
    }
  }
  private async runNext(a: Agent) {
    const next = a.queue.shift();
    if (!next || !a.bridge || ENDED.has(a.view.state)) return;
    if (!a.messages.some((r) => r.messageId === next.id)) this.remember(a, { messageId: next.id, role: 'user', at: Date.now(), text: next.text.slice(0, 16000), truncated: next.text.length > 16000 });
    this.publish(a, { state: 'running', turn: a.view.turn + 1, queuedSends: a.queue.length, failure: null });
    this.ctx.bus.publish({ type: 'turn.started', nodeId: a.view.nodeId, sessionId: a.view.sessionId!, origin: 'human' });
    this.ctx.bus.publish({ type: 'activity.changed', nodeId: a.view.nodeId, sessionId: a.view.sessionId!, activity: { state: 'generating', since: Date.now(), lastBlock: 'text' } });
    try { await a.bridge.send(next.text, next.id); } catch (e) { this.failed(a, e instanceof Error ? e.message : 'The provider rejected this turn.'); }
  }
  private finished(a: Agent, reason: string) {
    if (ENDED.has(a.view.state)) return;
    for (const [id, text] of [...a.partials]) this.text(a, id, text, true);
    this.cancelApprovals(a);
    this.publish(a, { state: 'idle', lastTerminalReason: reason });
    this.ctx.bus.publish({ type: 'turn.ended', nodeId: a.view.nodeId, sessionId: a.view.sessionId!, stopReason: reason === 'interrupted' || reason === 'cancelled' ? 'interrupted' : 'end_turn' });
    this.ctx.bus.publish({ type: 'activity.changed', nodeId: a.view.nodeId, sessionId: a.view.sessionId!, activity: { state: 'idle', since: Date.now(), backgroundShell: false } });
    if (a.queue.length) void this.runNext(a);
  }
  private failed(a: Agent, message: string) {
    if (ENDED.has(a.view.state)) return;
    this.cancelApprovals(a);
    a.queue = [];
    const limited = /rate.?limit|quota|usage limit|429/i.test(message);
    this.publish(a, { state: limited ? 'rate_limited' : 'crashed', failure: message.slice(0, 1000), queuedSends: 0, endedAt: Date.now(), resumable: !!a.nativeId });
    if (a.view.sessionId) this.ctx.bus.publish({ type: 'activity.changed', nodeId: a.view.nodeId, sessionId: a.view.sessionId, activity: { state: 'errored', since: Date.now(), kind: limited ? 'rate_limit' : 'api' } });
    void a.bridge?.close(); a.bridge = null;
  }
  send(id: string, text: string, priority: 'queue' | 'now', scope: string) {
    this.ui(scope); const a = this.need(id);
    if (priority !== 'queue') throw new CommandError('bad-request', 'Native follow-ups queue. Use Stop to interrupt this conversation.');
    if (typeof text !== 'string' || !text.trim() || text.length > 100000) throw new CommandError('bad-request', 'Write a message of at most 100,000 characters.');
    if (ENDED.has(a.view.state) || a.view.state === 'rate_limited') throw new CommandError('conflict', 'Resume this agent before sending another message.');
    if (a.queue.length >= 20) throw new CommandError('limit', 'Twenty messages are already queued.');
    const sendId = randomUUID();
    a.queue.push({ id: sendId, text });
    this.remember(a, { messageId: sendId, role: 'user', at: Date.now(), text: text.slice(0, 16000), truncated: text.length > 16000 });
    this.publish(a, { queuedSends: a.queue.length });
    // Native follow-ups queue deliberately; interrupt is the explicit stop control.
    if (a.view.state === 'idle' || a.view.state === 'ready') void this.runNext(a);
    return { sendId };
  }
  async stop(id: string, scope: string): Promise<'graceful' | 'forced' | 'already-stopped'> {
    this.ui(scope); const a = this.need(id);
    if (ENDED.has(a.view.state) && a.view.state !== 'stopping') return 'already-stopped';
    this.publish(a, { state: 'stopping', stopStep: 'interrupt' }); a.queue = []; this.cancelApprovals(a);
    await a.bridge?.interrupt().catch(() => {});
    await a.bridge?.close(); a.bridge = null;
    this.publish(a, { state: 'exited', stopStep: null, endedAt: Date.now(), queuedSends: 0, resumable: !!a.nativeId });
    if (a.view.sessionId) this.ctx.bus.publish({ type: 'session.ended', nodeId: a.view.nodeId, sessionId: a.view.sessionId, outcome: 'clean', reason: 'exit' });
    return 'graceful';
  }
  async stopAll() {
    const live = [...this.agents.values()].filter((a) => !ENDED.has(a.view.state));
    const results = await Promise.allSettled(live.map((a) => this.stop(a.view.agentId, 'ui')));
    return { stopped: results.filter((r) => r.status === 'fulfilled').length, outOfReach: results.filter((r) => r.status === 'rejected').length };
  }
  async resume(id: string, prompt?: string) {
    const a = this.need(id);
    if (!a.nativeId || !a.view.resumable || a.view.state === 'closed' || a.view.state === 'stopping') throw new CommandError('conflict', 'This conversation cannot be resumed.');
    if (!ENDED.has(a.view.state) && a.view.state !== 'rate_limited') throw new CommandError('conflict', 'This agent is already connected.');
    const check = await this.preflight(a.spec);
    if (check.blocked) throw new CommandError('limit', check.blocked);
    await a.bridge?.close(); a.bridge = null;
    if (prompt?.trim()) a.queue.push({ id: randomUUID(), text: prompt });
    this.publish(a, { state: 'spawning', failure: null, endedAt: null });
    a.starting = this.connect(a, true).catch((e: unknown) => this.failed(a, e instanceof Error ? e.message : 'Resume failed.'));
    return { agentId: id };
  }
  async close(id: string) { const a = this.need(id); await this.stop(id, 'ui'); this.publish(a, { state: 'closed', resumable: false }); return { closed: true }; }
  status(id: string, scope: string) { this.ui(scope); return this.need(id).view; }
  async wait(id: string, timeoutS: number, scope: string) {
    this.ui(scope); const a = this.need(id), end = Date.now() + Math.min(60, Math.max(0, Number.isFinite(timeoutS) ? timeoutS : 0)) * 1000;
    while (ACTIVE.has(a.view.state) && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
    return { agent: a.view, result: [...a.messages].reverse().find((r) => r.role === 'assistant')?.text ?? null, done: !ACTIVE.has(a.view.state) };
  }
  textRows(nodeId: string, limit = 50) { const a = [...this.agents.values()].find((v) => v.view.nodeId === nodeId); return { rows: a?.messages.slice(-Math.max(1, Math.min(120, limit))) ?? [], available: !!a }; }
  channel(nodeId: string, limit = 200) { const a = [...this.agents.values()].find((v) => v.view.nodeId === nodeId); return { rows: a?.channels.slice(-Math.max(1, Math.min(200, limit))) ?? [], complete: true }; }
  private cancelApprovals(a: Agent) {
    for (const [id, pending] of this.approvals) if (pending.agent === a) {
      const result = pending.method === 'session/request_permission' || pending.method.startsWith('cursor/') ? { outcome: { outcome: 'cancelled' } } : pending.method === 'item/tool/requestUserInput' ? { answers: {} } : pending.method.includes('/permissions/') ? { permissions: {}, scope: 'turn' } : { decision: 'cancel' };
      pending.agent.bridge?.rpc.respond(pending.rpcId, result);
      this.approvals.delete(id); this.ctx.bus.publish({ type: 'approval.cancelled', requestId: id, agentId: a.view.agentId, reason: 'stopped' });
    }
    if (a.view.openApprovals) this.publish(a, { openApprovals: 0 });
  }
  private approve(a: Agent, method: string, rpcId: string | number, params: Obj) {
    if (method === 'serverRequest/resolved') {
      for (const [id, pending] of this.approvals) if (pending.agent === a && String(pending.rpcId) === String(rpcId)) { this.approvals.delete(id); this.ctx.bus.publish({ type: 'approval.cancelled', requestId: id, agentId: a.view.agentId, reason: 'stopped' }); }
      this.publish(a, { openApprovals: [...this.approvals.values()].filter((p) => p.agent === a).length }); return;
    }
    if (ENDED.has(a.view.state)) { a.bridge?.rpc.reject(rpcId, 'The conversation is stopped.'); return; }
    const id = `native_approval_${randomUUID()}`, call = object(params.toolCall);
    const questions = method === 'item/tool/requestUserInput' || method === 'cursor/ask_question';
    const toolName = questions ? 'AskUserQuestion' : method === 'cursor/create_plan' ? 'ExitPlanMode' : method.includes('fileChange') || call.kind === 'edit' ? 'Edit' : method.includes('permissions') ? 'Native permissions' : 'Bash';
    const questionRows = (Array.isArray(params.questions) ? params.questions : []).map(object);
    const input = questions ? { questions: questionRows.map((q) => ({ question: String(q.question ?? q.prompt ?? ''), header: String(q.header ?? q.id ?? ''), multiSelect: q.multiSelect === true || q.allowMultiple === true,
      options: (Array.isArray(q.options) ? q.options : []).map(object).map((o) => ({ label: String(o.label ?? o.id ?? ''), description: String(o.description ?? '') })) })) } : { command: params.command ?? call.title ?? params.reason ?? 'Provider requests permission', ...params };
    const approval: ApprovalView = { requestId: id, agentId: a.view.agentId, nodeId: a.view.nodeId, worldId: a.view.worldId, toolUseID: String(params.itemId ?? call.toolCallId ?? rpcId),
      toolName, toolFamily: questions ? 'ask' : toolName === 'Edit' ? 'edit' : 'shell', input, displayName: String(call.title ?? toolName), description: String(params.reason ?? 'Review this provider request.'), title: CLIENT_NAME[a.view.client!],
      blockedPath: null, decisionReason: null, danger: !questions, defaultToNo: !questions, canRememberForSession: false, canRememberForProject: false,
      subagentId: null, subagentType: null, mcpServer: null, callIndex: 1, callCount: 1, createdAt: Date.now(), status: 'open', answeredAt: null, answeredBy: null, outcome: null, editable: false };
    this.approvals.set(id, { agent: a, rpcId, method, params });
    this.publish(a, { state: 'awaiting_approval', openApprovals: a.view.openApprovals + 1 });
    this.ctx.bus.publish({ type: 'approval.requested', approval });
  }
  answer(id: string, decision: ApprovalDecision, clientId: string) {
    const pending = this.approvals.get(id);
    if (!pending) return { applied: false };
    const { agent: a, method, params, rpcId } = pending;
    if (decision.kind === 'session' || decision.kind === 'project' || decision.kind === 'approve' && decision.input) throw new CommandError('bad-request', 'Native approvals support one-time approval or denial.');
    let result: Obj;
    const allow = decision.kind === 'approve' || decision.kind === 'answer';
    if (method === 'session/request_permission') {
      const option = (Array.isArray(params.options) ? params.options : []).map(object).find((o) => o.kind === (allow ? 'allow_once' : 'reject_once'));
      if (!option && decision.kind !== 'stop') throw new CommandError('bad-request', 'The provider did not offer this permission decision.');
      result = decision.kind === 'stop' ? { outcome: { outcome: 'cancelled' } } : { outcome: { outcome: 'selected', optionId: option!.optionId } };
    } else if (method === 'item/tool/requestUserInput') {
      const answers = decision.kind === 'answer' ? decision.answers : {};
      result = { answers: Object.fromEntries((Array.isArray(params.questions) ? params.questions : []).map(object).map((q) => [String(q.id), { answers: [answers[String(q.question)] ?? answers[String(q.id)] ?? 'Not answered'] }])) };
    } else if (method === 'cursor/ask_question') {
      if (decision.kind === 'answer') {
        const answers = (Array.isArray(params.questions) ? params.questions : []).map(object).map((q) => {
          const value = decision.answers[String(q.prompt)] ?? decision.answers[String(q.id)] ?? '';
          const selected = (Array.isArray(q.options) ? q.options : []).map(object).filter((o) => value === o.label || value.split(', ').includes(String(o.label))).map((o) => String(o.id));
          if (!selected.length) throw new CommandError('bad-request', 'Choose one of the provider’s offered answers.');
          return { questionId: String(q.id), selectedOptionIds: selected };
        });
        result = { outcome: { outcome: 'answered', answers } };
      } else result = { outcome: { outcome: decision.kind === 'stop' ? 'cancelled' : 'skipped' } };
    } else if (method === 'cursor/create_plan') result = { outcome: { outcome: decision.kind === 'stop' ? 'cancelled' : allow ? 'accepted' : 'rejected' } };
    else if (method.includes('/permissions/')) result = { permissions: allow ? object(params.permissions) : {}, scope: 'turn' };
    else result = { decision: allow ? 'accept' : decision.kind === 'stop' ? 'cancel' : 'decline' };
    a.bridge?.rpc.respond(rpcId, result); this.approvals.delete(id);
    this.ctx.bus.publish({ type: 'approval.answered', requestId: id, agentId: a.view.agentId, outcome: decision.kind, by: clientId });
    this.publish(a, { state: 'running', openApprovals: Math.max(0, a.view.openApprovals - 1) });
    if (decision.kind === 'stop') void this.stop(a.view.agentId, 'ui');
    if (decision.kind === 'redirect') this.send(a.view.agentId, decision.text, 'queue', 'ui');
    return { applied: true };
  }
  async shutdown() { this.closed = true; await this.stopAll(); await Promise.allSettled([...this.agents.values()].map((a) => a.starting)); }
}
