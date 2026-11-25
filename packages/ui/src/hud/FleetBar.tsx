import { CLIENT_NAME, SESSION_CLIENTS } from '@naos/protocol';
import { flyHome, setClientFilter, useModel, useNaos, useView } from '../store/store.ts';
import type { SessionClient } from '@naos/protocol';

export function FleetBar() {
  const crafts = useModel((m) => m.crafts);
  const sun = useModel((m) => m.sun);
  const now = useModel((m) => m.now);
  const plans = useNaos((s) => s.fleet.clientPlans);
  const planets = useNaos((s) => s.scene.planets);
  const worlds = useModel((m) => m.allWorlds);
  const filter = useView((v) => v.clientFilter);
  const level = useView((v) => v.level);
  const worldId = useView((v) => v.worldId);
  const sky = useView((v) => v.sky);
  const world = worlds.find((w) => w.worldId === worldId);
  const sessions = Object.values(crafts).filter((c) => c.kind === 'main' && c.live);
  const quota = (client: SessionClient): { left: number | null; title: string } => {
    const plan = plans?.[client];
    const stale = client === 'claude-code' ? sun.stale : !plan?.asOf || now - plan.asOf > 600000 || (plan.resetsAt.fiveHour !== null && now >= plan.resetsAt.fiveHour);
    const left = stale ? null : client === 'claude-code' ? sun.fiveLeft : plan?.fiveHourLeft ?? null;
    return { left, title: `${CLIENT_NAME[client]} · ${left === null ? 'Quota not reported or stale' : `${Math.round(left * 100)}% of the 5-hour window left`}` };
  };
  if (sky) return null;
  return (
    <>
      <div className="fleet-heading">
        <div className="fleet-eyebrow"><span className="live-dot" />LIVE OPERATIONS{level !== 'system' ? <button type="button" onClick={flyHome}>↗ All projects</button> : null}</div>
        <h1>{level === 'system' ? 'The fleet' : world?.name ?? 'Deep space'}</h1>
        <p>{level === 'system' ? `${worlds.length} projects · ${sessions.length} sessions across your machine` : `${level === 'craft' ? 'Session' : 'Project'} orbit · ${sessions.filter((c) => c.worldId === worldId).length} sessions`}</p>
        {planets && planets.ready < planets.total ? <p className="world-progress">Mapping worlds · {planets.ready} / {planets.total}</p> : null}
      </div>
      <div className="client-filters" role="group" aria-label="Filter sessions by client">
        <button type="button" aria-pressed={filter === 'all'} onClick={() => setClientFilter('all')}>All<span>{sessions.length}</span></button>
        {SESSION_CLIENTS.map((client) => <button key={client} type="button" data-client={client} title={quota(client).title} aria-pressed={filter === client} onClick={() => setClientFilter(client)}>
          {client === 'claude-code' ? 'Claude' : CLIENT_NAME[client]}<span>{sessions.filter((c) => c.client === client).length}</span>
          {quota(client).left !== null ? <i className="client-quota" aria-hidden="true" style={{ width: `${quota(client).left! * 100}%` }} /> : null}
        </button>)}
      </div>
      <div className="orbit-hint"><span>DRAG <b>Orbit</b></span><span>SCROLL <b>Explore</b></span><button type="button" onClick={flyHome}>0 <b>Home</b></button></div>
    </>
  );
}
