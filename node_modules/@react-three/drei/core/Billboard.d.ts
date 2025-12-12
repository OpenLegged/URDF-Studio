import { Group } from 'three';
import { ThreeElements } from '@react-three/fiber';
import { ForwardRefComponent } from '../helpers/ts-utils';
export type BillboardProps = Omit<ThreeElements['group'], 'ref'> & {
    follow?: boolean;
    lockX?: boolean;
    lockY?: boolean;
    lockZ?: boolean;
};
export declare const Billboard: ForwardRefComponent<BillboardProps, Group>;
