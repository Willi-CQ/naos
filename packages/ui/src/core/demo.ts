import type { Roster, RosterCraft } from '../scene/roster.ts';
import type { SessionClient } from '@naos/protocol';

export interface DemoState { active: boolean; paused: boolean; slow: boolean; run: number; elapsed: number; phase: string }
export const DEMO_END = 33;
export const DEMO_IDS = ['demo:lead', 'demo:claude', 'demo:codex', 'demo:cursor'] as const;
export const DEMO_STARTS = [0, 3, 5, 7];
export const DEMO_ENDS = [30, 22, 24, 26];

export function demoPhase(time: number): string {
  return time < 3 ? 'New chat' : time < 10 ? 'Subagents departing' : time < 14 ? 'Working formation'
    : time < 18 ? 'Docking' : time < 22 ? 'Back to work' : time < 30 ? 'Landing' : time < DEMO_END ? 'Final approach' : 'Complete';
}

/** Local presentation data. It never enters the kernel, session store, quotas, or control commands. */
export function demoRoster(worldId: string, time: number): Roster {
  const craft = (id: string, index: number, state: RosterCraft['state']): RosterCraft => ({
    id, client: (['codex', 'claude-code', 'codex', 'cursor'] as SessionClient[])[index] ?? 'claude-code',
    model: index === 1 ? 'claude-sonnet-5-5' : 'gpt-6.1-sol', agentType: index === 0 ? undefined : 'Explore',
    worldId, role: index === 0 ? 'vessel' : 'tender', parentId: index === 0 ? null : DEMO_IDS[0],
    order: index === 0 ? 0 : 12 + index, depth: index === 0 ? 0 : 1, owned: true, state,
    altitude: 0.45, tps: state === 'writing' ? 28 : 0, tokens: 0, tier: 6, danger: false,
    since: 100000, tools: [], countdown: null, fuel: null, queued: 0, moon: null, acked: false, workflow: null, pad: null,
  });
  const crafts: RosterCraft[] = [];
  for (let i = 0; i < 12; i++) crafts.push(craft(`demo:history:${i}`, i + 1, 'finished'));
  for (let i = 0; i < DEMO_IDS.length; i++) {
    if (time < DEMO_STARTS[i]!) continue;
    const state = time >= DEMO_ENDS[i]! ? 'finished' : i === 0 && time >= 14 && time < 18 ? 'idle' : 'writing';
    crafts.push(craft(DEMO_IDS[i]!, i, state));
  }
  return { crafts, hoops: [] };
}
