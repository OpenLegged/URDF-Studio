/**
 * @monogrid/gainmap-js v3.4.0
 * With ❤️, by MONOGRID <gainmap@monogrid.com>
 */

import { Q as QuadRenderer } from './QuadRenderer-Bj1xl_EK.js';
import { c as createDecodeFunction, L as LoaderBaseShared, e as extractGainmapFromJPEG, X as XMPMetadataNotFoundError, G as GainMapNotFoundError } from './Loader-DLI-_JDP.js';
export { M as MPFExtractor, a as extractXMP } from './Loader-DLI-_JDP.js';
import { ShaderMaterial, NoBlending, Vector3, WebGLRenderer, FileLoader } from 'three';

const vertexShader = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const fragmentShader = /* glsl */ `
// min half float value
#define HALF_FLOAT_MIN vec3( -65504, -65504, -65504 )
// max half float value
#define HALF_FLOAT_MAX vec3( 65504, 65504, 65504 )

uniform sampler2D sdr;
uniform sampler2D gainMap;
uniform vec3 gamma;
uniform vec3 offsetHdr;
uniform vec3 offsetSdr;
uniform vec3 gainMapMin;
uniform vec3 gainMapMax;
uniform float weightFactor;

varying vec2 vUv;

void main() {
  vec3 rgb = texture2D( sdr, vUv ).rgb;
  vec3 recovery = texture2D( gainMap, vUv ).rgb;
  vec3 logRecovery = pow( recovery, gamma );
  vec3 logBoost = gainMapMin * ( 1.0 - logRecovery ) + gainMapMax * logRecovery;
  vec3 hdrColor = (rgb + offsetSdr) * exp2( logBoost * weightFactor ) - offsetHdr;
  vec3 clampedHdrColor = max( HALF_FLOAT_MIN, min( HALF_FLOAT_MAX, hdrColor ));
  gl_FragColor = vec4( clampedHdrColor , 1.0 );
}
`;
/**
 * A Material which is able to decode the Gainmap into a full HDR Representation
 *
 * @category Materials
 * @group Materials
 */
class GainMapDecoderMaterial extends ShaderMaterial {
    _maxDisplayBoost;
    _hdrCapacityMin;
    _hdrCapacityMax;
    /**
     *
     * @param params
     */
    constructor({ gamma, offsetHdr, offsetSdr, gainMapMin, gainMapMax, maxDisplayBoost, hdrCapacityMin, hdrCapacityMax, sdr, gainMap }) {
        super({
            name: 'GainMapDecoderMaterial',
            vertexShader,
            fragmentShader,
            uniforms: {
                sdr: { value: sdr },
                gainMap: { value: gainMap },
                gamma: { value: new Vector3(1.0 / gamma[0], 1.0 / gamma[1], 1.0 / gamma[2]) },
                offsetHdr: { value: new Vector3().fromArray(offsetHdr) },
                offsetSdr: { value: new Vector3().fromArray(offsetSdr) },
                gainMapMin: { value: new Vector3().fromArray(gainMapMin) },
                gainMapMax: { value: new Vector3().fromArray(gainMapMax) },
                weightFactor: {
                    value: (Math.log2(maxDisplayBoost) - hdrCapacityMin) / (hdrCapacityMax - hdrCapacityMin)
                }
            },
            blending: NoBlending,
            depthTest: false,
            depthWrite: false
        });
        this._maxDisplayBoost = maxDisplayBoost;
        this._hdrCapacityMin = hdrCapacityMin;
        this._hdrCapacityMax = hdrCapacityMax;
        this.needsUpdate = true;
        this.uniformsNeedUpdate = true;
    }
    get sdr() { return this.uniforms.sdr.value; }
    set sdr(value) { this.uniforms.sdr.value = value; }
    get gainMap() { return this.uniforms.gainMap.value; }
    set gainMap(value) { this.uniforms.gainMap.value = value; }
    /**
     * @see {@link GainMapMetadata.offsetHdr}
     */
    get offsetHdr() { return this.uniforms.offsetHdr.value.toArray(); }
    set offsetHdr(value) { this.uniforms.offsetHdr.value.fromArray(value); }
    /**
     * @see {@link GainMapMetadata.offsetSdr}
     */
    get offsetSdr() { return this.uniforms.offsetSdr.value.toArray(); }
    set offsetSdr(value) { this.uniforms.offsetSdr.value.fromArray(value); }
    /**
     * @see {@link GainMapMetadata.gainMapMin}
     */
    get gainMapMin() { return this.uniforms.gainMapMin.value.toArray(); }
    set gainMapMin(value) { this.uniforms.gainMapMin.value.fromArray(value); }
    /**
     * @see {@link GainMapMetadata.gainMapMax}
     */
    get gainMapMax() { return this.uniforms.gainMapMax.value.toArray(); }
    set gainMapMax(value) { this.uniforms.gainMapMax.value.fromArray(value); }
    /**
     * @see {@link GainMapMetadata.gamma}
     */
    get gamma() {
        const g = this.uniforms.gamma.value;
        return [1 / g.x, 1 / g.y, 1 / g.z];
    }
    set gamma(value) {
        const g = this.uniforms.gamma.value;
        g.x = 1.0 / value[0];
        g.y = 1.0 / value[1];
        g.z = 1.0 / value[2];
    }
    /**
     * @see {@link GainMapMetadata.hdrCapacityMin}
     * @remarks Logarithmic space
     */
    get hdrCapacityMin() { return this._hdrCapacityMin; }
    set hdrCapacityMin(value) {
        this._hdrCapacityMin = value;
        this.calculateWeight();
    }
    /**
     * @see {@link GainMapMetadata.hdrCapacityMin}
     * @remarks Logarithmic space
     */
    get hdrCapacityMax() { return this._hdrCapacityMax; }
    set hdrCapacityMax(value) {
        this._hdrCapacityMax = value;
        this.calculateWeight();
    }
    /**
     * @see {@link GainmapDecodingParameters.maxDisplayBoost}
     * @remarks Non Logarithmic space
     */
    get maxDisplayBoost() { return this._maxDisplayBoost; }
    set maxDisplayBoost(value) {
        this._maxDisplayBoost = Math.max(1, Math.min(65504, value));
        this.calculateWeight();
    }
    calculateWeight() {
        const val = (Math.log2(this._maxDisplayBoost) - this._hdrCapacityMin) / (this._hdrCapacityMax - this._hdrCapacityMin);
        this.uniforms.weightFactor.value = Math.max(0, Math.min(1, val));
    }
}

