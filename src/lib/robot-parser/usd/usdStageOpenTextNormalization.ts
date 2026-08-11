const INSTANCEABLE_VISUAL_REFERENCE_PATTERN = /prepend references\s*=\s*<\/visuals\//i;
const INSTANCEABLE_VISUAL_REFERENCE_TOKEN = 'prepend references = </visuals/';
const TOP_LEVEL_VISUAL_SCOPE_HEADER = 'def Scope "visuals"';
const INVISIBLE_VISIBILITY_LINE_PATTERN = /^(\s*)token visibility = "invisible"\s*$/;
const GUIDE_PURPOSE_LINE_PATTERN = /^(\s*)(?:uniform\s+)?token purpose = "guide"\s*$/;
const USDA_NORMALIZATION_PROBE_CHUNK_SIZE = 64 * 1024;
const USDA_NORMALIZATION_PROBE_TAIL_LENGTH =
  Math.max(INSTANCEABLE_VISUAL_REFERENCE_TOKEN.length, TOP_LEVEL_VISUAL_SCOPE_HEADER.length) - 1;

export const USD_INSTANCEABLE_VISUAL_SCOPE_NORMALIZATION_VERSION = 'instanceable-visual-scope-v1';

function countOccurrences(source: string, token: string): number {
  if (!source || !token) {
    return 0;
  }

  let count = 0;
  let searchIndex = 0;
  while (searchIndex < source.length) {
    const nextIndex = source.indexOf(token, searchIndex);
    if (nextIndex < 0) {
      break;
    }
    count += 1;
    searchIndex = nextIndex + token.length;
  }

  return count;
}

function hasUsdInstanceableVisualScopeNormalizationTriggers(text: string): boolean {
  return (
    typeof text === 'string' &&
    text.length > 0 &&
    INSTANCEABLE_VISUAL_REFERENCE_PATTERN.test(text) &&
    text.includes(TOP_LEVEL_VISUAL_SCOPE_HEADER)
  );
}

async function* iterateBlobTextChunks(blob: Blob): AsyncGenerator<string, void, void> {
  if (typeof blob.stream === 'function') {
    const reader = blob.stream().getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        if (chunk.length > 0) {
          yield chunk;
        }
      }

      const trailingChunk = decoder.decode();
      if (trailingChunk.length > 0) {
        yield trailingChunk;
      }
      return;
    } finally {
      reader.releaseLock();
    }
  }

  const decoder = new TextDecoder();
  for (let offset = 0; offset < blob.size; offset += USDA_NORMALIZATION_PROBE_CHUNK_SIZE) {
    const chunkBuffer = await blob
      .slice(offset, offset + USDA_NORMALIZATION_PROBE_CHUNK_SIZE)
      .arrayBuffer();
    const chunk = decoder.decode(new Uint8Array(chunkBuffer), {
      stream: offset + USDA_NORMALIZATION_PROBE_CHUNK_SIZE < blob.size,
    });
    if (chunk.length > 0) {
      yield chunk;
    }
  }

  const trailingChunk = decoder.decode();
  if (trailingChunk.length > 0) {
    yield trailingChunk;
  }
}

export async function blobNeedsUsdInstanceableVisualScopeNormalization(
  blob: Blob,
): Promise<boolean> {
  if (!(blob instanceof Blob) || blob.size === 0) {
    return false;
  }

  let hasReferenceToken = false;
  let hasVisualScopeHeader = false;
  let tail = '';

  for await (const chunk of iterateBlobTextChunks(blob)) {
    const combinedChunk = `${tail}${chunk}`;
    if (!hasReferenceToken) {
      hasReferenceToken = combinedChunk.toLowerCase().includes(INSTANCEABLE_VISUAL_REFERENCE_TOKEN);
    }
    if (!hasVisualScopeHeader) {
      hasVisualScopeHeader = combinedChunk.includes(TOP_LEVEL_VISUAL_SCOPE_HEADER);
    }

    if (hasReferenceToken && hasVisualScopeHeader) {
      return true;
    }

    tail = combinedChunk.slice(-USDA_NORMALIZATION_PROBE_TAIL_LENGTH);
  }

  return false;
}

export function normalizeUsdInstanceableVisualScopeVisibility(text: string): string {
  if (!hasUsdInstanceableVisualScopeNormalizationTriggers(text)) {
    return text;
  }

  const lines = text.split(/\r?\n/);
  let changed = false;

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] !== TOP_LEVEL_VISUAL_SCOPE_HEADER) {
      continue;
    }

    let visualScopeBraceDepth = 0;
    let visualScopeOpened = false;

    for (let scopeLineIndex = index + 1; scopeLineIndex < lines.length; scopeLineIndex += 1) {
      const line = lines[scopeLineIndex] ?? '';

      if (!visualScopeOpened) {
        if (line.trim().startsWith('{')) {
          visualScopeOpened = true;
          visualScopeBraceDepth = countOccurrences(line, '{') - countOccurrences(line, '}');
        }
        continue;
      }

      const visibilityMatch = line.match(INVISIBLE_VISIBILITY_LINE_PATTERN);
      if (visibilityMatch) {
        lines[scopeLineIndex] = `${visibilityMatch[1] || ''}token visibility = "inherited"`;
        changed = true;
      }

      const guidePurposeMatch = line.match(GUIDE_PURPOSE_LINE_PATTERN);
      if (guidePurposeMatch) {
        lines[scopeLineIndex] = `${guidePurposeMatch[1] || ''}uniform token purpose = "render"`;
        changed = true;
      }

      visualScopeBraceDepth += countOccurrences(line, '{');
      visualScopeBraceDepth -= countOccurrences(line, '}');

      if (visualScopeBraceDepth <= 0) {
        return changed ? lines.join('\n') : text;
      }
    }

    return changed ? lines.join('\n') : text;
  }

  return changed ? lines.join('\n') : text;
}
