// The hull classes, built by hand. Every shape answers to something a real ship needs: pressure, propellant, heat to throw away, a place to
// mount an engine. If a part could not be explained to an engineer, it is not here. Plain data and arithmetic, so a test can hold them.
import { along, Forge, lifting, MAT, move, mul, octagon, turnX, turnZ, type Station, type V3 } from './forge.ts';

const { WHITE, DARK, GOLD, METAL, SOLAR, WINDOW, SILVER, RADIATOR, PAINT, GRAPHITE } = MAT;
const TAU = Math.PI * 2;

/** The lower facets of `octagon`: thermal tile below, painted plate above. */
const belly = (top: number) => (side: number): number => (side >= 4 && side <= 6 ? DARK : top);

/** A parabolic dish opening toward +x, both faces, with its feed held on three struts. */
export function dish(f: Forge, r: number, depth: number): void {
  const segs = 32;
  const steps = f.detail ? 7 : 3;
  const curve: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    curve.push([depth * t * t, r * t]);
  }
  f.use(WHITE, r).lathe([...curve].reverse(), segs);
  f.use(METAL, r).lathe(curve.map(([x, q]) => [x - 0.03 * r, q] as const), segs);
  if (!f.detail) return;
  const focus = (r * r) / (4 * depth);
  f.use(METAL, 1);
  for (let k = 0; k < 3; k++) {
    const t = (k / 3) * TAU;
    f.beam([depth * 0.7, Math.cos(t) * r * 0.84, Math.sin(t) * r * 0.84], [focus, 0, 0], r * 0.012);
  }
  f.use(GOLD, 1).cyl([focus - r * 0.08, 0, 0], [focus + r * 0.05, 0, 0], r * 0.06, r * 0.03, 10);
}

/** A row of identical cabinets on a plate facing +y. Equipment comes in racks, and a straight row reads as designed where a scatter reads as noise. */
function rack(f: Forge, x0: number, y: number, z: number, count: number, pitch: number, w: number, h: number, d: number): void {
  if (!f.detail) return;
  const r = f.rand;
  for (let i = 0; i < count; i++) {
    const x = x0 + i * pitch;
    const skip = r();
    if (skip < 0.12) continue;
    f.use(skip < 0.3 ? GRAPHITE : skip < 0.45 ? METAL : WHITE, 0).box([x, y + h / 2, z], [w, h, d], Math.min(h, w) * 0.12);
    if (skip > 0.7) {
      // Louvres, on the cabinets that have to breathe.
      f.use(METAL, 0);
      for (let k = 0; k < 4; k++) f.box([x - w * 0.3 + k * w * 0.2, y + h * 1.02, z], [w * 0.06, h * 0.05, d * 0.76], 0);
    }
  }
}

/** Two formed lines side by side, clamped to the hull at intervals. */
function lines(f: Forge, a: V3, b: V3, r: number, gap: number, clamps: number): void {
  if (!f.detail) return;
  f.use(METAL, 0).tube([[a[0], a[1], a[2] - gap], [b[0], b[1], b[2] - gap]], r, 6);
  f.tube([[a[0], a[1], a[2] + gap], [b[0], b[1], b[2] + gap]], r, 6);
  for (let i = 0; i <= clamps; i++) {
    const t = i / clamps;
    f.box([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], [r * 2.6, r * 3, gap * 2 + r * 5], 0);
  }
}

/** Painted registry, block letters from a 3 by 5 grid, on a plate that faces +y. */
const GLYPHS: Record<string, string> = {
  N: '101111111101101', A: '010101111101101', O: '111101101101111', S: '111100111001111', 0: '111101101101111', 1: '010110010010111', 2: '111001111100111',
  3: '111001111001111', 4: '101101111001001', 5: '111100111001111', 6: '111100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001111', '-': '000000111000000',
};

export function stencil(f: Forge, text: string, x: number, y: number, z: number, h: number, facing: 1 | -1 = 1): void {
  if (!f.detail) return;
  f.use(PAINT, 0);
  const cell = h / 5;
  let cursor = 0;
  for (const ch of text) {
    const g = GLYPHS[ch];
    if (g) {
      for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 3; col++) {
          if (g[row * 3 + col] === '1') f.decal([x + facing * (cursor + col * cell), y, z + facing * (row * cell - h / 2)], [0, 1, 0], [1, 0, 0], cell * 0.92, cell * 0.92);
        }
      }
    }
    cursor += cell * 4;
  }
}

