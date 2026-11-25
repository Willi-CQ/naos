// The fleet engine. `setRoster` runs four times a second and may allocate. `draw` runs on every rendered frame, allocates nothing, and
// writes every list from scratch, so a state is only ever a row of the table in core/look.ts and never a slot to keep in step.
// Pure maths lives in core: this file only turns it into instances. Everything here is structure, no name reaches it.
import * as THREE from 'three';
import type { EpochMs, ToolFamily } from '@naos/protocol';
import { crowdDim, crowdWorld, seatTurn, spreadRing, type Crowd, type CrowdCraft, type Seat } from '../core/crowd.ts';
import { ease } from '../core/ease.ts';
import { departureAt, type DeparturePose } from '../core/lifecycle.ts';
import { FlashGate } from '../core/flash.ts';
import { burnAngle, orbitCss, orbitRate } from '../core/laws.ts';
import { beadTone, beamVisible, lookOf, orbitsShown, plumeStyle, type Look, type PlumeStyle, type SceneTone, type ViewLevel } from '../core/look.ts';
import { craftAngle, planeOf } from '../core/orbit.ts';
import { homeLens, moonRadius, moonReach, PAD_RADIUS, see } from '../core/space.ts';
import { hash32 } from '../store/veil.ts';
import { ArcBuffer, BEAM, BeamBuffer, HullBuffer, KIND, type ArcSpec, type HullSpec } from './layers/buffers.ts';
import type { Roster, RosterCraft } from './roster.ts';
import { linear } from './tokens.ts';
import { craftKindOf, craftLength, type CraftKind } from './craft/kind.ts';
import { shipFrame } from './craft/frame.ts';
import { harborAt } from './harbor.ts';
import type { CraftDraw } from './craft/Layer.ts';

type V3 = THREE.Vector3;
const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const GOLDEN = 137.508 * DEG;

const MAX_BEAMS = 64;
const MAX_FX = 128;
/** System level draws this many tenders on a parent, and a count for the rest. */
export const TENDERS_DRAWN = 4;
const TENDERS_MAX = 8;
const HOLDING_ALTITUDE = 1.18;
const ALT_MS = 900;
const ALT_JUMP_MS = 120;
const SPREAD_TAU_S = 0.7;
const HALT_S = 0.04;
const IGNITE_S = 0.06;
const BURN_MIN_MS = 600;
const BURN_MAX_MS = 2400;
const INTERRUPT_SLASH_MS = 4_000;
const TRANSFER_MS = 1_260;
const REENTRY_MS = 1_400;
const HARD_LANDING_MS = 700;
const EMBER_MS = 10_000;
const CITY_HOLD_MS = 5_000;
const FLARE_MS = 300;
const TICK_MS = 120;
const BEACON_MS = 120;
const STREAK_GAP_MS = 48;
const STREAK_MS = 420;
const LINE_MS = 1_200;
const WEB_REACH = 320;
const READ_SWEEP = 12 * DEG;
const CHASE_PLUME = 2.6;
/** World units a hull asks for on its orbit, and what a ring around it asks for, so a small world's craft can be counted. */
const SEAT_PITCH = 30;
const SEAT_RING = 56;
/** An edit lance is never shorter than this on the screen, CSS px, seen from anywhere. */
const LANCE_MIN = 26;
const HOOP_TILT = [[62, 20], [-48, 110], [74, 200], [-30, 300], [40, 60], [-66, 160]] as const;

/** Where a world stands. The controller owns these and moves them while a world wakes. */
export interface FleetBody {
  worldId: string;
  position: V3;
  /** World units. */
  radius: number;
  /** CSS px at system zoom. */
  rCss: number;
  /** Unit vectors in the orbital plane. */
  a: V3;
  b: V3;
  /** Always 1: orbits are world units and a window no longer scales them. The bench shares this shape. */
  perUnit: number;
  /** Where a moon of this world stands now. False when it has none by that name. */
  moonAt?(key: string, out: V3): boolean;
}

export interface FleetBuffers { plumes: ArcBuffer; wakes: ArcBuffer; rings: ArcBuffer; hulls: HullBuffer; beams: BeamBuffer }

export interface FleetView { level: ViewLevel; worldId: string | null; selected: string | null }

export interface FleetOptions { free: { w: number; h: number }; craftK: number; discR: number; reduced: boolean; cut: boolean; hidden?: (point: V3) => boolean }

export interface FleetClock {
  /** performance.now(). */
  wall: number;
  /** Kernel ms: stops with a paused fixture, so a shot repeats. */
  kernel: EpochMs;
  /** Kernel seconds since the last frame. */
  dt: number;
  /** uNow of the arc and beam shaders. */
  scene: number;
}

type FxKind = 'fall' | 'flare' | 'ember' | 'streak' | 'line';

interface Fx {
  kind: FxKind;
  on: boolean;
  at: number;
  life: number;
  /** Fall and streak: an ellipse quarter through two points. Line: two ends. */
  c: V3; a: V3; b: V3;
  tone: SceneTone;
  gain: number;
  size: number;
  from: Slot | null;
  to: Slot | null;
  /** Ember left when a fall lands. */
  hard: boolean;
  /** Set once the fall has landed. */
  landed: boolean;
}

class Slot {
  c: RosterCraft;
  kind: CraftKind;
  ship: CraftDraw;
  look: Look;
  body: FleetBody | null = null;
  /** Orbit centre: the world, or a moon of it. */
  centre = new THREE.Vector3();
  rCss = 0;
  th = 0;
  speed = 0;
  drive = 0;
  alt = 0;
  altFrom = 0;
  altTo = 0;
  altAt = 0;
  altMs = 0;
  burnFrom = 0;
  burnTo = 0;
  burnAt = 0;
  burnMs = 0;
  lastFlush = 0;
  spread = 0;
  spreadTo = 0;
  lane = -1;
  shoaled = false;
  /** Radius in world units, as drawn. */
  r = 0;
  /** CSS px per world unit at the hull, this frame. */
  k = 1;
  /** Length of the plume in radians, this frame. */
  plumeLen = 0;
  /** Already given its place on a small world. Nothing moves it again but its tokens. */
  seated = false;
  /** This frame's numbers the plume and the marks read. On the slot, because a double handed to a call that is not inlined gets boxed. */
  pxPerRad = 0.5;
  angle = 0.5;
  focus = 0.5;
  stateAt = -Infinity;
  flashUntil = 0;
  /** Set when a landing took over, so the hull does not linger for the quarter second until the next roster. */
  landing = false;
  birthAt = -Infinity;
  birthMs = 2400;
  birthFrom = new THREE.Vector3();
  birthTangent = new THREE.Vector3();
  departing = false;
  berth = -1;
  park = 0;
  parkFrom = 0;
  parkTo = 0;
  parkAt = -Infinity;
  parking = false;
  pos = new THREE.Vector3();
  heading = 0;
  sx = 0;
  sy = 0;
  drawn = false;
  gen = 0;
  tenderSeat = 0;
  tenderCount = 1;
  tenderTangent = new THREE.Vector3(1, 0, 0);
  tenderMotion = 0;

  constructor(c: RosterCraft) {
    this.c = c;
    this.look = lookOf(c.state, c.owned);
    this.kind = craftKindOf({ client: c.client, model: c.model, agentType: c.agentType, profile: c.profile, node: c.role === 'vessel' ? 'main' : c.role === 'bead' ? 'workflow-agent' : 'subagent' });
    this.ship = { kind: this.kind, position: this.pos, quaternion: new THREE.Quaternion(), tone: linear(this.look.tone), gain: this.look.gain, fill: this.look.fill };
    this.park = this.parkFrom = this.parkTo = c.state === 'idle' || c.state === 'idle-shell' ? 1 : 0;
  }
}

const here = new THREE.Vector3();
const ahead = new THREE.Vector3();
const scratchA = new THREE.Vector3();
const scratchB = new THREE.Vector3();
const scratchC = new THREE.Vector3();
const toCam = new THREE.Vector3();
const STAR = new THREE.Vector3();
const tenderAnchor = new THREE.Vector3();
const departure: DeparturePose = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0 };
// Every number field starts as a double on purpose: V8 then keeps it unboxed in place, and a write on the frame path allocates nothing.
const arc: Required<ArcSpec> = { center: scratchC, a: scratchA, b: scratchB, start: 0.5, sweep: 0.5, color: linear('pearl'), gain: 0.5, width: 0.5, taper: 0.5, dashCycles: 0.5, dashFlow: 0.5, birth: 0.5, life: 0.5 };
const mark: Required<HullSpec> = { position: here, heading: 0.5, size: 0.5, color: linear('pearl'), gain: 0.5, kind: 0.5, fill: 0.5, progress: 0.5, dashes: 0.5 };
const ray = { from: here, to: ahead, kind: 0.5, width: 0.5, color: linear('pearl'), gain: 0.5, birth: 0.5, life: 0.5 };

const hoopBasis = HOOP_TILT.map(([incl, node]) => {
  const p = planeOf(incl * DEG, node * DEG);
  return { a: new THREE.Vector3().fromArray(p.a), b: new THREE.Vector3().fromArray(p.b) };
});

interface HoopRow { body: FleetBody; index: number; status: 'running' | 'orphaned' }
interface LaneRow { body: FleetBody; radius: number; shoal: number }
interface BeamRow { slot: Slot; id: string; family: ToolFamily; toStar: boolean; startedAt: number }
type Dim = ReturnType<typeof crowdDim>;

