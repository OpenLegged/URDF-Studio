/**
 * @monogrid/gainmap-js v3.4.0
 * With ❤️, by MONOGRID <gainmap@monogrid.com>
 */

import { c as compress } from './compress-C-X439Jm.js';
import { DataTexture, RGBAFormat, UVMapping, RepeatWrapping, LinearFilter, LinearSRGBColorSpace, ShaderMaterial, NoBlending, Vector3, UnsignedByteType, ACESFilmicToneMapping, LinearToneMapping, NeutralToneMapping, AgXToneMapping, CineonToneMapping, ReinhardToneMapping, SRGBColorSpace, AlphaFormat, RGBFormat, DepthFormat, DepthStencilFormat, RedFormat, RedIntegerFormat, RGFormat, RGIntegerFormat, RGBIntegerFormat, RGBAIntegerFormat, Vector2, WebGLRenderTarget, ClampToEdgeWrapping, NearestFilter, DataUtils, FloatType } from 'three';
import { Q as QuadRenderer } from './QuadRenderer-Bj1xl_EK.js';

/**
 * Utility function to obtain a `DataTexture` from various input formats
 *
 * @category Utility
 * @group Utility
 *
 * @param image
 * @returns
 */
const getDataTexture = (image) => {
    let dataTexture;
    if (image instanceof DataTexture) {
        if (!(image.image.data instanceof Uint16Array) && !(image.image.data instanceof Float32Array)) {
            throw new Error('Provided image is not HDR');
        }
        dataTexture = image;
    }
    else {
        dataTexture = new DataTexture(image.data, image.width, image.height, 'format' in image ? image.format : RGBAFormat, image.type, UVMapping, RepeatWrapping, RepeatWrapping, LinearFilter, LinearFilter, 1, 'colorSpace' in image && image.colorSpace === 'srgb' ? image.colorSpace : LinearSRGBColorSpace);
        // TODO: This tries to detect a raw RGBE and applies flipY
        // see if there's a better way to detect it?
        if ('header' in image && 'gamma' in image) {
            dataTexture.flipY = true;
        }
        dataTexture.needsUpdate = true;
    }
    return dataTexture;
};

const vertexShader$2 = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const fragmentShader$2 = /* glsl */ `
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
uniform sampler2D sdr;
uniform sampler2D hdr;
uniform vec3 gamma;
uniform vec3 offsetSdr;
uniform vec3 offsetHdr;
uniform float minLog2;
uniform float maxLog2;

varying vec2 vUv;

void main() {
  vec3 sdrColor = texture2D(sdr, vUv).rgb;
  vec3 hdrColor = texture2D(hdr, vUv).rgb;

  vec3 pixelGain = (hdrColor + offsetHdr) / (sdrColor + offsetSdr);
  vec3 logRecovery = (log2(pixelGain) - minLog2) / (maxLog2 - minLog2);
  vec3 clampedRecovery = saturate(logRecovery);
  gl_FragColor = vec4(pow(clampedRecovery, gamma), 1.0);
}
`;
/**
 * A Material which is able to encode a gainmap
 *
 * @category Materials
 * @group Materials
 */
