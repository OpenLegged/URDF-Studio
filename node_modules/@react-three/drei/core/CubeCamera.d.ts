import * as THREE from 'three';
import { Fog, FogExp2, Texture } from 'three';
import * as React from 'react';
import { ThreeElements } from '@react-three/fiber';
export type CubeCameraOptions = {
    resolution?: number;
    near?: number;
    far?: number;
    envMap?: THREE.Texture;
    fog?: Fog | FogExp2;
};
export declare function useCubeCamera({ resolution, near, far, envMap, fog }?: CubeCameraOptions): {
    fbo: THREE.WebGLCubeRenderTarget;
    camera: THREE.CubeCamera;
    update: () => void;
};
export type CubeCameraProps = Omit<ThreeElements['group'], 'children'> & {
    children?: (tex: Texture) => React.ReactNode;
    frames?: number;
} & CubeCameraOptions;
export declare function CubeCamera({ children, frames, resolution, near, far, envMap, fog, ...props }: CubeCameraProps): React.JSX.Element;