/** Wrapped propellant tanks ringed around a spine, strapped to a frame at each end. */
function tankRing(f: Forge, x0: number, x1: number, R: number, r: number, count: number, phase: number, skin: number, domes: number): void {
  const segs = 24;
  for (let k = 0; k < count; k++) {
    const t = phase + (k / count) * TAU;
    const y = Math.cos(t) * R;
    const z = Math.sin(t) * R;
    f.at(move(x0, y, z), () => {
      const len = x1 - x0;
      const dome: Array<[number, number]> = [];
      const steps = f.detail ? 6 : 2;
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * Math.PI / 2;
        dome.push([r * 0.72 * (1 - Math.cos(a)), r * Math.sin(a)]);
      }
      const back = [...dome].reverse().map(([x, q]) => [len - x, q] as [number, number]);
      // Wrapped barrels with bare film on the domes: foil is an accent on a ship like this, never its colour.
      f.use(domes, 1.6).lathe(dome, segs);
      f.use(skin, 2.4).lathe([[r * 0.72, r], [len - r * 0.72, r]], segs);
      f.use(domes, 1.6).lathe(back, segs);
      if (!f.detail) return;
      f.use(METAL, 1);
      for (const u of [0.2, 0.5, 0.8]) {
        const x = len * u;
        f.lathe([[x - 0.1, r], [x - 0.1, r * 1.012], [x + 0.1, r * 1.012], [x + 0.1, r]], segs);
      }
      // The line that feeds this tank, out of its aft dome and back to the spine.
      f.use(GOLD, 0.8).tube([[len - r * 0.1, -Math.cos(t) * r * 0.5, -Math.sin(t) * r * 0.5], [len + r * 0.35, -Math.cos(t) * R * 0.35, -Math.sin(t) * R * 0.35], [len + r * 0.6, -Math.cos(t) * R * 0.86, -Math.sin(t) * R * 0.86]], r * 0.05, 6);
    });
  }
  if (!f.detail) return;
  // Frames and struts that carry the tank load into the spine.
  f.use(METAL, 1.5);
  for (const x of [x0 + (x1 - x0) * 0.2, x0 + (x1 - x0) * 0.8]) {
    for (let k = 0; k < count; k++) {
      const t = phase + (k / count) * TAU;
      const u = t + Math.PI / count;
      const Q = R * 0.98;
      f.beam([x, Math.cos(t) * r * 0.5, Math.sin(t) * r * 0.5], [x, Math.cos(t) * (Q - r * 0.7), Math.sin(t) * (Q - r * 0.7)], r * 0.05);
      f.beam([x, Math.cos(u) * r * 0.6, Math.sin(u) * r * 0.6], [x, Math.cos(u) * Q * 1.02, Math.sin(u) * Q * 1.02], r * 0.045);
    }
  }
}

/** A deployable radiator wing lying in the xz plane, running out from z0 to z1. Coolant comes up the root through a manifold. */
function radiator(f: Forge, x0: number, x1: number, y: number, z0: number, z1: number, tipCut: number): void {
  const cx = (x0 + x1) / 2;
  const t = 0.34;
  f.use(RADIATOR, 2).loft(
    [{ x: x0, y, z: (z0 + z1 - tipCut) / 2, hw: Math.abs(z1 - z0 - tipCut) / 2, hh: t / 2 }, { x: x1 - 2, y, z: (z0 + z1) / 2, hw: Math.abs(z1 - z0) / 2, hh: t / 2 }, { x: x1, y, z: (z0 + z1) / 2, hw: Math.abs(z1 - z0) / 2, hh: t / 2 }],
    [[1, 1], [-1, 1], [-1, -1], [1, -1]],
  );
  const sign = Math.sign(z1 - z0);
  f.use(METAL, 0).box([cx, y, z0 + sign * 0.3], [x1 - x0 + 0.4, 0.75, 0.75]);
  f.box([cx, y, z1 + sign * 0.06], [x1 - x0, 0.42, 0.14], 0);
  if (!f.detail) return;
  const span = Math.abs(z1 - z0);
  const panels = Math.round(span / 7);
  for (let i = 1; i < panels; i++) f.box([cx, y, z0 + sign * (i / panels) * span], [x1 - x0, 0.4, 0.09], 0);
  f.use(GOLD, 0.8).cyl([x0 - 0.5, y, z0 + sign * 0.3], [x1 + 0.5, y, z0 + sign * 0.3], 0.3, 0.3, 8);
}

/** A disc of film facing +x, stretched between ribs into gores. Each gore tips its own way, so the disc flashes one sector at a time, as a real one does. */
function gores(f: Forge, x: number, r0: number, r1: number, count: number, tip: number): void {
  for (let k = 0; k < count; k++) {
    const a = (k / count) * TAU, b = ((k + 1) / count) * TAU;
    const up = x + (k % 2 ? tip : -tip) * 0.12;
    const P = (r: number, t: number, q: number): V3 => [q, Math.cos(t) * r, Math.sin(t) * r];
    f.use(GOLD, 1.2).poly([P(r0, a, x), P(r1, a, x), P(r1, b, up), P(r0, b, up)], [1, 0, 0]);
  }
  f.use(METAL, 1);
  for (let k = 0; k < count; k += 2) {
    const t = (k / count) * TAU;
    f.beam([x + 0.04, Math.cos(t) * r0, Math.sin(t) * r0], [x + 0.04, Math.cos(t) * r1, Math.sin(t) * r1], 0.05);
  }
}

