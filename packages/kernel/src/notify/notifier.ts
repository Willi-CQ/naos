// An approval has no deadline, and with one display NAOS can sit behind the editor for hours. So the kernel raises a toast
// when nobody is looking, then again at 2 and at 10 minutes, at most 3 per decision. A slot that finds a client looking is
// spent without a toast, so answering in the page stays the quiet path.
import type { ApprovalView, EpochMs, FleetState, RequestId } from '@naos/protocol';
import type { Bus, Logger } from '../context.ts';
import type { Toast } from './toast.ts';

/** Offsets of the three chances, DESIGN 3.7. */
const SLOTS_MS = [0, 120_000, 600_000];
/** Survives a client that reported focus without an open socket, so a stale report cannot silence toasts for good. */
const UNBOUND_REPORT_MS = 60_000;

const GREEK = 'αβγδεζηθικλμνξοπρστυφχψω';

interface Presence {
  visible: boolean;
  focused: boolean;
  veiled: boolean;
  at: EpochMs;
}

export interface Notifier {
  report(clientId: string, presence: { visible: boolean; focused: boolean; notifications: boolean; veiled?: boolean }): void;
  drop(clientId: string): void;
  /** True while some client reports visible and focused. */
  watched(): boolean;
  stop(): void;
}

export interface NotifierOptions {
  bus: Bus;
  log: Logger;
  /** Off in fixture mode, with NAOS_NO_TOAST, and under the test runner. Presence is still tracked. */
  enabled: boolean;
  raise(toast: Toast): void;
  /** Where a click on this decision goes. The port is known only after listen. */
  link(requestId: RequestId): string;
  connected(clientId: string): boolean;
  /** The Settings switch, read once at start and saved on change. */
  load(): boolean;
  save(on: boolean): void;
  now?: () => EpochMs;
}

/** `kestrel β`, by launch order inside the world, the same letter the UI shows. */
function craftName(state: FleetState, approval: ApprovalView): string {
  const world = state.worlds[approval.worldId]?.name ?? 'NAOS';
  const node = state.nodes[approval.nodeId];
  if (!node) return world;
  const order = Object.values(state.sessions)
    .filter((session) => session.worldId === approval.worldId)
    .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
  const index = order.findIndex((session) => session.sessionId === node.sessionId);
  const letter = GREEK[index];
  return letter ? `${world} ${letter}` : world;
}

export function createNotifier(options: NotifierOptions): Notifier {
  const { bus, log, enabled, raise, link, connected } = options;
  const now = options.now ?? Date.now;
  const clients = new Map<string, Presence>();
  const timers = new Map<RequestId, NodeJS.Timeout[]>();
  let switchedOn = options.load();

  const watched = (): boolean => {
    for (const [clientId, presence] of clients) {
      if (!presence.visible || !presence.focused) continue;
      if (connected(clientId) || now() - presence.at < UNBOUND_REPORT_MS) return true;
    }
    return false;
  };

  const chance = (approval: ApprovalView): void => {
    if (!switchedOn || watched()) return;
    const open = bus.state().approvals[approval.requestId];
    if (!open || open.status !== 'open') return;
    log.info('toast', { requestId: approval.requestId, tool: approval.toolName });
    const veiled = [...clients.values()].some((presence) => presence.veiled);
    raise({
      text: `${veiled ? 'A craft' : craftName(bus.state(), approval)} needs approval: ${approval.toolName}`,
      url: link(approval.requestId),
    });
  };

  const settle = (requestId: RequestId): void => {
    for (const timer of timers.get(requestId) ?? []) clearTimeout(timer);
    timers.delete(requestId);
  };

  const unsubscribe = bus.subscribe((event) => {
    if (!enabled) return;
    switch (event.type) {
      case 'approval.requested': {
        const { approval } = event;
        if (approval.status !== 'open' || timers.has(approval.requestId)) return;
        timers.set(approval.requestId, SLOTS_MS.map((delay) => setTimeout(() => chance(approval), delay)));
        return;
      }
      case 'approval.answered':
      case 'approval.cancelled':
      case 'approval.expired':
        settle(event.requestId);
        return;
      default:
    }
  });

  return {
    report(clientId, { visible, focused, notifications, veiled }) {
      clients.set(clientId, { visible, focused, veiled: veiled === true, at: now() });
      if (notifications !== switchedOn) {
        switchedOn = notifications;
        options.save(notifications);
      }
    },
    drop(clientId) {
      clients.delete(clientId);
    },
    watched,
    stop() {
      unsubscribe();
      for (const requestId of [...timers.keys()]) settle(requestId);
    },
  };
}
