// The system in real 3D, INTERSTELLAR 21. Pure, shared by the scene, the Plate and tests. The disk lies in the XZ plane around the origin
// and nothing here knows a window: a world stands where it stands at any size of the free rect, and only the Home distance fits the frame.
// The hole is the centre and the repos are the point: the user wants the worlds in the foreground, so the heaviest is about as big as the
// shadow and the orbits fill the frame around a disk that no longer does. One world unit is about 0.67 CSS px at the hole at Home in a 748 px
// wide free rect, and craft orbits are in the same units.
import { bandOf } from './layout.ts';

export type Vec3 = readonly [number, number, number];
type Mut3 = [number, number, number];

const DEG = Math.PI / 180;
const GOLDEN = 137.508;

/** Radius of the shadow, world units. It is sqrt(27) M, and the disk ends at 18 M. Nothing else orbits inside that. */
export const HOLE_RADIUS = 64;
export const DISK_OUTER = (HOLE_RADIUS * 18) / Math.sqrt(27);
/** Where worlds orbit, by recency. Recent worlds sit close to the fire. The disk's last light reaches 24 M, so the first band starts past it. */
export const BAND_RADII = [360, 450, 540] as const;
/** Each band is this wide, and a world takes its own lane inside it, so orbits do not stack. */
const BAND_WIDTH = 90;
export const BELT_RADIUS = 700;
export const BELT_WIDTH = 60;
/** The ring where held craft wait, just past the disk. */
export const PAD_RADIUS = DISK_OUTER * 1.08;
/** The heaviest repo is about as big as the shadow, the lightest still a third of it. */
export const WORLD_R_MIN = 22;
export const WORLD_R_MAX = 56;
/** A rock of the Belt that holds a live session. Smaller than any world, because a sandbox is not a place. */
export const BELT_ROCK_R = 6;
/** Least gap between two worlds, world units. */
const WORLD_GAP = 14;
/** Least gap between two worlds at Home, units at the hole. */
const HOME_GAP = 12;
const DR_STEPS = [0, 34, -34, 68, -68, 102, -102] as const;
const AZ_STEP = 5;
/** Two orbits try to stay this far apart. */
const LANE_GAP = 16;
const DENSITY = 0.1;

/** The axis the camera turns around. It leans off the disk's normal, so the disk crosses the Home frame on a slant and the camera never has to roll. */
const LEAN = -15 * DEG;
export const UP: Vec3 = [-Math.sin(LEAN), Math.cos(LEAN), 0];
export const SIDE: Vec3 = [Math.cos(LEAN), Math.sin(LEAN), 0];
export const FRONT: Vec3 = [0, 0, 1];

/** A long lens, so the front of the system does not swell and the disk keeps the thin line of the reference. */
export const HOME = { az: 0.17, el: 22 * DEG, fov: 26 } as const;
/** What the Home frame holds at the depth of the hole, half width and half height in world units. Width is what sizes the hole against the frame. */
const HOME_FRAME = { w: 560, h: 400 } as const;
/** Worlds stay this far inside that frame. */
const HOME_MARGIN = 0.92;
/** The widest and the narrowest free rect: a world has to be clear in both, because the camera stands farther off in the narrow one. */
const HOME_RECTS = [{ w: 1840, h: 1344 }, { w: 748, h: 720 }] as const;
/** Largest a world may look at Home, against the shadow's radius. Near the lens a world swells, and it must not outgrow the centre. */
const SEEN_MAX = 1.1;

export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale3 = (a: Vec3, k: number): Mut3 => [a[0] * k, a[1] * k, a[2] * k];
const add3 = (a: Vec3, b: Vec3): Mut3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** Where a camera stands around its focus. Elevation is measured from the plane under `UP`, plus or minus 90 degrees are the poles. */
export interface Orbit { az: number; el: number; dist: number }

