import * as THREE from 'three';
import { ThreeElements } from '@react-three/fiber';
import { ForwardRefComponent } from '../helpers/ts-utils';
export type GridMaterialType = {
    cellSize?: number;
    cellThickness?: number;
    cellColor?: THREE.ColorRepresentation;
    sectionSize?: number;
    sectionThickness?: number;
    sectionColor?: THREE.ColorRepresentation;
    followCamera?: boolean;
    infiniteGrid?: boolean;
    fadeDistance?: number;
    fadeStrength?: number;
    fadeFrom?: number;
    side?: THREE.Side;
};
export type GridProps = Omit<ThreeElements['mesh'], 'ref' | 'args'> & GridMaterialType & {
    args?: ConstructorParameters<typeof THREE.PlaneGeometry>;
};
declare module '@react-three/fiber' {
    interface ThreeElements {
        gridMaterial: ThreeElements['shaderMaterial'] & GridMaterialType;
    }
}
export declare const Grid: ForwardRefComponent<GridProps, THREE.Mesh>;
