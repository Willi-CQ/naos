// Thirty days of synthetic history for the Sky. A seeded generator, so the same rows come back in every process.
import { makeNodeId } from '@naos/protocol';
import type { EpochMs, HistoryDigest, Salvo } from '@naos/protocol';
import { MODEL, WORLDS, agentIdOf, rootOf, uuidOf, worldIdOf } from './scene.ts';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** mulberry32: small, and it matches on every platform. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface History {
  rows: HistoryDigest[];
  salvos: Salvo[];
  /** Totals per world name, for mass and city lights. */
  mass: Record<string, { usd: number; bytes: number; lit: number; failed: number }>;
}

/** Transcripts per world, the same heavy tail as the bytes. */
const WEIGHTS = [50, 20, 90, 4, 10, 1, 1];

/** The survey of DESIGN 7.1: two projects hold nearly all of 2.09 GB, and world radius is the log of that. Spend follows the same shape. */
const MASS: Record<string, { mb: number; usd: number }> = {
  kestrel: { mb: 874, usd: 240 }, tundra: { mb: 88, usd: 37 }, harbor: { mb: 1154, usd: 300 }, mosaic: { mb: 18.5, usd: 10 },
  lumen: { mb: 3.2, usd: 2.2 }, quill: { mb: 1.4, usd: 1 }, ferro: { mb: 0.2, usd: 0.16 },
};

/** Work comes in bursts about a week apart, and a burst is a few sittings. That draws the bright strips along the meridians. */
const BURSTS = [
  { age: 1, spread: 0.7, weight: 0.13 }, { age: 5.2, spread: 0.9, weight: 0.14 }, { age: 12, spread: 0.8, weight: 0.13 },
  { age: 19.6, spread: 0.9, weight: 0.16 }, { age: 26.6, spread: 1.4, weight: 0.36 },
] as const;

/** 2,177 transcripts on the machine this copies, 86 % of them agents. */
const SESSIONS = 460;
/** The model behind an agent row. Haiku and Sonnet do most of the agent work, and class O is the rare expensive run. */
const AGENT_MODELS = [MODEL.haiku, MODEL.sonnet, MODEL.sonnet, MODEL.opus, MODEL.opus, 'claude-fable-5-5'] as const;

