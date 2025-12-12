import * as THREE from 'three';
import * as React from 'react';
import { Instance } from "./reconciler.js";
import type { Fiber } from 'react-reconciler';
import type { Dpr, RootStore, Size } from "./store.js";
export type NonFunctionKeys<P> = {
    [K in keyof P]-?: P[K] extends Function ? never : K;
}[keyof P];
export type Overwrite<P, O> = Omit<P, NonFunctionKeys<O>> & O;
export type Properties<T> = Pick<T, NonFunctionKeys<T>>;
export type Mutable<P> = {
    [K in keyof P]: P[K] | Readonly<P[K]>;
};
export type IsOptional<T> = undefined extends T ? true : false;
export type IsAllOptional<T extends any[]> = T extends [infer First, ...infer Rest] ? IsOptional<First> extends true ? IsAllOptional<Rest> : false : true;
/**
 * Returns the instance's initial (outmost) root.
 */
export declare function findInitialRoot<T>(instance: Instance<T>): RootStore;
export type Act = <T = any>(cb: () => Promise<T>) => Promise<T>;
/**
 * Safely flush async effects when testing, simulating a legacy root.
 * @deprecated Import from React instead. import { act } from 'react'
 */
export declare const act: Act;
export type Camera = (THREE.OrthographicCamera | THREE.PerspectiveCamera) & {
    manual?: boolean;
};
export declare const isOrthographicCamera: (def: Camera) => def is THREE.OrthographicCamera;
export declare const isRef: (obj: any) => obj is React.RefObject<unknown>;
export declare const isColorRepresentation: (value: unknown) => value is THREE.ColorRepresentation;
/**
 * An SSR-friendly useLayoutEffect.
 *
 * React currently throws a warning when using useLayoutEffect on the server.
 * To get around it, we can conditionally useEffect on the server (no-op) and
 * useLayoutEffect elsewhere.
 *
 * @see https://github.com/facebook/react/issues/14927
 */
export declare const useIsomorphicLayoutEffect: typeof React.useLayoutEffect;
export declare function useMutableCallback<T>(fn: T): React.RefObject<T>;
export type Bridge = React.FC<{
    children?: React.ReactNode;
}>;
/**
 * Bridges renderer Context and StrictMode from a primary renderer.
 */
