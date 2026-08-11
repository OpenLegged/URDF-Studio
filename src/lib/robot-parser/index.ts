/**
 * @urdf-studio/robot-runtime/parser — pure robot definition parser.
 *
 * Unified entry + format-specific parsers + Motion Studio metadata adapters.
 * No React UI, mesh loading, or USD runtime: only text → RobotData DTO and
 * Canonical metadata extraction shared with Motion Studio.
 *
 * USD parsing is gated behind `needs_usd_runtime`; opt into the heavyweight
 * worker/WASM implementation through the explicit `./usd` package subpath.
 */

// Unified dispatch entry.
export { parseRobotDefinition, parseRobotDefinitionAsync } from './dispatch';
export { toRobotData } from './toRobotData';
export type { ParseRobotDefinitionOptions, ParseResult } from './types';

// Format-specific parsers (re-exported so consumers can call them directly).
export { parseURDF } from '@/core/parsers/urdf/parser';
export { parseMJCF, isMJCF } from '@/core/parsers/mjcf/mjcfParser';
export { parseSDF, isSDF } from '@/core/parsers/sdf/sdfParser';
export { processXacro, parseXacro, isXacro } from '@/core/parsers/xacro/xacroParser';
export type { XacroArgs, XacroFileMap } from '@/core/parsers/xacro/xacroParser';
export { detectRobotDefinitionFormat } from '@/core/parsers/format_detection';
export type { RobotDefinitionFormat } from '@/core/parsers/format_detection';
export { isUSDA, isUSDCBinary, isUsdLikeFormat } from '@/core/parsers/usd/usdFormatUtils';

// Motion Studio metadata adapters.
export { extractDofMetadata, extractCollisionProfile } from './motion-studio';
export type {
  CollisionGeometryType,
  RobotCollisionBody,
  RobotCollisionProfile,
  RobotDofMetadata,
  RobotJointLimit,
} from './motion-studio';

// Unified robot DTO (the parser output) so consumers do not need a separate
// types package.
export type { RobotData, RobotState, UrdfLink, UrdfJoint } from '@/types/robot';
export type { GeometryType, UrdfVisual } from '@/types/geometry';
