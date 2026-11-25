// The planets in the Stage. A world gets its genome from what is known of its repo until a designer sends one, and its planet takes over
// from the stand-in disc once the first bake has landed. Moons and the rocks of the Belt stay with the stand-in layer.
import { genomeFromFacts, identityForRepo, planetForRepo, type PlanetGenome } from '@naos/protocol';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { DISK_OUTER } from '../../core/space.ts';
import type { Tier } from '../../core/tiers.ts';
import { setScene, useNaos } from '../../store/store.ts';
import { useStage } from '../context.ts';
import type { SceneController } from '../controller.ts';
import { diskLight } from '../hole/disk.ts';
import type { CityLight } from '../history.ts';
import type { PlanetFrame } from './body.ts';
import { PlanetFleet, WORLD_SIZE } from './fleet.ts';
import type { PlanetCity } from './tables.ts';

/** The disk's light against the lab's source, which the planets were tuned under. */
const LIGHT_GAIN = 1.2;
const buffer = new THREE.Vector2();

const citiesOf = (lights: readonly CityLight[]): PlanetCity[] => lights.map((l) => ({ x: l.dir[0], y: l.dir[1], z: l.dir[2], ember: l.fail }));

export function PlanetLayer({ controller, tier }: { controller: SceneController; tier: Tier }) {
  const { state } = useStage();
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const live = useMemo(() => ({
    root: new THREE.Group(),
    fleet: null as PlanetFleet | null,
    warm: false,
    genomes: new Map<string, PlanetGenome>(),
    designedAt: new Map<string, number>(),
    appearances: new Map<string, string>(),
    lights: new Map<string, readonly CityLight[]>(),
    focus: '',
    time: 0,
    at: -1,
    progress: '',
    frame: {
      camera: controller.camera,
      source: { position: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0), radius: DISK_OUTER, color: new THREE.Color() },
      time: 0,
      height: 1,
    } as PlanetFrame,
    still: typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null,
  }), [controller]);

  useEffect(() => {
    const fleet = new PlanetFleet(gl, { writeDepth: true });
    live.fleet = fleet;
    setScene({ planets: { ready: 0, total: controller.worldStates().filter((w) => !w.belt).length, baking: true } });
    live.root.add(fleet.group);
    let on = true;
    // Every program is compiled off the main thread first. Until then each world keeps its stand-in.
    void fleet.warm(controller.camera).catch(() => undefined).then(() => {
      if (!on) return;
      live.warm = true;
      invalidate();
    });
    const restored = () => { fleet.restored(); invalidate(); };
    gl.domElement.addEventListener('webglcontextrestored', restored);
    return () => {
      on = false;
      gl.domElement.removeEventListener('webglcontextrestored', restored);
      controller.handOver(new Set());
      live.root.remove(fleet.group);
      fleet.dispose();
      live.fleet = null;
      live.warm = false;
      live.genomes.clear();
      live.designedAt.clear();
      live.appearances.clear();
      live.lights.clear();
      live.focus = '';
    };
  }, [controller, gl, invalidate, live]);

  useEffect(() => { if (live.fleet) live.fleet.worldSize = tier.name === 'Penumbra' ? 512 : WORLD_SIZE; }, [live, tier]);

  useFrame(() => {
    const { fleet, frame } = live;
    if (!fleet || !live.warm) return;
    const dt = live.at < 0 ? 0 : Math.max(0, Math.min(0.25, state.now - live.at));
    live.at = state.now;
    if (!live.still?.matches) live.time += dt;

    const facts = useNaos.getState().fleet.worlds;
    const { level, worldId } = useNaos.getState().view;
    const worlds = controller.worldStates().filter((w) => !w.belt).sort((a, b) => a.slot - b.slot);
    const here = new Set<string>();
    const shown = new Set<string>();
    for (const w of worlds) {
      here.add(w.worldId);
      const lights = controller.lightsOf(w.worldId);
      const fact = facts[w.worldId];
      const designed = fact?.genome;
      const designedAt = fact?.designedAt;
      const identity = fact?.identity ?? identityForRepo(fact?.name ?? w.worldId);
      const appearance = JSON.stringify([identity, designedAt]);
      let body = fleet.get(w.worldId);
      if (!body) {
        // Lower slots first, so a new world is told what the others already look like and is drawn apart from them.
        const genome = planetForRepo(designed ?? genomeFromFacts({ name: w.worldId, sizeBytes: fact?.massBytes ?? 0 }, [...live.genomes.values()]), identity, !!designed);
        live.appearances.set(w.worldId, appearance);
        live.genomes.set(w.worldId, genome);
        if (designedAt !== undefined) live.designedAt.set(w.worldId, designedAt);
        body = fleet.add(w.worldId, genome, citiesOf(lights));
        live.lights.set(w.worldId, lights);
      } else if (live.appearances.get(w.worldId) !== appearance) {
        const genome = planetForRepo(designed ?? genomeFromFacts({ name: w.worldId, sizeBytes: fact?.massBytes ?? 0 }), identity, !!designed);
        fleet.replace(w.worldId, genome);
        live.genomes.set(w.worldId, genome);
        live.appearances.set(w.worldId, appearance);
        if (designedAt !== undefined) live.designedAt.set(w.worldId, designedAt);
        body = fleet.get(w.worldId) ?? body;
      } else if (live.lights.get(w.worldId) !== lights) {
        body.setCities(citiesOf(lights));
        live.lights.set(w.worldId, lights);
      }
      body.position.copy(w.position);
      body.group.visible = level === 'system' || worldId === w.worldId;
      body.radius = w.radius;
      body.activity = w.load;
      body.auroras = useNaos.getState().view.settings.auroras;
      if (body.ready) shown.add(w.worldId);
    }
    for (const id of live.genomes.keys()) {
      if (here.has(id)) continue;
      fleet.remove(id);
      live.genomes.delete(id);
      live.designedAt.delete(id);
      live.appearances.delete(id);
      live.lights.delete(id);
    }
    controller.handOver(shown);

    const focus = `${level}|${worldId}`;
    if (focus !== live.focus) {
      live.focus = focus;
      if (worldId !== null && level !== 'system') fleet.focus(worldId, level);
    }

    const [r, g, b] = diskLight(Math.max(0.82, state.sunLeft));
    frame.source.color.setRGB(r * LIGHT_GAIN, (g * 0.72 + r * 0.28) * LIGHT_GAIN, (b * 0.72 + r * 0.28) * LIGHT_GAIN);
    frame.time = live.time;
    frame.height = gl.getDrawingBufferSize(buffer).y;
    fleet.update(frame, dt);
    const progress = `${shown.size}/${here.size}/${fleet.busy}`;
    if (progress !== live.progress) {
      live.progress = progress;
      setScene({ planets: { ready: shown.size, total: here.size, baking: fleet.busy } });
    }
    // A bake only moves while frames come, and at rest they would stop.
    if (fleet.busy) invalidate();
  }, -4);

  return <primitive object={live.root} />;
}
