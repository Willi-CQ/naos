import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { DISK_OUTER } from '../core/space.ts';
import { useNaos } from '../store/store.ts';
import type { SceneController } from './controller.ts';
import { useStage } from './context.ts';

const CAP = 32, SEGMENTS = 32;

/** Activity routes connect repo worlds to the core. They are separate from agent-to-agent relationships. */
export function Signals({ controller }: { controller: SceneController }) {
  const { state } = useStage();
  const field = useMemo(() => {
    const geometry = new THREE.BufferGeometry(), dots = new THREE.BufferGeometry();
    const positions = new THREE.BufferAttribute(new Float32Array(CAP * SEGMENTS * 6), 3).setUsage(THREE.DynamicDrawUsage);
    const colors = new THREE.BufferAttribute(new Float32Array(CAP * SEGMENTS * 6), 3).setUsage(THREE.DynamicDrawUsage);
    const dotsAt = new THREE.BufferAttribute(new Float32Array(CAP * 6), 3).setUsage(THREE.DynamicDrawUsage);
    const dotsColor = new THREE.BufferAttribute(new Float32Array(CAP * 6), 3).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', positions); geometry.setAttribute('color', colors);
    dots.setAttribute('position', dotsAt); dots.setAttribute('color', dotsColor);
    const material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .34, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const pointMaterial = new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: .8, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const lines = new THREE.LineSegments(geometry, material), points = new THREE.Points(dots, pointMaterial), group = new THREE.Group();
    lines.frustumCulled = points.frustumCulled = false;
    lines.renderOrder = 11; points.renderOrder = 12; group.name = 'activity-signals'; group.add(lines, points);
    const from = new THREE.Vector3(), to = new THREE.Vector3(), bend = new THREE.Vector3(), at = new THREE.Vector3();
    return { group, geometry, dots, material, pointMaterial, positions, colors, dotsAt, dotsColor, color: new THREE.Color(), from, to, bend, at, up: new THREE.Vector3(0,1,0),
      sample: (t: number) => at.copy(from).lerp(to, t).addScaledVector(bend, Math.sin(Math.PI * t)) };
  }, []);
  useEffect(() => () => { field.geometry.dispose(); field.dots.dispose(); field.material.dispose(); field.pointMaterial.dispose(); }, [field]);
  useFrame(() => {
    const app = useNaos.getState();
    field.group.visible = app.view.settings.signalRoutes && app.view.level === 'system' && !app.view.sky && !app.scene.demo?.active;
    if (!field.group.visible) return;
    let vertex = 0, dot = 0, index = 0;
    for (const world of controller.worldStates()) {
      if (world.belt || index >= CAP) continue;
      const length = world.position.length();
      if (length < 1) continue;
      field.from.copy(world.position).multiplyScalar(DISK_OUTER * .82 / length);
      field.to.copy(world.position).multiplyScalar((length - world.radius * 1.1) / length);
      field.bend.copy(world.position).cross(field.up).normalize().multiplyScalar(34).addScaledVector(field.up, 20);
      field.color.set(app.fleet.worlds[world.worldId]?.identity?.accent ?? '#8bb9ce');
      const gain = .12 + Math.min(1, world.load) * .65;
      for (let s = 0; s < SEGMENTS; s++) for (let end = 0; end < 2; end++) {
        const t = (s + end) / SEGMENTS; field.sample(t);
        field.positions.setXYZ(vertex, field.at.x, field.at.y, field.at.z);
        const fade = Math.sin(Math.PI * t) * gain;
        field.colors.setXYZ(vertex++, field.color.r * fade, field.color.g * fade, field.color.b * fade);
      }
      if (world.load > .01) for (let i = 0; i < 2; i++) {
        const t = state.still ? .35 + i * .3 : (state.now * (.045 + Math.min(1, world.load) * .06) + index * .17 + i * .5) % 1;
        field.sample(t); field.dotsAt.setXYZ(dot, field.at.x, field.at.y, field.at.z);
        field.dotsColor.setXYZ(dot++, field.color.r * 1.9, field.color.g * 1.9, field.color.b * 1.9);
      }
      index++;
    }
    field.geometry.setDrawRange(0, vertex); field.dots.setDrawRange(0, dot);
    field.positions.needsUpdate = field.colors.needsUpdate = field.dotsAt.needsUpdate = field.dotsColor.needsUpdate = true;
  }, -2);
  return <primitive object={field.group} />;
}
