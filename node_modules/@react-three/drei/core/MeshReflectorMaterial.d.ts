import { ThreeElements, ThreeElement } from '@react-three/fiber';
import { MeshReflectorMaterial as MeshReflectorMaterialImpl } from '../materials/MeshReflectorMaterial';
import { ForwardRefComponent } from '../helpers/ts-utils';
declare module '@react-three/fiber' {
    interface ThreeElements {
        meshReflectorMaterialImpl: ThreeElement<typeof MeshReflectorMaterialImpl>;
    }
}
export type MeshReflectorMaterialProps = ThreeElements['meshReflectorMaterialImpl'] & {
    resolution?: number;
    blur?: [number, number] | number;
    reflectorOffset?: number;
};
export declare const MeshReflectorMaterial: ForwardRefComponent<MeshReflectorMaterialProps, MeshReflectorMaterialImpl>;
