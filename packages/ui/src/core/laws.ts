// Every mapping from data to picture. Pure functions, no three.js, shared by the scene and the Plate.

/** Law 2. 1 is an empty context window, 0 is a full one. Log scale, because agents end at p50 71k and p90 245k of a 1M window. */
export const altitude = (used: number, window: number): number =>
  Math.max(0, 1 - Math.log1p(used / 20_000) / Math.log1p(window / 20_000));

/** Law 3, owned craft. rad/s from live tokens per second. Compressed, so a craft never crawls and never spins. */
export const orbitRate = (tps: number): number => ((2 * Math.PI) / 18) * (1 - Math.exp(-tps / 40));

/** Law 3, observed craft. Radians to burn through when a response lands. Half an orbit at most. */
export const burnAngle = (tokens: number): number => Math.PI * (1 - Math.exp(-tokens / 3000));

/** Length of the drive plume in CSS px, before craftK. A generating craft is never below 30. */
export const plumeCss = (tps: number): number => 30 + 38 * (1 - Math.exp(-tps / 120));

/** Law 4. Einstein radius in CSS px from the age of the request. Age is the only urgency, because prompts have no deadline. */
export const thetaE = (ageS: number, freeH: number): number =>
  (freeH / 720) * Math.min(150, 56 * (1 + 0.4 * Math.log2(1 + ageS / 20)));

/** Ages at which a waiting well sends another wavefront, and repeats its alert. */
export const WAVE_AGES_S = [0, 30, 120, 600] as const;

/** Law 7. Everything the star lights dims with the window. */
export const quotaLight = (sunLeft: number): number => 0.28 + 0.72 * sunLeft;

/** Radius of a craft's orbit from its altitude. World units in the scene, with `craftK` 1, so an orbit does not change with the window. */
export const orbitCss = (worldR: number, alt: number, craftK: number): number => {
  const span = Math.min(66, Math.max(34, 1.3 * worldR)) * craftK;
  return worldR + 14 + alt * span;
};

/** Corona streamer of one world, 0..1, from its tokens per second. One busy craft already shows, a whole fleet tops out. */
export const streamLoad = (tps: number): number => 1 - Math.exp(-tps / 420);

/** Salvo rule. Measured on this machine: 113 fan-outs in October, launch gaps p25 3 ms, p50 1.9 s. */
export const SALVO = { openCount: 3, openWindowMs: 1_000, joinWindowMs: 10_000, maxStreaks: 16 } as const;
