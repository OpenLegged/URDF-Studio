import { HalfFloatType } from 'three/webgpu';
import { QuadRenderer } from '../core/QuadRenderer';
import { GainMapDecoderMaterial } from '../materials/GainMapDecoderMaterial';
import { LoaderBaseWebGPU } from './LoaderBaseWebGPU';
/**
 * A Three.js Loader for the gain map format (WebGPU version).
 *
 * @category Loaders
 * @group Loaders
 *
 * @example
 * import { GainMapLoader } from '@monogrid/gainmap-js/webgpu'
 * import {
 *   EquirectangularReflectionMapping,
 *   Mesh,
 *   MeshBasicMaterial,
 *   PerspectiveCamera,
 *   PlaneGeometry,
 *   Scene,
 *   WebGPURenderer
 * } from 'three/webgpu'
 *
 * const renderer = new WebGPURenderer()
 * await renderer.init()
 *
 * const loader = new GainMapLoader(renderer)
 *   .setRenderTargetOptions({ mapping: EquirectangularReflectionMapping })
 *
 * const result = await loader.loadAsync(['sdr.jpeg', 'gainmap.jpeg', 'metadata.json'])
 * // `result` can be used to populate a Texture
 *
 * const scene = new Scene()
 * const mesh = new Mesh(
 *   new PlaneGeometry(),
 *   new MeshBasicMaterial({ map: result.renderTarget.texture })
 * )
 * scene.add(mesh)
 * renderer.render(scene, new PerspectiveCamera())
 *
 * // Starting from three.js r159
 * // `result.renderTarget.texture` can
 * // also be used as Equirectangular scene background
 * //
 * // it was previously needed to convert it
 * // to a DataTexture with `result.toDataTexture()`
 * scene.background = result.renderTarget.texture
 *
 * // result must be manually disposed
 * // when you are done using it
 * result.dispose()
 *
 */
export declare class GainMapLoader extends LoaderBaseWebGPU<[string, string, string]> {
    /**
     * Loads a gainmap using separate data
     * * sdr image
     * * gain map image
     * * metadata json
     *
     * useful for webp gain maps
     *
     * @param urls An array in the form of [sdr.jpg, gainmap.jpg, metadata.json]
     * @param onLoad Load complete callback, will receive the result
     * @param onProgress Progress callback, will receive a `ProgressEvent`
     * @param onError Error callback
     * @returns
     */
    load([sdrUrl, gainMapUrl, metadataUrl]: [string, string, string], onLoad?: (data: QuadRenderer<typeof HalfFloatType, GainMapDecoderMaterial>) => void, onProgress?: (event: ProgressEvent) => void, onError?: (err: unknown) => void): QuadRenderer<typeof HalfFloatType, GainMapDecoderMaterial>;
}