/** Camera right, up and back. Right comes from the azimuth alone, which is why a pole holds no singularity and the view never flips. */
export function orbitBasis(az: number, el: number): { right: Mut3; up: Mut3; back: Mut3 } {
  const ca = Math.cos(az);
  const sa = Math.sin(az);
  const ce = Math.cos(el);
  const se = Math.sin(el);
  const flat: Vec3 = [FRONT[0] * ca + SIDE[0] * sa, FRONT[1] * ca + SIDE[1] * sa, FRONT[2] * ca + SIDE[2] * sa];
  const right: Mut3 = [SIDE[0] * ca - FRONT[0] * sa, SIDE[1] * ca - FRONT[1] * sa, SIDE[2] * ca - FRONT[2] * sa];
  const back: Mut3 = [UP[0] * se + flat[0] * ce, UP[1] * se + flat[1] * ce, UP[2] * se + flat[2] * ce];
  const up: Mut3 = [UP[0] * ce - flat[0] * se, UP[1] * ce - flat[1] * se, UP[2] * ce - flat[2] * se];
  return { right, up, back };
}

/** The orbit that puts a camera at `position` around `focus`. */
export function orbitOf(position: Vec3, focus: Vec3): Orbit {
  const v: Vec3 = [position[0] - focus[0], position[1] - focus[1], position[2] - focus[2]];
  const dist = Math.hypot(v[0], v[1], v[2]) || 1;
  return { az: Math.atan2(dot(v, SIDE), dot(v, FRONT)), el: Math.asin(Math.max(-1, Math.min(1, dot(v, UP) / dist))), dist };
}

/** Far enough that the Home frame fits the free rect at this lens: wide enough for the disk and its worlds, tall enough for the worlds above and below it. */
export function homeDistance(free: { w: number; h: number }, fov: number = HOME.fov): number {
  return Math.max(HOME_FRAME.w / (free.w / free.h), HOME_FRAME.h) / Math.tan((fov * DEG) / 2);
}

export const homeOrbit = (free: { w: number; h: number }): Orbit => ({ az: HOME.az, el: HOME.el, dist: homeDistance(free) });

/** A pure pinhole, so the Plate and the layout can read the Home view with no WebGL. */
export interface Lens { position: Vec3; right: Vec3; up: Vec3; back: Vec3; focal: number }

export function lensOf(o: Orbit, focus: Vec3, fov: number, freeH: number): Lens {
  const { right, up, back } = orbitBasis(o.az, o.el);
  return { position: add3(focus, scale3(back, o.dist)), right, up, back, focal: freeH / 2 / Math.tan((fov * DEG) / 2) };
}

export interface Seen { x: number; y: number; /** CSS px per world unit at this depth. */ scale: number; depth: number }

/** CSS px from the centre of the frame, y down. */
export function see(l: Lens, p: Vec3): Seen {
  const v: Vec3 = [p[0] - l.position[0], p[1] - l.position[1], p[2] - l.position[2]];
  const depth = -dot(v, l.back);
  const scale = l.focal / Math.max(1e-3, depth);
  return { x: dot(v, l.right) * scale, y: -dot(v, l.up) * scale, scale, depth };
}

export const homeLens = (free: { w: number; h: number }): Lens => lensOf(homeOrbit(free), [0, 0, 0], HOME.fov, free.h);

/** Law 1 in units that suit a perspective view. Log of mass, because two stores hold 95 % of the bytes here. */
export const planetRadius = (mass: number, massMax: number): number =>
  (massMax <= 0 ? WORLD_R_MIN : WORLD_R_MIN + ((WORLD_R_MAX - WORLD_R_MIN) * Math.log10(1 + mass)) / Math.log10(1 + massMax));

/** How far a world's craft reach, so two worlds keep their orbits apart. Same shape as `orbitCss` at altitude 1. */
export const haloOf = (r: number): number => r + 14 + Math.min(66, Math.max(34, 1.3 * r));

export interface SpaceSeed {
  /** Stable name of the row, a world id in the app. */
  key: string;
  /** Slot from 0, persisted, never reassigned. A rock of the Belt holds none and counts in its own row. */
  slot: number;
  mass: number;
  ageDays: number;
  belt?: boolean;
}

export interface OrbitRing { radius: number; /** Unit vectors spanning the orbit, world space. */ u: Vec3; v: Vec3 }

export interface WorldSpot {
  key: string;
  slot: number;
  belt: boolean;
  band: 0 | 1 | 2;
  position: Vec3;
  radius: number;
  ring: OrbitRing;
}

function ringOf(radius: number, inclDeg: number, nodeDeg: number): OrbitRing {
  const i = inclDeg * DEG;
  const n = nodeDeg * DEG;
  return { radius, u: [Math.cos(n), 0, Math.sin(n)], v: [-Math.sin(n) * Math.cos(i), Math.sin(i), Math.cos(n) * Math.cos(i)] };
}

