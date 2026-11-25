import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, before, describe, test } from 'node:test';
import type { KernelInfo, World } from '@naos/protocol';
import { createBus } from '../../src/bus.ts';
import type { Logger, Plane, Worlds } from '../../src/context.ts';
import { GONE_GRACE_MS, cleanWorldName, createWorlds, rootState, worldName } from '../../src/worlds.ts';
import type { RootState, WorldsOptions } from '../../src/worlds.ts';
import { boot, post, run } from './helpers.ts';
import type { TestKernel } from './helpers.ts';

const silent: Logger = { info() {}, warn() {}, error() {} };
const info: KernelInfo = { version: 'test', protocol: 1, pid: 1, startedAt: 0, mode: 'fixture', veilSalt: '', controlPlane: false };

const homes: string[] = [];
const tempHome = (): string => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'naos-worlds-'));
  homes.push(home);
  return home;
};
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

const SALT = 'a'.repeat(32);
const TEMP = 'C:/Users/someone/AppData/Local/Temp';

/** A disk with a clock. Anything in `gone` is missing, anything in `away` gives no verdict, the rest is there. */
function fakeDisk(gone: Iterable<string> = [], away: Iterable<string> = []) {
  const state = { gone: new Set(gone), away: new Set(away), time: 1_000_000, lookups: 0 };
  const lookNow = (target: string): RootState => {
    state.lookups += 1;
    return state.away.has(target) ? 'unknown' : state.gone.has(target) ? 'gone' : 'here';
  };
  return { state, disk: { lookNow, look: async (target: string) => lookNow(target), now: () => state.time } };
}

function open(home: string, disk = fakeDisk().disk, over: Partial<WorldsOptions> = {}) {
  const bus = createBus({ kernel: info, log: silent });
  return { bus, worlds: createWorlds({ home, bus, log: silent, tempRoots: [TEMP], disk, ...over }) };
}

const layoutOf = (home: string): Record<string, unknown> & { version: number; worlds: Record<string, Record<string, unknown>> } =>
  JSON.parse(readFileSync(path.join(home, 'layout.json'), 'utf8'));

/** What a kernel from before the Belt wrote: rubble and real repos dealt out in first-seen order. */
function oldLayout(home: string, rows: Array<[root: string | null, over?: Record<string, unknown>]>, extra: Record<string, unknown> = {}): void {
  const worlds = Object.fromEntries(rows.map(([root, over], index) => {
    const key = root === null ? 'null:rogue' : root.toLowerCase();
    const row = {
      worldId: `id${index}`, projectRoot: root, name: root === null ? 'rogue' : path.posix.basename(root), slot: index + 1,
      kind: root === null ? 'rogue' : 'repo', isGit: root !== null, trusted: false, ...over,
    };
    return [key, row];
  }));
  writeFileSync(path.join(home, 'layout.json'), JSON.stringify({ version: 1, veilSalt: SALT, nextSlot: rows.length + 1, worlds, ...extra }));
}

