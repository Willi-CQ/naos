// What the layers share inside the Canvas: live uniforms, written once a frame by the Stage.
import { createContext, use } from 'react';
import type * as THREE from 'three';
import type { FrameUniforms, SceneState } from './state.ts';

export interface StageUniforms {
  state: SceneState;
  frame: FrameUniforms;
  passes: {
    sky: { value: THREE.Texture | null };
    corona: { value: THREE.Texture | null };
    noise: { value: THREE.Texture | null };
    /** The whole sky as a cube, drawn when the month changes. What the hole samples along a bent ray. Linear, mipmapped. */
    skyCube: { value: THREE.CubeTexture | THREE.Texture | null };
  };
  lens: {
    well: { value: Float32Array };
    wellCount: { value: number };
    wave: { value: Float32Array };
    waveCount: { value: number };
    waveShape: { value: THREE.Vector2 };
    res: { value: THREE.Vector2 };
  };
  disc: {
    radius: { value: number };
    sunLeft: { value: number };
    sliver: { value: THREE.Color };
    quota: { value: number };
  };
}

export const StageContext = createContext<StageUniforms | null>(null);

export function useStage(): StageUniforms {
  const v = use(StageContext);
  if (!v) throw new Error('useStage needs a <Stage> above it');
  return v;
}
