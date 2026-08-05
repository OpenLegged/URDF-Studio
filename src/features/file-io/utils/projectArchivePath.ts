function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid project file: ${label} must be a non-empty string`);
  }
}

export function assertProjectArchiveEntryPath(
  value: unknown,
  label: string,
): asserts value is string {
  assertNonEmptyString(value, label);
  let decoded = value;
  try {
    for (let pass = 0; pass < 4; pass += 1) {
      const parts = decoded.split('/');
      const hasControlCharacter = Array.from(decoded).some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 31 || codePoint === 127;
      });
      if (
        decoded.length > 1024
        || decoded.trim() !== decoded
        || decoded.startsWith('/')
        || decoded.includes('\\')
        || decoded.includes(':')
        || hasControlCharacter
        || parts.length > 32
        || parts.some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))
      ) {
        throw new Error(`Invalid project file: ${label} path "${value}" is invalid`);
      }
      const nextDecoded = decodeURIComponent(decoded);
      if (nextDecoded === decoded) return;
      decoded = nextDecoded;
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Invalid project file:')) throw error;
  }
  throw new Error(`Invalid project file: ${label} path "${value}" is invalid`);
}
