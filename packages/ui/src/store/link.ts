// The WebSocket to the kernel. It knows frames and time, nothing about the fleet. The store owns what a frame means.
import type { ServerFrame } from '@naos/protocol';

/** Section 12.3: 1, 2, 4, 8 s, then every 10 s. */
export const backoffMs = (attempt: number): number => (attempt < 4 ? 1000 * 2 ** attempt : 10_000);

export interface SocketLike {
  readyState?: number;
  onopen: ((ev: never) => void) | null;
  onclose: ((ev: never) => void) | null;
  onerror: ((ev: never) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  close(): void;
}

export interface LinkOptions {
  /** Called on every attempt, so the client id learned from `hello` joins the next url. */
  url(): string;
  open(url: string): SocketLike;
  onFrame(frame: ServerFrame): void;
  /** `up` with a new socket, `down` when one was lost or an attempt failed. */
  onUp(): void;
  onDown(attempt: number): void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
  now?: () => number;
}

export interface Link {
  connect(): void;
  /** Drops this socket and comes straight back, for a sequence gap or a dead socket. A fresh connect brings a snapshot. */
  resync(): void;
  close(): void;
}

export function createLink(o: LinkOptions): Link {
  const later = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = o.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let socket: SocketLike | null = null;
  let timer: unknown = null;
  let attempt = 0;
  let closed = false;
  let connectingAt = 0;
  const now = o.now ?? Date.now;

  const retry = (delay: number): void => {
    if (closed || timer !== null) return;
    timer = later(() => {
      timer = null;
      connect();
    }, delay);
  };

  const detach = (): void => {
    if (!socket) return;
    socket.onopen = socket.onclose = socket.onerror = socket.onmessage = null;
    try { socket.close(); } catch { /* it was already gone */ }
    socket = null;
  };

  const lost = (s: SocketLike): void => {
    if (s !== socket) return;
    detach();
    const delay = backoffMs(attempt);
    o.onDown(attempt);
    attempt += 1;
    retry(delay);
  };

  function connect(): void {
    if (closed || socket) return;
    let s: SocketLike;
    try {
      s = o.open(o.url());
    } catch {
      const delay = backoffMs(attempt);
      o.onDown(attempt);
      attempt += 1;
      retry(delay);
      return;
    }
    socket = s;
    connectingAt = now();
    s.onopen = () => {
      if (s !== socket) return;
      attempt = 0;
      o.onUp();
    };
    s.onclose = () => lost(s);
    s.onerror = () => lost(s);
    s.onmessage = (ev) => {
      if (s !== socket || typeof ev.data !== 'string') return;
      try {
        o.onFrame(JSON.parse(ev.data) as ServerFrame);
      } catch {
        // A frame this client cannot read is dropped. The next `seq` shows the gap and resyncs.
      }
    };
  }

  return {
    connect,
    resync() {
      // A stale-frame watchdog can fire again before a replacement socket's handshake completes.
      if (socket?.readyState === 0 && now() - connectingAt < 10000) return;
      detach();
      if (timer !== null) { cancel(timer); timer = null; }
      connect();
    },
    close() {
      closed = true;
      if (timer !== null) { cancel(timer); timer = null; }
      detach();
    },
  };
}
