/**
 * Renderer Backend Factory
 *
 * Creates the appropriate backend instance based on the robot file format.
 */

import type { RobotRendererBackend, RendererSceneProps, BackendFactory, BackendRegistry } from './types';
import { createThreeJsBackend } from './ThreeJsBackend';

const USD_HYDRATION_REQUIRED_MESSAGE = 'USD sources must be hydrated to RobotState before rendering';

function isUsdFormat(format: string | null | undefined): boolean {
  const normalizedFormat = format?.toLowerCase();
  return normalizedFormat === 'usd';
}

function rejectUsdRendererSource(): never {
  throw new Error(USD_HYDRATION_REQUIRED_MESSAGE);
}

function rejectUnsupportedRendererSourceFormat(format: string): never {
  throw new Error(`Unsupported renderer source format: ${format}`);
}

/**
 * Default backend registry
 */
const defaultBackendRegistry: BackendRegistry = {
  urdf: () => {
    throw new Error('ThreeJsBackend requires sourceFile and assets parameters');
  },
  mjcf: () => {
    throw new Error('ThreeJsBackend requires sourceFile and assets parameters');
  },
  sdf: () => {
    throw new Error('ThreeJsBackend requires sourceFile and assets parameters');
  },
  xacro: () => {
    throw new Error('ThreeJsBackend requires sourceFile and assets parameters');
  },
  mesh: () => {
    throw new Error('ThreeJsBackend requires sourceFile and assets parameters');
  },
  asset: () => {
    throw new Error('ThreeJsBackend requires sourceFile and assets parameters');
  },
};

/**
 * Create a renderer backend instance based on the source file format
 *
 * @param props - Scene properties including sourceFile and assets
 * @returns A RobotRendererBackend instance
 */
export function createRendererBackend(props: RendererSceneProps): RobotRendererBackend {
  const { sourceFile, assets, invalidate } = props;
  const format = sourceFile?.format || 'urdf';
  const normalizedFormat = format.toLowerCase();

  // Determine which backend to use
  if (isUsdFormat(normalizedFormat)) {
    return rejectUsdRendererSource();
  }

  if (!isFormatSupported(normalizedFormat)) {
    return rejectUnsupportedRendererSourceFormat(normalizedFormat);
  }

  // Default to ThreeJsBackend for all other formats
  return createThreeJsBackend(sourceFile, assets, invalidate);
}

/**
 * Create a renderer backend with explicit format specification
 *
 * @param format - The format to create a backend for
 * @param sourceFile - The source robot file
 * @param assets - Map of asset paths to URLs
 * @param invalidate - Optional callback to invalidate the renderer
 * @returns A RobotRendererBackend instance
 */
export function createRendererBackendForFormat(
  format: string,
  sourceFile: any,
  assets: Record<string, string>,
  invalidate?: () => void,
): RobotRendererBackend {
  const normalizedFormat = format.toLowerCase();
  if (isUsdFormat(normalizedFormat)) {
    return rejectUsdRendererSource();
  }

  if (!isFormatSupported(normalizedFormat)) {
    return rejectUnsupportedRendererSourceFormat(normalizedFormat);
  }

  return createThreeJsBackend(sourceFile, assets, invalidate);
}

/**
 * Register a custom backend factory for a format
 *
 * @param format - The format to register
 * @param factory - The factory function
 */
export function registerBackendFactory(format: string, factory: BackendFactory): void {
  defaultBackendRegistry[format.toLowerCase()] = factory;
}

/**
 * Get the backend registry (for testing or customization)
 */
export function getBackendRegistry(): BackendRegistry {
  return { ...defaultBackendRegistry };
}

/**
 * Check if a format is supported
 */
export function isFormatSupported(format: string): boolean {
  const normalizedFormat = format.toLowerCase();
  return normalizedFormat in defaultBackendRegistry;
}
