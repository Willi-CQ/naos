// Section 6 as a table. One state in, what the scene draws out. Motion and shape come first, colour third, so a row must read with the
// colour taken away, and a test holds that. Pure, so the shape language is proved without a GPU.
import type { ToolFamily } from '@naos/protocol';
import type { VisualState } from './state.ts';

export type SceneTone = 'oiii' | 'pearl' | 'nad' | 'halpha' | 'ash' | 'bone' | 'slag' | 'lamp' | 'rule';
export type PlumeKind = 'writing' | 'thinking' | 'observed' | 'flicker' | 'retro';
export type RingKind = 'well' | 'broken' | 'hollow' | 'countdown' | 'fuel';
export type HullForm = 'kite' | 'shards' | 'none';
export type ViewLevel = 'system' | 'world' | 'craft';

export interface Look {
  hull: HullForm;
  /** 1 filled, 0 outline. Hull fill is owned or observed unless the row says otherwise. */
  fill: 0 | 1;
  tone: SceneTone;
  gain: number;
  /** A dashed outline, the frozen `lost`. */
  dashed: boolean;
  /** Radians off the flight path: 30 degrees for a retry, half a turn for a retro burn. */
  turn: number;
  /** Radians a second. A tumble means dead, and nothing else ever tumbles. */
  tumble: number;
  /** Law 3: it travels with its tokens. */
  moves: boolean;
  plume: PlumeKind | null;
  ring: RingKind | null;
  /** The slash that lies across an interrupted or stopping hull. */
  slash: boolean;
  /** Beacon on the 1 s probe. */
  beacon: boolean;
  /** A dim dashed lance: a shell left running under a moored craft. */
  shellLance: boolean;
  /** The dim tick of NO SIGNAL. */
  tick: boolean;
  /** Sits on the Pad, near the star. */
  pad: boolean;
  /** A far holding orbit. */
  holding: boolean;
  /** Drifts off its orbit at 1 px/s. */
  drift: boolean;
  /** Flies the transfer arc. */
  transfer: boolean;
}

const BASE: Look = {
  hull: 'kite', fill: 0, tone: 'pearl', gain: 2.8, dashed: false, turn: 0, tumble: 0, moves: false, plume: null, ring: null, slash: false, beacon: false,
  shellLance: false, tick: false, pad: false, holding: false, drift: false, transfer: false,
};

const WORK = 2.8;
/** 5.4 says 0.5, against a token that is already dark. On this curve that is no hull at all, and the reference shows a thin grey kite. */
const IDLE = 1.3;
const TURN_RETRY = Math.PI / 6;
const TUMBLE = (Math.PI * 2) / 6;
const GONE: Partial<Look> = { hull: 'none', gain: 0 };

/** Fill from the row. `null` keeps the owned or observed rule of 2.2. */
const ROWS: Record<VisualState, Partial<Look> & { filled?: boolean }> = {
  thinking: { tone: 'oiii', gain: WORK, moves: true, plume: 'thinking' },
  writing: { tone: 'oiii', gain: WORK, moves: true, plume: 'writing' },
  generating: { tone: 'oiii', gain: WORK, plume: 'observed', filled: false },
  tool: { tone: 'pearl', gain: WORK },
  approve: { tone: 'nad', gain: 2.6, ring: 'well', filled: true },
  answer: { tone: 'nad', gain: 2.6, ring: 'well', filled: true },
  plan: { tone: 'nad', gain: 2.6, ring: 'well', filled: true },
  source: { tone: 'nad', gain: 2.5, ring: 'broken', filled: false },
  parked: { tone: 'nad', gain: 0.6, ring: 'hollow', holding: true, filled: false },
  idle: { tone: 'ash', gain: IDLE, beacon: true, filled: false },
  'idle-shell': { tone: 'ash', gain: IDLE, beacon: true, shellLance: true, filled: false },
  interrupted: { tone: 'bone', gain: 1.4, slash: true },
  compacting: { tone: 'pearl', gain: 4 },
  retrying: { tone: 'pearl', gain: WORK, turn: TURN_RETRY, plume: 'flicker', ring: 'countdown' },
  'no-signal': { tone: 'oiii', gain: WORK, plume: 'observed', tick: true, filled: false },
  queued: { tone: 'bone', gain: 1.2, pad: true, filled: false },
  spawning: { tone: 'oiii', gain: WORK, transfer: true, filled: true },
  starting: { tone: 'bone', gain: 1.2, filled: false },
  ready: { tone: 'bone', gain: 1.2, filled: false },
  stopping: { tone: 'bone', gain: 1.4, turn: Math.PI, plume: 'retro', slash: true },
  'rate-limited': { tone: 'pearl', gain: 0.6, ring: 'countdown', filled: false },
  errored: { tone: 'halpha', gain: WORK, tumble: TUMBLE, filled: true },
  'no-budget': { tone: 'bone', gain: 1.2, ring: 'fuel', filled: false },
  crashed: { hull: 'shards', tone: 'halpha', gain: WORK },
  orphaned: { tone: 'ash', gain: 1, drift: true, filled: false },
  lost: { tone: 'slag', gain: 1.2, dashed: true, filled: false },
  finished: GONE,
  exited: GONE,
  abandoned: GONE,
  failed: GONE,
  stopped: GONE,
  unknown: { tone: 'slag', gain: 0.8, filled: false },
};

