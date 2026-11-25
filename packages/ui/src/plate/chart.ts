// The Plate as numbers. Pure and free of the DOM, so tests read it. Same layout.ts and laws.ts as the scene, and the same sky frame:
// DESIGN 7.1 for right ascension and the tilt, the stereographic mapping of sky-line, the point lens of the Bend (section 7.6).
import { placeLabels } from '../core/labels.ts';
import type { Anchor } from '../core/labels.ts';
import { orbitCss, thetaE } from '../core/laws.ts';
import { bandOf } from '../core/layout.ts';
import type { Rect } from '../core/layout.ts';
import { craftAngle, onOrbit, orbitEllipse, orbitPlane } from '../core/orbit.ts';
import type { OrbitPlane } from '../core/orbit.ts';
import { HOLE_RADIUS, homeLens, placeSpace, see, type OrbitRing, type Vec3 } from '../core/space.ts';
import type { CraftVM, Model, WorldVM } from '../store/model.ts';
import { hash32 } from '../store/veil.ts';

const DEG = Math.PI / 180;
const TILT = -16 * DEG;
const COS_T = Math.cos(TILT);
const SIN_T = Math.sin(TILT);

export interface Pt { x: number; y: number }
export interface Well { x: number; y: number; theta: number; danger?: boolean; id?: string; /** World space, for the scene. */ at?: Vec3 }

/** `ra(age) = -90 + 6 * age`: now at the right edge of the globe, the Horizon at the left. */
export const raOf = (ageDays: number): number => (-90 + 6 * ageDays) * DEG;

export const skyRadius = (free: Rect): number => Math.max(free.w, free.h) / 2;

/** Centre-relative CSS px, y down. `e3` is up tilted by -16 degrees toward camera right, `e2 = e3 x e1`, `e1` the view axis. */
export function skyPoint(ra: number, dec: number, skyR: number): Pt {
  const cd = Math.cos(dec);
  const a = cd * Math.sin(ra);
  const z = Math.sin(dec);
  // Rows of the view basis applied to the sky axes, written out: right, up and forward.
  const vx = -COS_T * a + SIN_T * z;
  const vy = SIN_T * a + COS_T * z;
  const vz = cd * Math.cos(ra);
  const psi = Math.acos(Math.max(-1, Math.min(1, vz)));
  const rho = Math.tan(0.5 * psi) * skyR;
  const n = Math.hypot(vx, vy) || 1e-6;
  return { x: (vx / n) * rho, y: -(vy / n) * rho };
}

/**
 * The shader maps a screen pixel back to the sky with `s = p - d * te^2 / (r^2 + 1)`. The Plate draws forward, so it solves that for
 * the outer image, in closed form per well. Wells add in the shader and in turn here, which agrees while they sit apart.
 */
export function lensForward(p: Pt, wells: readonly Well[]): Pt {
  let { x, y } = p;
  for (const w of wells) {
    const dx = x - w.x;
    const dy = y - w.y;
    const beta = Math.hypot(dx, dy);
    if (beta < 1e-6) continue;
    const r = (beta + Math.sqrt(Math.max(0, beta * beta + 4 * (w.theta * w.theta - 1)))) / 2;
    const k = r / beta;
    x = w.x + dx * k;
    y = w.y + dy * k;
  }
  return { x, y };
}

/** The shader's own mapping, for tests and for nothing else. */
export function lensBack(p: Pt, wells: readonly Well[]): Pt {
  let { x, y } = p;
  for (const w of wells) {
    const dx = p.x - w.x;
    const dy = p.y - w.y;
    const r2 = dx * dx + dy * dy + 1;
    x -= (dx * w.theta * w.theta) / r2;
    y -= (dy * w.theta * w.theta) / r2;
  }
  return { x, y };
}

const round = (n: number): number => Math.round(n * 10) / 10;

export function meridianPath(ageDays: number, skyR: number, wells: readonly Well[], halfDeg = 86, stepDeg = 3): string {
  const ra = raOf(ageDays);
  let d = '';
  for (let dec = -halfDeg; dec <= halfDeg; dec += stepDeg) {
    const p = lensForward(skyPoint(ra, dec * DEG, skyR), wells);
    d += `${d ? 'L' : 'M'}${round(p.x)} ${round(p.y)}`;
  }
  return d;
}

export interface MeridianLine { day: number; d: string; kind: 'now' | 'week' | 'day' | 'horizon' }

export function meridians(skyR: number, wells: readonly Well[]): MeridianLine[] {
  const out: MeridianLine[] = [];
  for (let day = 0; day <= 30; day += 1) {
    out.push({ day, d: meridianPath(day, skyR, wells), kind: day === 0 ? 'now' : day === 30 ? 'horizon' : day % 7 === 0 ? 'week' : 'day' });
  }
  return out;
}

