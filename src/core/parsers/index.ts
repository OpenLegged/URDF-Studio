/**
 * Parsers Module
 * Unified exports for all robot format parsers
 */

// URDF Parser
export { parseURDF } from './urdf/parser';
export {
  ensureXacroNamespace,
  generateURDF,
  generateAssemblyURDF,
  injectGazeboTags,
} from './urdf/urdfGenerator';
export type { RosGazeboProfile, RosHardwareInterface } from './urdf/urdfGenerator';

// MJCF Parser (MuJoCo format)
export { parseMJCF, isMJCF } from './mjcf/mjcfParser';
export { loadMJCFToThreeJS, isMJCFContent } from './mjcf/mjcfLoader';
export { generateMujocoXML } from './mjcf/mjcfGenerator';
export { generateSkeletonXML } from './mjcf/skeletonGenerator';

// USD Parser (Universal Scene Description)
export { isUSDA, isUSDCBinary, isUsdLikeFormat } from './usd/usdFormatUtils';

// Xacro Parser (ROS Xacro format)
export { isXacro, processXacro, parseXacro, getXacroArgs } from './xacro/xacroParser';
export type { XacroArgs, XacroFileMap } from './xacro/xacroParser';

// SDF Parser (Gazebo SDFormat)
export { isSDF, parseSDF } from './sdf/sdfParser';
export { generateSDF, generateSdfModelConfig } from './sdf/sdfGenerator';

// File Preview - Convert various robot file formats to URDF for preview
export { computePreviewUrdf } from './filePreview';
export { createUsdPlaceholderRobotData } from './importRobotFileLightweight';
export type { RobotImportErrorReason, RobotImportResult } from './importRobotFile';

// Keep the async production import boundary lazy. Re-exporting the implementation
// directly evaluates every format parser when this broad parser barrel is loaded.
export async function resolveRobotFileDataAsync(
  ...args: Parameters<typeof import('./importRobotFile').resolveRobotFileDataAsync>
): ReturnType<typeof import('./importRobotFile').resolveRobotFileDataAsync> {
  const { resolveRobotFileDataAsync: resolve } = await import('./importRobotFile');
  return resolve(...args);
}
