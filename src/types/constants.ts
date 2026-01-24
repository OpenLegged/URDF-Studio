/**
 * Default values and constants
 */

import { GeometryType } from './geometry';
import { JointType } from './robot';
import type { UrdfLink, UrdfJoint } from './robot';

export const DEFAULT_LINK: UrdfLink = {
  id: '',
  name: 'link',
  visible: true,
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
