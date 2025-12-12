import * as React from 'react';
import * as THREE from 'three';
type CanvasSize = {
    top: number;
    left: number;
    height: number;
    width: number;
};
export type ContainerProps = {
    visible: boolean;
    scene: THREE.Scene;
    index: number;
    children?: React.ReactNode;
    frames: number;
    rect: React.RefObject<DOMRect>;
    track?: React.RefObject<HTMLElement>;
    canvasSize: CanvasSize;
};
export type ViewProps = {
    as?: string;
    id?: string;
    className?: string;
    style?: React.CSSProperties;
    visible?: boolean;
    index?: number;
    frames?: number;
    children?: React.ReactNode;
    track?: React.RefObject<HTMLElement>;
};
export type ViewportProps = {
    Port: () => React.JSX.Element;
} & React.ForwardRefExoticComponent<ViewProps & React.RefAttributes<HTMLElement | THREE.Group>>;
export declare const View: ViewportProps;
export {};
