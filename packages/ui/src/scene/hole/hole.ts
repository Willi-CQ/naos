// The black hole as one object. Add `group` to a scene and call `update` once a frame. Three draws: the back pass under the worlds, then
// after the worlds the shadow again and the direct image of the disk over everything behind it. Everything the shaders need is here:
// three tables, the structure of the disk, the heat map and the laws of ruling 20.
import * as THREE from 'three';
import { fullscreenTriangle } from '../materials.ts';
import { diskLaw, HEAT_H, holeExposure, HEAT_W, paintHeat, R_IN, R_OUT, ROTATION, type Arc, type Flare } from './disk.ts';
import { B_MAX, buildCameraTable, buildOrbitTables, CAMERA_TEXELS, clampCameraR, lensFade, ORBIT_COLS, ORBIT_ROWS, S_ESC, S_MIN, shadowAngle, type OrbitTables } from './geodesic.ts';
import { bakeStreaks, STREAK_H, STREAK_MEAN, STREAK_W } from './streaks.ts';
import holeCapFrag from './shaders/hole-cap.frag?raw';
import holeCapVert from './shaders/hole-cap.vert?raw';
import holeFrag from './shaders/hole.frag?raw';
import lensChunk from './shaders/hole-lens.glsl?raw';
import skyChunk from './shaders/hole-sky.glsl?raw';
import holeVert from './shaders/hole.vert?raw';

let orbit: OrbitTables | null = null;
let streak: Uint8Array | null = null;
let preparing: Promise<void> | null = null;

/**
 * Builds the tables in a worker, once for the page. Await it before the first Hole, or the constructor does the same work on the
 * main thread and blocks it for about a third of a second.
 */
export function prepareHole(): Promise<void> {
  return preparing ??= new Promise<void>((resolve) => {
    const worker = new Worker(new URL('./tables.worker.ts', import.meta.url), { type: 'module' });
    const done = () => { worker.terminate(); resolve(); };
    worker.onmessage = (e: MessageEvent<OrbitTables & { streak: Uint8Array }>) => {
      orbit = { u: e.data.u, length: e.data.length };
      streak = e.data.streak;
      done();
    };
    worker.onerror = done;
  });
}

function floatTexture(data: Float32Array, w: number, h: number, name: string): THREE.DataTexture {
  const t = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.name = name;
  t.needsUpdate = true;
  return t;
}

/** The numbers a shader needs to include hole-lens.glsl. */
export const HOLE_DEFINES = {
  HOLE_ROWS: `${ORBIT_ROWS}.0`,
  HOLE_COLS: `${ORBIT_COLS}.0`,
  HOLE_HALF: `${ORBIT_ROWS / 2}.0`,
  HOLE_CAM_TEXELS: `${CAMERA_TEXELS}.0`,
  HOLE_S_MIN: S_MIN.toFixed(8),
  HOLE_S_ESC: S_ESC.toFixed(8),
  HOLE_B_MAX: `${B_MAX}.0`,
  HOLE_R_IN: R_IN.toFixed(3),
  HOLE_STREAK_MEAN: `vec4(${STREAK_MEAN.join(', ')})`,
};

/** After the bodies that write depth, before anything that glows on top. PlanetBody draws at 9 to 9.6. */
export const HOLE_FRONT_ORDER = 9.9;

export { lensChunk };

export interface HoleOptions {
  /** GLSL defining `vec3 holeSky(vec3 dir, vec3 dirDx, vec3 dirDy)`, in world space. Default: nothing behind the hole. */
  sky?: string;
  skyUniforms?: Record<string, THREE.IUniform>;
  /** Scene void, linear, added wherever a ray escapes. */
  voidColor?: THREE.Color;
}

export interface HoleLaws {
  quota: number;
  /** Radians at r = 6. The caller advances it with fleet tokens over a small base rate, DESIGN law 7. */
  clock: number;
  turbulence: number;
  arcs: readonly Arc[];
  flares: readonly Flare[];
  /** The reset's bead on the photon ring: azimuth in the ring, strength. */
  bead?: { azimuth: number; strength: number };
}

/** The Stage's sky through the lens: `new Hole({ ...stageSky(passes.sky, passes.skyCube) })`. Crisp stars from the target, the rest of the sphere from the cube. */
export function stageSky(target: THREE.IUniform, cube: THREE.IUniform): Pick<HoleOptions, 'sky' | 'skyUniforms'> {
  return { sky: skyChunk, skyUniforms: { uHoleSkyTarget: target, uHoleSkyCube: cube, uHoleSkyClip: { value: new THREE.Matrix4() } } };
}

