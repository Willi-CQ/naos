// Zustand outside React. Three clocks (DESIGN 7.10): events reduce in as they land, the scene reads `getState()` per frame, and
// React reads `model`, which is rebuilt at most four times a second. Decisions are the one exception: they publish at once, so
// the title and the rail never wait, even in a throttled tab.
import { useShallow } from 'zustand/react/shallow';
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { emptyState, reduce, TAPE_LIMIT } from '@naos/protocol';
import type {
  ChannelRow, FleetState, HistoryDigest, KernelInfo, NaosEvent, NodeId, Salvo, ServerFrame, TapeEntry, TextRow, WorldId,
} from '@naos/protocol';
import { hud, LAYOUT } from '../core/layout.ts';
import type { SessionClient } from '@naos/protocol';
import type { Hud } from '../core/layout.ts';
import type { Tier } from '../core/tiers.ts';
import { command } from './commands.ts';
import { createLink, type Link, type SocketLike } from './link.ts';
import { buildModel, TAPE_FILTERS } from './model.ts';
import type { Model, ModelInput, Rates, TapeFilter } from './model.ts';
import { overlayDef, runAction } from './registry.ts';
import { COPY } from './strings.ts';

export type Level = 'system' | 'world' | 'craft';

export interface Settings {
  boot: 'full' | 'short' | 'off';
  alert: boolean;
  geiger: boolean;
  mute: boolean;
  notifications: boolean;
  comfort: boolean;
  quality: 'auto' | 'Umbra' | 'Corona' | 'Penumbra';
  scene: boolean;
  singleKeys: boolean;
  longArm: boolean;
  veil: boolean;
  /** The camera drifts very slowly at System level after a while with no input. Never under reduced motion or on battery. */
  idleDrift: boolean;
  signalRoutes: boolean;
  auroras: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  boot: 'full', alert: false, geiger: false, mute: false, notifications: true, comfort: false, quality: 'auto', scene: true, singleKeys: true, longArm: false, veil: false, idleDrift: true, signalRoutes: true, auroras: true,
};

const SETTINGS_KEY = 'naos.settings';

