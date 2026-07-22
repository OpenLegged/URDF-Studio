import type { ExportDialogConfig, ExportMeshFormat, MeshExportFormat } from './types';

export const EXPORT_FORMATS: MeshExportFormat[] = ['mjcf', 'urdf', 'xacro', 'sdf', 'usd'];

export const MESH_FORMAT_OPTIONS: { value: ExportMeshFormat; labelKey: string }[] = [
  { value: 'auto', labelKey: 'exportMeshFormatAuto' },
  { value: 'obj', labelKey: 'exportMeshFormatObj' },
  { value: 'stl', labelKey: 'exportMeshFormatStl' },
  { value: 'ply', labelKey: 'exportMeshFormatPly' },
];

export const MJCF_SUPPORTS = ['MuJoCo', 'Motphys', 'Genesis'];
export const URDF_SUPPORTS = ['Isaac Sim', 'Isaac Gym', 'Genesis', 'PyBullet', 'ManiSkill', 'Motphys'];
export const XACRO_SUPPORTS = ['Gazebo Classic', 'Gazebo Sim', 'ROS1', 'ROS2'];
export const SDF_SUPPORTS = ['Gazebo', 'Ignition Gazebo', 'sdformat'];
export const USD_SUPPORTS = ['OpenUSD', 'Isaac Sim', 'Genesis', 'Omniverse'];

export const DEFAULT_CONFIG: ExportDialogConfig = {
  format: 'mjcf',
  includeSkeleton: false,
  mjcf: {
    meshdir: 'meshes/',
    addFloatBase: false,
    preferSharedMeshReuse: true,
    includeActuators: true,
    actuatorType: 'position',
    includeMeshes: true,
    meshFormat: 'auto',
    compressSTL: false,
    stlQuality: 50,
  },
  urdf: {
    includeExtended: false,
    includeBOM: false,
    useRelativePaths: true,
    preferSourceVisualMeshes: true,
    includeMeshes: true,
    meshFormat: 'auto',
    compressSTL: false,
    stlQuality: 50,
  },
  xacro: {
    includeGazeboControl: true,
    rosVersion: 'ros2',
    gazeboBackend: 'classic',
    rosHardwareInterface: 'effort',
    useRelativePaths: true,
    includeMeshes: true,
    meshFormat: 'auto',
    compressSTL: false,
    stlQuality: 50,
  },
  sdf: {
    includeMeshes: true,
    meshFormat: 'auto',
    compressSTL: false,
    stlQuality: 50,
  },
  usd: {
    fileFormat: 'usd',
    compressMeshes: true,
    meshQuality: 100,
  },
};

export function getExportFormatSupports(format: MeshExportFormat): string[] {
  switch (format) {
    case 'mjcf':
      return MJCF_SUPPORTS;
    case 'urdf':
      return URDF_SUPPORTS;
    case 'xacro':
      return XACRO_SUPPORTS;
    case 'sdf':
      return SDF_SUPPORTS;
    case 'usd':
      return USD_SUPPORTS;
    default: {
      const exhaustiveFormat: never = format;
      return exhaustiveFormat;
    }
  }
}
