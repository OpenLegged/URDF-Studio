import * as THREE from 'three';
import { ForwardRefComponent } from '../helpers/ts-utils';
import { ThreeElements } from '@react-three/fiber';
export declare class PointMaterialImpl extends THREE.PointsMaterial {
    constructor(props: any);
}
export type PointMaterialProps = Omit<ThreeElements['pointsMaterial'], 'ref'>;
export declare const PointMaterial: ForwardRefComponent<PointMaterialProps, PointMaterialImpl>;