/** Browser storage can throw or come back empty, so this never decides anything but a convenience. */
function loadSettings(): Settings {
  try {
    const raw = globalThis.localStorage?.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings: Settings): void {
  try { globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* stays for this page only */ }
}

export interface OpenOverlay { id: string; arg: unknown; returnTo: HTMLElement | null }

export interface View {
  clientFilter: SessionClient | 'all';
  level: Level;
  worldId: WorldId | null;
  selected: NodeId | null;
  selectedWorld: WorldId | null;
  /** What the Channel shows while nothing is selected. Picked once, so it never jumps under the eye. */
  follow: NodeId | null;
  overlays: OpenOverlay[];
  tapeFilter: TapeFilter;
  cinema: boolean;
  sky: boolean;
  /** Age of the selected day. 0 is today. */
  skyDay: number;
  manifest: 'craft' | 'world';
  railCollapsed: boolean;
  /** Below 1280 the rail is a strip, `M` opens it over the scene. */
  railOverlay: boolean;
  keyScope: 'global' | 'docket';
  collapsed: Record<WorldId, boolean>;
  settings: Settings;
}

export interface Shell extends Hud {
  vw: number;
  vh: number;
  /** Below 1024: one column, no canvas. */
  instrument: boolean;
  /** 1024 to 1279: the left rail is a 44 px strip. */
  strip: boolean;
  left: number;
  right: number;
  top: number;
  bot: number;
  /** Channel width at Craft level. */
  channel: number;
  docket: number;
  sheet: number;
}

export function shellOf(vw: number, vh: number, view: Pick<View, 'railCollapsed' | 'cinema'> & Partial<Pick<View, 'level'>>): Shell {
  const strip = vw < 1280;
  const open = !strip && !view.railCollapsed;
  const base = hud(vw, vh, open);
  const l = LAYOUT[base.cls];
  const right = view.level === 'craft' ? l.channel : l.right;
  const shell = {
    ...base, free: { ...base.free, w: vw - base.free.x - right }, vw, vh, instrument: vw < 1024, strip, left: base.free.x, right, top: l.top, bot: base.short ? 24 : l.bot,
    channel: l.channel, docket: l.docket, sheet: l.sheet,
  };
  if (!view.cinema) return shell;
  return { ...shell, left: 0, right: 0, bot: 0, free: { x: 0, y: l.top, w: vw, h: vh - l.top } };
}

export interface LinkState {
  status: 'connecting' | 'up' | 'lost';
  /** When the link went down, on this machine's clock: there is no kernel clock to ask then. */
  lostAt: number | null;
  lostForMs: number;
  /** A first snapshot arrived on this page. */
  everUp: boolean;
  lastFrameAt: number;
  clientId: string | null;
  kernel: KernelInfo | null;
}

export interface ChannelState {
  nodeId: NodeId | null;
  rows: ChannelRow[];
  complete: boolean;
  loading: boolean;
  textOn: boolean;
  pinned: boolean;
  text: TextRow[];
  /** Live text for the watched craft. */
  liveText: string;
  textFailed: boolean;
}

/** Written only by the scene (section 8.7). */
export interface SceneSlice {
  demo?: import('../core/demo.ts').DemoState;
  camera?: { angle: import('../core/cinema.ts').CameraAngle | null; touring: boolean; journey?: boolean };
  planets?: { ready: number; total: number; baking: boolean };
  /** A scene frame is on screen, over the Plate. */
  mounted: boolean;
  tier: Tier | null;
  cadence: string;
  context: 'ok' | 'lost' | 'none';
  /** The Plate took over for good: lost twice in 10 minutes, or the monitor gave up. Until reload. */
  retired: boolean;
  /** Why there is no scene, when there is none and nobody chose that. */
  why: string | null;
}

export interface NaosState {
  fleet: FleetState;
  rates: Rates;
  link: LinkState;
  history: HistoryDigest[];
  salvos: Salvo[];
  model: Model;
  view: View;
  shell: Shell;
  channel: ChannelState;
  announce: { polite: string; assertive: string; n: number };
  scene: SceneSlice;
  /** Bumps on every snapshot. The scene cuts to it, because a seek, a reconnect or a reload is not motion. */
  epoch: number;
}

const emptyRates = (): Rates => ({ at: 0, fleet: null, nodes: {} });

const initialView = (): View => ({
  clientFilter: 'all',
  level: 'system', worldId: null, selected: null, selectedWorld: null, follow: null, overlays: [], tapeFilter: 'all', cinema: false, sky: false, skyDay: 0,
  manifest: 'craft', railCollapsed: false, railOverlay: false, keyScope: 'global', collapsed: {}, settings: loadSettings(),
});

const initialChannel = (): ChannelState => ({
  nodeId: null, rows: [], complete: true, loading: false, textOn: false, pinned: false, text: [], liveText: '', textFailed: false,
});

const clockNow = (rates: Rates, fleet: FleetState): number => rates.at || fleet.lastTickAt || Date.now();

function modelInput(s: Pick<NaosState, 'fleet' | 'rates' | 'view' | 'history' | 'link'>): ModelInput {
  return {
    fleet: s.fleet,
    clientFilter: s.view.clientFilter,
    rates: s.rates,
    now: clockNow(s.rates, s.fleet),
    veil: s.view.settings.veil,
    tapeFilter: s.view.tapeFilter,
    history: s.history,
    clientId: s.link.clientId,
    linkUp: s.link.status === 'up',
    sensorChangedAt,
    burns,
  };
}

let sensorChangedAt: number | null = null;
let burns: Record<WorldId, number[]> = {};
let burnSampledAt = 0;

const startView = initialView();
const startFleet = emptyState();
const startLink: LinkState = { status: 'connecting', lostAt: null, lostForMs: 0, everUp: false, lastFrameAt: 0, clientId: null, kernel: null };

export const useNaos = create<NaosState>()(subscribeWithSelector((): NaosState => ({
  fleet: startFleet,
  rates: emptyRates(),
  link: startLink,
  history: [],
  salvos: [],
  model: buildModel(modelInput({ fleet: startFleet, rates: emptyRates(), view: startView, history: [], link: startLink })),
  view: startView,
  shell: shellOf(1280, 800, startView),
  channel: initialChannel(),
  announce: { polite: '', assertive: '', n: 0 },
  scene: { mounted: false, tier: null, cadence: 'rest', context: 'none', retired: false, why: null },
  epoch: 0,
})));

const get = useNaos.getState;
const set = useNaos.setState;

export const useModel = <T>(pick: (m: Model) => T): T => useNaos(useShallow((s) => pick(s.model)));
export const useView = <T>(pick: (v: View) => T): T => useNaos(useShallow((s) => pick(s.view)));
export const useShell = <T>(pick: (s: Shell) => T): T => useNaos(useShallow((s) => pick(s.shell)));

let modelDirty = true;

/** Rebuilds what the HUD reads. Veil, filters and links call it directly, the 4 Hz timer does for everything else. */
export function publish(): void {
  modelDirty = false;
  const s = get();
  const model = buildModel(modelInput(s));
  set({ model });
  afterPublish(model);
}

function afterPublish(model: Model): void {
  const { view } = get();
  // One live craft needs no zoom (3.2).
  if (view.selected === null && model.craftCount === 1) {
    const only = Object.values(model.crafts).find((c) => c.live);
    if (only) select(only.id);
  }
  // What the Channel shows with nothing selected. A function of the fleet alone, never of when this page happened to settle: the working
  // craft on the lowest slot, the first of that world by name. A hand can predict it, and the same moment shows the same thing.
  if (view.selected === null) {
    const slotOf = new Map(model.allWorlds.map((w) => [w.worldId, w.slot]));
    const working = model.walk.map((id) => model.crafts[id]!).filter((c) => c.tier === 6 && c.state !== 'idle');
    const pick = working.sort((a, b) => (slotOf.get(a.worldId) ?? 1e6) - (slotOf.get(b.worldId) ?? 1e6) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))[0];
    if (pick && pick.id !== view.follow) {
      set({ view: { ...get().view, follow: pick.id } });
      targetChannel(pick.id);
    }
  }
  flushSpeech(model);
}

