import type { RobotState } from '@/types';
import { clearParsedMJCFModelCache, parseMJCFModel } from './mjcfModel';
import { disposeMJCFMeshCache, type MJCFMeshCache } from './mjcfMeshAssetLoader';
import { resolveMJCFMeshBackedPrimitiveGeoms } from './mjcfMeshBackedPrimitiveResolver';
import { isMJCFLoadAbortedError, type MJCFLoadAbortSignal } from './mjcfLoadLifecycle';
import { convertParsedMJCFModelToRobotState } from './mjcfParser';

export interface ParseCanonicalPhysicalMJCFOptions {
  assets?: Record<string, string>;
  sourceFileDir?: string;
  abortSignal?: MJCFLoadAbortSignal;
}

/**
 * Resolve mesh-derived MuJoCo primitive parameters before creating canonical state.
 *
 * The synchronous `parseMJCF` API intentionally remains asset-free and deterministic.
 * Production imports use this async preparation boundary so fitted collision geometry
 * becomes canonical RobotState data instead of a viewer-only scene mutation.
 */
export async function parseCanonicalPhysicalMJCF(
  xmlContent: string,
  options: ParseCanonicalPhysicalMJCFOptions = {},
): Promise<RobotState | null> {
  const meshCache: MJCFMeshCache = new Map();

  try {
    const parsedModel = parseMJCFModel(xmlContent);
    if (!parsedModel) {
      return null;
    }

    try {
      await resolveMJCFMeshBackedPrimitiveGeoms(parsedModel, {
        assets: options.assets ?? {},
        sourceFileDir: options.sourceFileDir ?? '',
        abortSignal: options.abortSignal,
        meshCache,
        onUnresolvedPrimitive: (geom, reason, error) => {
          const geomName = geom.sourceName || geom.name || '<unnamed geom>';
          const detail = error instanceof Error ? ` ${error.message}` : '';
          parsedModel.recoveryDiagnostics.push({
            code: 'mjcf_mesh_primitive_fit_unresolved',
            severity: 'warning',
            category: 'physical',
            message: `Mesh-backed primitive "${geomName}" could not be fitted (${reason}) and remains a mesh.${detail}`,
            relatedIds: geom.name ? [geom.name] : undefined,
            source: {
              tag: 'geom',
              name: geomName,
              attribute: 'mesh',
            },
            action: 'downgraded',
          });
        },
      });
    } catch (error) {
      if (isMJCFLoadAbortedError(error)) {
        throw error;
      }

      const detail = error instanceof Error ? error.message : String(error || 'unknown error');
      parsedModel.recoveryDiagnostics.push({
        code: 'mjcf_mesh_primitive_fit_unresolved',
        severity: 'warning',
        category: 'physical',
        message: `A mesh-backed MJCF primitive could not be fitted and remains a mesh: ${detail}`,
        action: 'downgraded',
      });
    }

    return convertParsedMJCFModelToRobotState(parsedModel);
  } catch (error) {
    if (isMJCFLoadAbortedError(error)) {
      throw error;
    }
    console.warn('[MJCFParser] Failed to prepare canonical physical MJCF state:', error);
    return null;
  } finally {
    disposeMJCFMeshCache(meshCache);
    clearParsedMJCFModelCache(xmlContent);
  }
}
