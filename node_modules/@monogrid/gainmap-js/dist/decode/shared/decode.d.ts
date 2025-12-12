import { HalfFloatType, LinearSRGBColorSpace } from 'three';
import { Constructor, QuadRendererTextureOptions } from '../../core';
import { DecodeParametersWithRenderer } from './types';
/**
 * Configuration for decode function
 */
export interface DecodeConfig<TRenderer extends Constructor, TQuadRenderer, TMaterial> {
    renderer: TRenderer;
    createMaterial: (params: DecodeParametersWithRenderer<InstanceType<TRenderer>>) => TMaterial;
    createQuadRenderer: (params: {
        width: number;
        height: number;
        type: typeof HalfFloatType;
        colorSpace: typeof LinearSRGBColorSpace;
        material: TMaterial;
        renderer: InstanceType<TRenderer>;
        renderTargetOptions?: QuadRendererTextureOptions;
    }) => TQuadRenderer;
}
/**
 * Shared decode implementation factory
 * Creates a decode function that prepares a QuadRenderer with the given parameters
 */
export declare function createDecodeFunction<TRenderer extends Constructor, TQuadRenderer, TMaterial>(config: DecodeConfig<TRenderer, TQuadRenderer, TMaterial>): (params: DecodeParametersWithRenderer<InstanceType<TRenderer>>) => TQuadRenderer;
