import * as React from 'react';
import { ThreeElements } from '@react-three/fiber';
export type FisheyeProps = ThreeElements['mesh'] & {
    zoom?: number;
    segments?: number;
    resolution?: number;
    children: React.ReactNode;
    renderPriority?: number;
};
export declare function Fisheye({ renderPriority, zoom, segments, children, resolution, ...props }: FisheyeProps): React.JSX.Element;
