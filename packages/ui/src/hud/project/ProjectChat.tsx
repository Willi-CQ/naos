import { useEffect, useMemo, useRef, useState } from 'react';
import { CLIENT_NAME, type AgentProvider, type NativeClient, type ProjectSkill, type SessionClient, type SkillInstructions, type SpawnSpec, type TextRow } from '@naos/protocol';
import type { AtlasWorld } from '../../core/observatory.ts';
import { chatCommandQuery, literalChatMessage } from '../../core/chatCommands.ts';
import { projectPrompt, visibleProjectPrompt } from '../../core/chatContext.ts';
import { command } from '../../store/commands.ts';
import { runAction } from '../../store/registry.ts';
import { attend, onCraftText, onFleetEvents, useNaos, useView } from '../../store/store.ts';
import { StopButton } from '../sheets/stop.tsx';
import { openCraftAction } from '../sheets/CraftActions.tsx';
import { ChatComposer } from './ChatComposer.tsx';
import { MessageBody } from './MessageBody.tsx';

interface PendingMessage { id: string; text: string; at: number }
interface Conversation { draft: string; pending: PendingMessage[]; selectedSkill: SkillInstructions | null }
// Drafts live only in this window's memory. Transcripts remain owned by the kernel.
const conversations = new Map<string, Conversation>();
const lastConversation = new Map<string, string | null>();
const drafts = (key: string): Conversation => {
  if (!conversations.has(key)) conversations.set(key, { draft: '', pending: [], selectedSkill: null });
  return conversations.get(key)!;
};
const TERMINAL = new Set(['closed', 'exited', 'crashed', 'lost', 'stopping']);
const initialConversation = (worldId: string): string | null => {
  if (lastConversation.has(worldId)) return lastConversation.get(worldId) ?? null;
  const state = useNaos.getState();
  return Object.values(state.model.crafts)
    .filter((craft) => craft.worldId === worldId && craft.kind === 'main' && craft.visible && craft.owned && craft.sessionId)
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    .map((craft) => craft.agentId ?? craft.id)[0] ?? null;
};

function CopyMessage({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1400); }
    catch { setCopied(false); }
  };
  return <button type="button" className="message-copy" aria-label="Copy assistant response" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy'}</button>;
}