// ---- speech -----------------------------------------------------------------------------------------------------------------

const POLITE_GAP_MS = 4_000;
const assertiveQueue: string[] = [];
const politeCounts = { finished: 0, failed: 0, salvo: 0, limit: 0 };
const politeLines: string[] = [];
let lastPoliteAt = 0;

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

function flushSpeech(model: Model): void {
  while (assertiveQueue.length > 0) {
    const nodeId = assertiveQueue.shift()!;
    const d = model.decisions.find((row) => row.requestId === nodeId);
    if (d) speak('assertive', `${d.worldName} ${d.letter} needs approval, ${d.tool}`);
  }
  const wall = Date.now();
  if (wall - lastPoliteAt < POLITE_GAP_MS) return;
  const parts = [...politeLines];
  politeLines.length = 0;
  if (politeCounts.finished) parts.push(`${plural(politeCounts.finished, 'agent')} finished`);
  if (politeCounts.failed) parts.push(`${plural(politeCounts.failed, 'agent')} failed`);
  if (politeCounts.salvo) parts.push(plural(politeCounts.salvo, 'salvo'));
  if (politeCounts.limit) parts.push('plan limit reached');
  politeCounts.finished = politeCounts.failed = politeCounts.salvo = politeCounts.limit = 0;
  if (parts.length === 0) return;
  lastPoliteAt = wall;
  speak('polite', parts.join(', '));
}

