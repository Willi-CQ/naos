// Mission modules: one each, in their own frame, bolted to any hull by a mount. A real shipyard works the same way, and it keeps the family
// in one hand: a capital and a scout on the same mission carry the same module at two sizes. It is also why draw calls stay few.
import { dish } from './hulls.ts';
import { along, Forge, MAT, move, mul, octagon, turnY, turnZ, type V3 } from './forge.ts';

const { WHITE, DARK, GOLD, METAL, SOLAR, WINDOW, SILVER, GRAPHITE } = MAT;
const TAU = Math.PI * 2;

/** Explore. A long sensor boom forward of the bow: seventy metres of mast so the instruments hear nothing of the ship. +x from the origin. */
export function boom(f: Forge): void {
  const d = f.detail;
  f.use(METAL, 1.4).lathe([[-1, 0], [-1, 2.8], [0.6, 2.8], [1.4, 1.5], [1.4, 0]], 20);
  f.use(METAL, 1.4).truss([1.2, 0, 0], [72, 0, 0], 1.25, 40, 3, 0.1);
  if (d) {
    f.use(GOLD, 0.6).tube([[1.6, 0.3, 0.2], [72, 0.3, 0.2]], 0.05, 5);
    // Two instrument stations out on the mast, then the head.
    f.use(WHITE, 1.2).lathe([[29, 0], [29, 0.7], [29.4, 1.5], [33, 1.5], [33.4, 0.7], [33.4, 0]], 16);
    f.use(GOLD, 0.6).lathe([[50, 0], [50, 0.9], [52.6, 0.9], [52.6, 0]], 14);
    f.both(() => {
      f.use(METAL, 1).beam([31, 0, 0], [31, 0, 7], 0.08);
      f.use(SILVER, 0.6).sphere([31, 0, 7.2], 0.42, 10, 6);
      f.use(METAL, 1).beam([51, 0, 0], [51, 3.4, 3.4], 0.05);
    });
  }
  f.use(WHITE, 1.4).lathe([[71, 0], [71, 1.8], [71.4, 2.3], [75, 2.3], [75.4, 1.8]], 20);
  f.use(GOLD, 0.8).lathe([[75.4, 1.8], [77.4, 0.7], [77.4, 0]], 20);
  if (d) {
    f.use(GRAPHITE, 0.6).cyl([77.4, 0, 0], [77.6, 0, 0], 0.5, 0.4, 14);
    f.use(METAL, 1);
    for (let k = 0; k < 4; k++) {
      const t = (k / 4) * TAU + 0.4;
      f.beam([73, Math.cos(t) * 2.2, Math.sin(t) * 2.2], [80 - k, Math.cos(t) * 2.7, Math.sin(t) * 2.7], 0.03);
    }
  }
  f.light([77.6, 0, 0], 'strobe', 1.4);
}

/** Plan. A survey ship: one big dish on a turret, and two long aperture panels that see a whole surface at once. Origin on the dorsal plate. */
export function survey(f: Forge): void {
  const d = f.detail;
  f.use(WHITE, 1.4).cyl([0, 0, 0], [0, 2.6, 0], 3.6, 3, 20);
  f.use(METAL, 1.4).cyl([0, 2.6, 0], [0, 3.2, 0], 2.1, 2.1, 20);
  f.box([0, 4.2, 0], [1.8, 2.6, 2.6]);
  // The dish, turned out and up, the way one looks when it is reading a world.
  f.at(mul(move(0.8, 6.4, 0), turnZ(0.7)), () => dish(f, 9.4, 3.2));
  f.both(() => {
    f.use(METAL, 1).box([0, 1.2, 7.4], [1.6, 1.1, 9.6]);
    f.use(SOLAR, 1.2).box([0, 1.2, 25], [8.4, 0.3, 26], 0.04);
    f.use(METAL, 1).box([0, 1.2, 25], [0.5, 0.52, 26.6]);
    f.box([4.3, 1.2, 25], [0.22, 0.42, 26.2], 0);
    f.box([-4.3, 1.2, 25], [0.22, 0.42, 26.2], 0);
    if (d) {
      for (let i = 0; i < 13; i++) f.box([0, 1.36, 12.5 + i * 2.08], [8.4, 0.08, 0.12], 0);
      f.beam([-0.6, 1.2, 3], [-3.6, 1.2, 20], 0.09);
      f.beam([0.6, 1.2, 3], [3.6, 1.2, 20], 0.09);
    }
    f.light([0, 1.2, 38.2], 'nav', 1.6);
  });
}

