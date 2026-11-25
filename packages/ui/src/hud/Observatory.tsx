import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { CLIENT_NAME, SESSION_CLIENTS } from '@naos/protocol';
import { atlasPoint, atlasWorlds, PLANET_CLASS, type AtlasWorld } from '../core/observatory.ts';
import { closeOverlay, flyToSlot, openOverlay, setSetting, useNaos, useView } from '../store/store.ts';
import { useDialogFocus } from './focus.ts';
import { PlanetEmblem } from './PlanetEmblem.tsx';
import { contour } from '../core/cartography.ts';

const accentOf = (w: AtlasWorld): CSSProperties => ({ '--atlas-accent': w.identity.accent } as CSSProperties);

export function ObservatoryDock() {
  const visible = useNaos((s) => !s.view.sky && s.view.level !== 'craft');
  const routes = useView((v) => v.settings.signalRoutes);
  if (!visible) return null;
  return <div className="observatory-dock" aria-label="Observatory">
    <button type="button" data-observatory="open" onClick={() => openOverlay('observatory')}><span className="observatory-symbol" aria-hidden="true">✧</span> Project atlas <kbd>P</kbd></button>
    <button type="button" data-observatory="signals" aria-pressed={routes} title="Show activity routes between the core and your projects" onClick={() => setSetting('signalRoutes', !routes)}><i /> Signals</button>
  </div>;
}

function WorldCard({ world: w, selected, choose, explore }: { world: AtlasWorld; selected: boolean; choose(): void; explore(): void }) {
  return <button type="button" className="atlas-card" style={accentOf(w)} data-world={w.id} aria-pressed={selected} onClick={choose} onDoubleClick={explore} title={`Inspect ${w.name}. Double click to open its surface and chat.`}>
    <div className="atlas-card-orbit"><span>{String(w.slot).padStart(2, '0')}</span><small>{w.identity.label}</small></div>
    <svg className="atlas-card-topography" viewBox="0 0 240 180" aria-hidden="true"><g transform="translate(120 90)">{[1.4, 1.2, 1, .8, .6].map((s) => <path key={s} d={contour(w.genome.seed, 95, 58, s)} />)}</g></svg>
    <PlanetEmblem genome={w.genome} />
    <div className="atlas-card-copy"><h3>{w.name}</h3><span>{PLANET_CLASS[w.genome.archetype]}</span><div className="atlas-card-signal"><i data-on={w.working > 0} />{w.working ? `${w.working} working` : w.sessions ? `${w.sessions} open chats` : 'Quiet orbit'}{w.attention ? <b>{w.attention} attention</b> : null}</div><div className="atlas-card-invitation"><span>EXPLORE WORLD</span><span>↗</span></div></div>
  </button>;
}

function Constellation({ worlds, selected, choose }: { worlds: AtlasWorld[]; selected: string | null; choose(id: string): void }) {
  const outer = Math.max(220, 124 + Math.floor(Math.max(0, worlds.length - 1) / 8) * 72 + 55);
  const scale = Math.max(1, outer / 220), vb = `${310 - 310 * scale} ${220 - 220 * scale} ${620 * scale} ${440 * scale}`;
  return <div className="atlas-constellation"><svg viewBox={vb} aria-label="Schematic project constellation">
    <defs><radialGradient id="atlas-core"><stop offset=".25" stopColor="#04070c" /><stop offset=".48" stopColor="#04070c" /><stop offset=".51" stopColor="#f7dcc0" /><stop offset=".58" stopColor="#db9960" stopOpacity=".8" /><stop offset="1" stopColor="#db9960" stopOpacity="0" /></radialGradient></defs>
    {[124,196,268].map((r) => <ellipse key={r} cx="310" cy="220" rx={r * 1.23} ry={r} className="atlas-chart-orbit" />)}
    <path d="M290 220H330M310 200V240" className="atlas-chart-cross" /><circle cx="310" cy="220" r="43" fill="url(#atlas-core)" /><text x="310" y="276" className="atlas-core-caption">NAOS / CORE</text>
    {worlds.map((w, i) => {
      const p = atlasPoint(i, worlds.length), d = `M310 220 Q${(310 + p.x) / 2 + 32} ${(220 + p.y) / 2 - 24} ${p.x} ${p.y}`;
      return <g key={w.id} style={accentOf(w)} data-selected={selected === w.id} data-working={w.working > 0}>
        <path d={d} className="atlas-chart-link" /><path d={d} className="atlas-chart-packet" />
        <g className="atlas-chart-world" role="button" tabIndex={0} aria-label={`Inspect ${w.name}`} aria-pressed={selected === w.id} onClick={() => choose(w.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(w.id); } }}>
          <circle cx={p.x} cy={p.y} r="25" className="atlas-chart-halo" /><circle cx={p.x} cy={p.y} r="13" fill={w.genome.palette.mid} stroke={w.identity.accent} />
          <circle cx={p.x - 4} cy={p.y - 4} r="6" fill={w.genome.palette.high} opacity=".35" />
          <text x={p.x} y={p.y + 41}>{w.slot} / {w.name.length > 20 ? `${w.name.slice(0, 19)}…` : w.name}</text>
          {w.attention ? <circle cx={p.x + 19} cy={p.y - 16} r="3" fill="#efae75" /> : null}
        </g>
      </g>;
    })}
  </svg><p>Schematic map · select a world to inspect</p></div>;
}

