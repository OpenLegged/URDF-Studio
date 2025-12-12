import { Mesh, Color, type PlaneGeometry, type MeshBasicMaterial } from 'three';
import { ForwardRefComponent } from '../helpers/ts-utils';
import { ThreeElements } from '@react-three/fiber';
export type ShadowProps = Omit<ThreeElements['mesh'], 'ref'> & {
    colorStop?: number;
    fog?: boolean;
    color?: Color | number | string;
    opacity?: number;
    depthWrite?: boolean;
};
export type ShadowType = Mesh<PlaneGeometry, MeshBasicMaterial>;
export declare const Shadow: ForwardRefComponent<ShadowProps, ShadowType>;
