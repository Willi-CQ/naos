// Find, Laws and Settings, and the host that renders every registered overlay. Keyboard rules are in keymap.ts.
import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { overlayDef, registerOverlay } from '../store/registry.ts';
import { COPY, KEY_TABLE, LAWS, SETTING_TEXT } from '../store/strings.ts';
import type { Settings } from '../store/store.ts';
import {
  closeOverlay, cycleTape, flyHome, flyToSlot, flyToSelection, openOverlay, select, selectWorld, setSetting, toggleCinema, toggleSky, toggleVeil, useModel, useView,
} from '../store/store.ts';
import { useDialogFocus } from './focus.ts';
import { Observatory } from './Observatory.tsx';
import { ProjectWindow } from './project/ProjectWindow.tsx';

interface FindItem { id: string; kind: string; label: string; hint: string; run(): void }

/** Subsequence match, tighter runs first. No dependency for what twenty lines can do. */
function score(query: string, text: string): number {
  if (!query) return 1;
  const t = text.toLowerCase();
  let at = -1;
  let total = 0;
  for (const ch of query.toLowerCase()) {
    const next = t.indexOf(ch, at + 1);
    if (next === -1) return 0;
    total += next === at + 1 ? 3 : 1;
    at = next;
  }
  return total + (t.startsWith(query.toLowerCase()) ? 10 : 0);
}

const COMMANDS: ReadonlyArray<{ label: string; hint: string; run(): void }> = [
  { label: 'System view', hint: '0', run: flyHome },
  { label: 'Project atlas', hint: 'P', run: () => openOverlay('observatory') },
  { label: 'Laws and keys', hint: '?', run: () => openOverlay('laws') },
  { label: 'Settings', hint: ',', run: () => openOverlay('settings') },
  { label: 'Sky', hint: 'T', run: toggleSky },
  { label: 'Veil', hint: 'V', run: toggleVeil },
  { label: 'Cinema', hint: 'H', run: toggleCinema },
  { label: 'Tape filter', hint: 'Q', run: cycleTape },
  { label: 'Launch', hint: 'L', run: () => openOverlay('launch') },
  { label: 'Ledger', hint: 'C', run: () => openOverlay('ledger') },
];

function FindPalette() {
  const worlds = useModel((m) => m.allWorlds);
  const crafts = useModel((m) => m.crafts);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref);

  const items = useMemo<FindItem[]>(() => {
    const out: FindItem[] = [];
    for (const w of worlds) out.push({ id: `w:${w.worldId}`, kind: 'world', label: `${w.slot} ${w.name}`, hint: `${w.craftCount} craft`, run: () => { flyToSlot(w.slot); selectWorld(w.worldId); } });
    for (const c of Object.values(crafts)) {
      const kind = c.kind !== 'main' ? 'tender' : c.live ? 'craft' : 'session';
      out.push({ id: `c:${c.id}`, kind, label: `${c.name} ${c.title}`, hint: `${c.word}${c.metric ? ` ${c.metric}` : ''}`, run: () => { select(c.id); flyToSelection(); } });
    }
    for (const c of COMMANDS) out.push({ id: `k:${c.label}`, kind: 'command', label: c.label, hint: c.hint, run: c.run });
    return out;
  }, [worlds, crafts]);

  const matches = useMemo(
    () => items.map((item) => ({ item, s: score(query, item.label) })).filter((r) => r.s > 0).sort((a, b) => b.s - a.s).slice(0, 12).map((r) => r.item),
    [items, query],
  );

  const run = (item: FindItem | undefined) => {
    if (!item) return;
    closeOverlay('find');
    item.run();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(matches.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); run(matches[active]); }
  };

  return (
    <div ref={ref} className="layer-palette" role="dialog" aria-label="Find">
      <input
        className="find-input" data-autofocus aria-label="Find" role="combobox" aria-expanded="true" aria-controls="find-list" aria-activedescendant={matches[active] ? `find-${active}` : undefined}
        value={query} placeholder="Worlds, craft, sessions, commands" autoComplete="off" spellCheck={false}
        onChange={(e) => { setQuery(e.target.value); setActive(0); }} onKeyDown={onKey}
      />
      <ul id="find-list" className="find-list" role="listbox" aria-label="Results">
        {matches.map((item, i) => (
          <li key={item.id} id={`find-${i}`} role="option" aria-selected={i === active} className="find-row t-body" onMouseEnter={() => setActive(i)} onClick={() => run(item)}>
            <span className="ellipsis">{item.label}</span>
            <span className="kind t-micro">{item.kind}, {item.hint}</span>
          </li>
        ))}
        {matches.length === 0 ? <li className="find-row t-body c-slag">{COPY.noMatch}</li> : null}
      </ul>
    </div>
  );
}

function Keys({ at }: { at: number }) {
  const table = KEY_TABLE[at]!;
  return (
    <div style={{ marginBottom: 12 }}>
      <h2 className="t-label">{table.head}</h2>
      {table.rows.map(([key, text]) => <div key={key} className="key t-body"><b>{key}</b><span>{text}</span></div>)}
    </div>
  );
}

