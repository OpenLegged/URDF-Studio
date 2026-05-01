import type { RobotFile } from '@/types';
import {
  MJCF_COMPILER_ANGLE_SCOPE_ATTR,
  MJCF_COMPILER_EULERSEQ_SCOPE_ATTR,
} from './mjcfCompilerScope';
import { parseMJCFXmlDocument } from './mjcfUtils';

type MJCFFileMap = Record<string, string>;

export type MJCFSourceResolutionIssueKind =
  | 'missing_include'
  | 'unresolved_template_placeholder'
  | 'circular_include'
  | 'included_xml_parse_failed'
  | 'missing_attached_model_asset'
  | 'missing_attached_model_file'
  | 'circular_attach'
  | 'attached_xml_parse_failed'
  | 'missing_attached_body';

export interface MJCFSourceResolutionIssue {
  kind: MJCFSourceResolutionIssueKind;
  sourceFilePath: string;
  reference: string;
  detail: string;
}

interface IndexedMJCFFileMap {
  fileMap: MJCFFileMap;
  mjcfFiles: RobotFile[];
  byNormalized: Map<string, string>;
}

interface ResolvedSourceContentCacheSignatureEntry {
  index: number;
  name: string;
  content: string;
}

interface ResolvedSourceContentCacheSignature {
  selectedName: string;
  selectedContent: string;
  files: ResolvedSourceContentCacheSignatureEntry[];
}

interface ResolvedSourceContentCacheIdentity {
  key: string;
  signature: ResolvedSourceContentCacheSignature;
}

interface ResolvedSourceContentCacheEntry {
  resolved: ResolvedMJCFSource;
  signature: ResolvedSourceContentCacheSignature;
}

const indexedFileMapCache = new WeakMap<RobotFile[], IndexedMJCFFileMap>();
const resolvedSourceCache = new WeakMap<RobotFile[], WeakMap<RobotFile, ResolvedMJCFSource>>();
const resolvedSourceContentCache = new Map<string, ResolvedSourceContentCacheEntry>();
const RESOLVED_SOURCE_CONTENT_CACHE_LIMIT = 32;
export const MJCF_SOURCE_FILE_SCOPE_ATTR = 'data-urdf-studio-source-file';
const MJCF_SOURCE_FILE_SCOPE_ATTR_PATTERN = new RegExp(
  `\\s${MJCF_SOURCE_FILE_SCOPE_ATTR}=(?:"[^"]*"|'[^']*')`,
  'g',
);
const MJCF_INCLUDE_TAG_PATTERN = /<\s*include(?=[\s>/])/i;
const MJCF_ATTACH_TAG_PATTERN = /<\s*attach(?=[\s>/])/i;
const MJCF_TEMPLATE_PLACEHOLDER_TOKENS = ['OBJECT_NAME'] as const;

function normalizePath(path: string): string {
  const slashNormalized = path.replace(/\\/g, '/').replace(/\/+/g, '/');
  const hasLeadingSlash = slashNormalized.startsWith('/');
  const parts = slashNormalized.split('/').filter(Boolean);
  const resolved: string[] = [];

  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      resolved.pop();
      continue;
    }
    resolved.push(part);
  }

  const normalized = resolved.join('/');
  if (!normalized) {
    return hasLeadingSlash ? '/' : '';
  }

  return hasLeadingSlash ? `/${normalized}` : normalized;
}

function getBasePath(path: string): string {
  const normalized = normalizePath(path);
  const parts = normalized.split('/');
  parts.pop();
  return parts.join('/');
}

