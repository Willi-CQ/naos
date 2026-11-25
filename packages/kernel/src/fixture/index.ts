// The scripted fleet: a Plane that drives the same bus as the real ones. State at time t comes only from the timeline, so a
// seek replays from t = 0 and a shot at t repeats. The clock is the timeline's, and it stops when the timeline is paused.
import { CommandError } from '../context.ts';
import type { KernelContext, Plane } from '../context.ts';
import type { KernelBus } from '../bus.ts';
import { placeholder, registerCommands } from './commands.ts';
import { buildHistory } from './history.ts';
import { DURATION_S, FIXTURE_EPOCH } from './scene.ts';
import { buildIdleTimeline, buildTimeline, rateAt, stateAt } from './timeline.ts';
import type { Timeline } from './timeline.ts';
import type { FleetRate, NaosEvent, NodeId, NodeRate } from '@naos/protocol';

const STEP_MS = 33;
const RATE_STEP_MS = 200;
const MAX_SPEED = 32;
const BASE_TODAY_USD = 11.4;
const BURN_USD_PER_HOUR = 3.2;

interface Later {
  t: number;
  run(): void;
  agentId?: string;
}

export interface FixturePlane extends Plane {
  /** Timeline position in seconds. */
  position(): { t: number; playing: boolean; loop: number };
}

