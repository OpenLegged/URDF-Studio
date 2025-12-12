import * as THREE from 'three';
import * as React from 'react';
import { ThreeElement, ThreeElements } from '@react-three/fiber';
import { ForwardRefComponent } from '../helpers/ts-utils';
declare module '@react-three/fiber' {
    interface ThreeElements {
        positionMesh: ThreeElement<typeof PositionMesh>;
    }
}
type Api = {
    getParent: () => React.RefObject<InstancedMesh>;
    subscribe: <T>(ref: React.RefObject<T>) => void;
};
export type InstancesProps = Omit<ThreeElements['instancedMesh'], 'ref' | 'args'> & {
    context?: React.Context<Api>;
    range?: number;
    limit?: number;
    frames?: number;
};
export type InstanceProps = Omit<ThreeElements['positionMesh'], 'ref'> & {
    context?: React.Context<Api>;
};
export type InstancedAttributeProps = Omit<ThreeElements['instancedBufferAttribute'], 'ref' | 'args'> & {
    name: string;
    defaultValue: any;
    normalized?: boolean;
    usage?: number;
};
type InstancedMesh = Omit<THREE.InstancedMesh, 'instanceMatrix' | 'instanceColor'> & {
    instanceMatrix: THREE.InstancedBufferAttribute;
    instanceColor: THREE.InstancedBufferAttribute;
};
export declare class PositionMesh extends THREE.Group {
    color: THREE.Color;
    instance: React.RefObject<THREE.InstancedMesh | undefined>;
    instanceKey: React.RefObject<PositionMesh | undefined>;
    constructor();
    get geometry(): THREE.BufferGeometry<THREE.NormalBufferAttributes> | undefined;
    raycast(raycaster: THREE.Raycaster, intersects: THREE.Intersection[]): void;
}
export declare const Instance: React.ForwardRefExoticComponent<Omit<import("@react-three/fiber/dist/declarations/src/core/utils").Mutable<import("@react-three/fiber/dist/declarations/src/core/utils").Overwrite<Partial<import("@react-three/fiber/dist/declarations/src/core/utils").Overwrite<PositionMesh, import("@react-three/fiber").MathProps<PositionMesh> & import("@react-three/fiber").ReactProps<PositionMesh> & Partial<import("@react-three/fiber").EventHandlers>>>, Omit<import("@react-three/fiber").InstanceProps<PositionMesh, typeof PositionMesh>, "object">>>, "ref"> & {
    context?: React.Context<Api>;
} & React.RefAttributes<unknown>>;
export declare const Instances: ForwardRefComponent<InstancesProps, THREE.InstancedMesh>;
export interface MergedProps extends Omit<InstancesProps, 'children'> {
    meshes: THREE.Mesh[] | Record<string, THREE.Object3D>;
    children: (...instances: [React.FC<InstanceProps> & Record<string, React.FC<InstanceProps>>, ...React.FC<InstanceProps>[]]) => React.ReactNode;
}
export declare const Merged: ForwardRefComponent<MergedProps, THREE.Group>;
export declare function createInstances<T = InstanceProps>(): readonly [React.ForwardRefExoticComponent<Omit<import("@react-three/fiber/dist/declarations/src/core/utils").Mutable<import("@react-three/fiber/dist/declarations/src/core/utils").Overwrite<Partial<import("@react-three/fiber/dist/declarations/src/core/utils").Overwrite<THREE.InstancedMesh<THREE.BufferGeometry<THREE.NormalBufferAttributes>, THREE.Material | THREE.Material[]>, import("@react-three/fiber").MathProps<THREE.InstancedMesh<THREE.BufferGeometry<THREE.NormalBufferAttributes>, THREE.Material | THREE.Material[]>> & import("@react-three/fiber").ReactProps<THREE.InstancedMesh<THREE.BufferGeometry<THREE.NormalBufferAttributes>, THREE.Material | THREE.Material[]>> & Partial<import("@react-three/fiber").EventHandlers>>>, Omit<import("@react-three/fiber").InstanceProps<THREE.InstancedMesh<THREE.BufferGeometry<THREE.NormalBufferAttributes>, THREE.Material | THREE.Material[]>, typeof THREE.InstancedMesh>, "object">>>, "ref" | "args"> & {
    context?: React.Context<Api>;
    range?: number;
    limit?: number;
    frames?: number;
} & React.RefAttributes<THREE.InstancedMesh<THREE.BufferGeometry<THREE.NormalBufferAttributes>, THREE.Material | THREE.Material[]>>>, React.ForwardRefExoticComponent<React.PropsWithoutRef<T & Omit<import("@react-three/fiber/dist/declarations/src/core/utils").Mutable<import("@react-three/fiber/dist/declarations/src/core/utils").Overwrite<Partial<import("@react-three/fiber/dist/declarations/src/core/utils").Overwrite<PositionMesh, import("@react-three/fiber").MathProps<PositionMesh> & import("@react-three/fiber").ReactProps<PositionMesh> & Partial<import("@react-three/fiber").EventHandlers>>>, Omit<import("@react-three/fiber").InstanceProps<PositionMesh, typeof PositionMesh>, "object">>>, "ref"> & {
    context?: React.Context<Api>;
}> & React.RefAttributes<PositionMesh & T>>];
export declare const InstancedAttribute: React.ForwardRefExoticComponent<Omit<import("@react-three/fiber/dist/declarations/src/core/utils").Mutable<import("@react-three/fiber/dist/declarations/src/core/utils").Overwrite<Partial<import("@react-three/fiber/dist/declarations/src/core/utils").Overwrite<THREE.InstancedBufferAttribute, import("@react-three/fiber").MathProps<THREE.InstancedBufferAttribute> & import("@react-three/fiber").ReactProps<THREE.InstancedBufferAttribute>>>, Omit<import("@react-three/fiber").InstanceProps<THREE.InstancedBufferAttribute, typeof THREE.InstancedBufferAttribute>, "object">>>, "ref" | "args"> & {
    name: string;
    defaultValue: any;
    normalized?: boolean;
    usage?: number;
} & React.RefAttributes<unknown>>;
export {};