export function buildHistory(base: EpochMs): History {
  const random = seeded(0x4e414f53);
  const rows: HistoryDigest[] = [];
  const salvos: Salvo[] = [];
  const total = WEIGHTS.reduce((sum, weight) => sum + weight, 0);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const pickWorld = (): string => {
    let roll = random() * total;
    for (const [index, weight] of WEIGHTS.entries()) {
      roll -= weight;
      if (roll < 0) return WORLDS[index]!.name;
    }
    return WORLDS[0]!.name;
  };
  const gauss = (): number => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());

  const sittings = BURSTS.map((burst) => Array.from({ length: 3 + Math.floor(burst.spread * 3) }, () => burst.age + gauss() * burst.spread));
  /** Days back. A fifth of the month is stray work, the rest falls into a sitting. */
  const whenBack = (): number => {
    if (random() < 0.2) return 0.1 + random() * 29.5;
    let roll = random();
    for (const [index, burst] of BURSTS.entries()) {
      roll -= burst.weight;
      if (roll <= 0) {
        const list = sittings[index]!;
        return Math.min(29.7, Math.max(0.1, list[Math.floor(random() ** 1.4 * list.length)]! + gauss() * 0.12));
      }
    }
    return 0.1 + random() * 29.5;
  };

  const row = (seed: string, world: string, startedAt: EpochMs, over: Partial<HistoryDigest> = {}): HistoryDigest => {
    const sessionId = uuidOf(`history:${seed}`);
    const roll = random();
    const out: HistoryDigest = {
      nodeId: makeNodeId(sessionId),
      sessionId,
      worldId: worldIdOf(world),
      projectRoot: rootOf(world),
      kind: 'main',
      parentNodeId: null,
      startedAt,
      endedAt: startedAt + Math.round(120_000 + random() * 5_400_000),
      model: pick(Object.values(MODEL)),
      // A heavy tail, as on this machine: a few huge transcripts make the dust clouds.
      bytes: Math.round(40_000 * Math.exp(1.9 * gauss())),
      usd: Math.round((0.02 + random() * random() * 2.8) * 100) / 100,
      blockedMs: random() < 0.3 ? Math.round(random() * 600_000) : 0,
      outcome: roll < 0.86 ? 'clean' : roll < 0.93 ? 'abandoned' : roll < 0.97 ? 'failed' : 'unknown',
      ...over,
    };
    rows.push(out);
    return out;
  };

  /** Keeps a past row out of the last hour, which belongs to the rail's LANDED rows below. */
  const past = (back: number): EpochMs => Math.round(base - Math.max(back * DAY_MS, 3 * HOUR_MS));

  for (let index = 0; index < SESSIONS; index += 1) {
    const world = pickWorld();
    const startedAt = past(whenBack());
    const parent = row(`session:${index}`, world, startedAt);
    // Most sessions run alone. A few fan out wide, and those are the cities.
    const agents = random() < 0.45 ? 0 : Math.floor(1 + 3 * Math.exp(1.15 * gauss()));
    for (let agent = 0; agent < Math.min(40, agents); agent += 1) {
      const agentId = agentIdOf(`history:${index}:agent:${agent}`);
      row(`session:${index}:agent:${agent}`, world, startedAt + Math.round(random() * 1_800_000), {
        nodeId: makeNodeId(parent.sessionId, agentId), sessionId: parent.sessionId, kind: 'subagent', parentNodeId: parent.nodeId, model: pick(AGENT_MODELS),
        endedAt: startedAt + Math.round(1_800_000 + random() * 1_800_000), blockedMs: 0, usd: Math.round(random() * 40) / 100, bytes: Math.round(12_000 * Math.exp(1.5 * gauss())),
      });
    }
  }

  for (let day = 29; day >= 0; day -= 1) {
    // About 74 of 113 fan-outs in the census were 3 to 5 agents, so that is the size here.
    if (random() < 0.6) {
      const world = pickWorld();
      const openedAt = past(day + 0.2 + random() * 0.7);
      const parent = row(`${day}:salvo`, world, openedAt - 60_000, { outcome: 'clean' });
      const size = 3 + Math.floor(random() * 3);
      const nodeIds: string[] = [];
      for (let index = 0; index < size; index += 1) {
        const agentId = agentIdOf(`history:${day}:salvo:${index}`);
        const nodeId = makeNodeId(parent.sessionId, agentId);
        nodeIds.push(nodeId);
        row(`${day}:salvo:${index}`, world, openedAt + index * 250, {
          nodeId, sessionId: parent.sessionId, kind: 'subagent', parentNodeId: parent.nodeId, endedAt: openedAt + 60_000 + index * 60_000,
        });
      }
      salvos.push({
        salvoId: `salvo_h${day}`, parentNodeId: parent.nodeId, sessionId: parent.sessionId, worldId: worldIdOf(world), source: 'subagent',
        openedAt, closedAt: openedAt + 11_000, nodeIds,
      });
    }
  }

  // The rail's LANDED, LAST HOUR in the reference: harbor 11 lit and 1 failed, kestrel 1 lit.
  for (let index = 0; index < 12; index += 1) {
    const startedAt = base - 54 * 60_000 + index * 4 * 60_000;
    row(`landed:harbor:${index}`, 'harbor', startedAt, { endedAt: startedAt + 150_000, outcome: index === 7 ? 'failed' : 'clean' });
  }
  row('landed:kestrel', 'kestrel', base - 21 * 60_000, { endedAt: base - 18 * 60_000, outcome: 'clean' });

  rows.sort((a, b) => a.startedAt - b.startedAt);

  const nameOf = new Map(WORLDS.map((world) => [worldIdOf(world.name), world.name]));
  // The month is drawn first, then each world is scaled to its mass, so the rows keep their shape and the totals land exactly.
  const raw = new Map<string, { usd: number; bytes: number }>();
  for (const entry of rows) {
    const sum = raw.get(entry.worldId) ?? { usd: 0, bytes: 0 };
    sum.usd += entry.usd ?? 0;
    sum.bytes += entry.bytes;
    raw.set(entry.worldId, sum);
  }
  for (const entry of rows) {
    const sum = raw.get(entry.worldId)!;
    const target = MASS[nameOf.get(entry.worldId)!]!;
    entry.bytes = Math.max(1, Math.round((entry.bytes * target.mb * 1_048_576) / sum.bytes));
    entry.usd = Math.round((((entry.usd ?? 0) * target.usd) / sum.usd) * 10_000) / 10_000;
  }

  const mass: History['mass'] = Object.fromEntries(WORLDS.map((world) => [world.name, { usd: 0, bytes: 0, lit: 0, failed: 0 }]));
  for (const entry of rows) {
    const totals = mass[nameOf.get(entry.worldId)!]!;
    totals.usd += entry.usd ?? 0;
    totals.bytes += entry.bytes;
    if (entry.outcome === 'failed' || entry.outcome === 'abandoned') totals.failed += 1;
    else totals.lit += 1;
  }
  return { rows, salvos, mass };
}
