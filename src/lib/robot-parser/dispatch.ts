import { detectRobotDefinitionFormat } from '@/core/parsers/format_detection';
import type { RobotDefinitionFormat } from '@/core/parsers/format_detection';
import { getSourceFileDirectory } from '@/core/parsers/meshPathUtils';
import { parseURDF } from '@/core/parsers/urdf/parser';
import { parseMJCF } from '@/core/parsers/mjcf/mjcfParser';
import { parseSDF } from '@/core/parsers/sdf/sdfParser';
import { processXacro } from '@/core/parsers/xacro/xacroParser';
import type { RobotState } from '@/types/robot';
import { toRobotData } from './toRobotData';
import type { ParseRobotDefinitionOptions, ParseResult } from './types';

/**
 * Parse a robot definition file (URDF/MJCF/SDF/Xacro) into a unified
 * {@link RobotData} DTO. Format is auto-detected from content + filename, so
 * the same entry works for any supported format.
 *
 * USD returns `needs_usd_runtime` because parsing it requires the lazy-loaded
 * ~20MB WASM runtime; consumers opt in via the lazy USD entry to keep the
 * main bundle WASM-free.
 *
 * This dispatch intentionally does NOT reuse `resolveRobotFileData` from
 * `importRobotFile.ts`: that function performs app-specific orchestration
 * (mesh path rewriting, material sync, MJCF external asset validation,
 * progress reporting) that external consumers do not need.
 */
export function parseRobotDefinition(
  content: string,
  filename: string,
  options?: ParseRobotDefinitionOptions,
): ParseResult {
  const format = detectRobotDefinitionFormat(content, filename);
  if (!format) {
    return {
      status: 'error',
      format: null,
      message: `Unsupported robot definition format: ${filename}`,
    };
  }
  if (format === 'usd') {
    return { status: 'needs_usd_runtime', format: 'usd' };
  }

  const robot = parseByFormat(format, content, options);
  if (!robot) {
    return { status: 'error', format, message: `${format.toUpperCase()} parse returned no robot` };
  }
  return { status: 'ready', format, robotData: toRobotData(robot) };
}

/**
 * Parse a robot definition into canonical physical data.
 *
 * MJCF may need to load mesh assets before mesh-backed capsules/cylinders can
 * be represented truthfully. Final runtime/export consumers must use this
 * async entry; the synchronous parser is reserved for text-only structure
 * inspection where no asset-dependent physical result is consumed.
 */
export async function parseRobotDefinitionAsync(
  content: string,
  filename: string,
  options?: ParseRobotDefinitionOptions,
): Promise<ParseResult> {
  const format = detectRobotDefinitionFormat(content, filename);
  if (format !== 'mjcf') {
    return parseRobotDefinition(content, filename, options);
  }

  const { parseCanonicalPhysicalMJCF } =
    await import('@/core/parsers/mjcf/mjcfCanonicalPhysicalImport');
  const robot = await parseCanonicalPhysicalMJCF(content, {
    assets: options?.assets,
    sourceFileDir: getSourceFileDirectory(options?.sourcePath ?? filename),
    abortSignal: options?.signal,
  });
  if (!robot) {
    return { status: 'error', format, message: 'MJCF parse returned no robot' };
  }
  return { status: 'ready', format, robotData: toRobotData(robot) };
}

function parseByFormat(
  format: RobotDefinitionFormat,
  content: string,
  options?: ParseRobotDefinitionOptions,
): RobotState | null {
  switch (format) {
    case 'urdf':
      return parseURDF(content);
    case 'mjcf':
      return parseMJCF(content);
    case 'sdf':
      return parseSDF(content, {
        allFileContents: options?.allFileContents,
        availableFiles: options?.availableFiles,
        sourcePath: options?.sourcePath,
        sdfVersion: options?.sdfVersion,
      });
    case 'xacro': {
      const urdfContent = processXacro(
        content,
        options?.xacroArgs ?? {},
        options?.xacroFileMap ?? {},
        options?.xacroBasePath ?? '',
      );
      return parseURDF(urdfContent);
    }
    default:
      return null;
  }
}
