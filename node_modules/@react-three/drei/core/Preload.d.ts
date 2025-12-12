import { Object3D, Camera } from 'three';
export type PreloadProps = {
    all?: boolean;
    scene?: Object3D;
    camera?: Camera;
};
export declare function Preload({ all, scene, camera }: PreloadProps): null;