class GainMapEncoderMaterial extends ShaderMaterial {
    _minContentBoost;
    _maxContentBoost;
    _offsetSdr;
    _offsetHdr;
    _gamma;
    /**
     *
     * @param params
     */
    constructor({ sdr, hdr, offsetSdr, offsetHdr, maxContentBoost, minContentBoost, gamma }) {
        if (!maxContentBoost)
            throw new Error('maxContentBoost is required');
        if (!sdr)
            throw new Error('sdr is required');
        if (!hdr)
            throw new Error('hdr is required');
        const _gamma = gamma || [1, 1, 1];
        const _offsetSdr = offsetSdr || [1 / 64, 1 / 64, 1 / 64];
        const _offsetHdr = offsetHdr || [1 / 64, 1 / 64, 1 / 64];
        const _minContentBoost = minContentBoost || 1;
        const _maxContentBoost = Math.max(maxContentBoost, 1.0001);
        super({
            name: 'GainMapEncoderMaterial',
            vertexShader: vertexShader$2,
            fragmentShader: fragmentShader$2,
            uniforms: {
                sdr: { value: sdr },
                hdr: { value: hdr },
                gamma: { value: new Vector3().fromArray(_gamma) },
                offsetSdr: { value: new Vector3().fromArray(_offsetSdr) },
                offsetHdr: { value: new Vector3().fromArray(_offsetHdr) },
                minLog2: { value: Math.log2(_minContentBoost) },
                maxLog2: { value: Math.log2(_maxContentBoost) }
            },
            blending: NoBlending,
            depthTest: false,
            depthWrite: false
        });
        this._minContentBoost = _minContentBoost;
        this._maxContentBoost = _maxContentBoost;
        this._offsetSdr = _offsetSdr;
        this._offsetHdr = _offsetHdr;
        this._gamma = _gamma;
        this.needsUpdate = true;
        this.uniformsNeedUpdate = true;
    }
    /**
     * @see {@link GainmapEncodingParameters.gamma}
     */
    get gamma() { return this._gamma; }
    set gamma(value) {
        this._gamma = value;
        this.uniforms.gamma.value = new Vector3().fromArray(value);
    }
    /**
     * @see {@link GainmapEncodingParameters.offsetHdr}
     */
    get offsetHdr() { return this._offsetHdr; }
    set offsetHdr(value) {
        this._offsetHdr = value;
        this.uniforms.offsetHdr.value = new Vector3().fromArray(value);
    }
    /**
     * @see {@link GainmapEncodingParameters.offsetSdr}
     */
    get offsetSdr() { return this._offsetSdr; }
    set offsetSdr(value) {
        this._offsetSdr = value;
        this.uniforms.offsetSdr.value = new Vector3().fromArray(value);
    }
    /**
     * @see {@link GainmapEncodingParameters.minContentBoost}
     * @remarks Non logarithmic space
     */
    get minContentBoost() { return this._minContentBoost; }
    set minContentBoost(value) {
        this._minContentBoost = value;
        this.uniforms.minLog2.value = Math.log2(value);
    }
    /**
     * @see {@link GainmapEncodingParameters.maxContentBoost}
     * @remarks Non logarithmic space
     */
    get maxContentBoost() { return this._maxContentBoost; }
    set maxContentBoost(value) {
        this._maxContentBoost = value;
        this.uniforms.maxLog2.value = Math.log2(value);
    }
    /**
     * @see {@link GainMapMetadata.gainMapMin}
     * @remarks Logarithmic space
     */
    get gainMapMin() { return [Math.log2(this._minContentBoost), Math.log2(this._minContentBoost), Math.log2(this._minContentBoost)]; }
    /**
     * @see {@link GainMapMetadata.gainMapMax}
     * @remarks Logarithmic space
     */
    get gainMapMax() { return [Math.log2(this._maxContentBoost), Math.log2(this._maxContentBoost), Math.log2(this._maxContentBoost)]; }
    /**
     * @see {@link GainMapMetadata.hdrCapacityMin}
     * @remarks Logarithmic space
     */
    get hdrCapacityMin() { return Math.min(Math.max(0, this.gainMapMin[0]), Math.max(0, this.gainMapMin[1]), Math.max(0, this.gainMapMin[2])); }
    /**
     * @see {@link GainMapMetadata.hdrCapacityMax}
     * @remarks Logarithmic space
     */
    get hdrCapacityMax() { return Math.max(Math.max(0, this.gainMapMax[0]), Math.max(0, this.gainMapMax[1]), Math.max(0, this.gainMapMax[2])); }
}

/**
 *
 * @param params
 * @returns
 * @category Encoding Functions
 * @group Encoding Functions
 */