/** Opus. A long-haul capital ship: crew forward behind the propellant, reactor as far aft as the spine will carry it. */
export function capital(f: Forge): void {
  const d = f.detail;
  const hull: Station[] = [
    { x: 30.6, hw: 7.2, hh: 5.2 }, { x: 32.2, hw: 9.8, hh: 6.8 }, { x: 52, hw: 9.8, hh: 6.8 },
    { x: 57.4, hw: 7.8, hh: 5.1 }, { x: 60.6, hw: 5.6, hh: 3.5 }, { x: 62, hw: 4.3, hh: 2.7 },
  ];
  const section = octagon(0.24);
  f.use(WHITE, 3.2).loft(hull, section, belly(WHITE));

  // Frames at each bulkhead. On a hull this size they are the first thing that tells you how big it is.
  if (d) {
    f.use(WHITE, 0);
    for (let i = 0; i < 7; i++) {
      const x = 33.8 + i * 3.2;
      f.frame(hull, section, x, x + 0.34, 0.16, belly(WHITE));
    }
    f.frame(hull, section, 55.4, 55.74, 0.16, belly(WHITE));
    f.frame(hull, section, 59, 59.3, 0.14, belly(WHITE));
  }

  // The deck that stands proud of the hull, with the bridge at its forward end looking out over the prow.
  const deck: Station[] = [
    { x: 33.6, y: 6.9, hw: 6.2, hh: 0.2 }, { x: 34.6, y: 7.4, hw: 6.8, hh: 1.2 }, { x: 47, y: 7.4, hw: 6.8, hh: 1.2 }, { x: 51.4, y: 7.3, hw: 5.2, hh: 1 }, { x: 54.2, y: 6.9, hw: 3.4, hh: 0.4 },
  ];
  f.use(WHITE, 2.2).loft(deck, octagon(0.3));
  f.use(GRAPHITE, 0).box([51.6, 8.2, 0], [4.2, 0.5, 8.6], 0.1);
  if (d) {
    // Bridge glazing, a long low band under the brow.
    f.use(WINDOW, 0.5);
    for (let i = 0; i < 17; i++) f.box([52.86, 7.8, -3.84 + i * 0.48], [0.5, 0.42, 0.34], 0);
    f.use(METAL, 0);
    f.box([52.9, 8.04, 0], [0.5, 0.08, 8.2], 0);
    f.box([52.9, 7.56, 0], [0.5, 0.08, 8.2], 0);
    rack(f, 36, 8.6, 3.3, 9, 1.42, 1.1, 0.46, 1.5);
    rack(f, 36, 8.6, -3.3, 9, 1.42, 1.1, 0.46, 1.5);
    lines(f, [35, 8.68, 1.3], [47.4, 8.68, 1.3], 0.09, 0.24, 7);
    lines(f, [35, 8.68, -1.3], [47.4, 8.68, -1.3], 0.09, 0.24, 7);
    f.use(WHITE, 0).box([41, 8.84, 0], [6, 0.34, 1.2]);
    f.use(METAL, 0).cyl([38.8, 8.6, 0], [38.8, 9.5, 0], 0.5, 0.34, 12);
    f.at(mul(move(38.8, 9.5, 0), turnZ(Math.PI / 2)), () => dish(f, 1.5, 0.4));
    f.use(METAL, 0).beam([44, 8.6, 0.9], [44.4, 12, 0.9], 0.03);
    f.beam([45.6, 8.6, 0.9], [46.2, 10.8, 0.9], 0.02);
    stencil(f, 'NAOS-1', 36.4, 8.58, 5.9, 1.1);
    stencil(f, 'NAOS-1', 44.6, 8.58, -5.9, 1.1, -1);
  }

  // Keel, dark tile, with the service bays let into it.
  f.use(DARK, 2.4).box([44, -7.2, 0], [22, 1.1, 10.4], 0.2);

  f.both(() => {
    // Accommodation sponsons: two decks of small ports. Small windows are how a large thing looks large.
    const sponson: Station[] = [{ x: 34, y: -1.1, z: 9.9, hw: 0.6, hh: 2.2 }, { x: 35.4, y: -1.1, z: 10.6, hw: 1.2, hh: 3 }, { x: 49, y: -1.1, z: 10.6, hw: 1.2, hh: 3 }, { x: 51, y: -1.1, z: 10, hw: 0.7, hh: 2.3 }];
    f.use(WHITE, 1.8).loft(sponson, octagon(0.32));
    if (d) {
      f.use(GRAPHITE, 0).box([42.2, 0.1, 11.82], [13.4, 0.82, 0.06], 0);
      f.box([42.2, -2.1, 11.82], [13.4, 0.82, 0.06], 0);
      f.use(WINDOW, 0.5);
      for (let i = 0; i < 18; i++) {
        f.box([36 + i * 0.73, 0.1, 11.86], [0.34, 0.5, 0.05], 0);
        f.box([36 + i * 0.73, -2.1, 11.86], [0.34, 0.5, 0.05], 0);
      }
      f.use(METAL, 0).box([42.2, 1.0, 11.84], [13.8, 0.1, 0.1], 0);
      // Everything on the shoulder of the hull sits in the plane of the chamfer.
      f.at(mul(move(42, 6.08, 8.68), turnX(0.586)), () => {
        rack(f, -8, 0, 0.3, 12, 1.42, 1.1, 0.42, 1.2);
        lines(f, [-9.6, 0.1, -0.86], [9.6, 0.1, -0.86], 0.08, 0.18, 8);
      });
      f.rcs([54.8, 4.1, 6.9], [0, 0.55, 0.83], 0.62);
      f.rcs([54.8, -4.1, 6.9], [0, -0.55, 0.83], 0.62);
      f.rcs([33.4, 3.4, 9.86], [0, 0, 1], 0.62);
      // Sensor blisters and a boarding hatch forward, where the plating runs out.
      f.use(WHITE, 0).box([52.6, -1.8, 9.92], [3.4, 2.6, 0.24]);
      f.use(GRAPHITE, 0).box([52.6, -1.8, 10.06], [2.4, 1.7, 0.08], 0.02);
      f.use(METAL, 0).box([52.6, -0.7, 10.08], [2.6, 0.08, 0.12], 0);
      f.use(GRAPHITE, 0).cyl([57, 1.4, 7.2], [57.6, 1.4, 7.9], 0.42, 0.3, 10);
      f.use(GOLD, 0.8).cyl([57.6, 1.4, 7.9], [57.72, 1.4, 8.04], 0.26, 0.22, 10);
    }
    f.light([61.6, -0.4, 4.1], 'nav', 2.2);
  });

  // The prow carries a docking port, the reason the whole forward face is flat.
  f.use(METAL, 0).lathe([[61.9, 3], [62.4, 3], [62.5, 2.5], [62.5, 2.1]], 28);
  f.use(GRAPHITE, 0).lathe([[62.5, 2.1], [62.2, 1.8], [62.2, 0]], 28);
  if (d) {
    f.use(METAL, 0);
    for (let k = 0; k < 12; k++) {
      const t = (k / 12) * TAU;
      f.box([62.5, Math.cos(t) * 2.5, Math.sin(t) * 2.5], [0.2, 0.3, 0.3], 0);
    }
  }

  // Docking node and the collar that takes the whole bow's load into the spine.
  f.use(METAL, 2).cyl([26, 0, 0], [30.8, 0, 0], 4.6, 5.2, 20);
  f.use(WHITE, 2).lathe([[26.6, 5.1], [26.6, 5.9], [27.4, 5.9], [27.4, 5.05]], 28);
  f.lathe([[29.3, 5.25], [29.3, 6.2], [30.1, 6.2], [30.1, 5.25]], 28);
  if (d) {
    f.use(METAL, 1);
    for (let k = 0; k < 8; k++) {
      const t = ((k + 0.5) / 8) * TAU;
      f.beam([26, Math.cos(t) * 3.6, Math.sin(t) * 3.6], [31, Math.cos(t) * 6.2, Math.sin(t) * 6.2], 0.16);
    }
  }

  // The spine. A pressure tube for walking aft, inside a truss that carries the thrust.
  f.use(WHITE, 3).cyl([-40, 0, 0], [26.2, 0, 0], 1.9, 1.9, 16);
  f.use(METAL, 2).truss([-38, 0, 0], [26, 0, 0], 4.3, 26, 4, 0.2);

  // Three banks of tanks with the truss showing between them.
  tankRing(f, 8.6, 24.4, 6.5, 2.9, 6, 0, SILVER, SILVER);
  tankRing(f, -8.4, 7.4, 6.5, 2.9, 6, TAU / 12, GRAPHITE, GOLD);
  if (d) {
    f.use(WHITE, 3);
    for (const x of [8.0, -9.0]) {
      f.lathe([[x - 0.4, 1.9], [x - 0.4, 3.4], [x + 0.4, 3.4], [x + 0.4, 1.9]], 16);
    }
    f.use(METAL, 2);
    for (const x of [-37, -24, -10]) f.lathe([[x - 0.3, 1.9], [x - 0.3, 4.9], [x + 0.3, 4.9], [x + 0.3, 1.9]], 4, Math.PI / 4);
  }

  // Heat has nowhere to go in vacuum except out, and this is the wingspan of the ship.
  f.both(() => {
    radiator(f, -36, -12.5, 0, 3.8, 27, 0);
    f.light([-13, 0, 27.2], 'nav', 2);
  });
  if (d) {
    f.use(METAL, 1);
    f.both(() => {
      f.beam([-34, 3.2, 3.2], [-34, 0.2, 13], 0.14);
      f.beam([-14.5, 3.2, 3.2], [-14.5, 0.2, 13], 0.14);
      f.beam([-34, -3.2, 3.2], [-34, -0.2, 13], 0.14);
      f.beam([-14.5, -3.2, 3.2], [-14.5, -0.2, 13], 0.14);
    });
  }

  // The shadow shield: everything forward of it stands in the reactor's shade.
  f.use(WHITE, 2.2).lathe([[-40.6, 0], [-40.6, 10.8], [-39.6, 11.4], [-38.8, 11.4], [-38.8, 2]], 32);
  if (d) gores(f, -38.72, 2.2, 11.1, 24, 0.5);

  const reactor: Station[] = [
    { x: -52.5, hw: 7.4, hh: 7.4 }, { x: -51.2, hw: 9.8, hh: 9.8 }, { x: -44, hw: 10.2, hh: 10.2 }, { x: -41.2, hw: 8.6, hh: 8.6 }, { x: -40.2, hw: 6, hh: 6 },
  ];
  f.use(WHITE, 2.6).loft(reactor, octagon(0.36), (side, band) => (band === 1 && side % 2 === 0 ? GRAPHITE : WHITE));

  if (d) {
    f.use(METAL, 1);
    for (let k = 0; k < 8; k++) {
      const t = ((k + 0.5) / 8) * TAU;
      const R = 10.25;
      const y = Math.cos(t) * R, z = Math.sin(t) * R;
      f.at(along([-44, y * 0.97, z * 0.97], [-44, y * 1.1, z * 1.1]), () => {
        f.use(GRAPHITE, 0.8).box([0.2, 0, 0], [0.5, 2.3, 4.2]);
        f.use(METAL, 0.8);
        for (let i = 0; i < 7; i++) f.box([0.5, -0.9 + i * 0.3, 0], [0.1, 0.1, 4], 0);
      });
    }
    f.both(() => {
      f.rcs([-48, 7.6, 7.6], [0, 0.7, 0.7], 1);
      f.rcs([-48, -7.6, 7.6], [0, -0.7, 0.7], 1);
    });
  }

  // Thrust frame and the engines. Five, because one engine out on a long burn must not end the voyage.
  f.use(METAL, 2).cyl([-55, 0, 0], [-52.3, 0, 0], 8.6, 9, 32);
  f.use(GRAPHITE, 2).cyl([-55.6, 0, 0], [-55, 0, 0], 8.2, 8.6, 32);
  if (d) {
    // The thrust structure the engines push on: a ring and eight ribs, which a flat plate would not survive.
    f.use(METAL, 1);
    f.lathe([[-55.7, 7.9], [-56, 7.9], [-56, 7.1], [-55.7, 7.1]], 40);
    for (let k = 0; k < 8; k++) {
      const t = ((k + 0.5) / 8) * TAU;
      f.at(turnX(t), () => f.box([-55.84, 4.4, 0], [0.32, 6.6, 0.5], 0.05));
    }
  }
  const engines: V3[] = [[0, 0, 0], [0, 5.7, 0], [0, -5.7, 0], [0, 0, 5.7], [0, 0, -5.7]];
  for (const e of engines) {
    f.at(move(-55.8, e[1], e[2]), () => f.bell(e[1] === 0 && e[2] === 0 ? 3.5 : 2.7, e[1] === 0 && e[2] === 0 ? 6.4 : 5.2));
    if (d && (e[1] !== 0 || e[2] !== 0)) {
      // The rams that gimbal an outer engine.
      // Either side of the bell, plate to its waist, so neither crosses the mouth.
      const across: V3 = e[1] !== 0 ? [0, 0, 1] : [0, 1, 0];
      f.use(METAL, 0);
      for (const side of [-1, 1]) {
        f.beam([-55.5, e[1] + across[1] * side * 2.4, e[2] + across[2] * side * 2.4], [-58.6, e[1] + across[1] * side * 1.9, e[2] + across[2] * side * 1.9], 0.09);
      }
    }
  }
  f.light([-52, 10.1, 0], 'strobe', 2);
  f.light([-52, -10.1, 0], 'strobe', 2);
  f.light([-40, 11.5, 0], 'nav', 1.4);
  f.both(() => f.light([-52.6, 0, 7.6], 'nav', 1.6));
  f.light([62.6, 2.6, 0], 'nav', 1.4);
}

