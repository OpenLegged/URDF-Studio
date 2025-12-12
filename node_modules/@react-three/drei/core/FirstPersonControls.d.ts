import { ThreeElement } from '@react-three/fiber';
import { FirstPersonControls as FirstPersonControlImpl } from 'three-stdlib';
import { ForwardRefComponent } from '../helpers/ts-utils';
export type FirstPersonControlsProps = Omit<ThreeElement<typeof FirstPersonControlImpl>, 'ref' | 'args'> & {
    domElement?: HTMLElement;
    makeDefault?: boolean;
};
export declare const FirstPersonControls: ForwardRefComponent<FirstPersonControlsProps, FirstPersonControlImpl>;