export function ProjectChat({ world, region, enabled = true, expanded = false, onToggleExpand, onClearContext, onSessionChange, request }: { world: AtlasWorld; region: string | null; enabled?: boolean; expanded?: boolean; onToggleExpand?(): void; onClearContext?(): void; onSessionChange?(nodeId: string | null): void; request?: { id: string | null; at: number; worldId: string } }) {
  const crafts = useNaos((s) => s.model.crafts), managed = useNaos((s) => s.fleet.managed);
  const linked = useNaos((s) => s.link.status === 'up'), clientId = useNaos((s) => s.link.clientId);
  const veil = useView((v) => v.settings.veil);
  const [selection, setSelection] = useState<string | null>(() => initialConversation(world.id));
  const [mode, setMode] = useState('work');
  const [provider, setProvider] = useState<SessionClient>('codex'), [model, setModel] = useState('');
  const [providers, setProviders] = useState<AgentProvider[]>([]), [providerLoading, setProviderLoading] = useState(false), [providerRefresh, refreshProvider] = useState(0);
  const [skills, setSkills] = useState<ProjectSkill[]>([]), [skillLoading, setSkillLoading] = useState(false);
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState<string | null>(null);
  const [rows, setRows] = useState<TextRow[]>([]), [live, setLive] = useState(''), [loaded, setLoaded] = useState(false), [available, setAvailable] = useState(true);
  const [transcriptKey, setTranscriptKey] = useState('');
  const [revision, revise] = useState(0), [retry, setRetry] = useState(0);
  const list = useRef<HTMLDivElement>(null), nearBottom = useRef(true);
  const sending = useRef(false), attempt = useRef({ body: '', key: crypto.randomUUID() });
  const sessions = useMemo(() => Object.values(crafts).filter((c) => c.worldId === world.id && c.kind === 'main' && c.visible !== false).sort((a, b) => Number(b.owned) - Number(a.owned) || b.lastActiveAt - a.lastActiveAt), [crafts, world.id]);
  const agent = selection ? managed[selection] : undefined;
  const craft = selection ? sessions.find((c) => c.agentId === selection || c.id === selection) : undefined;
  const client: SessionClient = selection ? agent?.client ?? craft?.client ?? 'claude-code' : provider;
  const native = client !== 'claude-code', providerInfo = provider === 'claude-code' ? undefined : providers.find((p) => p.client === provider);
  const clientName = CLIENT_NAME[client];
  const nodeId = agent?.nodeId ?? craft?.id;
  const key = `${world.id}:${selection ?? 'new'}`, conversation = drafts(key);
  const writable = selection === null || !!agent && !TERMINAL.has(agent.state) && agent.state !== 'rate_limited';
  const textCapable = !!agent || craft?.capabilities.includes('text');
  const allDecisions = useNaos((s) => s.model.decisions);
  const decisions = allDecisions.filter((d) => d.nodeId === nodeId && d.status === 'open');

  useEffect(() => {
    if (!enabled || !linked || selection !== null) return;
    if (provider === 'claude-code') { setProviderLoading(false); return; }
    let active = true; setProviderLoading(true);
    void command('agent.providers', { inspect: provider }).then((res) => {
      if (!active) return;
      setProviderLoading(false);
      if (res.ok) setProviders(res.result); else setFailure(res.error.message === 'unknown command' ? 'Restart the local NAOS kernel to load Codex and Cursor support.' : res.error.message);
    });
    return () => { active = false; };
  }, [provider, linked, selection, providerRefresh, enabled]);

  useEffect(() => {
    if (!enabled || !linked || veil) { setSkills([]); return; }
    let active = true;
    void command('world.skills', { worldId: world.id }).then((res) => {
      if (!active) return;
      if (res.ok) setSkills(res.result.skills); else setSkills([]);
    });
    return () => { active = false; };
  }, [world.id, linked, veil, enabled]);

  useEffect(() => {
    setRows([]); setLive(''); setLoaded(false); setAvailable(true); setFailure(null); setTranscriptKey(key); nearBottom.current = true;
    if (!enabled || !nodeId || nodeId.startsWith('pending:') || veil || !linked || !textCapable) return;
    let active = true, polling = false, stream = '', streamVersion = 0;
    let completed: { id: string; chars: number } | null = null;
    const unlisten = onCraftText((id, delta) => {
      if (id !== nodeId || !active) return;
      const joined = stream + delta, dropped = Math.max(0, joined.length - 24000);
      stream = joined.slice(-24000);
      if (completed) completed.chars = Math.max(0, completed.chars - dropped);
      streamVersion += 1; setLive(stream);
    });
    const unevent = onFleetEvents((events) => {
      for (const e of events) if (e.type === 'message.completed' && e.nodeId === nodeId) completed = { id: e.messageId, chars: stream.length };
    });
    if (clientId) void command('craft.watchText', { nodeId, on: true, clientId });
    const poll = async () => {
      if (polling || !active || document.visibilityState === 'hidden') return;
      polling = true;
      const version = streamVersion;
      const res = await command('craft.text', { nodeId, limit: 120 });
      polling = false;
      if (!active) return;
      setLoaded(true);
      if (!res.ok) { setFailure(res.error.message); return; }
      setFailure(null); setAvailable(res.result.available);
      const last = res.result.rows.at(-1);
      // Retire the completed prefix, preserving tokens from the next message, including after a tool call.
      if (completed && res.result.rows.some((r) => r.messageId === completed!.id)) {
        stream = stream.slice(completed.chars); completed = null; setLive(stream);
      } else if (stream && last?.role === 'assistant' && last.text.includes(stream) && version === streamVersion) { stream = ''; setLive(''); }
      setRows(res.result.rows);
      const local = drafts(key);
      // A queued send can take a while to reach disk. Keep its bubble until that exact turn is present.
      const recorded = res.result.rows.filter((r) => r.role === 'user');
      local.pending = local.pending.filter((p) => !recorded.some((r) => r.messageId === p.id || p.id.startsWith('local:') && r.text.trim() === p.text.trim() && Math.abs(r.at - p.at) < 120000));
      revise((n) => n + 1);
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 1200);
    return () => {
      active = false; clearInterval(timer); unlisten(); unevent();
      const channel = useNaos.getState().channel;
      if (clientId && !(channel.nodeId === nodeId && channel.textOn)) void command('craft.watchText', { nodeId, on: false, clientId });
    };
  }, [nodeId, key, clientId, veil, linked, textCapable, retry, enabled]);

  useEffect(() => { if (nearBottom.current) list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'instant' }); }, [rows, live, revision]);

  const choose = (id: string | null) => { if (sending.current) return; lastConversation.set(world.id, id); setSelection(id); setFailure(null); revise((n) => n + 1); };
  useEffect(() => { onSessionChange?.(nodeId ?? null); }, [nodeId, onSessionChange]);
  useEffect(() => { if (request?.worldId === world.id) choose(request.id); }, [request, world.id]);
  const send = async () => {
    if (chatCommandQuery(conversation.draft)) return;
    const text = literalChatMessage(conversation.draft);
    if (!text || sending.current || !linked || veil || !writable || selection === null && provider !== 'claude-code' && (providerLoading || !providerInfo?.installed || providerInfo.authenticated === false)) return;
    sending.current = true; setBusy(true); setFailure(null);
    const skill = conversation.selectedSkill;
    const body = projectPrompt(world.name, region, text, skill);
    const requestBody = JSON.stringify([world.id, body, provider, model, mode]);
    if (attempt.current.body !== requestBody) attempt.current = { body: requestBody, key: crypto.randomUUID() };
    let target = key;
    let messageId = `local:${crypto.randomUUID()}`;
    try {
      if (agent) {
        const res = await command('agent.send', { agentId: agent.agentId, text: body, priority: 'queue' });
        if (!res.ok) { setFailure(res.error.message); return; }
        messageId = res.result.sendId;
      } else {
        const profile = provider === 'claude-code' ? mode === 'plan' ? 'plan' : mode === 'read' ? 'analyst' : 'build' : provider;
        const spec: SpawnSpec = { worldId: world.id, client: provider, profile, prompt: body, title: text.split('\n')[0]!.slice(0, 48), worktree: false, idempotencyKey: attempt.current.key };
        if (model) spec.model = model;
        if (mode === 'plan') spec.mode = 'plan-first';
        if (mode === 'read') spec.mode = 'read-only';
        const check = await command('preflight', { spec });
        if (!check.ok) { setFailure(check.error.message); return; }
        if (check.result.blocked) { setFailure(check.result.blocked); return; }
        const res = await command('agent.spawn', { spec });
        if (!res.ok) { setFailure(res.error.message); return; }
        const id = res.result.agentIds[0];
        if (!id) { setFailure('The kernel did not return an agent. Try again.'); return; }
        target = `${world.id}:${id}`;
        lastConversation.set(world.id, id);
        setSelection(id);
      }
      drafts(target).pending.push({ id: messageId, text: body, at: Date.now() });
      conversation.draft = ''; conversation.selectedSkill = null; attempt.current = { body: '', key: crypto.randomUUID() };
      nearBottom.current = true; revise((n) => n + 1);
    } finally { sending.current = false; setBusy(false); }
  };
  const messages: TextRow[] = [...(transcriptKey === key ? rows : []), ...conversation.pending.map((p) => ({ messageId: p.id, role: 'user' as const, text: p.text, at: p.at, truncated: false }))].sort((a, b) => a.at - b.at);
  const context = region && region !== '.' ? region : null;
  const providerProblem = selection === null && providerInfo && (!providerInfo.installed || providerInfo.authenticated === false || providerInfo.message);
  const sessionOptions = sessions.map(c => ({ id: c.agentId ?? c.id, label: c.title || c.name }));
  if (agent && !craft) sessionOptions.push({ id: agent.agentId, label: veil ? 'Managed conversation' : agent.title });
  const ready = selection !== null || provider === 'claude-code' || !providerLoading && !!providerInfo?.installed && providerInfo.authenticated !== false;
  const chooseSkill = async (item: ProjectSkill) => {
    if (item.requiresTrust || item.client !== 'shared' && item.client !== provider) return;
    setSkillLoading(true); setFailure(null);
    const result = await command('world.skill.read', { worldId: world.id, skillId: item.id });
    setSkillLoading(false);
    if (!result.ok) { setFailure(result.error.message); return; }
    conversation.selectedSkill = result.result; revise((n) => n + 1);
  };
  const compatibleSkills = skills.filter((item) => item.client === 'shared' || item.client === provider);
  return <section className="project-chat quiet-chat" aria-label="Project agent chat" data-provider-ready={selection !== null || provider === 'claude-code' || !providerLoading && !!providerInfo}>
    <header className="project-chat-head"><div className="project-session-picker"><span className="chat-status-dot" data-active={!!agent && !TERMINAL.has(agent.state)}/><select aria-label="Project conversation" value={selection ?? ''} disabled={busy} onChange={e => choose(e.target.value || null)}><option value="">New conversation</option>{sessionOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></div><div className="chat-workspace-context" aria-label="Project context">{veil ? <span>Context veiled</span> : <><span>WORKSPACE</span><strong>{world.name}</strong><i>/</i><span>{context ?? 'project root'}</span></>}</div><div className="project-chat-head-actions">{onToggleExpand ? <button type="button" className="project-focus-chat" aria-label={expanded ? 'Show agent telemetry' : 'Focus conversation'} aria-pressed={expanded} title={expanded ? 'Show telemetry /focus' : 'Focus chat /focus'} onClick={onToggleExpand}>{expanded ? '◫' : '↔'}</button> : null}<button type="button" className="project-icon-btn" aria-label="New project chat" title="New conversation /new" disabled={busy} onClick={() => choose(null)}>＋</button></div></header>
    {decisions.length ? <button type="button" className="project-approval" onClick={() => attend(decisions[0]!.requestId)}><span>◇ Your decision is needed</span><span>Review →</span></button> : null}
    <div ref={list} className="project-messages" role="log" aria-label="Conversation messages" aria-live="polite" aria-relevant="additions" onScroll={() => { const el = list.current; if (el) nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90; }}>
      {veil ? <div className="project-chat-empty"><h4>Privacy veil is on.</h4><p>Messages and project paths stay hidden.</p></div> : selection === null ? <div className="project-chat-empty"><span className="quiet-empty-symbol">✧</span><h4>A little space to think.</h4><p>Write a message. Type <kbd>/</kbd> for options.</p></div> : !textCapable && !craft ? <p className="project-chat-note">Connecting to your new agent…</p> : !textCapable ? <div className="project-chat-empty"><h4>{craft ? CLIENT_NAME[craft.client] : 'External'} signal</h4><p>This client shares activity only.</p><button type="button" className="project-secondary" onClick={() => choose(null)}>Start a new conversation ↗</button></div> : <>
        {!loaded && !messages.length ? <p className="project-chat-note">Opening the channel…</p> : null}
        {loaded && !available ? <p className="project-chat-note">The transcript is not available yet. It will appear as the session starts.</p> : null}
        {loaded && available && !messages.length ? <div className="project-chat-empty"><h4>The conversation is open.</h4><p>Pick up where you left off.</p></div> : null}
        {messages.map(r => { const visible = r.role === 'user' ? visibleProjectPrompt(r.text) : { context: null, text: r.text }; return <article key={r.messageId} className="project-message" data-role={r.role}><div className="project-message-top"><div className="project-message-label">{r.role === 'user' ? 'YOU' : clientName.toUpperCase()}<span>{new Date(r.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>{r.role === 'assistant' ? <CopyMessage text={r.text}/> : null}</div>{visible.context ? <div className="message-context"><span>⌖ {visible.context.project}</span><span>{visible.context.focus === '.' ? 'Project root' : visible.context.focus}</span>{visible.context.skill ? <span>✳ {visible.context.skill.name}</span> : null}</div> : null}<MessageBody text={visible.text}/>{r.truncated ? <small>Earlier text shortened by the transcript reader.</small> : null}</article>; })}
        {live && transcriptKey === key ? <article className="project-message" data-role="assistant" data-streaming="true"><div className="project-message-top"><div className="project-message-label">{clientName.toUpperCase()} <span className="chat-live-label">LIVE</span></div></div><MessageBody text={live}/><i className="chat-caret"/></article> : null}
      </>}
    </div>
    {providerProblem ? <div className="project-provider-picker quiet-provider-notice"><p role="status">{providerInfo.message ?? 'Sign in to the provider’s local CLI to start a conversation.'}</p>{!providerInfo.installed ? <a href={provider === 'codex' ? 'https://learn.chatgpt.com/docs/cli' : 'https://cursor.com/docs/cli/installation'} target="_blank" rel="noreferrer">CLI setup ↗</a> : null}{providerInfo.authenticated === false ? <button type="button" className="provider-login-copy" disabled={veil} onClick={() => void navigator.clipboard?.writeText(providerInfo.loginCommand).catch(() => setFailure('Could not copy the sign-in command.'))}>Copy sign-in command</button> : null}<button type="button" className="provider-recheck" aria-label="Recheck agent provider" disabled={providerLoading || veil} onClick={() => refreshProvider(n => n + 1)}>↻</button></div> : null}
    {agent ? <div className="project-agent-state"><span><i data-state={agent.state}/>{agent.state.replaceAll('_', ' ')}{agent.queuedSends ? ' · ' + agent.queuedSends + ' queued' : ''}{agent.instructionFilesLoaded !== null && agent.instructionFilesLoaded !== undefined ? <small className="chat-instructions">{agent.instructionFilesLoaded} Codex instruction {agent.instructionFilesLoaded === 1 ? 'file' : 'files'} loaded</small> : null}</span><span>{native ? clientName + ' account limits' : '$' + agent.spentUsd.toFixed(2) + ' / $' + agent.budgetUsd.toFixed(2)}{craft && !native ? <button type="button" aria-label="Increase agent budget" title="Increase agent budget" disabled={!linked || veil} onClick={() => openCraftAction('addBudget', craft.id)}>＋</button> : null}{craft && !TERMINAL.has(agent.state) ? <StopButton craft={craft}/> : null}</span></div> : null}
    {!writable && selection ? <div className="project-chat-readonly"><p>{agent?.state === 'rate_limited' ? 'Provider usage limit reached. Resume after its reset.' : agent ? 'This agent has ended.' : 'This conversation is observed from another client.'}</p><button type="button" className="project-secondary" onClick={() => choose(null)}>New conversation ↗</button>{agent?.resumable ? <button type="button" className="project-secondary" disabled={!linked || busy || veil} onClick={async () => { const res = await command('agent.resume', { agentId: agent.agentId }); if (!res.ok) setFailure(res.error.message); else setRetry(n => n + 1); }}>Resume agent</button> : null}</div> : <ChatComposer key={key} draft={veil ? '' : conversation.draft} change={value => { conversation.draft = value; revise(n => n + 1); }} send={() => void send()} disabled={!linked || veil || busy} ready={ready} busy={busy} active={enabled && !veil} selection={selection} provider={provider} model={model} mode={mode} providerInfo={providerInfo} providerLoading={providerLoading} setProvider={value => { if (provider !== value) { setProvider(value); setModel(''); conversation.selectedSkill = null; revise(n => n + 1); } }} setModel={setModel} setMode={setMode} context={veil ? null : context} clearContext={() => onClearContext?.()} sessions={sessionOptions} chooseSession={choose} newChat={() => choose(null)} focused={expanded} toggleFocus={onToggleExpand} stop={craft?.owned && agent && !TERMINAL.has(agent.state) ? () => runAction('stop', craft.id) : undefined} skills={compatibleSkills} selectedSkill={veil ? null : conversation.selectedSkill} skillLoading={skillLoading} selectSkill={item => void chooseSkill(item)} clearSkill={() => { conversation.selectedSkill = null; revise(n => n + 1); }}/>} 
    {failure ? <div className="project-chat-error" role="alert">{failure}<button type="button" onClick={() => { if (selection === null) void send(); else { setFailure(null); setRetry(n => n + 1); } }}>Try again</button></div> : null}
  </section>;
}
