// A world is a project root. A real repo's slot is assigned on first sight and kept in layout.json, so `1` means the same
// project every day. Sandboxes, roots that are gone and stray sessions go to the Belt, which holds no slot and has no planet.
// layout.json also holds the Veil salt, which must not change once a clip has been shared.
import { createHash, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateGenome, type EpochMs, type PlanetGenome, type World, type WorldId, type WorldKind } from '@naos/protocol';
import { CommandError } from './context.ts';
import type { Bus, Logger, Worlds } from './context.ts';
import { readRepoIdentity } from './appearance.ts';

/** 2 added the Belt: rubble gave its slot back, and the real repos closed up behind it. */
const LAYOUT_VERSION = 2;
const SWEEP_MS = 60_000;
/** A folder swapped for a fresh clone is back long before this. A deleted repo is not. */
export const GONE_GRACE_MS = 15 * 60_000;
const LOOKUP_MS = 3_000;
const NAME_LIMIT = 60;

const SLOT_OF_BELT = 0;
const NAME_OF_NOTHING = 'Belt';

interface LayoutWorld {
  worldId: WorldId;
  projectRoot: string | null;
  /** Made from the folder on every load, so a better rule reaches old worlds. `alias` outranks it. */
  name: string;
  slot: number;
  /** What the root is. The Belt is held apart in `belt`, so a root that returns is still a repo. */
  kind: WorldKind;
  isGit: boolean;
  trusted: boolean;
  alias?: string;
  belt?: boolean;
  /** The slot this world gave up, taken back if it is still free when the root returns. */
  homeSlot?: number;
  /** When a sweep first missed the root. Any sweep that finds it clears this. */
  goneSince?: EpochMs;
  /** The designer's planet, and when it came. */
  genome?: PlanetGenome;
  designedAt?: EpochMs;
}

/** Unknown keys survive a rewrite, so a newer kernel's nudges are not lost to an older one. */
interface LayoutFile extends Record<string, unknown> {
  version: number;
  veilSalt: string;
  worlds: Record<string, LayoutWorld>;
}

export interface KernelWorlds extends Worlds {
  readonly veilSalt: string;
  /** Tells clients about every persisted world, so a project with no session today still has its place in the sky. */
  publishAll(): void;
  /** Sets the user's name, or clears it with null or an empty name. undefined when the world is not known. */
  rename(worldId: WorldId, name: string | null): string | undefined;
  /** One pass over the roots on disk. It waits for a pass already running. */
  sweep(): Promise<void>;
  start(): void;
  stop(): Promise<void>;
}

/** `unknown` is no verdict: a drive that is away, a read that was refused, a lookup that hung. */
export type RootState = 'here' | 'gone' | 'unknown';

export interface WorldsDisk {
  look(target: string): Promise<RootState>;
  lookNow(target: string): RootState;
  now(): EpochMs;
}

export interface WorldsOptions {
  home: string;
  bus: Bus;
  log: Logger;
  /** The fixture keeps nothing on disk and fixes the salt, so a screenshot repeats. */
  ephemeral?: { veilSalt: string };
  /** This repository, which shows as NAOS. */
  selfRoot?: string;
  /** Folders whose contents are sandboxes. The system temp folder unless a test says otherwise. */
  tempRoots?: readonly string[];
  /** Replaces the disk and the clock in tests. */
  disk?: Partial<WorldsDisk>;
}

export function normalizeRoot(root: string): string {
  let out = root.replace(/\\/g, '/');
  if (/^[a-z]:/.test(out)) out = out[0]!.toUpperCase() + out.slice(1);
  while (out.length > 1 && out.endsWith('/') && !/^[A-Za-z]:\/$/.test(out)) out = out.slice(0, -1);
  return out;
}

/** The identity of a root. Windows paths differ by case and are still one folder. */
const rootKey = (normalized: string): string => (process.platform === 'win32' ? normalized.toLowerCase() : normalized);

const worldIdOf = (key: string): WorldId => createHash('sha256').update(key).digest('hex').slice(0, 16);

// Names.

/** A folder with one of these names says nothing, so the folder above it speaks for the project. */
const GENERIC_FOLDERS = new Set([
  'app', 'code', 'main', 'master', 'project', 'projects', 'repo', 'repos', 'repository', 'source', 'src', 'trunk', 'work', 'workspace',
]);
const ACRONYMS = new Set([
  'ai', 'api', 'cli', 'css', 'db', 'gpu', 'html', 'http', 'js', 'llm', 'mcp', 'ml', 'os', 'rag', 'sdk', 'sql', 'ts', 'ui', 'ux', 'vm',
]);

