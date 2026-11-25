// The hybrid of AC 10. A plain `git worktree` plus cwd does not confine an agent. The kernel creates the worktree so it can
// name the branch and the base, then `extraArgs: { worktree }` makes the binary enforce it.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface GitInfo {
  isGit: boolean;
  /** The main checkout, even from inside a worktree. The folder itself when not git. */
  root: string;
  commonDir: string | null;
  hasCommit: boolean;
}

const gitEnv = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.toUpperCase().startsWith('GIT_')) delete env[key];
  return env;
};

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true, env: gitEnv(), maxBuffer: 16e6 });
  return stdout.trim();
}

export async function gitInfo(dir: string): Promise<GitInfo> {
  const none: GitInfo = { isGit: false, root: path.resolve(dir), commonDir: null, hasCommit: false };
  try {
    const top = path.resolve(await git(dir, 'rev-parse', '--show-toplevel'));
    const common = path.resolve(dir, await git(dir, 'rev-parse', '--git-common-dir'));
    const root = path.basename(common).toLowerCase() === '.git' ? path.dirname(common) : top;
    const hasCommit = await git(dir, 'rev-parse', '--verify', '--quiet', 'HEAD').then(() => true, () => false);
    return { isGit: true, root, commonDir: common, hasCommit };
  } catch {
    return none;
  }
}

export const worktreePath = (repo: string, name: string): string => path.join(repo, '.claude', 'worktrees', name);
export const branchFor = (name: string): string => `agent/${name}`;

const EXCLUDE_LINE = '.claude/worktrees/';

/** `.claude/` shows as untracked otherwise. This keeps the repo's own .gitignore out of it (AC 10). */
export function excludeWorktrees(commonDir: string): void {
  const file = path.join(commonDir, 'info', 'exclude');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (text.split(/\r?\n/).some((line) => line.trim() === EXCLUDE_LINE)) return;
  fs.appendFileSync(file, `${text === '' || text.endsWith('\n') ? '' : '\n'}${EXCLUDE_LINE}\n`);
}

/** Git makes hybrid worktrees, so `.worktreeinclude` is the kernel's job (AC 10). */
async function copyIncluded(repo: string, target: string): Promise<number> {
  const listFile = path.join(repo, '.worktreeinclude');
  if (!fs.existsSync(listFile)) return 0;
  const listed = await git(repo, 'ls-files', '--others', '--ignored', `--exclude-from=${listFile}`);
  let copied = 0;
  for (const rel of listed.split(/\r?\n/).filter(Boolean)) {
    const from = path.join(repo, rel);
    const to = path.join(target, rel);
    if (!path.resolve(to).startsWith(path.resolve(target) + path.sep) || !fs.statSync(from, { throwIfNoEntry: false })?.isFile()) continue;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    copied += 1;
  }
  return copied;
}

export interface Worktree { path: string; name: string; branch: string }

export async function createWorktree(repo: string, name: string, base = 'HEAD'): Promise<Worktree> {
  const info = await gitInfo(repo);
  if (!info.isGit || !info.commonDir) throw new Error('not a git repository');
  if (!info.hasCommit) throw new Error('the repository has no commits yet');
  excludeWorktrees(info.commonDir);
  const target = worktreePath(info.root, name);
  const branch = branchFor(name);
  await git(info.root, 'worktree', 'add', target, '-b', branch, base);
  await copyIncluded(info.root, target);
  return { path: target, name, branch };
}

export interface RemoveResult {
  removed: boolean;
  branchRemoved: boolean;
  /** Why work was kept. Null when everything went. */
  kept: string | null;
}

/**
 * Unlock first: SDK runs leave the lock behind (AC 10). Nothing is forced. Uncommitted work keeps the worktree, and commits
 * nobody merged keep the branch, so closing an agent can never destroy what it made.
 */
export async function removeWorktree(repo: string, wt: Worktree): Promise<RemoveResult> {
  if (!fs.existsSync(wt.path)) {
    const branchRemoved = await git(repo, 'branch', '-d', wt.branch).then(() => true, () => false);
    await git(repo, 'worktree', 'prune').catch(() => undefined);
    return { removed: true, branchRemoved, kept: branchRemoved ? null : 'branch' };
  }
  await git(repo, 'worktree', 'unlock', wt.path).catch(() => undefined); // Not locked is fine.
  const dirty = await git(wt.path, 'status', '--porcelain').catch(() => '?');
  if (dirty !== '') return { removed: false, branchRemoved: false, kept: 'uncommitted changes' };
  await git(repo, 'worktree', 'remove', wt.path);
  const branchRemoved = await git(repo, 'branch', '-d', wt.branch).then(() => true, () => false);
  return { removed: true, branchRemoved, kept: branchRemoved ? null : 'unmerged commits' };
}
