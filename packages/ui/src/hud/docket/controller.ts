// The docket's state and the one road to `approval.answer`. It lives outside React, so a key is judged against the state of this
// moment and never against the last render. `decide` is the choke point: keys, clicks and assistive activation all end there.
import { create } from 'zustand';
import type { ApprovalDecision, ApprovalView } from '@naos/protocol';
import { command } from '../../store/commands.ts';
import { overlayDef, registerAction, registerKeys, runAction } from '../../store/registry.ts';
import { closeOverlay, openOverlay, select, setKeyScope, useNaos } from '../../store/store.ts';
import {
  DANGER_HOLD_MS, NEXT_CALL_WAIT_MS, SETTLED_LEAVE_MS, armDelay, focusIn, focusOut, gate, isArmed, neighbour, newRequests, nextAfter, restart, unarmed,
} from './arm.ts';
import type { ArmState, Refusal } from './arm.ts';
import {
  activeQuestion, allAnswered, answersOf, bodyKind, canAlways, canAlwaysProject, canEdit, canWiden, isDanger, pick, questionsOf,
} from './card.ts';
import type { Picks } from './card.ts';
import { createHold } from './hold.ts';

export type DocketMode = 'card' | 'edit' | 'redirect' | 'confirm';

export interface DocketState {
  requestId: string | null;
  arm: ArmState;
  /** For the bar only. `gate` reads the clock, so a throttled timer can never arm early. */
  armed: boolean;
  mode: DocketMode;
  wide: boolean;
  /** `V` held: read through the veil. */
  peek: boolean;
  picks: Picks;
  holding: boolean;
  pending: boolean;
  /** Answered call 1 of 2 and the next has not landed yet. */
  waitingNext: boolean;
  error: string | null;
  lastRefusal: Refusal | null;
}

const closed = (): Omit<DocketState, 'arm'> => ({
  requestId: null, armed: false, mode: 'card', wide: false, peek: false, picks: {}, holding: false, pending: false, waitingNext: false, error: null, lastRefusal: null,
});

export const useDocket = create<DocketState>(() => ({ ...closed(), arm: unarmed() }));

const get = useDocket.getState;
const set = useDocket.setState;
const now = (): number => performance.now();
const naos = useNaos.getState;
const approvals = (): Record<string, ApprovalView> => naos().fleet.approvals;
const delay = (): number => armDelay(naos().view.settings.longArm);
const isOpen = (): boolean => naos().view.overlays.some((o) => o.id === 'docket');
const linkUp = (): boolean => naos().link.status === 'up' && naos().link.clientId !== null;

export const armMs = delay;
export const currentCard = (): ApprovalView | undefined => {
  const id = get().requestId;
  return id === null ? undefined : approvals()[id];
};

export const openRequests = (): ApprovalView[] =>
  Object.values(approvals()).filter((a) => a.status === 'open').sort((a, b) => a.createdAt - b.createdAt || a.requestId.localeCompare(b.requestId));
const openIds = (): string[] => openRequests().map((a) => a.requestId);

let region: HTMLElement | null = null;
let known = new Set<string>();
let armTimer: ReturnType<typeof setTimeout> | undefined;
let leaveTimer: ReturnType<typeof setTimeout> | null = null;
let nextTimer: ReturnType<typeof setTimeout> | undefined;

export const bindRegion = (el: HTMLElement | null): void => { region = el; };

/** Keys count only with focus inside the docket, read at the moment of the key. */
const inDocket = (): boolean => region !== null && isOpen() && region.contains(document.activeElement);

function scheduleArm(arm: ArmState): void {
  clearTimeout(armTimer);
  if (arm.armsAt === null) return;
  armTimer = setTimeout(() => { if (get().arm.epoch === arm.epoch) set({ armed: true }); }, Math.max(0, arm.armsAt - now()) + 1);
}

const approveHold = createHold(DANGER_HOLD_MS, () => { void finishHold(); }, (holding) => set({ holding }));

function rearm(): void {
  approveHold.cancel();
  const arm = restart(get().arm, now(), delay());
  set({ arm, armed: false });
  scheduleArm(arm);
}

