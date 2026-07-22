/**
 * Robot Data Validators
 * Functions to validate robot data integrity
 */

import type { RobotState, UrdfLink, UrdfJoint } from '@/types';
import { JointType, GeometryType } from '@/types';
import { hasFiniteJointLimitBounds } from './jointLimits';
import { getVisualGeometryEntries } from './visualBodies';

const AXIS_REQUIRED_TYPES = new Set<JointType>([
    JointType.REVOLUTE,
    JointType.CONTINUOUS,
    JointType.PRISMATIC,
    JointType.PLANAR,
]);

const EFFORT_VELOCITY_LIMIT_TYPES = new Set<JointType>([
    JointType.REVOLUTE,
    JointType.PRISMATIC,
    JointType.CONTINUOUS,
]);

export interface ValidationError {
    type: 'error' | 'warning';
    message: string;
    path?: string;
}

export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
}

/**
 * Validate a single link
 */
export const validateLink = (link: UrdfLink): ValidationResult => {
    const errors: ValidationError[] = [];
    const inertial = link.inertial;
    const validateVisualGeometry = (geometry: UrdfLink['visual'], path: string) => {
        const dims = geometry.dimensions;
        if (geometry.type === GeometryType.BOX) {
            if (dims.x <= 0 || dims.y <= 0 || dims.z <= 0) {
                errors.push({ type: 'error', message: 'Box dimensions must be positive', path });
            }
        } else if (geometry.type === GeometryType.PLANE) {
            if (dims.x <= 0 || dims.y <= 0) {
                errors.push({ type: 'error', message: 'Plane width and depth must be positive', path });
            }
        } else if (geometry.type === GeometryType.CYLINDER) {
            if (dims.x <= 0 || dims.y <= 0) {
                errors.push({ type: 'error', message: 'Cylinder radius and length must be positive', path });
            }
        } else if (geometry.type === GeometryType.CAPSULE) {
            if (dims.x <= 0 || dims.y <= 0) {
                errors.push({ type: 'error', message: 'Capsule radius and length must be positive', path });
            }
        } else if (geometry.type === GeometryType.SPHERE) {
            if (dims.x <= 0) {
                errors.push({ type: 'error', message: 'Sphere radius must be positive', path });
            }
        } else if (geometry.type === GeometryType.ELLIPSOID) {
            if (dims.x <= 0 || dims.y <= 0 || dims.z <= 0) {
                errors.push({ type: 'error', message: 'Ellipsoid radii must be positive', path });
            }
        } else if (geometry.type === GeometryType.HFIELD) {
            const hfieldSize = geometry.mjcfHfield?.size;
            if (!hfieldSize) {
                errors.push({ type: 'warning', message: 'Height field geometry is missing MJCF asset metadata', path });
            } else if (hfieldSize.radiusX <= 0 || hfieldSize.radiusY <= 0 || hfieldSize.elevationZ < 0 || hfieldSize.baseZ < 0) {
                errors.push({ type: 'error', message: 'Height field asset dimensions must be non-negative, with positive width/depth', path });
            }
        }
    };

    if (!link.id) {
        errors.push({ type: 'error', message: 'Link must have an ID', path: 'id' });
    }

    if (!link.name) {
        errors.push({ type: 'error', message: 'Link must have a name', path: 'name' });
    }

    if (inertial && inertial.mass < 0) {
        errors.push({ type: 'error', message: 'Link mass cannot be negative', path: 'inertial.mass' });
    }

    if (inertial && inertial.mass === 0) {
        errors.push({ type: 'warning', message: 'Link has zero mass', path: 'inertial.mass' });
    }

    getVisualGeometryEntries(link).forEach((entry) => {
        validateVisualGeometry(
            entry.geometry,
            entry.bodyIndex === null
                ? 'visual.dimensions'
                : `visualBodies.${entry.bodyIndex}.dimensions`,
        );
    });

    return {
        valid: errors.filter(e => e.type === 'error').length === 0,
        errors
    };
};