/** Sonnet. A working cruiser: a lifting body with two drop tanks, built to go back and forth and to take a scrape. */
export function cruiser(f: Forge): void {
  const d = f.detail;
  const body: Station[] = [
    { x: 31, y: -0.9, hw: 2.4, hh: 0.8 }, { x: 28, y: -0.7, hw: 4.6, hh: 1.6 }, { x: 20, y: 0, hw: 8.4, hh: 3.5 }, { x: 6, y: 0.2, hw: 10.4, hh: 4.5 },
    { x: -14, y: 0.3, hw: 11.2, hh: 4.9 }, { x: -22, y: 0.3, hw: 10.6, hh: 4.7 }, { x: -24.4, y: 0.3, hw: 8.8, hh: 3.9 },
  ];
  f.use(WHITE, 2.6).loft(body, lifting(), (side) => (side >= 5 && side <= 9 ? DARK : WHITE));

  // Spine hump: the crew tunnel, and the only place to put a mast.
  const hump: Station[] = [
    { x: 16, y: 4.0, hw: 0.8, hh: 0.3 }, { x: 11, y: 4.6, hw: 3.3, hh: 1.5 }, { x: -6, y: 5.0, hw: 3.9, hh: 2.0 }, { x: -20, y: 5.0, hw: 3.5, hh: 1.7 }, { x: -23, y: 4.6, hw: 2.2, hh: 1.0 },
  ];
  f.use(WHITE, 2).loft(hump, octagon(0.4), (side) => (side === 1 ? GRAPHITE : WHITE));

  // Canopy.
  f.use(GRAPHITE, 1).loft([{ x: 24.8, y: 1.4, hw: 2.2, hh: 0.3 }, { x: 21.5, y: 2.4, hw: 4.3, hh: 0.9 }, { x: 18.5, y: 3.0, hw: 4.6, hh: 1.0 }, { x: 17.5, y: 3.0, hw: 3.6, hh: 0.6 }], octagon(0.3));
  if (d) {
    f.use(WINDOW, 0.6);
    for (let i = 0; i < 6; i++) f.box([22.7, 3.05, -2.75 + i * 1.1], [2.2, 0.2, 0.88], 0);
    f.use(METAL, 1);
    for (let i = 0; i < 7; i++) f.box([22.7, 3.14, -3.3 + i * 1.1], [2.5, 0.16, 0.12], 0);
  } else f.use(WINDOW, 0.6).box([22.7, 3.0, 0], [2.2, 0.3, 6.4]);

  // Drop tanks on pylons. The working ship's silhouette is these.
  f.both(() => {
    f.at(move(-1, -0.6, 15.2), () => {
      const len = 25;
      const r = 3.3;
      const dome: Array<[number, number]> = [[0, 0]];
      const n = d ? 6 : 3;
      for (let i = 1; i <= n; i++) {
        const a = (i / n) * Math.PI / 2;
        dome.push([r * 1.25 * (1 - Math.cos(a)), r * Math.sin(a)]);
      }
      const back = [...dome].reverse().map(([x, q]) => [len - x, q] as [number, number]);
      f.at(move(-len / 2), () => {
        f.use(GOLD, 1.8).lathe(dome, 22);
        f.use(SILVER, 2.6).lathe([[r * 1.25, r], [len - r * 1.25, r]], 22);
        f.use(GOLD, 1.8).lathe(back, 22);
        if (d) {
          f.use(METAL, 1);
          for (const x of [2.2, 8, 12.5, 17, 22.8]) f.lathe([[x - 0.14, r * 0.99], [x - 0.14, r * 1.025], [x + 0.14, r * 1.025], [x + 0.14, r * 0.99]], 22);
          f.use(METAL, 1).tube([[1, 3.4, 0], [24, 3.4, 0]], 0.22, 6);
        }
      });
    });
    f.use(METAL, 1.4);
    f.box([6, 0.2, 12.2], [3.2, 0.8, 4.8]);
    f.box([-8, 0.2, 12.2], [3.2, 0.8, 4.8]);
    f.light([12, -0.5, 18.4], 'nav', 2);
  });

  // Two engines side by side, one spare in the middle.
  const aft: Station[] = [{ x: -28, y: 0.3, hw: 8.3, hh: 3.4 }, { x: -24.2, y: 0.3, hw: 9.0, hh: 4.0 }];
  f.use(GRAPHITE, 2).loft(aft, octagon(0.3));
  for (const [y, z, r, l] of [[0.3, 4.2, 2.3, 4.2], [0.3, -4.2, 2.3, 4.2], [0.3, 0, 1.55, 3.4]] as const) f.at(move(-28.2, y, z), () => f.bell(r, l, 24));

  // Folded radiators either side of the hump.
  f.both(() => {
    f.at(move(0, 5.2, 3.8), () => f.at(turnX(0.42), () => radiator(f, -18, -2, 0, 0.2, 7.8, 2)));
  });

  if (d) {
    f.both(() => {
      rack(f, -16, 4.86, 7, 15, 2.1, 1.7, 0.42, 3);
      lines(f, [-18, 4.9, 5], [15, 4.9, 5], 0.08, 0.2, 8);
    });
    f.both(() => {
      f.rcs([18, 0.6, 7.6], [0, 0.2, 1], 0.7);
      f.rcs([-19, 0.8, 11], [0, 0.2, 1], 0.7);
      f.use(WINDOW, 0.5);
      for (let i = 0; i < 7; i++) f.box([9 - i * 1.5, 1.6, 10.56], [0.7, 0.6, 0.08], 0);
    });
    stencil(f, 'NAOS-2', 6, 4.72, 8.6, 1.1);
    stencil(f, 'NAOS-2', 14, 4.72, -8.6, 1.1, -1);
  }
  f.light([31, -0.9, 0], 'nav', 1.6);
  f.light([-23, 7.0, 0], 'strobe', 1.8);
}

