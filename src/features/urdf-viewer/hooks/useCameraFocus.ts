import { useRef, useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export interface UseCameraFocusOptions {
    robot: THREE.Object3D | null;
    focusTarget: string | null | undefined;
    mode?: 'detail' | 'hardware';
}

export function useCameraFocus({
    robot,
    focusTarget,
    mode
}: UseCameraFocusOptions): void {
    const { camera, controls, invalidate } = useThree();

    const focusTargetRef = useRef<THREE.Vector3 | null>(null);
    const cameraTargetPosRef = useRef<THREE.Vector3 | null>(null);
    const isFocusingRef = useRef(false);

    // Handle focus target change
    useEffect(() => {
        if (!focusTarget || !robot) return;

        let targetObj: THREE.Object3D | undefined;

        if ((robot as any).links && (robot as any).links[focusTarget]) {
            targetObj = (robot as any).links[focusTarget];
        }
        else if ((robot as any).joints && (robot as any).joints[focusTarget]) {
            targetObj = (robot as any).joints[focusTarget];
        }
        else {
            targetObj = robot.getObjectByName(focusTarget);
        }

        if (targetObj) {
            const box = new THREE.Box3().setFromObject(targetObj);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            const distance = Math.max(maxDim * 2, 0.5);
            const direction = new THREE.Vector3().subVectors(camera.position, controls ? (controls as any).target : new THREE.Vector3(0, 0, 0)).normalize();

            if (direction.lengthSq() < 0.001) direction.set(1, 1, 1).normalize();

            const newPos = center.clone().add(direction.multiplyScalar(distance));

            focusTargetRef.current = center;
            cameraTargetPosRef.current = newPos;
            isFocusingRef.current = true;
            invalidate();
        }
    }, [focusTarget, robot, camera, controls, invalidate]);

    // Animate camera focus
    useFrame((state, delta) => {
        // Skip in hardware mode to improve performance
        if (mode === 'hardware') return;

        if (isFocusingRef.current && focusTargetRef.current && cameraTargetPosRef.current && controls) {
            const orbitControls = controls as any;
            const step = 5 * delta;

            orbitControls.target.lerp(focusTargetRef.current, step);
            camera.position.lerp(cameraTargetPosRef.current, step);
            orbitControls.update();
            invalidate();

            if (camera.position.distanceTo(cameraTargetPosRef.current) < 0.01 &&
                orbitControls.target.distanceTo(focusTargetRef.current) < 0.01) {
                isFocusingRef.current = false;
            }
        }
    });
}
