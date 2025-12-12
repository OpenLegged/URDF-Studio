import * as React from 'react';
import { LOD, Object3D } from 'three';
import { ThreeElements } from '@react-three/fiber';
import { ForwardRefComponent } from '../helpers/ts-utils';
export type DetailedProps = Omit<ThreeElements['lOD'], 'ref'> & {
    children: React.ReactElement<Object3D>[];
    hysteresis?: number;
    distances: number[];
};
export declare const Detailed: ForwardRefComponent<DetailedProps, LOD>;
