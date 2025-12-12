import * as THREE from 'three';
import * as React from 'react';
import { ForwardRefComponent } from '../helpers/ts-utils';
import { ThreeElements } from '@react-three/fiber';
export type CloneProps = Omit<ThreeElements['group'], 'ref' | 'children'> & {
    object: THREE.Object3D | THREE.Object3D[];
    children?: React.ReactNode;
    deep?: boolean | 'materialsOnly' | 'geometriesOnly';
    keys?: string[];
    inject?: ThreeElements['mesh'] | React.ReactNode | ((object: THREE.Object3D) => React.ReactNode);
    castShadow?: boolean;
    receiveShadow?: boolean;
    isChild?: boolean;
};
export declare const Clone: ForwardRefComponent<CloneProps, THREE.Group>;