function speak(kind: 'polite' | 'assertive', text: string): void {
  const { announce } = get();
  set({ announce: { ...announce, [kind]: text, n: announce.n + 1 } });
}

/** Feedback for a key that changed something unseen. Goes through the polite throttle. */
export function say(text: string): void {
  politeLines.push(text);
  flushSpeech(get().model);
}

// ---- the stream -------------------------------------------------------------------------------------------------------------

let link: Link | null = null;
let gapPending = false;

type FleetEvents = (events: readonly NaosEvent[]) => void;
const fleetSinks = new Set<FleetEvents>();
const textSinks = new Set<(nodeId: NodeId, delta: string) => void>();

/** Explicit transcript viewers share the existing socket, never the structural fleet stream. */
export function onCraftText(fn: (nodeId: NodeId, delta: string) => void): () => void {
  textSinks.add(fn);
  return () => { textSinks.delete(fn); };
}

/** The scene's transients. Events only, never a snapshot: a seek or a reconnect replays nothing. */
export function onFleetEvents(fn: FleetEvents): () => void {
  fleetSinks.add(fn);
  return () => { fleetSinks.delete(fn); };
}
let historyAsked = false;

function noteEvents(events: readonly NaosEvent[]): boolean {
  let urgent = false;
  const { channel, view } = get();
  for (const e of events) {
    switch (e.type) {
      case 'approval.requested':
        assertiveQueue.push(e.approval.requestId);
        urgent = true;
        break;
      case 'approval.answered': case 'approval.cancelled': case 'approval.expired':
        urgent = true;
        break;
      case 'session.ended':
        if (e.outcome === 'abandoned') politeCounts.failed += 1; else politeCounts.finished += 1;
        break;
      case 'agent.ended':
        if (e.status === 'failed') politeCounts.failed += 1; else if (e.status === 'completed') politeCounts.finished += 1;
        break;
      case 'salvo.opened': politeCounts.salvo += 1; break;
      case 'plan.changed': if (e.plan.status === 'rejected') politeCounts.limit += 1; break;
      case 'history.digest': mergeHistory(e.rows); break;
      case 'history.expired': dropHistory(e.nodeIds); break;
      default:
    }
    if (channel.nodeId !== null && ('nodeId' in e) && e.nodeId === channel.nodeId) channelDirty = true;
    if (channel.nodeId !== null && e.type === 'agent.started' && e.node.parentNodeId === channel.nodeId) channelDirty = true;
    if (e.type === 'session.changed' && e.patch.sessionId !== undefined && view.selected === e.sessionId) {
      // /clear: same hull, new conversation. The event carries both ids, so the selection follows the craft.
      const next = e.patch.rootNodeId ?? e.patch.sessionId;
      select(next);
    }
  }
  return urgent;
}

function mergeHistory(rows: readonly HistoryDigest[]): void {
  const known = new Map(get().history.map((r) => [r.nodeId, r]));
  for (const row of rows) known.set(row.nodeId, row);
  set({ history: [...known.values()] });
}

function dropHistory(nodeIds: readonly NodeId[]): void {
  const gone = new Set(nodeIds);
  set({ history: get().history.filter((r) => !gone.has(r.nodeId)) });
}

async function fetchHistory(): Promise<void> {
  const res = await command('history.get', {});
  if (!res.ok) { historyAsked = false; return; }
  set({ history: res.result.rows, salvos: res.result.salvos });
  modelDirty = true;
}

