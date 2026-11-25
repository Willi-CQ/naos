// Quality tiers, render cadence, and the automatic switch between tiers.
import type { Rect } from './layout.ts';

export interface Tier {
  name: 'Umbra' | 'Corona' | 'Penumbra';
  /** Multiplier of devicePixelRatio, never an absolute dpr. */
  scale: number;
  /** Ceiling on the drawing buffer, megapixels. */
  maxMP: number;
  bloomLevels: number;
  coronaHz: number;
  skyScale: number;
  motes: number;
  cities: number;
}

export const TIERS: readonly Tier[] = [
  { name: 'Umbra', scale: 1, maxMP: 3, bloomLevels: 6, coronaHz: 30, skyScale: 1, motes: 1024, cities: 8192 },
  { name: 'Corona', scale: 0.85, maxMP: 2, bloomLevels: 5, coronaHz: 15, skyScale: 0.75, motes: 512, cities: 8192 },
  { name: 'Penumbra', scale: 0.7, maxMP: 1.2, bloomLevels: 4, coronaHz: 15, skyScale: 0.5, motes: 256, cities: 4096 },
];

/** R3F treats a numeric dpr as absolute, so derive it from the display. */
export const renderDpr = (t: Tier, free: Rect, devicePixelRatio: number): number =>
  Math.min(devicePixelRatio * t.scale, Math.sqrt((t.maxMP * 1e6) / (free.w * free.h)));

export type Cadence = 'rest' | 'alive' | 'drift' | 'cruise' | 'event';
/** INTERSTELLAR 22: on mains the window never shows less than 30 Hz, and on battery the old rest rule holds. */
export const CADENCE_HZ: Record<Cadence, number> = { rest: 0, alive: 30, drift: 30, cruise: 30, event: 60 };
export const BATTERY_CAP_HZ: Record<Cadence, number> = { rest: 0, alive: 0, drift: 10, cruise: 20, event: 30 };

/**
 * Picks the tier from measured frame intervals. Knows nothing about React or three.
 * Feed it the rAF delta of each frame the cadence driver asked for. It ignores the first 3 frames after any rest.
 * A vsync locked interval cannot fall below budget, so headroom cannot be read from it. Stepping up is a probe:
 * after 60 s on time it tries one tier higher, and a step down within 30 s counts as a failed probe. Three end the probing.
 */
export class TierMonitor {
  private samples: number[] = [];
  private lastChangeAt = -Infinity;
  private lastUpAt = -Infinity;
  private onTimeSince = -Infinity;
  private overBudget = 0;
  private skip = 3;
  private failedUps = 0;
  private hz = 0;
  private plated = false;
  private readonly onChange: (index: number) => void;
  private readonly onPlate: () => void;
  /** Ceiling the cadence driver obeys. Halves before the Plate is considered. */
  capHz = 60;
  index: number;

  constructor(start: number, onChange: (index: number) => void, onPlate: () => void) {
    this.index = start;
    this.onChange = onChange;
    this.onPlate = onPlate;
  }

  /** Call when the cadence falls to rest or the tab hides. */
  rest(): void { this.skip = 3; this.samples.length = 0; this.onTimeSince = -Infinity; }

  frame(dtMs: number, hz: number, now: number): void {
    if (hz <= 0 || this.plated) return;
    if (hz !== this.hz) { this.hz = hz; this.samples.length = 0; }    // never mix two cadences in one window
    if (this.skip > 0) { this.skip--; return; }
    this.samples.push(dtMs);
    if (this.samples.length < Math.max(30, hz)) return;               // 1 s at 30 and 60 Hz, 2 s at 15 Hz
    const sorted = [...this.samples].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    this.samples.length = 0;
    const budget = 1000 / hz;
    if (p95 > budget * 1.2) {
      this.onTimeSince = -Infinity;
      if (++this.overBudget >= 2 && now - this.lastChangeAt >= 10_000) {
        this.overBudget = 0;
        this.lastChangeAt = now;
        if (this.index < TIERS.length - 1) {
          if (now - this.lastUpAt < 30_000) this.failedUps++;
          this.onChange(++this.index);
        } else if (this.capHz > 15) this.capHz /= 2;
        else if (p95 > 100) { this.plated = true; this.onPlate(); }
      }
      return;
    }
    this.overBudget = 0;
    if (hz < 30 || p95 > budget * 1.05) return;                       // 15 Hz proves nothing about a higher tier
    if (this.onTimeSince === -Infinity) this.onTimeSince = now;
    if (this.index > 0 && this.failedUps < 3 && now - this.onTimeSince >= 60_000 && now - this.lastChangeAt >= 60_000) {
      this.lastChangeAt = this.lastUpAt = now;
      this.onTimeSince = -Infinity;
      this.onChange(--this.index);
    }
  }
}
