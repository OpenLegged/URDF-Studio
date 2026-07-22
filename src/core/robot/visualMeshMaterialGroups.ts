import type { UrdfVisual, UrdfVisualMaterial, UrdfVisualMeshMaterialGroup } from '@/types';
import { normalizeAuthoredMaterialEntry } from './visualMaterials';

function normalizeMaterialValue(value?: string | null): string | undefined {
  const trimmed = String(value || '').trim();
  return trimmed ? trimmed : undefined;
}

function normalizeMeshKey(candidate: unknown): string | null {
  if (typeof candidate !== 'string') {
    return null;
  }

  const trimmed = candidate.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeMeshMaterialGroup(
  group: UrdfVisualMeshMaterialGroup | null | undefined,
): UrdfVisualMeshMaterialGroup | null {
  const meshKey = normalizeMeshKey(group?.meshKey);
  const start = Number(group?.start);
  const count = Number(group?.count);
  const materialIndex = Number(group?.materialIndex);

  if (!meshKey) {
    return null;
  }

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(count) ||
    !Number.isInteger(materialIndex) ||
    start < 0 ||
    count <= 0 ||
    materialIndex < 0 ||
    start % 3 !== 0 ||
    count % 3 !== 0
  ) {
    return null;
  }

  return {
    meshKey,
    start,
    count,
    materialIndex,
  };
}

function normalizeColor(value?: string | null): string | null {
  const normalized = normalizeMaterialValue(value)?.toLowerCase() ?? null;
  return normalized && /^#[0-9a-f]{6,8}$/.test(normalized) ? normalized : normalized;
}

export function getGeometryMeshMaterialGroups(
  geometry: Pick<UrdfVisual, 'meshMaterialGroups'> | null | undefined,
): UrdfVisualMeshMaterialGroup[] {
  if (!Array.isArray(geometry?.meshMaterialGroups)) {
    return [];
  }

  return geometry.meshMaterialGroups
    .map((group) => normalizeMeshMaterialGroup(group))
    .filter((group): group is UrdfVisualMeshMaterialGroup => Boolean(group))
    .sort((left, right) => {
      if (left.meshKey !== right.meshKey) {
        return left.meshKey.localeCompare(right.meshKey);
      }
      if (left.start !== right.start) {
        return left.start - right.start;
      }
      return left.materialIndex - right.materialIndex;
    });
}

export function hasGeometryMeshMaterialGroups(
  geometry: Pick<UrdfVisual, 'meshMaterialGroups'> | null | undefined,
): boolean {
  return getGeometryMeshMaterialGroups(geometry).length > 0;
}

export function getGeometryMeshMaterialGroupsForMesh(
  geometry: Pick<UrdfVisual, 'meshMaterialGroups'> | null | undefined,
  meshKey: string,
): UrdfVisualMeshMaterialGroup[] {
  const normalizedMeshKey = normalizeMeshKey(meshKey);
  if (!normalizedMeshKey) {
    return [];
  }

  return getGeometryMeshMaterialGroups(geometry).filter(
    (group) => group.meshKey === normalizedMeshKey,
  );
}

export function normalizeGeometryAuthoredMaterials(
  geometry: Pick<UrdfVisual, 'authoredMaterials'> | null | undefined,
): UrdfVisualMaterial[] {
  if (!Array.isArray(geometry?.authoredMaterials)) {
    return [];
  }

  return geometry.authoredMaterials
    .map((material) => normalizeAuthoredMaterialEntry(material))
    .filter((material): material is UrdfVisualMaterial => Boolean(material));
}

export function buildMeshMaterialGroupsFromAssignments(
  meshKey: string,
  assignments: readonly number[],
): UrdfVisualMeshMaterialGroup[] {
  const normalizedMeshKey = normalizeMeshKey(meshKey);
  if (!normalizedMeshKey || assignments.length === 0) {
    return [];
  }

  const groups: UrdfVisualMeshMaterialGroup[] = [];
  let runStartFace = 0;
  let runMaterialIndex = Number(assignments[0] ?? 0);

  const pushRun = (startFace: number, endFaceExclusive: number, materialIndex: number) => {
    const faceCount = endFaceExclusive - startFace;
    if (faceCount <= 0) {
      return;
    }

    groups.push({
      meshKey: normalizedMeshKey,
      start: startFace * 3,
      count: faceCount * 3,
      materialIndex: Math.max(0, Math.trunc(materialIndex)),
    });
  };

  for (let faceIndex = 1; faceIndex < assignments.length; faceIndex += 1) {
    const materialIndex = Number(assignments[faceIndex] ?? 0);
    if (materialIndex === runMaterialIndex) {
      continue;
    }

    pushRun(runStartFace, faceIndex, runMaterialIndex);
    runStartFace = faceIndex;
    runMaterialIndex = materialIndex;
  }

  pushRun(runStartFace, assignments.length, runMaterialIndex);
  return groups;
}

