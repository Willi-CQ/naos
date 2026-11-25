// LedgerSheet, DESIGN 4.10. Every number is a list price estimate, not a bill: the plan windows are the real limit.
import { useEffect, useRef, useState } from 'react';
import type { LedgerReport } from '@naos/protocol';
import { command } from '../../store/commands.ts';
import { ageWords, money, moneyBare, percent, tokens } from '../../store/format.ts';
import { BELT_GROUP, BELT_NAME, foldBelt } from '../../store/model.ts';
import { closeOverlay, useModel, useNaos } from '../../store/store.ts';
import { useDialogFocus } from '../focus.ts';
import { useOpening } from '../sheets/overlay.ts';
import { Meter, RankedBars, StatTile, TableView } from './charts.tsx';
import type { BarRow } from './charts.tsx';

const POLL_MS = 5000;

function useLedger(): { report: LedgerReport | null; failure: string | null } {
  const [report, setReport] = useState<LedgerReport | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const fetchIt = async (): Promise<void> => {
      const res = await command('ledger.get', {});
      if (!live) return;
      if (res.ok) { setReport(res.result); setFailure(null); } else setFailure(res.error.message);
    };
    void fetchIt();
    const timer = setInterval(() => void fetchIt(), POLL_MS);
    return () => { live = false; clearInterval(timer); };
  }, []);
  return { report, failure };
}

const dayName = (ms: number | null): string => (ms === null ? '' : `resets ${new Date(ms).toLocaleDateString('en-US', { weekday: 'short' })}`);

function Almanac() {
  const index = useNaos((s) => s.fleet.index);
  if (index.stage === 'done') return null;
  const pct = index.total > 0 ? Math.round((index.done / index.total) * 100) : 0;
  return <span className="t-num-s c-bone">partial, ALMANAC {pct} %</span>;
}

export function LedgerSheet() {
  const opening = useOpening('ledger');
  return <Ledger key={opening} />;
}

function Ledger() {
  const { report, failure } = useLedger();
  const sun = useModel((m) => m.sun);
  const worlds = useModel((m) => m.allWorlds);
  const belt = useModel((m) => m.beltWorlds);
  const crafts = useModel((m) => m.crafts);
  const sevenReset = useNaos((s) => s.fleet.plan?.resetsAt.sevenDay ?? null);
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref);

  const used = (left: number | null): number | null => (left === null ? null : 1 - left);
  const worldRow = (id: string) => worlds.find((w) => w.worldId === id);
  const days30 = report?.days30Usd ?? 0;
  const bars: BarRow[] = foldBelt(report?.byWorld ?? [], belt, (a, b) => ({ ...a, usd: a.usd + b.usd }))
    .map((row) => ({ row, world: worldRow(row.worldId) }))
    .sort((a, b) => b.row.usd - a.row.usd)
    .map(({ row, world }) => ({
      key: row.worldId, label: row.worldId === BELT_GROUP ? BELT_NAME : `${world?.slot ?? ''} ${world?.name ?? 'unknown'}`.trim(), value: row.usd, text: money(row.usd),
      note: days30 > 0 ? `${percent(row.usd / days30)} % of 30 days` : 'no total yet',
    }));
  const owner = (agentId: string): string => Object.values(crafts).find((c) => c.agentId === agentId)?.name ?? agentId;

  return (
    <div ref={ref} className="layer-sheet lg" role="dialog" aria-label="Ledger" tabIndex={-1} data-autofocus>
      <div className="row2 lg-head">
        <h2 className="t-label c-paper" style={{ margin: 0 }}>LEDGER</h2>
        <span className="t-body c-slag">list price estimates, not a bill</span>
        <Almanac />
        <button type="button" className="t-micro c-slag" onClick={() => closeOverlay('ledger')}>ESC close</button>
      </div>
      {failure ? <p className="t-body dk-error" role="alert">{failure}</p> : null}
      {report === null ? <p className="t-body c-slag" role="status">{failure ? '' : 'loading'}</p> : (
        <>
          <div className="lg-tiles">
            <StatTile label="Today" value={moneyBare(report.todayUsd)} note="est" />
            <StatTile label="Burn" value={`${moneyBare(report.burnUsdPerHour)}/h`} note="est" />
            <StatTile label="30 days" value={moneyBare(report.days30Usd)} note="est" />
          </div>
          <section className="lx-sec" aria-label="Plan windows">
            <div className="dk-sec-head t-label"><span>PLAN WINDOWS</span><span className="t-micro c-slag" style={{ textTransform: 'none', fontWeight: 400 }}>the real limit. {sun.asOf ? `as of ${sun.asOf}` : 'not fetched yet'}</span></div>
            <Meter label="5H" spoken="five hour window" used={used(sun.fiveLeft)} resets={sun.resets ? `resets ${sun.resets}` : ''} />
            <Meter label="7D" spoken="seven day window" used={used(sun.sevenLeft)} resets={dayName(sevenReset)} />
          </section>
          <section className="lx-sec" aria-label="By world, 30 days">
            <div className="dk-sec-head t-label"><span>BY WORLD, 30 DAYS</span><span className="t-micro c-slag" style={{ textTransform: 'none', fontWeight: 400 }}>mass in the scene</span></div>
            {bars.length === 0 ? <p className="t-body c-slag">No spend yet.</p> : <RankedBars rows={bars} name="Spend per world." />}
            {bars.length > 0 ? <TableView caption="Spend per world over 30 days" head={['world', 'usd', 'share']} rows={bars.map((b) => [b.label, b.text, b.note])} /> : null}
          </section>
          <section className="lx-sec" aria-label="Tree budgets">
            <div className="dk-sec-head t-label"><span>TREE BUDGETS</span><span className="t-micro c-slag" style={{ textTransform: 'none', fontWeight: 400 }}>owned only</span></div>
            {report.trees.length === 0 ? <p className="t-body c-slag">No owned trees.</p> : report.trees.map((t) => (
              <Meter key={t.rootAgentId} plain label={owner(t.rootAgentId)} spoken={`${owner(t.rootAgentId)} tree budget`} used={t.budgetUsd > 0 ? Math.min(1, t.spentUsd / t.budgetUsd) : null} text={`${moneyBare(t.spentUsd)} of ${moneyBare(t.budgetUsd)}`} />
            ))}
            {report.trees.length > 0 ? <TableView caption="Tree budgets" head={['tree', 'spent', 'budget']} rows={report.trees.map((t) => [owner(t.rootAgentId), moneyBare(t.spentUsd), moneyBare(t.budgetUsd)])} /> : null}
          </section>
          <section className="lx-sec" aria-label="By model, 30 days">
            <div className="dk-sec-head t-label"><span>BY MODEL, 30 DAYS</span><span className="t-micro c-slag" style={{ textTransform: 'none', fontWeight: 400 }}>table</span></div>
            <TableView open caption="Spend per model over 30 days" head={['model', 'input', 'output', 'usd']} rows={report.byModel.map((m) => [m.model, tokens(m.inputTokens), tokens(m.outputTokens), money(m.usd)])} />
          </section>
          <p className="t-body c-bone lg-blocked"><b className="t-label c-paper">BLOCKED ON YOU</b> today {ageWords(report.blockedTodayMs)}, exact. Earlier days are marked ~</p>
        </>
      )}
    </div>
  );
}
