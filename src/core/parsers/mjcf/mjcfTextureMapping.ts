import * as THREE from 'three';
import { GeometryType, type UrdfVisual } from '@/types';

// Primitive buffers are runtime-owned. Weak keys release the baseline with the buffer;
// repeated resize operations always derive from its original UVs, never the last size.
const originalUvs = new WeakMap<THREE.BufferGeometry, THREE.BufferAttribute>();

/** Matches MuJoCo classic settexture: texuniform scales 2D UVs by geom.size (half-size). */
export function applyMjcfUniformTextureMapping(
  mesh: THREE.Mesh,
  halfSize: readonly [number, number],
  enabled: boolean,
): void {
  const uv = mesh.geometry.getAttribute('uv');
  if (!uv || uv.itemSize !== 2) return;
  let original = originalUvs.get(mesh.geometry);
  if (!enabled && !original) return;
  if (!original) {
    original = new THREE.Float32BufferAttribute(
      Array.from({ length: uv.count }, (_, index) => [uv.getX(index), uv.getY(index)]).flat(),
      2,
    );
    originalUvs.set(mesh.geometry, original);
  }
  const scaleX = enabled && halfSize[0] > 0 ? halfSize[0] : 1;
  const scaleY = enabled && halfSize[1] > 0 ? halfSize[1] : 1;
  for (let index = 0; index < uv.count; index += 1) {
    uv.setXY(index, original.getX(index) * scaleX, original.getY(index) * scaleY);
  }
  uv.needsUpdate = true;
  if (!enabled) originalUvs.delete(mesh.geometry);
}

export function applyCanonicalMjcfTextureMapping(mesh: THREE.Mesh, visual: UrdfVisual): void {
  if (visual.type !== GeometryType.BOX && visual.type !== GeometryType.PLANE) return;
  const material = visual.authoredMaterials?.[0];
  applyMjcfUniformTextureMapping(
    mesh,
    [visual.dimensions.x / 2, visual.dimensions.y / 2],
    material?.mjcfTextureUniform === true && material.mjcfBuiltinTexture?.type !== 'cube',
  );
}
