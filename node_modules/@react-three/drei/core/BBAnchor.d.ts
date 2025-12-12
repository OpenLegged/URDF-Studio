import * as React from 'react';
import * as THREE from 'three';
import { ThreeElements } from '@react-three/fiber';
export type BBAnchorProps = ThreeElements['group'] & {
    anchor: THREE.Vector3 | [number, number, number];
};
export declare const BBAnchor: ({ anchor, ...props }: BBAnchorProps) => React.JSX.Element;
