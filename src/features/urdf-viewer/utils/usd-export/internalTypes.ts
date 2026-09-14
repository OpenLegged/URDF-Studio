import type {
  RobotData,
  RobotState,
  UsdMeshDescriptorRanges,
  UsdMeshRange,
  UsdSceneBuffers,
  UsdSceneMaterialRecord,
  UsdSceneMeshDescriptor,
  UsdSceneSnapshot,
} from '../../../../types/index.ts';

export type MeshRange = UsdMeshRange;
export type MeshDescriptorRanges = UsdMeshDescriptorRanges;
export type SnapshotMaterialRecord = UsdSceneMaterialRecord;
export type SnapshotMeshDescriptor = UsdSceneMeshDescriptor;
export type SnapshotBuffers = UsdSceneBuffers;
export type UsdExportSnapshot = UsdSceneSnapshot;

export type DescriptorRole = 'visual' | 'collision';

export type SnapshotGeomSubsetSection = {
  start: number;
  length: number;
  materialId?: string | null;
};

export type ExportDescriptor = {
  descriptor: SnapshotMeshDescriptor;
  meshId: string;
  linkPath: string;
  linkId: string;
  role: DescriptorRole;
  exportPath: string;
  ordinal: number;
  subsetIndex?: number;
  subsetSection?: SnapshotGeomSubsetSection | null;
  materialIdOverride?: string | null;
  displayColor?: [number, number, number] | null;
  subsetDisplayColors?: Array<{
    start: number;
    length: number;
    color: [number, number, number];
  }> | null;
  bakeTransformIntoMesh?: boolean;
  geometryTransform?: number[];
  writeTextureCoordinates?: boolean;
};

export type RobotLike = RobotData | RobotState;

export type PreparedUsdExportCacheTransferBytesCarrier = {
  __meshFileBytes?: Record<string, Uint8Array>;
};

export type SnapshotHost =
  | {
      renderInterface?: {
        getCachedRobotSceneSnapshot?: (stageSourcePath?: string | null) => unknown;
        getPreferredVisualMaterialForLink?: (
          linkPath: string,
          requestingMeshId?: string | null,
        ) => unknown;
        getPreferredLinkWorldTransform?: (linkPath: string) => unknown;
        getWorldTransformForPrimPath?: (primPath: string) => unknown;
      } | null;
    }
  | null
  | undefined;

export const ORIGIN_EPSILON = 1e-9;
// Unitree cooked USDs contain very thin triangles whose normals still affect shading.
export const NORMAL_EPSILON = 0;
export const NORMAL_REPAIR_DOT_THRESHOLD = 0.2;
