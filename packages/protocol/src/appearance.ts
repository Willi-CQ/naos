import { archetypeDefaults, hashName, validateGenome, type Hex, type PlanetArchetype, type PlanetGenome, type PlanetPalette } from './planet.ts';

export type RepoTheme = 'observatory' | 'forge' | 'intelligence' | 'knowledge' | 'systems' | 'creative' | 'unmapped';
export interface RepoIdentity { theme: RepoTheme; label: string; accent: Hex; variation: number }

interface Direction {
  label: string; kind: PlanetArchetype; palette: PlanetPalette; air: Hex;
  terms: RegExp;
}
const DIRECTIONS: Record<Exclude<RepoTheme, 'unmapped'>, Direction> = {
  observatory: { label: 'Observatory', kind: 'ice', air: '#72b9ff', terms: /benchmark|evaluat|\bevals?\b|experiment|research|analytic|metric|statistic|quant|backtest|poker|machine.learning/gi,
    palette: { low: '#102443', mid: '#3b75cf', high: '#9fcff0', accent: '#70dfef', pole: '#e4f4ff' } },
  forge: { label: 'Forge', kind: 'desert', air: '#efb96d', terms: /construct|\bbau\b|\bbim\b|\bcad\b|building|manufactur|engineering|architect/gi,
    palette: { low: '#392738', mid: '#bf7e43', high: '#e6c18c', accent: '#ffbe6a', pole: '#f0dcc4' } },
  intelligence: { label: 'Intelligence', kind: 'ice-giant', air: '#a69bff', terms: /agent|automat|orchestrat|assistant|\bllm\b|\bmcp\b|\bnaos\b|artificial.intelligence/gi,
    palette: { low: '#28234f', mid: '#7563c9', high: '#b5a9ea', accent: '#74e4da', pole: '#e3dcfa' } },
  knowledge: { label: 'Archive', kind: 'terran', air: '#63d3b6', terms: /knowledge|\brag\b|brain|notes|document|wiki|retriev|learning|personal|memory/gi,
    palette: { low: '#113e42', mid: '#398c70', high: '#a8c998', accent: '#79dfbe', pole: '#e2f3ea' } },
  systems: { label: 'Nexus', kind: 'volcanic', air: '#83bcd5', terms: /\bapi\b|backend|server|database|pipeline|infra|deploy|network|protocol|kernel|compiler/gi,
    palette: { low: '#172b3b', mid: '#416e8c', high: '#9bb8c4', accent: '#ffb470', pole: '#c5d9e0' } },
  creative: { label: 'Prism', kind: 'gas', air: '#d9a6dd', terms: /design|visual|render|canvas|graphic|frontend|\bui\b|\bgame\b|creative|studio/gi,
    palette: { low: '#48285c', mid: '#a16eb9', high: '#d6b9dd', accent: '#f0b48e', pole: '#ede1ee' } },
};

/** Public project metadata chooses a visual metaphor, never a permission or an instruction. */
export function identityForRepo(name: string, description = '', topics: readonly string[] = []): RepoIdentity {
  let theme: RepoTheme = 'unmapped';
  let best = 0;
  for (const [key, d] of Object.entries(DIRECTIONS)) {
    const hits = (s: string) => (s.match(d.terms) ?? []).length;
    const score = hits(name.slice(0, 256)) * 6 + hits(description.slice(0, 12000)) + hits(topics.join(' ').slice(0, 2048)) * 2;
    if (score > best) { best = score; theme = key as RepoTheme; }
  }
  return { theme, label: theme === 'unmapped' ? 'Frontier' : DIRECTIONS[theme].label,
    accent: theme === 'unmapped' ? '#8db4df' : DIRECTIONS[theme].palette.accent,
    variation: hashName(name.trim().toLowerCase()) };
}