function getIndexedMJCFFileMap(files: RobotFile[]): IndexedMJCFFileMap {
  const cached = indexedFileMapCache.get(files);
  if (cached) {
    return cached;
  }

  const mjcfFiles = files.filter((file) => file.format === 'mjcf');
  const fileMap: MJCFFileMap = {};
  mjcfFiles.forEach((file) => {
    if (typeof file.content === 'string' && file.content) {
      fileMap[file.name] = file.content;
    }
  });

  const normalizedEntries = Object.keys(fileMap).map((original) => {
    const normalized = normalizePath(original);
    return {
      original,
      normalized,
    };
  });
  const byNormalized = new Map<string, string>();

  normalizedEntries.forEach((entry) => {
    byNormalized.set(entry.normalized, entry.original);
  });

  const indexed = {
    fileMap,
    mjcfFiles,
    byNormalized,
  } satisfies IndexedMJCFFileMap;
  indexedFileMapCache.set(files, indexed);
  return indexed;
}

function getResolvedSourceMemo(files: RobotFile[]): WeakMap<RobotFile, ResolvedMJCFSource> {
  const cached = resolvedSourceCache.get(files);
  if (cached) {
    return cached;
  }

  const memo = new WeakMap<RobotFile, ResolvedMJCFSource>();
  resolvedSourceCache.set(files, memo);
  return memo;
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;

  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return `${value.length}:${(hash >>> 0).toString(36)}`;
}

function buildResolvedSourceContentCacheIdentity(
  file: RobotFile,
  files: RobotFile[],
): ResolvedSourceContentCacheIdentity | null {
  if (typeof file.content !== 'string') {
    return null;
  }

  const selectedName = normalizePath(file.name);
  const parts = [
    'mjcf-resolved-v1',
    selectedName,
    hashString(file.content),
  ];
  const signature: ResolvedSourceContentCacheSignature = {
    selectedName,
    selectedContent: file.content,
    files: [],
  };

  files.forEach((candidate, index) => {
    if (candidate.format !== 'mjcf' || typeof candidate.content !== 'string') {
      return;
    }

    const normalizedName = normalizePath(candidate.name);
    parts.push(String(index), normalizedName, hashString(candidate.content));
    signature.files.push({
      index,
      name: normalizedName,
      content: candidate.content,
    });
  });

  return {
    key: parts.join('\0'),
    signature,
  };
}

function contentCacheSignaturesEqual(
  left: ResolvedSourceContentCacheSignature,
  right: ResolvedSourceContentCacheSignature,
): boolean {
  if (
    left.selectedName !== right.selectedName ||
    left.selectedContent !== right.selectedContent ||
    left.files.length !== right.files.length
  ) {
    return false;
  }

  return left.files.every((leftEntry, index) => {
    const rightEntry = right.files[index];
    return (
      rightEntry !== undefined &&
      leftEntry.index === rightEntry.index &&
      leftEntry.name === rightEntry.name &&
      leftEntry.content === rightEntry.content
    );
  });
}

function cloneResolvedSourceForFile(
  resolved: ResolvedMJCFSource,
  file: RobotFile,
): ResolvedMJCFSource {
  return {
    ...resolved,
    sourceFile: file,
    effectiveFile: file,
    issues: [...resolved.issues],
  };
}

function cacheResolvedSourceByContent(
  identity: ResolvedSourceContentCacheIdentity,
  resolved: ResolvedMJCFSource,
): void {
  if (resolvedSourceContentCache.has(identity.key)) {
    resolvedSourceContentCache.delete(identity.key);
  }

  resolvedSourceContentCache.set(identity.key, {
    signature: identity.signature,
    resolved: {
      ...resolved,
      issues: [...resolved.issues],
    },
  });

  while (resolvedSourceContentCache.size > RESOLVED_SOURCE_CONTENT_CACHE_LIMIT) {
    const oldestKey = resolvedSourceContentCache.keys().next().value;
    if (typeof oldestKey !== 'string') {
      return;
    }
    resolvedSourceContentCache.delete(oldestKey);
  }
}

function getCachedResolvedSourceByContent(
  identity: ResolvedSourceContentCacheIdentity,
  file: RobotFile,
): ResolvedMJCFSource | null {
  const cached = resolvedSourceContentCache.get(identity.key);
  if (!cached) {
    return null;
  }
  if (!contentCacheSignaturesEqual(cached.signature, identity.signature)) {
    return null;
  }

  resolvedSourceContentCache.delete(identity.key);
  resolvedSourceContentCache.set(identity.key, cached);
  return cloneResolvedSourceForFile(cached.resolved, file);
}

