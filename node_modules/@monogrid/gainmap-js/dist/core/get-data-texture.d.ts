import { DataTexture } from 'three';
import { EXR } from 'three/examples/jsm/loaders/EXRLoader.js';
import { HDR } from 'three/examples/jsm/loaders/HDRLoader.js';
import { RGBE } from 'three/examples/jsm/loaders/RGBELoader.js';
/**
 * Utility function to obtain a `DataTexture` from various input formats
 *
 * @category Utility
 * @group Utility
 *
 * @param image
 * @returns
 */
export declare const getDataTexture: (image: EXR | RGBE | HDR | DataTexture) => DataTexture;
