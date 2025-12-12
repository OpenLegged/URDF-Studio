import * as React from 'react';
import * as THREE from 'three';
import { ThreeElements } from '@react-three/fiber';
import { Flow } from 'three-stdlib';
import { ForwardRefComponent } from '../helpers/ts-utils';
export interface CurveModifierProps {
    children: React.ReactElement<ThreeElements['mesh']>;
    curve?: THREE.Curve<THREE.Vector3>;
}
export type CurveModifierRef = Flow;
export declare const CurveModifier: ForwardRefComponent<CurveModifierProps, CurveModifierRef>;
