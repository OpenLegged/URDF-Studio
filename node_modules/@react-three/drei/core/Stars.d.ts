import { ThreeElement } from '@react-three/fiber';
import { Points, ShaderMaterial } from 'three';
import { ForwardRefComponent } from '../helpers/ts-utils';
export type StarsProps = {
    radius?: number;
    depth?: number;
    count?: number;
    factor?: number;
    saturation?: number;
    fade?: boolean;
    speed?: number;
};
declare class StarfieldMaterial extends ShaderMaterial {
    constructor();
}
declare module '@react-three/fiber' {
    interface ThreeElements {
        starfieldMaterial: ThreeElement<typeof StarfieldMaterial>;
    }
}
export declare const Stars: ForwardRefComponent<StarsProps, Points>;
export {};
