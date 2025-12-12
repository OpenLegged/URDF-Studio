import * as React from 'react';
import { Color, Group, Vector3, Material, MeshLambertMaterial, Matrix4 } from 'three';
import { ReactThreeFiber, ThreeElement, ThreeElements } from '@react-three/fiber';
declare module '@react-three/fiber' {
    interface ThreeElements {
        cloudMaterial: ThreeElement<typeof MeshLambertMaterial>;
    }
}
type CloudState = {
    uuid: string;
    index: number;
    segments: number;
    dist: number;
    matrix: Matrix4;
    bounds: Vector3;
    position: Vector3;
    volume: number;
    length: number;
    ref: React.RefObject<Group>;
    speed: number;
    growth: number;
    opacity: number;
    fade: number;
    density: number;
    rotation: number;
    rotationFactor: number;
    color: Color;
};
export type CloudsProps = Omit<ThreeElements['group'], 'ref'> & {
    texture?: string;
    limit?: number;
    range?: number;
    material?: typeof Material;
    frustumCulled?: boolean;
};
export type CloudProps = Omit<ThreeElements['group'], 'ref'> & {
    seed?: number;
    segments?: number;
    bounds?: ReactThreeFiber.Vector3;
    concentrate?: 'random' | 'inside' | 'outside';
    scale?: ReactThreeFiber.Vector3;
    volume?: number;
    smallestVolume?: number;
    distribute?: (cloud: CloudState, index: number) => {
        point: Vector3;
        volume?: number;
    };
    growth?: number;
    speed?: number;
    fade?: number;
    opacity?: number;
    color?: ReactThreeFiber.Color;
};
export declare const Clouds: React.ForwardRefExoticComponent<Omit<import("@react-three/fiber/dist/declarations/src/core/utils").Mutable<import("@react-three/fiber/dist/declarations/src/core/utils").Overwrite<Partial<import("@react-three/fiber/dist/declarations/src/core/utils").Overwrite<Group<import("three").Object3DEventMap>, ReactThreeFiber.MathProps<Group<import("three").Object3DEventMap>> & ReactThreeFiber.ReactProps<Group<import("three").Object3DEventMap>> & Partial<import("@react-three/fiber").EventHandlers>>>, Omit<import("@react-three/fiber").InstanceProps<Group<import("three").Object3DEventMap>, typeof Group>, "object">>>, "ref"> & {
    texture?: string;
    limit?: number;
    range?: number;
    material?: typeof Material;
    frustumCulled?: boolean;
} & React.RefAttributes<Group<import("three").Object3DEventMap>>>;
export declare const CloudInstance: React.ForwardRefExoticComponent<Omit<import("@react-three/fiber/dist/declarations/src/core/utils").Mutable<import("@react-three/fiber/dist/declarations/src/core/utils").Overwrite<Partial<import("@react-three/fiber/dist/declarations/src/core/utils").Overwrite<Group<import("three").Object3DEventMap>, ReactThreeFiber.MathProps<Group<import("three").Object3DEventMap>> & ReactThreeFiber.ReactProps<Group<import("three").Object3DEventMap>> & Partial<import("@react-three/fiber").EventHandlers>>>, Omit<import("@react-three/fiber").InstanceProps<Group<import("three").Object3DEventMap>, typeof Group>, "object">>>, "ref"> & {
    seed?: number;
    segments?: number;
    bounds?: ReactThreeFiber.Vector3;
    concentrate?: "random" | "inside" | "outside";
    scale?: ReactThreeFiber.Vector3;
    volume?: number;
    smallestVolume?: number;
    distribute?: (cloud: CloudState, index: number) => {
        point: Vector3;
        volume?: number;
    };
    growth?: number;
    speed?: number;
    fade?: number;
    opacity?: number;
    color?: ReactThreeFiber.Color;
} & React.RefAttributes<Group<import("three").Object3DEventMap>>>;
export declare const Cloud: React.ForwardRefExoticComponent<Omit<import("@react-three/fiber/dist/declarations/src/core/utils").Mutable<import("@react-three/fiber/dist/declarations/src/core/utils").Overwrite<Partial<import("@react-three/fiber/dist/declarations/src/core/utils").Overwrite<Group<import("three").Object3DEventMap>, ReactThreeFiber.MathProps<Group<import("three").Object3DEventMap>> & ReactThreeFiber.ReactProps<Group<import("three").Object3DEventMap>> & Partial<import("@react-three/fiber").EventHandlers>>>, Omit<import("@react-three/fiber").InstanceProps<Group<import("three").Object3DEventMap>, typeof Group>, "object">>>, "ref"> & {
    seed?: number;
    segments?: number;
    bounds?: ReactThreeFiber.Vector3;
    concentrate?: "random" | "inside" | "outside";
    scale?: ReactThreeFiber.Vector3;
    volume?: number;
    smallestVolume?: number;
    distribute?: (cloud: CloudState, index: number) => {
        point: Vector3;
        volume?: number;
    };
    growth?: number;
    speed?: number;
    fade?: number;
    opacity?: number;
    color?: ReactThreeFiber.Color;
} & React.RefAttributes<Group<import("three").Object3DEventMap>>>;
export {};
