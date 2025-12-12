import * as React from 'react';
import * as THREE from 'three';
import { ThreeElements } from '@react-three/fiber';
export type SelectProps = Omit<ThreeElements['group'], 'ref'> & {
    multiple?: boolean;
    box?: boolean;
    border?: string;
    backgroundColor?: string;
    onChange?: (selected: THREE.Object3D[]) => void;
    onChangePointerUp?: (selected: THREE.Object3D[]) => void;
    filter?: (selected: THREE.Object3D[]) => THREE.Object3D[];
};
export declare function Select({ box, multiple, children, onChange, onChangePointerUp, border, backgroundColor, filter: customFilter, ...props }: SelectProps): React.JSX.Element;
export declare function useSelect(): THREE.Object3D[];
