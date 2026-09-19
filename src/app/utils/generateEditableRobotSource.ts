import { generateMujocoXML, generateSDF, generateURDF } from '@/core/parsers';
import { canGenerateUrdf } from '@/core/parsers/urdf/urdfExportSupport';
import { canPreserveClosedLoopsInSource, canPreserveJointTypesInSource } from '@/core/parsers/sourceJointSupport';
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
  robot: Pick<RobotData, 'joints' | 'inspectionContext' | 'closedLoopConstraints'>,
  preferredFormat?: GenerateEditableRobotSourceFormat,
  options?: {
    /**
     * User-selected fallback used when URDF/Xacro source cannot carry closed
     * loops. Defaults to SDF, which preserves loop-closer joint semantics.
     */
    closedLoopFallbackFormat?: 'sdf' | 'mjcf';
  },
): GenerateEditableRobotSourceFormat {
  const sourceFormat = preferredFormat ?? robot.inspectionContext?.sourceFormat;
  const format = sourceFormat === 'mjcf' || sourceFormat === 'sdf' || sourceFormat === 'xacro'
    ? sourceFormat
    : 'urdf';
  if (!canPreserveClosedLoopsInSource(robot, 'mjcf')) {
    // Native MJCF equality constraints do not preserve hinge/slide loop edges.
    // Never turn an automatically derived source view into a ball-joint model.
    return 'sdf';
  }
  if (format !== 'urdf' && format !== 'xacro') {
    return format;
  }
  if (!canGenerateUrdf(robot)) {
    return 'mjcf';
  }
  // Closed loops cannot be expressed in URDF/Xacro source; degrade to the
  // user-selected loop-capable format so the merged source keeps the loops.
  return (robot.closedLoopConstraints?.length ?? 0) > 0
    ? (options?.closedLoopFallbackFormat ?? 'sdf')
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
