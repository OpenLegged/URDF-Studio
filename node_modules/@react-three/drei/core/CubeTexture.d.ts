import * as React from 'react';
import { CubeTexture as _CubeTexture, Texture } from 'three';
export type CubeTextureOptions = {
    path: string;
};
export declare function useCubeTexture(files: string[], { path }: CubeTextureOptions): _CubeTexture;
export declare namespace useCubeTexture {
    var preload: (files: string[], { path }: CubeTextureOptions) => void;
}
export type CubeTextureProps = CubeTextureOptions & {
    children?: (tex: Texture) => React.ReactNode;
    files: Parameters<typeof useCubeTexture>[0];
};
export declare function CubeTexture({ children, files, ...options }: CubeTextureProps): React.JSX.Element;
