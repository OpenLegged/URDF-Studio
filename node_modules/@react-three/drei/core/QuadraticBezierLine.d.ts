import { Vector3 } from 'three';
import { Line2 } from 'three-stdlib';
import { LineProps } from './Line';
import { ForwardRefComponent } from '../helpers/ts-utils';
export type QuadraticBezierLineRef = Line2 & {
    setPoints(start: Vector3 | [number, number, number], end: Vector3 | [number, number, number], mid: Vector3 | [number, number, number]): void;
};
export type QuadraticBezierLineProps = Omit<LineProps, 'points' | 'ref'> & {
    start: Vector3 | [number, number, number];
    end: Vector3 | [number, number, number];
    mid?: Vector3 | [number, number, number];
    segments?: number;
};
export declare const QuadraticBezierLine: ForwardRefComponent<QuadraticBezierLineProps, QuadraticBezierLineRef>;
