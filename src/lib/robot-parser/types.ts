import type { RobotData } from '@/types/robot';
import type { RobotDefinitionFormat } from '@/core/parsers/format_detection';
import type { SdfIncludeAvailableFile } from '@/core/parsers/sdf/sdfIncludeResolution';

/**
 * Options for the unified robot definition parser. Each format only reads the
 * fields relevant to it; unspecified fields fall back to empty defaults.
 */
export interface ParseRobotDefinitionOptions {
  /** MJCF: source-relative mesh paths mapped to fetchable blob/data/http URLs. */
  assets?: Record<string, string>;
  /** Abort asset-dependent MJCF physical preparation. */
  signal?: AbortSignal;
  /** SDF: contents of sibling files referenced via `<include>`. */
  allFileContents?: Record<string, string>;
  /** SDF: discovered files in the import set (used for include resolution). */
  availableFiles?: readonly SdfIncludeAvailableFile[];
  /** SDF: source path of the root file, used to resolve relative includes. */
  sourcePath?: string;
  /** SDF: spec version (e.g. "1.5", "1.6"). Affects axis-frame defaults. */
  sdfVersion?: string;
  /** Xacro: macro argument overrides (`xacro:arg` substitutions). */
  xacroArgs?: Record<string, string>;
  /** Xacro: map of file path → file content for macro/inclusion resolution. */
  xacroFileMap?: Record<string, string>;
  /** Xacro: base path used to resolve relative `package://` style references. */
  xacroBasePath?: string;
}

/**
 * Outcome of {@link parseRobotDefinition}. USD is routed to the explicit lazy
 * runtime entry because parsing it requires the ~20MB WASM bindings.
 */
export type ParseResult =
  | {
      status: 'ready';
      format: Exclude<RobotDefinitionFormat, 'usd'>;
      robotData: RobotData;
    }
  | { status: 'needs_usd_runtime'; format: 'usd' }
  | { status: 'error'; format: RobotDefinitionFormat | null; message: string };
