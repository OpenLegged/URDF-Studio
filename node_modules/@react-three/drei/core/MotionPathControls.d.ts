import * as THREE from 'three';
import * as React from 'react';
import { ThreeElements } from '@react-three/fiber';
export type MotionPathProps = ThreeElements['group'] & {
    curves?: THREE.Curve<THREE.Vector3>[];
    debug?: boolean;
    debugColor?: THREE.ColorRepresentation;
    object?: React.RefObject<THREE.Object3D>;
    focus?: [x: number, y: number, z: number] | React.RefObject<THREE.Object3D>;
    loop?: boolean;
    offset?: number;
    smooth?: boolean | number;
    eps?: number;
    damping?: number;
    focusDamping?: number;
    maxSpeed?: number;
};
type MotionState = {
    current: number;
    path: THREE.CurvePath<THREE.Vector3>;
    focus: React.RefObject<THREE.Object3D> | [x: number, y: number, z: number] | undefined;
    object: React.RefObject<THREE.Object3D>;
    offset: number;
    point: THREE.Vector3;
    tangent: THREE.Vector3;
    next: THREE.Vector3;
};
export type MotionPathRef = THREE.Group & {
    motion: MotionState;
};
export declare function useMotion(): MotionState;
export declare const MotionPathControls: React.ForwardRefExoticComponent<Omit<MotionPathProps, "ref"> & React.RefAttributes<MotionPathRef>>;
export {};