function LawsDialog() {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref);
  return (
    <div className="layer-dialog" onClick={(e) => { if (e.target === e.currentTarget) closeOverlay('laws'); }}>
      <div ref={ref} className="dialog" role="dialog" aria-modal="true" aria-label="Laws and keys" tabIndex={-1} data-autofocus>
        <div className="laws">
          <div>
            <h2 className="t-label">The seven laws</h2>
            <ol>
              {LAWS.map(([name, text], i) => (
                <li key={name} className="t-body"><b className="c-paper">{i + 1}. {name}.</b> <span className="c-bone">{text}</span></li>
              ))}
            </ol>
          </div>
          <div>
            <Keys at={0} />
          </div>
          <div>
            <Keys at={1} />
            <Keys at={2} />
            <Keys at={3} />
          </div>
        </div>
        <button type="button" className="t-micro c-slag" onClick={() => closeOverlay('laws')} style={{ marginTop: 8 }}>Esc close</button>
      </div>
    </div>
  );
}

type BooleanSetting = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];
function Toggle({ k, label, hint }: { k: BooleanSetting; label: string; hint: string }) {
  const on = useView((v) => v.settings[k]);
  return (
    <div className="set-row">
      <span className="t-body">{label}</span>
      <span className="hint t-micro">{hint}</span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => setSetting(k, !on)}>{on ? 'on' : 'off'}</button>
    </div>
  );
}

function Choice<K extends 'boot' | 'quality'>({ k, label, hint, options }: { k: K; label: string; hint: string; options: ReadonlyArray<Settings[K]> }) {
  const value = useView((v) => v.settings[k]);
  return (
    <div className="set-row">
      <span className="t-body">{label}</span>
      <span className="hint t-micro">{hint}</span>
      <select aria-label={label} value={value} onChange={(e) => setSetting(k, e.target.value as Settings[K])}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function SettingsSheet() {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref);
  const t = SETTING_TEXT;
  return (
    <div ref={ref} className="layer-sheet" role="dialog" aria-label="Settings" tabIndex={-1}>
      <div className="row2" style={{ marginBottom: 12 }}>
        <h2 className="t-label" style={{ margin: 0 }}>{t.title}</h2>
        <button type="button" className="t-micro c-slag" onClick={() => closeOverlay('settings')}>Esc close</button>
      </div>
      <Choice k="boot" label={t.boot} hint={t.bootHint} options={['full', 'short', 'off']} />
      <Toggle k="alert" label={t.alert} hint={t.alertHint} />
      <Toggle k="geiger" label={t.geiger} hint={t.geigerHint} />
      <Toggle k="mute" label={t.mute} hint={t.muteHint} />
      <Toggle k="notifications" label={t.notifications} hint={t.notificationsHint} />
      <Toggle k="comfort" label={t.comfort} hint={t.comfortHint} />
      <Choice k="quality" label={t.quality} hint={t.qualityHint} options={['auto', 'Umbra', 'Corona', 'Penumbra']} />
      <Toggle k="scene" label={t.scene} hint={t.sceneHint} />
      <Toggle k="idleDrift" label={t.idleDrift} hint={t.idleDriftHint} />
      <Toggle k="signalRoutes" label="Signal routes" hint="Activity links from the core to working projects" />
      <Toggle k="auroras" label="Polar lights" hint="Atmospheric ribbons follow each world's activity" />
      <Toggle k="singleKeys" label={t.singleKeys} hint={t.singleKeysHint} />
      <Toggle k="longArm" label={t.longArm} hint={t.longArmHint} />
    </div>
  );
}

export function registerCoreOverlays(): void {
  registerOverlay({ id: 'observatory', layer: 'sheet', modal: true, Component: Observatory });
  registerOverlay({ id: 'project', layer: 'sheet', modal: true, Component: ProjectWindow });
  registerOverlay({ id: 'find', layer: 'palette', modal: true, Component: FindPalette });
  registerOverlay({ id: 'laws', layer: 'dialog', modal: true, Component: LawsDialog });
  registerOverlay({ id: 'settings', layer: 'sheet', modal: true, Component: SettingsSheet });
}

/** Section 5.5. Motion makes each wrapper its own stacking context, so the layer sits here and not on the child. */
const LAYER_Z = { sheet: 40, docket: 50, palette: 60, dialog: 80 } as const;

export function OverlayHost() {
  const overlays = useView((v) => v.overlays);
  return (
    <AnimatePresence>
      {overlays.map((o) => {
        const def = overlayDef(o.id);
        if (!def) return null;
        const { Component } = def;
        return (
          <motion.div key={o.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }} style={{ position: 'absolute', inset: 0, zIndex: LAYER_Z[def.layer], pointerEvents: 'none' }}>
            <div style={{ pointerEvents: 'auto' }}><Component arg={o.arg} /></div>
          </motion.div>
        );
      })}
    </AnimatePresence>
  );
}
