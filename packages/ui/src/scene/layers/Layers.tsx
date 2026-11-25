// The instanced layers of DESIGN 7.2. Each takes a buffer and owns one draw. Layer 4 adds the state language on top of these.
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { fullscreenTriangle, PREMULTIPLIED, shader, unitQuad } from '../materials.ts';
import { useStage } from '../context.ts';
import { linear } from '../tokens.ts';
import { BELT_RADIUS, BELT_WIDTH } from '../../core/space.ts';
import type { ArcBuffer, BeamBuffer, CityBuffer, HullBuffer, WorldBuffer } from './buffers.ts';
import arcFrag from '../shaders/arc.frag?raw';
import arcVert from '../shaders/arc.vert?raw';
import beamFrag from '../shaders/beam.frag?raw';
import beamVert from '../shaders/beam.vert?raw';
import beltFrag from '../shaders/belt.frag?raw';
import beltVert from '../shaders/belt.vert?raw';
import cityFrag from '../shaders/city.frag?raw';
import cityVert from '../shaders/city.vert?raw';
import coronaQuadFrag from '../shaders/corona-quad.frag?raw';
import discFrag from '../shaders/disc.frag?raw';
import discVert from '../shaders/disc.vert?raw';
import fullscreenVert from '../shaders/fullscreen.vert?raw';
import hullFrag from '../shaders/hull.frag?raw';
import hullVert from '../shaders/hull.vert?raw';
import lensFrag from '../shaders/lens.frag?raw';
import limbFrag from '../shaders/limb.frag?raw';
import limbVert from '../shaders/limb.vert?raw';
import craftFrag from '../shaders/craft.frag?raw';
import craftVert from '../shaders/craft.vert?raw';

/** Depth tested and additive, the default for everything in front of the disc. */
const TESTED: THREE.ShaderMaterialParameters = { depthTest: true };

function useDraw<T extends THREE.Object3D>(build: () => T, dispose: () => void): T {
  const object = useMemo(build, []); // eslint-disable-line
  useEffect(() => dispose, []); // eslint-disable-line
  return object;
}

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, renderOrder: number): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.frustumCulled = false;
  m.renderOrder = renderOrder;
  return m;
}

/** The scene background: the sky through the lens, wavefronts and rings. The only distortion that exists. */
export function LensBackground() {
  const { lens, passes } = useStage();
  const object = useDraw(() => mesh(fullscreenTriangle(), shader(fullscreenVert, lensFrag, {
    uSky: passes.sky,
    uNoise: passes.noise,
    uWell: lens.well,
    uWellCount: lens.wellCount,
    uWave: lens.wave,
    uWaveCount: lens.waveCount,
    uWaveShape: lens.waveShape,
    uRes: lens.res,
    uVoid: { value: linear('void') },
    uNad: { value: linear('nad') },
    uHalpha: { value: linear('halpha') },
  }, { blending: THREE.NoBlending }), -1000), () => (object.material as THREE.Material).dispose());
  return <primitive object={object} />;
}

export function CoronaQuad() {
  const { passes } = useStage();
  const object = useDraw(() => mesh(fullscreenTriangle(), shader(fullscreenVert, coronaQuadFrag, { uCorona: passes.corona }), -900),
    () => (object.material as THREE.Material).dispose());
  return <primitive object={object} />;
}

export function Disc() {
  const { disc } = useStage();
  const geometry = useMemo(unitQuad, []);
  const object = useDraw(() => mesh(geometry, shader(discVert, discFrag, {
    uStar: { value: new THREE.Vector3() },
    uRadius: disc.radius,
    uSunLeft: disc.sunLeft,
    uSliver: disc.sliver,
    uPearl: { value: linear('pearl') },
    // It writes depth, so a world behind the hole is hidden by it and one in front is not.
  }, { ...PREMULTIPLIED, depthTest: true, depthWrite: true }), -800), () => { (object.material as THREE.Material).dispose(); geometry.dispose(); });
  return <primitive object={object} />;
}

// Moons, the rocks of the Belt, and a world until its planet has landed. After the planets, which pass every depth test to keep their own
// order, so a moon in front of one is tested against it and shows. Before the hole's direct image, which must cover what stands behind it.
export function Worlds({ buffer }: { buffer: WorldBuffer }) {
  const { disc } = useStage();
  const object = useDraw(() => mesh(buffer.geometry, shader(limbVert, limbFrag, {
    uStar: { value: new THREE.Vector3() },
    uQuota: disc.quota,
    uPearl: { value: linear('pearl') },
  }, { ...PREMULTIPLIED, depthTest: true, depthWrite: true }), 9.7), () => (object.material as THREE.Material).dispose());
  return <primitive object={object} />;
}

