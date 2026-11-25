// Review the shared fleet through the same headless GPU capture path used for the app's screenshots.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(repo, '.shots/fleet');
mkdirSync(out, { recursive: true });

const filtered = `(async () => {
  document.querySelector('.client-filters button[data-client="codex"]').click();
  await new Promise(r => setTimeout(r, 900));
  const state = window.__naos.getState();
  const drawn = window.__naosScene.craftsOnCanvas();
  const checks = {
    filter: state.view.clientFilter === 'codex',
    visibleFleet: drawn.length > 0 && drawn.every(c => state.model.crafts[c.id]?.client === 'codex'),
    keyboardWalk: state.model.walk.every(id => state.model.crafts[id].client === 'codex'),
    decisionsRemain: state.model.decisions.some(d => d.status === 'open'),
    faultsRemain: state.model.trouble.length === 2
  };
  return { checks, drawn: drawn.length };
})()`;

const chase = `(() => {
  const s = window.__naos.getState(), c = window.__naosScene;
  const hull = c.craftsOnCanvas().find(x => x.id === s.view.selected);
  const f = s.shell.free;
  return { checks: {
    craftLevel: s.view.level === 'craft',
    channelReserved: s.shell.right === s.shell.channel && f.x + f.w + s.shell.right === s.shell.vw,
    hullVisible: !!hull && !hull.behind && hull.x > 50 && hull.x < f.w - 50 && hull.y > 80 && hull.y < f.h - 50,
    shipsIntegrated: c.fleet.externalShips === true
  }};
})()`;

const cases = [
  { name: 'system', viewport: '1600x1000' },
  { name: 'world', viewport: '1600x1000', keys: '1' },
  { name: 'craft', viewport: '1600x1000', keys: 'j Enter', evaluate: chase },
  { name: 'codex-filter', viewport: '1280x800', evaluate: filtered },
  { name: 'wide', viewport: '2560x1440' },
  { name: 'reduced', viewport: '1280x800', reduced: true, evaluate: `({checks:{motionHeld:window.__naosScene.state.still === true}})` },
];
const reports = [];
for (const item of cases) {
  const args = ['scripts/shot.mjs', '--name', item.name, '--out', out, '--viewport', item.viewport,
    '--seek', '60', '--pause', '--mounted', '--settled', '--wait', '3000'];
  if (item.keys) args.push('--keys', item.keys);
  if (item.evaluate) args.push('--eval', item.evaluate);
  if (item.reduced) args.push('--reduced');
  const result = await run(process.execPath, args, { cwd: repo, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.pageErrors, [], `${item.name}: page errors`);
  assert.deepEqual(report.consoleErrors, [], `${item.name}: console errors`);
  assert.deepEqual(report.failedRequests, [], `${item.name}: failed requests`);
  for (const [name, passed] of Object.entries(report.eval?.checks ?? {})) assert.equal(passed, true, `${item.name}: ${name}`);
  reports.push(report);
  console.log(`${item.name}: passed, ${report.scene.tier}, ${item.viewport}`);
}
writeFileSync(path.join(out, 'review.json'), JSON.stringify(reports, null, 2));