/** Focus entering or leaving the region. Moves between its own buttons never reach here. */
export function docketFocus(on: boolean): void {
  if (on) {
    const arm = focusIn(get().arm, now(), delay());
    if (arm !== get().arm) {
      set({ arm, armed: false });
      scheduleArm(arm);
    }
    setKeyScope('docket');
    return;
  }
  approveHold.cancel();
  clearTimeout(armTimer);
  set({ arm: focusOut(get().arm), armed: false, peek: false });
  setKeyScope('global');
}

function clearLeave(): void {
  if (leaveTimer !== null) clearTimeout(leaveTimer);
  leaveTimer = null;
}

function watchSettled(): void {
  const card = currentCard();
  if (card === undefined || card.status === 'open' || leaveTimer !== null) return;
  approveHold.cancel();
  leaveTimer = setTimeout(() => {
    leaveTimer = null;
    advance();
  }, SETTLED_LEAVE_MS);
}

/** Swaps the card. Focus goes back to the region, never to a button, so a repeated `Space` cannot land on the same control. */
function showCard(id: string): void {
  clearLeave();
  clearTimeout(nextTimer);
  const focused = get().arm.focused;
  set({ requestId: id, mode: 'card', wide: false, picks: {}, error: null, waitingNext: false, pending: false, lastRefusal: null });
  rearm();
  if (focused) {
    region?.focus({ preventScroll: true });
    const card = approvals()[id];
    if (card) select(card.nodeId);
  }
  watchSettled();
}

export function closeDocket(): void {
  clearLeave();
  clearTimeout(nextTimer);
  closeOverlay('docket');
}

function advance(): void {
  const next = nextAfter(openIds(), get().requestId);
  if (next === null) closeDocket();
  else showCard(next);
}

function onApprovals(): void {
  const open = openIds();
  const fresh = newRequests(known, open);
  known = new Set(open);
  const { requestId, waitingNext, pending } = get();
  if (requestId === null) return;
  if (waitingNext && open.length > 0) {
    showCard(open[0]!);
    return;
  }
  // Every new request restarts the arm, also one that only joins the queue. It costs the operator 350 ms at most.
  if (fresh.length > 0) rearm();
  if (pending || waitingNext) return;
  if (approvals()[requestId] === undefined) { advance(); return; }
  watchSettled();
}

const gateFor = (decision: ApprovalDecision, held: boolean): Refusal | null => {
  const s = get();
  const card = currentCard();
  return gate({ arm: s.arm, now: now(), status: card?.status ?? null, linkUp: linkUp(), pending: s.pending, danger: card ? isDanger(card) : false, held }, decision);
};

const refuse = (lastRefusal: Refusal): boolean => {
  set({ lastRefusal });
  return false;
};

function afterAnswer(card: ApprovalView, decision: ApprovalDecision): void {
  if (decision.kind === 'stop') {
    closeDocket();
    // The message of an interrupt is lost, so guidance goes in the next follow-up.
    runAction('focusFollowUp', card.nodeId);
    return;
  }
  const rest = openIds().filter((id) => id !== card.requestId);
  if (rest.length > 0) { showCard(rest[0]!); return; }
  const serial = card.callIndex < card.callCount && decision.kind !== 'deny' && decision.kind !== 'redirect';
  if (!serial) { closeDocket(); return; }
  set({ waitingNext: true });
  clearTimeout(nextTimer);
  nextTimer = setTimeout(closeDocket, NEXT_CALL_WAIT_MS);
}

/** The one road to `approval.answer`. `held` says the danger hold or its confirm finished. */
export async function decide(decision: ApprovalDecision, held = false): Promise<boolean> {
  const refusal = gateFor(decision, held);
  if (refusal !== null) return refuse(refusal);
  const card = currentCard()!;
  const clientId = naos().link.clientId;
  if (clientId === null) return refuse('link-lost');
  approveHold.cancel();
  set({ pending: true, error: null, lastRefusal: null });
  const res = await command('approval.answer', { requestId: card.requestId, decision, clientId });
  if (get().requestId !== card.requestId) return res.ok;
  set({ pending: false });
  if (!res.ok) {
    set({ error: res.error.message });
    rearm();
    return false;
  }
  if (!res.result.applied) {
    // Another tab was first. The stream carries the settled card, and `onApprovals` takes it from there.
    watchSettled();
    return false;
  }
  afterAnswer(card, decision);
  return true;
}