describe('a world is named as the user calls the repo', () => {
  test('the folder name made readable, with its capitals kept', () => {
    assert.equal(worldName('C:/dev/Benchmark-Agent'), 'Benchmark Agent');
    assert.equal(worldName('C:/dev/Poker_ML_Bot'), 'Poker ML Bot');
    assert.equal(worldName('C:/dev/ConstructQ'), 'ConstructQ');
    assert.equal(worldName('C:/dev/my repo'), 'My Repo');
  });

  test('an all-lower name gets capitals, and acronyms stay acronyms', () => {
    assert.equal(worldName('C:/dev/poker-ml-bot'), 'Poker ML Bot');
    assert.equal(worldName('C:/dev/dotfiles'), 'Dotfiles');
    assert.equal(worldName('C:/dev/.dotfiles'), 'Dotfiles');
    assert.equal(worldName('C:/dev/thing.git'), 'Thing');
  });

  test('a generic folder hands over to the folder above it', () => {
    for (const generic of ['repo', 'src', 'app', 'code', 'main', 'project', 'workspace', 'Repo']) {
      assert.equal(worldName(`C:/dev/Benchmark-Agent/${generic}`), 'Benchmark Agent', generic);
    }
    assert.equal(worldName('C:/dev/ConstructQ/code/src'), 'ConstructQ', 'it keeps climbing');
  });

  test('climbing stops at the drive and at the home folder, and a person\'s name never becomes a world', () => {
    assert.equal(worldName('C:/repo'), 'Repo');
    assert.equal(worldName('C:/code/app'), 'App');
    assert.equal(worldName('C:/Users/someone/repo', null, 'C:\\Users\\someone'), 'Repo');
  });

  test('this repository is NAOS, and only this one', () => {
    assert.equal(worldName('C:/dev/Claude_Agent_Manager', 'C:\\dev\\Claude_Agent_Manager'), 'NAOS');
    if (process.platform === 'win32') assert.equal(worldName('C:/DEV/claude_agent_manager', 'C:\\dev\\Claude_Agent_Manager'), 'NAOS');
    assert.equal(worldName('C:/dev/Other_Thing', 'C:\\dev\\Claude_Agent_Manager'), 'Other Thing');
  });

  test('the name reaches the world, and a plane cannot change it', () => {
    const { worlds } = open(tempHome());
    const world = worlds.ensure('C:\\dev\\Benchmark-Agent', { kind: 'repo', isGit: true });
    assert.equal(world.name, 'Benchmark Agent');
    assert.equal(world.projectRoot, 'C:/dev/Benchmark-Agent', 'the Veil hashes the root, which did not change');
    assert.equal(worlds.ensure('C:/dev/Benchmark-Agent', { name: 'from a plane' }).name, 'Benchmark Agent');
  });

  test('selfRoot from the composition names the world NAOS', () => {
    const { worlds } = open(tempHome(), undefined, { selfRoot: 'C:\\dev\\Claude_Agent_Manager' });
    assert.equal(worlds.ensure('C:/dev/Claude_Agent_Manager').name, 'NAOS');
  });
});

