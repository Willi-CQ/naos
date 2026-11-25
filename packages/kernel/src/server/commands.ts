// The commands the kernel answers itself. Everything else belongs to a plane.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { liveCraft } from '../app/lifetime.ts';
import { CommandError } from '../context.ts';
import type { Bus, KernelConfig, Router } from '../context.ts';
import type { Notifier } from '../notify/notifier.ts';
import type { KernelWorlds } from '../worlds.ts';
import { surveyProject } from '../survey.ts';
import { projectKnowledge } from '../knowledge.ts';
import { listProjectSkills, readProjectSkill } from '../skills.ts';
import { projectChanges, projectDiff } from '../projectChanges.ts';

const BENCH_NAME = /^[\w .-]{1,80}$/;
/** Long enough for the reply to leave before the server closes. */
const QUIT_DELAY_MS = 50;

function readBench(file: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function registerCoreCommands(router: Router, deps: { bus: Bus; config: KernelConfig; notifier: Notifier; worlds?: KernelWorlds; quit?: () => void }): void {
  const { bus, config, notifier, worlds, quit } = deps;

  if (config.mode === 'live') router.register('world.survey', async ({ worldId }) => {
    if (typeof worldId !== 'string' || !Object.hasOwn(bus.state().worlds, worldId)) throw new CommandError('not-found', 'That world is not known.');
    const world = bus.state().worlds[worldId]!;
    if (!world.projectRoot || world.kind === 'belt') throw new CommandError('bad-request', 'This world has no project folder.');
    return surveyProject(world.projectRoot);
  });
  if (config.mode === 'live') router.register('world.knowledge', async ({ worldId }) => {
    if (typeof worldId !== 'string' || !Object.hasOwn(bus.state().worlds, worldId)) throw new CommandError('not-found', 'That world is not known.');
    const world = bus.state().worlds[worldId]!;
    if (!world.projectRoot || world.kind === 'belt') throw new CommandError('bad-request', 'This world has no project folder.');
    return projectKnowledge(world.projectRoot);
  });
  if (config.mode === 'live') router.register('world.skills', async ({ worldId }) => {
    if (typeof worldId !== 'string' || !Object.hasOwn(bus.state().worlds, worldId)) throw new CommandError('not-found', 'That world is not known.');
    const world = bus.state().worlds[worldId]!;
    if (!world.projectRoot || world.kind === 'belt') throw new CommandError('bad-request', 'This world has no project folder.');
    return { skills: await listProjectSkills(world.projectRoot, world.trusted) };
  });
  if (config.mode === 'live') router.register('world.skill.read', async ({ worldId, skillId }) => {
    if (typeof worldId !== 'string' || !Object.hasOwn(bus.state().worlds, worldId)) throw new CommandError('not-found', 'That world is not known.');
    if (typeof skillId !== 'string' || skillId.length > 512) throw new CommandError('bad-request', 'That workflow reference is invalid.');
    const world = bus.state().worlds[worldId]!;
    if (!world.projectRoot || world.kind === 'belt') throw new CommandError('bad-request', 'This world has no project folder.');
    try { return await readProjectSkill(world.projectRoot, world.trusted, skillId); }
    catch (error) { throw new CommandError('not-found', error instanceof Error ? error.message : 'That workflow is unavailable.'); }
  });
  if (config.mode === 'live') router.register('world.changes', async ({ worldId }) => {
    if (typeof worldId !== 'string' || !Object.hasOwn(bus.state().worlds, worldId)) throw new CommandError('not-found', 'That world is not known.');
    const world = bus.state().worlds[worldId]!;
    if (!world.projectRoot || world.kind === 'belt') throw new CommandError('bad-request', 'This world has no project folder.');
    return projectChanges(world.projectRoot);
  });
  if (config.mode === 'live') router.register('world.diff', async ({ worldId, path: filePath }) => {
    if (typeof worldId !== 'string' || !Object.hasOwn(bus.state().worlds, worldId)) throw new CommandError('not-found', 'That world is not known.');
    const world = bus.state().worlds[worldId]!;
    if (!world.projectRoot || world.kind === 'belt') throw new CommandError('bad-request', 'This world has no project folder.');
    return projectDiff(world.projectRoot, filePath);
  });

  if (worlds) {
    router.register('world.rename', ({ worldId, name }) => {
      const shown = worlds.rename(worldId, name ?? null);
      if (shown === undefined) throw new CommandError('not-found', 'That world is not known.');
      return { name: shown };
    });
  }

  router.register('fault.ack', ({ nodeId }) => {
    const state = bus.state();
    const known = Object.hasOwn(state.nodes, nodeId) || Object.values(state.managed).some((agent) => agent.nodeId === nodeId);
    if (!known) throw new CommandError('not-found', 'that craft is not known');
    bus.publish({ type: 'fault.acked', nodeId });
    return {};
  });

  router.register('ui.presence', ({ clientId, visible, focused, notifications, veiled }) => {
    if (typeof clientId !== 'string' || clientId.length === 0) throw new CommandError('bad-request', 'clientId is required');
    notifier.report(clientId, { visible: visible === true, focused: focused === true, notifications: notifications !== false, veiled: veiled === true });
    return {};
  });

  router.register('kernel.quit', () => {
    const craft = liveCraft(bus.state());
    if (craft > 0) throw new CommandError('conflict', `${craft} owned craft ${craft === 1 ? 'is' : 'are'} still alive. Stop them first, for example with naos stop-all.`);
    if (!quit) throw new CommandError('unavailable', 'this kernel cannot quit from here');
    setTimeout(quit, QUIT_DELAY_MS);
    return { stopping: true };
  });

  router.register('bench.record', ({ name, data }) => {
    if (typeof name !== 'string' || !BENCH_NAME.test(name)) throw new CommandError('bad-request', 'name must be a short plain label');
    const date = new Date().toISOString().slice(0, 10);
    const relative = `docs/bench/${date}.json`;
    const file = path.join(config.repoRoot, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    const report = { ...readBench(file), [name]: data };
    writeFileSync(`${file}.tmp`, `${JSON.stringify(report, null, 2)}\n`);
    renameSync(`${file}.tmp`, file);
    return { path: relative };
  });
}
