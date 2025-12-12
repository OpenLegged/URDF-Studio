/**
 * Multi-Picture Format (MPF) generator
 * Based on CIPA DC-007 specification and libultrahdr multipictureformat.cpp
 *
 * MPF is used to embed multiple images in a single JPEG file
 */
/**
 * Calculate the total size of the MPF structure
 */
export declare function calculateMpfSize(): number;
/**
 * Generate MPF (Multi-Picture Format) data structure
 *
 * @param primaryImageSize - Size of the primary image in bytes
 * @param primaryImageOffset - Offset of the primary image (typically 0 for FII - First Individual Image)
 * @param secondaryImageSize - Size of the secondary (gain map) image in bytes
 * @param secondaryImageOffset - Offset of the secondary image from the MP Endian field
 * @returns Uint8Array containing the MPF data
 */
export declare function generateMpf(primaryImageSize: number, primaryImageOffset: number, secondaryImageSize: number, secondaryImageOffset: number): Uint8Array<ArrayBuffer>;
