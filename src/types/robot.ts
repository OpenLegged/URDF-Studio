/**
 * Robot model related types
 */

import type { UsdSceneMaterialRecord } from './usdMaterial';
import type { Euler, QuaternionXYZW, UrdfOrigin, UrdfVisual, Vector3 } from './geometry';
import type { InteractionSelection } from './ui';

export enum JointType {
  FIXED = 'fixed',
  REVOLUTE = 'revolute',
  CONTINUOUS = 'continuous',
  BALL = 'ball',
  PRISMATIC = 'prismatic',
  PLANAR = 'planar',
  FLOATING = 'floating',
}

export type JointHardwareInterface = 'effort' | 'position' | 'velocity';

export type JointQuaternion = QuaternionXYZW;

export interface UrdfInertial {
  mass: number;
  origin?: UrdfOrigin; // Center of mass position and orientation
  inertia: {
    ixx: number;
    ixy: number;
    ixz: number;
    iyy: number;
    iyz: number;
    izz: number;
  };
}

export interface UrdfMjcfSite {
  name: string;
  sourceName?: string;
  type: string;
  size?: number[];
  rgba?: [number, number, number, number];
  pos?: [number, number, number];
  quat?: [number, number, number, number];
  group?: number;
}

export interface UrdfLink {
  id: string;
  name: string;
  type?: string;
  visual: UrdfVisual;
  /**
   * Additional visual geometries on the same link.
   * The primary visual is kept in `visual` for backward compatibility.
   */
  visualBodies?: UrdfVisual[];
  collision: UrdfVisual;
  /**
   * Additional collision geometries on the same link.
   * The primary collision is kept in `collision` for backward compatibility.
   */
  collisionBodies?: UrdfVisual[];
  inertial?: UrdfInertial;
  mjcfSites?: UrdfMjcfSite[];
  visible?: boolean; // Controls visibility in the 3D scene
  /** Prevents editing, transforms, and viewport picking for this link subtree. */
  editorLocked?: boolean;
}

export interface UrdfJointDynamics {
  damping: number;
  friction: number;
  stiffness?: number;
}

export interface UrdfJointHardware {
  armature: number;
  brand?: string;
  motorType: string;
  motorId: string;
  motorDirection: 1 | -1;
  hardwareInterface?: JointHardwareInterface;
}

export interface UrdfJointMimic {
  joint: string;
  multiplier?: number;
  offset?: number;
}

export interface UrdfJointCalibration {
  referencePosition?: number;
  rising?: number;
  falling?: number;
}

export interface UrdfJointSafetyController {
  softLowerLimit?: number;
  softUpperLimit?: number;
  kPosition?: number;
  kVelocity?: number;
}

export type UsdPhysicsQuaternionWxyz = [number, number, number, number];

export interface UrdfJointUsdPhysicsAxisLimit {
  low?: number | null;
  high?: number | null;
}

export interface UrdfJointUsdPhysicsAxisDrive {
  type?: string | null;
  stiffness?: number | null;
  damping?: number | null;
  maxForce?: number | null;
  targetPosition?: number | null;
  targetVelocity?: number | null;
}

export interface UrdfJointUsdPhysicsFrame {
  jointTypeName?: string;
  axisToken?: string;
  localPos0?: Vector3;
  localRot0Wxyz?: UsdPhysicsQuaternionWxyz;
  localPos1?: Vector3;
  localRot1Wxyz?: UsdPhysicsQuaternionWxyz;
  limitAxes?: Record<string, UrdfJointUsdPhysicsAxisLimit>;
  driveAxes?: Record<string, UrdfJointUsdPhysicsAxisDrive>;
}

export interface UrdfJoint {
  id: string;
  name: string;
  type: JointType;
  parentLinkId: string;
  childLinkId: string;
  origin: UrdfOrigin;
  axis?: Vector3;
  limit?: {
    lower?: number;
    upper?: number;
    effort?: number;
    velocity?: number;
  };
  dynamics: UrdfJointDynamics;
  hardware: UrdfJointHardware;
  mimic?: UrdfJointMimic;
  calibration?: UrdfJointCalibration;
  safetyController?: UrdfJointSafetyController;
  referencePosition?: number;
  angle?: number;
  quaternion?: JointQuaternion;
  usdPhysics?: UrdfJointUsdPhysicsFrame;
}

export interface RobotClosedLoopConstraintSource {
  format: 'mjcf';
  body1Name: string;
  body2Name: string;
}

interface RobotClosedLoopConstraintBase {
  id: string;
  linkAId: string;
  linkBId: string;
  anchorWorld: Vector3;
  anchorLocalA: Vector3;
  anchorLocalB: Vector3;
  source?: RobotClosedLoopConstraintSource;
}

export interface RobotClosedLoopConnectConstraint extends RobotClosedLoopConstraintBase {
  type: 'connect';
}

export interface RobotClosedLoopDistanceConstraint extends RobotClosedLoopConstraintBase {
  type: 'distance';
  restDistance: number;
}

export type RobotClosedLoopConstraint =
  | RobotClosedLoopConnectConstraint
  | RobotClosedLoopDistanceConstraint;

export interface RobotMaterialState {
  color?: string;
  colorRgba?: [number, number, number, number];
  texture?: string;
  usdMaterial?: UsdSceneMaterialRecord | null;
}