/** The approve this card means: its answers for a form, otherwise plain approve. */
function approveDecision(card: ApprovalView): ApprovalDecision | null {
  if (bodyKind(card) !== 'question') return { kind: 'approve' };
  const questions = questionsOf(card.input);
  const { picks } = get();
  if (!allAnswered(questions, picks)) {
    set({ error: 'Pick an option for each question first.' });
    return null;
  }
  return { kind: 'answer', answers: answersOf(questions, picks) };
}

async function finishHold(): Promise<void> {
  const card = currentCard();
  const decision = card ? approveDecision(card) : null;
  if (decision) await decide(decision, true);
}

export function startApproveHold(): boolean {
  const refusal = gateFor({ kind: 'approve' }, true);
  if (refusal !== null) return refuse(refusal);
  return approveHold.start();
}

export const canHold = (): boolean => gateFor({ kind: 'approve' }, true) === null;
export const approveHeld = (): void => { void finishHold(); };

export const armedNow = (): boolean => isArmed(get().arm, now());
const cardMode = (): boolean => get().mode === 'card';

/** The press of `A` or the Approve button. Danger starts the hold instead. */
export function pressApprove(): void {
  const card = currentCard();
  if (!card || !cardMode()) return;
  if (isDanger(card)) { startApproveHold(); return; }
  const decision = approveDecision(card);
  if (decision) void decide(decision);
}

/** The route for a pointer click or assistive activation of a danger approve: a confirm that arms again, in place of the hold. */
export function askConfirm(): void {
  const card = currentCard();
  if (!card || !isDanger(card) || !armedNow()) return;
  set({ mode: 'confirm' });
  rearm();
}

export function confirmApprove(): void {
  if (get().mode !== 'confirm') return;
  void finishHold();
}

/** Text panes open only when armed: `E` inside the arm window does nothing, like every other key. */
function enterMode(mode: 'edit' | 'redirect'): void {
  if (!armedNow() || !cardMode()) return;
  const card = currentCard();
  if (!card || card.status !== 'open' || !linkUp()) return;
  if (mode === 'edit' && !canEdit(card)) return;
  set({ mode, error: null });
}

export const startEdit = (): void => enterMode('edit');
export const startRedirect = (): void => enterMode('redirect');

export function leaveMode(): void {
  set({ mode: 'card', error: null });
  region?.focus({ preventScroll: true });
}

export function pressSession(): void {
  const card = currentCard();
  if (card && cardMode() && canAlways(card)) void decide({ kind: 'session' });
}

export function pressProject(): void {
  const card = currentCard();
  if (card && cardMode() && canAlwaysProject(card)) void decide({ kind: 'project' });
}

export const pressDeny = (): void => { if (cardMode()) void decide({ kind: 'deny' }); };
export const pressStop = (): void => { if (cardMode()) void decide({ kind: 'stop' }); };

export function pressOption(option: number): void {
  const card = currentCard();
  if (!card || !cardMode() || !armedNow() || bodyKind(card) !== 'question') return;
  const questions = questionsOf(card.input);
  const { picks } = get();
  const at = activeQuestion(questions, picks);
  const question = questions[at];
  if (question) set({ picks: pick(picks, question, at, option), error: null });
}

export function pickOption(at: number, option: number): void {
  const card = currentCard();
  if (!card || !armedNow()) return;
  const question = questionsOf(card.input)[at];
  if (question) set({ picks: pick(get().picks, question, at, option), error: null });
}

function step(by: 1 | -1): void {
  if (!armedNow() || !cardMode()) return;
  const next = neighbour(openIds(), get().requestId, by);
  if (next !== null && next !== get().requestId) showCard(next);
}

function toggleWide(): void {
  const card = currentCard();
  if (card && canWiden(card) && armedNow()) set({ wide: !get().wide });
}

