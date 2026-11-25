// The keyboard map of section 3.4, on QWERTZ. Characters match on `event.key`, which follows the layout. The stop keys match on
// `event.code === 'Period'`, because `Shift+.` is `:` there. One listener, one table: the Hand replaces or adds rows by id.
import { allKeys, overlayDef, registerAction, registerKeys, runAction } from '../store/registry.ts';
import type { KeyBinding } from '../store/registry.ts';
import { COPY } from '../store/strings.ts';
import {
  attend, cycleTape, escape, flyHome, flyToSelection, flyToSlot, openOverlay, say, setSetting, setSkyDay, toggleCinema, toggleManifestMode, toggleOverlay, toggleRailCollapse,
  toggleRailOverlay, toggleSky, toggleText, toggleVeil, topOverlay, useNaos, walk,
} from '../store/store.ts';

const state = useNaos.getState;

const plain = (e: KeyboardEvent): boolean => !e.ctrlKey && !e.altKey && !e.metaKey;
export const letter = (key: string, shift = false) => (e: KeyboardEvent): boolean =>
  plain(e) && e.shiftKey === shift && e.key.toLowerCase() === key;
const char = (key: string) => (e: KeyboardEvent): boolean => plain(e) && e.key === key;

const isTextField = (t: EventTarget | null): boolean => {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'checkbox');
};
const isControl = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.tagName === 'BUTTON' || t.tagName === 'A' || t.getAttribute('role') === 'button' || t.getAttribute('role') === 'switch');

const needsControl = (name: Parameters<typeof runAction>[0], arg?: string) => (): void => {
  if (!runAction(name, arg)) say(COPY.stopUnavailable);
};

const DEFAULTS: KeyBinding[] = [
  { id: 'attend.space', scope: 'global', match: (e) => plain(e) && !e.shiftKey && e.code === 'Space', when: () => !isControl(document.activeElement), run: () => attend() },
  { id: 'attend.anywhere', scope: 'global', inText: true, always: true, match: (e) => e.ctrlKey && e.code === 'Period', run: () => attend() },
  { id: 'open', scope: 'global', match: (e) => plain(e) && !e.shiftKey && e.key === 'Enter', when: () => !isControl(document.activeElement), run: flyToSelection },
  { id: 'escape', scope: 'global', inText: true, always: true, match: (e) => e.key === 'Escape', run: (e) => {
    // Esc in a plain field leaves the field. In an overlay it closes it.
    if (isTextField(e.target) && !topOverlay()) (e.target as HTMLElement).blur();
    else escape();
  } },
  { id: 'next', scope: 'global', match: (e) => letter('j')(e) || char('ArrowDown')(e), run: () => walk(1) },
  { id: 'prev', scope: 'global', match: (e) => letter('k')(e) || char('ArrowUp')(e), run: () => walk(-1) },
  { id: 'world', scope: 'global', match: (e) => plain(e) && /^[1-9]$/.test(e.key), run: (e) => flyToSlot(Number(e.key)) },
  { id: 'system', scope: 'global', match: char('0'), run: flyHome },
  { id: 'launch', scope: 'global', match: letter('l'), run: () => openOverlay('launch', 'craft') },
  { id: 'mission', scope: 'global', match: letter('l', true), run: () => openOverlay('launch', 'mission') },
  { id: 'find', scope: 'global', match: (e) => letter('f')(e) || char('/')(e), run: () => openOverlay('find') },
  { id: 'observatory', scope: 'global', match: letter('p'), run: () => openOverlay('observatory') },
  { id: 'manifest', scope: 'global', match: letter('m'), run: () => { if (state().shell.strip) toggleRailOverlay(); else toggleManifestMode(); } },
  { id: 'rail', scope: 'global', match: letter('m', true), run: toggleRailCollapse },
  { id: 'sky', scope: 'global', match: letter('t'), run: toggleSky },
  { id: 'ledger', scope: 'global', match: (e) => letter('c')(e) || char('$')(e), run: () => openOverlay('ledger') },
  { id: 'veil', scope: 'global', match: letter('v'), run: toggleVeil },
  { id: 'cinema', scope: 'global', match: letter('h'), run: toggleCinema },
  { id: 'tape', scope: 'global', match: letter('q'), run: cycleTape },
  { id: 'geiger', scope: 'global', match: letter('g'), run: () => {
    const on = !state().view.settings.geiger;
    setSetting('geiger', on);
    say(on ? 'Geiger on' : 'Geiger off');
  } },
  { id: 'mute', scope: 'global', match: letter('n'), run: () => {
    const on = !state().view.settings.mute;
    setSetting('mute', on);
    say(on ? 'Sound muted' : 'Sound on');
  } },
  { id: 'laws', scope: 'global', match: char('?'), run: () => toggleOverlay('laws') },
  { id: 'settings', scope: 'global', match: char(','), run: () => toggleOverlay('settings') },
  // The holds belong to the Hand, which knows the stop steps. These rows are there so `.` is never a dead key in the meantime.
  { id: 'stop.hold', scope: 'global', match: (e) => plain(e) && !e.shiftKey && e.code === 'Period', run: needsControl('stop') },
  { id: 'allstop.hold', scope: 'global', match: (e) => plain(e) && e.shiftKey && e.code === 'Period', run: needsControl('allStop') },

  { id: 'craft.text', scope: 'craft', match: letter('w'), run: () => void toggleText() },
  { id: 'craft.followup', scope: 'craft', match: letter('i'), run: needsControl('focusFollowUp') },
  { id: 'craft.budget', scope: 'craft', match: letter('b'), run: needsControl('addBudget') },
  { id: 'craft.fork', scope: 'craft', match: letter('o'), run: needsControl('fork') },
  { id: 'craft.resume', scope: 'craft', match: letter('u'), run: needsControl('resume') },

  { id: 'sky.back', scope: 'sky', match: (e) => plain(e) && e.key === 'ArrowLeft', run: (e) => setSkyDay(state().view.skyDay + (e.shiftKey ? 7 : 1)) },
  { id: 'sky.forward', scope: 'sky', match: (e) => plain(e) && e.key === 'ArrowRight', run: (e) => setSkyDay(state().view.skyDay - (e.shiftKey ? 7 : 1)) },
];

/** Decides, for one keydown, whether a binding may fire. Later registrations win, so the Hand's rows sit on top of these. */
function onKey(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.isComposing) return;
  const { view } = state();
  const inText = isTextField(e.target);
  const top = topOverlay();
  const modal = top !== undefined && overlayDef(top.id)?.modal === true;
  const quiet = modal || !view.settings.singleKeys;
  for (const b of allKeys().reverse()) {
    if (!b.match(e)) continue;
    if (inText && !b.inText) continue;
    if (quiet && !b.always) continue;
    if (view.keyScope === 'docket' ? b.scope !== 'docket' && !b.always : b.scope === 'docket') continue;
    if (b.scope === 'sky' && !view.sky) continue;
    if (b.scope === 'craft' && state().channel.nodeId === null) continue;
    if (b.when && !b.when()) continue;
    e.preventDefault();
    b.run(e);
    return;
  }
}

/** Registers the default table, and the WCAG fallback for a click on a stop control. Returns a remove. */
export function installKeys(): () => void {
  registerKeys(DEFAULTS);
  registerAction('attend', () => false);
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
