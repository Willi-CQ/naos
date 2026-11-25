import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { useNaos, useView } from '../store/store.ts';
import type { SceneController } from './controller.ts';
import { harborAt } from './harbor.ts';

function hullMaterial(color: string) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) } },
    vertexShader: 'varying float vLight; void main(){ vec3 p=(modelMatrix*vec4(position,1.)).xyz; vec3 n=normalize(mat3(modelMatrix)*normal); vLight=.3+1.25*max(0.,dot(n,normalize(-p))); gl_Position=projectionMatrix*viewMatrix*vec4(p,1.); }',
    fragmentShader: 'uniform vec3 uColor; varying float vLight; void main(){ gl_FragColor=vec4(uColor*vLight,1.); }',
    toneMapped: false,
    transparent: true, depthWrite: true, blending: THREE.NoBlending,
  });
}

/** A physical orbital landmark, shared by every chat working on this repo. */
export function Harbors({ controller }: { controller: SceneController }) {
  const worldId = useView((v) => v.sky || v.level === 'system' ? null : v.worldId);
  const dock = useMemo(() => {
    const root = new THREE.Group();
    root.name = 'orbital-harbor';
    const pieces: THREE.BufferGeometry[] = [];
    const box = (x: number, y: number, z: number, w: number, h: number, d: number) => pieces.push(new THREE.BoxGeometry(w, h, d).translate(x, y, z));
    pieces.push(new THREE.TorusGeometry(1.8, 0.17, 5, 36).rotateY(Math.PI / 2));
    box(-0.8, 0, 0, 7.2, 0.4, 0.4); box(-1.4, 0, 0, 0.28, 0.28, 7.5);
    box(2.1, 0, 0, 1.1, 1.1, 1.1);
    for (const side of [-1, 1]) for (let i = 0; i < 4; i++) box(-2.8 + i * 0.9, 0.04, side * 2.7, 0.07, 0.14, 2.6);
    const hull = mergeGeometries(pieces)!;
    for (const p of pieces) p.dispose();
    const wings = [-1, 1].map((z) => new THREE.BoxGeometry(3.5, 0.07, 2.5).translate(-1.4, 0, z * 2.7));
    const panels = mergeGeometries(wings)!;
    wings.forEach((g) => g.dispose());
    const rim = new THREE.TorusGeometry(1.82, 0.035, 4, 36).rotateY(Math.PI / 2);
    const materials = [hullMaterial('#aebbc2'), hullMaterial('#223e62'), new THREE.MeshBasicMaterial({ color: '#8cd9db', toneMapped: false, transparent: true, depthWrite: true, blending: THREE.NoBlending })];
    root.add(new THREE.Mesh(hull, materials[0]), new THREE.Mesh(panels, materials[1]), new THREE.Mesh(rim, materials[2]));
    for (const child of root.children) child.renderOrder = 9.8;
    const matrix = new THREE.Matrix4(), up = new THREE.Vector3();
    return { root, materials, geometries: [hull, panels, rim], matrix, up };
  }, []);
  useEffect(() => {
    controller.harbor = dock.root;
    return () => {
      controller.harbor = null;
      dock.geometries.forEach((g) => g.dispose()); dock.materials.forEach((m) => m.dispose());
    };
  }, [controller, dock]);
  useFrame(() => {
    const body = worldId ? controller.worldBody(worldId) : undefined;
    dock.root.visible = !!body;
    if (!body || !worldId) return;
    harborAt(worldId, body, dock.root.position, dock.up);
    dock.root.scale.setScalar(body.radius * 0.085);
    dock.root.quaternion.setFromRotationMatrix(dock.matrix.makeBasis(body.a, dock.up, body.b));
    const accent = useNaos.getState().fleet.worlds[worldId]?.identity?.accent ?? '#8cd9db';
    (dock.materials[2] as THREE.MeshBasicMaterial).color.set(accent).multiplyScalar(1.4);
  }, -2);
  return <primitive object={dock.root} />;
}
