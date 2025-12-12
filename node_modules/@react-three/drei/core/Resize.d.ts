import * as THREE from 'three';
import * as React from 'react';
import { ThreeElements } from '@react-three/fiber';
export type ResizeProps = Omit<ThreeElements['group'], 'ref'> & {
    width?: boolean;
    height?: boolean;
    depth?: boolean;
    box3?: THREE.Box3;
    precise?: boolean;
};
export declare const Resize: React.ForwardRefExoticComponent<Omit<import("@react-three/fiber/dist/declarations/src/core/utils").Mutable<import("@react-three/fiber/dist/declarations/src/core/utils").Overwrite<Partial<import("@react-three/fiber/dist/declarations/src/core/utils").Overwrite<THREE.Group<THREE.Object3DEventMap>, import("@react-three/fiber").MathProps<THREE.Group<THREE.Object3DEventMap>> & import("@react-three/fiber").ReactProps<THREE.Group<THREE.Object3DEventMap>> & Partial<import("@react-three/fiber").EventHandlers>>>, Omit<import("@react-three/fiber").InstanceProps<THREE.Group<THREE.Object3DEventMap>, typeof THREE.Group>, "object">>>, "ref"> & {
    width?: boolean;
    height?: boolean;
    depth?: boolean;
    box3?: THREE.Box3;
    precise?: boolean;
} & React.RefAttributes<THREE.Group<THREE.Object3DEventMap>>>;