export function Observatory() {
  const model = useNaos((s) => s.model), facts = useNaos((s) => s.fleet.worlds);
  const filter = useView((v) => v.clientFilter), linked = useNaos((s) => s.link.status === 'up');
  const worlds = useMemo(() => atlasWorlds(model.allWorlds, model.crafts, facts), [model.allWorlds, model.crafts, facts]);
  const [query, setQuery] = useState(''), [mode, setMode] = useState<'cards' | 'map'>('cards');
  const [sort, setSort] = useState('orbit'), [selected, setSelected] = useState<string | null>(() => useNaos.getState().view.worldId);
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref);
  const matching = worlds.filter((w) => `${w.name} ${w.identity.label} ${PLANET_CLASS[w.genome.archetype]}`.toLowerCase().includes(query.trim().toLowerCase()));
  matching.sort((a, b) => (sort === 'activity' ? b.working - a.working : sort === 'attention' ? b.attention - a.attention : 0) || a.slot - b.slot);
  const focus = matching.find((w) => w.id === selected) ?? matching[0];
  const enter = () => { if (focus) { closeOverlay('observatory'); flyToSlot(focus.slot); } };
  const explore = (id: string) => { closeOverlay('observatory'); openOverlay('project', id); };
  return <div ref={ref} className="observatory" role="dialog" aria-modal="true" aria-label="Project atlas">
    <header className="atlas-header"><div><div className="atlas-eyebrow"><span>NAOS / FIELD ATLAS</span><span className="atlas-link" data-up={linked}><i />{linked ? 'CONNECTED' : 'LAST OBSERVATION'}</span></div><h2>A universe in the making.</h2><p>{worlds.length} worlds charted <span> / </span> {worlds.reduce((n,w) => n + w.sessions, 0)} open chats <span> / </span> {filter === 'all' ? 'All clients' : CLIENT_NAME[filter]}</p></div><button type="button" className="atlas-close" aria-label="Close project atlas" onClick={() => closeOverlay('observatory')}>✕ <kbd>ESC</kbd></button></header>
    <div className="atlas-toolbar"><label><span aria-hidden="true">⌕</span><input data-autofocus aria-label="Search projects" placeholder="Find a world, identity or terrain…" value={query} onChange={(e) => setQuery(e.target.value)} /></label><select aria-label="Order projects" value={sort} onChange={(e) => setSort(e.target.value)}><option value="orbit">Orbit order</option><option value="activity">Most active</option><option value="attention">Needs attention</option></select><div role="group" aria-label="Atlas view"><button type="button" data-atlas-view="cards" aria-pressed={mode === 'cards'} onClick={() => setMode('cards')}>Worlds</button><button type="button" data-atlas-view="map" aria-pressed={mode === 'map'} onClick={() => setMode('map')}>Constellation</button></div></div>
    <div className="atlas-body"><div className="atlas-explorer">
      {matching.length ? mode === 'cards' ? <div className="atlas-grid">{matching.map((w) => <WorldCard key={w.id} world={w} selected={focus?.id === w.id} choose={() => setSelected(w.id)} explore={() => explore(w.id)} />)}</div> : <Constellation worlds={matching} selected={focus?.id ?? null} choose={setSelected} /> : <div className="atlas-empty"><span>✧</span><h3>No worlds in this sector.</h3><p>{worlds.length ? 'Try another project name or visual identity.' : 'Your projects appear here as the fleet discovers them.'}</p>{query ? <button type="button" onClick={() => setQuery('')}>Clear search</button> : null}</div>}
    </div>{focus ? <aside className="atlas-dossier" style={accentOf(focus)} aria-label={`About ${focus.name}`}><div className="atlas-dossier-content"><div className="atlas-dossier-index">SECTOR {String(focus.slot).padStart(2, '0')}<span>{focus.identity.label}</span></div><div className="atlas-hero"><div className="atlas-reticle" /><PlanetEmblem genome={focus.genome} /></div><span className="atlas-class">{PLANET_CLASS[focus.genome.archetype]}</span><h3>{focus.name}</h3><p className="atlas-description">{focus.description}</p><div className="atlas-telemetry"><div><b>{focus.sessions}</b><span>open chats</span></div><div><b>{focus.tenders}</b><span>subagents</span></div><div><b>{focus.working}</b><span>working</span></div><div><b>{focus.attention}</b><span>attention</span></div></div><div className="atlas-clients">{SESSION_CLIENTS.filter((c) => focus.clients[c]).map((c) => <span key={c} data-client={c}>{CLIENT_NAME[c]} <b>{focus.clients[c]}</b></span>)}{!focus.sessions ? <span>No open chats</span> : null}</div><dl className="atlas-world-facts"><div><dt>Atmosphere</dt><dd>{focus.genome.atmosphere.density > .5 ? 'Dense' : focus.genome.atmosphere.density > .1 ? 'Thin' : 'Trace'}</dd></div><div><dt>Surface water</dt><dd>{['gas','ice-giant','shrouded'].includes(focus.genome.archetype) ? 'Cloud deck' : `${Math.round(focus.genome.oceans.coverage * 100)}%`}</dd></div><div><dt>Worktree moons</dt><dd>{focus.moons}</dd></div><div><dt>History lights</dt><dd>{focus.landed}</dd></div></dl></div><button type="button" data-observatory="surface" className="atlas-surface-enter" onClick={() => explore(focus.id)}>Open surface &amp; chat <span>↗</span></button><button type="button" data-observatory="enter" className="atlas-enter" onClick={enter}>Enter orbit <span>↗</span></button><small className="atlas-legend">Explore its landscape. Start an agent. Make something new.</small></aside> : null}</div>
    <footer className="atlas-footer"><span>YOUR LOCAL UNIVERSE</span><span>Select a world · chart its surface · start a conversation</span></footer>
  </div>;
}
