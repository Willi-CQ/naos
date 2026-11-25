// What a world does when it holds more craft than free orbits can show. DESIGN 12.5 merges vessels past 24 into a shoal, and the bench
// shows that the 24 before them are already noise. So a crowded world gathers its craft into altitude lanes, spaces each lane evenly,
// and sends what does not fit into a density band on the lane. Law 2 survives: a lane is still a band of context, low to high.
import type { VisualState } from './state.ts';

/** Up to this many, every craft keeps its exact altitude. */
export const FREE_CRAFT = 8;
/** DESIGN 12.5. */
export const SOLO_CAP = 24;
/** Least distance between two hulls on a lane, CSS px before craftK. A hull is 15 long, so its plume still has room. */
const HULL_PITCH = 25;
const LANE_MIN = 2;
const LANE_MAX = 5;
const LANE_GAP = 13;
/** A tilted orbit is an ellipse on the screen. This much of its length is what a hull actually gets. */
const ELLIPSE = 0.72;

/** Waiting and failed craft never merge, section 7.4. */
const NEVER_MERGE: ReadonlySet<VisualState> = new Set<VisualState>(['approve', 'answer', 'plan', 'source', 'errored', 'crashed', 'retrying', 'no-budget', 'rate-limited', 'lost', 'parked']);

export const neverMerges = (state: VisualState): boolean => NEVER_MERGE.has(state);

export interface CrowdCraft {
  id: string;
  altitude: number;
  state: VisualState;
  tier: number;
  tps: number;
  selected: boolean;
}

export interface Lane { altitude: number; radius: number; shoal: number }

export interface Crowd {
  /** Empty for a world that is not crowded. */
  lanes: Lane[];
  /** Lane by craft id. A craft missing here is free. */
  laneOf: Map<string, number>;
  /** Merged into a band. */
  shoaled: Set<string>;
}

const EMPTY: Crowd = { lanes: [], laneOf: new Map(), shoaled: new Set() };

/** `span` is the orbital span of the world, `radiusAt` its orbit radius by altitude, both CSS px. */
export function crowdWorld(craft: readonly CrowdCraft[], span: number, radiusAt: (altitude: number) => number, craftK: number): Crowd {
  if (craft.length <= FREE_CRAFT) return EMPTY;
  const count = Math.max(LANE_MIN, Math.min(LANE_MAX, Math.floor(span / (LANE_GAP * craftK))));
  const lanes: Lane[] = [];
  const room: number[] = [];
  for (let i = 0; i < count; i++) {
    const altitude = (i + 0.5) / count;
    const radius = radiusAt(altitude);
    lanes.push({ altitude, radius, shoal: 0 });
    room.push(Math.max(2, Math.floor((2 * Math.PI * radius * ELLIPSE) / (HULL_PITCH * craftK))));
  }
  const laneOf = new Map<string, number>();
  const shoaled = new Set<string>();
  const rank = (c: CrowdCraft): number => (neverMerges(c.state) || c.selected ? 0 : 1);
  const order = [...craft].sort((a, b) => rank(a) - rank(b) || a.tier - b.tier || b.tps - a.tps || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let solo = 0;
  for (const c of order) {
    const lane = Math.min(count - 1, Math.max(0, Math.floor(c.altitude * count)));
    laneOf.set(c.id, lane);
    if (rank(c) === 0) { solo += 1; room[lane] = room[lane]! - 1; continue; }
    if (solo < SOLO_CAP && room[lane]! > 0) { solo += 1; room[lane] = room[lane]! - 1; continue; }
    shoaled.add(c.id);
    lanes[lane]!.shoal += 1;
  }
  return { lanes, laneOf, shoaled };
}

const TAU = Math.PI * 2;
const wrap = (a: number): number => ((a % TAU) + TAU) % TAU;

/**
 * Pushes angles apart until no two sit closer than `gap`, moving each as little as it can. Pure, so the same craft on the same ring
 * land the same way. Returns how far each one moved, in input order.
 */
export function spreadRing(angles: readonly number[], gap: number): number[] {
  const n = angles.length;
  const out = new Array<number>(n).fill(0);
  if (n < 2) return out;
  const step = Math.min(gap, (TAU * 0.98) / n);
  const order = angles.map((a, i) => ({ a: wrap(a), i })).sort((x, y) => x.a - y.a || x.i - y.i);
  const at = order.map((o) => o.a);
  for (let pass = 0; pass < 24; pass++) {
    let moved = false;
    for (let k = 0; k < n; k++) {
      const next = (k + 1) % n;
      const delta = next === 0 ? at[next]! + TAU - at[k]! : at[next]! - at[k]!;
      if (delta >= step - 1e-6) continue;
      const push = (step - delta) / 2;
      at[k] = at[k]! - push;
      at[next] = at[next]! + push;
      moved = true;
    }
    if (!moved) break;
  }
  order.forEach((o, k) => { out[o.i] = at[k]! - o.a; });
  return out;
}

export interface Seat { angle: number; radius: number; /** Room this craft asks for, world units. A ring around a hull needs more. */ pitch: number }

/** The smallest turn that puts a craft clear of those already seated, so a small world's craft can be counted. Zero when it is clear. */
export function seatTurn(seated: readonly Seat[], me: Seat, projectedRoom?: (turn: number) => number): number {
  const room = (turn: number): number => {
    let worst = Infinity;
    for (const o of seated) {
      const gap = Math.sqrt(Math.max(0, me.radius ** 2 + o.radius ** 2 - 2 * me.radius * o.radius * Math.cos(me.angle + turn - o.angle)));
      worst = Math.min(worst, gap - Math.max(me.pitch, o.pitch));
    }
    return Math.min(worst, projectedRoom?.(turn) ?? Infinity);
  };
  if (room(0) >= 0) return 0;
  let best = 0;
  let most = room(0);
  for (let i = 1; i <= 18; i++) {
    for (const sign of [1, -1]) {
      const turn = sign * i * (Math.PI / 18);
      const r = room(turn);
      if (r >= 0) return turn;
      if (r > most) { most = r; best = turn; }
    }
  }
  return best;
}

/** Plumes shorten as a lane fills, so a crowded ring reads as a rotor and not as a smear. Never under the 30 px floor of the law. */
export const crowdDim = (craftOnWorld: number): { plume: number; gain: number; wake: boolean } => {
  if (craftOnWorld <= FREE_CRAFT) return { plume: 1, gain: 1, wake: true };
  const k = Math.min(1, (craftOnWorld - FREE_CRAFT) / 16);
  return { plume: 1 - 0.45 * k, gain: 1 - 0.4 * k, wake: false };
};
