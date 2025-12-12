import * as React from 'react';
import { Euler, ThreeElement } from '@react-three/fiber';
import { Texture, Scene } from 'three';
import { GroundProjectedEnv as GroundProjectedEnvImpl } from 'three-stdlib';
import { PresetsType } from '../helpers/environment-assets';
import { EnvironmentLoaderProps } from './useEnvironment';
export type EnvironmentProps = {
    children?: React.ReactNode;
    frames?: number;
    near?: number;
    far?: number;
    resolution?: number;
    background?: boolean | 'only';
    blur?: number;
    backgroundBlurriness?: number;
    backgroundIntensity?: number;
    backgroundRotation?: Euler;
    environmentIntensity?: number;
    environmentRotation?: Euler;
    map?: Texture;
    preset?: PresetsType;
    scene?: Scene | React.RefObject<Scene>;
    ground?: boolean | {
        radius?: number;
        height?: number;
        scale?: number;
    };
} & EnvironmentLoaderProps;
export declare function EnvironmentMap({ scene, background, map, ...config }: EnvironmentProps): null;
export declare function EnvironmentCube({ background, scene, blur, backgroundBlurriness, backgroundIntensity, backgroundRotation, environmentIntensity, environmentRotation, ...rest }: EnvironmentProps): null;
export declare function EnvironmentPortal({ children, near, far, resolution, frames, map, background, blur, backgroundBlurriness, backgroundIntensity, backgroundRotation, environmentIntensity, environmentRotation, scene, files, path, preset, extensions, }: EnvironmentProps): React.JSX.Element;
declare module '@react-three/fiber' {
    interface ThreeElements {
        groundProjectedEnvImpl: ThreeElement<typeof GroundProjectedEnvImpl>;
    }
}
export declare function Environment(props: EnvironmentProps): React.JSX.Element;
