// The family as a table: which parts make a ship, where each one bolts on, and how long the result is. Built lazily, a part at a time, because
// a fleet rarely holds more than a few of them and the first frame should not pay for the rest.
import { buildField, type Field } from './field.ts';
import { Forge, type Mesh, type Nozzle, type Spot, type V3 } from './forge.ts';
import { capital, cruiser, drone, longrange, plain, scout } from './hulls.ts';
import { HULLS, ROLES, kindIndex, type HullClass, type Role } from './kind.ts';
import { arms, boom, ring, survey } from './modules.ts';

export const PART_IDS = ['capital', 'cruiser', 'scout', 'longrange', 'plain', 'drone', 'boom', 'survey', 'arms', 'ring'] as const;
export type PartId = (typeof PART_IDS)[number];

/**
 * The status section: a stretch of hull between two lit rings, where section 6 reads on a ship too large to wear a mark. `at` is the station, `half`
 * the half width, `within` how far from the axis it reaches (0 for everything at that station), `spill` how far its light runs down the plating.
 * Metres, on the part. A hull carries one amidships for the flank, and one each toward the bow and the stern, where a camera on the axis can see it.
 */
export interface Belt { at: number; half: number; within: number; spill: number }

const RECIPES: Record<PartId, { build: (f: Forge) => void; seed: number; field: number; belts?: readonly Belt[] }> = {
  capital: {
    build: capital, seed: 11, field: 128,
    belts: [{ at: 43.6, half: 1.5, within: 0, spill: 2.6 }, { at: 59.2, half: 0.16, within: 0, spill: 0.8 }, { at: -46.6, half: 0.2, within: 0, spill: 0.9 }],
  },
  cruiser: {
    build: cruiser, seed: 23, field: 112,
    belts: [{ at: -10.5, half: 1, within: 12.4, spill: 1.9 }, { at: 25.2, half: 0.12, within: 12.4, spill: 0.6 }, { at: -25.6, half: 0.14, within: 12.4, spill: 0.6 }],
  },
  scout: {
    build: scout, seed: 37, field: 96,
    belts: [{ at: -1.1, half: 0.3, within: 0, spill: 0.5 }, { at: 7, half: 0.05, within: 0, spill: 0.2 }, { at: -7.1, half: 0.05, within: 3.3, spill: 0.2 }],
  },
  longrange: {
    build: longrange, seed: 41, field: 144,
    belts: [{ at: 55.2, half: 1.2, within: 8.4, spill: 2.2 }, { at: 71.6, half: 0.2, within: 0, spill: 0.9 }, { at: -63.6, half: 0.2, within: 0, spill: 0.9 }],
  },
  plain: {
    build: plain, seed: 53, field: 72,
    belts: [{ at: -3, half: 0.5, within: 0, spill: 0.9 }, { at: 7.6, half: 0.08, within: 0, spill: 0.3 }, { at: -9.6, half: 0.07, within: 0, spill: 0.3 }],
  },
  drone: {
    build: drone, seed: 59, field: 56,
    belts: [{ at: -0.1, half: 0.24, within: 2.4, spill: 0.3 }],
  },
  boom: { build: boom, seed: 67, field: 96 },
  survey: { build: survey, seed: 71, field: 80 },
  arms: { build: arms, seed: 79, field: 96 },
  ring: { build: ring, seed: 83, field: 96 },
};

export interface Part {
  id: PartId;
  near: Mesh;
  far: Mesh;
  speck: Mesh;
  field: Field;
  spots: readonly Spot[];
  nozzles: readonly Nozzle[];
  belts: readonly Belt[];
}

/** The smallest level keeps what is longer than this share of the part: under two pixels on a ship of the size it is drawn at. */
const SPECK_LEAST = 0.04;

const cache = new Map<PartId, Part>();

export function part(id: PartId): Part {
  const seen = cache.get(id);
  if (seen) return seen;
  const recipe = RECIPES[id];
  const near = new Forge(recipe.seed, true);
  recipe.build(near);
  const mesh = near.build();
  const reach = Math.max(mesh.max[0] - mesh.min[0], mesh.max[1] - mesh.min[1], mesh.max[2] - mesh.min[2]);
  const far = new Forge(recipe.seed, false, 0, reach);
  recipe.build(far);
  const speck = new Forge(recipe.seed, false, reach * SPECK_LEAST, reach);
  recipe.build(speck);
  const made: Part = { id, near: mesh, far: far.build(), speck: speck.build(), field: buildField(mesh, recipe.field), spots: near.spots, nozzles: near.nozzles, belts: recipe.belts ?? [] };
  cache.set(id, made);
  return made;
}

export const hasPart = (id: PartId): boolean => cache.has(id);

/** Takes a part built elsewhere. The worker sends a plain copy, and it is as good as one built here. */
export function keepParts(p: Part): void { cache.set(p.id, p); }

/** Where a part sits in the ship's frame. `spin` marks the one that turns around +x. */
export interface Mount { part: PartId; at: V3; scale: number; spin?: boolean }

