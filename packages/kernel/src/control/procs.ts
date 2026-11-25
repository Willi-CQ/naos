// Windows process facts, AC 3.4. One snapshot costs about 1.2 s, so it serves boots and sweeps, never polling.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface Proc {
  pid: number;
  ppid: number;
  name: string;
  /** FILETIME as decimal text. Comparable with `procStart` of a pid file within 10 ticks (RF 2.4). */
  created: string;
}

export type Snapshot = () => Promise<Proc[]>;
export type TreeKill = (pid: number) => Promise<boolean>;

const PS = "Get-CimInstance Win32_Process | ForEach-Object { if ($_.CreationDate) { '{0}|{1}|{2}|{3}' -f $_.ProcessId,$_.ParentProcessId,$_.CreationDate.ToFileTimeUtc(),$_.Name } }";

export const parseSnapshot = (text: string): Proc[] => {
  const out: Proc[] = [];
  for (const line of text.split(/\r?\n/)) {
    const [pid, ppid, created, ...name] = line.split('|');
    if (!pid || !ppid || !created || name.length === 0) continue;
    out.push({ pid: Number(pid), ppid: Number(ppid), created, name: name.join('|') });
  }
  return out;
};

export async function snapshot(): Promise<Proc[]> {
  if (process.platform !== 'win32') return [];
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS], {
    encoding: 'utf8', maxBuffer: 64e6, windowsHide: true,
  });
  return parseSnapshot(stdout);
}

/**
 * Windows keeps a dead parent's pid in ParentProcessId and reuses pids, so a browser or a chat client can name one of our shells as its
 * parent. A process older than the holder of that pid cannot be its child. This was seen for real: a user's app in a craft's tree.
 */
function olderThan(child: Proc, parent: Proc | undefined): boolean {
  if (!parent) return false;
  try {
    return BigInt(child.created) < BigInt(parent.created);
  } catch {
    return false;
  }
}

function walkTree(root: number, procs: readonly Proc[], keep: (child: Proc, parent: Proc | undefined) => boolean): Proc[] {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const out: Proc[] = [];
  const seen = new Set<number>([root]);
  const walk = (pid: number): void => {
    for (const p of procs) {
      if (p.ppid === pid && !seen.has(p.pid) && keep(p, byPid.get(pid))) {
        seen.add(p.pid);
        out.push(p);
        walk(p.pid);
      }
    }
  };
  walk(root);
  return out;
}

/** Every process under `root`, root excluded. Only real children count, see `olderThan`. */
export function descendants(root: number, procs: readonly Proc[]): Proc[] {
  return walkTree(root, procs, (child, parent) => !olderThan(child, parent));
}

/** `taskkill /T` follows the same parent pids. `each` names the real tree, children first, for when /T would reach a stranger. */
export function killPlan(root: number, procs: readonly Proc[]): { kind: 'tree' } | { kind: 'each'; pids: number[] } {
  const real = descendants(root, procs);
  if (walkTree(root, procs, () => true).length === real.length) return { kind: 'tree' };
  return { kind: 'each', pids: [...real.map((p) => p.pid).reverse(), root] };
}

const SHELLS = new Set(['bash.exe', 'sh.exe', 'powershell.exe', 'pwsh.exe', 'cmd.exe']);

/** The shells a CLI started, with all they started. MCP servers die with the CLI, so they need no row (AC 2.4). */
export function shellTrees(cliPid: number, procs: readonly Proc[]): Proc[] {
  const out: Proc[] = [];
  for (const p of procs) {
    if (p.ppid !== cliPid || !SHELLS.has(p.name.toLowerCase())) continue;
    out.push(p, ...descendants(p.pid, procs));
  }
  return out;
}

/** Epoch milliseconds as the FILETIME a snapshot reports. */
export const toFiletime = (ms: number): string => String((BigInt(Math.trunc(ms)) + 11_644_473_600_000n) * 10_000n);

/**
 * Shells a dead CLI left behind. Windows keeps a dead parent's pid in ParentProcessId, so they stay findable with no row at all.
 * The pid may be reused since, so a live holder rules the search out, and only shells started inside `from..to` count.
 */
export function orphanedShells(cliPid: number, from: string, to: string, procs: readonly Proc[]): Proc[] {
  if (procs.some((p) => p.pid === cliPid)) return [];
  const [start, end] = [BigInt(from), BigInt(to)];
  return procs.filter((p) => {
    if (p.ppid !== cliPid || !SHELLS.has(p.name.toLowerCase())) return false;
    const created = BigInt(p.created);
    return created >= start && created <= end;
  });
}

/** Same process, not merely the same pid. PIDs get reused (AC 7.12). A value above 3e17 is the old format, so it never matches. */
export function sameStart(a: string, b: string): boolean {
  try {
    const [x, y] = [BigInt(a), BigInt(b)];
    if (x > 300_000_000_000_000_000n || y > 300_000_000_000_000_000n) return false;
    return (x > y ? x - y : y - x) <= 10n;
  } catch {
    return false;
  }
}

/** Exit code only. taskkill's text is localized (AC 7.6). */
export async function treeKill(pid: number): Promise<boolean> {
  try {
    if (process.platform !== 'win32') {
      process.kill(pid, 'SIGKILL');
      return true;
    }
    const plan = killPlan(pid, await snapshot().catch(() => []));
    if (plan.kind === 'tree') {
      await run('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
      return true;
    }
    let killed = false;
    for (const each of plan.pids) {
      await run('taskkill', ['/PID', String(each), '/F'], { windowsHide: true }).then(() => { killed = true; }, () => {});
    }
    return killed;
  } catch {
    return false;
  }
}
