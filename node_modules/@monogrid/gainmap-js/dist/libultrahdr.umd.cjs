/**
 * @monogrid/gainmap-js v3.4.0
 * With ❤️, by MONOGRID <gainmap@monogrid.com>
 */

(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
    typeof define === 'function' && define.amd ? define(['exports'], factory) :
    (global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.libultrahdr = {}));
})(this, (function (exports) { 'use strict';

    /**
     * JPEG marker constants
     * Based on JPEG specification and libultrahdr implementation
     */
    /**
     * JPEG marker prefix - all markers start with this byte
     */
    const MARKER_PREFIX = 0xff;
    /**
     * JPEG markers
     */
    const MARKERS = {
        /** Start of Image */
        SOI: 0xd8,
        /** Application segment 1 (EXIF/XMP) */
        APP1: 0xe1,
        /** Application segment 2 (ICC/MPF) */
        APP2: 0xe2,
        /** Start of Scan */
        SOS: 0xda};
    /**
     * XMP namespace identifier for APP1 marker
     */
    const XMP_NAMESPACE = 'http://ns.adobe.com/xap/1.0/\0';

    /**
     * Multi-Picture Format (MPF) generator
     * Based on CIPA DC-007 specification and libultrahdr multipictureformat.cpp
     *
     * MPF is used to embed multiple images in a single JPEG file
     */
    /**
     * MPF constants from the specification
     */
    const MPF_CONSTANTS = {
        /** MPF signature "MPF\0" */
        SIGNATURE: new Uint8Array([0x4d, 0x50, 0x46, 0x00]),
        /** Big endian marker "MM" */
        BIG_ENDIAN: new Uint8Array([0x4d, 0x4d]),
        /** TIFF magic number */
        TIFF_MAGIC: 0x002a,
        /** Number of pictures in MPF */
        NUM_PICTURES: 2,
        /** Number of tags to serialize */
        TAG_COUNT: 3,
        /** Size of each tag in bytes */
        TAG_SIZE: 12,
        /** Size of each MP entry in bytes */
        MP_ENTRY_SIZE: 16
    };
    /**
     * MPF tag identifiers
     */
    const MPF_TAGS = {
        /** MPF version tag */
        VERSION: 0xb000,
        /** Number of images tag */
        NUMBER_OF_IMAGES: 0xb001,
        /** MP entry tag */
        MP_ENTRY: 0xb002
    };
    /**
     * MPF tag types
     */
    const MPF_TAG_TYPES = {
        /** Undefined type */
        UNDEFINED: 7,
        /** Unsigned long type */
        ULONG: 4
    };
    /**
     * MP entry attributes
     */
    const MP_ENTRY_ATTRIBUTES = {
        /** JPEG format */
        FORMAT_JPEG: 0x00000000,
        /** Primary image type */
        TYPE_PRIMARY: 0x20000000
    };
    /**
     * MPF version string
     */
    const MPF_VERSION = new Uint8Array([0x30, 0x31, 0x30, 0x30]); // "0100"
    /**
     * Calculate the total size of the MPF structure
     */
    function calculateMpfSize() {
        return (MPF_CONSTANTS.SIGNATURE.length + // Signature "MPF\0"
            2 + // Endianness marker
            2 + // TIFF magic number
            4 + // Index IFD Offset
            2 + // Tag count
            MPF_CONSTANTS.TAG_COUNT * MPF_CONSTANTS.TAG_SIZE + // Tags
            4 + // Attribute IFD offset
            MPF_CONSTANTS.NUM_PICTURES * MPF_CONSTANTS.MP_ENTRY_SIZE // MP Entries
        );
    }
    /**
     * Generate MPF (Multi-Picture Format) data structure
     *
     * @param primaryImageSize - Size of the primary image in bytes
     * @param primaryImageOffset - Offset of the primary image (typically 0 for FII - First Individual Image)
     * @param secondaryImageSize - Size of the secondary (gain map) image in bytes
     * @param secondaryImageOffset - Offset of the secondary image from the MP Endian field
     * @returns Uint8Array containing the MPF data
     */
    function generateMpf(primaryImageSize, primaryImageOffset, secondaryImageSize, secondaryImageOffset) {
        const mpfSize = calculateMpfSize();
        const buffer = new ArrayBuffer(mpfSize);
        const view = new DataView(buffer);
        const uint8View = new Uint8Array(buffer);
        let pos = 0;
        // Write MPF signature "MPF\0"
        uint8View.set(MPF_CONSTANTS.SIGNATURE, pos);
        pos += MPF_CONSTANTS.SIGNATURE.length;
        // Write endianness marker (big endian "MM")
        // Using big endian to match the C++ implementation's USE_BIG_ENDIAN
        uint8View.set(MPF_CONSTANTS.BIG_ENDIAN, pos);
        const bigEndian = false; // DataView uses little endian by default, so we need to flip this
        pos += 2;
        // Write TIFF magic number (0x002A)
        view.setUint16(pos, MPF_CONSTANTS.TIFF_MAGIC, bigEndian);
        pos += 2;
        // Set the Index IFD offset
        // This offset is from the start of the TIFF header (the endianness marker)
        // After: endianness (2) + magic (2) + this offset field (4) = 8 bytes
        const indexIfdOffset = 8;
        view.setUint32(pos, indexIfdOffset, bigEndian);
        pos += 4;
        // Write tag count (3 tags: version, number of images, MP entries)
        view.setUint16(pos, MPF_CONSTANTS.TAG_COUNT, bigEndian);
        pos += 2;
        // Write version tag
        view.setUint16(pos, MPF_TAGS.VERSION, bigEndian);
        pos += 2;
        view.setUint16(pos, MPF_TAG_TYPES.UNDEFINED, bigEndian);
        pos += 2;
        view.setUint32(pos, MPF_VERSION.length, bigEndian);
        pos += 4;
        uint8View.set(MPF_VERSION, pos);
        pos += 4; // Version is 4 bytes, embedded in the tag
        // Write number of images tag
        view.setUint16(pos, MPF_TAGS.NUMBER_OF_IMAGES, bigEndian);
        pos += 2;
        view.setUint16(pos, MPF_TAG_TYPES.ULONG, bigEndian);
        pos += 2;
        view.setUint32(pos, 1, bigEndian); // Count = 1
        pos += 4;
        view.setUint32(pos, MPF_CONSTANTS.NUM_PICTURES, bigEndian);
        pos += 4;
        // Write MP entry tag
        view.setUint16(pos, MPF_TAGS.MP_ENTRY, bigEndian);
        pos += 2;
        view.setUint16(pos, MPF_TAG_TYPES.UNDEFINED, bigEndian);
        pos += 2;
        view.setUint32(pos, MPF_CONSTANTS.MP_ENTRY_SIZE * MPF_CONSTANTS.NUM_PICTURES, bigEndian);
        pos += 4;
        // Calculate MP entry offset
        // The offset is from the start of the MP Endian field (after signature)
        // Current position is at the value field of MP Entry tag
        const mpEntryOffset = pos - MPF_CONSTANTS.SIGNATURE.length + 4 + 4;
        view.setUint32(pos, mpEntryOffset, bigEndian);
        pos += 4;
        // Write attribute IFD offset (0 = none)
        view.setUint32(pos, 0, bigEndian);
        pos += 4;
        // Write MP entries for primary image
        // Attribute format: JPEG (0x00000000) | Type: Primary (0x20000000)
        view.setUint32(pos, MP_ENTRY_ATTRIBUTES.FORMAT_JPEG | MP_ENTRY_ATTRIBUTES.TYPE_PRIMARY, bigEndian);
        pos += 4;
        view.setUint32(pos, primaryImageSize, bigEndian);
        pos += 4;
        view.setUint32(pos, primaryImageOffset, bigEndian);
        pos += 4;
        view.setUint16(pos, 0, bigEndian); // Dependent image 1
        pos += 2;
        view.setUint16(pos, 0, bigEndian); // Dependent image 2
        pos += 2;
        // Write MP entries for secondary image (gain map)
        // Attribute format: JPEG only (no type flag)
        view.setUint32(pos, MP_ENTRY_ATTRIBUTES.FORMAT_JPEG, bigEndian);
        pos += 4;
        view.setUint32(pos, secondaryImageSize, bigEndian);
        pos += 4;
        view.setUint32(pos, secondaryImageOffset, bigEndian);
        pos += 4;
        view.setUint16(pos, 0, bigEndian); // Dependent image 1
        pos += 2;
        view.setUint16(pos, 0, bigEndian); // Dependent image 2
        // pos += 2
        return uint8View;
    }

    /**
     * XMP metadata generator for gain map images
     * Based on libultrahdr jpegrutils.cpp implementation
     */
    /**
     * Item semantic types
     */
    const ITEM_SEMANTIC = {
        PRIMARY: 'Primary',
        GAIN_MAP: 'GainMap'
    };
    /**
     * MIME type for JPEG images
     */
    const MIME_IMAGE_JPEG = 'image/jpeg';
    /**
     * Escape XML special characters
     */
    function escapeXml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }
    /**
     * Generate XMP metadata for the primary image
     *
     * This XMP contains:
     * - Container directory with references to primary and gain map images
     * - Gain map version
     * - Item metadata for both images
     *
     * @param secondaryImageLength - Length of the secondary (gain map) JPEG in bytes
     * @param metadata - Gain map metadata
     * @returns XMP packet as string
     */
    function generateXmpForPrimaryImage(secondaryImageLength, metadata) {
        const lines = [];
        // XMP packet header
        lines.push('<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>');
        lines.push('<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 5.1.2">');
        lines.push('  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">');
        lines.push('    <rdf:Description');
        lines.push('      xmlns:Container="http://ns.google.com/photos/1.0/container/"');
        lines.push('      xmlns:Item="http://ns.google.com/photos/1.0/container/item/"');
        lines.push('      xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/"');
        lines.push(`      hdrgm:Version="${escapeXml(metadata.version)}"`);
        lines.push('      rdf:about="">');
        // Container directory
        lines.push('      <Container:Directory>');
        lines.push('        <rdf:Seq>');
        // Primary image item
        lines.push('          <rdf:li rdf:parseType="Resource">');
        lines.push('            <Container:Item');
        lines.push(`              Item:Semantic="${ITEM_SEMANTIC.PRIMARY}"`);
        lines.push(`              Item:Mime="${MIME_IMAGE_JPEG}"/>`);
        lines.push('          </rdf:li>');
        // Gain map image item
        lines.push('          <rdf:li rdf:parseType="Resource">');
        lines.push('            <Container:Item');
        lines.push(`              Item:Semantic="${ITEM_SEMANTIC.GAIN_MAP}"`);
        lines.push(`              Item:Mime="${MIME_IMAGE_JPEG}"`);
        lines.push(`              Item:Length="${secondaryImageLength}"/>`);
        lines.push('          </rdf:li>');
        lines.push('        </rdf:Seq>');
        lines.push('      </Container:Directory>');
        lines.push('    </rdf:Description>');
        lines.push('  </rdf:RDF>');
        lines.push('</x:xmpmeta>');
        lines.push('<?xpacket end="w"?>');
        return lines.join('\n');
    }
    /**
     * Generate XMP metadata for the secondary (gain map) image
     *
     * This XMP contains all the gain map parameters:
     * - Version
     * - Gain map min/max
     * - Gamma
     * - Offset SDR/HDR
     * - HDR capacity min/max
     * - Base rendition flag
     *
     * @param metadata - Gain map metadata
     * @returns XMP packet as string
     */
    function generateXmpForSecondaryImage(metadata) {
        const lines = [];
        // hdrCapacityMin/Max are already in log2 space (from GainMapEncoderMaterial)
        // No conversion needed
        const hdrCapacityMin = metadata.hdrCapacityMin;
        const hdrCapacityMax = metadata.hdrCapacityMax;
        // Handle array values - take average if array, or use single value
        const getAverage = (val) => {
            if (Array.isArray(val)) {
                return val.reduce((sum, v) => sum + v, 0) / val.length;
            }
            return val;
        };
        const gainMapMinAvg = getAverage(metadata.gainMapMin);
        const gainMapMaxAvg = getAverage(metadata.gainMapMax);
        const gammaAvg = getAverage(metadata.gamma);
        const offsetSdrAvg = getAverage(metadata.offsetSdr);
        const offsetHdrAvg = getAverage(metadata.offsetHdr);
        // XMP packet header
        lines.push('<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>');
        lines.push('<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 5.1.2">');
        lines.push('  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">');
        lines.push('    <rdf:Description');
        lines.push('      xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/"');
        lines.push(`      hdrgm:Version="${escapeXml(metadata.version)}"`);
        lines.push(`      hdrgm:GainMapMin="${escapeXml(gainMapMinAvg)}"`);
        lines.push(`      hdrgm:GainMapMax="${escapeXml(gainMapMaxAvg)}"`);
        lines.push(`      hdrgm:Gamma="${escapeXml(gammaAvg)}"`);
        lines.push(`      hdrgm:OffsetSDR="${escapeXml(offsetSdrAvg)}"`);
        lines.push(`      hdrgm:OffsetHDR="${escapeXml(offsetHdrAvg)}"`);
        lines.push(`      hdrgm:HDRCapacityMin="${escapeXml(hdrCapacityMin)}"`);
        lines.push(`      hdrgm:HDRCapacityMax="${escapeXml(hdrCapacityMax)}"`);
        lines.push('      hdrgm:BaseRenditionIsHDR="False"');
        lines.push('      rdf:about=""/>');
        lines.push('  </rdf:RDF>');
        lines.push('</x:xmpmeta>');
        lines.push('<?xpacket end="w"?>');
        return lines.join('\n');
    }

    /**
     * JPEG assembler for creating JPEG-R (JPEG with gain map) files
     * Based on libultrahdr jpegr.cpp implementation
     */
    /**
     * Extract EXIF data from a JPEG if present
     *
     * @param jpegData - JPEG file data
     * @returns Object containing EXIF data and position, or null if not found
     */
    function extractExif(jpegData) {
        const view = new DataView(jpegData.buffer, jpegData.byteOffset, jpegData.byteLength);
        // Check for JPEG SOI marker
        if (view.getUint8(0) !== MARKER_PREFIX || view.getUint8(1) !== MARKERS.SOI) {
            return null;
        }
        let offset = 2;
        const EXIF_SIGNATURE = 'Exif\0\0';
        while (offset < jpegData.length - 1) {
            // Check for marker prefix
            if (view.getUint8(offset) !== MARKER_PREFIX) {
                break;
            }
            const marker = view.getUint8(offset + 1);
            // Check for SOS (Start of Scan) - end of metadata
            if (marker === MARKERS.SOS) {
                break;
            }
            // Check for APP1 marker (EXIF/XMP)
            if (marker === MARKERS.APP1) {
                const length = view.getUint16(offset + 2, false); // Big endian
                const dataStart = offset + 4;
                // Check if this APP1 contains EXIF
                let isExif = true;
                for (let i = 0; i < EXIF_SIGNATURE.length; i++) {
                    if (dataStart + i >= jpegData.length || jpegData[dataStart + i] !== EXIF_SIGNATURE.charCodeAt(i)) {
                        isExif = false;
                        break;
                    }
                }
                if (isExif) {
                    // Found EXIF data
                    const exifSize = length - 2; // Length includes the 2-byte length field itself
                    const exifData = jpegData.slice(dataStart, dataStart + exifSize);
                    return {
                        data: exifData,
                        pos: offset,
                        size: length + 2 // Include marker (2 bytes) + length (2 bytes) + data
                    };
                }
            }
            // Move to next marker
            const length = view.getUint16(offset + 2, false);
            offset += 2 + length;
        }
        return null;
    }
    /**
     * Copy JPEG data without EXIF segment
     *
     * @param jpegData - Original JPEG data
     * @param exifPos - Position of EXIF segment
     * @param exifSize - Size of EXIF segment (including marker and length)
     * @returns JPEG data without EXIF
     */
    function copyJpegWithoutExif(jpegData, exifPos, exifSize) {
        const newSize = jpegData.length - exifSize;
        const result = new Uint8Array(newSize);
        // Copy data before EXIF
        result.set(jpegData.subarray(0, exifPos), 0);
        // Copy data after EXIF
        result.set(jpegData.subarray(exifPos + exifSize), exifPos);
        return result;
    }
    /**
     * Write a JPEG marker and its data
     *
     * @param buffer - Target buffer
     * @param pos - Current position in buffer
     * @param marker - Marker type (without 0xFF prefix)
     * @param data - Data to write after marker
     * @returns New position after writing
     */
    function writeMarker(buffer, pos, marker, data) {
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        // Write marker
        view.setUint8(pos++, MARKER_PREFIX);
        view.setUint8(pos++, marker);
        // Write data if present
        if (data && data.length > 0) {
            // Write length (big endian, includes the 2-byte length field itself)
            const length = data.length + 2;
            view.setUint16(pos, length, false);
            pos += 2;
            // Write data
            buffer.set(data, pos);
            pos += data.length;
        }
        return pos;
    }
    /**
     * Assemble a JPEG-R file (JPEG with embedded gain map)
     *
     * The structure is:
     * 1. Primary image:
     *    - SOI
     *    - APP1 (EXIF if present)
     *    - APP1 (XMP with gain map metadata)
     *    - APP2 (ICC profile if present)
     *    - APP2 (MPF data)
     *    - Rest of primary JPEG data
     * 2. Secondary image (gain map):
     *    - SOI
     *    - APP1 (XMP with gain map parameters)
     *    - Rest of gain map JPEG data
     *
     * @param options - Assembly options
     * @returns Complete JPEG-R file as Uint8Array
     */
    function assembleJpegWithGainMap(options) {
        const { sdr, gainMap, metadata, exif: externalExif, icc } = options;
        // Validate input
        if (sdr.mimeType !== 'image/jpeg') {
            throw new Error('SDR image must be JPEG format');
        }
        if (gainMap.mimeType !== 'image/jpeg') {
            throw new Error('Gain map image must be JPEG format');
        }
        // Check for EXIF in primary image
        const exifFromJpeg = extractExif(sdr.data);
        if (exifFromJpeg && externalExif) {
            throw new Error('Primary image already contains EXIF data, cannot add external EXIF');
        }
        // Prepare primary JPEG (remove embedded EXIF if present)
        let primaryJpegData = sdr.data;
        let exifData = externalExif;
        if (exifFromJpeg) {
            primaryJpegData = copyJpegWithoutExif(sdr.data, exifFromJpeg.pos, exifFromJpeg.size);
            exifData = exifFromJpeg.data;
        }
        // Generate XMP for secondary image
        const xmpSecondary = generateXmpForSecondaryImage(metadata);
        const xmpSecondaryBytes = new TextEncoder().encode(xmpSecondary);
        // Calculate secondary image size
        // 2 bytes SOI + 2 bytes marker + 2 bytes length field + namespace + XMP data + gain map data (without SOI)
        const namespaceBytes = new TextEncoder().encode(XMP_NAMESPACE);
        const secondaryImageSize = 2 + 2 + 2 + namespaceBytes.length + xmpSecondaryBytes.length + (gainMap.data.length - 2);
        // Generate XMP for primary image
        const xmpPrimary = generateXmpForPrimaryImage(secondaryImageSize, metadata);
        const xmpPrimaryBytes = new TextEncoder().encode(xmpPrimary);
        const xmpPrimaryData = new Uint8Array(namespaceBytes.length + xmpPrimaryBytes.length);
        xmpPrimaryData.set(namespaceBytes, 0);
        xmpPrimaryData.set(xmpPrimaryBytes, namespaceBytes.length);
        // Calculate MPF size and offset
        const mpfLength = calculateMpfSize();
        // Calculate total size
        let totalSize = 2; // SOI
        if (exifData)
            totalSize += 2 + 2 + exifData.length; // APP1 + length + EXIF
        totalSize += 2 + 2 + xmpPrimaryData.length; // APP1 + length + XMP primary
        if (icc)
            totalSize += 2 + 2 + icc.length; // APP2 + length + ICC
        totalSize += 2 + 2 + mpfLength; // APP2 + length + MPF
        totalSize += primaryJpegData.length - 2; // Primary JPEG without SOI
        totalSize += secondaryImageSize; // Secondary image
        // Calculate offsets for MPF
        const primaryImageSize = totalSize - secondaryImageSize;
        // Offset is from MP Endian field (after APP2 marker + length + MPF signature)
        const secondaryImageOffset = primaryImageSize - (2 + // SOI
            (exifData ? 2 + 2 + exifData.length : 0) +
            2 + 2 + xmpPrimaryData.length +
            (icc ? 2 + 2 + icc.length : 0) +
            2 + 2 + 4 // APP2 marker + length + MPF signature
        );
        // Generate MPF data
        const mpfDataActual = generateMpf(primaryImageSize, 0, secondaryImageSize, secondaryImageOffset);
        // Allocate output buffer
        const output = new Uint8Array(totalSize);
        let pos = 0;
        // === PRIMARY IMAGE ===
        // Write SOI
        pos = writeMarker(output, pos, MARKERS.SOI);
        // Write EXIF if present
        if (exifData) {
            pos = writeMarker(output, pos, MARKERS.APP1, exifData);
        }
        // Write XMP for primary image (already created above)
        pos = writeMarker(output, pos, MARKERS.APP1, xmpPrimaryData);
        // Write ICC profile if present
        if (icc) {
            pos = writeMarker(output, pos, MARKERS.APP2, icc);
        }
        // Write MPF
        pos = writeMarker(output, pos, MARKERS.APP2, mpfDataActual);
        // Write rest of primary JPEG (skip SOI)
        output.set(primaryJpegData.subarray(2), pos);
        pos += primaryJpegData.length - 2;
        // === SECONDARY IMAGE (GAIN MAP) ===
        // Write SOI
        pos = writeMarker(output, pos, MARKERS.SOI);
        // Write XMP for secondary image
        const xmpSecondaryData = new Uint8Array(namespaceBytes.length + xmpSecondaryBytes.length);
        xmpSecondaryData.set(namespaceBytes, 0);
        xmpSecondaryData.set(xmpSecondaryBytes, namespaceBytes.length);
        pos = writeMarker(output, pos, MARKERS.APP1, xmpSecondaryData);
        // Write rest of gain map JPEG (skip SOI)
        output.set(gainMap.data.subarray(2), pos);
        // pos += gainMap.data.length - 2
        return output;
    }

    /**
     * Encapsulates a Gainmap into a single JPEG file (aka: JPEG-R) with the base map
     * as the sdr visualization and the gainMap encoded into a MPF (Multi-Picture Format) tag.
     *
     * @category Encoding
     * @group Encoding
     *
     * @example
     * import { compress, encode, findTextureMinMax } from '@monogrid/gainmap-js'
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
     * const encodingResult = encode({
     *   image,
     *   maxContentBoost: Math.max.apply(this, textureMax)
     * })
     *
     * // obtain the RAW RGBA SDR buffer and create an ImageData
     * const sdrImageData = new ImageData(
     *   encodingResult.sdr.toArray(),
     *   encodingResult.sdr.width,
     *   encodingResult.sdr.height
     * )
     * // obtain the RAW RGBA Gain map buffer and create an ImageData
     * const gainMapImageData = new ImageData(
     *   encodingResult.gainMap.toArray(),
     *   encodingResult.gainMap.width,
     *   encodingResult.gainMap.height
     * )
     *
     * // parallel compress the RAW buffers into the specified mimeType
     * const mimeType = 'image/jpeg'
     * const quality = 0.9
     *
     * const [sdr, gainMap] = await Promise.all([
     *   compress({
     *     source: sdrImageData,
     *     mimeType,
     *     quality,
     *     flipY: true // output needs to be flipped
     *   }),
     *   compress({
     *     source: gainMapImageData,
     *     mimeType,
     *     quality,
     *     flipY: true // output needs to be flipped
     *   })
     * ])
     *
     * // obtain the metadata which will be embedded into
     * // and XMP tag inside the final JPEG file
     * const metadata = encodingResult.getMetadata()
     *
     * // embed the compressed images + metadata into a single
     * // JPEG file
     * const jpeg = encodeJPEGMetadata({
     *   ...encodingResult,
     *   ...metadata,
     *   sdr,
     *   gainMap
     * })
     *
     * // `jpeg` will be an `Uint8Array` which can be saved somewhere
     *
     *
     * @param encodingResult - Encoding result containing SDR image, gain map image, and metadata
     * @returns A Uint8Array representing a JPEG-R file
     * @throws {Error} If `encodingResult.sdr.mimeType !== 'image/jpeg'`
     * @throws {Error} If `encodingResult.gainMap.mimeType !== 'image/jpeg'`
     */
    const encodeJPEGMetadata = (encodingResult) => {
        // Validate input
        if (encodingResult.sdr.mimeType !== 'image/jpeg') {
            throw new Error('This function expects an SDR image compressed in jpeg');
        }
        if (encodingResult.gainMap.mimeType !== 'image/jpeg') {
            throw new Error('This function expects a GainMap image compressed in jpeg');
        }
        // Prepare metadata with proper conversions
        // The XMP generator handles the log2 conversion internally for gain map min/max values
        const metadata = {
            version: '1.0',
            gainMapMin: encodingResult.gainMapMin,
            gainMapMax: encodingResult.gainMapMax,
            gamma: encodingResult.gamma,
            offsetSdr: encodingResult.offsetSdr,
            offsetHdr: encodingResult.offsetHdr,
            hdrCapacityMin: encodingResult.hdrCapacityMin,
            hdrCapacityMax: encodingResult.hdrCapacityMax,
            minContentBoost: Array.isArray(encodingResult.gainMapMin)
                ? Math.pow(2, encodingResult.gainMapMin.reduce((a, b) => a + b, 0) / encodingResult.gainMapMin.length)
                : Math.pow(2, encodingResult.gainMapMin),
            maxContentBoost: Array.isArray(encodingResult.gainMapMax)
                ? Math.pow(2, encodingResult.gainMapMax.reduce((a, b) => a + b, 0) / encodingResult.gainMapMax.length)
                : Math.pow(2, encodingResult.gainMapMax)
        };
        // Assemble the JPEG with gain map using pure JavaScript
        return assembleJpegWithGainMap({
            sdr: encodingResult.sdr,
            gainMap: encodingResult.gainMap,
            metadata
        });
    };

    exports.encodeJPEGMetadata = encodeJPEGMetadata;

}));