export class FleetEngine {
  private readonly slots = new Map<string, Slot>();
  private order: Slot[] = [];
  private readonly buffers: FleetBuffers;
  private readonly bodyOf: (worldId: string) => FleetBody | undefined;
  private view: FleetView = { level: 'system', worldId: null, selected: null };
  private free = { w: 1, h: 1 };
  private craftK = 1;
  private discR = 60;
  private reduced = false;
  private hidden: ((point: V3) => boolean) | undefined;
  private hoops: HoopRow[] = [];
  private lanes: LaneRow[] = [];
  private beamRows: BeamRow[] = [];
  private padCount = 0;
  private readonly crowdByWorld = new Map<string, number>();
  private readonly dimByWorld = new Map<string, Dim>();
  private readonly tendersOf = new Map<string, number>();
  private readonly beadIndex = new Map<string, number>();
  private readonly fx: Fx[] = [];
  private fxHead = 0;
  private readonly gate = new FlashGate();
  private beaconAt = -Infinity;
  private streakAt = 0;
  private kernelNow = 0;
  private wallNow = 0;
  /** Eases along a flight, DESIGN 7.9: hulls are 15 px at System and 20 closer in. */
  hullScale = 1;
  /** Set by the rig while a craft is the chase view: its mesh stands in for the sprite. */
  meshOf: string | null = null;
  /** The app supplies lit ships; the bench and fallback keep their original marks. */
  externalShips = false;
  /** Something on the screen moves although no token flows: a tumble, a countdown, a drift. */
  animated = false;

  constructor(buffers: FleetBuffers, bodyOf: (worldId: string) => FleetBody | undefined) {
    this.buffers = buffers;
    this.bodyOf = bodyOf;
    for (let i = 0; i < MAX_FX; i++) {
      this.fx.push({ kind: 'flare', on: false, at: 0, life: 0, c: new THREE.Vector3(), a: new THREE.Vector3(), b: new THREE.Vector3(), tone: 'pearl', gain: 0, size: 0, from: null, to: null, hard: false, landed: false });
    }
  }

  // ---- four times a second -------------------------------------------------------------------------------------------------------

  setRoster(roster: Roster, view: FleetView, o: FleetOptions, kernelNow: EpochMs): void {
    this.view = view;
    this.free = o.free;
    this.craftK = o.craftK;
    this.discR = o.discR;
    this.reduced = o.reduced;
    this.hidden = o.hidden;
    this.kernelNow = kernelNow;
    const gen = (this.order[0]?.gen ?? 0) + 1;
    let joined = false;
    for (const c of roster.crafts) {
      let slot = this.slots.get(c.id);
      if (!slot) {
        slot = new Slot(c);
        this.slots.set(c.id, slot);
        slot.th = craftAngle(c.id, c.tokens);
        slot.alt = slot.altFrom = slot.altTo = c.altitude;
        slot.drive = slot.look.plume ? 1 : 0;
        slot.stateAt = o.cut ? -Infinity : kernelNow;
        joined = true;
      } else if (slot.c.state !== c.state) {
        slot.stateAt = o.cut ? -Infinity : kernelNow;
        if (slot.landing && c.state !== 'idle' && c.state !== 'idle-shell' && lookOf(c.state, c.owned).hull !== 'none') {
          slot.landing = false;
          for (const f of this.fx) if (f.from === slot && f.kind === 'fall') f.on = false;
        }
      }
      slot.c = c;
      const parked = c.state === 'idle' || c.state === 'idle-shell' ? 1 : 0;
      if (parked !== slot.parkTo) { slot.parkFrom = slot.park; slot.parkTo = parked; slot.parkAt = this.wallNow; }
      const kind = craftKindOf({ client: c.client, model: c.model, agentType: c.agentType, profile: c.profile, node: c.role === 'vessel' ? 'main' : c.role === 'bead' ? 'workflow-agent' : 'subagent' });
      slot.kind = slot.ship.kind = kind;
      slot.look = lookOf(c.state, c.owned);
      slot.gen = gen;
      if (o.cut || o.reduced) {
        slot.th = craftAngle(c.id, c.tokens);
        slot.burnMs = 0;
      }
      if (o.cut) {
        slot.tenderMotion = 0;
        slot.seated = false;
        slot.alt = slot.altFrom = slot.altTo = c.altitude;
        slot.altMs = 0;
        slot.spread = slot.spreadTo;
        slot.landing = false;
        slot.birthAt = -Infinity;
        slot.departing = false;
        slot.park = slot.parkFrom = slot.parkTo;
        slot.parking = false;
        slot.drive = slot.look.plume ? 1 : 0;
      } else if (Math.abs(c.altitude - slot.altTo) > 1e-4) {
        slot.altFrom = slot.alt;
        slot.altTo = c.altitude;
        slot.altAt = kernelNow;
        slot.altMs = c.owned ? ALT_MS : ALT_JUMP_MS;
      }
      slot.body = this.bodyOf(c.worldId) ?? null;
    }
    let left = false;
    for (const [id, slot] of this.slots) {
      if (slot.gen !== gen) { this.slots.delete(id); left = true; }
    }
    if (joined || left || gen === 1) {
      const rank = { vessel: 0, tender: 1, bead: 2 } as const;
      const depth = new Map<string, number>();
      for (const s of this.slots.values()) {
        const seen = new Set([s.c.id]);
        let parent = s.c.parentId, n = 0;
        while (parent && !seen.has(parent)) {
          seen.add(parent); n += 1; parent = this.slots.get(parent)?.c.parentId ?? null;
        }
        depth.set(s.c.id, n);
      }
      this.order = [...this.slots.values()].sort((a, b) => rank[a.c.role] - rank[b.c.role] || depth.get(a.c.id)! - depth.get(b.c.id)! || (a.c.id < b.c.id ? -1 : 1));
    }
    this.layoutTenders();
    if (o.cut) { for (const f of this.fx) f.on = false; this.gate.clear(); }
    for (const s of this.order) {
      if (s.parkTo === 0 || s.berth >= 0 || s.c.role !== 'vessel') continue;
      let index = 0;
      while (this.order.some((other) => other !== s && other.c.worldId === s.c.worldId && other.berth === index)) index += 1;
      s.berth = index;
    }
    this.layoutCrowds();
    this.layoutHoops(roster);
    this.sampleBeams();
    this.updateAnimated();
  }

  private updateAnimated(): void {
    let moving = false;
    for (const s of this.order) {
      const l = s.look;
      if (l.tumble > 0 || l.ring === 'countdown' || l.drift || l.plume === 'flicker') moving = true;
    }
    this.animated = moving;
  }

  private layoutTenders(): void {
    const groups = new Map<string, Slot[]>();
    for (const s of this.order) {
      if (s.c.role !== 'tender' || s.look.hull === 'none') continue;
      const key = s.c.parentId ?? `world:${s.c.worldId}`;
      const siblings = groups.get(key) ?? [];
      siblings.push(s); groups.set(key, siblings);
    }
    for (const siblings of groups.values()) {
      siblings.sort((a, b) => a.c.order - b.c.order || (a.c.id < b.c.id ? -1 : 1));
      siblings.forEach((s, i) => { s.tenderSeat = i; s.tenderCount = siblings.length; });
    }
  }

  private layoutCrowds(): void {
    const { craftK } = this;
    const groups = new Map<string, Slot[]>();
    this.padCount = 0;
    this.tendersOf.clear();
    for (const s of this.order) {
      if (s.c.role === 'tender' && s.c.parentId && s.look.hull !== 'none') this.tendersOf.set(s.c.parentId, (this.tendersOf.get(s.c.parentId) ?? 0) + 1);
      if (s.look.pad) this.padCount += 1;
      if (s.c.role !== 'vessel' || s.look.hull === 'none' || !s.body || s.c.moon || s.look.pad || s.look.transfer) continue;
      const row = groups.get(s.c.worldId);
      if (row) row.push(s); else groups.set(s.c.worldId, [s]);
    }
    this.lanes.length = 0;
    this.crowdByWorld.clear();
    this.dimByWorld.clear();
    for (const [worldId, slots] of groups) {
      const body = slots[0]!.body!;
      this.crowdByWorld.set(worldId, slots.length);
      this.dimByWorld.set(worldId, crowdDim(slots.length));
      const span = Math.min(66, Math.max(34, 1.3 * body.rCss));
      const radiusAt = (alt: number) => orbitCss(body.rCss, alt, 1);
      const input: CrowdCraft[] = slots.map((s) => ({ id: s.c.id, altitude: s.c.altitude, state: s.c.state, tier: s.c.tier, tps: s.c.tps, selected: s.c.id === this.view.selected }));
      const crowd = crowdWorld(input, span, radiusAt, 1);
      this.applyCrowd(slots, crowd, body);
      if (crowd.lanes.length === 0) this.seatWorld(slots, body);
    }
  }

