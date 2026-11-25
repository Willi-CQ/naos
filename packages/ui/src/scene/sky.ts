// The Almanac Sky as typed arrays, DESIGN 7.1. Input is history, output is what sky-point and sky-line read.
import * as THREE from 'three';
import { jitter, spokeHalfDeg, type SkySpoke, type SkyStar } from '../store/sky.ts';
import type { SkyFrame } from './camera.ts';
import { linear, type Token } from './tokens.ts';

export type { SkySpoke, SkyStar };

const DEG = Math.PI / 180;

export interface SkyPoints { dir: Float32Array; color: Float32Array; size: Float32Array; count: number }
export interface SkyLines { ra: Float32Array; dec: Float32Array; color: Float32Array; fade: Float32Array; count: number }
export interface SkyData {
  stars: SkyPoints;
  dust: SkyPoints;
  lines: SkyLines;
  /** How much landed on each day of the month, 0..1. The diffuse light of the band follows it, so even the glow is the month. */
  days: Float32Array;
}

/** Line gains, tuned on the Arc to the displayed peaks in DESIGN 5.1. */
export const LINE_GAIN = { day: 0.014, week: 0.032, now: 0.085, horizon: 0.07, spoke: 0.08 } as const;

/** The month goes once around the whole sky and closes on itself: now meets the Horizon just right of the Home frame. */
export const RA_STEP = 12 * DEG;
export const RA_NOW = -15 * DEG;
export const raOf = (ageDays: number): number => RA_NOW + RA_STEP * ageDays;
const BAND_SPREAD = 4;

function direction(frame: SkyFrame, ra: number, dec: number, out: Float32Array, i: number): void {
  const x = Math.cos(dec) * Math.cos(ra);
  const y = Math.cos(dec) * Math.sin(ra);
  const z = Math.sin(dec);
  out[i * 3] = frame.e1.x * x + frame.e2.x * y + frame.e3.x * z;
  out[i * 3 + 1] = frame.e1.y * x + frame.e2.y * y + frame.e3.y * z;
  out[i * 3 + 2] = frame.e1.z * x + frame.e2.z * y + frame.e3.z * z;
}

const writeRgb = (out: Float32Array, i: number, c: THREE.Color, k: number) => {
  out[i * 3] = c.r * k;
  out[i * 3 + 1] = c.g * k;
  out[i * 3 + 2] = c.b * k;
};

/**
 * `sigmaCss` here is what DESIGN 7.1 calls diameter: the stills spread each star as a gaussian of that sigma, in px of a
 * 1080 high frame. sky-point draws `exp(-12 d^2)` over the point, whose sigma is 0.204 of the point size. So the point is
 * 4.9 sigma across, and its peak is flux over 2 pi sigma^2.
 */
const STILL_PX_PER_CSS = 1.5 / 1.11;
const POINT_PER_SIGMA = 1 / 0.204;

/** The sky redraw stays cheap on a heavy month: past this, one dust point stands for more than 64 KiB. */
const DUST_CEILING = 64_000;

export function buildSky(stars: readonly SkyStar[], spokes: readonly SkySpoke[], frame: SkyFrame, dustScale = 16): SkyData {
  const heavy = stars.reduce((a, f) => a + f.mb, 0);
  const dustPerMb = Math.min(dustScale, DUST_CEILING / Math.max(1, heavy));
  const dustTotal = stars.reduce((a, f) => a + Math.floor(f.mb * dustPerMb), 0);
  const out: SkyData = {
    stars: { dir: new Float32Array(stars.length * 3), color: new Float32Array(stars.length * 3), size: new Float32Array(stars.length), count: stars.length },
    dust: { dir: new Float32Array(dustTotal * 3), color: new Float32Array(dustTotal * 3), size: new Float32Array(dustTotal), count: dustTotal },
    lines: { ra: new Float32Array(31 + spokes.length), dec: new Float32Array((31 + spokes.length) * 2), color: new Float32Array((31 + spokes.length) * 4), fade: new Float32Array(31 + spokes.length), count: 31 + spokes.length },
    days: new Float32Array(31),
  };
  for (const f of stars) { const d = Math.min(30, Math.floor(f.ageDays)); out.days[d] = out.days[d]! + Math.log2(1 + f.mb); }
  const peak = out.days.reduce((a, v) => Math.max(a, v), 0);
  if (peak > 0) for (let i = 0; i < 31; i++) out.days[i] = out.days[i]! / peak;

  const dustColor = linear('dust');
  let d = 0;
  stars.forEach((f, i) => {
    const gauss = jitter(f.seed);
    const ra = raOf(f.ageDays) + gauss() * 2.5 * DEG;
    // Agents scatter wider, and a few of everything stray far from the band, or half the sky would stay empty from where the camera now goes.
    const stray = 1 + BAND_SPREAD * Math.abs(gauss()) ** 3;
    const dec = (f.laneDeg * 1.2 + gauss() * (f.agent ? 6.5 : 4) * stray) * DEG;
    direction(frame, ra, dec, out.stars.dir, i);
    const sigma = 0.62 + 0.09 * Math.log2(1 + f.mb);
    const flux = 0.75 + 0.36 * Math.log2(1 + 4 * f.mb);
    out.stars.size[i] = (sigma / STILL_PX_PER_CSS) * POINT_PER_SIGMA;
    writeRgb(out.stars.color, i, linear(f.star), flux / (2 * Math.PI * sigma * sigma));
    for (let n = Math.floor(f.mb * dustPerMb); n > 0; n--, d++) {
      const far = 1 + BAND_SPREAD * Math.abs(gauss()) ** 3;
      direction(frame, ra + gauss() * 5 * DEG, dec + gauss() * 7 * far * DEG, out.dust.dir, d);
      out.dust.size[d] = 1.5;
      writeRgb(out.dust.color, d, dustColor, 0.08);
    }
  });

  const put = (i: number, ra: number, lo: number, hi: number, token: Token, gain: number, fade: number) => {
    out.lines.ra[i] = ra;
    out.lines.dec[i * 2] = lo;
    out.lines.dec[i * 2 + 1] = hi;
    const c = linear(token);
    out.lines.color.set([c.r, c.g, c.b, gain], i * 4);
    out.lines.fade[i] = fade;
  };
  for (let day = 0; day <= 30; day++) {
    const gain = day === 0 ? LINE_GAIN.now : day === 30 ? 0 : day % 7 === 0 ? LINE_GAIN.week : LINE_GAIN.day;
    put(day, raOf(day), -1.5, 1.5, day === 0 ? 'now' : 'meridian', gain, 1);
  }
  spokes.forEach((spoke, i) => {
    const half = spokeHalfDeg(spoke.count);
    put(31 + i, raOf(spoke.ageDays), (spoke.laneDeg - half) * DEG, (spoke.laneDeg + half) * DEG, 'starG', LINE_GAIN.spoke, 0);
  });
  return out;
}
