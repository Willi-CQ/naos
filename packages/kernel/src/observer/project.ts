// Which world a working directory belongs to (RF 3.3). Reads `.git` inside the user's repos, and nothing else there.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorldKind } from '@naos/protocol';
import { normalizePath } from './paths.ts';

export interface ProjectInfo {
  /** null is a rogue body: no repo and no folder worth a world. */
  root: string | null;
  kind: WorldKind;
  isGit: boolean;
  worktree: { path: string; name: string } | null;
}

const CLAUDE_WORKTREE = /^(.*?)\/\.claude\/worktrees\/([^/]+)/;
const GITDIR = /^gitdir:\s*(.+?)\s*$/m;
const WORKTREE_GITDIR = /^(.*)\/\.git\/worktrees\/([^/]+)\/?$/;
const GIT_FILE_CAP = 4096;
const CACHE_LIMIT = 4096;

const ROGUE: ProjectInfo = { root: null, kind: 'rogue', isGit: false, worktree: null };

const cache = new Map<string, ProjectInfo>();

export const clearProjectCache = (): void => cache.clear();

function statOf(p: string): fs.Stats | undefined {
  try {
    return fs.statSync(p, { throwIfNoEntry: false });
  } catch {
    return undefined;
  }
}

function readGitFile(file: string): string | null {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.allocUnsafe(GIT_FILE_CAP);
    const n = fs.readSync(fd, buf, 0, GIT_FILE_CAP, 0);
    return buf.toString('utf8', 0, n);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function fromGitFile(dir: string): ProjectInfo {
  const text = readGitFile(path.join(dir, '.git'));
  const gitdir = text ? GITDIR.exec(text)?.[1] : undefined;
  if (gitdir) {
    const resolved = normalizePath(path.resolve(dir, gitdir));
    const m = WORKTREE_GITDIR.exec(resolved);
    if (m?.[1] && m[2]) {
      return { root: normalizePath(m[1]), kind: 'repo', isGit: true, worktree: { path: normalizePath(dir), name: m[2] } };
    }
  }
  // A submodule or an unusual gitdir: this folder is still the repo the session works in.
  return { root: normalizePath(dir), kind: 'repo', isGit: true, worktree: null };
}

/** Home, temp and a drive root are places a session happens to stand, not projects. */
function isRoguePlace(cwd: string, home: string, tmp: string): boolean {
  const c = cwd.toLowerCase();
  return c === home || c.startsWith(`${tmp}/`) || c === tmp || /^[a-z]:\/?$/.test(c);
}

function resolve(cwd: string): ProjectInfo {
  const norm = normalizePath(cwd);
  const wt = CLAUDE_WORKTREE.exec(norm);
  if (wt?.[1] && wt[2]) {
    return { root: normalizePath(wt[1]), kind: 'repo', isGit: true, worktree: { path: wt[0], name: wt[2] } };
  }
  let dir = norm;
  for (;;) {
    const st = statOf(path.join(dir, '.git'));
    if (st?.isDirectory()) return { root: normalizePath(dir), kind: 'repo', isGit: true, worktree: null };
    if (st?.isFile()) return fromGitFile(dir);
    const parent = path.posix.dirname(dir);
    if (parent === dir || parent === '.') break;
    dir = parent;
  }
  const home = normalizePath(os.homedir()).toLowerCase();
  const tmp = normalizePath(os.tmpdir()).toLowerCase();
  return isRoguePlace(norm, home, tmp) ? ROGUE : { root: norm, kind: 'folder', isGit: false, worktree: null };
}

export function resolveProject(cwd: string | null): ProjectInfo {
  if (!cwd) return ROGUE;
  const hit = cache.get(cwd);
  if (hit) return hit;
  const info = resolve(cwd);
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(cwd, info);
  return info;
}

/** The transcript's `worktree-state` outranks the walk, because the folder may be gone (RF 3.3). */
export function projectOf(
  startCwd: string | null,
  worktreeState: { path: string; name?: string; originalCwd?: string } | null,
): ProjectInfo {
  if (!worktreeState) return resolveProject(startCwd);
  const base = resolveProject(worktreeState.originalCwd ?? startCwd);
  const name = worktreeState.name ?? path.posix.basename(normalizePath(worktreeState.path));
  return { ...base, worktree: { path: normalizePath(worktreeState.path), name } };
}