  /**
   * A world with few craft keeps every exact altitude, and on a small world that stacked them. So each still craft takes a seat when it
   * first appears, clear of the others, and keeps it. A craft in flight is passing through and needs none, and nobody is pushed later:
   * a still craft moves for no one, because a craft only ever moves on its own tokens.
   */
  private seatWorld(slots: readonly Slot[], body: FleetBody): void {
    const seated: Seat[] = [];
    const seatOf = (s: Slot): Seat => ({ angle: s.th + s.spreadTo, radius: orbitCss(body.rCss, s.c.altitude, 1), pitch: s.look.ring === 'broken' || s.look.ring === 'well' ? SEAT_RING : SEAT_PITCH });
    const lens = homeLens(this.free);
    const pitchOf = (s: Slot): number => (s.look.ring === 'well' || s.look.ring === 'broken' ? 22 : 14) * this.craftK;
    const projected = (s: Slot, angle: number) => {
      const b = s.body!;
      const radius = orbitCss(b.rCss, s.c.altitude, 1);
      const c = Math.cos(angle) * radius, n = Math.sin(angle) * radius;
      return see(lens, [b.position.x + b.a.x * c + b.b.x * n, b.position.y + b.a.y * c + b.b.y * n, b.position.z + b.a.z * c + b.b.z * n]);
    };
    // Distant worlds can have overlapping projected orbits. Choose each first seat against the whole Home view, then keep it still.
    const marks = this.order.filter((s) => s.body && s.c.role === 'vessel' && !s.c.moon && !s.look.pad && !s.look.transfer && s.look.hull !== 'none' && (s.seated || s.look.moves))
      .map((s) => ({ ...projected(s, s.th + s.spreadTo), pitch: pitchOf(s) }));
    for (const s of slots) if (s.seated) seated.push(seatOf(s));
    for (const s of slots) {
      if (s.seated || s.look.moves) continue;
      const me = seatOf(s);
      s.spreadTo += seatTurn(seated, me, (turn) => {
        const at = projected(s, me.angle + turn);
        let room = Infinity;
        for (const mark of marks) room = Math.min(room, Math.hypot(at.x - mark.x, at.y - mark.y) - Math.max(pitchOf(s), mark.pitch));
        return room;
      });
      // A first look has nothing to ease from.
      if (s.spread === 0) s.spread = s.spreadTo;
      s.seated = true;
      seated.push(seatOf(s));
      marks.push({ ...projected(s, s.th + s.spreadTo), pitch: pitchOf(s) });
    }
  }

  private applyCrowd(slots: readonly Slot[], crowd: Crowd, body: FleetBody): void {
    const lanes = crowd.lanes;
    for (const s of slots) {
      const lane = crowd.laneOf.get(s.c.id);
      s.lane = lane ?? -1;
      s.shoaled = crowd.shoaled.has(s.c.id);
      if (lane === undefined && lanes.length > 0) s.spreadTo = 0;
    }
    lanes.forEach((lane, i) => {
      this.lanes.push({ body, radius: lane.radius, shoal: lane.shoal });
      const on = slots.filter((s) => s.lane === i && !s.shoaled);
      const gap = SEAT_PITCH / lane.radius;
      const moves = spreadRing(on.map((s) => s.th), gap);
      on.forEach((s, k) => { s.spreadTo = moves[k]!; });
    });
  }

  private layoutHoops(roster: Roster): void {
    this.hoops.length = 0;
    this.beadIndex.clear();
    const seen = new Map<string, number>();
    const seats = new Map<string, number>();
    for (const h of roster.hoops) {
      const body = this.bodyOf(h.worldId);
      if (!body) continue;
      const index = seen.get(h.worldId) ?? 0;
      seen.set(h.worldId, index + 1);
      seats.set(`${h.runId}:${h.index}`, this.hoops.length);
      this.hoops.push({ body, index, status: h.status });
    }
    const filled = new Map<number, number>();
    for (const s of this.order) {
      const wf = s.c.workflow;
      if (!wf) continue;
      const seat = seats.get(`${wf.runId}:${wf.phase}`);
      if (seat === undefined) continue;
      const k = filled.get(seat) ?? 0;
      filled.set(seat, k + 1);
      this.beadIndex.set(s.c.id, seat * 4096 + k);
    }
  }

  /** Newest win, section 12.5. A pure pick at 4 Hz, so the frame path only walks a list of at most 64. */
  private sampleBeams(): void {
    const rows: BeamRow[] = [];
    for (const s of this.order) {
      for (const t of s.c.tools) {
        if (t.family === 'ask' || t.family === 'launch' || t.family === 'send' || t.family === 'other') continue;
        rows.push({ slot: s, id: t.id, family: t.family, toStar: t.toStar, startedAt: t.startedAt });
      }
    }
    rows.sort((a, b) => b.startedAt - a.startedAt || (a.id < b.id ? -1 : 1));
    rows.length = Math.min(rows.length, MAX_BEAMS);
    this.beamRows = rows;
  }

  // ---- events --------------------------------------------------------------------------------------------------------------------

  private slot(id: string): Slot | undefined { return this.slots.get(id); }

  private spawnFx(kind: FxKind, at: number, life: number): Fx {
    const f = this.fx[this.fxHead]!;
    this.fxHead = (this.fxHead + 1) % MAX_FX;
    f.kind = kind;
    f.on = true;
    f.at = at;
    f.life = life;
    f.from = f.to = null;
    f.hard = f.landed = false;
    return f;
  }

  /** Law 3 for a craft you can only read: still, then one burn when a response lands. */
  burn(id: string, tokens: number, wall: number): void {
    const s = this.slot(id);
    if (!s || this.reduced) return;
    const gap = s.lastFlush === 0 ? BURN_MIN_MS : wall - s.lastFlush;
    s.lastFlush = wall;
    s.burnFrom = s.th;
    s.burnTo = s.th + burnAngle(tokens);
    s.burnAt = wall;
    s.burnMs = Math.max(BURN_MIN_MS, Math.min(BURN_MAX_MS, gap));
  }

  beacon(wall: number): void { this.beaconAt = wall; }

  hasBeacons(): boolean {
    for (const s of this.order) if (s.look.beacon) return true;
    return false;
  }

  flare(id: string, tone: SceneTone, gain: number, size: number, ms: number, wall: number, must: boolean): void {
    const s = this.slot(id);
    if (!s) return;
    const at = must ? this.gate.book(wall) : this.gate.tryNow(wall) ? wall : -1;
    if (at < 0) return;
    const f = this.spawnFx('flare', at, ms);
    f.from = s;
    f.c.copy(s.pos);
    f.tone = tone;
    f.gain = gain;
    f.size = size;
  }

  /** A faint mark at the hull, too small to count as a flash. */
  tick(id: string, tone: SceneTone, gain: number, size: number, ms: number, wall: number): void {
    const s = this.slot(id);
    if (!s) return;
    const f = this.spawnFx('flare', wall, ms);
    f.from = s;
    f.c.copy(s.pos);
    f.tone = tone;
    f.gain = gain;
    f.size = size;
  }

  toolStarted(id: string, family: ToolFamily, wall: number): void {
    if (family === 'other') this.tick(id, 'pearl', 3, 3, TICK_MS, wall);
    if (family === 'launch') this.flare(id, 'pearl', 5, 7, 180, wall, false);
  }

  /** The tool came back failed: a spark at the tip of the beam, Tape tick only otherwise. */
  spark(id: string, wall: number): void {
    const s = this.slot(id);
    if (!s || !s.body || !this.gate.tryNow(wall)) return;
    const f = this.spawnFx('flare', wall, FLARE_MS);
    this.visibleTip(s, f.c);
    f.tone = 'halpha';
    f.gain = 7;
    f.size = 5;
  }

  /**
   * Where a lance meets the surface as you see it. It runs from the hull toward the middle of the disc on the screen, at least LANCE_MIN
   * long, and ends on the side of the world that faces the camera. A straight radial line would be a stub whenever the hull sits low or
   * the camera looks along it, and from a free camera that is half the time.
   */
  private visibleTip(s: Slot, out: V3): V3 {
    const body = s.body!;
    scratchD.copy(s.pos).sub(body.position);
    const hx = scratchD.dot(camRight);
    const hy = scratchD.dot(camUp);
    const d = Math.sqrt(hx * hx + hy * hy) || 1e-3;
    const R = body.radius;
    const q = Math.max(-0.94, Math.min(0.94, (d - LANCE_MIN / Math.max(1e-3, s.k)) / R));
    const x = (hx / d) * q * R;
    const y = (hy / d) * q * R;
    const z = Math.sqrt(Math.max(0, R * R - x * x - y * y));
    scratchE.copy(toCam).sub(body.position).normalize();
    return out.copy(body.position).addScaledVector(camRight, x).addScaledVector(camUp, y).addScaledVector(scratchE, z);
  }

  /** Ten seconds of ember where an edit landed. */
  scorch(id: string, wall: number): void {
    const s = this.slot(id);
    if (!s || !s.body) return;
    const f = this.spawnFx('ember', wall, EMBER_MS);
    this.visibleTip(s, f.c);
    f.tone = 'nad';
    f.gain = 1.6;
    f.size = 2.4;
  }

  compacted(id: string, wall: number): void {
    const s = this.slot(id);
    if (!s) return;
    if (this.gate.tryNow(wall)) s.flashUntil = wall + TICK_MS * (s.c.owned ? 3 : 1);
  }

  /** Re-entry: a streak down to the surface, a light where it lands. `hard` is the short red fall that leaves an ember. */
  land(id: string, hard: boolean, wall: number): void {
    const s = this.slot(id);
    if (!s || !s.body || !s.drawn || s.landing || s.c.role === 'bead') return;
    s.departing = s.parking = false;
    if (this.reduced) {
      s.landing = true;
      const f = this.spawnFx('ember', wall, CITY_HOLD_MS);
      this.impact(s, f.c);
      f.tone = hard ? 'halpha' : 'lamp';
      f.gain = 3;
      f.size = 3;
      return;
    }
    const at = this.gate.book(wall);
    const f = this.spawnFx('fall', at, hard ? HARD_LANDING_MS : REENTRY_MS);
    f.hard = hard;
    f.tone = hard ? 'halpha' : 'lamp';
    f.from = s;
    // A quarter ellipse from the hull to the surface, bowed around the world.
    this.impact(s, f.b);
    f.a.copy(s.pos);
    scratchA.copy(s.pos).add(f.b).multiplyScalar(0.5);
    scratchB.copy(s.pos).sub(s.body.position).normalize().multiplyScalar(s.body.radius * 0.6);
    f.c.copy(scratchA).sub(scratchB);
    f.a.sub(f.c);
    f.b.sub(f.c);
    s.landing = true;
  }

