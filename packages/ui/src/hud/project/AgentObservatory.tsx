import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { CLIENT_NAME, type ChannelRow, type ProjectChanges, type ProjectDiff } from '@naos/protocol';
import { agentTree } from '../../core/agentTree.ts';
import { command } from '../../store/commands.ts';
import { useNaos, useView } from '../../store/store.ts';

const clock = (at: number): string => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const traceLabel = (row: ChannelRow): { title: string; detail: string; state: string; icon: string } => {
  if (row.kind === 'turn') return { title: 'Turn started', detail: row.origin.replaceAll('_', ' '), state: 'done', icon: '↗' };
  if (row.kind === 'thinking') return { title: 'Reasoning', detail: row.tokens ? `${row.tokens.toLocaleString()} tokens reported` : 'Thinking through the request', state: 'done', icon: '✧' };
  if (row.kind === 'text') return { title: 'Response', detail: row.tokens === null ? `${row.chars.toLocaleString()} characters` : `${row.tokens.toLocaleString()} tokens`, state: 'done', icon: '✳' };
  if (row.kind === 'tool') {
    const title = row.name;
    const detail = row.summary.target && ['read', 'edit'].includes(row.family) ? row.summary.target : row.summary.shape;
    const state = row.status === 'running' ? 'running' : row.isError || row.status === 'failed' ? 'failed' : 'done';
    return { title, detail, state, icon: row.family === 'edit' ? '⌁' : row.family === 'read' ? '⌕' : row.family === 'shell' ? '›' : '◇' };
  }
  if (row.kind === 'tender') return { title: row.agentType || 'Subagent', detail: row.status, state: /run|start/i.test(row.status) ? 'running' : /fail|error/i.test(row.status) ? 'failed' : 'done', icon: '⤷' };
  if (row.kind === 'error') return { title: 'Provider notice', detail: row.label, state: 'failed', icon: '!' };
  return { title: 'Working', detail: '', state: 'running', icon: '◌' };
};

