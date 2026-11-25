// Turns a genome into cube maps, a few tiles a frame, so a bake takes as long as it takes and no frame pays for it. There is no timer query
// here: the app's Meter holds one open during offscreen passes, and WebGL does not nest them. The cost per tile is a constant measured on the
// Arc, which a slower machine can answer by lowering budgetMs.
import type { PlanetGenome } from '@naos/protocol';
import * as THREE from 'three';
import { cloudCut, cubeBytes, hasClouds, hasOcean, heightRange, isFluid, reliefAmplitude, seaLevel, seedVector } from './params.ts';
import { Region, type RegionHost, type RegionTargets } from './region.ts';
import { PATCH_SIZE, patchMatrices, type RegionLevel } from './region-plan.ts';
import { BAND_LUT_SIZE, buildArcs, buildBandLut, buildRayCraters, buildRingLut, buildStorms, buildVents, linearOf, packCities, RING_LUT_SIZE, type PackedCities, type PlanetCity } from './tables.ts';
import { buildNoiseVolume, VOLUME_SIZE } from './volume.ts';
import bakeVert from './shaders/bake.vert?raw';
import albedoFluidFrag from './shaders/albedo-fluid.frag?raw';
import albedoSolidFrag from './shaders/albedo-solid.frag?raw';
import cityFrag from './shaders/city.frag?raw';
import cityVert from './shaders/city.vert?raw';
import cloudFrag from './shaders/cloud.frag?raw';
import fieldFrag from './shaders/field.frag?raw';
import lightsFrag from './shaders/lights.frag?raw';
import noiseFrag from './shaders/noise.frag?raw';
import reliefFrag from './shaders/relief.frag?raw';

/** Column vectors of a cube face, in the order the GL cube map spec gives them: s, t, major axis. */
const FACES: readonly (readonly number[])[] = [
  [0, 0, -1, 0, -1, 0, 1, 0, 0],
  [0, 0, 1, 0, -1, 0, -1, 0, 0],
  [1, 0, 0, 0, 0, 1, 0, 1, 0],
  [1, 0, 0, 0, 0, -1, 0, -1, 0],
  [1, 0, 0, 0, -1, 0, 0, 0, 1],
  [-1, 0, 0, 0, -1, 0, 0, 0, -1],
];

// Large enough that a frame spends its budget in a few draws, small enough that no single draw is a hitch.
const TILE = 256;
/** One unit of tile cost on this Arc, with a margin: a 1024 bake read 1.3 back through a blocking readback. */
const NS_PER_COST = 2;
const LIGHTS_MAX = 1024;
const FACE_MATRICES = FACES.map((f) => new THREE.Matrix3().fromArray(f));

export interface PlanetBake {
  size: number;
  albedo: THREE.WebGLCubeRenderTarget;
  relief: THREE.WebGLCubeRenderTarget | null;
  clouds: THREE.WebGLCubeRenderTarget | null;
  lights: THREE.WebGLCubeRenderTarget | null;
  band: THREE.DataTexture | null;
  ring: THREE.DataTexture | null;
  bytes: number;
  ready: boolean;
}

export interface BakeStats { jobs: number; tiles: number; msCpu: number; lastJobMs: number }

interface Job {
  genome: PlanetGenome;
  size: number;
  bake: PlanetBake;
  cities: PackedCities | null;
  steps: Generator<number, void, unknown>;
  priority: number;
  startedAt: number;
  onDone: (bake: PlanetBake) => void;
  cancelled: boolean;
}

function cube(size: number, options: THREE.RenderTargetOptions): THREE.WebGLCubeRenderTarget {
  return new THREE.WebGLCubeRenderTarget(size, { depthBuffer: false, stencilBuffer: false, generateMipmaps: false, ...options });
}

