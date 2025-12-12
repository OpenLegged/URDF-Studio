import * as THREE from 'three';
import { ThreeElements } from '@react-three/fiber';
import { ForwardRefComponent } from '../helpers/ts-utils';
type MeshTransmissionMaterialType = Omit<ThreeElements['meshPhysicalMaterial'], 'args' | 'roughness' | 'thickness' | 'transmission'> & {
    transmission?: number;
    thickness?: number;
    roughness?: number;
    chromaticAberration?: number;
    anisotropy?: number;
    anisotropicBlur?: number;
    distortion?: number;
    distortionScale?: number;
    temporalDistortion?: number;
    buffer?: THREE.Texture;
    time?: number;
    args?: [samples: number, transmissionSampler: boolean];
};
export type MeshTransmissionMaterialProps = Omit<MeshTransmissionMaterialType, 'ref' | 'args'> & {
    transmissionSampler?: boolean;
    backside?: boolean;
    backsideThickness?: number;
    backsideEnvMapIntensity?: number;
    resolution?: number;
    backsideResolution?: number;
    samples?: number;
    background?: THREE.Texture | THREE.Color;
};
declare module '@react-three/fiber' {
    interface ThreeElements {
        meshTransmissionMaterial: MeshTransmissionMaterialType;
    }
}
export declare const MeshTransmissionMaterial: ForwardRefComponent<MeshTransmissionMaterialProps, ThreeElements['meshTransmissionMaterial']>;
export {};
