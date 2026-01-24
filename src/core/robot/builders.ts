/**
 * Robot Data Builders
 * Factory functions for creating robot components with sensible defaults
 */

import type { UrdfLink, UrdfJoint, RobotState } from '@/types';
import { DEFAULT_LINK, DEFAULT_JOINT, JointType, GeometryType } from '@/types';
import {
    LINK_ID_PREFIX,
    JOINT_ID_PREFIX,
    DEFAULT_ROBOT_NAME,
    DEFAULT_VISUAL_COLOR
} from './constants';

/**
 * Generate a unique ID with the given prefix
 */
export const generateId = (prefix: string): string => {
    return `${prefix}${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
};

/**
 * Generate a unique link ID
 */
export const generateLinkId = (): string => generateId(LINK_ID_PREFIX);

/**
 * Generate a unique joint ID
 */
export const generateJointId = (): string => generateId(JOINT_ID_PREFIX);

/**
 * Create a new link with default values
 */
export const createLink = (options: Partial<UrdfLink> = {}): UrdfLink => {
    const id = options.id || generateLinkId();
    return {
        ...DEFAULT_LINK,
        id,
        name: options.name || id,
        visual: {
            ...DEFAULT_LINK.visual,
            color: DEFAULT_VISUAL_COLOR,
            ...options.visual
        },
        collision: {
            ...DEFAULT_LINK.collision,
            ...options.collision
        },
        inertial: {
            ...DEFAULT_LINK.inertial,
            ...options.inertial
        },
        visible: options.visible ?? true,
        ...options
    };
};

/**
 * Create a new joint with default values
 */
export const createJoint = (options: Partial<UrdfJoint> & {
    parentLinkId: string;
    childLinkId: string;
}): UrdfJoint => {
    const id = options.id || generateJointId();
    return {
        ...DEFAULT_JOINT,
        id,
        name: options.name || id,
        type: options.type || JointType.REVOLUTE,
        parentLinkId: options.parentLinkId,
        childLinkId: options.childLinkId,
        origin: {
            xyz: { x: 0, y: 0, z: 0.5 },
            rpy: { r: 0, p: 0, y: 0 },
            ...options.origin
        },
        axis: options.axis || { x: 0, y: 0, z: 1 },
        limit: {
            ...DEFAULT_JOINT.limit,
            ...options.limit
        },
        dynamics: {
            ...DEFAULT_JOINT.dynamics,
            ...options.dynamics
        },
        hardware: {
            ...DEFAULT_JOINT.hardware,
            ...options.hardware
        },
        ...options
    };
};

/**
 * Create a new empty robot state with a single root link
 */
export const createEmptyRobot = (name: string = DEFAULT_ROBOT_NAME): RobotState => {
    const rootLinkId = generateLinkId();
    const rootLink = createLink({
        id: rootLinkId,
        name: 'base_link'
    });

    return {
        name,
        links: { [rootLinkId]: rootLink },
        joints: {},
        rootLinkId,
        selection: { type: 'link', id: rootLinkId }
    };
};

/**
 * Add a child link and joint to an existing robot
 */
export const addChildToRobot = (
    robot: RobotState,
    parentLinkId: string,
    linkOptions: Partial<UrdfLink> = {},
    jointOptions: Partial<UrdfJoint> = {}
): RobotState => {
    // Calculate offset based on existing siblings
    const siblings = Object.values(robot.joints).filter(j => j.parentLinkId === parentLinkId);
    const yOffset = siblings.length * 0.5;

    const newLink = createLink({
        name: `link_${Object.keys(robot.links).length + 1}`,
        ...linkOptions
    });

    const newJoint = createJoint({
        name: `joint_${Object.keys(robot.joints).length + 1}`,
        parentLinkId,
        childLinkId: newLink.id,
        origin: {
            xyz: { x: 0, y: yOffset, z: 0.5 },
            rpy: { r: 0, p: 0, y: 0 }
        },
        ...jointOptions
    });

    return {
        ...robot,
        links: { ...robot.links, [newLink.id]: newLink },
        joints: { ...robot.joints, [newJoint.id]: newJoint },
        selection: { type: 'joint', id: newJoint.id }
    };
};

/**
 * Clone a link with a new ID
 */
export const cloneLink = (link: UrdfLink, newId?: string): UrdfLink => {
    const id = newId || generateLinkId();
    return {
        ...link,
        id,
        name: `${link.name}_copy`,
        visual: { ...link.visual },
        collision: { ...link.collision },
        inertial: {
            ...link.inertial,
            origin: link.inertial.origin ? { ...link.inertial.origin } : undefined,
            inertia: { ...link.inertial.inertia }
        }
    };
};

/**
 * Clone a joint with a new ID and updated link references
 */
export const cloneJoint = (
    joint: UrdfJoint,
    newParentLinkId: string,
    newChildLinkId: string,
    newId?: string
): UrdfJoint => {
    const id = newId || generateJointId();
    return {
        ...joint,
        id,
        name: `${joint.name}_copy`,
        parentLinkId: newParentLinkId,
        childLinkId: newChildLinkId,
        origin: { ...joint.origin, xyz: { ...joint.origin.xyz }, rpy: { ...joint.origin.rpy } },
        axis: { ...joint.axis },
        limit: { ...joint.limit },
        dynamics: { ...joint.dynamics },
        hardware: { ...joint.hardware }
    };
};
