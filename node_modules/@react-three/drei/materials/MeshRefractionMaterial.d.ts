import * as THREE from 'three';
import { MeshBVHUniformStruct } from 'three-mesh-bvh';
export declare const MeshRefractionMaterial: import("@react-three/fiber").ConstructorRepresentation<THREE.ShaderMaterial & {
    envMap: null;
    bounces: number;
    ior: number;
    correctMips: true;
    aberrationStrength: number;
    fresnel: number;
    bvh: MeshBVHUniformStruct;
    color: THREE.Color;
    opacity: number;
    resolution: THREE.Vector2;
    viewMatrixInverse: THREE.Matrix4;
    projectionMatrixInverse: THREE.Matrix4;
}> & {
    key: string;
};