const onRing = (ring: OrbitRing, phase: number): Vec3 => add3(scale3(ring.u, Math.cos(phase) * ring.radius), scale3(ring.v, Math.sin(phase) * ring.radius));

/** Slight, and never the same twice in a row, so the worlds stay apart when the disk is seen edge on. */
export const inclinationOf = (slot: number): number => 2 + ((slot * 3) % 7) * 0.8;
const nodeOf = (slot: number): number => (slot * 83 + 20) % 360;

/** Where a world's orbit lies inside its band. The golden ratio keeps every prefix of lanes spread. */
const laneOf = (slot: number, band: 0 | 1 | 2): number => BAND_RADII[band] + BAND_WIDTH * ((slot * 0.618034) % 1 - 0.5);

interface HomeRoom { room: number; x: number; y: number; r: number }

/** The two Home views, with the disk's rim in units at the hole. A constant: placing a world measures against it hundreds of times. */
const homeViews = HOME_RECTS.map((rect) => {
  const lens = homeLens(rect);
  const unit = see(lens, [0, 0, 0]).scale;
  const rim = Array.from({ length: 28 }, (_, i) => {
    const e = see(lens, [Math.cos((i / 28) * Math.PI * 2) * DISK_OUTER, 0, Math.sin((i / 28) * Math.PI * 2) * DISK_OUTER]);
    return { x: e.x / unit, y: e.y / unit };
  });
  return { lens, unit, rim };
});

/** How a place sits at Home in one window, in units at the hole. Below 0 it breaks the composition. */
function homeRoom(view: (typeof homeViews)[number], p: Vec3, r: number): HomeRoom {
  const seen = see(view.lens, p);
  const x = seen.x / view.unit;
  const y = seen.y / view.unit;
  const rr = (r * seen.scale) / view.unit;
  // The hole keeps its own room, bent light included, the frame holds the whole body, and nothing near the lens swells to rival the shadow.
  let room = Math.min(Math.hypot(x, y) - HOLE_RADIUS * 1.75 - rr, HOME_FRAME.w * HOME_MARGIN - Math.abs(x) - rr, HOME_FRAME.h * HOME_MARGIN - Math.abs(y) - rr, HOLE_RADIUS * SEEN_MAX - rr);
  // Worlds stand beside the disk, not on it: at Home the disk is the brightest thing there is.
  for (const e of view.rim) room = Math.min(room, Math.hypot(e.x - x, e.y - y) - rr - 8);
  return { room, x, y, r: rr };
}

interface Placed extends WorldSpot { seen: HomeRoom[] }

/**
 * Azimuth comes from the slot by the golden angle, so a world stays where you remember it and every prefix is well spread. The band follows
 * recency, and inside it each world takes its own lane. Lower slots win: a new world never pushes an old one. Clear means three things: two
 * bodies never touch in space, at Home no two discs overlap, and at Home every world stands in the frame and off the disk, because Home is
 * the poster. Orbits try to stay apart as well, and give way first. If the worlds cannot fit, all shrink.
 */
export function placeSpace(seeds: readonly SpaceSeed[]): WorldSpot[] {
  // The model is rebuilt four times a second, and it almost never moves a world.
  const key = seeds.map((s) => `${s.key}|${s.slot}|${s.mass}|${bandOf(s.ageDays)}|${s.belt ? 1 : 0}`).sort().join();
  if (key !== placedKey) { placedKey = key; placedSpots = solveSpace(seeds); }
  return placedSpots;
}

let placedKey = '\0';
let placedSpots: WorldSpot[] = [];

