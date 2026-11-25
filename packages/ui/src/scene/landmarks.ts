import type { SkyPoints } from './sky.ts';
import { HOME, orbitBasis } from '../core/space.ts';

/** Permanent navigation stars. History never changes their directions. */
export function landmarkStars(): SkyPoints {
  const count = 105;
  const dir = new Float32Array(count * 3), color = new Float32Array(count * 3), size = new Float32Array(count);
  const write = (i: number, x: number, y: number, z: number, diameter: number, warm: boolean) => {
    const length = Math.hypot(x, y, z);
    dir.set([x / length, y / length, z / length], i * 3);
    color.set(warm ? [6.2, 4.2, 2.6] : [3.4, 4.8, 7.5], i * 3);
    size[i] = diameter;
  };
  for (let i = 0; i < count - 5; i++) {
    const y = 1 - 2 * (i + 0.5) / (count - 5), a = i * 2.39996323, r = Math.sqrt(1 - y * y);
    write(i, Math.cos(a) * r, y, Math.sin(a) * r, 12 + (i * 13 % 17), i % 4 === 0);
  }
  const b = orbitBasis(HOME.az, HOME.el);
  const marks = [[-0.24, 0.14, 26], [0.25, 0.18, 21], [-0.35, -0.13, 17], [0.13, -0.21, 23], [0.38, 0.04, 15]];
  marks.forEach(([x, y, diameter], k) => write(count - 5 + k,
    -b.back[0] + b.right[0] * x! + b.up[0] * y!, -b.back[1] + b.right[1] * x! + b.up[1] * y!, -b.back[2] + b.right[2] * x! + b.up[2] * y!, diameter!, k === 0 || k === 3));
  return { dir, color, size, count };
}
