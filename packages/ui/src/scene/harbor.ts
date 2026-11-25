import type * as THREE from 'three';
import { hash32 } from '../store/veil.ts';
import { UP } from '../core/space.ts';

interface DockBody { position: THREE.Vector3; radius: number; a: THREE.Vector3; b: THREE.Vector3 }

/** On the inward, lit side of a world, fixed in the orbital plane rather than following the camera. */
export function harborAt(worldId: string, body: DockBody, out: THREE.Vector3, up: THREE.Vector3): void {
  const angle = Math.atan2(-body.position.dot(body.b), -body.position.dot(body.a)) + 0.9 + (hash32(worldId) % 20) / 100;
  up.crossVectors(body.b, body.a).normalize();
  const above = up.x * UP[0] + up.y * UP[1] + up.z * UP[2] >= 0 ? 1 : -1;
  out.copy(body.position).addScaledVector(body.a, Math.cos(angle) * body.radius * 1.65)
    .addScaledVector(body.b, Math.sin(angle) * body.radius * 1.65).addScaledVector(up, body.radius * 1.35 * above);
}
