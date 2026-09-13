import { generateMujocoXML, generateSDF, generateURDF } from '@/core/parsers';
import { canGenerateUrdf } from '@/core/parsers/urdf/urdfExportSupport';
import { canPreserveJointTypesInSource } from '@/core/parsers/sourceJointSupport';
import { canPreserveGeometryInSource } from '@/core/parsers/sourceGeometrySupport';
import type { RobotData, RobotFile, RobotState } from '@/types';

export type GenerateEditableRobotSourceFormat = Extract<
  RobotFile['format'],
  'urdf' | 'mjcf' | 'sdf' | 'xacro'
>;

export interface GenerateEditableRobotSourceOptions {
  format: GenerateEditableRobotSourceFormat;
  robotState: RobotState;
  includeHardware?: 'never' | 'auto' | 'always';
  preserveMeshPaths?: boolean;
  sdfVersion?: string;
}

/** Internal source views must preserve joints that the URDF export format cannot represent. */
export function resolveEditableRobotSourceFormat(
  robot: Pick<RobotData, 'joints' | 'inspectionContext'>,
  preferredFormat?: GenerateEditableRobotSourceFormat,
): GenerateEditableRobotSourceFormat {
  const sourceFormat = preferredFormat ?? robot.inspectionContext?.sourceFormat;
  const format = sourceFormat === 'mjcf' || sourceFormat === 'sdf' || sourceFormat === 'xacro'
    ? sourceFormat
    : 'urdf';
  return (format === 'urdf' || format === 'xacro') && !canGenerateUrdf(robot)
    ? 'mjcf'
    : format;
}

export function generateEditableRobotSource({
  format,
  robotState,
  includeHardware = 'auto',
  preserveMeshPaths,
  sdfVersion,
}: GenerateEditableRobotSourceOptions): string {
  switch (format) {
    case 'mjcf':
      return generateMujocoXML(robotState, {
        meshdir: 'meshes/',
        includeSceneHelpers: false,
        preserveInertialData: true,
        preserveNumericPrecision: true,
      });
    case 'sdf':
      return generateSDF(robotState, { preserveNumericPrecision: true, version: sdfVersion });
    case 'urdf':
    case 'xacro':
      // Editable drafts must round-trip to the exact workspace values across edits.
      return generateURDF(robotState, {
        includeHardware,
        preserveMeshPaths: preserveMeshPaths ?? true,
        preserveNumericPrecision: true,
      });
    default: {
      const unsupportedFormat: never = format;
      throw new Error(`Unsupported editable source format: ${String(unsupportedFormat)}`);
    }
  }
}

/** A transient edit can be valid workspace data before it has serializable source. */
export function tryGenerateEditableRobotSource(options: GenerateEditableRobotSourceOptions): string | null {
  if (
    !canPreserveJointTypesInSource(options.robotState, options.format)
    || !canPreserveGeometryInSource(options.robotState, options.format)
  ) return null;
  try {
    return generateEditableRobotSource(options);
  } catch {
    // Source is a derived view. Export readiness must not gate editing or replace a valid draft.
    return null;
  }
}
