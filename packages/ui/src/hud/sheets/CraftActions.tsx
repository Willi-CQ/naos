// Budget, fork and resume on a selected craft. `O` is also a docket key, so a stray press outside the docket must not spawn: all three
// open this dialog, and the action needs one more deliberate press.
import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { command } from '../../store/commands.ts';
import { closeOverlay, openOverlay, say, useModel, useNaos } from '../../store/store.ts';
import { useDialogFocus } from '../focus.ts';
import { HAND } from './copy.ts';
import { finishOverlay, useOpening } from './overlay.ts';

export type CraftAction = 'addBudget' | 'fork' | 'resume';

/** The registered verbs. They always return true: the default line about the control plane no longer applies. */
export function openCraftAction(kind: CraftAction, nodeId?: string): boolean {
  const { model, channel, fleet } = useNaos.getState();
  const id = nodeId ?? channel.nodeId;
  const craft = id ? model.crafts[id] : undefined;
  if (!craft?.owned || !craft.agentId) { say(HAND.readOnly); return true; }
  if (kind === 'resume' && !fleet.managed[craft.agentId]?.resumable) { say(HAND.notResumable); return true; }
  openOverlay('craft-action', { kind, nodeId: craft.id });
  return true;
}

export function CraftActionDialog({ arg }: { arg: unknown }) {
  const { kind, nodeId } = arg as { kind: CraftAction; nodeId: string };
  const opening = useOpening('craft-action');
  return <ActionForm key={opening} kind={kind} nodeId={nodeId} />;
}

function ActionForm({ kind, nodeId }: { kind: CraftAction; nodeId: string }) {
  const craft = useModel((m) => m.crafts[nodeId]);
  const [amount, setAmount] = useState(kind === 'addBudget' ? '1' : '');
  const [prompt, setPrompt] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref);
  const close = (): void => closeOverlay('craft-action');
  if (!craft?.agentId) return null;
  const agentId = craft.agentId;
  const usd = Number(amount);

  const run = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    const addUsd = amount !== '' && usd > 0 ? usd : undefined;
    const res = kind === 'addBudget'
      ? await command('agent.addBudget', { agentId, addUsd: usd })
      : kind === 'fork'
        ? await command('agent.fork', { agentId })
        : await command('agent.resume', { agentId, ...(prompt.trim() ? { prompt: prompt.trim() } : {}), ...(addUsd !== undefined ? { addUsd } : {}) });
    setBusy(false);
    if (!res.ok) { setFailure(res.error.message); return; }
    finishOverlay('craft-action');
    say(kind === 'addBudget' ? `Budget raised on ${craft.name}` : kind === 'fork' ? `Forked ${craft.name}` : `Resuming ${craft.name}`);
  };
  const invalid = kind === 'addBudget' && !(usd > 0);
  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') { e.preventDefault(); if (!invalid) void run(); }
  };

  const title = kind === 'addBudget' ? 'ADD BUDGET' : kind === 'fork' ? 'FORK' : 'RESUME';
  const verb = kind === 'addBudget' ? 'Add' : kind === 'fork' ? 'Fork' : 'Resume';
  return (
    <div className="layer-dialog" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div ref={ref} className="dialog hand-confirm" role="dialog" aria-modal="true" aria-label={`${verb} ${craft.name}`}>
        <h2 className="t-label">{title}</h2>
        <p className="t-body c-paper">{craft.name}, {craft.budget}</p>
        {kind === 'fork' ? <p className="t-body c-bone">A new craft starts from this session, with its own budget.</p> : null}
        {kind !== 'fork' ? (
          <label className="hand-field t-body c-bone">Add, USD
            <input className="dk-input t-num" data-autofocus inputMode="decimal" value={amount} placeholder={kind === 'resume' ? 'optional' : ''} onChange={(e) => setAmount(e.target.value)} onKeyDown={onKey} />
          </label>
        ) : null}
        {kind === 'addBudget' ? <p className="t-micro c-slag">A soft cap. It can overshoot by one API call.</p> : null}
        {kind === 'resume' ? (
          <label className="hand-field t-body c-bone">Prompt
            <input className="dk-input t-body" value={prompt} placeholder="optional" onChange={(e) => setPrompt(e.target.value)} onKeyDown={onKey} />
          </label>
        ) : null}
        {failure ? <p className="t-body dk-error" role="alert">{failure}</p> : null}
        <div className="hand-actions">
          <button type="button" className="dk-btn dk-small t-body" data-autofocus={kind === 'fork' ? true : undefined} onClick={close}>Cancel</button>
          <button type="button" className="dk-btn dk-small t-body" data-primary="true" aria-disabled={invalid || busy ? 'true' : undefined} onClick={() => { if (!invalid) void run(); }}>{verb}</button>
        </div>
      </div>
    </div>
  );
}
