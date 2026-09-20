import { parseDocument } from 'yaml';

function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}

/** Resolve only within the imported package. Never fetch files or use host filesystem paths. */
export function loadXacroYaml(filename: string, basePath: string, files: Record<string, string>): unknown {
  const packageMatch = filename.match(/^(?:\$\(find\s+([^)]+)\)|package:\/\/([^/]+))\/?(.*)$/);
  const requested = packageMatch
    ? normalize(`${packageMatch[1] ?? packageMatch[2]}/${packageMatch[3]}`)
    : normalize(filename.startsWith('/') ? filename : `${basePath}/${filename}`);
  const entries = Object.entries(files);
  const exact = entries.find(([path]) => normalize(path) === requested);
  const matches = exact ? [exact] : packageMatch
    ? entries.filter(([path]) => normalize(path).endsWith(`/${requested}`))
    : [];
  if (matches.length !== 1) {
    throw new Error(`[Xacro] YAML "${filename}" from "${basePath}" ${matches.length ? 'is ambiguous' : 'was not imported'}.`);
  }
  const [path, source] = matches[0];
  const document = parseDocument(source, { schema: 'core', uniqueKeys: true });
  const issues = [...document.errors, ...document.warnings];
  if (issues.length) throw new Error(`[Xacro] Invalid YAML "${path}": ${issues.map(issue => issue.message).join('; ')}`);
  try {
    const value: unknown = document.toJS({ maxAliasCount: 100 });
    return value;
  } catch (error) {
    throw new Error(`[Xacro] Invalid YAML "${path}": ${error instanceof Error ? error.message : String(error)}`);
  }
}
