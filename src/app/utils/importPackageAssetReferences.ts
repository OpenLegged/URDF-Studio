import { validateMJCFImportExternalAssets } from '@/core/parsers/mjcf/mjcfImportValidation';
import { resolveMJCFSource } from '@/core/parsers/mjcf/mjcfSourceResolver';
import { resolveGazeboScriptMaterial } from '@/core/parsers/sdf/gazeboMaterialScripts';
import type { RobotFile } from '@/types';

export interface PackageAssetReferenceSource {
  name?: string;
  format: string;
  content: string;
}

export interface StandalonePackageAssetImportWarning {
  bundleRoots: string[];
  packageNames: string[];
}

export interface StandaloneImportAssetWarning {
  missingAssetPaths: string[];
}

export interface StandalonePrimitiveGeometryHint {
  siblingMeshAssetPaths: string[];
  siblingMeshAssetCount: number;
}

export interface StandaloneImportAssetReferenceOptions {
  allFileContents?: Record<string, string>;
  availableFiles?: readonly Pick<RobotFile, 'name' | 'format' | 'content'>[];
  sourcePath?: string;
}

export function canProceedWithStandaloneImportAssetWarning(
  _source: Pick<PackageAssetReferenceSource, 'format'> | null,
): boolean {
  // Render whatever the source describes: missing meshes fall back to
  // placeholders and missing textures fall back to default materials, so a
  // partial asset bundle should never hard-stop the import.
  return true;
}

export function collectStandaloneImportSupportAssetPaths(
  assetUrls: Record<string, string>,
  availableFiles: readonly Pick<RobotFile, 'name' | 'format'>[],
): string[] {
  return uniqueSorted([
    ...Object.keys(assetUrls),
    // MJCF scene wrappers reference sibling XML files via <include file="...">.
    // Treat every imported file path as support context so a complete folder/archive
    // does not get blocked by the standalone missing-asset warning.
    ...availableFiles.map((file) => file.name),
  ]);
}

