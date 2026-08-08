/**
 * Mesh path utilities for robust export.
 *
 * Handles common path formats from imported URDF/MJCF/Xacro files:
 * - package://<pkg>/meshes/part.stl
 * - ../meshes/part.stl
 * - /meshes/part.stl
 * - windows\\path\\part.stl
 */

import { type UrdfLink } from '@/types';
import { normalizeRelativePath } from '@/core/utils/pathNormalization';
import {
  stripPackagePrefix,
  stripBlobPrefix,
  stripFilePrefix,
  stripExternalPrefix,
  ImportedAssetPathResolutionOptions,
  RobotWithLinks,
  rewriteTexturePathForSource,
  rewriteGeometryAssetPathsForSource,
  normalizeMeshPathForExport,
  normalizeTexturePathForExport,
  normalizeTextureSourceKey,
  buildTextureCollisionFallbackPath,
  dedupeExportPath,
  RewriteUrdfAssetPathsForExportOptions,
  buildUrdfMeshExportFilename,
  buildUrdfTextureExportFilename,
  rewriteXmlTagFilenameAttribute,
  pushUnique,
} from './meshPathUtilsHelpers';
export type { ImportedAssetPathResolutionOptions } from './meshPathUtilsHelpers';
export {
  getSourceFileDirectory,
  resolveImportedAssetPath,
  normalizeMeshPathForExport,
  normalizeTexturePathForExport,
} from './meshPathUtilsHelpers';

/**
 * Directory of the source robot file, always with forward slashes and a trailing slash.
 */
/**
 * Resolve an imported asset path against the directory of its source robot file.
 * This turns relative paths like "meshes/leg.dae" into stable library paths like
 * "go1/meshes/leg.dae", which avoids collisions between different robot packages.
 */
/**
 * Rewrite imported mesh and texture asset paths in parsed robot data to stable
 * library-relative paths.
 */
export const rewriteRobotMeshPathsForSource = <T extends RobotWithLinks>(
  robot: T,
  sourceFilePath?: string | null,
  options: ImportedAssetPathResolutionOptions = {},
): T => {
  if (!sourceFilePath) return robot;

  const rewriteOptions = {
    ...options,
    candidateAssetPaths: options.candidateAssetPaths ? [...options.candidateAssetPaths] : undefined,
  };
  let linksChanged = false;
  let materialsChanged = false;
  const nextLinks: Record<string, UrdfLink> = {};

  Object.entries(robot.links).forEach(([linkId, link]) => {
    const nextVisual = rewriteGeometryAssetPathsForSource(
      link.visual,
      sourceFilePath,
      rewriteOptions,
    );
    let nextVisualBodies = link.visualBodies;
    const nextCollision = rewriteGeometryAssetPathsForSource(
      link.collision,
      sourceFilePath,
      rewriteOptions,
    );
    let nextCollisionBodies = link.collisionBodies;

    if (link.visualBodies?.length) {
      const rewrittenBodies = link.visualBodies.map((body) =>
        rewriteGeometryAssetPathsForSource(body, sourceFilePath, rewriteOptions),
      );

      const bodiesChanged = rewrittenBodies.some(
        (body, index) => body !== link.visualBodies?.[index],
      );
      if (bodiesChanged) {
        nextVisualBodies = rewrittenBodies;
      }
    }

    if (link.collisionBodies?.length) {
      const rewrittenBodies = link.collisionBodies.map((body) =>
        rewriteGeometryAssetPathsForSource(body, sourceFilePath, rewriteOptions),
      );

      const bodiesChanged = rewrittenBodies.some(
        (body, index) => body !== link.collisionBodies?.[index],
      );
      if (bodiesChanged) {
        nextCollisionBodies = rewrittenBodies;
      }
    }

    const linkChanged =
      nextVisual !== link.visual ||
      nextVisualBodies !== link.visualBodies ||
      nextCollision !== link.collision ||
      nextCollisionBodies !== link.collisionBodies;

    if (linkChanged) {
      linksChanged = true;
      nextLinks[linkId] = {
        ...link,
        visual: nextVisual,
        visualBodies: nextVisualBodies,
        collision: nextCollision,
        collisionBodies: nextCollisionBodies,
      };
      return;
    }

    nextLinks[linkId] = link;
  });

  const nextMaterials = robot.materials
    ? Object.fromEntries(
        Object.entries(robot.materials).map(([key, material]) => {
          const texturePath = material.texture?.trim();
          if (!texturePath) {
            return [key, material];
          }

          const resolvedTexturePath = rewriteTexturePathForSource(
            texturePath,
            sourceFilePath,
            rewriteOptions,
          );
          if (resolvedTexturePath !== texturePath) {
            materialsChanged = true;
            return [
              key,
              {
                ...material,
                texture: resolvedTexturePath,
              },
            ];
          }

          return [key, material];
        }),
      )
    : robot.materials;

  if (!linksChanged && !materialsChanged) return robot;

  return {
    ...robot,
    links: nextLinks,
    materials: nextMaterials,
  };
};

