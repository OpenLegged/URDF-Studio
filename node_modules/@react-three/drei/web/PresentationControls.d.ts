import * as React from 'react';
export type PresentationControlProps = {
    snap?: Boolean | number;
    global?: boolean;
    cursor?: boolean;
    speed?: number;
    zoom?: number;
    rotation?: [number, number, number];
    polar?: [number, number];
    azimuth?: [number, number];
    damping?: number;
    enabled?: boolean;
    children?: React.ReactNode;
    domElement?: HTMLElement;
};
export declare function PresentationControls({ enabled, snap, global, domElement, cursor, children, speed, rotation, zoom, polar, azimuth, damping, }: PresentationControlProps): React.JSX.Element;
