import * as THREE from 'three';

/**
 * Offset the robot so its bottom is at ground level (Y=0)
 * Also handles Z-up URDF convention by offsetting negative Z parts
 */
export function offsetRobotToGround(robot: THREE.Object3D): void {
    // Update matrix world to ensure correct bounds calculation for detached object
    robot.updateMatrixWorld(true);

    const box = new THREE.Box3();

    robot.traverse((child) => {
        // Ignore gizmos and helpers
        if (child.userData?.isGizmo) return;

        // Ignore specific helper names that might not be tagged
        if (child.name === '__link_axes_helper__' ||
            child.name === '__joint_axis_helper__' ||
            child.name === '__debug_joint_axes__' ||
            child.name === '__inertia_visual__' ||
            child.name === '__com_visual__' ||
            child.name === '__inertia_box__' ||
            child.name === '__origin_axes__' ||
            child.name === '__joint_axis__') return;

        if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            if (mesh.geometry) {
                if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
                const geomBox = mesh.geometry.boundingBox!.clone();
                geomBox.applyMatrix4(mesh.matrixWorld);
                box.union(geomBox);
            }
        }
    });

    // Fallback if box is empty (e.g. only gizmos found or no meshes)
    if (box.isEmpty()) {
        const standardBox = new THREE.Box3().setFromObject(robot);
        if (!standardBox.isEmpty()) {
             box.copy(standardBox);
        } else {
             return;
        }
    }

    const minY = box.min.y;
    const minZ = box.min.z;

    console.log(`[RobotModel] Robot bounds before offset: minY=${minY.toFixed(4)}, minZ=${minZ.toFixed(4)}`);

    // Offset Y so bottom is at Y=0 (ground plane in Three.js Y-up convention)
    if (isFinite(minY) && Math.abs(minY) > 0.0001) {
        robot.position.y -= minY;
        console.log(`[RobotModel] Offset robot Y by ${-minY} to place on ground`);
    }

    // Also offset Z if there are negative Z parts (for Z-up URDF convention)
    // This ensures the robot is fully above the XY plane
    if (isFinite(minZ) && minZ < -0.0001) {
        robot.position.z -= minZ;
        console.log(`[RobotModel] Offset robot Z by ${-minZ} to remove negative Z parts`);
    }
}