export function lookOf(state: VisualState, owned: boolean): Look {
  const { filled, ...row } = ROWS[state];
  return { ...BASE, fill: (filled ?? owned) ? 1 : 0, ...row };
}

const BEAD_DONE = { tone: 'lamp', gain: 1.3, fill: 1 } as const;
const BEAD_FAILED = { tone: 'halpha', gain: 3, fill: 1 } as const;
const BEAD_STOPPED = { tone: 'slag', gain: 0.8, fill: 1 } as const;
const BEAD_DERELICT = { tone: 'ash', gain: 0.5, fill: 0 } as const;
const BEAD_UNKNOWN = { tone: 'slag', gain: 0.8, fill: 0 } as const;
const BEAD_TOOL = { tone: 'pearl', gain: 2.4, fill: 1 } as const;
const BEAD_WORK = { tone: 'oiii', gain: 2.2, fill: 1 } as const;

/** A workflow agent is a bead, whatever it is doing. */
export function beadTone(state: VisualState): { tone: SceneTone; gain: number; fill: 0 | 1 } {
  switch (state) {
    case 'finished': return BEAD_DONE;
    case 'failed': case 'errored': case 'crashed': return BEAD_FAILED;
    case 'stopped': return BEAD_STOPPED;
    case 'orphaned': case 'lost': return BEAD_DERELICT;
    case 'unknown': return BEAD_UNKNOWN;
    case 'tool': return BEAD_TOOL;
    default: return BEAD_WORK;
  }
}

/** Section 2.4: the two highest base rates stay off the System view. */
const BEAM_FROM: Record<ToolFamily, 0 | 1 | null> = { shell: 1, read: 1, edit: 0, web: 1, mcp: 1, launch: 0, send: 0, ask: null, other: 1 };
const LEVEL_RANK: Record<ViewLevel, number> = { system: 0, world: 1, craft: 1 };

export const beamVisible = (family: ToolFamily, level: ViewLevel): boolean => {
  const from = BEAM_FROM[family];
  return from !== null && LEVEL_RANK[level] >= from;
};

/** Selected craft only at Craft level: 7.9. */
export const orbitsShown = (level: ViewLevel, selected: boolean, inWorld: boolean): boolean => (level === 'world' ? inWorld : selected);

export const FLIGHT_GAIN = { writing: 9, thinking: 5, observed: 3, flicker: 3, retro: 3 } as const;

export interface PlumeStyle { length: number; width: number; gain: number; dashes: number; flow: number }

/**
 * Length in CSS px before craftK. The gains are the tuned ones from the bench: 7.5 calls its numbers starting values, and at 4.2 a plume
 * sits under the bloom threshold, where the reference has it well over. Writes into `out`, because this runs per craft per frame.
 */
export function plumeStyle(kind: PlumeKind, tps: number, timeS: number, still: boolean, out: PlumeStyle = { length: 0, width: 0, gain: 0, dashes: 0, flow: 0 }): PlumeStyle {
  out.dashes = 0;
  out.flow = 0;
  const full = 30 + 38 * (1 - Math.exp(-tps / 120));
  switch (kind) {
    case 'writing':
      out.length = full;
      out.width = 4.6;
      out.gain = FLIGHT_GAIN.writing;
      break;
    case 'thinking':
      // Length pulses 70 to 100 % at 0.8 Hz.
      out.length = full * (still ? 1 : 0.85 + 0.15 * Math.sin(timeS * Math.PI * 2 * 0.8));
      out.width = 3.4;
      out.gain = FLIGHT_GAIN.thinking;
      break;
    case 'observed':
      out.length = 30;
      out.width = 3;
      out.gain = FLIGHT_GAIN.observed;
      out.dashes = 9;
      out.flow = still ? 0 : 1.5;
      break;
    case 'flicker':
      // A stepped 2 Hz. A stutter that is never called stalled, so the drive stays visibly on half the time.
      out.length = 30;
      out.width = 3;
      out.gain = still || Math.floor(timeS * 4) % 2 === 0 ? FLIGHT_GAIN.flicker : 0;
      break;
    default:
      out.length = 22;
      out.width = 3;
      out.gain = FLIGHT_GAIN.retro;
  }
  return out;
}