export function dataStrip(data: Uint8Array, size: number, colorSpace: THREE.ColorSpace): THREE.DataTexture {
  const t = new THREE.DataTexture(data, size, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = true;
  t.colorSpace = colorSpace;
  t.needsUpdate = true;
  return t;
}

export function buildNoiseTexture3D(): THREE.Data3DTexture {
  const t = new THREE.Data3DTexture(buildNoiseVolume(), VOLUME_SIZE, VOLUME_SIZE, VOLUME_SIZE);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

export class Baker implements RegionHost {
  readonly noise: THREE.Data3DTexture;
  readonly stats: BakeStats = { jobs: 0, tiles: 0, msCpu: 0, lastJobMs: 0 };
  /** GPU milliseconds a frame may spend. A 1024 bake then takes about 1.5 s at 60 Hz, and it runs while the camera is still far away. */
  budgetMs = 2;
  readonly region: Region;
  readonly anisotropy: number;
  readonly fieldType: THREE.TextureDataType;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly mesh: THREE.Mesh;
  private readonly materials = new Map<string, THREE.ShaderMaterial>();
  private queue: Job[] = [];
  private patchSteps: Generator<number, void, unknown> | null = null;
  private scratch: THREE.WebGLCubeRenderTarget | null = null;
  private warmTarget: THREE.WebGLRenderTarget | null = null;
  private gl: WebGL2RenderingContext;
  private flat: THREE.WebGLCubeRenderTarget | null = null;
  private clear: THREE.WebGLCubeRenderTarget | null = null;
  private readonly blackStrip: THREE.DataTexture;

  constructor(renderer: THREE.WebGLRenderer, noise?: THREE.Data3DTexture) {
    this.renderer = renderer;
    this.noise = noise ?? buildNoiseTexture3D();
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    this.gl.getExtension('EXT_color_buffer_float');
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.mesh = new THREE.Mesh(g);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.blackStrip = dataStrip(new Uint8Array(8), 2, THREE.NoColorSpace);
    this.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    // Half floats round a height of 0.03 radii to steps of 3e-5, and normals taken from that are contour lines all over a smooth plain.
    this.fieldType = renderer.extensions.has('OES_texture_float_linear') ? THREE.FloatType : THREE.HalfFloatType;
    this.region = new Region(this);
  }

  private material(name: string, frag: string, withNoise: boolean, patch = false): THREE.ShaderMaterial {
    const key = patch ? `${name}-patch` : name;
    let m = this.materials.get(key);
    if (m) return m;
    m = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: bakeVert,
      fragmentShader: (withNoise ? noiseFrag : '') + frag,
      defines: patch ? { PATCH: 1 } : {},
      uniforms: {},
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      toneMapped: false,
    });
    this.materials.set(key, m);
    return m;
  }

  /**
   * Runs a compile against a render target, as every real draw has. three keys its programs on the output colour space, which follows the
   * target, so a compile against the screen would build programs that no draw here ever uses.
   */
  async compileOffscreen(scene: THREE.Scene, camera: THREE.Camera): Promise<void> {
    const r = this.renderer;
    const before = r.getRenderTarget();
    this.warmTarget ??= new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: false });
    r.setRenderTarget(this.warmTarget);
    const done = r.compileAsync(scene, camera);
    r.setRenderTarget(before);
    await done;
  }

  /** Programs start compiling here, on the driver's threads, so no bake waits on the main thread for them. */
  async warm(): Promise<void> {
    const list = [
      this.material('field', fieldFrag, true), this.material('relief', reliefFrag, false),
      this.material('solid', albedoSolidFrag, true), this.material('fluid', albedoFluidFrag, true), this.material('cloud', cloudFrag, true),
      this.material('lights', lightsFrag, false), this.material('relief', reliefFrag, false, true), this.material('solid', albedoSolidFrag, true, true),
    ];
    this.placeholders();
    for (const m of list) {
      this.mesh.material = m;
      this.setUniforms(m);
      await this.compileOffscreen(this.scene, this.camera);
    }
    const stamp = new THREE.Scene();
    const quad = new THREE.Mesh(this.cityGeometry(), this.cityMaterial());
    quad.frustumCulled = false;
    stamp.add(quad);
    await this.compileOffscreen(stamp, this.camera);
  }

  private cityGeometry(cities: PackedCities = { point: new Float32Array(4), kind: new Float32Array(2), count: 1 }): THREE.InstancedBufferGeometry {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.setAttribute('iPoint', new THREE.InstancedBufferAttribute(cities.point, 4));
    g.setAttribute('iKind', new THREE.InstancedBufferAttribute(cities.kind, 2));
    g.instanceCount = cities.count;
    return g;
  }

  private setUniforms(m: THREE.ShaderMaterial, values: Record<string, unknown> = {}): void {
    const u = m.uniforms;
    const defaults: Record<string, unknown> = { uNoise: this.noise, uFace: FACE_MATRICES[0], ...values };
    for (const [k, v] of Object.entries(defaults)) {
      if (u[k]) u[k].value = v;
      else u[k] = { value: v };
    }
  }

  /**
   * Fills a cube with one value by drawing it. Never with renderer.clear: three encodes the clear colour by the target bound when it is set,
   * so changing and restoring it here would leave the wrong encoding for the next clear anywhere else in the app.
   */
  private paint(target: THREE.WebGLCubeRenderTarget, value: THREE.Vector4): void {
    const r = this.renderer;
    const before = r.getRenderTarget();
    const autoClear = r.autoClear;
    r.autoClear = false;
    const m = this.constantMaterial();
    m.uniforms.uValue!.value = value;
    this.mesh.material = m;
    for (let f = 0; f < 6; f++) {
      r.setRenderTarget(target, f);
      r.render(this.scene, this.camera);
    }
    r.autoClear = autoClear;
    r.setRenderTarget(before);
  }

  private constantMaterial(): THREE.ShaderMaterial {
    let m = this.materials.get('constant');
    if (m) return m;
    m = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: bakeVert,
      fragmentShader: 'uniform vec4 uValue;\nout vec4 o;\nvoid main() { o = uValue; }',
      uniforms: { uValue: { value: new THREE.Vector4() } },
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      toneMapped: false,
    });
    this.materials.set('constant', m);
    return m;
  }

  private placeholders(): { flat: THREE.WebGLCubeRenderTarget; clear: THREE.WebGLCubeRenderTarget } {
    if (this.flat && this.clear) return { flat: this.flat, clear: this.clear };
    const flat = cube(2, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    const clear = cube(2, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.paint(flat, new THREE.Vector4(0.5, 0.5, 0.5, 0.5));
    this.paint(clear, new THREE.Vector4(0, 0, 0, 0));
    this.flat = flat;
    this.clear = clear;
    return { flat, clear };
  }

  private allocate(g: PlanetGenome, size: number): PlanetBake {
    const mipped = (colorSpace: THREE.ColorSpace, anisotropy: number, s = size) => cube(s, {
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      colorSpace,
      anisotropy,
    });
    const aniso = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    const fluid = isFluid(g);
    const clouded = hasClouds(g);
    const albedo = mipped(THREE.SRGBColorSpace, aniso);
    const relief = fluid ? null : mipped(THREE.NoColorSpace, aniso);
    const clouds = clouded ? mipped(THREE.NoColorSpace, 1, Math.min(size, 1024)) : null;
    const lights = g.terrain.volcanism > 0 && !fluid ? this.lightCube(size) : null;
    let bytes = cubeBytes(size, 4);
    if (lights) bytes += cubeBytes(lights.width, 4);
    if (relief) bytes += cubeBytes(size, 4);
    if (clouds) bytes += cubeBytes(clouds.width, 4);
    const band = fluid ? dataStrip(buildBandLut(g), BAND_LUT_SIZE, THREE.SRGBColorSpace) : null;
    const ring = g.rings ? dataStrip(buildRingLut(g), RING_LUT_SIZE, THREE.SRGBColorSpace) : null;
    // Ring optical depth is in alpha, which an sRGB format leaves linear.
    return { size, albedo, relief, clouds, lights, band, ring, bytes, ready: false };
  }

  /** Half the surface resolution is plenty for something seen only at night. */
  private lightCube(size: number): THREE.WebGLCubeRenderTarget {
    return cube(Math.min(size, LIGHTS_MAX), { minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, colorSpace: THREE.NoColorSpace });
  }

  /** Lights places on the surface. Adds to what is there, so new history costs only its own points, and never a rebake. */
  stamp(bake: PlanetBake, genome: PlanetGenome, cities: PackedCities): void {
    if (cities.count === 0) return;
    const r = this.renderer;
    const target = r.getRenderTarget();
    const autoClear = r.autoClear;
    r.autoClear = false;
    if (!bake.lights) {
      bake.lights = this.lightCube(bake.size);
      bake.bytes += cubeBytes(bake.lights.width, 4);
      this.paint(bake.lights, new THREE.Vector4(0, 0, 0, 1));
    }
    const g = this.cityGeometry(cities);
    const m = this.cityMaterial();
    m.uniforms.uAlbedo!.value = bake.albedo.texture;
    m.uniforms.uOceans!.value = hasOcean(genome) ? 1 : 0;
    m.uniforms.uNoise!.value = this.noise;
    m.uniforms.uFine!.value = Math.min(1, bake.lights.width / 256);
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(mesh);
    for (let f = 0; f < 6; f++) {
      m.uniforms.uFace!.value = FACE_MATRICES[f];
      r.setRenderTarget(bake.lights, f);
      r.render(scene, this.camera);
    }
    g.dispose();
    this.mipmaps(bake.lights);
    r.autoClear = autoClear;
    r.setRenderTarget(target);
  }

  private cityMaterial(): THREE.ShaderMaterial {
    let m = this.materials.get('city');
    if (m) return m;
    m = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: cityVert,
      fragmentShader: noiseFrag + cityFrag,
      uniforms: { uFace: { value: FACE_MATRICES[0] }, uAlbedo: { value: null }, uOceans: { value: 0 }, uNoise: { value: this.noise }, uFine: { value: 1 } },
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.MaxEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    });
    this.materials.set('city', m);
    return m;
  }

  /** A shared flat relief and an empty cloud layer, for bodies that have none. */
  get flatRelief(): THREE.Texture { return this.placeholders().flat.texture; }
  get emptyCube(): THREE.Texture { return this.placeholders().clear.texture; }
  get emptyStrip(): THREE.Texture { return this.blackStrip; }

  /** Starts a bake. Lower priority numbers go first. */
  enqueue(genome: PlanetGenome, size: number, priority: number, onDone: (bake: PlanetBake) => void, cities: readonly PlanetCity[] = []): PlanetBake {
    const bake = this.allocate(genome, size);
    const packed = cities.length ? packCities(cities) : null;
    const job: Job = { genome, size, bake, cities: packed, priority, onDone, cancelled: false, startedAt: 0, steps: this.run(genome, bake, packed) };
    this.queue.push(job);
    // A job that has started keeps its place: all jobs share the scratch field, so none may be interrupted.
    this.queue.sort((a, b) => (b.startedAt > 0 ? 1 : 0) - (a.startedAt > 0 ? 1 : 0) || a.priority - b.priority);
    return bake;
  }

  cancel(bake: PlanetBake): void {
    const job = this.queue.find((j) => j.bake === bake);
    if (job) { job.cancelled = true; this.queue = this.queue.filter((j) => j !== job); }
    this.dispose(bake);
  }

  dispose(bake: PlanetBake): void {
    bake.albedo.dispose();
    bake.relief?.dispose();
    bake.clouds?.dispose();
    bake.lights?.dispose();
    bake.band?.dispose();
    bake.ring?.dispose();
  }

  get busy(): boolean { return this.queue.length > 0 || this.region.busy; }

  /** The shared programs and scratch. Planets dispose their own textures. */
  destroy(): void {
    for (const m of this.materials.values()) m.dispose();
    this.materials.clear();
    this.region.release();
    this.scratch?.dispose();
    this.warmTarget?.dispose();
    this.flat?.dispose();
    this.clear?.dispose();
    this.blackStrip.dispose();
    this.noise.dispose();
    this.mesh.geometry.dispose();
  }

  /** After a lost context. three rebuilds its own state, but nothing rendered into a target has survived, and no running job can go on. */
  restored(): void {
    this.queue = [];
    this.scratch = null;
    this.flat = null;
    this.clear = null;
    this.region.restored();
  }

  /** Scratch is 6 cube faces of half floats at the largest bake, and held only for a bake. */
  releaseScratch(): void {
    this.scratch?.dispose();
    this.scratch = null;
  }

  private *faces(material: THREE.ShaderMaterial, target: THREE.WebGLCubeRenderTarget, pixelCost: number, uniforms: Record<string, unknown>): Generator<number, void, unknown> {
    const size = target.width;
    const tile = Math.min(TILE, size);
    for (let f = 0; f < 6; f++) {
      for (let y = 0; y < size; y += tile) {
        for (let x = 0; x < size; x += tile) {
          this.setUniforms(material, uniforms);
          material.uniforms.uFace!.value = FACE_MATRICES[f];
          target.scissor.set(x, y, Math.min(tile, size - x), Math.min(tile, size - y));
          target.scissorTest = true;
          this.mesh.material = material;
          this.renderer.setRenderTarget(target, f);
          this.renderer.render(this.scene, this.camera);
          yield Math.min(tile, size - x) * Math.min(tile, size - y) * pixelCost;
        }
      }
    }
    target.scissorTest = false;
  }

  /** One target tile by tile, for a patch. The same bake as a cube face, under another matrix. */
  private *tiles(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget, pixelCost: number, uniforms: Record<string, unknown>): Generator<number, void, unknown> {
    const size = target.width;
    for (let y = 0; y < size; y += TILE) {
      for (let x = 0; x < size; x += TILE) {
        this.setUniforms(material, uniforms);
        target.scissor.set(x, y, Math.min(TILE, size - x), Math.min(TILE, size - y));
        target.scissorTest = true;
        this.mesh.material = material;
        this.renderer.setRenderTarget(target);
        this.renderer.render(this.scene, this.camera);
        yield Math.min(TILE, size - x) * Math.min(TILE, size - y) * pixelCost;
      }
    }
    target.scissorTest = false;
  }

  private surfaceUniforms(g: PlanetGenome, texel: number, detail: number): Record<string, unknown> {
    const rays = buildRayCraters(g);
    const arcs = buildArcs(g);
    const vents = buildVents(g);
    return {
      uSeed: new THREE.Vector3(...seedVector(g.seed)), uFreq: 0.55 + 1.7 * g.terrain.scale, uWarp: 0.9, uSea: seaLevel(g), uOceans: hasOcean(g) ? 1 : 0,
      uRelief: reliefAmplitude(g), uRough: g.terrain.roughness, uCraters: g.terrain.craters, uBasins: g.terrain.basins,
      uFractures: g.terrain.fractures, uWorn: Math.min(1, g.atmosphere.density * 6), uTexel: texel, uDetail: Math.max(5, detail), uRay: rays.list, uRayCount: rays.count,
      uArcA: arcs.a, uArcB: arcs.b, uArcC: arcs.c, uArcCount: arcs.count, uVent: vents.place, uVentLook: vents.look, uVentCount: vents.count,
    };
  }

  private paintUniforms(g: PlanetGenome, detail: number): Record<string, unknown> {
    const c = (hex: string) => new THREE.Vector3(...linearOf(hex));
    return {
      uSeed: new THREE.Vector3(...seedVector(g.seed)), uLow: c(g.palette.low), uMid: c(g.palette.mid), uHigh: c(g.palette.high), uAccent: c(g.palette.accent), uPole: c(g.palette.pole),
      uDeep: c(g.oceans.deep), uShallow: c(g.oceans.shallow), uShelf: g.oceans.shelf, uOceans: hasOcean(g) ? 1 : 0, uMoisture: g.terrain.moisture,
      uVegetation: g.archetype === 'terran' || g.archetype === 'ocean' ? 1 : 0, uCaps: g.terrain.caps, uHeightMax: heightRange(g),
      uFractures: g.terrain.fractures, uVolcano: g.terrain.volcanism, uDetail: Math.max(5, detail),
    };
  }

  /** The bake of one patch: the same three passes as a planet's surface, at the size of this patch. */
  *patchJob(g: PlanetGenome, level: RegionLevel, targets: RegionTargets, field: THREE.WebGLRenderTarget): Generator<number, void, unknown> {
    const texel = (2 * level.width) / PATCH_SIZE;
    const detail = Math.min(14, Math.round(Math.log2((Math.PI / 2) / texel)));
    const { face, inverse } = patchMatrices(level);
    const uFace = new THREE.Matrix3().fromArray(face);
    const uFaceInv = new THREE.Matrix3().fromArray(inverse);
    yield* this.tiles(this.material('field', fieldFrag, true), field, 5.5, { ...this.surfaceUniforms(g, texel, detail), uFace });
    yield* this.tiles(this.material('relief', reliefFrag, false, true), targets.relief, 0.6, {
      uField: field.texture, uFace, uFaceInv, uTexel: texel, uHeightMax: heightRange(g), uOceans: hasOcean(g) ? 1 : 0,
    });
    yield* this.tiles(this.material('solid', albedoSolidFrag, true, true), targets.albedo, 2, {
      ...this.paintUniforms(g, detail), uField: field.texture, uRelief: targets.relief.texture, uFace,
    });
    this.mipmaps2D(targets.albedo);
    this.mipmaps2D(targets.relief);
  }

  private fieldTarget(size: number): THREE.WebGLCubeRenderTarget {
    if (this.scratch && this.scratch.width === size) return this.scratch;
    this.scratch?.dispose();
    this.scratch = cube(size, { type: this.fieldType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    return this.scratch;
  }

  private *run(g: PlanetGenome, bake: PlanetBake, cities: PackedCities | null): Generator<number, void, unknown> {
    const size = bake.size;
    const texel = (Math.PI / 2) / size;
    const seedV = new THREE.Vector3(...seedVector(g.seed));
    const detail = Math.round(Math.log2(size)) ;
    const c = (hex: string) => new THREE.Vector3(...linearOf(hex));
    const storms = buildStorms(g);
    const stormUniforms = { uStorm: storms.place, uStormLook: storms.look, uStormCount: storms.count };

    if (isFluid(g)) {
      yield* this.faces(this.material('fluid', albedoFluidFrag, true), bake.albedo, 2.5, {
        uSeed: seedV, uBand: bake.band, uAccent: c(g.palette.accent), uHigh: c(g.palette.high),
        uTurbulence: g.bands.turbulence, uFine: Math.min(detail + 1, 10), uChevron: g.archetype === 'shrouded' ? 1 : 0, ...stormUniforms,
      });
    } else {
      const field = this.fieldTarget(size);
      yield* this.faces(this.material('field', fieldFrag, true), field, 4, this.surfaceUniforms(g, texel, detail));
      yield* this.faces(this.material('relief', reliefFrag, false), bake.relief!, 0.6, {
        uField: field.texture, uTexel: texel, uHeightMax: heightRange(g), uOceans: hasOcean(g) ? 1 : 0,
      });
      yield* this.faces(this.material('solid', albedoSolidFrag, true), bake.albedo, 1.6, {
        ...this.paintUniforms(g, detail), uField: field.texture, uRelief: bake.relief!.texture,
      });
    }

    if (bake.clouds) {
      yield* this.faces(this.material('cloud', cloudFrag, true), bake.clouds, 2, {
        uSeed: seedV, uCut: cloudCut(g.clouds.coverage), uScale: g.clouds.scale, uWisps: g.clouds.wisps,
        uBanded: isFluid(g) ? 1 : 0, uThin: 0.3 + 0.7 * Math.min(1, g.clouds.coverage / 0.25), uDetail: Math.max(4, detail - 2), ...stormUniforms,
      });
    }
    if (bake.lights) {
      const field = this.fieldTarget(size);
      yield* this.faces(this.material('lights', lightsFrag, false), bake.lights, 0.3, { uField: field.texture });
    }
    for (const t of [bake.albedo, bake.relief, bake.clouds, bake.lights]) if (t) this.mipmaps(t);
    if (cities) this.stamp(bake, g, cities);
    bake.ready = true;
  }

  /** Mips only once all faces are done: three would rebuild them after every tile. */
  private mipmaps(target: THREE.WebGLCubeRenderTarget): void {
    const gl = this.gl;
    const props = this.renderer.properties.get(target.texture) as { __webglTexture: WebGLTexture };
    this.renderer.state.bindTexture(gl.TEXTURE_CUBE_MAP, props.__webglTexture);
    gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
    this.renderer.state.unbindTexture();
  }

  private mipmaps2D(target: THREE.WebGLRenderTarget): void {
    const gl = this.gl;
    const props = this.renderer.properties.get(target.texture) as { __webglTexture: WebGLTexture };
    this.renderer.state.bindTexture(gl.TEXTURE_2D, props.__webglTexture);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.renderer.state.unbindTexture();
  }

  /** Runs tiles until the budget for this frame is gone. Returns true while there is more to do. */
  step(budgetMs = this.budgetMs): boolean {
    if (!this.queue.length && !this.region.busy) return false;
    const r = this.renderer;
    const target = r.getRenderTarget();
    const autoClear = r.autoClear;
    const cpu = performance.now();
    r.autoClear = false;
    let spent = 0;
    while (this.queue.length && spent < budgetMs) {
      const job = this.queue[0]!;
      if (job.startedAt === 0) job.startedAt = performance.now();
      const next = job.steps.next();
      if (next.done) {
        this.queue.shift();
        this.stats.jobs++;
        this.stats.lastJobMs = performance.now() - job.startedAt;
        if (!job.cancelled) job.onDone(job.bake);
        if (!this.queue.length) this.releaseScratch();
        continue;
      }
      this.stats.tiles++;
      spent += (next.value * NS_PER_COST) / 1e6;
    }
    // Ground under the camera comes after whole planets, and it picks up where it stopped.
    while (spent < budgetMs && this.region.busy) {
      this.patchSteps ??= this.region.work();
      const next = this.patchSteps.next();
      if (next.done) { this.patchSteps = null; if (!this.region.busy) break; continue; }
      this.stats.tiles++;
      spent += (next.value * NS_PER_COST) / 1e6;
    }
    this.stats.msCpu += performance.now() - cpu;
    r.autoClear = autoClear;
    r.setRenderTarget(target);
    return this.busy;
  }

  /** Everything now, for a lab page that has nothing else to show. */
  flush(): void {
    while (this.step(1e9));
  }
}