describe('world.rename', () => {
  test('it is stored in layout.json, survives a restart and a plane, and clears', () => {
    const home = tempHome();
    const first = open(home);
    const { worldId } = first.worlds.ensure('C:/dev/Benchmark-Agent');
    assert.equal(first.worlds.rename(worldId, '  The Bench  '), 'The Bench');
    assert.equal(first.bus.state().worlds[worldId]?.name, 'The Bench');
    assert.equal(first.bus.state().worlds[worldId]?.renamed, true);
    assert.equal(first.worlds.ensure('C:/dev/Benchmark-Agent', { massBytes: 5 }).name, 'The Bench');

    const second = open(home);
    assert.equal(second.worlds.get(worldId)?.name, 'The Bench');
    assert.equal(second.worlds.rename(worldId, null), 'Benchmark Agent');
    assert.equal(second.worlds.get(worldId)?.renamed, false);
    assert.equal(open(home).worlds.get(worldId)?.name, 'Benchmark Agent');
  });

  test('an empty name and the folder\'s own name both clear it', () => {
    const { worlds } = open(tempHome());
    const { worldId } = worlds.ensure('C:/dev/Benchmark-Agent');
    worlds.rename(worldId, 'x');
    assert.equal(worlds.rename(worldId, '   '), 'Benchmark Agent');
    worlds.rename(worldId, 'x');
    worlds.rename(worldId, 'Benchmark Agent');
    assert.equal(worlds.get(worldId)?.renamed, false);
  });

  test('an unknown world is undefined', () => {
    assert.equal(open(tempHome()).worlds.rename('nope', 'x'), undefined);
  });

  test('a name is one plain line: no controls, no direction overrides, no novels', () => {
    assert.equal(cleanWorldName('a\nb\t\u202Ec\u200B'), 'a b c');
    assert.equal(cleanWorldName(null), '');
    assert.throws(() => cleanWorldName('x'.repeat(61)), /fits in 60/);
    assert.throws(() => cleanWorldName(5 as unknown as string), /text or null/);
  });

  describe('through the router', () => {
    let kernel: TestKernel;
    let worlds: Worlds;
    let world: World;

    before(async () => {
      const plane: Plane = { name: 'probe', start: async (ctx) => { worlds = ctx.worlds; }, stop: async () => {} };
      kernel = await boot('live', { planes: [plane] });
      world = worlds.ensure('C:/dev/Benchmark-Agent', { kind: 'repo' });
    });
    after(() => kernel.close());

    test('the UI renames, and every client hears it', async () => {
      assert.deepEqual(await run(kernel, { type: 'world.rename', worldId: world.worldId, name: 'The Bench' }), { name: 'The Bench' });
      assert.equal(kernel.bus.state().worlds[world.worldId]?.name, 'The Bench');
      assert.equal(layoutOf(kernel.config.home).worlds[Object.keys(layoutOf(kernel.config.home).worlds)[0]!]?.alias, 'The Bench');
    });

    test('bad input is refused in plain words, an unknown world is not found', async () => {
      const long = await post(kernel, { type: 'world.rename', worldId: world.worldId, name: 'x'.repeat(61) });
      assert.equal(long.status, 400);
      const odd = await post(kernel, { type: 'world.rename', worldId: world.worldId, name: 5 });
      assert.equal(odd.status, 400);
      const unknown = await post(kernel, { type: 'world.rename', worldId: 'nope', name: 'x' });
      assert.equal(unknown.status, 404);
    });

    test('the MCP scope has no route to it', async () => {
      const reply = await post(kernel, { type: 'world.rename', worldId: world.worldId, name: 'pwned' }, { authorization: `Bearer ${kernel.tokens.mcp}` });
      assert.equal(reply.status, 403);
      assert.equal(kernel.bus.state().worlds[world.worldId]?.name, 'The Bench');
    });
  });
});

