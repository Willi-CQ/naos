// Stars and dust are drawn once in Canvas 2D, the rest is SVG at 4 Hz. The Sky and the fallback share the same chart and lens equation.
import { memo, useEffect, useMemo, useRef } from 'react';
import type { HistoryDigest, Salvo } from '@naos/protocol';
import { dayHeights, jitter, skySpokes, skyStars, spokeHalfDeg } from '../store/sky.ts';
import { COPY } from '../store/strings.ts';
import { webglUsable } from '../hud/sceneGate.ts';
import { openOverlay, select, selectWorld, setSkyDay, useModel, useNaos, useShell, useView } from '../store/store.ts';
import { arcPath, chartOf, meridians, raOf, skyPoint } from './chart.ts';
import type { CraftMark, Well } from './chart.ts';

const TONE: Record<string, string> = {
  work: 'var(--oiii)', tool: 'var(--pearl)', need: 'var(--nad)', fault: 'var(--halpha)', rest: 'var(--bone)', idle: 'var(--slag)', done: 'var(--lamp)',
};

const DEG = Math.PI / 180;

function drawStars(canvas: HTMLCanvasElement, w: number, h: number, skyR: number, rows: readonly HistoryDigest[], salvos: readonly Salvo[], now: number, sky: boolean): void {
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const g = canvas.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, w * dpr * 0.5, h * dpr * 0.5);
  const read = getComputedStyle(canvas);
  const paper = read.getPropertyValue('--plate-paper').trim();
  const wash = read.getPropertyValue('--plate-wash').trim();
  const ink = read.getPropertyValue('--plate-ink').trim();
  const fill = g.createRadialGradient(0, 0, skyR * 0.05, 0, 0, skyR);
  fill.addColorStop(0, wash);
  fill.addColorStop(1, paper);
  g.fillStyle = fill;
  g.beginPath();
  g.arc(0, 0, skyR, 0, Math.PI * 2);
  g.fill();

  g.save();
  g.beginPath();
  g.arc(0, 0, skyR, 0, Math.PI * 2);
  g.clip();
  if (sky) {
    const haze = g.createRadialGradient(-skyR * 0.35, -skyR * 0.25, 0, -skyR * 0.35, -skyR * 0.25, skyR * 0.85);
    haze.addColorStop(0, 'rgba(64, 110, 150, 0.2)');
    haze.addColorStop(1, 'rgba(19, 25, 50, 0)');
    g.fillStyle = haze;
    g.fillRect(-skyR, -skyR, skyR * 2, skyR * 2);
  }
  g.fillStyle = ink;
  const scale = skyR / 374;
  for (const star of skyStars(rows, now)) {
    const gauss = jitter(star.seed);
    const ra = raOf(star.ageDays) + gauss() * 0.25 * DEG;
    const dec = (star.laneDeg + gauss() * (star.agent ? 6.5 : 4)) * DEG;
    const p = skyPoint(ra, dec, skyR);
    const r = (0.62 + 0.09 * Math.log2(1 + star.mb)) * scale;
    g.fillStyle = sky ? (star.agent ? '#a8d2d4' : '#ecdbbe') : ink;
    g.globalAlpha = sky ? 0.95 : 0.85;
    g.beginPath();
    g.arc(p.x, p.y, r, 0, Math.PI * 2);
    g.fill();
    // One point per 64 KiB: the dust.
    const dust = Math.min(120, Math.floor(star.mb * 16));
    g.globalAlpha = sky ? 0.26 : 0.4;
    for (let i = 0; i < dust; i += 1) {
      const q = skyPoint(ra + gauss() * 1.5 * DEG, dec + gauss() * 7 * DEG, skyR);
      g.fillRect(q.x, q.y, 0.7, 0.7);
    }
  }
  // Burned spokes: one segment per closed salvo on its day's meridian.
  g.strokeStyle = sky ? '#b3c8d5' : ink;
  g.lineWidth = 1.2;
  g.globalAlpha = 0.9;
  for (const spoke of skySpokes([salvos], now)) {
    const half = spokeHalfDeg(spoke.count);
    const a = skyPoint(raOf(spoke.ageDays), (spoke.laneDeg - half) * DEG, skyR);
    const b = skyPoint(raOf(spoke.ageDays), (spoke.laneDeg + half) * DEG, skyR);
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();
  }
  g.restore();
}