export function createFixture(bus: KernelBus): FixturePlane {
  const history = buildHistory(FIXTURE_EPOCH);
  const durationMs = DURATION_S * 1000;

  let timeline: Timeline = buildTimeline(history, FIXTURE_EPOCH);
  /** The morning of DESIGN 12.4: no craft, the month behind them. A seek leaves it. */
  let idle = false;
  let loop = 0;
  let tMs = 0;
  let cursor = 0;
  let playing = true;
  let speed = 1;
  let timer: NodeJS.Timeout | null = null;
  let lastReal = 0;
  let lastRates = 0;
  let unsubscribe: (() => void) | null = null;

  let applied: NaosEvent[] = [];
  let later: Later[] = [];
  const muted = new Set<string>();
  const overrides = new Map<NodeId, { tps: number; block: 'thinking' | 'text' | null }>();
  const watched = new Set<NodeId>();
  /** Tokens a whole loop adds, so the corona's counter keeps rising through a wrap. */
  const tokensPerLoop = timeline.lanes.reduce((sum, lane) => sum + rateAt(lane, durationMs).outputTokens, 0);

  const today = (): { usd: number; burn: number } => {
    const usd = Math.round((BASE_TODAY_USD + (BURN_USD_PER_HOUR * (loop * durationMs + tMs)) / 3_600_000) * 100) / 100;
    return { usd, burn: BURN_USD_PER_HOUR };
  };

  /** A pure function of the timeline position, plus what an operator overrode since the last seek. */
  const pushRates = (): void => {
    const state = bus.state();
    const nodes: NodeRate[] = [];
    const perWorld: Record<string, number> = {};
    let tps = 0;
    let outputTokens = loop * tokensPerLoop;
    const add = (nodeId: NodeId, worldId: string | undefined, source: NodeRate['source'], rate: number, block: NodeRate['liveBlock'], tokens: number): void => {
      outputTokens += tokens;
      if (rate <= 0) return;
      tps += rate;
      if (worldId !== undefined) perWorld[worldId] = (perWorld[worldId] ?? 0) + rate;
      nodes.push({ nodeId, tps: rate, source, liveBlock: block, outputTokens: tokens });
    };
    for (const lane of timeline.lanes) {
      const rate = rateAt(lane, tMs);
      if (!overrides.has(lane.nodeId)) add(lane.nodeId, lane.worldId, lane.source, muted.has(lane.nodeId) ? 0 : rate.tps, rate.block, rate.outputTokens);
    }
    for (const [nodeId, rate] of overrides) {
      const session = state.sessions[state.nodes[nodeId]?.sessionId ?? ''];
      add(nodeId, session?.worldId, 'live', rate.tps, rate.block, 0);
    }
    let lagMaxMs = 0;
    for (const node of Object.values(state.nodes)) {
      if (node.endedAt === null && (node.flushLagMs ?? 0) > lagMaxMs) lagMaxMs = node.flushLagMs ?? 0;
    }
    const { usd, burn } = today();
    const fleet: FleetRate = { tps, outputTokens, perWorld, burnUsdPerHour: burn, todayUsd: usd, lagMaxMs };
    bus.replaceRates(nodes, fleet);
  };

  const rebuild = (targetMs: number, nextLoop: number): void => {
    if (nextLoop !== loop) timeline = idle ? buildIdleTimeline(history, FIXTURE_EPOCH + nextLoop * durationMs) : buildTimeline(history, FIXTURE_EPOCH + nextLoop * durationMs);
    loop = nextLoop;
    tMs = targetMs;
    const replay = stateAt(timeline, targetMs);
    cursor = replay.cursor;
    applied = timeline.steps.slice(0, cursor).map((step) => step.event);
    later = [];
    muted.clear();
    overrides.clear();
    bus.reset(replay.state);
    pushRates();
  };

  /** A taken-over craft leaves the script. Its tenders and its workflow keep running, because nobody took those over. */
  const isMuted = (event: NaosEvent): boolean => {
    switch (event.type) {
      case 'workflow.changed':
        return false;
      case 'managed.upserted':
        return muted.has(event.agent.nodeId);
      case 'approval.requested':
        return muted.has(event.approval.nodeId);
      default:
        return 'nodeId' in event && muted.has(event.nodeId);
    }
  };

  const apply = (event: NaosEvent): void => {
    if (!isMuted(event)) bus.publish(event);
  };

  const pushWatchedText = (): void => {
    const { nodes } = bus.ratesFrame();
    for (const nodeId of watched) {
      if (nodes.some((rate) => rate.nodeId === nodeId && rate.liveBlock === 'text')) bus.pushText(nodeId, `${placeholder(32)} `);
    }
  };

  const advance = (target: number): void => {
    if (target >= durationMs) {
      rebuild(target - durationMs, loop + 1);
      return;
    }
    tMs = target;
    while (cursor < timeline.steps.length && timeline.steps[cursor]!.t <= tMs) {
      apply(timeline.steps[cursor]!.event);
      cursor += 1;
    }
    if (later.length > 0) {
      const due = later.filter((entry) => entry.t <= tMs);
      if (due.length > 0) {
        later = later.filter((entry) => entry.t > tMs);
        for (const entry of due) entry.run();
      }
    }
  };

  const step = (): void => {
    const real = performance.now();
    const elapsed = real - lastReal;
    lastReal = real;
    if (playing) advance(tMs + elapsed * speed);
    if (real - lastRates >= RATE_STEP_MS) {
      lastRates = real;
      pushRates();
      if (playing) pushWatchedText();
    }
  };

  const control = (input: { action: 'pause' | 'play' | 'seek' | 'speed' | 'idle'; value?: number }): { t: number; playing: boolean } => {
    switch (input.action) {
      case 'idle':
        idle = true;
        timeline = buildIdleTimeline(history, FIXTURE_EPOCH);
        rebuild(0, 0);
        break;
      case 'pause':
        playing = false;
        break;
      case 'play':
        playing = true;
        break;
      case 'seek': {
        const seconds = input.value;
        if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) throw new CommandError('bad-request', 'seek needs a time in seconds');
        if (idle) {
          idle = false;
          timeline = buildTimeline(history, FIXTURE_EPOCH);
          loop = 0;
        }
        rebuild(Math.round((seconds * 1000) % durationMs), 0);
        break;
      }
      case 'speed': {
        const value = input.value;
        if (typeof value !== 'number' || !(value > 0) || value > MAX_SPEED) throw new CommandError('bad-request', `speed runs up to ${MAX_SPEED}`);
        speed = value;
        break;
      }
      default:
        throw new CommandError('bad-request', 'unknown action');
    }
    return { t: tMs / 1000, playing };
  };

  return {
    name: 'fixture',
    start(ctx: KernelContext) {
      bus.setClock(() => timeline.base + Math.round(tMs));
      unsubscribe = bus.subscribe((event) => {
        if (event.type !== 'kernel.tick') applied.push(event);
      });
      registerCommands(ctx.router, {
        bus,
        history,
        after(delayS, run, agentId) {
          later.push({ t: tMs + delayS * 1000, run, ...(agentId === undefined ? {} : { agentId }) });
        },
        cancelFor(agentId) {
          later = later.filter((entry) => entry.agentId !== agentId);
        },
        mute(nodeId) {
          muted.add(nodeId);
        },
        override(nodeId, rate) {
          if (rate) overrides.set(nodeId, rate);
          else overrides.delete(nodeId);
        },
        applied: () => applied,
        watch(nodeId, on) {
          if (on) watched.add(nodeId);
          else watched.delete(nodeId);
        },
        control,
        today,
      });
      rebuild(0, 0);
      lastReal = performance.now();
      timer = setInterval(step, STEP_MS);
      return Promise.resolve();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      unsubscribe?.();
      return Promise.resolve();
    },
    position: () => ({ t: tMs / 1000, playing, loop }),
  };
}
