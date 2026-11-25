// The fleet of the reference renders: 7 worlds, 13 vessels, 7 beads, placeholder data, drawn by the real engine. The bench writes a roster
// by hand, the app gets one from the store, and everything past that point is the same code. S60 and S120 add craft on the same worlds.
import * as THREE from 'three';
import { orbitCss, thetaE } from '../core/laws.ts';
import type { Rect } from '../core/layout.ts';
import { orbitPlane, planeOf } from '../core/orbit.ts';
import { homeLens, placeSpace, see, type Seen } from '../core/space.ts';
import type { VisualState } from '../core/state.ts';
import { FleetEngine, type FleetBody } from '../scene/fleet.ts';
import { ArcBuffer, BeamBuffer, CityBuffer, HullBuffer, WorldBuffer } from '../scene/layers/buffers.ts';
import type { Roster, RosterCraft } from '../scene/roster.ts';
import type { SceneState } from '../scene/state.ts';
import { linear } from '../scene/tokens.ts';

const DEG = Math.PI / 180;
const REFERENCE_WORLDS = [
  { mb: 874, files: 492, last: 0.1 }, { mb: 88, files: 175, last: 0.1 }, { mb: 1154, files: 1418, last: 0.1 }, { mb: 18.5, files: 8, last: 0.1 },
  { mb: 3.2, files: 76, last: 0.1 }, { mb: 1.4, files: 1, last: 4 }, { mb: 0.2, files: 3, last: 19 },
] as const;
const LOADS = [0.85, 0.3, 0.7, 0.42, 0.15] as const;

interface CraftSeed { world: number; state: VisualState; alt: number; th: number; rate?: number; owned?: boolean; beam?: boolean; age?: number }

const REFERENCE_CRAFT: readonly CraftSeed[] = [
  { world: 0, state: 'writing', alt: 0.78, th: 0.6, rate: 0.9 }, { world: 0, state: 'thinking', alt: 0.45, th: 3.4, rate: 0.5 },
  { world: 0, state: 'tool', alt: 0.24, th: 5, beam: true }, { world: 0, state: 'approve', alt: 0.62, th: 2.2, age: 41 },
  { world: 1, state: 'generating', alt: 0.72, th: 1.2, owned: false }, { world: 1, state: 'tool', alt: 0.45, th: 3.9, owned: false }, { world: 1, state: 'idle', alt: 0.2, th: 5.6, owned: false },
  { world: 2, state: 'writing', alt: 0.8, th: 1.1, rate: 0.8 },
  { world: 3, state: 'writing', alt: 0.8, th: 0.4, rate: 0.7 }, { world: 3, state: 'errored', alt: 0.5, th: 2.6 }, { world: 3, state: 'retrying', alt: 0.25, th: 4.7 },
  { world: 4, state: 'source', alt: 0.6, th: 5.4, owned: false }, { world: 4, state: 'generating', alt: 0.3, th: 2, owned: false },
];

const BEADS: ReadonlyArray<readonly [number, VisualState]> = [
  [0, 'finished'], [0, 'finished'], [0, 'failed'], [1, 'generating'], [1, 'generating'], [1, 'tool'], [1, 'generating'],
];
const HOOPS = [{ incl: 62, node: 20, rad: 1.5 }, { incl: -48, node: 110, rad: 1.72 }] as const;

interface World extends FleetBody { seen: Seen }

const vectors = (p: { a: readonly number[]; b: readonly number[] }) => ({ a: new THREE.Vector3().fromArray(p.a), b: new THREE.Vector3().fromArray(p.b) });

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

const gaussian = (r: () => number) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * (1 - r()));

export interface FleetOptions {
  free: Rect;
  craftK: number;
  camera: THREE.PerspectiveCamera;
  /** False leaves only worlds, cities and long exposures: the idle sky of S0. */
  active: boolean;
  /** Extra craft past the reference 13. S60 uses 40. */
  extraCraft?: number;
  /** Total wells. The first is the reference one, the rest ride on extra craft. */
  wells?: number;
  /** Streaks in flight, 0 for none. */
  streaks?: number;
}

const craftRow = (id: string, s: CraftSeed, worldId: string): RosterCraft => ({
  id, worldId, role: 'vessel', parentId: null, order: 0, depth: 0, owned: s.owned ?? true, state: s.state, altitude: s.alt, tps: 40 + 300 * (s.rate ?? 0.6), tokens: 0,
  tier: s.state === 'approve' ? 1 : s.state === 'source' ? 2 : s.state === 'errored' || s.state === 'retrying' ? 3 : 6, danger: false, since: 0,
  tools: s.beam ? [{ id: `${id}-t`, family: 'edit', toStar: false, startedAt: 0 }] : [],
  countdown: s.state === 'retrying' ? { from: 0, to: 9000 } : null, fuel: null, queued: 0, moon: null, acked: false, workflow: null, pad: null,
});