export interface Assembly {
  mounts: readonly Mount[];
  /** Design length in metres, nose of the hull to the end of the bell. A module may reach past it. */
  length: number;
  /** Radius of a sphere around the origin that holds everything, module included. */
  radius: number;
  centre: V3;
  /** How wide the ship stands across its axis, as a share of `length`. It is what a head-on camera sees of it. */
  breadth: number;
}

const HULL_PART: Record<HullClass, PartId> = { capital: 'capital', cruiser: 'cruiser', scout: 'scout', longrange: 'longrange', default: 'plain' };

/** Where each module bolts on, per hull. Worked out by eye against the renders, and held by a test that nothing floats. */
const MOUNT: Record<HullClass, Record<'probe' | 'survey' | 'tug' | 'command', { at: V3; scale: number }>> = {
  capital: { probe: { at: [60, -0.5, 0], scale: 0.84 }, survey: { at: [41, 6.7, 0], scale: 0.8 }, tug: { at: [58, -2, 0], scale: 0.62 }, command: { at: [17, 0, 0], scale: 0.9 } },
  cruiser: { probe: { at: [31, -0.9, 0], scale: 0.58 }, survey: { at: [-4, 6.8, 0], scale: 0.6 }, tug: { at: [29, -0.8, 0], scale: 0.42 }, command: { at: [-3, 0.3, 0], scale: 0.84 } },
  scout: { probe: { at: [9.3, -0.25, 0], scale: 0.2 }, survey: { at: [-2, 1.42, 0], scale: 0.17 }, tug: { at: [8.6, -0.2, 0], scale: 0.13 }, command: { at: [-1, 0.1, 0], scale: 0.32 } },
  longrange: { probe: { at: [78, 0, 0], scale: 0.7 }, survey: { at: [56, 7.1, 0], scale: 0.66 }, tug: { at: [76, 0, 0], scale: 0.6 }, command: { at: [38, 0, 0], scale: 0.86 } },
  default: { probe: { at: [14, 0, 0], scale: 0.24 }, survey: { at: [-3, 4, 0], scale: 0.22 }, tug: { at: [12, 0, 0], scale: 0.17 }, command: { at: [-4, 0, 0], scale: 0.42 } },
};

const assemblies: Array<Assembly | undefined> = new Array(HULLS.length * ROLES.length);

const moduleOf = (role: Role): PartId | null => (role === 'probe' ? 'boom' : role === 'survey' ? 'survey' : role === 'tug' ? 'arms' : role === 'command' ? 'ring' : null);

/** True once everything this ship is made of has arrived. */
export function assemblyReady(hull: HullClass, role: Role): boolean {
  if (role === 'drone') return cache.has('drone');
  const m = moduleOf(role);
  return cache.has(HULL_PART[hull]) && (m === null || cache.has(m));
}

function bounded(mounts: readonly Mount[]): Assembly {
  let lo: [number, number, number] = [Infinity, Infinity, Infinity];
  let hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const m of mounts) {
    const { min, max } = part(m.part).near;
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i]!, m.at[i]! + min[i]! * m.scale);
      hi[i] = Math.max(hi[i]!, m.at[i]! + max[i]! * m.scale);
    }
  }
  const body = part(mounts[0]!.part).near;
  const centre: V3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const radius = 0.5 * Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  const length = body.max[0] - body.min[0];
  return { mounts, length, radius, centre, breadth: Math.max(hi[1] - lo[1], hi[2] - lo[2]) / length };
}

export function assembly(hull: HullClass, role: Role): Assembly {
  const key = kindIndex(hull, role);
  const seen = assemblies[key];
  if (seen) return seen;
  let mounts: Mount[];
  if (role === 'drone') mounts = [{ part: 'drone', at: [0, 0, 0], scale: 1 }];
  else {
    mounts = [{ part: HULL_PART[hull], at: [0, 0, 0], scale: 1 }];
    if (role !== 'plain') {
      const m = MOUNT[hull][role];
      mounts.push({ part: moduleOf(role)!, at: m.at, scale: m.scale, spin: role === 'command' });
    }
  }
  const made = bounded(mounts);
  assemblies[key] = made;
  return made;
}

/**
 * Where a plume leaves the ship: distance aft of the origin along -x, and the width of the exhaust, both as shares of the hull's length. A
 * plume drawn from here starts at the bells, whatever the class. Every hull has engines, so this always has an answer.
 */
export function plumeAnchor(hull: HullClass, role: Role): { aft: number; width: number } {
  const a = assembly(hull, role);
  const body = part(a.mounts[0]!.part);
  let aft = 0;
  let r = 0;
  for (const n of body.nozzles) {
    aft = Math.max(aft, -n.p[0]);
    r = Math.max(r, Math.abs(n.p[1]) + n.r, Math.abs(n.p[2]) + n.r);
  }
  return { aft: aft / a.length, width: (2 * r) / a.length };
}
