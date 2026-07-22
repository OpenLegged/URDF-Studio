import * as THREE from 'three';

import { createLoadingManager, createMeshLoader } from '@/core/loaders/meshLoader';
import { getSourceFileDirectory } from '@/core/parsers/meshPathUtils';
import { disposeObject3D } from '@/shared/utils/three/dispose';

import {
  computeApproximateCapsuleDecomposition,
  type ApproximateCapsuleDecomposition,
} from './approximateCapsuleFit';
import { computeBestPrimitiveFits, type Point3, type PrimitiveFitSet } from './primitiveFit';

const MAX_MESH_ANALYSIS_POINTS = 4096;
const DEFAULT_MESH_SURFACE_POINT_LIMIT = 1536;

export interface MeshAnalysisOptions {
  includePrimitiveFits?: boolean;
  includeSurfacePoints?: boolean;
  pointCollectionLimit?: number;
  surfacePointLimit?: number;
}

export interface MeshBounds {
  x: number;
  y: number;
  z: number;
  cx: number;
  cy: number;
  cz: number;
}

export interface MeshClearanceObstaclePoint {
  x: number;
  y: number;
  z: number;
}

export interface MeshClearanceObstacle {
  points: MeshClearanceObstaclePoint[];
}

export interface MeshAnalysis {
  bounds: MeshBounds;
  approximateCapsules?: ApproximateCapsuleDecomposition;
  representativeColor?: string;
  surfacePoints?: MeshClearanceObstaclePoint[];
  primitiveFits?: PrimitiveFitSet;
}

function extractMaterialColorHex(material: THREE.Material | undefined): string | undefined {
  if (!material) return undefined;
  const color = (material as THREE.Material & { color?: THREE.Color }).color;
  if (!(color instanceof THREE.Color)) return undefined;
  return `#${color.getHexString()}`;
}

function addColorWeight(
  colorWeights: Map<string, number>,
  color: string | undefined,
  weight: number,
): void {
  if (!color || !Number.isFinite(weight) || weight <= 0) return;
  colorWeights.set(color, (colorWeights.get(color) ?? 0) + weight);
}

function getRepresentativeMeshColor(object: THREE.Object3D): string | undefined {
  const colorWeights = new Map<string, number>();

  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;

    const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];

    if (materials.length === 0) return;

    const indexCount = geometry?.index?.count ?? 0;
    const vertexCount = geometry?.attributes?.position?.count ?? 0;
    const defaultWeight = Math.max(indexCount, vertexCount, 1);

    if (materials.length === 1) {
      addColorWeight(colorWeights, extractMaterialColorHex(materials[0]), defaultWeight);
      return;
    }

    const groupWeights = new Array<number>(materials.length).fill(0);
    if (geometry?.groups?.length) {
      geometry.groups.forEach((group) => {
        const materialIndex = group.materialIndex;
        if (
          materialIndex !== undefined &&
          materialIndex >= 0 &&
          materialIndex < groupWeights.length
        ) {
          groupWeights[materialIndex] += Math.max(group.count, 1);
        }
      });
    }

    const fallbackWeight = defaultWeight / materials.length;
    materials.forEach((material, index) => {
      addColorWeight(
        colorWeights,
        extractMaterialColorHex(material),
        groupWeights[index] > 0 ? groupWeights[index] : fallbackWeight,
      );
    });
  });

  let representativeColor: string | undefined;
  let bestWeight = -1;

  colorWeights.forEach((weight, color) => {
    if (weight > bestWeight) {
      bestWeight = weight;
      representativeColor = color;
    }
  });

  return representativeColor;
}

function normalizeMeshScale(meshScale?: { x: number; y: number; z: number }): {
  x: number;
  y: number;
  z: number;
} {
  const toNonZero = (value: number | undefined) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) < 1e-8) {
      return 1;
    }
    return value;
  };

  return {
    x: toNonZero(meshScale?.x),
    y: toNonZero(meshScale?.y),
    z: toNonZero(meshScale?.z),
  };
}

function collectMeshPoints(
  object: THREE.Object3D,
  maxPoints: number = MAX_MESH_ANALYSIS_POINTS,
): Point3[] {
  const meshEntries: Array<{
    mesh: THREE.Mesh;
    position: THREE.BufferAttribute;
    vertexCount: number;
  }> = [];
  let totalVertexCount = 0;

  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;

    const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
    const position = geometry?.attributes?.position as THREE.BufferAttribute | undefined;
    if (!position || position.count <= 0) return;

    meshEntries.push({
      mesh,
      position,
      vertexCount: position.count,
    });
    totalVertexCount += position.count;
  });

  if (meshEntries.length === 0 || totalVertexCount === 0) {
    return [];
  }

  const points: Point3[] = [];
  const vertex = new THREE.Vector3();
  const pushVertex = (mesh: THREE.Mesh, position: THREE.BufferAttribute, vertexIndex: number) => {
    vertex.fromBufferAttribute(position, vertexIndex).applyMatrix4(mesh.matrixWorld);
    points.push({ x: vertex.x, y: vertex.y, z: vertex.z });
  };

  if (totalVertexCount <= maxPoints) {
    meshEntries.forEach(({ mesh, position, vertexCount }) => {
      for (let index = 0; index < vertexCount; index += 1) {
        pushVertex(mesh, position, index);
      }
    });
    return points;
  }

  let remainingBudget = maxPoints;
  let remainingVertexCount = totalVertexCount;

  meshEntries.forEach(({ mesh, position, vertexCount }, meshIndex) => {
    if (remainingBudget <= 0 || remainingVertexCount <= 0) {
      remainingVertexCount -= vertexCount;
      return;
    }

    const isLastMesh = meshIndex === meshEntries.length - 1;
    const quota = isLastMesh
      ? Math.min(remainingBudget, vertexCount)
      : Math.max(
          1,
          Math.min(vertexCount, Math.round((vertexCount / remainingVertexCount) * remainingBudget)),
        );

    if (quota >= vertexCount) {
      for (let index = 0; index < vertexCount; index += 1) {
        pushVertex(mesh, position, index);
      }
    } else if (quota === 1) {
      pushVertex(mesh, position, Math.floor((vertexCount - 1) / 2));
    } else {
      for (let sampleIndex = 0; sampleIndex < quota; sampleIndex += 1) {
        const vertexIndex = Math.min(
          Math.round((sampleIndex * (vertexCount - 1)) / (quota - 1)),
          vertexCount - 1,
        );
        pushVertex(mesh, position, vertexIndex);
      }
    }

    remainingBudget -= quota;
    remainingVertexCount -= vertexCount;
  });

  return points;
}