/** Haiku. A small fast scout, close kin of a lander: a wedge, a keel, two engines and not much else. */
export function scout(f: Forge): void {
  const d = f.detail;
  const body: Station[] = [
    { x: 9.4, y: -0.25, hw: 0.8, hh: 0.2 }, { x: 8.5, y: -0.2, hw: 1.3, hh: 0.46 }, { x: 5, y: 0, hw: 2.6, hh: 1.16 }, { x: -2, y: 0.1, hw: 3.8, hh: 1.5 }, { x: -6.6, y: 0.1, hw: 4.2, hh: 1.5 }, { x: -7.6, y: 0.1, hw: 3.4, hh: 1.2 },
  ];
  f.use(WHITE, 1.5).loft(body, lifting(), (side) => (side >= 5 && side <= 9 ? DARK : WHITE));
  // Wing roots, stubbed: enough for a thin atmosphere and a place for the outer thrusters.
  f.both(() => {
    f.use(DARK, 1).loft([{ x: -1, y: -0.1, z: 3.7, hw: 0.5, hh: 0.3 }, { x: -6.4, y: -0.1, z: 5.2, hw: 2, hh: 0.3 }, { x: -7.4, y: -0.1, z: 5.4, hw: 2, hh: 0.24 }], octagon(0.4));
    f.use(WHITE, 1).box([-5.9, 0.3, 6.6], [2.8, 0.5, 0.9]);
    if (d) f.rcs([-5.6, 0.3, 7.1], [0, 0, 1], 0.26);
    f.light([-6.6, 0.3, 7.25], 'nav', 1.2);
  });
  f.use(GRAPHITE, 1).loft([{ x: 7.2, y: 0.2, hw: 1.1, hh: 0.14 }, { x: 5.2, y: 0.84, hw: 1.86, hh: 0.34 }, { x: 3.7, y: 1.1, hw: 1.9, hh: 0.26 }], octagon(0.3));
  if (d) {
    f.use(WINDOW, 0.4);
    for (const z of [-1.05, -0.35, 0.35, 1.05]) f.box([5.4, 1.14, z], [1.15, 0.08, 0.58], 0);
    f.both(() => {
      rack(f, -5.4, 1.5, 2.2, 7, 1.1, 0.8, 0.2, 1.2);
      lines(f, [-6, 1.54, 1.1], [2.6, 1.54, 1.1], 0.03, 0.07, 4);
    });
    f.use(METAL, 1).cyl([-1, 1.6, 0], [-1, 1.9, 0], 0.3, 0.26, 12);
    f.at(mul(move(-1, 1.9, 0), turnZ(Math.PI / 2 - 0.5)), () => dish(f, 0.62, 0.18));
    f.use(METAL, 1).beam([-3.2, 1.6, 0.8], [-5.6, 3.1, 0.8], 0.018);
    f.beam([-3.2, 1.6, -0.8], [-5.6, 3.1, -0.8], 0.018);
    stencil(f, 'NAOS-3', 0.4, 1.52, 3, 0.3);
    stencil(f, 'NAOS-3', 2.8, 1.52, -3, 0.3, -1);
  }
  f.use(GRAPHITE, 1).loft([{ x: -8.2, y: 0.1, hw: 3, hh: 0.86 }, { x: -7.5, y: 0.1, hw: 3.3, hh: 1.1 }], octagon(0.3));
  // Three in a row under one brow, the way a lander carries them: a shape with a job, and nothing that can be read as a face.
  for (const z of [-1.86, 0, 1.86]) f.at(move(-8.2, 0.02, z), () => f.bell(0.72, 1.3, 20));
  f.use(WHITE, 1).box([-8.9, 0.98, 0], [1.5, 0.12, 5.9]);
  f.both(() => f.use(METAL, 1).box([-8.9, 0.1, 2.92], [1.5, 1.7, 0.14]));
  f.light([9.3, -0.25, 0], 'nav', 0.9);
  f.light([-5.6, 3.1, 0.8], 'strobe', 0.8);
}

