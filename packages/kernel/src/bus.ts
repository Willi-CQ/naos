// One stream. Every event is stamped and numbered here, reduced with the same code the UI runs, then handed to subscribers.
import { emptyState, reduce } from '@naos/protocol';
import type { EpochMs, FleetRate, FleetState, KernelInfo, NaosEvent, NodeId, NodeRate, ServerFrames } from '@naos/protocol';
import type { Bus, EventInit, Logger } from './context.ts';

/** What main, the server and the fixture need beyond the plane contract. */
export interface KernelBus extends Bus {
  /** The kernel's clock. Wall time, or the timeline's time in a fixture kernel. */
  now(): EpochMs;
  setClock(clock: () => EpochMs): void;
  /** Replaces the state and keeps `seq` rising. Whoever serves clients must follow with a fresh snapshot. */
  reset(state: FleetState): void;
  onReset(fn: () => void): () => void;
  setKernel(info: KernelInfo): void;
  ratesFrame(): ServerFrames['rates'];
  /** Replaces every rate at once, so a seek cannot leave one behind. */
  replaceRates(nodes: readonly NodeRate[], fleet: FleetRate): void;
  onText(fn: ((nodeId: NodeId, delta: string) => void) | null): void;
}

const emptyFleetRate = (): FleetRate => ({ tps: 0, outputTokens: 0, perWorld: {}, burnUsdPerHour: 0, todayUsd: null, lagMaxMs: 0 });

export function createBus(options: { kernel: KernelInfo; log: Logger; now?: () => EpochMs }): KernelBus {
  const { log } = options;
  const bootId = Date.now().toString(36);
  let clock = options.now ?? Date.now;
  let state: FleetState = { ...emptyState(), kernel: options.kernel };

  const subscribers = new Set<(event: NaosEvent, seq: number) => void>();
  const resetListeners = new Set<() => void>();
  let textSink: ((nodeId: NodeId, delta: string) => void) | null = null;

  // A subscriber may publish. Queueing keeps every subscriber seeing events in seq order.
  const queue: EventInit[] = [];
  let draining = false;

  const nodeRates = new Map<NodeId, NodeRate>();
  /** Fields a plane set outright. Everything else is derived for each frame. */
  let fleetPatch: Partial<FleetRate> = {};
  let outputTokens = 0;

  const stamp = (init: EventInit, seq: number): NaosEvent => {
    const observedAt = init.observedAt ?? clock();
    return { ...init, id: init.id ?? `${bootId}-${seq}`, at: init.at ?? observedAt, observedAt } as NaosEvent;
  };

  const drain = (): void => {
    draining = true;
    try {
      for (let init = queue.shift(); init; init = queue.shift()) {
        const seq = state.seq + 1;
        const event = stamp(init, seq);
        state = reduce(state, [event], seq);
        for (const fn of subscribers) {
          try {
            fn(event, seq);
          } catch (error) {
            log.error('bus subscriber threw', { type: event.type, error: String(error) });
          }
        }
      }
    } finally {
      draining = false;
    }
  };

  const derivedFleet = (): FleetRate => {
    let tps = 0;
    const perWorld: Record<string, number> = {};
    for (const rate of nodeRates.values()) {
      tps += rate.tps;
      const node = state.nodes[rate.nodeId];
      const session = node && state.sessions[node.sessionId];
      if (session) perWorld[session.worldId] = (perWorld[session.worldId] ?? 0) + rate.tps;
    }
    let lagMaxMs = 0;
    for (const node of Object.values(state.nodes)) {
      if (node.endedAt === null && node.flushLagMs !== null && node.flushLagMs > lagMaxMs) lagMaxMs = node.flushLagMs;
    }
    return { ...emptyFleetRate(), tps, perWorld, outputTokens, lagMaxMs, ...fleetPatch };
  };

  return {
    publish(init) {
      queue.push(init);
      if (!draining) drain();
    },
    state: () => state,
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    pushText(nodeId, delta) {
      textSink?.(nodeId, delta);
    },
    setRate(rate) {
      const previous = nodeRates.get(rate.nodeId)?.outputTokens ?? 0;
      outputTokens += Math.max(0, rate.outputTokens - previous);
      nodeRates.set(rate.nodeId, rate);
    },
    clearRate(nodeId) {
      nodeRates.delete(nodeId);
    },
    setFleetRate(patch) {
      fleetPatch = { ...fleetPatch, ...patch };
    },

    now: () => clock(),
    setClock(next) {
      clock = next;
    },
    reset(next) {
      queue.length = 0;
      state = { ...next, kernel: state.kernel, seq: state.seq + 1 };
      for (const fn of resetListeners) fn();
    },
    onReset(fn) {
      resetListeners.add(fn);
      return () => resetListeners.delete(fn);
    },
    setKernel(info) {
      state = { ...state, kernel: info };
    },
    ratesFrame: () => ({ t: 'rates', at: clock(), fleet: derivedFleet(), nodes: [...nodeRates.values()] }),
    replaceRates(nodes, fleet) {
      nodeRates.clear();
      for (const rate of nodes) nodeRates.set(rate.nodeId, rate);
      fleetPatch = fleet;
    },
    onText(fn) {
      textSink = fn;
    },
  };
}