  /** One streak from a parent to the craft it launched. */
  streak(fromId: string, toId: string, wall: number): void {
    const from = this.slot(fromId);
    const to = this.slot(toId);
    if (!from || !to || this.reduced) return;
    this.streakAt = Math.max(wall, this.streakAt + STREAK_GAP_MS);
    const f = this.spawnFx('streak', this.streakAt, STREAK_MS);
    f.from = from;
    f.to = to;
    f.tone = 'pearl';
    f.gain = 6;
  }

  /** A send: the line from craft to craft. */
  line(fromId: string, toId: string, wall: number): void {
    const from = this.slot(fromId);
    const to = this.slot(toId);
    if (!from || !to) return;
    const f = this.spawnFx('line', wall, LINE_MS);
    f.from = from;
    f.to = to;
    f.tone = 'pearl';
    f.gain = 2.4;
  }

  // ---- what others ask ----------------------------------------------------------------------------------------------------------

  /** Only a fresh start event calls this; discovering an old chat leaves its ship in place. */
  launch(id: string, parentId: string | null, wall: number): boolean {
    const s = this.slots.get(id);
    if (!s?.body) return false;
    if (this.reduced || s.c.role === 'bead' || s.landing || Number.isFinite(s.birthAt)) return true;
    const parent = parentId ? this.slots.get(parentId) : undefined;
    if (parent?.body) {
      s.birthFrom.copy(parent.pos.lengthSq() > 0 ? parent.pos : parent.body.position);
      s.birthMs = 1100;
    } else {
      s.birthFrom.copy(s.body.position).normalize().multiplyScalar(this.discR * 2.0);
      s.birthFrom.y += this.discR * 0.2;
      s.birthMs = 2600;
    }
    s.birthAt = wall;
    this.animated = true;
    return true;
  }

  /** Copies where a craft is. False for one that has no hull on the screen. */
  positionOf(id: string, out: V3): boolean {
    const s = this.slots.get(id);
    if (!s) return false;
    out.copy(s.pos);
    return true;
  }

  /** Seat included, so the Plate draws a craft where the scene does. */
  angleOf(id: string): number | undefined { const s = this.slots.get(id); return s ? s.th + s.spread : undefined; }

  /** The bench places its craft by hand. The app never needs this: an angle comes from tokens. */
  setAngle(id: string, th: number): void {
    const s = this.slots.get(id);
    if (s) s.th = th;
  }

  /** Tangent of flight and the outward radial, both unit, world space. */
  frameOf(id: string, tangent: V3, outward: V3): FleetBody | null {
    const s = this.slots.get(id);
    if (!s?.body) return null;
    const { a, b } = s.body;
    if (s.departing || (s.park > 0.01 && s.berth >= 0 && !s.c.moon)) {
      tangent.copy(s.birthTangent);
      outward.copy(s.pos).sub(s.body.position).normalize();
      return s.body;
    }
    if (s.c.role === 'tender') {
      tangent.copy(s.tenderTangent);
      outward.copy(s.pos).sub(s.body.position).normalize();
      return s.body;
    }
    const c = Math.cos(s.th);
    const n = Math.sin(s.th);
    outward.copy(a).multiplyScalar(c).addScaledVector(b, n);
    tangent.copy(a).multiplyScalar(-n).addScaledVector(b, c);
    return s.body;
  }

  /** Tone and gain of a craft, for the mesh that replaces its sprite. */
  lookOfCraft(id: string): Look | null { return this.slots.get(id)?.look ?? null; }

  /** CSS px from the centre of the free rect. Null off screen or not drawn. */
  spot(id: string): { x: number; y: number } | null {
    const s = this.slots.get(id);
    if (!s?.drawn) return null;
    spotOut.x = s.sx;
    spotOut.y = s.sy;
    return spotOut;
  }

  outerOrbit(worldId: string): number {
    const body = this.bodyOf(worldId);
    return body ? orbitCss(body.rCss, 1, 1) : 100;
  }

  /** Nearest craft to a CSS point, measured from the centre. Selecting is a thumb on a moving target, so the reach is generous. */
  pick(x: number, y: number, reach: number, hidden: (p: V3) => boolean): string | null {
    let best = reach;
    let id: string | null = null;
    for (const s of this.order) {
      if (!s.drawn) continue;
      const d = Math.hypot(s.sx - x, s.sy - y);
      if (d < best && !hidden(s.pos)) { best = d; id = s.c.id; }
    }
    return id;
  }

  /** Points along every plume on the screen, CSS px from the centre, so a label can stay off a drive. Runs at 4 Hz, not on the frame path. */
  plumePoints(camera: THREE.Camera, out: Array<{ x: number; y: number }>): void {
    const vp = matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    for (const s of this.order) {
      if (!s.drawn || !s.body || s.plumeLen <= 0 || !s.look.plume) continue;
      const th = s.th + s.spread;
      const way = s.look.plume === 'retro' ? 1 : -1;
      for (let i = 1; i <= 4; i++) {
        const a = th + way * s.plumeLen * (i / 4);
        ahead.copy(s.centre).addScaledVector(s.body.a, Math.cos(a) * s.r).addScaledVector(s.body.b, Math.sin(a) * s.r);
        project(ahead, vp, this.free, projected);
        if (projected.front) out.push({ x: projected.x, y: projected.y });
      }
    }
  }

  /** Who needs a label at this view, attention first. */
  forEachSlot(fn: (s: { id: string; x: number; y: number; drawn: boolean; shoaled: boolean; state: string; worldId: string; role: string; tier: number }) => void): void {
    for (const s of this.order) fn({ id: s.c.id, x: s.sx, y: s.sy, drawn: s.drawn, shoaled: s.shoaled, state: s.c.state, worldId: s.c.worldId, role: s.c.role, tier: s.c.tier });
  }

  tenderCount(id: string): number { return this.tendersOf.get(id) ?? 0; }

  // ---- every rendered frame ------------------------------------------------------------------------------------------------------

  /** Allocates nothing. Returns whether a transient is still running, so the cadence holds. */
  draw(clock: FleetClock, camera: THREE.Camera): boolean {
    const { plumes, wakes, rings, hulls, beams } = this.buffers;
    plumes.clear();
    wakes.clear();
    rings.clear();
    hulls.clear();
    beams.clear();
    this.kernelNow = clock.kernel;
    this.wallNow = clock.wall;
    toCam.setFromMatrixPosition(camera.matrixWorld);
    camera.matrixWorld.extractBasis(camRight, camUp, scratchD);
    lens.focal = (camera.projectionMatrix.elements[5]! * this.free.h) / 2;
    const vp = matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.drawRings();
    for (const s of this.order) this.drawCraft(s, clock, vp);
    this.drawBeams(clock);
    let busy = this.drawFx(clock);
    for (const s of this.order) if (s.drawn && !s.landing && (s.departing || s.parking)) busy = true;
    plumes.commit();
    wakes.commit();
    rings.commit();
    hulls.commit();
    beams.commit();
    return busy;
  }

  private ring(center: V3, a: V3, b: V3, radius: number, tone: SceneTone, gain: number, width: number, dashes = 0): void {
    scratchC.copy(center);
    scratchA.copy(a).multiplyScalar(radius);
    scratchB.copy(b).multiplyScalar(radius);
    arc.center = scratchC;
    arc.a = scratchA;
    arc.b = scratchB;
    arc.start = 0;
    arc.sweep = TAU;
    arc.color = linear(tone);
    arc.gain = gain;
    arc.width = width;
    arc.taper = 0;
    arc.dashCycles = dashes;
    arc.dashFlow = 0;
    arc.birth = arc.life = 0;
    this.buffers.rings.add(arc);
  }

  private drawRings(): void {
    const { view, craftK } = this;
    for (const lane of this.lanes) {
      if (view.level !== 'system' && lane.body.worldId !== view.worldId) continue;
      const r = lane.radius;
      const near = view.level !== 'system' && view.worldId === lane.body.worldId;
      if (near || lane.shoal > 0) this.ring(lane.body.position, lane.body.a, lane.body.b, r, 'pearl', near ? 0.065 : 0.025, 0.6);
      // The density band: stipple as thick as the lane, one mark per craft it holds.
      if (lane.shoal > 0) this.ring(lane.body.position, lane.body.a, lane.body.b, r, 'oiii', Math.min(0.8, 0.28 + lane.shoal * 0.03), 4 * craftK, lane.shoal * 7);
    }
    for (const h of this.hoops) {
      if (view.level !== 'system' && h.body.worldId !== view.worldId) continue;
      const basis = hoopBasis[h.index % hoopBasis.length]!;
      const radius = h.body.radius * (1.5 + 0.22 * h.index);
      this.ring(h.body.position, basis.a, basis.b, radius, h.status === 'orphaned' ? 'ash' : 'pearl', h.status === 'orphaned' ? 0.07 : 0.14 - 0.015 * h.index, 0.65);
    }
    if (this.padCount > 0) this.ring(STAR, X_AXIS, Z_AXIS, PAD_RADIUS, 'rule', 0.5, 0.75, 48);
  }

