// A synthetic month of history, shaped like the survey in DESIGN 7.1: 2,177 transcripts, 2.09 GB, about 36,000 points.
// No file on this machine is read. It exists so the bench loads the GPU like the real sky will.
import type { SkySpoke, SkyStar } from '../scene/sky.ts';

/** Bursts of work, read off the reference renders: the month clumps about one week apart. */
const BURSTS: readonly { age: number; spread: number; weight: number }[] = [
  { age: 1, spread: 0.7, weight: 0.13 },
  { age: 5.2, spread: 0.9, weight: 0.14 },
  { age: 12, spread: 0.8, weight: 0.13 },
  { age: 19.6, spread: 0.9, weight: 0.16 },
  { age: 26.6, spread: 1.6, weight: 0.36 },
];

/** Spokes from the reference renders: age, agents. */
export const SPOKES: readonly SkySpoke[] = ([
  [0.4, 5], [1.2, 3], [2.3, 16], [5.4, 4], [5.6, 3], [9.2, 7], [12.3, 3], [15.1, 5], [21.4, 9],
] as const).map(([ageDays, count]) => ({ ageDays, count, laneDeg: 0 }));

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

const gaussian = (r: () => number) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * (1 - r()));

export function syntheticSky(count = 2177, seed = 77): SkyStar[] {
  const r = rng(seed);
  const lanes = Array.from({ length: 14 }, () => (r() * 2 - 1) * 15);
  // A burst is a few sittings, and a sitting is hours long. That is what draws thin bright strips along the meridians.
  const sittings = BURSTS.map((b) => Array.from({ length: 3 + Math.floor(b.spread * 3) }, () => b.age + gaussian(r) * b.spread));
  const out: SkyStar[] = [];
  for (let i = 0; i < count; i++) {
    let pick = r();
    let age = r() * 30;
    for (let k = 0; k < BURSTS.length; k++) {
      pick -= BURSTS[k]!.weight;
      if (pick <= 0) {
        const s = sittings[k]!;
        age = s[Math.floor(r() ** 1.4 * s.length)]! + gaussian(r) * 0.12;
        break;
      }
    }
    age = Math.min(30, Math.max(0, age));
    const agent = r() < 0.86;
    // Heavy tail, as on this machine: a few huge transcripts make the dust clouds, DESIGN 7.1.
    const mb = Math.min(120, Math.exp(-2.1 + 2.1 * gaussian(r)));
    const c = r();
    const star = !agent ? 'starG' : c < 0.45 ? 'starO' : c < 0.8 ? 'starG' : c < 0.93 ? 'starA' : 'starM';
    out.push({ seed: Math.floor(r() * 4294967296), ageDays: age, laneDeg: lanes[Math.floor(r() ** 1.6 * lanes.length)]!, agent, mb, star });
  }
  return out;
}