const DEFAULT_SKY = 'vec3 holeSky(vec3 d, vec3 dx, vec3 dy) { return vec3(0.0); }\n';

const center = new THREE.Vector3();
const rel = new THREE.Vector3();
const col = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] as const;
const toHole = new THREE.Quaternion();
const m4 = new THREE.Matrix4();
const NDC = [[0, 0], [1, 0], [0, 1]] as const;
const unit = new THREE.Vector3();
const inverse = new THREE.Quaternion();
const ringX = new THREE.Vector3();
const ringY = new THREE.Vector3();
const toBody = new THREE.Vector3();
const axis = new THREE.Vector3();
const eye = new THREE.Vector3();
const clipCentre = new THREE.Vector4();

// Premultiplied, and the scene's alpha stays what the back pass wrote: there it means how much bloom may land.
const OVER = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor } as const;

export class Hole {
  /** Everything to add to the scene. */
  readonly group = new THREE.Group();
  /** The back pass. It draws first. */
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  /** The direct image of the disk. Its renderOrder must stay behind every body that writes depth. */
  readonly front: THREE.Mesh;
  readonly frontMaterial: THREE.ShaderMaterial;
  /** The shadow over bodies that stand behind the hole. It draws just before `front`. */
  readonly cap: THREE.Mesh;
  private readonly capMaterial: THREE.ShaderMaterial;
  /** World position of the singularity. */
  readonly position = new THREE.Vector3();
  /** Turns the hole frame, where y is the disk normal, into world space. Tilts the disk across the frame at Home. */
  readonly tilt = new THREE.Quaternion();
  /** World units per M. */
  scale = 1;
  rc = 0;
  /** Doppler strength. 1 is the real thing. The reference holds it well back. */
  doppler = 0.3;
  /** Crossings drawn, 1 to 4. Set by the tier, it recompiles nothing. */
  images = 4;
  /** Steps of the march along rays inside the disk. 0 turns it off, and the disk is a sheet when seen exactly edge on. */
  graze = 32;

  private readonly camera = new Float32Array(CAMERA_TEXELS);
  private readonly camTex: THREE.DataTexture;
  private readonly orbitTex: THREE.DataTexture;
  private readonly rowsTex: THREE.DataTexture;
  private readonly streakTex: THREE.DataTexture;
  private readonly heatTex: THREE.DataTexture;
  private readonly heat = new Uint8Array(HEAT_W * HEAT_H * 2);
  private heatLive = false;
  private arcKey = '';
  private beadAzimuth = 0;