/** Fable. A rare long-range vessel: a shield in front of everything, the ship in its shade, and the drive as far from anyone as possible. */
export function longrange(f: Forge): void {
  const d = f.detail;
  // The bow shield, shallow, because it spends years facing the dust of a straight line.
  const shield: Array<[number, number]> = [[78, 0], [77.6, 4], [76.2, 9], [73.6, 14], [70.6, 18], [69.4, 18.4]];
  f.use(GRAPHITE, 2.2).lathe([...shield].reverse(), 48);
  f.use(METAL, 2).lathe([[68.6, 2], [69.0, 18.2], [69.4, 18.4]], 48);
  if (d) {
    f.use(METAL, 1);
    for (let k = 0; k < 16; k++) {
      const t = (k / 16) * TAU;
      f.beam([68.4, Math.cos(t) * 3, Math.sin(t) * 3], [69.2, Math.cos(t) * 18, Math.sin(t) * 18], 0.18);
    }
  }

  // Habitat in the shield's shade.
  const hab: Station[] = [
    { x: 46, hw: 4, hh: 4 }, { x: 47.6, hw: 6.8, hh: 6.8 }, { x: 62, hw: 7.2, hh: 7.2 }, { x: 66, hw: 5.6, hh: 5.6 }, { x: 68.6, hw: 3, hh: 3 },
  ];
  f.use(WHITE, 2.8).loft(hab, octagon(0.38), (side, band) => (band === 1 && side === 5 ? DARK : WHITE));
  if (d) {
    f.both(() => {
      f.use(WINDOW, 0.5);
      for (let i = 0; i < 8; i++) f.box([51.5 + i * 1.32, 3.1, 7.12], [0.62, 0.8, 0.08], 0);
      f.use(GRAPHITE, 1).box([56, 3.1, 7.08], [11.6, 1.3, 0.06], 0);
      f.rcs([64, 3.6, 4.6], [0, 0.6, 0.8], 0.6);
    });
  }
  if (d) {
    f.both(() => {
      rack(f, 49.5, 7.2, 3, 8, 1.6, 1.3, 0.34, 1.6);
      lines(f, [49, 7.24, 1.2], [62, 7.24, 1.2], 0.07, 0.17, 6);
    });
    stencil(f, 'NAOS-5', 50, 7.2, 5, 1);
    stencil(f, 'NAOS-5', 57.6, 7.2, -5, 1, -1);
  }

  // A hundred metres of nothing but spine. Distance is the only shielding that weighs nothing.
  f.use(METAL, 2).truss([-60, 0, 0], [46.4, 0, 0], 2.5, 46, 3, 0.15);
  f.use(WHITE, 2.4).cyl([-60, 0, 0], [46.2, 0, 0], 0.8, 0.8, 10);

  // Spheres of propellant strung along it, as few as the trip allows.
  for (const x of [28, 13, -2]) {
    for (let k = 0; k < 3; k++) {
      const t = (k / 3) * TAU + Math.PI / 6;
      f.use(x === 13 ? GOLD : SILVER, 2.4).sphere([x, Math.cos(t) * 5.2, Math.sin(t) * 5.2], 3.6, 22, d ? 12 : 4);
      if (d) f.use(METAL, 1).beam([x, Math.cos(t) * 1.8, Math.sin(t) * 1.8], [x, Math.cos(t) * 8.8, Math.sin(t) * 8.8], 0.1);
    }
    if (d) {
      f.use(METAL, 1.4).lathe([[x - 0.35, 0.85], [x - 0.35, 2.7], [x + 0.35, 2.7], [x + 0.35, 0.85]], 3);
    }
  }

  // Long ribbon radiators, trailing back along the spine.
  f.both(() => {
    radiator(f, -52, -16, 0, 2.8, 12.6, 3);
    f.light([-30, 0, 12.8], 'nav', 1.8);
  });

  // Shadow shield, reactor, and one enormous bell.
  f.use(GOLD, 2).lathe([[-58.6, 8.6], [-58.6, 0.8]], 32);
  f.use(WHITE, 2).lathe([[-68, 4.6], [-60, 8.8], [-58.8, 8.8], [-58.8, 1]], 32);
  f.use(METAL, 2).cyl([-70, 0, 0], [-68, 0, 0], 3.4, 4.6, 24);
  f.at(move(-70), () => f.bell(6.8, 8.2, 40));
  if (d) {
    f.use(METAL, 1);
    for (let k = 0; k < 6; k++) {
      const t = (k / 6) * TAU;
      f.beam([-68, Math.cos(t) * 4.2, Math.sin(t) * 4.2], [-73.6, Math.cos(t) * 4.9, Math.sin(t) * 4.9], 0.16);
    }
  }
  f.light([69, 18.4, 0], 'nav', 2.4);
  f.light([69, -18.4, 0], 'nav', 2.4);
  f.light([-64, 7.4, 0], 'strobe', 1.8);
}

