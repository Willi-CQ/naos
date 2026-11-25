// The chart parts of DESIGN 8.5, by the dataviz method of 4.10: headline numbers are tiles, single ratios are meters, ranked spend is a
// single-hue bar. One series each, so the section title names it and no legend exists. Values stay in text tokens, bars carry `bone`.
import { useState } from 'react';
import type { ReactNode } from 'react';

export function StatTile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="lg-tile">
      <div className="t-body c-bone">{label}</div>
      <div className="lg-value">{value}{note ? <span className="lg-est">{note}</span> : null}</div>
    </div>
  );
}

/** `used` is a fraction. Past 80 % the fill turns `halpha`, and the text always carries the number. */
export function Meter({ label, spoken, used, resets, text, plain }: { label: string; spoken: string; used: number | null; resets?: string; text?: string; plain?: boolean }) {
  const pct = used === null ? null : Math.round(used * 100);
  return (
    <div className="lg-meter">
      <span className={plain ? 't-body c-paper ellipsis' : 't-label c-bone'}>{label}</span>
      <span className="lg-track" role="meter" aria-label={spoken} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined} aria-valuetext={pct === null ? `${spoken}, unknown` : `${spoken}, ${pct} percent used`}>
        <i style={{ width: `${pct ?? 0}%` }} data-hot={(pct ?? 0) > 80} />
      </span>
      <span className="t-num c-paper">{text ?? (pct === null ? 'unknown' : `${pct} % used`)}</span>
      {resets !== undefined ? <span className="t-body c-slag">{resets}</span> : null}
    </div>
  );
}

export interface BarRow { key: string; label: string; value: number; text: string; note: string }

/** 12 px thick, 2 px gap, value at the tip. The readout line answers hover and keyboard focus alike. */
export function RankedBars({ rows, name }: { rows: readonly BarRow[]; name: string }) {
  const [active, setActive] = useState<BarRow | null>(null);
  const top = rows.reduce((max, row) => Math.max(max, row.value), 0);
  return (
    <div className="lg-bars" onMouseLeave={() => setActive(null)}>
      {rows.map((row) => (
        <div key={row.key} className="lg-bar" tabIndex={0} role="img" aria-label={`${row.label}, ${row.text}, ${row.note}`} data-active={active?.key === row.key} onMouseEnter={() => setActive(row)} onFocus={() => setActive(row)} onBlur={() => setActive(null)}>
          <span className="t-body c-paper ellipsis">{row.label}</span>
          <span className="lg-bar-run">
            <i style={{ width: top > 0 ? `calc((100% - 96px) * ${row.value / top})` : 0 }} />
            <span className="t-num-s c-paper">{row.text}</span>
          </span>
        </div>
      ))}
      <div className="lg-readout t-micro c-slag" aria-hidden="true">{active ? `${active.label}: ${active.text}, ${active.note}` : `hover a bar. ${name}`}</div>
    </div>
  );
}

export function TableView({ caption, head, rows, open }: { caption: string; head: readonly string[]; rows: ReadonlyArray<readonly ReactNode[]>; open?: boolean }) {
  const table = (
    <table className="lg-table t-body">
      <caption className="sr-only">{caption}</caption>
      <thead><tr>{head.map((h, i) => <th key={h} scope="col" data-num={i > 0}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((row, r) => <tr key={r}>{row.map((cell, c) => (c === 0 ? <th key={c} scope="row">{cell}</th> : <td key={c} data-num="true">{cell}</td>))}</tr>)}</tbody>
    </table>
  );
  if (open) return table;
  return <details className="lg-details"><summary className="t-micro c-slag">table</summary>{table}</details>;
}
