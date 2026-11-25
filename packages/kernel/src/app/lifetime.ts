// How long a kernel started by `naos open` stays. Closing the window is not a reason to stop, because agents keep working
// behind it. Only a long stretch with nobody watching, no craft alive and no decision waiting ends it.
import type { AgentState, FleetState } from '@naos/protocol';

const ENDED: ReadonlySet<AgentState> = new Set(['exited', 'crashed', 'lost', 'closed']);

export const liveCraft = (state: FleetState): number =>
  Object.values(state.managed).filter((agent) => !ENDED.has(agent.state)).length;

export const openDecisions = (state: FleetState): number =>
  Object.values(state.approvals).filter((approval) => approval.status === 'open').length;

export interface Occupancy {
  clients: number;
  craft: number;
  decisions: number;
}

/** When the quiet stretch began, or null while anything still needs the kernel. */
export const quietSince = (since: number | null, occupancy: Occupancy, now: number): number | null =>
  occupancy.clients + occupancy.craft + occupancy.decisions > 0 ? null : since ?? now;

export interface IdleWatch {
  /** Someone is about to attach. Starts the quiet stretch again. */
  touch(): void;
  stop(): void;
}

export interface IdleOptions {
  limitMs: number;
  read(): Occupancy;
  onIdle(): void;
  now?: () => number;
}

const TICK_MS = 5000;

export function createIdleWatch(options: IdleOptions): IdleWatch {
  const now = options.now ?? Date.now;
  let since: number | null = now();
  const timer = setInterval(() => {
    since = quietSince(since, options.read(), now());
    if (since === null || now() - since < options.limitMs) return;
    clearInterval(timer);
    options.onIdle();
  }, Math.max(100, Math.min(TICK_MS, options.limitMs / 4)));
  timer.unref();
  return {
    touch() {
      since = now();
    },
    stop() {
      clearInterval(timer);
    },
  };
}
