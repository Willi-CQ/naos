// The docket, DESIGN 4.8 and 8.4. It opens over the rail at a fixed place at every level. Buttons use aria-disabled and stay
// focusable: a real `disabled` on a focused button drops its key events in the arm window, and that is when focus must hold.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { ApprovalView } from '@naos/protocol';
import { veiledApproval } from '../../store/model.ts';
import { SECTION } from '../../store/strings.ts';
import { useModel, useNaos, useView } from '../../store/store.ts';
import { Designator } from '../marks.tsx';
import { DANGER_HOLD_MS } from './arm.ts';
import { DocketBody } from './Body.tsx';
import {
  allAnswered, applyEdit, bodyKind, canAlways, canAlwaysProject, canEdit, canWiden, editableOf, isDanger, questionsOf, TOOL_VERB,
} from './card.ts';
import {
  approveHeld, armMs, askConfirm, bindRegion, canHold, confirmApprove, decide, docketFocus, leaveMode, pressApprove, pressDeny, pressProject, pressSession, pressStop, startEdit, startRedirect, useDocket,
} from './controller.ts';
import { HoldButton } from './HoldButton.tsx';

const FOCUSABLE = 'button, input, textarea, select, a[href], [tabindex="0"]';
const isTextTarget = (t: EventTarget): boolean => t instanceof HTMLElement && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.tagName === 'SELECT');

function ArmBar({ note }: { note: string | null }) {
  const arm = useDocket((s) => s.arm);
  const armed = useDocket((s) => s.armed);
  const danger = useDocket((s) => s.holding);
  const word = note !== null ? '' : !arm.focused ? 'focus the docket to answer' : armed ? 'armed' : 'arming';
  return (
    <div className="dk-armbar">
      <div className="dk-arm" data-armed={armed} data-hold={danger} aria-hidden="true">
        {arm.focused && note === null ? <i key={arm.epoch} style={{ animationDuration: `${armMs()}ms` }} /> : null}
      </div>
      <p className="t-body c-bone dk-armtext" data-note={note !== null}>{note ?? `${word}. Enter never approves. Esc leaves this undecided.`}</p>
      <span className="sr-only" role="status">{armed ? 'armed' : ''}</span>
    </div>
  );
}

function Btn({ k, keys, label, off, primary, onPress }: { k: string; keys: string; label: string; off: boolean; primary?: boolean; onPress(): void }) {
  return (
    <button type="button" className="dk-btn t-body" data-primary={primary === true} aria-disabled={off ? 'true' : undefined} aria-keyshortcuts={keys} onClick={onPress}>
      <b>{k}</b>{label}
    </button>
  );
}

function DecisionButtons({ a, off }: { a: ApprovalView; off: boolean }) {
  const armed = useDocket((s) => s.armed);
  const holding = useDocket((s) => s.holding);
  const picks = useDocket((s) => s.picks);
  const epoch = useDocket((s) => s.arm.epoch);
  const danger = isDanger(a);
  const kind = bodyKind(a);
  const locked = off || !armed;
  const answered = kind !== 'question' || allAnswered(questionsOf(a.input), picks);
  const word = kind === 'plan' ? 'Approve plan' : kind === 'question' ? 'Send answers' : 'Approve';
  return (
    <div className="dk-btns" data-danger={danger}>
      {danger ? (
        <HoldButton ms={DANGER_HOLD_MS} className="dk-btn t-body" holding={holding} disabled={locked} keys="A" reset={epoch} canStart={canHold} onDone={approveHeld} onRoute={askConfirm}>
          <b>A</b>{word}, hold
        </HoldButton>
      ) : <Btn k="A" keys="A" label={word} off={locked || !answered} primary={!off} onPress={pressApprove} />}
      <Btn k="D" keys="D" label="Deny" off={locked} primary={danger && !off} onPress={pressDeny} />
      <Btn k="X" keys="X" label="Deny, stop" off={locked} onPress={pressStop} />
      {canEdit(a) ? <Btn k="E" keys="E" label="Edit first" off={locked} onPress={startEdit} /> : null}
      {canAlways(a) ? <Btn k="S" keys="S" label="This session" off={locked} onPress={pressSession} /> : null}
      <Btn k="R" keys="R" label="Redirect" off={locked} onPress={startRedirect} />
    </div>
  );
}

function EditPane({ a }: { a: ApprovalView }) {
  const edit = useMemo(() => editableOf(a), [a]);
  const [value, setValue] = useState(edit.value);
  const [bad, setBad] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => { ref.current?.focus(); }, []);
  const submit = (): void => {
    const input = applyEdit(a, edit, value);
    setBad(input === null);
    if (input !== null) void decide({ kind: 'approve', input, edited: true });
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); submit(); }
  };
  return (
    <div className="dk-pane">
      <label className="t-label c-bone" htmlFor="dk-edit">Edit {edit.label}</label>
      <textarea id="dk-edit" ref={ref} className="dk-input t-num" rows={6} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={onKey} spellCheck={false} />
      {bad ? <p className="t-body dk-error">That is not valid JSON.</p> : null}
      <div className="row2">
        <span className="t-micro c-slag">CTRL+ENTER approve this edit. ESC back. The model is not told, it goes to the audit log.</span>
        <button type="button" className="dk-btn dk-small t-body" onClick={submit}>Approve edit</button>
      </div>
    </div>
  );
}

