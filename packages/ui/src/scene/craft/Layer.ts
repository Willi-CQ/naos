// Everything a fleet needs to draw its ships. Add the group to a scene, call begin, add each craft, then commit. Marks, meshes, glints and
// shadows are all decided here from one projected length, so the two bodies of a craft cannot disagree. The frame path allocates nothing:
// each list is written whole, and a part that no craft uses costs nothing, not even its build.
import * as THREE from 'three';
import { apparentLength, markBasis, markFade, markPlanar, meshFade, NEAR_FROM, SPECK_TO, screenLength, shadowStrength, shadowTile, SHADOW_FROM, SHADOW_TILES, stateBody, stateHandover, surfaceDetail, type MarkBasis, type MarkPose } from './fade.ts';
import type { Mesh } from './forge.ts';
import { ATLAS_COLS, ATLAS_ROWS, buildAtlas, OUTLINE_GAP, OUTLINE_HALF, SDF_RANGE, TILE_REACH } from './glyphs.ts';
import { buildCrumple, buildGrain } from './grain.ts';
import { craftLength, kindIndex, markLength, type CraftKind } from './kind.ts';
import { assembly, assemblyReady, keepParts, part, type Assembly, type Belt, type PartId } from './parts.ts';
import { shardOf, SHARDS } from './shards.ts';
import glintFrag from './shaders/glint.frag?raw';
import glintVert from './shaders/glint.vert?raw';
import markFrag from './shaders/mark.frag?raw';
import markVert from './shaders/mark.vert?raw';
import shadowFrag from './shaders/shadow.frag?raw';
import shadowVert from './shaders/shadow.vert?raw';
import shipFrag from './shaders/ship.frag?raw';
import shipVert from './shaders/ship.vert?raw';

export { shipFrame } from './frame.ts';

export const SHADOW_SIZE = 2048;
const MAX_INSTANCES = 192;
const MAX_MARKS = 512;
const MAX_GLINTS = 2048;
const GRAIN = 32;
const CRUMPLE = 128;

const OIII = new THREE.Color('#21E3BE');

/** One per craft, kept by the caller from frame to frame, because `held` carries a heading across a moment with none to give. */
export interface CraftDraw {
  kind: CraftKind;
  /** Ship origin, world. */
  position: THREE.Vector3;
  /** Ship frame: +x forward, +y dorsal. `shipFrame` builds it from a flight path and a look. */
  quaternion: THREE.Quaternion;
  /** Hull length in world units. Without it, the class length at the layer's base. */
  length?: number;
  /** Section 6: colour and gain. */
  tone: THREE.Color;
  gain: number;
  /** 1 filled, 0 outline. */
  fill: number;
  dashed?: boolean;
  /** Engines, 0 to 1. */
  drive?: number;
  /** Running lights, 0 to 1. An idle craft pulses this on the liveness probe. */
  strobe?: number;
  /** Angle of a command ring. Advance it with tokens, so it stands still when they stop. */
  ring?: number;
  /** Set on a crashed craft: how far the five sections have parted, 0 to 1. */
  broken?: number;
  /** Written by the layer. */
  held?: number;
}

export interface CraftLayerOptions {
  /** Length of a cruiser in world units. */
  base?: number;
  /** Render orders of the ship meshes, the marks and the glints. */
  order?: { ships: number; marks: number; glints: number };
  /** Build parts on the calling thread at first use. The lab wants a shot now, the app wants no hitch. */
  sync?: boolean;
}

const tmpQ = new THREE.Quaternion();
const tmpShard = new THREE.Quaternion();
const tmpSpin = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpW = new THREE.Vector3();
const tmpCentre = new THREE.Vector3();
const tmpFwd = new THREE.Vector3();
const tmpAt = new THREE.Vector3();
const xAxis = new THREE.Vector3(1, 0, 0);
const tile = { x: 0, y: 0, size: 0 };
const pose: MarkPose = { heading: 0, squash: 1 };
const basis: MarkBasis = { ax: 0, ay: 0, bx: 0, by: 0, heading: 0 };
const shard = { dx: 0, dy: 0, dz: 0, ax: 0, ay: 0, az: 0, angle: 0 };
function dynamic(g: THREE.BufferGeometry, name: string, capacity: number, size: number): { attr: THREE.InstancedBufferAttribute; a: Float32Array } {
  const a = new Float32Array(capacity * size);
  const attr = new THREE.InstancedBufferAttribute(a, size);
  attr.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute(name, attr);
  return { attr, a };
}

