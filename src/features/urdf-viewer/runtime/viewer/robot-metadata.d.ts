export type RenderRobotJointCatalogEntry = {
  linkPath: string;
  jointPath: string | null;
  jointName: string;
  jointType: string;
  jointTypeName?: string | null;
  parentLinkPath: string | null;
  axisToken: "X" | "Y" | "Z";
  axisLocal: [number, number, number];
  lowerLimitDeg: number;
  upperLimitDeg: number;
  angleDeg?: number | null;
  driveDamping?: number | null;
  driveMaxForce?: number | null;
  localPos0?: [number, number, number] | null;
  localRot0Wxyz?: [number, number, number, number] | null;
  localPivotInLink: [number, number, number] | null;
  localPos1?: [number, number, number] | null;
  localRot1Wxyz?: [number, number, number, number] | null;
  originXyz: [number, number, number] | null;
  originQuatWxyz: [number, number, number, number] | null;
};

export type RenderRobotLinkDynamicsEntry = {
  linkPath: string;
  mass: number | null;
  centerOfMassLocal: [number, number, number];
  diagonalInertia: [number, number, number] | null;
  principalAxesLocal: [number, number, number, number];
};

export type RenderRobotMetadataSnapshot = {
  stageSourcePath: string | null;
  generatedAtMs: number;
  source: string;
  stale?: boolean;
  errorFlags?: string[];
  truthLoadError?: string | null;
  linkParentPairs: Array<[string, string | null]>;
  jointCatalogEntries: RenderRobotJointCatalogEntry[];
  linkDynamicsEntries: RenderRobotLinkDynamicsEntry[];
  meshCountsByLinkPath: Record<string, {
    visualMeshCount: number;
    collisionMeshCount: number;
    collisionPrimitiveCounts: Record<string, number>;
  }>;
};

export function normalizeRenderRobotMetadataSnapshot(raw: any): RenderRobotMetadataSnapshot | null;

export function getRenderRobotMetadataSnapshot(
  renderInterface: any,
  stageSourcePath?: string | null,
  options?: {
    strictErrors?: boolean;
    logErrors?: boolean;
  },
): RenderRobotMetadataSnapshot | null;

export function warmupRenderRobotMetadataSnapshot(
  renderInterface: any,
  options?: {
    force?: boolean;
    logErrors?: boolean;
    stageSourcePath?: string | null;
    skipIdleWait?: boolean;
    skipUrdfTruthFallback?: boolean;
  },
): Promise<RenderRobotMetadataSnapshot | null>;
