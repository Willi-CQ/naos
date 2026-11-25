// The bottom strip, section 8.1. Two rows, one when short. Numbers roll with `servo`, the Tape is a quiet log.
import { count, money, moneyBare, tokens } from '../store/format.ts';
import type { TapeVM } from '../store/model.ts';
import { HINTS, SECTION } from '../store/strings.ts';
import { select, useModel, useShell, useView } from '../store/store.ts';
import { Servo } from './marks.tsx';

const FILTER_WORD = { all: '', 'writes-damage': 'writes and damage', needs: 'needs' } as const;

function Eph({ k, children }: { k: string; children: React.ReactNode }) {
  return <span className="eph"><span className="k">{k}</span><span className="v">{children}</span></span>;
}

export function Ephemeris() {
  const e = useModel((m) => m.ephemeris);
  const cls = useShell((s) => s.cls);
  return (
    <div className="bottom-row" role="group" aria-label="Ephemeris">
      <Eph k="RATE"><Servo value={e.tps} format={(n) => `${count(n)} tok/s est`} /></Eph>
      <Eph k="CLAUDE BURN"><Servo value={e.burn} format={(n) => `${moneyBare(n)}/h est`} /></Eph>
      <Eph k="CLAUDE TODAY">{e.today === null ? 'no index yet' : <Servo value={e.today} format={(n) => money(n)} />}</Eph>
      <Eph k="RESETS">{e.resets}</Eph>
      <Eph k="OWNED">{e.ownedRun} of {e.ownedLimit} running</Eph>
      <Eph k="LAG MAX">{(e.lagMs / 1000).toFixed(1)} s</Eph>
      {cls === 'W' ? null : (
        <span className="hints t-micro">
          {HINTS.map(([key, word]) => <span key={key}><b>{key}</b>{word}</span>)}
        </span>
      )}
    </div>
  );
}

function TapeRow({ row }: { row: TapeVM }) {
  const body = (
    <>
      <span className="time">{row.time}</span>
      <span className="who">{row.who}</span>
      <span className="what">{row.what}{row.times > 1 ? ` ×${row.times}` : ''}</span>
    </>
  );
  return (
    <li data-kind={row.kind}>
      {row.nodeId ? <button type="button" style={{ display: 'inline-flex', gap: 5, alignItems: 'baseline' }} tabIndex={-1} onClick={() => select(row.nodeId)}>{body}</button> : body}
    </li>
  );
}

export function Tape() {
  const tape = useModel((m) => m.tape);
  const filter = useView((v) => v.tapeFilter);
  return (
    <div className="bottom-row">
      <span className="tape-k">{SECTION.tape}</span>
      {filter === 'all' ? null : <span className="tape-filter t-micro">{FILTER_WORD[filter]}</span>}
      <ol className="tape" role="log" aria-label="Tape" aria-live="off">
        {tape.map((row) => <TapeRow key={row.id} row={row} />)}
      </ol>
    </div>
  );
}

export function BottomStrip() {
  const short = useShell((s) => s.short && !s.instrument);
  return (
    <footer className="bottom">
      <Ephemeris />
      {short ? null : <Tape />}
    </footer>
  );
}

export { tokens };