/** Capitals are the user's, so `ConstructQ` and `Poker_ML_Bot` keep theirs. Only an all-lower name gets any from here. */
function readable(folder: string): string {
  const stem = folder.replace(/\.git$/i, '').replace(/^\.+/, '');
  const words = stem.split(/[-_\s]+/).filter((word) => word.length > 0);
  if (words.length === 0) return folder;
  if (stem !== stem.toLowerCase()) return words.join(' ');
  return words.map((word) => (ACRONYMS.has(word) ? word.toUpperCase() : word.slice(0, 1).toUpperCase() + word.slice(1))).join(' ');
}

export function worldName(root: string | null, selfRoot: string | null = null, home: string = os.homedir()): string {
  if (root === null) return NAME_OF_NOTHING;
  if (selfRoot !== null && rootKey(root) === rootKey(normalizeRoot(selfRoot))) return 'NAOS';
  const homeKey = rootKey(normalizeRoot(home));
  for (let at = root; ;) {
    const folder = path.posix.basename(at);
    // A drive or the home folder is no project, and a home folder's name is a person's.
    if (folder === '' || /^[A-Za-z]:$/.test(folder) || rootKey(at) === homeKey) break;
    if (!GENERIC_FOLDERS.has(folder.toLowerCase())) return readable(folder);
    at = path.posix.dirname(at);
  }
  return readable(path.posix.basename(root) || root);
}

/** Control and format characters would spoof a label, so a name is one plain line. An empty result means no name. */
export function cleanWorldName(name: string | null): string {
  if (name === null) return '';
  if (typeof name !== 'string') throw new CommandError('bad-request', 'name must be text or null');
  const clean = name.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (clean.length > NAME_LIMIT) throw new CommandError('bad-request', `a name fits in ${NAME_LIMIT} characters`);
  return clean;
}

// The disk.

function systemTemp(): string[] {
  const { LOCALAPPDATA, SystemRoot } = process.env;
  // A kernel started by a tool may carry a narrower TEMP than the folder sandboxes really sit in.
  const found = [os.tmpdir(), ...(LOCALAPPDATA ? [path.join(LOCALAPPDATA, 'Temp')] : []), ...(SystemRoot ? [path.join(SystemRoot, 'Temp')] : [])];
  // TEMP can be an 8.3 path, and a session records the long one.
  for (const folder of [...found]) {
    try {
      found.push(realpathSync.native(folder));
    } catch {
      // Not there, so nothing can sit under it.
    }
  }
  return found;
}

const verdictOf = (error: unknown): RootState => {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR' ? 'gone' : 'unknown';
};

async function look(target: string): Promise<RootState> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<RootState>((resolve) => { timer = setTimeout(resolve, LOOKUP_MS, 'unknown'); });
  const found = stat(target).then((): RootState => 'here', verdictOf);
  const state = await Promise.race([found, late]);
  clearTimeout(timer);
  return state;
}

function lookNow(target: string): RootState {
  try {
    return statSync(target, { throwIfNoEntry: false }) ? 'here' : 'gone';
  } catch (error) {
    return verdictOf(error);
  }
}

/** A missing folder on a drive that is there means something. On a drive that is away it means nothing. */
const driveOf = (root: string): string | null => /^[A-Za-z]:/.exec(root)?.[0].concat('/') ?? null;

/** Asked of a share every minute, a repo there would wake a NAS or a WSL distro, so a share is never judged. */
const judged = (root: string): boolean => !root.startsWith('//');

function rootStateNow(root: string, lookup: WorldsDisk['lookNow']): RootState {
  if (!judged(root)) return 'unknown';
  const drive = driveOf(root);
  return drive !== null && lookup(drive) !== 'here' ? 'unknown' : lookup(root);
}

/** `drives` keeps one pass from asking a hanging drive once per repo. */
export async function rootState(root: string, lookup: WorldsDisk['look'], drives = new Map<string, RootState>()): Promise<RootState> {
  if (!judged(root)) return 'unknown';
  const drive = driveOf(root);
  if (drive !== null) {
    const known = drives.get(drive.toLowerCase()) ?? await lookup(drive);
    drives.set(drive.toLowerCase(), known);
    if (known !== 'here') return 'unknown';
  }
  return lookup(root);
}

