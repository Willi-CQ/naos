// All the planets of a scene. This is the whole surface the rest of the app needs: add a world, say which one is in focus, call update once a
// frame. Textures come and go by what is on screen, and a designer's new genome arrives as an event, not as a pop.
import { archetypeDefaults, planetSeed, type PlanetGenome } from '@naos/protocol';
import * as THREE from 'three';
import { Baker } from './bake.ts';
import { PlanetBody, type PlanetBodyOptions, type PlanetFrame } from './body.ts';
import { isFluid } from './params.ts';
import { REGION_ALTITUDE } from './region-plan.ts';
import type { PlanetCity } from './tables.ts';

/** Enough for a 90 px planet. Every world has this from its first second. */
export const SYSTEM_SIZE = 128;
/** One texel to about a pixel at 700 CSS px and DPR 1.5. */
export const WORLD_SIZE = 1024;
/** Close-ups kept at once: the focus, and the one just left so that going back is instant. */
const CLOSE_LIMIT = 2;
const REVEAL_SECONDS = 2.4;
const BOOT_BUDGET_MS = 6;
/** Device px of radius past which a System bake starts to show. A wheel zoom is no flight, and nobody calls focus for it, so size alone asks. */
const SHARPEN_PX = 80;

const view = new THREE.Matrix4();

export type PlanetFocus = 'system' | 'world' | 'craft';

interface Entry { id: string; body: PlanetBody; leaving: PlanetBody | null; close: boolean }

export interface PlanetFleetStats { planets: number; bytes: number; baking: boolean; closeUps: number }

export class PlanetFleet {
  readonly baker: Baker;
  readonly group = new THREE.Group();
  /** Set from the tier, at Penumbra a close-up can stay at the System bake. */
  worldSize = WORLD_SIZE;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly entries = new Map<string, Entry>();
  private recent: string[] = [];
  private readonly frustum = new THREE.Frustum();
  private readonly options: PlanetBodyOptions;

  constructor(renderer: THREE.WebGLRenderer, options: PlanetBodyOptions & { noise?: THREE.Data3DTexture } = {}) {
    this.renderer = renderer;
    this.baker = new Baker(renderer, options.noise);
    this.options = options;
  }

  /**
   * Compiles every program on the driver's threads, before anything needs one. Without this the first planet drawn stalls the main thread
   * for about a second on this machine, while the HLSL compiler runs. Call once at boot, and do not wait for it to show the rails.
   */
  async warm(camera: THREE.Camera): Promise<void> {
    await this.baker.warm();
    const probe = new PlanetBody(this.baker, archetypeDefaults('rock'), this.options);
    await probe.warmUp(camera);
    probe.dispose();
  }

  /** Geography comes from the world itself. A designer who picks the seed of another world still gets a planet of its own. */
  private own(id: string, genome: PlanetGenome): PlanetGenome { return { ...genome, seed: planetSeed(id, genome.seed) }; }

  add(id: string, genome: PlanetGenome, cities: readonly PlanetCity[] = []): PlanetBody {
    const existing = this.entries.get(id);
    if (existing) return existing.body;
    const body = new PlanetBody(this.baker, this.own(id, genome), this.options);
    body.setCities(cities);
    body.request(SYSTEM_SIZE, 1);
    this.group.add(body.group);
    this.entries.set(id, { id, body, leaving: null, close: false });
    return body;
  }

  get(id: string): PlanetBody | undefined { return this.entries.get(id)?.body; }

  /**
   * A new genome for a world, usually the designer's. The old planet stays until the new one is baked, and then the new surface spreads
   * over it from the point facing the camera. Identical genomes do nothing.
   */
  replace(id: string, genome: PlanetGenome): void {
    const e = this.entries.get(id);
    if (!e) return;
    const mine = this.own(id, genome);
    if (JSON.stringify(e.body.genome) === JSON.stringify(mine)) return;
    if (e.leaving) { this.group.remove(e.leaving.group); e.leaving.dispose(); }
    const old = e.body;
    const next = new PlanetBody(this.baker, mine, { ...this.options, renderOrder: (this.options.renderOrder ?? 9) + 0.1 });
    next.position.copy(old.position);
    next.radius = old.radius;
    next.activity = old.activity;
    next.setCities(old.currentCities);
    next.reveal = 0;
    next.request(e.close ? this.worldSize : SYSTEM_SIZE, 0);
    this.group.add(next.group);
    e.leaving = old;
    e.body = next;
  }

