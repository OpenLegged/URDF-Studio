import * as THREE from 'three';
import { ThreeElement, ThreeElements } from '@react-three/fiber';
import { ForwardRefComponent } from '../helpers/ts-utils';
declare class SparklesImplMaterial extends THREE.ShaderMaterial {
    constructor();
    get time(): number;
    set time(value: number);
    get pixelRatio(): number;
    set pixelRatio(value: number);
}
declare module '@react-three/fiber' {
    interface ThreeElements {
        sparklesImplMaterial: ThreeElement<typeof SparklesImplMaterial>;
    }
}
export type SparklesProps = Omit<ThreeElements['points'], 'ref'> & {
    count?: number;
    speed?: number | Float32Array;
    opacity?: number | Float32Array;
    color?: THREE.ColorRepresentation | Float32Array;
    size?: number | Float32Array;
    scale?: number | [number, number, number] | THREE.Vector3;
    noise?: number | [number, number, number] | THREE.Vector3 | Float32Array;
};
export declare const Sparkles: ForwardRefComponent<SparklesProps, THREE.Points>;
export {};
