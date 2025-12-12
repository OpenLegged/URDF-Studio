import * as THREE from 'three';
import * as React from 'react';
import { ThreeElement, ThreeElements } from '@react-three/fiber';
import { ForwardRefComponent } from '../helpers/ts-utils';
declare module '@react-three/fiber' {
    interface ThreeElements {
        positionPoint: ThreeElement<typeof PositionPoint>;
    }
}
export type PointsInstancesProps = Omit<ThreeElements['points'], 'ref'> & {
    range?: number;
    limit?: number;
};
export declare class PositionPoint extends THREE.Group {
    size: number;
    color: THREE.Color;
    instance: React.RefObject<THREE.Points | undefined>;
    instanceKey: React.RefObject<PositionPoint | undefined>;
    constructor();
    get geometry(): THREE.BufferGeometry<THREE.NormalBufferAttributes> | undefined;
    raycast(raycaster: THREE.Raycaster, intersects: THREE.Intersection[]): void;
}
export declare const Point: ForwardRefComponent<ThreeElements['positionPoint'], PositionPoint>;
export type PointsBuffersProps = ThreeElements['points'] & {
    positions: Float32Array;
    colors?: Float32Array;
    sizes?: Float32Array;
    stride?: 2 | 3;
};
export declare const PointsBuffer: ForwardRefComponent<PointsBuffersProps, THREE.Points>;
export declare const Points: ForwardRefComponent<PointsBuffersProps | PointsInstancesProps, THREE.Points>;
