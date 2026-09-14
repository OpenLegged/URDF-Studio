import type { UrdfGeneratorOptions } from '@/core/parsers/urdf/urdfGenerator';

function objTextHasEmbeddedVertexColors(source: string): boolean {
  const lines = source.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('v ')) {
      continue;
    }

    const segments = trimmed.split(/\s+/);
    if (segments.length >= 7) {
      return true;
    }
  }

  return false;
}

async function resolveEmbeddedMeshMaterialPaths(
  extraMeshFiles?: Map<string, Blob>,
): Promise<string[]> {
  if (!extraMeshFiles || extraMeshFiles.size === 0) {
    return [];
  }

  const results = await Promise.all(
    Array.from(extraMeshFiles.entries()).map(async ([meshPath, meshBlob]) => {
      if (!/\.obj$/i.test(meshPath) || !(meshBlob instanceof Blob)) {
        return null;
      }

      const source = await meshBlob.text();
      return objTextHasEmbeddedVertexColors(source) ? meshPath : null;
    }),
  );

  return results.filter(Boolean) as string[];
}

export async function buildGeneratedUrdfOptions(
  extraMeshFiles?: Map<string, Blob>,
  options: {
    extended?: boolean;
    useRelativePaths?: boolean;
  } = {},
): Promise<UrdfGeneratorOptions> {
  const omitMeshMaterialPaths = await resolveEmbeddedMeshMaterialPaths(extraMeshFiles);

  return {
    preserveNumericPrecision: true,
    ...(options.extended ? { extended: true } : {}),
    ...(options.useRelativePaths ? { useRelativePaths: true } : {}),
    ...(omitMeshMaterialPaths.length > 0
      ? { omitMeshMaterialPaths }
      : {}),
  };
}

export const __private__ = {
  objTextHasEmbeddedVertexColors,
  resolveEmbeddedMeshMaterialPaths,
};