/** Uploads a range that is set again each frame. three empties updateRanges after every upload, and this keeps one array for good. */
class Range {
  private readonly attr: THREE.InstancedBufferAttribute;
  private readonly range = { start: 0, count: 0 };
  constructor(attr: THREE.InstancedBufferAttribute) {
    this.attr = attr;
    attr.updateRanges.push(this.range);
    attr.clearUpdateRanges = keep;
  }
  flush(count: number): void {
    this.range.count = count * this.attr.itemSize;
    this.attr.needsUpdate = true;
  }
}
const keep = (): void => undefined;

function meshGeometry(m: Mesh, share: THREE.BufferGeometry | null): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  if (share) {
    for (const name of ['position', 'normal', 'uv', 'aMeta', 'aEdge']) g.setAttribute(name, share.getAttribute(name));
    g.setIndex(share.getIndex());
    g.instanceCount = 0;
    return g;
  }
  g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3, true));
  g.setAttribute('uv', new THREE.BufferAttribute(m.uv, 2));
  g.setAttribute('aMeta', new THREE.BufferAttribute(m.meta, 4, false));
  g.setAttribute('aEdge', new THREE.BufferAttribute(m.edge, 4));
  g.setIndex(new THREE.BufferAttribute(m.index, 1));
  g.instanceCount = 0;
  return g;
}

/** One level of one part, instanced. */
class Bucket {
  readonly geometry: THREE.InstancedBufferGeometry;
  readonly mesh: THREE.Mesh;
  readonly shadow: THREE.Mesh;
  readonly triangles: number;
  count = 0;
  private readonly ranges: Range[] = [];
  private readonly pose: Float32Array;
  private readonly quat: Float32Array;
  private readonly tone: Float32Array;
  private readonly look: Float32Array;
  private readonly extra: Float32Array;
  private readonly fine: Float32Array;
  private readonly ship: Float32Array;
  private readonly tileAttr: Float32Array;

  constructor(m: Mesh, material: THREE.ShaderMaterial, shadow: THREE.ShaderMaterial, order: number, share: THREE.BufferGeometry | null = null) {
    this.geometry = meshGeometry(m, share);
    this.triangles = m.triangles;
    const f = (name: string, size = 4): Float32Array => {
      const { attr, a } = dynamic(this.geometry, name, MAX_INSTANCES, size);
      this.ranges.push(new Range(attr));
      return a;
    };
    this.pose = f('iPose');
    this.quat = f('iQuat');
    this.tone = f('iTone');
    this.look = f('iLook');
    this.extra = f('iExtra');
    this.fine = f('iFine', 1);
    this.ship = f('iShip');
    this.tileAttr = f('iTile');
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
    this.shadow = new THREE.Mesh(this.geometry, shadow);
    this.shadow.frustumCulled = false;
  }

  /** Returns the slot, or -1 past the cap. */
  put(position: THREE.Vector3, scale: number, q: THREE.Quaternion, tone: THREE.Color, gain: number, fill: number, fade: number, rim: number, dashes: number, drive: number, centre: THREE.Vector3, radius: number, fine: number, from = 0, to = 0, seed = 0): number {
    const i = this.count;
    if (i >= MAX_INSTANCES) return -1;
    this.count = i + 1;
    const k = i * 4;
    this.pose[k] = position.x; this.pose[k + 1] = position.y; this.pose[k + 2] = position.z; this.pose[k + 3] = scale;
    this.quat[k] = q.x; this.quat[k + 1] = q.y; this.quat[k + 2] = q.z; this.quat[k + 3] = q.w;
    this.tone[k] = tone.r; this.tone[k + 1] = tone.g; this.tone[k + 2] = tone.b; this.tone[k + 3] = gain;
    this.look[k] = fill; this.look[k + 1] = fade; this.look[k + 2] = rim; this.look[k + 3] = drive;
    this.extra[k] = dashes; this.extra[k + 1] = from; this.extra[k + 2] = to; this.extra[k + 3] = seed;
    this.fine[i] = fine;
    this.ship[k] = centre.x; this.ship[k + 1] = centre.y; this.ship[k + 2] = centre.z; this.ship[k + 3] = radius;
    this.tileAttr[k] = 0; this.tileAttr[k + 1] = 0; this.tileAttr[k + 2] = 0; this.tileAttr[k + 3] = 0;
    return i;
  }

  setTile(i: number, x: number, y: number, size: number, strength: number): void {
    const k = i * 4;
    this.tileAttr[k] = x; this.tileAttr[k + 1] = y; this.tileAttr[k + 2] = size; this.tileAttr[k + 3] = strength;
  }

  commit(): void {
    this.geometry.instanceCount = this.count;
    this.mesh.visible = this.count > 0;
    for (let i = 0; i < this.ranges.length; i++) this.ranges[i]!.flush(this.count);
  }

  dispose(): void { this.geometry.dispose(); }
}