/** One frame from the kernel. Exported for tests, the socket calls nothing else. */
export function ingest(frame: ServerFrame): void {
  const s = get();
  const wall = Date.now();
  if (s.link.lastFrameAt !== wall) set({ link: { ...get().link, lastFrameAt: wall } });
  switch (frame.t) {
    case 'hello': {
      set({ link: { ...get().link, clientId: frame.clientId, kernel: frame.kernel } });
      sendPresence();
      return;
    }
    case 'snapshot': {
      let state = frame.state;
      if (gapPending) {
        // The reducer cannot see a lost link, so the client marks the gap, after the snapshot.
        const gap: TapeEntry = { id: `gap-${wall}`, at: state.lastTickAt ?? wall, kind: 'gap', nodeId: null, worldId: null, detail: null, note: null };
        state = { ...state, tape: [...state.tape, gap].slice(-TAPE_LIMIT) };
        gapPending = false;
      }
      // A fixture seek moves the kernel's clock backwards, so the last `rates` frame no longer says what time it is.
      const rates = state.lastTickAt === null ? get().rates : { ...get().rates, at: state.lastTickAt };
      set({ fleet: state, rates, epoch: get().epoch + 1, link: { ...get().link, status: 'up', lostAt: null, lostForMs: 0, everUp: true } });
      modelDirty = true;
      channelDirty = true;
      if (!historyAsked) { historyAsked = true; void fetchHistory(); }
      publish();
      return;
    }
    case 'events': {
      const prior = frame.seq - frame.events.length;
      if (frame.seq <= s.fleet.seq) return;
      if (prior !== s.fleet.seq) {
        gapPending = true;
        link?.resync();
        return;
      }
      const urgent = noteEvents(frame.events);
      const next = reduce(get().fleet, frame.events, frame.seq);
      if (next.sensor !== s.fleet.sensor) sensorChangedAt = clockNow(s.rates, s.fleet);
      set({ fleet: next });
      modelDirty = true;
      if (urgent) publish();
      for (const sink of fleetSinks) sink(frame.events);
      return;
    }
    case 'rates': {
      const nodes: Rates['nodes'] = {};
      for (const row of frame.nodes) nodes[row.nodeId] = row;
      set({ rates: { at: frame.at, fleet: frame.fleet, nodes } });
      modelDirty = true;
      if (wall - burnSampledAt >= 1000) {
        burnSampledAt = wall;
        const next: Record<WorldId, number[]> = {};
        for (const id of Object.keys(s.fleet.worlds)) next[id] = [...(burns[id] ?? []), frame.fleet.perWorld[id] ?? 0].slice(-60);
        burns = next;
      }
      return;
    }
    case 'text': {
      for (const sink of textSinks) sink(frame.nodeId, frame.delta);
      const { channel } = get();
      if (channel.textOn && channel.nodeId === frame.nodeId) set({ channel: { ...channel, liveText: (channel.liveText + frame.delta).slice(-8000) } });
      return;
    }
    default:
      frame satisfies never;
  }
}

function linkDown(): void {
  const l = get().link;
  gapPending = l.everUp || gapPending;
  set({ link: { ...l, status: 'lost', lostAt: l.lostAt ?? Date.now() } });
  historyAsked = false;
  modelDirty = true;
  publish();
}

// ---- presence ---------------------------------------------------------------------------------------------------------------

export function sendPresence(): void {
  const { link: l, view } = get();
  if (!l.clientId || typeof document === 'undefined') return;
  void command('ui.presence', {
    clientId: l.clientId, visible: document.visibilityState === 'visible', focused: document.hasFocus(), notifications: view.settings.notifications,
    veiled: view.settings.veil,
  });
}

// ---- the 4 Hz clock ---------------------------------------------------------------------------------------------------------

const TICK_MS = 250;
const WATCHDOG_MS = 10_000;
const CHANNEL_MIN_MS = 500;
const CHANNEL_MAX_MS = 5_000;
let channelDirty = false;
let channelBusy = false;
let channelAskedAt = 0;

