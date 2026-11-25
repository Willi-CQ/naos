// The shell, section 8.1: instrument below 1024, compact, regular, wide, short, cinema. Rails sit on opaque void and the free rect
// is the canvas. `SceneSlot` mounts the WebGL Stage over the Plate, which stays behind it as the fallback.
import { lazy, Suspense, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Plate, SkyStrip } from '../plate/Plate.tsx';
import { COPY } from '../store/strings.ts';
import { resize, setScene, toggleRailOverlay, useModel, useNaos, useShell, useView } from '../store/store.ts';
import { BottomStrip } from './BottomStrip.tsx';
import { FleetBar } from './FleetBar.tsx';
import { CameraControls } from './CameraControls.tsx';
import { DemoControls } from './DemoControls.tsx';
import { ObservatoryDock } from './Observatory.tsx';
import { Manifest, RailStrip } from './Manifest.tsx';
import { Masthead } from './Masthead.tsx';
import { Announcer, SceneMirror, useTitle } from './Mirror.tsx';
import { OverlayHost } from './overlays.tsx';
import { CraftPanel, SkyPanel, WorldPanel } from './panels.tsx';
import { CinemaNeeds, Rail, RailLower } from './Rail.tsx';
import { gateWhy, retryGate, webglUsable } from './sceneGate.ts';

const Live = lazy(() => import('../scene/Live.tsx'));

/** The slot's own fade out, 400 ms in the stylesheet, before the Stage is taken down. */
const FADE_OUT_MS = 420;
const GATE_RETRY_MS = 1500;

function LeftRail() {
  const sky = useView((v) => v.sky);
  const level = useView((v) => v.level);
  const worldId = useView((v) => v.worldId);
  const selected = useNaos((s) => s.channel.nodeId);
  const world = useModel((m) => m.allWorlds.find((w) => w.worldId === worldId));
  const craft = useModel((m) => (selected ? m.crafts[selected] : undefined));
  if (sky) return <SkyPanel />;
  if (level === 'craft' && craft) return <CraftPanel craft={craft} />;
  if (level !== 'system' && world) return <WorldPanel world={world} />;
  return <Manifest />;
}

function Almanac() {
  const sentences = useModel((m) => m.almanac);
  const sky = useView((v) => v.sky);
  if (sentences.length === 0 || sky) return null;
  return <div className="almanac t-display" role="note">{sentences.map((s) => <div key={s}>{s}</div>)}</div>;
}

function KernelAbsent() {
  const link = useNaos((s) => s.link);
  if (link.everUp || link.status !== 'lost') return null;
  return (
    <div className="notice t-body">
      <div className="t-title">{COPY.kernelAbsent}</div>
      <span className="t-code">naos up</span>
      <button type="button" className="t-micro" onClick={() => void navigator.clipboard?.writeText('naos up')}>Copy</button>
    </div>
  );
}

function Banners() {
  const lost = useNaos((s) => s.link.status === 'lost' && s.link.everUp);
  const limit = useModel((m) => m.sun.status === 'rejected');
  const resets = useModel((m) => m.sun.resets);
  const scene = useNaos((s) => s.scene.context === 'lost');
  return (
    <>
      {lost ? <div className="banner t-body" data-kind="kernel-lost" role="alert">{COPY.kernelLost}</div> : null}
      {!lost && scene ? <div className="banner t-body" data-kind="scene-lost" role="alert">Scene lost, recovering</div> : null}
      {!lost && !scene && limit ? <div className="banner t-body" data-kind="limit">Claude plan limit reached, resets {resets}. Other clients continue independently.</div> : null}
    </>
  );
}

/**
 * The DOM paints first and the chunk loads after it, so nothing here delays the rails. The slot stays empty when the scene is off or
 * WebGL is missing, and then the browser never fetches three. The Plate behind it is the fallback for all of that.
 */
