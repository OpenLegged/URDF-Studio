import { Texture } from 'three';
import { GainMapMetadata, QuadRendererTextureOptions, TextureImageFormat } from '../../core';
/**
 * Parameters related to the display used for decoding
 */
export type GainmapDecodingParameters = {
    /**
     * The maximum available boost supported by a display, at a given point in time.
     *
     * @remarks
     * This value can change over time based on device settings and other factors,
     * such as ambient light conditions, or how many bright pixels are on the screen.
     *
     * Non Logarithmic space
     */
    maxDisplayBoost: number;
};
/**
 * Parameters for generic decoding
 */
export type DecodeParameters = {
    /**
     * A Texture containing the SDR Rendition
     */
    sdr: Texture<TextureImageFormat>;
    /**
     * A Texture containing the GainMap recovery image
     */
    gainMap: Texture<TextureImageFormat>;
} & GainmapDecodingParameters & GainMapMetadata;
/**
 * Parameters for decode function
 */
export type DecodeParametersWithRenderer<TRenderer> = {
    /**
     * The renderer used to decode the GainMap
     */
    renderer: TRenderer;
    /**
     * Options to use when creating the output renderTarget
     */
    renderTargetOptions?: QuadRendererTextureOptions;
} & DecodeParameters & GainmapDecodingParameters & GainMapMetadata;
