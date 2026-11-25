// How a genome becomes shader numbers. Kept apart from three, so the tests can read it and a designer's field always lands somewhere.
import type { PlanetGenome } from '@naos/protocol';
import { linearOf, mulberry, normalQuantile, type Rgb } from './tables.ts';

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export const isFluid = (g: PlanetGenome): boolean => g.archetype === 'gas' || g.archetype === 'ice-giant' || g.archetype === 'shrouded';
export const hasOcean = (g: PlanetGenome): boolean => !isFluid(g) && g.oceans.coverage > 0.001;
export const hasClouds = (g: PlanetGenome): boolean => g.clouds.coverage > 0.001 || (g.clouds.wisps > 0.001 && g.atmosphere.density > 0.05);
export const hasAir = (g: PlanetGenome): boolean => g.atmosphere.density > 0.001;
/** Cloud tops in radii. About 19 km on an Earth: high enough to stand off the ground at low orbit, and low enough not to float. */
export const CLOUD_TOP = 0.003;

/** Heights in the relief cube run over plus and minus this, in radii. */
export function heightRange(g: PlanetGenome): number {
  return 0.02 + reliefAmplitude(g) * 2.4;
}

export function reliefAmplitude(g: PlanetGenome): number {
  return mix(0.004, 0.05, g.terrain.relief * g.terrain.relief);
}

/** The spread of the continent field, from reading real bakes back in the lab. One world can still land 0.1 off, its big shapes are few. */
const CONTINENT_SIGMA = 0.3;

export function seaLevel(g: PlanetGenome): number {
  return hasOcean(g) ? CONTINENT_SIGMA * normalQuantile(g.oceans.coverage) : 0;
}

/** Where the deck starts in the cloud field, which has about this spread. */
export const cloudCut = (coverage: number): number => 0.26 * normalQuantile(1 - coverage);

/** Three stable offsets into the noise volume. */
export function seedVector(seed: number): [number, number, number] {
  const r = mulberry(seed);
  return [r() * 16, r() * 16, r() * 16];
}

export interface Air {
  on: boolean;
  /** Scale height in radii. */
  h: number;
  tauR: Rgb;
  tauM: number;
  haze: Rgb;
  sky: Rgb;
  /** Multiple scattering gain. A deep column of air has it, the thin air over a giant's deck barely. */
  multi: number;
}

export function airOf(g: PlanetGenome): Air {
  const a = g.atmosphere;
  if (!hasAir(g)) return { on: false, h: 0.002, tauR: [0, 0, 0], tauM: 0, haze: [1, 1, 1], sky: [0, 0, 0], multi: 1 };
  const c = linearOf(a.color);
  const peak = Math.max(c[0], c[1], c[2], 1e-3);
  const n: Rgb = [c[0] / peak, c[1] / peak, c[2] / peak];
  return {
    on: true,
    h: mix(0.0018, 0.0085, a.height),
    tauR: [n[0] * a.density * 0.72, n[1] * a.density * 0.72, n[2] * a.density * 0.72],
    tauM: a.haze * a.density * 0.55,
    haze: [mix(1, n[0], 0.45), mix(1, n[1], 0.45), mix(1, n[2], 0.45)],
    sky: [n[0] * a.density * 0.1, n[1] * a.density * 0.1, n[2] * a.density * 0.1],
    multi: g.archetype === 'gas' || g.archetype === 'ice-giant' ? 0.9 : 2.5,
  };
}

/** Where the spin axis points in the plane of the orbit. Tilt says how far, this says which way, and the seed keeps it for life. */
export function poleAzimuth(seed: number): number {
  return mulberry(seed ^ 0x7f4a7c15)() * Math.PI * 2;
}

/** Radians of spin per second. Ruling 22: faster with activity, and never zero while the window is visible. */
export function spinRate(g: PlanetGenome, activity: number): number {
  const a = Math.min(1, Math.max(0, activity));
  const period = mix(160, 32, Math.sqrt(a));
  const direction = g.axialTilt > 90 ? -1 : 1;
  return ((Math.PI * 2) / period) * g.rotation.rate * direction;
}

/** Radians per second against the ground, of the deck (layer 0) or the high thin layer (1). The high layer always moves a little. */
export function cloudRate(g: PlanetGenome, activity: number, layer: 0 | 1): number {
  const a = Math.min(1, Math.max(0, activity));
  const base = (Math.PI * 2) / mix(520, 260, a);
  return layer === 0 ? base * g.clouds.drift : base * (g.clouds.drift * 1.6 + 0.12);
}

export const cubeBytes = (size: number, bytesPerTexel: number): number => Math.round(size * size * 6 * bytesPerTexel * (4 / 3));
