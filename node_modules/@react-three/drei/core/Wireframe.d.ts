import * as React from 'react';
import * as THREE from 'three';
import { ThreeElement } from '@react-three/fiber';
import { WireframeMaterial, WireframeMaterialProps } from '../materials/WireframeMaterial';
declare module '@react-three/fiber' {
    interface ThreeElements {
        meshWireframeMaterial: ThreeElement<typeof WireframeMaterial>;
    }
}
interface WireframeProps {
    geometry?: THREE.BufferGeometry | React.RefObject<THREE.BufferGeometry>;
    simplify?: boolean;
}
export declare function Wireframe({ geometry: customGeometry, ...props }: WireframeProps & WireframeMaterialProps): React.JSX.Element;
export {};
