import { ThreeElement } from '@react-three/fiber';
import * as THREE from 'three';
import { DeviceOrientationControls as DeviceOrientationControlsImp } from 'three-stdlib';
import { ForwardRefComponent } from '../helpers/ts-utils';
export type DeviceOrientationControlsProps = Omit<ThreeElement<typeof DeviceOrientationControlsImp>, 'ref' | 'args'> & {
    camera?: THREE.Camera;
    onChange?: (e?: THREE.Event) => void;
    makeDefault?: boolean;
};
export declare const DeviceOrientationControls: ForwardRefComponent<DeviceOrientationControlsProps, DeviceOrientationControlsImp>;
