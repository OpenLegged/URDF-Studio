/**
 * JPEG assembler for creating JPEG-R (JPEG with gain map) files
 * Based on libultrahdr jpegr.cpp implementation
 */
import { GainMapMetadataExtended } from '../core/types';
import { type CompressedImage } from '../encode/types';
/**
 * Options for assembling a JPEG with gain map
 */
export interface AssembleJpegOptions {
    /** Primary (SDR) JPEG image */
    sdr: CompressedImage;
    /** Gain map JPEG image */
    gainMap: CompressedImage;
    /** Gain map metadata */
    metadata: GainMapMetadataExtended;
    /** Optional EXIF data to embed */
    exif?: Uint8Array<ArrayBuffer>;
    /** Optional ICC color profile */
    icc?: Uint8Array<ArrayBuffer>;
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
export declare function assembleJpegWithGainMap(options: AssembleJpegOptions): Uint8Array<ArrayBuffer>;
