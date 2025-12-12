import * as THREE from 'three';
import { type ConstructorRepresentation } from '@react-three/fiber';
import { type MeshBVHUniformStruct } from 'three-mesh-bvh';
type UniformValue = THREE.Texture | THREE.TypedArray | THREE.Matrix4 | THREE.Matrix3 | THREE.Quaternion | THREE.Vector4 | THREE.Vector3 | THREE.Vector2 | THREE.Color | MeshBVHUniformStruct | number | boolean | null;
type Uniforms = Record<string, UniformValue | Record<string, UniformValue> | Array<UniformValue>>;
export declare function shaderMaterial<U extends Uniforms, M extends THREE.ShaderMaterial & U>(uniforms: U, vertexShader: string, fragmentShader: string, onInit?: (material?: M) => void): ConstructorRepresentation<M> & {
    key: string;
};
export {};
