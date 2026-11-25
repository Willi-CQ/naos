import { genomeFromFacts, identityForRepo, planetForRepo, type PlanetGenome, type RepoIdentity, type SessionClient, type World } from '@naos/protocol';
import type { CraftVM, WorldVM } from '../store/model.ts';

export interface AtlasWorld {
  id: string; slot: number; name: string; identity: RepoIdentity; genome: PlanetGenome; description: string;
  sessions: number; tenders: number; working: number; idle: number; attention: number;
  clients: Partial<Record<SessionClient, number>>; landed: number; moons: number;
}

const WORK = new Set(['thinking', 'writing', 'generating', 'tool', 'compacting', 'spawning', 'starting']);
const NEED = new Set(['approve', 'answer', 'plan', 'source', 'parked', 'errored', 'crashed', 'rate-limited', 'no-budget']);
export const PLANET_CLASS: Record<PlanetGenome['archetype'], string> = {
  terran: 'Continental world', ocean: 'Ocean world', desert: 'Desert world', ice: 'Glacial world', volcanic: 'Volcanic world',
  rock: 'Rocky world', gas: 'Gas giant', 'ice-giant': 'Ice giant', shrouded: 'Shrouded world',
};

/** Only display-safe names and descriptions leave this projection. Counts follow the current client filter. */
export function atlasWorlds(worlds: readonly WorldVM[], crafts: Readonly<Record<string, CraftVM>>, facts: Readonly<Record<string, World>>): AtlasWorld[] {
  const previous: PlanetGenome[] = [];
  return worlds.map((w) => {
    const fact = facts[w.worldId];
    const identity = fact?.identity ?? identityForRepo(fact?.name ?? w.worldId);
    const genome = planetForRepo(fact?.genome ?? genomeFromFacts({ name: w.worldId, sizeBytes: fact?.massBytes ?? 0 }, previous), identity, !!fact?.genome);
    genome.rationale = w.rationale;
    previous.push(genome);
    const rows = Object.values(crafts).filter((c) => c.worldId === w.worldId && c.live && c.visible !== false);
    const clients: AtlasWorld['clients'] = {};
    for (const c of rows) if (c.kind === 'main') clients[c.client] = (clients[c.client] ?? 0) + 1;
    const features = [genome.oceans.coverage > .3 ? 'deep oceans' : '', genome.rings ? 'orbital rings' : '', genome.terrain.fractures > .5 ? 'mineral fractures' : '', genome.clouds.coverage > .3 ? 'cloud systems' : ''].filter(Boolean);
    return {
      id: w.worldId, slot: w.slot, name: w.name, identity, genome,
      description: w.rationale || `${PLANET_CLASS[genome.archetype]}${features.length ? ` with ${features.join(' and ')}` : ''}. ${/^[aeiou]/i.test(identity.label) ? 'An' : 'A'} ${identity.label.toLowerCase()} in your project system.`,
      sessions: rows.filter((c) => c.kind === 'main').length, tenders: rows.filter((c) => c.kind !== 'main').length,
      working: rows.filter((c) => WORK.has(c.state)).length, idle: rows.filter((c) => c.state === 'idle' || c.state === 'idle-shell').length,
      attention: rows.filter((c) => NEED.has(c.state)).length, clients, landed: fact?.lightsTotal ?? w.landed, moons: fact?.worktrees.length ?? w.moonNames.length,
    };
  });
}

export function atlasPoint(index: number, count: number): { x: number; y: number } {
  const ring = Math.floor(index / 8), seats = Math.min(8, count - ring * 8);
  const angle = (index % 8) / Math.max(1, seats) * Math.PI * 2 - Math.PI / 2 + ring * .32;
  const r = 124 + ring * 72;
  return { x: 310 + Math.cos(angle) * r * 1.23, y: 220 + Math.sin(angle) * r };
}