// The file.

const blank = (): LayoutFile => ({ version: LAYOUT_VERSION, veilSalt: randomBytes(16).toString('hex'), worlds: {} });

function readLayout(file: string, log: Logger): LayoutFile {
  if (!existsSync(file)) return blank();
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<LayoutFile>;
    if (typeof parsed.veilSalt !== 'string' || typeof parsed.worlds !== 'object' || parsed.worlds === null) throw new Error('shape');
    return { ...blank(), ...parsed, version: typeof parsed.version === 'number' ? parsed.version : 1 };
  } catch {
    // Keep the bad file for a human, and do not stop the kernel for it.
    log.error('layout.json unreadable, starting a new one', {});
    renameSync(file, `${file}.bad-${Date.now()}`);
    return blank();
  }
}

const isRow = (row: unknown): row is LayoutWorld => {
  const r = row as Partial<LayoutWorld> | null;
  return typeof r === 'object' && r !== null && typeof r.worldId === 'string' && (typeof r.projectRoot === 'string' || r.projectRoot === null);
};

export function createWorlds(options: WorldsOptions): KernelWorlds {
  const { home, bus, log, ephemeral } = options;
  const selfRoot = options.selfRoot ?? null;
  const disk: WorldsDisk = { look, lookNow, now: Date.now, ...options.disk };
  const temp = (options.tempRoots ?? systemTemp()).map((folder) => rootKey(normalizeRoot(folder)));
  const file = path.join(home, 'layout.json');
  const layout: LayoutFile = ephemeral ? { ...blank(), veilSalt: ephemeral.veilSalt } : readLayout(file, log);
  const worlds = new Map<WorldId, World>();
  const identities = new Map<string, { at: number; value: NonNullable<World['identity']> }>();
  const identityOf = (row: LayoutWorld): NonNullable<World['identity']> => {
    const cached = identities.get(row.worldId);
    if (cached && disk.now() - cached.at < 60_000) return cached.value;
    const value = readRepoIdentity(ephemeral || row.belt || row.kind === 'offworld' ? null : row.projectRoot, row.name);
    identities.set(row.worldId, { at: disk.now(), value });
    return value;
  };
  const byKey = new Map<string, WorldId>();
  const keyOf = new Map<WorldId, string>();
  let sweepTimer: NodeJS.Timeout | null = null;
  let sweeping: Promise<void> | null = null;
  let stopped = false;

  const persist = (): void => {
    if (ephemeral) return;
    mkdirSync(home, { recursive: true });
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(layout, null, 2)}\n`);
    renameSync(temporary, file);
  };

  const underTemp = (root: string): boolean => {
    const key = rootKey(root);
    return temp.some((folder) => key === folder || key.startsWith(`${folder}/`));
  };

  /** Decided from the path alone, so these need no sweep and cannot flicker. */
  const alwaysBelt = (root: string | null): boolean => root === null || underTemp(root);

  /** Another machine's path says nothing about this disk. */
  const onThisDisk = (row: Pick<LayoutWorld, 'projectRoot' | 'kind'>): boolean => row.projectRoot !== null && row.kind !== 'offworld';

  const isGone = (row: Pick<LayoutWorld, 'projectRoot' | 'kind'>): boolean =>
    onThisDisk(row) && rootStateNow(row.projectRoot!, disk.lookNow) === 'gone';

  const lowestFree = (): number => {
    const taken = new Set(Object.values(layout.worlds).map((row) => row.slot));
    let slot = 1;
    while (taken.has(slot)) slot += 1;
    return slot;
  };

  const enterBelt = (row: LayoutWorld): void => {
    if (row.slot > 0) row.homeSlot = row.slot;
    row.belt = true;
    row.slot = SLOT_OF_BELT;
  };

  const leaveBelt = (row: LayoutWorld): void => {
    const held = Object.values(layout.worlds).some((other) => other.slot === row.homeSlot);
    row.slot = row.homeSlot !== undefined && !held ? row.homeSlot : lowestFree();
    delete row.belt;
    delete row.homeSlot;
  };

  /** A stored planet is validated again, so a hand edit cannot put something undrawable on the wire. */
  const planetOf = (row: LayoutWorld): Pick<World, 'genome' | 'designedAt'> => {
    if (!row.genome) return {};
    return { genome: validateGenome(row.genome).genome, designedAt: row.designedAt };
  };

  /** The persisted part of a world. A plane's patch never outranks these. */
  const fields = (row: LayoutWorld): Pick<World, 'worldId' | 'projectRoot' | 'name' | 'renamed' | 'slot' | 'kind' | 'isGit' | 'trusted' | 'genome' | 'designedAt' | 'identity'> => ({
    worldId: row.worldId,
    identity: identityOf(row),
    projectRoot: row.projectRoot,
    name: row.alias ?? row.name,
    renamed: row.alias !== undefined,
    slot: row.slot,
    kind: row.belt ? 'belt' : row.kind,
    isGit: row.isGit,
    trusted: row.trusted,
    genome: planetOf(row).genome,
    designedAt: planetOf(row).designedAt,
  });

  const fromLayout = (row: LayoutWorld): World => ({
    ...fields(row), massBytes: 0, massUsd30d: null, spendTodayUsd: null, lightsTotal: 0, lightsFailed: 0, lastActiveAt: null, worktrees: [],
  });

  /** Runs on every load: it is the migration from version 1, and it keeps the file honest for any later hand edit. */
  const settle = (): void => {
    const before = JSON.stringify(layout);
    const migrating = layout.version < 2;
    if (migrating && !ephemeral && !existsSync(`${file}.v1`)) copyFileSync(file, `${file}.v1`);
    const rows = layout.worlds;
    for (const [key, row] of Object.entries(rows)) {
      if (!isRow(row)) {
        log.warn('layout.json row ignored', {});
        delete rows[key];
        continue;
      }
      row.name = worldName(row.projectRoot, selfRoot);
      // A vanished root gets the same answer as on first sight: this runs once, and the repos behind it should close up now.
      if (alwaysBelt(row.projectRoot) || row.belt || (migrating && isGone(row))) enterBelt(row);
      if (migrating) delete row.homeSlot;
    }
    const planets = Object.values(rows).filter((row) => !row.belt).sort((a, b) => a.slot - b.slot || (a.worldId < b.worldId ? -1 : 1));
    if (migrating) planets.forEach((row, index) => { row.slot = index + 1; });
    const seen = new Set<number>();
    const unplaced: LayoutWorld[] = [];
    for (const row of planets) {
      if (Number.isInteger(row.slot) && row.slot > 0 && !seen.has(row.slot)) seen.add(row.slot);
      else { row.slot = SLOT_OF_BELT; unplaced.push(row); }
    }
    for (const row of unplaced) row.slot = lowestFree();
    if (migrating) {
      layout.version = LAYOUT_VERSION;
      delete layout['nextSlot'];
      log.info('layout.json migrated', { planets: planets.length, belt: Object.keys(rows).length - planets.length });
    }
    if (JSON.stringify(layout) !== before) persist();
  };

  settle();

  for (const [key, row] of Object.entries(layout.worlds)) {
    worlds.set(row.worldId, fromLayout(row));
    byKey.set(key, row.worldId);
    keyOf.set(row.worldId, key);
  }

  const firstSight = (key: string, root: string | null, kind: WorldKind): LayoutWorld => {
    const isGit = onThisDisk({ projectRoot: root, kind }) && disk.lookNow(path.join(root!, '.git')) === 'here';
    const row: LayoutWorld = {
      worldId: worldIdOf(key),
      projectRoot: root,
      name: worldName(root, selfRoot),
      slot: SLOT_OF_BELT,
      kind: root === null ? kind : isGit ? 'repo' : 'folder',
      isGit,
      trusted: false,
    };
    // A root that is gone before it was ever seen has no slot to lose, so it needs no grace.
    if (alwaysBelt(root) || isGone({ projectRoot: root, kind })) row.belt = true;
    else row.slot = lowestFree();
    layout.worlds[key] = row;
    byKey.set(key, row.worldId);
    keyOf.set(row.worldId, key);
    return row;
  };

  const refresh = (row: LayoutWorld): void => {
    const world: World = { ...worlds.get(row.worldId) ?? fromLayout(row), ...fields(row) };
    if (world.genome === undefined) delete world.genome;
    if (world.designedAt === undefined) delete world.designedAt;
    worlds.set(row.worldId, world);
    bus.publish({ type: 'world.upserted', world });
  };

  const rowOf = (worldId: WorldId): LayoutWorld | undefined => {
    const key = keyOf.get(worldId);
    return key === undefined ? undefined : layout.worlds[key];
  };

  /** Returns true when the row changed. Nothing here reads the disk but the stat that came in. */
  const judge = (row: LayoutWorld, state: RootState): boolean => {
    if (state === 'unknown') return false;
    if (state === 'here') {
      const away = row.goneSince !== undefined;
      delete row.goneSince;
      if (!row.belt) return away;
      leaveBelt(row);
      refresh(row);
      return true;
    }
    const now = disk.now();
    const first = row.goneSince === undefined;
    row.goneSince ??= now;
    if (row.belt || now - row.goneSince < GONE_GRACE_MS) return first;
    enterBelt(row);
    refresh(row);
    return true;
  };

  const pass = async (): Promise<void> => {
    const drives = new Map<string, RootState>();
    let dirty = false;
    for (const row of Object.values(layout.worlds)) {
      if (!onThisDisk(row) || alwaysBelt(row.projectRoot)) continue;
      const state = await rootState(row.projectRoot!, disk.look, drives);
      if (stopped) break;
      if (judge(row, state)) dirty = true;
    }
    if (dirty) persist();
  };

  const sweep = (): Promise<void> => {
    if (ephemeral || stopped) return Promise.resolve();
    sweeping ??= pass()
      .catch((error: unknown) => log.warn('world sweep failed', { error: String(error) }))
      .finally(() => { sweeping = null; });
    return sweeping;
  };

  return {
    veilSalt: layout.veilSalt,
    publishAll() {
      for (const world of worlds.values()) bus.publish({ type: 'world.upserted', world });
    },
    ensure(projectRoot, patch = {}) {
      const root = projectRoot === null ? null : normalizeRoot(projectRoot);
      const key = root === null ? `null:${patch.kind ?? 'rogue'}` : rootKey(root);
      const known = layout.worlds[key];
      const row = known ?? firstSight(key, root, patch.kind ?? 'rogue');
      const before = known ? JSON.stringify(known) : '';
      if (patch.kind !== undefined && patch.kind !== 'belt') row.kind = patch.kind;
      if (patch.isGit !== undefined) row.isGit = patch.isGit;
      if (patch.trusted !== undefined) row.trusted = patch.trusted;
      const base = worlds.get(row.worldId);
      // Identity and the name never move, whatever a plane passes.
      const world: World = { ...(base ?? fromLayout(row)), ...patch, ...fields(row) };
      if (world.genome === undefined) delete world.genome;
      if (world.designedAt === undefined) delete world.designedAt;
      if (JSON.stringify(row) !== before) persist();
      if (base && JSON.stringify(world) === JSON.stringify(base)) return base;
      worlds.set(world.worldId, world);
      bus.publish({ type: 'world.upserted', world });
      return world;
    },
    get: (worldId) => worlds.get(worldId),
    find(projectRoot) {
      const id = byKey.get(rootKey(normalizeRoot(projectRoot)));
      return id === undefined ? undefined : worlds.get(id);
    },
    setTrusted(worldId, trusted) {
      const row = rowOf(worldId);
      if (!row || row.trusted === trusted) return;
      row.trusted = trusted;
      persist();
      refresh(row);
    },
    setGenome(worldId, genome) {
      const row = rowOf(worldId);
      if (!row) throw new CommandError('not-found', 'That world is not known.');
      const { genome: clean } = validateGenome(genome);
      row.genome = clean;
      row.designedAt = disk.now();
      persist();
      refresh(row);
    },
    rename(worldId, name) {
      const row = rowOf(worldId);
      if (!row) return undefined;
      const clean = cleanWorldName(name);
      // Typing the folder's own name is the same as clearing it, so a better rule can still reach this world later.
      const alias = clean === row.name ? '' : clean;
      if (alias === (row.alias ?? '')) return row.alias ?? row.name;
      if (alias === '') delete row.alias;
      else row.alias = alias;
      persist();
      refresh(row);
      return row.alias ?? row.name;
    },
    sweep,
    start() {
      if (ephemeral || sweepTimer !== null) return;
      void sweep();
      sweepTimer = setInterval(() => void sweep(), SWEEP_MS);
      sweepTimer.unref();
    },
    async stop() {
      stopped = true;
      if (sweepTimer !== null) clearInterval(sweepTimer);
      sweepTimer = null;
      await sweeping;
    },
  };
}