  remove(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    for (const b of [e.body, e.leaving]) if (b) { this.group.remove(b.group); b.dispose(); }
    this.entries.delete(id);
    this.recent = this.recent.filter((r) => r !== id);
  }

  /** Which world the camera is flying to. Ask early: the bake takes a moment and the fine texture arrives during the flight. */
  focus(id: string | null, level: PlanetFocus = 'world'): void {
    if (id !== null && level !== 'system' && this.entries.has(id)) this.sharpen(id);
  }

  private sharpen(id: string): void {
    this.recent = [id, ...this.recent.filter((r) => r !== id)];
    const e = this.entries.get(id)!;
    e.close = true;
    if (e.body.ready) e.body.request(this.worldSize, 0);
    for (const stale of this.recent.splice(CLOSE_LIMIT)) {
      const e = this.entries.get(stale);
      if (!e) continue;
      e.close = false;
      e.body.request(SYSTEM_SIZE, 2);
    }
  }

  /** Once a frame, before the scene renders. Moves everything, and spends the bake budget. */
  update(frame: PlanetFrame, dt: number): void {
    const { camera } = frame;
    view.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(view, camera.coordinateSystem);
    const framed: PlanetFrame = frame.frustum ? frame : { ...frame, frustum: this.frustum };
    let low = false;
    let largest: Entry | null = null;
    let largestPx = SHARPEN_PX;
    for (const e of this.entries.values()) {
      if (e.leaving) {
        e.leaving.group.visible = e.body.group.visible;
        // Follow the world it stands for, which may be moving.
        e.leaving.position.copy(e.body.position);
        e.leaving.radius = e.body.radius;
        e.leaving.activity = e.body.activity;
        e.leaving.update(framed, dt);
      }
      if (e.leaving && e.body.ready) {
        e.body.reveal = Math.min(1, e.body.reveal + dt / REVEAL_SECONDS);
        if (e.body.reveal >= 1) {
          this.group.remove(e.leaving.group);
          e.leaving.dispose();
          e.leaving = null;
        }
      }
      e.body.update(framed, dt);
      // Keep the first coarse bake: flying in must not replace it with a much larger unfinished job.
      if (e.close && e.body.ready) e.body.request(this.worldSize, 0);
      if (e.body.height < REGION_ALTITUDE && !isFluid(e.body.genome)) low = true;
      if (!e.close && e.body.screenRadius > largestPx) { largestPx = e.body.screenRadius; largest = e; }
    }
    if (largest) this.sharpen(largest.id);
    if (!low) this.baker.region.unused(dt);
    // Until every world has a surface there is little else worth drawing, so the first planets may take more of the frame.
    this.baker.step(this.baker.busy && this.waiting() ? BOOT_BUDGET_MS : this.baker.budgetMs);
  }

  private waiting(): boolean {
    for (const e of this.entries.values()) if (!e.body.ready) return true;
    return false;
  }

  /** Call from the context guard after a restore. Worlds go dark for a moment and come back from their genomes, nothing else is needed. */
  restored(): void {
    this.baker.restored();
    for (const e of this.entries.values()) {
      if (e.leaving) { this.group.remove(e.leaving.group); e.leaving.dispose(); e.leaving = null; }
      e.body.reveal = 1;
      e.body.restored();
    }
  }

  /** True while bakes run or a genome is being revealed. The driver must keep frames coming, or nothing finishes. */
  get busy(): boolean {
    if (this.baker.busy) return true;
    for (const e of this.entries.values()) if (e.leaving) return true;
    return false;
  }

  get stats(): PlanetFleetStats {
    let bytes = 0;
    let closeUps = 0;
    for (const e of this.entries.values()) {
      bytes += e.body.bytes + (e.leaving?.bytes ?? 0);
      if (e.close) closeUps++;
    }
    return { planets: this.entries.size, bytes: bytes + this.baker.region.bytes, baking: this.baker.busy, closeUps };
  }

  dispose(): void {
    for (const id of [...this.entries.keys()]) this.remove(id);
    this.baker.destroy();
  }
}
