import { generateMujocoXML, generateSDF, generateURDF } from '@/core/parsers';
import type { RobotFile, RobotState } from '@/types';

export type GenerateEditableRobotSourceFormat = Extract<
  RobotFile['format'],
  'urdf' | 'mjcf' | 'sdf' | 'xacro'
>;

export interface GenerateEditableRobotSourceOptions {
  format: GenerateEditableRobotSourceFormat;
  robotState: RobotState;
  includeHardware?: 'never' | 'auto' | 'always';
  preserveMeshPaths?: boolean;
}

export function generateEditableRobotSource({
  format,
  robotState,
  includeHardware = 'auto',
  preserveMeshPaths,
}: GenerateEditableRobotSourceOptions): string {
  switch (format) {
    case 'mjcf':
      return generateMujocoXML(robotState, {
        meshdir: 'meshes/',
        includeSceneHelpers: false,
        preserveInertialData: true,
      });
    case 'sdf':
      return generateSDF(robotState);
    case 'urdf':
      return generateURDF(robotState, {
        includeHardware,
        preserveMeshPaths: preserveMeshPaths ?? true,
      });
    case 'xacro':
      return generateURDF(robotState, {
        includeHardware,
        preserveMeshPaths: preserveMeshPaths ?? true,
      });
    default: {
      const unsupportedFormat: never = format;
      throw new Error(`Unsupported editable source format: ${String(unsupportedFormat)}`);
    }
  }
}
