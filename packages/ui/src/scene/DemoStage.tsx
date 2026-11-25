import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { DEMO_END, DEMO_IDS, demoPhase, demoRoster } from '../core/demo.ts';
import { placeLabels, type CraftLabelIn } from '../core/labels.ts';
import { HOLE_RADIUS } from '../core/space.ts';
import { setScene, useNaos } from '../store/store.ts';
import type { SceneController } from './controller.ts';
import { useStage } from './context.ts';
import { CraftLayer } from './craft/Layer.ts';
import { FleetEngine, type FleetBody } from './fleet.ts';
import { diskLight } from './hole/disk.ts';
import { Arcs, Beams, Hulls } from './layers/Layers.tsx';
import { ArcBuffer, BeamBuffer, HullBuffer } from './layers/buffers.ts';

export function DemoStage({ controller }: { controller: SceneController }) {
  const gl = useThree((s) => s.gl);
  const { state } = useStage();
  const demo = useMemo(() => {
    const buffers = { plumes: new ArcBuffer(128, 48), wakes: new ArcBuffer(64, 48), rings: new ArcBuffer(128, 48), hulls: new HullBuffer(128), beams: new BeamBuffer(32) };
    const engine = new FleetEngine(buffers, (id) => controller.worldBody(id) as FleetBody | undefined);
    engine.externalShips = true;
    const layer = new CraftLayer({ base: 24 });
    return { buffers, engine, layer, attached: false, run: -1, elapsed: 0, last: -1, key: '', target: '', seen: new Set<string>(), ended: new Set<string>(),
      time: { value: 0 }, size: new THREE.Vector2(), direction: new THREE.Vector3(), light: [0, 0, 0] as [number, number, number],
      add: (craft: Parameters<CraftLayer['add']>[0]) => layer.add(craft) };
  }, [controller]);
  useEffect(() => {
    demo.attached = true;
    controller.demoFleet = demo.engine;
    return () => {
      demo.attached = false;
      controller.demoFleet = null;
      // React rehearses effects in development; only a real unmount releases the preview's GPU resources.
      queueMicrotask(() => {
        if (demo.attached) return;
        demo.layer.dispose();
        for (const buffer of Object.values(demo.buffers)) buffer.geometry.dispose();
      });
    };
  }, [controller, demo]);

  useFrame(() => {
    const app = useNaos.getState(), config = app.scene.demo;
    if (!config?.active) return;
    const world = app.view.worldId || demo.target || app.view.selectedWorld || app.model.allWorlds.find((w) => w.name === 'NAOS')?.worldId || app.model.allWorlds[0]?.worldId;
    if (!world) return;
    const body = controller.worldBody(world);
    if (!body) { controller.animate(); return; }
    const view = { level: app.view.level, worldId: app.view.level === 'system' ? null : world, selected: null };
    const options = { free: app.shell.free, craftK: app.shell.craftK, discR: HOLE_RADIUS, reduced: state.still, cut: false, hidden: controller.isHidden };
    if (demo.run !== config.run) {
      demo.engine.setRoster({ crafts: [], hoops: [] }, view, { ...options, cut: true }, 100000);
      demo.run = config.run; demo.elapsed = config.elapsed; demo.key = ''; demo.last = state.now;
      demo.seen.clear(); demo.ended.clear();
    }
    const dt = demo.last < 0 ? 0 : Math.min(0.1, Math.max(0, state.now - demo.last));
    demo.last = state.now;
    const advance = config.paused || state.still || document.hidden ? 0 : dt * (config.slow ? 0.5 : 1);
    demo.elapsed = Math.min(DEMO_END, demo.elapsed + advance);
    demo.time.value = demo.elapsed;
    const wall = demo.elapsed * 1000;
    const key = `${world}|${view.level}|${app.shell.free.w}|${app.shell.free.h}|${Math.floor(demo.elapsed)}|${state.still}`;
    if (key !== demo.key) {
      const roster = demoRoster(world, demo.elapsed);
      for (const craft of roster.crafts) {
        if (craft.state !== 'finished' || !demo.seen.has(craft.id) || demo.ended.has(craft.id)) continue;
        demo.engine.land(craft.id, false, wall); demo.ended.add(craft.id);
      }
      demo.engine.setRoster(roster, view, options, 100000 + wall);
      if (!demo.seen.has(DEMO_IDS[0]) || demo.target !== world) {
        demo.direction.copy(controller.camera.position).sub(body.position);
        demo.engine.setAngle(DEMO_IDS[0], Math.atan2(demo.direction.dot(body.b), demo.direction.dot(body.a)));
      }
      for (const craft of roster.crafts) {
        if (craft.state === 'finished' || demo.seen.has(craft.id)) continue;
        demo.engine.launch(craft.id, craft.parentId, wall); demo.seen.add(craft.id);
      }
      demo.target = world; demo.key = key;
    }
    demo.engine.hullScale = controller.rig.hullScale;
    demo.engine.draw({ wall, kernel: 100000 + wall, dt: advance, scene: demo.elapsed }, controller.camera);
    const [r, g, b] = diskLight(state.sunLeft, demo.light);
    demo.layer.uniforms.uKey.value.setRGB(2.4 * r, 2.4 * g, 2.4 * b);
    demo.layer.uniforms.uBody.value.set(body.position.x, body.position.y, body.position.z, body.radius);
    demo.layer.markScale = app.shell.craftK * controller.rig.hullScale;
    demo.layer.begin(controller.camera, app.shell.free, gl.getDrawingBufferSize(demo.size).x / app.shell.free.w);
    demo.engine.drawShips(demo.add, demo.elapsed);
    demo.layer.commit(gl);
    const phase = state.still ? 'Static preview' : demoPhase(demo.elapsed);
    if (phase !== config.phase || Math.floor(demo.elapsed) !== config.elapsed) {
      setScene({ demo: { ...config, elapsed: Math.floor(demo.elapsed), phase, paused: config.paused || demo.elapsed >= DEMO_END } });
    }
    if (!config.paused && !state.still && demo.elapsed < DEMO_END) controller.animate();
  }, -2);
  return <>
    <primitive object={demo.layer.group} />
    <Arcs buffer={demo.buffers.plumes} time={demo.time} /><Arcs buffer={demo.buffers.wakes} time={demo.time} />
    <Arcs buffer={demo.buffers.rings} time={demo.time} /><Hulls buffer={demo.buffers.hulls} /><Beams buffer={demo.buffers.beams} time={demo.time} />
  </>;
}