function Paper({ w, h, skyR, sky }: { w: number; h: number; skyR: number; sky: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const history = useNaos((s) => s.history);
  const salvos = useNaos((s) => s.salvos);
  const hasClock = useModel((m) => m.now > 0);
  useEffect(() => {
    const el = ref.current;
    if (el) drawStars(el, w, h, skyR, history, salvos, useNaos.getState().model.now, sky);
  }, [w, h, skyR, history, salvos, hasClock, sky]);
  return <canvas ref={ref} aria-hidden="true" />;
}

const Meridians = memo(function Meridians({ skyR, wells, day }: { skyR: number; wells: readonly Well[]; day: number | null }) {
  const lines = useMemo(() => meridians(skyR, wells), [skyR, wells]);
  return (
    <g className="plate-meridians" fill="none" stroke="var(--plate-ink)">
      {lines.map((m) => (
        <path key={m.day} d={m.d} data-selected={m.day === day} strokeWidth={m.day === day ? 1.6 : m.kind === 'day' ? 0.6 : 0.9} strokeOpacity={m.day === day ? 1 : m.kind === 'day' ? 0.55 : 0.95} />
      ))}
    </g>
  );
});

function Kite({ mark }: { mark: CraftMark }) {
  const c = mark.craft;
  const colour = TONE[c.tone] ?? 'var(--slag)';
  return (
    <g transform={`translate(${mark.x} ${mark.y}) rotate(${(mark.angle * 180) / Math.PI})`}>
      <path d="M-7 -5 L9 0 L-7 5 L-3 0 Z" fill={c.owned ? colour : 'var(--plate-ink)'} stroke={colour} strokeWidth="1.2" strokeLinejoin="round" />
    </g>
  );
}

function PlateCraft({ mark, selected, veil }: { mark: CraftMark; selected: boolean; veil: boolean }) {
  const c = mark.craft;
  const colour = c.danger ? 'var(--halpha)' : 'var(--nad)';
  return (
    <g className="hit" onClick={() => select(c.id)} data-veil={veil}>
      {mark.ring === 'well' ? <circle cx={mark.x} cy={mark.y} r={mark.ringR} fill="none" stroke={colour} strokeWidth="2" /> : null}
      {mark.ring === 'broken' ? <circle cx={mark.x} cy={mark.y} r={mark.ringR} fill="none" stroke="var(--nad)" strokeWidth="1.5" strokeDasharray={`${(mark.ringR * Math.PI * 2) / 8 - 6} 6`} /> : null}
      {mark.ring === 'hollow' ? <circle cx={mark.x} cy={mark.y} r={mark.ringR} fill="none" stroke="var(--nad)" strokeWidth="1" /> : null}
      {selected ? <rect x={mark.x - 12} y={mark.y - 12} width="24" height="24" fill="none" stroke="var(--paper)" strokeWidth="1" /> : null}
      <Kite mark={mark} />
      {mark.label ? <text x={mark.label.x} y={mark.label.y} textAnchor={mark.label.anchor}><tspan className="greek">{c.glyph}</tspan>{mark.tag ? ` ${mark.tag}` : ''}</text> : null}
    </g>
  );
}

export function Plate() {
  const model = useModel((m) => m);
  const free = useShell((s) => s.free);
  const craftK = useShell((s) => s.craftK);
  const sky = useView((v) => v.sky);
  const day = useView((v) => v.skyDay);
  const selected = useView((v) => v.selected);
  const selectedWorld = useView((v) => v.selectedWorld);
  const veil = useView((v) => v.settings.veil);
  const sceneOff = useNaos((s) => !s.view.settings.scene || s.scene.retired) || !webglUsable();
  const why = useNaos((s) => s.scene.why);
  const chart = chartOf(model, free, craftK, selected);
  const left = model.sun.fiveLeft;
  const seven = model.sun.sevenLeft;
  // The wells barely move between ticks, and rebuilding 31 paths for nothing is wasted work.
  const wellsKey = chart.wells.map((w) => `${Math.round(w.x)},${Math.round(w.y)},${Math.round(w.theta)}`).join('|');
  const wells = useMemo(() => chart.wells, [wellsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const arcDash = model.sun.stale ? '4 3' : undefined;

  return (
    <div className="plate" data-sky={sky} aria-hidden="true">
      <Paper w={free.w} h={free.h} skyR={chart.skyR} sky={sky} />
      <svg viewBox={`${-chart.cx} ${-chart.cy} ${free.w} ${free.h}`} preserveAspectRatio="xMidYMid meet">
        {sky ? <circle r={chart.skyR - 1} fill="none" stroke="#84a9bc" strokeOpacity="0.2" strokeWidth="1" /> : null}
        <Meridians skyR={chart.skyR} wells={wells} day={sky ? day : null} />
        <circle r={chart.discR} fill="var(--void)" />
        {left !== null ? <path d={arcPath(chart.discR + 7, left)} fill="none" stroke="var(--paper)" strokeWidth="2" strokeDasharray={arcDash} /> : null}
        {seven !== null ? <path d={arcPath(chart.discR + 3, seven)} fill="none" stroke="var(--bone)" strokeWidth="1" strokeDasharray={arcDash} /> : null}
        {left !== null && left > 0 ? <path d={arcPath(chart.discR + 1, Math.min(0.2, left / 3))} fill="none" stroke={left < 0.25 ? '#FFB96E' : '#9FB8FF'} strokeWidth="3" /> : null}
        {left === 0 ? <text textAnchor="middle" y={5}>RESETS {model.sun.resets}</text> : null}
        {sky ? null : (
          <>
            <g fill="none" stroke="var(--plate-ink)" strokeOpacity="0.45" strokeWidth="0.7">
              {chart.orbits.map((o) => (
                <ellipse key={o.key} cx={o.x} cy={o.y} rx={o.rx} ry={o.ry} transform={`rotate(${(o.tilt * 180) / Math.PI} ${o.x} ${o.y})`} />
              ))}
            </g>
            {chart.worlds.map((w) => (
              <g key={w.world.worldId} className="hit" onClick={() => selectWorld(w.world.worldId)} onDoubleClick={() => { if (!w.world.belt) openOverlay('project', w.world.worldId); }}>
                <circle cx={w.x} cy={w.y} r={w.r} fill="var(--void)" stroke={selectedWorld === w.world.worldId ? 'var(--paper)' : 'var(--pearl)'} strokeWidth="1.2" />
                {w.labelHidden ? null : <text x={w.labelX} y={w.labelY} textAnchor={w.anchor}>{w.world.slot} {w.world.name}</text>}
              </g>
            ))}
            {chart.beads.map((b) => <circle key={b.id} cx={b.x} cy={b.y} r="2.2" fill={TONE[b.tone]} stroke="var(--plate-ink)" strokeWidth="0.6" />)}
            {chart.crafts.map((c) => <PlateCraft key={c.craft.id} mark={c} selected={selected === c.craft.id} veil={veil} />)}
          </>
        )}
        {sky ? chart.crafts.filter((c) => c.ring === 'well').map((c) => <circle key={c.craft.id} cx={c.x} cy={c.y} r={c.ringR} fill="none" stroke="var(--nad)" strokeWidth="2" />) : null}
      </svg>
      {sceneOff ? <div className="free-caption t-micro c-bone">{COPY.sceneOff}{why ? ` Reason: ${why}.` : ''}</div> : null}
    </div>
  );
}

/** The scrubber of the Sky, section 8.5. `role="slider"`, arrow keys through the key table. */
export function SkyStrip() {
  const history = useNaos((s) => s.history);
  const now = useModel((m) => m.now);
  const day = useView((v) => v.skyDay);
  const heights = useMemo(() => dayHeights(history, now), [history, now]);
  const top = Math.max(1, ...heights);
  const label = new Date(now - day * 86_400_000).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <div className="skystrip" role="slider" tabIndex={0} aria-label="Day" aria-valuemin={0} aria-valuemax={30} aria-valuenow={30 - day} aria-valuetext={label}>
      <div className="cap t-micro"><span>horizon</span><span>now</span></div>
      <svg viewBox="0 0 310 40" preserveAspectRatio="none" aria-hidden="true">
        {heights.map((h, age) => {
          const x = 300 - age * 10 + 4;
          const height = 4 + (h / top) * 32;
          return <rect key={age} x={x} y={40 - height} width={age === day ? 4 : 2} height={height} fill={age === day ? 'var(--paper)' : 'var(--bone)'} onClick={() => setSkyDay(age)} style={{ cursor: 'pointer' }} />;
        })}
      </svg>
      <div className="cap t-micro"><span>{COPY.stripCaption}</span><span>{COPY.arrowsWeeks}</span></div>
    </div>
  );
}