  private solveAltitude(s: Slot, wall: number): number {
    if (s.altMs > 0) {
      const k = (this.kernelNow - s.altAt) / s.altMs;
      if (k >= 1) { s.altMs = 0; s.alt = s.altTo; } else s.alt = s.altFrom + (s.altTo - s.altFrom) * ease.settle(Math.max(0, k));
    } else s.alt = s.altTo;
    return wall;
  }

  private place(s: Slot, clock: FleetClock): boolean {
    const body = s.body;
    if (!body) return false;
    const { dt, wall } = clock;
    const l = s.look;
    if (s.burnMs > 0) {
      const k = (wall - s.burnAt) / s.burnMs;
      if (k >= 1) { s.th = s.burnTo; s.burnMs = 0; } else s.th = s.burnFrom + (s.burnTo - s.burnFrom) * ease.burn(k);
    }
    // Law 3, and the two named ways to stop: halt for a well, a cut in one frame for an interrupt.
    const want = l.moves && !this.reduced ? orbitRate(s.c.tps) : 0;
    const tau = want > s.speed ? IGNITE_S : l.slash ? 0.001 : HALT_S;
    s.speed += (want - s.speed) * Math.min(1, dt / tau);
    if (s.speed < 1e-4 && want === 0) s.speed = 0;
    s.th += s.speed * dt;
    this.solveAltitude(s, wall);
    s.spread += (s.spreadTo - s.spread) * Math.min(1, dt / SPREAD_TAU_S);
    const th = s.th + s.spread;

    let rCss = body.rCss;
    s.centre.copy(body.position);
    if (s.c.moon) {
      if (!body.moonAt?.(s.c.moon, s.centre)) {
        const az = (hash32(s.c.moon) % 628) / 100;
        const reach = moonReach(body.radius, 0);
        s.centre.addScaledVector(body.a, Math.cos(az) * reach).addScaledVector(body.b, Math.sin(az) * reach);
      }
      rCss = moonRadius(body.rCss);
    }
    s.rCss = rCss;
    const alt = l.holding ? HOLDING_ALTITUDE : s.lane >= 0 ? (s.lane + 0.5) / this.laneCount(s) : s.alt;
    let r = orbitCss(rCss, alt, 1);
    // From when it was orphaned, which a seek also knows: an orbit that only grew from the last state change would stand still after a reload.
    if (l.drift) r += Math.min(90, Math.max(0, (this.kernelNow - (Number.isFinite(s.stateAt) ? s.stateAt : s.c.since)) / 1000));
    s.r = r;
    const c = Math.cos(th);
    const n = Math.sin(th);
    s.pos.copy(s.centre).addScaledVector(body.a, c * s.r).addScaledVector(body.b, n * s.r);
    return true;
  }

  private laneCount(s: Slot): number {
    let n = 0;
    for (const lane of this.lanes) if (lane.body === s.body) n += 1;
    return Math.max(1, n);
  }

  private drawCraft(s: Slot, clock: FleetClock, vp: THREE.Matrix4): void {
    const { craftK, view } = this;
    const l = s.look;
    s.drawn = false;
    const role = s.c.role;
    const parent = s.c.parentId ? this.slots.get(s.c.parentId) : undefined;
    if (view.level !== 'system' && s.c.worldId !== view.worldId) {
      if (role === 'vessel') this.place(s, clock);
      return;
    }

    if (role === 'bead') { this.drawBead(s, clock, vp); return; }

    if (role === 'tender') {
      if (l.hull === 'none' && !l.drift) return;
      this.drawTender(s, parent, clock, vp);
      return;
    }

    if (l.pad) {
      this.placePad(s, clock);
    } else if (l.transfer) {
      if (this.externalShips) return;
      if (!this.placeTransfer(s, clock)) return;
    } else if (!this.place(s, clock)) return;
    if (s.landing && !l.transfer) return;
    if (l.hull === 'none' && !l.drift) { s.drawn = false; return; }
    if (s.shoaled) { this.project(s, vp); return; }

    const body = s.body!;
    this.placeBerth(s, clock);
    this.placeDeparture(s, clock);
    const th = s.th + s.spread;
    project(s.pos, vp, this.free, projected);
    s.sx = projected.x;
    s.sy = projected.y;
    s.drawn = projected.front;
    s.k = projected.k;
    if (s.departing || s.park > 0.01) ahead.copy(s.pos).addScaledVector(s.birthTangent, 8);
    else ahead.copy(s.centre).addScaledVector(body.a, Math.cos(th + 0.04) * s.r).addScaledVector(body.b, Math.sin(th + 0.04) * s.r);
    project(ahead, vp, this.free, projectedB);
    const dx = projectedB.x - s.sx;
    const dy = projectedB.y - s.sy;
    // Seen along its flight a hull has no direction on the screen. It keeps the last one until it has.
    if (dx * dx + dy * dy > 1e-3) s.heading = Math.atan2(-dy, dx);
    // Length is taken as if the orbit lay flat to the camera, so an arc keeps its true size and a glancing view foreshortens it like the rest.
    const pxPerRad = Math.max(1, s.r * s.k);

    const selected = s.c.id === view.selected;
    const inWorld = view.worldId === s.c.worldId;
    if (orbitsShown(view.level, selected, inWorld)) this.ring(s.centre, body.a, body.b, s.r, 'pearl', selected ? 0.13 : 0.045, 0.65);

    const crowd = this.dimByWorld.get(s.c.worldId) ?? CLEAR;
    const focus = view.level === 'craft' && !selected ? 0.35 : 1;
    this.drive(s, clock);
    s.plumeLen = 0;
    s.pxPerRad = pxPerRad;
    s.angle = th;
    s.focus = focus;
    if (!s.departing && s.park < 0.01 && l.plume && s.drive > 0.01) this.drawPlume(s, clock, crowd);

    this.drawHull(s, clock);
    this.drawMarks(s, clock);
    if (selected) this.drawSelection(s);

    if (selected && parent?.drawn) this.filament(s, parent);
  }

  private project(s: Slot, vp: THREE.Matrix4): void {
    project(s.pos, vp, this.free, projected);
    s.sx = projected.x;
    s.sy = projected.y;
    s.drawn = false;
  }

  private placeDeparture(s: Slot, clock: FleetClock): void {
    const k = (clock.wall - s.birthAt) / s.birthMs;
    s.departing = !this.reduced && k >= 0 && k < 1;
    if (!s.departing) return;
    scratchB.copy(s.pos);
    const bend = s.c.parentId ? 9 : Math.min(180, s.birthFrom.distanceTo(s.pos) * 0.32);
    const u = ease.ejection(k);
    departureAt(s.birthFrom, scratchB, u, bend, departure);
    scratchC.copy(s.birthFrom).add(scratchB).multiplyScalar(0.5); scratchC.y -= bend;
    scratchA.copy(s.birthFrom).sub(scratchC); scratchB.sub(scratchC);
    arc.center = scratchC; arc.a = scratchA; arc.b = scratchB;
    arc.start = Math.max(0, u - 0.22) * Math.PI / 2; arc.sweep = Math.min(u, 0.22) * Math.PI / 2;
    arc.color = linear('oiii'); arc.gain = 3.2 * (1 - k * 0.5); arc.width = 1.8; arc.taper = 1;
    arc.dashCycles = arc.dashFlow = arc.birth = arc.life = 0;
    this.buffers.plumes.add(arc);
    s.pos.set(departure.x, departure.y, departure.z);
    s.birthTangent.set(departure.tx, departure.ty, departure.tz).normalize();
    if (k < 0.24) this.sprite(s.birthFrom, KIND.BEAD, 7 * (1 - k / 0.24), 'pearl', 2, 1, 0, 0, 0);
  }

  private drawSelection(s: Slot): void {
    const r = Math.max(13, 16 * this.craftK) / Math.max(0.01, s.k);
    scratchC.copy(s.pos); scratchA.copy(camRight).multiplyScalar(r); scratchB.copy(camUp).multiplyScalar(r);
    arc.center = scratchC; arc.a = scratchA; arc.b = scratchB; arc.sweep = 0.85;
    arc.color = linear('pearl'); arc.gain = 0.85; arc.width = 0.8; arc.taper = 0;
    arc.dashCycles = arc.dashFlow = arc.birth = arc.life = 0;
    for (let i = 0; i < 2; i++) { arc.start = i * Math.PI - 0.425; this.buffers.rings.add(arc); }
  }

  private placeBerth(s: Slot, clock: FleetClock): void {
    if (s.c.moon) { s.park = 0; s.parking = false; return; }
    if (!s.body || s.berth < 0) return;
    const k = this.reduced ? 1 : Math.min(1, Math.max(0, (clock.wall - s.parkAt) / 1500));
    s.park = s.parkFrom + (s.parkTo - s.parkFrom) * (k * k * (3 - 2 * k));
    s.parking = k < 1 && s.parkFrom !== s.parkTo;
    if (s.park <= 0) return;
    scratchA.copy(s.pos);
    harborAt(s.c.worldId, s.body, scratchB, scratchC);
    scratchB.addScaledVector(s.body.a, s.body.radius * 0.7 + Math.floor(s.berth / 3) * 26)
      .addScaledVector(s.body.b, ((s.berth % 3) - 1) * 26);
    departureAt(scratchA, scratchB, s.park, s.body.radius * 1.2, departure);
    s.pos.set(departure.x, departure.y, departure.z);
    if (s.park > 0.99) s.birthTangent.copy(s.body.a);
    else s.birthTangent.set(departure.tx, departure.ty, departure.tz).normalize().multiplyScalar(s.parkTo ? 1 : -1);
  }

