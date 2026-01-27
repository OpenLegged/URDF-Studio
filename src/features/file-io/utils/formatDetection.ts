/**
 * Format Detection Utilities
 * Detect robot file format from content and filename
 */

import { isMJCF } from '@/core/parsers/mjcf';
import { isUSDA } from '@/core/parsers/usd';
import { isXacro } from '@/core/parsers/xacro';
import type { FileFormat } from '../types';

/**
 * Detect file format from content and filename
 * @param content - File content as string
 * @param filename - Filename with extension
 * @returns Detected format or null if unknown
 */
export function detectFormat(content: string, filename: string): FileFormat | null {
  const lowerName = filename.toLowerCase();

  // Check by extension first (fastest)
  if (lowerName.endsWith('.xacro') || lowerName.endsWith('.urdf.xacro')) return 'xacro';
  if (lowerName.endsWith('.urdf')) return 'urdf';
  if (lowerName.endsWith('.usda') || lowerName.endsWith('.usdc') || lowerName.endsWith('.usd')) return 'usd';

  // For XML files, check content
  if (lowerName.endsWith('.xml')) {
    if (isMJCF(content)) return 'mjcf';
    // Check for xacro content
    if (isXacro(content)) return 'xacro';
    // Could also be URDF (though rare with .xml extension)
    if (content.includes('<robot')) return 'urdf';
  }

  // Try content-based detection
  if (isUSDA(content)) return 'usd';
  if (isMJCF(content)) return 'mjcf';
  if (isXacro(content)) return 'xacro';
  if (content.includes('<robot')) return 'urdf';

  return null;
}

/**
 * Check if file is a robot definition file by extension
 */
export function isRobotDefinitionFile(filename: string): boolean {
  const lowerName = filename.toLowerCase();
  return (
    lowerName.endsWith('.urdf') ||
    lowerName.endsWith('.xml') ||
    lowerName.endsWith('.mjcf') ||
    lowerName.endsWith('.usda') ||
    lowerName.endsWith('.usd') ||
    lowerName.endsWith('.xacro')
  );
}

/**
 * Check if file is an asset file (mesh or texture)
 */
export function isAssetFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase();
  return ['stl', 'obj', 'dae', 'png', 'jpg', 'jpeg', 'tga', 'bmp', 'tiff', 'tif', 'webp'].includes(ext || '');
}

/**
 * Check if path is a motor library file
 */
export function isMotorLibraryFile(path: string): boolean {
  const lowerPath = path.toLowerCase();
  return lowerPath.includes('motor library') && lowerPath.endsWith('.txt');
}

/**
 * Check if path should be skipped (hidden files/folders)
 */
export function shouldSkipPath(path: string): boolean {
  const pathParts = path.split('/');
  return pathParts.some(part => part.startsWith('.'));
}
