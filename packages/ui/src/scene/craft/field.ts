// A solid copy of a part in voxels, blurred at two scales. The ship shader reads it for soft occlusion and, stepping toward the light, for a
// soft self shadow. Stored apart from the mesh, so the near and the far level of a part are lit by the same numbers and cannot pop, and big
// flat plates shade as well as a dense mesh would.
import type { Mesh, V3 } from './forge.ts';

export interface Field {
  /** Two channels per voxel: fine occupancy, coarse occupancy. */
  data: Uint8Array;
  nx: number; ny: number; nz: number;
  min: V3;
  /** One over the size of the box, so a position turns into a texture coordinate. */
  inverse: V3;
  /** Metres. */
  cell: number;
}

export function buildField(mesh: Mesh, longest = 128): Field {
  const pad = 3;
  const span = [mesh.max[0] - mesh.min[0], mesh.max[1] - mesh.min[1], mesh.max[2] - mesh.min[2]] as const;
  const cell = Math.max(span[0], span[1], span[2]) / (longest - pad * 2);
  const dim = (i: number): number => Math.max(8, Math.min(longest, Math.ceil(span[i]! / cell) + pad * 2));
  const nx = dim(0), ny = dim(1), nz = dim(2);
  const min: V3 = [mesh.min[0] - pad * cell, mesh.min[1] - pad * cell, mesh.min[2] - pad * cell];
  const count = nx * ny * nz;
  const solid = new Uint8Array(count);
  const at = (x: number, y: number, z: number): number => x + nx * (y + ny * z);
  const { position, index } = mesh;

  // Every triangle stamped at cell spacing. Cheap, and watertight enough for the flood fill below.
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t]! * 3, b = index[t + 1]! * 3, c = index[t + 2]! * 3;
    const ax = position[a]!, ay = position[a + 1]!, az = position[a + 2]!;
    const bx = position[b]! - ax, by = position[b + 1]! - ay, bz = position[b + 2]! - az;
    const cx = position[c]! - ax, cy = position[c + 1]! - ay, cz = position[c + 2]! - az;
    const steps = Math.min(64, Math.ceil(Math.max(Math.hypot(bx, by, bz), Math.hypot(cx, cy, cz)) / (cell * 0.7)));
    for (let i = 0; i <= steps; i++) {
      for (let j = 0; j <= steps - i; j++) {
        const u = i / steps, v = j / steps;
        const x = Math.floor((ax + bx * u + cx * v - min[0]) / cell);
        const y = Math.floor((ay + by * u + cy * v - min[1]) / cell);
        const z = Math.floor((az + bz * u + cz * v - min[2]) / cell);
        if (x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz) solid[at(x, y, z)] = 1;
      }
    }
  }

  // Whatever the outside cannot reach is inside the hull, so a tank is a mass and not a thin shell.
  const seen = new Uint8Array(count);
  const stack = new Int32Array(count);
  let top = 0;
  stack[top++] = 0;
  seen[0] = 1;
  const row = nx, layer = nx * ny;
  while (top > 0) {
    const i = stack[--top]!;
    const z = Math.floor(i / layer);
    const y = Math.floor((i - z * layer) / row);
    const x = i - row * y - layer * z;
    if (x > 0 && !seen[i - 1] && !solid[i - 1]) { seen[i - 1] = 1; stack[top++] = i - 1; }
    if (x + 1 < nx && !seen[i + 1] && !solid[i + 1]) { seen[i + 1] = 1; stack[top++] = i + 1; }
    if (y > 0 && !seen[i - row] && !solid[i - row]) { seen[i - row] = 1; stack[top++] = i - row; }
    if (y + 1 < ny && !seen[i + row] && !solid[i + row]) { seen[i + row] = 1; stack[top++] = i + row; }
    if (z > 0 && !seen[i - layer] && !solid[i - layer]) { seen[i - layer] = 1; stack[top++] = i - layer; }
    if (z + 1 < nz && !seen[i + layer] && !solid[i + layer]) { seen[i + layer] = 1; stack[top++] = i + layer; }
  }
  const occupied = new Float32Array(count);
  for (let i = 0; i < count; i++) occupied[i] = seen[i] ? 0 : 1;

  const fine = blur(occupied, nx, ny, nz, 1, 2);
  const coarse = blur(occupied, nx, ny, nz, 4, 2);
  const data = new Uint8Array(count * 2);
  for (let i = 0; i < count; i++) {
    data[i * 2] = Math.round(fine[i]! * 255);
    data[i * 2 + 1] = Math.round(coarse[i]! * 255);
  }
  return { data, nx, ny, nz, min, inverse: [1 / (nx * cell), 1 / (ny * cell), 1 / (nz * cell)], cell };
}

/** One running box along one axis. Written as flat loops: this runs over a few hundred thousand voxels while a frame waits. */
function pass(src: Float32Array, dst: Float32Array, lines: number, n: number, lineStep: number, step: number, r: number): void {
  const w = 1 / (r * 2 + 1);
  for (let l = 0; l < lines; l++) {
    const o = l * lineStep;
    let sum = src[o]! * (r + 1);
    for (let k = 1; k <= r; k++) sum += src[o + Math.min(n - 1, k) * step]!;
    for (let k = 0; k < n; k++) {
      dst[o + k * step] = sum * w;
      const add = k + r + 1 < n ? k + r + 1 : n - 1;
      const drop = k - r > 0 ? k - r : 0;
      sum += src[o + add * step]! - src[o + drop * step]!;
    }
  }
}

function blur(input: Float32Array, nx: number, ny: number, nz: number, radius: number, passes: number): Float32Array {
  let a = input.slice();
  let b = new Float32Array(input.length);
  const row = nx, layer = nx * ny;
  for (let p = 0; p < passes; p++) {
    pass(a, b, ny * nz, nx, row, 1, radius);
    [a, b] = [b, a];
    for (let z = 0; z < nz; z++) passAt(a, b, nx, ny, row, z * layer, radius);
    [a, b] = [b, a];
    pass(a, b, layer, nz, 1, layer, radius);
    [a, b] = [b, a];
  }
  return a;
}

/** The y axis, one z layer at a time, because its lines do not start at multiples of one stride. */
function passAt(src: Float32Array, dst: Float32Array, lines: number, n: number, step: number, base: number, r: number): void {
  const w = 1 / (r * 2 + 1);
  for (let l = 0; l < lines; l++) {
    const o = base + l;
    let sum = src[o]! * (r + 1);
    for (let k = 1; k <= r; k++) sum += src[o + Math.min(n - 1, k) * step]!;
    for (let k = 0; k < n; k++) {
      dst[o + k * step] = sum * w;
      const add = k + r + 1 < n ? k + r + 1 : n - 1;
      const drop = k - r > 0 ? k - r : 0;
      sum += src[o + add * step]! - src[o + drop * step]!;
    }
  }
}
