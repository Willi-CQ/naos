// A ship's orientation from its flight. Apart from the layer because it is plain maths: the layer's shader imports do not load in Node.
import * as THREE from 'three';

const basis = new THREE.Matrix4();
const zAxis = new THREE.Vector3();
const upAxis = new THREE.Vector3();
const yAxis = new THREE.Vector3(0, 1, 0);
const fallbackAxis = new THREE.Vector3(0, 0, 1);
const yaw = new THREE.Quaternion();
const roll = new THREE.Quaternion();
const tumbleAxis = new THREE.Vector3(0.36, 0.48, 0.8).normalize();

/**
 * `tangent` is the way it flies and `outward` the way away from what it orbits, so dorsal faces out. `turn` is the yaw of a retry or a retro
 * burn, and `tumble` the slow dead roll of an error, both from the state table. Allocates nothing.
 */
export function shipFrame(tangent: THREE.Vector3, outward: THREE.Vector3, turn: number, tumble: number, out: THREE.Quaternion): THREE.Quaternion {
  zAxis.crossVectors(tangent, outward);
  if (zAxis.lengthSq() < 1e-8) zAxis.crossVectors(tangent, Math.abs(tangent.y) < 0.9 ? yAxis : fallbackAxis);
  zAxis.normalize();
  upAxis.crossVectors(zAxis, tangent).normalize();
  basis.makeBasis(tangent, upAxis, zAxis);
  out.setFromRotationMatrix(basis);
  if (turn !== 0) out.multiply(yaw.setFromAxisAngle(yAxis, turn));
  if (tumble !== 0) out.multiply(roll.setFromAxisAngle(tumbleAxis, tumble));
  return out;
}