function RedirectPane() {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => { ref.current?.focus(); }, []);
  const submit = (): void => {
    const text = value.trim();
    if (text) void decide({ kind: 'redirect', text });
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); submit(); }
  };
  return (
    <div className="dk-pane">
      <label className="t-label c-bone" htmlFor="dk-redirect">Redirect, sends now and cancels this request</label>
      <textarea id="dk-redirect" ref={ref} className="dk-input t-body" rows={4} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={onKey} />
      <div className="row2">
        <span className="t-micro c-slag">CTRL+ENTER send. ESC back.</span>
        <button type="button" className="dk-btn dk-small t-body" onClick={submit}>Send</button>
      </div>
    </div>
  );
}

function ConfirmPane() {
  const armed = useDocket((s) => s.armed);
  return (
    <div className="dk-pane" role="group" aria-label="Confirm approve">
      <p className="t-body c-paper">Approve this call although it defaults to deny?</p>
      <div className="row2" style={{ justifyContent: 'flex-start' }}>
        <button type="button" className="dk-btn dk-small t-body" aria-disabled={armed ? undefined : 'true'} onClick={confirmApprove}>Approve anyway</button>
        <button type="button" className="dk-btn dk-small t-body" onClick={leaveMode}>Back</button>
      </div>
    </div>
  );
}

function Hints({ a, off }: { a: ApprovalView; off: boolean }) {
  const armed = useDocket((s) => s.armed);
  return (
    <div className="dk-hints t-body c-slag">
      {canAlwaysProject(a) ? (
        <button type="button" className="dk-link" aria-disabled={off || !armed ? 'true' : undefined} aria-keyshortcuts="Shift+S" onClick={pressProject}>Shift+S  always in this project: writes settings.local.json</button>
      ) : null}
      <div>Deny sends: "Not approved for this call."</div>
      {canEdit(a) ? <div>Edit is not told to the model. It goes to the audit log.</div> : null}
      {canWiden(a) ? <div>O opens wide</div> : null}
    </div>
  );
}

function Grants({ nodeId }: { nodeId: string }) {
  const standing = useModel((m) => m.crafts[nodeId]?.standing ?? []);
  if (standing.length === 0) return null;
  return (
    <section className="dk-sec">
      <div className="dk-sec-head t-label"><span>{SECTION.grants}</span><span className="n">{standing.length}</span></div>
      {standing.map((g, i) => <div key={i} className="kv"><span className="t-num c-paper ellipsis">{g.rule}</span><span className="t-body c-slag">{g.scope}</span></div>)}
    </section>
  );
}

function AtSource() {
  const sources = useModel((m) => m.sources);
  if (sources.length === 0) return null;
  return (
    <section className="dk-sec">
      <div className="dk-sec-head t-label"><span>{SECTION.source}</span><span className="n">{sources.length}</span></div>
      {sources.map((s) => (
        <div key={s.nodeId} className="kv"><span className="t-body c-paper"><span className="t-num" style={{ marginRight: 10 }}>{s.age}</span>{s.who}</span><span className="t-body c-slag">answer in its own window</span></div>
      ))}
    </section>
  );
}

function noteOf(a: ApprovalView, clientId: string | null, lost: boolean, waiting: boolean): string | null {
  if (waiting) return `call ${a.callIndex + 1} of ${a.callCount} is on its way`;
  if (a.status === 'answered') return a.answeredBy === clientId ? 'answered' : 'ANSWERED ELSEWHERE';
  if (a.status === 'withdrawn') return 'WITHDRAWN';
  if (a.status === 'expired') return 'EXPIRED';
  return lost ? 'cannot be answered now' : null;
}

