import * as THREE from 'three';
import * as React from 'react';
import { ReactThreeFiber, ThreeElements, ThreeElement } from '@react-three/fiber';
import { Line2, LineMaterialParameters } from 'three-stdlib';
import { ForwardRefComponent } from '../helpers/ts-utils';
export type SegmentsProps = LineMaterialParameters & {
    limit?: number;
    lineWidth?: number;
    children: React.ReactNode;
};
export type SegmentProps = Omit<ThreeElements['segmentObject'], 'ref' | 'start' | 'end' | 'color'> & {
    start: ReactThreeFiber.Vector3;
    end: ReactThreeFiber.Vector3;
    color?: ReactThreeFiber.Color;
};
declare const Segments: ForwardRefComponent<SegmentsProps, Line2>;
declare module '@react-three/fiber' {
    interface ThreeElements {
        segmentObject: ThreeElement<typeof SegmentObject>;
    }
}
export declare class SegmentObject {
    color: THREE.Color;
    start: THREE.Vector3;
    end: THREE.Vector3;
    constructor();
}
declare const Segment: ForwardRefComponent<SegmentProps, SegmentObject>;
export { Segments, Segment };
