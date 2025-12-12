import { EventDispatcher, OrthographicCamera, PerspectiveCamera } from 'three';
import { ThreeElement } from '@react-three/fiber';
import CameraControlsImpl from 'camera-controls';
import { ForwardRefComponent, Overwrite } from '../helpers/ts-utils';
export type CameraControlsProps = Omit<Overwrite<ThreeElement<typeof CameraControlsImpl>, {
    impl?: typeof CameraControlsImpl;
    camera?: PerspectiveCamera | OrthographicCamera;
    domElement?: HTMLElement;
    makeDefault?: boolean;
    onControlStart?: (e?: {
        type: 'controlstart';
    }) => void;
    onControl?: (e?: {
        type: 'control';
    }) => void;
    onControlEnd?: (e?: {
        type: 'controlend';
    }) => void;
    onTransitionStart?: (e?: {
        type: 'transitionstart';
    }) => void;
    onUpdate?: (e?: {
        type: 'update';
    }) => void;
    onWake?: (e?: {
        type: 'wake';
    }) => void;
    onRest?: (e?: {
        type: 'rest';
    }) => void;
    onSleep?: (e?: {
        type: 'sleep';
    }) => void;
    onStart?: (e?: {
        type: 'controlstart';
    }) => void;
    onEnd?: (e?: {
        type: 'controlend';
    }) => void;
    onChange?: (e?: {
        type: string;
    }) => void;
    events?: boolean;
    regress?: boolean;
}>, 'ref' | 'args' | keyof EventDispatcher>;
export declare const CameraControls: ForwardRefComponent<CameraControlsProps, CameraControlsImpl>;
export type CameraControls = CameraControlsImpl;
export { CameraControlsImpl };
