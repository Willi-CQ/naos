import { execFile } from 'node:child_process';
import path from 'node:path';
import type { ProjectChange, ProjectChanges, ProjectDiff } from '@naos/protocol';
import { CommandError } from './context.ts';

const MAX_DIFF_CHARS = 48_000;
const MAX_GIT_OUTPUT = 256_000;

function git(root: string, args: string[], allowDiffExit = false): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 2_500, maxBuffer: MAX_GIT_OUTPUT }, (error, stdout) => {
      if (error) {
        const code = (error as unknown as { code?: unknown }).code;
        if (allowDiffExit && (code === 1 || code === '1')) { resolve(stdout); return; }
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

function relativePath(value: string): boolean {
  return value.length > 0 && !path.isAbsolute(value) && !value.includes('\\') && value.split('/').every((part) => part !== '..' && part !== '.' && part !== '');
}

function statusKind(code: string): ProjectChange['status'] {
  if (code === '??') return 'untracked';
  if (code.includes('U') || code === 'AA' || code === 'DD') return 'conflicted';
  if (code.includes('D')) return 'deleted';
  if (code.includes('R')) return 'renamed';
  if (code.includes('A')) return 'added';
  return 'modified';
}

async function status(root: string): Promise<ProjectChange[]> {
  const raw = await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=normal', '--ignore-submodules=all']);
  const parts = raw.split('\0');
  const changes: ProjectChange[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const row = parts[i]!;
    if (row.length < 4) continue;
    const code = row.slice(0, 2), file = row.slice(3);
    if (!relativePath(file)) { if (code.includes('R') || code.includes('C')) i += 1; continue; }
    const rename = code.includes('R') || code.includes('C');
    if (rename) i += 1; // -z emits the original name in the next NUL-delimited field.
    changes.push({ path: file, status: statusKind(code), staged: code[0] !== ' ' && code !== '??', unstaged: code[1] !== ' ' || code === '??', additions: null, deletions: null });
  }
  return changes;
}

function applyNumstat(files: ProjectChange[], text: string): void {
  const counts = new Map<string, { additions: number; deletions: number }>();
  for (const row of text.split(/\r?\n/)) {
    const first = row.indexOf('\t'), second = row.indexOf('\t', first + 1);
    if (first < 0 || second < 0) continue;
    const additions = Number(row.slice(0, first)), deletions = Number(row.slice(first + 1, second));
    const file = row.slice(second + 1);
    if (Number.isFinite(additions) && Number.isFinite(deletions)) counts.set(file, { additions, deletions });
  }
  for (const file of files) {
    const count = counts.get(file.path);
    if (count) { file.additions = count.additions; file.deletions = count.deletions; }
  }
}

export async function projectChanges(root: string, now = Date.now()): Promise<ProjectChanges> {
  try {
    const files = await status(root);
    const [branch, numstat] = await Promise.all([
      git(root, ['branch', '--show-current']).then((value) => value.trim() || 'detached').catch(() => 'detached'),
      git(root, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--numstat', 'HEAD', '--']).catch(() => git(root, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--numstat', '--'])),
    ]);
    applyNumstat(files, numstat);
    return {
      available: true, branch, files,
      additions: files.reduce((sum, file) => sum + (file.additions ?? 0), 0),
      deletions: files.reduce((sum, file) => sum + (file.deletions ?? 0), 0), updatedAt: now,
    };
  } catch {
    return { available: false, branch: null, files: [], additions: 0, deletions: 0, updatedAt: now, message: 'Git changes are unavailable for this project.' };
  }
}

export async function projectDiff(root: string, filePath: string): Promise<ProjectDiff> {
  if (typeof filePath !== 'string' || filePath.length > 1000 || !relativePath(filePath)) throw new CommandError('bad-request', 'Choose a project-relative file path.');
  let change: ProjectChange | undefined;
  try { change = (await status(root)).find((entry) => entry.path === filePath); }
  catch { throw new CommandError('unavailable', 'Git changes are unavailable for this project.'); }
  if (!change) throw new CommandError('not-found', 'That file is no longer listed as changed. Refresh the change list.');
  const args = change.status === 'untracked'
    ? ['diff', '--no-index', '--no-ext-diff', '--no-textconv', '--no-color', '--', '/dev/null', filePath]
    : ['diff', '--no-ext-diff', '--no-textconv', '--no-color', 'HEAD', '--', filePath];
  let patch: string;
  try { patch = await git(root, args, change.status === 'untracked'); }
  catch { throw new CommandError('unavailable', 'Git could not create a preview for that file.'); }
  const truncated = patch.length > MAX_DIFF_CHARS;
  patch = patch.slice(0, MAX_DIFF_CHARS);
  return { path: filePath, status: change.status, patch, truncated, binary: patch.includes('Binary files ') || patch.includes('GIT binary patch') };
}
