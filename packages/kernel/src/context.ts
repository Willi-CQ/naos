// What the kernel's parts share. Observer, Control and Server are built against this file and meet only here.
import type {
  AgentId, Command, CommandMap, CommandType, FleetRate, FleetState, KernelEvent, KernelMode, NaosEvent, NodeRate,
  NodeId, ObservedEvent, SessionId, World, WorldId,
} from '@naos/protocol';

export interface KernelConfig {
  mode: KernelMode;
  port: number;
  /** `<repo>/.naos`, or NAOS_HOME. Tokens, database, audit log, layout.json. Never under ~/.claude. */
  home: string;
  /** Read only. Nothing in NAOS writes here. */
  claudeHome: string;
  /** Where the built UI lives. */
  uiDist: string;
  /** Repo root, for agents/ and docs/bench/. */
  repoRoot: string;
  /** Origins allowed besides the kernel's own, such as the Vite dev server. */
  devOrigins: string[];
}

/** Without id, at and observedAt, which the bus stamps when they are absent. */
type Stamp<E> = E extends unknown ? Omit<E, 'id' | 'at' | 'observedAt'> & Partial<Pick<NaosEvent, 'id' | 'at' | 'observedAt'>> : never;
export type EventInit = Stamp<ObservedEvent> | Stamp<KernelEvent>;

export interface Bus {
  /** Reduces into the state, assigns a sequence number, and schedules a batched push to clients. */
  publish(event: EventInit): void;
  /** Reduced state. Do not mutate. */
  state(): FleetState;
  /** Fires synchronously after an event was reduced. */
  subscribe(fn: (event: NaosEvent, seq: number) => void): () => void;
  /** Message text for clients that asked with `craft.watchText`. Never reduced, stored or logged. Dropped when nobody watches. */
  pushText(nodeId: NodeId, delta: string): void;
  /** Latest rate per craft. The server pushes a `rates` frame at 4 Hz, so publishing is cheap. */
  setRate(rate: NodeRate): void;
  clearRate(nodeId: NodeId): void;
  setFleetRate(patch: Partial<FleetRate>): void;
}

export type CommandHandler<K extends CommandType> = (
  input: Extract<Command, { type: K }>,
  caller: { scope: 'ui' | 'mcp' },
) => Promise<CommandMap[K]['out']> | CommandMap[K]['out'];

/** Throw this from a handler to return a typed error instead of `internal`. */
export class CommandError extends Error {
  readonly code: 'bad-request' | 'not-found' | 'forbidden' | 'conflict' | 'limit' | 'unavailable';
  constructor(code: CommandError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

export interface Router {
  register<K extends CommandType>(type: K, handler: CommandHandler<K>): void;
}

export interface Logger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

/** One SQLite file at `<home>/naos.db`. Each plane owns its tables and creates them in start(). */
export interface Db {
  exec(sql: string): void;
  run(sql: string, ...params: Array<string | number | bigint | null | Uint8Array>): void;
  get<T>(sql: string, ...params: Array<string | number | bigint | null | Uint8Array>): T | undefined;
  all<T>(sql: string, ...params: Array<string | number | bigint | null | Uint8Array>): T[];
}

/** Worlds are shared: Observer and Control both name them, layout.json keeps their slots. */
export interface Worlds {
  /** Normalizes the root, assigns a slot on first sight, persists it, and publishes `world.upserted` when it changed. */
  ensure(projectRoot: string | null, patch?: Partial<World>): World;
  get(worldId: WorldId): World | undefined;
  /** By root, without assigning a slot, because a preflight on an unknown folder must not create a world. */
  find(projectRoot: string): World | undefined;
  setTrusted(worldId: WorldId, trusted: boolean): void;
  /** Keeps a designer's planet. It is validated again here, so nothing but a drawable genome is ever stored or sent. */
  setGenome(worldId: WorldId, genome: unknown): void;
}

/**
 * The dedupe contract, AC 13. Control fills it before calling query(). For a managed session, the Observer stays quiet
 * on the main node, because control frames are live and outrank the transcript. It still reports that session's
 * subagents and workflows, which only the disk knows about.
 */
export interface ManagedRegistry {
  lookup(key: { sessionId?: SessionId; pid?: number; title?: string }): AgentId | null;
  /** Adds to what is known. Control calls it before query(), and again when resume brings a new pid or fork a new sessionId. */
  register(agentId: AgentId, key: { sessionId: SessionId; pid?: number; title?: string }): void;
  unregister(agentId: AgentId): void;
}

export interface KernelContext {
  nativeText?: {
    ownsNode(id: string): boolean;
    textRows(id: string, limit?: number): { rows: import('@naos/protocol').TextRow[]; available: boolean };
    channel(id: string, limit?: number): { rows: import('@naos/protocol').ChannelRow[]; complete: boolean };
  };
  externalHistory?: () => import('@naos/protocol').HistoryDigest[];
  config: KernelConfig;
  bus: Bus;
  router: Router;
  db: Db;
  log: Logger;
  worlds: Worlds;
  managed: ManagedRegistry;
}

/** Observer, Control and the fixture engine are planes. main.ts starts them after the server listens. */
export interface Plane {
  readonly name: string;
  start(ctx: KernelContext): Promise<void>;
  stop(): Promise<void>;
}
