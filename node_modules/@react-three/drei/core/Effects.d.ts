import { TextureDataType, ColorSpace } from 'three';
import { ThreeElement, ThreeElements } from '@react-three/fiber';
import { EffectComposer, RenderPass, ShaderPass } from 'three-stdlib';
import { ForwardRefComponent } from '../helpers/ts-utils';
export type EffectsProps = Omit<ThreeElements['effectComposer'], 'ref' | 'args'> & {
    multisamping?: number;
    colorSpace?: ColorSpace;
    type?: TextureDataType;
    renderIndex?: number;
    disableGamma?: boolean;
    disableRenderPass?: boolean;
    disableRender?: boolean;
    depthBuffer?: boolean;
    stencilBuffer?: boolean;
    anisotropy?: number;
};
declare module '@react-three/fiber' {
    interface ThreeElements {
        effectComposer: ThreeElement<typeof EffectComposer>;
        renderPass: ThreeElement<typeof RenderPass>;
        shaderPass: ThreeElement<typeof ShaderPass>;
    }
}
export declare const isWebGL2Available: () => boolean;
export declare const Effects: ForwardRefComponent<EffectsProps, EffectComposer>;
