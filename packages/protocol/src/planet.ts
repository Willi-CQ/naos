// What a planet is, as plain JSON. A world designer agent fills it in without ever seeing the shader, so FIELDS below is both the
// validator and the documentation it reads: planetGenomeGuide() prints that table. No runtime dependencies, the kernel uses this too.

export const PLANET_GENOME_VERSION = 1;

export const PLANET_ARCHETYPES = ['terran', 'ocean', 'desert', 'ice', 'volcanic', 'rock', 'gas', 'ice-giant', 'shrouded'] as const;
export type PlanetArchetype = (typeof PLANET_ARCHETYPES)[number];

/** A colour as `#rrggbb`, sRGB. */
export type Hex = string;

export interface PlanetPalette { low: Hex; mid: Hex; high: Hex; accent: Hex; pole: Hex }

export interface PlanetTerrain {
  scale: number; relief: number; roughness: number; moisture: number; caps: number;
  craters: number; basins: number; rifts: number; fractures: number; volcanism: number;
}

export interface PlanetOceans { coverage: number; deep: Hex; shallow: Hex; shelf: number; glint: number }
export interface PlanetClouds { coverage: number; scale: number; storms: number; wisps: number; color: Hex; drift: number }
export interface PlanetBands { count: number; contrast: number; turbulence: number; storms: number; spot: number }
export interface PlanetAtmosphere { density: number; color: Hex; haze: number; height: number }
export interface PlanetRings { inner: number; outer: number; density: number; gaps: number; color: Hex }
export interface PlanetRotation { rate: number }

export interface PlanetGenome {
  version: typeof PLANET_GENOME_VERSION;
  seed: number;
  archetype: PlanetArchetype;
  palette: PlanetPalette;
  terrain: PlanetTerrain;
  oceans: PlanetOceans;
  clouds: PlanetClouds;
  bands: PlanetBands;
  atmosphere: PlanetAtmosphere;
  rings: PlanetRings | null;
  axialTilt: number;
  rotation: PlanetRotation;
  rationale: string;
}

/** What the kernel knows about a repo at first sight. Everything but the name may be missing. */
export interface RepoFacts {
  name: string;
  /** Bytes or files per language, any case. Only the proportions count. */
  languages?: Readonly<Record<string, number>>;
  sizeBytes?: number;
  files?: number;
  ageDays?: number;
  /** 0 asleep to 1 busy all day. */
  activity?: number;
}

export interface GenomeResult {
  genome: PlanetGenome;
  /** One line per value that was wrong: bad type, out of range, or at odds with the rest of the planet. A designer should hear about these. */
  fixes: string[];
  /** Fields left out and filled from the archetype. Leaving them out is the normal way to write a genome, so this is not a complaint. */
  filled: string[];
}

interface NumberField { path: string; min: number; max: number; doc: string }
interface HexField { path: string; hex: true; maxChroma: number; doc: string }
type Field = NumberField | HexField;

const unit = (path: string, doc: string): NumberField => ({ path, min: 0, max: 1, doc });
const hex = (path: string, doc: string, maxChroma = 0.8): HexField => ({ path, hex: true, maxChroma, doc });

