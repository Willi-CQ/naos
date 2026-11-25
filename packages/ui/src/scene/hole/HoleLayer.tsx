// The hole in the Stage. It replaces LensBackground, CoronaQuad and Disc. Mount it after `await prepareHole()`. Its passes sort by renderOrder.
import { useFrame } from '@react-three/fiber';
import type { Hole } from './hole.ts';

export function HoleLayer({ hole }: { hole: Hole }) {
  useFrame(({ camera }) => hole.update(camera), -3);
  return <primitive object={hole.group} />;
}
