// Activity from the priority order of RF 3.5. Pure. A running craft's `since` only moves when its state does.
import type { Activity, ActiveTool, PidStatus, WaitReason } from '@naos/protocol';
import type { TranscriptMachine } from './transcript.ts';

const WAIT_REASONS = new Set<WaitReason>(['permission prompt', 'input needed', 'sandbox request', 'worker request', 'dialog open']);

export const waitReason = (v: string | null | undefined): WaitReason =>
  WAIT_REASONS.has(v as WaitReason) ? (v as WaitReason) : 'unknown';

const activeTools = (m: TranscriptMachine): ActiveTool[] =>
  [...m.openTools.values()].map(({ toolUseId, name, family, startedAt }) => ({ toolUseId, name, family, startedAt }));

/** Keeps `since` for an unchanged state, so that a late record cannot restart a timer the UI is showing. */
function keep(prev: Activity, next: Activity): Activity {
  return prev.state === next.state ? { ...next, since: prev.since } : next;
}

function fromIdleRecords(m: TranscriptMachine, prev: Activity, now: number, backgroundShell: boolean): Activity {
  if (m.last === 'errored' && m.error) {
    return keep(prev, { state: 'errored', since: m.errorAt ?? now, ...m.error });
  }
  if (m.last === 'interrupted') return keep(prev, { state: 'interrupted', since: m.lastAt ?? now });
  return keep(prev, { state: 'idle', since: now, backgroundShell });
}

function fromBusyRecords(m: TranscriptMachine, prev: Activity, now: number): Activity {
  if (m.last === 'api-error' && m.retry) {
    const { attempt, maxRetries, nextAttemptAt, at } = m.retry;
    const next: Activity = { state: 'retrying', since: at, attempt, maxRetries, ...(nextAttemptAt !== undefined ? { nextAttemptAt } : {}) };
    // A new attempt is a new state of its own, because the countdown restarts.
    return prev.state === 'retrying' && prev.attempt === attempt ? { ...next, since: prev.since } : next;
  }
  if (m.openTools.size > 0) {
    const tools = activeTools(m);
    const since = prev.state === 'tool_running' ? prev.since : Math.min(...tools.map((t) => t.startedAt));
    return { state: 'tool_running', since, tools };
  }
  const lastBlock = m.lastBlock;
  return keep(prev, { state: 'generating', since: m.requestAt ?? m.lastAt ?? now, ...(lastBlock ? { lastBlock } : {}) });
}

export interface PidView {
  status: PidStatus | string | null;
  waitingFor: string | null;
  /** When the status was written, so a wait starts where it began. */
  statusAt: number | null;
}

/** A session with a pid file. `pid.status` may lag the transcript by a tick, so the pid record decides, as RF orders it. */
export function sessionActivity(pid: PidView, m: TranscriptMachine | null, prev: Activity, now: number): Activity {
  const tail = m;
  switch (pid.status) {
    case null:
      // Absent for the first tens of ms on this build. An older CLI never writes it, and then the tail decides.
      if (tail && tail.last !== 'none') return agentActivity(tail, prev, now);
      return keep(prev, { state: 'starting', since: pid.statusAt ?? now });
    case 'waiting': {
      const reason = waitReason(pid.waitingFor);
      if (prev.state === 'waiting' && prev.reason === reason) return prev;
      return { state: 'waiting', since: pid.statusAt ?? now, reason };
    }
    case 'idle':
    case 'shell':
      if (!tail) return keep(prev, { state: 'idle', since: now, backgroundShell: pid.status === 'shell' });
      return fromIdleRecords(tail, prev, now, pid.status === 'shell');
    case 'busy':
      if (!tail) return keep(prev, { state: 'generating', since: pid.statusAt ?? now });
      return fromBusyRecords(tail, prev, now);
    default:
      return keep(prev, { state: 'unknown', since: now });
  }
}

/** Agents have no pid file. Their state comes from their own tail (RF 3.5). */
export function agentActivity(m: TranscriptMachine, prev: Activity, now: number): Activity {
  switch (m.last) {
    case 'none':
      return keep(prev, { state: 'starting', since: m.firstAt ?? now });
    case 'errored':
    case 'interrupted':
      return fromIdleRecords(m, prev, now, false);
    case 'turn-end':
    case 'cost-state':
      return keep(prev, { state: 'idle', since: m.lastAt ?? now, backgroundShell: false });
    default:
      return fromBusyRecords(m, prev, now);
  }
}

/** Equal for a reader: `since` and the tool list both count, because planes publish every transition. */
export function sameActivity(a: Activity, b: Activity): boolean {
  if (a.state !== b.state || a.since !== b.since) return false;
  if (a.state === 'tool_running' && b.state === 'tool_running') {
    return a.tools.length === b.tools.length && a.tools.every((t, i) => t.toolUseId === b.tools[i]?.toolUseId);
  }
  if (a.state === 'waiting' && b.state === 'waiting') return a.reason === b.reason;
  if (a.state === 'generating' && b.state === 'generating') return a.lastBlock === b.lastBlock;
  if (a.state === 'idle' && b.state === 'idle') return a.backgroundShell === b.backgroundShell;
  return true;
}
