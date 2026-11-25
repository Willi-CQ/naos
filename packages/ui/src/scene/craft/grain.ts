// Baked surface noise. A pixel of hull used to hash its way through dozens of noise lookups, and one close ship paid for that across half the
// frame. A few texture fetches give the same weathering, and mipmaps fade it out for free. Both tile, and both are pure so they can be held.

const fade = (t: number): number => t * t * (3 - 2 * t);

/** `size` cubed, four channels: independent tiling noise, three octaves each, centred near 0.5. */
export function buildGrain(size = 32): Uint8Array {
  const data = new Uint8Array(size * size * size * 4);
  let seed = 90127;
  const r = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const octaves = [{ cells: 4, gain: 0.5 }, { cells: 8, gain: 0.3 }, { cells: 16, gain: 0.2 }];
  for (let ch = 0; ch < 4; ch++) {
    for (const { cells, gain } of octaves) {
      const lattice = new Float32Array(cells * cells * cells);
      for (let i = 0; i < lattice.length; i++) lattice[i] = r();
      const at = (x: number, y: number, z: number): number => lattice[(x % cells) + cells * ((y % cells) + cells * (z % cells))]!;
      let o = ch;
      for (let k = 0; k < size; k++) {
        const fz = (k / size) * cells;
        const z0 = Math.floor(fz);
        const tz = fade(fz - z0);
        for (let j = 0; j < size; j++) {
          const fy = (j / size) * cells;
          const y0 = Math.floor(fy);
          const ty = fade(fy - y0);
          for (let i = 0; i < size; i++) {
            const fx = (i / size) * cells;
            const x0 = Math.floor(fx);
            const tx = fade(fx - x0);
            const a = at(x0, y0, z0) + (at(x0 + 1, y0, z0) - at(x0, y0, z0)) * tx;
            const b = at(x0, y0 + 1, z0) + (at(x0 + 1, y0 + 1, z0) - at(x0, y0 + 1, z0)) * tx;
            const c = at(x0, y0, z0 + 1) + (at(x0 + 1, y0, z0 + 1) - at(x0, y0, z0 + 1)) * tx;
            const d = at(x0, y0 + 1, z0 + 1) + (at(x0 + 1, y0 + 1, z0 + 1) - at(x0, y0 + 1, z0 + 1)) * tx;
            const near = a + (b - a) * ty;
            const far = c + (d - c) * ty;
            data[o] = Math.min(255, data[o]! + (near + (far - near) * tz) * gain * 255);
            o += 4;
          }
        }
      }
    }
  }
  return data;
}

/**
 * Crumpled film, `size` squared and tiling: each cell of a jittered grid is one flat facet, with its tilt in red and green and a tone in blue.
 * The flat cells are what make foil glitter instead of looking like noise, and the mip chain averages them to a smooth gold further off.
 */
export function buildCrumple(size = 128, cells = 18): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  let seed = 4231;
  const r = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const jitter = new Float32Array(cells * cells * 5);
  for (let i = 0; i < jitter.length; i++) jitter[i] = r();
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = (i / size) * cells, v = (j / size) * cells;
      const cu = Math.floor(u), cv = Math.floor(v);
      let best = 1e9;
      let hit = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const gx = (cu + dx + cells) % cells, gy = (cv + dy + cells) % cells;
          const k = (gx + gy * cells) * 5;
          const px = cu + dx + jitter[k]!, py = cv + dy + jitter[k + 1]!;
          const d = (px - u) * (px - u) + (py - v) * (py - v);
          if (d < best) { best = d; hit = k; }
        }
      }
      const o = (i + j * size) * 4;
      data[o] = jitter[hit + 2]! * 255;
      data[o + 1] = jitter[hit + 3]! * 255;
      data[o + 2] = jitter[hit + 4]! * 255;
      data[o + 3] = 255;
    }
  }
  return data;
}