export function AgentObservatory({ worldId, active, openChat, enabled = true }: { worldId: string; active: string | null; openChat(id: string): void; enabled?: boolean }) {
  const model = useNaos((s) => s.model), linked = useNaos((s) => s.link.status === 'up'), veil = useView((s) => s.settings.veil);
  const crafts = useMemo(() => Object.values(model.crafts).filter((c) => c.worldId === worldId), [model.crafts, worldId]);
  const tree = useMemo(() => agentTree(crafts), [crafts]);
  const [inspect, setInspect] = useState<string | null>(null), [section, setSection] = useState<'agents' | 'trace' | 'activity' | 'changes'>('agents');
  const [channel, setChannel] = useState<{ id: string; rows: ChannelRow[] } | null>(null), [failure, setFailure] = useState('');
  const [changes, setChanges] = useState<ProjectChanges | null>(null), [filePath, setFilePath] = useState<string | null>(null), [diff, setDiff] = useState<ProjectDiff | null>(null), [changesFailure, setChangesFailure] = useState('');
  const [copiedDiff, setCopiedDiff] = useState(false);
  const selected = crafts.find((c) => c.id === (inspect ?? active)) ?? crafts.find((c) => c.kind === 'main');
  useEffect(() => { setInspect(null); }, [active, worldId]);
  const selectedId = selected?.id;
  useEffect(() => {
    setChannel(null); setFailure('');
    if (!enabled || !selectedId || selectedId.startsWith('pending:') || veil || !linked) return;
    let current = true, busy = false;
    const poll = async () => { if (busy || !current || document.visibilityState === 'hidden') return; busy = true; const res = await command('craft.channel', { nodeId: selectedId, limit: 60 }); busy = false; if (!current) return; if (res.ok) { setChannel({ id: selectedId, rows: res.result.rows }); setFailure(''); } else setFailure(res.error.message); };
    void poll(); const timer = window.setInterval(() => void poll(), 1800);
    return () => { current = false; clearInterval(timer); };
  }, [selectedId, veil, linked, enabled]);
  useEffect(() => {
    setChanges(null); setFilePath(null); setDiff(null); setChangesFailure('');
    if (section !== 'changes' || !enabled || !linked || veil) return;
    let current = true, busy = false;
    const poll = async () => {
      if (busy || !current || document.visibilityState === 'hidden') return;
      busy = true;
      const res = await command('world.changes', { worldId });
      busy = false;
      if (!current) return;
      if (res.ok) {
        setChanges(res.result); setChangesFailure(res.result.message ?? '');
        setFilePath((previous) => previous && res.result.files.some((file) => file.path === previous) ? previous : res.result.files[0]?.path ?? null);
      } else setChangesFailure(res.error.message);
    };
    void poll(); const timer = window.setInterval(() => void poll(), 4500);
    return () => { current = false; clearInterval(timer); };
  }, [section, worldId, veil, linked, enabled]);
  useEffect(() => {
    setDiff(null);
    if (section !== 'changes' || !filePath || veil || !linked || !enabled) return;
    let current = true;
    void command('world.diff', { worldId, path: filePath }).then((res) => {
      if (!current) return;
      if (res.ok) { setDiff(res.result); setChangesFailure(''); } else setChangesFailure(res.error.message);
    });
    return () => { current = false; };
  }, [section, worldId, filePath, veil, linked, enabled]);
  const rows = channel && channel.id === selectedId && !veil ? channel.rows : [];
  const recent = model.tape.filter((e) => e.nodeId && crafts.some((c) => c.id === e.nodeId)).slice(0, 28);
  const live = crafts.filter((c) => c.live).length, children = crafts.filter((c) => c.kind !== 'main').length;
  const output = crafts.reduce((n, c) => n + c.outputTokens, 0), tps = crafts.reduce((n, c) => n + c.tps, 0);
  const hasTokens = crafts.some((c) => c.capabilities.includes('tokens'));
  return <aside className="agent-observatory" aria-label="Agent statistics and activity"><header><span className="project-kicker">MISSION TELEMETRY</span><h3>Every little move<span>.</span></h3><span className="telemetry-link"><i data-up={linked}/>{linked ? 'Local feed connected' : 'Feed disconnected'}</span></header>
    <div className="agent-stat-grid"><div><strong>{live}</strong><span>active agents</span></div><div><strong>{children}</strong><span>subagents</span></div><div><strong>{hasTokens ? output.toLocaleString() : '—'}</strong><span>{hasTokens ? 'reported output tokens' : 'tokens not reported'}</span></div><div><strong>{hasTokens ? Math.round(tps * 10) / 10 : '—'}{hasTokens ? <small> /s</small> : null}</strong><span>{hasTokens ? 'reported token rate' : 'rate not reported'}</span></div></div>
    <div className="agent-radar" aria-label="Observed agent connections"><svg viewBox={`0 0 300 ${Math.max(100, Math.min(200, tree.length * 24 + 30))}`} role="img" aria-label={`${crafts.length} observed agents, ${children} subagents`}><defs><pattern id="radar-grid" width="15" height="15" patternUnits="userSpaceOnUse"><circle cx="7" cy="7" r=".5" fill="#a7c8b2" opacity=".17"/></pattern></defs><rect width="300" height="300" fill="url(#radar-grid)"/>{tree.slice(0, 7).map((row, i, list) => { const x = 35 + Math.min(row.depth, 8) * 22, y = 23 + i * 24, parent = list.findIndex((r) => r.craft.id === row.parent); return <g key={row.craft.id}>{parent >= 0 ? <path className="radar-branch" d={`M${35 + Math.min(list[parent]!.depth, 8) * 22} ${23 + parent * 24}V${y}H${x}`}/> : null}<circle cx={x} cy={y} r="4" className="radar-dot" data-live={row.craft.live}/><text x={x + 12} y={y + 3}>{row.craft.name.slice(0, 29)}</text>{row.craft.live ? <circle cx={x} cy={y} r="8" className="radar-pulse"/> : null}</g>; })}{!tree.length ? <text x="150" y="55" textAnchor="middle">Awaiting the first signal</text> : null}</svg><span>OBSERVED CONNECTIONS{tree.length > 7 ? ` · +${tree.length - 7} IN TREE` : ''}</span></div>
    <nav className="telemetry-tabs" aria-label="Telemetry view">{(['agents', 'trace', 'changes', 'activity'] as const).map((id) => <button type="button" key={id} aria-pressed={section === id} onClick={() => setSection(id)}>{id === 'agents' ? 'Agent tree' : id === 'trace' ? 'Live trace' : id === 'changes' ? 'Changes' : 'Activity'}{id === 'agents' ? <small>{crafts.length}</small> : id === 'trace' ? <small>{rows.filter((row) => row.kind === 'tool').length}</small> : id === 'changes' ? <small>{veil ? '—' : changes?.files.length ?? '·'}</small> : null}</button>)}</nav>
    <div className="telemetry-scroll">{section === 'agents' ? <div className="agent-hierarchy" aria-label="Complete agent hierarchy">{tree.length ? tree.map(({ craft, depth, parent }) => <button type="button" key={craft.id} className="agent-tree-row" data-node={craft.id} data-depth={depth} aria-pressed={selectedId === craft.id} style={{ '--tree-depth': Math.min(depth, 8) } as CSSProperties} onClick={() => setInspect(craft.id)}><span className="agent-tree-branch">{parent ? '└' : '◇'}</span><i data-live={craft.live}/><span><strong>{craft.name}</strong><small>{depth ? `L${depth} · ` : ''}{CLIENT_NAME[craft.client]} · {craft.agentType || (depth ? 'subagent' : 'main agent')}</small></span><em>{craft.word}</em></button>) : <div className="telemetry-empty">Start an agent to see its work unfold here.</div>}</div> : section === 'trace' ? <section className="agent-timeline" role="log" aria-label="Selected agent live trace"><header><span className="project-kicker">{selected?.name ?? 'PROJECT RUN'}</span><span className="trace-live"><i data-live={!!selected?.live}/>{selected?.live ? 'LIVE' : linked ? 'CONNECTED' : 'OFFLINE'}</span></header>{rows.length ? rows.slice(-32).reverse().map((row, i) => { const event = traceLabel(row); return <article className="agent-trace-row" key={row.kind === 'tool' ? `${row.toolUseId}:${row.at}` : `${row.kind}:${row.at}:${i}`} data-state={event.state}><i>{event.icon}</i><div><strong>{event.title}</strong><span title={event.detail}>{veil ? row.kind === 'tool' ? row.summary.shape : 'Details are veiled' : event.detail}</span></div><time>{clock(row.at)}</time></article>; }) : <div className="telemetry-empty">{veil ? 'Agent activity is veiled.' : failure || (selected ? 'Waiting for this agent’s first trace.' : 'Choose an agent to follow its run.')}</div>}</section> : section === 'changes' ? <section className="change-review" aria-label="Project file changes">{veil ? <div className="telemetry-empty">Project files are veiled.</div> : !linked ? <div className="telemetry-empty">Connect to NAOS to inspect project changes.</div> : changes ? <>{!changes.available ? <div className="telemetry-empty">{changes.message || 'Git changes are unavailable.'}</div> : <><header className="change-review-head"><div><span className="project-kicker">{changes.branch || 'PROJECT CHANGES'}</span><strong>{changes.files.length} {changes.files.length === 1 ? 'file' : 'files'}</strong></div><span className="change-totals"><i>+{changes.additions}</i><b>?{changes.deletions}</b></span></header>{changes.files.length ? <><div className="change-file-list" role="listbox" aria-label="Changed project files">{changes.files.map((file) => <button type="button" role="option" aria-selected={file.path === filePath} key={file.path} onClick={() => setFilePath(file.path)}><i data-status={file.status}>{file.status === 'added' || file.status === 'untracked' ? '+' : file.status === 'deleted' ? '?' : file.status === 'renamed' ? '?' : file.status === 'conflicted' ? '!' : '?'}</i><span title={file.path}>{file.path}</span><small>{file.additions !== null ? '+' + file.additions : file.status}</small></button>)}</div><div className="change-diff"><header><span title={filePath || ''}>{filePath}</span><button type="button" disabled={!diff?.patch} onClick={async () => { if (!diff?.patch) return; try { if (!navigator.clipboard) throw new Error(); await navigator.clipboard.writeText(diff.patch); setCopiedDiff(true); window.setTimeout(() => setCopiedDiff(false), 1400); } catch { setChangesFailure("Could not copy this diff."); } }}>{copiedDiff ? "Copied" : "Copy diff"}</button></header>{changesFailure ? <p className="change-diff-note">{changesFailure}</p> : diff ? diff.binary ? <p className="change-diff-note">Binary file changed. Text preview is not available.</p> : <><pre aria-label={'Diff for ' + diff.path}><code>{diff.patch || 'No textual changes in this file.'}</code></pre>{diff.truncated ? <p className="change-diff-note">Preview limited to the first 48,000 characters.</p> : null}</> : <p className="change-diff-note">Loading file diff?</p>}</div></> : <div className="telemetry-empty">No changed files. Your project is clean.</div>}</>}</> : <div className="telemetry-empty">{changesFailure || 'Loading project changes?'}</div>}</section> : <div className="agent-activity" role="log" aria-label="Project agent activity">{recent.length ? recent.map((e) => <div key={e.id}><time>{e.time}</time><p><strong>{e.who}</strong><span>{e.what}{e.times > 1 ? ` ×${e.times}` : ''}</span></p></div>) : <div className="telemetry-empty">New actions will appear as they are reported.</div>}</div>}
    {selected ? <section className="agent-inspection" aria-label="Selected agent details"><div><span className="project-kicker">{selected.kind === 'main' ? 'MAIN AGENT' : 'SUBAGENT'} / {selected.word.toUpperCase()}</span><h4>{selected.title || selected.name}</h4><p>{selected.model || 'Model not reported'}{selected.effort ? ` · ${selected.effort}` : ''}</p></div>{selected.kind === 'main' ? <button type="button" className="agent-open-chat" onClick={() => openChat(selected.agentId ?? selected.id)}>Open conversation ↗</button> : null}<dl><div><dt>Context</dt><dd>{selected.contextFrac !== null ? `${Math.round(selected.contextFrac * 100)}% used` : 'Not reported'}</dd></div><div><dt>Output</dt><dd>{selected.capabilities.includes('tokens') ? `${selected.outputTokens.toLocaleString()} tokens` : 'Not reported'}</dd></div><div><dt>Pending</dt><dd>{selected.queued} messages</dd></div></dl>{selected.contextFrac !== null ? <div className="context-gauge"><i style={{ width: `${Math.max(0, Math.min(100, selected.contextFrac * 100))}%` }}/></div> : null}</section> : null}</div>
    <footer>Live data from the connected clients. Missing telemetry stays unreported.</footer>
  </aside>;
}
