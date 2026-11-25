// If the kernel dies, claude.exe dies with it and the Bash tree does not (AC 1.5). So running shells are written down as
// {pid, creationDate}, and a boot kills what survived. A snapshot costs 1.2 s, so it runs only while a shell is open.
import type { AgentId } from '@naos/protocol';
import type { Logger } from '../context.ts';
import { orphanedShells, sameStart, shellTrees, toFiletime, type Proc, type Snapshot, type TreeKill } from './procs.ts';
import type { Store } from './store.ts';

const FIRST_SCAN_MS = 500; // The hook fires before the shell exists.
const NEXT_SCAN_MS = 3000;
const SHELL_START_MS = 30_000; // From the audited step to the shell existing. Git Bash is slow to start.

export interface TreeDeps {
  store: Store;
  snapshot: Snapshot;
  treeKill: TreeKill;
  log: Logger;
  pidOf(agentId: AgentId): number | null;
  now?: () => number;
}

export class ToolTrees {
  readonly #d: TreeDeps;
  readonly #open = new Map<AgentId, number>();
  #timer: NodeJS.Timeout | null = null;
  #scanning = false;

  constructor(deps: TreeDeps) {
    this.#d = deps;
  }

  shellStarted(agentId: AgentId): void {
    this.#open.set(agentId, (this.#open.get(agentId) ?? 0) + 1);
    this.#schedule(FIRST_SCAN_MS);
  }

  shellFinished(agentId: AgentId): void {
    const left = (this.#open.get(agentId) ?? 1) - 1;
    if (left > 0) this.#open.set(agentId, left);
    else this.#open.delete(agentId);
  }

  #schedule(ms: number): void {
    if (this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.#scan();
    }, ms);
    this.#timer.unref();
  }

  async #scan(): Promise<void> {
    if (this.#scanning || this.#open.size === 0) return;
    this.#scanning = true;
    try {
      const procs = await this.#d.snapshot();
      for (const agentId of this.#open.keys()) {
        const pid = this.#d.pidOf(agentId);
        if (pid !== null) this.record(agentId, shellTrees(pid, procs));
      }
    } catch (e) {
      this.#d.log.warn('control: process snapshot failed', { error: String(e) });
    }
    this.#scanning = false;
    if (this.#open.size > 0) this.#schedule(NEXT_SCAN_MS);
  }

  record(agentId: AgentId, procs: readonly Proc[]): void {
    const at = (this.#d.now ?? Date.now)();
    for (const p of procs) this.#d.store.saveToolTree({ pid: p.pid, created: p.created, agentId, name: p.name, at });
  }

  /** Stop leaves nothing, and a background shell can outlive its tool. Rows stay until their agent is gone. */
  async sweep(agentId?: AgentId): Promise<number> {
    if (agentId !== undefined) this.#open.delete(agentId);
    const rows = this.#d.store.toolTrees(agentId);
    if (rows.length === 0) return 0;
    const procs = await this.#d.snapshot();
    let killed = 0;
    for (const row of rows) {
      if (procs.some((p) => p.pid === row.pid && sameStart(p.created, row.created)) && await this.#d.treeKill(row.pid)) killed += 1;
    }
    this.#d.store.clearToolTrees(agentId);
    if (killed > 0) this.#d.log.info('control: killed orphaned tool processes', { killed });
    return killed;
  }

  /**
   * A scan runs every 3 s, so the newest shell may have no row when the CLI dies. This finds it from the CLI's own pid.
   * A shell can only start after the agent's last audited step, so that step bounds the search.
   */
  async sweepDeadCli(agentId: AgentId, cliPid: number, startedAt: string, procs: readonly Proc[]): Promise<number> {
    const last = this.#d.store.auditRows(agentId).at(-1);
    if (!last) return 0;
    let killed = 0;
    for (const shell of orphanedShells(cliPid, startedAt, toFiletime(last.at + SHELL_START_MS), procs)) {
      if (await this.#d.treeKill(shell.pid)) killed += 1;
    }
    if (killed > 0) this.#d.log.info('control: killed shells of a dead process', { killed });
    return killed;
  }

  stop(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }
}
