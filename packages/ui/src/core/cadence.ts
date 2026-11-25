// How fast the canvas has to render, DESIGN 11.1 and INTERSTELLAR 22. Pure: facts in, one of five cadences out.
import type { Cadence } from './tiers.ts';

export interface CadenceFacts {
  now: number;
  hidden: boolean;
  linkUp: boolean;
  /** The canvas is off screen: Sky view, Plate, or a lost context. */
  covered: boolean;
  /** An owned craft is producing tokens, or a burn is in flight. */
  burning: boolean;
  /** An observed craft is working. A moored craft is not. */
  observed: boolean;
  /** End of the last event, its 400 ms hold included. */
  holdUntil: number;
  /** Reduced motion. Nothing travels, so only a change draws, DESIGN 11.6. */
  still: boolean;
}

export const EVENT_HOLD_MS = 400;

/** `alive` is the rest of a scene with physics in it: planets turn, moons orbit. What it costs in Hz is the table's, and on battery that is nothing. */
export function chooseCadence(f: CadenceFacts): Cadence {
  if (f.hidden || !f.linkUp || f.covered) return 'rest';
  if (f.now < f.holdUntil) return 'event';
  if (f.still) return 'rest';
  if (f.burning) return 'cruise';
  return f.observed ? 'drift' : 'alive';
}
