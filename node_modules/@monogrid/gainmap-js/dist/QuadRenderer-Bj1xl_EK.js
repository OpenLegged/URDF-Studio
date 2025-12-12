/**
 * @monogrid/gainmap-js v3.4.0
 * With ❤️, by MONOGRID <gainmap@monogrid.com>
 */

import { ClampToEdgeWrapping, LinearFilter, Scene, OrthographicCamera, HalfFloatType, FloatType, Mesh, PlaneGeometry, WebGLRenderTarget, RGBAFormat, UVMapping, WebGLRenderer, DataTexture, LinearSRGBColorSpace, ShaderMaterial, Texture, MeshBasicMaterial, IntType, ShortType, ByteType, UnsignedIntType, UnsignedByteType } from 'three';

const getBufferForType = (type, width, height) => {
    let out;
    switch (type) {
        case UnsignedByteType:
            out = new Uint8ClampedArray(width * height * 4);
            break;
        case HalfFloatType:
            out = new Uint16Array(width * height * 4);
            break;
        case UnsignedIntType:
            out = new Uint32Array(width * height * 4);
            break;
        case ByteType:
            out = new Int8Array(width * height * 4);
            break;
        case ShortType:
            out = new Int16Array(width * height * 4);
            break;
        case IntType:
            out = new Int32Array(width * height * 4);
            break;
        case FloatType:
            out = new Float32Array(width * height * 4);
            break;
        default:
            throw new Error('Unsupported data type');
    }
    return out;
};
let _canReadPixelsResult;
/**
 * Test if this browser implementation can correctly read pixels from the specified
 * Render target type.
 *
 * Runs only once
 *
 * @param type
 * @param renderer
 * @param camera
 * @param renderTargetOptions
 * @returns
 */
const canReadPixels = (type, renderer, camera, renderTargetOptions) => {
    if (_canReadPixelsResult !== undefined)
        return _canReadPixelsResult;
    const testRT = new WebGLRenderTarget(1, 1, renderTargetOptions);
    renderer.setRenderTarget(testRT);
    const mesh = new Mesh(new PlaneGeometry(), new MeshBasicMaterial({ color: 0xffffff }));
    renderer.render(mesh, camera);
    renderer.setRenderTarget(null);
    const out = getBufferForType(type, testRT.width, testRT.height);
    renderer.readRenderTargetPixels(testRT, 0, 0, testRT.width, testRT.height, out);
    testRT.dispose();
    mesh.geometry.dispose();
    mesh.material.dispose();
    _canReadPixelsResult = out[0] !== 0;
    return _canReadPixelsResult;
};
/**
 * Utility class used for rendering a texture with a material
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
        if (!canReadPixels(this._type, this._renderer, this._camera, rtOptions)) {
            let alternativeType;
            switch (this._type) {
                case HalfFloatType:
                    alternativeType = this._renderer.extensions.has('EXT_color_buffer_float') ? FloatType : undefined;
                    break;
            }
            if (alternativeType !== undefined) {
                console.warn(`This browser does not support reading pixels from ${this._type} RenderTargets, switching to ${FloatType}`);
                this._type = alternativeType;
            }
            else {
                this._supportsReadPixels = false;
                console.warn('This browser dos not support toArray or toDataTexture, calls to those methods will result in an error thrown');
            }
        }
        this._quad = new Mesh(new PlaneGeometry(), this._material);
        this._quad.geometry.computeBoundingBox();
        this._scene.add(this._quad);
        this._renderTarget = new WebGLRenderTarget(this.width, this.height, rtOptions);
        this._renderTarget.texture.mapping = options.renderTargetOptions?.mapping !== undefined ? options.renderTargetOptions?.mapping : UVMapping;
    }
    /**
     * Instantiates a temporary renderer
     *
     * @returns
     */
    static instantiateRenderer() {
        const renderer = new WebGLRenderer();
        renderer.setSize(128, 128);
        // renderer.outputColorSpace = SRGBColorSpace
        // renderer.toneMapping = LinearToneMapping
        // renderer.debug.checkShaderErrors = false
        // this._rendererIsDisposable = true
        return renderer;
    }
    /**
     * Renders the input texture using the specified material
     */
    render = () => {
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
    toArray() {
        if (!this._supportsReadPixels)
            throw new Error('Can\'t read pixels in this browser');
        const out = getBufferForType(this._type, this._width, this._height);
        this._renderer.readRenderTargetPixels(this._renderTarget, 0, 0, this._width, this._height, out);
        return out;
    }
    /**
     * Performs a readPixel operation in the renderTarget
     * and returns a DataTexture containing the read data
     *
     * @param options options
     * @returns
     */
    toDataTexture(options) {
        const returnValue = new DataTexture(
        // fixed values
        this.toArray(), this.width, this.height, RGBAFormat, this._type, 
        // user values
        options?.mapping || UVMapping, options?.wrapS || ClampToEdgeWrapping, options?.wrapT || ClampToEdgeWrapping, options?.magFilter || LinearFilter, options?.minFilter || LinearFilter, options?.anisotropy || 1, 
        // fixed value
        LinearSRGBColorSpace);
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
            this._renderer.forceContextLoss();
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
        this.disposeOnDemandRenderer();
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
     * The `WebGLRenderTarget` used.
     */
    get renderTarget() { return this._renderTarget; }
    set renderTarget(value) {
        this._renderTarget = value;
        this._width = value.width;
        this._height = value.height;
        // this._type = value.texture.type
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

export { QuadRenderer as Q };
