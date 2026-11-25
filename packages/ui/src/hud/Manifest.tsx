// The left rail at System level, section 8.2. `role="tree"` with a roving tabindex: arrows move, Enter opens. J and K stay global.
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { collapsedWorlds } from '../store/collapse.ts';
import { BELT_GROUP } from '../store/model.ts';
import type { CraftVM, ManifestRow, WorkflowVM, WorldVM } from '../store/model.ts';
import { SECTION } from '../store/strings.ts';
import { flyToSelection, openOverlay, select, selectWorld, setCollapsed, useModel, useNaos, useShell, useView } from '../store/store.ts';
import { Designator, StateMark } from './marks.tsx';
import { CLIENT_NAME, CLIENT_MARK } from '@naos/protocol';

function Sparkline({ values }: { values: readonly number[] }) {
  if (values.length < 2) return null;
  const top = Math.max(1, ...values);
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 48},${11 - (v / top) * 10}`).join(' ');
  return <svg width="48" height="12" viewBox="0 0 48 12" aria-hidden="true" style={{ marginRight: 6 }}><polyline points={points} fill="none" stroke="var(--bone)" strokeWidth="1" /></svg>;
}

function CostCell({ world, wide, regular }: { world: WorldVM; wide: boolean; regular: boolean }) {
  const parts = world.cost.split(' ');
  return (
    <span className="cost" title="Claude Code cost estimate. Codex and Cursor costs are unavailable." style={{ display: 'inline-flex', alignItems: 'center' }}>
      {wide ? <Sparkline values={world.burns} /> : null}
      {regular ? <span className="c-slag" style={{ marginRight: 10 }}>{world.burn}</span> : null}
      {parts.length === 2 ? <>{parts[0]}<em>{parts[1]}</em></> : world.cost}
    </span>
  );
}

function WorldRow({ world, collapsed, count }: { world: WorldVM; collapsed: boolean; count: number }) {
  const selected = useView((v) => v.selectedWorld === world.worldId);
  const cls = useShell((s) => s.cls);
  return (
    <div role="treeitem" className="m-world t-body" tabIndex={-1} aria-expanded={!collapsed} aria-selected={selected} aria-level={1} data-world={world.worldId}
      onClick={() => (world.belt ? setCollapsed(world.worldId, !collapsed) : selectWorld(world.worldId))}
      onDoubleClick={world.belt ? undefined : () => { selectWorld(world.worldId); openOverlay('project', world.worldId); }}>
      <span className="slot">{world.belt ? '' : world.slot}</span>
      <span className="ellipsis t-body-b">
        {world.name}{world.observedOnly ? <span className="obs">obs</span> : null}{collapsed ? <span className="obs">{count} craft</span> : null}
      </span>
      <CostCell world={world} wide={cls === 'W'} regular={cls !== 'C'} />
    </div>
  );
}

function CraftRow({ craft }: { craft: CraftVM }) {
  const selected = useView((v) => v.selected === craft.id);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (selected) ref.current?.scrollIntoView({ block: 'nearest' }); }, [selected]);
  return (
    <div ref={ref} role="treeitem" className="m-craft" tabIndex={-1} aria-selected={selected} aria-level={2} data-node={craft.id}
      data-attention={craft.tier === 1} data-idle={craft.state === 'idle' || craft.state === 'idle-shell'}
      onClick={() => select(craft.id)} onDoubleClick={() => { select(craft.id); flyToSelection(); }}>
      <StateMark mark={craft.mark} tone={craft.tone} owned={craft.owned} />
      <Designator glyph={craft.glyph} letter={craft.letter} />
      <span className="ttl ellipsis t-body"><span className="client-mark" data-client={craft.client} title={CLIENT_NAME[craft.client]}>{CLIENT_MARK[craft.client]}</span>{craft.title}</span>
      <span className="word t-num-s">{craft.word}{craft.metric ? ` ${craft.metric}` : ''}</span>
    </div>
  );
}

function WorkflowRow({ workflow }: { workflow: WorkflowVM }) {
  return (
    <div role="treeitem" className="m-craft m-flow" tabIndex={-1} aria-level={2} aria-selected={false} data-node={workflow.parentId} onClick={() => select(workflow.parentId)}>
      <StateMark mark="dot" tone={workflow.live ? 'work' : 'idle'} owned />
      <span className="ttl ellipsis t-body">{workflow.title}</span>
      <span className="word t-num-s">{workflow.metric}</span>
    </div>
  );
}

const Row = ({ row }: { row: ManifestRow }) => (row.type === 'craft' ? <CraftRow craft={row.craft} /> : <WorkflowRow workflow={row.workflow} />);

const items = (root: HTMLElement): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('[role="treeitem"]')];

function rove(root: HTMLElement, next: HTMLElement): void {
  for (const el of items(root)) el.tabIndex = el === next ? 0 : -1;
  next.focus();
}

export function Manifest() {
  const worlds = useModel((m) => m.worlds);
  const allWorlds = useModel((m) => m.allWorlds);
  const craftCount = useModel((m) => m.craftCount);
  const pad = useModel((m) => m.pad);
  const derelict = useModel((m) => m.derelict);
  const ownedLine = useModel((m) => m.ownedLine);
  const mode = useView((v) => v.manifest);
  const overrides = useView((v) => v.collapsed);
  const available = useNaos(useShallow((s) => s.shell.vh - s.shell.top - s.shell.bot - 70));
  const rowPx = useNaos((s) => (s.view.settings.comfort ? 24 : s.shell.cls === 'W' ? 22 : 20));
  const ref = useRef<HTMLDivElement>(null);

  const folded = useMemo(() => collapsedWorlds(worlds, available, rowPx, overrides), [worlds, available, rowPx, overrides]);

  // The first item must be tabbable, and a re-render must not take the roving stop away from the row that holds it.
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const all = items(root);
    if (all.length > 0 && !all.some((el) => el.tabIndex === 0)) all[0]!.tabIndex = 0;
  });

  const onKey = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    const root = ref.current;
    if (!root) return;
    const all = items(root);
    const at = all.indexOf(e.target as HTMLElement);
    if (at === -1) return;
    const here = all[at]!;
    const world = here.dataset.world;
    switch (e.key) {
      case 'ArrowDown': if (all[at + 1]) rove(root, all[at + 1]!); break;
      case 'ArrowUp': if (all[at - 1]) rove(root, all[at - 1]!); break;
      case 'Home': rove(root, all[0]!); break;
      case 'End': rove(root, all.at(-1)!); break;
      case 'ArrowLeft': if (world) setCollapsed(world, true); break;
      case 'ArrowRight': if (world) setCollapsed(world, false); break;
      case 'Enter':
        // The Belt is a group, not a place: there is nothing to fly to.
        if (world === BELT_GROUP) break;
        if (world) selectWorld(world); else if (here.dataset.node) select(here.dataset.node);
        flyToSelection();
        break;
      default: return;
    }
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // At rest with no craft, the rail is the list of worlds and what landed there (section 12.4).
  const resting = craftCount === 0;
  return (
    <>
      <div className="left-head">
        <h2 className="t-label" style={{ margin: 0 }}>{SECTION.manifest}</h2>
        <span className="t-num-s c-slag">{craftCount} craft</span>
      </div>
      <div ref={ref} className="manifest" role="tree" aria-label="Manifest" onKeyDown={onKey}>
        {resting
          ? allWorlds.map((w) => (
            <div key={w.worldId} role="treeitem" tabIndex={-1} aria-level={1} aria-selected={false} className="m-world t-body" data-world={w.worldId} style={{ margin: 0 }}
              onClick={() => selectWorld(w.worldId)} onDoubleClick={() => { selectWorld(w.worldId); openOverlay('project', w.worldId); }}>
              <span className="slot">{w.slot}</span>
              <span className="ellipsis">{w.name}</span>
              <span className="t-num-s c-bone">{w.landed > 0 ? `${w.landed} landed` : ''}</span>
            </div>
          ))
          : worlds.map((w) => {
            const closed = mode === 'world' || folded.has(w.worldId);
            return (
              <div key={w.worldId} role="group">
                <WorldRow world={w} collapsed={closed} count={w.craftCount} />
                {closed ? null : w.rows.map((row) => <Row key={row.type === 'craft' ? row.craft.id : row.workflow.id} row={row} />)}
              </div>
            );
          })}
      </div>
      <div className="m-foot">
        <div className="row">
          <span>
            <span className="pair"><b>PAD</b><span className="v">{pad}</span></span>
            <span className="pair"><b>DERELICT</b><span className="v">{derelict}</span></span>
          </span>
        </div>
        <div className="row t-micro"><span>{ownedLine}</span><span>m  collapse</span></div>
      </div>
    </>
  );
}

/** The 44 px strip of slots and marks, 1024 to 1279. */
export function RailStrip({ onOpen }: { onOpen(): void }) {
  const worlds = useModel((m) => m.worlds);
  return (
    <nav className="left strip" aria-label="Worlds">
      {worlds.map((w) => (
        <div key={w.worldId} style={{ display: 'contents' }}>
          <button type="button" className="t-num-s" onClick={onOpen} aria-label={w.belt ? w.name : `${w.slot} ${w.name}`}>{w.belt ? 'B' : w.slot}</button>
          {w.rows.flatMap((row) => (row.type === 'craft' ? [row.craft] : [])).map((c) => (
            <button key={c.id} type="button" onClick={() => select(c.id)} aria-label={c.spoken}><StateMark mark={c.mark} tone={c.tone} owned={c.owned} /></button>
          ))}
          <span className="sep" />
        </div>
      ))}
    </nav>
  );
}