describe('the Belt', () => {
  test('a root under temp, a root that is gone and no root at all hold no slot', () => {
    const { disk } = fakeDisk(['C:/dev/deleted']);
    const { worlds } = open(tempHome(), disk);
    for (const root of [`${TEMP}/spike-3/repo`, 'c:\\users\\SOMEONE\\appdata\\local\\temp\\x', TEMP, 'C:/dev/deleted', null]) {
      const world = worlds.ensure(root, { kind: root === null ? 'rogue' : 'repo' });
      assert.equal(world.kind, 'belt', String(root));
      assert.equal(world.slot, 0, String(root));
    }
    const real = worlds.ensure('C:/dev/ConstructQ', { kind: 'repo' });
    assert.equal(real.slot, 1, 'the good slots stay for real repos');
    assert.equal(real.kind, 'repo');
  });

  test('a folder merely next to temp is no sandbox', () => {
    const { worlds } = open(tempHome());
    assert.equal(worlds.ensure(`${TEMP}erature/repo`).kind === 'belt', false);
  });

  test('a sandbox keeps a readable name, and stray sessions are simply the Belt', () => {
    const { worlds } = open(tempHome());
    assert.equal(worlds.ensure(`${TEMP}/spike-3/repo`).name, 'Spike 3');
    assert.equal(worlds.ensure(null).name, 'Belt');
  });

  test('a plane saying repo does not lift a world out of the Belt', () => {
    const { worlds } = open(tempHome());
    const root = `${TEMP}/spike/repo`;
    assert.equal(worlds.ensure(root, { kind: 'repo', isGit: true }).kind, 'belt');
    assert.equal(worlds.ensure(root, { kind: 'repo', isGit: true, massBytes: 9 }).massBytes, 9);
    assert.equal(worlds.ensure(root).kind, 'belt');
  });

  test('a repeat in the Belt publishes nothing and writes nothing', () => {
    const home = tempHome();
    const { bus, worlds } = open(home);
    worlds.ensure(`${TEMP}/spike/repo`, { kind: 'repo', isGit: true });
    const before = readFileSync(path.join(home, 'layout.json'), 'utf8');
    const seq = bus.state().seq;
    worlds.ensure(`${TEMP}/spike/repo`, { kind: 'repo', isGit: true });
    assert.equal(bus.state().seq, seq);
    assert.equal(readFileSync(path.join(home, 'layout.json'), 'utf8'), before);
  });

  test('another machine\'s path is not judged by this disk', () => {
    const { state, disk } = fakeDisk(['/home/someone/thing']);
    const { worlds } = open(tempHome(), disk);
    assert.equal(worlds.ensure('/home/someone/thing', { kind: 'offworld' }).kind, 'offworld');
    assert.equal(state.lookups, 0);
    assert.equal(worlds.ensure(null, { kind: 'offworld' }).kind, 'belt');
  });

  describe('a root that vanishes', () => {
    const ROOT = 'C:/dev/ConstructQ';

    test('it waits out the grace, then gives its slot back, and a new repo takes it', async () => {
      const home = tempHome();
      const { state, disk } = fakeDisk();
      const { bus, worlds } = open(home, disk);
      const world = worlds.ensure(ROOT);
      assert.equal(worlds.ensure('C:/dev/Benchmark-Agent').slot, 2);
      await worlds.sweep();

      state.gone.add(ROOT);
      await worlds.sweep();
      assert.equal(worlds.get(world.worldId)?.kind, 'repo', 'one miss is not a verdict');
      state.time += GONE_GRACE_MS - 1;
      await worlds.sweep();
      assert.equal(worlds.get(world.worldId)?.slot, 1);

      state.time += 1;
      await worlds.sweep();
      assert.equal(worlds.get(world.worldId)?.kind, 'belt');
      assert.equal(bus.state().worlds[world.worldId]?.slot, 0, 'clients hear it');
      assert.equal(worlds.ensure('C:/dev/New-One').slot, 1, 'the lowest free slot');
      assert.equal(worlds.ensure('C:/dev/Benchmark-Agent').slot, 2, 'a real repo never moves for it');
    });

    test('a root back inside the grace stops the clock, so it never flickers', async () => {
      const { state, disk } = fakeDisk();
      const { bus, worlds } = open(tempHome(), disk);
      const world = worlds.ensure(ROOT);
      const seq = bus.state().seq;
      for (let i = 0; i < 6; i += 1) {
        if (i % 2 === 0) state.gone.add(ROOT);
        else state.gone.delete(ROOT);
        await worlds.sweep();
        state.time += GONE_GRACE_MS / 2;
      }
      assert.equal(worlds.get(world.worldId)?.kind, 'repo');
      assert.equal(worlds.get(world.worldId)?.slot, 1);
      assert.equal(bus.state().seq, seq, 'no client saw any of it');
    });

    test('a drive that is away stops nothing and judges nothing, however long', async () => {
      const { state, disk } = fakeDisk();
      const { worlds } = open(tempHome(), disk);
      const world = worlds.ensure('D:/repos/ConstructQ');
      state.gone.add('D:/').add('D:/repos/ConstructQ');
      await worlds.sweep();
      state.time += GONE_GRACE_MS * 100;
      await worlds.sweep();
      assert.equal(worlds.get(world.worldId)?.kind, 'repo');
      assert.equal(worlds.get(world.worldId)?.slot, 1);
    });

    test('a refused or hung read is no verdict', async () => {
      const { state, disk } = fakeDisk([], [ROOT]);
      const { worlds } = open(tempHome(), disk);
      const world = worlds.ensure(ROOT);
      await worlds.sweep();
      state.time += GONE_GRACE_MS * 2;
      await worlds.sweep();
      assert.equal(worlds.get(world.worldId)?.kind, 'repo');
    });

    test('a network share is never judged, because asking would wake it', async () => {
      const { state, disk } = fakeDisk(['//nas/share/ConstructQ']);
      const { worlds } = open(tempHome(), disk);
      const world = worlds.ensure('\\\\nas\\share\\ConstructQ');
      state.lookups = 0;
      await worlds.sweep();
      state.time += GONE_GRACE_MS * 2;
      await worlds.sweep();
      assert.equal(worlds.get(world.worldId)?.kind, 'repo');
      assert.equal(state.lookups, 0);
    });

    test('the clock survives a restart, because a kernel can idle out inside the grace', async () => {
      const home = tempHome();
      const { state, disk } = fakeDisk();
      const first = open(home, disk);
      const world = first.worlds.ensure(ROOT);
      state.gone.add(ROOT);
      await first.worlds.sweep();
      state.time += GONE_GRACE_MS;
      const second = open(home, disk);
      assert.equal(second.worlds.get(world.worldId)?.kind, 'repo', 'a load alone judges nothing');
      await second.worlds.sweep();
      assert.equal(second.worlds.get(world.worldId)?.kind, 'belt');
    });

    test('a root that returns takes its slot back, and keeps what it is', async () => {
      const home = tempHome();
      const { state, disk } = fakeDisk();
      const { worlds } = open(home, disk);
      const world = worlds.ensure(ROOT, { kind: 'repo', isGit: true });
      worlds.setTrusted(world.worldId, true);
      state.gone.add(ROOT);
      await worlds.sweep();
      state.time += GONE_GRACE_MS;
      await worlds.sweep();
      assert.equal(worlds.get(world.worldId)?.kind, 'belt');

      state.gone.delete(ROOT);
      const again = open(home, disk);
      await again.worlds.sweep();
      const back = again.worlds.get(world.worldId);
      assert.equal(back?.kind, 'repo');
      assert.equal(back?.slot, 1);
      assert.equal(back?.trusted, true);
    });

    test('a root that returns to a slot now taken gets the lowest free one', async () => {
      const { state, disk } = fakeDisk();
      const { worlds } = open(tempHome(), disk);
      const world = worlds.ensure(ROOT);
      worlds.ensure('C:/dev/Second');
      state.gone.add(ROOT);
      await worlds.sweep();
      state.time += GONE_GRACE_MS;
      await worlds.sweep();
      assert.equal(worlds.ensure('C:/dev/Third').slot, 1);
      state.gone.delete(ROOT);
      await worlds.sweep();
      assert.equal(worlds.get(world.worldId)?.slot, 3);
    });

    test('a sweep with nothing to say writes nothing, and skips what the path already settled', async () => {
      const home = tempHome();
      const { state, disk } = fakeDisk();
      const { worlds } = open(home, disk);
      worlds.ensure(ROOT);
      worlds.ensure(`${TEMP}/spike/repo`);
      worlds.ensure(null);
      const before = readFileSync(path.join(home, 'layout.json'), 'utf8');
      state.lookups = 0;
      await worlds.sweep();
      assert.equal(readFileSync(path.join(home, 'layout.json'), 'utf8'), before);
      assert.equal(state.lookups, 2, 'the drive and one root');
    });

    test('an ephemeral instance never sweeps', async () => {
      const { state, disk } = fakeDisk();
      const { worlds } = open(tempHome(), disk, { ephemeral: { veilSalt: 'fixed' } });
      worlds.ensure(ROOT);
      state.lookups = 0;
      worlds.start();
      await worlds.sweep();
      await worlds.stop();
      assert.equal(state.lookups, 0);
    });

    test('stop waits for a pass in flight and ends it, so nothing writes into a removed home', async () => {
      const home = tempHome();
      let release = (): void => {};
      const held = new Promise<void>((resolve) => { release = resolve; });
      const { worlds } = open(home, { ...fakeDisk().disk, look: async () => { await held; return 'gone'; } });
      worlds.ensure(ROOT);
      const pass = worlds.sweep();
      let stopped = false;
      const stop = worlds.stop().then(() => { stopped = true; });
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(stopped, false);
      release();
      await Promise.all([pass, stop]);
      assert.equal('goneSince' in Object.values(layoutOf(home).worlds)[0]!, false);
    });
  });

  test('one pass asks a drive once, however many repos sit on it', async () => {
    const asked: string[] = [];
    const lookup = async (target: string): Promise<RootState> => { asked.push(target); return target === 'D:/' ? 'unknown' : 'here'; };
    const drives = new Map<string, RootState>();
    assert.equal(await rootState('D:/a', lookup, drives), 'unknown');
    assert.equal(await rootState('d:/b', lookup, drives), 'unknown');
    assert.equal(await rootState('C:/a', lookup, drives), 'here');
    assert.deepEqual(asked, ['D:/', 'C:/', 'C:/a']);
  });
});