/**
 * Convert any mesh path into a stable export path relative to zip "meshes/" folder.
 */
/**
 * Convert any texture path into a stable export path relative to zip "textures/" folder.
 */
export function buildTextureExportPathOverrides(
  texturePaths: Iterable<string>,
): Map<string, string> {
  const entries = new Map<
    string,
    {
      basePath: string;
      fallbackPath: string;
      canonicalPath: string;
    }
  >();

  for (const sourcePath of texturePaths) {
    const canonicalPath = normalizeTextureSourceKey(sourcePath);
    if (!canonicalPath || entries.has(canonicalPath)) {
      continue;
    }

    entries.set(canonicalPath, {
      basePath: normalizeTexturePathForExport(sourcePath),
      fallbackPath: buildTextureCollisionFallbackPath(sourcePath),
      canonicalPath,
    });
  }

  const collisionsByBasePath = new Map<string, string[]>();
  entries.forEach(({ basePath }, canonicalPath) => {
    const key = basePath.toLowerCase();
    const paths = collisionsByBasePath.get(key) ?? [];
    paths.push(canonicalPath);
    collisionsByBasePath.set(key, paths);
  });

  const overrides = new Map<string, string>();
  const usedPaths = new Set<string>();

  const sortedEntries = Array.from(entries.entries()).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  for (const [canonicalPath, entry] of sortedEntries) {
    const collisionGroup = collisionsByBasePath.get(entry.basePath.toLowerCase()) ?? [];
    const hasCollision = collisionGroup.length > 1;
    const candidatePath = hasCollision
      ? entry.fallbackPath || entry.canonicalPath || entry.basePath
      : entry.basePath || entry.fallbackPath || entry.canonicalPath;
    const resolvedPath = dedupeExportPath(candidatePath, usedPaths);
    if (!resolvedPath) {
      continue;
    }

    usedPaths.add(resolvedPath.toLowerCase());
    overrides.set(canonicalPath, resolvedPath);
  }

  return overrides;
}

export function resolveTextureExportPath(
  texturePath: string,
  overrides?: ReadonlyMap<string, string> | null,
): string {
  const raw = (texturePath || '').trim();
  if (!raw) {
    return '';
  }

  const canonicalPath = normalizeTextureSourceKey(raw);
  return overrides?.get(canonicalPath) ?? normalizeTexturePathForExport(raw);
}

/**
 * Rewrite raw URDF mesh/texture asset filenames for zip export while preserving
 * the original document structure, including multi-material mesh visuals.
 */
export function rewriteUrdfAssetPathsForExport(
  urdfContent: string,
  options: RewriteUrdfAssetPathsForExportOptions,
): string {
  if (!urdfContent.trim()) {
    return urdfContent;
  }

  const withRewrittenMeshes = rewriteXmlTagFilenameAttribute(urdfContent, 'mesh', (meshPath) =>
    buildUrdfMeshExportFilename(meshPath, options),
  );

  return rewriteXmlTagFilenameAttribute(withRewrittenMeshes, 'texture', (texturePath) =>
    buildUrdfTextureExportFilename(texturePath, options),
  );
}