function resolveFileInMap(
  filename: string,
  indexedFileMap: IndexedMJCFFileMap,
  basePath: string,
): string | null {
  const normalizedFilename = normalizePath(filename.trim());
  if (!normalizedFilename) {
    return null;
  }

  const normalizedBasePath = normalizePath(basePath);

  if (normalizedBasePath) {
    const isAbsoluteBase = normalizedBasePath.startsWith('/');
    const baseParts = normalizedBasePath.split('/').filter(Boolean);
    for (let i = baseParts.length; i >= 0; i -= 1) {
      const prefix = baseParts.slice(0, i).join('/');
      const scopedBase = prefix
        ? isAbsoluteBase
          ? `/${prefix}`
          : prefix
        : isAbsoluteBase
          ? '/'
          : '';
      const tryPath = normalizePath(
        scopedBase ? `${scopedBase}/${normalizedFilename}` : normalizedFilename,
      );
      const found = indexedFileMap.byNormalized.get(tryPath);
      if (found) {
        return found;
      }
    }
  }

  const directMatch = indexedFileMap.byNormalized.get(normalizedFilename);
  if (directMatch) {
    return directMatch;
  }

  return null;
}

function detectMJCFTemplatePlaceholder(reference: string): string | null {
  const normalizedReference = reference.replace(/\\/g, '/').trim();
  if (!normalizedReference) {
    return null;
  }

  for (const token of MJCF_TEMPLATE_PLACEHOLDER_TOKENS) {
    if (
      normalizedReference === token ||
      normalizedReference.startsWith(`${token}/`) ||
      normalizedReference.endsWith(`/${token}`) ||
      normalizedReference.includes(`/${token}/`)
    ) {
      return token;
    }
  }

  return null;
}

function parseXml(content: string): Document | null {
  return parseMJCFXmlDocument(content).doc;
}

function getCombinedCompilerAttributes(doc: Document): {
  angle: string;
  assetdir: string;
  meshdir: string;
  texturedir: string;
  eulerseq: string;
} {
  let angle = '';
  let assetdir = '';
  let meshdir: string | null = null;
  let texturedir: string | null = null;
  let eulerseq = '';

  doc.querySelectorAll('compiler').forEach((compilerEl) => {
    const nextAngle = compilerEl.getAttribute('angle');
    if (nextAngle) {
      angle = nextAngle;
    }

    const nextAssetdir = compilerEl.getAttribute('assetdir');
    if (nextAssetdir !== null) {
      assetdir = nextAssetdir;
    }

    const nextMeshdir = compilerEl.getAttribute('meshdir');
    if (nextMeshdir !== null) {
      meshdir = nextMeshdir;
    }

    const nextTexturedir = compilerEl.getAttribute('texturedir');
    if (nextTexturedir !== null) {
      texturedir = nextTexturedir;
    }

    const nextEulerSeq = compilerEl.getAttribute('eulerseq');
    if (nextEulerSeq) {
      eulerseq = nextEulerSeq;
    }
  });

  return {
    angle,
    assetdir,
    meshdir: meshdir ?? assetdir,
    texturedir: texturedir ?? assetdir,
    eulerseq,
  };
}

function prefixIdentifier(value: string, prefix: string): string {
  const trimmed = value.trim();
  if (!trimmed || !prefix) {
    return trimmed;
  }

  return `${prefix}${trimmed}`;
}

function applyAssetDirectory(filePath: string, directory: string): string {
  const trimmed = filePath.trim();
  if (!trimmed || trimmed.startsWith('/') || trimmed.includes(':')) {
    return trimmed;
  }

  const normalizedDirectory = normalizePath(directory);
  if (!normalizedDirectory) {
    return normalizePath(trimmed);
  }

  return normalizePath(`${normalizedDirectory}/${trimmed}`);
}

