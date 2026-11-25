// Ground for low orbit. A cube of any size is too coarse once the camera is close, so the one planet under the camera gets three nested patches
// from the same bake shaders, run again at a finer scale. They are the same surface, so a coast or a crater simply carries on to smaller sizes,
// and a patch that moves swaps in without a seam. One planet at a time, so this memory is paid once, and only while someone is down there.
import type { PlanetGenome } from '@naos/protocol';
import * as THREE from 'three';
import { PATCH_LEVELS, PATCH_SIZE, patchMatrices, staleness, type RegionLevel } from './region-plan.ts';

export interface RegionTargets { albedo: THREE.WebGLRenderTarget; relief: THREE.WebGLRenderTarget }

/** What a region asks of the baker. */
export interface RegionHost {
  patchJob(genome: PlanetGenome, level: RegionLevel, targets: RegionTargets, field: THREE.WebGLRenderTarget): Generator<number, void, unknown>;
  readonly emptyStrip: THREE.Texture;
  readonly anisotropy: number;
  readonly fieldType: THREE.TextureDataType;
}

interface Slot extends RegionTargets { level: RegionLevel | null }

const FADE_SECONDS = 0.5;
const IDLE_SECONDS = 6;

export class Region {
  private readonly host: RegionHost;
  private owner: object | null = null;
  private genome: PlanetGenome | null = null;
  private plan: RegionLevel[] | null = null;
  /** One more than the levels: a bake lands in the spare, which then swaps with the level it replaces. */
  private slots: Slot[] = [];
  private spare: Slot | null = null;
  private readonly shown: (Slot | null)[] = Array.from({ length: PATCH_LEVELS }, () => null);
  private readonly fade: number[] = Array.from({ length: PATCH_LEVELS }, () => 0);
  private field: THREE.WebGLRenderTarget | null = null;
  private job: { steps: Generator<number, void, unknown>; index: number; level: RegionLevel; into: Slot } | null = null;
  private idle = 0;

  constructor(host: RegionHost) { this.host = host; }

  private target(type: THREE.TextureDataType, colorSpace: THREE.ColorSpace, anisotropy: number): THREE.WebGLRenderTarget {
    return new THREE.WebGLRenderTarget(PATCH_SIZE, PATCH_SIZE, {
      type, colorSpace, anisotropy, depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
    });
  }

  private build(): void {
    const a = this.host.anisotropy;
    this.slots = Array.from({ length: PATCH_LEVELS + 1 }, () => ({
      albedo: this.target(THREE.UnsignedByteType, THREE.SRGBColorSpace, a),
      relief: this.target(THREE.HalfFloatType, THREE.NoColorSpace, a),
      level: null,
    }));
    this.spare = this.slots[PATCH_LEVELS]!;
    this.field = new THREE.WebGLRenderTarget(PATCH_SIZE, PATCH_SIZE, {
      type: this.host.fieldType, depthBuffer: false, stencilBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
  }

  /** Says what the camera wants this frame. Whoever calls last owns the region, and a new owner starts from nothing. */
  track(owner: object, genome: PlanetGenome, plan: RegionLevel[] | null): void {
    if (this.slots.length === 0) this.build();
    if (owner !== this.owner || genome !== this.genome) {
      this.owner = owner;
      this.genome = genome;
      this.job = null;
      this.shown.fill(null);
      this.fade.fill(0);
      for (const s of this.slots) s.level = null;
      this.spare = this.slots[PATCH_LEVELS]!;
    }
    this.plan = plan;
    this.idle = 0;
  }

  owns(owner: object): boolean { return this.owner === owner; }

  /** Bakes what is most behind, one tile at each step. Yields the cost of each tile. */
  *work(): Generator<number, void, unknown> {
    if (!this.plan || !this.genome || !this.field) return;
    if (!this.job) {
      let worst = -1;
      let score = 1;
      for (let i = 0; i < PATCH_LEVELS; i++) {
        const s = staleness(this.shown[i]?.level ?? null, this.plan[i]!);
        if (s > score) { score = s; worst = i; }
      }
      if (worst < 0 || !this.spare) return;
      const level = this.plan[worst]!;
      this.job = { index: worst, level, into: this.spare, steps: this.host.patchJob(this.genome, level, this.spare, this.field) };
    }
    const job = this.job;
    for (;;) {
      const next = job.steps.next();
      if (this.job !== job) return;
      if (next.done) break;
      yield next.value;
      if (this.job !== job) return;
    }
    job.into.level = job.level;
    const before = this.shown[job.index] ?? null;
    // A patch far from the last one has nothing to carry on from, so it fades in like the first.
    if (!before || staleness(before.level, job.level) > 3) this.fade[job.index] = 0;
    this.shown[job.index] = job.into;
    this.spare = before ?? this.slots.find((s) => !this.shown.includes(s)) ?? null;
    this.job = null;
  }

  /** True while a patch is on its way or wanted. */
  get busy(): boolean {
    if (this.job) return true;
    if (!this.plan) return false;
    return this.plan.some((want, i) => staleness(this.shown[i]?.level ?? null, want) > 1);
  }

  /** Writes the patches into a planet's uniforms. Call for the owner, every frame. */
  bind(u: Record<string, THREE.IUniform>, dt: number): void {
    for (let i = 0; i < PATCH_LEVELS; i++) {
      const s = this.shown[i] ?? null;
      this.fade[i] = s ? Math.min(1, this.fade[i]! + dt / FADE_SECONDS) : 0;
      u[`uA${i}`]!.value = s ? s.albedo.texture : this.host.emptyStrip;
      u[`uR${i}`]!.value = s ? s.relief.texture : this.host.emptyStrip;
      if (s?.level) (u[`uP${i}`]!.value as THREE.Matrix3).fromArray(patchMatrices(s.level).inverse);
    }
    (u.uPW!.value as THREE.Vector3).set(this.shown[0]?.level?.width ?? 1, this.shown[1]?.level?.width ?? 1, this.shown[2]?.level?.width ?? 1);
    (u.uPOn!.value as THREE.Vector3).set(this.fade[0]!, this.fade[1]!, this.fade[2]!);
  }

  /** A frame has passed with nobody below the region altitude, so memory nobody is using can go. */
  unused(dt: number): void {
    if (this.slots.length === 0) return;
    this.plan = null;
    this.idle += dt;
    if (this.idle > IDLE_SECONDS) this.release();
  }

  get bytes(): number {
    if (this.slots.length === 0) return 0;
    const texels = PATCH_SIZE * PATCH_SIZE;
    return Math.round(this.slots.length * (texels * 4 + texels * 8) * (4 / 3) + texels * 16);
  }

  release(): void {
    for (const s of this.slots) { s.albedo.dispose(); s.relief.dispose(); }
    this.field?.dispose();
    this.field = null;
    this.slots = [];
    this.spare = null;
    this.shown.fill(null);
    this.fade.fill(0);
    this.job = null;
    this.plan = null;
    this.owner = null;
    this.genome = null;
  }

  /** After a lost context nothing here exists any more, and disposing it is harmless. */
  restored(): void { this.release(); }
}