function SceneSlot() {
  const on = useView((v) => v.settings.scene);
  const sky = useView((v) => v.sky);
  const retired = useNaos((s) => s.scene.retired);
  const live = useNaos((s) => s.scene.mounted);
  const [asked, ask] = useState(0);
  const wanted = on && !retired && webglUsable();
  const [present, setPresent] = useState(false);

  // An empty slot always says why, and a failure that can pass is asked about again.
  useEffect(() => {
    if (!on || retired || wanted) return undefined;
    const why = gateWhy();
    setScene({ why });
    if (why) console.warn(`NAOS scene off: ${why}`);
    const again = window.setTimeout(() => { if (retryGate()) ask((n) => n + 1); }, GATE_RETRY_MS);
    return () => clearTimeout(again);
  }, [asked, on, retired, wanted]);

  useEffect(() => {
    if (wanted) {
      const idle = window.requestIdleCallback?.(() => setPresent(true), { timeout: 300 });
      const fallback = idle === undefined ? window.setTimeout(() => setPresent(true), 50) : 0;
      return () => { if (idle !== undefined) window.cancelIdleCallback(idle); clearTimeout(fallback); };
    }
    const off = window.setTimeout(() => setPresent(false), FADE_OUT_MS);
    return () => clearTimeout(off);
  }, [wanted]);

  return (
    <div id="scene-slot" className="scene-slot" data-live={live && wanted} data-sky={sky} aria-hidden="true">
      {present ? <Suspense fallback={null}><Live /></Suspense> : null}
    </div>
  );
}

function Free() {
  const sky = useView((v) => v.sky);
  return (
    <main className="free" aria-label="Sky">
      <Plate />
      <SceneSlot />
      <FleetBar />
      <CameraControls />
      <DemoControls />
      <ObservatoryDock />
      {sky ? <SkyStrip /> : null}
      <Almanac />
      <KernelAbsent />
    </main>
  );
}

export function AppShell() {
  const shell = useShell((s) => s);
  const lost = useNaos((s) => s.link.status === 'lost');
  const comfort = useView((v) => v.settings.comfort);
  const cinema = useView((v) => v.cinema);
  const railOverlay = useView((v) => v.railOverlay);
  const collapsed = useView((v) => v.railCollapsed);
  const focusWorldId = useView((v) => !v.sky && v.level !== 'system' ? v.worldId : null);
  const focusAccent = useNaos((s) => focusWorldId ? s.fleet.worlds[focusWorldId]?.identity?.accent : undefined);
  useTitle();

  useEffect(() => {
    const onResize = () => resize(window.innerWidth, window.innerHeight);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const vars = {
    '--left': `${shell.left}px`, '--right': `${shell.right}px`, '--top': `${shell.top}px`, '--bot': `${shell.bot}px`,
    '--channel': `${shell.channel}px`, '--docket': `${shell.docket}px`, '--sheet': `${shell.sheet}px`,
    '--focus-accent': focusAccent ?? '#8ab9bb',
  } as CSSProperties;
  const classes = ['shell', `cls-${shell.cls}`];
  if (shell.short) classes.push('short');
  if (shell.instrument) classes.push('instrument');
  if (cinema) classes.push('cinema');
  if (comfort) classes.push('comfort');
  if (lost) classes.push('lost');

  if (shell.instrument) {
    return (
      <div className={classes.join(' ')} style={vars}>
        <a className="skip" href="#sec-needs">{COPY.skip}</a>
        <Masthead />
        <Rail />
        <div className="left"><Manifest /></div>
        <div className="right"><RailLower /></div>
        <SceneMirror />
        <BottomStrip />
        <Banners />
        <OverlayHost />
        <Announcer />
      </div>
    );
  }

  const rail = shell.strip || collapsed;
  return (
    <div className={classes.join(' ')} data-focus={focusWorldId !== null} style={vars}>
      <a className="skip" href="#sec-needs">{COPY.skip}</a>
      <Masthead />
      {rail ? <RailStrip onOpen={toggleRailOverlay} /> : <nav className="left" aria-label="Manifest"><LeftRail /></nav>}
      <Free />
      <SceneMirror />
      <Rail />
      <BottomStrip />
      {rail && railOverlay ? <div className="rail-overlay" style={{ top: shell.top, bottom: shell.bot }}><LeftRail /></div> : null}
      <CinemaNeeds />
      <Banners />
      <OverlayHost />
      <Announcer />
    </div>
  );
}