export interface WorldMark {
  world: WorldVM; plane: OrbitPlane; band: 0 | 1 | 2;
  /** Where it stands in space, and how large. What the scene reads. */
  at: Vec3; radius: number; ring: OrbitRing; belt: boolean;
  /** The same, seen from Home. What the Plate draws, and the only view it registers with. */
  x: number; y: number; r: number; labelX: number; labelY: number; anchor: Anchor; labelHidden: boolean;
}
export interface CraftMark {
  craft: CraftVM; x: number; y: number; angle: number; ring: 'well' | 'broken' | 'hollow' | null; ringR: number; tag: string | null;
  /** Null for a craft that shows no label. */
  label: { x: number; y: number; anchor: Anchor } | null;
}
export interface BeadMark { id: string; x: number; y: number; tone: CraftVM['tone'] }

export interface Chart {
  cx: number;
  cy: number;
  skyR: number;
  discR: number;
  worlds: WorldMark[];
  crafts: CraftMark[];
  beads: BeadMark[];
  wells: Well[];
  orbits: Array<{ key: string; x: number; y: number; rx: number; ry: number; tilt: number }>;
}

const MAX_WELLS = 8;
/** One sentence of the Almanac is one 34 px line above a 20 px foot. Section 12.4. */
const ALMANAC_LINE = 34;
const ALMANAC_FOOT = 20;
export const almanacTop = (lines: number, h: number): number => (lines > 0 ? h / 2 - ALMANAC_FOOT - lines * ALMANAC_LINE : Number.POSITIVE_INFINITY);
/** B612 at the label size. Only the collision search reads this, the text itself is measured by the browser. */
export const CHAR_PX = 7.4;
/** At five craft or fewer every one has its letter, section 12.5. */
export const LABEL_ALL_BELOW = 6;

type ChartInput = Pick<Model, 'allWorlds' | 'crafts' | 'decisions' | 'now'> & Partial<Pick<Model, 'almanac' | 'beltWorlds'>>;

/** The short tag beside a craft at System level. */
export function craftTag(c: Pick<CraftVM, 'state' | 'metric'>, answerable: boolean): string | null {
  if (answerable || c.state === 'source') return c.metric;
  return c.state === 'errored' ? `API ${c.metric}`.trim() : null;
}

/** Set by the scene while it runs: its craft fly at the law's rate, and this keeps the Plate under them on the same spot. */
let angleSource: ((id: string) => number | undefined) | null = null;
export const setAngleSource = (fn: ((id: string) => number | undefined) | null): void => { angleSource = fn; };

/** A band a world was last in. Bands move outward only at the first boot of a day, so inside one page they only fall inward. */
export type HeldBands = Map<string, 0 | 1 | 2>;
const BAND_AGE = [0, 2, 8] as const;

