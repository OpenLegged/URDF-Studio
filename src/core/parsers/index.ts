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
export {
  createUsdPlaceholderRobotData,
  describeRobotImportFailure,
  resolveRobotFileData,
  resolveRobotFileDataAsync,
} from './importRobotFile';
export type { RobotImportErrorReason, RobotImportResult } from './importRobotFile';
