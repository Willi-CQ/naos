// What the render loop reads each frame. A plain object outside React, written by the store or the bench, never by a render.
import * as THREE from 'three';
import type { Arc, Flare } from './hole/disk.ts';

export const MAX_WELLS = 8;
export const MAX_WAVES = 4;
export const MAX_STREAMS = 16;

export interface WellInput {
  /** World position of the waiting craft. */
  position: THREE.Vector3;
  /** Einstein radius in CSS px, signed. `thetaE()` times the snapback multiplier. */
  thetaCss: number;
  /** 0 sodium, 1 H-alpha. */
  ring: 0 | 1;
}

export interface WaveInput {
  /** World position of the source. */
  position: THREE.Vector3;
  /** Crest radius and amplitude in CSS px. */
  radiusCss: number;
  amplitudeCss: number;
}

export interface SceneState {
  /** Scene seconds, for dashes and for marks with a life. */
  now: number;
  /** Fleet energy, independent of any one client's quota. */
  sunLeft: number;
  still: boolean;
  diskArcs: Arc[];
  diskFlares: Array<Flare & { born: number }>;
  /** Advances with fleet output tokens, never with wall time. */
  tokenClock: number;
  /** True while tokens flow. The corona only updates then. */
  tokensMoving: boolean;
  /** Pairs of screen azimuth and load. */
  streams: Float32Array;
  streamCount: number;
  wells: WellInput[];
  waves: WaveInput[];
  /** Crest width and peak amplitude in CSS px. */
  waveShape: [number, number];
  /** 1 normal, 0.45 locked. */
  dim: number;
  /** What stays lit while dimmed: world position and two radii in CSS px. Null dims the whole frame. */
  focus: { position: THREE.Vector3; inner: number; outer: number } | null;
  /** 0 normal, 0.4 kernel link lost. */
  desat: number;
  /** Raised after anything that invalidates a target. Each pass lowers its own. */
  skyDirty: boolean;
  coronaDirty: boolean;
  /** The month changed: the environment cube is stale, and is redrawn when it next may be. */
  cubeDirty: boolean;
  /** The context came back and the cube is empty: now, whatever the last redraw was. */
  cubeLost: boolean;
  /** A body stands in front of the hole, so the finish must not paint the shadow over it. */
  holeCovered: boolean;
  /** Set by the Stage. What the environment cube holds in one direction, for the tooling. */
  probeSky: ((dir: readonly [number, number, number]) => number[] | null) | null;
}

export function createSceneState(): SceneState {
  return {
    now: 0,
    sunLeft: 1,
    still: false,
    diskArcs: [],
    diskFlares: [],
    tokenClock: 0,
    tokensMoving: false,
    streams: new Float32Array(MAX_STREAMS * 2),
    streamCount: 0,
    wells: [],
    waves: [],
    waveShape: [46, 15],
    dim: 1,
    focus: null,
    desat: 0,
    skyDirty: true,
    coronaDirty: true,
    cubeDirty: true,
    cubeLost: false,
    holeCovered: false,
    probeSky: null,
  };
}

/** Shared by every material, so one write reaches them all. */
export interface FrameUniforms {
  uRes: { value: THREE.Vector2 };
  uPxPerCss: { value: number };
  uNow: { value: number };
}

export const createFrameUniforms = (): FrameUniforms => ({
  uRes: { value: new THREE.Vector2(2, 2) },
  uPxPerCss: { value: 1 },
  uNow: { value: 0 },
});
