type BlobBackedTextUsdLike = {
  name: string;
  content: string;
  blobUrl?: string;
};

const LARGE_BLOB_BACKED_TEXT_USD_THRESHOLD = 1024 * 1024;
const LARGE_BLOB_BACKED_TEXT_USD_SAMPLE_SIZE = 2048;

function isAsciiUsdPath(path: string): boolean {
  const normalizedPath = String(path || '').trim().toLowerCase();
  return normalizedPath.endsWith('.usd') || normalizedPath.endsWith('.usda');
}

export function isBlobBackedLargeTextUsd(file: BlobBackedTextUsdLike): boolean {
  return Boolean(
    file.blobUrl
      && typeof file.content === 'string'
      && file.content.length >= LARGE_BLOB_BACKED_TEXT_USD_THRESHOLD
      && isAsciiUsdPath(file.name),
  );
}

export function buildBlobBackedLargeTextUsdSignature(
  file: BlobBackedTextUsdLike,
  hashString: (value: string) => string,
): string {
  const content = String(file.content || '');
  const sampleSize = Math.min(LARGE_BLOB_BACKED_TEXT_USD_SAMPLE_SIZE, content.length);
  const leadingSample = content.slice(0, sampleSize);
  const trailingSample = content.slice(Math.max(0, content.length - sampleSize));
  const sampledHash = hashString(`${leadingSample}\u0000${trailingSample}`);

  return [
    'blob-backed-large-text-usd',
    file.name,
    file.blobUrl ?? '',
    String(content.length),
    sampledHash,
  ].join('\u0000');
}

export function compactBlobBackedLargeTextUsdForWorker<T extends BlobBackedTextUsdLike>(file: T): T {
  if (!isBlobBackedLargeTextUsd(file)) {
    return file;
  }

  return {
    ...file,
    content: '',
  };
}
