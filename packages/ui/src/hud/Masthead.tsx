// The masthead, section 8.1. Dark means normal: a dark lamp row answers "does anything need me?" in one second.
import { useModel, useNaos, useView } from '../store/store.ts';
import type { LampVM, LampId } from '../store/model.ts';
import { ageClock } from '../store/format.ts';
import { percent } from '../store/format.ts';
import { runAction, slotOf } from '../store/registry.ts';
import { COPY, LAMP_NAME, LAMP_SPOKEN } from '../store/strings.ts';
import { openOverlay } from '../store/store.ts';

export function Wordmark() {
  return (
    <span className="wordmark" aria-label="NAOS" role="img">
      <span aria-hidden="true">NA</span>
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="9" fill="none" stroke="currentColor" strokeWidth="0.8" />
        <circle cx="14.5" cy="2.2" r="1.5" fill="currentColor" />
      </svg>
      <span aria-hidden="true">S</span>
    </span>
  );
}

const SECTION_OF: Partial<Record<LampId, string>> = { you: 'sec-needs', source: 'sec-source', fault: 'sec-trouble', retry: 'sec-trouble', low: 'sec-low' };

function jumpTo(id: LampId): void {
  if (id === 'limit') { openOverlay('ledger'); return; }
  const target = SECTION_OF[id];
  if (!target) return;
  const el = document.getElementById(target);
  el?.scrollIntoView({ block: 'nearest' });
  el?.focus();
}

function Lamp({ lamp }: { lamp: LampVM }) {
  const name = LAMP_NAME[lamp.id];
  return (
    <button type="button" className="lamp" data-id={lamp.id} data-lit={lamp.lit} onClick={() => jumpTo(lamp.id)} aria-label={`${LAMP_SPOKEN[lamp.id]}, ${lamp.count}`}>
      {lamp.note ?? name}{lamp.count > 0 ? ` ${lamp.count}` : ''}
    </button>
  );
}

function SunReadout() {
  const sun = useModel((m) => m.sun);
  const meter = (label: string, spoken: string, left: number | null) => {
    const text = left === null ? 'unknown' : `${percent(left)} % left`;
    return (
      <span className="mast-sun" data-stale={sun.stale} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={left === null ? undefined : percent(left)}
        aria-valuetext={left === null ? `${spoken}, unknown` : `${spoken}, ${percent(left)} percent left`} aria-label={spoken}>
        <span className="mast-k">{label}</span><span className="mast-v">{text}</span>
      </span>
    );
  };
  return (
    <button type="button" className="mast-group" style={{ gap: 10 }} onClick={() => openOverlay('ledger')} title="Ledger">
      <span className="mast-k quota-owner">CLAUDE</span>
      {meter('5H', 'Claude five hour window', sun.fiveLeft)}
      {meter('7D', 'seven day window', sun.sevenLeft)}
      {sun.asOf ? <span className="t-micro c-slag">{sun.stale ? 'stale, as of' : 'as of'} {sun.asOf}</span> : null}
    </button>
  );
}

function LinkLamp() {
  const link = useNaos((s) => s.link);
  const state = link.status === 'lost' ? 'no-signal' : link.status === 'connecting' ? 'lag' : 'ok';
  return (
    <span className="linklamp" data-state={state} role="status">
      <i aria-hidden="true" />
      {state === 'no-signal' ? `${COPY.noSignal} ${ageClock(link.lostForMs)}` : 'LINK'}
    </span>
  );
}

function AllStop() {
  const Slot = slotOf('allStop');
  const owned = useModel((m) => m.ownedCount);
  if (Slot) return <Slot />;
  // The hold, the confirm and the command arrive with the control plane. Until then this says so and does nothing.
  return (
    <button type="button" className="allstop" aria-disabled={owned === 0 ? 'true' : undefined} title={COPY.stopUnavailable} onClick={() => runAction('allStop')}>
      ALL STOP
    </button>
  );
}

export function Masthead() {
  const lamps = useModel((m) => m.lamps);
  const run = useModel((m) => m.run);
  const idle = useModel((m) => m.idle);
  const veil = useView((v) => v.settings.veil);
  const cinema = useView((v) => v.cinema);
  return (
    <header className="masthead">
      <Wordmark />
      <div className="lamps" role="group" aria-label="Lamps">
        {lamps.map((lamp) => <Lamp key={lamp.id} lamp={lamp} />)}
      </div>
      {cinema ? null : (
        <>
          <span className="mast-group">
            <span className="mast-k">RUN</span><span className="mast-v">{run}</span>
            <span className="mast-k" style={{ marginLeft: 6 }}>IDLE</span><span className="mast-v">{idle}</span>
          </span>
          <SunReadout />
        </>
      )}
      <span className="mast-end">
        {veil ? <span className="veiltag">{COPY.veiled}</span> : null}
        <LinkLamp />
        {cinema ? null : <AllStop />}
      </span>
    </header>
  );
}
