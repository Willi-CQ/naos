// The automatic switch of DESIGN 11.4, outside the render loop. React sees a change only when the tier itself changes.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Rect } from '../core/layout.ts';
import { renderDpr, TierMonitor, TIERS, type Tier } from '../core/tiers.ts';

const KEY = 'naos.tier';

/** Umbra where the canvas is 1.3 MP or less, Corona above that, DESIGN 11.3. S20 measured on the Arc confirms it, docs/bench. */
export function defaultTier(free: Rect, devicePixelRatio: number): number {
  const umbra = TIERS[0]!;
  const dpr = renderDpr(umbra, free, devicePixelRatio);
  return (free.w * dpr * free.h * dpr) / 1e6 <= 1.3 ? 0 : 1;
}

function remembered(): number | null {
  try {
    const v = localStorage.getItem(KEY);
    const n = v === null ? NaN : Number(v);
    return n >= 0 && n < TIERS.length ? n : null;
  } catch { return null; }
}

function remember(index: number): void {
  try { localStorage.setItem(KEY, String(index)); } catch { /* the tier is simply measured again next time */ }
}

export interface TierControl {
  tier: Tier;
  dpr: number;
  /** The Plate takes over, and stays until reload. */
  plate: boolean;
  capHz: () => number;
  onBattery: () => boolean;
  onFrame: (dtMs: number, hz: number, now: number) => void;
  /** Call when the cadence falls to rest or the tab hides. */
  rest: () => void;
  log: { current: { at: number; tier: string }[] };
}

/** `forced` is settings.quality: the monitor stands aside while it holds a tier. */
export function useTier(free: Rect, devicePixelRatio: number, start?: number, memory = true, forced: number | null = null): TierControl {
  const [index, setIndex] = useState(() => start ?? (memory ? remembered() : null) ?? defaultTier(free, devicePixelRatio));
  const held = useRef(forced);
  held.current = forced;
  const [plate, setPlate] = useState(false);
  const battery = useRef(false);
  const log = useRef<{ at: number; tier: string }[]>([]);

  const monitor = useMemo(() => new TierMonitor(index, (next) => {
    log.current.push({ at: performance.now(), tier: TIERS[next]!.name });
    if (memory) remember(next);
    setIndex(next);
  }, () => setPlate(true)), []); // eslint-disable-line -- one monitor for the life of the page

  useEffect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<EventTarget & { charging: boolean }> };
    if (!nav.getBattery) return;
    let cancelled = false;
    let source: (EventTarget & { charging: boolean }) | null = null;
    const update = () => {
      battery.current = !(source?.charging ?? true);
      // On battery the tier stops at Corona, DESIGN 11.4.
      if (battery.current && monitor.index === 0) { monitor.index = 1; setIndex(1); }
    };
    nav.getBattery().then((b) => {
      if (cancelled) return;
      source = b;
      b.addEventListener('chargingchange', update);
      update();
    }).catch(() => { /* no battery API, no cap */ });
    return () => { cancelled = true; source?.removeEventListener('chargingchange', update); };
  }, [monitor]);

  const capHz = useCallback(() => monitor.capHz, [monitor]);
  const onBattery = useCallback(() => battery.current, []);
  const onFrame = useCallback((dtMs: number, hz: number, now: number) => { if (held.current === null) monitor.frame(dtMs, hz, now); }, [monitor]);
  const rest = useCallback(() => monitor.rest(), [monitor]);
  const tier = TIERS[forced ?? index]!;
  const dpr = renderDpr(tier, free, devicePixelRatio);
  return useMemo(() => ({ tier, dpr, plate, capHz, onBattery, onFrame, rest, log }), [capHz, dpr, onBattery, onFrame, plate, rest, tier]);
}
