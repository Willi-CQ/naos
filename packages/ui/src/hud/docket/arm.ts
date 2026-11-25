// The safety rules of DESIGN 3.6 as pure functions. The controller and every route into a decision go through `gate`, so a key, a
// click and a screen reader activation cannot differ. Time is passed in: nothing here reads a clock, so the rules run in plain Node.
import type { ApprovalDecision, ApprovalStatus } from '@naos/protocol';

export const ARM_MS = 350;
export const LONG_ARM_MS = 1000;
export const DANGER_HOLD_MS = 700;
/** How long a settled card stays before the docket moves on. "Shows WITHDRAWN and leaves." */
export const SETTLED_LEAVE_MS = 2000;
/** After call 1 of 2 the next call is a moment away, so the docket waits for it instead of closing under the finger. */
export const NEXT_CALL_WAIT_MS = 1500;

export const armDelay = (longArm: boolean): number => (longArm ? LONG_ARM_MS : ARM_MS);

export interface ArmState {
  focused: boolean;
  /** Clock value at which keys start to work. null while the docket has no focus. */
  armsAt: number | null;
  /** Bumps on every restart, so the bar can restart its animation. */
  epoch: number;
}

export const unarmed = (): ArmState => ({ focused: false, armsAt: null, epoch: 0 });

/** Focus entering the docket. Moving between its own buttons is not an entry, so it does not call this. */
export const focusIn = (arm: ArmState, now: number, delay: number): ArmState =>
  (arm.focused ? arm : { focused: true, armsAt: now + delay, epoch: arm.epoch + 1 });

export const focusOut = (arm: ArmState): ArmState => ({ focused: false, armsAt: null, epoch: arm.epoch + 1 });

/** A new request, a serial next call, a swapped card, the link coming back. Focus is not needed: arming starts from focus anyway. */
export const restart = (arm: ArmState, now: number, delay: number): ArmState =>
  (arm.focused ? { focused: true, armsAt: now + delay, epoch: arm.epoch + 1 } : arm);

export const isArmed = (arm: ArmState, now: number): boolean => arm.focused && arm.armsAt !== null && now >= arm.armsAt;

export type Refusal = 'no-card' | 'settled' | 'link-lost' | 'unfocused' | 'arming' | 'pending' | 'needs-hold' | 'not-in-danger';

export interface GateInput {
  arm: ArmState;
  now: number;
  status: ApprovalStatus | null;
  linkUp: boolean;
  /** An answer for this card is on its way. A second tap must not send a second one. */
  pending: boolean;
  danger: boolean;
  /** The danger approve finished its 700 ms hold, or passed the confirm that replaces it. */
  held: boolean;
}

/**
 * What a danger card can never take without the hold. `session` and `project` would remember the call, and an edited approve would
 * skip the hold, so in danger only the held approve, denies and a redirect exist.
 */
const refusedInDanger = (decision: ApprovalDecision): boolean =>
  decision.kind === 'session' || decision.kind === 'project' || (decision.kind === 'approve' && decision.edited === true);

const needsHold = (decision: ApprovalDecision): boolean => decision.kind === 'approve' || decision.kind === 'answer';

/** null lets the decision through. Every refusal has a name, so the reason can be shown and tested. */
export function gate(input: GateInput, decision: ApprovalDecision): Refusal | null {
  if (input.status === null) return 'no-card';
  if (input.status !== 'open') return 'settled';
  if (!input.linkUp) return 'link-lost';
  if (!input.arm.focused) return 'unfocused';
  if (!isArmed(input.arm, input.now)) return 'arming';
  if (input.pending) return 'pending';
  if (input.danger && refusedInDanger(decision)) return 'not-in-danger';
  if (input.danger && needsHold(decision) && !input.held) return 'needs-hold';
  return null;
}

/** Only ids not seen before count as new. A snapshot that repeats known requests must not keep re-arming. */
export function newRequests(known: ReadonlySet<string>, open: readonly string[]): string[] {
  return open.filter((id) => !known.has(id));
}

/** `J` and `K`: the neighbour in the queue, wrapping. The current card can be settled and gone from `open`. */
export function neighbour(open: readonly string[], current: string | null, step: 1 | -1): string | null {
  if (open.length === 0) return null;
  const at = current === null ? -1 : open.indexOf(current);
  if (at === -1) return step === 1 ? open[0]! : open.at(-1)!;
  return open[(at + step + open.length) % open.length]!;
}

/** Oldest first. When the current card left the queue, the next one is the oldest still open. */
export function nextAfter(open: readonly string[], current: string | null): string | null {
  if (open.length === 0) return null;
  const at = current === null ? -1 : open.indexOf(current);
  if (at === -1) return open[0]!;
  return open[at + 1] ?? open.find((id) => id !== current) ?? null;
}