function solveSpace(seeds: readonly SpaceSeed[]): WorldSpot[] {
  const worlds = seeds.filter((s) => !s.belt);
  const massMax = worlds.reduce((a, s) => Math.max(a, s.mass), 0);
  const field = 4 * HOME_FRAME.w * HOME_FRAME.h;
  const want = worlds.reduce((a, s) => a + Math.PI * (planetRadius(s.mass, massMax) + WORLD_GAP / 2) ** 2, 0);
  const shrink = Math.min(1, Math.sqrt((DENSITY * field) / Math.max(1, want)));
  const placed: Placed[] = [];
  const inner = (DISK_OUTER * 4) / 3;
  const outer = BAND_RADII[2] + BAND_WIDTH / 2;

  for (const s of [...worlds].sort((a, b) => a.slot - b.slot)) {
    const r = Math.max(12, planetRadius(s.mass, massMax) * shrink);
    const band = bandOf(s.ageDays);
    const base = 28 + s.slot * GOLDEN;
    const lane = laneOf(s.slot, band);
    const incl = inclinationOf(s.slot);
    const node = nodeOf(s.slot);
    let best: Placed | null = null;
    let bestScore = -Infinity;
    search: for (let i = 0; i * AZ_STEP <= 180; i++) {
      for (const sign of i === 0 ? [1] : [1, -1]) {
        const azimuth = base + sign * i * AZ_STEP;
        for (const dr of DR_STEPS) {
          const ring = ringOf(Math.max(inner + r, Math.min(outer, lane + dr)), incl, node);
          const position = onRing(ring, (azimuth - node) * DEG);
          const views = homeViews.map((v) => homeRoom(v, position, r));
          let hard = Math.min(...views.map((v) => v.room));
          let soft = Infinity;
          for (const q of placed) {
            const gap = Math.hypot(q.position[0] - position[0], q.position[1] - position[1], q.position[2] - position[2]);
            hard = Math.min(hard, gap - q.radius - r - WORLD_GAP);
            views.forEach((v, n) => { const o = q.seen[n]!; hard = Math.min(hard, Math.hypot(o.x - v.x, o.y - v.y) - o.r - v.r - HOME_GAP); });
            soft = Math.min(soft, gap - haloOf(q.radius) - haloOf(r), (Math.abs(q.ring.radius - ring.radius) - LANE_GAP) * 3);
          }
          const score = hard < 0 ? hard - 1e4 : Math.min(hard, soft / 3);
          if (score > bestScore) { bestScore = score; best = { key: s.key, slot: s.slot, belt: false, band, position, radius: r, ring, seen: views }; }
          if (score >= 0) break search;
        }
      }
    }
    placed.push(best!);
  }

  const out: WorldSpot[] = placed.map(({ seen: _seen, ...spot }) => spot);
  seeds.filter((s) => s.belt).sort((a, b) => a.slot - b.slot || (a.key < b.key ? -1 : 1)).forEach((s, i) => {
    const ring = ringOf(BELT_RADIUS + 20 * Math.sin(i * 2.3), 1.2, 40);
    out.push({ key: s.key, slot: s.slot, belt: true, band: 2, position: onRing(ring, ((70 + i * GOLDEN) * DEG)), radius: BELT_ROCK_R, ring });
  });
  return out;
}

/** The axis a world turns around, unit, from its slot. A planet's genome overrides this once it has one. */
export function spinAxis(slot: number): Vec3 {
  const tilt = (6 + ((slot * 41) % 23)) * DEG;
  const dir = (slot * 137.5 + 15) * DEG;
  return [Math.sin(tilt) * Math.cos(dir), Math.cos(tilt), Math.sin(tilt) * Math.sin(dir)];
}

const TAU = Math.PI * 2;
/** Physics never stops while the window shows: a quiet world turns in four minutes. */
const SPIN_REST = TAU / 240;
const SPIN_BUSY = TAU / 120;

/** Radians a second, from a world's load, 0..1. Rotation means something: the busier the world, the faster it turns. */
export const spinRate = (load: number): number => SPIN_REST + (SPIN_BUSY - SPIN_REST) * Math.max(0, Math.min(1, load));

/** Moons orbit in about three minutes, the near ones faster. */
export const moonRate = (index: number): number => (TAU / 170) * (1 - 0.14 * Math.min(4, index));
export const moonReach = (radius: number, index: number): number => radius * (1.9 + 0.42 * index);
export const moonRadius = (radius: number): number => Math.max(3, 0.16 * radius);

/**
 * World level. The camera stands off to the side of the world, so its lit face shows as a broad crescent and the hole's light comes in from the
 * edge of the frame. High enough to look down into the orbits: from lower they close into one line, and every craft and label lands on it.
 */
export function worldOrbit(position: Vec3, dist: number): Orbit {
  const az = Math.atan2(dot(position, SIDE), dot(position, FRONT));
  return { az: az + 160 * DEG, el: 25 * DEG, dist };
}
