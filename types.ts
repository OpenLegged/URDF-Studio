
export type Vector3 = { x: number; y: number; z: number };
export type Euler = { r: number; p: number; y: number };

export enum JointType {
  FIXED = 'fixed',
  REVOLUTE = 'revolute',
  CONTINUOUS = 'continuous',
  PRISMATIC = 'prismatic',
}

export enum GeometryType {
  BOX = 'box',
  CYLINDER = 'cylinder',
  SPHERE = 'sphere',
  MESH = 'mesh',
  NONE = 'none',
}

export interface UrdfVisual {
  type: GeometryType;
  dimensions: Vector3; // Used variably based on type (x=radius, y=length for cylinder)
  color: string;
  meshPath?: string; // For later detailed design
  origin: { xyz: Vector3; rpy: Euler }; // Offset relative to link frame
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
}

export interface RobotState {
  name: string;
  links: Record<string, UrdfLink>;
  joints: Record<string, UrdfJoint>;
  rootLinkId: string;
  selection: { type: 'link' | 'joint' | null; id: string | null };
}

export interface MotorSpec {
    name: string;
    armature: number;
    velocity: number;
    effort: number;
    url?: string;
    description?: string;
}

export interface InspectionIssue {
  type: 'error' | 'warning' | 'suggestion' | 'pass';
  title: string;
  description: string;
  relatedIds?: string[]; // IDs of links/joints involved
  category?: string; // 所属章节 ID
  itemId?: string; // 检查条目 ID
  score?: number; // 得分（0-10）
}

export interface InspectionReport {
  summary: string;
  issues: InspectionIssue[];
  overallScore?: number; // 总分（0-100）
  categoryScores?: Record<string, number>; // 各章节得分
  maxScore?: number; // 满分（默认 100）
}

export const DEFAULT_LINK: UrdfLink = {
  id: '',
  name: 'link',
  visual: { 
    type: GeometryType.CYLINDER, 
    dimensions: { x: 0.05, y: 0.5, z: 0.05 }, 
    color: '#3b82f6',
    origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } }
  },
  collision: { 
    type: GeometryType.CYLINDER, 
    dimensions: { x: 0.05, y: 0.5, z: 0.05 }, 
    color: '#ef4444',
    origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } }
  },
  inertial: {
      mass: 1.0,
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      inertia: { ixx: 0.1, ixy: 0, ixz: 0, iyy: 0.1, iyz: 0, izz: 0.1 }
  }
};

export const DEFAULT_JOINT: UrdfJoint = {
  id: '',
  name: 'joint',
  type: JointType.REVOLUTE,
  parentLinkId: '',
  childLinkId: '',
  origin: { xyz: { x: 0, y: 0, z: 0.5 }, rpy: { r: 0, p: 0, y: 0 } },
  axis: { x: 0, y: 0, z: 1 },
  limit: { lower: -1.57, upper: 1.57, effort: 100, velocity: 10 },
  dynamics: { damping: 0, friction: 0 },
  hardware: { armature: 0, motorType: 'Go1-M8010-6', motorId: '0', motorDirection: 1 }
};

export type AppMode = 'skeleton' | 'detail' | 'hardware';
