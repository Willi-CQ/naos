// Follow-up, DESIGN 3.5: Enter queues until the turn ends, Ctrl+Enter sends now and interrupts, Esc leaves the field. The foot of the
// wide Channel holds it through the `followUp` slot, and at the other levels `I` opens the same box over the rail.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { command } from '../../store/commands.ts';
import type { CraftVM } from '../../store/model.ts';
import { say, useModel, useNaos } from '../../store/store.ts';
import { openCraftAction } from './CraftActions.tsx';
import { HAND } from './copy.ts';
import { finishOverlay, useOpening } from './overlay.ts';
import { StopButton } from './stop.tsx';

let focusBox: (() => void) | null = null;

export const focusFollowUpBox = (): boolean => {
  if (focusBox === null) return false;
  focusBox();
  return true;
};

function Box({ craft, onDone, autoFocus }: { craft: CraftVM; onDone?(): void; autoFocus?: boolean }) {
  const [text, setText] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const lost = useNaos((s) => s.link.status !== 'up');
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);
  useEffect(() => {
    focusBox = () => ref.current?.focus();
    return () => { focusBox = null; };
  }, []);

  const send = async (priority: 'queue' | 'now'): Promise<void> => {
    const body = text.trim();
    if (!body || lost || craft.agentId === null) return;
    const res = await command('agent.send', { agentId: craft.agentId, text: body, priority });
    if (!res.ok) { setFailure(res.error.message); return; }
    setText('');
    setFailure(null);
    say(priority === 'now' ? HAND.followNow : HAND.followSent);
    onDone?.();
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key !== 'Enter' || e.shiftKey || e.altKey) return;
    e.preventDefault();
    void send(e.ctrlKey ? 'now' : 'queue');
  };
  return (
    <>
      <textarea
        ref={ref} className="dk-input t-body" rows={2} aria-label={`Follow up to ${craft.name}`} placeholder={lost ? 'Disabled: the kernel link is lost.' : HAND.followPlaceholder} disabled={lost}
        value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey}
      />
      {failure ? <p className="t-body dk-error" role="alert">{failure}</p> : null}
    </>
  );
}

/** Fills the `followUp` slot. Only owned craft reach it. */
export function FollowUpSlot() {
  const nodeId = useNaos((s) => s.channel.nodeId);
  const craft = useModel((m) => (nodeId ? m.crafts[nodeId] : undefined));
  const agent = useNaos((s) => (craft?.agentId ? s.fleet.managed[craft.agentId] : undefined));
  if (!craft) return null;
  return (
    <div className="hand-foot">
      <Box craft={craft} />
      <div className="hand-foot-row t-micro">
        <span className="c-slag">{craft.queued > 0 ? `${craft.queued} queued` : 'ENTER queue  CTRL+ENTER now'}</span>
        <span className="hand-foot-acts">
          <button type="button" onClick={() => openCraftAction('addBudget', craft.id)}>B budget</button>
          <button type="button" onClick={() => openCraftAction('fork', craft.id)}>O fork</button>
          {agent?.resumable ? <button type="button" onClick={() => openCraftAction('resume', craft.id)}>U resume</button> : null}
          <StopButton craft={craft} />
        </span>
      </div>
    </div>
  );
}

/** `I` at System and World level, and the place `X` sends you for guidance. */
export function FollowUpSheet({ arg }: { arg: unknown }) {
  const craft = useModel((m) => m.crafts[arg as string]);
  const close = (): void => finishOverlay('followup');
  const opening = useOpening('followup');
  if (!craft) return null;
  return (
    <div className="hand-follow" role="dialog" aria-label={`Follow up to ${craft.name}`}>
      <div className="row2 t-label c-bone"><span>FOLLOW UP</span><span className="t-num-s" style={{ textTransform: 'none' }}>{craft.name}</span></div>
      <Box key={opening} craft={craft} onDone={close} autoFocus />
      <div className="t-micro c-slag">ENTER queue  CTRL+ENTER now  ESC close</div>
    </div>
  );
}
