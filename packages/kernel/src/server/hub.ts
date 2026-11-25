// The push side. Each client gets hello, then a snapshot, then events batched at most once per 16 ms. A client that falls
// behind never gets a replay: its stream stops, and once its socket has drained it gets a fresh snapshot.
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import type { NaosEvent, NodeId, ServerFrame } from '@naos/protocol';
import type { KernelBus } from '../bus.ts';
import { SERVER_LIMITS } from '../config.ts';
import type { Logger } from '../context.ts';

export type HubLimits = Record<'batchMs' | 'ratesMs' | 'bufferedHighBytes' | 'bufferedLowBytes' | 'staleCloseMs' | 'pingMs', number>;

interface Client {
  id: string;
  ws: WebSocket;
  /** The last seq this client holds. Events at or below it are already in its snapshot. */
  seq: number;
  /** Set while the client is behind. Nothing is sent until it drains. */
  staleSince: number | null;
  alive: boolean;
}

interface Numbered {
  seq: number;
  event: NaosEvent;
}

export interface HubStats {
  clients: number;
  frames: number;
  snapshots: number;
  dropped: number;
  stale: number;
}

export interface Hub {
  attach(ws: WebSocket, requestedId: string | null): void;
  /** A fresh hello and snapshot for everyone, after a seek or a change to KernelInfo. */
  resyncAll(): void;
  watch(clientId: string, nodeId: NodeId, on: boolean): void;
  connected(clientId: string): boolean;
  onClientGone(fn: (clientId: string) => void): void;
  stats(): HubStats;
  close(): void;
}

export function createHub(bus: KernelBus, log: Logger, limits: HubLimits = SERVER_LIMITS): Hub {
  const clients = new Set<Client>();
  const watching = new Map<string, Set<NodeId>>();
  const gone: Array<(clientId: string) => void> = [];
  const stats = { frames: 0, snapshots: 0, dropped: 0 };

  let pending: Numbered[] = [];
  let timer: NodeJS.Timeout | null = null;
  let lastFlush = 0;

  const open = (client: Client): boolean => client.ws.readyState === WebSocket.OPEN;

  const send = (client: Client, payload: string): void => {
    if (!open(client)) return;
    client.ws.send(payload, (error) => {
      if (error) log.warn('ws send failed', { client: client.id });
    });
    stats.frames += 1;
  };

  const frame = (value: ServerFrame): string => JSON.stringify(value);

  const sendSnapshot = (client: Client): void => {
    const state = bus.state();
    send(client, frame({ t: 'snapshot', seq: state.seq, state }));
    client.seq = state.seq;
    client.staleSince = null;
    stats.snapshots += 1;
  };

  /** True once the client is behind. Its socket keeps what it already took, and nothing more is added. */
  const behind = (client: Client): boolean => {
    if (client.staleSince !== null) return true;
    if (client.ws.bufferedAmount <= limits.bufferedHighBytes) return false;
    client.staleSince = performance.now();
    log.warn('ws client behind, stream dropped until it drains', { client: client.id });
    return true;
  };

  const recover = (client: Client): void => {
    if (client.staleSince === null) return;
    if (client.ws.bufferedAmount <= limits.bufferedLowBytes) {
      // It may have missed a resync while it was behind, so this is the full greeting.
      hello(client);
      sendSnapshot(client);
    } else if (performance.now() - client.staleSince > limits.staleCloseMs) {
      log.warn('ws client never drained, closing it', { client: client.id });
      client.ws.terminate();
    }
  };

  const flush = (): void => {
    timer = null;
    lastFlush = performance.now();
    const batch = pending;
    pending = [];
    const first = batch[0];
    const last = batch.at(-1);
    if (!first || !last) return;

    let whole: string | null = null;
    for (const client of clients) {
      if (behind(client)) {
        stats.dropped += batch.length;
        continue;
      }
      if (client.seq >= last.seq) continue;
      if (client.seq < first.seq - 1) {
        // Cannot happen while the bus and this hub agree. Never let a gap reach a client as events.
        sendSnapshot(client);
      } else if (client.seq === first.seq - 1) {
        whole ??= frame({ t: 'events', seq: last.seq, events: batch.map((row) => row.event) });
        send(client, whole);
      } else {
        // It joined inside this batch, and its snapshot already holds the earlier part.
        const events = batch.filter((row) => row.seq > client.seq).map((row) => row.event);
        send(client, frame({ t: 'events', seq: last.seq, events }));
      }
      client.seq = last.seq;
    }
  };

  const schedule = (): void => {
    if (timer) return;
    const wait = Math.max(0, lastFlush + limits.batchMs - performance.now());
    timer = setTimeout(flush, wait);
  };

  const unsubscribe = bus.subscribe((event, seq) => {
    pending.push({ seq, event });
    schedule();
  });

  const hello = (client: Client): void => {
    const kernel = bus.state().kernel;
    if (kernel) send(client, frame({ t: 'hello', kernel, clientId: client.id }));
  };

  const resyncAll = (): void => {
    pending = [];
    for (const client of clients) {
      if (client.staleSince !== null) continue;
      hello(client);
      sendSnapshot(client);
    }
  };

  const unsubscribeReset = bus.onReset(resyncAll);

  bus.onText((nodeId, delta) => {
    let payload: string | null = null;
    for (const client of clients) {
      if (!watching.get(client.id)?.has(nodeId) || behind(client)) continue;
      payload ??= frame({ t: 'text', nodeId, delta });
      send(client, payload);
    }
  });

  const ratesTimer = setInterval(() => {
    const payload = frame(bus.ratesFrame());
    for (const client of clients) {
      recover(client);
      if (!behind(client)) send(client, payload);
    }
  }, limits.ratesMs);

  const pingTimer = setInterval(() => {
    for (const client of clients) {
      if (!client.alive) {
        client.ws.terminate();
        continue;
      }
      client.alive = false;
      client.ws.ping();
    }
  }, limits.pingMs);

  return {
    attach(ws, requestedId) {
      const client: Client = { id: requestedId ?? randomUUID(), ws, seq: 0, staleSince: null, alive: true };
      clients.add(client);
      ws.on('pong', () => { client.alive = true; });
      // Push only. Anything a client sends is ignored, and commands go through POST /api/cmd.
      ws.on('message', () => {});
      ws.on('error', () => {});
      ws.on('close', () => {
        clients.delete(client);
        if (![...clients].some((other) => other.id === client.id)) {
          watching.delete(client.id);
          for (const fn of gone) fn(client.id);
        }
      });
      hello(client);
      sendSnapshot(client);
    },
    resyncAll,
    watch(clientId, nodeId, on) {
      const nodes = watching.get(clientId) ?? new Set<NodeId>();
      if (on) nodes.add(nodeId);
      else nodes.delete(nodeId);
      if (nodes.size > 0) watching.set(clientId, nodes);
      else watching.delete(clientId);
    },
    connected: (clientId) => [...clients].some((client) => client.id === clientId),
    onClientGone(fn) {
      gone.push(fn);
    },
    stats: () => ({ ...stats, clients: clients.size, stale: [...clients].filter((client) => client.staleSince !== null).length }),
    close() {
      if (timer) clearTimeout(timer);
      clearInterval(ratesTimer);
      clearInterval(pingTimer);
      unsubscribe();
      unsubscribeReset();
      bus.onText(null);
      for (const client of clients) client.ws.terminate();
      clients.clear();
    },
  };
}
