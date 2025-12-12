import { ReactThreeFiber, ThreeElement } from '@react-three/fiber';
import { ArcballControls as ArcballControlsImpl } from 'three-stdlib';
import type { Event, OrthographicCamera, PerspectiveCamera } from 'three';
import { ForwardRefComponent, Overwrite } from '../helpers/ts-utils';
export type ArcballControlsProps = Omit<Overwrite<ThreeElement<typeof ArcballControlsImpl>, {
    target?: ReactThreeFiber.Vector3;
    camera?: OrthographicCamera | PerspectiveCamera;
    domElement?: HTMLElement;
    regress?: boolean;
    makeDefault?: boolean;
    onChange?: (e?: Event) => void;
    onStart?: (e?: Event) => void;
    onEnd?: (e?: Event) => void;
}>, 'ref' | 'args'>;
export declare const ArcballControls: ForwardRefComponent<ArcballControlsProps, ArcballControlsImpl>;
