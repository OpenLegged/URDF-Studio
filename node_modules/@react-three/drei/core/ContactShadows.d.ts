import * as THREE from 'three';
import { ThreeElements } from '@react-three/fiber';
import { ForwardRefComponent } from '../helpers/ts-utils';
export type ContactShadowsProps = Omit<ThreeElements['group'], 'ref' | 'scale'> & {
    opacity?: number;
    width?: number;
    height?: number;
    blur?: number;
    near?: number;
    far?: number;
    smooth?: boolean;
    resolution?: number;
    frames?: number;
    scale?: number | [x: number, y: number];
    color?: THREE.ColorRepresentation;
    depthWrite?: boolean;
};
export declare const ContactShadows: ForwardRefComponent<ContactShadowsProps, THREE.Group>;
