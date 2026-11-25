// The stills' tone curve as an effect, DESIGN ruling 10. Last in the pass, so bloom lands under the disc occluder.
import { BlendFunction, Effect } from 'postprocessing';
import * as THREE from 'three';
import finishFrag from './shaders/finish.frag?raw';
import { HEX } from './tokens.ts';

export class FinishEffect extends Effect {
  constructor({ fragment = finishFrag }: { fragment?: string } = {}) {
    super('FinishEffect', fragment, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, THREE.Uniform>([
        ['uDisc', new THREE.Uniform(new THREE.Vector3(0.5, 0.5, 0.12))],
        ['uFocus', new THREE.Uniform(new THREE.Vector4(0.5, 0.5, 2, 3))],
        ['uDim', new THREE.Uniform(1)],
        ['uDesat', new THREE.Uniform(0)],
        ['uVoid', new THREE.Uniform(new THREE.Color(HEX.void))],
      ]),
    });
  }
}
