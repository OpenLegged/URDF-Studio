import * as THREE from 'three';
import { isProtectedMaterial } from '@/core/utils/three/materialProtection';

const PLANE_TOLERANCE = 1e-6;
const DEPTH_OFFSET = 2;
const LOG_DEPTH_OFFSET = 2e-6;
const BASE_DEPTH_SETTINGS = '__coplanarGroundBaseDepth';

interface GroundSurface {
  mesh: THREE.Mesh;
  corners: THREE.Vector3[];
  origin: THREE.Vector3;
  axisX: THREE.Vector3;
  axisY: THREE.Vector3;
  width: number;
  height: number;
  elevation: number;
}

interface MaterialDepthOffset {
  original: THREE.Material | THREE.Material[];
  sourceVersion: string;
  replacement: THREE.Material | THREE.Material[];
  clones: THREE.Material[];
  cloneVersions: number[];
}

interface GroundDepthState {
  enabled: boolean;
  signature: string;
  offsets: Map<THREE.Mesh, MaterialDepthOffset>;
}

const states = new WeakMap<THREE.Object3D, GroundDepthState>();
const disposedClones = new WeakSet<THREE.Material>();
const ownedClones = new WeakSet<THREE.Material>();

function restoreInheritedDepthSettings(material: THREE.Material): void {
  if (ownedClones.has(material)) return;
  const value: unknown = material.userData[BASE_DEPTH_SETTINGS];
  if (!value || typeof value !== 'object') return;
  const settings = value as Record<string, unknown>;
  if (typeof settings.enabled !== 'boolean' || typeof settings.factor !== 'number' ||
    typeof settings.units !== 'number' || !Number.isFinite(settings.factor) ||
    !Number.isFinite(settings.units)) return;

  // Material.clone copies userData and polygonOffset, but not shader hooks.
  // A paint replacement cloned from the displayed material must start with the
  // authored depth settings before becoming the next restorable baseline.
  material.polygonOffset = settings.enabled;
  material.polygonOffsetFactor = settings.factor;
  material.polygonOffsetUnits = settings.units;
  delete material.userData[BASE_DEPTH_SETTINGS];
}

function readGroundSurface(mesh: THREE.Mesh): GroundSurface | null {
  const geometry = mesh.geometry;
  if (!(geometry instanceof THREE.BoxGeometry) && !(geometry instanceof THREE.PlaneGeometry)) {
    return null;
  }
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  if (!bounds || bounds.isEmpty()) return null;

  const corners = [
    new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.max.z),
    new THREE.Vector3(bounds.max.x, bounds.min.y, bounds.max.z),
    new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.max.z),
    new THREE.Vector3(bounds.min.x, bounds.max.y, bounds.max.z),
  ].map((point) => point.applyMatrix4(mesh.matrixWorld));
  const origin = corners[0]!;
  const axisX = corners[1]!.clone().sub(origin);
  const axisY = corners[3]!.clone().sub(origin);
  const width = axisX.length();
  const height = axisY.length();
  if (width <= PLANE_TOLERANCE || height <= PLANE_TOLERANCE) return null;
  axisX.divideScalar(width);
  axisY.divideScalar(height);
  // Restrict the policy to genuinely horizontal, rectangular primitive faces.
  // A bounding box alone would also classify tilted walls and mesh internals.
  if (
    Math.abs(axisX.z) > PLANE_TOLERANCE ||
    Math.abs(axisY.z) > PLANE_TOLERANCE ||
    Math.abs(axisX.dot(axisY)) > PLANE_TOLERANCE
  ) return null;

  return { mesh, corners, origin, axisX, axisY, width, height, elevation: origin.z };
}

function containsCoplanarSurface(outer: GroundSurface, inner: GroundSurface): boolean {
  if (
    outer.mesh === inner.mesh ||
    Math.abs(outer.elevation - inner.elevation) > PLANE_TOLERANCE ||
    outer.width * outer.height <= inner.width * inner.height + PLANE_TOLERANCE
  ) return false;

  return inner.corners.every((corner) => {
    const delta = corner.clone().sub(outer.origin);
    const x = delta.dot(outer.axisX);
    const y = delta.dot(outer.axisY);
    return x >= -PLANE_TOLERANCE && x <= outer.width + PLANE_TOLERANCE &&
      y >= -PLANE_TOLERANCE && y <= outer.height + PLANE_TOLERANCE;
  });
}

function materialIsAttached(robot: THREE.Object3D, material: THREE.Material): boolean {
  let attached = false;
  robot.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object.material === material || (Array.isArray(object.material) && object.material.includes(material))) {
      attached = true;
    }
  });
  return attached;
}

