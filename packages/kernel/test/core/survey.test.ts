import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import type { ProjectSurvey } from '@naos/protocol';
import { surveyProject } from '../../src/survey.ts';
import { boot, post, run } from './helpers.ts';

const roots: string[] = [];
function scratch() { const root = mkdtempSync(path.join(os.tmpdir(), 'naos-survey-')); roots.push(root); return root; }
function file(root: string, name: string) { const target = path.join(root, name); mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, 'private contents are never part of a survey'); }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test('a survey charts actual workspace packages without file contents, hidden data, dependencies or linked directories', async () => {
  const root = scratch(), elsewhere = scratch();
  for (const name of ['packages/ui/src/App.tsx', 'packages/kernel/src/main.ts', 'test/main.test.ts', 'docs/guide.md', 'package.json', '.env', '.naos/key', 'node_modules/vendor/lib.ts', 'dist/output.js']) file(root, name);
  file(elsewhere, 'outside.ts');
  symlinkSync(elsewhere, path.join(root, 'linked'), 'junction');
  const survey = await surveyProject(root);
  assert.equal(survey.files, 5);
  assert.equal(survey.complete, true);
  assert.equal(survey.regions.find((r) => r.path === 'packages/ui')?.kind, 'interface');
  assert.equal(survey.regions.find((r) => r.path === 'packages/kernel')?.kind, 'service');
  assert.deepEqual(survey.languages, [{ name: 'TypeScript', files: 3 }, { name: 'Markdown', files: 1 }]);
  assert.ok(survey.regions.flatMap((r) => r.entries).every((p) => !path.isAbsolute(p) && !p.includes('outside') && !p.startsWith('.')));
  assert.ok(!JSON.stringify(survey).includes('private contents'));
});

test('large and deep projects report a partial survey rather than blocking or claiming a complete count', async () => {
  const root = scratch();
  for (let i = 0; i < 20; i += 1) file(root, `src/file${i}.ts`);
  file(root, 'nested/a/b/c/main.ts');
  const bounded = await surveyProject(root, { files: 4, entries: 100, depth: 6, ms: 2000 });
  assert.equal(bounded.files, 4);
  assert.equal(bounded.complete, false);
  const shallow = await surveyProject(root, { files: 100, entries: 100, depth: 1, ms: 2000 });
  assert.equal(shallow.complete, false);
  assert.equal(shallow.files, 20);
});

test('the survey endpoint accepts a known world only and keeps project geography in UI scope', async () => {
  const root = scratch(); file(root, 'src/main.ts');
  let worldId = '';
  const kernel = await boot('live', { planes: [{ name: 'survey-test', async start(ctx) {
    const world = ctx.worlds.ensure(root);
    worldId = world.worldId;
    ctx.bus.publish({ type: 'world.upserted', world: { ...world, kind: 'repo', projectRoot: root } });
  }, async stop() {} }] });
  try {
    const survey = await run<ProjectSurvey>(kernel, { type: 'world.survey', worldId });
    assert.equal(survey.files, 1);
    assert.equal((await post(kernel, { type: 'world.survey', worldId: root })).status, 404);
    assert.equal((await post(kernel, { type: 'world.survey', worldId: '__proto__' })).status, 404);
    assert.equal((await post(kernel, { type: 'world.survey', worldId }, {})).status, 401);
    const refused = await kernel.router.dispatch({ type: 'world.survey', worldId }, 'mcp');
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.error.code, 'forbidden');
  } finally { await kernel.close(); }
});
