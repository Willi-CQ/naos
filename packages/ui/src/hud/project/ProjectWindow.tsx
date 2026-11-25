import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { ProjectSurvey } from '@naos/protocol';
import { atlasWorlds } from '../../core/observatory.ts';
import { command } from '../../store/commands.ts';
import { closeOverlay, flyToSlot, openOverlay, setSetting, useNaos, useView } from '../../store/store.ts';
import { useDialogFocus } from '../focus.ts';
import { ProjectChat } from './ProjectChat.tsx';
import type { MapStyle } from './ProjectMap.tsx';
import { ProjectSurface } from './ProjectSurface.tsx';
import { GraphWidget } from './GraphWidget.tsx';
import { AgentObservatory } from './AgentObservatory.tsx';

const surveys = new Map<string, ProjectSurvey>();
type Widget = 'brain' | 'structure';

export function ProjectWindow({ arg, overlayId = 'project' }: { arg: unknown; overlayId?: string }) {
  const model = useNaos(s => s.model), facts = useNaos(s => s.fleet.worlds);
  const worlds = useMemo(() => atlasWorlds(model.allWorlds, model.crafts, facts), [model.allWorlds, model.crafts, facts]);
  const [worldId, setWorldId] = useState(typeof arg === 'string' ? arg : worlds[0]?.id);
  const world = worlds.find(w => w.id === worldId);
  const [survey, setSurvey] = useState<{ worldId: string; data: ProjectSurvey } | null>(null);
  const [failure, setFailure] = useState<{ worldId: string; message: string } | null>(null);
  const [selection, setSelection] = useState<{ worldId: string; path: string } | null>(null);
  const [reload, setReload] = useState(0), [tab, setTab] = useState(overlayId === 'launch' ? 'chat' : 'map');
  const [style, setStyle] = useState<MapStyle>('landscape'), [filter, setFilter] = useState('all');
  const [lens, setLens] = useState<{ worldId: string; kind: Widget } | null>(null), [expanded, expand] = useState(false);
  const [maximized, setMaximized] = useState(false), [chatFocused, focusChat] = useState(false);
  const [active, setActive] = useState<string | null>(null), [request, setRequest] = useState<{ id: string | null; at: number; worldId: string }>();
  const veil = useView(v => v.settings.veil), linked = useNaos(s => s.link.status === 'up');
  const ref = useRef<HTMLDivElement>(null), widgetRef = useRef<HTMLElement>(null), widgetTrigger = useRef<HTMLElement | null>(null);
  const selected = selection && selection.worldId === worldId ? selection.path : null;
  const widget = lens && lens.worldId === worldId ? lens.kind : null;
  useDialogFocus(ref);
  const onSessionChange = useCallback((id: string | null) => setActive(id), []);
  const choose = (path: string | null) => setSelection(worldId && path !== null ? { worldId, path } : null);
  const openChat = (id: string) => { if (worldId) setRequest({ id, at: Date.now(), worldId }); setTab('chat'); };
  const closeWidget = () => { setLens(null); expand(false); widgetTrigger.current?.focus(); };
  const showWidget = (kind: Widget) => {
    widgetTrigger.current = document.activeElement as HTMLElement;
    const map = ref.current?.querySelector('.project-map-stage');
    if (map) map.scrollTop = 0;
    if (worldId) setLens({ worldId, kind });
    expand(false);
  };
  const discuss = (path?: string) => { if (path) choose(path); setTab('chat'); requestAnimationFrame(() => ref.current?.querySelector<HTMLTextAreaElement>('[aria-label="Message project agent"]')?.focus()); };
  useEffect(() => { if (widget) widgetRef.current?.focus(); }, [widget]);
  useEffect(() => { setLens(null); setFilter('all'); setActive(null); setRequest(undefined); }, [worldId, veil]);
  useEffect(() => {
    setSelection(null); setFailure(null);
    if (!worldId || veil || !linked) return;
    const cached = surveys.get(worldId);
    if (cached && reload === 0) { setSurvey({ worldId, data: cached }); return; }
    let current = true;
    void command('world.survey', { worldId }).then(res => {
      if (!current) return;
      if (res.ok) { surveys.set(worldId, res.result); setSurvey({ worldId, data: res.result }); }
      else setFailure({ worldId, message: res.error.message === 'unknown command' ? 'The running local kernel predates project maps. Restart NAOS to load the new commands.' : res.error.message });
    });
    return () => { current = false; };
  }, [worldId, veil, linked, reload]);
  if (!world) return <div ref={ref} className="project-window" role="dialog" aria-modal="true" aria-label="Project surface"><div className="atlas-empty"><h3>This world is no longer in the atlas.</h3><button type="button" onClick={() => closeOverlay(overlayId)}>Return to the universe</button></div></div>;
  const visibleSurvey = !veil && survey?.worldId === world.id ? survey.data : null;
  const back = () => { closeOverlay(overlayId); openOverlay('observatory'); };
  return <div ref={ref} className="project-window expedition-window" data-maximized={maximized} role="dialog" aria-modal="true" aria-label={`Project surface: ${world.name}`} style={{ '--atlas-accent': world.identity.accent } as CSSProperties}>
    <header className="project-window-head"><div className="project-breadcrumb"><button type="button" data-autofocus onClick={back}>← Atlas</button><span>/</span><select aria-label="Explore project" value={world.id} onChange={e => { setWorldId(e.target.value); setReload(0); }}>{worlds.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div>
      <nav className="project-view-tabs" aria-label="Project workspace view"><button type="button" aria-pressed={tab === 'map'} data-view="map" onClick={() => setTab('map')}><span>⌖</span> Project surface</button><button type="button" aria-pressed={tab === 'chat'} data-view="chat" onClick={() => setTab('chat')}><span>◈</span> Agents <small>{world.working || ''}</small></button></nav>
      <div className="project-window-actions"><span className="project-live"><i />{linked ? 'LOCAL LINK' : 'OFFLINE'}</span><button type="button" className="project-privacy-btn" aria-label="Privacy veil" aria-pressed={veil} title="Hide project paths and messages" onClick={() => setSetting('veil', !veil)}>◈</button><button type="button" className="project-orbit-btn" onClick={() => { closeOverlay(overlayId); flyToSlot(world.slot); }}>Orbit ↗</button><button type="button" className="project-icon-btn" aria-label={maximized ? 'Restore project window' : 'Maximize project window'} aria-pressed={maximized} title={maximized ? 'Restore window size' : 'Use the full window'} onClick={() => setMaximized(!maximized)}>{maximized ? '⤡' : '⤢'}</button><button type="button" className="project-icon-btn" aria-label="Close project surface" onClick={() => closeOverlay(overlayId)}>×</button></div></header>
    <div className="project-workspace expedition-workspace" data-tab={tab}>
      <section className="project-map-stage" hidden={tab !== 'map'} aria-label="Interactive project map">
        <ProjectSurface key={world.id} world={world} survey={visibleSurvey} failure={failure?.worldId === world.id ? failure.message : null} veil={veil} linked={linked} selected={veil ? null : selected} choose={choose} style={style} setStyle={setStyle} filter={filter} setFilter={setFilter} showWidget={showWidget} discuss={discuss} openChat={openChat} resurvey={() => setReload(n => n + 1)}/>
        {widget && !veil ? <section ref={widgetRef} tabIndex={-1} className="project-map-widget" data-expanded={expanded} role="region" aria-label={widget === 'brain' ? 'Brain widget' : 'Structure widget'} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeWidget(); } }}><header><div><span>{widget === 'brain' ? '⌘' : '◇'}</span><div><small>{world.name} / PROJECT KNOWLEDGE</small><h3>{widget === 'brain' ? 'The connected mind' : 'Project anatomy'}</h3></div></div><div><button type="button" aria-label={expanded ? 'Restore widget size' : 'Expand widget'} onClick={() => expand(!expanded)}>⤢</button><button type="button" aria-label="Close map widget" onClick={closeWidget}>×</button></div></header><GraphWidget key={`${world.id}:${widget}`} worldId={world.id} survey={visibleSurvey} kind={widget} useContext={path => { setLens(null); discuss(path); }}/></section> : null}
      </section>
      <div className="project-agent-stage" data-focused={chatFocused} hidden={tab !== 'chat'}><div className="project-chat-center"><ProjectChat key={world.id} world={world} region={veil ? null : selected} enabled={tab === 'chat'} expanded={chatFocused} onToggleExpand={() => focusChat(!chatFocused)} onClearContext={() => choose(null)} onSessionChange={onSessionChange} request={request}/></div>{tab === 'chat' ? <div className="project-telemetry-region" hidden={chatFocused}><AgentObservatory key={world.id} worldId={world.id} active={active} openChat={openChat} enabled={!chatFocused}/></div> : null}</div>
    </div>
  </div>;
}
