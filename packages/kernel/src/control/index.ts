// The Control plane: agents NAOS spawned through the Agent SDK. Everything reaches it through the router, so scope is
// decided before a handler runs. approval.answer is checked here a second time, because that one must never be wrong.
import type { Requester } from './types.ts';
import { CommandError, type CommandHandler, type KernelContext, type ManagedRegistry, type Plane } from '../context.ts';
import type { AuthScope, CommandType } from '@naos/protocol';
import path from 'node:path';
import type { QueryFn } from './driver.ts';
import { snapshot as realSnapshot, treeKill as realTreeKill, type Snapshot, type TreeKill } from './procs.ts';
import { preflight, type ResolveSettings } from './preflight.ts';
import { WorldDesigners } from './designers.ts';
import { Profiles } from './profiles.ts';
import { Registry } from './registry.ts';
import { Store } from './store.ts';
import { Supervisor } from './supervisor.ts';
import { NativeAgents } from './native/agents.ts';
import type { RpcFactory } from './native/bridge.ts';
import type { NativeExecutable } from './native/rpc.ts';
import type { NativeClient } from '@naos/protocol';

export interface ControlOverrides {
  native?: { locate?: (client: NativeClient) => NativeExecutable | null; rpc?: RpcFactory };
  query?: QueryFn;
  snapshot?: Snapshot;
  treeKill?: TreeKill;
  resolveSettings?: ResolveSettings;
  /** agents/ by default. Tests bring their own. */
  profilesDir?: string;
  /** The live kernel turns this on. Tests leave it off, so a fixture world does not start a designer. */
  autoDesign?: boolean;
}

export type Control = Plane & {
  registry: ManagedRegistry;
  readonly supervisor: Supervisor;
  readonly profiles: Profiles;
  readonly store: Store;
  readonly designers: WorldDesigners;
};

const requester = (scope: AuthScope): Requester => (scope === 'mcp' ? { kind: 'mcp' } : { kind: 'ui' });