  private placePad(s: Slot, clock: FleetClock): void {
    const n = Math.max(1, this.padCount);
    const a = ((s.c.pad ?? 0) / n) * TAU + 0.6;
    const r = PAD_RADIUS;
    s.pos.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    s.centre.set(0, 0, 0);
    s.th = a;
    this.solveAltitude(s, clock.wall);
    s.r = r;
    s.body = s.body ?? PAD_BODY;
  }

  /** `ejection` for the real spawn time. A quarter ellipse from the corona to the orbit it will hold. */
  private placeTransfer(s: Slot, clock: FleetClock): boolean {
    if (!this.place(s, clock)) return false;
    const k = Number.isFinite(s.stateAt) ? Math.min(1, (this.kernelNow - s.stateAt) / TRANSFER_MS) : 1;
    const e = ease.ejection(k);
    // Out of the star, along the line to the orbit, bowed so it leaves the disc on its near side.
    scratchA.copy(s.pos).normalize().multiplyScalar(this.discR * 1.15);
    scratchB.copy(s.pos);
    scratchC.copy(scratchA).add(scratchB).multiplyScalar(0.5);
    scratchC.y -= 0.32 * s.pos.length();
    scratchA.sub(scratchC);
    scratchB.sub(scratchC);
    arc.center = scratchC;
    arc.a = scratchA;
    arc.b = scratchB;
    arc.start = 0;
    arc.sweep = Math.PI / 2;
    arc.color = linear('oiii');
    arc.gain = 0.8;
    arc.width = 1.25;
    arc.taper = 0;
    arc.dashCycles = 24;
    arc.dashFlow = 0;
    arc.birth = arc.life = 0;
    this.buffers.wakes.add(arc);
    s.pos.copy(scratchC).addScaledVector(scratchA, Math.cos(e * Math.PI / 2)).addScaledVector(scratchB, Math.sin(e * Math.PI / 2));
    return true;
  }

  private drive(s: Slot, clock: FleetClock): void {
    const l = s.look;
    if (!l.plume) { s.drive = l.slash ? 0 : Math.max(0, s.drive - clock.dt / 0.12); return; }
    s.drive = Math.min(1, s.drive + clock.dt / 0.18);
  }

  private drawPlume(s: Slot, clock: FleetClock, crowd: Dim): void {
    const { pxPerRad, angle: th, focus } = s;
    const l = s.look;
    const body = s.body!;
    const { craftK } = this;
    const style = plumeStyle(l.plume!, s.c.tps, clock.kernel / 1000, this.reduced, plumeOut);
    if (style.gain <= 0) return;
    // In the chase view the hull is a mesh a hundred px long, and the plume has to belong to it.
    const near = s.c.id === this.meshOf ? CHASE_PLUME : 1;
    const len = Math.min(1.8, (style.length * craftK * s.drive * crowd.plume * near) / pxPerRad);
    s.plumeLen = len;
    const retro = l.plume === 'retro';
    scratchC.copy(s.centre);
    scratchA.copy(body.a).multiplyScalar(s.r);
    scratchB.copy(body.b).multiplyScalar(s.r);
    arc.center = scratchC;
    arc.a = scratchA;
    arc.b = scratchB;
    arc.start = retro ? th + len + 0.02 : th - len - 0.02;
    arc.sweep = retro ? -len : len;
    arc.color = linear('oiii');
    arc.gain = style.gain * crowd.gain * focus * (this.externalShips ? 0.62 : 1);
    arc.width = style.width * near * (this.externalShips ? 0.62 : 1);
    arc.taper = 1;
    arc.dashCycles = style.dashes;
    arc.dashFlow = style.flow;
    arc.birth = arc.life = 0;
    this.buffers.plumes.add(arc);
    if (!crowd.wake || retro || l.plume === 'flicker') return;
    arc.start = th - 1.9;
    arc.sweep = 1.7;
    arc.gain = (this.externalShips ? 0.12 : 0.6) * focus;
    arc.width = 1;
    arc.taper = 1;
    arc.dashCycles = 0;
    arc.dashFlow = 0;
    this.buffers.wakes.add(arc);
  }

