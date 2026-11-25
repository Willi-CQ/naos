// Fixed capacity instance buffers, DESIGN 7.7. One shared geometry per kind. Every list is written whole and uploads only its
// used range, so the frame path allocates nothing and the state language needs no slot book-keeping.
import * as THREE from 'three';
import { stripGeometry, unitQuad } from '../materials.ts';

type V3 = THREE.Vector3;

function instanced(base: THREE.BufferGeometry): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute('position', base.getAttribute('position'));
  g.instanceCount = 0;
  return g;
}

function attribute(g: THREE.BufferGeometry, name: string, capacity: number, size: number): THREE.InstancedBufferAttribute {
  const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size);
  a.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute(name, a);
  return a;
}

/**
 * Uploads the first items of one attribute. three empties `updateRanges` after each upload, and an array cut to length 0 loses its
 * storage, so this keeps one array with one range for good and turns that clearing off. A frame then allocates nothing here.
 */
class Upload {
  private readonly attr: THREE.InstancedBufferAttribute;
  private readonly range = { start: 0, count: 0 };
  constructor(attr: THREE.InstancedBufferAttribute) {
    this.attr = attr;
    attr.updateRanges.push(this.range);
    attr.clearUpdateRanges = keepRanges;
  }
  flush(count: number): void {
    this.range.count = count * this.attr.itemSize;
    this.attr.needsUpdate = true;
  }
}

const keepRanges = (): void => undefined;

/** A list of instances that is written again whenever it changes: clear, add each one, commit. */
abstract class Instances {
  readonly geometry: THREE.InstancedBufferGeometry;
  readonly capacity: number;
  count = 0;
  private readonly uploads: Upload[] = [];
  private touched = false;

  constructor(base: THREE.BufferGeometry, capacity: number) {
    this.geometry = instanced(base);
    this.capacity = capacity;
  }

  protected field(name: string, size: number, upload = true): THREE.InstancedBufferAttribute {
    const a = attribute(this.geometry, name, this.capacity, size);
    if (upload) this.uploads.push(new Upload(a));
    return a;
  }

  /** The next free slot, or -1 past the cap. */
  protected next(): number {
    if (this.count >= this.capacity) return -1;
    this.touched = true;
    return this.count++;
  }

  clear(): void {
    this.count = 0;
    this.touched = true;
  }

  protected touch(): void { this.touched = true; }

  commit(): void {
    if (!this.touched) return;
    this.touched = false;
    this.geometry.instanceCount = this.count;
    const { uploads, count } = this;
    for (let i = 0; i < uploads.length; i++) uploads[i]!.flush(count);
  }
}

export interface ArcSpec {
  center: V3; a: V3; b: V3;
  start: number; sweep: number;
  color: THREE.Color; gain: number;
  width: number; taper?: number; dashCycles?: number; dashFlow?: number;
  birth?: number; life?: number;
}

export class ArcBuffer extends Instances {
  private readonly center: THREE.InstancedBufferAttribute;
  private readonly a: THREE.InstancedBufferAttribute;
  private readonly b: THREE.InstancedBufferAttribute;
  private readonly span: THREE.InstancedBufferAttribute;
  private readonly color: THREE.InstancedBufferAttribute;
  private readonly style: THREE.InstancedBufferAttribute;
  private readonly life: THREE.InstancedBufferAttribute;

  constructor(capacity: number, segments: number) {
    super(stripGeometry(segments), capacity);
    this.center = this.field('iCenter', 3);
    this.a = this.field('iA', 3);
    this.b = this.field('iB', 3);
    this.span = this.field('iSpan', 2);
    this.color = this.field('iColor', 4);
    this.style = this.field('iStyle', 4);
    this.life = this.field('iLife', 2);
    this.field('iUnroll', 1, false);
    this.field('iRow', 3, false);
  }

  add(s: ArcSpec): number {
    const i = this.next();
    if (i < 0) return i;
    this.center.setXYZ(i, s.center.x, s.center.y, s.center.z);
    this.a.setXYZ(i, s.a.x, s.a.y, s.a.z);
    this.b.setXYZ(i, s.b.x, s.b.y, s.b.z);
    this.span.setXY(i, s.start, s.sweep);
    this.color.setXYZW(i, s.color.r, s.color.g, s.color.b, s.gain);
    this.style.setXYZW(i, s.width, s.taper ?? 0, s.dashCycles ?? 0, s.dashFlow ?? 0);
    this.life.setXY(i, s.birth ?? 0, s.life ?? 0);
    return i;
  }

  /** Fires an arc that stays in its list. A window runs along it once, from `birth`. */
  setLife(i: number, birth: number, life: number): void {
    this.life.setXY(i, birth, life);
    this.touch();
  }
}

export const KIND = { KITE: 0, DART: 1, BEAD: 2, BROKEN: 3, HOLLOW: 4, COUNTDOWN: 5, SLASH: 6, SHARD: 7, POD: 8 } as const;

export interface HullSpec {
  position: V3; heading: number; size: number;
  color: THREE.Color; gain: number;
  kind: number; fill?: number; progress?: number; dashes?: number;
}

