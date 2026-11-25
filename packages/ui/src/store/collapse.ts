// Rail overflow, DESIGN 4.3. Healthy worlds fold to one row, least attention first. A world with a fault or a decision never folds.
import type { WorldId } from '@naos/protocol';
import type { WorldVM } from './model.ts';

/** A world row takes 27 px at 20 px rows: the row, 2 above, 5 below. */
const WORLD_EXTRA = 7;

export function collapsedWorlds(
  worlds: readonly Pick<WorldVM, 'worldId' | 'rows' | 'bestTier' | 'slot'>[],
  availablePx: number,
  rowPx: number,
  overrides: Readonly<Record<WorldId, boolean>>,
): Set<WorldId> {
  const out = new Set<WorldId>();
  for (const w of worlds) if (overrides[w.worldId] === true) out.add(w.worldId);
  const height = (w: (typeof worlds)[number]): number => rowPx + WORLD_EXTRA + (out.has(w.worldId) ? 0 : w.rows.length * rowPx);
  let total = worlds.reduce((sum, w) => sum + height(w), 0);
  if (total <= availablePx) return out;
  // Fold the calmest first, and among equals the one that gives back the most rows.
  const healthy = worlds
    .filter((w) => w.bestTier >= 5 && !(w.worldId in overrides))
    .sort((a, b) => b.bestTier - a.bestTier || b.rows.length - a.rows.length || b.slot - a.slot);
  for (const w of healthy) {
    if (total <= availablePx) break;
    total -= w.rows.length * rowPx;
    out.add(w.worldId);
  }
  return out;
}
