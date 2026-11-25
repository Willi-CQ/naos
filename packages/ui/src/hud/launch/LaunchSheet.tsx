// LaunchSheet, DESIGN 4.9 and 8.5. The command line is the whole form, and every row below shows what was parsed and writes the line
// again when edited. Preflight shows only what the kernel returns: no spawn, no model call.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKey } from 'react';
import { DEFAULT_LIMITS } from '@naos/protocol';
import type { PreflightResult, SpawnSpec } from '@naos/protocol';
import { command } from '../../store/commands.ts';
import { closeOverlay, say, useModel, useNaos, useView } from '../../store/store.ts';
import { HoldButton } from '../docket/HoldButton.tsx';
import { createHold } from '../docket/hold.ts';
import { useDialogFocus } from '../focus.ts';
import { finishOverlay, useOpening } from '../sheets/overlay.ts';
import { composeLine, parseLaunch, resolve, specOf, terminalLine } from './grammar.ts';
import type { Head, LaunchContext, Parsed, Resolved } from './grammar.ts';
import { ProjectWindow } from '../project/ProjectWindow.tsx';

const TRUST_MS = 700;
const PREFLIGHT_DEBOUNCE_MS = 180;

function CommandLine({ value, parsed, onChange }: { value: string; parsed: Parsed; onChange(v: string): void }) {
  const parts: Array<{ text: string; kind: string }> = [];
  let at = 0;
  for (const t of parsed.tokens) {
    if (t.start > at) parts.push({ text: value.slice(at, t.start), kind: 'gap' });
    parts.push({ text: value.slice(t.start, t.end), kind: t.kind });
    at = t.end;
  }
  if (at < value.length) parts.push({ text: value.slice(at), kind: 'gap' });
  return (
    <div className="lx-line">
      <span className="lx-prompt t-code" aria-hidden="true">{'>'}</span>
      <div className="lx-edit t-code">
        <div className="lx-mirror" aria-hidden="true">{parts.map((p, i) => <span key={i} data-kind={p.kind}>{p.text}</span>)}{'​'}</div>
        <textarea
          data-autofocus className="lx-input" aria-label="Launch command" spellCheck={false} autoComplete="off" rows={1} value={value} placeholder="@world #profile $2 x2 moon prompt"
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="lx-row"><span className="k">{k}</span><div className="v t-body">{children}</div></div>;
}

const MODE_TEXT: Record<string, string> = {
  default: 'approvals on Bash and PowerShell',
  plan: 'plans first, writes nothing until approved',
  dontAsk: 'read-only tools, nothing asks',
  auto: 'auto mode',
};

function Preflight({ result, checking }: { result: PreflightResult | null; checking: boolean }) {
  const state = checking ? 'checking' : result === null ? 'idle' : result.blocked ? 'blocked' : result.warnings.length > 0 ? 'warn' : 'ok';
  return (
    <section className="lx-sec" aria-label="Preflight" data-state={state}>
      <div className="dk-sec-head t-label"><span>PREFLIGHT</span><span className="t-micro c-slag" style={{ textTransform: 'none', fontWeight: 400 }}>{state === 'checking' ? 'checking' : 'no spawn, no model call'}</span></div>
      {result === null ? <p className="t-body c-slag">Name a world to check it.</p> : (
        <>
          <Row k="SOURCES">{result.sources.length > 0 ? result.sources.join('  ') : 'none'}<span className="c-slag">   from resolveSettings</span></Row>
          <Row k="HOOKS">{result.hooks.length > 0 ? `${result.hooks.join('  ')}: run at spawn, outside approvals` : 'none'}</Row>
          <Row k="CWD">{result.cwd.exists ? 'exists' : 'missing'}{result.cwd.isGit ? ', git repo' : ''}{result.cwd.worktreePossible ? ', worktree possible' : ''}</Row>
          <Row k="ADMISSION">running {result.admission.running} of {result.admission.runningLimit}   alive {result.admission.alive} of {result.admission.aliveLimit}{result.admission.frozen ? `, frozen: ${result.admission.frozen}` : ''}</Row>
          <Row k="WINDOW">{result.plan.fiveHourUsedPercent === null ? '5H unknown' : `5H ${result.plan.fiveHourUsedPercent} % used`}, launch freezes at {result.plan.freezeAtPercent} %</Row>
          <Row k="CONNECTORS">off for every managed agent</Row>
          {result.warnings.map((w) => <p key={w} className="t-body lx-warn">{w}</p>)}
          {result.world.trusted && result.loadout ? (
            <>
              <div className="dk-sec-head t-label" style={{ marginTop: 10 }}><span style={{ textTransform: 'none' }}>LOADOUT, measured at last spawn in this repo</span><span className="t-micro c-slag" style={{ textTransform: 'none', fontWeight: 400 }}>trusted repos only</span></div>
              <p className="t-body c-paper" style={{ margin: 0 }}>skills {result.loadout.skills}   MCP servers {result.loadout.mcpServers}   context about {Math.round(result.loadout.contextTokens / 1000)}k tokens at start</p>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}

function TrustHold({ world, holding, onDone }: { world: { worldId: string; name: string }; holding: boolean; onDone(): void }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="lx-trust">
      <p className="t-body c-bone">Unknown world: no settings, strict MCP, no project hooks.</p>
      <div className="lx-trust-row">
        <span className="t-body c-paper">Hold ALT+T to trust: its hooks and MCP servers then run at spawn.</span>
        <HoldButton ms={TRUST_MS} className="dk-btn dk-small t-body" holding={holding} keys="Alt+T" label={`Trust ${world.name}`} onDone={onDone} onRoute={() => setConfirming(true)}>Trust, hold</HoldButton>
      </div>
      {confirming ? (
        <div className="hand-actions" style={{ justifyContent: 'flex-start' }}>
          <button type="button" className="dk-btn dk-small t-body" onClick={() => setConfirming(false)}>Cancel</button>
          <button type="button" className="dk-btn dk-small t-body" data-danger="true" onClick={onDone}>Trust {world.name}</button>
        </div>
      ) : null}
    </div>
  );
}

function ParsedRows({ parsed, resolved, ctx, head, setHead, moon, setMoon, preflight, mission, setMission }: {
  parsed: Parsed; resolved: Resolved; ctx: LaunchContext; head: Head; setHead(h: Head): void; moon: boolean; setMoon(v: boolean): void; preflight: PreflightResult | null;
  mission: LaunchContext['mission']; setMission(m: LaunchContext['mission']): void;
}) {
  const worlds = useModel((m) => m.allWorlds);
  const profiles = useNaos((s) => s.fleet.profiles);
  const profile = profiles.find((p) => p.name === resolved.profile);
  const world = worlds.find((w) => w.worldId === ctx.world?.worldId);
  const field = (name: string, value: string, change: (n: number) => void) => (
    <input className="lx-num t-num" aria-label={name} inputMode="decimal" defaultValue={value} key={value} onBlur={(e) => { const n = Number(e.target.value); if (n > 0) change(n); }} />
  );
  return (
    <section className="lx-sec" aria-label="Parsed">
      <Row k="WORLD">
        <select className="lx-sel t-body" aria-label="World" value={world?.name ?? ''} onChange={(e) => setHead({ ...head, world: e.target.value || null })}>
          <option value="">{ctx.world ? '' : 'none'}</option>
          {worlds.map((w) => <option key={w.worldId} value={w.name}>{w.name}</option>)}
        </select>
        {world ? <span className="c-bone">   {world.path}{world.git ? '   git repo' : ''}{ctx.world?.trusted ? '   trusted' : '   unknown'}</span> : null}
      </Row>
      <Row k="PROFILE">
        <select className="lx-sel t-body" aria-label="Profile" value={resolved.profile} onChange={(e) => setHead({ ...head, profile: e.target.value })}>
          {profiles.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
        </select>
        {profile ? <span className="c-bone">   permission mode {profile.permissionMode}, {MODE_TEXT[profile.permissionMode] ?? ''}</span> : null}
      </Row>
      <Row k="MODEL">{preflight?.model ?? profile?.model ?? 'unknown'}{profile?.effort ? `   effort ${profile.effort}` : ''}</Row>
      <Row k="BUDGET">
        {field('Budget per craft', String(resolved.budgetUsd ?? ''), (n) => setHead({ ...head, budgetUsd: n }))}
        <span className="c-bone">   each, soft cap, can overshoot by one API call.{resolved.budgetUsd !== null && resolved.copies > 1 ? ` Tree $${(resolved.budgetUsd * resolved.copies).toFixed(2)}` : ''}</span>
      </Row>
      <Row k="COPIES">{field('Copies', String(resolved.copies), (n) => setHead({ ...head, copies: Math.floor(n) }))}<span className="c-bone">   as a salvo, inside the spawn limits</span></Row>
      <Row k="MOON">
        <button type="button" className="lx-switch t-body" role="switch" aria-checked={moon} aria-label="New worktree per craft" onClick={() => setMoon(!moon)}>{moon ? 'on' : 'off'}</button>
        <span className="c-bone">   {moon ? 'new worktree per craft, branch agent/<id>' : 'runs in the world folder'}</span>
      </Row>
      {moon ? <Row k=" "><span className="c-bone">Shell writes are not confined, so Bash stays on approval.</span></Row> : null}
      {mission ? (
        <>
          <Row k="TREE BUDGET">{field('Tree budget', String(mission.treeBudgetUsd), (n) => setMission({ ...mission, treeBudgetUsd: n }))}<span className="c-bone">   for the whole mission</span></Row>
          <Row k="CHILD LIMIT">{field('Child limit', String(mission.childLimit), (n) => setMission({ ...mission, childLimit: Math.floor(n) }))}<span className="c-bone">   per agent</span></Row>
          <Row k="DEPTH">{field('Depth', String(mission.depth), (n) => setMission({ ...mission, depth: Math.floor(n) }))}<span className="c-bone">   {DEFAULT_LIMITS.livePerTree} live per tree, {DEFAULT_LIMITS.spawnsPerTreePerMinute} spawns a minute</span></Row>
        </>
      ) : null}
      {parsed.prompt ? null : <p className="t-micro c-slag">rest of the line is the prompt</p>}
    </section>
  );
}

export function LaunchSheet({ arg }: { arg: unknown }) {
  const opening = useOpening('launch');
  const selected = useView((v) => v.selectedWorld ?? v.worldId);
  const world = useModel((m) => m.allWorlds.find((w) => w.worldId === selected)?.worldId ?? m.allWorlds[0]?.worldId);
  if (arg !== 'mission' && arg !== 'legacy') return <ProjectWindow arg={world} overlayId="launch" />;
  return <LaunchForm key={opening} arg={arg} />;
}

function LaunchForm({ arg }: { arg: unknown }) {
  const missionMode = arg === 'mission';
  const worlds = useModel((m) => m.allWorlds);
  const profiles = useNaos((s) => s.fleet.profiles);
  const fleetWorlds = useNaos((s) => s.fleet.worlds);
  const selected = useView((v) => v.selectedWorld ?? v.worldId);
  const selectedCraftWorld = useNaos((s) => (s.view.selected ? s.model.crafts[s.view.selected]?.worldId ?? null : null));
  const lost = useNaos((s) => s.link.status !== 'up');
  const [line, setLine] = useState(missionMode ? '#orchestrator ' : '');
  const [moonOverride, setMoonOverride] = useState<boolean | null>(null);
  const [mission, setMission] = useState<LaunchContext['mission']>(
    missionMode ? { treeBudgetUsd: 8, childLimit: DEFAULT_LIMITS.childrenPerAgent, depth: DEFAULT_LIMITS.depth } : null,
  );
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [phase, setPhase] = useState<'drafting' | 'launching' | 'queued'>('drafting');
  const [failure, setFailure] = useState<string | null>(null);
  const [trustHolding, setTrustHolding] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref);

  const vocabulary = useMemo(() => ({ worlds: worlds.map((w) => w.name), profiles: profiles.map((p) => p.name) }), [worlds, profiles]);
  const parsed = useMemo(() => parseLaunch(line, vocabulary), [line, vocabulary]);
  const namedId = parsed.worldKnown ? worlds.find((w) => w.name === parsed.world)?.worldId : undefined;
  const worldId = parsed.world !== null ? namedId : selected ?? selectedCraftWorld ?? undefined;
  const raw = worldId === undefined ? undefined : fleetWorlds[worldId];
  const name = worlds.find((w) => w.worldId === worldId)?.name ?? '';
  // The Belt is not on this list, so a selected craft out there does not make it the place to launch into.
  const world = raw && name ? { worldId: raw.worldId, name, trusted: raw.trusted } : null;
  const worldKey = world ? `${world.worldId}:${world.trusted}` : '';
  const ctx = useMemo<LaunchContext>(() => ({ world, profiles, mission, moonOverride }), [worldKey, profiles, mission, moonOverride]);
  const resolved = useMemo(() => resolve(parsed, ctx), [parsed, ctx]);
  const spec = useMemo(() => specOf(parsed, resolved, ctx), [parsed, resolved, ctx]);
  const specKey = JSON.stringify(spec);
  const attempt = useRef({ specKey, key: crypto.randomUUID() });
  if (attempt.current.specKey !== specKey) attempt.current = { specKey, key: crypto.randomUUID() };

  useEffect(() => {
    if (spec.worldId === undefined) { setPreflight(null); setChecking(false); return undefined; }
    setChecking(true);
    let live = true;
    const timer = setTimeout(() => {
      void command('preflight', { spec }).then((res) => {
        if (!live) return;
        setChecking(false);
        setPreflight(res.ok ? res.result : null);
        if (!res.ok) setFailure(res.error.message);
      });
    }, PREFLIGHT_DEBOUNCE_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [specKey]);

  const head: Head = { world: parsed.world, profile: parsed.profile, budgetUsd: parsed.budgetUsd, copies: parsed.copies, moon: parsed.moon };
  const setHead = (next: Head): void => setLine(composeLine(next, parsed.prompt));

  const frozen = preflight?.admission.frozen ?? null;
  const reason = resolved.blocked ?? (lost ? 'Disabled: the kernel link is lost.' : preflight?.blocked ?? null);
  const canQueue = resolved.blocked === null && !lost && frozen !== null;

  const go = async (extra: Pick<SpawnSpec, 'mode' | 'queue'>): Promise<void> => {
    if (phase === 'launching') return;
    if (reason !== null && !(extra.queue === true && canQueue)) { say(reason); return; }
    setPhase('launching');
    setFailure(null);
    const res = await command('agent.spawn', { spec: specOf(parsed, resolved, ctx, { ...extra, idempotencyKey: attempt.current.key }) });
    if (!res.ok) {
      setPhase('drafting');
      setFailure(res.error.message);
      return;
    }
    if (res.result.queued > 0) {
      setPhase('queued');
      say(`${res.result.queued} queued on the Pad`);
      return;
    }
    finishOverlay('launch');
    say(`Launched ${res.result.agentIds.length}`);
  };

  const trust = async (): Promise<void> => {
    if (!world) return;
    const res = await command('world.trust', { worldId: world.worldId, trusted: true });
    if (res.ok) say(`${world.name} trusted`);
    else setFailure(res.error.message);
  };
  const latestTrust = useRef(trust);
  latestTrust.current = trust;
  const trustHold = useMemo(() => createHold(TRUST_MS, () => { void latestTrust.current(); }, setTrustHolding), []);

  const onKey = (e: ReactKey<HTMLElement>): void => {
    // AltGr arrives as Ctrl+Alt on Windows, and `@` must reach the field untouched.
    const altGr = e.ctrlKey && e.altKey;
    if (altGr) return;
    if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); void go({}); }
    else if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); void go({ mode: 'plan-first' }); }
    else if (e.key === 'Enter' && e.altKey) { e.preventDefault(); void go({ mode: 'read-only' }); }
    else if (e.code === 'KeyT' && e.altKey) {
      e.preventDefault();
      if (!e.repeat && preflight !== null && !preflight.world.trusted) trustHold.start();
    }
  };
  useEffect(() => {
    const up = (e: KeyboardEvent): void => { if (e.code === 'KeyT' || e.key === 'Alt') trustHold.cancel(); };
    window.addEventListener('keyup', up);
    window.addEventListener('blur', trustHold.cancel);
    return () => {
      trustHold.cancel();
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', trustHold.cancel);
    };
  }, [trustHold]);

  const moon = resolved.moon;
  const copies = resolved.copies;
  const state = phase !== 'drafting' ? phase : reason !== null ? 'blocked' : 'drafting';
  return (
    <div ref={ref} className="layer-sheet lx" role="dialog" aria-label={missionMode ? 'Start a mission' : 'Launch'} tabIndex={-1} data-state={state} onKeyDown={onKey}>
      <div className="row2 lx-head">
        <h2 className="t-label c-paper" style={{ margin: 0 }}>{missionMode ? 'MISSION' : 'LAUNCH'}</h2>
        <button type="button" className="t-micro c-slag" onClick={() => closeOverlay('launch')}>ESC cancel</button>
      </div>
      <CommandLine value={line} parsed={parsed} onChange={setLine} />
      <ParsedRows parsed={parsed} resolved={resolved} ctx={ctx} head={head} setHead={setHead} moon={moon} setMoon={setMoonOverride} preflight={preflight} mission={mission} setMission={setMission} />
      <Preflight result={preflight} checking={checking} />
      {world && preflight && !preflight.world.trusted ? <TrustHold world={world} holding={trustHolding} onDone={() => void trust()} /> : null}
      {reason ? <p className="t-body lx-blocked" role="status">{reason}</p> : null}
      {failure ? <p className="t-body dk-error" role="alert">{failure}</p> : null}
      {phase === 'queued' ? <p className="t-body c-paper" role="status">Queued on the Pad. It starts when admission opens.</p> : null}
      <div className="lx-keys">
        <button type="button" className="dk-btn dk-small t-body" data-primary={reason === null} aria-disabled={reason !== null ? 'true' : undefined} onClick={() => void go({})}><b>CTRL+ENTER</b>{phase === 'launching' ? 'launching' : `launch ${copies}`}</button>
        <button type="button" className="dk-btn dk-small t-body" aria-disabled={reason !== null ? 'true' : undefined} onClick={() => void go({ mode: 'plan-first' })}><b>SHIFT+ENTER</b>plan first</button>
        <button type="button" className="dk-btn dk-small t-body" aria-disabled={reason !== null ? 'true' : undefined} onClick={() => void go({ mode: 'read-only' })}><b>ALT+ENTER</b>read-only</button>
        {canQueue ? <button type="button" className="dk-btn dk-small t-body" onClick={() => void go({ queue: true })}>Queue it</button> : null}
      </div>
      <div className="lx-equiv t-num-s">
        <div><span className="c-slag">terminal</span> {terminalLine(world?.name ?? null, resolved)}</div>
        <div><span className="c-slag">agent</span>    agent_spawn {'{ project, profile, budget_usd, worktree, prompt }'}</div>
      </div>
    </div>
  );
}
