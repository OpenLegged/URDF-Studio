/**
 * @monogrid/gainmap-js v3.4.0
 * With ❤️, by MONOGRID <gainmap@monogrid.com>
 */

(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports, require('three'), require('three/webgpu'), require('three/tsl')) :
    typeof define === 'function' && define.amd ? define(['exports', 'three', 'three/webgpu', 'three/tsl'], factory) :
    (global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global["@monogrid/gainmap-js"] = {}, global.three, global["three/webgpu"], global["three/tsl"]));
})(this, (function (exports, three, webgpu, tsl) { 'use strict';

    /**
     * Shared decode implementation factory
     * Creates a decode function that prepares a QuadRenderer with the given parameters
     */
    function createDecodeFunction(config) {
        return (params) => {
            const { sdr, gainMap, renderer } = params;
            if (sdr.colorSpace !== three.SRGBColorSpace) {
                console.warn('SDR Colorspace needs to be *SRGBColorSpace*, setting it automatically');
                sdr.colorSpace = three.SRGBColorSpace;
            }
            sdr.needsUpdate = true;
            if (gainMap.colorSpace !== three.LinearSRGBColorSpace) {
                console.warn('Gainmap Colorspace needs to be *LinearSRGBColorSpace*, setting it automatically');
                gainMap.colorSpace = three.LinearSRGBColorSpace;
            }
            gainMap.needsUpdate = true;
            const material = config.createMaterial({
                ...params,
                sdr,
                gainMap
            });
            const quadRenderer = config.createQuadRenderer({
                width: sdr.image.width,
                height: sdr.image.height,
                type: three.HalfFloatType,
                colorSpace: three.LinearSRGBColorSpace,
                material,
                renderer,
                renderTargetOptions: params.renderTargetOptions
            });
            return quadRenderer;
        };
    }

    class GainMapNotFoundError extends Error {
    }

    class XMPMetadataNotFoundError extends Error {
    }

    const getXMLValue = (xml, tag, defaultValue) => {
        // Check for attribute format first: tag="value"
        const attributeMatch = new RegExp(`${tag}="([^"]*)"`, 'i').exec(xml);
        if (attributeMatch)
            return attributeMatch[1];
        // Check for tag format: <tag>value</tag> or <tag><rdf:li>value</rdf:li>...</tag>
        const tagMatch = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
        if (tagMatch) {
            // Check if it contains rdf:li elements
            const liValues = tagMatch[1].match(/<rdf:li>([^<]*)<\/rdf:li>/g);
            if (liValues && liValues.length === 3) {
                return liValues.map(v => v.replace(/<\/?rdf:li>/g, ''));
            }
            return tagMatch[1].trim();
        }
        if (defaultValue !== undefined)
            return defaultValue;
        throw new Error(`Can't find ${tag} in gainmap metadata`);
    };
    const extractXMP = (input) => {
        let str;
        // support node test environment
        if (typeof TextDecoder !== 'undefined')
            str = new TextDecoder().decode(input);
        else
            str = input.toString();
        let start = str.indexOf('<x:xmpmeta');
        while (start !== -1) {
            const end = str.indexOf('x:xmpmeta>', start);
            const xmpBlock = str.slice(start, end + 10);
            try {
                const gainMapMin = getXMLValue(xmpBlock, 'hdrgm:GainMapMin', '0');
                const gainMapMax = getXMLValue(xmpBlock, 'hdrgm:GainMapMax');
                const gamma = getXMLValue(xmpBlock, 'hdrgm:Gamma', '1');
                const offsetSDR = getXMLValue(xmpBlock, 'hdrgm:OffsetSDR', '0.015625');
                const offsetHDR = getXMLValue(xmpBlock, 'hdrgm:OffsetHDR', '0.015625');
                // These are always attributes, so we can use a simpler regex
                const hdrCapacityMinMatch = /hdrgm:HDRCapacityMin="([^"]*)"/.exec(xmpBlock);
                const hdrCapacityMin = hdrCapacityMinMatch ? hdrCapacityMinMatch[1] : '0';
                const hdrCapacityMaxMatch = /hdrgm:HDRCapacityMax="([^"]*)"/.exec(xmpBlock);
                if (!hdrCapacityMaxMatch)
                    throw new Error('Incomplete gainmap metadata');
                const hdrCapacityMax = hdrCapacityMaxMatch[1];
                return {
                    gainMapMin: Array.isArray(gainMapMin) ? gainMapMin.map(v => parseFloat(v)) : [parseFloat(gainMapMin), parseFloat(gainMapMin), parseFloat(gainMapMin)],
                    gainMapMax: Array.isArray(gainMapMax) ? gainMapMax.map(v => parseFloat(v)) : [parseFloat(gainMapMax), parseFloat(gainMapMax), parseFloat(gainMapMax)],
                    gamma: Array.isArray(gamma) ? gamma.map(v => parseFloat(v)) : [parseFloat(gamma), parseFloat(gamma), parseFloat(gamma)],
                    offsetSdr: Array.isArray(offsetSDR) ? offsetSDR.map(v => parseFloat(v)) : [parseFloat(offsetSDR), parseFloat(offsetSDR), parseFloat(offsetSDR)],
                    offsetHdr: Array.isArray(offsetHDR) ? offsetHDR.map(v => parseFloat(v)) : [parseFloat(offsetHDR), parseFloat(offsetHDR), parseFloat(offsetHDR)],
                    hdrCapacityMin: parseFloat(hdrCapacityMin),
                    hdrCapacityMax: parseFloat(hdrCapacityMax)
                };
            }
            catch (e) {
                // Continue searching for another xmpmeta block if this one fails
            }
            start = str.indexOf('<x:xmpmeta', end);
        }
    };

    /**
     * MPF Extractor (Multi Picture Format Extractor)
     * By Henrik S Nilsson 2019
     *
     * Extracts images stored in images based on the MPF format (found here: https://www.cipa.jp/e/std/std-sec.html
     * under "CIPA DC-007-Translation-2021 Multi-Picture Format"
     *
     * Overly commented, and without intention of being complete or production ready.
     * Created to extract depth maps from iPhone images, and to learn about image metadata.
     * Kudos to: Phil Harvey (exiftool), Jaume Sanchez (android-lens-blur-depth-extractor)
     */
    class MPFExtractor {
        options;
        constructor(options) {
            this.options = {
                debug: options && options.debug !== undefined ? options.debug : false,
                extractFII: options && options.extractFII !== undefined ? options.extractFII : true,
                extractNonFII: options && options.extractNonFII !== undefined ? options.extractNonFII : true
            };
        }
        extract(imageArrayBuffer) {
            return new Promise((resolve, reject) => {
                const debug = this.options.debug;
                const dataView = new DataView(imageArrayBuffer.buffer);
                // If you're executing this line on a big endian machine, it'll be reversed.
                // bigEnd further down though, refers to the endianness of the image itself.
                if (dataView.getUint16(0) !== 0xffd8) {
                    reject(new Error('Not a valid jpeg'));
                    return;
                }
                const length = dataView.byteLength;
                let offset = 2;
                let loops = 0;
                let marker; // APP# marker
                while (offset < length) {
                    if (++loops > 250) {
                        reject(new Error(`Found no marker after ${loops} loops 😵`));
                        return;
                    }
                    if (dataView.getUint8(offset) !== 0xff) {
                        reject(new Error(`Not a valid marker at offset 0x${offset.toString(16)}, found: 0x${dataView.getUint8(offset).toString(16)}`));
                        return;
                    }
                    marker = dataView.getUint8(offset + 1);
                    if (debug)
                        console.log(`Marker: ${marker.toString(16)}`);
                    if (marker === 0xe2) {
                        if (debug)
                            console.log('Found APP2 marker (0xffe2)');
                        // Works for iPhone 8 Plus, X, and XSMax. Or any photos of MPF format.
                        // Great way to visualize image information in html is using Exiftool. E.g.:
                        // ./exiftool.exe -htmldump -wantTrailer photo.jpg > photo.html
                        const formatPt = offset + 4;
                        /*
                         *  Structure of the MP Format Identifier
                         *
                         *  Offset Addr.  | Code (Hex)  | Description
                         *  +00             ff            Marker Prefix      <-- offset
                         *  +01             e2            APP2
                         *  +02             #n            APP2 Field Length
                         *  +03             #n            APP2 Field Length
                         *  +04             4d            'M'                <-- formatPt
                         *  +05             50            'P'
                         *  +06             46            'F'
                         *  +07             00            NULL
                         *                                                   <-- tiffOffset
                         */
                        if (dataView.getUint32(formatPt) === 0x4d504600) {
                            // Found MPF tag, so we start dig out sub images
                            const tiffOffset = formatPt + 4;
                            let bigEnd; // Endianness from TIFF header
                            // Test for TIFF validity and endianness
                            // 0x4949 and 0x4D4D ('II' and 'MM') marks Little Endian and Big Endian
                            if (dataView.getUint16(tiffOffset) === 0x4949) {
                                bigEnd = false;
                            }
                            else if (dataView.getUint16(tiffOffset) === 0x4d4d) {
                                bigEnd = true;
                            }
                            else {
                                reject(new Error('No valid endianness marker found in TIFF header'));
                                return;
                            }
                            if (dataView.getUint16(tiffOffset + 2, !bigEnd) !== 0x002a) {
                                reject(new Error('Not valid TIFF data! (no 0x002A marker)'));
                                return;
                            }
                            // 32 bit number stating the offset from the start of the 8 Byte MP Header
                            // to MP Index IFD Least possible value is thus 8 (means 0 offset)
                            const firstIFDOffset = dataView.getUint32(tiffOffset + 4, !bigEnd);
                            if (firstIFDOffset < 0x00000008) {
                                reject(new Error('Not valid TIFF data! (First offset less than 8)'));
                                return;
                            }
                            // Move ahead to MP Index IFD
                            // Assume we're at the first IFD, so firstIFDOffset points to
                            // MP Index IFD and not MP Attributes IFD. (If we try extract from a sub image,
                            // we fail silently here due to this assumption)
                            // Count (2 Byte) | MP Index Fields a.k.a. MP Entries (count * 12 Byte) | Offset of Next IFD (4 Byte)
                            const dirStart = tiffOffset + firstIFDOffset; // Start of IFD (Image File Directory)
                            const count = dataView.getUint16(dirStart, !bigEnd); // Count of MPEntries (2 Byte)
                            // Extract info from MPEntries (starting after Count)
                            const entriesStart = dirStart + 2;
                            let numberOfImages = 0;
                            for (let i = entriesStart; i < entriesStart + 12 * count; i += 12) {
                                // Each entry is 12 Bytes long
                                // Check MP Index IFD tags, here we only take tag 0xb001 = Number of images
                                if (dataView.getUint16(i, !bigEnd) === 0xb001) {
                                    // stored in Last 4 bytes of its 12 Byte entry.
                                    numberOfImages = dataView.getUint32(i + 8, !bigEnd);
                                }
                            }
                            const nextIFDOffsetLen = 4; // 4 Byte offset field that appears after MP Index IFD tags
                            const MPImageListValPt = dirStart + 2 + count * 12 + nextIFDOffsetLen;
                            const images = [];
                            for (let i = MPImageListValPt; i < MPImageListValPt + numberOfImages * 16; i += 16) {
                                const image = {
                                    MPType: dataView.getUint32(i, !bigEnd),
                                    size: dataView.getUint32(i + 4, !bigEnd),
                                    // This offset is specified relative to the address of the MP Endian
                                    // field in the MP Header, unless the image is a First Individual Image,
                                    // in which case the value of the offset shall be NULL (0x00000000).
                                    dataOffset: dataView.getUint32(i + 8, !bigEnd),
                                    dependantImages: dataView.getUint32(i + 12, !bigEnd),
                                    start: -1,
                                    end: -1,
                                    isFII: false
                                };
                                if (!image.dataOffset) {
                                    // dataOffset is 0x00000000 for First Individual Image
                                    image.start = 0;
                                    image.isFII = true;
                                }
                                else {
                                    image.start = tiffOffset + image.dataOffset;
                                    image.isFII = false;
                                }
                                image.end = image.start + image.size;
                                images.push(image);
                            }
                            if (this.options.extractNonFII && images.length) {
                                const bufferBlob = new Blob([dataView]);
                                const imgs = [];
                                for (const image of images) {
                                    if (image.isFII && !this.options.extractFII) {
                                        continue; // Skip FII
                                    }
                                    const imageBlob = bufferBlob.slice(image.start, image.end + 1, 'image/jpeg');
                                    // we don't need this
                                    // const imageUrl = URL.createObjectURL(imageBlob)
                                    // image.img = document.createElement('img')
                                    // image.img.src = imageUrl
                                    imgs.push(imageBlob);
                                }
                                resolve(imgs);
                            }
                        }
                    }
                    offset += 2 + dataView.getUint16(offset + 2);
                }
            });
        }
    }

    /**
     * Extracts XMP Metadata and the gain map recovery image
     * from a single JPEG file.
     *
     * @category Decoding Functions
     * @group Decoding Functions
     * @param jpegFile an `Uint8Array` containing and encoded JPEG file
     * @returns an sdr `Uint8Array` compressed in JPEG, a gainMap `Uint8Array` compressed in JPEG and the XMP parsed XMP metadata
     * @throws Error if XMP Metadata is not found
     * @throws Error if Gain map image is not found
     * @example
     * import { FileLoader } from 'three'
     * import { extractGainmapFromJPEG } from '@monogrid/gainmap-js'
     *
     * const jpegFile = await new FileLoader()
     *  .setResponseType('arraybuffer')
     *  .loadAsync('image.jpg')
     *
     * const { sdr, gainMap, metadata } = extractGainmapFromJPEG(jpegFile)
     */
    const extractGainmapFromJPEG = async (jpegFile) => {
        const metadata = extractXMP(jpegFile);
        if (!metadata)
            throw new XMPMetadataNotFoundError('Gain map XMP metadata not found');
        const mpfExtractor = new MPFExtractor({ extractFII: true, extractNonFII: true });
        const images = await mpfExtractor.extract(jpegFile);
        if (images.length !== 2)
            throw new GainMapNotFoundError('Gain map recovery image not found');
        return {
            sdr: new Uint8Array(await images[0].arrayBuffer()),
            gainMap: new Uint8Array(await images[1].arrayBuffer()),
            metadata
        };
    };

    /**
     * private function, async get image from blob
     *
     * @param blob
     * @returns
     */
    const getHTMLImageFromBlob = (blob) => {
        return new Promise((resolve, reject) => {
            const img = document.createElement('img');
            img.onload = () => { resolve(img); };
            // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
            img.onerror = (e) => { reject(e); };
            img.src = URL.createObjectURL(blob);
        });
    };

    /**
     * Shared base class for loaders that extracts common logic
     */
    class LoaderBaseShared extends three.Loader {
        _renderer;
        _renderTargetOptions;
        _internalLoadingManager;
        _config;
        constructor(config, manager) {
            super(manager);
            this._config = config;
            if (config.renderer)
                this._renderer = config.renderer;
            this._internalLoadingManager = new three.LoadingManager();
        }
        setRenderer(renderer) {
            this._renderer = renderer;
            return this;
        }
        setRenderTargetOptions(options) {
            this._renderTargetOptions = options;
            return this;
        }
        prepareQuadRenderer() {
            if (!this._renderer) {
                console.warn('WARNING: A Renderer was not passed to this Loader constructor or in setRenderer, the result of this Loader will need to be converted to a Data Texture with toDataTexture() before you can use it in your renderer.');
            }
            const material = this._config.createMaterial({
                gainMapMax: [1, 1, 1],
                gainMapMin: [0, 0, 0],
                gamma: [1, 1, 1],
                offsetHdr: [1, 1, 1],
                offsetSdr: [1, 1, 1],
                hdrCapacityMax: 1,
                hdrCapacityMin: 0,
                maxDisplayBoost: 1,
                gainMap: new three.Texture(),
                sdr: new three.Texture()
            });
            return this._config.createQuadRenderer({
                width: 16,
                height: 16,
                type: three.HalfFloatType,
                colorSpace: three.LinearSRGBColorSpace,
                material,
                renderer: this._renderer,
                renderTargetOptions: this._renderTargetOptions
            });
        }
        async processImages(sdrBuffer, gainMapBuffer, imageOrientation) {
            const gainMapBlob = gainMapBuffer ? new Blob([gainMapBuffer], { type: 'image/jpeg' }) : undefined;
            const sdrBlob = new Blob([sdrBuffer], { type: 'image/jpeg' });
            let sdrImage;
            let gainMapImage;
            let needsFlip = false;
            if (typeof createImageBitmap === 'undefined') {
                const res = await Promise.all([
                    gainMapBlob ? getHTMLImageFromBlob(gainMapBlob) : Promise.resolve(undefined),
                    getHTMLImageFromBlob(sdrBlob)
                ]);
                gainMapImage = res[0];
                sdrImage = res[1];
                needsFlip = imageOrientation === 'flipY';
            }
            else {
                const res = await Promise.all([
                    gainMapBlob ? createImageBitmap(gainMapBlob, { imageOrientation: imageOrientation || 'flipY' }) : Promise.resolve(undefined),
                    createImageBitmap(sdrBlob, { imageOrientation: imageOrientation || 'flipY' })
                ]);
                gainMapImage = res[0];
                sdrImage = res[1];
            }
            return { sdrImage, gainMapImage, needsFlip };
        }
        createTextures(sdrImage, gainMapImage, needsFlip) {
            const gainMap = new three.Texture(gainMapImage || new ImageData(2, 2), three.UVMapping, three.ClampToEdgeWrapping, three.ClampToEdgeWrapping, three.LinearFilter, three.LinearMipMapLinearFilter, three.RGBAFormat, three.UnsignedByteType, 1, three.LinearSRGBColorSpace);
            gainMap.flipY = needsFlip;
            gainMap.needsUpdate = true;
            const sdr = new three.Texture(sdrImage, three.UVMapping, three.ClampToEdgeWrapping, three.ClampToEdgeWrapping, three.LinearFilter, three.LinearMipMapLinearFilter, three.RGBAFormat, three.UnsignedByteType, 1, three.SRGBColorSpace);
            sdr.flipY = needsFlip;
            sdr.needsUpdate = true;
            return { gainMap, sdr };
        }
        updateQuadRenderer(quadRenderer, sdrImage, gainMap, sdr, metadata) {
            quadRenderer.width = sdrImage.width;
            quadRenderer.height = sdrImage.height;
            quadRenderer.material.gainMap = gainMap;
            quadRenderer.material.sdr = sdr;
            quadRenderer.material.gainMapMin = metadata.gainMapMin;
            quadRenderer.material.gainMapMax = metadata.gainMapMax;
            quadRenderer.material.offsetHdr = metadata.offsetHdr;
            quadRenderer.material.offsetSdr = metadata.offsetSdr;
            quadRenderer.material.gamma = metadata.gamma;
            quadRenderer.material.hdrCapacityMin = metadata.hdrCapacityMin;
            quadRenderer.material.hdrCapacityMax = metadata.hdrCapacityMax;
            quadRenderer.material.maxDisplayBoost = Math.pow(2, metadata.hdrCapacityMax);
            quadRenderer.material.needsUpdate = true;
        }
    }

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
                format: webgpu.RGBAFormat,
                depthBuffer: false,
                stencilBuffer: false,
                // user options
                type: this._type, // set in class property
                colorSpace: this._colorSpace, // set in class property
                anisotropy: options.renderTargetOptions?.anisotropy !== undefined ? options.renderTargetOptions?.anisotropy : 1,
                generateMipmaps: options.renderTargetOptions?.generateMipmaps !== undefined ? options.renderTargetOptions?.generateMipmaps : false,
                magFilter: options.renderTargetOptions?.magFilter !== undefined ? options.renderTargetOptions?.magFilter : webgpu.LinearFilter,
                minFilter: options.renderTargetOptions?.minFilter !== undefined ? options.renderTargetOptions?.minFilter : webgpu.LinearFilter,
                samples: options.renderTargetOptions?.samples !== undefined ? options.renderTargetOptions?.samples : undefined,
                wrapS: options.renderTargetOptions?.wrapS !== undefined ? options.renderTargetOptions?.wrapS : webgpu.ClampToEdgeWrapping,
                wrapT: options.renderTargetOptions?.wrapT !== undefined ? options.renderTargetOptions?.wrapT : webgpu.ClampToEdgeWrapping
            };
            this._material = options.material;
            if (options.renderer) {
                this._renderer = options.renderer;
            }
            else {
                this._renderer = QuadRenderer.instantiateRenderer();
                this._rendererIsDisposable = true;
            }
            this._scene = new webgpu.Scene();
            this._camera = new webgpu.OrthographicCamera();
            this._camera.position.set(0, 0, 10);
            this._camera.left = -0.5;
            this._camera.right = 0.5;
            this._camera.top = 0.5;
            this._camera.bottom = -0.5;
            this._camera.updateProjectionMatrix();
            this._quad = new webgpu.Mesh(new webgpu.PlaneGeometry(), this._material);
            this._quad.geometry.computeBoundingBox();
            this._scene.add(this._quad);
            this._renderTarget = new webgpu.RenderTarget(this.width, this.height, rtOptions);
            this._renderTarget.texture.mapping = options.renderTargetOptions?.mapping !== undefined ? options.renderTargetOptions?.mapping : webgpu.UVMapping;
        }
        /**
         * Instantiates a temporary renderer
         *
         * @returns
         */
        static instantiateRenderer() {
            const renderer = new webgpu.WebGPURenderer();
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
            const returnValue = new webgpu.DataTexture(
            // fixed values
            await this.toArray(), this.width, this.height, webgpu.RGBAFormat, this._type, 
            // user values
            options?.mapping || webgpu.UVMapping, options?.wrapS || webgpu.ClampToEdgeWrapping, options?.wrapT || webgpu.ClampToEdgeWrapping, options?.magFilter || webgpu.LinearFilter, options?.minFilter || webgpu.LinearFilter, options?.anisotropy || 1, 
            // fixed value
            webgpu.LinearSRGBColorSpace);
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
            if (this.material instanceof webgpu.ShaderMaterial) {
                Object.values(this.material.uniforms).forEach(v => {
                    if (v.value instanceof webgpu.Texture)
                        v.value.dispose();
                });
            }
            // dispose other material properties
            Object.values(this.material).forEach(value => {
                if (value instanceof webgpu.Texture)
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
    const HALF_FLOAT_MIN = tsl.vec3(-65504, -65504, -65504);
    // max half float value
    const HALF_FLOAT_MAX = tsl.vec3(65504, 65504, 65504);
    /**
     * A Material which is able to decode the Gainmap into a full HDR Representation using TSL (Three.js Shading Language)
     *
     * @category Materials
     * @group Materials
     */
    class GainMapDecoderMaterial extends webgpu.MeshBasicNodeMaterial {
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
            this.blending = webgpu.NoBlending;
            this.depthTest = false;
            this.depthWrite = false;
            this._sdrTexture = tsl.texture(sdr);
            this._gainMapTexture = tsl.texture(gainMap);
            // Create uniform nodes
            this._gammaUniform = tsl.uniform(tsl.vec3(1.0 / gamma[0], 1.0 / gamma[1], 1.0 / gamma[2]));
            this._offsetHdrUniform = tsl.uniform(tsl.vec3(offsetHdr[0], offsetHdr[1], offsetHdr[2]));
            this._offsetSdrUniform = tsl.uniform(tsl.vec3(offsetSdr[0], offsetSdr[1], offsetSdr[2]));
            this._gainMapMinUniform = tsl.uniform(tsl.vec3(gainMapMin[0], gainMapMin[1], gainMapMin[2]));
            this._gainMapMaxUniform = tsl.uniform(tsl.vec3(gainMapMax[0], gainMapMax[1], gainMapMax[2]));
            const weightFactor = (Math.log2(maxDisplayBoost) - hdrCapacityMin) / (hdrCapacityMax - hdrCapacityMin);
            this._weightFactorUniform = tsl.uniform(weightFactor);
            this._maxDisplayBoost = maxDisplayBoost;
            this._hdrCapacityMin = hdrCapacityMin;
            this._hdrCapacityMax = hdrCapacityMax;
            // Build the TSL shader graph
            // Get RGB values
            const rgb = this._sdrTexture.rgb;
            const recovery = this._gainMapTexture.rgb;
            // Apply gamma correction
            const logRecovery = tsl.pow(recovery, this._gammaUniform);
            // Calculate log boost
            // logBoost = gainMapMin * (1.0 - logRecovery) + gainMapMax * logRecovery
            const oneMinusLogRecovery = tsl.sub(tsl.float(1.0), logRecovery);
            const logBoost = tsl.add(tsl.mul(this._gainMapMinUniform, oneMinusLogRecovery), tsl.mul(this._gainMapMaxUniform, logRecovery));
            // Calculate HDR color
            // hdrColor = (rgb + offsetSdr) * exp2(logBoost * weightFactor) - offsetHdr
            const hdrColor = tsl.sub(tsl.mul(tsl.add(rgb, this._offsetSdrUniform), tsl.exp2(tsl.mul(logBoost, this._weightFactorUniform))), this._offsetHdrUniform);
            // Clamp to half float range
            const clampedHdrColor = tsl.max(HALF_FLOAT_MIN, tsl.min(HALF_FLOAT_MAX, hdrColor));
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
        renderer: webgpu.WebGPURenderer,
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
            const sdrLoader = new webgpu.FileLoader(this._internalLoadingManager);
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
            const gainMapLoader = new webgpu.FileLoader(this._internalLoadingManager);
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
            const metadataLoader = new webgpu.FileLoader(this._internalLoadingManager);
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
            const loader = new webgpu.FileLoader(this._internalLoadingManager);
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

    exports.GainMapDecoderMaterial = GainMapDecoderMaterial;
    exports.GainMapLoader = GainMapLoader;
    exports.GainMapNotFoundError = GainMapNotFoundError;
    exports.HDRJPGLoader = HDRJPGLoader;
    exports.JPEGRLoader = HDRJPGLoader;
    exports.LoaderBaseShared = LoaderBaseShared;
    exports.MPFExtractor = MPFExtractor;
    exports.QuadRenderer = QuadRenderer;
    exports.XMPMetadataNotFoundError = XMPMetadataNotFoundError;
    exports.createDecodeFunction = createDecodeFunction;
    exports.decode = decode;
    exports.extractGainmapFromJPEG = extractGainmapFromJPEG;
    exports.extractXMP = extractXMP;

}));
