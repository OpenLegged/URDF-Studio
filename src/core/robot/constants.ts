/**
 * Robot Constants
 * Re-exports default values from types and provides additional robot-specific constants
 */

// Re-export default values from types
export { DEFAULT_LINK, DEFAULT_JOINT } from '@/types';

// Default robot state
export const DEFAULT_ROBOT_NAME = 'robot';

// ID prefixes for generating unique IDs
export const LINK_ID_PREFIX = 'link_';
export const JOINT_ID_PREFIX = 'joint_';

// Default geometry dimensions
export const DEFAULT_LINK_RADIUS = 0.05;
export const DEFAULT_LINK_LENGTH = 0.5;
export const DEFAULT_JOINT_OFFSET_Z = 0.5;

// Axis vectors
export const AXIS_X = { x: 1, y: 0, z: 0 };
export const AXIS_Y = { x: 0, y: 1, z: 0 };
export const AXIS_Z = { x: 0, y: 0, z: 1 };

// Default colors
export const DEFAULT_VISUAL_COLOR = '#3b82f6';
export const DEFAULT_COLLISION_COLOR = '#ef4444';
