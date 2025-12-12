import * as THREE from 'three';
import { ForwardRefComponent } from '../helpers/ts-utils';
import { ThreeElements } from '@react-three/fiber';
export type MaskProps = Omit<ThreeElements['mesh'], 'ref' | 'id'> & {
    id: number;
    colorWrite?: boolean;
    depthWrite?: boolean;
};
export declare const Mask: ForwardRefComponent<MaskProps, THREE.Mesh>;
export declare function useMask(id: number, inverse?: boolean): {
    stencilWrite: boolean;
    stencilRef: number;
    stencilFunc: 514 | 517;
    stencilFail: 7680;
    stencilZFail: 7680;
    stencilZPass: 7680;
};
