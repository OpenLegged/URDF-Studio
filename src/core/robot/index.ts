/**
 * Robot Core Module
 * Provides robot data manipulation utilities
 */

// Constants
export * from './constants';

// Builders - Factory functions for creating robot components
export {
    generateId,
    generateLinkId,
    generateJointId,
    createLink,
    createJoint,
    createEmptyRobot,
    addChildToRobot,
    cloneLink,
    cloneJoint
} from './builders';

// Validators - Data validation functions
export {
    validateLink,
    validateJoint,
    validateRobot,
    hasLinks,
    hasJoints,
    isRootLink,
    hasChildren,
    getParentJoint,
    getChildJoints
} from './validators';

export type { ValidationError, ValidationResult } from './validators';

// Transforms - Coordinate transformation utilities
export {
    zeroVector,
    zeroEuler,
    addVectors,
    subtractVectors,
    scaleVector,
    vectorMagnitude,
    normalizeVector,
    dotProduct,
    crossProduct,
    distance,
    degToRad,
    radToDeg,
    clamp,
    lerp,
    lerpVector,
    vectorsEqual,
    eulersEqual,
    eulerToRotationMatrix,
    rotateVector,
    rotateVectorAroundAxis,
    transformPoint,
    inverseTransformPoint,
    formatNumber,
    formatVector,
    formatEuler
} from './transforms';
