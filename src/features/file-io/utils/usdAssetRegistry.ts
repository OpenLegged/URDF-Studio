import * as THREE from 'three';

import {
  buildMeshLookupCandidates,
  normalizeMeshPathForExport,
} from '@/core/parsers/meshPathUtils';
import { registerManagedTextureHandlers } from '@/core/loaders/textureLoaderHandlers';
import { getAssetFileExtension, isImageAssetPath } from '@/core/utils/assetFileTypes';

export type UsdAssetRegistry = {
  direct: Map<string, string>;
  lowercase: Map<string, string>;
  filenameLower: Map<string, string>;
  registeredUrls: Set<string>;
};

const isUsdTextureAssetPath = (path: string): boolean => {
  return isImageAssetPath(path) || getAssetFileExtension(path) === 'ktx2';
};

const registerUsdAssetAliases = (registry: UsdAssetRegistry, key: string, url: string) => {
  registry.registeredUrls.add(url);
  const candidates = buildMeshLookupCandidates(key);
  const compatibleCandidates = isUsdTextureAssetPath(key)
    ? candidates.filter((candidate) => isUsdTextureAssetPath(candidate))
    : candidates;

  for (const candidate of compatibleCandidates) {
    registry.direct.set(candidate, url);
    registry.lowercase.set(candidate.toLowerCase(), url);

    const filename = candidate.split('/').pop();
    if (filename) {
      registry.filenameLower.set(filename.toLowerCase(), url);
    }
  }
};

export const createUsdAssetRegistry = (
  assets: Record<string, string>,
  extraMeshFiles?: Map<string, Blob>,
): { registry: UsdAssetRegistry; tempObjectUrls: string[] } => {
  const registry: UsdAssetRegistry = {
    direct: new Map(),
    lowercase: new Map(),
    filenameLower: new Map(),
    registeredUrls: new Set(),
  };
  const tempObjectUrls: string[] = [];

  Object.entries(assets).forEach(([key, url]) => {
    registerUsdAssetAliases(registry, key, url);
  });

  extraMeshFiles?.forEach((blob, key) => {
    const objectUrl = URL.createObjectURL(blob);
    tempObjectUrls.push(objectUrl);
    registerUsdAssetAliases(registry, key, objectUrl);

    const exportPath = normalizeMeshPathForExport(key);
    if (exportPath) {
      registerUsdAssetAliases(registry, exportPath, objectUrl);
    }
  });

  return { registry, tempObjectUrls };
};

export const resolveUsdAssetUrl = (path: string, registry: UsdAssetRegistry): string | null => {
  if (!path) return null;
  if (/^(?:data:|https?:\/\/)/i.test(path)) {
    return path;
  }

  const isBlobUrl = /^blob:/i.test(path);
  if (isBlobUrl && registry.registeredUrls.has(path)) {
    return path;
  }

  const candidates = buildMeshLookupCandidates(path);
  const compatibleCandidates = isUsdTextureAssetPath(path)
    ? candidates.filter((candidate) => isUsdTextureAssetPath(candidate))
    : candidates;

  for (const candidate of compatibleCandidates) {
    const directMatch = registry.direct.get(candidate);
    if (directMatch) return directMatch;

    const lowerMatch = registry.lowercase.get(candidate.toLowerCase());
    if (lowerMatch) return lowerMatch;
  }

  const lowerPath = path.toLowerCase();
  for (const [candidate, url] of registry.lowercase.entries()) {
    if (candidate.endsWith(lowerPath)) {
      return url;
    }
  }

  const filename = lowerPath.split('/').pop();
  if (filename) {
    const filenameMatch = registry.filenameLower.get(filename);
    if (filenameMatch) return filenameMatch;
  }

  // GLTFLoader resolves sidecar buffers/textures against the mesh's object URL,
  // producing malformed blob:http://.../file.bin-style URLs. Give those a
  // chance to resolve through the registry above, while preserving unrelated
  // direct blob URLs when no managed asset matches.
  return isBlobUrl ? path : null;
};

export const createUsdTextureLoadingManager = (
  registry: UsdAssetRegistry,
): THREE.LoadingManager => {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => resolveUsdAssetUrl(url, registry) ?? url);
  registerManagedTextureHandlers(manager);
  return manager;
};