const getGainMap = (params) => {
    const { image, sdr, renderer } = params;
    const dataTexture = getDataTexture(image);
    const material = new GainMapEncoderMaterial({
        ...params,
        sdr: sdr.renderTarget.texture,
        hdr: dataTexture
    });
    const quadRenderer = new QuadRenderer({
        width: dataTexture.image.width,
        height: dataTexture.image.height,
        type: UnsignedByteType,
        colorSpace: LinearSRGBColorSpace,
        material,
        renderer,
        renderTargetOptions: params.renderTargetOptions
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

const vertexShader$1 = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const fragmentShader$1 = /* glsl */ `
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif

uniform sampler2D map;
uniform float brightness;
uniform float contrast;
uniform float saturation;
uniform float exposure;

varying vec2 vUv;

mat4 brightnessMatrix( float brightness ) {
  return mat4(
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    brightness, brightness, brightness, 1
  );
}

mat4 contrastMatrix( float contrast ) {
  float t = ( 1.0 - contrast ) / 2.0;
  return mat4(
    contrast, 0, 0, 0,
    0, contrast, 0, 0,
    0, 0, contrast, 0,
    t, t, t, 1
  );
}

mat4 saturationMatrix( float saturation ) {
  vec3 luminance = vec3( 0.3086, 0.6094, 0.0820 );
  float oneMinusSat = 1.0 - saturation;
  vec3 red = vec3( luminance.x * oneMinusSat );
  red+= vec3( saturation, 0, 0 );
  vec3 green = vec3( luminance.y * oneMinusSat );
  green += vec3( 0, saturation, 0 );
  vec3 blue = vec3( luminance.z * oneMinusSat );
  blue += vec3( 0, 0, saturation );
  return mat4(
    red,     0,
    green,   0,
    blue,    0,
    0, 0, 0, 1
  );
}

vec3 RRTAndODTFit( vec3 v ) {
  vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
  vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
  return a / b;
}

vec3 ACESFilmicToneMapping( vec3 color ) {
  // sRGB => XYZ => D65_2_D60 => AP1 => RRT_SAT
  const mat3 ACESInputMat = mat3(
    vec3( 0.59719, 0.07600, 0.02840 ), // transposed from source
    vec3( 0.35458, 0.90834, 0.13383 ),
    vec3( 0.04823, 0.01566, 0.83777 )
  );
  // ODT_SAT => XYZ => D60_2_D65 => sRGB
  const mat3 ACESOutputMat = mat3(
    vec3(  1.60475, -0.10208, -0.00327 ), // transposed from source
    vec3( -0.53108,  1.10813, -0.07276 ),
    vec3( -0.07367, -0.00605,  1.07602 )
  );
  color = ACESInputMat * color;
  // Apply RRT and ODT
  color = RRTAndODTFit( color );
  color = ACESOutputMat * color;
  // Clamp to [0, 1]
  return saturate( color );
}

// source: https://www.cs.utah.edu/docs/techreports/2002/pdf/UUCS-02-001.pdf
vec3 ReinhardToneMapping( vec3 color ) {
  return saturate( color / ( vec3( 1.0 ) + color ) );
}

// source: http://filmicworlds.com/blog/filmic-tonemapping-operators/
vec3 CineonToneMapping( vec3 color ) {
  // optimized filmic operator by Jim Hejl and Richard Burgess-Dawson
  color = max( vec3( 0.0 ), color - 0.004 );
  return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}

// nothing
vec3 LinearToneMapping ( vec3 color ) {
  return color;
}

// Matrices for rec 2020 <> rec 709 color space conversion
// matrix provided in row-major order so it has been transposed
// https://www.itu.int/pub/R-REP-BT.2407-2017
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
  vec3( 1.6605, - 0.1246, - 0.0182 ),
  vec3( - 0.5876, 1.1329, - 0.1006 ),
  vec3( - 0.0728, - 0.0083, 1.1187 )
);

const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
  vec3( 0.6274, 0.0691, 0.0164 ),
  vec3( 0.3293, 0.9195, 0.0880 ),
  vec3( 0.0433, 0.0113, 0.8956 )
);

// https://iolite-engine.com/blog_posts/minimal_agx_implementation
// Mean error^2: 3.6705141e-06
vec3 agxDefaultContrastApprox( vec3 x ) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return + 15.5 * x4 * x2
    - 40.14 * x4 * x
    + 31.96 * x4
    - 6.868 * x2 * x
    + 0.4298 * x2
    + 0.1191 * x
    - 0.00232;
}

// AgX Tone Mapping implementation based on Filament, which in turn is based
// on Blender's implementation using rec 2020 primaries
// https://github.com/google/filament/pull/7236
// Inputs and outputs are encoded as Linear-sRGB.

vec3 AgXToneMapping( vec3 color ) {

  // AgX constants
  const mat3 AgXInsetMatrix = mat3(
    vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
    vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
    vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
  );

  // explicit AgXOutsetMatrix generated from Filaments AgXOutsetMatrixInv
  const mat3 AgXOutsetMatrix = mat3(
    vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
    vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
    vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
  );

  // LOG2_MIN      = -10.0
  // LOG2_MAX      =  +6.5
  // MIDDLE_GRAY   =  0.18
  const float AgxMinEv = - 12.47393;  // log2( pow( 2, LOG2_MIN ) * MIDDLE_GRAY )
  const float AgxMaxEv = 4.026069;    // log2( pow( 2, LOG2_MAX ) * MIDDLE_GRAY )

  color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;

  color = AgXInsetMatrix * color;

  // Log2 encoding
  color = max( color, 1e-10 ); // avoid 0 or negative numbers for log2
  color = log2( color );
  color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );

  color = clamp( color, 0.0, 1.0 );

  // Apply sigmoid
  color = agxDefaultContrastApprox( color );

  // Apply AgX look
  // v = agxLook(v, look);

  color = AgXOutsetMatrix * color;

  // Linearize
  color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );

  color = LINEAR_REC2020_TO_LINEAR_SRGB * color;

  // Gamut mapping. Simple clamp for now.
  color = clamp( color, 0.0, 1.0 );

  return color;

}

// https://modelviewer.dev/examples/tone-mapping

vec3 NeutralToneMapping( vec3 color ) {

  const float StartCompression = 0.8 - 0.04;
  const float Desaturation = 0.15;

  float x = min( color.r, min( color.g, color.b ) );

  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;

  color -= offset;

  float peak = max( color.r, max( color.g, color.b ) );

  if ( peak < StartCompression ) return color;

  float d = 1. - StartCompression;

  float newPeak = 1. - d * d / ( peak + d - StartCompression );

  color *= newPeak / peak;

  float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );

  return mix( color, vec3( newPeak ), g );

}



void main() {
  vec4 color = texture2D(map, vUv);

  vec4 exposed = vec4(exposure * color.rgb, color.a);

  vec4 tonemapped = vec4(TONEMAPPING_FUNCTION(exposed.rgb), color.a);

  vec4 adjusted =
    brightnessMatrix( brightness ) *
    contrastMatrix( contrast ) *
    saturationMatrix( saturation ) *
    tonemapped;

  gl_FragColor = adjusted;
}
`;
/**
 * A Material used to adjust the SDR representation of an HDR image
 *
 * @category Materials
 * @group Materials
 */
class SDRMaterial extends ShaderMaterial {
    _brightness = 0;
    _contrast = 1;
    _saturation = 1;
    _exposure = 1;
    _toneMapping;
    _map;
    /**
     *
     * @param params
     */
    constructor({ map, toneMapping }) {
        super({
            name: 'SDRMaterial',
            vertexShader: vertexShader$1,
            fragmentShader: fragmentShader$1,
            uniforms: {
                map: { value: map },
                brightness: { value: 0 },
                contrast: { value: 1 },
                saturation: { value: 1 },
                exposure: { value: 1 }
            },
            blending: NoBlending,
            depthTest: false,
            depthWrite: false
        });
        this._map = map;
        this.toneMapping = this._toneMapping = toneMapping || ACESFilmicToneMapping;
        this.needsUpdate = true;
        this.uniformsNeedUpdate = true;
    }
    get toneMapping() { return this._toneMapping; }
    set toneMapping(value) {
        let valid = false;
        switch (value) {
            case ACESFilmicToneMapping:
                this.defines.TONEMAPPING_FUNCTION = 'ACESFilmicToneMapping';
                valid = true;
                break;
            case ReinhardToneMapping:
                this.defines.TONEMAPPING_FUNCTION = 'ReinhardToneMapping';
                valid = true;
                break;
            case CineonToneMapping:
                this.defines.TONEMAPPING_FUNCTION = 'CineonToneMapping';
                valid = true;
                break;
            case LinearToneMapping:
                this.defines.TONEMAPPING_FUNCTION = 'LinearToneMapping';
                valid = true;
                break;
            case AgXToneMapping:
                this.defines.TONEMAPPING_FUNCTION = 'AgXToneMapping';
                valid = true;
                break;
            case NeutralToneMapping:
                this.defines.TONEMAPPING_FUNCTION = 'NeutralToneMapping';
                valid = true;
                break;
            default:
                console.error(`Unsupported toneMapping: ${value}. Using LinearToneMapping.`);
                this.defines.TONEMAPPING_FUNCTION = 'LinearToneMapping';
                this._toneMapping = LinearToneMapping;
        }
        if (valid) {
            this._toneMapping = value;
        }
        this.needsUpdate = true;
    }
    get brightness() { return this._brightness; }
    set brightness(value) {
        this._brightness = value;
        this.uniforms.brightness.value = value;
    }
    get contrast() { return this._contrast; }
    set contrast(value) {
        this._contrast = value;
        this.uniforms.contrast.value = value;
    }
    get saturation() { return this._saturation; }
    set saturation(value) {
        this._saturation = value;
        this.uniforms.saturation.value = value;
    }
    get exposure() { return this._exposure; }
    set exposure(value) {
        this._exposure = value;
        this.uniforms.exposure.value = value;
    }
    get map() { return this._map; }
    set map(value) {
        this._map = value;
        this.uniforms.map.value = value;
    }
}

/**
 * Renders an SDR Representation of an HDR Image
 *
 * @category Encoding Functions
 * @group Encoding Functions
 *
 * @param hdrTexture The HDR image to be rendered
 * @param renderer (optional) WebGLRenderer to use during the rendering, a disposable renderer will be create and destroyed if this is not provided.
 * @param toneMapping (optional) Tone mapping to be applied to the SDR Rendition
 * @param renderTargetOptions (optional) Options to use when creating the output renderTarget
 * @throws {Error} if the WebGLRenderer fails to render the SDR image
 */
const getSDRRendition = (hdrTexture, renderer, toneMapping, renderTargetOptions) => {
    hdrTexture.needsUpdate = true;
    const quadRenderer = new QuadRenderer({
        width: hdrTexture.image.width,
        height: hdrTexture.image.height,
        type: UnsignedByteType,
        colorSpace: SRGBColorSpace,
        material: new SDRMaterial({ map: hdrTexture, toneMapping }),
        renderer,
        renderTargetOptions
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
 * Encodes a Gainmap starting from an HDR file.
 *
 * @remarks
 * if you do not pass a `renderer` parameter
 * you must manually dispose the result
 * ```js
 * const encodingResult = await encode({ ... })
 * // do something with the buffers
 * const sdr = encodingResult.sdr.getArray()
 * const gainMap = encodingResult.gainMap.getArray()
 * // after that
 * encodingResult.sdr.dispose()
 * encodingResult.gainMap.dispose()
 * ```
 *
 * @category Encoding Functions
 * @group Encoding Functions
 *
 * @example
 * import { encode, findTextureMinMax } from '@monogrid/gainmap-js'
 * import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js'
 *
 * // load an HDR file
 * const loader = new EXRLoader()
 * const image = await loader.loadAsync('image.exr')
 *
 * // find RAW RGB Max value of a texture
 * const textureMax = findTextureMinMax(image)
 *
 * // Encode the gainmap
 * const encodingResult = encode({
 *   image,
 *   // this will encode the full HDR range
 *   maxContentBoost: Math.max.apply(this, textureMax)
 * })
 * // can be re-encoded after changing parameters
 * encodingResult.sdr.material.exposure = 0.9
 * encodingResult.sdr.render()
 * // or
 * encodingResult.gainMap.material.gamma = [1.1, 1.1, 1.1]
 * encodingResult.gainMap.render()
 *
 * // do something with encodingResult.gainMap.toArray()
 * // and encodingResult.sdr.toArray()
 *
 * // renderers must be manually disposed
 * encodingResult.sdr.dispose()
 * encodingResult.gainMap.dispose()
 *
 * @param params Encoding Parameters
 * @returns
 */
const encode = (params) => {
    const { image, renderer } = params;
    const dataTexture = getDataTexture(image);
    const sdr = getSDRRendition(dataTexture, renderer, params.toneMapping, params.renderTargetOptions);
    const gainMapRenderer = getGainMap({
        ...params,
        image: dataTexture,
        sdr,
        renderer: sdr.renderer // reuse the same (maybe disposable?) renderer
    });
    return {
        sdr,
        gainMap: gainMapRenderer,
        hdr: dataTexture,
        getMetadata: () => {
            return {
                gainMapMax: gainMapRenderer.material.gainMapMax,
                gainMapMin: gainMapRenderer.material.gainMapMin,
                gamma: gainMapRenderer.material.gamma,
                hdrCapacityMax: gainMapRenderer.material.hdrCapacityMax,
                hdrCapacityMin: gainMapRenderer.material.hdrCapacityMin,
                offsetHdr: gainMapRenderer.material.offsetHdr,
                offsetSdr: gainMapRenderer.material.offsetSdr
            };
        }
    };
};

/**
 * Encodes a Gainmap starting from an HDR file into compressed file formats (`image/jpeg`, `image/webp` or `image/png`).
 *
 * Uses {@link encode} internally, then pipes the results to {@link compress}.
 *
 * @remarks
 * if a `renderer` parameter is not provided
 * This function will automatically dispose its "disposable"
 * renderer, no need to dispose it manually later
 *
 * @category Encoding Functions
 * @group Encoding Functions
 * @example
 * import { encodeAndCompress, findTextureMinMax } from '@monogrid/gainmap-js'
 * import { encodeJPEGMetadata } from '@monogrid/gainmap-js/libultrahdr'
 * import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js'
 *
 * // load an HDR file
 * const loader = new EXRLoader()
 * const image = await loader.loadAsync('image.exr')
 *
 * // find RAW RGB Max value of a texture
 * const textureMax = findTextureMinMax(image)
 *
 * // Encode the gainmap
 * const encodingResult = await encodeAndCompress({
 *   image,
 *   maxContentBoost: Math.max.apply(this, textureMax),
 *   mimeType: 'image/jpeg'
 * })
 *
 * // embed the compressed images + metadata into a single
 * // JPEG file
 * const jpeg = encodeJPEGMetadata({
 *   ...encodingResult,
 *   sdr: encodingResult.sdr,
 *   gainMap: encodingResult.gainMap
 * })
 *
 * // `jpeg` will be an `Uint8Array` which can be saved somewhere
 *
 *
 * @param params Encoding Parameters
 * @throws {Error} if the browser does not support [createImageBitmap](https://caniuse.com/createimagebitmap)
 */
const encodeAndCompress = async (params) => {
    const encodingResult = encode(params);
    const { mimeType, quality, flipY, withWorker } = params;
    let compressResult;
    let rawSDR;
    let rawGainMap;
    const sdrImageData = new ImageData(encodingResult.sdr.toArray(), encodingResult.sdr.width, encodingResult.sdr.height);
    const gainMapImageData = new ImageData(encodingResult.gainMap.toArray(), encodingResult.gainMap.width, encodingResult.gainMap.height);
    if (withWorker) {
        const workerResult = await Promise.all([
            withWorker.compress({
                source: sdrImageData,
                mimeType,
                quality,
                flipY
            }),
            withWorker.compress({
                source: gainMapImageData,
                mimeType,
                quality,
                flipY
            })
        ]);
        compressResult = workerResult;
        rawSDR = workerResult[0].source;
        rawGainMap = workerResult[1].source;
    }
    else {
        compressResult = await Promise.all([
            compress({
                source: sdrImageData,
                mimeType,
                quality,
                flipY
            }),
            compress({
                source: gainMapImageData,
                mimeType,
                quality,
                flipY
            })
        ]);
        rawSDR = sdrImageData.data;
        rawGainMap = gainMapImageData.data;
    }
    encodingResult.sdr.dispose();
    encodingResult.gainMap.dispose();
    return {
        ...encodingResult,
        ...encodingResult.getMetadata(),
        sdr: compressResult[0],
        gainMap: compressResult[1],
        rawSDR,
        rawGainMap
    };
};

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const fragmentShader = /* glsl */ `
precision mediump float;

#ifndef CELL_SIZE
  #define CELL_SIZE 2
#endif

#ifndef COMPARE_FUNCTION
  #define COMPARE_FUNCTION max
#endif

#ifndef INITIAL_VALUE
  #define INITIAL_VALUE 0
#endif

uniform sampler2D map;
uniform vec2 u_srcResolution;

varying vec2 vUv;

void main() {
  // compute the first pixel the source cell
  vec2 srcPixel = floor(gl_FragCoord.xy) * float(CELL_SIZE);

  // one pixel in source
  vec2 onePixel = vec2(1) / u_srcResolution;

  // uv for first pixel in cell. +0.5 for center of pixel
  vec2 uv = (srcPixel + 0.5) * onePixel;

  vec4 resultColor = vec4(INITIAL_VALUE);

  for (int y = 0; y < CELL_SIZE; ++y) {
    for (int x = 0; x < CELL_SIZE; ++x) {
      resultColor = COMPARE_FUNCTION(resultColor, texture2D(map, uv + vec2(x, y) * onePixel));
    }
  }

  gl_FragColor = resultColor;
}
`;
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
const findTextureMinMax = (image, mode = 'max', renderer) => {
    const srcTex = getDataTexture(image);
    // check if texture has a valid format
    if (srcTex.format !== AlphaFormat &&
        srcTex.format !== RGBFormat &&
        srcTex.format !== RGBAFormat &&
        srcTex.format !== DepthFormat &&
        srcTex.format !== DepthStencilFormat &&
        srcTex.format !== RedFormat &&
        srcTex.format !== RedIntegerFormat &&
        srcTex.format !== RGFormat &&
        srcTex.format !== RGIntegerFormat &&
        srcTex.format !== RGBIntegerFormat &&
        srcTex.format !== RGBAIntegerFormat) {
        throw new Error('Unsupported texture format');
    }
    const cellSize = 2;
    const mat = new ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
            u_srcResolution: { value: new Vector2(srcTex.image.width, srcTex.image.height) },
            map: { value: srcTex }
        },
        defines: {
            CELL_SIZE: cellSize,
            COMPARE_FUNCTION: mode,
            INITIAL_VALUE: mode === 'max' ? 0 : 65504 // max half float value
        }
    });
    srcTex.needsUpdate = true;
    mat.needsUpdate = true;
    let w = srcTex.image.width;
    let h = srcTex.image.height;
    const quadRenderer = new QuadRenderer({
        width: w,
        height: h,
        type: srcTex.type,
        colorSpace: srcTex.colorSpace,
        material: mat,
        renderer
    });
    const frameBuffers = [];
    while (w > 1 || h > 1) {
        w = Math.max(1, (w + cellSize - 1) / cellSize | 0);
        h = Math.max(1, (h + cellSize - 1) / cellSize | 0);
        const fb = new WebGLRenderTarget(w, h, {
            type: quadRenderer.type,
            format: srcTex.format,
            colorSpace: quadRenderer.colorSpace,
            minFilter: NearestFilter,
            magFilter: NearestFilter,
            wrapS: ClampToEdgeWrapping,
            wrapT: ClampToEdgeWrapping,
            generateMipmaps: false,
            depthBuffer: false,
            stencilBuffer: false
        });
        frameBuffers.push(fb);
    }
    w = srcTex.image.width;
    h = srcTex.image.height;
    frameBuffers.forEach((fbi) => {
        w = Math.max(1, (w + cellSize - 1) / cellSize | 0);
        h = Math.max(1, (h + cellSize - 1) / cellSize | 0);
        quadRenderer.renderTarget = fbi;
        quadRenderer.render();
        mat.uniforms.map.value = fbi.texture;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        mat.uniforms.u_srcResolution.value.x = w;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        mat.uniforms.u_srcResolution.value.y = h;
    });
    const out = quadRenderer.toArray();
    quadRenderer.dispose();
    frameBuffers.forEach(fb => fb.dispose());
    return [
        quadRenderer.type === FloatType ? out[0] : DataUtils.fromHalfFloat(out[0]),
        quadRenderer.type === FloatType ? out[1] : DataUtils.fromHalfFloat(out[1]),
        quadRenderer.type === FloatType ? out[2] : DataUtils.fromHalfFloat(out[2])
    ];
};

export { GainMapEncoderMaterial, SDRMaterial, compress, encode, encodeAndCompress, findTextureMinMax, getGainMap, getSDRRendition };
