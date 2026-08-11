/** Canonical metadata DTOs shared by Robot Runtime and Motion Studio. */

export interface RobotJointLimit {
  lower: number;
  upper: number;
}

export type CollisionGeometryType =
  | 'box'
  | 'plane'
  | 'sphere'
  | 'ellipsoid'
  | 'cylinder'
  | 'capsule'
  | 'hfield'
  | 'polyline'
  | 'mesh';

export interface RobotCollisionBody {
  id: string;
  /** Exact key of the package-owned collider in RobotRuntime.colliders. */
  runtimeKey?: string;
  linkName: string;
  source: 'definition' | 'custom';
  type: CollisionGeometryType;
  dimensions?: { x: number; y: number; z: number };
  meshFilename?: string;
  scale?: { x: number; y: number; z: number };
  origin: {
    xyz: { x: number; y: number; z: number };
    rpy: { r: number; p: number; y: number };
  };
  enabled: boolean;
  visible: boolean;
}

export interface RobotCollisionProfile {
  robotId: string;
  links: Record<string, RobotCollisionBody[]>;
}

export interface RobotDofMetadata {
  /** Independent runtime joints in the order consumed by motion frames. */
  jointNames: string[];
  /** Flattened component names; multi-axis joints contribute multiple entries. */
  dofNames: string[];
  jointLimits: Record<string, RobotJointLimit>;
  linkNames: string[];
}
