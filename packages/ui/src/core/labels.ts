// The collision search of DESIGN 4.5. Pure. A world's name sits on the outward side from the star and moves only when that spot is
// taken. A craft's label never lies on a world, which is what the Plate used to do. Centre-relative CSS px, y down.

export type Anchor = 'start' | 'middle' | 'end';

export interface WorldLabelIn { id: string; x: number; y: number; r: number; width: number }
export interface CraftLabelIn { id: string; x: number; y: number; width: number; /** Clear of a ring around the hull. */ reach?: number }
export interface LabelIn {
  worlds: readonly WorldLabelIn[];
  /** Attention order. Past the cap the end of the list goes. */
  crafts: readonly CraftLabelIn[];
  /** Every craft on the screen, labelled or not. A world name keeps clear of them. */
  dots: ReadonlyArray<{ x: number; y: number }>;
  /** Points along the plumes. No label sits on a drive. */
  plumes?: ReadonlyArray<{ x: number; y: number }>;
  /** Which turn each label stood on last time. A spot that is still good stays, or a label hops while the camera moves. */
  held?: ReadonlyMap<string, number>;
  discR: number;
  /** Where the star is, when the camera has left it. Centre by default. */
  discX?: number;
  discY?: number;
  w: number;
  h: number;
  /** Top of the Almanac, centre-relative. A world label that reaches it hides. Infinity when there is none. */
  almanacTop: number;
}
export interface LabelOut { id: string; x: number; y: number; anchor: Anchor; hidden: boolean; turn: number }

export const LABEL_CAP = 30;
const HEIGHT = 16;
const CRAFT_REACH = 13;
const WORLD_GAP = 10;
const DOT_R = 9;
const PLUME_R = 7;
/** A held spot stays while it is clean. */
const HOLD_COST = 1;
/** The turns of DESIGN 4.5: outward, 0.9 and 1.8 radians either way, then the far side. */
const WORLD_TURNS = [0, 0.9, -0.9, 1.8, -1.8, Math.PI] as const;
const CRAFT_TURNS = [-0.55, 0.55, -2.6, 2.6, -1.57, 1.57, 0, Math.PI] as const;

interface Box { l: number; r: number; t: number; b: number }
interface Spot { x: number; y: number; anchor: Anchor; box: Box; c: number; turn: number }

const anchorOf = (ux: number): Anchor => (Math.abs(ux) < 0.35 ? 'middle' : ux > 0 ? 'start' : 'end');

function boxOf(x: number, y: number, width: number, anchor: Anchor): Box {
  const l = anchor === 'start' ? x : anchor === 'end' ? x - width : x - width / 2;
  return { l, r: l + width, t: y - HEIGHT + 4, b: y + 4 };
}

const hitBox = (a: Box, b: Box): boolean => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

function hitCircle(a: Box, x: number, y: number, r: number): boolean {
  const dx = Math.max(a.l - x, 0, x - a.r);
  const dy = Math.max(a.t - y, 0, y - a.b);
  return dx * dx + dy * dy < r * r;
}

export function placeLabels(input: LabelIn): LabelOut[] {
  const { worlds, crafts, dots, plumes = [], held, discR, discX = 0, discY = 0, w, h, almanacTop } = input;
  const taken: Box[] = [];
  const out: LabelOut[] = [];

  /** How badly a spot sits. Below 1 is clean, and the search stops at the first clean spot. */
  const cost = (b: Box, own: string | null, useDots: boolean): number => {
    let c = b.l < -w / 2 + 4 || b.r > w / 2 - 4 || b.t < -h / 2 + 2 || b.b > h / 2 - 2 ? 4 : 0;
    if (hitCircle(b, discX, discY, discR + 4)) c += 8;
    for (const o of worlds) if (o.id !== own && hitCircle(b, o.x, o.y, o.r + 3)) c += 8;
    for (const t of taken) if (hitBox(b, t)) c += 4;
    if (useDots) for (const d of dots) if (hitCircle(b, d.x, d.y, DOT_R)) c += 1;
    for (const p of plumes) if (hitCircle(b, p.x, p.y, PLUME_R)) c += 2;
    return c;
  };

  /** The held turn first, and it wins if it is still good. Then the turns in order, and the first clean one. */
  const search = (id: string, count: number, at: (turn: number) => Spot): Spot => {
    const kept = held?.get(id);
    if (kept !== undefined && kept < count) {
      const spot = at(kept);
      if (spot.c < HOLD_COST) return spot;
    }
    let best: Spot | null = null;
    for (let i = 0; i < count; i++) {
      const spot = at(i);
      if (!best || spot.c < best.c) best = spot;
      if (spot.c < 1) break;
    }
    return best!;
  };

  // Craft first: a craft's tag has to stay next to its hull, and a world's name can walk around the world.
  const room = Math.max(0, LABEL_CAP - worlds.length);
  crafts.forEach((craft, i) => {
    if (i >= room) { out.push({ id: craft.id, x: craft.x, y: craft.y, anchor: 'start', hidden: true, turn: 0 }); return; }
    const chosen = search(craft.id, CRAFT_TURNS.length, (turn) => {
      const a = CRAFT_TURNS[turn]!;
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      const anchor = anchorOf(ux);
      const reach = craft.reach ?? CRAFT_REACH;
      const x = craft.x + ux * reach;
      const y = craft.y + uy * reach + 4;
      const box = boxOf(x, y, craft.width, anchor);
      return { x, y, anchor, box, c: cost(box, null, false), turn };
    });
    taken.push(chosen.box);
    out.push({ id: craft.id, x: chosen.x, y: chosen.y, anchor: chosen.anchor, hidden: false, turn: chosen.turn });
  });

  for (const world of worlds) {
    const dist = Math.hypot(world.x - discX, world.y - discY) || 1;
    const base = Math.atan2((world.y - discY) / dist, (world.x - discX) / dist);
    const chosen = search(world.id, WORLD_TURNS.length, (turn) => {
      const ux = Math.cos(base + WORLD_TURNS[turn]!);
      const uy = Math.sin(base + WORLD_TURNS[turn]!);
      const reach = world.r + WORLD_GAP;
      const anchor = anchorOf(ux);
      const x = world.x + ux * reach;
      // Above and below the world the text needs its own height, or the descender lands on the limb.
      const y = world.y + uy * reach + (Math.abs(uy) > 0.7 ? Math.sign(uy) * 8 + 4 : 4);
      const box = boxOf(x, y, world.width, anchor);
      return { x, y, anchor, box, c: cost(box, world.id, true) + (box.b > almanacTop ? 16 : 0), turn };
    });
    const hidden = chosen.box.b > almanacTop;
    if (!hidden) taken.push(chosen.box);
    out.push({ id: world.id, x: chosen.x, y: chosen.y, anchor: chosen.anchor, hidden, turn: chosen.turn });
  }
  return out;
}
