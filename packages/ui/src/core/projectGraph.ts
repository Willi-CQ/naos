import { hashName, type KnowledgeGraph, type ProjectSurvey } from '@naos/protocol';

export function structureGraph(survey: ProjectSurvey): KnowledgeGraph {
  const nodes = [{ id: '.', title: 'Project', folder: '.' }], edges: KnowledgeGraph['edges'] = [];
  for (const region of survey.regions.slice(0, 24)) {
    const id = `folder:${region.path}`;
    nodes.push({ id, title: region.name, folder: region.path }); edges.push({ from: '.', to: id, kind: 'folder' });
    for (const file of region.entries.slice(0, 5)) { nodes.push({ id: file, title: file.split('/').at(-1)!, folder: region.path }); edges.push({ from: id, to: file, kind: 'folder' }); }
  }
  return { nodes, edges, complete: survey.complete };
}

/** Stable bounded force layout; it runs once when the document set changes. */
export function graphPositions(graph: KnowledgeGraph): Map<string, { x: number; y: number }> {
  const points = graph.nodes.map((node, i) => { const angle = i * 2.399963, radius = 35 + Math.sqrt(i) * 29; return { id: node.id, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, dx: 0, dy: 0 }; });
  const byId = new Map(points.map((p) => [p.id, p]));
  for (let step = 0; step < 90; step++) {
    for (const p of points) { p.dx = -p.x * .004; p.dy = -p.y * .004; }
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
      const a = points[i]!, b = points[j]!, x = a.x - b.x || .1, y = a.y - b.y || .1, d2 = Math.max(80, x * x + y * y), f = 480 / d2;
      a.dx += x * f; a.dy += y * f; b.dx -= x * f; b.dy -= y * f;
    }
    for (const e of graph.edges) { const a = byId.get(e.from), b = byId.get(e.to); if (!a || !b) continue; const x = b.x - a.x, y = b.y - a.y, d = Math.hypot(x, y) || 1, f = (d - 90) * .012; a.dx += x / d * f; a.dy += y / d * f; b.dx -= x / d * f; b.dy -= y / d * f; }
    for (const p of points) { p.x += Math.max(-8, Math.min(8, p.dx)); p.y += Math.max(-8, Math.min(8, p.dy)); }
  }
  const maxX = Math.max(180, ...points.map((p) => Math.abs(p.x))), maxY = Math.max(130, ...points.map((p) => Math.abs(p.y)));
  return new Map(points.map((p) => [p.id, { x: 400 + p.x / maxX * 310, y: 235 + p.y / maxY * 155 }]));
}

export const folderColor = (folder: string): string => ['#abc4a5', '#9bbfc8', '#c9af87', '#ada6cf', '#a3bbb3'][hashName(folder) % 5]!;
