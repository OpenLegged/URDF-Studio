import { ThreeElements } from '@react-three/fiber';
import { Object3D } from 'three';
import { ForwardRefComponent } from '../helpers/ts-utils';
export type ScreenSizerProps = Omit<ThreeElements['object3D'], 'ref'> & {
    scale?: number;
};
export declare const ScreenSizer: ForwardRefComponent<ScreenSizerProps, Object3D>;
