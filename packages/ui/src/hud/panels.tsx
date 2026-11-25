// What the left rail shows at World and Craft level and in the Sky, sections 4.6, 4.7 and 4.11.
import { useMemo, useState } from 'react';
import { altitude } from '../core/laws.ts';
import { BELT_GROUP, BELT_NAME, foldBelt } from '../store/model.ts';
import type { CraftVM, WorldVM } from '../store/model.ts';
import { command } from '../store/commands.ts';
import { skyDay } from '../store/sky.ts';
import { SECTION } from '../store/strings.ts';
import { openOverlay, say, select, useModel, useNaos, useView } from '../store/store.ts';
import { Designator, StateMark } from './marks.tsx';

const TICKS = [25_000, 100_000, 250_000, 500_000, 1_000_000] as const;

function PanelHead({ title, back = 'esc back' }: { title: React.ReactNode; back?: string }) {
  return (
    <div className="panel-head">
      <span className="t-title">{title}</span>
      <span className="t-micro c-slag">{back}</span>
    </div>
  );
}

function Altimeter({ crafts }: { crafts: CraftVM[] }) {
  // Law 2: rows on the log ruler, each craft at the tick nearest its altitude, with the exact number in its row in the rail.
  const slots = TICKS.map((t) => altitude(t, 1_000_000));
  const at = (c: CraftVM): number => {
    let best = 0;
    slots.forEach((alt, i) => { if (Math.abs(alt - c.altitude) < Math.abs(slots[best]! - c.altitude)) best = i; });
    return best;
  };
  return (
    <div className="alti block">
      <h3><span>{SECTION.altimeter}</span><span className="t-micro c-slag" style={{ fontWeight: 400, letterSpacing: 0 }}>window used</span></h3>
      {TICKS.map((tick, i) => (
        <div key={tick} className="alti-row">
          <span className="t-num-s" style={{ textAlign: 'right', paddingRight: 4 }}>{tick / 10000}%</span>
          <i />
          <span>
            {crafts.filter((c) => c.contextFrac !== null && at(c) === i).map((c) => (
              <button key={c.id} type="button" className="alti-mark" onClick={() => select(c.id)}>
                <StateMark mark={c.mark} tone={c.tone} owned={c.owned} /><Designator glyph={c.glyph} letter={c.letter} />
              </button>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Under the Veil the name on screen is a star, and neither that nor the real one belongs in this field. Empty goes back to the folder's name. */
function Rename({ world }: { world: WorldVM }) {
  const veil = useModel((m) => m.veil);
  const [draft, setDraft] = useState<string | null>(null);
  if (veil) return null;
  if (draft === null) return <button type="button" className="t-micro c-slag" onClick={() => setDraft(world.name)}>rename</button>;
  const save = (): void => {
    setDraft(null);
    void command('world.rename', { worldId: world.worldId, name: draft }).then((res) => { if (!res.ok) say(res.error.message); });
  };
  return (
    <input className="lx-num t-body" style={{ width: '100%' }} aria-label={`Rename ${world.name}`} placeholder="folder name" maxLength={60} autoFocus value={draft}
      onChange={(e) => setDraft(e.target.value)} onBlur={() => setDraft(null)} onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
  );
}

function Design({ world }: { world: WorldVM }) {
  if (world.belt) return null;
  if (world.designing) return <div className="t-micro c-slag">designing planet…</div>;
  return (
    <div>
      {world.rationale ? <div className="t-micro c-bone" style={{ marginBottom: 4 }}>{world.rationale}</div> : null}
      <button
        type="button"
        className="t-micro c-slag"
        onClick={() => { void command('world.design', { worldId: world.worldId }).then((res) => { if (!res.ok) say(res.error.message); }); }}
      >
        {world.designed ? 'redesign planet' : 'design planet'}
      </button>
    </div>
  );
}

export function WorldPanel({ world }: { world: WorldVM }) {
  const crafts = world.rows.flatMap((r) => (r.type === 'craft' ? [r.craft] : []));
  return (
    <div className="panel">
      <PanelHead title={<><span className="t-num c-slag" style={{ marginRight: 6 }}>{world.slot}</span>{world.name}</>} />
      {!world.belt ? <button type="button" className="project-panel-open" onClick={() => openOverlay('project', world.worldId)}>⌖ Open surface & chat <span>↗</span></button> : null}
      <div className="t-micro c-bone ellipsis">{world.path}{world.git ? '  git' : ''}{world.branch ? `  ${world.branch}` : ''}</div>
      <Rename key={world.worldId} world={world} />
      <Design key={`design-${world.worldId}`} world={world} />
      <Altimeter crafts={crafts} />
      <div className="block">
        <h3><span>CRAFT {crafts.length}</span><span className="t-micro c-slag" style={{ fontWeight: 400, letterSpacing: 0 }}>J K walk</span></h3>
        {crafts.map((c) => (
          <div key={c.id} className="m-craft" style={{ padding: 0 }} role="button" tabIndex={0} onClick={() => select(c.id)} onKeyDown={(e) => { if (e.key === 'Enter') select(c.id); }}>
            <StateMark mark={c.mark} tone={c.tone} owned={c.owned} />
            <Designator glyph={c.glyph} letter={c.letter} />
            <span className="ttl ellipsis t-body">{c.title}</span>
            <span className="word t-num-s">{c.word}{c.metric ? ` ${c.metric}` : ''}</span>
          </div>
        ))}
        {crafts.length === 0 ? <p className="t-body c-slag" style={{ margin: '4px 0' }}>L launch into this world</p> : null}
      </div>
      {world.moonNames.length > 0 ? (
        <div className="block"><h3><span>{SECTION.worktrees} {world.moonNames.length}</span></h3>
          {world.moonNames.map((m) => <div key={m} className="t-num-s c-bone ellipsis">{m}</div>)}
        </div>
      ) : null}
    </div>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  if (!v) return null;
  return <div className="kv"><span className="k">{k}</span><span className="v">{v}</span></div>;
}

function Lineage({ craft }: { craft: CraftVM }) {
  const crafts = useModel((m) => m.crafts);
  const chain: CraftVM[] = [];
  let at: CraftVM | undefined = craft.parentId ? crafts[craft.parentId] : undefined;
  while (at && chain.length < 8) { chain.unshift(at); at = at.parentId ? crafts[at.parentId] : undefined; }
  const tenders = craft.childIds.map((id) => crafts[id]).filter((c): c is CraftVM => c !== undefined).slice(0, 12);
  if (chain.length === 0 && tenders.length === 0) return null;
  return (
    <div className="block lineage">
      <h3><span>{SECTION.lineage}</span></h3>
      <ul>
        {chain.map((c, i) => <li key={c.id} style={{ paddingLeft: i * 8 }}><button type="button" className="t-body" onClick={() => select(c.id)}>{c.name}</button></li>)}
        <li data-here="true" style={{ paddingLeft: chain.length * 8 }} className="t-body">{craft.name}, this craft</li>
        {tenders.map((c) => (
          <li key={c.id} style={{ paddingLeft: (chain.length + 1) * 8, borderLeft: c.dashedLink ? '1px dashed var(--rule)' : undefined }}>
            <button type="button" className="t-body" onClick={() => select(c.id)}>{c.agentType}, {c.word.toLowerCase()}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CraftPanel({ craft }: { craft: CraftVM }) {
  return (
    <div className="panel">
      <PanelHead title={<>{craft.worldName} <Designator glyph={craft.glyph} letter={craft.letter} /></>} />
      <div className="t-body c-bone ellipsis">{craft.title}</div>
      <div className="block">
        <Line k="STATE" v={`${craft.word}${craft.metric ? ` ${craft.metric}` : ''}`} />
        <Line k="MODEL" v={`${craft.model} ${craft.stellar}`} />
        <Line k="EFFORT" v={craft.effort} />
        <Line k="MODE" v={craft.mode} />
        <Line k="BRANCH" v={craft.branch} />
        <Line k="OWNER" v={craft.owner} />
      </div>
      <div className="block">
        <Line k="CONTEXT" v={craft.contextUsed} />
        <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((craft.contextFrac ?? 0) * 100)} aria-valuetext={craft.contextUsed} aria-label="Context window">
          <i style={{ width: `${Math.round((craft.contextFrac ?? 0) * 100)}%` }} data-hot={(craft.contextFrac ?? 0) >= 0.8} />
        </div>
        <div className="t-micro c-slag">alt {craft.altitude.toFixed(2)}, orbit, log scale</div>
      </div>
      <div className="block">
        <Line k="DRIVE" v={craft.capabilities.includes('tokens') ? `${Math.round(craft.tps)} tok/s est` : 'not available'} />
        <Line k="BUDGET" v={craft.budget} />
        <Line k="TURN" v={craft.turn} />
        <Line k="TOOLS" v={craft.toolsLine} />
        <Line k="QUEUED" v={String(craft.queued)} />
        <Line k="LAG" v={craft.lag} />
      </div>
      <Lineage craft={craft} />
      {craft.standing.length > 0 ? (
        <div className="block">
          <h3><span>{SECTION.grants} {craft.standing.length}</span></h3>
          {craft.standing.map((g, i) => <div key={i} className="kv"><span className="t-num-s">{g.rule}</span><span className="t-micro c-slag">{g.scope}</span></div>)}
        </div>
      ) : null}
    </div>
  );
}

export function SkyPanel() {
  const history = useNaos((s) => s.history);
  const salvos = useNaos((s) => s.salvos);
  const day = useView((v) => v.skyDay);
  const now = useModel((m) => m.now);
  const allWorlds = useModel((m) => m.allWorlds);
  const belt = useModel((m) => m.beltWorlds);
  const veil = useView((v) => v.settings.veil);
  const stats = useMemo(() => skyDay(history, salvos, now, day), [history, salvos, now, day]);
  const perWorld = foldBelt(stats.worlds, belt, (a, b) => ({ ...a, sessions: a.sessions + b.sessions })).sort((a, b) => b.sessions - a.sessions);
  const name = (id: string): string => (id === BELT_GROUP ? BELT_NAME : allWorlds.find((w) => w.worldId === id)?.name ?? (veil ? 'uncharted' : 'unknown'));
  return (
    <div className="panel">
      <PanelHead title={SECTION.sky} />
      <div className="t-micro c-bone">retained 30 days</div>
      <div className="block">
        <h3><span style={{ letterSpacing: 0, textTransform: 'none' }}>{stats.date}</span></h3>
        <Line k="SESSIONS" v={String(stats.sessions)} />
        <Line k="AGENTS" v={String(stats.agents)} />
        <Line k="FAN-OUTS" v={stats.fanouts === 0 ? '0' : `${stats.fanouts}, largest ${stats.largest}`} />
        <Line k="CLAUDE SPEND" v={`$${stats.usd.toFixed(0)} est`} />
        <Line k="BLOCKED" v={`~${Math.round(stats.blockedMs / 60_000)} min`} />
        <Line k="FAILED" v={String(stats.failed)} />
      </div>
      <div className="block">
        <h3><span>{SECTION.daily}</span></h3>
        {perWorld.map((w) => <div key={w.worldId} className="kv"><span className="t-body">{name(w.worldId)}</span><span className="v">{w.sessions} {w.sessions === 1 ? 'session' : 'sessions'}</span></div>)}
      </div>
    </div>
  );
}
