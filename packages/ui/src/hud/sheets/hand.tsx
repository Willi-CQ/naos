// One call wires the Hand into the shell, through the seams of hud/README.md. It must run after `installKeys()`: that call registers the
// default rows and the `attend` action this one replaces.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerAction, registerOverlay, registerSlot } from '../../store/registry.ts';
import { openOverlay, useNaos } from '../../store/store.ts';
import { installDocket } from '../docket/controller.ts';
import { Docket } from '../docket/Docket.tsx';
import '../docket/hand.css';
import { LaunchSheet } from '../launch/LaunchSheet.tsx';
import { LedgerSheet } from '../ledger/LedgerSheet.tsx';
import { CraftActionDialog, openCraftAction } from './CraftActions.tsx';
import { FirstFlight } from './FirstFlight.tsx';
import { FollowUpSheet, FollowUpSlot, focusFollowUpBox } from './FollowUp.tsx';
import { AllStopButton, HoldReadout, StopConfirm, installStops } from './stop.tsx';

function HandLayer() {
  return (
    <>
      <HoldReadout />
      <FirstFlight />
    </>
  );
}

let installed = false;

/** Safe to call twice, so a main.tsx that wires it and a test that injects it cannot register the rows twice over. */
export function registerHand(): void {
  if (installed) return;
  installed = true;
  registerOverlay({ id: 'docket', layer: 'docket', modal: false, Component: Docket });
  registerOverlay({ id: 'launch', layer: 'sheet', modal: true, Component: LaunchSheet });
  registerOverlay({ id: 'ledger', layer: 'sheet', modal: true, Component: LedgerSheet });
  registerOverlay({ id: 'followup', layer: 'sheet', modal: true, Component: FollowUpSheet });
  registerOverlay({ id: 'stop-confirm', layer: 'dialog', modal: true, Component: StopConfirm });
  registerOverlay({ id: 'craft-action', layer: 'dialog', modal: true, Component: CraftActionDialog });
  registerSlot('followUp', FollowUpSlot);
  registerSlot('allStop', AllStopButton);
  registerAction('focusFollowUp', (nodeId) => {
    const { view, channel, model } = useNaos.getState();
    const id = nodeId ?? channel.nodeId;
    const craft = id ? model.crafts[id] : undefined;
    if (!craft?.owned) return false;
    if (view.level === 'craft' && channel.nodeId === id && focusFollowUpBox()) return true;
    return openOverlay('followup', craft.id);
  });
  registerAction('addBudget', () => openCraftAction('addBudget'));
  registerAction('fork', () => openCraftAction('fork'));
  registerAction('resume', () => openCraftAction('resume'));
  installDocket();
  installStops();
  const host = document.createElement('div');
  host.id = 'hand-layer';
  document.body.append(host);
  createRoot(host).render(<StrictMode><HandLayer /></StrictMode>);
}
