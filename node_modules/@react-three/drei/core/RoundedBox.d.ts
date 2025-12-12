import { Mesh, ExtrudeGeometry } from 'three';
import { ForwardRefComponent, NamedArrayTuple } from '../helpers/ts-utils';
import { ThreeElements } from '@react-three/fiber';
export type RoundedBoxProps = {
    args?: NamedArrayTuple<(width?: number, height?: number, depth?: number) => void>;
    radius?: number;
    smoothness?: number;
    bevelSegments?: number;
    steps?: number;
    creaseAngle?: number;
} & Omit<ThreeElements['mesh'], 'ref' | 'args'>;
export type RoundedBoxGeometryProps = Omit<RoundedBoxProps, 'children'> & Omit<ThreeElements['extrudeGeometry'], 'args' | 'ref'>;
export declare const RoundedBox: ForwardRefComponent<RoundedBoxProps, Mesh>;
export declare const RoundedBoxGeometry: ForwardRefComponent<RoundedBoxGeometryProps, ExtrudeGeometry>;
