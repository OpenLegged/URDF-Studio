/**
 * @monogrid/gainmap-js v3.4.0
 * With ❤️, by MONOGRID <gainmap@monogrid.com>
 */

import { c as createDecodeFunction, L as LoaderBaseShared, e as extractGainmapFromJPEG, X as XMPMetadataNotFoundError, G as GainMapNotFoundError } from './Loader-DLI-_JDP.js';
export { M as MPFExtractor, a as extractXMP } from './Loader-DLI-_JDP.js';
import { ClampToEdgeWrapping, LinearFilter, Scene, OrthographicCamera, Mesh, PlaneGeometry, RenderTarget, RGBAFormat, UVMapping, WebGPURenderer, DataTexture, LinearSRGBColorSpace, ShaderMaterial, Texture, MeshBasicNodeMaterial, NoBlending, FileLoader } from 'three/webgpu';
import 'three';
import { vec3, texture, uniform, pow, sub, float, add, mul, exp2, max, min } from 'three/tsl';

/**
 * Utility class used for rendering a texture with a material (WebGPU version)
 *
 * @category Core
 * @group Core
 */
class QuadRenderer {
    _renderer;
    _rendererIsDisposable = false;
    _material;
    _scene;
    _camera;
    _quad;
    _renderTarget;
    _width;
    _height;
    _type;
    _colorSpace;
    _supportsReadPixels = true;
    /**
     * Constructs a new QuadRenderer
     *
     * @param options Parameters for this QuadRenderer
     */
    constructor(options) {
        this._width = options.width;
        this._height = options.height;
        this._type = options.type;
        this._colorSpace = options.colorSpace;
        const rtOptions = {
            // fixed options
            format: RGBAFormat,
            depthBuffer: false,
            stencilBuffer: false,
            // user options
            type: this._type, // set in class property
            colorSpace: this._colorSpace, // set in class property
            anisotropy: options.renderTargetOptions?.anisotropy !== undefined ? options.renderTargetOptions?.anisotropy : 1,
            generateMipmaps: options.renderTargetOptions?.generateMipmaps !== undefined ? options.renderTargetOptions?.generateMipmaps : false,
            magFilter: options.renderTargetOptions?.magFilter !== undefined ? options.renderTargetOptions?.magFilter : LinearFilter,
            minFilter: options.renderTargetOptions?.minFilter !== undefined ? options.renderTargetOptions?.minFilter : LinearFilter,
            samples: options.renderTargetOptions?.samples !== undefined ? options.renderTargetOptions?.samples : undefined,
            wrapS: options.renderTargetOptions?.wrapS !== undefined ? options.renderTargetOptions?.wrapS : ClampToEdgeWrapping,
            wrapT: options.renderTargetOptions?.wrapT !== undefined ? options.renderTargetOptions?.wrapT : ClampToEdgeWrapping
        };
        this._material = options.material;
        if (options.renderer) {
            this._renderer = options.renderer;
        }
        else {
            this._renderer = QuadRenderer.instantiateRenderer();
            this._rendererIsDisposable = true;
        }
        this._scene = new Scene();
        this._camera = new OrthographicCamera();
        this._camera.position.set(0, 0, 10);
        this._camera.left = -0.5;
        this._camera.right = 0.5;
        this._camera.top = 0.5;
        this._camera.bottom = -0.5;
        this._camera.updateProjectionMatrix();
        this._quad = new Mesh(new PlaneGeometry(), this._material);
        this._quad.geometry.computeBoundingBox();
        this._scene.add(this._quad);
        this._renderTarget = new RenderTarget(this.width, this.height, rtOptions);
        this._renderTarget.texture.mapping = options.renderTargetOptions?.mapping !== undefined ? options.renderTargetOptions?.mapping : UVMapping;
    }
    /**
     * Instantiates a temporary renderer
     *
     * @returns
     */
    static instantiateRenderer() {
        const renderer = new WebGPURenderer();
        renderer.setSize(128, 128);
        return renderer;
    }
    /**
     * Renders the input texture using the specified material
     */
    render = async () => {
        if (!this._renderer.hasInitialized()) {
            await this._renderer.init();
        }
        this._renderer.setRenderTarget(this._renderTarget);
        try {
            this._renderer.render(this._scene, this._camera);
        }
        catch (e) {
            this._renderer.setRenderTarget(null);
            throw e;
        }
        this._renderer.setRenderTarget(null);
    };
    /**
     * Obtains a Buffer containing the rendered texture.
     *
     * @throws Error if the browser cannot read pixels from this RenderTarget type.
     * @returns a TypedArray containing RGBA values from this renderer
     */
    async toArray() {
        if (!this._supportsReadPixels)
            throw new Error('Can\'t read pixels in this browser');
        const out = await this._renderer.readRenderTargetPixelsAsync(this._renderTarget, 0, 0, this._width, this._height);
        return out;
    }
    /**
     * Performs a readPixel operation in the renderTarget
     * and returns a DataTexture containing the read data
     *
     * @param options options
     * @returns
     */
    async toDataTexture(options) {
        const returnValue = new DataTexture(
        // fixed values
        await this.toArray(), this.width, this.height, RGBAFormat, this._type, 
        // user values
        options?.mapping || UVMapping, options?.wrapS || ClampToEdgeWrapping, options?.wrapT || ClampToEdgeWrapping, options?.magFilter || LinearFilter, options?.minFilter || LinearFilter, options?.anisotropy || 1, 
        // fixed value
        LinearSRGBColorSpace);
        returnValue.flipY = options?.flipY !== undefined ? options?.flipY : true;
        // set this afterwards, we can't set it in constructor
        returnValue.generateMipmaps = options?.generateMipmaps !== undefined ? options?.generateMipmaps : false;
        return returnValue;
    }
    /**
     * If using a disposable renderer, it will dispose it.
     */
    disposeOnDemandRenderer() {
        this._renderer.setRenderTarget(null);
        if (this._rendererIsDisposable) {
            this._renderer.dispose();
        }
    }
    /**
     * Will dispose of **all** assets used by this renderer.
     *
     *
     * @param disposeRenderTarget will dispose of the renderTarget which will not be usable later
     * set this to true if you passed the `renderTarget.texture` to a `PMREMGenerator`
     * or are otherwise done with it.
     *
     * @example
     * ```js
     * const loader = new HDRJPGLoader(renderer)
     * const result = await loader.loadAsync('gainmap.jpeg')
     * const mesh = new Mesh(geometry, new MeshBasicMaterial({ map: result.renderTarget.texture }) )
     * // DO NOT dispose the renderTarget here,
     * // it is used directly in the material
     * result.dispose()
     * ```
     *
     * @example
     * ```js
     * const loader = new HDRJPGLoader(renderer)
     * const pmremGenerator = new PMREMGenerator( renderer );
     * const result = await loader.loadAsync('gainmap.jpeg')
     * const envMap = pmremGenerator.fromEquirectangular(result.renderTarget.texture)
     * const mesh = new Mesh(geometry, new MeshStandardMaterial({ envMap }) )
     * // renderTarget can be disposed here
     * // because it was used to generate a PMREM texture
     * result.dispose(true)
     * ```
     */
    dispose(disposeRenderTarget) {
        if (disposeRenderTarget) {
            this.renderTarget.dispose();
        }
        // dispose shader material texture uniforms
        if (this.material instanceof ShaderMaterial) {
            Object.values(this.material.uniforms).forEach(v => {
                if (v.value instanceof Texture)
                    v.value.dispose();
            });
        }
        // dispose other material properties
        Object.values(this.material).forEach(value => {
            if (value instanceof Texture)
                value.dispose();
        });
        this.material.dispose();
        this._quad.geometry.dispose();
        this.disposeOnDemandRenderer();
    }
    /**
     * Width of the texture
     */
    get width() { return this._width; }
    set width(value) {
        this._width = value;
        this._renderTarget.setSize(this._width, this._height);
    }
    /**
     * Height of the texture
     */
    get height() { return this._height; }
    set height(value) {
        this._height = value;
        this._renderTarget.setSize(this._width, this._height);
    }
    /**
     * The renderer used
     */
    get renderer() { return this._renderer; }
    /**
     * The `RenderTarget` used.
     */
    get renderTarget() { return this._renderTarget; }
    set renderTarget(value) {
        this._renderTarget = value;
        this._width = value.width;
        this._height = value.height;
    }
    /**
     * The `Material` used.
     */
    get material() { return this._material; }
    /**
     *
     */
    get type() { return this._type; }
    get colorSpace() { return this._colorSpace; }
}

