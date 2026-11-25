// The right rail, section 8.3. Fixed order from the attention order. NEEDS YOU is sticky and never leaves.
import { command } from '../store/commands.ts';
import { useNaos, useModel, useShell, useView, attend, flyToSelection, select } from '../store/store.ts';
import type { DecisionVM, WorldVM } from '../store/model.ts';
import { COPY, SECTION } from '../store/strings.ts';
import { Channel, ChannelFoot } from './Channel.tsx';
import { Designator, StateMark } from './marks.tsx';

function Who({ text, glyph, letter }: { text: string; glyph: string; letter: string }) {
  return <span className="t-body-b">{text} {glyph ? <Designator glyph={glyph} letter={letter} /> : null}</span>;
}

export function SectionHead({ id, label, count, need, quiet, plain }: { id?: string; label: string; count?: number | string; need?: boolean; quiet?: boolean; plain?: boolean }) {
  return (
    <div className="sec-head t-label" data-need={need} data-quiet={quiet}>
      <h2 id={id} tabIndex={-1} className="t-label" style={{ margin: 0, textTransform: plain ? 'none' : undefined }}>{label}</h2>
      {count !== undefined ? <span className="n" style={{ textTransform: 'none' }}>{count}</span> : null}
    </div>
  );
}

export function DecisionRow({ d, compact }: { d: DecisionVM; compact?: boolean }) {
  const settled = d.status !== 'open';
  const world = d.worldName;
  if (compact) {
    return (
      <button type="button" className="decision" data-settled={settled} data-danger={d.danger} onClick={() => attend(d.requestId)}>
        <span className="needs-line">
          <span className="age">{d.age}</span>
          <Who text={world} glyph={d.glyph} letter={d.letter} />
          <span className="tool t-body">{d.tool}</span>
          <span className="t-micro c-slag" style={{ marginLeft: 'auto' }}>{d.note ?? 'SPACE answer'}</span>
        </span>
      </button>
    );
  }
  return (
    <button type="button" className="decision" data-settled={settled} data-danger={d.danger} onClick={() => attend(d.requestId)} aria-label={`${world} ${d.letter}, ${d.tool}, ${d.age}${d.note ? `, ${d.note}` : ''}`}>
      <span className="row2">
        <span className="ellipsis"><span className="age">{d.age}</span><Who text={world} glyph={d.glyph} letter={d.letter} /></span>
        <span className="tool t-body">{d.tool}</span>
      </span>
      <span className="cmd ellipsis" style={{ display: 'block' }}>{d.preview}</span>
      {d.note ? <span className="hint t-micro" style={{ color: 'var(--nad)' }}>{d.note}</span> : (
        <span className="hint t-micro">
          <span><b>SPACE</b>{COPY.answerHere}</span>
          <span><b>ENTER</b>{COPY.dive}</span>
        </span>
      )}
      {d.tag ? <span className="t-micro c-slag">{d.tag}</span> : null}
    </button>
  );
}

function Needs({ compact }: { compact?: boolean }) {
  const decisions = useModel((m) => m.decisions);
  const open = decisions.filter((d) => d.status === 'open').length;
  return (
    <section className="sec sticky" aria-label={SECTION.needs}>
      <SectionHead id="sec-needs" label={SECTION.needs} count={open} need={open > 0} quiet={open === 0} />
      {decisions.map((d) => <DecisionRow key={d.requestId} d={d} compact={compact ?? false} />)}
    </section>
  );
}

function Sources({ elsewhere }: { elsewhere?: boolean }) {
  const sources = useModel((m) => m.sources);
  if (sources.length === 0) return null;
  return (
    <section className="sec" aria-label={SECTION.source}>
      <SectionHead id="sec-source" label={elsewhere ? SECTION.sourceHere : SECTION.source} count={sources.length} />
      {sources.map((s) => {
        const [name, ...rest] = s.who.split(' ');
        return (
          <button key={s.nodeId} type="button" className="src" onClick={() => select(s.nodeId)}>
            <span className="row2">
              <span className="ellipsis"><span className="age">{s.age}</span><span className="t-body-b">{name}</span> <span className="t-desig">{rest.join(' ')}</span></span>
              <span className="why t-body">{s.reason}</span>
            </span>
            <span className="own t-body">{COPY.ownWindow}: {s.owner}</span>
          </button>
        );
      })}
    </section>
  );
}

function Trouble() {
  const trouble = useModel((m) => m.trouble);
  if (trouble.length === 0) return null;
  return (
    <section className="sec" aria-label={SECTION.trouble}>
      <SectionHead id="sec-trouble" label={SECTION.trouble} count={trouble.length} />
      {trouble.map((t) => {
        const [name, ...rest] = t.who.split(' ');
        return (
          <div key={t.nodeId} className="rail-ackable">
          <button type="button" className="rail-row" onClick={() => select(t.nodeId)}>
            <span className="who"><StateMark mark={t.mark} tone={t.tone} owned /><span className="t-body">{name} <span className="t-desig">{rest.join(' ')}</span></span></span>
            <span className="line t-body ellipsis">{t.line}</span>
          </button>
          <button type="button" className="rail-ack t-body" aria-label={`Acknowledge fault on ${t.who}`} onClick={() => { void command('fault.ack', { nodeId: t.nodeId }); }}>ack</button>
          </div>
        );
      })}
    </section>
  );
}

