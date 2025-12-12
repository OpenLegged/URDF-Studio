import { ThreeElements } from '@react-three/fiber';
import * as React from 'react';
export type MultiMaterialProps = Omit<ThreeElements['group'], 'ref'>;
export declare function MultiMaterial(props: MultiMaterialProps): React.JSX.Element;
