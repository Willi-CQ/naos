import * as THREE from 'three';
import type { PlanetGenome } from '@naos/protocol';
import vertex from './shaders/aurora.vert?raw';
import fragment from './shaders/aurora.frag?raw';

let geometry: THREE.BufferGeometry | null = null;
function curtain(): THREE.BufferGeometry {
  const positions: number[] = [], indices: number[] = [], segments = 160;
  for (let pole = 0; pole < 2; pole++) for (let i = 0; i <= segments; i++) for (let edge = 0; edge < 2; edge++) positions.push(i / segments * Math.PI * 2, edge, pole ? -1 : 1);
  for (let pole = 0; pole < 2; pole++) for (let i = 0; i < segments; i++) {
    const k = pole * (segments + 1) * 2 + i * 2; indices.push(k,k+1,k+2,k+1,k+3,k+2);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setIndex(indices); return g;
}

export function aurora(genome: PlanetGenome, shared: Record<string, THREE.IUniform>): THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const color = new THREE.Color(genome.atmosphere.color).lerp(new THREE.Color(genome.palette.accent), .45);
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: vertex, fragmentShader: fragment, toneMapped: false,
    transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { uCentre: shared.uCentre!, uScale: shared.uScale!, uBody: shared.uBody!, uSun: shared.uSun!, uReveal: shared.uReveal!,
      uTime: { value: 0 }, uActivity: { value: 0 }, uSeed: { value: (genome.seed % 1000) / 100 }, uColor: { value: color } },
  });
  const mesh = new THREE.Mesh(geometry ??= curtain(), material);
  mesh.frustumCulled = false; mesh.renderOrder = 10; mesh.name = 'polar-lights'; return mesh;
}
