import type { RobotData } from './robot';
import type { UsdSceneMaterialRecord } from './usdMaterial';

export type { UsdSceneMaterialRecord } from './usdMaterial';

export interface UsdMeshRange {
  offset: number;
  count: number;
  stride: number;
}

export interface UsdMeshDescriptorRanges {
  positions?: UsdMeshRange | null;
  indices?: UsdMeshRange | null;
  normals?: UsdMeshRange | null;
  uvs?: UsdMeshRange | null;
  transform?: UsdMeshRange | null;
}

export interface UsdSceneMeshDescriptor {
  meshId?: string | null;
  sectionName?: string | null;
  resolvedPrimPath?: string | null;
  primType?: string | null;
  axis?: string | null;
  size?: number | null;
  radius?: number | null;
  height?: number | null;
  extentSize?: ArrayLike<number> | null;
  materialId?: string | null;
  renderReady?: boolean | null;
  topologyMode?: 'indexed' | 'nonIndexed' | string | null;
  geometry?: {
    materialId?: string | null;
    renderReady?: boolean | null;
    topologyMode?: 'indexed' | 'nonIndexed' | string | null;
    uvSource?: string | null;
    geomSubsetSections?: Array<{
      start?: number | null;
      length?: number | null;
      materialId?: string | null;
    }> | null;
    normalDiagnostics?: UsdSceneMeshNormalDiagnostics | null;
  } | null;
  ranges?: UsdMeshDescriptorRanges | null;
  normalDiagnostics?: UsdSceneMeshNormalDiagnostics | null;
}

export interface UsdSceneMeshNormalDiagnostics {
  normalSource?: string | null;
  normalRepairCount?: number | null;
  normalFallbackCount?: number | null;
  postRepairLowDotCount?: number | null;
}

export interface UsdAuthoredXformOpsInfo {
  hasAuthoredOps: boolean;
  resetsXformStack: boolean;
  xformOpOrder?: string[] | null;
}

export interface UsdLayerInfo {
  rootLayerPath: string | null;
  usedLayerPaths: string[];
  layerTextByPath?: Record<string, string>;
}

export interface UsdMeshCountsEntry {
  visualMeshCount?: number;
  collisionMeshCount?: number;
  collisionPrimitiveCounts?: Record<string, number | undefined>;
  collisionPrimitiveGeometries?: Array<{
    primitiveType?: string | null;
    dimensions?: ArrayLike<number> | null;
    originXyz?: ArrayLike<number> | null;
  }>;
}

export interface UsdJointCatalogEntry {
  linkPath?: string | null;
  childLinkPath?: string | null;
  parentLinkPath?: string | null;
  jointPath?: string | null;
  jointName?: string | null;
  jointType?: string | null;
  jointTypeName?: string | null;
  usdPhysicsJointTypeName?: string | null;
  axisToken?: string | null;
  axisLocal?: ArrayLike<number> | null;
  lowerLimitDeg?: number | null;
  upperLimitDeg?: number | null;
  angleDeg?: number | null;
  driveDamping?: number | null;
  driveMaxForce?: number | null;
  usdLimitAxes?: Record<string, { low?: number | null; high?: number | null }> | null;
  usdDriveAxes?: Record<
    string,
    {
      type?: string | null;
      stiffness?: number | null;
      damping?: number | null;
      maxForce?: number | null;
      targetPosition?: number | null;
      targetVelocity?: number | null;
    }
  > | null;
  localPos0?: ArrayLike<number> | null;
  localRot0Wxyz?: ArrayLike<number> | null;
  localPivotInLink?: ArrayLike<number> | null;
  localPos1?: ArrayLike<number> | null;
  localRot1Wxyz?: ArrayLike<number> | null;
  originXyz?: ArrayLike<number> | null;
  originQuatWxyz?: ArrayLike<number> | null;
}

export interface UsdLinkDynamicsEntry {
  linkPath?: string | null;
  mass?: number | null;
  centerOfMassLocal?: ArrayLike<number> | null;
  diagonalInertia?: ArrayLike<number> | null;
  principalAxesLocal?: ArrayLike<number> | null;
  principalAxesLocalWxyz?: ArrayLike<number> | null;
}

export interface UsdClosedLoopConstraintEntry {
  id?: string | null;
  constraintType?: string | null;
  linkAPath?: string | null;
  linkBPath?: string | null;
  anchorWorld?: ArrayLike<number> | null;
  anchorLocalA?: ArrayLike<number> | null;
  anchorLocalB?: ArrayLike<number> | null;
}

export interface UsdRobotMetadataSnapshot {
  stageSourcePath?: string | null;
  source?: string;
  stale?: boolean;
  errorFlags?: ArrayLike<string>;
  truthLoadError?: string | null;
  linkParentPairs?: ArrayLike<[string, string | null]>;
  jointCatalogEntries?: ArrayLike<UsdJointCatalogEntry>;
  linkDynamicsEntries?: ArrayLike<UsdLinkDynamicsEntry>;
  closedLoopConstraintEntries?: ArrayLike<UsdClosedLoopConstraintEntry>;
  meshCountsByLinkPath?: Record<string, UsdMeshCountsEntry>;
}

export interface UsdSceneBuffers {
  positions?: ArrayLike<number> | null;
  indices?: ArrayLike<number> | null;
  normals?: ArrayLike<number> | null;
  uvs?: ArrayLike<number> | null;
  transforms?: ArrayLike<number> | null;
  rangesByMeshId?: Record<string, UsdMeshDescriptorRanges> | null;
}

export interface UsdSceneSnapshot {
  stageSourcePath?: string | null;
  stage?: {
    defaultPrimPath?: string | null;
  } | null;
  robotTree?: {
    linkParentPairs?: ArrayLike<[string, string | null]>;
    jointCatalogEntries?: ArrayLike<UsdJointCatalogEntry>;
    rootLinkPaths?: ArrayLike<string>;
  } | null;
  physics?: {
    linkDynamicsEntries?: ArrayLike<UsdLinkDynamicsEntry>;
  } | null;
  render?: {
    meshDescriptors?: ArrayLike<UsdSceneMeshDescriptor>;
    materials?: ArrayLike<UsdSceneMaterialRecord>;
    preferredVisualMaterialsByLinkPath?: Record<string, UsdSceneMaterialRecord>;
  } | null;
  robotMetadataSnapshot?: UsdRobotMetadataSnapshot | null;
  buffers?: UsdSceneBuffers | null;
  authoredXformOpsByPrimPath?: Record<string, UsdAuthoredXformOpsInfo> | null;
  layerInfo?: UsdLayerInfo | null;
}

/**
 * C++/WASM-baked USD scene payload used as the render/export sidecar.
 * Kept as a type alias while legacy snapshot call sites are migrated.
 */
export type UsdBakedScene = UsdSceneSnapshot;

export interface UsdPreparedExportCache {
  stageSourcePath?: string | null;
  robotData: RobotData;
  meshFiles: Record<string, Blob>;
}