// min half float value
const HALF_FLOAT_MIN = vec3(-65504, -65504, -65504);
// max half float value
const HALF_FLOAT_MAX = vec3(65504, 65504, 65504);
/**
 * A Material which is able to decode the Gainmap into a full HDR Representation using TSL (Three.js Shading Language)
 *
 * @category Materials
 * @group Materials
 */
class GainMapDecoderMaterial extends MeshBasicNodeMaterial {
    _maxDisplayBoost;
    _hdrCapacityMin;
    _hdrCapacityMax;
    // Uniforms for TSL
    _gammaUniform;
    _offsetHdrUniform;
    _offsetSdrUniform;
    _gainMapMinUniform;
    _gainMapMaxUniform;
    _weightFactorUniform;
    _sdrTexture;
    _gainMapTexture;
    /**
     *
     * @param params
     */
    constructor({ gamma, offsetHdr, offsetSdr, gainMapMin, gainMapMax, maxDisplayBoost, hdrCapacityMin, hdrCapacityMax, sdr, gainMap }) {
        super();
        this.name = 'GainMapDecoderMaterial';
        this.blending = NoBlending;
        this.depthTest = false;
        this.depthWrite = false;
        this._sdrTexture = texture(sdr);
        this._gainMapTexture = texture(gainMap);
        // Create uniform nodes
        this._gammaUniform = uniform(vec3(1.0 / gamma[0], 1.0 / gamma[1], 1.0 / gamma[2]));
        this._offsetHdrUniform = uniform(vec3(offsetHdr[0], offsetHdr[1], offsetHdr[2]));
        this._offsetSdrUniform = uniform(vec3(offsetSdr[0], offsetSdr[1], offsetSdr[2]));
        this._gainMapMinUniform = uniform(vec3(gainMapMin[0], gainMapMin[1], gainMapMin[2]));
        this._gainMapMaxUniform = uniform(vec3(gainMapMax[0], gainMapMax[1], gainMapMax[2]));
        const weightFactor = (Math.log2(maxDisplayBoost) - hdrCapacityMin) / (hdrCapacityMax - hdrCapacityMin);
        this._weightFactorUniform = uniform(weightFactor);
        this._maxDisplayBoost = maxDisplayBoost;
        this._hdrCapacityMin = hdrCapacityMin;
        this._hdrCapacityMax = hdrCapacityMax;
        // Build the TSL shader graph
        // Get RGB values
        const rgb = this._sdrTexture.rgb;
        const recovery = this._gainMapTexture.rgb;
        // Apply gamma correction
        const logRecovery = pow(recovery, this._gammaUniform);
        // Calculate log boost
        // logBoost = gainMapMin * (1.0 - logRecovery) + gainMapMax * logRecovery
        const oneMinusLogRecovery = sub(float(1.0), logRecovery);
        const logBoost = add(mul(this._gainMapMinUniform, oneMinusLogRecovery), mul(this._gainMapMaxUniform, logRecovery));
        // Calculate HDR color
        // hdrColor = (rgb + offsetSdr) * exp2(logBoost * weightFactor) - offsetHdr
        const hdrColor = sub(mul(add(rgb, this._offsetSdrUniform), exp2(mul(logBoost, this._weightFactorUniform))), this._offsetHdrUniform);
        // Clamp to half float range
        const clampedHdrColor = max(HALF_FLOAT_MIN, min(HALF_FLOAT_MAX, hdrColor));
        // Set the color output
        this.colorNode = clampedHdrColor;
    }
    get sdr() { return this._sdrTexture.value; }
    set sdr(value) { this._sdrTexture.value = value; }
    get gainMap() { return this._gainMapTexture.value; }
    set gainMap(value) { this._gainMapTexture.value = value; }
    /**
     * @see {@link GainMapMetadata.offsetHdr}
     */
    get offsetHdr() {
        return [this._offsetHdrUniform.value.x, this._offsetHdrUniform.value.y, this._offsetHdrUniform.value.z];
    }
    set offsetHdr(value) {
        this._offsetHdrUniform.value.x = value[0];
        this._offsetHdrUniform.value.y = value[1];
        this._offsetHdrUniform.value.z = value[2];
    }
    /**
     * @see {@link GainMapMetadata.offsetSdr}
     */
    get offsetSdr() {
        return [this._offsetSdrUniform.value.x, this._offsetSdrUniform.value.y, this._offsetSdrUniform.value.z];
    }
    set offsetSdr(value) {
        this._offsetSdrUniform.value.x = value[0];
        this._offsetSdrUniform.value.y = value[1];
        this._offsetSdrUniform.value.z = value[2];
    }
    /**
     * @see {@link GainMapMetadata.gainMapMin}
     */
    get gainMapMin() {
        return [this._gainMapMinUniform.value.x, this._gainMapMinUniform.value.y, this._gainMapMinUniform.value.z];
    }
    set gainMapMin(value) {
        this._gainMapMinUniform.value.x = value[0];
        this._gainMapMinUniform.value.y = value[1];
        this._gainMapMinUniform.value.z = value[2];
    }
    /**
     * @see {@link GainMapMetadata.gainMapMax}
     */
    get gainMapMax() {
        return [this._gainMapMaxUniform.value.x, this._gainMapMaxUniform.value.y, this._gainMapMaxUniform.value.z];
    }
    set gainMapMax(value) {
        this._gainMapMaxUniform.value.x = value[0];
        this._gainMapMaxUniform.value.y = value[1];
        this._gainMapMaxUniform.value.z = value[2];
    }
    /**
     * @see {@link GainMapMetadata.gamma}
     */
    get gamma() {
        return [1 / this._gammaUniform.value.x, 1 / this._gammaUniform.value.y, 1 / this._gammaUniform.value.z];
    }
    set gamma(value) {
        this._gammaUniform.value.x = 1.0 / value[0];
        this._gammaUniform.value.y = 1.0 / value[1];
        this._gammaUniform.value.z = 1.0 / value[2];
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
     * @see {@link GainMapMetadata.hdrCapacityMax}
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
        this._weightFactorUniform.value = Math.max(0, Math.min(1, val));
    }
}