function pushResolutionIssue(
  issues: MJCFSourceResolutionIssue[],
  issue: MJCFSourceResolutionIssue,
): void {
  issues.push(issue);
}

function annotateImportedNodeSourceScope(node: Node, sourceFilePath: string): void {
  if (node.nodeType !== 1) {
    return;
  }

  (node as Element).setAttribute(MJCF_SOURCE_FILE_SCOPE_ATTR, sourceFilePath);
}

function stripMJCFSourceScopeAnnotations(content: string): string {
  return content.replace(MJCF_SOURCE_FILE_SCOPE_ATTR_PATTERN, '');
}

function prefixAttachedModelDocument(doc: Document, prefix: string): void {
  const compilerAttrs = getCombinedCompilerAttributes(doc);
  const referenceAttributes = [
    'mesh',
    'material',
    'texture',
    'class',
    'childclass',
    'joint',
    'joint1',
    'joint2',
    'body',
    'body1',
    'body2',
    'site',
    'site1',
    'site2',
    'geom',
    'geom1',
    'geom2',
    'tendon',
    'tendon1',
    'tendon2',
    'actuator',
    'objname',
    'name1',
    'name2',
  ] as const;
  const elements = Array.from(doc.querySelectorAll('*'));

  elements.forEach((element) => {
    const tagName = element.tagName.toLowerCase();
    const name = element.getAttribute('name');
    if (name) {
      element.setAttribute('name', prefixIdentifier(name, prefix));
    }

    if (tagName === 'default') {
      const className = element.getAttribute('class');
      if (className) {
        element.setAttribute('class', prefixIdentifier(className, prefix));
      }
    }
  });

  elements.forEach((element) => {
    const tagName = element.tagName.toLowerCase();
    referenceAttributes.forEach((attributeName) => {
      if (tagName === 'default' && attributeName === 'class') {
        return;
      }

      const value = element.getAttribute(attributeName);
      if (!value) {
        return;
      }

      element.setAttribute(attributeName, prefixIdentifier(value, prefix));
    });

    if (tagName === 'mesh') {
      const fileAttr = element.getAttribute('file');
      if (fileAttr) {
        element.setAttribute('file', applyAssetDirectory(fileAttr, compilerAttrs.meshdir));
      }
    }

    if (tagName === 'texture') {
      const fileAttr = element.getAttribute('file');
      if (fileAttr) {
        element.setAttribute('file', applyAssetDirectory(fileAttr, compilerAttrs.texturedir));
      }
    }
  });
}

