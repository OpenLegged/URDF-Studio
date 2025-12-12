import { Texture, Loader, CubeTexture, ColorSpace } from 'three';
import { PresetsType } from '../helpers/environment-assets';
export type EnvironmentLoaderProps = {
    files?: string | string[];
    path?: string;
    preset?: PresetsType;
    extensions?: (loader: Loader) => void;
    colorSpace?: ColorSpace;
};
export declare function useEnvironment({ files, path, preset, colorSpace, extensions, }?: Partial<EnvironmentLoaderProps>): Texture | CubeTexture;
export declare namespace useEnvironment {
    var preload: (preloadOptions?: EnvironmentLoaderPreloadOptions) => void;
    var clear: (clearOptions?: EnvironmentLoaderClearOptions) => void;
}
type EnvironmentLoaderPreloadOptions = Omit<EnvironmentLoaderProps, 'encoding'>;
type EnvironmentLoaderClearOptions = Pick<EnvironmentLoaderProps, 'files' | 'preset'>;
export {};
