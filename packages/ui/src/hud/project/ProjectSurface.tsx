import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ProjectSurvey } from '@naos/protocol';
import { REGION_COLOR, REGION_TITLE } from '../../core/cartography.ts';
import { PLANET_CLASS, type AtlasWorld } from '../../core/observatory.ts';
import { useNaos } from '../../store/store.ts';
import { PlanetEmblem } from '../PlanetEmblem.tsx';
import { ProjectMap, type MapStyle } from './ProjectMap.tsx';

type IconName = 'brain' | 'structure' | 'chat' | 'folder' | 'arrow' | 'search' | 'refresh' | 'copy';
function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, string> = {
    brain: 'M9 4a3 3 0 0 0-5 3 4 4 0 0 0-1 7 3 3 0 0 0 5 5h1V4Zm6 0a3 3 0 0 1 5 3 4 4 0 0 1 1 7 3 3 0 0 1-5 5h-1V4ZM5 9h4m6 5h4M9 17H6m9-9h3',
    structure: 'M9 3h6v5H9Zm-6 13h6v5H3Zm12 0h6v5h-6ZM12 8v4M6 16v-4h12v4',
    chat: 'M4 4h16v12H9l-5 4V4Zm4 5h8m-8 3h5',
    folder: 'M3 6h7l2 3h9v11H3V6Z',
    arrow: 'M5 12h14m-6-6 6 6-6 6',
    search: 'M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
    refresh: 'M20 7v5h-5M4 17v-5h5M5.5 7a7 7 0 0 1 12-2L20 8M4 16l2.5 3a7 7 0 0 0 12-2',
    copy: 'M8 8h12v13H8V8ZM16 8V3H3v13h5',
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}

