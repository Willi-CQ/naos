// Frame numbers for the bench and for the real app. rAF intervals say what a viewer gets, timer queries say what the GPU spent, and only the
// queries can see headroom, because an rAF interval never falls below vsync.
import { RenderPass } from 'postprocessing';
import type * as THREE from 'three';

interface Disjoint {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

export interface Percentiles { count: number; mean: number; p50: number; p95: number; p99: number; max: number }

export function percentiles(values: readonly number[]): Percentiles {
  if (!values.length) return { count: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  const v = [...values].sort((a, b) => a - b);
  const at = (q: number) => v[Math.min(v.length - 1, Math.floor(q * v.length))]!;
  const round = (n: number) => Math.round(n * 100) / 100;
  return { count: v.length, mean: round(v.reduce((a, b) => a + b, 0) / v.length), p50: round(at(0.5)), p95: round(at(0.95)), p99: round(at(0.99)), max: round(v.at(-1)!) };
}

type Section = 'pre' | 'scene' | 'post';
interface Pending { query: WebGLQuery; section: Section; frame: number }
interface FrameSample { pre: number; scene: number; post: number; left: number }

/** One GPU time for each of the three parts of a frame: offscreen passes, the scene, the post chain. */
export class Meter {
  private gl: WebGL2RenderingContext | null = null;
  private ext: Disjoint | null = null;
  private open: Section | null = null;
  private pending: Pending[] = [];
  private frames = new Map<number, FrameSample>();
  private free: WebGLQuery[] = [];
  private frameId = 0;
  private cpuStart = 0;
  recording = false;
  rendered = 0;
  disjoint = 0;
  raf: number[] = [];
  gpu: number[] = [];
  pre: number[] = [];
  sceneMs: number[] = [];
  post: number[] = [];
  cpu: number[] = [];
  calls = 0;
  triangles = 0;
  points = 0;
  lastCalls = 0;

  attach(renderer: THREE.WebGLRenderer): void {
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    this.ext = this.gl.getExtension('EXT_disjoint_timer_query_webgl2') as Disjoint | null;
    this.pending = [];
    this.free = [];
    this.frames.clear();
    this.open = null;
  }

  get hasTimer(): boolean { return this.ext !== null; }

  reset(): void {
    this.raf = []; this.gpu = []; this.pre = []; this.sceneMs = []; this.post = []; this.cpu = [];
    this.rendered = 0; this.disjoint = 0;
  }

  private begin(section: Section): void {
    const { gl, ext } = this;
    if (!gl || !ext || gl.isContextLost()) return;
    const query = this.free.pop() ?? gl.createQuery();
    if (!query) return;
    gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    this.open = section;
    this.pending.push({ query, section, frame: this.frameId });
  }

  private end(): void {
    const { gl, ext } = this;
    if (gl && ext && this.open && !gl.isContextLost()) gl.endQuery(ext.TIME_ELAPSED_EXT);
    this.open = null;
  }

  frameStart(renderer: THREE.WebGLRenderer): void {
    this.collect();
    this.frameId++;
    this.frames.set(this.frameId, { pre: 0, scene: 0, post: 0, left: 3 });
    renderer.info.reset();
    this.cpuStart = performance.now();
    this.begin('pre');
  }

  sceneStart(): void { this.end(); this.begin('scene'); }
  postStart(): void { this.end(); this.begin('post'); }

  frameEnd(renderer: THREE.WebGLRenderer): void {
    this.end();
    this.rendered++;
    const cpu = performance.now() - this.cpuStart;
    this.lastCalls = renderer.info.render.calls;
    if (this.recording) {
      this.cpu.push(cpu);
      this.calls = Math.max(this.calls, renderer.info.render.calls);
      this.triangles = Math.max(this.triangles, renderer.info.render.triangles);
      this.points = Math.max(this.points, renderer.info.render.points);
    }
  }

  collect(): void {
    const { gl, ext } = this;
    if (!gl || !ext || gl.isContextLost()) return;
    const bad = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean;
    if (bad) this.disjoint++;
    while (this.pending.length) {
      const p = this.pending[0]!;
      if (p.frame === this.frameId) break;
      if (!gl.getQueryParameter(p.query, gl.QUERY_RESULT_AVAILABLE)) break;
      this.pending.shift();
      const ns = gl.getQueryParameter(p.query, gl.QUERY_RESULT) as number;
      this.free.push(p.query);
      const f = this.frames.get(p.frame);
      if (!f || bad) continue;
      f[p.section] = ns / 1e6;
      if (--f.left === 0) {
        this.frames.delete(p.frame);
        if (this.recording) {
          this.gpu.push(f.pre + f.scene + f.post);
          this.pre.push(f.pre);
          this.sceneMs.push(f.scene);
          this.post.push(f.post);
        }
      }
    }
  }

  summary() {
    return {
      rendered: this.rendered,
      raf: percentiles(this.raf.slice(3)),
      gpu: percentiles(this.gpu),
      gpuPre: percentiles(this.pre),
      gpuScene: percentiles(this.sceneMs),
      gpuPost: percentiles(this.post),
      cpu: percentiles(this.cpu),
      disjoint: this.disjoint,
      calls: this.calls,
      triangles: this.triangles,
      points: this.points,
    };
  }
}

/** A RenderPass that marks the border between the scene and the post chain. */
export function timedRenderPass(meter: Meter) {
  return (scene: THREE.Scene, camera: THREE.Camera): RenderPass => {
    const pass = new RenderPass(scene, camera);
    const render = pass.render.bind(pass);
    pass.render = (...args: Parameters<RenderPass['render']>) => {
      meter.sceneStart();
      render(...args);
      meter.postStart();
    };
    return pass;
  };
}
