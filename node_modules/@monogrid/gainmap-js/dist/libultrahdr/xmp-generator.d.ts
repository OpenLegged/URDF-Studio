/**
 * XMP metadata generator for gain map images
 * Based on libultrahdr jpegrutils.cpp implementation
 */
import { type GainMapMetadataExtended } from '../core/types';
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
export declare function generateXmpForPrimaryImage(secondaryImageLength: number, metadata: GainMapMetadataExtended): string;
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
export declare function generateXmpForSecondaryImage(metadata: GainMapMetadataExtended): string;