function attendAction(id?: string): boolean {
  const current = get().requestId;
  const live = current !== null && approvals()[current]?.status === 'open';
  const target = id ?? (isOpen() && live ? current : openRequests()[0]?.requestId);
  if (target === undefined || approvals()[target] === undefined) return false;
  if (!isOpen()) {
    set({ ...closed(), requestId: target });
    openOverlay('docket', target);
    select(approvals()[target]!.nodeId);
    watchSettled();
  } else if (target !== current) {
    showCard(target);
  }
  region?.focus({ preventScroll: true });
  return true;
}

function onOverlays(): void {
  const { overlays } = naos().view;
  const open = overlays.some((o) => o.id === 'docket');
  if (!open) {
    if (get().requestId === null) return;
    approveHold.cancel();
    clearTimeout(armTimer);
    clearLeave();
    clearTimeout(nextTimer);
    set({ ...closed(), arm: focusOut(get().arm) });
    setKeyScope('global');
    return;
  }
  // A sheet opened over an unfocused docket would sit under it. The request stays in the rail, undecided.
  const top = overlays.at(-1);
  if (top && top.id !== 'docket' && overlayDef(top.id)?.layer === 'sheet' && !get().arm.focused) closeDocket();
}

const letter = (key: string, shift = false) => (e: KeyboardEvent): boolean =>
  !e.ctrlKey && !e.altKey && !e.metaKey && e.shiftKey === shift && e.key.toLowerCase() === key;

/** A repeat is a key that went down before the card it would land on. It never counts. */
const fresh = (run: (e: KeyboardEvent) => void) => (e: KeyboardEvent): void => { if (!e.repeat) run(e); };

const row = (id: string, match: (e: KeyboardEvent) => boolean, run: (e: KeyboardEvent) => void) => ({
  id: `docket.${id}`, scope: 'docket' as const, always: true, when: inDocket, match, run: fresh(run),
});

export function installDocket(): () => void {
  known = new Set(openIds());
  registerAction('attend', attendAction);
  registerKeys([
    row('approve', letter('a'), pressApprove),
    row('edit', letter('e'), startEdit),
    row('session', letter('s'), pressSession),
    row('project', letter('s', true), pressProject),
    row('deny', letter('d'), pressDeny),
    row('stop', letter('x'), pressStop),
    row('redirect', letter('r'), startRedirect),
    row('next', (e) => letter('j')(e) || (e.key === 'ArrowDown' && !e.shiftKey), () => step(1)),
    row('prev', (e) => letter('k')(e) || (e.key === 'ArrowUp' && !e.shiftKey), () => step(-1)),
    row('wide', letter('o'), toggleWide),
    row('option', (e) => !e.ctrlKey && !e.altKey && !e.metaKey && /^[1-4]$/.test(e.key), (e) => pressOption(Number(e.key) - 1)),
    row('veil', letter('v'), () => { if (naos().view.settings.veil) set({ peek: true }); }),
    // Backstop for the capture handler in Docket.tsx. Enter never approves, wherever focus sits inside the docket.
    row('enter', (e) => e.key === 'Enter', () => undefined),
    { id: 'docket.escape', scope: 'docket', always: true, inText: true, when: inDocket, match: (e) => e.key === 'Escape', run: () => {
      if (get().mode !== 'card') leaveMode();
      else closeDocket();
    } },
  ]);
  const onKeyUp = (e: KeyboardEvent): void => {
    if (e.key.toLowerCase() === 'a') approveHold.cancel();
    if (e.key.toLowerCase() === 'v' && get().peek) set({ peek: false });
  };
  const onBlur = (): void => {
    approveHold.cancel();
    if (get().peek) set({ peek: false });
  };
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  const stops = [
    useNaos.subscribe((s) => s.fleet.approvals, onApprovals),
    useNaos.subscribe((s) => s.view.overlays, onOverlays),
    useNaos.subscribe((s) => s.link.status, (status, before) => {
      if (status === 'lost') approveHold.cancel();
      if (status === 'up' && before === 'lost') rearm();
    }),
  ];
  return () => {
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    for (const stop of stops) stop();
  };
}
