import { Group } from 'three';
import { ThreeElements } from '@react-three/fiber';
import { ForwardRefComponent } from '../helpers/ts-utils';
export type ScreenSpaceProps = Omit<ThreeElements['group'], 'ref'> & {
    depth?: number;
};
export declare const ScreenSpace: ForwardRefComponent<ScreenSpaceProps, Group>;