function expandIncludesRecursive(
  content: string,
  indexedFileMap: IndexedMJCFFileMap,
  basePath: string,
  currentFilePath: string,
  issues: MJCFSourceResolutionIssue[],
  includeStack: string[] = [],
): string {
  if (!MJCF_INCLUDE_TAG_PATTERN.test(content)) {
    return content;
  }

  const doc = parseXml(content);
  if (!doc) {
    return content;
  }

  const includeElements = Array.from(doc.querySelectorAll('include[file]'));
  includeElements.forEach((includeEl) => {
    const includePath = includeEl.getAttribute('file')?.trim();
    if (!includePath) {
      includeEl.remove();
      return;
    }

    const templatePlaceholder = detectMJCFTemplatePlaceholder(includePath);
    if (templatePlaceholder) {
      console.error(`[MJCF] Include file still contains template placeholder: ${includePath}`);
      pushResolutionIssue(issues, {
        kind: 'unresolved_template_placeholder',
        sourceFilePath: currentFilePath,
        reference: includePath,
        detail: `Referenced MJCF include "${includePath}" from "${currentFilePath}" still contains template placeholder "${templatePlaceholder}". Replace "${templatePlaceholder}" with a concrete object directory before import.`,
      });
      includeEl.remove();
      return;
    }

    const resolvedPath = resolveFileInMap(includePath, indexedFileMap, basePath);
    if (!resolvedPath) {
      console.error(`[MJCF] Include file not found: ${includePath}`);
      pushResolutionIssue(issues, {
        kind: 'missing_include',
        sourceFilePath: currentFilePath,
        reference: includePath,
        detail: `Referenced MJCF include "${includePath}" could not be resolved from "${currentFilePath}".`,
      });
      includeEl.remove();
      return;
    }

    const normalizedResolvedPath = normalizePath(resolvedPath);
    if (includeStack.includes(normalizedResolvedPath)) {
      console.error(`[MJCF] Circular include detected: ${normalizedResolvedPath}`);
      pushResolutionIssue(issues, {
        kind: 'circular_include',
        sourceFilePath: currentFilePath,
        reference: includePath,
        detail: `Circular MJCF include detected while resolving "${includePath}" from "${currentFilePath}".`,
      });
      includeEl.remove();
      return;
    }

    const includedContent = expandIncludesRecursive(
      indexedFileMap.fileMap[resolvedPath],
      indexedFileMap,
      getBasePath(resolvedPath),
      resolvedPath,
      issues,
      [...includeStack, normalizedResolvedPath],
    );

    const includedDoc = parseXml(includedContent);
    if (!includedDoc) {
      pushResolutionIssue(issues, {
        kind: 'included_xml_parse_failed',
        sourceFilePath: resolvedPath,
        reference: includePath,
        detail: `Resolved MJCF include "${includePath}" from "${currentFilePath}" could not be parsed as XML.`,
      });
      includeEl.remove();
      return;
    }

    const includedRoot = includedDoc.documentElement;
    const parent = includeEl.parentNode;
    if (!parent) {
      includeEl.remove();
      return;
    }

    Array.from(includedRoot.childNodes).forEach((child) => {
      const importedChild = doc.importNode(child, true);
      annotateImportedNodeSourceScope(importedChild, resolvedPath);
      parent.insertBefore(importedChild, includeEl);
    });

    includeEl.remove();
  });

  return new XMLSerializer().serializeToString(doc);
}