/** One arm: shoulder at the origin reaching +x, with a hydraulic ram, a wrist and three fingers. A tug is mostly these. */
function arm(f: Forge, spread: number): void {
  const d = f.detail;
  const shoulder: V3 = [0, 0, 0];
  const elbow: V3 = [17, 3.2, 7 + spread];
  const wrist: V3 = [37, 1.6, 2 + spread * 0.4];
  f.use(WHITE, 1.4).cyl([-1.6, 0, 0], [1.6, 0, 0], 2.3, 2.3, 20);
  f.use(METAL, 1.4).cyl([0, -2.6, 0], [0, 2.6, 0], 1, 1, 12);
  // Boxed, not round: these take bending, and a box section is what a crane is.
  const segment = (a: V3, b: V3, w: number, h: number): void => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    f.at(along(a, b), () => {
      f.use(WHITE, 1.6).loft(d ? [{ x: 0, hw: w * 0.7, hh: h * 0.7 }, { x: 2.4, hw: w, hh: h }, { x: len - 2.4, hw: w * 0.72, hh: h * 0.72 }, { x: len, hw: w * 0.5, hh: h * 0.5 }] : [{ x: 0, hw: w * 0.8, hh: h * 0.8 }, { x: len, hw: w * 0.55, hh: h * 0.55 }], octagon(0.3));
      if (!d) return;
      f.use(METAL, 1).cyl([3, h * 1.2, 0], [len * 0.62, h * 1.2, 0], w * 0.3, w * 0.3, 8);
      f.use(SILVER, 1).cyl([len * 0.6, h * 1.2, 0], [len - 3, h * 1.2, 0], w * 0.14, w * 0.14, 8);
      f.use(METAL, 1).box([3, h * 0.9, 0], [1.4, h * 0.5, w * 0.8]);
      f.box([len - 3, h * 0.82, 0], [1.2, h * 0.34, w * 0.5]);
      f.use(GRAPHITE, 1).box([len * 0.5, 0, w * 0.76], [len * 0.56, h * 0.7, 0.1], 0);
      f.box([len * 0.5, 0, -w * 0.76], [len * 0.56, h * 0.7, 0.1], 0);
      f.use(GOLD, 0.8).tube([[3, -h * 0.94, w * 0.4], [len - 3, -h * 0.72, w * 0.3]], 0.14, 5);
    });
  };
  segment(shoulder, elbow, 2, 2.4);
  f.use(METAL, 1.4).at(move(elbow[0], elbow[1], elbow[2]), () => {
    f.use(METAL, 1.4).cyl([0, -2.3, 0], [0, 2.3, 0], 1.9, 1.9, 18);
  });
  segment(elbow, wrist, 1.5, 1.8);
  f.at(along(wrist, [wrist[0] + 8, wrist[1] - 0.3, wrist[2] - 1.2]), () => {
    f.use(METAL, 1.2).cyl([-0.4, 0, 0], [1.2, 0, 0], 1.3, 1.5, 16);
    f.use(WHITE, 1).lathe([[1.2, 0], [1.2, 2.5], [2.2, 2.5], [2.2, 0]], 18);
    for (let k = 0; k < 3; k++) {
      const t = (k / 3) * TAU + Math.PI / 2;
      const y = Math.cos(t), z = Math.sin(t);
      f.use(METAL, 1).box([2.6, y * 1.9, z * 1.9], [1, 1, 1]);
      f.tube([[2.6, y * 1.9, z * 1.9], [6, y * 3.1, z * 3.1], [9, y * 2.4, z * 2.4], [10.4, y * 1, z * 1]], 0.42, d ? 6 : 3);
    }
  });
}

/** General builder. A tug: a heavy yoke carrying two arms and a docking collar. Origin at the yoke, arms reach forward. */
export function arms(f: Forge): void {
  const d = f.detail;
  f.use(METAL, 1.6).box([-3, 0, 0], [6, 4.4, 26]);
  f.use(WHITE, 2).box([-3, 0, 0], [5, 5.2, 22]);
  f.use(METAL, 1.4).lathe([[0, 0], [0, 4.8], [2.6, 4.8], [2.6, 3.4], [2.6, 0]], 24);
  if (d) {
    f.use(GOLD, 0.8).lathe([[2.6, 3.3], [2.6, 1.8]], 24);
    for (let k = 0; k < 12; k++) {
      const t = (k / 12) * TAU;
      f.use(METAL, 1).box([2.75, Math.cos(t) * 4.1, Math.sin(t) * 4.1], [0.3, 0.5, 0.5]);
    }
  }
  f.both(() => {
    f.at(move(0.5, 0, 12.6), () => arm(f, 2));
    f.light([46, 0.6, 8], 'nav', 1.2);
  });
}

