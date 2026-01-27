/**
 * Robot model related types
 */

import type { Vector3, Euler, UrdfVisual } from './geometry';

export enum JointType {
  FIXED = 'fixed',
  REVOLUTE = 'revolute',
  CONTINUOUS = 'continuous',
  PRISMATIC = 'prismatic',
}

export interface UrdfInertial {
  mass: number;
  origin?: { xyz: Vector3; rpy: Euler }; // Center of mass position and orientation
  inertia: {
    ixx: number;
    ixy: number;
    ixz: number;
    iyy: number;
    iyz: number;
    izz: number;
  };
}

export interface UrdfLink {
  id: string;
  name: string;
  visual: UrdfVisual;
  collision: UrdfVisual;
  inertial: UrdfInertial;
  visible?: boolean; // Controls visibility in the 3D scene
}

export interface UrdfJointDynamics {
  damping: number;
  friction: number;
}

export interface UrdfJointHardware {
  armature: number;
  motorType: string;
  motorId: string;
  motorDirection: 1 | -1;
}

export interface UrdfJoint {
  id: string;
  name: string;
  type: JointType;
  parentLinkId: string;
  childLinkId: string;
  origin: { xyz: Vector3; rpy: Euler };
  axis: Vector3;
  limit: { lower: number; upper: number; effort: number; velocity: number };
  dynamics: UrdfJointDynamics;
  hardware: UrdfJointHardware;
  angle?: number;
}

export interface RobotState {
  name: string;
  links: Record<string, UrdfLink>;
  joints: Record<string, UrdfJoint>;
  rootLinkId: string;
  selection: { type: 'link' | 'joint' | null; id: string | null; subType?: 'visual' | 'collision' };
}

export interface RobotFile {
  name: string;
  content: string;
  format: 'urdf' | 'mjcf' | 'usd' | 'xacro';
}