export class Fleet {
  readonly worlds = new WorldBuffer(64);
  readonly cities = new CityBuffer(8192);
  readonly arcs24 = new ArcBuffer(512, 24);
  readonly arcs48 = new ArcBuffer(1024, 48);
  readonly arcs96 = new ArcBuffer(512, 96);
  readonly wakes = new ArcBuffer(1024, 48);
  readonly rings = new ArcBuffer(512, 96);
  readonly hulls = new HullBuffer(1024);
  readonly beams = new BeamBuffer(64);
  readonly uWorld = new Float32Array(32 * 4);
  private readonly bodies: World[] = [];
  private readonly camera: THREE.PerspectiveCamera;
  private readonly free: Rect;
  private readonly engine: FleetEngine;
  private readonly wellIds: string[] = [];
  private readonly wellAges: number[] = [];
  private readonly streakArcs: number[] = [];
  private kernel = 1;
  private scene = 0;
  readonly streams: { azimuth: number; load: number }[] = [];
  readonly craftCount: number;

  constructor(o: FleetOptions) {
    this.camera = o.camera;
    this.free = o.free;
    const seeds = REFERENCE_WORLDS.map((w, slot) => ({ key: `w${slot}`, slot, mass: w.mb, ageDays: w.last }));
    const lens = homeLens(o.free);
    const random = rng(99);

    placeSpace(seeds).forEach((spot, k) => {
      const position = new THREE.Vector3().fromArray(spot.position);
      const seen = see(lens, spot.position);
      const { a, b } = vectors(orbitPlane(k));
      this.bodies.push({ worldId: `w${k}`, seen, position, radius: spot.radius, rCss: spot.radius, a, b, perUnit: 1 });
      this.worlds.add(position, spot.radius);
      this.uWorld.set([position.x, position.y, position.z, spot.radius], k * 4);
      if (k < LOADS.length) this.streams.push({ azimuth: Math.atan2(-seen.y, seen.x), load: LOADS[k]! });
    });

    this.engine = new FleetEngine({ plumes: this.arcs24, wakes: this.wakes, rings: this.rings, hulls: this.hulls, beams: this.beams }, (id) => this.bodies[Number(id.slice(1))]);
    this.buildCities(random);
    this.buildExposures(o.craftK, o.active ? 0.05 : 0.11);

    const seedsOf: Array<[string, CraftSeed]> = [];
    if (o.active) {
      REFERENCE_CRAFT.forEach((seed, i) => seedsOf.push([`c${i}`, seed]));
      const extra = rng(1234);
      const states: VisualState[] = ['writing', 'thinking', 'generating', 'tool'];
      for (let i = 0; i < (o.extraCraft ?? 0); i++) {
        const isWell = i < (o.wells ?? 1) - 1;
        seedsOf.push([`x${i}`, { world: Math.floor(extra() * 5), state: isWell ? 'approve' : states[i % 4]!, alt: 0.15 + extra() * 0.8, th: extra() * 6.283, rate: extra(), owned: i % 3 !== 0 || isWell, age: 20 + extra() * 200 }]);
      }
    }
    const crafts = seedsOf.map(([id, seed]) => craftRow(id, seed, `w${seed.world}`));
    const hoops: Roster['hoops'] = [];
    if (o.active) {
      hoops.push({ worldId: 'w2', runId: 'r', index: 0, status: 'running' }, { worldId: 'w2', runId: 'r', index: 1, status: 'running' });
      BEADS.forEach(([phase, state], i) => crafts.push({ ...craftRow(`b${i}`, { world: 2, state, alt: 0, th: 0, owned: false }, 'w2'), role: 'bead', parentId: 'c7', workflow: { runId: 'r', phase, attempt: 1 } }));
    }
    this.engine.setRoster({ crafts, hoops }, { level: 'system', worldId: null, selected: null }, { free: o.free, craftK: o.craftK, discR: 0.082 * Math.min(o.free.w, o.free.h), reduced: false, cut: true }, this.kernel);
    for (const [id, seed] of seedsOf) {
      this.engine.setAngle(id, seed.th);
      if (seed.state === 'approve') { this.wellIds.push(id); this.wellAges.push(seed.age ?? 41); }
    }
    this.arrange(0);
    for (let i = 0; i < (o.streaks ?? 0); i++) this.addStreak(i, o.streaks ?? 0);
    this.craftCount = crafts.length;
  }

