// First Flight, DESIGN 12.1: three steps in the free rect, and nothing is faked. The kernel fills in the folder, the model, the cap and
// the prompt from FIRST_FLIGHT_SPEC, so the one real approval it raises reaches the normal docket.
import { useEffect, useState } from 'react';
import { FIRST_FLIGHT_SPEC } from '@naos/protocol';
import { command } from '../../store/commands.ts';
import { say, setSetting, useNaos, useShell, useView } from '../../store/store.ts';
import { HAND } from './copy.ts';

const SEEN_KEY = 'naos.firstFlight';
/** The history reply follows the snapshot, so a returning fleet must not flash this first. */
const SETTLE_MS = 1200;

type Step = 'notifications' | 'sound' | 'launch' | 'done' | 'skipped';

function seen(): boolean {
  try { return globalThis.localStorage?.getItem(SEEN_KEY) != null; } catch { return false; }
}

function remember(step: 'done' | 'skipped'): void {
  try { globalThis.localStorage?.setItem(SEEN_KEY, step); } catch { /* shows again next time */ }
}

const STEPS = ['notifications', 'sound', 'launch'] as const;

function Choice({ label, yes, no, onYes, onNo }: { label: string; yes: string; no: string; onYes(): void; onNo(): void }) {
  return (
    <>
      <p className="t-body c-paper">{label}</p>
      <div className="hand-actions">
        <button type="button" className="dk-btn dk-small t-body" onClick={onNo}>{no}</button>
        <button type="button" className="dk-btn dk-small t-body" data-primary="true" onClick={onYes}>{yes}</button>
      </div>
    </>
  );
}

export function FirstFlight() {
  const empty = useNaos((s) => s.link.everUp && s.history.length === 0 && Object.keys(s.fleet.nodes).length === 0 && Object.keys(s.fleet.managed).length === 0);
  const free = useShell((s) => s.free);
  const instrument = useShell((s) => s.instrument);
  const overlays = useView((v) => v.overlays.length);
  const [step, setStep] = useState<Step | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (step !== null || !empty || seen()) return undefined;
    const timer = setTimeout(() => setStep('notifications'), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [empty, step]);

  if (step === null || step === 'done' || step === 'skipped' || overlays > 0 || instrument) return null;

  const skip = (): void => {
    remember('skipped');
    setStep('skipped');
  };
  const launch = async (): Promise<void> => {
    setBusy(true);
    setFailure(null);
    const res = await command('agent.spawn', { spec: FIRST_FLIGHT_SPEC });
    setBusy(false);
    if (!res.ok) { setFailure(res.error.message); return; }
    remember('done');
    setStep('done');
    say('Test craft launched. It will ask for one approval.');
  };

  return (
    <section className="hand-first" style={{ left: free.x + free.w / 2, top: free.y + free.h * 0.74 }} aria-label="First Flight" data-step={step}>
      <div className="row2">
        <h2 className="t-label c-bone" style={{ margin: 0 }}>FIRST FLIGHT</h2>
        <span className="t-num-s c-slag">{STEPS.indexOf(step as typeof STEPS[number]) + 1} of 3</span>
      </div>
      {step === 'notifications' ? (
        <Choice
          label="Decisions wait with no timeout, and NAOS may sit behind your editor. Raise a Windows notification when no window is focused?" yes="Allow notifications" no="Not now"
          onYes={() => { setSetting('notifications', true); setStep('sound'); }} onNo={() => { setSetting('notifications', false); setStep('sound'); }}
        />
      ) : null}
      {step === 'sound' ? (
        <Choice
          label="Play one ping when an answerable decision opens?" yes="Allow the alert" no="Stay silent"
          onYes={() => { setSetting('alert', true); setStep('launch'); }} onNo={() => { setSetting('alert', false); setStep('launch'); }}
        />
      ) : null}
      {step === 'launch' ? (
        <>
          <p className="t-body c-paper">Launch one Haiku test craft in a scratch folder, $0.02 cap, no settings, strict MCP. It writes one file, so it raises one real approval.</p>
          {failure ? <p className="t-body dk-error" role="alert">{failure}</p> : null}
          <div className="hand-actions">
            <button type="button" className="dk-btn dk-small t-body" onClick={skip}>Skip</button>
            <button type="button" className="dk-btn dk-small t-body" data-primary="true" aria-disabled={busy ? 'true' : undefined} onClick={() => void launch()}>{busy ? 'Launching' : 'Launch test craft'}</button>
          </div>
        </>
      ) : null}
      <p className="t-micro c-slag" style={{ margin: 0 }}>{HAND.firstNoHistory}</p>
    </section>
  );
}