interface PartSet { near: Bucket; far: Bucket; speck: Bucket; tornNear: Bucket | null; tornFar: Bucket | null; texture: THREE.Data3DTexture; material: THREE.ShaderMaterial; tornMaterial: THREE.ShaderMaterial | null }

/** One record per close ship, so ranks can be decided after everything was added. */
interface Row {
  s: number;
  slots: Array<{ bucket: Bucket; slot: number }>;
  used: number;
}

const SLOTS = SHARDS + 2;

export class CraftLayer {
  readonly group = new THREE.Group();
  /** The shadow atlas needs a pass of its own, before the main one. It renders only when a ship is close enough to cast. */
  private readonly shadowScene = new THREE.Scene();
  private readonly shadowCamera = new THREE.Camera();
  private readonly target: THREE.WebGLRenderTarget;
  readonly uniforms = {
    /** Where the disk is, world. */
    uDisk: { value: new THREE.Vector3() },
    /** Colour times power of the disk's light. Dim it with quota. */
    uKey: { value: new THREE.Color(2.0, 1.78, 1.46) },
    /** The world in the frame: position and radius, 0 for none. It can eclipse a ship and lights its shadow side. */
    uBody: { value: new THREE.Vector4(0, 0, 0, 0) },
    uBodyColor: { value: new THREE.Color(0.2, 0.3, 0.4) },
    uShadow: { value: null as THREE.Texture | null },
    uGrain: { value: null as THREE.Texture | null },
    uCrumple: { value: null as THREE.Texture | null },
    uShadowTexel: { value: 1 / SHADOW_SIZE },
  };
  private readonly frame = {
    uRes: { value: new THREE.Vector2(1, 1) },
    uPxPerCss: { value: 1 },
  };
  private readonly sets = new Map<PartId, PartSet>();
  private readonly buckets: Bucket[] = [];
  private readonly shadowMaterial: THREE.ShaderMaterial;
  private readonly order: { ships: number; marks: number; glints: number };
  private readonly sync: boolean;
  readonly base: number;
  /** DESIGN 7.9: `craftK`, times the 20/15 a mark grows by on the way to World. Set it from the rig. */
  markScale = 1;

  private readonly marks: THREE.Mesh;
  private readonly markGeometry: THREE.InstancedBufferGeometry;
  private readonly markPos: Float32Array;
  private readonly markBasis: Float32Array;
  private readonly markIndex: Float32Array;
  private readonly markColor: Float32Array;
  private readonly markStyle: Float32Array;
  private readonly markRanges: Range[] = [];
  private readonly atlas: THREE.DataTexture;
  private markCount = 0;

  private readonly glints: THREE.Mesh;
  private readonly glintGeometry: THREE.InstancedBufferGeometry;
  private readonly glintA: Float32Array;
  private readonly glintB: Float32Array;
  private readonly glintColor: Float32Array;
  private readonly glintRanges: Range[] = [];
  private glintCount = 0;

  private readonly rows: Row[] = [];
  private rowCount = 0;
  private ranked: Row[] = [];
  private camera: THREE.PerspectiveCamera | null = null;
  private focal = 1;
  private cssH = 1;
  private warming = false;
  private warmed = false;
  private probe: { ship: THREE.ShaderMaterial; torn: THREE.ShaderMaterial; geometry: THREE.BufferGeometry } | null = null;
  /** Set while the atlas holds something from the last frame. */
  private casting = false;
  private worker: Worker | null = null;
  /** What the last frame drew, for the bench. */
  readonly stats = { ships: 0, marks: 0, nearDraws: 0, farDraws: 0, speckDraws: 0, casters: 0, glints: 0, triangles: 0, dropped: 0 };