function expandMeshAssignments(
  triangleCount: number,
  groups: readonly UrdfVisualMeshMaterialGroup[],
): number[] {
  const assignments = Array.from({ length: triangleCount }, () => 0);

  for (const group of groups) {
    const startFace = Math.trunc(group.start / 3);
    const faceCount = Math.trunc(group.count / 3);
    const endFace = Math.min(triangleCount, startFace + faceCount);

    for (let faceIndex = startFace; faceIndex < endFace; faceIndex += 1) {
      assignments[faceIndex] = group.materialIndex;
    }
  }

  return assignments;
}

function compactMeshMaterialPalette(
  authoredMaterials: readonly UrdfVisualMaterial[],
  groups: readonly UrdfVisualMeshMaterialGroup[],
): {
  authoredMaterials: UrdfVisualMaterial[];
  groups: UrdfVisualMeshMaterialGroup[];
} {
  const usedMaterialIndexes = new Set<number>();
  groups.forEach((group) => {
    if (group.materialIndex > 0) {
      usedMaterialIndexes.add(group.materialIndex);
    }
  });

  const nextAuthoredMaterials: UrdfVisualMaterial[] = [];
  const indexMapping = new Map<number, number>();
  const baseMaterial = normalizeAuthoredMaterialEntry(authoredMaterials[0]);
  if (baseMaterial) {
    nextAuthoredMaterials.push(baseMaterial);
  } else if (groups.length > 0) {
    nextAuthoredMaterials.push({});
  }
  indexMapping.set(0, 0);

  Array.from(usedMaterialIndexes)
    .sort((left, right) => left - right)
    .forEach((materialIndex) => {
      const material = normalizeAuthoredMaterialEntry(authoredMaterials[materialIndex]);
      if (!material) {
        return;
      }

      indexMapping.set(materialIndex, nextAuthoredMaterials.length);
      nextAuthoredMaterials.push(material);
    });

  const nextGroups = groups
    .map((group) => {
      const nextMaterialIndex = indexMapping.get(group.materialIndex);
      if (nextMaterialIndex === undefined) {
        return null;
      }

      return {
        ...group,
        materialIndex: nextMaterialIndex,
      };
    })
    .filter((group): group is UrdfVisualMeshMaterialGroup => Boolean(group));

  return {
    authoredMaterials: nextAuthoredMaterials,
    groups: nextGroups,
  };
}

function findMatchingCustomMaterialIndex(
  authoredMaterials: readonly UrdfVisualMaterial[],
  paintColor: string,
): number | null {
  const normalizedPaintColor = normalizeColor(paintColor);
  if (!normalizedPaintColor) {
    return null;
  }

  for (let materialIndex = 1; materialIndex < authoredMaterials.length; materialIndex += 1) {
    const material = authoredMaterials[materialIndex];
    if (!material) {
      continue;
    }

    if (
      normalizeColor(material.color) === normalizedPaintColor &&
      !normalizeMaterialValue(material.texture)
    ) {
      return materialIndex;
    }
  }

  return null;
}

export interface ApplyMeshMaterialPaintEditOptions {
  geometry: Pick<UrdfVisual, 'authoredMaterials' | 'meshMaterialGroups' | 'color'>;
  meshKey: string;
  triangleCount: number;
  selectedFaceIndices: readonly number[];
  paintColor: string;
  erase?: boolean;
  baseMaterial?: UrdfVisualMaterial | null;
  materialNamePrefix?: string;
}

export interface MeshMaterialPaintEditResult
  extends Pick<UrdfVisual, 'authoredMaterials' | 'meshMaterialGroups'> {
  changed: boolean;
}

