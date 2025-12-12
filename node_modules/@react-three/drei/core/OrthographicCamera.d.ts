import * as THREE from 'three';
import * as React from 'react';
import { OrthographicCamera as OrthographicCameraImpl } from 'three';
import { ThreeElements } from '@react-three/fiber';
import { ForwardRefComponent } from '../helpers/ts-utils';
export type OrthographicCameraProps = Omit<ThreeElements['orthographicCamera'], 'ref' | 'children'> & {
    makeDefault?: boolean;
    manual?: boolean;
    children?: React.ReactNode | ((texture: THREE.Texture) => React.ReactNode);
    frames?: number;
    resolution?: number;
    envMap?: THREE.Texture;
};
export declare const OrthographicCamera: ForwardRefComponent<OrthographicCameraProps, OrthographicCameraImpl>;
