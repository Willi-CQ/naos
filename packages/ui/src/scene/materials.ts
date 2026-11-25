// One way to build a material. Everything sits in the transparent list, so renderOrder is the whole draw order of DESIGN 7.2.
import * as THREE from 'three';

export function shader(
  vertexShader: string,
  fragmentShader: string,
  uniforms: Record<string, THREE.IUniform>,
  options: THREE.ShaderMaterialParameters = {},
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader,
    fragmentShader,
    uniforms,
    toneMapped: false,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    // Strips and screen facing quads have no winding worth keeping.
    side: THREE.DoubleSide,
    ...options,
  });
}

/** `One`, `OneMinusSrcAlpha`: the body occludes, the rim adds. */
export const PREMULTIPLIED: THREE.ShaderMaterialParameters = {
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
  blendSrcAlpha: THREE.OneFactor,
  blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
};

let triangle: THREE.BufferGeometry | null = null;

/** The fullscreen triangle. position.xy runs -1..3. Shared, never disposed. */
export function fullscreenTriangle(): THREE.BufferGeometry {
  if (triangle) return triangle;
  triangle = new THREE.BufferGeometry();
  triangle.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  return triangle;
}

/** A quad, position.xy runs -1..1. */
export function unitQuad(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/** A strip along x 0..1, side y -1..1. */
export function stripGeometry(segments: number): THREE.BufferGeometry {
  const position = new Float32Array((segments + 1) * 6);
  const index: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    position.set([t, -1, 0, t, 1, 0], i * 6);
    if (i < segments) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setIndex(index);
  return g;
}
