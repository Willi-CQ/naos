// State marks of section 6, 12 px SVG in currentColor. Filled for owned craft and outlined for observed ones wherever the shape allows.
// They are aria-hidden: the state word is the accessible text.
import { useEffect, useRef } from 'react';
import type { MarkKind, Tone } from '../core/state.ts';

function shape(mark: MarkKind, filled: boolean) {
  const fill = filled ? 'currentColor' : 'none';
  switch (mark) {
    case 'dots': return <g fill="currentColor"><circle cx="2" cy="6" r="1.1" /><circle cx="6" cy="6" r="1.1" /><circle cx="10" cy="6" r="1.1" /></g>;
    case 'kite': return <path d="M1 2 L11.5 6 L1 10 L3.8 6 Z" fill={fill} stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />;
    case 'hollowkite': return <path d="M1.5 2.5 L11 6 L1.5 9.5 L4 6 Z" fill="none" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />;
    case 'dashes': return <path d="M0.5 6 H3 M4.8 6 H7.3 M9.1 6 H11.6" stroke="currentColor" strokeWidth="1.5" />;
    case 'square': return <rect x="2" y="2" width="8" height="8" fill={fill} stroke="currentColor" strokeWidth="1.4" />;
    case 'triangle': return <path d="M1.8 10.2 L6 2 L10.2 10.2 Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />;
    case 'lance': return <g><path d="M1.5 10.5 L8.5 3.5" stroke="currentColor" strokeWidth="1.3" /><path d="M6.8 1.8 L10.7 1.3 L10.2 5.2 Z" fill="currentColor" /></g>;
    case 'arrow': return <path d="M2 10 L10 2 M4.5 2 H10 V7.5" fill="none" stroke="currentColor" strokeWidth="1.3" />;
    case 'arc': return <path d="M1.5 10.5 A9 9 0 0 1 10.5 1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />;
    case 'fork': return <path d="M6 11 V6.2 M6 6.2 L2 2 M6 6.2 L10 2" fill="none" stroke="currentColor" strokeWidth="1.4" />;
    case 'joined': return <g fill="currentColor"><circle cx="2.5" cy="6" r="1.8" /><circle cx="9.5" cy="6" r="1.8" /><path d="M3 6 H9" stroke="currentColor" strokeWidth="1.2" /></g>;
    case 'dotsquare': return <g><rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.2" /><circle cx="6" cy="6" r="1.6" fill="currentColor" /></g>;
    case 'ringdot': return <g><circle cx="6" cy="6" r="4.9" fill="none" stroke="currentColor" strokeWidth="1.4" /><circle cx="6" cy="6" r="1.9" fill="currentColor" /></g>;
    case 'ringcross': return <g fill="none" stroke="currentColor"><circle cx="6" cy="6" r="4.9" strokeWidth="1.4" /><path d="M4 4 L8 8 M8 4 L4 8" strokeWidth="1.3" /></g>;
    case 'brokenring': return <circle cx="6" cy="6" r="4.9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2.3 1.55" />;
    case 'hollowring': return <circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" strokeWidth="1" />;
    case 'dot': return <circle cx="6" cy="6" r="2" fill="currentColor" />;
    case 'slash': return <path d="M2 10.5 L10 1.5" stroke="currentColor" strokeWidth="1.5" />;
    case 'up': return <path d="M6 11 V1.8 M2.5 5.3 L6 1.8 L9.5 5.3" fill="none" stroke="currentColor" strokeWidth="1.4" />;
    case 'down': return <path d="M6 1 V10.2 M2.5 6.7 L6 10.2 L9.5 6.7" fill="none" stroke="currentColor" strokeWidth="1.4" />;
    case 'dashedarc': return <circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2 2 2 2 2 2 2 9" />;
    case 'cross': return <path d="M1.8 1.8 L10.2 10.2 M10.2 1.8 L1.8 10.2" stroke="currentColor" strokeWidth="1.8" />;
    case 'emptybar': return <rect x="0.8" y="3.8" width="10.4" height="4.4" fill="none" stroke="currentColor" strokeWidth="1.1" />;
    case 'hollowdot': return <circle cx="6" cy="6" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.1" />;
    default: return <circle cx="6" cy="6" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.1" />;
  }
}

export function StateMark({ mark, tone, owned, size = 12 }: { mark: MarkKind; tone: Tone; owned: boolean; size?: number }) {
  return (
    <svg className={`mark tone-${tone}`} width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      {shape(mark, owned)}
    </svg>
  );
}

export function Designator({ glyph, letter }: { glyph: string; letter: string }) {
  // Past 24 it is a Flamsteed number, and EB Garamond's Greek subset has no digits.
  if (/^\d+$/.test(glyph)) return <span className="t-num-s" aria-label={letter}>{glyph}</span>;
  return <span className="t-desig" role="img" aria-label={letter}>{glyph}</span>;
}

const REDUCED = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

/** `servo`: spring 170 / 26, no overshoot. Writes the DOM directly, so a rolling number costs no render. */
export function Servo({ value, format }: { value: number; format: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const state = useRef({ x: value, v: 0, raf: 0, last: 0 });
  const fmt = useRef(format);
  fmt.current = format;
  useEffect(() => {
    const s = state.current;
    const el = ref.current;
    if (!el) return undefined;
    if (REDUCED?.matches) {
      s.x = value;
      el.textContent = fmt.current(value);
      return undefined;
    }
    const step = (time: number) => {
      const dt = Math.min(0.05, s.last ? (time - s.last) / 1000 : 0.016);
      s.last = time;
      s.v += (170 * (value - s.x) - 26 * s.v) * dt;
      s.x += s.v * dt;
      if (Math.abs(value - s.x) < 0.005 && Math.abs(s.v) < 0.05) s.x = value;
      el.textContent = fmt.current(s.x);
      s.raf = s.x === value ? 0 : requestAnimationFrame(step);
    };
    s.last = 0;
    cancelAnimationFrame(s.raf);
    s.raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(s.raf);
  }, [value]);
  return <span ref={ref}>{format(value)}</span>;
}