/**
 * Validate a single joint
 */
export const validateJoint = (joint: UrdfJoint, links: Record<string, UrdfLink>): ValidationResult => {
    const errors: ValidationError[] = [];

    if (!joint.id) {
        errors.push({ type: 'error', message: 'Joint must have an ID', path: 'id' });
    }

    if (!joint.name) {
        errors.push({ type: 'error', message: 'Joint must have a name', path: 'name' });
    }

    if (!joint.parentLinkId) {
        errors.push({ type: 'error', message: 'Joint must have a parent link', path: 'parentLinkId' });
    } else if (!links[joint.parentLinkId]) {
        errors.push({ type: 'error', message: `Parent link "${joint.parentLinkId}" not found`, path: 'parentLinkId' });
    }

    if (!joint.childLinkId) {
        errors.push({ type: 'error', message: 'Joint must have a child link', path: 'childLinkId' });
    } else if (!links[joint.childLinkId]) {
        errors.push({ type: 'error', message: `Child link "${joint.childLinkId}" not found`, path: 'childLinkId' });
    }

    if (joint.parentLinkId === joint.childLinkId) {
        errors.push({ type: 'error', message: 'Parent and child link cannot be the same', path: 'childLinkId' });
    }

    // Validate joint type
    if (!Object.values(JointType).includes(joint.type)) {
        errors.push({ type: 'error', message: `Invalid joint type: ${joint.type}`, path: 'type' });
    }

    // Validate axis only for types that use axis
    if (AXIS_REQUIRED_TYPES.has(joint.type)) {
        if (!joint.axis) {
            errors.push({ type: 'error', message: 'Joint axis is required for this joint type', path: 'axis' });
        } else {
            const axisLength = Math.sqrt(joint.axis.x ** 2 + joint.axis.y ** 2 + joint.axis.z ** 2);
            if (Math.abs(axisLength - 1) > 0.001) {
                errors.push({ type: 'warning', message: 'Joint axis should be normalized', path: 'axis' });
            }
            if (axisLength === 0) {
                errors.push({ type: 'error', message: 'Joint axis cannot be zero vector', path: 'axis' });
            }
        }
    }

    // Validate limits for revolute and prismatic joints
    if (joint.type === JointType.REVOLUTE || joint.type === JointType.PRISMATIC) {
        if (!joint.limit) {
            errors.push({ type: 'error', message: 'Joint limit is required for this joint type', path: 'limit' });
        } else if (
            hasFiniteJointLimitBounds(joint.limit) &&
            joint.limit.lower > joint.limit.upper
        ) {
            errors.push({ type: 'error', message: 'Lower limit cannot be greater than upper limit', path: 'limit' });
        }
    }

    if (EFFORT_VELOCITY_LIMIT_TYPES.has(joint.type)) {
        if (!joint.limit) {
            errors.push({ type: 'error', message: 'Joint limit is required for this joint type', path: 'limit' });
        } else {
            if (typeof joint.limit.effort === 'number' && joint.limit.effort < 0) {
                errors.push({ type: 'error', message: 'Effort limit cannot be negative', path: 'limit.effort' });
            }
            if (typeof joint.limit.velocity === 'number' && joint.limit.velocity < 0) {
                errors.push({ type: 'error', message: 'Velocity limit cannot be negative', path: 'limit.velocity' });
            }
        }
    }

    return {
        valid: errors.filter(e => e.type === 'error').length === 0,
        errors
    };
};

/**
 * Validate the entire robot structure
 */
