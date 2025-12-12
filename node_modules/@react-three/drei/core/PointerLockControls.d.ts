import { ThreeElement } from '@react-three/fiber';
import * as THREE from 'three';
import { PointerLockControls as PointerLockControlsImpl } from 'three-stdlib';
import { ForwardRefComponent } from '../helpers/ts-utils';
export type PointerLockControlsProps = Omit<ThreeElement<typeof PointerLockControlsImpl>, 'ref' | 'args'> & {
    domElement?: HTMLElement;
    selector?: string;
    enabled?: boolean;
    camera?: THREE.Camera;
    onChange?: (e?: THREE.Event) => void;
    onLock?: (e?: THREE.Event) => void;
    onUnlock?: (e?: THREE.Event) => void;
    makeDefault?: boolean;
};
export declare const PointerLockControls: ForwardRefComponent<PointerLockControlsProps, PointerLockControlsImpl>;