/**
 * Build candidate keys for mesh lookup in assets map.
 */
export const buildMeshLookupCandidates = (meshPath: string): string[] => {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const raw = (meshPath || '').trim();
  const slashNormalized = raw.replace(/\\/g, '/');
  const strippedPackage = stripPackagePrefix(slashNormalized);
  const strippedBlob = stripBlobPrefix(slashNormalized);
  const strippedFile = stripFilePrefix(slashNormalized);
  const strippedBoth = stripExternalPrefix(strippedBlob);
  const relative = normalizeRelativePath(strippedBoth.replace(/^\/+/, '').replace(/^(\.\/)+/, ''));
  const exportRelative = normalizeMeshPathForExport(meshPath);
  const filename = (exportRelative || relative || slashNormalized).split('/').pop() || '';
  const extension = filename.includes('.') ? filename.split('.').pop()?.toLowerCase() || '' : '';
  const directoryVariants = ['assets', 'dae', 'obj', 'stl', 'msh', 'gltf', 'glb', 'ply'];

  pushUnique(candidates, seen, raw);
  pushUnique(candidates, seen, slashNormalized);
  pushUnique(candidates, seen, strippedPackage);
  pushUnique(candidates, seen, strippedBlob);
  pushUnique(candidates, seen, strippedFile);
  pushUnique(candidates, seen, strippedBoth);
  pushUnique(candidates, seen, relative);
  pushUnique(candidates, seen, exportRelative);

  pushUnique(candidates, seen, filename);

  if (exportRelative) {
    pushUnique(candidates, seen, `meshes/${exportRelative}`);
    pushUnique(candidates, seen, `/meshes/${exportRelative}`);
  }

  if (filename) {
    pushUnique(candidates, seen, `meshes/${filename}`);
    pushUnique(candidates, seen, `/meshes/${filename}`);
    directoryVariants.forEach((directory) => {
      pushUnique(candidates, seen, `${directory}/${filename}`);
      pushUnique(candidates, seen, `/${directory}/${filename}`);
    });
  }

  if (extension && exportRelative) {
    const siblingExtensions = ['dae', 'obj', 'stl', 'msh', 'gltf', 'glb', 'ply'];
    siblingExtensions.forEach((nextExtension) => {
      if (nextExtension === extension) return;
      const siblingExportRelative = exportRelative.replace(/\.[^.\/]+$/, `.${nextExtension}`);
      const siblingFilename = filename.replace(/\.[^.\/]+$/, `.${nextExtension}`);
      pushUnique(candidates, seen, siblingExportRelative);
      pushUnique(candidates, seen, siblingFilename);
      directoryVariants.forEach((directory) => {
        pushUnique(candidates, seen, `${directory}/${siblingFilename}`);
        pushUnique(candidates, seen, `/${directory}/${siblingFilename}`);
      });
    });
  }

  return candidates;
};

/**
 * Resolve mesh blob URL from assets map using robust matching.
 */
export const resolveMeshAssetUrl = (
  meshPath: string,
  assets: Record<string, string>,
): string | null => {
  const candidates = buildMeshLookupCandidates(meshPath);
  if (candidates.length === 0) return null;

  // 1) Fast exact match
  for (const candidate of candidates) {
    const exact = assets[candidate];
    if (exact) return exact;
  }

  const lowerCandidates = candidates.map((c) => c.toLowerCase());

  // 2) Case-insensitive exact match
  for (const [key, value] of Object.entries(assets)) {
    if (lowerCandidates.includes(key.toLowerCase())) {
      return value;
    }
  }

  // 3) Suffix-based fuzzy match (handles nested paths and aliases)
  for (const [key, value] of Object.entries(assets)) {
    const keyLower = key.toLowerCase();
    for (const candidate of lowerCandidates) {
      if (keyLower.endsWith(candidate) || candidate.endsWith(keyLower)) {
        return value;
      }
    }
  }

  return null;
};