const FIELDS: readonly Field[] = [
  hex('palette.low', 'Darkest surface colour. Solid worlds: lowlands, vegetation, dark basalt plains. Giants: the dark belts.'),
  hex('palette.mid', 'The colour the planet reads as from far away. Solid worlds: dry land, regolith, ice sheet. Giants: the main zones.'),
  hex('palette.high', 'Brightest surface colour. Solid worlds: highlands, bare rock, crater rays. Giants: the pale zones.'),
  hex('palette.accent', 'Small but telling colour. Lava glow on volcanic worlds, stain in ice cracks, sand on terran worlds, storm colour on giants. May be saturated, the rest should not be.', 1),
  hex('palette.pole', 'Polar caps on solid worlds, polar haze on giants.'),

  unit('terrain.scale', 'Size of land masses. 0 one supercontinent, 0.5 several continents, 1 a scatter of islands.'),
  unit('terrain.relief', 'Height of mountains. 0 smooth plains, 0.5 like Earth, 1 extreme, like Mars.'),
  unit('terrain.roughness', 'Fine detail. 0 smooth and old, 1 jagged and young.'),
  unit('terrain.moisture', 'Wetness of land. 0 all desert, 0.5 like Earth, 1 green to the coasts.'),
  unit('terrain.caps', 'Polar caps. 0 none, 0.3 like Earth, 1 ice down to the mid latitudes.'),
  unit('terrain.craters', 'Impact craters. 0 a fresh surface, 0.4 like Mars, 1 saturated, like the far side of the Moon. Old means more.'),
  unit('terrain.basins', 'Dark smooth lava plains, like the seas of the Moon. 0 none, 1 a third of the surface.'),
  unit('terrain.rifts', 'Canyon systems. 0 none, 0.4 one long canyon, 1 a scar across half the planet with side canyons, seen from far away.'),
  unit('terrain.fractures', 'Long arcs of cracks that cross each other, like Europa. 0 none, 0.4 a few great arcs, 1 a net across the whole planet.'),
  unit('terrain.volcanism', 'Active volcanoes: calderas, dark lava flows and a few fissures that glow at night. 0 dead, 0.3 a handful of vents, 1 many vents and long fissures.'),

  unit('oceans.coverage', 'Share of the surface under water. 0 none, 0.7 like Earth, 1 no land at all.'),
  hex('oceans.deep', 'Open ocean. Very dark, real oceans reflect little.', 0.5),
  hex('oceans.shallow', 'Shallow water over shelves and reefs.', 0.6),
  unit('oceans.shelf', 'Width of shallow water around coasts. 0 steep coasts, 1 wide turquoise shelves.'),
  unit('oceans.glint', 'How strongly the sun mirrors in the water. 1 a calm sea, 0 a rough one.'),

  unit('clouds.coverage', 'Share of the sky under cloud. 0 clear, 0.5 like Earth, 1 solid overcast.'),
  unit('clouds.scale', 'Size of cloud systems. 0 fine cells, 1 huge fronts.'),
  unit('clouds.storms', 'Spiral storms. 0 none, 0.4 some cyclones, 1 hurricanes everywhere.'),
  unit('clouds.wisps', 'High thin streaks along the winds. 0 none, 1 many.'),
  hex('clouds.color', 'Cloud tops. Close to white unless the air itself is coloured.', 0.2),
  { path: 'clouds.drift', min: -1, max: 1, doc: 'How clouds move against the ground. 0 with the ground, 1 fast with the spin, -1 fast against it.' },

  { path: 'bands.count', min: 2, max: 16, doc: 'Giants only. Band pairs from pole to pole. 6 like Jupiter, 12 fine like Saturn, 2 nearly plain like Uranus.' },
  unit('bands.contrast', 'Giants only. Difference between belts and zones. 0.1 like Uranus, 0.4 like Saturn, 0.9 like Jupiter.'),
  unit('bands.turbulence', 'Giants only. Curling of band edges. 0 smooth stripes, 1 chaos.'),
  unit('bands.storms', 'Giants only. Number of oval storms. 0 none, 1 strings of them.'),
  unit('bands.spot', 'Giants only. Size of one great spot. 0 none, 1 very large.'),

  unit('atmosphere.density', 'Air. 0 none and a sharp limb, 0.1 thin like Mars, 0.5 like Earth, 1 thick like Titan.'),
  hex('atmosphere.color', 'What the sky scatters and the limb glows. Blue for nitrogen and oxygen, butterscotch for dust, pale orange for haze. Sunsets come out in the opposite colour by themselves.', 0.75),
  unit('atmosphere.haze', 'Dust or aerosol. 0 clear, 1 a thick veil that hides the ground near the limb.'),
  unit('atmosphere.height', 'Thickness of the limb. 0 a hairline, 1 a broad halo.'),

  { path: 'rings.inner', min: 1.15, max: 2.4, doc: 'Inner edge of the rings in planet radii. Set rings to null for none, and most planets should have none.' },
  { path: 'rings.outer', min: 1.3, max: 3.2, doc: 'Outer edge in planet radii, 2.3 like Saturn. Must exceed inner.' },
  unit('rings.density', 'Opacity. 0.1 faint dust, 0.5 clear, 1 solid bright ice.'),
  unit('rings.gaps', 'Dark divisions. 0 a smooth sheet, 1 many ringlets.'),
  hex('rings.color', 'Colour of the ring ice.', 0.25),

  { path: 'axialTilt', min: 0, max: 180, doc: 'Degrees between the spin axis and the orbit normal. 23 like Earth, 98 like Uranus on its side, past 90 spins backwards.' },
  { path: 'rotation.rate', min: 0.25, max: 4, doc: 'Spin against the base rate. The base rate rises with the activity of the repo by itself. 1 is normal.' },
];

const ARCHETYPE_DOCS: Record<PlanetArchetype, string> = {
  terran: 'Oceans, continents, clouds, polar caps, like Earth. Night side city lights show best here.',
  ocean: 'Nearly all water, island arcs, big weather.',
  desert: 'Dry and rust or sand coloured, thin air, canyons and dark plains, like Mars.',
  ice: 'A bright frozen shell, cracks, little else, like Europa or Enceladus.',
  volcanic: 'Dark basalt or sulfur, glowing cracks, like Io.',
  rock: 'Airless and grey or tan, cratered, sharp shadows, like the Moon or Mercury.',
  gas: 'A banded giant with oval storms, like Jupiter or Saturn. terrain and oceans do not apply.',
  'ice-giant': 'A nearly plain blue or cyan giant, thin high clouds, like Neptune or Uranus. terrain and oceans do not apply.',
  shrouded: 'A solid world under a closed deck of cloud or haze, like Venus or Titan. The surface is never seen. terrain and oceans do not apply.',
};

const BASE: Omit<PlanetGenome, 'archetype' | 'seed'> = {
  version: PLANET_GENOME_VERSION,
  palette: { low: '#3f3a34', mid: '#8a7f70', high: '#b8ad9c', accent: '#c47a3c', pole: '#e6e9ec' },
  terrain: { scale: 0.5, relief: 0.5, roughness: 0.5, moisture: 0.5, caps: 0, craters: 0, basins: 0, rifts: 0, fractures: 0, volcanism: 0 },
  oceans: { coverage: 0, deep: '#071a33', shallow: '#1c6a80', shelf: 0.4, glint: 0.7 },
  clouds: { coverage: 0, scale: 0.5, storms: 0.3, wisps: 0, color: '#f4f5f7', drift: 0.3 },
  bands: { count: 6, contrast: 0.6, turbulence: 0.6, storms: 0.4, spot: 0 },
  atmosphere: { density: 0, color: '#7fa8ff', haze: 0.1, height: 0.3 },
  rings: null,
  axialTilt: 15,
  rotation: { rate: 1 },
  rationale: '',
};

