import { ShaderMaterial } from 'three';
import { ThreeElements } from '@react-three/fiber';
import { ForwardRefComponent } from '../helpers/ts-utils';
declare module '@react-three/fiber' {
    interface ThreeElements {
        discardMaterialImpl: ThreeElements['shaderMaterial'];
    }
}
export type MeshDiscardMaterialProps = Omit<ThreeElements['shaderMaterial'], 'ref'>;
export declare const MeshDiscardMaterial: ForwardRefComponent<MeshDiscardMaterialProps, ShaderMaterial>;
