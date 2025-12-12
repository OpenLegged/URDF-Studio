import { ReactThreeFiber, ThreeElement } from '@react-three/fiber';
import * as THREE from 'three';
import { TrackballControls as TrackballControlsImpl } from 'three-stdlib';
import { ForwardRefComponent, Overwrite } from '../helpers/ts-utils';
export type TrackballControlsProps = Omit<Overwrite<ThreeElement<typeof TrackballControlsImpl>, {
    target?: ReactThreeFiber.Vector3;
    camera?: THREE.Camera;
    domElement?: HTMLElement;
    regress?: boolean;
    makeDefault?: boolean;
    onChange?: (e?: THREE.Event) => void;
    onStart?: (e?: THREE.Event) => void;
    onEnd?: (e?: THREE.Event) => void;
}>, 'ref' | 'args'>;
export declare const TrackballControls: ForwardRefComponent<TrackballControlsProps, TrackballControlsImpl>;