function tint(hex: Hex, degrees: number, saturation = 1): Hex {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const hi = Math.max(...rgb), lo = Math.min(...rgb), l = (hi + lo) / 2, d = hi - lo;
  let h = d === 0 ? 0 : hi === rgb[0] ? ((rgb[1]! - rgb[2]!) / d + 6) % 6 : hi === rgb[1] ? (rgb[2]! - rgb[0]!) / d + 2 : (rgb[0]! - rgb[1]!) / d + 4;
  h = (h / 6 + degrees / 360 + 2) % 1;
  const s = d === 0 ? 0 : Math.min(0.88, d / (1 - Math.abs(2 * l - 1)) * saturation);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const channel = (n: number) => { const k = (n + h * 12) % 12; return Math.round(255 * (l - c / 2 * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return `#${[channel(0), channel(8), channel(4)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Keep authored geography; art-direct its colour and the first, automatically generated world. */
export function planetForRepo(base: PlanetGenome, identity: RepoIdentity, authored = false): PlanetGenome {
  const direction = identity.theme === 'unmapped' ? null : DIRECTIONS[identity.theme];
  const g = authored || !direction ? structuredClone(base) : archetypeDefaults(direction.kind, base.seed);
  const shift = ((identity.variation % 1000) / 999 - 0.5) * 26;
  const palette = direction?.palette ?? base.palette;
  g.palette = { ...palette };
  for (const key of ['low', 'mid', 'high', 'accent'] as const) g.palette[key] = tint(palette[key], shift, 1.16);
  if (direction) {
    g.atmosphere.color = tint(direction.air, shift);
    if (g.archetype !== 'rock') g.atmosphere.density = Math.max(0.2, g.atmosphere.density);
    g.atmosphere.height = Math.max(0.45, g.atmosphere.height);
    g.atmosphere.haze = Math.min(0.22, g.atmosphere.haze);
    if (!authored) {
      if (identity.theme === 'observatory') { g.terrain.fractures = 0.88; g.terrain.craters = 0.06; g.rings = { inner: 1.42, outer: 1.74, density: 0.26, gaps: 0.6, color: '#b8d7e6' }; }
      if (identity.theme === 'forge') { g.terrain.rifts = 0.85; g.terrain.relief = 0.8; g.terrain.fractures = 0.38; g.terrain.craters = 0.08; }
      if (identity.theme === 'intelligence') { g.bands.contrast = 0.48; g.bands.turbulence = 0.7; g.bands.count = 5; }
      if (identity.theme === 'knowledge') { g.oceans.coverage = 0.52; g.clouds.coverage = 0.22; g.terrain.scale = 0.72; }
      if (identity.theme === 'systems') { g.terrain.volcanism = 0.38; g.terrain.fractures = 0.7; }
      if (identity.theme === 'creative') { g.bands.contrast = 0.72; g.bands.spot = 0.55; g.clouds.coverage = 0.04; }
    }
    if (g.oceans.coverage > 0) { g.oceans.deep = '#071e38'; g.oceans.shallow = identity.theme === 'knowledge' ? '#239b9f' : '#3289bf'; }
    g.rationale = `${identity.label}: ${identity.theme === 'observatory' ? 'sapphire survey ice, fine measurement scars and a thin observation ring' : identity.theme === 'forge' ? 'copper terrain, cut ridges and structured canyon systems' : identity.theme === 'intelligence' ? 'violet cloud streams and connected bands' : identity.theme === 'knowledge' ? 'emerald islands and an interconnected turquoise sea' : identity.theme === 'systems' ? 'slate crust and warm pathways through a dark surface' : 'amethyst cloud bands and a peach storm signature'}.`;
  } else {
    // Give grey fallback bodies a mineral colour without making every unknown repo the same planet.
    const hue = identity.variation % 360;
    const minerals: PlanetPalette[] = [DIRECTIONS.observatory.palette, DIRECTIONS.forge.palette, DIRECTIONS.knowledge.palette, DIRECTIONS.creative.palette];
    const mineral = minerals[identity.variation % minerals.length]!;
    g.palette = { ...mineral, mid: tint(mineral.mid, hue % 38 - 19) };
    if (g.archetype !== 'rock') g.atmosphere.color = tint('#8cadd4', hue % 70 - 35);
  }
  return validateGenome(g).genome;
}
