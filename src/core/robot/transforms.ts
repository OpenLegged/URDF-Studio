/**
 * Robot Coordinate Transforms
 * Utilities for coordinate transformation calculations
 */

import type { Vector3, Euler } from '@/types';

/**
 * Create a zero vector
 */
export const zeroVector = (): Vector3 => ({ x: 0, y: 0, z: 0 });

/**
 * Create a zero euler angles
 */
export const zeroEuler = (): Euler => ({ r: 0, p: 0, y: 0 });

/**
 * Add two vectors
 */
export const addVectors = (a: Vector3, b: Vector3): Vector3 => ({
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z
});

/**
 * Subtract two vectors (a - b)
 */
export const subtractVectors = (a: Vector3, b: Vector3): Vector3 => ({
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z
});

/**
 * Scale a vector by a scalar
 */
export const scaleVector = (v: Vector3, s: number): Vector3 => ({
    x: v.x * s,
    y: v.y * s,
    z: v.z * s
});

/**
 * Calculate the magnitude of a vector
 */
export const vectorMagnitude = (v: Vector3): number => {
    return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
};

/**
 * Normalize a vector (make it unit length)
 */
export const normalizeVector = (v: Vector3): Vector3 => {
    const mag = vectorMagnitude(v);
    if (mag === 0) return { x: 0, y: 0, z: 0 };
    return scaleVector(v, 1 / mag);
};

/**
 * Calculate the dot product of two vectors
 */
export const dotProduct = (a: Vector3, b: Vector3): number => {
    return a.x * b.x + a.y * b.y + a.z * b.z;
};

/**
 * Calculate the cross product of two vectors
 */
export const crossProduct = (a: Vector3, b: Vector3): Vector3 => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
});

/**
 * Calculate the distance between two points
 */
export const distance = (a: Vector3, b: Vector3): number => {
    return vectorMagnitude(subtractVectors(a, b));
};

/**
 * Convert degrees to radians
 */
export const degToRad = (deg: number): number => deg * Math.PI / 180;

/**
 * Convert radians to degrees
 */
export const radToDeg = (rad: number): number => rad * 180 / Math.PI;

/**
 * Clamp a value between min and max
 */
export const clamp = (value: number, min: number, max: number): number => {
    return Math.max(min, Math.min(max, value));
};

/**
 * Linear interpolation between two values
 */
export const lerp = (a: number, b: number, t: number): number => {
    return a + (b - a) * t;
};

/**
 * Linear interpolation between two vectors
 */
export const lerpVector = (a: Vector3, b: Vector3, t: number): Vector3 => ({
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t)
});

/**
 * Check if two vectors are approximately equal
 */
export const vectorsEqual = (a: Vector3, b: Vector3, epsilon: number = 0.0001): boolean => {
    return Math.abs(a.x - b.x) < epsilon &&
           Math.abs(a.y - b.y) < epsilon &&
           Math.abs(a.z - b.z) < epsilon;
};

/**
 * Check if two euler angles are approximately equal
 */
export const eulersEqual = (a: Euler, b: Euler, epsilon: number = 0.0001): boolean => {
    return Math.abs(a.r - b.r) < epsilon &&
           Math.abs(a.p - b.p) < epsilon &&
           Math.abs(a.y - b.y) < epsilon;
};

/**
 * Create a rotation matrix from euler angles (ZYX order - yaw, pitch, roll)
 * Returns a 3x3 matrix as a flat array [m00, m01, m02, m10, m11, m12, m20, m21, m22]
 */
export const eulerToRotationMatrix = (euler: Euler): number[] => {
    const { r: roll, p: pitch, y: yaw } = euler;

    const cr = Math.cos(roll);
    const sr = Math.sin(roll);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);

    return [
        cy * cp,                      cy * sp * sr - sy * cr,    cy * sp * cr + sy * sr,
        sy * cp,                      sy * sp * sr + cy * cr,    sy * sp * cr - cy * sr,
        -sp,                          cp * sr,                   cp * cr
    ];
};

/**
 * Apply a rotation matrix to a vector
 */
export const rotateVector = (v: Vector3, matrix: number[]): Vector3 => {
    return {
        x: matrix[0] * v.x + matrix[1] * v.y + matrix[2] * v.z,
        y: matrix[3] * v.x + matrix[4] * v.y + matrix[5] * v.z,
        z: matrix[6] * v.x + matrix[7] * v.y + matrix[8] * v.z
    };
};

/**
 * Rotate a vector around an axis by an angle
 * Uses Rodrigues' rotation formula
 */
export const rotateVectorAroundAxis = (v: Vector3, axis: Vector3, angle: number): Vector3 => {
    const k = normalizeVector(axis);
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    // Rodrigues' rotation formula:
    // v_rot = v * cos(angle) + (k × v) * sin(angle) + k * (k · v) * (1 - cos(angle))
    const kCrossV = crossProduct(k, v);
    const kDotV = dotProduct(k, v);

    return {
        x: v.x * cosA + kCrossV.x * sinA + k.x * kDotV * (1 - cosA),
        y: v.y * cosA + kCrossV.y * sinA + k.y * kDotV * (1 - cosA),
        z: v.z * cosA + kCrossV.z * sinA + k.z * kDotV * (1 - cosA)
    };
};

/**
 * Transform a point by a position and rotation (apply rotation first, then translation)
 */
export const transformPoint = (
    point: Vector3,
    position: Vector3,
    rotation: Euler
): Vector3 => {
    const rotationMatrix = eulerToRotationMatrix(rotation);
    const rotatedPoint = rotateVector(point, rotationMatrix);
    return addVectors(rotatedPoint, position);
};

/**
 * Inverse transform a point (reverse of transformPoint)
 */
export const inverseTransformPoint = (
    point: Vector3,
    position: Vector3,
    rotation: Euler
): Vector3 => {
    // First subtract position, then apply inverse rotation
    const translated = subtractVectors(point, position);

    // For inverse rotation, negate the euler angles
    const inverseRotation: Euler = { r: -rotation.r, p: -rotation.p, y: -rotation.y };
    const rotationMatrix = eulerToRotationMatrix(inverseRotation);

    return rotateVector(translated, rotationMatrix);
};

/**
 * Format a number to a fixed precision (default 4 decimal places)
 */
export const formatNumber = (n: number, precision: number = 4): string => {
    return n.toFixed(precision);
};

/**
 * Format a vector as a string "x y z"
 */
export const formatVector = (v: Vector3, precision: number = 4): string => {
    return `${formatNumber(v.x, precision)} ${formatNumber(v.y, precision)} ${formatNumber(v.z, precision)}`;
};

/**
 * Format euler angles as a string "r p y"
 */
export const formatEuler = (e: Euler, precision: number = 4): string => {
    return `${formatNumber(e.r, precision)} ${formatNumber(e.p, precision)} ${formatNumber(e.y, precision)}`;
};
