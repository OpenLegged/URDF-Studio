import { resolveImportedAssetPath } from '@/core/parsers/meshPathUtils';

/** Resolve the same asset closure for model and scene MJCF exports. */
export async function readMjcfExportAsset(
  path: string,
  sourceFiles: ReadonlyMap<string, Blob>,
  assets: Record<string, string> = {},
): Promise<Blob> {
  const candidates = [...new Set([...sourceFiles.keys(), ...Object.keys(assets)])];
  let resolved = sourceFiles.has(path) || assets[path]
    ? path
    : resolveImportedAssetPath(path, undefined, { candidateAssetPaths: candidates });
  if (!sourceFiles.has(resolved) && !assets[resolved]) {
    // USD references can be layer-relative while the closure includes a prefix.
    // A full relative suffix must be unique; do not guess by basename.
    const matches = candidates.filter((candidate) => candidate.endsWith(`/${resolved}`));
    if (matches.length > 1) {
      throw new Error(`MJCF export asset is ambiguous: ${path} (${matches.join(', ')})`);
    }
    if (matches.length === 1) resolved = matches[0];
  }
  const file = sourceFiles.get(resolved || path);
  if (file) return file;
  const url = assets[resolved || path];
  if (!url) throw new Error(`MJCF export asset is unavailable: ${path}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`MJCF export asset failed to load: ${path} (${response.status})`);
  return response.blob();
}

/** Repair JPEG bytes mislabeled as PNG before MuJoCo's strict PNG decoder sees them. */
export async function prepareMjcfTextureBlob(path: string, source: Blob): Promise<Blob> {
  if (!/\.png$/i.test(path)) return source;
  const signature = new Uint8Array(await source.slice(0, 3).arrayBuffer());
  if (signature[0] !== 0xff || signature[1] !== 0xd8 || signature[2] !== 0xff) return source;

  let bitmap: ImageBitmap | undefined;
  try {
    // USD closures may also label the Blob image/png. Decode using the actual
    // content type, preserving resolution and UV orientation; keep source bytes
    // untouched in the original project archive.
    bitmap = await createImageBitmap(new Blob([source], { type: 'image/jpeg' }), {
      imageOrientation: 'none',
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2D image conversion is unavailable.');
    context.drawImage(bitmap, 0, 0);
    return await canvas.convertToBlob({ type: 'image/png' });
  } catch (error) {
    throw new Error(`MJCF texture ${path} contains JPEG data and could not be converted to PNG.`, { cause: error });
  } finally {
    bitmap?.close();
  }
}