function expandAttachedModelsRecursive(
  content: string,
  indexedFileMap: IndexedMJCFFileMap,
  basePath: string,
  currentFilePath: string,
  issues: MJCFSourceResolutionIssue[],
  attachStack: string[] = [],
): string {
  if (!MJCF_ATTACH_TAG_PATTERN.test(content)) {
    return content;
  }

  const doc = parseXml(content);
  if (!doc) {
    return content;
  }

  const hostMujoco = doc.querySelector('mujoco');
  if (!hostMujoco) {
    return content;
  }

  const attachElements = Array.from(doc.querySelectorAll('attach[model]'));
  if (attachElements.length === 0) {
    return new XMLSerializer().serializeToString(doc);
  }

  const compilerAttrs = getCombinedCompilerAttributes(doc);
  const modelAssetByName = new Map<string, string>();
  doc.querySelectorAll('asset > model[name][file]').forEach((modelEl) => {
    const name = modelEl.getAttribute('name')?.trim();
    const file = modelEl.getAttribute('file')?.trim();
    if (name && file) {
      modelAssetByName.set(name, applyAssetDirectory(file, compilerAttrs.assetdir));
    }
  });

  attachElements.forEach((attachEl) => {
    const modelName = attachEl.getAttribute('model')?.trim();
    const bodyName = attachEl.getAttribute('body')?.trim();
    const prefix = attachEl.getAttribute('prefix')?.trim() || '';

    if (!modelName || !bodyName) {
      attachEl.remove();
      return;
    }

    const modelFile = modelAssetByName.get(modelName);
    if (!modelFile) {
      console.error(`[MJCF] Attached model asset not found: ${modelName}`);
      pushResolutionIssue(issues, {
        kind: 'missing_attached_model_asset',
        sourceFilePath: currentFilePath,
        reference: modelName,
        detail: `Attached MJCF model asset "${modelName}" referenced from "${currentFilePath}" is missing.`,
      });
      attachEl.remove();
      return;
    }

    const resolvedPath = resolveFileInMap(modelFile, indexedFileMap, basePath);
    if (!resolvedPath) {
      console.error(`[MJCF] Attached model file not found: ${modelFile}`);
      pushResolutionIssue(issues, {
        kind: 'missing_attached_model_file',
        sourceFilePath: currentFilePath,
        reference: modelFile,
        detail: `Attached MJCF model file "${modelFile}" referenced from "${currentFilePath}" could not be resolved.`,
      });
      attachEl.remove();
      return;
    }

    const normalizedResolvedPath = normalizePath(resolvedPath);
    if (attachStack.includes(normalizedResolvedPath)) {
      console.error(`[MJCF] Circular attach detected: ${normalizedResolvedPath}`);
      pushResolutionIssue(issues, {
        kind: 'circular_attach',
        sourceFilePath: currentFilePath,
        reference: modelFile,
        detail: `Circular MJCF attach detected while resolving "${modelFile}" from "${currentFilePath}".`,
      });
      attachEl.remove();
      return;
    }

    const attachedContent = expandMJCFSource(
      indexedFileMap.fileMap[resolvedPath],
      indexedFileMap,
      getBasePath(resolvedPath),
      resolvedPath,
      issues,
      [...attachStack, normalizedResolvedPath],
    );
    const attachedDoc = parseXml(attachedContent);
    if (!attachedDoc) {
      pushResolutionIssue(issues, {
        kind: 'attached_xml_parse_failed',
        sourceFilePath: resolvedPath,
        reference: modelFile,
        detail: `Resolved attached MJCF model "${modelFile}" from "${currentFilePath}" could not be parsed as XML.`,
      });
      attachEl.remove();
      return;
    }

    prefixAttachedModelDocument(attachedDoc, prefix);

    const prefixedBodyName = prefixIdentifier(bodyName, prefix);
    const attachedRootBody = Array.from(attachedDoc.querySelectorAll('worldbody body')).find(
      (bodyEl) => bodyEl.getAttribute('name')?.trim() === prefixedBodyName,
    );

    if (!attachedRootBody) {
      console.error(`[MJCF] Attached body not found: ${bodyName} in ${resolvedPath}`);
      pushResolutionIssue(issues, {
        kind: 'missing_attached_body',
        sourceFilePath: resolvedPath,
        reference: bodyName,
        detail: `Attached MJCF body "${bodyName}" was not found inside "${resolvedPath}".`,
      });
      attachEl.remove();
      return;
    }

    const attachedMujoco = attachedDoc.querySelector('mujoco');
    if (!attachedMujoco) {
      attachEl.remove();
      return;
    }

    const insertionAnchor = hostMujoco.querySelector(':scope > worldbody');
    const attachedCompilerAttrs = getCombinedCompilerAttributes(attachedDoc);
    if (attachedCompilerAttrs.angle) {
      attachedRootBody.setAttribute(MJCF_COMPILER_ANGLE_SCOPE_ATTR, attachedCompilerAttrs.angle);
    }
    if (attachedCompilerAttrs.eulerseq) {
      attachedRootBody.setAttribute(
        MJCF_COMPILER_EULERSEQ_SCOPE_ATTR,
        attachedCompilerAttrs.eulerseq,
      );
    }

    attachedMujoco.querySelectorAll(':scope > default').forEach((defaultEl) => {
      const importedDefault = doc.importNode(defaultEl, true);
      annotateImportedNodeSourceScope(importedDefault, resolvedPath);
      hostMujoco.insertBefore(importedDefault, insertionAnchor);
    });

    attachedMujoco.querySelectorAll(':scope > asset').forEach((assetEl) => {
      const assetClone = doc.importNode(assetEl, true) as Element;
      Array.from(assetClone.querySelectorAll(':scope > model')).forEach((modelEl) =>
        modelEl.remove(),
      );
      if (assetClone.children.length > 0) {
        annotateImportedNodeSourceScope(assetClone, resolvedPath);
        hostMujoco.insertBefore(assetClone, insertionAnchor);
      }
    });

    const importedBody = doc.importNode(attachedRootBody, true);
    annotateImportedNodeSourceScope(importedBody, resolvedPath);
    attachEl.parentNode?.insertBefore(importedBody, attachEl);
    attachEl.remove();
  });

  return new XMLSerializer().serializeToString(doc);
}