interface Overrides {
  palette?: Partial<PlanetPalette>; terrain?: Partial<PlanetTerrain>; oceans?: Partial<PlanetOceans>; clouds?: Partial<PlanetClouds>;
  bands?: Partial<PlanetBands>; atmosphere?: Partial<PlanetAtmosphere>;
}

const ARCHETYPE_DEFAULTS: Record<PlanetArchetype, Overrides> = {
  terran: {
    palette: { low: '#2c4423', mid: '#7f7349', high: '#8f806d', accent: '#c7ad80', pole: '#eef2f6' },
    terrain: { caps: 0.3, relief: 0.5, craters: 0 },
    oceans: { coverage: 0.68 },
    clouds: { coverage: 0.5, storms: 0.45, wisps: 0.3 },
    atmosphere: { density: 0.46, color: '#5f8fff', haze: 0.06, height: 0.4 },
  },
  ocean: {
    palette: { low: '#3a4a2c', mid: '#8b7e58', high: '#9a8c78', accent: '#c9b58c', pole: '#eef3f8' },
    terrain: { caps: 0.2, scale: 0.9, relief: 0.3 },
    oceans: { coverage: 0.95, shelf: 0.75, glint: 0.85 },
    clouds: { coverage: 0.6, storms: 0.7, scale: 0.65, wisps: 0.3 },
    atmosphere: { density: 0.5, color: '#5c94ff', haze: 0.08, height: 0.45 },
  },
  desert: {
    palette: { low: '#4c2f22', mid: '#a0603a', high: '#c9996c', accent: '#d9b48a', pole: '#ece4da' },
    terrain: { caps: 0.12, relief: 0.75, roughness: 0.55, craters: 0.35, basins: 0.35, rifts: 0.5 },
    clouds: { coverage: 0.06, wisps: 0.2, storms: 0, color: '#efe6da' },
    atmosphere: { density: 0.14, color: '#d9a878', haze: 0.45, height: 0.35 },
  },
  ice: {
    palette: { low: '#7f6a5e', mid: '#c8bdb0', high: '#efeae4', accent: '#8a4f33', pole: '#f7f7f6' },
    terrain: { relief: 0.15, roughness: 0.3, craters: 0.12, fractures: 0.8 },
    atmosphere: { density: 0.02, color: '#a9c8ff', haze: 0, height: 0.2 },
  },
  volcanic: {
    palette: { low: '#17120f', mid: '#322a26', high: '#5a5048', accent: '#ff6a1f', pole: '#3e3834' },
    terrain: { relief: 0.65, roughness: 0.7, craters: 0.05, basins: 0.3, volcanism: 0.6, fractures: 0.25 },
    atmosphere: { density: 0.08, color: '#c98a5a', haze: 0.5, height: 0.3 },
  },
  rock: {
    palette: { low: '#3b3835', mid: '#7a7570', high: '#b0aaa2', accent: '#d8d2c8', pole: '#8a8580' },
    terrain: { relief: 0.5, roughness: 0.5, craters: 0.8, basins: 0.4 },
  },
  gas: {
    palette: { low: '#8a6242', mid: '#cdb08a', high: '#ece0cb', accent: '#b5573a', pole: '#8e8a86' },
    clouds: { coverage: 0.03, wisps: 0.1, storms: 0, drift: 0.4 },
    atmosphere: { density: 0.18, color: '#c7d4ec', haze: 0.25, height: 0.35 },
  },
  'ice-giant': {
    palette: { low: '#2c5f98', mid: '#3f82bd', high: '#6db1d6', accent: '#1d3e74', pole: '#7fbcd8' },
    bands: { count: 3, contrast: 0.16, turbulence: 0.25, storms: 0.12, spot: 0 },
    clouds: { coverage: 0.12, wisps: 0.7, storms: 0, drift: 0.6 },
    atmosphere: { density: 0.35, color: '#8fc3ff', haze: 0.2, height: 0.45 },
  },
  shrouded: {
    palette: { low: '#a58652', mid: '#d6bd8c', high: '#efe2c0', accent: '#b07a3c', pole: '#d9c8a4' },
    bands: { count: 3, contrast: 0.22, turbulence: 0.45, storms: 0, spot: 0 },
    clouds: { coverage: 0, wisps: 0, storms: 0 },
    atmosphere: { density: 0.85, color: '#e8c690', haze: 0.7, height: 0.6 },
  },
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** The defaults of one archetype, a complete genome that passes the validator unchanged. */
export function archetypeDefaults(archetype: PlanetArchetype, seed = 0): PlanetGenome {
  const o = ARCHETYPE_DEFAULTS[archetype];
  return {
    ...BASE,
    seed,
    archetype,
    palette: { ...BASE.palette, ...o.palette },
    terrain: { ...BASE.terrain, ...o.terrain },
    oceans: { ...BASE.oceans, ...o.oceans },
    clouds: { ...BASE.clouds, ...o.clouds },
    bands: { ...BASE.bands, ...o.bands },
    atmosphere: { ...BASE.atmosphere, ...o.atmosphere },
    rings: null,
    rotation: { ...BASE.rotation },
  };
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - (c / 2) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

const hexOf = (rgb: readonly number[]): Hex => `#${rgb.map((v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join('')}`;
const parseHex = (h: Hex): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];

/**
 * Keep unusually harsh colors bounded without flattening cinematic mineral hues. Hue and lightness stay and chroma is capped. Saturation
 * would be the wrong measure: a deep rust is fully saturated in HSL and looks perfectly natural.
 */
function tame(h: Hex, maxChroma: number): Hex {
  const [r, g, b] = parseHex(h);
  if (Math.max(r, g, b) - Math.min(r, g, b) <= maxChroma) return h.toLowerCase();
  const [hue, , l] = rgbToHsl(r, g, b);
  return hexOf(hslToRgb(hue, maxChroma / (1 - Math.abs(2 * l - 1)), l));
}

function readField(field: Field, value: unknown, fallback: unknown, fixes: string[], filled: string[]): unknown {
  const { path } = field;
  if ('hex' in field) {
    if (value === undefined) { filled.push(path); return fallback; }
    if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) { fixes.push(`${path} is not #rrggbb`); return fallback; }
    const tamed = tame(value, field.maxChroma);
    if (tamed !== value.toLowerCase()) fixes.push(`${path} too saturated`);
    return tamed;
  }
  if (value === undefined) { filled.push(path); return fallback; }
  if (typeof value !== 'number' || !Number.isFinite(value)) { fixes.push(`${path} is not a number`); return fallback; }
  const v = clamp(value, field.min, field.max);
  if (v !== value) fixes.push(`${path} clamped to ${v}`);
  return v;
}

