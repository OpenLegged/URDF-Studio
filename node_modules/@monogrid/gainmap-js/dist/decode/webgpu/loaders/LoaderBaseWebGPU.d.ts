import { HalfFloatType, LoadingManager, WebGPURenderer } from 'three/webgpu';
import { type GainMapMetadata } from '../../../core/types';
import { LoaderBaseShared } from '../../shared';
import { QuadRenderer } from '../core/QuadRenderer';
import { GainMapDecoderMaterial } from '../materials/GainMapDecoderMaterial';
/**
 * Base class for WebGPU loaders
 * @template TUrl - The type of URL used to load resources
 */
export declare abstract class LoaderBaseWebGPU<TUrl = string> extends LoaderBaseShared<WebGPURenderer, QuadRenderer<typeof HalfFloatType, GainMapDecoderMaterial>, GainMapDecoderMaterial, TUrl> {
    constructor(renderer?: WebGPURenderer, manager?: LoadingManager);
    /**
     * @private
     * @param quadRenderer
     * @param metadata
     * @param sdrBuffer
     * @param gainMapBuffer
     */
    protected render(quadRenderer: QuadRenderer<typeof HalfFloatType, GainMapDecoderMaterial>, metadata: GainMapMetadata, sdrBuffer: ArrayBuffer, gainMapBuffer?: ArrayBuffer): Promise<void>;
}
