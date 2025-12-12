import * as React from 'react';
import * as THREE from 'three';
import { ThreeElement, ThreeElements } from '@react-three/fiber';
import { TextGeometry, TextGeometryParameters } from 'three-stdlib';
import { FontData } from './useFont';
import { ForwardRefComponent } from '../helpers/ts-utils';
declare module '@react-three/fiber' {
    interface ThreeElements {
        renamedTextGeometry: ThreeElement<typeof TextGeometry>;
    }
}
export type Text3DProps = Omit<ThreeElements['mesh'], 'ref'> & {
    font: FontData | string;
    bevelSegments?: number;
    smooth?: number;
} & Omit<TextGeometryParameters, 'font'>;
export declare const Text3D: ForwardRefComponent<React.PropsWithChildren<Text3DProps & {
    letterSpacing?: number;
    lineHeight?: number;
}>, THREE.Mesh>;