/**
 * Orchestrator. The command ring, the one piece of the family that turns: a dozen pressurised segments on four spokes, which is how you
 * give a crew gravity on a long trip. It spins only while the ship has tokens to spend, so it obeys the same law as everything else.
 * In the yz plane, around x, with the hub's clear bore at radius 11.
 */
export function ring(f: Forge): void {
  const d = f.detail;
  const R = 31;
  const count = 12;
  const hub = 11;
  f.use(METAL, 1.4).lathe([[-3.6, hub], [-3.6, hub + 2.4], [3.6, hub + 2.4], [3.6, hub]], 32);
  f.use(WHITE, 1.8).lathe([[-1.4, hub + 2.4], [-1.4, hub + 3.8], [1.4, hub + 3.8], [1.4, hub + 2.4]], 32);
  const around = (t: number): number[] => [1, 0, 0, 0, Math.cos(t), Math.sin(t), 0, -Math.sin(t), Math.cos(t), 0, 0, 0];
  for (let k = 0; k < count; k++) {
    const t = (k / count) * TAU;
    // Turned a quarter, so a segment runs along the circle and twelve of them close it without pretending to be a torus.
    f.at(mul(around(t), turnY(Math.PI / 2)), () => {
      f.use(WHITE, 1.8).loft(
        d ? [{ x: -6.4, y: R, hw: 3, hh: 2.2 }, { x: -5.4, y: R, hw: 3.8, hh: 2.8 }, { x: 5.4, y: R, hw: 3.8, hh: 2.8 }, { x: 6.4, y: R, hw: 3, hh: 2.2 }] : [{ x: -6.4, y: R, hw: 3.6, hh: 2.6 }, { x: 6.4, y: R, hw: 3.6, hh: 2.6 }],
        octagon(0.3),
        (side) => (side >= 4 && side <= 6 ? DARK : WHITE),
      );
      if (d) {
        // A band of small ports, each set in dark glazing. Small windows in a long row are how a large thing looks large.
        f.use(GRAPHITE, 0).box([0, R + 0.2, 3.82], [9.6, 0.9, 0.06], 0);
        f.box([0, R + 0.2, -3.82], [9.6, 0.9, 0.06], 0);
        f.use(WINDOW, 0.4);
        for (let i = 0; i < 12; i++) {
          f.box([-4.4 + i * 0.8, R + 0.2, 3.86], [0.34, 0.5, 0.05], 0);
          f.box([-4.4 + i * 0.8, R + 0.2, -3.86], [0.34, 0.5, 0.05], 0);
        }
        f.use(GRAPHITE, 1).box([0, R + 2.86, 0], [8.4, 0.1, 4.6], 0);
        f.use(METAL, 1).box([0, R - 2.86, 0], [6, 0.3, 2.6]);
      }
    });
    f.at(around(t + TAU / count / 2), () => {
      f.use(METAL, 1.2).box([0, R, 0], [3.2, 3.2, 1.4]);
      f.use(SILVER, 1).cyl([0, R, -2], [0, R, 2], 1.8, 1.8, 12, [false, false]);
    });
  }
  for (let k = 0; k < 4; k++) {
    const t = (k / 4) * TAU + TAU / 24;
    const y = Math.cos(t), z = Math.sin(t);
    f.use(WHITE, 1.6).cyl([0, y * (hub + 3.6), z * (hub + 3.6)], [0, y * (R - 2.6), z * (R - 2.6)], 1.15, 1.15, 12, [false, false]);
    if (d) {
      f.use(METAL, 1).beam([1.6, y * (hub + 3), z * (hub + 3)], [1.6, y * (R - 3), z * (R - 3)], 0.12);
      f.beam([-1.6, y * (hub + 3), z * (hub + 3)], [-1.6, y * (R - 3), z * (R - 3)], 0.12);
    }
  }
  f.use(MAT.STRIP, 0).lathe([[3.7, hub + 2.2], [3.7, hub + 2.4]], 32);
  f.light([0, R + 3, 0], 'nav', 1.4);
  f.light([0, -R - 3, 0], 'nav', 1.4);
}
