import { useId, useMemo, useRef, useState } from 'react';
import type { ProjectSurvey } from '@naos/protocol';
import { contour, mapRegions, REGION_COLOR, REGION_TITLE, territoryCells } from '../../core/cartography.ts';
import type { AtlasWorld } from '../../core/observatory.ts';

export type MapStyle = 'landscape' | 'topography';

export function ProjectMap({ world, survey, selected, choose, style = 'landscape', filter = 'all' }: {
  world: AtlasWorld; survey: ProjectSurvey; selected: string | null; choose(path: string): void; style?: MapStyle; filter?: string;
}) {
  const id = useId().replaceAll(':', ''), svg = useRef<SVGSVGElement>(null);
  const [zoom, setZoom] = useState(1), [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const regions = useMemo(() => mapRegions(survey.regions, world.genome.seed, selected), [survey.regions, world.genome.seed, selected]);
  const cells = useMemo(() => territoryCells(regions), [regions]);
  const coast = contour(world.genome.seed, 428, 225);
  const reset = () => { setZoom(1); setPan({ x: 0, y: 0 }); };
  return <div className="project-map surface-terrain-map" data-map-world={world.id} data-theme={world.identity.theme} data-style={style}>
    <svg ref={svg} viewBox={`${500 - 500 / zoom - pan.x} ${330 - 330 / zoom - pan.y} ${1000 / zoom} ${660 / zoom}`} aria-label={`Land map of ${world.name}`} role="group"
      onPointerDown={(e) => { if (e.button !== 0 || (e.target as Element).closest('[data-region]')) return; drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }; e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={(e) => { const d = drag.current, bounds = svg.current?.getBoundingClientRect(); if (!d || !bounds) return; const k = Math.max(1000 / bounds.width, 660 / bounds.height) / zoom; setPan({ x: Math.max(-500, Math.min(500, d.px + (e.clientX - d.x) * k)), y: Math.max(-330, Math.min(330, d.py + (e.clientY - d.y) * k)) }); }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <defs>
        <pattern id={`${id}grid`} width="50" height="50" patternUnits="userSpaceOnUse"><path d="M50 0H0V50" fill="none" stroke="#a1c8c6" strokeOpacity=".055" strokeWidth=".6"/><path d="M23 25H27M25 23V27" stroke="#a1c8c6" strokeOpacity=".2" strokeWidth=".6"/></pattern>
        <radialGradient id={`${id}ocean`}><stop stopColor="#153336"/><stop offset=".65" stopColor="#0c2028"/><stop offset="1" stopColor="#07141d"/></radialGradient>
        <linearGradient id={`${id}land`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#73856d"/><stop offset=".5" stopColor="#364e47"/><stop offset="1" stopColor="#152d30"/></linearGradient>
        <linearGradient id={`${id}light`} x1="0" y1="0" x2=".8" y2="1"><stop stopColor="#e5ead0" stopOpacity=".12"/><stop offset=".6" stopColor="#0c1d26" stopOpacity=".04"/><stop offset="1" stopColor="#041019" stopOpacity=".6"/></linearGradient>
        <clipPath id={`${id}continent`}><path d={coast} transform="translate(500 354)"/></clipPath>
        {regions.map((r, i) => <clipPath id={`${id}cell${i}`} key={r.region.path}><polygon points={cells[i]}/></clipPath>)}
      </defs>
      <rect x="-1000" y="-1000" width="3000" height="2660" fill={`url(#${id}ocean)`}/>
      <rect x="-1000" y="-1000" width="3000" height="2660" fill={`url(#${id}grid)`}/>
      <g transform="translate(500 354)" className="surface-coastal-shelf" aria-hidden="true">
        {[1.2, 1.14, 1.08, 1.035].map((scale, i) => <path key={scale} d={contour(world.genome.seed, 428, 225, scale)} fill={i === 0 ? '#8cb6a6' : 'none'} fillOpacity=".025" stroke="#97d2c4" strokeOpacity={.04 + i * .027} strokeWidth=".8"/>)}
        <path d={coast} fill="#020b13" transform="translate(4 9)" opacity=".7"/>
        <path d={coast} fill={`url(#${id}land)`}/>
      </g>
      <g clipPath={`url(#${id}continent)`}>
        {style === 'landscape' ? <image className="expedition-terrain surface-terrain-texture" href="/maps/night-terrain.png" x="-15" y="55" width="1030" height="660" preserveAspectRatio="xMidYMid slice"/> : null}
        {regions.map((r, i) => <g key={r.region.path} clipPath={`url(#${id}cell${i})`} className="surface-territory" data-region={r.region.path} data-selected={selected === r.region.path} data-muted={filter !== 'all' && filter !== r.region.kind} onClick={() => { if (filter === 'all' || filter === r.region.kind) choose(r.region.path); }}>
          <polygon points={cells[i]} fill={REGION_COLOR[r.region.kind]} className="surface-territory-fill"/>
          <g transform={`translate(${r.x} ${r.y})`} className="expedition-elevation surface-elevation" style={{ color: REGION_COLOR[r.region.kind] }}>{Array.from({ length: 9 }, (_, n) => <path key={n} d={contour(r.seed, r.rx * 1.7, r.ry * 1.55, 1.4 - n * .14)}/>)}</g>
          <polygon points={cells[i]} className="surface-territory-border"/>
        </g>)}
        <rect width="1000" height="660" fill={`url(#${id}light)`} pointerEvents="none"/>
      </g>
      <path d={coast} transform="translate(500 354)" fill="none" stroke="#bedac0" strokeOpacity=".55" strokeWidth="1" pointerEvents="none"/>
      {regions.filter(r => filter === 'all' || r.region.kind === filter).map(r => <g key={r.region.path} transform={`translate(${r.x} ${r.y})`} className="map-region surface-map-place" data-region={r.region.path} data-selected={selected === r.region.path} style={{ color: REGION_COLOR[r.region.kind] }} role="button" tabIndex={0} aria-label={`${r.region.path}, ${r.region.files} files`} aria-pressed={selected === r.region.path}
        onClick={() => choose(r.region.path)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(r.region.path); } }}>
        <title>{r.region.path} · {REGION_TITLE[r.region.kind]} · {r.region.files} files</title>
        <rect x="-85" y="-27" width="170" height="83" rx="8" fill="transparent"/>
        <path className="surface-place-beacon" d="M0 -18L6 -12L0 -6L-6 -12Z"/>
        <path className="surface-place-brackets" d="M-15 -20V-26H-9M9 -26H15V-20M-15 -5V1H-9M9 1H15V-5"/>
        <text className="surface-place-name" y="23">{r.region.name.length > 19 ? r.region.name.slice(0, 18) + '…' : r.region.name}</text>
        <text className="surface-place-count" y="40">{r.region.files.toLocaleString()} FILES / {REGION_TITLE[r.region.kind].toUpperCase()}</text>
      </g>)}
      <g className="surface-map-compass" transform="translate(914 550)" aria-hidden="true"><path d="M0 -23V23M-23 0H23M0 -17L4 6L0 2L-4 6Z"/><circle r="15"/><text y="-32">N</text></g>
      <text x="80" y="613" className="surface-map-coordinate" aria-hidden="true">FOLDER TERRITORIES / {regions.length} AREAS MAPPED</text>
    </svg>
    <div className="map-controls surface-map-controls" aria-label="Map controls"><button type="button" aria-label="Zoom out" disabled={zoom <= .8} onClick={() => setZoom(Math.max(.8, zoom - .2))}>−</button><button type="button" title="Reset map view" onClick={reset}>{Math.round(zoom * 100)}%</button><button type="button" aria-label="Zoom in" disabled={zoom >= 2.6} onClick={() => setZoom(Math.min(2.6, zoom + .2))}>+</button></div>
  </div>;
}
