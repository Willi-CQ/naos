import { hashName, type ProjectRegion } from '@naos/protocol';

export const REGION_TITLE: Record<ProjectRegion['kind'], string> = {
  source: 'Source code', interface: 'Interface', service: 'Services', tests: 'Tests',
  docs: 'Knowledge & docs', assets: 'Assets', config: 'Tools & config',
};

export const REGION_COLOR: Record<ProjectRegion['kind'], string> = {
  source: '#b1cda0', interface: '#86d6ce', service: '#dfba84', tests: '#c6ce86',
  docs: '#b6afe1', assets: '#d4b7c7', config: '#adbfc9',
};

export interface MapRegion { region: ProjectRegion; x: number; y: number; rx: number; ry: number; seed: number }

export function mapRegions(regions: readonly ProjectRegion[], seed: number, selected?: string | null): MapRegion[] {
  const visible = regions.slice(0, 12);
  const extra = regions.find((r) => r.path === selected);
  if (extra && !visible.includes(extra)) visible[11] = extra;
  const anchors = [[265, 265], [570, 260], [485, 455], [770, 405], [235, 440], [785, 230]];
  return visible.map((region, i) => {
    const h = hashName(`${seed}:${region.path}`);
    const p = visible.length <= 6 ? anchors[i]! : [200 + (i % 4) * 200, 225 + Math.floor(i / 4) * 125];
    const size = visible.length <= 6 ? 1 : .66;
    return { region, seed: h, x: p[0]! + (h % 29) - 14, y: p[1]! + ((h >> 8) % 21) - 10,
      rx: (94 + Math.min(36, Math.sqrt(region.files) * 3)) * size, ry: (69 + Math.min(25, Math.sqrt(region.files) * 2)) * size };
  });
}

/** Partition one project's continent into folder territories without implying dependency links. */
export function territoryCells(regions: readonly MapRegion[]): string[] {
  return regions.map((region, index) => {
    let polygon = [[0, 0], [1000, 0], [1000, 660], [0, 660]];
    for (let other = 0; other < regions.length; other++) {
      if (other === index) continue;
      const next = regions[other]!, nx = next.x - region.x, ny = next.y - region.y;
      const limit = (next.x ** 2 + next.y ** 2 - region.x ** 2 - region.y ** 2) / 2;
      const clipped: number[][] = [];
      for (let edge = 0; edge < polygon.length; edge++) {
        const a = polygon[edge]!, b = polygon[(edge + 1) % polygon.length]!;
        const da = a[0]! * nx + a[1]! * ny - limit, db = b[0]! * nx + b[1]! * ny - limit;
        if (da <= 0) clipped.push(a);
        if ((da <= 0) !== (db <= 0)) {
          const t = da / (da - db);
          clipped.push([a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t]);
        }
      }
      polygon = clipped;
    }
    return polygon.map(point => point.map(n => n.toFixed(2)).join(',')).join(' ');
  });
}

/** Smooth closed contours, shared by the coastline and its nested elevation lines. */
export function contour(seed: number, rx: number, ry: number, scale = 1): string {
  const points = Array.from({ length: 28 }, (_, i) => {
    const a = i / 28 * Math.PI * 2, phase = seed % 628 / 100;
    const r = 1 + Math.sin(a * 3 + phase) * .14 + Math.cos(a * 5 - phase) * .08 + Math.sin(a * 7 + phase * 2) * .04;
    return { x: Math.cos(a) * rx * r * scale, y: Math.sin(a) * ry * r * scale };
  });
  let d = `M${points[0]!.x.toFixed(2)},${points[0]!.y.toFixed(2)}`;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[(i + points.length - 1) % points.length]!, b = points[i]!, c = points[(i + 1) % points.length]!, e = points[(i + 2) % points.length]!;
    d += `C${(b.x + (c.x - a.x) / 6).toFixed(2)},${(b.y + (c.y - a.y) / 6).toFixed(2)} ${(c.x - (e.x - b.x) / 6).toFixed(2)},${(c.y - (e.y - b.y) / 6).toFixed(2)} ${c.x.toFixed(2)},${c.y.toFixed(2)}`;
  }
  return `${d}Z`;
}
