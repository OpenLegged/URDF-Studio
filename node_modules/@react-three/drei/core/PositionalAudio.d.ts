import { PositionalAudio as PositionalAudioImpl } from 'three';
import { ThreeElements } from '@react-three/fiber';
import { ForwardRefComponent } from '../helpers/ts-utils';
export type PositionalAudioProps = Omit<ThreeElements['positionalAudio'], 'ref' | 'args'> & {
    url: string;
    distance?: number;
    loop?: boolean;
};
export declare const PositionalAudio: ForwardRefComponent<PositionalAudioProps, PositionalAudioImpl>;
