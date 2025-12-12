import * as THREE from 'three';
import * as React from 'react';
import { ReactThreeFiber, ThreeElements } from '@react-three/fiber';
import { MeshRefractionMaterial as MeshRefractionMaterial_ } from '../materials/MeshRefractionMaterial';
declare module '@react-three/fiber' {
    interface ThreeElements {
        meshRefractionMaterial: typeof MeshRefractionMaterial_;
    }
}
export type MeshRefractionMaterialProps = ThreeElements['shaderMaterial'] & {
    envMap: THREE.CubeTexture | THREE.Texture;
    bounces?: number;
    ior?: number;
    fresnel?: number;
    aberrationStrength?: number;
    color?: ReactThreeFiber.Color;
    fastChroma?: boolean;
};
export declare function MeshRefractionMaterial({ aberrationStrength, fastChroma, envMap, ...props }: MeshRefractionMaterialProps): React.JSX.Element;