const LABELS = ['DEMO · lead', 'DEMO · Claude', 'DEMO · Codex', 'DEMO · Cursor'];
export function DemoLabels({ controller }: { controller: SceneController }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const nodes = [...root.current!.children] as HTMLElement[];
    const held = new Map<string, number>();
    const offsets = { start: '0', middle: '-50%', end: '-100%' };
    let frame = 0;
    const place = () => {
      const { shell } = useNaos.getState(), engine = controller.demoFleet;
      const crafts: CraftLabelIn[] = [];
      DEMO_IDS.forEach((id, i) => {
        const spot = engine?.spot(id), node = nodes[i]!;
        node.hidden = !spot;
        if (spot) crafts.push({ id, x: spot.x, y: spot.y, width: node.offsetWidth, reach: 18 });
      });
      const labels = placeLabels({ worlds: [], crafts, dots: crafts, held, discR: 0, discX: -1e6, discY: -1e6, w: shell.free.w, h: shell.free.h, almanacTop: Infinity });
      for (const label of labels) {
        const node = nodes[DEMO_IDS.indexOf(label.id as typeof DEMO_IDS[number])]!;
        held.set(label.id, label.turn);
        node.style.transform = `translate(${Math.round(label.x + shell.free.w / 2)}px,${Math.round(label.y + shell.free.h / 2 - 13)}px) translateX(${offsets[label.anchor]})`;
      }
      frame = requestAnimationFrame(place);
    };
    frame = requestAnimationFrame(place);
    return () => cancelAnimationFrame(frame);
  }, [controller]);
  return <div ref={root} className="demo-labels" aria-hidden="true">{LABELS.map((label) => <span key={label} hidden>{label}</span>)}</div>;
}
