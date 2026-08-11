import { GeometryType, type RobotState, type UrdfLink, type UrdfVisual } from '@/types';
import { buildMeshLookupCandidates, resolveImportedAssetPath } from '@/core/parsers/meshPathUtils';
import { isIdentityMeshScale } from '@/core/parsers/urdf/meshScale';
import { getVisualGeometryEntries } from '@/core/robot';

const addPathHintCandidates = (target: Set<string>, meshPath?: string, urdfDir: string = '') => {
  const rawPath = String(meshPath || '').trim();
  if (!rawPath) return;

  const addCandidates = (value: string) => {
    buildMeshLookupCandidates(value).forEach((candidate) => {
      target.add(candidate.toLowerCase());
    });
  };

  addCandidates(rawPath);

  if (!urdfDir) return;

  const resolvedPath = resolveImportedAssetPath(rawPath, `${urdfDir}__mesh_scale_hint__`);
  if (resolvedPath) {
    addCandidates(resolvedPath);
  }
};

const collectMeshGeometries = (link: UrdfLink): UrdfVisual[] => {
  const geometries: UrdfVisual[] = [];
  const isMeshAssetGeometry = (geometry: UrdfVisual): boolean =>
    geometry.type === GeometryType.MESH || geometry.type === GeometryType.SDF;

  getVisualGeometryEntries(link).forEach((entry) => {
    if (isMeshAssetGeometry(entry.geometry)) {
      geometries.push(entry.geometry);
    }
  });

  if (link.collision && isMeshAssetGeometry(link.collision)) {
    geometries.push(link.collision);
  }

  (link.collisionBodies || []).forEach((body) => {
    if (isMeshAssetGeometry(body)) {
      geometries.push(body);
    }
  });

  return geometries;
};

export const collectExplicitlyScaledMeshPathsFromLinks = (
  links: Record<string, UrdfLink> | null | undefined,
): Set<string> => {
  const meshPaths = new Set<string>();

  if (!links) {
    return meshPaths;
  }

  Object.values(links).forEach((link) => {
    collectMeshGeometries(link).forEach((geometry) => {
      if (
        !geometry.meshPath ||
        (!geometry.mjcfMesh && isIdentityMeshScale(geometry.dimensions))
      ) {
        return;
      }

      meshPaths.add(geometry.meshPath);
    });
  });

  return meshPaths;
};

export const collectExplicitlyScaledMeshPaths = (robot: RobotState | null | undefined): Set<string> => {
  return collectExplicitlyScaledMeshPathsFromLinks(robot?.links);
};

export const buildExplicitlyScaledMeshPathHints = (
  meshPaths: Iterable<string>,
  urdfDir: string = '',
): Set<string> => {
  const hints = new Set<string>();

  for (const meshPath of meshPaths) {
    addPathHintCandidates(hints, meshPath, urdfDir);
  }

  return hints;
};

export const hasExplicitMeshScaleHint = (
  meshPath: string,
  explicitScaleHints?: ReadonlySet<string> | null,
  urdfDir: string = '',
): boolean => {
  if (!explicitScaleHints || explicitScaleHints.size === 0) {
    return false;
  }

  const candidates = new Set<string>();
  addPathHintCandidates(candidates, meshPath, urdfDir);

  for (const candidate of candidates) {
    if (explicitScaleHints.has(candidate)) {
      return true;
    }
  }

  return false;
};