export function ProjectSurface({ world, survey, failure, veil, linked, selected, choose, style, setStyle, filter, setFilter, showWidget, discuss, openChat, resurvey }: {
  world: AtlasWorld; survey: ProjectSurvey | null; failure: string | null; veil: boolean; linked: boolean;
  selected: string | null; choose(path: string | null): void; style: MapStyle; setStyle(style: MapStyle): void;
  filter: string; setFilter(filter: string): void; showWidget(kind: 'brain' | 'structure'): void;
  discuss(path?: string): void; openChat(id: string): void; resurvey(): void;
}) {
  const [search, setSearch] = useState(''), [copied, setCopied] = useState('');
  const explorer = useRef<HTMLInputElement>(null);
  const crafts = useNaos(s => s.model.crafts);
  const localAgents = Object.values(crafts).filter(c => c.worldId === world.id && c.live && c.visible !== false).sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  const region = survey?.regions.find(r => r.path === selected);
  const areas = survey?.regions.filter(r => (filter === 'all' || r.kind === filter) && `${r.name} ${r.path}`.toLowerCase().includes(search.toLowerCase().trim())) ?? [];
  const languageFiles = survey?.languages.reduce((sum, language) => sum + language.files, 0) ?? 0;
  useEffect(() => { setCopied(''); }, [selected]);
  const copyPath = async () => {
    if (veil || !selected) return;
    try { await navigator.clipboard.writeText(selected); setCopied('Path copied'); }
    catch { setCopied('Could not copy the path'); }
  };
  return <div className="planet-surface" data-project-scope={world.id}>
    <div className="surface-cartography">
      {survey?.regions.length ? <ProjectMap world={world} survey={survey} selected={selected} choose={choose} style={style} filter={filter}/> : <div className="project-map-state surface-map-state"><span>⌖</span><h3>{veil ? 'A private landscape.' : failure ? 'The map is waiting.' : survey ? 'An open frontier.' : linked ? 'Charting this project…' : 'Waiting for the local link.'}</h3><p>{veil ? 'Turn off the veil to explore this project.' : failure ?? (survey ? 'This project has no visible files yet. Open its agent workspace to start building.' : 'Discovering the folders that make this world yours.')}</p>{failure ? <button type="button" className="project-secondary" onClick={resurvey}>Try the survey again ↻</button> : null}</div>}
      <header className="surface-map-heading"><div className="surface-eyebrow"><span className="surface-scope-dot"/>ONE PROJECT. A WORLD OF POSSIBILITIES.</div><h2>{world.name}<span>.</span></h2><p>{veil ? 'Your private project surface.' : survey ? `${survey.regions.length} territories · ${survey.files.toLocaleString()} files · ${PLANET_CLASS[world.genome.archetype].toLowerCase()}` : 'A landscape shaped by your repository.'}</p></header>
      <div className="surface-map-toolbar"><div className="surface-layers" role="group" aria-label="Map representation">{([['landscape', 'Surface'], ['topography', 'Relief']] as const).map(([id, label]) => <button type="button" key={id} aria-pressed={style === id} onClick={() => setStyle(id)}>{label}</button>)}</div><button type="button" className="surface-locate" aria-label="Browse project territories" disabled={!survey} title="Find a project area" onClick={() => { explorer.current?.scrollIntoView({ block: 'nearest' }); explorer.current?.focus(); }}><Icon name="search"/></button></div>
      <div className="surface-map-caption"><span className="surface-caption-line"/><span>One territory, one project folder.<br/><small>Landscape is illustrative. File counts are real.</small></span></div>
      {selected && !veil ? <div className="surface-selected-place" aria-label="Selected project area"><div><span className="project-kicker">{region ? REGION_TITLE[region.kind] : 'PROJECT CONTEXT'}</span><strong>{selected}</strong><small>{region ? `${region.files.toLocaleString()} files · ready to explore` : 'Selected from this project’s knowledge'}</small></div><button type="button" aria-label="Discuss selected area" onClick={() => discuss(selected)}><Icon name="arrow"/></button><button type="button" className="surface-clear-selection" aria-label="Clear territory selection" title="Explore the whole project" onClick={() => choose(null)}>×</button></div> : null}
      <div className="surface-map-stamp" aria-hidden="true"><span>LOCAL SURFACE</span><b>{String(world.slot).padStart(2, '0')}</b></div>
    </div>
    <aside className="surface-project-panel" aria-label={`Project details: ${world.name}`}>
      <div className="surface-project-scroll">
        <section className="surface-project-identity"><div className="surface-project-planet"><PlanetEmblem genome={world.genome}/></div><div><span className="project-kicker">YOUR PROJECT / {world.identity.label.toUpperCase()}</span><h3>{world.name}</h3><p><span className="surface-scope-dot"/>{linked ? 'Local workspace' : 'Last observation'}{survey && !survey.complete ? ' · partial survey' : ''}</p></div></section>
        <div className="surface-project-stats" aria-label="Selected project statistics"><div><strong>{survey ? survey.files.toLocaleString() : '—'}</strong><span>files charted</span></div><div><strong>{survey?.regions.length ?? '—'}</strong><span>territories</span></div><div><strong>{veil ? '—' : localAgents.length}</strong><span>live agents</span></div></div>
        {failure && survey && !veil ? <p className="surface-survey-error" role="alert">The last survey is shown. {failure}</p> : null}
        <section className="surface-integrations" aria-label="Project integrations"><div className="surface-section-title"><h4>Make the connections</h4><span>PROJECT TOOLS</span></div><button type="button" aria-label="Open Brain widget" disabled={veil || !linked} onClick={() => showWidget('brain')}><span className="surface-tool-icon" data-tool="brain"><Icon name="brain"/></span><span><strong>Brain</strong><small>Ideas & connected knowledge</small></span><Icon name="arrow"/></button><button type="button" aria-label="Open structure widget" disabled={!survey} onClick={() => showWidget('structure')}><span className="surface-tool-icon" data-tool="structure"><Icon name="structure"/></span><span><strong>Architecture</strong><small>Folders, files & how they fit</small></span><Icon name="arrow"/></button></section>
        {survey?.languages.length ? <section className="surface-languages" aria-label="Project languages"><div className="surface-section-title"><h4>Built with</h4><span>{survey.languages.length} LANGUAGES</span></div><div className="surface-language-bar">{survey.languages.map((language, i) => <span key={language.name} title={`${language.name}: ${language.files} files`} style={{ flex: language.files, '--language-color': ['#86d6ce', '#c4b5db', '#dbbc84', '#a8c194', '#a1b7cc'][i % 5] } as CSSProperties}/>)}</div><div className="surface-language-legend">{survey.languages.slice(0, 4).map((language, i) => <span key={language.name}><i style={{ background: ['#86d6ce', '#c4b5db', '#dbbc84', '#a8c194'][i] }}/>{language.name}<small>{Math.round(language.files / Math.max(1, languageFiles) * 100)}%</small></span>)}</div></section> : null}
        <section className="surface-directory" aria-label="Project territories"><div className="surface-section-title"><h4>Explore the terrain</h4><span>{areas.length} AREAS</span></div><div className="surface-directory-search"><Icon name="search"/><input ref={explorer} aria-label="Search project territories" placeholder="Find a folder…" value={veil ? '' : search} disabled={!survey} onChange={e => setSearch(e.target.value)}/><select aria-label="Filter map territories" value={filter} disabled={!survey} onChange={e => setFilter(e.target.value)}><option value="all">All types</option>{Object.entries(REGION_TITLE).map(([kind, title]) => <option key={kind} value={kind}>{title}</option>)}</select></div><div className="surface-directory-list">{areas.map(area => <button type="button" key={area.path} className="surface-directory-entry" data-territory={area.path} aria-pressed={selected === area.path} onClick={() => choose(area.path)} style={{ '--territory-color': REGION_COLOR[area.kind] } as CSSProperties}><Icon name="folder"/><span><strong>{area.name}</strong><small>{area.path}</small></span><span>{area.files.toLocaleString()}</span></button>)}{!areas.length ? <p className="surface-directory-empty">{veil ? 'Project folders are veiled.' : survey ? 'No territories match this view.' : 'Your territories will appear here.'}{!veil && (search || filter !== 'all') ? <button type="button" onClick={() => { setSearch(''); setFilter('all'); }}>Show all territories</button> : null}</p> : null}</div></section>
        {selected && !veil ? <section className="surface-area-details" aria-label="Territory details"><div className="surface-section-title"><h4>Inside this territory</h4><button type="button" aria-label="Copy territory path" title="Copy relative path" onClick={() => void copyPath()}><Icon name="copy"/></button></div><code>{selected}</code>{region?.entries.slice(0, 4).map(file => <span key={file}><Icon name="folder"/>{file.split('/').at(-1)}</span>)}<span role="status" className="surface-copy-status">{copied}</span></section> : null}
        {!veil && localAgents.length ? <section className="surface-local-activity" aria-label="Agents in selected project"><div className="surface-section-title"><h4>In this workspace</h4><span>{localAgents.length} LIVE</span></div>{localAgents.filter(agent => agent.kind === 'main').slice(0, 3).map(agent => <button type="button" key={agent.id} data-local-agent={agent.id} onClick={() => openChat(agent.agentId ?? agent.id)}><i data-tone={agent.tone}/><span><strong>{agent.title || agent.name}</strong><small>{agent.word}</small></span><Icon name="arrow"/></button>)}</section> : null}
      </div>
      <footer className="surface-project-actions"><button type="button" className="surface-start-agent" aria-label="Switch to agent chat" disabled={veil || !linked} onClick={() => discuss(selected ?? undefined)}><Icon name="chat"/><span>{selected ? 'Work in this territory' : 'Open agent workspace'}<small>{selected ? 'Selected path travels with your message' : 'Codex & Cursor, connected to this project'}</small></span><Icon name="arrow"/></button><div><span>{survey ? survey.complete ? 'PROJECT SURVEY COMPLETE' : 'PARTIAL PROJECT SURVEY' : 'PROJECT SURVEY'}</span><button type="button" aria-label="Resurvey project" disabled={veil || !linked} onClick={resurvey}><Icon name="refresh"/>Refresh</button></div></footer>
    </aside>
  </div>;
}