function tick(): void {
  const wall = Date.now();
  const l = get().link;
  if (l.status === 'lost' && l.lostAt !== null) {
    set({ link: { ...l, lostForMs: wall - l.lostAt } });
  } else if (l.status === 'up' && wall - l.lastFrameAt > WATCHDOG_MS) {
    // Rates come at 4 Hz even from a paused fixture, so this silence is a dead socket that never said so.
    link?.resync();
  }
  if (modelDirty) publish();
  const { channel } = get();
  const due = wall - channelAskedAt >= (channelDirty ? CHANNEL_MIN_MS : CHANNEL_MAX_MS);
  // A snapshot can take a craft away. Asking for it again would only earn a 404 every five seconds.
  const known = channel.nodeId !== null && (get().fleet.nodes[channel.nodeId] !== undefined || get().model.crafts[channel.nodeId] !== undefined);
  if (channel.nodeId !== null && due && !channelBusy && l.status === 'up' && known) void fetchChannel(channel.nodeId);
}

/** Starts the socket and the clock. The page calls this once. Returns a stop for tests. */
export function startKernelLink(open?: (url: string) => SocketLike): () => void {
  const opener = open ?? ((url: string) => new WebSocket(url) as unknown as SocketLike);
  const base = (): string => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const id = get().link.clientId;
    return `${proto}://${location.host}/ws${id ? `?clientId=${encodeURIComponent(id)}` : ''}`;
  };
  link = createLink({ url: base, open: opener, onFrame: ingest, onUp: () => undefined, onDown: linkDown });
  link.connect();
  const timer = setInterval(tick, TICK_MS);
  const presence = () => sendPresence();
  document.addEventListener('visibilitychange', presence);
  window.addEventListener('focus', presence);
  window.addEventListener('blur', presence);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', presence);
    window.removeEventListener('focus', presence);
    window.removeEventListener('blur', presence);
    link?.close();
    link = null;
  };
}

// ---- Channel ----------------------------------------------------------------------------------------------------------------

async function fetchChannel(nodeId: NodeId): Promise<void> {
  const craft = get().model.crafts[nodeId];
  if (craft && craft.client !== 'claude-code' && !craft.capabilities.includes('text')) {
    channelAskedAt = Date.now();
    set({ channel: { ...get().channel, loading: false, rows: [], complete: true } });
    return;
  }
  channelBusy = true;
  channelDirty = false;
  channelAskedAt = Date.now();
  const res = await command('craft.channel', { nodeId, limit: 200 });
  channelBusy = false;
  const { channel } = get();
  if (channel.nodeId !== nodeId) return;
  if (res.ok) set({ channel: { ...channel, rows: res.result.rows, complete: res.result.complete, loading: false } });
  else set({ channel: { ...channel, loading: false } });
}

function targetChannel(nodeId: NodeId | null): void {
  const { channel } = get();
  if (channel.nodeId === nodeId) return;
  if (channel.textOn && channel.pinned) return;
  if (channel.textOn) sealChannel();
  set({ channel: { ...initialChannel(), nodeId, loading: nodeId !== null } });
  channelAskedAt = 0;
  channelDirty = true;
  if (nodeId !== null && get().link.status === 'up' && !channelBusy) void fetchChannel(nodeId);
}

function sealChannel(): void {
  const { channel, link: l } = get();
  if (channel.nodeId !== null && l.clientId) void command('craft.watchText', { nodeId: channel.nodeId, on: false, clientId: l.clientId });
  set({ channel: { ...get().channel, textOn: false, pinned: false, text: [], liveText: '', textFailed: false } });
}