/** Unknown model. The plain default: a service module, a cone, one engine, two arrays. Honest and unremarkable. */
export function plain(f: Forge): void {
  const d = f.detail;
  f.use(WHITE, 1.8).lathe([[-10, 0], [-10, 3.9], [-9.7, 4.1], [3.4, 4.1], [3.8, 3.8], [4.2, 3.6]], 28);
  f.use(WHITE, 1.8).lathe([[4.2, 3.6], [12.2, 1.1], [12.4, 0.9], [12.4, 0]], 28);
  f.at(move(-10.2), () => f.bell(2.1, 3.8, 24));
  f.both(() => {
    f.use(METAL, 1).box([-3, 0, 5.2], [1.2, 0.7, 2.3]);
    f.use(SOLAR, 0.8).box([-3, 0, 11], [4.2, 0.12, 9.6], 0);
    f.use(METAL, 1).box([-3, 0, 11], [0.24, 0.18, 9.8], 0);
    f.light([-3, 0, 15.9], 'nav', 1.2);
  });
  if (d) {
    f.use(METAL, 1);
    for (let k = 0; k < 4; k++) {
      const t = (k / 4) * TAU + 0.4;
      f.at(turnX(t), () => {
        f.rcs([-1.5, 4.1, 0], [0, 1, 0], 0.5);
        f.use(GRAPHITE, 1).box([-6.4, 4.12, 0], [4.8, 0.12, 2.2]);
      });
    }
    f.use(WINDOW, 0.5);
    for (const t of [-0.5, 0.5]) f.at(turnX(t), () => f.box([8, 2.62, 0], [0.9, 0.1, 0.8], 0));
    f.use(METAL, 1).tube([[12.4, 0, 0], [13.6, 0, 0]], 0.2, 8);
    f.use(WHITE, 1).lathe([[13.6, 0.5], [14, 0.5], [14, 0]], 12);
  }
  f.light([14, 0, 0], 'nav', 1);
}