export function applyMeshMaterialPaintEdit({
  geometry,
  meshKey,
  triangleCount,
  selectedFaceIndices,
  paintColor,
  erase = false,
  baseMaterial,
  materialNamePrefix = 'paint_slot',
}: ApplyMeshMaterialPaintEditOptions): MeshMaterialPaintEditResult {
  const normalizedMeshKey = normalizeMeshKey(meshKey);
  if (!normalizedMeshKey || triangleCount <= 0) {
    return {
      authoredMaterials: normalizeGeometryAuthoredMaterials(geometry),
      meshMaterialGroups: getGeometryMeshMaterialGroups(geometry),
      changed: false,
    };
  }

  const existingGroups = getGeometryMeshMaterialGroups(geometry);
  const authoredMaterials = normalizeGeometryAuthoredMaterials(geometry);
  const normalizedBaseMaterial = normalizeAuthoredMaterialEntry(baseMaterial);
  const authoredBaseMaterial = normalizeAuthoredMaterialEntry(authoredMaterials[0]);
  const firstPaintBaseMaterial = normalizeAuthoredMaterialEntry({
    ...(authoredBaseMaterial ?? {}),
    ...(normalizedBaseMaterial ?? {}),
  });
  const baseMaterialEntry =
    (existingGroups.length > 0
      ? authoredBaseMaterial ?? normalizedBaseMaterial
      : firstPaintBaseMaterial ?? normalizedBaseMaterial ?? authoredBaseMaterial) ??
    normalizeAuthoredMaterialEntry({ color: geometry.color });
  const nextAuthoredMaterials = [
    baseMaterialEntry ?? {},
    ...authoredMaterials.slice(1),
  ] as UrdfVisualMaterial[];

  const nextGroupsByMesh = new Map<string, UrdfVisualMeshMaterialGroup[]>();
  existingGroups.forEach((group) => {
    const bucket = nextGroupsByMesh.get(group.meshKey) ?? [];
    bucket.push(group);
    nextGroupsByMesh.set(group.meshKey, bucket);
  });

  const currentAssignments = expandMeshAssignments(
    triangleCount,
    getGeometryMeshMaterialGroupsForMesh(geometry, normalizedMeshKey),
  );
  const previousAssignments = currentAssignments.slice();
  let targetMaterialIndex = 0;

  if (!erase) {
    const existingMaterialIndex = findMatchingCustomMaterialIndex(
      nextAuthoredMaterials,
      paintColor,
    );
    if (existingMaterialIndex !== null) {
      targetMaterialIndex = existingMaterialIndex;
    } else {
      targetMaterialIndex = nextAuthoredMaterials.length;
      nextAuthoredMaterials.push({
        name: `${materialNamePrefix}_${targetMaterialIndex}`,
        color: paintColor,
      });
    }
  }

  selectedFaceIndices.forEach((faceIndex) => {
    if (!Number.isInteger(faceIndex) || faceIndex < 0 || faceIndex >= triangleCount) {
      return;
    }

    currentAssignments[faceIndex] = targetMaterialIndex;
  });

  const hasCustomPaint = currentAssignments.some((materialIndex) => materialIndex > 0);
  if (hasCustomPaint) {
    nextGroupsByMesh.set(
      normalizedMeshKey,
      buildMeshMaterialGroupsFromAssignments(normalizedMeshKey, currentAssignments),
    );
  } else {
    nextGroupsByMesh.delete(normalizedMeshKey);
  }

  const flattenedGroups = Array.from(nextGroupsByMesh.values()).flat();
  const { authoredMaterials: compactedMaterials, groups: compactedGroups } =
    compactMeshMaterialPalette(nextAuthoredMaterials, flattenedGroups);

  return {
    authoredMaterials:
      compactedGroups.length > 0
        ? compactedMaterials
        : compactedMaterials[0] && normalizeAuthoredMaterialEntry(compactedMaterials[0])
          ? [compactedMaterials[0]]
          : undefined,
    meshMaterialGroups: compactedGroups.length > 0 ? compactedGroups : undefined,
    changed: currentAssignments.some(
      (materialIndex, faceIndex) => materialIndex !== previousAssignments[faceIndex],
    ),
  };
}
