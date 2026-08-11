import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { findAssetByPath } from '@/core/loaders';
import { createMatteMaterial } from '@/core/utils/materialFactory';
import type { MJCFMesh } from './mjcfUtils';
import { loadMJCFMeshObject, type MJCFMeshCache } from './mjcfMeshAssetLoader';
import {
  disposeTransientObject3D,
  type MJCFLoadAbortSignal,
  throwIfMJCFLoadAborted,
} from './mjcfLoadLifecycle';

export type { MJCFMeshCache } from './mjcfMeshAssetLoader';

export interface MJCFGeometryDef {
  name?: string;
  type: string;
  size?: number[];
  mesh?: string;
  hfield?: string;
  fromto?: number[];
}

/**
 * Creates default matte material for MJCF geometry.
 * Uses unified material factory for consistent appearance with URDF.
 */
function createDefaultMaterial(): THREE.MeshStandardMaterial {
  return createMatteMaterial({
    color: 0x888888,
    name: 'mjcf_default',
  });
}

function mjcfQuatToThreeQuat(quat: [number, number, number, number]): THREE.Quaternion {
  return new THREE.Quaternion(quat[1], quat[2], quat[3], quat[0]);
}

function createMuJoCoFromToQuaternion(direction: THREE.Vector3): THREE.Quaternion {
  const normalizedDirection = direction.clone().normalize();
  const localNegativeZ = new THREE.Vector3(0, 0, -1);
  const dot = localNegativeZ.dot(normalizedDirection);

  // MuJoCo uses a deterministic 180deg rotation around +X when fromto points
  // exactly opposite the canonical local -Z axis.
  if (dot <= -1 + 1e-9) {
    return new THREE.Quaternion(1, 0, 0, 0);
  }

  return new THREE.Quaternion().setFromUnitVectors(localNegativeZ, normalizedDirection);
}

function normalizeScale(scale?: number[]): [number, number, number] | null {
  if (!scale || scale.length === 0) {
    return null;
  }

  return [scale[0] ?? 1, scale[1] ?? scale[0] ?? 1, scale[2] ?? scale[0] ?? 1];
}

function collectInlineMeshPoints(vertices?: number[]): THREE.Vector3[] {
  const uniquePoints = new Map<string, THREE.Vector3>();

  for (let index = 0; index + 2 < (vertices?.length ?? 0); index += 3) {
    const x = vertices?.[index] ?? 0;
    const y = vertices?.[index + 1] ?? 0;
    const z = vertices?.[index + 2] ?? 0;
    const key = `${x},${y},${z}`;
    if (!uniquePoints.has(key)) {
      uniquePoints.set(key, new THREE.Vector3(x, y, z));
    }
  }

  return Array.from(uniquePoints.values());
}

export function createInlineMJCFMeshObject(meshDef: MJCFMesh): THREE.Object3D | null {
  const points = collectInlineMeshPoints(meshDef.vertices);
  if (points.length < 3) {
    return null;
  }

  let geometry: THREE.BufferGeometry;
  if (points.length === 3) {
    geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        points.flatMap((point) => [point.x, point.y, point.z]),
        3,
      ),
    );
    geometry.setIndex([0, 1, 2]);
    geometry.computeVertexNormals();
  } else {
    geometry = new ConvexGeometry(points);
  }

  return new THREE.Mesh(geometry, createDefaultMaterial());
}

export function applyMeshAssetTransform(
  meshObject: THREE.Object3D,
  meshDef: MJCFMesh,
): THREE.Object3D {
  const normalizedScale = normalizeScale(meshDef.scale);
  if (!meshDef.refpos && !meshDef.refquat) {
    if (normalizedScale) {
      meshObject.scale.multiply(
        new THREE.Vector3(normalizedScale[0], normalizedScale[1], normalizedScale[2]),
      );
    }
    return meshObject;
  }

  const referenceTransform = new THREE.Group();
  referenceTransform.add(meshObject);

  if (meshDef.refquat) {
    referenceTransform.quaternion.copy(mjcfQuatToThreeQuat(meshDef.refquat).conjugate());
  }

  if (meshDef.refpos) {
    referenceTransform.position.set(-meshDef.refpos[0], -meshDef.refpos[1], -meshDef.refpos[2]);
    if (meshDef.refquat) {
      referenceTransform.position.applyQuaternion(referenceTransform.quaternion);
    }
  }

  if (!normalizedScale) {
    return referenceTransform;
  }

  // MuJoCo first moves vertices out of the authored reference frame and only
  // then applies the mesh asset scale. Keeping scale on an outer wrapper is
  // essential for non-uniform scale combined with refpos/refquat.
  const scaleTransform = new THREE.Group();
  scaleTransform.scale.set(normalizedScale[0], normalizedScale[1], normalizedScale[2]);
  scaleTransform.add(referenceTransform);
  return scaleTransform;
}

function normalizeLookupPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function pickDeterministicAssetMatch(matches: Array<{ key: string; url: string }>): string | null {
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0].url;
  matches.sort((a, b) => a.key.length - b.key.length || a.key.localeCompare(b.key));
  return matches[0].url;
}

function createMJCFGeometryError(message: string, detail: string, cause?: unknown): Error {
  return new Error(
    `[MJCFLoader] ${message}: ${detail}`,
    cause === undefined ? undefined : { cause },
  );
}

export function resolveMJCFAssetUrl(
  filePath: string,
  assets: Record<string, string>,
  sourceFileDir: string,
): string | null {
  const direct = findAssetByPath(filePath, assets, sourceFileDir);
  if (direct) return direct;

  const normalizedFilePath = normalizeLookupPath(filePath);
  const normalizedSourceDir = normalizeLookupPath(sourceFileDir);
  const sourcePrefix = normalizedSourceDir ? `${normalizedSourceDir}/` : '';
  const assetEntries = Object.entries(assets).map(([key, url]) => ({
    key: normalizeLookupPath(key),
    url,
  }));

  if (sourcePrefix) {
    const fullSuffix = normalizeLookupPath(`${sourcePrefix}${normalizedFilePath}`);
    const fullSuffixMatches = assetEntries.filter(
      ({ key }) => key === fullSuffix || key.endsWith(`/${fullSuffix}`),
    );
    const fullSuffixResolved = pickDeterministicAssetMatch(fullSuffixMatches);
    if (fullSuffixResolved) return fullSuffixResolved;
  }

  if (normalizedFilePath) {
    const relativeMatches = assetEntries.filter(
      ({ key }) => key === normalizedFilePath || key.endsWith(`/${normalizedFilePath}`),
    );

    if (relativeMatches.length === 1) {
      return relativeMatches[0].url;
    }

    if (relativeMatches.length > 1 && sourcePrefix) {
      const scopedRelativeMatches = relativeMatches.filter(
        ({ key }) => key.includes(`/${sourcePrefix}`) || key.startsWith(sourcePrefix),
      );
      const scopedRelativeResolved = pickDeterministicAssetMatch(scopedRelativeMatches);
      if (scopedRelativeResolved) return scopedRelativeResolved;
    }
  }

  const filename = normalizedFilePath.split('/').pop() || '';
  if (filename) {
    const filenameMatches = assetEntries.filter(
      ({ key }) => key === filename || key.endsWith(`/${filename}`),
    );

    if (filenameMatches.length === 1) {
      return filenameMatches[0].url;
    }

    if (filenameMatches.length > 1 && sourcePrefix) {
      const scopedFilenameMatches = filenameMatches.filter(
        ({ key }) => key.includes(`/${sourcePrefix}`) || key.startsWith(sourcePrefix),
      );
      const scopedFilenameResolved = pickDeterministicAssetMatch(scopedFilenameMatches);
      if (scopedFilenameResolved) return scopedFilenameResolved;
    }

    if (filenameMatches.length > 1) {
      console.error(
        `[MJCFLoader] Ambiguous mesh filename "${filename}" (${filenameMatches.length} matches), refusing unscoped fallback.`,
      );
      return null;
    }
  }

  return null;
}

/**
 * Create geometry from fromto specification (common in MuJoCo).
 * fromto defines two endpoints, and we create a cylinder/capsule between them.
 */