const isGiantOrShroud = (a: PlanetArchetype): boolean => a === 'gas' || a === 'ice-giant' || a === 'shrouded';

/** A designer works without seeing the result, so a combination that cannot exist is put right here and reported, not drawn. */
function settle(g: PlanetGenome, fixes: string[]): void {
  if (isGiantOrShroud(g.archetype)) {
    for (const k of ['craters', 'basins', 'rifts', 'fractures', 'volcanism', 'caps'] as const) {
      if (g.terrain[k] > 0) { g.terrain[k] = 0; fixes.push(`terrain.${k} means nothing on ${g.archetype}, no ground is seen`); }
    }
    if (g.oceans.coverage > 0) { g.oceans.coverage = 0; fixes.push(`oceans.coverage means nothing on ${g.archetype}, no ground is seen`); }
    return;
  }
  const airless = g.atmosphere.density < 0.02;
  if (airless && (g.clouds.coverage > 0 || g.clouds.wisps > 0)) {
    g.clouds.coverage = 0;
    g.clouds.wisps = 0;
    fixes.push('clouds removed: there is no air to hold them, raise atmosphere.density to have clouds');
  }
  if (g.oceans.coverage > 0 && g.atmosphere.density < 0.05) {
    if (g.archetype === 'terran' || g.archetype === 'ocean') {
      g.atmosphere.density = 0.25;
      fixes.push('atmosphere.density raised to 0.25: open water needs air over it');
    } else {
      g.oceans.coverage = 0;
      fixes.push(`oceans removed: ${g.archetype} with no air cannot hold open water`);
    }
  }
  if (g.archetype === 'ocean' && g.oceans.coverage < 0.75) { g.oceans.coverage = 0.75; fixes.push('oceans.coverage raised to 0.75: an ocean world is nearly all water, use terran for less'); }
  if (g.archetype === 'desert' && g.oceans.coverage > 0.25) { g.oceans.coverage = 0.25; fixes.push('oceans.coverage lowered to 0.25: use terran for a wet world'); }
  if (g.archetype === 'volcanic' && g.terrain.volcanism < 0.15) { g.terrain.volcanism = 0.15; fixes.push('terrain.volcanism raised to 0.15: use rock for a dead world'); }
}

/**
 * The seed a world is really drawn with. It always carries the world's own identity, so no two worlds can share their continents and storms,
 * whatever a designer wrote. The fleet applies this, so a caller cannot forget it.
 */
export function planetSeed(worldId: string, seed = 0): number {
  return (hashName(worldId) ^ Math.imul(seed >>> 0, 0x9e3779b1)) >>> 0;
}

/** Turns anything at all into a genome the renderer can draw. It clamps and fills in, and it never throws. */
export function validateGenome(input: unknown): GenomeResult {
  const fixes: string[] = [];
  const filled: string[] = [];
  const raw = isRecord(input) ? input : {};
  if (!isRecord(input)) fixes.push('genome is not an object');

  let archetype: PlanetArchetype = 'rock';
  if (PLANET_ARCHETYPES.includes(raw.archetype as PlanetArchetype)) archetype = raw.archetype as PlanetArchetype;
  else fixes.push('archetype unknown, used rock');

  let seed = 0;
  if (typeof raw.seed === 'number' && Number.isFinite(raw.seed)) seed = Math.abs(Math.trunc(raw.seed)) % 4294967296;
  else if (raw.seed !== undefined) fixes.push('seed is not a number');

  const genome = archetypeDefaults(archetype, seed);
  if (raw.version !== undefined && raw.version !== PLANET_GENOME_VERSION) fixes.push(`version ${String(raw.version)} read as ${PLANET_GENOME_VERSION}`);

  const rawRings = raw.rings;
  if (isRecord(rawRings)) genome.rings = { inner: 1.3, outer: 2.2, density: 0.6, gaps: 0.5, color: '#d8ccb8' };
  else if (rawRings !== null && rawRings !== undefined) fixes.push('rings is neither an object nor null');

  for (const field of FIELDS) {
    const parts = field.path.split('.');
    const [group, key] = parts as [string, string | undefined];
    if (key === undefined) {
      (genome as unknown as Record<string, unknown>)[group] = readField(field, raw[group], (genome as unknown as Record<string, unknown>)[group], fixes, filled);
      continue;
    }
    const target = (genome as unknown as Record<string, Record<string, unknown> | null>)[group];
    if (!target) continue;
    const source = raw[group];
    target[key] = readField(field, isRecord(source) ? source[key] : undefined, target[key], fixes, filled);
  }

  if (genome.rings && genome.rings.outer < genome.rings.inner + 0.1) {
    genome.rings.outer = clamp(genome.rings.inner + 0.1, 1.3, 3.2);
    genome.rings.inner = Math.min(genome.rings.inner, genome.rings.outer - 0.1);
    fixes.push('rings.outer moved past rings.inner');
  }

  if (typeof raw.rationale === 'string') {
    // One sentence shown in the UI, written from repo content, so it is data: no control characters and no length to speak of.
    genome.rationale = raw.rationale.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 240);
  } else filled.push('rationale');

  settle(genome, fixes);
  return { genome, fixes, filled };
}