  constructor(options: HoleOptions = {}) {
    const t = orbit ??= buildOrbitTables();
    this.orbitTex = floatTexture(t.u, ORBIT_COLS, ORBIT_ROWS, 'HoleOrbit');
    this.rowsTex = floatTexture(t.length, ORBIT_ROWS, 1, 'HoleRows');
    this.camTex = floatTexture(this.camera, CAMERA_TEXELS, 1, 'HoleCamera');

    const s = new THREE.DataTexture(streak ??= bakeStreaks(), STREAK_W, STREAK_H, THREE.RGBAFormat, THREE.UnsignedByteType);
    s.wrapS = s.wrapT = THREE.RepeatWrapping;
    s.magFilter = THREE.LinearFilter;
    s.minFilter = THREE.LinearMipmapLinearFilter;
    s.generateMipmaps = true;
    s.anisotropy = 8;
    s.name = 'HoleStreak';
    s.needsUpdate = true;
    this.streakTex = s;

    const h = new THREE.DataTexture(this.heat, HEAT_W, HEAT_H, THREE.RGFormat, THREE.UnsignedByteType);
    h.wrapS = THREE.RepeatWrapping;
    h.wrapT = THREE.ClampToEdgeWrapping;
    h.minFilter = h.magFilter = THREE.LinearFilter;
    h.generateMipmaps = false;
    h.name = 'HoleHeat';
    h.needsUpdate = true;
    this.heatTex = h;

    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: holeVert,
      fragmentShader: `${lensChunk}\n${options.sky ?? DEFAULT_SKY}\n${holeFrag}`,
      defines: HOLE_DEFINES,
      uniforms: {
        ...options.skyUniforms,
        uView: { value: 0 },
        uHoleOrbit: { value: this.orbitTex },
        uHoleRows: { value: this.rowsTex },
        uHoleCam: { value: this.camTex },
        uHoleE1: { value: new THREE.Vector3(0, 0, 1) },
        uHoleBScale: { value: 1 },
        uHoleRay: { value: new THREE.Matrix3() },
        uHoleToWorld: { value: new THREE.Matrix3() },
        uHoleClip: { value: new THREE.Matrix4() },
        uStreak: { value: this.streakTex },
        uHeat: { value: this.heatTex },
        uRIn: { value: 4 },
        uROut: { value: R_OUT },
        uEnergy: { value: 1 },
        uTemp: { value: 1 },
        uClock: { value: 0 },
        uTurbulence: { value: 1 },
        uDoppler: { value: this.doppler },
        uRing: { value: 1 },
        uExposure: { value: 1 },
        uBeadDir: { value: new THREE.Vector3(1, 0, 0) },
        uBeadGain: { value: 0 },
        uGraze: { value: this.graze },
        uImages: { value: this.images },
        uRotation: { value: ROTATION },
        uVoid: { value: options.voidColor ?? new THREE.Color('#060504') },
      },
      toneMapped: false,
      transparent: true,
      // Always passes. It is on so that the shadow writes its depth.
      depthTest: true,
      depthWrite: true,
      depthFunc: THREE.AlwaysDepth,
      blending: THREE.NoBlending,
    });
    this.mesh = new THREE.Mesh(fullscreenTriangle(), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;

    this.frontMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: holeVert,
      fragmentShader: `${lensChunk}\n${holeFrag}`,
      defines: { ...HOLE_DEFINES, HOLE_FRONT: 1 },
      uniforms: this.material.uniforms,
      toneMapped: false,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      ...OVER,
    });
    this.front = new THREE.Mesh(fullscreenTriangle(), this.frontMaterial);
    this.front.frustumCulled = false;
    this.front.renderOrder = HOLE_FRONT_ORDER;

    this.capMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: holeCapVert,
      fragmentShader: holeCapFrag,
      uniforms: {
        uHoleE1: this.material.uniforms.uHoleE1!,
        uHoleBScale: this.material.uniforms.uHoleBScale!,
        uHoleRay: this.material.uniforms.uHoleRay!,
        uCapBox: { value: new THREE.Vector4(0, 0, 1, 1) },
        uCapZ: { value: 0 },
      },
      toneMapped: false,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.cap = new THREE.Mesh(fullscreenTriangle(), this.capMaterial);
    this.cap.frustumCulled = false;
    this.cap.renderOrder = HOLE_FRONT_ORDER - 0.01;

    this.group.add(this.mesh, this.cap, this.front);
  }

  /**
   * How much of a body to draw where it stands, 0 to 1: multiply its opacity by this. A body behind the hole, inside its Einstein ring,
   * would stand there unbent, and that is the one place where the eye can tell. `radius` in world units.
   */
  bodyFade(world: THREE.Vector3, radius: number, camera: THREE.Camera): number {
    eye.setFromMatrixPosition(camera.matrixWorld);
    axis.copy(this.position).sub(eye);
    const toHole = axis.length();
    axis.divideScalar(toHole);
    toBody.copy(world).sub(this.position);
    const behind = toBody.dot(axis);
    const along = toHole + behind;
    if (along <= 0) return 1;
    const off = toBody.addScaledVector(axis, -behind).length();
    return lensFade(toHole / this.scale, behind / this.scale, ((off / along) * toHole) / this.scale, ((radius / along) * toHole) / this.scale);
  }

  /** Azimuth in the disk of a world position, for arcs and flares. */
  azimuthOf(world: THREE.Vector3): number {
    unit.copy(world).sub(this.position).applyQuaternion(inverse.copy(this.tilt).invert());
    return Math.atan2(unit.z, unit.x);
  }

  /** Upload the laws. Call when they change, or every frame while a flare burns. */
  setLaws(laws: HoleLaws): void {
    const law = diskLaw(laws.quota);
    const u = this.material.uniforms;
    u.uRIn!.value = law.rIn;
    u.uEnergy!.value = law.energy;
    u.uTemp!.value = law.temp;
    u.uRing!.value = law.ring;
    u.uClock!.value = laws.clock;
    u.uTurbulence!.value = laws.turbulence;
    this.beadAzimuth = laws.bead?.azimuth ?? 0;
    u.uBeadGain!.value = laws.bead?.strength ?? 0;
    const arcs = laws.arcs.map((a) => `${a.azimuth.toFixed(3)} ${a.strength.toFixed(3)}`).join() + law.rIn.toFixed(2);
    if (laws.flares.length > 0 || this.heatLive || arcs !== this.arcKey) {
      this.arcKey = arcs;
      this.heatLive = paintHeat(this.heat, laws.arcs, laws.flares, law.rIn, laws.clock) && laws.flares.length > 0;
      this.heatTex.needsUpdate = true;
    }
  }

  /** Follows the camera. The camera table is rebuilt only when the distance changes. */
  update(camera: THREE.Camera): void {
    camera.updateMatrixWorld();
    const u = this.material.uniforms;
    center.copy(this.position);
    rel.setFromMatrixPosition(camera.matrixWorld).sub(center).divideScalar(this.scale);
    toHole.copy(this.tilt).invert();
    rel.applyQuaternion(toHole);
    const rc = clampCameraR(rel.length());
    if (Math.abs(rc - this.rc) > 1e-4 * rc) {
      this.rc = rc;
      buildCameraTable(rc, this.camera);
      this.camTex.needsUpdate = true;
      u.uHoleBScale!.value = rc / Math.sqrt(1 - 2 / rc);
    }
    const e1 = (u.uHoleE1!.value as THREE.Vector3).copy(rel).normalize();

    // The bead's azimuth runs around the shadow as the camera sees it. Up in the hole frame, unless the camera sits on the pole.
    ringX.set(0, 1, 0).cross(e1);
    if (ringX.lengthSq() < 1e-6) ringX.set(1, 0, 0);
    ringX.normalize();
    ringY.crossVectors(e1, ringX);
    (u.uBeadDir!.value as THREE.Vector3).copy(ringX).multiplyScalar(Math.cos(this.beadAzimuth)).addScaledVector(ringY, Math.sin(this.beadAzimuth));

    for (let i = 0; i < 3; i++) col[i]!.set(NDC[i]![0], NDC[i]![1], 1).applyMatrix4((camera as THREE.PerspectiveCamera).projectionMatrixInverse);
    col[1].sub(col[0]);
    col[2].sub(col[0]);
    m4.makeRotationFromQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
    for (const c of col) c.applyMatrix4(m4).applyQuaternion(toHole);
    (u.uHoleRay!.value as THREE.Matrix3).set(col[1].x, col[2].x, col[0].x, col[1].y, col[2].y, col[0].y, col[1].z, col[2].z, col[0].z);
    (u.uHoleToWorld!.value as THREE.Matrix3).setFromMatrix4(m4.makeRotationFromQuaternion(this.tilt));
    m4.compose(this.position, this.tilt, unit.setScalar(this.scale));
    (u.uHoleSkyClip?.value as THREE.Matrix4 | undefined)?.multiplyMatrices((camera as THREE.PerspectiveCamera).projectionMatrix, camera.matrixWorldInverse);
    (u.uHoleClip!.value as THREE.Matrix4).multiplyMatrices((camera as THREE.PerspectiveCamera).projectionMatrix, camera.matrixWorldInverse).multiply(m4);
    u.uDoppler!.value = this.doppler;
    u.uView!.value = Math.abs(e1.y);
    u.uExposure!.value = holeExposure(rc, e1.y);
    u.uImages!.value = this.images;
    u.uGraze!.value = this.graze;

    clipCentre.set(this.position.x, this.position.y, this.position.z, 1).applyMatrix4(camera.matrixWorldInverse).applyMatrix4((camera as THREE.PerspectiveCamera).projectionMatrix);
    const ahead = clipCentre.w > 0;
    // The bead's glow reaches into the shadow, and the cap would cut it in half.
    this.cap.visible = ahead && u.uBeadGain!.value === 0;
    if (ahead) {
      const p = (camera as THREE.PerspectiveCamera).projectionMatrix.elements;
      const slope = Math.tan(Math.min(shadowAngle(rc), 1.5)) * 1.03;
      const box = this.capMaterial.uniforms.uCapBox!.value as THREE.Vector4;
      box.set(clipCentre.x / clipCentre.w, clipCentre.y / clipCentre.w, Math.min(4, slope * p[0]! * (1 + Math.abs(clipCentre.x / clipCentre.w))), Math.min(4, slope * p[5]! * (1 + Math.abs(clipCentre.y / clipCentre.w))));
      this.capMaterial.uniforms.uCapZ!.value = clipCentre.z / clipCentre.w;
    }
  }

  /**
   * Links the shaders off the main thread where the browser can. Without this, the first draw blocks for a second. three keys a
   * program on whether it draws to a target, and the hole always does, so it must compile with one bound or it compiles twice.
   */
  precompile(renderer: THREE.WebGLRenderer, camera: THREE.Camera): Promise<unknown> {
    const before = renderer.getRenderTarget();
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    renderer.setRenderTarget(target);
    const done = renderer.compileAsync(this.group, camera);
    renderer.setRenderTarget(before);
    return done.finally(() => target.dispose());
  }

  dispose(): void {
    this.material.dispose();
    this.frontMaterial.dispose();
    this.capMaterial.dispose();
    this.orbitTex.dispose();
    this.rowsTex.dispose();
    this.camTex.dispose();
    this.streakTex.dispose();
    this.heatTex.dispose();
  }
}