  constructor(options: CraftLayerOptions = {}) {
    this.base = options.base ?? 10;
    this.order = options.order ?? { ships: 15, marks: 30, glints: 45 };
    this.sync = options.sync ?? false;
    const depth = new THREE.DepthTexture(SHADOW_SIZE, SHADOW_SIZE);
    depth.type = THREE.FloatType;
    depth.compareFunction = THREE.LessEqualCompare;
    depth.minFilter = depth.magFilter = THREE.LinearFilter;
    this.target = new THREE.WebGLRenderTarget(SHADOW_SIZE, SHADOW_SIZE, { depthTexture: depth, depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
    this.uniforms.uShadow.value = depth;
    const grain = new THREE.Data3DTexture(buildGrain(GRAIN), GRAIN, GRAIN, GRAIN);
    grain.format = THREE.RGBAFormat;
    grain.type = THREE.UnsignedByteType;
    grain.minFilter = grain.magFilter = THREE.LinearFilter;
    grain.wrapS = grain.wrapT = grain.wrapR = THREE.RepeatWrapping;
    grain.generateMipmaps = false;
    grain.needsUpdate = true;
    this.uniforms.uGrain.value = grain;
    const crumple = new THREE.DataTexture(buildCrumple(CRUMPLE), CRUMPLE, CRUMPLE, THREE.RGBAFormat, THREE.UnsignedByteType);
    crumple.wrapS = crumple.wrapT = THREE.RepeatWrapping;
    crumple.minFilter = THREE.LinearMipmapLinearFilter;
    crumple.magFilter = THREE.LinearFilter;
    crumple.generateMipmaps = true;
    crumple.needsUpdate = true;
    this.uniforms.uCrumple.value = crumple;
    this.shadowMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: shadowVert, fragmentShader: shadowFrag, uniforms: { uDisk: this.uniforms.uDisk },
      side: THREE.DoubleSide, colorWrite: false, depthTest: true, depthWrite: true, toneMapped: false,
    });

    const quad = new THREE.BufferGeometry();
    quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    const additive: THREE.ShaderMaterialParameters = { glslVersion: THREE.GLSL3, toneMapped: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide };

    const atlas = buildAtlas();
    this.atlas = new THREE.DataTexture(atlas.data, atlas.width, atlas.height, THREE.RedFormat, THREE.UnsignedByteType);
    this.atlas.minFilter = this.atlas.magFilter = THREE.LinearFilter;
    this.atlas.generateMipmaps = false;
    this.atlas.needsUpdate = true;
    const mg = new THREE.InstancedBufferGeometry();
    mg.setAttribute('position', quad.getAttribute('position'));
    mg.index = quad.index;
    mg.instanceCount = 0;
    const field = (g: THREE.BufferGeometry, name: string, cap: number, size: number, list: Range[]): Float32Array => {
      const { attr, a } = dynamic(g, name, cap, size);
      list.push(new Range(attr));
      return a;
    };
    this.markGeometry = mg;
    this.markPos = field(mg, 'iPos', MAX_MARKS, 3, this.markRanges);
    this.markBasis = field(mg, 'iBasis', MAX_MARKS, 4, this.markRanges);
    this.markIndex = field(mg, 'iIndex', MAX_MARKS, 1, this.markRanges);
    this.markColor = field(mg, 'iColor', MAX_MARKS, 4, this.markRanges);
    this.markStyle = field(mg, 'iStyle', MAX_MARKS, 4, this.markRanges);
    this.marks = new THREE.Mesh(mg, new THREE.ShaderMaterial({
      ...additive, vertexShader: markVert, fragmentShader: markFrag, depthTest: true,
      uniforms: {
        ...this.frame, uAtlas: { value: this.atlas }, uGrid: { value: new THREE.Vector2(ATLAS_COLS, ATLAS_ROWS) }, uReach: { value: TILE_REACH },
        uRange: { value: SDF_RANGE }, uOutlineHalf: { value: OUTLINE_HALF }, uOutlineGap: { value: OUTLINE_GAP },
      },
    }));
    this.marks.frustumCulled = false;
    this.marks.renderOrder = this.order.marks;
    this.group.add(this.marks);

    const gg = new THREE.InstancedBufferGeometry();
    gg.setAttribute('position', quad.getAttribute('position'));
    gg.index = quad.index;
    gg.instanceCount = 0;
    this.glintGeometry = gg;
    this.glintA = field(gg, 'iA', MAX_GLINTS, 4, this.glintRanges);
    this.glintB = field(gg, 'iB', MAX_GLINTS, 4, this.glintRanges);
    this.glintColor = field(gg, 'iColor', MAX_GLINTS, 4, this.glintRanges);
    this.glints = new THREE.Mesh(gg, new THREE.ShaderMaterial({ ...additive, vertexShader: glintVert, fragmentShader: glintFrag, uniforms: { ...this.frame }, depthTest: true }));
    this.glints.frustumCulled = false;
    this.glints.renderOrder = this.order.glints;
    this.group.add(this.glints);

    if (!this.sync) {
      this.worker = new Worker(new URL('./parts.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<Parameters<typeof keepParts>[0] | 'done'>): void => {
        if (e.data === 'done') { this.worker?.terminate(); this.worker = null; return; }
        keepParts(e.data);
      };
    }
  }

  private shipMaterial(field: THREE.Texture | null, min: THREE.Vector3, inverse: THREE.Vector3, cell: number, span: number, belts: readonly Belt[]): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: shipVert,
      fragmentShader: shipFrag,
      toneMapped: false,
      transparent: true,
      depthTest: true,
      depthWrite: true,
      side: THREE.FrontSide,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      uniforms: {
        ...this.uniforms, uField: { value: field }, uFieldMin: { value: min }, uFieldInverse: { value: inverse }, uFieldCell: { value: cell }, uSpan: { value: span },
        uBelt: { value: [0, 1, 2].map((i) => { const b = belts[i]; return b ? new THREE.Vector4(b.at, b.half, b.within, b.spill) : new THREE.Vector4(); }) },
      },
    });
  }

  /**
   * Compiles the programs off the frame path. The first ship would otherwise stall a frame for half a second, on the very moment an operator
   * flies in to look at something. Materials with the same source share a program, so this probe never draws and the parts reuse its work.
   * It holds on to its materials, because three frees a program with its last user.
   */
  private warm(renderer: THREE.WebGLRenderer): void {
    this.warming = true;
    const zero = new THREE.Vector3();
    const ship = this.shipMaterial(null, zero, zero, 1, 1, []);
    const torn = this.shipMaterial(null, zero, zero, 1, 1, []);
    torn.defines = { TORN: 1 };
    // Shaped like a real part, because the attributes a geometry has are part of the key too.
    const g = meshGeometry({ position: new Float32Array(9), normal: new Int16Array(9), uv: new Float32Array(6), meta: new Uint8Array(12), edge: new Float32Array(12), index: new Uint32Array([0, 1, 2]), triangles: 1, min: [0, 0, 0], max: [0, 0, 0] }, null);
    const probe = new THREE.Scene();
    for (const m of [ship, torn, this.shadowMaterial]) probe.add(new THREE.Mesh(g, m));
    this.probe = { ship, torn, geometry: g };
    // Against a target, as the real draw is: three keys a program on the output colour space, and on the canvas this would compile one nobody uses.
    const target = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    void renderer.compileAsync(probe, this.camera!).then(() => { this.warmed = true; }).catch(() => { this.warming = false; });
    renderer.setRenderTarget(target);
  }

  private setOf(id: PartId): PartSet {
    const seen = this.sets.get(id);
    if (seen) return seen;
    const p = part(id);
    const texture = new THREE.Data3DTexture(p.field.data, p.field.nx, p.field.ny, p.field.nz);
    texture.format = THREE.RGFormat;
    texture.type = THREE.UnsignedByteType;
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.wrapS = texture.wrapT = texture.wrapR = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;
    const material = this.shipMaterial(texture, new THREE.Vector3(...p.field.min), new THREE.Vector3(...p.field.inverse), p.field.cell, p.near.max[0] - p.near.min[0], p.belts);
    const far = new Bucket(p.far, material, this.shadowMaterial, this.order.ships);
    const near = new Bucket(p.near, material, this.shadowMaterial, this.order.ships);
    const speck = new Bucket(p.speck, material, this.shadowMaterial, this.order.ships);
    const set: PartSet = { near, far, speck, tornNear: null, tornFar: null, texture, material, tornMaterial: null };
    this.group.add(near.mesh, far.mesh, speck.mesh);
    this.shadowScene.add(near.shadow);
    this.buckets.push(near, far, speck);
    this.sets.set(id, set);
    return set;
  }

  /** Crashed hulls get a program of their own, built the first time one is seen: see the note on `discard` in the shader. */
  private tornOf(id: PartId, set: PartSet, near: boolean): Bucket {
    const seen = near ? set.tornNear : set.tornFar;
    if (seen) return seen;
    if (!set.tornMaterial) {
      set.tornMaterial = set.material.clone();
      set.tornMaterial.defines = { TORN: 1 };
      set.tornMaterial.uniforms = set.material.uniforms;
    }
    const p = part(id);
    const bucket = new Bucket(near ? p.near : p.far, set.tornMaterial, this.shadowMaterial, this.order.ships, near ? set.near.geometry : set.far.geometry);
    if (near) set.tornNear = bucket; else set.tornFar = bucket;
    this.group.add(bucket.mesh);
    this.buckets.push(bucket);
    return bucket;
  }

  /** Starts a frame. `css` is the canvas in CSS px, `pxPerCss` the device pixels in one. */
  begin(camera: THREE.PerspectiveCamera, css: { w: number; h: number }, pxPerCss: number): void {
    this.camera = camera;
    this.focal = css.h / (2 * Math.tan((camera.fov * Math.PI) / 360));
    this.cssH = css.h;
    this.frame.uRes.value.set(css.w * pxPerCss, css.h * pxPerCss);
    this.frame.uPxPerCss.value = pxPerCss;
    for (let i = 0; i < this.buckets.length; i++) this.buckets[i]!.count = 0;
    this.markCount = 0;
    this.glintCount = 0;
    this.rowCount = 0;
    this.ranked.length = 0;
    const st = this.stats;
    st.ships = st.marks = st.nearDraws = st.farDraws = st.speckDraws = st.casters = st.glints = st.triangles = st.dropped = 0;
  }

  /** What a craft measures on the screen right now, 0 when it is behind the eye or clear of the frame. A hit test wants the number the drawing used. */
  measure(c: CraftDraw): number {
    const camera = this.camera!;
    const length = c.length ?? craftLength(c.kind, this.base);
    const v = tmpV.copy(c.position).applyMatrix4(camera.matrixWorldInverse);
    const depth = -v.z;
    // A long module can stand a hull length clear of the origin, and a mark is 22 px wide whatever the depth.
    const reach = length * 1.3 + (depth * 24) / this.focal;
    if (depth <= -reach) return 0;
    const half = (depth * this.cssH) / (2 * this.focal);
    if (Math.abs(v.y) > half + reach || Math.abs(v.x) > half * camera.aspect + reach) return 0;
    return screenLength(length, Math.max(depth, length * 0.05), this.focal);
  }

  /** Draws a craft as one or both of its bodies. A ship whose part has not arrived stays a mark, which is always correct. */
  add(c: CraftDraw): void {
    const s = this.measure(c);
    if (s <= 0) return;
    const m = markLength(c.kind) * this.markScale;
    const view = this.camera!.matrixWorldInverse;
    const fwd = tmpFwd.copy(xAxis).applyQuaternion(c.quaternion).transformDirection(view);
    const fx = fwd.x, fy = fwd.y, fz = fwd.z;
    const side = tmpW.set(0, 0, 1).applyQuaternion(c.quaternion).transformDirection(view);
    const zx = side.x, zy = side.y;
    if (!(this.sync || (this.warmed && assemblyReady(c.kind.hull, c.kind.role)))) {
      this.addMark(c, m, 1, 0, 0, fx, fy, fz, zx, zy);
      return;
    }
    const asm = assembly(c.kind.hull, c.kind.role);
    const seen = apparentLength(s, Math.hypot(fx, fy), asm.breadth);
    const shipFade = meshFade(seen, m);
    const flatFade = markFade(seen, m);
    if (shipFade > 0) {
      const length = c.length ?? craftLength(c.kind, this.base);
      this.addShip(c, asm, length / asm.length, s, stateBody(seen) + stateHandover(seen, m), shipFade);
    }
    if (flatFade > 0) this.addMark(c, m, flatFade, markPlanar(seen, m), shipFade, fx, fy, fz, zx, zy);
  }

  private addShip(c: CraftDraw, asm: Assembly, scale: number, s: number, body: number, fade: number): void {
    const near = s >= NEAR_FROM;
    let row: Row | null = null;
    if (near) {
      row = this.rows[this.rowCount] ?? null;
      if (!row) {
        row = { s: 0, slots: Array.from({ length: SLOTS }, () => ({ bucket: null as unknown as Bucket, slot: 0 })), used: 0 };
        this.rows.push(row);
      }
      this.rowCount += 1;
      row.s = s;
      row.used = 0;
    }
    const centre = tmpCentre.set(asm.centre[0], asm.centre[1], asm.centre[2]).multiplyScalar(scale).applyQuaternion(c.quaternion).add(c.position);
    const radius = asm.radius * scale;
    const dashes = c.dashed ? 7 : 0;
    const drive = c.drive ?? 0;
    const fine = surfaceDetail(s);
    const broken = c.broken ?? -1;
    for (let i = 0; i < asm.mounts.length; i++) {
      const mount = asm.mounts[i]!;
      const set = this.setOf(mount.part);
      const small = s < SPECK_TO;
      const bucket = broken >= 0 ? this.tornOf(mount.part, set, near) : near ? set.near : small ? set.speck : set.far;
      const mounted = scale * mount.scale;
      tmpAt.set(mount.at[0], mount.at[1], mount.at[2]).multiplyScalar(scale);
      if (mount.spin) tmpSpin.setFromAxisAngle(xAxis, c.ring ?? 0);
      const q = mount.spin ? tmpQ.copy(c.quaternion).multiply(tmpSpin) : c.quaternion;
      if (broken >= 0) {
        // Section 6, crashed: the hull comes apart along its length into five, and holds its orbit.
        const whole = i === 0;
        const min = part(mount.part).near.min[0], max = part(mount.part).near.max[0];
        const pieces = whole ? SHARDS : 1;
        for (let k = 0; k < pieces; k++) {
          shardOf(whole ? k : SHARDS, pieces === 1 ? 0.5 : (k + 0.5) / pieces, broken, shard);
          tmpW.set(shard.dx, shard.dy, shard.dz).multiplyScalar(asm.length * scale).add(tmpAt).applyQuaternion(c.quaternion).add(c.position);
          tmpShard.copy(q).multiply(tmpSpin.setFromAxisAngle(tmpFwd.set(shard.ax, shard.ay, shard.az), shard.angle));
          const from = pieces === 1 ? 0 : min + ((max - min) * k) / pieces;
          const to = pieces === 1 ? 0 : min + ((max - min) * (k + 1)) / pieces;
          const slot = bucket.put(tmpW, mounted, tmpShard, c.tone, c.gain, c.fill, fade, body, dashes, 0, centre, radius, fine, from, to, k + 1);
          if (slot < 0) this.stats.dropped += 1;
        }
        continue;
      }
      tmpW.copy(tmpAt).applyQuaternion(c.quaternion).add(c.position);
      const slot = bucket.put(tmpW, mounted, q, c.tone, c.gain, c.fill, fade, body, dashes, drive, centre, radius, fine);
      if (slot < 0) this.stats.dropped += 1;
      if (slot >= 0 && row) { const p = row.slots[row.used++]!; p.bucket = bucket; p.slot = slot; }
      this.addLights(c, mount.part, tmpAt, mounted, mount.spin ? c.ring ?? 0 : 0, scale, fade, s);
    }
    this.stats.ships += 1;
    if (row && s >= SHADOW_FROM) this.ranked.push(row);
  }

  private addLights(c: CraftDraw, id: PartId, at: THREE.Vector3, mounted: number, spin: number, scale: number, fade: number, s: number): void {
    const p = part(id);
    const strobe = c.strobe ?? 0;
    const lit = (0.32 + 0.68 * c.fill) * fade;
    const px = Math.max(1.6, Math.min(6, s * 0.009));
    if (spin !== 0) tmpSpin.setFromAxisAngle(xAxis, spin);
    for (let i = 0; i < p.spots.length; i++) {
      const spot = p.spots[i]!;
      const g = this.glintCount;
      if (g >= MAX_GLINTS) { this.stats.dropped += 1; break; }
      tmpV.set(spot.p[0], spot.p[1], spot.p[2]).multiplyScalar(mounted);
      if (spin !== 0) tmpV.applyQuaternion(tmpSpin);
      tmpV.add(at).applyQuaternion(c.quaternion).add(c.position);
      const k = g * 4;
      const strobing = spot.kind === 'strobe';
      this.glintA[k] = tmpV.x; this.glintA[k + 1] = tmpV.y; this.glintA[k + 2] = tmpV.z;
      this.glintA[k + 3] = px * (strobing ? 1 + strobe : 1);
      this.glintB[k + 3] = 0;
      this.glintColor[k] = c.tone.r; this.glintColor[k + 1] = c.tone.g; this.glintColor[k + 2] = c.tone.b;
      this.glintColor[k + 3] = lit * Math.min(c.gain, 2.4) * (strobing ? 0.42 + strobe * 2.6 : 0.6);
      this.glintCount = g + 1;
    }
    const drive = c.drive ?? 0;
    if (drive <= 0) return;
    for (let i = 0; i < p.nozzles.length; i++) {
      const n = p.nozzles[i]!;
      const g = this.glintCount;
      if (g >= MAX_GLINTS) { this.stats.dropped += 1; break; }
      tmpW.set(n.p[0], n.p[1], n.p[2]).multiplyScalar(mounted).add(at).applyQuaternion(c.quaternion).add(c.position);
      tmpFwd.set(n.dir[0], n.dir[1], n.dir[2]).applyQuaternion(c.quaternion);
      const worldR = n.r * mounted;
      const reach = worldR * (4 + 3.5 * drive);
      const depth = Math.max(0.01, -tmpV.copy(tmpW).applyMatrix4(this.camera!.matrixWorldInverse).z);
      const k = g * 4;
      this.glintA[k] = tmpW.x; this.glintA[k + 1] = tmpW.y; this.glintA[k + 2] = tmpW.z;
      this.glintA[k + 3] = Math.max(1.2, screenLength(worldR, depth, this.focal) * 0.62);
      this.glintB[k] = tmpW.x + tmpFwd.x * reach; this.glintB[k + 1] = tmpW.y + tmpFwd.y * reach; this.glintB[k + 2] = tmpW.z + tmpFwd.z * reach;
      this.glintB[k + 3] = worldR;
      this.glintColor[k] = OIII.r; this.glintColor[k + 1] = OIII.g; this.glintColor[k + 2] = OIII.b;
      this.glintColor[k + 3] = 1.25 * drive * fade;
      this.glintCount = g + 1;
    }
  }

  /** `pull` is how much of a ship is coming up through this mark. Only then does it stand off the hull, so a plain mark sits exactly where the craft is. */
  private addMark(c: CraftDraw, m: number, fade: number, planar: number, pull: number, fx: number, fy: number, fz: number, zx: number, zy: number): void {
    const i = this.markCount;
    if (i >= MAX_MARKS) { this.stats.dropped += 1; return; }
    markBasis(fx, fy, fz, zx, zy, c.held ?? 0, planar, m / 2, pose, basis);
    c.held = basis.heading;
    const k3 = i * 3;
    const k = i * 4;
    const reach = pull > 0 ? c.length ?? craftLength(c.kind, this.base) : 0;
    tmpV.setFromMatrixPosition(this.camera!.matrixWorld).sub(c.position).normalize().multiplyScalar(reach).add(c.position);
    this.markPos[k3] = tmpV.x; this.markPos[k3 + 1] = tmpV.y; this.markPos[k3 + 2] = tmpV.z;
    this.markBasis[k] = basis.ax; this.markBasis[k + 1] = basis.ay; this.markBasis[k + 2] = basis.bx; this.markBasis[k + 3] = basis.by;
    this.markIndex[i] = kindIndex(c.kind.hull, c.kind.role);
    this.markColor[k] = c.tone.r; this.markColor[k + 1] = c.tone.g; this.markColor[k + 2] = c.tone.b; this.markColor[k + 3] = c.gain;
    this.markStyle[k] = c.fill; this.markStyle[k + 1] = c.dashed ? 7 : 0; this.markStyle[k + 2] = fade; this.markStyle[k + 3] = c.broken ?? 0;
    this.markCount = i + 1;
    this.stats.marks += 1;
  }

  /** Uploads what the frame added, and renders the shadow atlas when a ship is close enough to need it. */
  commit(renderer: THREE.WebGLRenderer): void {
    if (!this.sync && !this.warming) this.warm(renderer);
    // Largest first: four ships share the atlas, and those are the ones you can see the shadows on.
    const ranked = this.ranked;
    ranked.sort(byLength);
    const casters = Math.min(ranked.length, SHADOW_TILES);
    for (let r = 0; r < casters; r++) {
      const row = ranked[r]!;
      shadowTile(r, casters, tile);
      const strength = shadowStrength(row.s);
      for (let i = 0; i < row.used; i++) {
        const place = row.slots[i]!;
        place.bucket.setTile(place.slot, tile.x, tile.y, tile.size, strength);
      }
    }
    const st = this.stats;
    for (let i = 0; i < this.buckets.length; i++) {
      const b = this.buckets[i]!;
      b.commit();
      st.triangles += b.triangles * b.count;
    }
    for (const set of this.sets.values()) {
      if (set.near.count > 0) st.nearDraws += 1;
      if (set.far.count > 0) st.farDraws += 1;
      if (set.speck.count > 0) st.speckDraws += 1;
      set.near.shadow.visible = casters > 0 && set.near.count > 0;
    }
    st.casters = casters;
    st.glints = this.glintCount;
    this.markGeometry.instanceCount = this.markCount;
    this.marks.visible = this.markCount > 0;
    for (let i = 0; i < this.markRanges.length; i++) this.markRanges[i]!.flush(this.markCount);
    this.glintGeometry.instanceCount = this.glintCount;
    this.glints.visible = this.glintCount > 0;
    for (let i = 0; i < this.glintRanges.length; i++) this.glintRanges[i]!.flush(this.glintCount);

    // A shadow sampler refuses to draw against a texture that was never made. The first frame primes it, and a lost context comes back here too.
    const fresh = (renderer.properties.get(this.target) as { __webglFramebuffer?: unknown }).__webglFramebuffer === undefined;
    if (casters > 0 || this.casting || fresh) {
      const target = renderer.getRenderTarget();
      renderer.setRenderTarget(this.target);
      renderer.clear(false, true, false);
      if (casters > 0) renderer.render(this.shadowScene, this.shadowCamera);
      renderer.setRenderTarget(target);
    }
    this.casting = casters > 0;
  }

  dispose(): void {
    this.worker?.terminate();
    this.probe?.ship.dispose();
    this.probe?.torn.dispose();
    this.probe?.geometry.dispose();
    this.target.depthTexture?.dispose();
    this.target.dispose();
    this.atlas.dispose();
    this.uniforms.uGrain.value?.dispose();
    this.uniforms.uCrumple.value?.dispose();
    for (const b of this.buckets) b.dispose();
    for (const set of this.sets.values()) { set.texture.dispose(); set.material.dispose(); set.tornMaterial?.dispose(); }
    this.shadowMaterial.dispose();
    (this.marks.material as THREE.Material).dispose();
    (this.glints.material as THREE.Material).dispose();
    this.markGeometry.dispose();
    this.glintGeometry.dispose();
  }
}

const byLength = (a: Row, b: Row): number => b.s - a.s;

