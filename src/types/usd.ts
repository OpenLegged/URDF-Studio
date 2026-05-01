import type { RobotData } from './robot';

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
  geometry?: {
    materialId?: string | null;
    geomSubsetSections?: Array<{
      start?: number | null;
      length?: number | null;
      materialId?: string | null;
    }> | null;
  } | null;
  ranges?: UsdMeshDescriptorRanges | null;
}

export interface UsdSceneMaterialRecord {
  materialId?: string | null;
  name?: string | null;
  shaderPath?: string | null;
  shaderName?: string | null;
  shaderInfoId?: string | null;
  isOmniPbr?: boolean | null;
  opacityEnabled?: boolean | null;
  opacityTextureEnabled?: boolean | null;
  emissiveEnabled?: boolean | null;
  color?: ArrayLike<number> | null;
  emissive?: ArrayLike<number> | null;
  specularColor?: ArrayLike<number> | null;
  attenuationColor?: ArrayLike<number> | null;
  sheenColor?: ArrayLike<number> | null;
  normalScale?: ArrayLike<number> | null;
  clearcoatNormalScale?: ArrayLike<number> | null;
  roughness?: number | null;
  metalness?: number | null;
  opacity?: number | null;
  alphaTest?: number | null;
  clearcoat?: number | null;
  clearcoatRoughness?: number | null;
  specularIntensity?: number | null;
  transmission?: number | null;
  thickness?: number | null;
  attenuationDistance?: number | null;
  aoMapIntensity?: number | null;
  sheen?: number | null;
  sheenRoughness?: number | null;
  iridescence?: number | null;
  iridescenceIOR?: number | null;
  anisotropy?: number | null;
  anisotropyRotation?: number | null;
  emissiveIntensity?: number | null;
  ior?: number | null;
  mapPath?: string | null;
  emissiveMapPath?: string | null;
  roughnessMapPath?: string | null;
  metalnessMapPath?: string | null;
  normalMapPath?: string | null;
  aoMapPath?: string | null;
  alphaMapPath?: string | null;
  clearcoatMapPath?: string | null;
  clearcoatRoughnessMapPath?: string | null;
  clearcoatNormalMapPath?: string | null;
  specularColorMapPath?: string | null;
  specularIntensityMapPath?: string | null;
  transmissionMapPath?: string | null;
  thicknessMapPath?: string | null;
  sheenColorMapPath?: string | null;
  sheenRoughnessMapPath?: string | null;
  anisotropyMapPath?: string | null;
  iridescenceMapPath?: string | null;
  iridescenceThicknessMapPath?: string | null;
}

export interface UsdMeshCountsEntry {
  visualMeshCount?: number;
  collisionMeshCount?: number;
  collisionPrimitiveCounts?: Record<string, number | undefined>;
}

export interface UsdJointCatalogEntry {
  linkPath?: string | null;
  childLinkPath?: string | null;
  parentLinkPath?: string | null;
  jointPath?: string | null;
  jointName?: string | null;
  jointType?: string | null;
  jointTypeName?: string | null;
  axisToken?: string | null;
  axisLocal?: ArrayLike<number> | null;
  lowerLimitDeg?: number | null;
  upperLimitDeg?: number | null;
  angleDeg?: number | null;
  driveDamping?: number | null;
  driveMaxForce?: number | null;
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
}

export interface UsdPreparedExportCache {
  stageSourcePath?: string | null;
  robotData: RobotData;
  meshFiles: Record<string, Blob>;
}
