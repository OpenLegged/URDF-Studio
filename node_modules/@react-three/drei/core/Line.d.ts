import { Color, ColorRepresentation } from 'three';
import { Vector2 as FiberVector2, Vector3 as FiberVector3, ThreeElement } from '@react-three/fiber';
import { LineMaterial, LineMaterialParameters, Line2, LineSegments2 } from 'three-stdlib';
import { ForwardRefComponent } from '../helpers/ts-utils';
export type LineProps = Omit<{
    points: ReadonlyArray<FiberVector2 | FiberVector3>;
    vertexColors?: ReadonlyArray<Color | [number, number, number] | [number, number, number, number]>;
    lineWidth?: number;
    segments?: boolean;
} & Omit<LineMaterialParameters, 'vertexColors' | 'color'> & Omit<ThreeElement<typeof Line2>, 'ref' | 'args'> & Omit<ThreeElement<typeof LineMaterial>, 'ref' | 'color' | 'vertexColors' | 'args'> & {
    color?: ColorRepresentation;
}, 'ref'>;
export declare const Line: ForwardRefComponent<LineProps, Line2 | LineSegments2>;