const decodeImpl = createDecodeFunction({
    renderer: WebGPURenderer,
    createMaterial: (params) => new GainMapDecoderMaterial(params),
    createQuadRenderer: (params) => new QuadRenderer(params)
});
/**
 * Decodes a gain map using WebGPU RenderTarget
 *
 * @category Decoding Functions
 * @group Decoding Functions
 * @example
 * import { decode } from '@monogrid/gainmap-js/webgpu'
 * import {
 *   Mesh,
 *   MeshBasicMaterial,
 *   PerspectiveCamera,
 *   PlaneGeometry,
 *   Scene,
 *   TextureLoader,
 *   WebGPURenderer
 * } from 'three/webgpu'
 *
 * const renderer = new WebGPURenderer()
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
 * const result = await decode({
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
 * @throws {Error} if the WebGPURenderer fails to render the gain map
 */
const decode = async (params) => {
    // Ensure renderer is defined for the base function
    if (!params.renderer) {
        throw new Error('Renderer is required for decode function');
    }
    const quadRenderer = decodeImpl({
        ...params,
        renderer: params.renderer
    });
    try {
        await quadRenderer.render();
    }
    catch (e) {
        quadRenderer.disposeOnDemandRenderer();
        throw e;
    }
    return quadRenderer;
};

/**
 * Base class for WebGPU loaders
 * @template TUrl - The type of URL used to load resources
 */
class LoaderBaseWebGPU extends LoaderBaseShared {
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
        // in WebGPU we apparently don't need flipY under any circumstance
        // except in QuadRenderer.toDataTexture() where we perform it in the texture itself
        const { sdrImage, gainMapImage, needsFlip } = await this.processImages(sdrBuffer, gainMapBuffer, 'from-image');
        const { gainMap, sdr } = this.createTextures(sdrImage, gainMapImage, needsFlip);
        this.updateQuadRenderer(quadRenderer, sdrImage, gainMap, sdr, metadata);
        await quadRenderer.render();
    }
}

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
class GainMapLoader extends LoaderBaseWebGPU {
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
 * A Three.js Loader for a JPEG with embedded gainmap metadata (WebGPU version).
 *
 * @category Loaders
 * @group Loaders
 *
 * @example
 * import { HDRJPGLoader } from '@monogrid/gainmap-js/webgpu'
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
class HDRJPGLoader extends LoaderBaseWebGPU {
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