function createFromToGeometry(geom: MJCFGeometryDef, type: 'cylinder' | 'capsule'): THREE.Object3D {
  const fromto = geom.fromto!;
  const from = new THREE.Vector3(fromto[0], fromto[1], fromto[2]);
  const to = new THREE.Vector3(fromto[3], fromto[4], fromto[5]);

  const direction = new THREE.Vector3().subVectors(to, from);
  const length = direction.length();
  const center = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
  const radius = geom.size?.[0] || 0.05;

  const group = new THREE.Group();
  const shapeGroup = new THREE.Group();

  if (type === 'cylinder') {
    const geometry = new THREE.CylinderGeometry(radius, radius, length, 32);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, createDefaultMaterial());
    shapeGroup.add(mesh);
  } else {
    // Capsule: cylinder + 2 hemispheres
    const cylGeom = new THREE.CylinderGeometry(radius, radius, length, 32);
    const cylMesh = new THREE.Mesh(cylGeom, createDefaultMaterial());
    shapeGroup.add(cylMesh);

    const topSphere = new THREE.SphereGeometry(radius, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const topMesh = new THREE.Mesh(topSphere, createDefaultMaterial());
    topMesh.position.y = length / 2;
    shapeGroup.add(topMesh);

    const bottomSphere = new THREE.SphereGeometry(
      radius,
      32,
      16,
      0,
      Math.PI * 2,
      Math.PI / 2,
      Math.PI / 2,
    );
    const bottomMesh = new THREE.Mesh(bottomSphere, createDefaultMaterial());
    bottomMesh.position.y = -length / 2;
    shapeGroup.add(bottomMesh);

    // MuJoCo canonicalizes fromto capsules so the primitive points along local -Z.
    shapeGroup.rotation.x = -Math.PI / 2;
  }

  group.add(shapeGroup);

  // Position at center
  group.position.copy(center);

  // MuJoCo canonicalizes fromto cylinder/capsule primitives so local -Z points
  // from the first endpoint to the second.
  if (length > 0.0001) {
    const quaternion = createMuJoCoFromToQuaternion(direction);
    group.quaternion.copy(quaternion);
  }

  return group;
}

