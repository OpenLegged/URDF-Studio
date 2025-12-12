import * as THREE from 'three';
import * as React from 'react';
import { PerspectiveCamera as PerspectiveCameraImpl } from 'three';
import { ThreeElements } from '@react-three/fiber';
import { ForwardRefComponent } from '../helpers/ts-utils';
export type PerspectiveCameraProps = Omit<ThreeElements['perspectiveCamera'], 'ref' | 'children'> & {
    makeDefault?: boolean;
    manual?: boolean;
    children?: React.ReactNode | ((texture: THREE.Texture) => React.ReactNode);
    frames?: number;
    resolution?: number;
    envMap?: THREE.Texture;
};
export declare const PerspectiveCamera: ForwardRefComponent<PerspectiveCameraProps, PerspectiveCameraImpl>;
