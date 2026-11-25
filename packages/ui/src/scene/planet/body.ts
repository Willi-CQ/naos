// One planet in the scene: the sphere, its rings, and the textures it has at the moment. Everything it needs per frame arrives through
// update(), so it works wherever the camera happens to be.
import type { PlanetGenome } from '@naos/protocol';
import * as THREE from 'three';
import { Baker, type PlanetBake } from './bake.ts';
import { aurora } from './aurora.ts';
import { airOf, CLOUD_TOP, cloudRate, hasClouds, heightRange, isFluid, poleAzimuth, spinRate, type Air } from './params.ts';
import { planRegion, REGION_ALTITUDE, type V3 } from './region-plan.ts';
import { linearOf, packCities, RING_TAU_MAX, type PlanetCity } from './tables.ts';
import planetFrag from './shaders/planet.frag?raw';
import planetVert from './shaders/planet.vert?raw';
import ringFrag from './shaders/ring.frag?raw';
import ringVert from './shaders/ring.vert?raw';

/** What lights a planet. The accretion disk is wide along its plane and thin across it, so it counts as a bar of light, not as a point. */
export interface PlanetSource {
  position: THREE.Vector3;
  /** Normal of the disk plane. */
  normal: THREE.Vector3;
  /** Radius of the disk in world units. Sets how soft the terminator is at this distance. */
  radius: number;
  /** HDR colour. Multiply by quota and the planets dim with it. */
  color: THREE.Color;
}

export interface PlanetFrame {
  camera: THREE.PerspectiveCamera;
  source: PlanetSource;
  /** Seconds of simulated time. Planets rotate with it. */
  time: number;
  /** Height of the drawing buffer in device px. */
  height: number;
  /** When given, planets outside it cost nothing. */
  frustum?: THREE.Frustum;
}

export type PlanetTier = 0 | 1 | 2;

export const TIER_WORLD_PX = 110;
/** Tier 2 starts here and adds nothing yet, then its detail comes in down to the altitude below, so that no one height shows a change. */
const TIER_CRAFT_ALTITUDE = REGION_ALTITUDE;
const TIER_CRAFT_FULL = 0.6;
const CITY = [1.05, 0.66, 0.3] as const;
const EMBER = [1.3, 0.2, 0.14] as const;
/** Mips of blur on lights in a giant's deck: there is no ground for them to stand on, so they are a dim glow from below. */
const DECK_GLOW_BLUR = 4;
/** Accent to lava light. Lower than it might be: it is the brightest thing on a planet, and it must stay small. */
const LAVA_GAIN = 3;
/** Radians a wind of 1 carries the deck per second, at activity 0.6. */
const WIND = 0.012;
/** Below this many px of limb the air would vanish, so it is widened to stay a thin line. */
const MIN_AIR_PX = 1.1;