  private drawHull(s: Slot, clock: FleetClock): void {
    if (this.externalShips) return;
    const l = s.look;
    const { craftK } = this;
    if (s.c.id === this.meshOf) { s.drawn = true; return; }
    const size = 7.5 * craftK * this.hullScale * 1.04;
    let gain = l.gain;
    if (clock.wall < s.flashUntil) gain = 8;
    if (l.hull === 'shards') {
      const h = hash32(s.c.id);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU + (h % 7);
        here.copy(s.pos).addScaledVector(s.body!.a, Math.cos(a) * (6 + 3 * i) * craftK / s.body!.perUnit).addScaledVector(s.body!.b, Math.sin(a) * (6 + 3 * i) * craftK / s.body!.perUnit);
        mark.position = here;
        mark.heading = a + clock.kernel * 0.0002 * (i % 2 ? 1 : -1);
        mark.size = 3.4 * craftK * this.hullScale;
        mark.color = linear(l.tone);
        mark.gain = gain;
        mark.kind = KIND.SHARD;
        mark.fill = 1;
        mark.progress = mark.dashes = 0;
        this.buffers.hulls.add(mark);
      }
      return;
    }
    mark.position = s.pos;
    const tumble = l.tumble > 0 ? clock.kernel * 0.001 * l.tumble : 0;
    mark.heading = s.heading + l.turn + tumble;
    mark.size = size;
    mark.color = linear(l.tone);
    mark.gain = gain;
    mark.kind = KIND.KITE;
    mark.fill = l.fill;
    mark.progress = 0;
    mark.dashes = l.dashed ? 7 : 0;
    this.buffers.hulls.add(mark);
  }

  private sprite(at: V3, kind: number, size: number, tone: SceneTone, gain: number, fill = 0, progress = 0, dashes = 0, heading = 0): void {
    mark.position = at;
    mark.heading = heading;
    mark.size = size;
    mark.color = linear(tone);
    mark.gain = gain;
    mark.kind = kind;
    mark.fill = fill;
    mark.progress = progress;
    mark.dashes = dashes;
    this.buffers.hulls.add(mark);
  }

  private drawMarks(s: Slot, clock: FleetClock): void {
    const { pxPerRad, angle: th } = s;
    const l = s.look;
    const { craftK, view } = this;
    const body = s.body!;
    if (l.ring === 'broken') this.sprite(s.pos, KIND.BROKEN, 30 * craftK, 'nad', 1.25, 0, 0, 8);
    if (l.ring === 'hollow') this.sprite(s.pos, KIND.HOLLOW, 16 * craftK, 'nad', 0.6);
    if (l.ring === 'countdown') {
      const span = s.c.countdown;
      const left = span ? Math.max(0, Math.min(1, (span.to - clock.kernel) / Math.max(1, span.to - span.from))) : 1;
      this.sprite(s.pos, KIND.COUNTDOWN, 15 * craftK, 'pearl', 0.9, 0, left, s.c.state === 'retrying' ? 12 : 0);
    }
    if (l.ring === 'fuel') this.sprite(s.pos, KIND.COUNTDOWN, 13 * craftK, 'rule', 0.8, 0, 1, 0);
    else if (view.level !== 'system' && s.c.fuel !== null && view.worldId === s.c.worldId && (l.ring === null || l.ring === 'well')) this.sprite(s.pos, KIND.COUNTDOWN, 13 * craftK, 'bone', 1, 0, s.c.fuel, 0);
    if (l.slash) {
      const on = s.c.state === 'stopping' || !Number.isFinite(s.stateAt) || this.kernelNow - s.stateAt < INTERRUPT_SLASH_MS || s.c.since + INTERRUPT_SLASH_MS > this.kernelNow;
      if (on) this.sprite(s.pos, KIND.SLASH, 9 * craftK * this.hullScale, 'bone', 1.6);
    }
    if (l.beacon) this.sprite(s.pos, KIND.BEAD, 1.9 * craftK, 'pearl', clock.wall - this.beaconAt < BEACON_MS ? 3.2 : 0.3, 1);
    if (l.tick) {
      here.copy(s.pos).addScaledVector(body.b, (13 * craftK) / body.perUnit);
      this.sprite(here, KIND.BEAD, 2.2 * craftK, 'slag', 1.6, 1);
    }
    // Pods and fuel: World level and closer.
    if (view.level !== 'system' && s.c.queued > 0) {
      for (let i = 0; i < Math.min(6, s.c.queued); i++) {
        const a = th + ((i + 1) * 15 * craftK) / pxPerRad;
        here.copy(s.centre).addScaledVector(body.a, Math.cos(a) * s.r).addScaledVector(body.b, Math.sin(a) * s.r);
        this.sprite(here, KIND.POD, 3.2 * craftK, 'pearl', 1.8, 1, 0, 0, s.heading);
      }
    }
  }

  private drawTender(s: Slot, parent: Slot | undefined, clock: FleetClock, vp: THREE.Matrix4): void {
    const { craftK, view } = this;
    const body = parent?.body ?? s.body;
    if (!body) return;
    s.body = body;
    const l = s.look;
    const attached = parent && !parent.landing && parent.look.hull !== 'none' && parent.pos.lengthSq() > 0;
    if (attached) tenderAnchor.copy(parent.pos);
    else tenderAnchor.copy(body.position).addScaledVector(body.a, body.radius + 45);
    const shownCap = view.level === 'system' && view.worldId !== s.c.worldId ? TENDERS_DRAWN : TENDERS_MAX;
    const fresh = !this.reduced && clock.wall - s.birthAt < s.birthMs;
    if (s.tenderSeat >= shownCap && s.c.id !== view.selected && !fresh) { s.drawn = false; return; }
    project(tenderAnchor, vp, this.free, projectedB);
    const scale = Math.max(0.015, projectedB.k);
    const ringIndex = Math.floor(s.tenderSeat / TENDERS_MAX);
    let eR = Math.max(24 + s.c.depth * 4, ((view.level === 'system' ? 30 : 24) + ringIndex * 20) * craftK / scale);
    const move = l.moves || s.c.state === 'generating' || s.c.state === 'writing' ? orbitRate(s.c.tps) * 1.4 : 0;
    if (!this.reduced) s.tenderMotion += move * clock.dt;
    const count = Math.min(TENDERS_MAX, s.tenderCount);
    const phase = (hash32(s.c.parentId ?? s.c.worldId) % 628) / 100;
    const a = (s.tenderSeat % TENDERS_MAX) / Math.max(3, count) * TAU + phase + 0.12 * Math.sin(s.tenderMotion);
    s.pos.copy(tenderAnchor).addScaledVector(camRight, Math.cos(a) * eR).addScaledVector(camUp, Math.sin(a) * eR);
    for (let i = 0; i < 6 && this.hidden?.(s.pos); i++) {
      eR += 18 * craftK / scale;
      s.pos.copy(tenderAnchor).addScaledVector(camRight, Math.cos(a) * eR).addScaledVector(camUp, Math.sin(a) * eR);
    }
    s.tenderTangent.copy(camRight).multiplyScalar(-Math.sin(a)).addScaledVector(camUp, Math.cos(a)).normalize();
    if (s.landing) return;
    this.placeDeparture(s, clock);
    project(s.pos, vp, this.free, projected);
    s.sx = projected.x;
    s.sy = projected.y;
    s.drawn = projected.front;
    s.k = projected.k;
    if (s.departing) ahead.copy(s.pos).addScaledVector(s.birthTangent, 8);
    else ahead.copy(s.pos).addScaledVector(s.tenderTangent, 8);
    project(ahead, vp, this.free, projectedB);
    if ((projectedB.y - s.sy) ** 2 + (projectedB.x - s.sx) ** 2 > 1e-3) s.heading = Math.atan2(-(projectedB.y - s.sy), projectedB.x - s.sx);
    if (move > 0 && !s.departing) {
      scratchC.copy(tenderAnchor);
      scratchA.copy(camRight).multiplyScalar(eR);
      scratchB.copy(camUp).multiplyScalar(eR);
      arc.center = scratchC;
      arc.a = scratchA;
      arc.b = scratchB;
      arc.start = a - 1.1;
      arc.sweep = 1.05;
      arc.color = linear('oiii');
      arc.gain = this.externalShips ? 1.4 : 3;
      arc.width = this.externalShips ? 1 : 1.6;
      arc.taper = 1;
      arc.dashCycles = 0;
      arc.dashFlow = 0;
      arc.birth = arc.life = 0;
      this.buffers.plumes.add(arc);
    }
    mark.position = s.pos;
    mark.heading = s.heading + l.turn;
    mark.size = 5 * craftK * this.hullScale;
    mark.color = linear(l.hull === 'none' ? 'ash' : l.tone);
    mark.gain = Math.max(l.gain, 0.5);
    mark.kind = KIND.DART;
    mark.fill = l.fill;
    mark.progress = 0;
    mark.dashes = 0;
    if (!this.externalShips) this.buffers.hulls.add(mark);
    if (s.c.id === view.selected) { this.drawSelection(s); if (attached) this.filament(s, parent); }
  }

  private drawBead(s: Slot, clock: FleetClock, vp: THREE.Matrix4): void {
    const seat = this.beadIndex.get(s.c.id);
    if (seat === undefined) return;
    const hoop = this.hoops[Math.floor(seat / 4096)];
    if (!hoop) return;
    const k = seat % 4096;
    const basis = hoopBasis[hoop.index % hoopBasis.length]!;
    const body = hoop.body;
    const radius = body.radius * (1.5 + 0.22 * hoop.index);
    const live = s.c.state === 'generating' || s.c.state === 'tool' || s.c.state === 'writing' || s.c.state === 'thinking';
    if (live && !this.reduced) s.th += orbitRate(s.c.tps) * 0.4 * clock.dt;
    const a = k * GOLDEN + (live ? s.th : 0);
    s.pos.copy(body.position).addScaledVector(basis.a, Math.cos(a) * radius).addScaledVector(basis.b, Math.sin(a) * radius);
    project(s.pos, vp, this.free, projected);
    s.sx = projected.x;
    s.sy = projected.y;
    s.drawn = projected.front;
    const tone = beadTone(s.c.state);
    scratchC.copy(body.position);
    scratchA.copy(basis.a).multiplyScalar(radius);
    scratchB.copy(basis.b).multiplyScalar(radius);
    arc.center = scratchC;
    arc.a = scratchA;
    arc.b = scratchB;
    arc.birth = arc.life = 0;
    arc.dashCycles = 0;
    arc.dashFlow = 0;
    if (s.c.state === 'finished') {
      arc.start = a;
      arc.sweep = 0.42;
      arc.color = linear('lamp');
      arc.gain = 0.8;
      arc.width = 1.1;
      arc.taper = 0;
      this.buffers.rings.add(arc);
    } else if (live) {
      arc.start = a - 0.5;
      arc.sweep = 0.5;
      arc.color = linear('oiii');
      arc.gain = 1.4;
      arc.width = 1.4;
      arc.taper = 1;
      this.buffers.plumes.add(arc);
    }
    mark.position = s.pos;
    mark.heading = 0;
    mark.size = 2.8 * this.craftK * this.hullScale;
    mark.color = linear(tone.tone);
    mark.gain = tone.gain;
    mark.kind = KIND.BEAD;
    mark.fill = tone.fill;
    mark.progress = 0;
    mark.dashes = 0;
    this.buffers.hulls.add(mark);
    if ((s.c.workflow?.attempt ?? 1) > 1) {
      mark.size = 6.5 * this.craftK;
      mark.gain = 0.9;
      mark.fill = 0;
      mark.kind = KIND.HOLLOW;
      this.buffers.hulls.add(mark);
    }
  }

  private filament(s: Slot, parent: Slot): void {
    ray.from = s.pos;
    ray.to = parent.pos;
    ray.kind = BEAM.TIGHT;
    ray.width = 0.75;
    ray.color = linear('bone');
    ray.gain = 0.5;
    ray.birth = ray.life = 0;
    this.buffers.beams.add(ray);
  }

  /** Reuses each slot's draw record; the renderer reads the same positions as picking and labels. */
  drawShips(add: (craft: CraftDraw) => void, clock: number): void {
    for (const s of this.order) {
      if (!s.drawn || s.shoaled || !s.body || s.c.role === 'bead' || s.look.hull === 'none') continue;
      const draw = s.ship;
      this.frameOf(s.c.id, scratchA, scratchB);
      shipFrame(scratchA, scratchB, s.look.turn, this.reduced ? 0 : s.look.tumble * clock, draw.quaternion);
      draw.tone = linear(s.look.tone);
      draw.length = undefined;
      draw.gain = s.look.gain * (s.c.id === this.view.selected ? 1.18 : 1);
      draw.fill = s.look.fill;
      draw.dashed = s.look.dashed;
      draw.drive = s.departing || s.parking ? 0.8 : s.c.tps > 0 && s.look.plume ? Math.min(1, s.c.tps / 80) : 0;
      draw.strobe = s.look.beacon && this.wallNow - this.beaconAt < BEACON_MS ? 1 : 0;
      draw.ring = s.c.tokens * 0.0004;
      draw.broken = s.look.hull === 'shards' ? 0.65 : undefined;
      add(draw);
    }
    for (const f of this.fx) {
      if (!f.on || f.kind !== 'fall' || !f.from || this.wallNow < f.at) continue;
      const s = f.from, draw = s.ship;
      if (this.view.level !== 'system' && s.c.worldId !== this.view.worldId) continue;
      const k = Math.max(0, Math.min(1, (this.wallNow - f.at) / f.life));
      draw.length = craftLength(s.kind, 24) * (1 - 0.82 * k ** 4);
      draw.tone = linear(f.hard ? 'halpha' : 'pearl'); draw.gain = 1.6; draw.fill = 1; draw.drive = 0.4;
      draw.broken = undefined; draw.dashed = false;
      add(draw);
    }
  }

  /** Where a beam from this hull meets the surface. */
  private impact(s: Slot, out: V3, swing = 0): V3 {
    const body = s.body!;
    out.copy(s.pos).sub(body.position);
    if (swing !== 0) out.applyAxisAngle(scratchD.crossVectors(body.a, body.b).normalize(), swing);
    return out.normalize().multiplyScalar(body.radius * 0.98).add(body.position);
  }

  private drawBeams(clock: FleetClock): void {
    const { view } = this;
    const t = clock.kernel / 1000;
    for (const row of this.beamRows) {
      const s = row.slot;
      if (!s.drawn || !s.body || !beamVisible(row.family, view.level)) continue;
      ray.from = s.pos;
      ray.to = ahead;
      ray.birth = ray.life = 0;
      switch (row.family) {
        case 'edit':
          this.visibleTip(s, ahead);
          ray.kind = BEAM.STRIKE;
          ray.width = 0.9;
          ray.color = linear('pearl');
          ray.gain = 4;
          break;
        case 'shell':
          this.visibleTip(s, ahead);
          ray.kind = BEAM.DRILL;
          ray.width = 1.2;
          ray.color = linear('pearl');
          ray.gain = 0.8;
          break;
        case 'read':
          this.impact(s, ahead, this.reduced ? 0 : READ_SWEEP * Math.sin(t * Math.PI * 2 * 0.5));
          ray.kind = BEAM.SCAN;
          ray.width = 16 * this.craftK;
          ray.color = linear('pearl');
          ray.gain = 0.9;
          break;
        case 'web':
          ahead.copy(s.pos).sub(s.body.position).normalize().multiplyScalar(WEB_REACH / s.body.perUnit).add(s.pos);
          ray.kind = BEAM.OUTBOUND;
          ray.width = 1;
          ray.color = linear('pearl');
          ray.gain = 1.6;
          break;
        default:
          if (row.toStar) ahead.set(0, 0, 0);
          else {
            ahead.copy(s.body.a).multiplyScalar(s.body.radius).applyAxisAngle(scratchD.crossVectors(s.body.a, s.body.b).normalize(), (hash32(row.id) % 628) / 100).add(s.body.position);
          }
          ray.kind = BEAM.TIGHT;
          ray.width = 1;
          ray.color = linear('pearl');
          ray.gain = 1.6;
      }
      this.buffers.beams.add(ray);
    }
    for (const s of this.order) {
      if (!s.drawn || !s.look.shellLance || !s.body || view.level === 'system') continue;
      this.visibleTip(s, ahead);
      ray.from = s.pos;
      ray.to = ahead;
      ray.kind = BEAM.DRILL;
      ray.width = 1.2;
      ray.color = linear('ash');
      ray.gain = 0.9;
      this.buffers.beams.add(ray);
    }
    if (view.level !== 'system') {
      let shown = 0;
      for (const s of this.order) {
        if (shown >= 8) break;
        if (!s.drawn || !s.body || s.departing || s.landing || s.c.role !== 'vessel') continue;
        if (s.c.state !== 'writing' && s.c.state !== 'thinking' && s.c.state !== 'generating') continue;
        if (view.level === 'craft' && s.c.id !== view.selected) continue;
        this.impact(s, ahead);
        ray.from = s.pos; ray.to = ahead; ray.kind = BEAM.TIGHT; ray.width = 0.65;
        ray.color = linear('oiii'); ray.gain = 0.2; ray.birth = ray.life = 0;
        this.buffers.beams.add(ray);
        const phase = this.reduced ? 0.5 : (clock.kernel * 0.00065 + (hash32(s.c.id) % 100) / 100) % 1;
        here.copy(s.pos).lerp(ahead, phase);
        this.sprite(here, KIND.BEAD, 1.6, 'oiii', 1.8, 1);
        shown += 1;
      }
    }
  }

  private drawFx(clock: FleetClock): boolean {
    const { hulls } = this.buffers;
    let busy = false;
    for (const f of this.fx) {
      if (!f.on) continue;
      if (clock.wall < f.at) { busy = true; continue; }
      const k = (clock.wall - f.at) / f.life;
      if (k >= 1) {
        f.on = false;
        if (f.kind === 'fall') this.landed(f, clock.wall);
        continue;
      }
      if (f.kind !== 'ember') busy = true;
      switch (f.kind) {
        case 'flare': case 'ember':
          mark.position = f.c;
          mark.heading = 0;
          mark.size = f.size * this.craftK * (f.kind === 'flare' ? 1 + k : 1);
          mark.color = linear(f.tone);
          mark.gain = f.gain * (f.kind === 'flare' ? (1 - k) * (1 - k) : 1 - k);
          mark.kind = KIND.BEAD;
          mark.fill = 1;
          mark.progress = mark.dashes = 0;
          hulls.add(mark);
          break;
        case 'fall': this.drawFall(f, k); break;
        case 'streak': this.drawStreak(f, k); break;
        case 'line': this.drawLine(f, k); break;
        default:
      }
    }
    return busy;
  }

  private drawFall(f: Fx, k: number): void {
    const u = ease.reentry(k);
    const q = Math.PI / 2;
    arc.center = f.c;
    arc.a = f.a;
    arc.b = f.b;
    arc.start = Math.max(0, u - 0.4) * q;
    arc.sweep = (u - Math.max(0, u - 0.4)) * q;
    arc.color = linear(f.tone);
    arc.gain = f.hard ? 6 : 5;
    arc.width = 2;
    arc.taper = 1;
    arc.dashCycles = 0;
    arc.dashFlow = 0;
    arc.birth = arc.life = 0;
    this.buffers.plumes.add(arc);
    here.copy(f.c).addScaledVector(f.a, Math.cos(u * q)).addScaledVector(f.b, Math.sin(u * q));
    if (f.from) {
      f.from.pos.copy(here);
      scratchA.copy(f.a).multiplyScalar(-Math.sin(u * q)).addScaledVector(f.b, Math.cos(u * q)).normalize();
      scratchB.copy(here).sub(f.from.body?.position ?? STAR).normalize();
      shipFrame(scratchA, scratchB, 0, 0, f.from.ship.quaternion);
    }
    mark.position = here;
    mark.heading = 0;
    mark.size = 3 * this.craftK;
    mark.color = linear(f.tone);
    mark.gain = 4;
    mark.kind = KIND.BEAD;
    mark.fill = 1;
    mark.progress = mark.dashes = 0;
    this.buffers.hulls.add(mark);
  }

  /** The city light itself comes with the digest, a moment later. Until then the landing keeps its own light on. */
  private landed(f: Fx, wall: number): void {
    here.copy(f.c).add(f.b);
    const flare = this.spawnFx('flare', wall, FLARE_MS * 1.5);
    flare.c.copy(here);
    flare.tone = f.hard ? 'halpha' : 'nad';
    flare.gain = 7;
    flare.size = 4;
    const glow = this.spawnFx('ember', wall, f.hard ? EMBER_MS : CITY_HOLD_MS);
    glow.c.copy(here);
    glow.tone = f.hard ? 'halpha' : 'lamp';
    glow.gain = f.hard ? 2.4 : 3;
    glow.size = 2.2;
  }

  private drawStreak(f: Fx, k: number): void {
    const from = f.from;
    const to = f.to;
    if (!from || !to) return;
    // A centre behind the world carries the streak over it, as in the stills.
    scratchC.copy(from.pos).add(to.pos).multiplyScalar(0.5);
    scratchA.copy(toCam).sub(scratchC).normalize().multiplyScalar(-1.2 * Math.max(8, from.pos.distanceTo(to.pos)));
    scratchC.add(scratchA);
    scratchA.copy(from.pos).sub(scratchC);
    scratchB.copy(to.pos).sub(scratchC);
    arc.center = scratchC;
    arc.a = scratchA;
    arc.b = scratchB;
    const u = ease.ignite(k);
    arc.start = Math.max(0, u - 0.35) * (Math.PI / 2);
    arc.sweep = (u - Math.max(0, u - 0.35)) * (Math.PI / 2);
    arc.color = linear(f.tone);
    arc.gain = f.gain * (1 - k * k);
    arc.width = 2;
    arc.taper = 1;
    arc.dashCycles = 0;
    arc.dashFlow = 0;
    arc.birth = arc.life = 0;
    this.buffers.wakes.add(arc);
  }

  private drawLine(f: Fx, k: number): void {
    if (!f.from || !f.to) return;
    ray.from = f.from.pos;
    ray.to = f.to.pos;
    ray.kind = BEAM.TIGHT;
    ray.width = 1;
    ray.color = linear(f.tone);
    ray.gain = f.gain * (1 - k);
    ray.birth = ray.life = 0;
    this.buffers.beams.add(ray);
  }
}