export function Cities({ buffer, world, spin, px }: { buffer: CityBuffer; world: Float32Array; spin: Float32Array; px: number }) {
  const { frame } = useStage();
  const object = useDraw(() => {
    const material = shader(cityVert, cityFrag, {
      uWorld: { value: world },
      uSpin: { value: spin },
      uStar: { value: new THREE.Vector3() },
      uPx: { value: px },
      // city.vert multiplies by 3, the gain in DESIGN 5.4. The stills peak near 1, so the colour carries the difference.
      uCity: { value: linear('city').clone().multiplyScalar(0.42) },
      uHalpha: { value: linear('halpha').clone().multiplyScalar(0.42) },
    }, TESTED);
    const points = new THREE.Points(buffer.geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 10;
    return points;
  }, () => (object.material as THREE.Material).dispose());
  useFrame(() => { (object.material as THREE.ShaderMaterial).uniforms.uPx!.value = px * frame.uPxPerCss.value; }, -3);
  return <primitive object={object} />;
}

const ROCKS = 2200;

function beltGeometry(): THREE.BufferGeometry {
  const rock = new Float32Array(ROCKS * 4);
  let s = 0x9e3779b9;
  const next = (): number => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const gauss = (): number => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());
  for (let i = 0; i < ROCKS; i++) {
    rock[i * 4] = BELT_RADIUS + gauss() * BELT_WIDTH * 0.5;
    rock[i * 4 + 1] = next() * Math.PI * 2;
    rock[i * 4 + 2] = gauss() * 7;
    rock[i * 4 + 3] = 1.4 + 9 * next() ** 5;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ROCKS * 3), 3));
  g.setAttribute('aRock', new THREE.BufferAttribute(rock, 4));
  return g;
}

/** INTERSTELLAR 24: an unnamed ring of rubble at the edge. One draw, plain until the heroes reach it. `turn` is shared, so it rests with everything else. */
export function Belt({ turn }: { turn: { value: number } }) {
  const { disc, frame } = useStage();
  const geometry = useMemo(beltGeometry, []);
  const object = useDraw(() => {
    const material = shader(beltVert, beltFrag, { uTurn: turn, uPx: { value: 1 }, uRock: { value: linear('bone').clone().multiplyScalar(0.2) }, uQuota: disc.quota }, { depthTest: true, depthWrite: true, blending: THREE.NoBlending });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 5;
    return points;
  }, () => { (object.material as THREE.Material).dispose(); geometry.dispose(); });
  useFrame((s) => {
    const camera = s.camera as THREE.PerspectiveCamera;
    (object.material as THREE.ShaderMaterial).uniforms.uPx!.value = (frame.uRes.value.y / 2) / Math.tan((camera.fov * Math.PI) / 360);
  }, -3);
  return <primitive object={object} />;
}

export function Arcs({ buffer, time }: { buffer: ArcBuffer; time?: { value: number } }) {
  const { frame } = useStage();
  const object = useDraw(() => mesh(buffer.geometry, shader(arcVert, arcFrag, { ...frame, ...(time ? { uNow: time } : {}) }, TESTED), 20),
    () => (object.material as THREE.Material).dispose());
  return <primitive object={object} />;
}

export function Hulls({ buffer }: { buffer: HullBuffer }) {
  const { frame } = useStage();
  const object = useDraw(() => mesh(buffer.geometry, shader(hullVert, hullFrag, { uRes: frame.uRes, uPxPerCss: frame.uPxPerCss }, TESTED), 30),
    () => (object.material as THREE.Material).dispose());
  return <primitive object={object} />;
}

/** About 300 triangles: a lofted kite, flat and swept, the sprite's shape with a body. It runs along +x, as the sprite does. */
function hullGeometry(): THREE.BufferGeometry {
  const stations = 15;
  const sides = 10;
  const position: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= stations; i++) {
    const u = i / stations;
    // From nose to tail: the beam of the kite grows to its wings, and the notch of the tail pulls the middle back in.
    const x = 1 - 1.62 * u;
    const beam = 0.46 * u ** 0.8 * (u > 0.82 ? 1 - ((u - 0.82) / 0.18) * 0.55 : 1);
    const keel = 0.16 * Math.sin(Math.PI * Math.min(1, u * 1.15)) ** 0.7;
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      const c = Math.cos(a);
      const n = Math.sin(a);
      position.push(x, Math.sign(n) * Math.abs(n) ** 1.4 * keel, Math.sign(c) * Math.abs(c) ** 0.7 * beam);
    }
  }
  for (let i = 0; i < stations; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * sides + j;
      const b = i * sides + (j + 1) % sides;
      const c = a + sides;
      const d = b + sides;
      index.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(position), 3));
  g.setIndex(index);
  return g;
}

/** The selected craft at Craft level, DESIGN 7.2. Always mounted, so nothing compiles when you fly in. */
export function CraftMesh({ place }: { place: (mesh: THREE.Mesh, color: THREE.Color) => { fill: number; gain: number } | null }) {
  const geometry = useMemo(hullGeometry, []);
  const color = useMemo(() => new THREE.Color(), []);
  const object = useDraw(() => {
    const m = mesh(geometry, shader(craftVert, craftFrag, { uColor: { value: color }, uFill: { value: 1 }, uGain: { value: 1 } }, TESTED), 50);
    m.visible = false;
    return m;
  }, () => { (object.material as THREE.Material).dispose(); geometry.dispose(); });
  useFrame(() => {
    const u = (object.material as THREE.ShaderMaterial).uniforms;
    const shown = place(object, color);
    object.visible = shown !== null;
    if (shown) { u.uFill!.value = shown.fill; u.uGain!.value = shown.gain; }
  }, -3);
  return <primitive object={object} />;
}

export function Beams({ buffer, time }: { buffer: BeamBuffer; time?: { value: number } }) {
  const { frame } = useStage();
  const object = useDraw(() => mesh(buffer.geometry, shader(beamVert, beamFrag, { ...frame, ...(time ? { uNow: time } : {}) }, TESTED), 40),
    () => (object.material as THREE.Material).dispose());
  return <primitive object={object} />;
}