/** 32 bit FNV-1a. A name must give the same planet on every run and on every machine. */
export function hashName(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Family = 'web' | 'data' | 'metal' | 'service' | 'ops' | 'text' | 'other';

const FAMILY_OF: Readonly<Record<string, Family>> = {
  typescript: 'web', javascript: 'web', tsx: 'web', jsx: 'web', html: 'web', css: 'web', scss: 'web', vue: 'web', svelte: 'web',
  python: 'data', jupyter: 'data', 'jupyter notebook': 'data', r: 'data', julia: 'data', sql: 'data',
  rust: 'metal', c: 'metal', 'c++': 'metal', cpp: 'metal', zig: 'metal', assembly: 'metal', asm: 'metal', glsl: 'metal', hlsl: 'metal',
  go: 'service', java: 'service', kotlin: 'service', 'c#': 'service', csharp: 'service', scala: 'service', ruby: 'service', php: 'service', elixir: 'service',
  shell: 'ops', bash: 'ops', powershell: 'ops', dockerfile: 'ops', makefile: 'ops', hcl: 'ops', nix: 'ops',
  markdown: 'text', md: 'text', text: 'text', tex: 'text', latex: 'text', rst: 'text',
};

// Lava is the loudest thing a planet can have, so it is rare, and it needs a repo that is really busy. See genomeFromFacts.
const FAMILY_WEIGHTS: Record<Family, Partial<Record<PlanetArchetype, number>>> = {
  web: { terran: 4, ocean: 2, ice: 1, desert: 1, shrouded: 1 },
  data: { terran: 2, gas: 2, shrouded: 2, ocean: 1, 'ice-giant': 1 },
  metal: { desert: 3, rock: 2, volcanic: 1.5, ice: 1 },
  service: { ice: 2, 'ice-giant': 2, terran: 1, rock: 1, gas: 1 },
  ops: { rock: 3, desert: 2, ice: 2 },
  text: { shrouded: 4, ice: 2, ocean: 1 },
  other: { rock: 2, desert: 2, ice: 1, terran: 1, 'ice-giant': 1 },
};

type PaletteVariant = { palette: PlanetPalette; atmosphere?: Hex; deep?: Hex; shallow?: Hex; rings?: Hex };

// Palettes from real bodies and the natural pigments near them. A hue jitter on top keeps two worlds of one variant apart.
const VARIANTS: Record<PlanetArchetype, readonly PaletteVariant[]> = {
  terran: [
    { palette: { low: '#2c4423', mid: '#7f7349', high: '#8f806d', accent: '#c7ad80', pole: '#eef2f6' } },
    { palette: { low: '#46462a', mid: '#8c7650', high: '#94806a', accent: '#ccae84', pole: '#f0f0ee' }, deep: '#08223a', shallow: '#1a7284' },
    { palette: { low: '#23403a', mid: '#6d7458', high: '#7f7a70', accent: '#b5a888', pole: '#ecf2f6' }, atmosphere: '#7aa8f4', deep: '#061d30' },
    { palette: { low: '#553a2c', mid: '#8e6a4a', high: '#9a8676', accent: '#c8a67e', pole: '#f2ece8' }, atmosphere: '#8aa8f0' },
  ],
  ocean: [
    { palette: { low: '#3a4a2c', mid: '#8b7e58', high: '#9a8c78', accent: '#c9b58c', pole: '#eef3f8' } },
    { palette: { low: '#2d4a44', mid: '#7a8068', high: '#8c8a80', accent: '#b8b294', pole: '#f0f4f6' }, deep: '#04202e', shallow: '#177a7c' },
    { palette: { low: '#4a4238', mid: '#857460', high: '#8f8074', accent: '#bca88c', pole: '#eef0f2' }, deep: '#0a1a40', shallow: '#2a6aa0' },
  ],
  desert: [
    { palette: { low: '#4c2f22', mid: '#a0603a', high: '#c9996c', accent: '#d9b48a', pole: '#ece4da' } },
    { palette: { low: '#5a4630', mid: '#b08a56', high: '#d6bb86', accent: '#e6d2a4', pole: '#efe9dc' }, atmosphere: '#e0bd8a' },
    { palette: { low: '#3a2a2c', mid: '#7e4e46', high: '#ac8070', accent: '#c8a08a', pole: '#e6dcd6' }, atmosphere: '#cf9f90' },
    { palette: { low: '#4d3b2e', mid: '#8f7560', high: '#b49c84', accent: '#cdb79c', pole: '#e8e4dc' }, atmosphere: '#c9b093' },
  ],
  ice: [
    { palette: { low: '#7f6a5e', mid: '#c8bdb0', high: '#efeae4', accent: '#8a4f33', pole: '#f7f7f6' } },
    { palette: { low: '#6c7a88', mid: '#c0ccd6', high: '#eef2f5', accent: '#5a6e8c', pole: '#f8fafb' } },
    { palette: { low: '#8c8074', mid: '#d4ccbe', high: '#f2eee6', accent: '#a4613c', pole: '#f6f4ee' } },
  ],
  volcanic: [
    { palette: { low: '#17120f', mid: '#322a26', high: '#5a5048', accent: '#ff6a1f', pole: '#3e3834' } },
    { palette: { low: '#3d2b12', mid: '#c0a040', high: '#e6d07c', accent: '#ff7a24', pole: '#d8cca0' }, atmosphere: '#dcb36a' },
    { palette: { low: '#242426', mid: '#5e5c5a', high: '#a09c96', accent: '#ff5a30', pole: '#8a8884' }, atmosphere: '#b8a498' },
    { palette: { low: '#2e1712', mid: '#6e3424', high: '#a0624a', accent: '#ffa040', pole: '#7a5044' }, atmosphere: '#c8785a' },
  ],
  rock: [
    { palette: { low: '#3b3835', mid: '#7a7570', high: '#b0aaa2', accent: '#d8d2c8', pole: '#8a8580' } },
    { palette: { low: '#46392e', mid: '#8a7a68', high: '#b7a78f', accent: '#d9cbb2', pole: '#94887a' } },
    { palette: { low: '#2e2c2d', mid: '#5e5a58', high: '#8e8a84', accent: '#bdb8ae', pole: '#6c6866' } },
    { palette: { low: '#3a2a24', mid: '#6e5344', high: '#94806a', accent: '#c0ac90', pole: '#7c6a5a' } },
    { palette: { low: '#54504a', mid: '#a09a8e', high: '#cfc9bc', accent: '#ece6da', pole: '#b0aa9e' } },
  ],
  gas: [
    { palette: { low: '#8a6242', mid: '#cdb08a', high: '#ece0cb', accent: '#b5573a', pole: '#8e8a86' } },
    { palette: { low: '#a88c5e', mid: '#d8c090', high: '#efe3c0', accent: '#c49a58', pole: '#b0a488' } },
    { palette: { low: '#6d5a60', mid: '#b09aa0', high: '#ddd0cc', accent: '#8a5048', pole: '#857a80' }, atmosphere: '#d8cce0' },
    { palette: { low: '#7a6a4a', mid: '#b9ae88', high: '#e4dfc4', accent: '#7c8a6a', pole: '#8c8a78' }, atmosphere: '#cfdcc4' },
  ],
  'ice-giant': [
    { palette: { low: '#2c5f98', mid: '#3f82bd', high: '#6db1d6', accent: '#1d3e74', pole: '#7fbcd8' } },
    { palette: { low: '#7cc2cc', mid: '#9ad4da', high: '#c0e8ea', accent: '#64aab8', pole: '#d4f0f0' }, atmosphere: '#b0e6f0' },
    { palette: { low: '#384f96', mid: '#4f6cb8', high: '#7f9ad4', accent: '#27346c', pole: '#94acdc' }, atmosphere: '#9ab4ff' },
  ],
  shrouded: [
    { palette: { low: '#a58652', mid: '#d6bd8c', high: '#efe2c0', accent: '#b07a3c', pole: '#d9c8a4' } },
    { palette: { low: '#a0682c', mid: '#c98c44', high: '#e0b06a', accent: '#8a5424', pole: '#c49a5c' }, atmosphere: '#8fa8d8' },
    { palette: { low: '#8c8476', mid: '#c4bcac', high: '#e6e0d2', accent: '#8a7a64', pole: '#cfc8ba' }, atmosphere: '#d8d0c0' },
  ],
};

function shiftHue(h: Hex, degrees: number): Hex {
  const [r, g, b] = parseHex(h);
  const [hue, s, l] = rgbToHsl(r, g, b);
  return hexOf(hslToRgb((hue + degrees / 360 + 1) % 1, s, l));
}

function topFamily(languages: RepoFacts['languages']): Family {
  let best: Family = 'other';
  let most = 0;
  const totals = new Map<Family, number>();
  for (const [language, amount] of Object.entries(languages ?? {})) {
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const family = FAMILY_OF[language.trim().toLowerCase()] ?? 'other';
    const total = (totals.get(family) ?? 0) + amount;
    totals.set(family, total);
    if (total > most) { most = total; best = family; }
  }
  return best;
}

const paletteGap = (a: Hex, b: Hex): number => {
  const x = parseHex(a);
  const y = parseHex(b);
  return Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2]);
};

