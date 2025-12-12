import { IUniform, MeshPhysicalMaterial, MeshPhysicalMaterialParameters } from 'three';
import { ThreeElements } from '@react-three/fiber';
import { ForwardRefComponent } from '../helpers/ts-utils';
interface Uniform<T> {
    value: T;
}
declare class DistortMaterialImpl extends MeshPhysicalMaterial {
    _time: Uniform<number>;
    _distort: Uniform<number>;
    _radius: Uniform<number>;
    constructor(parameters?: MeshPhysicalMaterialParameters);
    onBeforeCompile(shader: {
        vertexShader: string;
        uniforms: {
            [uniform: string]: IUniform;
        };
    }): void;
    get time(): number;
    set time(v: number);
    get distort(): number;
    set distort(v: number);
    get radius(): number;
    set radius(v: number);
}
declare module '@react-three/fiber' {
    interface ThreeElements {
        distortMaterialImpl: ThreeElements['meshPhysicalMaterial'] & {
            time?: number;
            distort?: number;
            radius?: number;
        };
    }
}
export type MeshDistortMaterialProps = Omit<ThreeElements['distortMaterialImpl'], 'ref'> & {
    speed?: number;
    factor?: number;
};
export declare const MeshDistortMaterial: ForwardRefComponent<MeshDistortMaterialProps, DistortMaterialImpl>;
export {};
