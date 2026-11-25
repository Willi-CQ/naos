// Ten fictional repos, each with the planet a designer might have given it. Nothing here comes from a real repo on this machine.
import { genomeFromFacts, validateGenome, type PlanetGenome, type RepoFacts } from '@naos/protocol';

export interface LabWorld { name: string; repo: string; genome: PlanetGenome }

const world = (name: string, repo: string, genome: Record<string, unknown>): LabWorld => ({
  name,
  repo,
  genome: validateGenome({ version: 1, ...genome }).genome,
});

/** What a world looks like before any designer has seen it, from the facts alone. All fictional. */
const LAB_FACTS: readonly RepoFacts[] = [
  { name: 'payments-api', languages: { TypeScript: 90, CSS: 10 }, sizeBytes: 40e6, ageDays: 700, activity: 0.7 },
  { name: 'kiln', languages: { Rust: 100 }, sizeBytes: 9e6, ageDays: 90, activity: 0.9 },
  { name: 'orchard-etl', languages: { Python: 80, SQL: 20 }, sizeBytes: 3e9, ageDays: 1300, activity: 0.4 },
  { name: 'dotfiles', languages: { Shell: 100 }, sizeBytes: 90e3, ageDays: 2400, activity: 0.05 },
  { name: 'field-notes', languages: { Markdown: 100 }, sizeBytes: 2e6, ageDays: 300, activity: 0.2 },
  { name: 'switchyard', languages: { Go: 100 }, sizeBytes: 60e6, ageDays: 500, activity: 0.5 },
  { name: 'shader-lab', languages: { GLSL: 60, 'C++': 40 }, sizeBytes: 300e6, ageDays: 800, activity: 0.8 },
  { name: 'atlas-web', languages: { JavaScript: 100 }, sizeBytes: 800e6, ageDays: 1800, activity: 0.6 },
  { name: 'mooring', languages: { Kotlin: 100 }, sizeBytes: 7e9, ageDays: 1000, activity: 0.3 },
  { name: 'thesis', languages: { LaTeX: 100 }, sizeBytes: 12e6, ageDays: 1100, activity: 0.1 },
];

export const LAB_DEFAULTS: readonly LabWorld[] = LAB_FACTS.map((f) => ({ name: f.name, repo: 'default genome', genome: genomeFromFacts(f) }));

