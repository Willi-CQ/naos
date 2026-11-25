// The real scene. This file is the lazy chunk: three, R3F and the shaders arrive only through it, after the first paint, and never
// when settings.scene is off or WebGL is missing. The controller lives outside React, and this component only hands it to the Stage.
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { MouseEvent, PointerEvent } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { TIERS } from '../core/tiers.ts';
import { setScene, useNaos, useShell, useView } from '../store/store.ts';
import { SceneController } from './controller.ts';
import { LabelLayer } from './LabelLayer.tsx';
import { Arcs, Beams, Belt, Cities, Hulls, Worlds } from './layers/Layers.tsx';
import { Ships } from './craft/Ships.tsx';
import { Harbors } from './Harbors.tsx';
import { DemoLabels, DemoStage } from './DemoStage.tsx';
import { PlanetLayer } from './planet/PlanetLayer.tsx';
import { Stage } from './Stage.tsx';
import { Signals } from './Signals.tsx';
import { useTier } from './useTier.ts';

function Bodies({ controller }: { controller: SceneController }) {
  const { buffers } = controller;
  const system = useView((v) => v.level === 'system');
  const demo = useNaos((s) => s.scene.demo?.active ?? false);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => { controller.attach(invalidate, gl); }, [controller, gl, invalidate]);
  useFrame(() => controller.beforeFrame(gl), -5);
  useFrame(() => controller.afterFrame(gl), 10);
  return (
    <>
      {/* Moons, Belt rocks, and each world until its planet has landed. PlanetLayer takes the worlds over through controller.handOver. */}
      <Worlds buffer={buffers.worlds} />
      <Cities buffer={buffers.cities} world={buffers.uWorld} spin={buffers.uSpin} px={2.3} />
      {system ? <Belt turn={buffers.beltTurn} /> : null}
      <Arcs buffer={buffers.paths} />
      <group visible={!demo}>
      <Arcs buffer={buffers.arcs24} />
      <Arcs buffer={buffers.arcs48} />
      <Arcs buffer={buffers.arcs96} />
      <Arcs buffer={buffers.wakes} />
      <Arcs buffer={buffers.rings} />
      <Hulls buffer={buffers.hulls} />
      <Beams buffer={buffers.beams} />
      </group>
    </>
  );
}

export default function Live() {
  const demo = useNaos((s) => s.scene.demo?.active ?? false);
  const invalidDemoView = useNaos((s) => s.view.sky || s.view.level === 'craft' || !s.view.settings.scene || s.link.status !== 'up' || s.scene.context === 'lost' || s.scene.retired);
  const free = useShell((s) => s.free);
  const craftK = useShell((s) => s.craftK);
  const quality = useView((v) => v.settings.quality);
  const forced = quality === 'auto' ? null : TIERS.findIndex((t) => t.name === quality);
  const control = useTier(free, window.devicePixelRatio, undefined, true, forced);
  const firstFree = useRef(free);
  const firstK = useRef(craftK);
  const controller = useMemo(() => new SceneController(firstFree.current, firstK.current), []);
  const sky = useSyncExternalStore(controller.onSky, controller.currentSky);

  useEffect(() => controller.start(), [controller]);
  useEffect(() => {
    const config = useNaos.getState().scene.demo;
    if (demo && invalidDemoView && config) setScene({ demo: { ...config, active: false } });
  }, [demo, invalidDemoView]);
  useEffect(() => { controller.setTier(control.tier); }, [controller, control.tier]);
  useEffect(() => { if (control.plate) controller.retire('frames stayed too slow at every tier'); }, [controller, control.plate]);
  useEffect(() => {
    const look = () => { controller.onBattery = control.onBattery(); };
    look();
    const timer = setInterval(look, 2000);
    return () => clearInterval(timer);
  }, [controller, control]);

  // Native, because React's wheel listener is passive and a zoom must not scroll anything. On the slot, so a label under the pointer does not stop it.
  const surface = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const slot = surface.current?.parentElement;
    if (!slot) return undefined;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const box = slot.getBoundingClientRect();
      controller.wheel(e.deltaY, e.ctrlKey, e.clientX - box.left, e.clientY - box.top);
    };
    slot.addEventListener('wheel', wheel, { passive: false });
    return () => slot.removeEventListener('wheel', wheel);
  }, [controller]);

  const dragged = useRef(false);
  const at = (e: MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  };
  const click = (e: MouseEvent<HTMLDivElement>) => {
    const { x, y } = at(e);
    if (!dragged.current) controller.click(x, y);
    dragged.current = false;
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    const { x, y } = at(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    controller.press(x, y, e.pointerId, e.button !== 0 || e.shiftKey);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const { x, y } = at(e);
    if (e.buttons !== 0) { controller.move(x, y, e.pointerId); return; }
    e.currentTarget.style.cursor = controller.hoverable(x, y) ? 'pointer' : '';
  };
  const up = (e: PointerEvent<HTMLDivElement>) => { dragged.current = controller.release(e.pointerId); };
  const twice = (e: MouseEvent<HTMLDivElement>) => {
    const { x, y } = at(e);
    controller.open(x, y);
  };

  return (
    <>
      <div ref={surface} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} onClick={click} onDoubleClick={twice} onContextMenu={(e) => e.preventDefault()} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <Stage free={free} tier={control.tier} dpr={control.dpr} camera={controller.camera} state={controller.state} sky={sky} skyFrameBasis={controller.frame}
               cadence={controller.cadence} onBattery={control.onBattery} capHz={control.capHz} onFrame={control.onFrame} onRest={control.rest}
               onLost={controller.onLost} onRestored={controller.onRestored} wake={controller.wake} renderPass={controller.renderPass}>
          <Bodies controller={controller} />
          <PlanetLayer controller={controller} tier={control.tier} />
          <Signals controller={controller} />
          <Ships controller={controller} />
          <Harbors controller={controller} />
          {demo ? <DemoStage controller={controller} /> : null}
        </Stage>
      </div>
      {demo ? <DemoLabels controller={controller} /> : <LabelLayer controller={controller} />}
    </>
  );
}
