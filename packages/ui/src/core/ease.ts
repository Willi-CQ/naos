// The named easings of DESIGN 9.2, as data. GSAP registers these through CustomEase, the CSS reads the same numbers, and the frame
// path samples them here, because a per-frame curve must not go through a tween.

export type Bezier = readonly [number, number, number, number];

export const BEZIER = {
  filament: [0.1, 0.9, 0.2, 1],
  settle: [0.22, 1, 0.36, 1],
  burn: [0.12, 0.8, 0.2, 1],
  halt: [0.2, 0, 0, 1],
  deepen: [0.45, 0, 0.55, 1],
  fall: [0.55, 0, 0.9, 0.35],
  collapse: [0.7, 0, 1, 0.4],
  ejection: [0.3, 0, 0.1, 1],
  slingshot: [0.7, 0, 0.12, 1],
  ignite: [0.16, 1, 0.3, 1],
  reentry: [0.6, 0.04, 0.98, 0.34],
  contact: [0.83, 0, 0.17, 1],
} as const satisfies Record<string, Bezier>;

export type EaseName = keyof typeof BEZIER;

/** Newton on x(t), then y(t). Precise to well under a pixel on anything these curves drive. */
export function cubicBezier([x1, y1, x2, y2]: Bezier): (x: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) {
      const e = ((ax * t + bx) * t + cx) * t - x;
      const d = (3 * ax * t + 2 * bx) * t + cx;
      if (Math.abs(e) < 1e-5 || Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    return ((ay * t + by) * t + cy) * t;
  };
}

export const ease = Object.fromEntries(Object.entries(BEZIER).map(([name, curve]) => [name, cubicBezier(curve)])) as Record<EaseName, (x: number) => number>;

/** The same curve for a CSS `transition`. */
export const cssEase = (name: EaseName): string => `cubic-bezier(${BEZIER[name].join(', ')})`;

/** The SVG path CustomEase takes. */
export const easePath = (name: EaseName): string => {
  const [x1, y1, x2, y2] = BEZIER[name];
  return `M0,0 C${x1},${y1} ${x2},${y2} 1,1`;
};
