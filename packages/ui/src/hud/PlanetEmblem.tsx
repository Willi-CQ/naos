import { useId } from 'react';
import type { PlanetGenome } from '@naos/protocol';

/** A lightweight atlas illustration in the planet's own palette, independent of WebGL availability. */
export function PlanetEmblem({ genome: g }: { genome: PlanetGenome }) {
  const id = useId().replaceAll(':', '');
  const fluid = g.archetype === 'gas' || g.archetype === 'ice-giant' || g.archetype === 'shrouded';
  const terrain = Array.from({ length: 5 }, (_, i) => {
    const angle = (i * 2.4 + g.seed % 10), x = 120 + Math.cos(angle) * 30, y = 90 + Math.sin(angle) * 30;
    return <ellipse key={i} cx={x} cy={y} rx={19 + i * 3} ry={10 + i * 2} fill={i % 2 ? g.palette.high : g.palette.low} opacity=".65" transform={`rotate(${i * 61} ${x} ${y})`} />;
  });
  return <svg className="planet-emblem" viewBox="0 0 240 180" aria-hidden="true">
    <defs>
      <radialGradient id={`${id}air`}><stop offset=".6" stopColor={g.atmosphere.color} stopOpacity=".22" /><stop offset="1" stopColor={g.atmosphere.color} stopOpacity="0" /></radialGradient>
      <radialGradient id={`${id}shade`} cx="28%" cy="25%" r="80%"><stop stopColor="#fff" stopOpacity=".3" /><stop offset=".4" stopColor="#000" stopOpacity="0" /><stop offset=".83" stopColor="#02060b" stopOpacity=".75" /><stop offset="1" stopColor="#010307" /></radialGradient>
      <filter id={`${id}terrain`} x="-30%" y="-30%" width="160%" height="160%"><feTurbulence type="fractalNoise" baseFrequency={fluid ? '.018 .1' : '.035'} numOctaves="3" seed={g.seed % 997} /><feDisplacementMap in="SourceGraphic" scale={fluid ? '13' : '30'} /></filter>
      <clipPath id={`${id}clip`}><circle cx="120" cy="90" r="56" /></clipPath>
      <clipPath id={`${id}front`}><rect x="0" y="90" width="240" height="100" /></clipPath>
    </defs>
    <circle cx="120" cy="90" r="86" fill={`url(#${id}air)`} />
    {g.rings ? <ellipse cx="120" cy="90" rx="98" ry="24" fill="none" stroke={g.rings.color} strokeWidth="8" opacity=".3" transform="rotate(-19 120 90)" /> : null}
    <circle cx="120" cy="90" r="56" fill={g.palette.mid} />
    <g clipPath={`url(#${id}clip)`}>
      <g filter={`url(#${id}terrain)`}>{fluid ? Array.from({ length: 9 }, (_, i) => <path key={i} d={`M50 ${42 + i * 12} Q120 ${29 + i * 12} 190 ${49 + i * 12}`} fill="none" stroke={i % 2 ? g.palette.low : g.palette.high} strokeWidth={i % 3 + 5} opacity=".55" />) : terrain}</g>
      {g.oceans.coverage > .35 ? <path d="M70 88 Q98 60 113 95 T164 97 L172 150 H60Z" fill={g.oceans.deep} opacity=".7" filter={`url(#${id}terrain)`} /> : null}
      <circle cx="120" cy="90" r="56" fill={`url(#${id}shade)`} />
    </g>
    <circle cx="120" cy="90" r="56" fill="none" stroke={g.atmosphere.color} strokeWidth="1.2" opacity=".6" />
    {g.rings ? <g transform="rotate(-19 120 90)"><ellipse clipPath={`url(#${id}front)`} cx="120" cy="90" rx="98" ry="24" fill="none" stroke={g.rings.color} strokeWidth="8" opacity=".62" /><ellipse cx="120" cy="90" rx="105" ry="28" fill="none" stroke={g.rings.color} strokeWidth=".5" opacity=".3" /></g> : null}
  </svg>;
}
