import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { listProjectSkills, readProjectSkill } from '../../src/skills.ts';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function temp(label: string): Promise<string> { const root = await mkdtemp(path.join(os.tmpdir(), `naos-${label}-`)); roots.push(root); return root; }

test('skill picker returns bounded metadata and loads instructions only after a selected reference is read', async () => {
  const root = await temp('skills-project'), home = await temp('skills-home'), codex = path.join(home, 'codex');
  const projectSkill = path.join(root, '.agents', 'skills', 'project-tour');
  const cursorCommand = path.join(root, '.cursor', 'commands');
  const userSkill = path.join(codex, 'skills', 'refactor');
  await mkdir(projectSkill, { recursive: true }); await mkdir(cursorCommand, { recursive: true }); await mkdir(userSkill, { recursive: true });
  await writeFile(path.join(projectSkill, 'SKILL.md'), '---\nname: Tour\ndescription: Explain this repository\n---\nInspect the entry points and describe how the project fits together.\n');
  await writeFile(path.join(cursorCommand, 'review.md'), '---\ndescription: Review pending changes\n---\nFind correctness risks and report file locations.\n');
  await writeFile(path.join(userSkill, 'SKILL.md'), '---\nname: Refactor\ndescription: Improve structure safely\n---\nKeep behavior stable while simplifying the implementation.\n');
  const env = { CODEX_HOME: codex };
  const entries = await listProjectSkills(root, true, env, home);
  assert.deepEqual(entries.map((entry) => entry.name).sort(), ['Refactor', 'Tour', 'review']);
  assert.ok(entries.every((entry) => !entry.id.includes(root) && !entry.id.includes(home)));
  assert.equal(entries.find((entry) => entry.name === 'review')?.client, 'cursor');
  const selected = await readProjectSkill(root, true, entries.find((entry) => entry.name === 'Tour')!.id, env, home);
  assert.match(selected.instructions, /Inspect the entry points/);
  assert.equal(selected.truncated, false);
});

test('untrusted project workflow files stay invisible, and a forged reference cannot read them', async () => {
  const root = await temp('skills-untrusted'), home = await temp('skills-home');
  const folder = path.join(root, '.claude', 'skills', 'unsafe');
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, 'SKILL.md'), '---\nname: Unsafe\n---\nProject instructions.\n');
  assert.deepEqual(await listProjectSkills(root, false, {}, home), []);
  await assert.rejects(readProjectSkill(root, false, 'project:claude-code:skill:unsafe', {}, home), /unavailable until the project is trusted/);
});

test('symlink skill folders are ignored', async (t) => {
  const root = await temp('skills-links'), home = await temp('skills-home'), external = await temp('skills-external');
  const outside = path.join(external, 'SKILL.md');
  await writeFile(outside, '---\nname: Outside\n---\nNever expose through a project symlink.\n');
  const skills = path.join(root, '.agents', 'skills');
  await mkdir(skills, { recursive: true });
  try { await symlink(external, path.join(skills, 'linked'), 'junction'); }
  catch { t.skip('This account cannot create directory links.'); return; }
  assert.deepEqual(await listProjectSkills(root, true, {}, home), []);
  assert.match(await readFile(outside, 'utf8'), /Never expose/);

  const aliasedRoot = await temp('skills-aliased-root'), agentsOutside = path.join(external, 'linked-agents');
  await mkdir(path.join(agentsOutside, 'skills', 'private'), { recursive: true });
  await writeFile(path.join(agentsOutside, 'skills', 'private', 'SKILL.md'), '---\nname: Outside parent\n---\nDo not expose a symlinked parent.\n');
  try { await symlink(agentsOutside, path.join(aliasedRoot, '.agents'), 'junction'); }
  catch { t.skip('This account cannot create parent directory links.'); return; }
  assert.deepEqual(await listProjectSkills(aliasedRoot, true, {}, home), []);
});
