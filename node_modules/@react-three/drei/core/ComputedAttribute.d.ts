import { ThreeElements } from '@react-three/fiber';
import * as React from 'react';
import { BufferAttribute, BufferGeometry } from 'three';
export type ComputedAttributeProps = Omit<ThreeElements['bufferAttribute'], 'args'> & {
    compute: (geometry: BufferGeometry) => BufferAttribute;
    name: string;
};
export declare const ComputedAttribute: ({ compute, name, ...props }: ComputedAttributeProps) => React.JSX.Element;