describe('a layout.json from before the Belt', () => {
  const OLD: Array<[string | null, Record<string, unknown>?]> = [
    [`${TEMP}/naos-spike-1/repo`],
    ['C:/dev/Benchmark-Agent', { trusted: true }],
    [`${TEMP}/naos-spike-2/repo`],
    [null],
    ['C:/dev/ConstructQ'],
    [`${TEMP}/naos-spike-3/repo`],
    ['C:/dev/Claude_Agent_Manager'],
    ['C:/dev/Deleted-Thing'],
    ['D:/stick/Poker_ML_Bot'],
  ];

  const load = (home: string) => open(home, fakeDisk(['C:/dev/Deleted-Thing', 'D:/', 'D:/stick/Poker_ML_Bot']).disk, { selfRoot: 'C:\\dev\\Claude_Agent_Manager' });

  test('rubble leaves, real repos close up in their old order, and identity holds', () => {
    const home = tempHome();
    oldLayout(home, OLD);
    const { worlds, bus } = load(home);
    worlds.publishAll();
    const state = Object.values(bus.state().worlds);
    const planets = state.filter((w) => w.kind !== 'belt').sort((a, b) => a.slot - b.slot).map((w) => [w.slot, w.name]);
    assert.deepEqual(planets, [[1, 'Benchmark Agent'], [2, 'ConstructQ'], [3, 'NAOS'], [4, 'Poker ML Bot']]);
    assert.equal(state.filter((w) => w.kind === 'belt').length, 5);
    assert.ok(state.filter((w) => w.kind === 'belt').every((w) => w.slot === 0));
    assert.equal(worlds.veilSalt, SALT, 'a shared clip keeps its star names');
    assert.equal(worlds.get('id1')?.trusted, true);
    assert.equal(worlds.ensure('C:/dev/Benchmark-Agent').worldId, 'id1', 'sessions and history stay attached');
  });

  test('the old file is kept once, the new one is version 2, and unknown keys survive', () => {
    const home = tempHome();
    oldLayout(home, OLD, { futureNudges: { a: 1 } });
    const original = readFileSync(path.join(home, 'layout.json'), 'utf8');
    load(home);
    assert.equal(readFileSync(path.join(home, 'layout.json.v1'), 'utf8'), original);
    const file = layoutOf(home);
    assert.equal(file.version, 2);
    assert.deepEqual(file['futureNudges'], { a: 1 });
    assert.equal('nextSlot' in file, false);
  });

  test('a second start changes nothing', () => {
    const home = tempHome();
    oldLayout(home, OLD);
    load(home);
    const once = readFileSync(path.join(home, 'layout.json'), 'utf8');
    load(home);
    assert.equal(readFileSync(path.join(home, 'layout.json'), 'utf8'), once);
  });

  test('a new repo after the migration takes the next free slot', () => {
    const home = tempHome();
    oldLayout(home, OLD);
    assert.equal(load(home).worlds.ensure('C:/dev/New-One').slot, 5);
  });

  test('rows it cannot read are dropped and the rest load, and two repos on one slot are parted', () => {
    const home = tempHome();
    oldLayout(home, [['C:/dev/One'], ['C:/dev/Two']], { version: 2 });
    const file = layoutOf(home);
    file.worlds['c:/dev/two']!.slot = 1;
    file.worlds['broken'] = { nonsense: true };
    file.worlds['also'] = null as unknown as Record<string, unknown>;
    writeFileSync(path.join(home, 'layout.json'), JSON.stringify(file));
    const { worlds } = open(home);
    assert.deepEqual([worlds.get('id0')?.slot, worlds.get('id1')?.slot].sort(), [1, 2]);
    assert.equal(Object.keys(layoutOf(home).worlds).length, 2);
  });

  test('a file with no version at all counts as the old one', () => {
    const home = tempHome();
    oldLayout(home, [[`${TEMP}/x/repo`], ['C:/dev/One']]);
    const file = layoutOf(home);
    delete (file as { version?: number }).version;
    writeFileSync(path.join(home, 'layout.json'), JSON.stringify(file));
    assert.equal(open(home).worlds.get('id1')?.slot, 1);
  });

  test('a real folder on the real disk: gone is gone, there is there', async () => {
    const home = tempHome();
    const real = path.join(home, 'Real-Repo');
    mkdirSync(real);
    const bus = createBus({ kernel: info, log: silent });
    const worlds = createWorlds({ home, bus, log: silent, tempRoots: [] });
    const world = worlds.ensure(real);
    assert.equal(world.name, 'Real Repo');
    assert.equal(world.kind, 'folder');
    assert.equal(worlds.ensure(path.join(home, 'Never-There')).kind, 'belt');
    rmSync(real, { recursive: true });
    await worlds.sweep();
    assert.equal(worlds.get(world.worldId)?.kind, 'folder', 'the grace runs on a real miss too');
    assert.ok(existsSync(path.join(home, 'layout.json')));
    await worlds.stop();
  });

  test('the system temp folder is found without being told', () => {
    const bus = createBus({ kernel: info, log: silent });
    const worlds = createWorlds({ home: tempHome(), bus, log: silent });
    assert.equal(worlds.ensure(path.join(os.tmpdir(), 'anything', 'repo')).kind, 'belt');
  });
});