  private buildCities(r: () => number): void {
    for (let k = 0; k < this.bodies.length; k++) {
      const n = Math.min(4200, REFERENCE_WORLDS[k]!.files);
      const clusters = Array.from({ length: Math.max(5, Math.round(9 + 2.4 * Math.log2(1 + n))) }, () => {
        const z = r() * 2 - 1;
        const t = r() * 6.283;
        const s = Math.sqrt(1 - z * z);
        return { c: new THREE.Vector3(s * Math.cos(t), s * Math.sin(t), z), w: r() ** 1.5 + 0.08, sp: 0.05 + r() * 0.17 };
      });
      const total = clusters.reduce((a, c) => a + c.w, 0);
      for (let i = 0; i < n; i++) {
        let pick = r() * total;
        let cluster = clusters[0]!;
        for (const c of clusters) { pick -= c.w; if (pick <= 0) { cluster = c; break; } }
        const d = cluster.c.clone().add(new THREE.Vector3(gaussian(r), gaussian(r), gaussian(r)).multiplyScalar(cluster.sp)).normalize();
        this.cities.add(d.x, d.y, d.z, k, r() < 0.05);
      }
    }
  }

  private buildExposures(craftK: number, gain: number): void {
    const r = rng(777);
    const city = linear('city');
    ([[0, 18], [1, 7], [2, 16], [3, 3], [4, 5]] as const).forEach(([index, n]) => {
      const w = this.bodies[index]!;
      for (let i = 0; i < n; i++) {
        const radius = orbitCss(w.rCss, r(), craftK) / w.perUnit;
        this.arcs48.add({
          center: w.position, a: w.a.clone().multiplyScalar(radius), b: w.b.clone().multiplyScalar(radius),
          start: r() * 6.28, sweep: 0.8 + r() * 3.6, color: city, gain, width: 0.6, taper: 1,
        });
      }
    });
  }

  private addStreak(i: number, total: number): void {
    const w = this.bodies[2]!;
    const from = new THREE.Vector3();
    if (!this.engine.positionOf('c7', from)) return;
    const hoop = HOOPS[1];
    const { a, b } = vectors(planeOf(hoop.incl * DEG, hoop.node * DEG));
    const th = (i / total) * Math.PI * 2 + 0.4;
    const to = w.position.clone().addScaledVector(a, w.radius * hoop.rad * Math.cos(th)).addScaledVector(b, w.radius * hoop.rad * Math.sin(th));
    // An arc through a and b bows away from its centre, so a centre behind the world carries the streak over the sphere.
    const toCamera = this.camera.position.clone().sub(w.position).normalize();
    const mid = from.clone().add(to).multiplyScalar(0.5).addScaledVector(toCamera, -2.6 * w.radius);
    this.streakArcs.push(this.arcs48.add({
      center: mid, a: from.clone().sub(mid), b: to.clone().sub(mid), start: 0, sweep: Math.PI / 2,
      color: linear('pearl'), gain: 6, width: 2, taper: 1, birth: -1, life: 0.42,
    }));
  }

  /** Launches the salvo: one streak per agent, 48 ms apart. */
  fireStreaks(now: number): void {
    this.streakArcs.forEach((arc, i) => this.arcs48.setLife(arc, now + i * 0.048, 0.42));
    this.arcs48.commit();
  }

  /** Moves craft by `dt` seconds. This is the per-frame write of a real fleet, through the real engine. */
  arrange(dt: number): void {
    this.kernel += dt * 1000;
    this.scene += dt;
    this.engine.draw({ wall: performance.now(), kernel: this.kernel, dt, scene: this.scene }, this.camera);
    this.arcs48.commit();
    this.arcs96.commit();
  }

  /** The wells of every craft that is waiting, written for the lens. Newest first is the rule, age order here is close enough. */
  writeWells(state: SceneState, multiplier: number): void {
    state.wells.length = 0;
    for (let i = 0; i < Math.min(8, this.wellIds.length); i++) {
      const position = new THREE.Vector3();
      this.engine.positionOf(this.wellIds[i]!, position);
      state.wells.push({ position, thetaCss: thetaE(this.wellAges[i]!, this.free.h) * multiplier, ring: 0 });
    }
  }

  writeStreams(state: SceneState, flare = -1): void {
    this.streams.forEach((s, i) => {
      state.streams[i * 2] = s.azimuth;
      state.streams[i * 2 + 1] = Math.min(1.3, s.load + (i === flare ? 0.9 : 0));
    });
    state.streamCount = this.streams.length;
  }

  wellPosition(out: THREE.Vector3): THREE.Vector3 {
    const id = this.wellIds[0];
    if (!id || !this.engine.positionOf(id, out)) out.set(0, 0, 0);
    return out;
  }
}