/** `W`. An explicit fetch for this one craft, and moving away seals it again unless pinned. */
export async function toggleText(): Promise<void> {
  const { channel, view, link: l } = get();
  if (view.settings.veil) { say(COPY.textVeiled); return; }
  if (channel.nodeId === null) { say(COPY.channelEmpty); return; }
  if (get().model.crafts[channel.nodeId]?.capabilities.includes('text') === false) { say('This client supplies activity metadata only.'); return; }
  if (channel.textOn) { sealChannel(); return; }
  const nodeId = channel.nodeId;
  set({ channel: { ...channel, textOn: true, textFailed: false } });
  if (l.clientId) void command('craft.watchText', { nodeId, on: true, clientId: l.clientId });
  const res = await command('craft.text', { nodeId, limit: 50 });
  const now = get().channel;
  if (now.nodeId !== nodeId || !now.textOn) return;
  if (res.ok && res.result.available) set({ channel: { ...now, text: res.result.rows } });
  else set({ channel: { ...now, textFailed: true } });
}

export function pinChannel(): void {
  const { channel } = get();
  set({ channel: { ...channel, pinned: !channel.pinned } });
}

// ---- view ---------------------------------------------------------------------------------------------------------------

const patchView = (patch: Partial<View>): void => {
  const view = { ...get().view, ...patch };
  const reshell = patch.cinema !== undefined || patch.railCollapsed !== undefined || patch.level !== undefined;
  set(reshell ? { view, shell: shellOf(get().shell.vw, get().shell.vh, view) } : { view });
};

export const resize = (vw: number, vh: number): void => { set({ shell: shellOf(vw, vh, get().view) }); };

export function select(id: NodeId | null): void {
  const hidden = id !== null && get().model.crafts[id]?.visible === false;
  patchView({ selected: id, selectedWorld: id === null ? get().view.selectedWorld : null, ...(hidden ? { clientFilter: 'all' as const } : {}) });
  if (hidden) publish();
  targetChannel(id ?? get().view.follow);
}

export function selectWorld(id: WorldId | null): void {
  patchView({ selectedWorld: id, selected: null });
}

export function walk(step: 1 | -1): void {
  const { model, view } = get();
  if (model.walk.length === 0) return;
  const at = view.selected === null ? -1 : model.walk.indexOf(view.selected);
  const next = at === -1 ? (step === 1 ? 0 : model.walk.length - 1) : (at + step + model.walk.length) % model.walk.length;
  select(model.walk[next]!);
}

export function flyToSlot(slot: number): void {
  const world = get().model.allWorlds.find((w) => w.slot === slot);
  if (world) patchView({ level: 'world', worldId: world.worldId, selectedWorld: world.worldId, sky: false });
}

export function flyHome(): void {
  patchView({ level: 'system', worldId: null, sky: false });
}

/** Enter. Only ever moves the view. */
export function flyToSelection(): void {
  const { view, model } = get();
  if (view.selected !== null) {
    const craft = model.crafts[view.selected];
    if (craft) patchView({ level: 'craft', worldId: craft.worldId, sky: false });
    return;
  }
  if (view.selectedWorld !== null) patchView({ level: 'world', worldId: view.selectedWorld, sky: false });
}

/** Esc: the top overlay, then Sky, Cinema, then one level up. It never decides anything. */
export function escape(): void {
  const { view } = get();
  const top = view.overlays.at(-1);
  if (top) { closeOverlay(top.id); return; }
  if (view.railOverlay) { patchView({ railOverlay: false }); return; }
  if (view.sky) { patchView({ sky: false }); return; }
  if (view.cinema) { patchView({ cinema: false }); return; }
  if (view.level === 'craft') { patchView({ level: 'world' }); return; }
  if (view.level === 'world') { patchView({ level: 'system', worldId: null }); }
}

export function openOverlay(id: string, arg: unknown = null): boolean {
  if (!overlayDef(id)) { say(COPY.noOverlay); return false; }
  const { view } = get();
  if (view.overlays.some((o) => o.id === id)) return true;
  const active = typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null);
  patchView({ overlays: [...view.overlays, { id, arg, returnTo: active }] });
  return true;
}

export function closeOverlay(id: string): void {
  const { view } = get();
  const row = view.overlays.find((o) => o.id === id);
  if (!row) return;
  patchView({ overlays: view.overlays.filter((o) => o.id !== id) });
  row.returnTo?.focus?.();
}

