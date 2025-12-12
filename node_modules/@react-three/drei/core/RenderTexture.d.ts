import * as THREE from 'three';
import * as React from 'react';
import { ThreeElements } from '@react-three/fiber';
import { ForwardRefComponent } from '../helpers/ts-utils';
export type RenderTextureProps = Omit<ThreeElements['texture'], 'ref' | 'args'> & {
    width?: number;
    height?: number;
    samples?: number;
    stencilBuffer?: boolean;
    depthBuffer?: boolean;
    generateMipmaps?: boolean;
    renderPriority?: number;
    eventPriority?: number;
    frames?: number;
    compute?: (event: any, state: any, previous: any) => false | undefined;
    children: React.ReactNode;
};
export declare const RenderTexture: ForwardRefComponent<RenderTextureProps, THREE.Texture>;
