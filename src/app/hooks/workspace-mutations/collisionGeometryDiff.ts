import { getCollisionGeometryEntries } from '@/core/robot';
import type { UrdfLink } from '@/types';

export interface CollisionGeometryPatch {
  objectIndex: number;
  geometry: UrdfLink['collision'];
}

function createCollisionGeometrySignature(
  geometry: UrdfLink['collision'],
  includeVisibility: boolean,
): string {
  return JSON.stringify({
    name: geometry.name ?? null,
    type: geometry.type,
    dimensions: geometry.dimensions,
    color: geometry.color,
    meshPath: geometry.meshPath ?? null,
    assetRef: geometry.assetRef ?? null,
    visible: includeVisibility ? (geometry.visible ?? null) : undefined,
    origin: geometry.origin,
    mjcfHfield: geometry.mjcfHfield
      ? {
          name: geometry.mjcfHfield.name ?? null,
          file: geometry.mjcfHfield.file ?? null,
          nrow: geometry.mjcfHfield.nrow ?? null,
          ncol: geometry.mjcfHfield.ncol ?? null,
        }
      : null,
  });
}

export function findRemovedCollisionGeometryObjectIndex(
  currentLink: UrdfLink,
  nextLink: UrdfLink,
): number | null {
  const currentEntries = getCollisionGeometryEntries(currentLink);
  const nextEntries = getCollisionGeometryEntries(nextLink);

  if (currentEntries.length !== nextEntries.length + 1) {
    return null;
  }

  const nextSignatures = nextEntries.map((entry) =>
    createCollisionGeometrySignature(entry.geometry, true),
  );

  for (let removeIndex = 0; removeIndex < currentEntries.length; removeIndex += 1) {
    const candidateSignatures = currentEntries
      .filter((_entry, index) => index !== removeIndex)
      .map((entry) => createCollisionGeometrySignature(entry.geometry, true));

    if (
      candidateSignatures.length === nextSignatures.length &&
      candidateSignatures.every((signature, index) => signature === nextSignatures[index])
    ) {
      return removeIndex;
    }
  }

  return null;
}

export function findAddedCollisionGeometryPatch(
  currentLink: UrdfLink,
  nextLink: UrdfLink,
): CollisionGeometryPatch | null {
  const currentEntries = getCollisionGeometryEntries(currentLink);
  const nextEntries = getCollisionGeometryEntries(nextLink);

  if (nextEntries.length !== currentEntries.length + 1) {
    return null;
  }

  const currentSignatures = currentEntries.map((entry) =>
    createCollisionGeometrySignature(entry.geometry, false),
  );

  for (let addIndex = 0; addIndex < nextEntries.length; addIndex += 1) {
    const candidateSignatures = nextEntries
      .filter((_entry, index) => index !== addIndex)
      .map((entry) => createCollisionGeometrySignature(entry.geometry, false));

    if (
      candidateSignatures.length === currentSignatures.length &&
      candidateSignatures.every((signature, index) => signature === currentSignatures[index])
    ) {
      return {
        objectIndex: nextEntries[addIndex].objectIndex,
        geometry: nextEntries[addIndex].geometry,
      };
    }
  }

  return null;
}

export function findUpdatedCollisionGeometryPatch(
  currentLink: UrdfLink,
  nextLink: UrdfLink,
): CollisionGeometryPatch | null {
  const currentEntries = getCollisionGeometryEntries(currentLink);
  const nextEntries = getCollisionGeometryEntries(nextLink);

  if (currentEntries.length !== nextEntries.length) {
    return null;
  }

  let changedEntry: CollisionGeometryPatch | null = null;

  for (let index = 0; index < currentEntries.length; index += 1) {
    const currentSignature = createCollisionGeometrySignature(
      currentEntries[index].geometry,
      false,
    );
    const nextSignature = createCollisionGeometrySignature(nextEntries[index].geometry, false);

    if (currentSignature === nextSignature) {
      continue;
    }

    if (changedEntry) {
      return null;
    }

    changedEntry = {
      objectIndex: currentEntries[index].objectIndex,
      geometry: nextEntries[index].geometry,
    };
  }

  return changedEntry;
}
