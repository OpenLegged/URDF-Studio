import { HalfFloatType, LinearSRGBColorSpace, Loader, LoadingManager, Texture } from 'three';
import { type GainMapMetadata, QuadRendererTextureOptions } from '../../core/types';
import { DecodeParameters } from './types';
/**
 * Configuration for the loader base class
 */
export interface LoaderBaseConfig<TRenderer, TQuadRenderer, TMaterial> {
    renderer?: TRenderer;
    renderTargetOptions?: QuadRendererTextureOptions;
    createMaterial: (params: DecodeParameters) => TMaterial;
    createQuadRenderer: (params: {
        width: number;
        height: number;
        type: typeof HalfFloatType;
        colorSpace: typeof LinearSRGBColorSpace;
        material: TMaterial;
        renderer?: TRenderer;
        renderTargetOptions?: QuadRendererTextureOptions;
    }) => TQuadRenderer;
}
/**
 * Shared base class for loaders that extracts common logic
 */
export declare abstract class LoaderBaseShared<TRenderer, TQuadRenderer, TMaterial, TUrl = string> extends Loader<TQuadRenderer, TUrl> {
    private _renderer?;
    private _renderTargetOptions?;
    protected _internalLoadingManager: LoadingManager;
    protected _config: LoaderBaseConfig<TRenderer, TQuadRenderer, TMaterial>;
    constructor(config: LoaderBaseConfig<TRenderer, TQuadRenderer, TMaterial>, manager?: LoadingManager);
    setRenderer(renderer: TRenderer): this;
    setRenderTargetOptions(options: QuadRendererTextureOptions): this;
    protected prepareQuadRenderer(): TQuadRenderer;
    protected processImages(sdrBuffer: ArrayBuffer, gainMapBuffer?: ArrayBuffer, imageOrientation?: 'flipY' | 'from-image'): Promise<{
        sdrImage: ImageBitmap | HTMLImageElement;
        gainMapImage: ImageBitmap | HTMLImageElement | undefined;
        needsFlip: boolean;
    }>;
    protected createTextures(sdrImage: ImageBitmap | HTMLImageElement, gainMapImage: ImageBitmap | HTMLImageElement | undefined, needsFlip: boolean): {
        gainMap: Texture;
        sdr: Texture;
    };
    protected updateQuadRenderer(quadRenderer: TQuadRenderer & {
        width: number;
        height: number;
        material: TMaterial & {
            gainMap: Texture;
            sdr: Texture;
            gainMapMin: [number, number, number];
            gainMapMax: [number, number, number];
            offsetHdr: [number, number, number];
            offsetSdr: [number, number, number];
            gamma: [number, number, number];
            hdrCapacityMin: number;
            hdrCapacityMax: number;
            maxDisplayBoost: number;
            needsUpdate: boolean;
        };
    }, sdrImage: ImageBitmap | HTMLImageElement, gainMap: Texture, sdr: Texture, metadata: GainMapMetadata): void;
}
