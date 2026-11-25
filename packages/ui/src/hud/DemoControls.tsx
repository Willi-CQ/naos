import { setScene, useNaos, useView } from '../store/store.ts';

export function DemoControls() {
  const mounted = useNaos((s) => s.scene.mounted);
  const ready = useNaos((s) => s.link.status === 'up' && Object.values(s.fleet.worlds).some((w) => w.kind === 'repo'));
  const demo = useNaos((s) => s.scene.demo);
  const sky = useView((v) => v.sky);
  const level = useView((v) => v.level);
  if (!mounted || sky || level === 'craft') return null;
  const start = () => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    setScene({ demo: { active: true, paused: reduced, slow: true, run: (demo?.run ?? 0) + 1, elapsed: reduced ? 10 : 0, phase: reduced ? 'Static preview' : 'New chat' } });
  };
  return <div className="demo-controls" data-active={demo?.active ?? false}>
    {demo?.active ? <>
      <div className="demo-caption" role="status"><b>VISUAL DEMO</b><span>{demo.phase}</span></div>
      <div className="demo-actions">
        <button type="button" data-demo="pause" disabled={demo.phase === 'Static preview' || demo.phase === 'Complete'} onClick={() => setScene({ demo: { ...demo, paused: !demo.paused } })}>{demo.paused ? 'Play' : 'Pause'}</button>
        <button type="button" data-demo="speed" aria-pressed={demo.slow} onClick={() => setScene({ demo: { ...demo, slow: !demo.slow } })}>{demo.slow ? '0.5×' : '1×'}</button>
        <button type="button" data-demo="replay" onClick={start}>Replay</button>
        <button type="button" data-demo="stop" aria-label="Close visual demo" onClick={() => setScene({ demo: { ...demo, active: false } })}>Close</button>
      </div>
    </> : <button type="button" data-demo="start" disabled={!ready} title="Preview ship launches, subagents, docking and landings. Starts no real agents." onClick={start}>▷ Ship demo</button>}
  </div>;
}