export const validateRobot = (robot: RobotState): ValidationResult => {
    const errors: ValidationError[] = [];

    if (!robot.name) {
        errors.push({ type: 'error', message: 'Robot must have a name', path: 'name' });
    }

    if (!robot.rootLinkId) {
        errors.push({ type: 'error', message: 'Robot must have a root link', path: 'rootLinkId' });
    } else if (!robot.links[robot.rootLinkId]) {
        errors.push({ type: 'error', message: `Root link "${robot.rootLinkId}" not found`, path: 'rootLinkId' });
    }

    // Validate all links
    for (const [linkId, link] of Object.entries(robot.links)) {
        const linkResult = validateLink(link);
        if (!linkResult.valid) {
            errors.push(...linkResult.errors.map(e => ({
                ...e,
                path: `links.${linkId}.${e.path}`
            })));
        }
    }

    // Validate all joints
    for (const [jointId, joint] of Object.entries(robot.joints)) {
        const jointResult = validateJoint(joint, robot.links);
        if (!jointResult.valid) {
            errors.push(...jointResult.errors.map(e => ({
                ...e,
                path: `joints.${jointId}.${e.path}`
            })));
        }
    }

    // Check for cycles in the kinematic tree
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const hasCycle = (linkId: string): boolean => {
        visited.add(linkId);
        recursionStack.add(linkId);

        for (const joint of Object.values(robot.joints)) {
            if (joint.parentLinkId === linkId) {
                const childId = joint.childLinkId;
                if (!visited.has(childId)) {
                    if (hasCycle(childId)) return true;
                } else if (recursionStack.has(childId)) {
                    return true;
                }
            }
        }

        recursionStack.delete(linkId);
        return false;
    };

    if (robot.rootLinkId && hasCycle(robot.rootLinkId)) {
        errors.push({ type: 'error', message: 'Kinematic tree contains a cycle' });
    }

    // Check for orphaned links (links not connected to the tree)
    const connectedLinks = new Set<string>();
    const traverseTree = (linkId: string) => {
        connectedLinks.add(linkId);
        for (const joint of Object.values(robot.joints)) {
            if (joint.parentLinkId === linkId && !connectedLinks.has(joint.childLinkId)) {
                traverseTree(joint.childLinkId);
            }
        }
    };

    if (robot.rootLinkId) {
        traverseTree(robot.rootLinkId);
    }

    for (const linkId of Object.keys(robot.links)) {
        if (!connectedLinks.has(linkId) && linkId !== robot.rootLinkId) {
            errors.push({ type: 'warning', message: `Link "${linkId}" is not connected to the kinematic tree` });
        }
    }

    // Check for duplicate names
    const linkNames = new Set<string>();
    for (const link of Object.values(robot.links)) {
        if (linkNames.has(link.name)) {
            errors.push({ type: 'warning', message: `Duplicate link name: "${link.name}"` });
        }
        linkNames.add(link.name);
    }

    const jointNames = new Set<string>();
    for (const joint of Object.values(robot.joints)) {
        if (jointNames.has(joint.name)) {
            errors.push({ type: 'warning', message: `Duplicate joint name: "${joint.name}"` });
        }
        jointNames.add(joint.name);
    }

    return {
        valid: errors.filter(e => e.type === 'error').length === 0,
        errors
    };
};

/**
 * Check if a robot state has any links
 */
export const hasLinks = (robot: RobotState): boolean => {
    return Object.keys(robot.links).length > 0;
};

/**
 * Check if a robot state has any joints
 */
export const hasJoints = (robot: RobotState): boolean => {
    return Object.keys(robot.joints).length > 0;
};

/**
 * Check if a link is the root link
 */
export const isRootLink = (robot: RobotState, linkId: string): boolean => {
    return robot.rootLinkId === linkId;
};

/**
 * Check if a link has children (joints that connect to child links)
 */
export const hasChildren = (robot: RobotState, linkId: string): boolean => {
    return Object.values(robot.joints).some(j => j.parentLinkId === linkId);
};

/**
 * Get the parent joint of a link (if any)
 */
export const getParentJoint = (robot: RobotState, linkId: string): UrdfJoint | null => {
    return Object.values(robot.joints).find(j => j.childLinkId === linkId) || null;
};

/**
 * Get all child joints of a link
 */
export const getChildJoints = (robot: RobotState, linkId: string): UrdfJoint[] => {
    return Object.values(robot.joints).filter(j => j.parentLinkId === linkId);
};