describe('a designer\'s planet is kept', () => {
  test('it is validated, stored, published, and still there after a restart', () => {
    const home = tempHome();
    const { state } = fakeDisk();
    const first = open(home, { lookNow: () => 'here', look: async () => 'here', now: () => state.time });
    const { worldId } = first.worlds.ensure('C:/dev/Benchmark-Agent');
    first.worlds.setGenome(worldId, { archetype: 'desert', rationale: 'A long dry rewrite of the type checker.' });
    const live = first.bus.state().worlds[worldId];
    assert.equal(live?.genome?.archetype, 'desert');
    assert.equal(live?.designedAt, state.time);
    assert.match(live?.genome?.rationale ?? '', /type checker/);
    const stored = layoutOf(home).worlds[Object.keys(layoutOf(home).worlds)[0]!];
    assert.equal((stored?.genome as { archetype?: string } | undefined)?.archetype, 'desert');

    const second = open(home);
    assert.equal(second.worlds.get(worldId)?.genome?.archetype, 'desert');
    assert.equal(second.worlds.get(worldId)?.designedAt, state.time);
  });

  test('an unknown world is not found, and a plane cannot write a genome through ensure', () => {
    const { worlds, bus } = open(tempHome());
    assert.throws(() => worlds.setGenome('nope', { archetype: 'ice' }), /not known/);
    const world = worlds.ensure('C:/dev/ConstructQ', { genome: { archetype: 'gas', rationale: 'from a plane' } as World['genome'] });
    assert.equal(world.genome, undefined);
    assert.equal(bus.state().worlds[world.worldId]?.genome, undefined);
  });
});
