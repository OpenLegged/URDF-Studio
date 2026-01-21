import React, { useRef, useState, useMemo, useEffect, useCallback } from 'react';
import { useThree } from '@react-three/fiber';
import { TransformControls } from '@react-three/drei';
import * as THREE from 'three';
import { JointInteractionProps } from './types';

// ============================================================
// PERFORMANCE: Module-level pooled objects to eliminate GC pressure
// ============================================================
const _pooledVec3 = new THREE.Vector3();
const _pooledQuat = new THREE.Quaternion();
const _pooledQuatAlign = new THREE.Quaternion();
const _pooledQuatRot = new THREE.Quaternion();
const _pooledQuatZero = new THREE.Quaternion();
const _pooledQuatDelta = new THREE.Quaternion();
const _pooledAlignVec = new THREE.Vector3();

export const JointInteraction: React.FC<JointInteractionProps> = ({ joint, value, onChange, onCommit }) => {
    const transformRef = useRef<any>(null);
    const dummyRef = useRef<THREE.Object3D>(new THREE.Object3D());
    const lastRotation = useRef<number>(value);
    const isDragging = useRef(false);
    const [, forceUpdate] = useState(0);
    const { invalidate } = useThree();

    if (!joint) return null;

    // PERFORMANCE: Store axis in ref to avoid recreating Vector3
    const axisNormalizedRef = useRef(new THREE.Vector3(1, 0, 0));
    
    // Get joint axis - ensure it's a proper Vector3 (writes to ref, no allocation)
    useMemo(() => {
        const axis = joint.axis;
        if (axis instanceof THREE.Vector3) {
            axisNormalizedRef.current.copy(axis).normalize();
        } else if (axis && typeof axis.x === 'number') {
            axisNormalizedRef.current.set(axis.x, axis.y, axis.z).normalize();
        } else {
            axisNormalizedRef.current.set(1, 0, 0);
        }
    }, [joint]);
    
    const axisNormalized = axisNormalizedRef.current;

    // Determine which rotation mode to use based on axis
    const rotationAxis = useMemo((): 'X' | 'Y' | 'Z' => {
        const absX = Math.abs(axisNormalized.x);
        const absY = Math.abs(axisNormalized.y);
        const absZ = Math.abs(axisNormalized.z);
        if (absX >= absY && absX >= absZ) return 'X';
        if (absY >= absX && absY >= absZ) return 'Y';
        return 'Z';
    }, [axisNormalized]);

    // Function to update dummy position and orientation (uses pooled objects)
    const updateDummyTransform = useCallback(() => {
        if (dummyRef.current && joint) {
            try {
                // Copy world position from joint
                joint.getWorldPosition(dummyRef.current.position);

                // Only update orientation if NOT dragging to prevent fighting with controls
                if (!isDragging.current) {
                    // Get parent's world quaternion (so gizmo doesn't spin with joint rotation)
                    const parent = joint.parent;
                    if (parent) {
                        parent.getWorldQuaternion(dummyRef.current.quaternion);
                    } else {
                        joint.getWorldQuaternion(dummyRef.current.quaternion);
                    }

                    // Align the gizmo with the joint axis (use pooled vector)
                    _pooledAlignVec.set(1, 0, 0); // Default X
                    if (rotationAxis === 'Y') _pooledAlignVec.set(0, 1, 0);
                    if (rotationAxis === 'Z') _pooledAlignVec.set(0, 0, 1);

                    // Use pooled quaternions
                    _pooledQuatAlign.setFromUnitVectors(_pooledAlignVec, axisNormalized);
                    dummyRef.current.quaternion.multiply(_pooledQuatAlign);

                    // Apply the current joint angle rotation (use pooled quaternion)
                    _pooledQuatRot.setFromAxisAngle(_pooledAlignVec, value);
                    dummyRef.current.quaternion.multiply(_pooledQuatRot);
                }
            } catch (e) {
                // Prevent crash on math error
            }
        }
    }, [joint, rotationAxis, axisNormalized, value]);

    // Force update on mount to ensure TransformControls has the dummy object
    useEffect(() => {
        forceUpdate(n => n + 1);
    }, []);

    // Update dummy transform when value or joint changes (instead of useFrame)
    useEffect(() => {
        updateDummyTransform();
        invalidate();
    }, [updateDummyTransform, invalidate]);
    
    const handleChange = useCallback(() => {
        if (!dummyRef.current || !isDragging.current) return;
        
        try {
            // Calculate the angle from the current quaternion relative to the zero-angle frame
            // Use pooled quaternion for parent
            const parent = joint.parent;
            if (parent) {
                parent.getWorldQuaternion(_pooledQuat);
            } else {
                joint.getWorldQuaternion(_pooledQuat);
            }

            // Re-calculate alignment (same as in updateDummyTransform) - use pooled vector
            _pooledAlignVec.set(1, 0, 0); 
            if (rotationAxis === 'Y') _pooledAlignVec.set(0, 1, 0);
            if (rotationAxis === 'Z') _pooledAlignVec.set(0, 0, 1);
            
            _pooledQuatAlign.setFromUnitVectors(_pooledAlignVec, axisNormalized);
            
            // Q_zero = Q_parent * Q_align (use pooled zeroQuat)
            _pooledQuatZero.copy(_pooledQuat).multiply(_pooledQuatAlign);
            
            // Q_delta = Q_zero^-1 * Q_current (use pooled deltaQuat)
            _pooledQuatDelta.copy(_pooledQuatZero).invert().multiply(dummyRef.current.quaternion);
            
            // Extract angle from deltaQuat
            // 2 * atan2(q.component, q.w) gives the angle
            let newValue = 0;
            if (rotationAxis === 'X') newValue = 2 * Math.atan2(_pooledQuatDelta.x, _pooledQuatDelta.w);
            else if (rotationAxis === 'Y') newValue = 2 * Math.atan2(_pooledQuatDelta.y, _pooledQuatDelta.w);
            else newValue = 2 * Math.atan2(_pooledQuatDelta.z, _pooledQuatDelta.w);
            
            // Apply limits for revolute joints
            const limit = joint.limit || { lower: -Math.PI, upper: Math.PI };
            if (joint.jointType === 'revolute') {
                newValue = Math.max(limit.lower, Math.min(limit.upper, newValue));
            }
            
            if (Math.abs(newValue - lastRotation.current) > 0.001) {
                lastRotation.current = newValue;
                onChange(newValue);
            }
        } catch (e) {
            console.error("Error in JointInteraction handleChange:", e);
        }
    }, [joint, onChange, rotationAxis, axisNormalized]);
    
    // Reset lastRotation when value changes externally
    useEffect(() => {
        lastRotation.current = value;
    }, [value]);

    return (
        <>
            <primitive object={dummyRef.current} />
            <TransformControls
                ref={transformRef}
                object={dummyRef.current}
                mode="rotate"
                showX={rotationAxis === 'X'}
                showY={rotationAxis === 'Y'}
                showZ={rotationAxis === 'Z'}
                size={1.2}
                space="local"
                onMouseDown={() => { isDragging.current = true; }}
                onMouseUp={() => { isDragging.current = false; if (onCommit) onCommit(lastRotation.current); }}
                onObjectChange={handleChange}
            />
        </>
    );
};
