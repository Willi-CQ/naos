import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { CommandError } from '../../src/context.ts';
import { projectChanges, projectDiff } from '../../src/projectChanges.ts';

const roots: string[] = [];
after(async () => { await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))); });
async function repository(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'naos-changes-')); roots.push(root);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'naos-test@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'NAOS Test'], { cwd: root });
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src', 'app.ts'), 'const ready = true;\nexport { ready };\n');
  execFileSync('git', ['add', 'src/app.ts'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root });
  return root;
}

test('project changes summarize only repo-relative dirty paths and return the selected tracked diff', async () => {
  const root = await repository();
  await writeFile(path.join(root, 'src', 'app.ts'), 'const ready = false;\nexport { ready };\n');
  await writeFile(path.join(root, 'src', 'new.ts'), 'export const fresh = true;\n');
  const changes = await projectChanges(root, 1234);
  assert.equal(changes.available, true);
  assert.equal(changes.updatedAt, 1234);
  assert.deepEqual(changes.files.map((file) => file.path).sort(), ['src/app.ts', 'src/new.ts']);
  assert.ok(changes.files.every((file) => !path.isAbsolute(file.path)));
  assert.equal(changes.files.find((file) => file.path === 'src/app.ts')?.additions, 1);
  const diff = await projectDiff(root, 'src/app.ts');
  assert.match(diff.patch, /const ready = false/);
  assert.equal(diff.truncated, false);
});

test('untracked files show an add-file diff and path traversal is rejected', async () => {
  const root = await repository();
  await writeFile(path.join(root, 'fresh.ts'), 'export const fresh = 1;\n');
  const diff = await projectDiff(root, 'fresh.ts');
  assert.equal(diff.status, 'untracked');
  assert.match(diff.patch, /export const fresh = 1/);
  await assert.rejects(projectDiff(root, '../outside.ts'), (error: unknown) => error instanceof CommandError && error.code === 'bad-request');
});

test('non-git folders return an unavailable state without leaking absolute paths', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'naos-plain-')); roots.push(root);
  const changes = await projectChanges(root);
  assert.equal(changes.available, false);
  assert.deepEqual(changes.files, []);
  assert.ok(!changes.message?.includes(root));
});
