// FinishEffect with the shadow mask in place of the disc occluder. Pass it to the Stage as `finishEffect`.
import { FinishEffect } from '../Finish.ts';
import holeFinishFrag from './shaders/hole-finish.frag?raw';

export class HoleFinishEffect extends FinishEffect {
  constructor() {
    super({ fragment: holeFinishFrag });
  }
}
