export interface NormalizePathKeyOptions {
  leadingSlash?: boolean;
  trailingSlash?: boolean;
  stripQuery?: boolean;
}

function splitPathBeforeQuery(path: string, stripQuery: boolean): string {
  return stripQuery ? path.split('?')[0] ?? '' : path;
}

function collapsePathSegments(path: string): string {
  const segments = path.replace(/\\/g, '/').split('/');
  const stack: string[] = [];

  for (const rawSegment of segments) {
    const segment = rawSegment.trim();
    if (!segment || segment === '.') {
      continue;
    }

    if (segment === '..') {
      if (stack.length > 0) {
        stack.pop();
      }
      continue;
    }

    stack.push(segment);
  }

  return stack.join('/');
}

export function normalizePathKey(
  path: string | null | undefined,
  {
    leadingSlash = false,
    trailingSlash = false,
    stripQuery = true,
  }: NormalizePathKeyOptions = {},
): string {
  const rawPath = splitPathBeforeQuery(String(path || '').trim(), stripQuery);
  const normalizedPath = collapsePathSegments(rawPath.replace(/^[A-Za-z]:\//, '').replace(/^\/+/, ''));

  if (!normalizedPath) {
    return leadingSlash ? '/' : '';
  }

  const withLeadingSlash = leadingSlash ? `/${normalizedPath}` : normalizedPath;
  if (!trailingSlash) {
    return withLeadingSlash.replace(/\/+$/, '') || (leadingSlash ? '/' : '');
  }

  return withLeadingSlash === '/' ? '/' : `${withLeadingSlash.replace(/\/+$/, '')}/`;
}

export function normalizeLibraryPathKey(path: string | null | undefined): string {
  return normalizePathKey(path, { leadingSlash: false, trailingSlash: false, stripQuery: true });
}

export function normalizeVirtualUsdPath(path: string | null | undefined): string {
  return normalizePathKey(path, { leadingSlash: true, trailingSlash: false, stripQuery: true });
}

export function normalizeVirtualDirectoryPath(path: string | null | undefined): string {
  return normalizePathKey(path, { leadingSlash: true, trailingSlash: true, stripQuery: true });
}
