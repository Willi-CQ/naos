// The seam between the sky and the hole: `new Hole({ ...cubeSky(passes.skyCube) })`. The hole bends a ray and asks what lies at the end of it, and
// the environment cube answers in any direction, also the ones the screen's sky target never drew. The two gradients pick the mip, so the
// images squeezed against the shadow stay smooth. A cube drawn by three needs no flip.
import type * as THREE from 'three';

export const cubeSky = (cube: THREE.IUniform): { sky: string; skyUniforms: Record<string, THREE.IUniform> } => ({
  sky: 'uniform samplerCube uHoleSkyCube;\nvec3 holeSky(vec3 d, vec3 dx, vec3 dy) { return textureGrad(uHoleSkyCube, d, dx, dy).rgb; }\n',
  skyUniforms: { uHoleSkyCube: cube },
});
