// Stop and All stop. `.` and `Shift+.` are holds on the key, the buttons are holds on the pointer, and section 13 gives each a confirm
// dialog for a click or a screen reader. One `useStop` state drives the readout, so all routes look alike.
import { useRef } from 'react';
import { create } from 'zustand';
import { command } from '../../store/commands.ts';
import type { CraftVM } from '../../store/model.ts';
import { registerAction, registerKeys } from '../../store/registry.ts';
import { closeOverlay, openOverlay, say, useModel, useNaos } from '../../store/store.ts';
import { HoldButton } from '../docket/HoldButton.tsx';
import { createHold } from '../docket/hold.ts';
import { useDialogFocus } from '../focus.ts';
import { HAND } from './copy.ts';
import { useOpening } from './overlay.ts';

export const STOP_MS = 600;
export const ALL_STOP_MS = 1200;

export const useStop = create<{ holding: 'stop' | 'allstop' | null; who: string }>(() => ({ holding: null, who: '' }));

const naos = useNaos.getState;

export function selectedOwned(): CraftVM | null {
  const { view, model } = naos();
  const craft = view.selected === null ? undefined : model.crafts[view.selected];
  return craft && craft.owned && craft.agentId !== null && craft.live ? craft : null;
}

export async function stopCraft(craft: CraftVM): Promise<void> {
  const res = await command('agent.stop', { agentId: craft.agentId! });
  say(res.ok ? `${craft.name} stopping` : res.error.message);
}

export async function allStop(): Promise<void> {
  const res = await command('agent.stopAll', {});
  say(res.ok ? `All stop: ${res.result.stopped} stopping, ${res.result.outOfReach} observed out of reach` : res.error.message);
}

let target: CraftVM | null = null;

const stopHold = createHold(STOP_MS, () => { if (target) void stopCraft(target); }, (on) => useStop.setState({ holding: on ? 'stop' : null, who: target?.name ?? '' }));
const allHold = createHold(ALL_STOP_MS, () => { void allStop(); }, (on) => useStop.setState({ holding: on ? 'allstop' : null, who: 'every owned craft' }));

const plainPeriod = (e: KeyboardEvent): boolean => !e.ctrlKey && !e.altKey && !e.metaKey && e.code === 'Period';

export function installStops(): () => void {
  registerKeys([
    { id: 'stop.hold', scope: 'global', match: (e) => plainPeriod(e) && !e.shiftKey, run: (e) => {
      if (e.repeat) return;
      target = selectedOwned();
      if (target === null) { say(HAND.selectOwned); return; }
      stopHold.start();
    } },
    { id: 'allstop.hold', scope: 'global', match: (e) => plainPeriod(e) && e.shiftKey, run: (e) => {
      if (e.repeat) return;
      if (naos().model.ownedCount === 0) { say(HAND.noOwned); return; }
      allHold.start();
    } },
  ]);
  registerAction('stop', (nodeId) => {
    const craft = nodeId ? naos().model.crafts[nodeId] : selectedOwned() ?? undefined;
    if (!craft?.owned) { say(HAND.selectOwned); return true; }
    openOverlay('stop-confirm', { kind: 'stop', nodeId: craft.id });
    return true;
  });
  registerAction('allStop', () => { openOverlay('stop-confirm', { kind: 'allstop' }); return true; });
  const onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'Period') { stopHold.cancel(); allHold.cancel(); }
    if (e.key === 'Shift') allHold.cancel();
  };
  const onBlur = (): void => { stopHold.cancel(); allHold.cancel(); };
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  return () => {
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
  };
}

/** Fills the `allStop` slot of the masthead. */
export function AllStopButton() {
  const owned = useModel((m) => m.ownedCount);
  const lost = useNaos((s) => s.link.status !== 'up');
  const holding = useStop((s) => s.holding === 'allstop');
  return (
    <HoldButton
      ms={ALL_STOP_MS} className="allstop" disabled={owned === 0 || lost} holding={holding} label="All stop" keys="Shift+." title={lost ? 'The kernel link is lost.' : 'Hold, or click to confirm'}
      onDone={() => void allStop()} onRoute={() => openOverlay('stop-confirm', { kind: 'allstop' })}
    >
      ALL STOP
    </HoldButton>
  );
}

export function StopButton({ craft }: { craft: CraftVM }) {
  const lost = useNaos((s) => s.link.status !== 'up');
  const holding = useStop((s) => s.holding === 'stop' && s.who === craft.name);
  return (
    <HoldButton
      ms={STOP_MS} className="hand-stop t-micro" disabled={lost || !craft.live} holding={holding} label={`Stop ${craft.name}`} keys="."
      onDone={() => void stopCraft(craft)} onRoute={() => openOverlay('stop-confirm', { kind: 'stop', nodeId: craft.id })}
    >
      STOP
    </HoldButton>
  );
}

export type StopArg = { kind: 'stop'; nodeId: string } | { kind: 'allstop' };

/** The non-hold route of section 13. Cancel takes focus, so a stray key leaves things running. */
export function StopConfirm({ arg }: { arg: unknown }) {
  const opening = useOpening('stop-confirm');
  return <Confirm key={opening} a={arg as StopArg} />;
}

function Confirm({ a }: { a: StopArg }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref);
  const crafts = useModel((m) => m.crafts);
  const close = (): void => closeOverlay('stop-confirm');
  const owned = Object.values(crafts).filter((c) => c.owned && c.live);
  const observed = Object.values(crafts).filter((c) => !c.owned && c.live).length;
  const craft = a.kind === 'stop' ? crafts[a.nodeId] : undefined;
  const confirm = (): void => {
    close();
    if (a.kind === 'allstop') void allStop();
    else if (craft) void stopCraft(craft);
  };
  return (
    <div className="layer-dialog" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div ref={ref} className="dialog hand-confirm" role="alertdialog" aria-modal="true" aria-label={a.kind === 'allstop' ? 'Confirm All stop' : 'Confirm stop'}>
        <h2 className="t-label">{a.kind === 'allstop' ? 'ALL STOP' : 'STOP'}</h2>
        {a.kind === 'allstop' ? (
          <>
            <p className="t-body c-paper">Stops {owned.length} owned craft: interrupt, end of input, tree kill. It takes about 2 s.</p>
            <ul className="hand-list t-body c-bone">{owned.slice(0, 8).map((c) => <li key={c.id}>{c.name}</li>)}{owned.length > 8 ? <li>and {owned.length - 8} more</li> : null}</ul>
            <p className="t-body c-slag">{observed} observed. {HAND.observedOut}</p>
          </>
        ) : <p className="t-body c-paper">Stop {craft?.name ?? 'this craft'}: interrupt, end of input, tree kill. It takes about 2 s.</p>}
        <div className="hand-actions">
          <button type="button" className="dk-btn dk-small t-body" data-autofocus onClick={close}>Cancel</button>
          <button type="button" className="dk-btn dk-small t-body" data-danger="true" onClick={confirm}>{a.kind === 'allstop' ? 'Stop all' : 'Stop'}</button>
        </div>
      </div>
    </div>
  );
}

/** The readout of a key hold, wherever the key was pressed. */
export function HoldReadout() {
  const holding = useStop((s) => s.holding);
  const who = useStop((s) => s.who);
  if (holding === null) return null;
  const ms = holding === 'allstop' ? ALL_STOP_MS : STOP_MS;
  return (
    <div className="hand-readout t-body" role="status">
      <span>{holding === 'allstop' ? HAND.allStopHold : HAND.stopHold}: {who}</span>
      <i aria-hidden="true"><b style={{ animationDuration: `${ms}ms` }} /></i>
    </div>
  );
}
