import * as React from 'react';
import * as THREE from 'three';
import { ThreeElements } from '@react-three/fiber';
export type MediaPipeFaceMesh = typeof FacemeshDatas.SAMPLE_FACE;
export type MediaPipePoints = typeof FacemeshDatas.SAMPLE_FACE.keypoints | (typeof FacemeshDatas.SAMPLE_FACELANDMARKER_RESULT.faceLandmarks)[0];
export type FacemeshProps = {
    points?: MediaPipePoints;
    face?: MediaPipeFaceMesh;
    width?: number;
    height?: number;
    depth?: number;
    verticalTri?: [number, number, number];
    origin?: number | THREE.Vector3;
    facialTransformationMatrix?: (typeof FacemeshDatas.SAMPLE_FACELANDMARKER_RESULT.facialTransformationMatrixes)[0];
    offset?: boolean;
    offsetScalar?: number;
    faceBlendshapes?: (typeof FacemeshDatas.SAMPLE_FACELANDMARKER_RESULT.faceBlendshapes)[0];
    eyes?: boolean;
    eyesAsOrigin?: boolean;
    debug?: boolean;
} & Omit<ThreeElements['group'], 'ref'>;
export type FacemeshApi = {
    meshRef: React.RefObject<THREE.Mesh>;
    outerRef: React.RefObject<THREE.Group>;
    eyeRightRef: React.RefObject<FacemeshEyeApi>;
    eyeLeftRef: React.RefObject<FacemeshEyeApi>;
};
export declare const Facemesh: React.ForwardRefExoticComponent<{
    points?: MediaPipePoints;
    face?: MediaPipeFaceMesh;
    width?: number;
    height?: number;
    depth?: number;
    verticalTri?: [number, number, number];
    origin?: number | THREE.Vector3;
    facialTransformationMatrix?: (typeof FacemeshDatas.SAMPLE_FACELANDMARKER_RESULT.facialTransformationMatrixes)[0];
    offset?: boolean;
    offsetScalar?: number;
    faceBlendshapes?: (typeof FacemeshDatas.SAMPLE_FACELANDMARKER_RESULT.faceBlendshapes)[0];
    eyes?: boolean;
    eyesAsOrigin?: boolean;
    debug?: boolean;
} & Omit<import("@react-three/fiber/dist/declarations/src/core/utils").Mutable<import("@react-three/fiber/dist/declarations/src/core/utils").Overwrite<Partial<import("@react-three/fiber/dist/declarations/src/core/utils").Overwrite<THREE.Group<THREE.Object3DEventMap>, import("@react-three/fiber").MathProps<THREE.Group<THREE.Object3DEventMap>> & import("@react-three/fiber").ReactProps<THREE.Group<THREE.Object3DEventMap>> & Partial<import("@react-three/fiber").EventHandlers>>>, Omit<import("@react-three/fiber").InstanceProps<THREE.Group<THREE.Object3DEventMap>, typeof THREE.Group>, "object">>>, "ref"> & React.RefAttributes<FacemeshApi>>;
export type FacemeshEyeProps = {
    side: 'left' | 'right';
    debug?: boolean;
};
export type FacemeshEyeApi = {
    eyeMeshRef: React.RefObject<THREE.Group>;
    irisDirRef: React.RefObject<THREE.Group>;
    _computeSphere: (faceGeometry: THREE.BufferGeometry) => THREE.Sphere;
    _update: (faceGeometry: THREE.BufferGeometry, faceBlendshapes: FacemeshProps['faceBlendshapes'], sphere?: THREE.Sphere) => void;
};
export declare const FacemeshEyeDefaults: {
    contourLandmarks: {
        right: number[];
        left: number[];
    };
    blendshapes: {
        right: number[];
        left: number[];
    };
    color: {
        right: string;
        left: string;
    };
    fov: {
        horizontal: number;
        vertical: number;
    };
};
export declare const FacemeshEye: React.ForwardRefExoticComponent<FacemeshEyeProps & React.RefAttributes<FacemeshEyeApi>>;
export declare const FacemeshDatas: {
    TRIANGULATION: number[];
    SAMPLE_FACE: {
        keypoints: ({
            x: number;
            y: number;
            z: number;
            name: string;
        } | {
            x: number;
            y: number;
            z: number;
            name?: undefined;
        })[];
        box: {
            xMin: number;
            yMin: number;
            xMax: number;
            yMax: number;
            width: number;
            height: number;
        };
    };
    SAMPLE_FACELANDMARKER_RESULT: {
        faceLandmarks: {
            x: number;
            y: number;
            z: number;
        }[][];
        faceBlendshapes: {
            categories: {
                index: number;
                score: number;
                categoryName: string;
                displayName: string;
            }[];
            headIndex: number;
            headName: string;
        }[];
        facialTransformationMatrixes: {
            rows: number;
            columns: number;
            data: number[];
        }[];
    };
};