function Low() {
  const low = useModel((m) => m.low);
  if (low.length === 0) return null;
  return (
    <section className="sec" aria-label={SECTION.low}>
      <SectionHead id="sec-low" label={SECTION.low} count={low.length} />
      {low.map((l) => {
        const [name, ...rest] = l.who.split(' ');
        return (
          <button key={l.nodeId} type="button" className="rail-row" onClick={() => select(l.nodeId)}>
            <span className="t-body">{name} <span className="t-desig">{rest.join(' ')}</span></span>
            <span className="t-num c-paper">{l.line}</span>
          </button>
        );
      })}
    </section>
  );
}

function Landed() {
  const landed = useModel((m) => m.landed);
  const total = useModel((m) => m.landedTotal);
  if (landed.length === 0) return null;
  return (
    <section className="sec" aria-label={SECTION.landed}>
      <SectionHead label={SECTION.landed} count={total} />
      {landed.map((l) => (
        <div key={l.worldId} className="rail-row"><span className="t-body">{l.name}</span><span className="t-body line">{l.line}</span></div>
      ))}
    </section>
  );
}

/** Below 720 high the bottom strip has one row, so the Tape takes the LANDED slot (4.3). */
function RailTape() {
  const tape = useModel((m) => m.tape.slice(0, 6));
  return (
    <section className="sec" aria-label={SECTION.tape}>
      <SectionHead label={SECTION.tape} />
      <ol role="log" aria-label="Tape" aria-live="off">
        {tape.map((t) => (
          <li key={t.id} className="rail-row">
            <span className="t-num-s c-slag">{t.time}</span>
            <span className="t-micro ellipsis"><span className="c-bone">{t.who}</span> {t.what}{t.times > 1 ? ` ×${t.times}` : ''}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The rest of the rail, under the Manifest in Instrument mode. */
export function RailLower() {
  return <div className="rail"><Landed /><Channel grow={false} /></div>;
}

function Dossier({ world }: { world: WorldVM }) {
  return (
    <section className="sec dossier" aria-label={world.name}>
      <SectionHead label={world.name} count="Claude est, list price" plain />
      <div className="kv"><span className="k">MASS</span><span className="v">{world.massLine}</span></div>
      <div className="kv"><span className="k">TODAY</span><span className="v">{world.today}</span></div>
      <div className="kv"><span className="k">LIGHTS</span><span className="v">{world.lights}</span></div>
      <div className="kv"><span className="k">MOONS</span><span className="v">{world.moons}</span></div>
      <div className="kv"><span className="k">CRAFT</span><span className="v">{world.craftCount}, {world.tenderCount} {world.tenderCount === 1 ? 'tender' : 'tenders'}</span></div>
    </section>
  );
}

function Armillaries({ world }: { world: WorldVM }) {
  const runs = world.rows.flatMap((r) => (r.type === 'workflow' ? [r.workflow] : []));
  return (
    <>
      {runs.map((run) => (
        <section key={run.id} className="sec" aria-label={SECTION.armillary}>
          <SectionHead label={`${SECTION.armillary}  ${run.title.split(',')[0]}`} count={run.statusWord} />
          {run.phases.map((p) => <div key={p.title} className="kv"><span className="t-body c-bone ellipsis">{p.title}</span><span className="v">{p.line}</span></div>)}
          <div className="t-micro c-slag">no total until the run ends</div>
        </section>
      ))}
    </>
  );
}

function Away() {
  const away = useModel((m) => m.away);
  return (
    <section className="sec" aria-label={SECTION.away} style={{ paddingTop: 13 }}>
      <SectionHead label={SECTION.away} />
      {away.map((row, i) => (
        <div key={i} className="away-row"><span className="k">{row.kind}</span><span className="t-body">{row.line}</span></div>
      ))}
      <div className="t-body-b" style={{ marginTop: 16 }}><b style={{ marginRight: 8 }}>L</b>{COPY.hintLaunch}</div>
    </section>
  );
}

export function Rail() {
  const level = useView((v) => v.level);
  const worldId = useView((v) => v.worldId);
  const world = useModel((m) => m.allWorlds.find((w) => w.worldId === worldId));
  const craftCount = useModel((m) => m.craftCount);
  const openNeeds = useModel((m) => m.decisions.length > 0);
  const instrument = useShell((s) => s.instrument);
  const short = useShell((s) => s.short && !s.instrument);
  const wide = level === 'craft' && !instrument;

  if (instrument) return <aside className="right" aria-label="Rail"><div className="rail"><Needs /><Sources /><Trouble /><Low /></div></aside>;
  if (craftCount === 0 && level === 'system') {
    return <aside className="right" aria-label="Rail"><div className="rail">{openNeeds ? <Needs /> : null}<Away /></div></aside>;
  }
  return (
    <aside className="right" aria-label="Rail">
      <div className={`rail${wide ? ' wide' : ''}`}>
        <Needs compact={wide} />
        {wide ? null : <Sources elsewhere={level === 'world'} />}
        {level === 'system' ? <><Trouble /><Low />{short ? <RailTape /> : <Landed />}</> : null}
        {level === 'world' && world ? <><Dossier world={world} /><Armillaries world={world} /></> : null}
        <Channel grow />
        {wide ? <ChannelFoot /> : null}
      </div>
    </aside>
  );
}

/** Cinema hides the rail, but a new decision brings its row back at once (3.2). */
export function CinemaNeeds() {
  const decisions = useModel((m) => m.decisions);
  const cinema = useNaos((s) => s.view.cinema);
  if (!cinema || decisions.length === 0) return null;
  return (
    <div style={{ position: 'absolute', right: 0, top: 'var(--top)', width: 320, zIndex: 30, background: 'var(--void)', padding: '0 12px' }}>
      <Needs />
    </div>
  );
}

export { flyToSelection };
