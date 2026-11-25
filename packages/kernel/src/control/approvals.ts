// Approvals, AC 9. A record per requestId, because a deferred resume can ask twice for one toolUseID. The SDK never settles
// the callback on its own: the signal is the only notice that a request died (AC 2.2). Never resolve with null, that leaves
// the tool blocked forever.
import type { CanUseTool, PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import type { AgentId, ApprovalDecision, ApprovalView, NodeId, RequestId, StandingGrant, WorldId } from '@naos/protocol';
import { toolFamily } from '@naos/protocol';
import { CommandError, type Bus, type EventInit, type Logger } from '../context.ts';
import type { Audit } from './audit.ts';
import type { Store } from './store.ts';

/** A policy-sounding sentence made the model refuse six later prompts. This one names the call (AC 1.13). */
export const DENY_TEXT = 'Not approved for this call.';
const OUTSIDE_CWD = 'Path is outside allowed working directories';
const REDIRECT_GRACE_MS = 3000;

type PermissionOptions = Parameters<CanUseTool>[2];

/** What Approvals needs to know about the asking agent. */
export interface ApprovalAgent {
  agentId: AgentId;
  sessionId: string;
  nodeId: NodeId;
  worldId: WorldId;
  callPosition(toolUseId: string): { index: number; count: number };
  subagentType(taskId: string | undefined): string | null;
  decided(toolUseId: string, decision: 'accept' | 'reject', source: string | null): void;
}

export interface ApprovalDeps {
  bus: Pick<Bus, 'publish'>;
  store: Store;
  audit: Audit;
  log: Logger;
  /** Count of open requests changed. A counter, because subagents can overlap (AC 5.1). */
  openChanged(agentId: AgentId, delta: 1 | -1): void;
  redirect(agentId: AgentId, text: string): void;
  grantsChanged?(agentId: AgentId, grants: StandingGrant[]): void;
  now?: () => number;
}

interface OpenRequest {
  view: ApprovalView;
  agent: ApprovalAgent;
  suggestions: PermissionUpdate[];
  resolve(result: PermissionResult): void;
}

/** Undocumented fields of the callback options, read defensively (AC 2.2). */
const extra = (o: PermissionOptions): { reasonType: string | null; needsHuman: boolean } => {
  const loose = o as unknown as { decisionReasonType?: unknown; requiresUserInteraction?: unknown };
  return {
    reasonType: typeof loose.decisionReasonType === 'string' ? loose.decisionReasonType : null,
    needsHuman: loose.requiresUserInteraction === true,
  };
};

const addRules = (u: PermissionUpdate): u is Extract<PermissionUpdate, { type: 'addRules' }> => u.type === 'addRules';

export const describeRule = (update: PermissionUpdate): string[] =>
  addRules(update) ? update.rules.map((r) => (r.ruleContent ? `${r.toolName}(${r.ruleContent})` : r.toolName)) : [];

/**
 * Rules to remember a call. Suggested rules are echoed, because self-written ones did not match (AC 2.2). `Write` suggests
 * only setMode, so it gets a rule for the tool. Suggestions default to localSettings, and a destination is never kept from
 * them: session stays session, and only the explicit project decision writes into the repo (AC 9.2).
 */
export function rememberRules(toolName: string, suggestions: readonly PermissionUpdate[], destination: 'session' | 'localSettings'): PermissionUpdate[] {
  const suggested = suggestions.filter(addRules).filter((u) => u.behavior === 'allow');
  if (suggested.length > 0) return suggested.map((u) => ({ ...u, destination }));
  return [{ type: 'addRules', rules: [{ toolName }], behavior: 'allow', destination }];
}

/** DESIGN 3.4 and AC 9.2. `redirect` has no return value: the send with priority 'now' aborts the request. */
export function resultFor(decision: Exclude<ApprovalDecision, { kind: 'redirect' }>, view: ApprovalView, suggestions: readonly PermissionUpdate[]): PermissionResult {
  switch (decision.kind) {
    case 'approve':
      return { behavior: 'allow', updatedInput: decision.input ?? view.input };
    case 'session':
      return { behavior: 'allow', updatedInput: view.input, updatedPermissions: rememberRules(view.toolName, suggestions, 'session') };
    case 'project':
      return { behavior: 'allow', updatedInput: view.input, updatedPermissions: rememberRules(view.toolName, suggestions, 'localSettings') };
    case 'deny':
      return { behavior: 'deny', message: decision.message?.trim() || DENY_TEXT };
    case 'stop':
      // The CLI drops this text and sends stock wording. Guidance goes in the next follow-up (AC 2.2).
      return { behavior: 'deny', message: DENY_TEXT, interrupt: true };
    case 'answer':
      return { behavior: 'allow', updatedInput: { ...view.input, answers: decision.answers } };
  }
}

export class Approvals {
  readonly #d: ApprovalDeps;
  readonly #now: () => number;
  readonly #open = new Map<RequestId, OpenRequest>();
  readonly #grants = new Map<AgentId, StandingGrant[]>();

  constructor(deps: ApprovalDeps) {
    this.#d = deps;
    this.#now = deps.now ?? Date.now;
  }

  #publish(event: EventInit): void {
    this.#d.bus.publish(event);
  }

  /** Hand this to canUseTool. */
  ask(agent: ApprovalAgent, toolName: string, input: Record<string, unknown>, o: PermissionOptions): Promise<PermissionResult> {
    const signal = o.signal;
    if (signal.aborted) return Promise.resolve({ behavior: 'deny', message: DENY_TEXT });
    return new Promise((resolve) => {
      const view = this.#view(agent, toolName, input, o);
      const open: OpenRequest = { view, agent, suggestions: o.suggestions ?? [], resolve };
      this.#open.set(view.requestId, open);
      this.#d.store.saveApproval(view);
      this.#d.audit.record(agent.agentId, 'approval.requested', { toolName, toolUseId: view.toolUseID, requestId: view.requestId, subagentId: view.subagentId, detail: input });
      // Fires on interrupt, on a send with priority 'now', on close and on child death.
      signal.addEventListener('abort', () => this.#aborted(view.requestId), { once: true });
      this.#d.openChanged(agent.agentId, 1);
      this.#publish({ type: 'approval.requested', approval: view });
    });
  }

  #view(agent: ApprovalAgent, toolName: string, input: Record<string, unknown>, o: PermissionOptions): ApprovalView {
    const { reasonType, needsHuman } = extra(o);
    const defaultToNo = o.defaultToNo === true;
    const remember = o.suppressAlwaysAllowRule !== true && !needsHuman;
    const { index, count } = agent.callPosition(o.toolUseID);
    return {
      requestId: o.requestId ?? o.toolUseID,
      agentId: agent.agentId,
      nodeId: agent.nodeId,
      worldId: agent.worldId,
      toolUseID: o.toolUseID,
      toolName,
      toolFamily: toolFamily(toolName),
      input,
      displayName: o.displayName ?? null,
      description: o.description ?? null,
      title: o.title ?? null,
      blockedPath: o.blockedPath ?? null,
      decisionReason: o.decisionReason ?? null,
      danger: defaultToNo || o.decisionReason === OUTSIDE_CWD || reasonType === 'workingDir',
      defaultToNo,
      canRememberForSession: remember,
      canRememberForProject: remember,
      subagentId: o.agentID ?? null,
      subagentType: agent.subagentType(o.agentID),
      mcpServer: o.mcpServer ?? null,
      callIndex: index,
      callCount: count,
      createdAt: this.#now(),
      status: 'open',
      answeredAt: null,
      answeredBy: null,
      outcome: null,
    };
  }

  #settle(requestId: RequestId, patch: Partial<ApprovalView>): OpenRequest | null {
    const open = this.#open.get(requestId);
    if (!open) return null;
    this.#open.delete(requestId);
    open.view = { ...open.view, ...patch };
    this.#d.store.saveApproval(open.view);
    this.#d.openChanged(open.view.agentId, -1);
    return open;
  }

  #aborted(requestId: RequestId): void {
    const open = this.#settle(requestId, { status: 'withdrawn', answeredAt: this.#now() });
    if (!open) return;
    const { view } = open;
    open.agent.decided(view.toolUseID, 'reject', 'withdrawn');
    this.#d.audit.record(view.agentId, 'approval.withdrawn', { toolName: view.toolName, toolUseId: view.toolUseID, requestId });
    this.#publish({ type: 'approval.cancelled', requestId, agentId: view.agentId, reason: 'aborted' });
    open.resolve({ behavior: 'deny', message: DENY_TEXT });
  }

  /** The first answer wins, any later one returns false, so two open tabs are safe (AC 9.1). */
  answer(requestId: RequestId, decision: ApprovalDecision, clientId: string): { applied: boolean } {
    const pending = this.#open.get(requestId);
    if (!pending) return { applied: false };
    const { view } = pending;
    if ((decision.kind === 'session' || decision.kind === 'project') && !view.canRememberForSession) {
      // A stale card must not quietly approve what cannot be remembered. The request stays open.
      throw new CommandError('forbidden', 'This call cannot be remembered. Approve it once or deny it.');
    }
    if (decision.kind === 'answer' && view.toolName !== 'AskUserQuestion') throw new CommandError('bad-request', 'answers only apply to AskUserQuestion');

    const open = this.#settle(requestId, { status: 'answered', answeredAt: this.#now(), answeredBy: clientId, outcome: decision.kind })!;
    const allow = decision.kind === 'approve' || decision.kind === 'session' || decision.kind === 'project' || decision.kind === 'answer';
    open.agent.decided(view.toolUseID, allow ? 'accept' : 'reject', allow ? null : 'human');
    this.#auditDecision(view, decision, clientId);
    this.#publish({ type: 'approval.answered', requestId, agentId: view.agentId, outcome: decision.kind, by: clientId });

    if (decision.kind === 'redirect') {
      // Sending aborts the request, and the abort settles the callback. If a race loses the signal, the tool must not hang.
      const timer = setTimeout(() => open.resolve({ behavior: 'deny', message: DENY_TEXT }), REDIRECT_GRACE_MS);
      timer.unref();
      this.#d.redirect(view.agentId, decision.text);
      return { applied: true };
    }
    if (decision.kind === 'session' || decision.kind === 'project') this.#grant(view, open.suggestions, decision.kind);
    open.resolve(resultFor(decision, view, open.suggestions));
    return { applied: true };
  }

  #auditDecision(view: ApprovalView, decision: ApprovalDecision, clientId: string): void {
    // The model is not told about an edit, so this row is the only record of it (AC 9.2).
    const edited = decision.kind === 'approve' && decision.input !== undefined && (decision.edited === true || JSON.stringify(decision.input) !== JSON.stringify(view.input));
    this.#d.audit.record(view.agentId, edited ? 'approval.edited' : 'approval.answered', {
      toolName: view.toolName, toolUseId: view.toolUseID, requestId: view.requestId, detail: { decision, by: clientId },
    });
  }

  #grant(view: ApprovalView, suggestions: readonly PermissionUpdate[], scope: 'session' | 'project'): void {
    const rules = rememberRules(view.toolName, suggestions, scope === 'session' ? 'session' : 'localSettings').flatMap(describeRule);
    const grants = this.#grants.get(view.agentId) ?? [];
    for (const rule of rules) grants.push({ agentId: view.agentId, rule, scope, grantedAt: this.#now() });
    this.#grants.set(view.agentId, grants);
    this.#publish({ type: 'standing.changed', agentId: view.agentId, grants: [...grants] });
  }

  /** Session grants die with the process. A resume starts with none. */
  clearGrants(agentId: AgentId): void {
    if (!this.#grants.delete(agentId)) return;
    this.#publish({ type: 'standing.changed', agentId, grants: [] });
  }

  get(requestId: RequestId): ApprovalView | undefined {
    return this.#open.get(requestId)?.view;
  }

  openFor(agentId: AgentId): ApprovalView[] {
    return [...this.#open.values()].filter((o) => o.view.agentId === agentId).map((o) => o.view);
  }

  /**
   * After a restart the records are void and the resumed model asks again (AC 5.3). The state holds nothing to settle, so the
   * card returns already expired: open requests from a dead kernel must never look answerable.
   */
  expireAll(): number {
    const rows = this.#d.store.openApprovals();
    const at = this.#now();
    for (const row of rows) {
      const view: ApprovalView = { ...row, status: 'expired', answeredAt: at };
      this.#d.store.saveApproval(view);
      this.#publish({ type: 'approval.requested', approval: view });
      this.#publish({ type: 'approval.expired', requestId: view.requestId });
    }
    return rows.length;
  }
}