/** Workflow agent. No crew, so no windows: a bus, four thrusters on outriggers, one eye. Always small. */
export function drone(f: Forge): void {
  const d = f.detail;
  f.use(WHITE, 0.9).loft([{ x: -2.2, hw: 1.2, hh: 1.2 }, { x: -1.8, hw: 1.6, hh: 1.6 }, { x: 1.4, hw: 1.6, hh: 1.6 }, { x: 2.2, hw: 1, hh: 1 }], octagon(0.36), (side) => (side % 2 ? WHITE : GRAPHITE));
  f.use(GOLD, 0.6).cyl([2.2, 0, 0], [3, 0, 0], 0.7, 0.5, 16);
  f.use(GRAPHITE, 0.6).cyl([3, 0, 0], [3.16, 0, 0], 0.46, 0.42, 16);
  for (const t of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
    const y = Math.cos(t), z = Math.sin(t);
    f.use(METAL, 0.6).beam([-0.2, y * 1.5, z * 1.5], [-1.2, y * 3.6, z * 3.6], 0.14);
    f.at(move(-1.2, y * 3.6, z * 3.6), () => {
      f.use(WHITE, 0.6).lathe([[-0.8, 0.46], [0.9, 0.46], [1.2, 0.2], [1.2, 0]], 12);
      f.bell(0.4, 0.7, 12);
    });
  }
  if (d) {
    f.use(METAL, 0.6);
    for (const t of [0, Math.PI]) f.at(turnX(t), () => f.box([0, 1.66, 0], [2.2, 0.1, 1.4], 0.03));
    f.use(SOLAR, 0.5).box([-0.2, 0, 1.66], [2.2, 1.6, 0.06], 0);
    f.box([-0.2, 0, -1.66], [2.2, 1.6, 0.06], 0);
    f.use(METAL, 0.6).beam([0, 1.6, 0], [0, 3.1, 0.3], 0.03);
  }
  f.light([3.2, 0, 0], 'nav', 0.5);
}
