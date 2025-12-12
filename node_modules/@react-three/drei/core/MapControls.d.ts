import { ReactThreeFiber, ThreeElement } from '@react-three/fiber';
import * as THREE from 'three';
import { MapControls as MapControlsImpl } from 'three-stdlib';
import { ForwardRefComponent, Overwrite } from '../helpers/ts-utils';
export type MapControlsProps = Omit<Overwrite<ThreeElement<typeof MapControlsImpl>, {
    target?: ReactThreeFiber.Vector3;
    camera?: THREE.Camera;
    makeDefault?: boolean;
    onChange?: (e?: THREE.Event) => void;
    onStart?: (e?: THREE.Event) => void;
    onEnd?: (e?: THREE.Event) => void;
    domElement?: HTMLElement;
}>, 'ref' | 'args'>;
export declare const MapControls: ForwardRefComponent<MapControlsProps, MapControlsImpl>;
