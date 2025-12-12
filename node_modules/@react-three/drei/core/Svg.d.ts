import { ThreeElements } from '@react-three/fiber';
import { Object3D } from 'three';
import { ForwardRefComponent } from '../helpers/ts-utils';
export interface SvgProps extends Omit<ThreeElements['object3D'], 'ref'> {
    src: string;
    skipFill?: boolean;
    skipStrokes?: boolean;
    fillMaterial?: ThreeElements['meshBasicMaterial'];
    strokeMaterial?: ThreeElements['meshBasicMaterial'];
    fillMeshProps?: ThreeElements['mesh'];
    strokeMeshProps?: ThreeElements['mesh'];
}
export declare const Svg: ForwardRefComponent<SvgProps, Object3D>;