const decodeImpl = createDecodeFunction({
    renderer: WebGLRenderer,
    createMaterial: (params) => new GainMapDecoderMaterial(params),
    createQuadRenderer: (params) => new QuadRenderer(params)
});
/**
 * Decodes a gain map using a WebGL RenderTarget
 *
 * @category Decoding Functions
 * @group Decoding Functions
 * @example
 * import { decode } from '@monogrid/gainmap-js'
 * import {
 *   Mesh,
 *   MeshBasicMaterial,
 *   PerspectiveCamera,
 *   PlaneGeometry,
 *   Scene,
 *   TextureLoader,
 *   WebGLRenderer
 * } from 'three'
 *
 * const renderer = new WebGLRenderer()
 *
 * const textureLoader = new TextureLoader()
 *
 * // load SDR Representation
 * const sdr = await textureLoader.loadAsync('sdr.jpg')
 * // load Gain map recovery image
 * const gainMap = await textureLoader.loadAsync('gainmap.jpg')
 * // load metadata
 * const metadata = await (await fetch('metadata.json')).json()
 *
 * const result = decode({
 *   sdr,
 *   gainMap,
 *   // this allows to use `result.renderTarget.texture` directly
 *   renderer,
 *   // this will restore the full HDR range
 *   maxDisplayBoost: Math.pow(2, metadata.hdrCapacityMax),
 *   ...metadata
 * })
 *
 * const scene = new Scene()
 * // `result` can be used to populate a Texture
 * const mesh = new Mesh(
 *   new PlaneGeometry(),
 *   new MeshBasicMaterial({ map: result.renderTarget.texture })
 * )
 * scene.add(mesh)
 * renderer.render(scene, new PerspectiveCamera())
 *
 * // result must be manually disposed
 * // when you are done using it
 * result.dispose()
 *
 * @param params
 * @returns
 * @throws {Error} if the WebGLRenderer fails to render the gain map
 */
const decode = (params) => {
    // Ensure renderer is defined for the base function
    if (!params.renderer) {
        throw new Error('Renderer is required for decode function');
    }
    const quadRenderer = decodeImpl({
        ...params,
        renderer: params.renderer
    });
    try {
        quadRenderer.render();
    }
    catch (e) {
        quadRenderer.disposeOnDemandRenderer();
        throw e;
    }
    return quadRenderer;
};

/**
 * Base class for WebGL loaders
 * @template TUrl - The type of URL used to load resources
 */
class LoaderBaseWebGL extends LoaderBaseShared {
    constructor(renderer, manager) {
        super({
            renderer,
            createMaterial: (params) => new GainMapDecoderMaterial(params),
            createQuadRenderer: (params) => new QuadRenderer(params)
        }, manager);
    }
    /**
     * @private
     * @param quadRenderer
     * @param metadata
     * @param sdrBuffer
     * @param gainMapBuffer
     */
    async render(quadRenderer, metadata, sdrBuffer, gainMapBuffer) {
        const { sdrImage, gainMapImage, needsFlip } = await this.processImages(sdrBuffer, gainMapBuffer, 'flipY');
        const { gainMap, sdr } = this.createTextures(sdrImage, gainMapImage, needsFlip);
        this.updateQuadRenderer(quadRenderer, sdrImage, gainMap, sdr, metadata);
        quadRenderer.render();
    }
}