export function buildChart(model: ChartInput, free: Rect, craftK: number, selected: string | null = null, held?: HeldBands): Chart {
  const worldsAll = [...model.allWorlds, ...(model.beltWorlds ?? [])];
  const seeds = worldsAll.map((w) => {
    const band = Math.min(bandOf(w.ageDays), held?.get(w.worldId) ?? 2) as 0 | 1 | 2;
    held?.set(w.worldId, band);
    return { key: w.worldId, slot: Math.max(0, w.slot - 1), mass: w.mass, ageDays: held ? BAND_AGE[band] : w.ageDays, belt: w.belt === true };
  });
  const spots = new Map(placeSpace(seeds).map((p) => [p.key, p]));
  const lens = homeLens(free);

  const worlds: WorldMark[] = [];
  const crafts: CraftMark[] = [];
  const beads: BeadMark[] = [];
  const orbits: Chart['orbits'] = [];
  const craftList = Object.values(model.crafts).filter((craft) => craft.visible !== false);
  const openDecisions = model.decisions.filter((d) => d.status === 'open');
  const decisionAge = new Map(openDecisions.map((d) => [d.nodeId, d.ageMs]));
  const danger = new Set(openDecisions.filter((d) => d.danger).map((d) => d.nodeId));
  const craftAt = new Map<string, Pt & { spot: Vec3 }>();
  const unit = (w: WorldVM): number => (w.belt ? (hash32(w.worldId) % 32) : Math.max(0, w.slot - 1));

  for (const w of worldsAll) {
    const p = spots.get(w.worldId);
    if (!p) continue;
    const plane = orbitPlane(unit(w));
    const ellipse = orbitEllipse(plane, lens);
    const seen = see(lens, p.position);
    worlds.push({ world: w, plane, band: p.band, at: p.position, radius: p.radius, ring: p.ring, belt: p.belt, x: seen.x, y: seen.y, r: p.radius * seen.scale, labelX: seen.x, labelY: seen.y, anchor: 'middle', labelHidden: p.belt });
    for (const row of w.rows) {
      if (row.type !== 'craft') continue;
      const c = row.craft;
      const r = orbitCss(p.radius, c.altitude, 1);
      const a = angleSource?.(c.id) ?? craftAngle(c.id, c.outputTokens);
      const spot = onOrbit(plane, p.position, r, a);
      const here = see(lens, spot);
      const nx = see(lens, onOrbit(plane, p.position, r, a + 0.02));
      const at = { x: here.x, y: here.y, spot };
      craftAt.set(c.id, at);
      orbits.push({ key: c.id, x: seen.x, y: seen.y, rx: r * seen.scale * ellipse.rx, ry: r * seen.scale * ellipse.ry, tilt: ellipse.tilt });
      const age = decisionAge.get(c.id);
      const answerable = age !== undefined;
      const ring = answerable ? 'well' : c.state === 'source' ? 'broken' : c.state === 'parked' ? 'hollow' : null;
      const ringR = answerable ? thetaE((age ?? 0) / 1000, free.h) : ring === 'broken' ? 30 * craftK : 16 * craftK;
      const tag = craftTag(c, answerable);
      crafts.push({ craft: c, x: at.x, y: at.y, angle: Math.atan2(nx.y - at.y, nx.x - at.x), ring, ringR, tag, label: null });
    }
  }

  // Tenders ride a small epicycle around the parent, workflow agents sit as beads on a hoop of their world.
  for (const c of craftList) {
    if (c.kind === 'main' || !c.live) continue;
    const parent = c.parentId ? craftAt.get(c.parentId) : undefined;
    if (!parent) continue;
    const a = (hash32(c.id) % 628) / 100 + c.outputTokens / 3000;
    const r = 12 * craftK;
    beads.push({ id: c.id, x: parent.x + r * Math.cos(a), y: parent.y + r * Math.sin(a), tone: c.tone });
  }

  const open = crafts.filter((c) => c.ring === 'well').sort((a, b) => (decisionAge.get(a.craft.id) ?? 0) - (decisionAge.get(b.craft.id) ?? 0));
  // Newest, then oldest 7 (section 12.5). The rail lists all.
  const chosen = open.length <= MAX_WELLS ? open : [open[0]!, ...open.slice(-(MAX_WELLS - 1))];
  const wells = chosen.map((c) => ({ x: c.x, y: c.y, theta: c.ringR, danger: danger.has(c.craft.id), id: c.craft.id, at: craftAt.get(c.craft.id)!.spot }));

  const discR = HOLE_RADIUS * see(lens, [0, 0, 0]).scale;
  const lines = model.almanac?.length ?? 0;
  const labelled = crafts.filter((c) => crafts.length < LABEL_ALL_BELOW || c.craft.id === selected || c.ring !== null || c.craft.state === 'errored' || c.craft.state === 'crashed')
    .sort((a, b) => a.craft.tier - b.craft.tier);
  const placed = new Map(placeLabels({
    worlds: worlds.filter((w) => !w.belt).map((w) => ({ id: w.world.worldId, x: w.x, y: w.y, r: w.r, width: labelText(w).length * CHAR_PX })),
    crafts: labelled.map((c) => ({ id: c.craft.id, x: c.x, y: c.y, width: (c.craft.glyph.length + (c.tag ? c.tag.length + 1 : 0)) * CHAR_PX })),
    dots: crafts,
    discR,
    w: free.w,
    h: free.h,
    almanacTop: almanacTop(lines, free.h),
  }).map((l) => [l.id, l]));
  for (const w of worlds) {
    const l = placed.get(w.world.worldId);
    if (l) { w.labelX = l.x; w.labelY = l.y; w.anchor = l.anchor; w.labelHidden = l.hidden; }
  }
  for (const c of labelled) {
    const l = placed.get(c.craft.id);
    if (l && !l.hidden) c.label = { x: l.x, y: l.y, anchor: l.anchor };
  }

  return { cx: free.w / 2, cy: free.h / 2, skyR: skyRadius(free), discR, worlds, crafts, beads, wells, orbits };
}

export const labelText = (w: Pick<WorldMark, 'world'>): string => `${w.world.slot} ${w.world.name}`;

const heldBands: HeldBands = new Map();
let last: { model: ChartInput; w: number; h: number; craftK: number; selected: string | null; chart: Chart } | null = null;

/** The Plate and the scene ask four times a second for the same chart, so the second one is free. */
export function chartOf(model: ChartInput, free: Rect, craftK: number, selected: string | null): Chart {
  if (last && last.model === model && last.w === free.w && last.h === free.h && last.craftK === craftK && last.selected === selected) return last.chart;
  const chart = buildChart(model, free, craftK, selected, heldBands);
  last = { model, w: free.w, h: free.h, craftK, selected, chart };
  return chart;
}

/** The sliver gauge: an arc from one o'clock, sweeping with what is left. */
export function arcPath(r: number, fraction: number): string {
  const start = -60 * DEG;
  const sweep = Math.max(0.001, Math.min(0.999, fraction)) * 2 * Math.PI;
  const end = start + sweep;
  const large = sweep > Math.PI ? 1 : 0;
  const p = (a: number) => `${round(r * Math.cos(a))} ${round(r * Math.sin(a))}`;
  return `M${p(start)}A${r} ${r} 0 ${large} 1 ${p(end)}`;
}
