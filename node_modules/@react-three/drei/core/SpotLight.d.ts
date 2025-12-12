import * as React from 'react';
import { DepthTexture, SpotLight as SpotLightImpl, Texture } from 'three';
import { ThreeElements } from '@react-three/fiber';
import { ForwardRefComponent } from '../helpers/ts-utils';
export type SpotLightProps = Omit<ThreeElements['spotLight'], 'ref'> & {
    depthBuffer?: DepthTexture;
    attenuation?: number;
    anglePower?: number;
    radiusTop?: number;
    radiusBottom?: number;
    opacity?: number;
    color?: string | number;
    volumetric?: boolean;
    debug?: boolean;
};
interface ShadowMeshProps {
    distance?: number;
    alphaTest?: number;
    scale?: number;
    map?: Texture;
    shader?: string;
    width?: number;
    height?: number;
}
export declare function SpotLightShadow(props: React.PropsWithChildren<ShadowMeshProps>): React.JSX.Element;
declare const SpotLight: ForwardRefComponent<React.PropsWithChildren<SpotLightProps>, SpotLightImpl>;
export { SpotLight };