function Card({ a }: { a: ApprovalView }) {
  const mode = useDocket((s) => s.mode);
  const wide = useDocket((s) => s.wide);
  const peek = useDocket((s) => s.peek);
  const error = useDocket((s) => s.error);
  const waiting = useDocket((s) => s.waitingNext);
  const veil = useView((v) => v.settings.veil);
  const lost = useNaos((s) => s.link.status !== 'up');
  const clientId = useNaos((s) => s.link.clientId);
  const d = useModel((m) => m.decisions.find((row) => row.requestId === a.requestId));
  const open = useModel((m) => m.decisions.filter((row) => row.status === 'open').map((row) => row.requestId));
  const craft = useModel((m) => m.crafts[a.nodeId]);
  const danger = isDanger(a);
  const veiled = veil && !peek;
  const shown = veiled ? veiledApproval(a) : a;
  const note = noteOf(a, clientId, lost, waiting);
  const off = note !== null;
  const at = open.indexOf(a.requestId);
  const kind = bodyKind(a);
  const tool = d?.tool ?? (veiled ? 'tool' : a.toolName);
  const age = d?.age ?? '';

  return (
    <>
      <div className="dk-head" data-danger={danger}>
        <h2 id="dk-title" className="t-label">{danger ? 'DEFAULT DENY' : 'NEEDS YOU'}</h2>
        <span className="dk-count t-num">{at === -1 ? '' : `${at + 1} of ${open.length}`}</span>
      </div>
      <div className="dk-who">
        <div className="row2">
          <span className="ellipsis">
            <span className="t-title">{craft?.worldName ?? d?.worldName ?? ''}</span>{' '}
            {craft ? <Designator glyph={craft.glyph} letter={craft.letter} /> : null}{' '}
            <span className="t-body c-bone">{craft?.title ?? ''}</span>
          </span>
          <span className="dk-age t-num">{age}</span>
        </div>
        <div className="row2 t-body c-bone">
          <span>{craft?.owned === false ? 'observed' : 'owned'}{d?.tag ? <span style={{ marginLeft: 16 }}>{d.tag}</span> : null}</span>
          {a.callCount > 1 ? <span>call {a.callIndex} of {a.callCount}</span> : null}
        </div>
      </div>
      <div className="dk-tool"><span className="t-body-b c-paper">{tool}</span><span className="t-body c-bone">{veiled ? 'structure only' : TOOL_VERB[kind]}</span></div>
      {a.decisionReason && !veiled ? <p className="dk-reason t-body">{a.decisionReason}</p> : null}
      <div className="dk-body">
        {veiled ? (
          <>
            <pre className="dk-code t-code">{d?.preview ?? tool}</pre>
            <p className="t-body c-slag">Hold V to read.</p>
          </>
        ) : <DocketBody a={shown} wide={wide} />}
      </div>
      <div className="dk-rule" />
      {mode === 'edit' ? <EditPane a={a} /> : null}
      {mode === 'redirect' ? <RedirectPane /> : null}
      {mode === 'confirm' ? <ConfirmPane /> : null}
      {mode === 'card' ? <DecisionButtons key={a.requestId} a={a} off={off} /> : null}
      <ArmBar note={note} />
      {error ? <p className="t-body dk-error" role="alert">{error}</p> : null}
      {mode === 'card' ? <Hints a={a} off={off} /> : null}
      <Grants nodeId={a.nodeId} />
      <AtSource />
    </>
  );
}

function useTrap(ref: React.RefObject<HTMLDivElement | null>): (e: KeyboardEvent<HTMLDivElement>) => void {
  return (e) => {
    if (e.key !== 'Tab') return;
    const root = ref.current;
    if (!root) return;
    const list = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = list[0];
    const last = list.at(-1);
    if (!first || !last) { e.preventDefault(); return; }
    const active = document.activeElement;
    // The region itself holds focus on entry and it sits outside the list.
    if (e.shiftKey && (active === first || active === root)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    else if (!e.shiftKey && active === root) { e.preventDefault(); first.focus(); }
  };
}

export function Docket(): ReactNode {
  const requestId = useDocket((s) => s.requestId);
  const wide = useDocket((s) => s.wide);
  const live = useNaos((s) => (requestId === null ? undefined : s.fleet.approvals[requestId]));
  const worldTool = useNaos((s) => (live ? `${s.model.decisions.find((d) => d.requestId === live.requestId)?.worldName ?? ''} ${live.toolFamily}` : 'Decision'));
  const ref = useRef<HTMLDivElement>(null);
  // Keeps the last card through the fade-out, so the panel does not blank while it leaves.
  const last = useRef<ApprovalView | undefined>(live);
  if (live) last.current = live;
  const a = last.current;
  const open = requestId !== null;
  const trap = useTrap(ref);
  const focused = useDocket((s) => s.arm.focused);
  const refusal = useDocket((s) => s.lastRefusal);

  useEffect(() => {
    bindRegion(ref.current);
    return () => bindRegion(null);
  }, []);
  // Focus enters on the region, never on a button (3.6).
  useEffect(() => { if (open) ref.current?.focus({ preventScroll: true }); }, [open]);

  const onKeyDownCapture = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Enter' && !isTextTarget(e.target)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return (
    <div
      ref={ref} className="layer-docket docket" role="region" aria-label={worldTool} tabIndex={-1} data-danger={a ? isDanger(a) : false} data-wide={wide} data-focused={focused} data-refusal={refusal ?? undefined}
      onFocus={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) docketFocus(true); }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) docketFocus(false); }}
      onKeyDownCapture={onKeyDownCapture} onKeyDown={trap}
    >
      {a ? <Card a={a} /> : null}
    </div>
  );
}

