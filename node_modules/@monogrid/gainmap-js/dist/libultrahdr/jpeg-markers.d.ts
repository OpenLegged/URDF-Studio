/**
 * JPEG marker constants
 * Based on JPEG specification and libultrahdr implementation
 */
/**
 * JPEG marker prefix - all markers start with this byte
 */
export declare const MARKER_PREFIX = 255;
/**
 * JPEG markers
 */
export declare const MARKERS: {
    /** Start of Image */
    readonly SOI: 216;
    /** End of Image */
    readonly EOI: 217;
    /** Application segment 0 */
    readonly APP0: 224;
    /** Application segment 1 (EXIF/XMP) */
    readonly APP1: 225;
    /** Application segment 2 (ICC/MPF) */
    readonly APP2: 226;
    /** Start of Scan */
    readonly SOS: 218;
    /** Define Quantization Table */
    readonly DQT: 219;
    /** Define Huffman Table */
    readonly DHT: 196;
    /** Start of Frame (baseline DCT) */
    readonly SOF0: 192;
};
/**
 * XMP namespace identifier for APP1 marker
 */
export declare const XMP_NAMESPACE = "http://ns.adobe.com/xap/1.0/\0";
/**
 * EXIF identifier for APP1 marker
 */
export declare const EXIF_IDENTIFIER = "Exif\0\0";
/**
 * MPF signature for APP2 marker
 */
export declare const MPF_SIGNATURE = "MPF\0";
/**
 * ICC profile identifier for APP2 marker
 */
export declare const ICC_IDENTIFIER = "ICC_PROFILE\0";
