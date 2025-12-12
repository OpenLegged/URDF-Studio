import { ReactThreeFiber, ThreeElements } from '@react-three/fiber';
import * as THREE from 'three';
import { ForwardRefComponent } from '../helpers/ts-utils';
export type LightProps = Omit<ThreeElements['mesh'], 'ref'> & {
    args?: any[];
    map?: THREE.Texture;
    toneMapped?: boolean;
    color?: ReactThreeFiber.Color;
    form?: 'circle' | 'ring' | 'rect' | 'plane' | 'box' | any;
    scale?: number | [number, number, number] | [number, number];
    intensity?: number;
    target?: boolean | [number, number, number] | THREE.Vector3;
    light?: Partial<ThreeElements['pointLight']>;
};
export declare const Lightformer: ForwardRefComponent<LightProps, THREE.Mesh>;