/**
 * A Three.js Loader for the gain map format.
 *
 * @category Loaders
 * @group Loaders
 *
 * @example
 * import { GainMapLoader } from '@monogrid/gainmap-js'
 * import {
 *   EquirectangularReflectionMapping,
 *   Mesh,
 *   MeshBasicMaterial,
 *   PerspectiveCamera,
 *   PlaneGeometry,
 *   Scene,
 *   WebGLRenderer
 * } from 'three'
 *
 * const renderer = new WebGLRenderer()
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
class GainMapLoader extends LoaderBaseWebGL {
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
    load([sdrUrl, gainMapUrl, metadataUrl], onLoad, onProgress, onError) {
        const quadRenderer = this.prepareQuadRenderer();
        let sdr;
        let gainMap;
        let metadata;
        const loadCheck = async () => {
            if (sdr && gainMap && metadata) {
                // solves #16
                try {
                    await this.render(quadRenderer, metadata, sdr, gainMap);
                }
                catch (error) {
                    this.manager.itemError(sdrUrl);
                    this.manager.itemError(gainMapUrl);
                    this.manager.itemError(metadataUrl);
                    if (typeof onError === 'function')
                        onError(error);
                    quadRenderer.disposeOnDemandRenderer();
                    return;
                }
                if (typeof onLoad === 'function')
                    onLoad(quadRenderer);
                this.manager.itemEnd(sdrUrl);
                this.manager.itemEnd(gainMapUrl);
                this.manager.itemEnd(metadataUrl);
                quadRenderer.disposeOnDemandRenderer();
            }
        };
        let sdrLengthComputable = true;
        let sdrTotal = 0;
        let sdrLoaded = 0;
        let gainMapLengthComputable = true;
        let gainMapTotal = 0;
        let gainMapLoaded = 0;
        let metadataLengthComputable = true;
        let metadataTotal = 0;
        let metadataLoaded = 0;
        const progressHandler = () => {
            if (typeof onProgress === 'function') {
                const total = sdrTotal + gainMapTotal + metadataTotal;
                const loaded = sdrLoaded + gainMapLoaded + metadataLoaded;
                const lengthComputable = sdrLengthComputable && gainMapLengthComputable && metadataLengthComputable;
                onProgress(new ProgressEvent('progress', { lengthComputable, loaded, total }));
            }
        };
        this.manager.itemStart(sdrUrl);
        this.manager.itemStart(gainMapUrl);
        this.manager.itemStart(metadataUrl);
        const sdrLoader = new FileLoader(this._internalLoadingManager);
        sdrLoader.setResponseType('arraybuffer');
        sdrLoader.setRequestHeader(this.requestHeader);
        sdrLoader.setPath(this.path);
        sdrLoader.setWithCredentials(this.withCredentials);
        sdrLoader.load(sdrUrl, async (buffer) => {
            /* istanbul ignore if
             this condition exists only because of three.js types + strict mode
            */
            if (typeof buffer === 'string')
                throw new Error('Invalid sdr buffer');
            sdr = buffer;
            await loadCheck();
        }, (e) => {
            sdrLengthComputable = e.lengthComputable;
            sdrLoaded = e.loaded;
            sdrTotal = e.total;
            progressHandler();
        }, (error) => {
            this.manager.itemError(sdrUrl);
            if (typeof onError === 'function')
                onError(error);
        });
        const gainMapLoader = new FileLoader(this._internalLoadingManager);
        gainMapLoader.setResponseType('arraybuffer');
        gainMapLoader.setRequestHeader(this.requestHeader);
        gainMapLoader.setPath(this.path);
        gainMapLoader.setWithCredentials(this.withCredentials);
        gainMapLoader.load(gainMapUrl, async (buffer) => {
            /* istanbul ignore if
             this condition exists only because of three.js types + strict mode
            */
            if (typeof buffer === 'string')
                throw new Error('Invalid gainmap buffer');
            gainMap = buffer;
            await loadCheck();
        }, (e) => {
            gainMapLengthComputable = e.lengthComputable;
            gainMapLoaded = e.loaded;
            gainMapTotal = e.total;
            progressHandler();
        }, (error) => {
            this.manager.itemError(gainMapUrl);
            if (typeof onError === 'function')
                onError(error);
        });
        const metadataLoader = new FileLoader(this._internalLoadingManager);
        // metadataLoader.setResponseType('json')
        metadataLoader.setRequestHeader(this.requestHeader);
        metadataLoader.setPath(this.path);
        metadataLoader.setWithCredentials(this.withCredentials);
        metadataLoader.load(metadataUrl, async (json) => {
            /* istanbul ignore if
             this condition exists only because of three.js types + strict mode
            */
            if (typeof json !== 'string')
                throw new Error('Invalid metadata string');
            // TODO: implement check on JSON file and remove this eslint disable
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            metadata = JSON.parse(json);
            await loadCheck();
        }, (e) => {
            metadataLengthComputable = e.lengthComputable;
            metadataLoaded = e.loaded;
            metadataTotal = e.total;
            progressHandler();
        }, (error) => {
            this.manager.itemError(metadataUrl);
            if (typeof onError === 'function')
                onError(error);
        });
        return quadRenderer;
    }
}

