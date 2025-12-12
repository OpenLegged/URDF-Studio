import * as React from 'react';
import * as THREE from 'three';
import type { ThreeElement } from "../three-types.js";
import { ComputeFunction, EventManager } from "./events.js";
import { Root } from "./reconciler.js";
import { Dpr, Frameloop, Performance, Renderer, RootState, RootStore, Size } from "./store.js";
import { type Properties, Camera } from "./utils.js";
interface OffscreenCanvas extends EventTarget {
}
export declare const _roots: Map<HTMLCanvasElement | OffscreenCanvas, Root>;
export type DefaultGLProps = Omit<THREE.WebGLRendererParameters, 'canvas'> & {
    canvas: HTMLCanvasElement | OffscreenCanvas;
};
export type GLProps = Renderer | ((defaultProps: DefaultGLProps) => Renderer) | ((defaultProps: DefaultGLProps) => Promise<Renderer>) | Partial<Properties<THREE.WebGLRenderer> | THREE.WebGLRendererParameters>;
export type CameraProps = (Camera | Partial<ThreeElement<typeof THREE.Camera> & ThreeElement<typeof THREE.PerspectiveCamera> & ThreeElement<typeof THREE.OrthographicCamera>>) & {
    /** Flags the camera as manual, putting projection into your own hands */
    manual?: boolean;
};
export interface RenderProps<TCanvas extends HTMLCanvasElement | OffscreenCanvas> {
    /** A threejs renderer instance or props that go into the default renderer */
    gl?: GLProps;
    /** Dimensions to fit the renderer to. Will measure canvas dimensions if omitted */
    size?: Size;
    /**
     * Enables shadows (by default PCFsoft). Can accept `gl.shadowMap` options for fine-tuning,
     * but also strings: 'basic' | 'percentage' | 'soft' | 'variance'.
     * @see https://threejs.org/docs/#api/en/renderers/WebGLRenderer.shadowMap
     */
    shadows?: boolean | 'basic' | 'percentage' | 'soft' | 'variance' | Partial<THREE.WebGLShadowMap>;
    /**
     * Disables three r139 color management.
     * @see https://threejs.org/docs/#manual/en/introduction/Color-management
     */
    legacy?: boolean;
    /** Switch off automatic sRGB encoding and gamma correction */
    linear?: boolean;
    /** Use `THREE.NoToneMapping` instead of `THREE.ACESFilmicToneMapping` */
    flat?: boolean;
    /** Creates an orthographic camera */
    orthographic?: boolean;
    /**
     * R3F's render mode. Set to `demand` to only render on state change or `never` to take control.
     * @see https://docs.pmnd.rs/react-three-fiber/advanced/scaling-performance#on-demand-rendering
     */
    frameloop?: Frameloop;
    /**
     * R3F performance options for adaptive performance.
     * @see https://docs.pmnd.rs/react-three-fiber/advanced/scaling-performance#movement-regression
     */
    performance?: Partial<Omit<Performance, 'regress'>>;
    /** Target pixel ratio. Can clamp between a range: `[min, max]` */
    dpr?: Dpr;
    /** Props that go into the default raycaster */
    raycaster?: Partial<THREE.Raycaster>;
    /** A `THREE.Scene` instance or props that go into the default scene */
    scene?: THREE.Scene | Partial<THREE.Scene>;
    /** A `THREE.Camera` instance or props that go into the default camera */
    camera?: CameraProps;
    /** An R3F event manager to manage elements' pointer events */
    events?: (store: RootStore) => EventManager<HTMLElement>;
    /** Callback after the canvas has rendered (but not yet committed) */
    onCreated?: (state: RootState) => void;
    /** Response for pointer clicks that have missed any target */
    onPointerMissed?: (event: MouseEvent) => void;
}
export interface ReconcilerRoot<TCanvas extends HTMLCanvasElement | OffscreenCanvas> {
    configure: (config?: RenderProps<TCanvas>) => Promise<ReconcilerRoot<TCanvas>>;
    render: (element: React.ReactNode) => RootStore;
    unmount: () => void;
}
export declare function createRoot<TCanvas extends HTMLCanvasElement | OffscreenCanvas>(canvas: TCanvas): ReconcilerRoot<TCanvas>;
export declare function unmountComponentAtNode<TCanvas extends HTMLCanvasElement | OffscreenCanvas>(canvas: TCanvas, callback?: (canvas: TCanvas) => void): void;
export type InjectState = Partial<Omit<RootState, 'events'> & {
    events?: {
        enabled?: boolean;
        priority?: number;
        compute?: ComputeFunction;
        connected?: any;
    };
}>;
export declare function createPortal(children: React.ReactNode, container: THREE.Object3D, state?: InjectState): React.JSX.Element;
/**
 * Force React to flush any updates inside the provided callback synchronously and immediately.
 * All the same caveats documented for react-dom's `flushSync` apply here (see https://react.dev/reference/react-dom/flushSync).
 * Nevertheless, sometimes one needs to render synchronously, for example to keep DOM and 3D changes in lock-step without
 * having to revert to a non-React solution. Note: this will only flush updates within the `Canvas` root.
 */
export declare function flushSync<R>(fn: () => R): R;
export {};
