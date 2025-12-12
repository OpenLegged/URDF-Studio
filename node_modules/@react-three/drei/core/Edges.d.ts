import * as THREE from 'three';
import { ThreeElement, type ThreeElements } from '@react-three/fiber';
import { LineSegmentsGeometry, LineMaterial, LineMaterialParameters, Line2 } from 'three-stdlib';
import { ForwardRefComponent } from '../helpers/ts-utils';
export type EdgesRef = THREE.Mesh<LineSegmentsGeometry, LineMaterial>;
export type EdgesProps = Partial<ThreeElements['mesh']> & {
    threshold?: number;
    lineWidth?: number;
} & Omit<LineMaterialParameters, 'vertexColors' | 'color'> & Omit<ThreeElement<typeof Line2>, 'args' | 'geometry'> & Omit<ThreeElement<typeof LineMaterial>, 'color' | 'vertexColors' | 'args'> & {
    geometry?: THREE.BufferGeometry;
    color?: THREE.ColorRepresentation;
};
export declare const Edges: ForwardRefComponent<EdgesProps, EdgesRef>;