const matrix = new THREE.Matrix4();
const scratchD = new THREE.Vector3();
const scratchE = new THREE.Vector3();
const camRight = new THREE.Vector3();
const camUp = new THREE.Vector3();
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const spotOut = { x: 0, y: 0 };
const plumeOut: PlumeStyle = { length: 0, width: 0, gain: 0, dashes: 0, flow: 0 };
const CLEAR = crowdDim(0);
/** Here and not an argument: a double passed to a call that is not inlined gets boxed, and this one runs five times a craft. */
const lens = { focal: 0.5 };
const projected = { x: 0, y: 0, front: false, k: 0 };
const projectedB = { x: 0, y: 0, front: false, k: 0 };
const PAD_BODY: FleetBody = { worldId: '', position: new THREE.Vector3(), radius: 1, rCss: 1, a: new THREE.Vector3(1, 0, 0), b: new THREE.Vector3(0, 0, 1), perUnit: 1 };

/** CSS px from the centre of the free rect, y down. Written out, because a Vector3.project per craft per frame adds up. */
function project(p: V3, vp: THREE.Matrix4, free: { w: number; h: number }, out: { x: number; y: number; front: boolean; k: number }): void {
  const e = vp.elements;
  const w = e[3]! * p.x + e[7]! * p.y + e[11]! * p.z + e[15]!;
  const x = (e[0]! * p.x + e[4]! * p.y + e[8]! * p.z + e[12]!) / w;
  const y = (e[1]! * p.x + e[5]! * p.y + e[9]! * p.z + e[13]!) / w;
  out.x = (x * free.w) / 2;
  out.y = (-y * free.h) / 2;
  out.front = w > 0 && Math.abs(x) < 1.15 && Math.abs(y) < 1.15;
  out.k = lens.focal / Math.max(1e-3, w);
}
