// The 256 x 256 tiling noise of the corona and the ring. Built once at boot, from the same three octaves as the stills.
import * as THREE from 'three';

const SIZE = 256;
// Whole numbers of cells, so every octave tiles. 1 unit of the stills' noise is 0.1 of the texture.
const OCTAVES = [[10, 0.55], [21, 0.3], [43, 0.15]] as const;

function hash(i: number, j: number, salt: number): number {
  let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(salt, 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, period: number, salt: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const wrap = (n: number) => ((n % period) + period) % period;
  const at = (i: number, j: number) => hash(wrap(i), wrap(j), salt);
  const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * u;
  const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * u;
  return a + (b - a) * v;
}

export function buildNoiseData(): Uint8Array {
  const data = new Uint8Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let n = 0;
      OCTAVES.forEach(([cells, weight], k) => { n += weight * valueNoise((x / SIZE) * cells, (y / SIZE) * cells, cells, k + 1); });
      data[y * SIZE + x] = Math.round(Math.min(1, Math.max(0, n)) * 255);
    }
  }
  return data;
}

export function buildNoiseTexture(): THREE.DataTexture {
  const t = new THREE.DataTexture(buildNoiseData(), SIZE, SIZE, THREE.RedFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}
