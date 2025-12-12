import * as THREE from 'three';
import { ForwardRefComponent } from '../helpers/ts-utils';
import { ThreeElements } from '@react-three/fiber';
export type ScreenQuadProps = Omit<ThreeElements['mesh'], 'ref' | 'args'>;
export declare const ScreenQuad: ForwardRefComponent<ScreenQuadProps, THREE.Mesh>;
