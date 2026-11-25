// Starts world designers, one auto at a time, and keeps the planet they write. A blocked Claude account is a backoff, not a loop.
import { WORLD_DESIGNER_PROFILE, parseDesignerOutput, type World, type WorldId } from '@naos/protocol';
import { CommandError, type Bus, type Logger, type Worlds } from '../context.ts';
import type { Supervisor } from './supervisor.ts';

const LIVE = new Set(['queued', 'spawning', 'ready', 'running', 'awaiting_approval', 'idle', 'parked', 'budget_exhausted', 'rate_limited', 'stopping']);
const WAIT_S = 180;
const AUTO_LIVE = 1;
const BACKOFF_MS = [30_000, 120_000, 480_000, 1_800_000, 7_200_000] as const;

export interface DesignersDeps {
  supervisor: Supervisor;
  worlds: Worlds;
  bus: Bus;
  log: Logger;
}

export class WorldDesigners {
  readonly #d: DesignersDeps;
  #watching = false;
  #unsub: (() => void) | null = null;
  #busy = 0;
  #waiting = new Set<WorldId>();
  #tries = new Map<WorldId, number>();
  #timers = new Map<WorldId, NodeJS.Timeout>();
  #collecting = new Map<string, Promise<void>>();

  constructor(deps: DesignersDeps) {
    this.#d = deps;
  }

  /** UI command. Redesigns even when a planet is already there. One live designer per world. */
  async request(worldId: WorldId): Promise<{ agentIds: string[]; queued: number }> {
    const world = this.#d.worlds.get(worldId);
    if (!world) throw new CommandError('not-found', 'That world is not known.');
    if (world.kind === 'belt' || world.projectRoot === null) throw new CommandError('bad-request', 'The Belt has no planet.');
    this.#waiting.delete(worldId);
    this.#clearWait(worldId);
    const receipt = await this.#d.supervisor.design(worldId, { kind: 'ui' });
    for (const id of receipt.agentIds) void this.#collect(id, worldId);
    return receipt;
  }

  /** Live kernel only. Worlds that still have the facts planet get a designer, one after another. */
  watch(): void {
    if (this.#watching) return;
    this.#watching = true;
    this.#unsub = this.#d.bus.subscribe((event) => {
      if (event.type === 'world.upserted') this.#consider(event.world);
    });
    for (const world of Object.values(this.#d.bus.state().worlds)) this.#consider(world);
  }

  stop(): void {
    this.#watching = false;
    this.#unsub?.();
    this.#unsub = null;
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
    this.#waiting.clear();
  }

  #consider(world: World): void {
    if (!this.#watching) return;
    if (world.genome || world.kind === 'belt' || world.kind === 'offworld' || world.projectRoot === null) return;
    if (world.kind !== 'repo' && world.kind !== 'folder') return;
    if (this.#waiting.has(world.worldId) || this.#timers.has(world.worldId)) return;
    if (this.#liveOn(world.worldId)) return;
    this.#waiting.add(world.worldId);
    this.#pump();
  }

  #pump(): void {
    if (this.#busy >= AUTO_LIVE) return;
    for (const worldId of this.#waiting) {
      const world = this.#d.worlds.get(worldId);
      this.#waiting.delete(worldId);
      if (!world || world.genome) continue;
      this.#busy += 1;
      void this.#autoStart(worldId).finally(() => {
        this.#busy = Math.max(0, this.#busy - 1);
        this.#pump();
      });
      return;
    }
  }

  async #autoStart(worldId: WorldId): Promise<void> {
    try {
      const receipt = await this.request(worldId);
      await Promise.all(receipt.agentIds.map((id) => this.#collect(id, worldId)));
    } catch (error: unknown) {
      this.#d.log.warn('world designer did not start', { error: String(error).slice(0, 160) });
      this.#retry(worldId);
    }
  }

  #collect(agentId: string, worldId: WorldId): Promise<void> {
    const known = this.#collecting.get(agentId);
    if (known) return known;
    const work = this.#d.supervisor.wait(agentId, WAIT_S)
      .then(({ result, done }) => {
        if (!done) {
          this.#retry(worldId);
          return;
        }
        const parsed = result ? parseDesignerOutput(result) : null;
        if (!parsed) {
          this.#d.log.warn('world designer wrote no genome', {});
          this.#retry(worldId);
          return;
        }
        this.#d.worlds.setGenome(worldId, parsed.genome);
        this.#tries.delete(worldId);
      })
      .catch((error: unknown) => {
        this.#d.log.warn('world designer did not finish', { error: String(error).slice(0, 160) });
        this.#retry(worldId);
      })
      .finally(() => { this.#collecting.delete(agentId); });
    this.#collecting.set(agentId, work);
    return work;
  }

  #liveOn(worldId: WorldId): boolean {
    return Object.values(this.#d.bus.state().managed).some((agent) => (
      agent.worldId === worldId && agent.profile === WORLD_DESIGNER_PROFILE && (LIVE.has(agent.state) || agent.state === 'queued')
    ));
  }

  #retry(worldId: WorldId): void {
    if (!this.#watching) return;
    const world = this.#d.worlds.get(worldId);
    if (!world || world.genome) return;
    const n = this.#tries.get(worldId) ?? 0;
    this.#tries.set(worldId, n + 1);
    this.#clearWait(worldId);
    const timer = setTimeout(() => {
      this.#timers.delete(worldId);
      this.#consider(world);
    }, BACKOFF_MS[Math.min(n, BACKOFF_MS.length - 1)]);
    timer.unref();
    this.#timers.set(worldId, timer);
  }

  #clearWait(worldId: WorldId): void {
    const timer = this.#timers.get(worldId);
    if (timer) clearTimeout(timer);
    this.#timers.delete(worldId);
  }
}
