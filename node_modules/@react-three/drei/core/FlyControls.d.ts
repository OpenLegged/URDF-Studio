import { ThreeElement } from '@react-three/fiber';
import * as THREE from 'three';
import { FlyControls as FlyControlsImpl } from 'three-stdlib';
import { ForwardRefComponent } from '../helpers/ts-utils';
export type FlyControlsProps = Omit<ThreeElement<typeof FlyControlsImpl>, 'ref' | 'args'> & {
    onChange?: (e?: THREE.Event) => void;
    domElement?: HTMLElement;
    makeDefault?: boolean;
};
export declare const FlyControls: ForwardRefComponent<FlyControlsProps, FlyControlsImpl>;