export function createControl(overrides: ControlOverrides = {}): Control {
  const registry = new Registry();
  let supervisor: Supervisor | null = null;
  let profiles: Profiles | null = null;
  let store: Store | null = null;
  let designers: WorldDesigners | null = null;
  let native: NativeAgents | null = null;

  const started = <T>(value: T | null): T => {
    if (value === null) throw new Error('control plane has not started');
    return value;
  };

  const start = async (ctx: KernelContext): Promise<void> => {
    if (ctx.managed !== registry) ctx.log.warn('control: ctx.managed is not this plane\'s registry, so the Observer will not see managed sessions', {});
    const ownedStore = new Store(ctx.db);
    const clients = new NativeAgents(ctx, overrides.native);
    native = clients; ctx.nativeText = clients;
    const onlyUi = (scope: AuthScope): void => { if (scope !== 'ui') throw new CommandError('forbidden', 'Native agent control belongs to the local user.'); };
    const ownedProfiles = new Profiles(overrides.profilesDir ?? path.join(ctx.config.repoRoot, 'agents'), ctx.bus, ctx.log);
    const sup = new Supervisor({
      ctx, store: ownedStore, registry, profiles: ownedProfiles,
      snapshot: overrides.snapshot ?? realSnapshot,
      treeKill: overrides.treeKill ?? realTreeKill,
      ...(overrides.query ? { query: overrides.query } : {}),
    });
    const ownedDesigners = new WorldDesigners({ supervisor: sup, worlds: ctx.worlds, bus: ctx.bus, log: ctx.log });
    store = ownedStore;
    profiles = ownedProfiles;
    supervisor = sup;
    designers = ownedDesigners;

    ownedProfiles.start();

    const on = <K extends CommandType>(type: K, handler: CommandHandler<K>): void => ctx.router.register(type, handler);
    on('agent.providers', ({ inspect }) => clients.providers(inspect));
    on('agent.spawn', ({ spec }, caller) => spec.client && spec.client !== 'claude-code' ? clients.spawn(spec, caller.scope) : sup.spawn(spec, requester(caller.scope)));
    on('agent.send', ({ agentId, text, priority }, caller) => clients.owns(agentId) ? clients.send(agentId, text, priority, caller.scope) : sup.send(agentId, text, priority, requester(caller.scope)));
    on('agent.stop', async ({ agentId }, caller) => ({ result: clients.owns(agentId) ? await clients.stop(agentId, caller.scope) : await sup.stop(agentId, requester(caller.scope)) }));
    on('agent.stopAll', async () => { const [other, legacy] = await Promise.all([clients.stopAll(), sup.stopAll()]); return { stopped: other.stopped + legacy.stopped, outOfReach: legacy.outOfReach + other.outOfReach }; });
    on('agent.addBudget', ({ agentId, addUsd }) => { if (clients.owns(agentId)) throw new CommandError('bad-request', 'Provider usage limits are managed by Codex or Cursor.'); return sup.addBudget(agentId, addUsd); });
    on('agent.fork', ({ agentId }) => { if (clients.owns(agentId)) throw new CommandError('unavailable', 'Start a new native conversation to begin another task.'); return sup.fork(agentId); });
    on('agent.resume', ({ agentId, prompt, addUsd }, caller) => { if (clients.owns(agentId)) { onlyUi(caller.scope); return clients.resume(agentId, prompt); } return sup.resume(agentId, prompt, addUsd); });
    on('agent.close', ({ agentId }, caller) => { if (clients.owns(agentId)) { onlyUi(caller.scope); return clients.close(agentId); } return sup.close(agentId); });
    on('agent.status', ({ agentId }, caller) => clients.owns(agentId) ? clients.status(agentId, caller.scope) : sup.status(agentId, requester(caller.scope)));
    on('agent.wait', ({ agentId, timeoutS }, caller) => clients.owns(agentId) ? clients.wait(agentId, timeoutS, caller.scope) : sup.wait(agentId, timeoutS, requester(caller.scope)));
    on('agent.list', ({ scope, of }, caller) => [...sup.list(scope, of, requester(caller.scope)), ...(scope === 'all' && caller.scope === 'ui' ? clients.views() : [])]);
    on('approval.answer', ({ requestId, decision, clientId }, caller) => {
      if (caller.scope !== 'ui') throw new CommandError('forbidden', 'Approval stays with the human.');
      return clients.ownsApproval(requestId) ? clients.answer(requestId, decision, clientId) : sup.answer(requestId, decision, clientId);
    });
    on('world.trust', ({ worldId, trusted }, caller) => {
      if (caller.scope !== 'ui') throw new CommandError('forbidden', 'Trust stays with the human.');
      if (!ctx.worlds.get(worldId)) throw new CommandError('not-found', 'That world is not known.');
      ctx.worlds.setTrusted(worldId, trusted);
      return { trusted };
    });
    on('world.design', ({ worldId }, caller) => {
      if (caller.scope !== 'ui') throw new CommandError('forbidden', 'A world designer is started by the operator.');
      return ownedDesigners.request(worldId);
    });
    on('admission.get', () => sup.admission());
    on('preflight', ({ spec }, caller) => spec.client && spec.client !== 'claude-code' ? (onlyUi(caller.scope), clients.preflight(spec)) : preflight(spec, {
      ctx, store: ownedStore,
      profile: (name) => ownedProfiles.get(name),
      admission: () => sup.admission(),
      admissionBlock: (copies) => sup.admissionBlock(copies),
      ...(overrides.resolveSettings ? { resolveSettings: overrides.resolveSettings } : {}),
    }));

    await sup.boot();
    clients.boot();
    if (overrides.autoDesign === true) ownedDesigners.watch();
  };

  return {
    name: 'control',
    registry,
    get supervisor() { return started(supervisor); },
    get profiles() { return started(profiles); },
    get store() { return started(store); },
    get designers() { return started(designers); },
    start,
    async stop() {
      designers?.stop();
      await native?.shutdown();
      await supervisor?.shutdown();
      profiles?.stop();
    },
  };
}