function expandMJCFSource(
  content: string,
  indexedFileMap: IndexedMJCFFileMap,
  basePath: string,
  currentFilePath: string,
  issues: MJCFSourceResolutionIssue[],
  expansionStack: string[] = [],
): string {
  const included = expandIncludesRecursive(
    content,
    indexedFileMap,
    basePath,
    currentFilePath,
    issues,
    expansionStack,
  );
  return expandAttachedModelsRecursive(
    included,
    indexedFileMap,
    basePath,
    currentFilePath,
    issues,
    expansionStack,
  );
}

export function prefixMJCFSourceIdentifiers(content: string, prefix: string): string {
  const normalizedPrefix = prefix.trim();
  if (!normalizedPrefix) {
    return content;
  }

  const doc = parseXml(content);
  if (!doc) {
    return content;
  }

  const bodyReferenceAttributes = ['body', 'body1', 'body2'] as const;
  const jointReferenceAttributes = ['joint', 'joint1', 'joint2'] as const;
  const elements = Array.from(doc.querySelectorAll('*'));

  elements.forEach((element) => {
    const tagName = element.tagName.toLowerCase();
    if (tagName === 'body' || tagName === 'joint') {
      const name = element.getAttribute('name');
      if (name) {
        element.setAttribute('name', prefixIdentifier(name, normalizedPrefix));
      }
    }
  });

  elements.forEach((element) => {
    bodyReferenceAttributes.forEach((attributeName) => {
      const value = element.getAttribute(attributeName);
      if (value) {
        element.setAttribute(attributeName, prefixIdentifier(value, normalizedPrefix));
      }
    });

    jointReferenceAttributes.forEach((attributeName) => {
      const value = element.getAttribute(attributeName);
      if (value) {
        element.setAttribute(attributeName, prefixIdentifier(value, normalizedPrefix));
      }
    });
  });

  return new XMLSerializer().serializeToString(doc);
}

export interface ResolvedMJCFSource {
  content: string;
  validationContent: string;
  sourceFile: RobotFile;
  effectiveFile: RobotFile;
  basePath: string;
  issues: MJCFSourceResolutionIssue[];
}

export function resolveMJCFSource(file: RobotFile, files: RobotFile[]): ResolvedMJCFSource {
  const memo = getResolvedSourceMemo(files);
  const cached = memo.get(file);
  if (cached) {
    return cached;
  }

  const contentCacheIdentity = buildResolvedSourceContentCacheIdentity(file, files);
  if (contentCacheIdentity) {
    const contentCached = getCachedResolvedSourceByContent(contentCacheIdentity, file);
    if (contentCached) {
      memo.set(file, contentCached);
      return contentCached;
    }
  }

  const indexedFileMap = getIndexedMJCFFileMap(files);
  const selectedBasePath = getBasePath(file.name);
  const issues: MJCFSourceResolutionIssue[] = [];
  const validationContent = expandMJCFSource(
    file.content,
    indexedFileMap,
    selectedBasePath,
    file.name,
    issues,
    [normalizePath(file.name)],
  );
  const resolved = {
    content: stripMJCFSourceScopeAnnotations(validationContent),
    validationContent,
    sourceFile: file,
    effectiveFile: file,
    basePath: selectedBasePath,
    issues,
  };
  memo.set(file, resolved);
  if (contentCacheIdentity) {
    cacheResolvedSourceByContent(contentCacheIdentity, resolved);
  }
  return resolved;
}

export function processMJCFIncludes(content: string, files: RobotFile[], basePath = ''): string {
  return stripMJCFSourceScopeAnnotations(
    expandMJCFSource(content, getIndexedMJCFFileMap(files), basePath, basePath, [], []),
  );
}
