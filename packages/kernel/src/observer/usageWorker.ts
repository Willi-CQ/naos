// Low priority full parse. Node has no per-thread priority on Windows, and os.setPriority would lower the whole kernel, so
// this thread paces itself: it sleeps as long as it worked, which keeps it at half a core at most.
import { parentPort } from 'node:worker_threads';
import type { Pace, WorkerResult, WorkerTask } from './usageScan.ts';
import { scanJournal, scanTranscript } from './usageScan.ts';

const SLICE_MS = 25;
const MAX_SLEEP_MS = 100;

let sliceStart = performance.now();

const pace: Pace = async () => {
  const worked = performance.now() - sliceStart;
  if (worked < SLICE_MS) return;
  await new Promise((resolve) => setTimeout(resolve, Math.min(MAX_SLEEP_MS, worked)));
  sliceStart = performance.now();
};

const queue: WorkerTask[] = [];
let running = false;

async function run(): Promise<void> {
  if (running) return;
  running = true;
  for (let task = queue.shift(); task; task = queue.shift()) {
    let result: WorkerResult;
    if (task.kind === 'transcript') {
      const summary = await scanTranscript(task.path, task.size, task.mtimeMs, task.to, pace).catch(() => null);
      result = { kind: 'transcript', nodeId: task.nodeId, summary, path: task.path, size: task.size, mtimeMs: task.mtimeMs };
    } else {
      result = { kind: 'journal', summary: await scanJournal(task.path, task.size, task.mtimeMs).catch(() => null), path: task.path };
    }
    parentPort?.postMessage(result);
    await pace();
  }
  running = false;
}

parentPort?.on('message', (tasks: WorkerTask[]) => {
  queue.push(...tasks);
  sliceStart = performance.now();
  void run();
});
