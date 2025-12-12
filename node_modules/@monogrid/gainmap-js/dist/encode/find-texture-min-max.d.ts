import { DataTexture, WebGLRenderer } from 'three';
import { EXR } from 'three/examples/jsm/loaders/EXRLoader.js';
import { HDR } from 'three/examples/jsm/loaders/HDRLoader.js';
import { RGBE } from 'three/examples/jsm/loaders/RGBELoader.js';
/**
 *
 * @category Utility
 * @group Utility
 *
 * @param image
 * @param mode
 * @param renderer
 * @returns
 */
export declare const findTextureMinMax: (image: EXR | RGBE | HDR | DataTexture, mode?: "min" | "max", renderer?: WebGLRenderer) => number[];
