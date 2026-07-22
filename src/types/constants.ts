/**
 * Default values and constants
 */

import { GeometryType, type UrdfVisual, type Vector3 } from './geometry';
import { JointType } from './robot';
import type { UrdfInertial, UrdfLink, UrdfJoint } from './robot';

type DefaultLink = UrdfLink & {
  visual: UrdfVisual;
  visualBodies: UrdfVisual[];
  collision: UrdfVisual;
  collisionBodies: UrdfVisual[];
  inertial: UrdfInertial;
};

type DefaultJoint = UrdfJoint & {
  axis: Vector3;
  limit: NonNullable<UrdfJoint['limit']>;
};

export const DEFAULT_VISUAL_COLOR = '#ffffff';
export const DEFAULT_COLLISION_COLOR = '#ef4444';
export const DEFAULT_MESH_PREVIEW_COLOR = '#6b9bd2';
export const DEFAULT_PAINT_COLOR = '#ff6c0a';
export const UI_ACCENT_COLOR = '#007aff';
export const IMPORTED_EXTERNAL_FRAME_LINK_TYPE = 'imported_external_frame';

export const DEFAULT_LINK: DefaultLink = {
  id: '',
  name: 'link',
  visible: true,
  visual: {
    type: GeometryType.CYLINDER,
    dimensions: { x: 0.05, y: 0.5, z: 0.05 },
    color: DEFAULT_VISUAL_COLOR,
    origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
  },
  visualBodies: [],
  collision: {
    type: GeometryType.CYLINDER,
    dimensions: { x: 0.05, y: 0.5, z: 0.05 },
    color: DEFAULT_COLLISION_COLOR,
    origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
  },
  collisionBodies: [],
  inertial: {
    mass: 1.0,
    origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
    inertia: { ixx: 0.1, ixy: 0, ixz: 0, iyy: 0.1, iyz: 0, izz: 0.1 },
  },
};

export const DEFAULT_JOINT: DefaultJoint = {
  id: '',
  name: 'joint',
  type: JointType.REVOLUTE,
  parentLinkId: '',
  childLinkId: '',
  origin: { xyz: { x: 0, y: 0, z: 0.5 }, rpy: { r: 0, p: 0, y: 0 } },
  axis: { x: 0, y: 0, z: 1 },
  limit: { lower: -1.57, upper: 1.57, effort: 100, velocity: 10 },
  dynamics: { damping: 0, friction: 0 },
  hardware: {
    armature: 0,
    brand: 'Unitree',
    motorType: 'Go1-M8010-6',
    motorId: '0',
    motorDirection: 1,
  },
};
