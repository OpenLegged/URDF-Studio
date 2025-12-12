import * as THREE from 'three';
import { Color } from 'three';
import { MarchingCubes as MarchingCubesImpl } from 'three-stdlib';
import { ThreeElements } from '@react-three/fiber';
import { ForwardRefComponent } from '../helpers/ts-utils';
export type MarchingCubesProps = {
    resolution?: number;
    maxPolyCount?: number;
    enableUvs?: boolean;
    enableColors?: boolean;
} & Omit<ThreeElements['group'], 'ref'>;
export declare const MarchingCubes: ForwardRefComponent<MarchingCubesProps, MarchingCubesImpl>;
export type MarchingCubeProps = {
    strength?: number;
    subtract?: number;
    color?: Color;
} & ThreeElements['group'];
export declare const MarchingCube: ForwardRefComponent<MarchingCubeProps, THREE.Group>;
export type MarchingPlaneProps = {
    planeType?: 'x' | 'y' | 'z';
    strength?: number;
    subtract?: number;
} & ThreeElements['group'];
export declare const MarchingPlane: ForwardRefComponent<MarchingPlaneProps, THREE.Group>;
