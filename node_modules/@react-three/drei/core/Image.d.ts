import * as THREE from 'three';
import { Color, ThreeElements } from '@react-three/fiber';
import { ForwardRefComponent } from '../helpers/ts-utils';
export type ImageProps = Omit<ThreeElements['mesh'], 'scale'> & {
    segments?: number;
    scale?: number | [number, number];
    color?: Color;
    zoom?: number;
    radius?: number;
    grayscale?: number;
    toneMapped?: boolean;
    transparent?: boolean;
    opacity?: number;
    side?: THREE.Side;
} & ({
    texture: THREE.Texture;
    url?: never;
} | {
    texture?: never;
    url: string;
});
type ImageMaterialType = ThreeElements['shaderMaterial'] & {
    scale?: number[];
    imageBounds?: number[];
    radius?: number;
    resolution?: number;
    color?: Color;
    map: THREE.Texture;
    zoom?: number;
    grayscale?: number;
};
declare module '@react-three/fiber' {
    interface ThreeElements {
        imageMaterial: ImageMaterialType;
    }
}
export declare const Image: ForwardRefComponent<ImageProps, THREE.Mesh>;
export {};