/**
 * A Three.js Loader for a JPEG with embedded gainmap metadata.
 *
 * @category Loaders
 * @group Loaders
 *
 * @example
 * import { HDRJPGLoader } from '@monogrid/gainmap-js'
 * import {
 *   EquirectangularReflectionMapping,
 *   Mesh,
 *   MeshBasicMaterial,
 *   PerspectiveCamera,
 *   PlaneGeometry,
 *   Scene,
 *   WebGLRenderer
 * } from 'three'
 *
 * const renderer = new WebGLRenderer()
 *
 * const loader = new HDRJPGLoader(renderer)
 *   .setRenderTargetOptions({ mapping: EquirectangularReflectionMapping })
 *
 * const result = await loader.loadAsync('gainmap.jpeg')
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
class HDRJPGLoader extends LoaderBaseWebGL {
    /**
     * Loads a JPEG containing gain map metadata
     * Renders a normal SDR image if gainmap data is not found
     *
     * @param url Path to a JPEG file containing embedded gain map metadata
     * @param onLoad Load complete callback, will receive the result
     * @param onProgress Progress callback, will receive a `ProgressEvent`
     * @param onError Error callback
     * @returns
     */
    load(url, onLoad, onProgress, onError) {
        const quadRenderer = this.prepareQuadRenderer();
        const loader = new FileLoader(this._internalLoadingManager);
        loader.setResponseType('arraybuffer');
        loader.setRequestHeader(this.requestHeader);
        loader.setPath(this.path);
        loader.setWithCredentials(this.withCredentials);
        this.manager.itemStart(url);
        loader.load(url, async (jpeg) => {
            /* istanbul ignore if
             this condition exists only because of three.js types + strict mode
            */
            if (typeof jpeg === 'string')
                throw new Error('Invalid buffer, received [string], was expecting [ArrayBuffer]');
            const jpegBuffer = new Uint8Array(jpeg);
            let sdrJPEG;
            let gainMapJPEG;
            let metadata;
            try {
                const extractionResult = await extractGainmapFromJPEG(jpegBuffer);
                // gain map is successfully reconstructed
                sdrJPEG = extractionResult.sdr;
                gainMapJPEG = extractionResult.gainMap;
                metadata = extractionResult.metadata;
            }
            catch (e) {
                // render the SDR version if this is not a gainmap
                if (e instanceof XMPMetadataNotFoundError || e instanceof GainMapNotFoundError) {
                    console.warn(`Failure to reconstruct an HDR image from ${url}: Gain map metadata not found in the file, HDRJPGLoader will render the SDR jpeg`);
                    metadata = {
                        gainMapMin: [0, 0, 0],
                        gainMapMax: [1, 1, 1],
                        gamma: [1, 1, 1],
                        hdrCapacityMin: 0,
                        hdrCapacityMax: 1,
                        offsetHdr: [0, 0, 0],
                        offsetSdr: [0, 0, 0]
                    };
                    sdrJPEG = jpegBuffer;
                }
                else {
                    throw e;
                }
            }
            // solves #16
            try {
                await this.render(quadRenderer, metadata, sdrJPEG.buffer, gainMapJPEG?.buffer);
            }
            catch (error) {
                this.manager.itemError(url);
                if (typeof onError === 'function')
                    onError(error);
                quadRenderer.disposeOnDemandRenderer();
                return;
            }
            if (typeof onLoad === 'function')
                onLoad(quadRenderer);
            this.manager.itemEnd(url);
            quadRenderer.disposeOnDemandRenderer();
        }, onProgress, (error) => {
            this.manager.itemError(url);
            if (typeof onError === 'function')
                onError(error);
        });
        return quadRenderer;
    }
}

export { GainMapDecoderMaterial, GainMapLoader, GainMapNotFoundError, HDRJPGLoader, HDRJPGLoader as JPEGRLoader, LoaderBaseShared, QuadRenderer, XMPMetadataNotFoundError, createDecodeFunction, decode, extractGainmapFromJPEG };
