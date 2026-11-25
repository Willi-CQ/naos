// Numbers as DESIGN 5.2 writes them. Glyph limits matter here: no `≥ → ≈`, a lower bound is a `+` suffix, an estimate a `~` prefix.

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** `14:06`, or `14:06:21` with seconds. Local time, 24 h. */
export function clock(ms: number, seconds = false): string {
  const d = new Date(ms);
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return seconds ? `${hm}:${pad2(d.getSeconds())}` : hm;
}

/** `0:41`, then `1h 12m`. For decisions and running tools. */
export function ageClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
}

/** `12 s`, `12 m`, `1h 12m`. */
export function ageWords(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

/** `4.8 s` under ten seconds, otherwise as ageWords. */
export function ageFine(ms: number): string {
  return ms < 10_000 ? `${(Math.max(0, ms) / 1000).toFixed(1)} s` : ageWords(ms);
}

/** Spoken age for the mirror: `41 seconds`. */
export function ageSpoken(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} seconds`;
  if (s < 3600) return `${Math.floor(s / 60)} minutes`;
  return `${Math.floor(s / 3600)} hours ${Math.floor((s % 3600) / 60)} minutes`;
}

/** `812k`, `1M`, `1.2M`. */
export function tokens(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(Math.round(n));
}

/** `1,840`. Fixed to en-US, so a shot repeats on any locale. */
export const count = (n: number): string => Math.round(n).toLocaleString('en-US');

/** `$4.20 est`, `$4.20+ est`. Every printed number says est. */
export function money(usd: number | null, lowerBound = false): string {
  return usd === null ? 'no index yet' : `$${usd.toFixed(2)}${lowerBound ? '+' : ''} est`;
}

export const moneyBare = (usd: number): string => `$${usd.toFixed(2)}`;

/** Plan windows are stored as fractions and read in whole percent. */
export const percent = (fraction: number): number => Math.round(fraction * 100);

/** Last segment of a path or the first word of a target, for rows too narrow for the whole thing. */
export function shortTarget(target: string): string {
  const cut = target.replace(/[\\/]+$/, '');
  const tail = cut.slice(Math.max(cut.lastIndexOf('/'), cut.lastIndexOf('\\')) + 1);
  return tail.length > 0 && !/\s/.test(cut) ? tail : cut;
}
