import { IUniform, MeshStandardMaterial, MeshStandardMaterialParameters } from 'three';
import { ThreeElements } from '@react-three/fiber';
import { ForwardRefComponent } from '../helpers/ts-utils';
interface Uniform<T> {
    value: T;
}
declare class WobbleMaterialImpl extends MeshStandardMaterial {
    _time: Uniform<number>;
    _factor: Uniform<number>;
    constructor(parameters?: MeshStandardMaterialParameters);
    onBeforeCompile(shader: {
        vertexShader: string;
        uniforms: {
            [uniform: string]: IUniform;
        };
    }): void;
    get time(): number;
    set time(v: number);
    get factor(): number;
    set factor(v: number);
}
declare module '@react-three/fiber' {
    interface ThreeElements {
        wobbleMaterialImpl: ThreeElements['meshStandardMaterial'] & {
            time?: number;
            factor?: number;
            speed?: number;
        };
    }
}
export type WobbleMaterialProps = Omit<ThreeElements['meshStandardMaterial'], 'ref'> & {
    speed?: number;
    factor?: number;
};
export declare const MeshWobbleMaterial: ForwardRefComponent<WobbleMaterialProps, WobbleMaterialImpl>;
export {};