export declare function useBridge(): Bridge;
export type SetBlock = false | Promise<null> | null;
export type UnblockProps = {
    set: React.Dispatch<React.SetStateAction<SetBlock>>;
    children: React.ReactNode;
};
export declare function Block({ set }: Omit<UnblockProps, 'children'>): null;
export declare const ErrorBoundary: {
    new (props: {
        set: React.Dispatch<Error | undefined>;
        children: React.ReactNode;
    }): {
        state: {
            error: boolean;
        };
        componentDidCatch(err: Error): void;
        render(): React.ReactNode;
        context: unknown;
        setState<K extends "error">(state: {
            error: boolean;
        } | ((prevState: Readonly<{
            error: boolean;
        }>, props: Readonly<{
            set: React.Dispatch<Error | undefined>;
            children: React.ReactNode;
        }>) => {
            error: boolean;
        } | Pick<{
            error: boolean;
        }, K> | null) | Pick<{
            error: boolean;
        }, K> | null, callback?: (() => void) | undefined): void;
        forceUpdate(callback?: (() => void) | undefined): void;
        readonly props: Readonly<{
            set: React.Dispatch<Error | undefined>;
            children: React.ReactNode;
        }>;
        componentDidMount?(): void;
        shouldComponentUpdate?(nextProps: Readonly<{
            set: React.Dispatch<Error | undefined>;
            children: React.ReactNode;
        }>, nextState: Readonly<{
            error: boolean;
        }>): boolean;
        componentWillUnmount?(): void;
        getSnapshotBeforeUpdate?(prevProps: Readonly<{
            set: React.Dispatch<Error | undefined>;
            children: React.ReactNode;
        }>, prevState: Readonly<{
            error: boolean;
        }>): any;
        componentDidUpdate?(prevProps: Readonly<{
            set: React.Dispatch<Error | undefined>;
            children: React.ReactNode;
        }>, prevState: Readonly<{
            error: boolean;
        }>, snapshot?: any): void;
        componentWillMount?(): void;
        UNSAFE_componentWillMount?(): void;
        componentWillReceiveProps?(nextProps: Readonly<{
            set: React.Dispatch<Error | undefined>;
            children: React.ReactNode;
        }>): void;
        UNSAFE_componentWillReceiveProps?(nextProps: Readonly<{
            set: React.Dispatch<Error | undefined>;
            children: React.ReactNode;
        }>): void;
        componentWillUpdate?(nextProps: Readonly<{
            set: React.Dispatch<Error | undefined>;
            children: React.ReactNode;
        }>, nextState: Readonly<{
            error: boolean;
        }>): void;
        UNSAFE_componentWillUpdate?(nextProps: Readonly<{
            set: React.Dispatch<Error | undefined>;
            children: React.ReactNode;
        }>, nextState: Readonly<{
            error: boolean;
        }>): void;
    };
    getDerivedStateFromError: () => {
        error: boolean;
    };
    contextType?: React.Context<any> | undefined;
    propTypes?: any;
};
export interface ObjectMap {
    nodes: {
        [name: string]: THREE.Object3D;
    };
    materials: {
        [name: string]: THREE.Material;
    };
    meshes: {
        [name: string]: THREE.Mesh;
    };
}
export declare function calculateDpr(dpr: Dpr): number;
/**
 * Returns instance root state
 */
export declare function getRootState<T extends THREE.Object3D = THREE.Object3D>(obj: T): import("./store.js").RootState | undefined;
export interface EquConfig {
    /** Compare arrays by reference equality a === b (default), or by shallow equality */
    arrays?: 'reference' | 'shallow';
    /** Compare objects by reference equality a === b (default), or by shallow equality */
    objects?: 'reference' | 'shallow';
    /** If true the keys in both a and b must match 1:1 (default), if false a's keys must intersect b's */
    strict?: boolean;
}
export declare const is: {
    obj: (a: any) => boolean;
    fun: (a: any) => a is Function;
    str: (a: any) => a is string;
    num: (a: any) => a is number;
    boo: (a: any) => a is boolean;
    und: (a: any) => boolean;
    nul: (a: any) => boolean;
    arr: (a: any) => boolean;
    equ(a: any, b: any, { arrays, objects, strict }?: EquConfig): boolean;
};
export declare function buildGraph(object: THREE.Object3D): ObjectMap;
export interface Disposable {
    type?: string;
    dispose?: () => void;
}
export declare function dispose<T extends Disposable>(obj: T): void;
export declare const REACT_INTERNAL_PROPS: string[];
export declare function getInstanceProps<T = any>(queue: Fiber['pendingProps']): Instance<T>['props'];
export declare function prepare<T = any>(target: T, root: RootStore, type: string, props: Instance<T>['props']): Instance<T>;
export declare function resolve(root: any, key: string): {
    root: any;
    key: string;
    target: any;
};
export declare function attach(parent: Instance, child: Instance): void;
export declare function detach(parent: Instance, child: Instance): void;
export declare const RESERVED_PROPS: string[];
export declare function diffProps<T = any>(instance: Instance<T>, newProps: Instance<T>['props']): Instance<T>['props'];
export declare function applyProps<T = any>(object: Instance<T>['object'], props: Instance<T>['props']): Instance<T>['object'];
export declare function invalidateInstance(instance: Instance): void;
export declare function updateCamera(camera: Camera, size: Size): void;
export declare const isObject3D: (object: any) => object is THREE.Object3D<THREE.Object3DEventMap>;