export class HullBuffer extends Instances {
  private readonly pos: THREE.InstancedBufferAttribute;
  private readonly heading: THREE.InstancedBufferAttribute;
  private readonly size: THREE.InstancedBufferAttribute;
  private readonly color: THREE.InstancedBufferAttribute;
  private readonly shape: THREE.InstancedBufferAttribute;

  constructor(capacity: number) {
    super(unitQuad(), capacity);
    this.pos = this.field('iPos', 3);
    this.heading = this.field('iHeading', 1);
    this.size = this.field('iSize', 1);
    this.color = this.field('iColor', 4);
    this.shape = this.field('iShape', 4);
  }

  add(s: HullSpec): number {
    const i = this.next();
    if (i < 0) return i;
    this.pos.setXYZ(i, s.position.x, s.position.y, s.position.z);
    this.heading.setX(i, s.heading);
    this.size.setX(i, s.size);
    this.color.setXYZW(i, s.color.r, s.color.g, s.color.b, s.gain);
    this.shape.setXYZW(i, s.kind, s.fill ?? 0, s.progress ?? 0, s.dashes ?? 0);
    return i;
  }
}

export const BEAM = { SCAN: 0, STRIKE: 1, DRILL: 2, OUTBOUND: 3, TIGHT: 4, METEOR: 5 } as const;

export interface BeamSpec { from: V3; to: V3; kind: number; birth?: number; life?: number; width: number; color: THREE.Color; gain: number }

export class BeamBuffer extends Instances {
  private readonly from: THREE.InstancedBufferAttribute;
  private readonly to: THREE.InstancedBufferAttribute;
  private readonly beam: THREE.InstancedBufferAttribute;
  private readonly color: THREE.InstancedBufferAttribute;

  constructor(capacity: number) {
    super(stripGeometry(1), capacity);
    this.from = this.field('iFrom', 3);
    this.to = this.field('iTo', 3);
    this.beam = this.field('iBeam', 4);
    this.color = this.field('iColor', 4);
  }

  add(s: BeamSpec): number {
    const i = this.next();
    if (i < 0) return i;
    this.from.setXYZ(i, s.from.x, s.from.y, s.from.z);
    this.to.setXYZ(i, s.to.x, s.to.y, s.to.z);
    this.beam.setXYZW(i, s.kind, s.birth ?? 0, s.life ?? 0, s.width);
    this.color.setXYZW(i, s.color.r, s.color.g, s.color.b, s.gain);
    return i;
  }
}

export class WorldBuffer {
  readonly geometry: THREE.InstancedBufferGeometry;
  count = 0;
  private readonly centre: THREE.InstancedBufferAttribute;
  private readonly radius: THREE.InstancedBufferAttribute;
  private readonly glow: THREE.InstancedBufferAttribute;

  constructor(capacity: number) {
    const g = (this.geometry = instanced(unitQuad()));
    this.centre = attribute(g, 'iCentre', capacity, 3);
    this.radius = attribute(g, 'iRadius', capacity, 1);
    this.glow = attribute(g, 'iGlow', capacity, 1);
  }

  add(centre: V3, radius: number, glow = 1): number {
    const i = this.count++;
    this.set(i, centre, radius, glow);
    this.geometry.instanceCount = this.count;
    return i;
  }

  set(i: number, centre: V3, radius: number, glow = 1): void {
    this.centre.setXYZ(i, centre.x, centre.y, centre.z);
    this.radius.setX(i, radius);
    this.glow.setX(i, glow);
    this.centre.needsUpdate = this.radius.needsUpdate = this.glow.needsUpdate = true;
  }

  clear(): void {
    this.count = 0;
    this.geometry.instanceCount = 0;
  }
}

export class CityBuffer {
  readonly geometry = new THREE.BufferGeometry();
  count = 0;
  private readonly dir: THREE.BufferAttribute;
  private readonly world: THREE.BufferAttribute;
  private readonly fail: THREE.BufferAttribute;

  constructor(capacity: number) {
    this.dir = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
    this.world = new THREE.BufferAttribute(new Float32Array(capacity), 1);
    this.fail = new THREE.BufferAttribute(new Float32Array(capacity), 1);
    this.geometry.setAttribute('position', this.dir);
    this.geometry.setAttribute('aDir', this.dir);
    this.geometry.setAttribute('aWorld', this.world);
    this.geometry.setAttribute('aFail', this.fail);
    this.geometry.setDrawRange(0, 0);
  }

  clear(): void {
    this.count = 0;
    this.geometry.setDrawRange(0, 0);
  }

  /** Newest last, so a smaller tier keeps the newest lights. */
  cap(max: number): void {
    const n = Math.min(this.count, max);
    this.geometry.setDrawRange(this.count - n, n);
  }

  add(x: number, y: number, z: number, world: number, fail: boolean): void {
    const i = this.count++;
    this.dir.setXYZ(i, x, y, z);
    this.world.setX(i, world);
    this.fail.setX(i, fail ? 1 : 0);
    this.geometry.setDrawRange(0, this.count);
    this.dir.needsUpdate = this.world.needsUpdate = this.fail.needsUpdate = true;
  }
}
