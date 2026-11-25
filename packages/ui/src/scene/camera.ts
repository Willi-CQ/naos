// The three.js side of core/space.ts, and the sky frame. A lens over a real 3D system: Home is the composed view, everything else is the rig's.
import * as THREE from 'three';
import type { Rect } from '../core/layout.ts';
import { HOME, homeDistance, orbitBasis } from '../core/space.ts';

const DEG = Math.PI / 180;
/** The month crosses the Home frame on a long diagonal, against the slant of the disk. */
const SKY_TILT = -58 * DEG;

const scratch = new THREE.Vector3();
const right = new THREE.Vector3();
const up = new THREE.Vector3();
const back = new THREE.Vector3();
const basis = new THREE.Matrix4();

export function systemCamera(free: Rect, azimuth: number = HOME.az, elevation: number = HOME.el): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(HOME.fov, free.w / free.h, 4, 12000);
  aimSystem(camera, free, azimuth, elevation);
  return camera;
}

/** Puts the camera on its sphere around the hole, for the bench and for a first frame. The app's camera belongs to the rig. */
export function aimSystem(camera: THREE.PerspectiveCamera, free: Rect, azimuth: number = HOME.az, elevation: number = HOME.el): void {
  const d = homeDistance(free);
  const b = orbitBasis(azimuth, elevation);
  camera.position.set(b.back[0] * d, b.back[1] * d, b.back[2] * d);
  right.fromArray(b.right);
  up.fromArray(b.up);
  back.fromArray(b.back);
  camera.quaternion.setFromRotationMatrix(basis.makeBasis(right, up, back));
  camera.updateMatrixWorld(true);
}

/** `e1`, `e2`, `e3` of the Almanac Sky. The sky is a place, so this is a constant: the same stars stand in the same direction in any window. */
export interface SkyFrame { e1: THREE.Vector3; e2: THREE.Vector3; e3: THREE.Vector3; matrix: THREE.Matrix3 }

export function skyFrame(): SkyFrame {
  const b = orbitBasis(HOME.az, HOME.el);
  const e1 = new THREE.Vector3().fromArray(b.back).negate();
  const camRight = new THREE.Vector3().fromArray(b.right);
  const camUp = new THREE.Vector3().fromArray(b.up);
  const e3 = camUp.clone().multiplyScalar(Math.cos(SKY_TILT)).addScaledVector(camRight, Math.sin(SKY_TILT)).normalize();
  const e2 = e3.clone().cross(e1);
  const matrix = new THREE.Matrix3().set(e1.x, e2.x, e3.x, e1.y, e2.y, e3.y, e1.z, e2.z, e3.z);
  return { e1, e2, e3, matrix };
}

/** CSS px per world unit at a world position. */
export function cssPerUnit(camera: THREE.PerspectiveCamera, free: Rect, position: THREE.Vector3): number {
  const depth = scratch.copy(position).applyMatrix4(camera.matrixWorldInverse).z;
  return free.h / 2 / Math.tan((camera.fov * Math.PI) / 360) / Math.max(1e-3, -depth);
}

/** Canvas px, GL origin at the bottom left. Returns false behind the camera. */
export function toCanvasPx(camera: THREE.Camera, position: THREE.Vector3, width: number, height: number, out: THREE.Vector2): boolean {
  scratch.copy(position).applyMatrix4(camera.matrixWorldInverse);
  if (scratch.z >= 0) return false;
  scratch.applyMatrix4(camera.projectionMatrix);
  out.set((scratch.x * 0.5 + 0.5) * width, (scratch.y * 0.5 + 0.5) * height);
  return true;
}
