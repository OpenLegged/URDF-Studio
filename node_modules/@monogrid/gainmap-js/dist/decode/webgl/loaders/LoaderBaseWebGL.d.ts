import { HalfFloatType, LoadingManager, type WebGLRenderer } from 'three';
import { QuadRenderer } from '../../../core/QuadRenderer';
import { type GainMapMetadata } from '../../../core/types';
import { LoaderBaseShared } from '../../shared';
import { GainMapDecoderMaterial } from '../materials/GainMapDecoderMaterial';
/**
 * Base class for WebGL loaders
 * @template TUrl - The type of URL used to load resources
 */
export declare abstract class LoaderBaseWebGL<TUrl = string> extends LoaderBaseShared<WebGLRenderer, QuadRenderer<typeof HalfFloatType, GainMapDecoderMaterial>, GainMapDecoderMaterial, TUrl> {
    constructor(renderer?: WebGLRenderer, manager?: LoadingManager);
    /**
     * @private
     * @param quadRenderer
     * @param metadata
     * @param sdrBuffer
     * @param gainMapBuffer
     */
    protected render(quadRenderer: QuadRenderer<typeof HalfFloatType, GainMapDecoderMaterial>, metadata: GainMapMetadata, sdrBuffer: ArrayBuffer, gainMapBuffer?: ArrayBuffer): Promise<void>;
}
