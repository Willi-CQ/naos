// HUD geometry. Pure. Used by the scene, the Plate and tests. Nothing here depends on WebGL. Where worlds stand is core/space.ts.

export interface Rect { x: number; y: number; w: number; h: number }
export type LayoutClass = 'C' | 'R' | 'W';

export const LAYOUT = {
  C: { left: 236, right: 296, top: 36, bot: 44, docket: 420, channel: 420, sheet: 640 },
  R: { left: 280, right: 340, top: 40, bot: 48, docket: 480, channel: 520, sheet: 720 },
  W: { left: 320, right: 400, top: 44, bot: 52, docket: 560, channel: 640, sheet: 840 },
} as const;

export interface Hud { cls: LayoutClass; free: Rect; craftK: number; short: boolean }

export function hud(vw: number, vh: number, leftRailOpen = true): Hud {
  const cls: LayoutClass = vw < 1600 ? 'C' : vw < 2200 ? 'R' : 'W';
  const l = LAYOUT[cls];
  const short = vh < 720;
  const left = leftRailOpen ? l.left : 44;
  const bot = short ? 24 : l.bot;
  const free = { x: left, y: l.top, w: vw - left - l.right, h: vh - l.top - bot };
  return { cls, free, craftK: Math.min(1.4, Math.max(1, free.h / 720)), short };
}

export const bandOf = (d: number): 0 | 1 | 2 => (d <= 1 ? 0 : d <= 7 ? 1 : 2);
