import * as THREE from 'three';
import { ReactThreeFiber, ThreeElements } from '@react-three/fiber';
import { ForwardRefComponent } from '../helpers/ts-utils';
declare module '@react-three/fiber' {
    interface ThreeElements {
        portalMaterialImpl: ThreeElements['shaderMaterial'] & {
            resolution: ReactThreeFiber.Vector2;
            blur: number;
            blend: number;
            size?: number;
            sdf?: THREE.Texture;
            map?: THREE.Texture;
        };
    }
}
export type PortalProps = Omit<ThreeElements['portalMaterialImpl'], 'ref' | 'blend'> & {
    blend?: number;
    blur?: number;
    resolution?: number;
    worldUnits?: boolean;
    eventPriority?: number;
    renderPriority?: number;
    events?: boolean;
};
export declare const MeshPortalMaterial: ForwardRefComponent<PortalProps, ThreeElements['portalMaterialImpl']>;
