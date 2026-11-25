import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { CLIENT_NAME, type AgentProvider, type NativeClient, type ProjectSkill, type SessionClient, type SkillInstructions } from '@naos/protocol';
import { chatCommandQuery, matchChatChoices } from '../../core/chatCommands.ts';

type Menu = 'commands' | 'provider' | 'model' | 'mode' | 'sessions' | 'skills';
interface Choice { id: string; label: string; description: string; disabled?: boolean; selected?: boolean; run(): void }

export function ChatComposer({ draft, change, send, disabled, ready, busy, active, selection, provider, model, mode, providerInfo, providerLoading, setProvider, setModel, setMode, context, clearContext, sessions, chooseSession, newChat, focused, toggleFocus, stop, skills, selectedSkill, skillLoading, selectSkill, clearSkill }: {
  draft: string; change(value: string): void; send(): void; disabled: boolean; ready: boolean; busy: boolean; active: boolean;
  selection: string | null; provider: SessionClient; model: string; mode: string; providerInfo?: AgentProvider; providerLoading: boolean;
  setProvider(provider: SessionClient): void; setModel(model: string): void; setMode(mode: string): void;
  context: string | null; clearContext(): void; sessions: Array<{ id: string; label: string }>; chooseSession(id: string | null): void; newChat(): void;
  focused: boolean; toggleFocus?(): void; stop?(): void;
  skills: ProjectSkill[]; selectedSkill: SkillInstructions | null; skillLoading: boolean; selectSkill(skill: ProjectSkill): void; clearSkill(): void;
}) {
  const input = useRef<HTMLTextAreaElement>(null), box = useRef<HTMLDivElement>(null);
  const id = useId().replaceAll(':', '');
  const [menu, setMenu] = useState<Menu | null>(null), [dismissed, dismiss] = useState(false), [index, setIndex] = useState(0), [expanded, expand] = useState(false);
  const query = chatCommandQuery(draft);
  const category = query?.name === 'skill' ? 'skills' : query?.hasArgument && ['provider', 'model', 'mode', 'sessions'].includes(query.name) ? query.name as Menu : null;
  const pane = menu ?? category ?? 'commands';
  const visible = active && !disabled && !dismissed && (!!menu || !!query);
  const term = query ? (pane === 'commands' ? query.name : query.hasArgument ? query.argument : '').toLowerCase() : '';
  const close = () => { setMenu(null); dismiss(true); };
  const finish = (action: () => void) => {
    if (query) change(query.rest);
    close(); action(); input.current?.focus();
  };
  const open = (next: Menu) => { setMenu(next); dismiss(false); setIndex(0); input.current?.focus(); };
  const toggleEditor = () => { expand(value => !value); input.current?.focus(); };
  const configure = selection !== null;
  let choices: Choice[];
  if (pane === 'provider') choices = (['codex', 'claude-code', 'cursor'] as const).map(value => ({ id: value, label: CLIENT_NAME[value], description: value === 'codex' ? 'Codex App Server · native conversation' : value === 'cursor' ? 'Cursor ACP · native agent session' : 'Claude Agent SDK · project-native session', selected: provider === value, disabled: configure, run: () => finish(() => setProvider(value)) }));
  else if (pane === 'model') choices = [{ id: 'default', label: 'Provider default', description: 'Follow the CLI’s configured model', selected: !model, disabled: configure || providerLoading, run: () => finish(() => setModel('')) }, ...(providerInfo?.models ?? []).map(value => ({ id: value.id, label: value.name, description: value.id, selected: model === value.id, disabled: configure || providerLoading, run: () => finish(() => setModel(value.id)) }))];
  else if (pane === 'mode') choices = [{ id: 'build', value: 'work', label: 'Build', description: 'Work on this project' }, { id: 'plan', value: 'plan', label: 'Plan first', description: 'Read-only planning before implementation' }, { id: 'read', value: 'read', label: 'Read only', description: 'Explore without changing files' }].map(value => ({ ...value, selected: mode === value.value, disabled: configure, run: () => finish(() => setMode(value.value)) }));
  else if (pane === 'sessions') choices = [{ id: 'new', label: 'New conversation', description: 'Start a separate thread in this project', selected: selection === null, run: () => finish(newChat) }, ...sessions.map(value => ({ id: value.id, label: value.label, description: 'Conversation in this project', selected: selection === value.id, run: () => finish(() => chooseSession(value.id)) }))];
  else if (pane === 'skills') choices = skills.filter(skill => skill.client === 'shared' || skill.client === provider).map(skill => ({ id: skill.id, label: skill.kind === 'command' ? `/${skill.name}` : skill.name, description: `${skill.scope === 'project' ? 'Project' : 'Installed'} · ${skill.description}${skill.requiresTrust ? ' · trust this project first' : ''}`, disabled: skillLoading || skill.requiresTrust, selected: selectedSkill?.id === skill.id, run: () => finish(() => selectSkill(skill)) }));
  else choices = [
    { id: 'provider', label: '/provider', description: 'Choose Codex, Claude Code or Cursor', disabled: configure, run: () => open('provider') },
    { id: 'model', label: '/model', description: 'Choose an available model', disabled: configure, run: () => open('model') },
    { id: 'mode', label: '/mode', description: 'Build, plan first or read only', disabled: configure, run: () => open('mode') },
    { id: 'skill', label: '/skill', description: 'Search installed skills and project workflows', run: () => open('skills') },
    { id: 'sessions', label: '/sessions', description: 'Switch conversation in this project', run: () => open('sessions') },
    { id: 'new', label: '/new', description: 'Start a new conversation', run: () => finish(newChat) },
    { id: 'focus', label: '/focus', description: focused ? 'Show agent telemetry' : 'Give the conversation the full width', disabled: !toggleFocus, run: () => finish(() => toggleFocus?.()) },
    { id: 'expand', label: '/expand', description: expanded ? 'Restore the compact editor' : 'Expand the writing area', run: () => finish(toggleEditor) },
    { id: 'context', label: '/context', description: 'Clear the selected project area', disabled: !context, run: () => finish(clearContext) },
    { id: 'stop', label: '/stop', description: 'Review stopping this agent', disabled: !stop, run: () => finish(() => stop?.()) },
    { id: 'help', label: '/help', description: 'Browse all chat commands', run: () => { if (query) change(query.rest); open('commands'); } },
  ];
  choices = matchChatChoices(choices.filter(choice => pane !== 'commands' || !choice.disabled || configure && ['provider', 'model', 'mode'].includes(choice.id)), term);
  const available = choices.filter(choice => !choice.disabled), current = available[Math.min(index, Math.max(0, available.length - 1))];
  useEffect(() => { setIndex(0); }, [pane, term]);
  useEffect(() => { if (!active || disabled) close(); }, [active, disabled]);
  useEffect(() => { if (active && !disabled) input.current?.focus({ preventScroll: true }); }, [active, disabled]);
  useLayoutEffect(() => {
    if (!active) return;
    const size = () => {
      const editor = input.current;
      if (!editor) return;
      editor.style.height = '0px';
      const limit = expanded ? Math.max(120, Math.min(420, window.innerHeight * .38)) : Math.max(42, Math.min(128, window.innerHeight * .16));
      editor.style.height = `${expanded ? limit : Math.min(limit, Math.max(42, editor.scrollHeight))}px`;
      const palette = box.current?.querySelector('.chat-command-palette');
      const bounds = box.current?.getBoundingClientRect(), dialog = box.current?.closest('[role="dialog"]')?.getBoundingClientRect();
      if (bounds && palette) box.current?.style.setProperty('--chat-menu-offset', bounds.top - (dialog?.top ?? 0) > palette.getBoundingClientRect().height + 20 ? 'calc(100% + 9px)' : '44px');
    };
    size(); window.addEventListener('resize', size);
    return () => window.removeEventListener('resize', size);
  }, [draft, expanded, active, visible]);
  useEffect(() => {
    if (!visible) return;
    const pointer = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) close(); };
    document.addEventListener('pointerdown', pointer);
    return () => document.removeEventListener('pointerdown', pointer);
  }, [visible]);
  useEffect(() => { if (visible && current) document.getElementById(`${id}-${encodeURIComponent(current.id)}`)?.scrollIntoView({ block: 'nearest' }); }, [visible, current?.id, id]);
  const submit = () => {
    if (query) {
      if (query.name === 'skill' && !query.hasArgument) { setMenu('skills'); setIndex(0); dismiss(false); return; }
      if (current) current.run(); else { setMenu(null); dismiss(false); }
      return;
    }
    close(); send();
  };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (visible && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (visible && ['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); setIndex(value => (value + (event.key === 'ArrowDown' ? 1 : -1) + Math.max(1, available.length)) % Math.max(1, available.length)); return; }
    if (visible && event.key === 'Tab' && !event.shiftKey) { event.preventDefault(); event.stopPropagation(); current?.run(); return; }
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.stopPropagation(); if (visible) current?.run(); else submit(); }
  };
  const modelName = providerInfo?.models.find(value => value.id === model)?.name ?? (model || 'Default');
  return <div className="quiet-composer-wrap"><div ref={box} className="project-composer quiet-composer" data-expanded={expanded} onKeyDownCapture={event => { if (visible && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); input.current?.focus(); } }}>
    {visible ? <div className="chat-command-palette" aria-label="Chat command menu"><header><button type="button" aria-label="All chat commands" onClick={() => { if (query) change(query.rest); open('commands'); }}>{pane === 'commands' ? '/' : '‹'}</button><span>{({ commands: 'Commands', provider: 'Provider', model: 'Model', mode: 'Mode', sessions: 'Conversations', skills: 'Skills & workflows' })[pane]}</span><kbd>esc</kbd></header><div id={`${id}-list`} role="listbox" aria-label="Chat commands">{choices.map(choice => <button type="button" id={`${id}-${encodeURIComponent(choice.id)}`} key={choice.id} role="option" tabIndex={-1} data-chat-command={choice.id} aria-selected={current?.id === choice.id} aria-disabled={choice.disabled || undefined} disabled={choice.disabled} onPointerMove={() => { const next = available.indexOf(choice); if (next >= 0) setIndex(next); }} onMouseDown={event => event.preventDefault()} onClick={choice.run}><span><strong>{choice.label}</strong><small>{choice.disabled ? choice.description.includes('trust this project') ? choice.description : configure ? 'Available in a new conversation' : skillLoading ? 'Loading workflow…' : 'Waiting for the provider' : choice.description}</small></span><span>{choice.selected ? '✓' : current?.id === choice.id ? '↵' : ''}</span></button>)}{!choices.length ? <p className="chat-command-empty">{pane === 'skills' ? 'No compatible workflows found for this provider.' : 'No matching command. Try /help.'}<br/><small>Use // to send a literal slash.</small></p> : null}</div><footer><span>↑ ↓ select</span><span>↵ apply · tab complete</span></footer></div> : null}
    {context ? <div className="project-context quiet-context"><span title={context}>⌖ {context}</span><button type="button" aria-label="Clear chat context" title="Remove selected project area" disabled={disabled} onClick={clearContext}>×</button></div> : null}
    {selectedSkill ? <div className="project-context quiet-context selected-workflow"><span title={selectedSkill.description}>✳ {selectedSkill.name} · {selectedSkill.scope}</span><button type="button" aria-label="Clear selected workflow" title="Remove selected workflow" disabled={disabled} onClick={clearSkill}>×</button></div> : null}
    <textarea ref={input} aria-label="Message project agent" role="combobox" aria-autocomplete="list" aria-expanded={visible} aria-controls={visible ? `${id}-list` : undefined} aria-activedescendant={visible && current ? `${id}-${encodeURIComponent(current.id)}` : undefined} placeholder={disabled ? 'Waiting for the local connection…' : selection ? 'Message your agent…' : 'What would you like to work on?'} disabled={disabled} rows={1} value={draft} onChange={event => { change(event.target.value); setMenu(null); dismiss(false); setIndex(0); }} onKeyDown={keyDown}/>
    <div className="quiet-composer-footer"><button type="button" className="quiet-command-trigger" aria-label="Open chat commands" title="Chat commands /" disabled={disabled} aria-expanded={visible} onClick={() => visible ? close() : open('commands')}>/</button><div className="quiet-configuration">{selection === null ? <><button type="button" aria-label="Choose agent provider" data-provider={provider} aria-pressed="true" disabled={disabled} onClick={() => open('provider')}>{CLIENT_NAME[provider]}<span>⌄</span></button><button type="button" aria-label="Choose agent model" title={modelName} disabled={disabled || providerLoading} onClick={() => open('model')}>{modelName}</button><button type="button" aria-label="Choose agent mode" disabled={disabled} onClick={() => open('mode')}>{mode === 'plan' ? 'Plan' : mode === 'read' ? 'Read only' : 'Build'}</button></> : <span>/ for commands</span>}</div><span className="quiet-enter-hint">⇧ ↵ newline</span><button type="button" className="quiet-expand-editor" aria-label={expanded ? 'Collapse text editor' : 'Expand text editor'} title={expanded ? 'Compact editor /expand' : 'Expand editor /expand'} aria-pressed={expanded} disabled={disabled} onClick={toggleEditor}>{expanded ? '⤡' : '⤢'}</button><button type="button" className="project-send" aria-label={selection ? 'Send message' : 'Start project agent'} title={query ? 'Apply command' : 'Send message'} disabled={disabled || !draft.trim() || !query && !ready} onClick={submit}>{busy ? '…' : '↑'}</button></div>
  </div><div className="quiet-composer-hint"><span>Enter to send</span><span>{selection ? 'Conversation stays in this project' : 'Starts a new conversation'}</span></div></div>;
}
