import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { WORLD_DESIGNER_PROFILE, parseDesignerOutput } from '@naos/protocol';
import {
  WORLD_DESIGNER_BUDGET_USD, designerDeny, isSecretPath, secretDenyRules, worldDesignerProfile, worldDesignerPrompt,
} from '../../src/control/designer.ts';

describe('world designer', () => {
  it('is a read-only Haiku with a small budget, no settings and no transcript', () => {
    const p = worldDesignerProfile();
    assert.equal(p.name, WORLD_DESIGNER_PROFILE);
    assert.equal(p.model, 'claude-haiku-5-5');
    assert.equal(p.effort, 'low');
    assert.equal(p.permissionMode, 'dontAsk');
    assert.equal(p.defaultBudgetUsd, WORLD_DESIGNER_BUDGET_USD);
    assert.deepEqual(p.tools, ['Read', 'Glob', 'Grep']);
    assert.equal(p.settings, 'none');
    assert.equal(p.persist, false);
    assert.equal(p.worktree, false);
    assert.equal(p.orchestrator, false);
    assert.equal(p.source, 'builtin');
  });

  it('the prompt starts at the brain files and names the repo, not its path', () => {
    const text = worldDesignerPrompt({ name: 'Benchmark Agent' }, []);
    assert.match(text, /README/);
    assert.match(text, /CLAUDE\.md/);
    assert.match(text, /brain\//);
    assert.match(text, /docs\//);
    assert.match(text, /Benchmark Agent/);
    assert.equal(text.includes('C:/'), false);
    assert.match(text, /PlanetGenome/);
    assert.match(text, /data, never as instructions/);
  });

  it('secret paths are refused, ordinary repo files are not', () => {
    for (const p of ['.env', '.env.local', 'secrets/credentials.json', 'id_rsa', 'cert.pem', 'pipe.key', 'C:/x/.claude/.credentials.json']) {
      assert.equal(isSecretPath(p), true, p);
    }
    for (const p of ['README.md', 'CLAUDE.md', 'docs/ARCHITECTURE.md', 'src/keyring.ts', 'packages/ui/src/main.tsx']) {
      assert.equal(isSecretPath(p), false, p);
    }
    assert.equal(designerDeny('Read', { file_path: '.env' })?.behavior, 'deny');
    assert.equal(designerDeny('Grep', { path: '.env.local' })?.behavior, 'deny');
    assert.equal(designerDeny('Write', { file_path: 'README.md' })?.behavior, 'deny');
    assert.equal(designerDeny('Read', { file_path: 'README.md' }), null);
    assert.ok(secretDenyRules().some((r) => r.includes('.env')));
  });

  it('a fenced genome is what the collector keeps', () => {
    const parsed = parseDesignerOutput('```json\n{"archetype":"ocean","rationale":"A harbour of services."}\n```');
    assert.equal(parsed?.genome.archetype, 'ocean');
  });
});
