import * as THREE from 'three';
import * as React from 'react';
import Reconciler from 'react-reconciler';
import { IsAllOptional } from "./utils.js";
import type { RootStore } from "./store.js";
import { type EventHandlers } from "./events.js";
import type { ThreeElement } from "../three-types.js";
export interface Root {
    fiber: Reconciler.FiberRoot;
    store: RootStore;
}
export type AttachFnType<O = any> = (parent: any, self: O) => () => void;
export type AttachType<O = any> = string | AttachFnType<O>;
export type ConstructorRepresentation<T = any> = new (...args: any[]) => T;
export interface Catalogue {
    [name: string]: ConstructorRepresentation;
}
export type Args<T> = T extends ConstructorRepresentation ? T extends typeof THREE.Color ? [r: number, g: number, b: number] | [color: THREE.ColorRepresentation] : ConstructorParameters<T> : any[];
type ArgsProp<P> = P extends ConstructorRepresentation ? IsAllOptional<ConstructorParameters<P>> extends true ? {
    args?: Args<P>;
} : {
    args: Args<P>;
} : {
    args: unknown[];
};
export type InstanceProps<T = any, P = any> = ArgsProp<P> & {
    object?: T;
    dispose?: null;
    attach?: AttachType<T>;
    onUpdate?: (self: T) => void;
};
export interface Instance<O = any> {
    root: RootStore;
    type: string;
    parent: Instance | null;
    children: Instance[];
    props: InstanceProps<O> & Record<string, unknown>;
    object: O & {
        __r3f?: Instance<O>;
    };
    eventCount: number;
    handlers: Partial<EventHandlers>;
    attach?: AttachType<O>;
    previousAttach?: any;
    isHidden: boolean;
}
export declare function extend<T extends ConstructorRepresentation>(objects: T): React.ExoticComponent<ThreeElement<T>>;
export declare function extend<T extends Catalogue>(objects: T): void;
export declare const reconciler: Reconciler.Reconciler<RootStore, Instance<any>, void, Instance<any>, never, any>;
export {};