export const toggleOverlay = (id: string): void => {
  if (get().view.overlays.some((o) => o.id === id)) closeOverlay(id);
  else openOverlay(id);
};

export const topOverlay = (): OpenOverlay | undefined => get().view.overlays.at(-1);
export const setKeyScope = (keyScope: View['keyScope']): void => patchView({ keyScope });

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  const settings = { ...get().view.settings, [key]: value };
  saveSettings(settings);
  patchView({ settings });
  if (key === 'veil') {
    if (value && get().channel.textOn) sealChannel();
    // Live regions keep their last line in the DOM, and that line may hold a real name.
    if (value) set({ announce: { polite: '', assertive: '', n: get().announce.n + 1 } });
    assertiveQueue.length = 0;
    politeLines.length = 0;
    publish();
  }
  if (key === 'notifications') sendPresence();
}

export function toggleVeil(): void {
  const on = !get().view.settings.veil;
  setSetting('veil', on);
  sendPresence();
  say(on ? COPY.veilOn : COPY.veilOff);
}

export function cycleTape(): void {
  const { tapeFilter } = get().view;
  const next = TAPE_FILTERS[(TAPE_FILTERS.indexOf(tapeFilter) + 1) % TAPE_FILTERS.length]!;
  patchView({ tapeFilter: next });
  publish();
  say(`Tape: ${next.replace('-', ' and ')}`);
}

/** The scene's own slice. Nothing else writes here. */
export const setScene = (patch: Partial<SceneSlice>): void => { set({ scene: { ...get().scene, ...patch } }); };

export const toggleSky = (): void => patchView({ sky: !get().view.sky, level: get().view.level });
export const setSkyDay = (day: number): void => patchView({ skyDay: Math.max(0, Math.min(30, day)) });
export const toggleCinema = (): void => patchView({ cinema: !get().view.cinema });
export const toggleManifestMode = (): void => patchView({ manifest: get().view.manifest === 'craft' ? 'world' : 'craft' });
export const toggleRailCollapse = (): void => patchView({ railCollapsed: !get().view.railCollapsed });
export const toggleRailOverlay = (): void => patchView({ railOverlay: !get().view.railOverlay });
export function setClientFilter(clientFilter: View['clientFilter']): void {
  const { view, model } = get();
  const selected = view.selected ? model.crafts[view.selected] : null;
  const leaveCraft = view.level === 'craft' && clientFilter !== 'all' && selected?.client !== clientFilter;
  patchView({ clientFilter, ...(leaveCraft ? { level: 'system' as const, worldId: null, selected: null } : {}) });
  publish();
}
export const setCollapsed = (id: WorldId, collapsed: boolean): void => patchView({ collapsed: { ...get().view.collapsed, [id]: collapsed } });

/** Space: the docket answers if it is there, otherwise the oldest decision, then the oldest wait at source, is selected. */
export function attend(requestId?: string): void {
  if (runAction('attend', requestId)) return;
  const { model } = get();
  const decision = (requestId ? model.decisions.find((d) => d.requestId === requestId) : undefined) ?? model.decisions.find((d) => d.status === 'open');
  if (decision) { select(decision.nodeId); return; }
  const wait = model.sources[0];
  if (wait) select(wait.nodeId);
}

/** Reset for tests. */
export function resetForTest(): void {
  set({
    fleet: emptyState(), rates: emptyRates(), link: { ...startLink }, history: [], salvos: [], view: initialView(), channel: initialChannel(),
    announce: { polite: '', assertive: '', n: 0 },
  });
  gapPending = false;
  historyAsked = false;
  sensorChangedAt = null;
  burns = {};
  modelDirty = true;
}

/** The test seam for a socket-driven gap. */
export function attachLinkForTest(l: Link | null): void { link = l; }
export const markLinkDownForTest = linkDown;
