/**
 * @monogrid/gainmap-js v3.4.0
 * With ❤️, by MONOGRID <gainmap@monogrid.com>
 */

import { SRGBColorSpace, LinearSRGBColorSpace, HalfFloatType, Loader, LoadingManager, Texture, UVMapping, ClampToEdgeWrapping, LinearFilter, LinearMipMapLinearFilter, RGBAFormat, UnsignedByteType } from 'three';

/**
 * Shared decode implementation factory
 * Creates a decode function that prepares a QuadRenderer with the given parameters
 */
function createDecodeFunction(config) {
    return (params) => {
        const { sdr, gainMap, renderer } = params;
        if (sdr.colorSpace !== SRGBColorSpace) {
            console.warn('SDR Colorspace needs to be *SRGBColorSpace*, setting it automatically');
            sdr.colorSpace = SRGBColorSpace;
        }
        sdr.needsUpdate = true;
        if (gainMap.colorSpace !== LinearSRGBColorSpace) {
            console.warn('Gainmap Colorspace needs to be *LinearSRGBColorSpace*, setting it automatically');
            gainMap.colorSpace = LinearSRGBColorSpace;
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
            type: HalfFloatType,
            colorSpace: LinearSRGBColorSpace,
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
class LoaderBaseShared extends Loader {
    _renderer;
    _renderTargetOptions;
    _internalLoadingManager;
    _config;
    constructor(config, manager) {
        super(manager);
        this._config = config;
        if (config.renderer)
            this._renderer = config.renderer;
        this._internalLoadingManager = new LoadingManager();
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
            gainMap: new Texture(),
            sdr: new Texture()
        });
        return this._config.createQuadRenderer({
            width: 16,
            height: 16,
            type: HalfFloatType,
            colorSpace: LinearSRGBColorSpace,
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
        const gainMap = new Texture(gainMapImage || new ImageData(2, 2), UVMapping, ClampToEdgeWrapping, ClampToEdgeWrapping, LinearFilter, LinearMipMapLinearFilter, RGBAFormat, UnsignedByteType, 1, LinearSRGBColorSpace);
        gainMap.flipY = needsFlip;
        gainMap.needsUpdate = true;
        const sdr = new Texture(sdrImage, UVMapping, ClampToEdgeWrapping, ClampToEdgeWrapping, LinearFilter, LinearMipMapLinearFilter, RGBAFormat, UnsignedByteType, 1, SRGBColorSpace);
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

export { GainMapNotFoundError as G, LoaderBaseShared as L, MPFExtractor as M, XMPMetadataNotFoundError as X, extractXMP as a, createDecodeFunction as c, extractGainmapFromJPEG as e };
