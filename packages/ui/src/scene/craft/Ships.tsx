import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useNaos, useShell, useView } from '../../store/store.ts';
import { useStage } from '../context.ts';
import type { SceneController } from '../controller.ts';
import { diskLight } from '../hole/disk.ts';
import { CraftLayer, type CraftDraw } from './Layer.ts';

export function Ships({ controller }: { controller: SceneController }) {
  const renderer = useThree((s) => s.gl);
  const free = useShell((s) => s.free);
  const craftK = useShell((s) => s.craftK);
  const worldId = useView((v) => v.level === 'system' ? null : v.worldId);
  const { state } = useStage();
  const layer = useMemo(() => new CraftLayer({ base: 24 }), []);
  const size = useMemo(() => new THREE.Vector2(), []);
  const light = useMemo<[number, number, number]>(() => [0, 0, 0], []);
  const add = useMemo(() => (craft: CraftDraw) => layer.add(craft), [layer]);

  useEffect(() => {
    controller.fleet.externalShips = true;
    return () => { controller.fleet.externalShips = false; layer.dispose(); };
  }, [controller, layer]);

  useFrame(() => {
    layer.group.visible = !useNaos.getState().scene.demo?.active;
    if (!layer.group.visible) return;
    const [r, g, b] = diskLight(state.sunLeft, light);
    layer.uniforms.uKey.value.setRGB(2.4 * r, 2.4 * g, 2.4 * b);
    const world = worldId ? controller.worldBody(worldId) : null;
    layer.uniforms.uBody.value.set(world?.position.x ?? 0, world?.position.y ?? 0, world?.position.z ?? 0, world?.radius ?? 0);
    layer.markScale = craftK * controller.fleet.hullScale;
    const pixels = renderer.getDrawingBufferSize(size).x / free.w;
    layer.begin(controller.camera, free, pixels);
    controller.fleet.drawShips(add, state.now);
    layer.commit(renderer);
  }, -2);

  return <primitive object={layer.group} />;
}