function quad(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

function ringMesh(segments: number): THREE.BufferGeometry {
  const position = new Float32Array((segments + 1) * 6);
  const index: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    position.set([0, a, 0, 1, a, 0], i * 6);
    if (i < segments) {
      const k = i * 2;
      index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setIndex(index);
  return g;
}

let sharedQuad: THREE.BufferGeometry | null = null;
let sharedRing: THREE.BufferGeometry | null = null;

const PREMULTIPLIED: THREE.ShaderMaterialParameters = {
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
  blendSrcAlpha: THREE.OneFactor,
  blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
};

const toSun = new THREE.Vector3();
const axisWorld = new THREE.Vector3();
const scratch = new THREE.Vector3();
const bound = new THREE.Sphere();
const scratchM = new THREE.Matrix4();
const scratchN = new THREE.Matrix3();
const forward = new THREE.Vector3();
const screenUp = new THREE.Vector3();
const screenRight = new THREE.Vector3();
const FRAME_RAYS = [[0, 0], [0, -1], [0, 1], [-1, 0], [1, 0], [-0.7, -1], [0.7, -1]] as const;

export interface PlanetBodyOptions {
  renderOrder?: number;
  /** Write the body into the depth buffer, for hulls that test against it. */
  writeDepth?: boolean;
  activity?: number;
}

export class PlanetBody {
  readonly group = new THREE.Group();
  readonly position = new THREE.Vector3();
  /** World units per radius. */
  radius = 1;
  activity: number;
  auroras = true;
  private readonly polarLights: ReturnType<typeof aurora>;
  genome: PlanetGenome;
  /** 0 to 1. Below 1 the planet is still spreading over whatever stands behind it. */
  reveal = 1;
  /** Set when lighting by another rule than the world's source, as the catalogue does. */
  sunOverride: THREE.Vector3 | null = null;

  private readonly baker: Baker;
  private readonly mesh: THREE.Mesh;
  private readonly ringMesh: THREE.Mesh;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly ringUniforms: Record<string, THREE.IUniform>;
  private readonly tiers: THREE.ShaderMaterial[];
  private readonly toBody = new THREE.Matrix3();
  private readonly unproject = new THREE.Matrix4();
  private readonly tilt = new THREE.Quaternion();
  private tier: PlanetTier = 0;
  private cities: PlanetCity[] = [];
  private bake: PlanetBake | null = null;
  private pending: PlanetBake | null = null;
  private sharpen = 0;
  private lastPx = 0;
  private altitude = Infinity;
  private revealSet = false;
  private air: Air;
  private lastTime: number | null = null;
  private flow = 0;
  private spin = 0;
  private deckAngle = 0;
  private highAngle = 0;

  constructor(baker: Baker, genome: PlanetGenome, options: PlanetBodyOptions = {}) {
    this.baker = baker;
    this.genome = genome;
    this.air = airOf(genome);
    this.activity = options.activity ?? 0.3;
    sharedQuad ??= quad();
    sharedRing ??= ringMesh(160);

    this.uniforms = {
      uCentre: { value: new THREE.Vector3() }, uScale: { value: 1 }, uBound: { value: 1 }, uBody: { value: new THREE.Matrix3() }, uUnproject: { value: new THREE.Matrix4() },
      uAlbedo: { value: baker.emptyCube }, uRelief: { value: baker.flatRelief }, uClouds: { value: baker.emptyCube }, uLights: { value: baker.emptyCube },
      uBand: { value: baker.emptyStrip }, uRing: { value: baker.emptyStrip }, uNoise: { value: baker.noise },
      uCam: { value: new THREE.Vector3() }, uSun: { value: new THREE.Vector3(1, 0, 0) }, uSunAxis: { value: new THREE.Vector3(0, 0, 1) },
      uLight: { value: new THREE.Color(1, 1, 1) }, uSoft: { value: new THREE.Vector2(0.02, 0.1) }, uPx: { value: 0.001 },
      uH: { value: 0.004 }, uTop: { value: 1 }, uTauR: { value: new THREE.Vector3() }, uTauM: { value: 0 }, uHazeColor: { value: new THREE.Vector3(1, 1, 1) }, uMulti: { value: 2.5 },
      uCloudTop: { value: CLOUD_TOP }, uCloudColor: { value: new THREE.Vector3(1, 1, 1) }, uCloudSpin: { value: new THREE.Vector4(1, 0, 1, 0) }, uCloudOn: { value: 0 }, uCloudShadow: { value: 0.72 },
      uLava: { value: new THREE.Vector3() }, uCity: { value: new THREE.Vector3(1.05, 0.66, 0.3) }, uEmber: { value: new THREE.Vector3(1.3, 0.2, 0.14) }, uLightsOn: { value: 0 }, uLightBlur: { value: 0 },
      uGlint: { value: 0 }, uSkyTint: { value: new THREE.Vector3() }, uLommel: { value: 0 }, uLimbDark: { value: 0 },
      uClose: { value: 0 }, uPW: { value: new THREE.Vector3(1, 1, 1) }, uPOn: { value: new THREE.Vector3() },
      uA0: { value: baker.emptyStrip }, uA1: { value: baker.emptyStrip }, uA2: { value: baker.emptyStrip },
      uR0: { value: baker.emptyStrip }, uR1: { value: baker.emptyStrip }, uR2: { value: baker.emptyStrip },
      uP0: { value: new THREE.Matrix3() }, uP1: { value: new THREE.Matrix3() }, uP2: { value: new THREE.Matrix3() },
      uRough: { value: 0.5 }, uRidge: { value: 0 }, uFlowOn: { value: 0 }, uFlow: { value: new THREE.Vector4() }, uBias: { value: 0 }, uHeightMax: { value: 0 },
      uViewProj: { value: new THREE.Matrix4() }, uRingBand: { value: new THREE.Vector4(1.3, 2.2, 1, 0) }, uRingTauMax: { value: RING_TAU_MAX }, uOccluder: { value: new THREE.Vector4() }, uReveal: { value: 1 }, uRevealAxis: { value: new THREE.Vector3(0, 0, 1) },
    };

    const defines = (tier: number): Record<string, number | string> => (options.writeDepth ? { TIER: tier, WRITE_DEPTH: 1 } : { TIER: tier });
    this.tiers = [0, 1, 2].map((tier) => new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: planetVert,
      fragmentShader: planetFrag,
      uniforms: this.uniforms,
      defines: defines(tier),
      toneMapped: false,
      transparent: true,
      // GL writes depth only with the test on. Always passing keeps the draw order what it was, and gives hulls a sphere to stand behind.
      depthTest: Boolean(options.writeDepth),
      depthFunc: THREE.AlwaysDepth,
      depthWrite: Boolean(options.writeDepth),
      side: THREE.DoubleSide,
      ...PREMULTIPLIED,
    }));
    this.mesh = new THREE.Mesh(sharedQuad, this.tiers[0]!);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = options.renderOrder ?? 9;

    this.ringUniforms = {
      uCentre: this.uniforms.uCentre!, uScale: this.uniforms.uScale!, uBody: this.uniforms.uBody!, uRadii: { value: new THREE.Vector2(1.3, 2.2) },
      uRing: this.uniforms.uRing!, uCam: this.uniforms.uCam!, uSun: this.uniforms.uSun!, uLight: this.uniforms.uLight!, uSoft: this.uniforms.uSoft!,
      uRingBand: this.uniforms.uRingBand!, uRingTauMax: this.uniforms.uRingTauMax!, uReveal: this.uniforms.uReveal!,
    };
    const ringMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: ringVert, fragmentShader: ringFrag, uniforms: this.ringUniforms, toneMapped: false,
      transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide, ...PREMULTIPLIED,
    });
    this.ringMesh = new THREE.Mesh(sharedRing, ringMaterial);
    this.ringMesh.frustumCulled = false;
    this.ringMesh.renderOrder = this.mesh.renderOrder + 0.5;
    this.ringMesh.visible = false;

    this.polarLights = aurora(genome, this.uniforms);
    this.group.add(this.mesh, this.ringMesh, this.polarLights);
    this.applyGenome();
  }

  private applyGenome(): void {
    const g = this.genome;
    const u = this.uniforms;
    const air = airOf(g);
    this.air = air;
    (u.uTauR!.value as THREE.Vector3).set(...air.tauR);
    u.uTauM!.value = air.tauM;
    (u.uHazeColor!.value as THREE.Vector3).set(...air.haze);
    (u.uSkyTint!.value as THREE.Vector3).set(...air.sky);
    u.uMulti!.value = air.multi;
    u.uTop!.value = air.on ? 2 : 1;
    (u.uCloudColor!.value as THREE.Vector3).set(...linearOf(g.clouds.color));
    u.uCloudOn!.value = hasClouds(g) ? 1 : 0;
    u.uGlint!.value = isFluid(g) ? 0 : g.oceans.glint;
    const airless = !air.on || g.atmosphere.density < 0.05;
    u.uLommel!.value = airless ? 1 : 0;
    u.uLimbDark!.value = g.archetype === 'gas' || g.archetype === 'ice-giant' ? 0.14 : g.archetype === 'shrouded' ? 0.1 : 0;
    u.uFlowOn!.value = isFluid(g) ? 1 : 0;
    u.uLightBlur!.value = isFluid(g) ? DECK_GLOW_BLUR : 0;
    (u.uCity!.value as THREE.Vector3).set(...CITY).multiplyScalar(isFluid(g) ? 0.5 : 1);
    (u.uEmber!.value as THREE.Vector3).set(...EMBER).multiplyScalar(isFluid(g) ? 0.5 : 1);
    const lava = linearOf(g.palette.accent);
    (u.uLava!.value as THREE.Vector3).set(lava[0] * LAVA_GAIN, lava[1] * LAVA_GAIN, lava[2] * LAVA_GAIN);
    u.uHeightMax!.value = isFluid(g) ? 0 : heightRange(g);
    u.uRough!.value = 0.5 + g.terrain.roughness;
    u.uRidge!.value = airless || g.archetype === 'volcanic' ? 0.5 : 0.3;
    const pole = poleAzimuth(g.seed);
    const tilt = (g.axialTilt * Math.PI) / 180;
    // The body's y is its spin axis. Tilt it away from the orbit normal, toward an azimuth of its own.
    this.tilt.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(Math.sin(tilt) * Math.cos(pole), Math.cos(tilt), Math.sin(tilt) * Math.sin(pole)));
    if (g.rings) {
      const { inner, outer } = g.rings;
      (u.uRingBand!.value as THREE.Vector4).set(inner, outer, 1 / (outer - inner), 1);
      (this.ringUniforms.uRadii!.value as THREE.Vector2).set(inner * 0.995, outer * 1.005);
    } else {
      (u.uRingBand!.value as THREE.Vector4).set(1, 2, 1, 0);
    }
    this.ringMesh.visible = Boolean(g.rings);
  }

  /** Every program this body can use, so they can all be compiled before the first frame needs one. */
  warmUp(camera: THREE.Camera): Promise<void> {
    const scene = new THREE.Scene();
    for (const m of [...this.tiers, this.ringMesh.material as THREE.Material]) {
      const mesh = new THREE.Mesh(m === this.ringMesh.material ? sharedRing! : sharedQuad!, m);
      mesh.frustumCulled = false;
      scene.add(mesh);
    }
    const lights = new THREE.Mesh(this.polarLights.geometry, this.polarLights.material);
    lights.frustumCulled = false; scene.add(lights);
    return this.baker.compileOffscreen(scene, camera);
  }

  /** The history of this repo on the night side. Grows cheaply: only new points are drawn. */
  setCities(cities: readonly PlanetCity[]): void {
    const fresh = cities.slice(this.cities.length);
    this.cities = [...cities];
    if (this.bake && fresh.length) {
      this.baker.stamp(this.bake, this.genome, packCities(fresh));
      this.bindLights(this.bake);
    }
  }

  private bindLights(bake: PlanetBake): void {
    this.uniforms.uLights!.value = bake.lights ? bake.lights.texture : this.baker.emptyCube;
    this.uniforms.uLightsOn!.value = bake.lights ? 1 : 0;
  }

  /** Asks for textures at this cube size. The old ones stay on screen until the new ones are complete. */
  request(size: number, priority = 1): void {
    if (this.bake?.size === size || this.pending?.size === size) return;
    if (this.pending) this.baker.cancel(this.pending);
    this.pending = this.baker.enqueue(this.genome, size, priority, (bake) => this.adopt(bake), this.cities);
  }

  get bytes(): number { return (this.bake?.bytes ?? 0) + (this.pending?.bytes ?? 0); }
  get ready(): boolean { return this.bake !== null; }
  get currentTier(): PlanetTier { return this.tier; }

  private adopt(bake: PlanetBake): void {
    const before = this.bake;
    this.bake = bake;
    this.pending = null;
    const u = this.uniforms;
    u.uAlbedo!.value = bake.albedo.texture;
    u.uRelief!.value = bake.relief ? bake.relief.texture : this.baker.flatRelief;
    u.uClouds!.value = bake.clouds ? bake.clouds.texture : this.baker.emptyCube;
    u.uBand!.value = bake.band ?? this.baker.emptyStrip;
    u.uRing!.value = bake.ring ?? this.baker.emptyStrip;
    this.bindLights(bake);
    // The new mips at the old size look just like the old bake. Sharpening from there is what hides the swap.
    this.sharpen = before ? Math.max(0, Math.log2(bake.size / before.size)) : 0;
    if (before) this.baker.dispose(before);
  }

  /** After a lost context every target is empty. The planet goes dark until its new bake lands, and the rails never knew. */
  restored(): void {
    const size = this.bake?.size ?? this.pending?.size ?? 0;
    this.bake = null;
    this.pending = null;
    const u = this.uniforms;
    u.uAlbedo!.value = this.baker.emptyCube;
    u.uRelief!.value = this.baker.flatRelief;
    u.uClouds!.value = this.baker.emptyCube;
    u.uBand!.value = this.baker.emptyStrip;
    u.uRing!.value = this.baker.emptyStrip;
    u.uLights!.value = this.baker.emptyCube;
    u.uLightsOn!.value = 0;
    (u.uPOn!.value as THREE.Vector3).set(0, 0, 0);
    if (size) this.request(size, 1);
  }

  /** Lab only: look at the ground alone. */
  debugClouds(on: boolean): void { this.uniforms.uCloudOn!.value = on ? 1 : 0; }

  get currentCities(): readonly PlanetCity[] { return this.cities; }

  /** The textures themselves, for a lab that wants to measure them. */
  get bakeForLab(): PlanetBake | null { return this.bake; }

  /** Call once a frame, before the scene renders. */
  update(f: PlanetFrame, dt: number): void {
    const { camera, source, time, height } = f;
    const u = this.uniforms;
    const g = this.genome;
    const radius = this.radius;
    const shown = this.bake !== null && (!f.frustum || f.frustum.intersectsSphere(bound.set(this.position, radius * (g.rings ? g.rings.outer * 1.01 : 1.1))));
    this.mesh.visible = shown;
    this.ringMesh.visible = shown && g.rings !== null;
    this.polarLights.visible = shown && this.auroras && g.atmosphere.density > .1 && this.reveal > .95;
    if (!shown) return;

    // Angles add up, so that a change of activity changes the speed and never makes a planet jump.
    if (this.lastTime === null) {
      this.spin = time * spinRate(g, this.activity);
      this.deckAngle = time * cloudRate(g, this.activity, 0);
      this.highAngle = time * cloudRate(g, this.activity, 1);
      this.flow = time * WIND * (0.4 + this.activity);
    } else {
      const step = time - this.lastTime;
      this.spin += step * spinRate(g, this.activity);
      this.deckAngle += step * cloudRate(g, this.activity, 0);
      this.highAngle += step * cloudRate(g, this.activity, 1);
      this.flow += step * WIND * (0.4 + this.activity);
    }
    this.lastTime = time;
    const spin = this.spin;
    const toBody = this.toBody;
    // World to body: undo the tilt, then undo the spin.
    scratchM.makeRotationFromQuaternion(this.tilt).transpose();
    const cs = Math.cos(spin);
    const sn = Math.sin(spin);
    const m = scratchM.elements;
    // Rotation about y applied after the inverse tilt. Written out, since this runs for thirty planets at thirty hertz.
    const e = toBody.elements;
    for (let c = 0; c < 3; c++) {
      const x = m[c * 4]!;
      const y = m[c * 4 + 1]!;
      const z = m[c * 4 + 2]!;
      e[c * 3] = cs * x + sn * z;
      e[c * 3 + 1] = y;
      e[c * 3 + 2] = cs * z - sn * x;
    }
    (u.uBody!.value as THREE.Matrix3).copy(toBody);

    (u.uCentre!.value as THREE.Vector3).copy(this.position);
    u.uScale!.value = radius;
    (u.uCam!.value as THREE.Vector3).copy(camera.position).sub(this.position).divideScalar(radius).applyMatrix3(toBody);
    const distance = scratch.copy(camera.position).sub(this.position).length();

    const sun = this.sunOverride ?? toSun.copy(source.position).sub(this.position).normalize();
    (u.uSun!.value as THREE.Vector3).copy(sun).applyMatrix3(toBody);
    // A bar of light: its long axis is what lies in the disk plane and across the line to the source.
    axisWorld.copy(source.normal).cross(sun);
    if (axisWorld.lengthSq() < 1e-6) axisWorld.set(1, 0, 0);
    (u.uSunAxis!.value as THREE.Vector3).copy(axisWorld.normalize()).applyMatrix3(toBody).normalize();
    (u.uLight!.value as THREE.Color).copy(source.color);
    const reach = source.radius / Math.max(scratch.copy(source.position).sub(this.position).length(), source.radius * 1.5);
    (u.uSoft!.value as THREE.Vector2).set(Math.max(0.02, reach * 0.3), Math.min(0.42, Math.max(0.03, reach)));

    const px = (2 * Math.tan((camera.fov * Math.PI) / 360)) / height;
    u.uPx!.value = px;
    const pxOnScreen = radius / Math.max(distance * px, 1e-6);
    this.lastPx = pxOnScreen;
    this.polarLights.visible &&= pxOnScreen > 22;
    this.polarLights.material.uniforms.uTime!.value = time;
    this.polarLights.material.uniforms.uActivity!.value = Math.min(1, Math.max(0, this.activity));

    const air = this.air;
    const h = air.on ? Math.max(air.h, Math.min(0.03, (MIN_AIR_PX / pxOnScreen) * 0.42)) : 0.002;
    u.uH!.value = h;
    const top = air.on ? 1 + h * 7 : 1;
    u.uTop!.value = top;
    u.uBound!.value = Math.max(top, hasClouds(g) ? 1.012 : 1) + 2.5 / pxOnScreen;

    const altitude = distance / radius - 1;
    this.altitude = altitude;
    const tier: PlanetTier = altitude < TIER_CRAFT_ALTITUDE ? 2 : pxOnScreen > TIER_WORLD_PX ? 1 : 0;
    if (tier !== this.tier) {
      this.tier = tier;
      this.mesh.material = this.tiers[tier]!;
    }
    if (tier === 2) {
      const t = Math.min(1, Math.max(0, (TIER_CRAFT_ALTITUDE - altitude) / (TIER_CRAFT_ALTITUDE - TIER_CRAFT_FULL)));
      u.uClose!.value = t * t * (3 - 2 * t);
      if (!isFluid(g)) this.trackGround(camera, px, dt);
    }

    (u.uCloudSpin!.value as THREE.Vector4).set(Math.cos(this.deckAngle), Math.sin(this.deckAngle), Math.cos(this.highAngle), Math.sin(this.highAngle));

    (u.uFlow!.value as THREE.Vector4).x = this.flow;

    if (this.sharpen > 0) {
      this.sharpen = Math.max(0, this.sharpen - dt * 5);
      u.uBias!.value = this.sharpen;
    } else u.uBias!.value = 0;

    u.uReveal!.value = this.reveal;
    if (this.reveal < 1 && !this.revealSet) {
      // The new surface starts on the visible side, toward the light, so the change is seen from its first frame and sweeps across the sphere.
      const cam = (u.uCam!.value as THREE.Vector3);
      (u.uRevealAxis!.value as THREE.Vector3).copy(cam).normalize().multiplyScalar(0.7).add(u.uSun!.value as THREE.Vector3).normalize();
      this.revealSet = true;
    }

    this.unproject.copy(camera.matrixWorld).multiply(camera.projectionMatrixInverse);
    (u.uUnproject!.value as THREE.Matrix4).copy(this.unproject);
    (u.uViewProj!.value as THREE.Matrix4).multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  }

  /** Asks for fine ground under the camera, from what the camera really sees of this body. */
  private trackGround(camera: THREE.PerspectiveCamera, px: number, dt: number): void {
    const u = this.uniforms;
    const toBody = this.toBody;
    const cam = u.uCam!.value as THREE.Vector3;
    camera.getWorldDirection(forward);
    screenUp.setFromMatrixColumn(camera.matrixWorld, 1);
    screenRight.setFromMatrixColumn(camera.matrixWorld, 0);
    const halfTall = Math.tan((camera.fov * Math.PI) / 360);
    const halfWide = halfTall * camera.aspect;
    const rays = FRAME_RAYS.map(([x, y]): V3 => {
      const r = scratch.copy(forward).addScaledVector(screenRight, x * halfWide).addScaledVector(screenUp, y * halfTall).normalize().applyMatrix3(toBody);
      return [r.x, r.y, r.z];
    });
    const region = this.baker.region;
    region.track(this, this.genome, planRegion([cam.x, cam.y, cam.z], rays, px));
    if (region.owns(this)) region.bind(u, dt);
  }

  /** A direction in the body, in world axes, as of the last update. */
  worldOf(body: THREE.Vector3): THREE.Vector3 { return body.applyMatrix3(scratchN.copy(this.toBody).transpose()); }

  /** Radii above the surface at the last update. */
  get height(): number { return this.altitude; }

  /** Screen radius in device px at the last update. */
  get screenRadius(): number { return this.lastPx; }

  dispose(): void {
    if (this.pending) this.baker.cancel(this.pending);
    if (this.bake) this.baker.dispose(this.bake);
    for (const m of this.tiers) m.dispose();
    (this.ringMesh.material as THREE.Material).dispose();
    this.polarLights.material.dispose();
  }
}

