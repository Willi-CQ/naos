import type { Orbit } from './space.ts';

export type CameraAngle = 'home' | 'atlas' | 'horizon';
export type CameraCommand = { type: 'angle'; angle: CameraAngle } | { type: 'tour'; enabled: boolean } | { type: 'journey' };

/** One gentle orbit in three minutes, counting only time spent visible. */
export function tourOrbit(base: Orbit, seconds: number): Orbit {
  const phase = Math.max(0, seconds) * Math.PI * 2 / 180;
  const poleRoom = Math.PI / 2 - Math.abs(base.el);
  const amplitude = Math.min(0.055, poleRoom + 0.055);
  const inward = (1 - Math.cos(phase * 2)) * 0.5;
  return { az: base.az + phase, el: base.el - Math.sign(base.el || 1) * amplitude * inward,
    dist: base.dist * (1 + (1 - Math.cos(phase)) * 0.025) };
}
const listeners = new Set<(command: CameraCommand) => void>();
export function cameraCommand(command: CameraCommand): void { for (const listener of listeners) listener(command); }
export function onCameraCommand(listener: (command: CameraCommand) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
