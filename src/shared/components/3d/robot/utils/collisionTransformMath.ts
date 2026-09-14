import * as THREE from 'three';

export type CollisionTransformAxis = 'X' | 'Y' | 'Z';

export interface CollisionPendingEdit {
    axis: CollisionTransformAxis;
    value: number;
    startValue: number;
    isRotate: boolean;
}

export const radToDeg = (rad: number) => rad * (180 / Math.PI);

export const degToRad = (deg: number) => deg * (Math.PI / 180);

const tempEuler = new THREE.Euler(0, 0, 0, 'ZYX');

const getObjectRPYEuler = (object: THREE.Object3D) => tempEuler.setFromQuaternion(object.quaternion, 'ZYX');

export const getAxisTransformValue = (
    object: THREE.Object3D,
    axis: CollisionTransformAxis,
    isRotate: boolean
) => {
    if (!isRotate) {
        if (axis === 'X') return object.position.x;
        if (axis === 'Y') return object.position.y;
        return object.position.z;
    }

    const rotation = getObjectRPYEuler(object);
    if (axis === 'X') return rotation.x;
    if (axis === 'Y') return rotation.y;
    return rotation.z;
};

export const applyAxisTransformValue = (
    object: THREE.Object3D,
    axis: CollisionTransformAxis,
    value: number,
    isRotate: boolean
) => {
    if (!isRotate) {
        if (axis === 'X') {
            object.position.x = value;
            return;
        }

        if (axis === 'Y') {
            object.position.y = value;
            return;
        }

        object.position.z = value;
        return;
    }

    const rotation = getObjectRPYEuler(object);
    if (axis === 'X') {
        rotation.x = value;
    } else if (axis === 'Y') {
        rotation.y = value;
    } else {
        rotation.z = value;
    }

    object.quaternion.setFromEuler(rotation);
};

export const getObjectRPY = (object: THREE.Object3D) => {
    const rotation = getObjectRPYEuler(object);
    return { r: rotation.x, p: rotation.y, y: rotation.z };
};

export const formatPendingDelta = (pendingEdit: CollisionPendingEdit | null) => {
    if (!pendingEdit) return '0';
    const delta = pendingEdit.value - pendingEdit.startValue;
    if (pendingEdit.isRotate) {
        const degDelta = radToDeg(delta);
        return (degDelta >= 0 ? '+' : '') + degDelta.toFixed(2);
    }
    return (delta >= 0 ? '+' : '') + delta.toFixed(4);
};
