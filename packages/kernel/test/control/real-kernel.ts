// A kernel in its own process, so real.test.ts can kill it hard. Takes the home folder as its only argument.
import os from 'node:os';
import path from 'node:path';
import { createControl } from '../../src/control/index.ts';
import { startKernel } from '../../src/main.ts';

const home = process.argv[2]!;
const control = createControl({ profilesDir: path.join(home, 'agents') });
const kernel = await startKernel({
  config: { mode: 'live', port: 0, home, claudeHome: path.join(os.homedir(), '.claude'), uiDist: '', repoRoot: home, devOrigins: [] },
  planes: [control],
  logToStderr: false,
});
await kernel.planesReady;
process.stdout.write(`port=${kernel.config.port}\n`);
