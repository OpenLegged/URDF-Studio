import * as React from 'react';
import { ThreeElements } from '@react-three/fiber';
import * as THREE from 'three';
import { ForwardRefComponent } from '../helpers/ts-utils';
export type FloatProps = Omit<ThreeElements['group'], 'ref'> & {
    enabled?: boolean;
    speed?: number;
    rotationIntensity?: number;
    floatIntensity?: number;
    children?: React.ReactNode;
    floatingRange?: [number?, number?];
    autoInvalidate?: boolean;
};
export declare const Float: ForwardRefComponent<FloatProps, THREE.Group>;
