import * as React from 'react';
import { Object3D, AnimationClip, AnimationAction, AnimationMixer } from 'three';
type Api<T extends AnimationClip> = {
    ref: React.RefObject<Object3D | undefined | null>;
    clips: AnimationClip[];
    mixer: AnimationMixer;
    names: T['name'][];
    actions: {
        [key in T['name']]: AnimationAction | null;
    };
};
export declare function useAnimations<T extends AnimationClip>(clips: T[], root?: React.RefObject<Object3D | undefined | null> | Object3D): Api<T>;
export {};
