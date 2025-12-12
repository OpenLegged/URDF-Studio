import * as React from 'react';
import { ThreeElements } from '@react-three/fiber';
import * as THREE from 'three';
export declare enum GradientType {
    Linear = "linear",
    Radial = "radial"
}
export type GradientTextureProps = {
    stops: Array<number>;
    colors: Array<THREE.ColorRepresentation>;
    attach?: string;
    size?: number;
    width?: number;
    type?: GradientType;
    innerCircleRadius?: number;
    outerCircleRadius?: string | number;
} & Omit<ThreeElements['texture'], 'args' | 'type'>;
export declare function GradientTexture({ stops, colors, size, width, type, innerCircleRadius, outerCircleRadius, ...props }: GradientTextureProps): React.JSX.Element;
