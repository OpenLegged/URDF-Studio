import { Line2 } from 'three-stdlib';
import { LineProps } from './Line';
import { ForwardRefComponent } from '../helpers/ts-utils';
export type CatmullRomLineProps = Omit<LineProps, 'ref' | 'segments'> & {
    closed?: boolean;
    curveType?: 'centripetal' | 'chordal' | 'catmullrom';
    tension?: number;
    segments?: number;
};
export declare const CatmullRomLine: ForwardRefComponent<CatmullRomLineProps, Line2>;