export async function createGeometryMesh(
  geom: MJCFGeometryDef,
  meshMap: Map<string, MJCFMesh>,
  assets: Record<string, string>,
  meshCache: MJCFMeshCache,
  sourceFileDir = '',
  abortSignal?: MJCFLoadAbortSignal,
): Promise<THREE.Object3D | null> {
  const type = geom.type?.trim() || (geom.mesh ? 'mesh' : '');

  switch (type) {
    case 'plane': {
      // MuJoCo plane: size[0]/size[1] are half-extents. When 0 or absent,
      // MuJoCo treats the extent as infinite — use a reasonable default.
      const INFINITE_HALF_EXTENT = 10;
      const halfX = geom.size?.[0] || INFINITE_HALF_EXTENT;
      const halfY = geom.size?.[1] || halfX;
      const geometry = new THREE.PlaneGeometry(halfX * 2, halfY * 2, 1, 1);
      // Lift the floor slightly above the reference grid (z=0) so the grid's
      // transparent fade pass never wins the LEQUAL depth test over the floor.
      geometry.translate(0, 0, 0.002);
      const material = createDefaultMaterial();
      material.side = THREE.DoubleSide;
      const mesh = new THREE.Mesh(geometry, material);
      // Ensure the material stays double-sided even when replaced later.
      mesh.userData.mjcfPreferDoubleSide = true;
      // Ground planes are scene helpers — exclude from hover / picking.
      mesh.userData.isHelper = true;
      return mesh;
    }

    case 'box': {
      if (!geom.size || geom.size.length < 1) return null;
      // MJCF size is half-size
      const sx = (geom.size[0] || 0.05) * 2;
      const sy = ((geom.size[1] ?? geom.size[0]) || 0.05) * 2;
      const sz = ((geom.size[2] ?? geom.size[0]) || 0.05) * 2;
      const geometry = new THREE.BoxGeometry(sx, sy, sz);
      return new THREE.Mesh(geometry, createDefaultMaterial());
    }

    case 'sphere': {
      const radius = geom.size?.[0] || 0.05;
      const geometry = new THREE.SphereGeometry(radius, 32, 32);
      return new THREE.Mesh(geometry, createDefaultMaterial());
    }

    case 'cylinder': {
      // Handle fromto if specified
      if (geom.fromto && geom.fromto.length === 6) {
        return createFromToGeometry(geom, 'cylinder');
      }
      const radius = geom.size?.[0] || 0.05;
      const halfHeight = geom.size?.[1] || 0.1;
      const geometry = new THREE.CylinderGeometry(radius, radius, halfHeight * 2, 32);
      geometry.rotateX(Math.PI / 2); // MJCF cylinder is along Z by default
      return new THREE.Mesh(geometry, createDefaultMaterial());
    }

    case 'capsule': {
      // Handle fromto if specified
      if (geom.fromto && geom.fromto.length === 6) {
        return createFromToGeometry(geom, 'capsule');
      }
      const radius = geom.size?.[0] || 0.05;
      const halfHeight = geom.size?.[1] || 0.1;
      // Create capsule using cylinder + 2 hemispheres
      const group = new THREE.Group();

      // Cylinder body
      const cylGeom = new THREE.CylinderGeometry(radius, radius, halfHeight * 2, 32);
      const cylMesh = new THREE.Mesh(cylGeom, createDefaultMaterial());
      group.add(cylMesh);

      // Top hemisphere
      const topSphere = new THREE.SphereGeometry(radius, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
      const topMesh = new THREE.Mesh(topSphere, createDefaultMaterial());
      topMesh.position.y = halfHeight;
      group.add(topMesh);

      // Bottom hemisphere
      const bottomSphere = new THREE.SphereGeometry(
        radius,
        32,
        16,
        0,
        Math.PI * 2,
        Math.PI / 2,
        Math.PI / 2,
      );
      const bottomMesh = new THREE.Mesh(bottomSphere, createDefaultMaterial());
      bottomMesh.position.y = -halfHeight;
      group.add(bottomMesh);

      // MJCF capsule is along Z by default, rotate to align
      group.rotation.x = Math.PI / 2;
      return group;
    }

    case 'ellipsoid': {
      const sx = geom.size?.[0] || 0.05;
      const sy = geom.size?.[1] || sx;
      const sz = geom.size?.[2] || sx;
      const geometry = new THREE.SphereGeometry(1, 32, 32);
      const mesh = new THREE.Mesh(geometry, createDefaultMaterial());
      mesh.scale.set(sx, sy, sz);
      return mesh;
    }

    case 'hfield': {
      console.warn(
        `[MJCFLoader] Height field geom "${geom.name || geom.hfield || 'unnamed'}" is not rendered yet.`,
      );
      return null;
    }

    case 'mesh':
    case 'sdf': {
      if (!geom.mesh) return null;

      const meshDef = meshMap.get(geom.mesh);
      if (!meshDef) {
        throw createMJCFGeometryError('Mesh not defined in assets', geom.mesh);
      }

      if (meshDef.vertices?.length) {
        const inlineMesh = createInlineMJCFMeshObject(meshDef);
        if (!inlineMesh) {
          throw createMJCFGeometryError('Inline mesh could not be constructed', geom.mesh);
        }

        return applyMeshAssetTransform(inlineMesh, meshDef);
      }

      if (!meshDef.file) {
        throw createMJCFGeometryError('Mesh file metadata is missing', geom.mesh);
      }

      const assetUrl = resolveMJCFAssetUrl(meshDef.file, assets, sourceFileDir);
      if (!assetUrl) {
        throw createMJCFGeometryError('Mesh file could not be resolved', meshDef.file);
      }

      const loadedMesh = await loadMJCFMeshObject(assetUrl, meshDef.file, meshCache, abortSignal);
      if (!loadedMesh) {
        return null;
      }

      if (abortSignal?.aborted) {
        disposeTransientObject3D(loadedMesh);
        throwIfMJCFLoadAborted(abortSignal);
      }

      return applyMeshAssetTransform(loadedMesh, meshDef);
    }

    default:
      throw createMJCFGeometryError('Unsupported geom type', type);
  }
}