function sampleMeshPoints(
  points: Point3[],
  maxPoints: number = DEFAULT_MESH_SURFACE_POINT_LIMIT,
): MeshClearanceObstaclePoint[] {
  if (points.length <= maxPoints) {
    return points.map((point) => ({ x: point.x, y: point.y, z: point.z }));
  }

  const step = Math.max(Math.floor(points.length / maxPoints), 1);
  const sampled: MeshClearanceObstaclePoint[] = [];

  for (let index = 0; index < points.length && sampled.length < maxPoints; index += step) {
    const point = points[index];
    sampled.push({ x: point.x, y: point.y, z: point.z });
  }

  const lastPoint = points[points.length - 1];
  if (
    lastPoint &&
    (sampled.length === 0 ||
      sampled[sampled.length - 1].x !== lastPoint.x ||
      sampled[sampled.length - 1].y !== lastPoint.y ||
      sampled[sampled.length - 1].z !== lastPoint.z)
  ) {
    sampled.push({ x: lastPoint.x, y: lastPoint.y, z: lastPoint.z });
  }

  return sampled;
}

export async function computeMeshAnalysisFromAssets(
  meshPath: string,
  assets: Record<string, string>,
  meshScale?: { x: number; y: number; z: number },
  options: MeshAnalysisOptions = {},
  sourceFilePath?: string,
): Promise<MeshAnalysis | null> {
  const sourceFileDirectory = getSourceFileDirectory(sourceFilePath);
  const manager = createLoadingManager(assets, sourceFileDirectory);
  const meshLoader = createMeshLoader(assets, manager, sourceFileDirectory);

  return await new Promise<MeshAnalysis | null>((resolve, reject) => {
    meshLoader(meshPath, manager, (obj: THREE.Object3D | null, error?: Error) => {
      if (error) {
        reject(error);
        return;
      }

      if (
        !obj ||
        (obj as THREE.Object3D & { userData: { isPlaceholder?: boolean } }).userData?.isPlaceholder
      ) {
        resolve(null);
        return;
      }

      const normalizedScale = normalizeMeshScale(meshScale);
      const includePrimitiveFits = options.includePrimitiveFits ?? true;
      const includeSurfacePoints = options.includeSurfacePoints ?? true;
      const pointCollectionLimit = Math.max(
        1,
        options.pointCollectionLimit ??
          (includePrimitiveFits ? MAX_MESH_ANALYSIS_POINTS : DEFAULT_MESH_SURFACE_POINT_LIMIT),
      );
      const surfacePointLimit = Math.max(
        1,
        options.surfacePointLimit ?? DEFAULT_MESH_SURFACE_POINT_LIMIT,
      );
      obj.scale.set(normalizedScale.x, normalizedScale.y, normalizedScale.z);
      obj.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(obj);
      const representativeColor = getRepresentativeMeshColor(obj);
      if (box.isEmpty()) {
        disposeObject3D(obj, true);
        resolve(null);
        return;
      }
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const needsPointCollection = includePrimitiveFits || includeSurfacePoints;
      const points = needsPointCollection ? collectMeshPoints(obj, pointCollectionLimit) : [];
      const surfacePoints = includeSurfacePoints
        ? sampleMeshPoints(points, surfacePointLimit)
        : undefined;
      const primitiveFits = includePrimitiveFits ? computeBestPrimitiveFits(points) : undefined;
      const approximateCapsules = includePrimitiveFits
        ? computeApproximateCapsuleDecomposition(points)
        : undefined;
      disposeObject3D(obj, true);
      resolve({
        bounds: {
          x: Math.abs(size.x),
          y: Math.abs(size.y),
          z: Math.abs(size.z),
          cx: center.x,
          cy: center.y,
          cz: center.z,
        },
        approximateCapsules,
        representativeColor,
        surfacePoints,
        primitiveFits,
      });
    });
  });
}

export async function computeMeshBoundsFromAssets(
  meshPath: string,
  assets: Record<string, string>,
  meshScale?: { x: number; y: number; z: number },
  sourceFilePath?: string,
): Promise<MeshBounds | null> {
  const analysis = await computeMeshAnalysisFromAssets(
    meshPath,
    assets,
    meshScale,
    {
      includePrimitiveFits: false,
      includeSurfacePoints: false,
    },
    sourceFilePath,
  );
  return analysis?.bounds ?? null;
}