export interface RobotMjcfInspectionBodySites {
  bodyId: string;
  siteCount: number;
  siteNames: string[];
}

export interface RobotMjcfInspectionTendonSummary {
  className?: string;
  group?: number;
  name: string;
  type: 'fixed' | 'spatial';
  limited?: boolean;
  range?: [number, number];
  width?: number;
  stiffness?: number;
  springlength?: number;
  rgba?: [number, number, number, number];
  attachmentRefs: string[];
  attachments: RobotMjcfInspectionTendonAttachment[];
  actuatorNames: string[];
}

export type RobotMjcfTendonVisualizationUpdate = Partial<
  Pick<RobotMjcfInspectionTendonSummary, 'rgba' | 'width'>
>;

export interface RobotMjcfInspectionTendonAttachment {
  type: 'site' | 'geom' | 'joint' | 'pulley';
  ref?: string;
  sidesite?: string;
  divisor?: number;
  coef?: number;
}

export type RobotSourceDiagnosticSeverity = 'info' | 'warning' | 'error';

export type RobotSourceDiagnosticCategory =
  | 'source'
  | 'topology'
  | 'joint'
  | 'geometry'
  | 'material'
  | 'physical'
  | 'simulation';

export interface RobotSourceDiagnostic {
  code: string;
  severity: RobotSourceDiagnosticSeverity;
  category: RobotSourceDiagnosticCategory;
  message: string;
  relatedIds?: string[];
  source?: {
    tag?: string;
    name?: string;
    attribute?: string;
  };
}

export type RobotImportRecoveryAction = 'omitted' | 'defaulted' | 'downgraded';

export interface RobotImportRecoveryDiagnostic extends RobotSourceDiagnostic {
  action: RobotImportRecoveryAction;
}

export interface RobotImportRecoveryReport {
  diagnostics: RobotImportRecoveryDiagnostic[];
  diagnosticCounts: Record<RobotSourceDiagnosticSeverity, number>;
  recoveredItemCount: number;
  omittedDiagnosticCount?: number;
}

export interface RobotUrdfInspectionFacts {
  linkCount: number;
  jointCount: number;
  visualCount: number;
  collisionCount: number;
  inertialCount: number;
  materialCount: number;
  meshCount: number;
  syntheticParentLinkCount: number;
  disconnectedRootCount: number;
}

export interface RobotUrdfInspectionContext {
  diagnostics: RobotSourceDiagnostic[];
  diagnosticCounts: Record<RobotSourceDiagnosticSeverity, number>;
  facts: RobotUrdfInspectionFacts;
  omittedDiagnosticCount?: number;
}

export interface RobotInspectionContext {
  sourceFormat: 'urdf' | 'mjcf' | 'usd' | 'xacro' | 'sdf' | 'mesh';
  recovery?: RobotImportRecoveryReport;
  urdf?: RobotUrdfInspectionContext;
  mjcf?: {
    siteCount: number;
    tendonCount: number;
    tendonActuatorCount: number;
    bodiesWithSites: RobotMjcfInspectionBodySites[];
    tendons: RobotMjcfInspectionTendonSummary[];
  };
}

export interface RobotState {
  name: string;
  version?: string;
  links: Record<string, UrdfLink>;
  joints: Record<string, UrdfJoint>;
  rootLinkId: string;
  materials?: Record<string, RobotMaterialState>;
  closedLoopConstraints?: RobotClosedLoopConstraint[];
  inspectionContext?: RobotInspectionContext;
  selection: InteractionSelection;
}

/**
 * Parser/renderer/export robot data without selection. Workspace ownership and
 * placement live only on AssemblyState and must never be mirrored here.
 */
export interface RobotData {
  name: string;
  version?: string;
  links: Record<string, UrdfLink>;
  joints: Record<string, UrdfJoint>;
  rootLinkId: string;
  materials?: Record<string, RobotMaterialState>;
  closedLoopConstraints?: RobotClosedLoopConstraint[];
  inspectionContext?: RobotInspectionContext;
}

export interface AssemblyTransform {
  position: Vector3;
  rotation: Euler;
}

export interface RenderableBounds {
  min: Vector3;
  max: Vector3;
}

/** A source-local RobotData instance placed in the workspace. */
export interface AssemblyComponent {
  id: string;
  name: string;
  sourceFile: string | null;
  robot: RobotData;
  renderableBounds?: RenderableBounds;
  transform: AssemblyTransform;
  visible: boolean;
  /** Prevents editing, transforms, and viewport picking for this component. */
  editorLocked?: boolean;
}

/** Bridge joint with source-local link endpoints scoped by explicit component IDs. */
export interface BridgeJoint {
  id: string;
  name: string;
  parentComponentId: string;
  parentLinkId: string;
  childComponentId: string;
  childLinkId: string;
  joint: UrdfJoint;
}

/** Canonical non-empty workspace state for both single- and multi-robot projects. */
export interface AssemblyState {
  name: string;
  transform: AssemblyTransform;
  components: Record<string, AssemblyComponent>;
  bridges: Record<string, BridgeJoint>;
}

export interface RobotFile {
  name: string;
  content: string;
  format: 'urdf' | 'mjcf' | 'usd' | 'xacro' | 'sdf' | 'mesh' | 'asset';
  blobUrl?: string;
}