const XML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;
const PACKAGE_ASSET_URI_PATTERN = /\b(?:package|model):\/\/([^\s"'<>]+)/g;

const PACKAGE_ROOT_BOUNDARY_SEGMENTS = new Set([
  'meshes',
  'mesh',
  'materials',
  'material',
  'textures',
  'texture',
  'urdf',
  'xacro',
  'sdf',
  'mjcf',
  'dae',
  'obj',
  'stl',
  'gltf',
  'glb',
  'launch',
  'config',
  'rviz',
  'worlds',
  'media',
  'thumbnail',
  'thumbnails',
]);

const ROOT_REFERENCE_FORMATS = new Set(['urdf', 'xacro', 'sdf']);
const GENERIC_ASSET_REFERENCE_FORMATS = new Set(['urdf', 'xacro', 'sdf', 'mjcf']);
const URDF_MESH_FILENAME_PATTERN = /<mesh\b[^>]*\bfilename\s*=\s*["']([^"']+)["'][^>]*>/gi;
const URDF_TEXTURE_FILENAME_PATTERN = /<texture\b[^>]*\bfilename\s*=\s*["']([^"']+)["'][^>]*>/gi;
const SDF_MESH_URI_PATTERN = /<mesh\b[^>]*>[\s\S]*?<uri>\s*([^<]+?)\s*<\/uri>[\s\S]*?<\/mesh>/gi;
const SDF_MATERIAL_SCRIPT_PATTERN =
  /<material\b[^>]*>[\s\S]*?<script\b[^>]*>([\s\S]*?)<\/script>[\s\S]*?<\/material>/gi;
const MJCF_COMPILER_MESHDIR_PATTERN = /<compiler\b[^>]*\bmeshdir\s*=\s*["']([^"']+)["'][^>]*>/i;
const MJCF_MESH_FILE_PATTERN = /<mesh\b[^>]*\bfile\s*=\s*["']([^"']+)["'][^>]*>/gi;
const PRIMITIVE_GEOMETRY_PATTERN = /<(?:box|cylinder|sphere|capsule)\b/i;
const PRIMITIVE_APPROXIMATION_COMMENT_PATTERN = /<!--\s*(?:Shapes for|Part)\s+[^>]+-->/i;
const MESH_ASSET_PATH_PATTERN = /\.(?:dae|obj|stl|msh|gltf|glb|ply|vtk)$/i;

function sanitizeRootSegment(segment: string): string {
  return segment
    .trim()
    .replace(/[\\/]+/g, '-')
    .replace(/^\.+/, '');
}

function normalizeRootSegmentIdentity(segment: string): string {
  return sanitizeRootSegment(segment)
    .replace(/ \(\d+\)$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeRootSegments(path: string): string[] {
  const segments = path.replace(/\\/g, '/').split('/');
  const normalized: string[] = [];

  for (const rawSegment of segments) {
    const segment = sanitizeRootSegment(rawSegment);
    if (!segment || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (normalized.length > 0) {
        normalized.pop();
      }
      continue;
    }
    normalized.push(segment);
  }

  return normalized;
}

function inferBundleRootFromUriPath(uriPath: string): string | null {
  const segments = normalizeRootSegments(uriPath);
  if (segments.length === 0) {
    return null;
  }

  const [packageName, ...relativeSegments] = segments;
  const boundaryIndex = relativeSegments.findIndex((segment) =>
    PACKAGE_ROOT_BOUNDARY_SEGMENTS.has(segment.toLowerCase()),
  );

  const rootSegments = [
    packageName,
    ...(boundaryIndex > 0 ? relativeSegments.slice(0, boundaryIndex) : []),
  ].filter(Boolean);

  return rootSegments.length > 0 ? rootSegments.join('/') : null;
}

function uniqueSorted(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function stripExternalAssetScheme(path: string): string {
  if (path.startsWith('package://')) {
    return path.slice('package://'.length);
  }

  if (path.startsWith('model://')) {
    return path.slice('model://'.length);
  }

  return path;
}

function joinNormalizedAssetPath(basePath: string, relativePath: string): string {
  if (!basePath) {
    return relativePath;
  }

  return `${basePath.replace(/\/+$/, '')}/${relativePath.replace(/^\/+/, '')}`;
}

function normalizeAssetReferencePath(path: string, meshDirectory = ''): string | null {
  const trimmedPath = path.trim();
  if (!trimmedPath) {
    return null;
  }

  if (/^(?:blob:|data:|https?:\/\/)/i.test(trimmedPath)) {
    return null;
  }

  let normalizedPath = trimmedPath.replace(/\\/g, '/');
  const hadExternalScheme =
    normalizedPath.startsWith('package://') || normalizedPath.startsWith('model://');
  normalizedPath = stripExternalAssetScheme(normalizedPath);

  if (!hadExternalScheme && meshDirectory && !normalizedPath.startsWith('/')) {
    normalizedPath = joinNormalizedAssetPath(meshDirectory, normalizedPath);
  }

  const normalizedSegments = normalizeRootSegments(
    normalizedPath.replace(/^[A-Za-z]:\//, '').replace(/^\/+/, ''),
  );
  if (normalizedSegments.length === 0) {
    return null;
  }

  return normalizedSegments.join('/');
}

function normalizeWarningReferencePath(path: string): string | null {
  const trimmedPath = path.trim();
  if (!trimmedPath) {
    return null;
  }

  if (/^(?:blob:|data:|https?:\/\/)/i.test(trimmedPath)) {
    return null;
  }

  const slashNormalizedPath = stripExternalAssetScheme(trimmedPath)
    .replace(/\\/g, '/')
    .replace(/^[A-Za-z]:\//, '')
    .replace(/^\/+/, '');
  const resolvedSegments: string[] = [];

  slashNormalizedPath.split('/').forEach((rawSegment) => {
    const segment = rawSegment.trim();
    if (!segment || segment === '.') {
      return;
    }

    if (segment === '..') {
      if (resolvedSegments.length > 0) {
        resolvedSegments.pop();
      }
      return;
    }

    resolvedSegments.push(segment);
  });

  return resolvedSegments.length > 0 ? resolvedSegments.join('/') : null;
}

function isMjcfSourcePath(path: string): boolean {
  return /\.(?:xml|mjcf)$/i.test(path);
}

function looksLikeMjcfSourceContent(content: string): boolean {
  return /<(?:mujoco|mujocoinclude)\b/i.test(content.slice(0, 4096));
}

function buildMjcfWarningSourceContext(
  source: PackageAssetReferenceSource,
  options: StandaloneImportAssetReferenceOptions,
): { sourceFile: RobotFile; availableFiles: RobotFile[] } {
  const sourceName = options.sourcePath ?? source.name ?? 'standalone-import.mjcf';
  const filesByName = new Map<string, RobotFile>();

  const addMjcfFile = (name: string | undefined, content: string | undefined): void => {
    const normalizedName = name?.trim();
    if (!normalizedName || !content?.trim()) {
      return;
    }

    filesByName.set(normalizedName, {
      name: normalizedName,
      format: 'mjcf',
      content,
    } as RobotFile);
  };

  options.availableFiles?.forEach((file) => {
    if (file.format === 'mjcf') {
      addMjcfFile(file.name, file.content);
    }
  });

  Object.entries(options.allFileContents ?? {}).forEach(([path, content]) => {
    if (isMjcfSourcePath(path) && looksLikeMjcfSourceContent(content)) {
      addMjcfFile(path, content);
    }
  });

  const sourceFile = {
    name: sourceName,
    format: 'mjcf',
    content: source.content,
  } as RobotFile;
  filesByName.set(sourceName, sourceFile);

  return {
    sourceFile,
    availableFiles: Array.from(filesByName.values()),
  };
}

function resolveRelativeWarningPath(sourceFilePath: string, rawPath: string): string {
  const trimmedPath = rawPath.trim();
  if (!trimmedPath) {
    return '';
  }

  const slashNormalizedPath = trimmedPath.replace(/\\/g, '/');
  if (/^(?:[a-z]+:)?\/\//i.test(trimmedPath) || slashNormalizedPath.startsWith('/')) {
    return normalizeAssetReferencePath(trimmedPath) ?? trimmedPath;
  }

  const normalizedSourcePath = normalizeAssetReferencePath(sourceFilePath);
  const sourceDirectory = normalizedSourcePath?.split('/').slice(0, -1).join('/') ?? '';
  return (
    normalizeWarningReferencePath(
      sourceDirectory ? joinNormalizedAssetPath(sourceDirectory, slashNormalizedPath) : trimmedPath,
    ) ?? slashNormalizedPath
  );
}

function assetPathMatchesBundleRoot(assetPath: string, bundleRoot: string): boolean {
  const normalizedAssetSegments = normalizeRootSegments(assetPath);
  const normalizedBundleSegments = normalizeRootSegments(bundleRoot);

  if (
    normalizedAssetSegments.length === 0 ||
    normalizedBundleSegments.length === 0 ||
    normalizedAssetSegments.length < normalizedBundleSegments.length
  ) {
    return false;
  }

  const normalizedBundleIdentities = normalizedBundleSegments.map(normalizeRootSegmentIdentity);

  for (
    let startIndex = 0;
    startIndex <= normalizedAssetSegments.length - normalizedBundleSegments.length;
    startIndex += 1
  ) {
    let matches = true;

    for (let segmentIndex = 0; segmentIndex < normalizedBundleSegments.length; segmentIndex += 1) {
      const assetSegment = normalizedAssetSegments[startIndex + segmentIndex] ?? '';
      const bundleSegment = normalizedBundleSegments[segmentIndex] ?? '';

      if (assetSegment === bundleSegment) {
        continue;
      }

      if (normalizeRootSegmentIdentity(assetSegment) !== normalizedBundleIdentities[segmentIndex]) {
        matches = false;
        break;
      }
    }

    if (matches) {
      return true;
    }
  }

  return false;
}

function buildReferenceSegmentCandidates(referenceSegments: readonly string[]): string[][] {
  const candidateKeys = new Set<string>();
  const candidates: string[][] = [];
  const addCandidate = (segments: readonly string[]) => {
    if (segments.length === 0) {
      return;
    }
    const key = segments.join('/');
    if (candidateKeys.has(key)) {
      return;
    }
    candidateKeys.add(key);
    candidates.push([...segments]);
  };

  addCandidate(referenceSegments);

  referenceSegments.forEach((segment, index) => {
    if (!PACKAGE_ROOT_BOUNDARY_SEGMENTS.has(segment.toLowerCase())) {
      return;
    }

    for (let startIndex = 1; startIndex <= index; startIndex += 1) {
      addCandidate(referenceSegments.slice(startIndex));
    }
  });

  return candidates;
}

function assetPathContainsReferenceSegments(
  normalizedAssetSegments: readonly string[],
  normalizedReferenceSegments: readonly string[],
): boolean {
  if (
    normalizedAssetSegments.length === 0 ||
    normalizedReferenceSegments.length === 0 ||
    normalizedAssetSegments.length < normalizedReferenceSegments.length
  ) {
    return false;
  }

  const normalizedReferenceIdentities = normalizedReferenceSegments.map(
    normalizeRootSegmentIdentity,
  );

  for (
    let startIndex = 0;
    startIndex <= normalizedAssetSegments.length - normalizedReferenceSegments.length;
    startIndex += 1
  ) {
    let matches = true;

    for (
      let segmentIndex = 0;
      segmentIndex < normalizedReferenceSegments.length;
      segmentIndex += 1
    ) {
      const assetSegment = normalizedAssetSegments[startIndex + segmentIndex] ?? '';
      const referenceSegment = normalizedReferenceSegments[segmentIndex] ?? '';

      if (assetSegment === referenceSegment) {
        continue;
      }

      if (
        normalizeRootSegmentIdentity(assetSegment) !== normalizedReferenceIdentities[segmentIndex]
      ) {
        matches = false;
        break;
      }
    }

    if (matches) {
      return true;
    }
  }

  return false;
}

function assetPathMatchesReferencePath(assetPath: string, referencePath: string): boolean {
  const normalizedAssetSegments = normalizeRootSegments(assetPath);
  const normalizedReferenceSegments = normalizeRootSegments(referencePath);

  return buildReferenceSegmentCandidates(normalizedReferenceSegments).some((candidateSegments) =>
    assetPathContainsReferenceSegments(normalizedAssetSegments, candidateSegments),
  );
}

function commonRootPrefix(roots: readonly string[]): string | null {
  if (roots.length === 0) {
    return null;
  }

  const splitRoots = roots.map((root) => root.split('/').filter(Boolean));
  const prefix = [...splitRoots[0]];

  for (let index = prefix.length - 1; index >= 0; index -= 1) {
    const candidate = prefix.slice(0, index + 1);
    const matchesAll = splitRoots.every((segments) =>
      candidate.every((segment, segmentIndex) => segments[segmentIndex] === segment),
    );
    if (matchesAll) {
      return candidate.join('/');
    }
  }

  return null;
}

export function extractPackageAssetBundleRoots(content: string): string[] {
  const roots: string[] = [];
  let match: RegExpExecArray | null;

  const xml = content.replace(XML_COMMENT_PATTERN, ' ');
  while ((match = PACKAGE_ASSET_URI_PATTERN.exec(xml)) !== null) {
    const inferredRoot = inferBundleRootFromUriPath(match[1] ?? '');
    if (inferredRoot) {
      roots.push(inferredRoot);
    }
  }

  return uniqueSorted(roots);
}

export function inferCommonPackageAssetBundleRoot(
  sources: readonly PackageAssetReferenceSource[],
): string | null {
  const roots = uniqueSorted(
    sources.flatMap((source) =>
      ROOT_REFERENCE_FORMATS.has(source.format)
        ? extractPackageAssetBundleRoots(source.content)
        : [],
    ),
  );

  return commonRootPrefix(roots);
}

export function buildStandalonePackageAssetImportWarning(
  source: PackageAssetReferenceSource | null,
  assetPaths: readonly string[],
): StandalonePackageAssetImportWarning | null {
  if (!source || !ROOT_REFERENCE_FORMATS.has(source.format)) {
    return null;
  }

  const bundleRoots = extractPackageAssetBundleRoots(source.content);
  if (bundleRoots.length === 0) {
    return null;
  }

  const missingBundleRoots = bundleRoots.filter(
    (bundleRoot) =>
      !assetPaths.some((assetPath) => assetPathMatchesBundleRoot(assetPath, bundleRoot)),
  );
  if (missingBundleRoots.length === 0) {
    return null;
  }

  return {
    bundleRoots: missingBundleRoots,
    packageNames: uniqueSorted(missingBundleRoots.map((root) => root.split('/')[0] ?? root)),
  };
}

function extractAssetReferencePathsFromUrdfLikeContent(content: string): string[] {
  const references: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = URDF_MESH_FILENAME_PATTERN.exec(content)) !== null) {
    const normalizedPath = normalizeAssetReferencePath(match[1] ?? '');
    if (normalizedPath) {
      references.push(normalizedPath);
    }
  }

  while ((match = SDF_MESH_URI_PATTERN.exec(content)) !== null) {
    const normalizedPath = normalizeAssetReferencePath(match[1] ?? '');
    if (normalizedPath) {
      references.push(normalizedPath);
    }
  }

  while ((match = URDF_TEXTURE_FILENAME_PATTERN.exec(content)) !== null) {
    const normalizedPath = normalizeAssetReferencePath(match[1] ?? '');
    if (normalizedPath) {
      references.push(normalizedPath);
    }
  }

  return uniqueSorted(references);
}

function extractXmlTextValues(block: string, tagName: string): string[] {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>\\s*([^<]+?)\\s*<\\/${tagName}>`, 'gi');
  const values: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(block)) !== null) {
    const value = match[1]?.trim();
    if (value) {
      values.push(value);
    }
  }

  return uniqueSorted(values);
}

function extractSdfScriptTextureReferencePaths(
  content: string,
  { allFileContents = {}, sourcePath }: StandaloneImportAssetReferenceOptions = {},
): string[] {
  const references: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = SDF_MATERIAL_SCRIPT_PATTERN.exec(content)) !== null) {
    const scriptBlock = match[1] ?? '';
    const scriptNames = extractXmlTextValues(scriptBlock, 'name');
    const scriptUris = extractXmlTextValues(scriptBlock, 'uri');

    scriptNames.forEach((scriptName) => {
      const resolvedMaterial = resolveGazeboScriptMaterial({
        allFileContents,
        scriptName,
        scriptUris,
        sourcePath,
      });
      if (resolvedMaterial?.texture) {
        const normalizedPath = normalizeAssetReferencePath(resolvedMaterial.texture);
        if (normalizedPath) {
          references.push(normalizedPath);
        }
      }
      if (resolvedMaterial?.passes) {
        for (const pass of resolvedMaterial.passes) {
          if (pass.texture) {
            const normalizedPath = normalizeAssetReferencePath(pass.texture);
            if (normalizedPath) {
              references.push(normalizedPath);
            }
          }
        }
      }
    });
  }

  return uniqueSorted(references);
}

function extractMeshReferencePathsFromMjcfContent(content: string): string[] {
  const references: string[] = [];
  const meshDirectory = normalizeAssetReferencePath(
    content.match(MJCF_COMPILER_MESHDIR_PATTERN)?.[1] ?? '',
  );
  let match: RegExpExecArray | null;

  while ((match = MJCF_MESH_FILE_PATTERN.exec(content)) !== null) {
    const normalizedPath = normalizeAssetReferencePath(match[1] ?? '', meshDirectory ?? '');
    if (normalizedPath) {
      references.push(normalizedPath);
    }
  }

  return uniqueSorted(references);
}

function extractExternalAssetWarningPathsFromMjcfContent(
  source: PackageAssetReferenceSource,
  assetPaths: readonly string[],
  options: StandaloneImportAssetReferenceOptions = {},
): string[] {
  const { sourceFile, availableFiles } = buildMjcfWarningSourceContext(source, options);
  const resolvedSource = resolveMJCFSource(sourceFile, availableFiles);
  const issues = validateMJCFImportExternalAssets(
    resolvedSource.sourceFile.name,
    resolvedSource.validationContent,
    availableFiles,
    Object.fromEntries(assetPaths.map((assetPath) => [assetPath, assetPath])),
  );

  return uniqueSorted(
    [
      ...resolvedSource.issues.map((issue) =>
        resolveRelativeWarningPath(issue.sourceFilePath, issue.reference),
      ),
      ...issues
        .filter((issue) => issue.referenceKind !== 'model')
        .map((issue) => issue.resolvedPath),
    ].filter(Boolean),
  );
}

export function extractStandaloneImportAssetReferences(
  source: PackageAssetReferenceSource | null,
  options: StandaloneImportAssetReferenceOptions = {},
): string[] {
  if (!source || !GENERIC_ASSET_REFERENCE_FORMATS.has(source.format)) {
    return [];
  }

  const xml = source.content.replace(XML_COMMENT_PATTERN, ' ');
  if (source.format === 'mjcf') {
    return extractMeshReferencePathsFromMjcfContent(xml);
  }

  if (source.format === 'sdf') {
    return uniqueSorted([
      ...extractAssetReferencePathsFromUrdfLikeContent(xml),
      ...extractSdfScriptTextureReferencePaths(xml, {
        ...options,
        sourcePath: options.sourcePath ?? source.name,
      }),
    ]);
  }

  return extractAssetReferencePathsFromUrdfLikeContent(xml);
}

export function buildStandaloneImportAssetWarning(
  source: PackageAssetReferenceSource | null,
  assetPaths: readonly string[],
  options: StandaloneImportAssetReferenceOptions = {},
): StandaloneImportAssetWarning | null {
  const referencePaths =
    source?.format === 'mjcf'
      ? extractExternalAssetWarningPathsFromMjcfContent(source, assetPaths, options)
      : extractStandaloneImportAssetReferences(source, options);
  if (referencePaths.length === 0) {
    return null;
  }

  const missingAssetPaths = referencePaths.filter(
    (referencePath) =>
      !assetPaths.some((assetPath) => assetPathMatchesReferencePath(assetPath, referencePath)),
  );

  if (missingAssetPaths.length === 0) {
    return null;
  }

  return {
    missingAssetPaths,
  };
}

export function buildStandalonePrimitiveGeometryHint(
  source: PackageAssetReferenceSource | null,
  assetPaths: readonly string[],
  options: StandaloneImportAssetReferenceOptions = {},
): StandalonePrimitiveGeometryHint | null {
  if (!source || source.format !== 'urdf') {
    return null;
  }

  if (!PRIMITIVE_GEOMETRY_PATTERN.test(source.content)) {
    return null;
  }

  if (!PRIMITIVE_APPROXIMATION_COMMENT_PATTERN.test(source.content)) {
    return null;
  }

  const meshReferencePaths = extractStandaloneImportAssetReferences(source, options).filter(
    (referencePath) => MESH_ASSET_PATH_PATTERN.test(referencePath),
  );
  if (meshReferencePaths.length > 0) {
    return null;
  }

  const sourcePath = options.sourcePath ?? source.name ?? '';
  const normalizedSourcePath = normalizeAssetReferencePath(sourcePath);
  if (!normalizedSourcePath) {
    return null;
  }

  const sourceDirectory = normalizedSourcePath.split('/').slice(0, -1).join('/');
  if (!sourceDirectory) {
    return null;
  }

  const siblingMeshAssetPaths = uniqueSorted(
    assetPaths.filter(
      (assetPath) =>
        MESH_ASSET_PATH_PATTERN.test(assetPath) &&
        assetPathMatchesBundleRoot(assetPath, sourceDirectory),
    ),
  );

  if (siblingMeshAssetPaths.length === 0) {
    return null;
  }

  return {
    siblingMeshAssetPaths: siblingMeshAssetPaths.slice(0, 3),
    siblingMeshAssetCount: siblingMeshAssetPaths.length,
  };
}