function cloneWithGroundDepthOffset(robot: THREE.Object3D, material: THREE.Material): THREE.Material {
  restoreInheritedDepthSettings(material);
  const clone = material.clone();
  ownedClones.add(clone);
  delete clone.userData.isSharedMaterial;
  delete clone.userData.isCollisionMaterial;
  clone.userData[BASE_DEPTH_SETTINGS] = {
    enabled: material.polygonOffset,
    factor: material.polygonOffsetFactor,
    units: material.polygonOffsetUnits,
  };
  const originalHook = material.onBeforeCompile;
  const originalKey = material.customProgramCacheKey();
  clone.onBeforeCompile = (shader, renderer) => {
    originalHook.call(clone, shader, renderer);
    // polygonOffset is ignored when the log-depth shader writes gl_FragDepth.
    // Keep the bias in depth space so it is stable at every camera distance.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <logdepthbuf_fragment>',
      `#include <logdepthbuf_fragment>
#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
  gl_FragDepth = min(1.0, gl_FragDepth + ${LOG_DEPTH_OFFSET});
#endif`,
    );
  };
  clone.customProgramCacheKey = () => `${originalKey}|coplanar-ground-depth-v1`;
  clone.polygonOffset = true;
  clone.polygonOffsetFactor = Math.max(material.polygonOffsetFactor, DEPTH_OFFSET);
  clone.polygonOffsetUnits = Math.max(material.polygonOffsetUnits, DEPTH_OFFSET);
  clone.addEventListener('dispose', () => {
    disposedClones.add(clone);
    // The ordinary scene/patch cleanup owns these clones. Release an original
    // that was displaced from the graph, while preserving a material shared by
    // another mesh. Textures remain owned by the normal asset lifecycle.
    if (!isProtectedMaterial(material) && !materialIsAttached(robot, material)) material.dispose();
  });
  return clone;
}

function installMaterialDepthOffset(robot: THREE.Object3D, mesh: THREE.Mesh): MaterialDepthOffset {
  const original = mesh.material;
  const materials = Array.isArray(original) ? original : [original];
  const clones = materials.map((material) => cloneWithGroundDepthOffset(robot, material));
  const replacement = Array.isArray(original) ? clones : clones[0]!;
  mesh.material = replacement;
  mesh.userData.coplanarGroundDepthOffset = true;
  return {
    original, sourceVersion: materialVersionSignature(original), replacement, clones,
    cloneVersions: clones.map((material) => material.version),
  };
}

function removeMaterialDepthOffset(mesh: THREE.Mesh, offset: MaterialDepthOffset): void {
  if (mesh.material === offset.replacement) {
    // Texture override loading also resolves the live render material. Preserve
    // such a late update when returning to the original, but never overwrite a
    // newer original that the loader updated directly.
    if (offset.sourceVersion === materialVersionSignature(offset.original)) {
      const originals = Array.isArray(offset.original) ? offset.original : [offset.original];
      offset.clones.forEach((clone, index) => {
        const original = originals[index]!;
        if (clone.version === offset.cloneVersions[index] || disposedClones.has(clone)) return;
        const shared = original.userData.isSharedMaterial;
        original.copy(clone);
        restoreInheritedDepthSettings(original);
        if (shared) original.userData.isSharedMaterial = shared;
        original.needsUpdate = true;
      });
    }
    mesh.material = offset.original;
  }
  // Restoring first keeps live originals from being released by clone cleanup.
  offset.clones.forEach((material) => {
    if (!disposedClones.has(material)) material.dispose();
  });
  delete mesh.userData.coplanarGroundDepthOffset;
}

function materialVersionSignature(value: THREE.Material | THREE.Material[]): string {
  return (Array.isArray(value) ? value : [value]).map((material) =>
    `${material.uuid}:${material.version}`,
  ).join(',');
}

function surfaceSignature(surfaces: GroundSurface[], offsets: GroundDepthState['offsets']): string {
  return surfaces.map(({ mesh }) => {
    const original = offsets.get(mesh)?.original;
    return `${mesh.uuid}:${mesh.geometry.uuid}:${mesh.matrixWorld.elements.join(',')}:` +
      materialVersionSignature(mesh.material) + (original ? `:${materialVersionSignature(original)}` : '');
  }).join('|');
}

/**
 * Resolve a visible large ground/smaller floor depth tie without changing the
 * source model, vertex positions, shadow geometry, or collision geometry.
 * Called on scene/geometry/pose/visibility changes, never from the render loop.
 */
export function syncCoplanarGroundDepth(robot: THREE.Object3D, enabled?: boolean): boolean {
  let state = states.get(robot);
  if (!state) {
    if (!enabled) return false;
    state = { enabled, signature: '', offsets: new Map() };
    states.set(robot, state);
  }
  if (enabled !== undefined) state.enabled = enabled;

  const surfaces: GroundSurface[] = [];
  if (state.enabled) {
    robot.updateWorldMatrix(true, true);
    robot.traverseVisible((object) => {
      if (!(object instanceof THREE.Mesh) || object.userData.isCollisionMesh ||
        object.userData.isCollision ||
        !(object.userData.isVisualMesh || object.userData.isVisual)) return;
      const surface = readGroundSurface(object);
      if (surface) surfaces.push(surface);
    });
  }
  const signature = surfaceSignature(surfaces, state.offsets);
  if (signature === state.signature) return false;

  const backgrounds = new Set(surfaces.filter((outer) =>
    surfaces.some((inner) => containsCoplanarSurface(outer, inner)),
  ).map(({ mesh }) => mesh));
  let changed = false;
  for (const [mesh, offset] of state.offsets) {
    if (backgrounds.has(mesh) && mesh.material === offset.replacement &&
      offset.sourceVersion === materialVersionSignature(offset.original)) continue;
    removeMaterialDepthOffset(mesh, offset);
    state.offsets.delete(mesh);
    changed = true;
  }
  for (const mesh of backgrounds) {
    if (state.offsets.has(mesh)) continue;
    state.offsets.set(mesh, installMaterialDepthOffset(robot, mesh));
    changed = true;
  }
  state.signature = surfaceSignature(surfaces, state.offsets);
  return changed;
}