function pick(weights: Partial<Record<PlanetArchetype, number>>, roll: number): PlanetArchetype {
  const entries = PLANET_ARCHETYPES.flatMap((a) => (weights[a] ? [[a, weights[a]] as const] : []));
  let left = roll * entries.reduce((sum, [, w]) => sum + w, 0);
  for (const [a, w] of entries) {
    left -= w;
    if (left <= 0) return a;
  }
  return entries.at(-1)?.[0] ?? 'rock';
}

const finite = (v: number | undefined, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/**
 * The planet a world has from its first second. The same facts and siblings always give the same planet, and a designer's genome replaces it
 * later. Name sets the dice, language the kind of world, size how big a kind, age the craters, activity the weather.
 *
 * siblings are the planets already in the system, in the order worlds first appeared. Pass them, or a user's repos can all land on one
 * archetype: a repo decides what it is likely to be, and the system decides what it has enough of. Earlier worlds never change.
 */
export function genomeFromFacts(facts: RepoFacts, siblings: readonly PlanetGenome[] = []): PlanetGenome {
  const name = typeof facts.name === 'string' ? facts.name : '';
  const seed = hashName(name.trim().toLowerCase());
  const roll = mulberry(seed);
  const family = topFamily(facts.languages);

  const bytes = finite(facts.sizeBytes, finite(facts.files, 0) * 8000);
  // 0 for a script folder, 1 at about a gigabyte.
  const size = clamp((Math.log10(Math.max(bytes, 1)) - 4) / 5, 0, 1);
  const age = clamp(finite(facts.ageDays, 120) / 900, 0, 1);
  const activity = clamp(finite(facts.activity, 0.3), 0, 1);

  const weights = { ...FAMILY_WEIGHTS[family] };
  // Big repos lean to giants, small ones to bare bodies.
  weights.gas = (weights.gas ?? 0.2) * (0.4 + 3 * size * size);
  weights['ice-giant'] = (weights['ice-giant'] ?? 0.2) * (0.4 + 2.4 * size * size);
  weights.rock = (weights.rock ?? 0.2) * (1 + (1 - size) + age * 0.5);

  weights.volcanic = (weights.volcanic ?? 0) * (0.3 + 1.4 * activity);
  for (const a of PLANET_ARCHETYPES) {
    if (a !== 'volcanic') weights[a] ??= 0.3;
    const twins = siblings.filter((s) => s.archetype === a).length;
    weights[a] = weights[a]! / (1 + 2.5 * twins * twins);
  }

  const archetype = pick(weights, roll());
  const variants = VARIANTS[archetype];
  // Start where the dice say, and pass over a palette a sibling of this archetype already wears.
  const first = Math.floor(roll() * variants.length);
  const taken = siblings.filter((s) => s.archetype === archetype);
  let variant = variants[first % variants.length] ?? variants[0]!;
  for (let i = 0; i < variants.length; i++) {
    const v = variants[(first + i) % variants.length]!;
    if (taken.every((s) => paletteGap(s.palette.mid, v.palette.mid) > 0.3)) { variant = v; break; }
  }
  const jitter = (roll() - 0.5) * 16;
  const g = archetypeDefaults(archetype, seed);
  g.palette = {
    low: shiftHue(variant.palette.low, jitter),
    mid: shiftHue(variant.palette.mid, jitter),
    high: shiftHue(variant.palette.high, jitter),
    accent: shiftHue(variant.palette.accent, jitter * 0.5),
    pole: variant.palette.pole,
  };
  if (variant.deep) g.oceans.deep = variant.deep;
  if (variant.shallow) g.oceans.shallow = variant.shallow;
  if (variant.atmosphere) g.atmosphere.color = variant.atmosphere;

  const near = (v: number, spread: number) => clamp(v + (roll() - 0.5) * spread, 0, 1);
  g.terrain.scale = near(g.terrain.scale, 0.7);
  g.terrain.relief = near(g.terrain.relief, 0.45);
  g.terrain.roughness = near(g.terrain.roughness, 0.3);
  g.terrain.moisture = near(g.terrain.moisture, 0.5);
  g.terrain.caps = g.terrain.caps > 0 ? near(g.terrain.caps, 0.2) : 0;
  g.terrain.craters = isGiantOrShroud(archetype) ? 0 : clamp(g.terrain.craters * (0.4 + 1.2 * age) + age * 0.05, 0, 1);
  g.terrain.rifts = g.terrain.rifts > 0 ? near(g.terrain.rifts, 0.5) : 0;
  // Not every airless body has seas: half have none, as Mercury and Callisto do not.
  g.terrain.basins = g.terrain.basins > 0 ? (roll() < 0.45 ? 0.05 * roll() : near(g.terrain.basins, 0.4)) : 0;
  g.terrain.volcanism = g.terrain.volcanism > 0 ? clamp(g.terrain.volcanism * (0.45 + activity) * (0.7 + 0.6 * roll()), 0.2, 1) : 0;
  if (archetype === 'ice') g.terrain.fractures = near(g.terrain.fractures, 0.8);
  if (g.oceans.coverage > 0) g.oceans.coverage = near(g.oceans.coverage, 0.3);
  if (archetype === 'ocean') g.oceans.coverage = Math.max(0.8, g.oceans.coverage);
  g.oceans.shelf = near(g.oceans.shelf, 0.4);
  if (g.clouds.coverage > 0) g.clouds.coverage = clamp(g.clouds.coverage * (0.45 + 0.7 * activity) + (roll() - 0.5) * 0.24, 0.02, 0.68);
  g.clouds.scale = near(g.clouds.scale, 0.4);
  g.clouds.storms = g.clouds.storms > 0 ? near(g.clouds.storms * (0.6 + 0.8 * activity), 0.2) : 0;
  g.clouds.drift = clamp(g.clouds.drift * (roll() < 0.2 ? -1 : 1), -1, 1);
  g.bands.count = 3 + Math.floor(roll() * 10);
  if (archetype === 'gas') {
    g.bands.contrast = near(g.bands.contrast, 0.5);
    g.bands.turbulence = near(0.35 + 0.5 * activity, 0.2);
    g.bands.storms = near(0.25 + 0.5 * activity, 0.2);
    g.bands.spot = roll() < 0.4 ? 0.3 + roll() * 0.5 : 0;
  } else if (archetype === 'ice-giant' || archetype === 'shrouded') {
    g.bands.count = 2 + Math.floor(roll() * 4);
  }
  g.atmosphere.height = near(g.atmosphere.height, 0.2);
  g.atmosphere.density = near(g.atmosphere.density, Math.min(0.2, g.atmosphere.density));

  g.axialTilt = clamp(Math.abs(roll() + roll() + roll() - 1.5) * 40 + (roll() < 0.08 ? 80 : 0), 0, 180);
  g.rotation.rate = 0.6 + roll() * 1.2;

  const ringRoll = roll();
  const ringChance = archetype === 'gas' ? 0.45 : archetype === 'ice-giant' ? 0.3 : 0.05;
  if (ringRoll < ringChance) {
    const inner = 1.25 + roll() * 0.3;
    const faint = archetype !== 'gas';
    g.rings = {
      inner,
      outer: inner + (faint ? 0.25 + roll() * 0.3 : 0.6 + roll() * 0.6),
      density: faint ? 0.12 + roll() * 0.2 : 0.45 + roll() * 0.5,
      gaps: roll(),
      color: variant.rings ?? shiftHue('#d8ccb8', jitter),
    };
  }
  g.rationale = `Default for ${name || 'an unnamed repo'}: ${family === 'other' ? 'unknown languages' : `${family} code`}, ${archetype}.`;
  return validateGenome(g).genome;
}

const describe = (g: PlanetGenome): string => {
  const marks = [
    g.rings ? 'rings' : '',
    g.terrain.rifts > 0.3 ? 'canyons' : '',
    g.terrain.fractures > 0.3 ? 'cracks' : '',
    g.terrain.volcanism > 0.1 ? 'lava' : '',
    g.terrain.craters > 0.5 ? 'heavy craters' : '',
    g.oceans.coverage > 0 ? `${Math.round(g.oceans.coverage * 100)}% water` : '',
    g.clouds.coverage > 0.3 ? 'much cloud' : '',
  ].filter(Boolean);
  return `  ${g.archetype}, reads as ${g.palette.mid}${marks.length ? `, ${marks.join(', ')}` : ''}`;
};

/**
 * The whole contract as text, for the prompt of a world designer. Each designer runs alone, so pass the planets of the other worlds and it
 * can tell what is already taken.
 */
export function planetGenomeGuide(siblings: readonly PlanetGenome[] = []): string {
  const groups = new Map<string, string[]>();
  for (const f of FIELDS) {
    const group = f.path.split('.')[0]!;
    const range = 'hex' in f ? '#rrggbb' : `${f.min} to ${f.max}`;
    const lines = groups.get(group) ?? [];
    lines.push(`  ${f.path} (${range}): ${f.doc}`);
    groups.set(group, lines);
  }
  const { seed: _unused, ...example } = archetypeDefaults('desert', 0);
  example.rationale = 'A compiler that has run for years: dry, old, and cut by one deep canyon where the type checker was rewritten.';
  return [
    'A PlanetGenome describes a cinematic world inspired by its repository. Geological form and lighting are grounded, but the palette',
    'may be rich sapphire, emerald, amethyst or copper. Do not default to grey, beige or strict Solar System realism.',
    'Use the repository purpose, its visual identity and one meaningful surface feature together. Keep one clear dominant hue, a restrained',
    'complement and enough dark terrain for the highlights to read. Avoid white clipping, full-surface emission and a rainbow of unrelated colours.',
    '',
    'Top level: version (always 1), archetype, palette, terrain, oceans, clouds, bands, atmosphere, rings (an object, or null for none),',
    'axialTilt, rotation, rationale. Do not write a seed: geography comes from the repo itself, so every world has its own.',
    'rationale is one plain sentence, 240 characters at most, on why this planet fits this repo.',
    'Out of range values are clamped and missing ones get the default of the archetype, so leave out what does not matter.',
    'You get back the list of what had to be changed, for instance clouds on a world with no air.',
    '',
    ...(siblings.length ? ['Worlds already in this system. Make yours read differently from all of them, by archetype first:', ...siblings.map(describe), ''] : []),
    'Archetypes:',
    ...PLANET_ARCHETYPES.map((a) => `  ${a}: ${ARCHETYPE_DOCS[a]}`),
    '',
    'Fields:',
    ...[...groups.values()].flat(),
    '',
    'Example:',
    JSON.stringify(example),
  ].join('\n');
}

/** The JSON object in a designer's last message. Fenced or bare. Nothing else in the text is read. */
export function extractGenome(text: string): unknown | null {
  if (typeof text !== 'string' || text.length === 0) return null;
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  for (const raw of [fence?.[1], text]) {
    if (!raw) continue;
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) continue;
    try {
      const value = JSON.parse(raw.slice(start, end + 1)) as unknown;
      if (isRecord(value)) return value;
    } catch {
      // The next candidate, or nothing.
    }
  }
  return null;
}

/** A drawable planet from a designer's reply, or null when there was no JSON at all. */
export function parseDesignerOutput(text: string): GenomeResult | null {
  const raw = extractGenome(text);
  return raw === null ? null : validateGenome(raw);
}