export const LAB_WORLDS: readonly LabWorld[] = [
  world('Tidewater', 'a logistics platform, TypeScript, four years old', {
    seed: 3180274, archetype: 'terran', axialTilt: 23,
    palette: { low: '#2c4423', mid: '#7f7349', high: '#8f806d', accent: '#c7ad80', pole: '#eef2f6' },
    terrain: { scale: 0.42, relief: 0.5, roughness: 0.55, moisture: 0.5, caps: 0.3, craters: 0 },
    oceans: { coverage: 0.68, deep: '#071a33', shallow: '#1c6a80', shelf: 0.45, glint: 0.8 },
    clouds: { coverage: 0.52, scale: 0.55, storms: 0.5, wisps: 0.4, color: '#f7f8fa', drift: 0.35 },
    atmosphere: { density: 0.46, color: '#5f8fff', haze: 0.06, height: 0.42 },
    rotation: { rate: 1 },
    rationale: 'Busy and many-sided, so it has what a lived-in world has: oceans, weather, cities.',
  }),
  world('Ironclad', 'a compiler in Rust, nine years old', {
    seed: 90211, archetype: 'desert', axialTilt: 25,
    palette: { low: '#4c2f22', mid: '#a0603a', high: '#c9996c', accent: '#d9b48a', pole: '#ece4da' },
    terrain: { relief: 0.82, roughness: 0.6, caps: 0.14, craters: 0.42, basins: 0.4, rifts: 0.8, moisture: 0 },
    clouds: { coverage: 0.03, wisps: 0.3, storms: 0, color: '#efe6da', scale: 0.4, drift: 0.2 },
    atmosphere: { density: 0.13, color: '#d9a878', haze: 0.5, height: 0.35 },
    rotation: { rate: 0.9 },
    rationale: 'Dry, old and exact, cut by one canyon where the borrow checker was rewritten.',
  }),
  world('Meridian', 'a data warehouse, 40 GB of tables', {
    seed: 771204, archetype: 'gas', axialTilt: 3,
    palette: { low: '#8a6242', mid: '#cdb08a', high: '#ece0cb', accent: '#b5573a', pole: '#8e8a86' },
    bands: { count: 6, contrast: 0.85, turbulence: 0.72, storms: 0.6, spot: 0.75 },
    clouds: { coverage: 0, wisps: 0, storms: 0, drift: 0.4 },
    atmosphere: { density: 0.16, color: '#c7d4ec', haze: 0.25, height: 0.32 },
    rotation: { rate: 2.2 },
    rationale: 'Enormous and turbulent, every band a pipeline, one storm that never clears.',
  }),
  world('Halcyon', 'an ocean simulation in Python', {
    seed: 1642097, archetype: 'ocean', axialTilt: 12,
    palette: { low: '#2d4a44', mid: '#7a8068', high: '#8c8a80', accent: '#b8b294', pole: '#f0f4f6' },
    terrain: { scale: 0.92, relief: 0.32, caps: 0.16, moisture: 0.8 },
    oceans: { coverage: 0.96, deep: '#04202e', shallow: '#177a7c', shelf: 0.85, glint: 0.92 },
    clouds: { coverage: 0.5, scale: 0.7, storms: 0.9, wisps: 0.3, color: '#f7f9fa', drift: 0.5 },
    atmosphere: { density: 0.5, color: '#5c94ff', haze: 0.08, height: 0.48 },
    rotation: { rate: 1.3 },
    rationale: 'Almost only water, with weather as its one great subject.',
  }),
  world('Lantern', 'a design system used by forty teams', {
    seed: 5150223, archetype: 'gas', axialTilt: 27,
    palette: { low: '#a88c5e', mid: '#d8c090', high: '#efe3c0', accent: '#c49a58', pole: '#b0a488' },
    bands: { count: 11, contrast: 0.32, turbulence: 0.28, storms: 0.14, spot: 0 },
    clouds: { coverage: 0, wisps: 0, storms: 0 },
    atmosphere: { density: 0.2, color: '#e8dcc0', haze: 0.3, height: 0.4 },
    rings: { inner: 1.26, outer: 2.34, density: 0.82, gaps: 0.72, color: '#dccfb6' },
    rotation: { rate: 1.8 },
    rationale: 'Calm, elegant, and everything around it moves in its plane.',
  }),
  world('Borealis', 'a message queue in Go', {
    seed: 280145, archetype: 'ice', axialTilt: 5,
    palette: { low: '#7f6a5e', mid: '#c8bdb0', high: '#efeae4', accent: '#8a4f33', pole: '#f7f7f6' },
    terrain: { relief: 0.14, roughness: 0.3, craters: 0.03, fractures: 0.95, caps: 0 },
    atmosphere: { density: 0.02, color: '#a9c8ff', haze: 0, height: 0.2 },
    rotation: { rate: 0.7 },
    rationale: 'A cold clean surface over something moving, each crack a stream.',
  }),
  world('Cinder', 'a game engine in C++', {
    seed: 6620911, archetype: 'volcanic', axialTilt: 8,
    palette: { low: '#17120f', mid: '#322a26', high: '#5a5048', accent: '#ff6a1f', pole: '#3e3834' },
    terrain: { relief: 0.68, roughness: 0.75, craters: 0.05, basins: 0.25, volcanism: 0.72, fractures: 0.2, caps: 0 },
    atmosphere: { density: 0.08, color: '#c98a5a', haze: 0.55, height: 0.3 },
    rotation: { rate: 1.1 },
    rationale: 'Hot, fast and dangerous, with fresh crust over open cracks.',
  }),
  world('Old Ledger', 'an accounting system, COBOL, thirty years old', {
    seed: 41987, archetype: 'rock', axialTilt: 2,
    palette: { low: '#3b3835', mid: '#7a7570', high: '#b0aaa2', accent: '#d8d2c8', pole: '#8a8580' },
    terrain: { relief: 0.5, roughness: 0.42, craters: 0.92, basins: 0.46 },
    rotation: { rate: 0.4 },
    rationale: 'Nothing has changed here for decades, and every impact is still on the record.',
  }),
  world('Quietus', 'an authentication service', {
    seed: 1099511, archetype: 'ice-giant', axialTilt: 28,
    palette: { low: '#2c5f98', mid: '#3f82bd', high: '#6db1d6', accent: '#1d3e74', pole: '#7fbcd8' },
    bands: { count: 3, contrast: 0.2, turbulence: 0.3, storms: 0.18, spot: 0.4 },
    clouds: { coverage: 0.1, wisps: 0.75, storms: 0, color: '#f4f8fb', drift: 0.6 },
    atmosphere: { density: 0.34, color: '#8fc3ff', haze: 0.2, height: 0.45 },
    rotation: { rate: 1.2 },
    rationale: 'Far out, deep blue and silent, with one dark spot nobody talks about.',
  }),
  world('Vesper', 'a documentation site, all Markdown', {
    seed: 3333073, archetype: 'shrouded', axialTilt: 177,
    palette: { low: '#a0682c', mid: '#c98c44', high: '#e0b06a', accent: '#8a5424', pole: '#c49a5c' },
    bands: { count: 3, contrast: 0.2, turbulence: 0.42, storms: 0, spot: 0 },
    clouds: { coverage: 0, wisps: 0, storms: 0 },
    atmosphere: { density: 0.86, color: '#8fa8d8', haze: 0.6, height: 0.7 },
    rotation: { rate: 0.5 },
    rationale: 'All surface and no ground: words all the way down, under a blue edge of haze.',
  }),
];
