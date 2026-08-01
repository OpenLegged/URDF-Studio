import { normalizeLibraryPathKey, normalizeVirtualUsdPath } from '@/core/utils/pathKeys';
import { inferUsdDependencyStemForPath } from './usdDependencyPathRules.js';

function normalizeUsdAssetPath(path: string): string {
  return normalizeLibraryPathKey(path);
}

function toVirtualUsdPath(path: string): string {
  return normalizeVirtualUsdPath(path);
}

function getUsdDependencyExtension(stagePath: string): '.usd' | '.usda' | '.usdc' {
  const normalizedPath = toVirtualUsdPath(stagePath).toLowerCase();
  if (normalizedPath.endsWith('.usda')) {
    return '.usda';
  }
  if (normalizedPath.endsWith('.usdc')) {
    return '.usdc';
  }
  return '.usd';
}

function getVirtualUsdDirectory(path: string): string {
  const normalizedPath = toVirtualUsdPath(path);
  const lastSlashIndex = normalizedPath.lastIndexOf('/');
  if (lastSlashIndex < 0) return '/';
  return normalizedPath.slice(0, lastSlashIndex + 1);
}

function inferUsdDependencyStem(stagePath: string): string | null {
  const normalizedPath = toVirtualUsdPath(stagePath).toLowerCase();
  const fileName = normalizedPath.split('/').pop() || '';
  if (!fileName) return null;

  return inferUsdDependencyStemForPath(normalizedPath, fileName) || null;
}

export function buildCriticalUsdDependencyPaths(stagePath: string): string[] {
  const normalizedStagePath = toVirtualUsdPath(stagePath);
  const dependencyStem = inferUsdDependencyStem(normalizedStagePath);
  if (!dependencyStem) return [];
  const dependencyExtension = getUsdDependencyExtension(normalizedStagePath);
  const rootFileStem = normalizedStagePath.split('/').pop()?.replace(/\.usd[a-z]?$/i, '') || '';

  const rootDirectory = getVirtualUsdDirectory(normalizedStagePath);
  const configurationDirectory = rootDirectory.toLowerCase().endsWith('/configuration/')
    ? rootDirectory
    : `${rootDirectory}configuration/`;

  const suffixes = dependencyStem === 'h1_2_handless'
    ? ['base', 'physics', 'robot']
    : rootFileStem === dependencyStem && dependencyStem.endsWith('_description')
      ? ['base', 'physics', 'sensor', 'robot']
      : ['base', 'physics', 'sensor'];

  return suffixes.map((suffix) => `${configurationDirectory}${dependencyStem}_${suffix}${dependencyExtension}`);
}
