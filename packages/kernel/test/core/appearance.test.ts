import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { readRepoIdentity } from '../../src/appearance.ts';
import { FakeClaude } from '../observer/harness.ts';

test('only a bounded public-metadata classification leaves the repo reader', () => {
  const fake = new FakeClaude();
  try {
    writeFileSync(path.join(fake.root, 'package.json'), JSON.stringify({ description: 'Construction and architectural planning', keywords: ['BIM'], scripts: { preinstall: 'PRIVATE_DO_NOT_RUN' }, token: 'PRIVATE_TOKEN' }));
    writeFileSync(path.join(fake.root, '.env'), 'PRIVATE_ENV');
    writeFileSync(path.join(fake.root, 'README.md'), '# Project\nConstruction engineering. PRIVATE_PROSE');
    const identity = readRepoIdentity(fake.root, 'Workbench');
    assert.equal(identity.theme, 'forge');
    assert.ok(!JSON.stringify(identity).includes('PRIVATE'));
    writeFileSync(path.join(fake.root, 'package.json'), 'not json');
    assert.equal(readRepoIdentity(fake.root, 'Workbench').theme, 'forge');
    assert.equal(readRepoIdentity(null, 'Benchmark Agent').theme, 'observatory');
  } finally { fake.cleanup(); }
});
