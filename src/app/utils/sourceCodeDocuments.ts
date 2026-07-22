import type {
  AssemblyComponent,
  AssemblyState,
  ComponentSourceDraft,
  RobotFile,
} from '@/types';
import { generateURDF } from '@/core/parsers';
import { buildExportableAssemblyRobotData } from '@/core/robot/assemblyTransforms';
import { analyzeAssemblyConnectivity } from '@/core/robot/assemblyConnectivity';
import { hasComponentEditorLocks } from '@/core/robot/editorLock';
import type { SourceCodeDocumentFlavor } from './sourceCodeDisplay';
import { detectImportFormat } from './import-preparation/formatDetection.ts';
import {
  extractUsdLayerReferencesFromText,
  resolveUsdLayerReferencePath,
} from '@/features/editor/usd_documents';
import { getSourceCodeDocumentFlavor, isSourceCodeDocumentReadOnly } from './sourceCodeDisplay.ts';
import {
  graftAssemblyGroupUrdfSource,
  resolveAssemblyGroupMasterComponentId,
} from './assemblyUrdfSourceGraft.ts';
import type { GraftAssemblyGroupUrdfSourceProvenance } from './assemblyUrdfSourceGraft.ts';

type SourceFileFormat = RobotFile['format'] | null;

interface SourceTextFileEntry {
  path: string;
  content: string;
  format: SourceFileFormat;
  blobUrl?: string;
}

export interface ComponentSourceCodeDocumentChangeTarget {
  kind: 'component';
  componentId: string;
  name: string;
  format: SourceFileFormat;
  content?: string;
  persistContent?: boolean;
}

export interface GroupSourceCodeDocumentChangeTarget {
  kind: 'group';
  rootComponentId: string;
  groupComponentIds: string[];
  provenance: GraftAssemblyGroupUrdfSourceProvenance;
}

export type SourceCodeDocumentChangeTarget =
  | ComponentSourceCodeDocumentChangeTarget
  | GroupSourceCodeDocumentChangeTarget;

export interface SourceCodeDocumentDescriptor {
  id: string;
  fileName: string;
  tabLabel?: string;
  filePath: string | null;
  content: string;
  contentUrl?: string;
  documentFlavor: SourceCodeDocumentFlavor;
  readOnly: boolean;
  validationEnabled?: boolean;
  changeTarget?: SourceCodeDocumentChangeTarget;
}

export interface CanonicalWorkspaceSourceDocuments {
  mode: 'component' | 'assembly';
  componentId: string | null;
  documents: SourceCodeDocumentDescriptor[];
  content: string;
  documentFlavor: SourceCodeDocumentFlavor;
  fileName: string;
  /** Resource/editor context only; renderer backend selection belongs to scene projection. */
  directComponentDocument: SourceCodeDocumentDescriptor | null;
}

export interface BuildCanonicalWorkspaceSourceDocumentsParams {
  workspace: AssemblyState;
  activeComponentId: string | null;
  componentSourceDrafts: Record<string, ComponentSourceDraft>;
  availableFiles: RobotFile[];
  allFileContents: Record<string, string>;
}

interface BuildSourceCodeDocumentsParams {
  componentId: string;
  activeSourceFile: RobotFile | null;
  sourceCodeContent: string;
  sourceCodeDocumentFlavor: SourceCodeDocumentFlavor;
  availableFiles: RobotFile[];
  allFileContents: Record<string, string>;
  forceReadOnly?: boolean;
}

const XACRO_INCLUDE_REGEX =
  /<!--[\s\S]*?-->|<xacro:include\b([^>]*?)(?:\/>|>\s*<\/xacro:include>)/g;
const MJCF_INCLUDE_REGEX = /<!--[\s\S]*?-->|<include\b([^>]*?)(?:\/>|>\s*<\/include>)/g;
const SOURCE_ROOT_PATTERNS: Partial<Record<SourceCodeDocumentFlavor, RegExp>> = {
  urdf: /<robot\b/i,
  xacro: /<\s*(?:xacro:)?robot\b/i,
  sdf: /<sdf\b/i,
  mjcf: /<mujoco\b/i,
  'equivalent-mjcf': /<mujoco\b/i,
  usd: /#usda\b/i,
};

function normalizeSourcePath(filePath: string): string {
  return filePath
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '');
}

function getSourceBasePath(filePath: string): string {
  const normalizedPath = normalizeSourcePath(filePath);
  const lastSlashIndex = normalizedPath.lastIndexOf('/');
  return lastSlashIndex === -1 ? '' : normalizedPath.slice(0, lastSlashIndex);
}

function getSourceFileName(filePath: string): string {
  const normalizedPath = normalizeSourcePath(filePath);
  const lastSlashIndex = normalizedPath.lastIndexOf('/');
  return lastSlashIndex === -1 ? normalizedPath : normalizedPath.slice(lastSlashIndex + 1);
}

function parseXmlAttributeMap(attrs: string): Map<string, string> {
  const parsed = new Map<string, string>();
  const attrRegex = /([A-Za-z_][\w:.-]*)\s*=\s*(["'])(.*?)\2/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(attrs)) !== null) {
    parsed.set(match[1], match[3]);
  }
  return parsed;
}

function extractXmlAttributeReferences(
  content: string,
  tagRegex: RegExp,
  attributeName: string,
): string[] {
  return Array.from(content.matchAll(tagRegex), (match) => {
    if (match[0].startsWith('<!--')) {
      return null;
    }
    return parseXmlAttributeMap(match[1] ?? '').get(attributeName)?.trim() ?? null;
  }).filter((value): value is string => Boolean(value));
}

function buildSourceFileIndex(
  availableFiles: RobotFile[],
  allFileContents: Record<string, string>,
): Map<string, SourceTextFileEntry> {
  const index = new Map<string, SourceTextFileEntry>();

  availableFiles.forEach((file) => {
    if (file.format === 'mesh' || file.format === 'asset') {
      return;
    }

    const normalizedPath = normalizeSourcePath(file.name);
    index.set(normalizedPath, {
      path: file.name,
      content: file.content,
      format: file.format,
      blobUrl: file.blobUrl,
    });
  });

  Object.entries(allFileContents).forEach(([path, content]) => {
    if (typeof content !== 'string') {
      return;
    }

    const normalizedPath = normalizeSourcePath(path);
    const existingEntry = index.get(normalizedPath);
    index.set(normalizedPath, {
      path: existingEntry?.path ?? path,
      content,
      format: existingEntry?.format ?? detectImportFormat(content, path),
      blobUrl: existingEntry?.blobUrl,
    });
  });

  return index;
}

function extractIncludeReferences(format: SourceFileFormat, content: string): string[] {
  if (format === 'xacro') {
    return extractXmlAttributeReferences(content, XACRO_INCLUDE_REGEX, 'filename');
  }

  if (format === 'mjcf') {
    return extractXmlAttributeReferences(content, MJCF_INCLUDE_REGEX, 'file');
  }

  if (format === 'usd') {
    return extractUsdLayerReferencesFromText(content);
  }

  return [];
}

function resolveXacroReference(
  reference: string,
  fileIndex: Map<string, SourceTextFileEntry>,
  basePath: string,
): string | null {
  const trimmedReference = reference.trim();
  if (!trimmedReference) {
    return null;
  }

  const normalizedKeys = Array.from(fileIndex.keys());
  const packageReferenceMatch = trimmedReference.match(/^\$\(find\s+([^)]+)\)(?:\/(.*))?$/);
  if (packageReferenceMatch) {
    const packageName = packageReferenceMatch[1]?.trim();
    const relativePath = normalizeSourcePath(packageReferenceMatch[2] ?? '');
    const searchPattern = normalizeSourcePath(
      relativePath ? `${packageName}/${relativePath}` : packageName,
    );

    return (
      normalizedKeys.find(
        (candidate) => candidate === searchPattern || candidate.endsWith(`/${searchPattern}`),
      ) ?? null
    );
  }

  const normalizedReference = normalizeSourcePath(trimmedReference);
  if (!normalizedReference) {
    return null;
  }

  const normalizedBasePath = normalizeSourcePath(basePath);
  if (normalizedBasePath) {
    const baseParts = normalizedBasePath.split('/').filter(Boolean);
    for (let index = baseParts.length; index >= 0; index -= 1) {
      const prefix = baseParts.slice(0, index).join('/');
      const candidatePath = normalizeSourcePath(
        prefix ? `${prefix}/${normalizedReference}` : normalizedReference,
      );
      if (fileIndex.has(candidatePath)) {
        return candidatePath;
      }
    }
  }

  if (fileIndex.has(normalizedReference)) {
    return normalizedReference;
  }

  const fuzzyMatch = normalizedKeys.find(
    (candidate) =>
      candidate === normalizedReference || candidate.endsWith(`/${normalizedReference}`),
  );
  if (fuzzyMatch) {
    return fuzzyMatch;
  }

  const fileName = getSourceFileName(normalizedReference);
  if (!fileName || !fileName.includes('.')) {
    return null;
  }

  return (
    normalizedKeys.find(
      (candidate) => candidate === fileName || candidate.endsWith(`/${fileName}`),
    ) ?? null
  );
}

function resolveMjcfReference(
  reference: string,
  fileIndex: Map<string, SourceTextFileEntry>,
  basePath: string,
): string | null {
  const normalizedReference = normalizeSourcePath(reference.trim());
  if (!normalizedReference) {
    return null;
  }

  const normalizedBasePath = normalizeSourcePath(basePath);
  if (normalizedBasePath) {
    const baseParts = normalizedBasePath.split('/').filter(Boolean);
    for (let index = baseParts.length; index >= 0; index -= 1) {
      const prefix = baseParts.slice(0, index).join('/');
      const candidatePath = normalizeSourcePath(
        prefix ? `${prefix}/${normalizedReference}` : normalizedReference,
      );
      if (fileIndex.has(candidatePath)) {
        return candidatePath;
      }
    }
  }

  if (fileIndex.has(normalizedReference)) {
    return normalizedReference;
  }

  return null;
}

function resolveUsdReference(
  reference: string,
  fileIndex: Map<string, SourceTextFileEntry>,
  parentPath: string,
): string | null {
  const resolvedVirtualPath = resolveUsdLayerReferencePath(parentPath, reference);
  if (!resolvedVirtualPath) {
    return null;
  }

  const normalizedResolvedPath = normalizeSourcePath(resolvedVirtualPath);
  if (fileIndex.has(normalizedResolvedPath)) {
    return normalizedResolvedPath;
  }

  const normalizedReference = normalizeSourcePath(reference);
  if (fileIndex.has(normalizedReference)) {
    return normalizedReference;
  }

  const normalizedKeys = Array.from(fileIndex.keys());
  return (
    normalizedKeys.find(
      (candidate) =>
        candidate === normalizedResolvedPath ||
        candidate.endsWith(`/${normalizedResolvedPath}`) ||
        candidate === normalizedReference ||
        candidate.endsWith(`/${normalizedReference}`),
    ) ?? null
  );
}

function resolveIncludedFilePath(
  parentFormat: SourceFileFormat,
  reference: string,
  fileIndex: Map<string, SourceTextFileEntry>,
  basePath: string,
  parentPath: string,
): string | null {
  if (parentFormat === 'xacro') {
    return resolveXacroReference(reference, fileIndex, basePath);
  }

  if (parentFormat === 'mjcf') {
    return resolveMjcfReference(reference, fileIndex, basePath);
  }

  if (parentFormat === 'usd') {
    return resolveUsdReference(reference, fileIndex, parentPath);
  }

  return null;
}

function resolveRelatedDocumentFlavor(
  entry: SourceTextFileEntry,
  fallbackFormat: SourceFileFormat,
): SourceCodeDocumentFlavor {
  if (entry.format === 'urdf') {
    return 'urdf';
  }
  if (entry.format === 'xacro') {
    return 'xacro';
  }
  if (entry.format === 'sdf') {
    return 'sdf';
  }
  if (entry.format === 'usd') {
    return 'usd';
  }
  if (entry.format === 'mjcf') {
    return 'mjcf';
  }

  return fallbackFormat === 'mjcf' ? 'mjcf' : 'xacro';
}

function resolveGeneratedDocumentFormat(
  documentFlavor: SourceCodeDocumentFlavor,
): SourceFileFormat {
  switch (documentFlavor) {
    case 'urdf':
      return 'urdf';
    case 'xacro':
      return 'xacro';
    case 'sdf':
      return 'sdf';
    case 'mjcf':
      return 'mjcf';
    default:
      return null;
  }
}

function shouldEnableValidationForDocument(
  documentFlavor: SourceCodeDocumentFlavor,
  content: string,
  isPrimaryDocument: boolean,
): boolean | undefined {
  if (isPrimaryDocument) {
    return undefined;
  }

  const rootPattern = SOURCE_ROOT_PATTERNS[documentFlavor];
  if (!rootPattern) {
    return false;
  }

  return rootPattern.test(content);
}

function buildDisplayNames(filePaths: string[]): Map<string, string> {
  const segmentsByPath = new Map(
    filePaths.map((filePath) => [
      filePath,
      normalizeSourcePath(filePath).split('/').filter(Boolean),
    ]),
  );
  const baseNameCounts = new Map<string, number>();

  filePaths.forEach((filePath) => {
    const baseName = getSourceFileName(filePath);
    baseNameCounts.set(baseName, (baseNameCounts.get(baseName) ?? 0) + 1);
  });

  const displayNames = new Map<string, string>();

  filePaths.forEach((filePath) => {
    const baseName = getSourceFileName(filePath);
    if ((baseNameCounts.get(baseName) ?? 0) <= 1) {
      displayNames.set(filePath, baseName);
      return;
    }

    const currentSegments = segmentsByPath.get(filePath) ?? [baseName];
    let nextLabel = baseName;
    for (let segmentCount = 2; segmentCount <= currentSegments.length; segmentCount += 1) {
      const candidate = currentSegments.slice(-segmentCount).join('/');
      const collision = filePaths.some((otherFilePath) => {
        if (otherFilePath === filePath) {
          return false;
        }
        const otherSegments = segmentsByPath.get(otherFilePath) ?? [
          getSourceFileName(otherFilePath),
        ];
        return otherSegments.slice(-segmentCount).join('/') === candidate;
      });
      if (!collision) {
        nextLabel = candidate;
        break;
      }
    }

    displayNames.set(filePath, nextLabel);
  });

  return displayNames;
}

function collectRelatedSourceEntries(
  rootFile: RobotFile,
  rootContent: string,
  fileIndex: Map<string, SourceTextFileEntry>,
): SourceTextFileEntry[] {
  const visitedPaths = new Set<string>([normalizeSourcePath(rootFile.name)]);
  const relatedEntries: SourceTextFileEntry[] = [];

  const visitEntry = (entryPath: string, entryContent: string, entryFormat: SourceFileFormat) => {
    const includeReferences = extractIncludeReferences(entryFormat, entryContent);
    if (includeReferences.length === 0) {
      return;
    }

    const basePath = getSourceBasePath(entryPath);
    includeReferences.forEach((reference) => {
      const resolvedPath = resolveIncludedFilePath(
        entryFormat,
        reference,
        fileIndex,
        basePath,
        entryPath,
      );
      if (!resolvedPath || visitedPaths.has(resolvedPath)) {
        return;
      }

      const relatedEntry = fileIndex.get(resolvedPath);
      if (!relatedEntry) {
        return;
      }

      visitedPaths.add(resolvedPath);
      relatedEntries.push(relatedEntry);
      visitEntry(relatedEntry.path, relatedEntry.content, relatedEntry.format ?? entryFormat);
    });
  };

  visitEntry(rootFile.name, rootContent, rootFile.format);
  return relatedEntries;
}

export function buildSourceCodeDocuments({
  componentId,
  activeSourceFile,
  sourceCodeContent,
  sourceCodeDocumentFlavor,
  availableFiles,
  allFileContents,
  forceReadOnly = false,
}: BuildSourceCodeDocumentsParams): SourceCodeDocumentDescriptor[] {
  if (!activeSourceFile) {
    const generatedDocumentFormat = resolveGeneratedDocumentFormat(sourceCodeDocumentFlavor);
    const isReadOnly = forceReadOnly || isSourceCodeDocumentReadOnly(sourceCodeDocumentFlavor);
    return [
      {
        id: 'source:robot',
        fileName: 'robot.urdf',
        tabLabel: 'robot.urdf',
        filePath: null,
        content: sourceCodeContent,
        documentFlavor: sourceCodeDocumentFlavor,
        readOnly: isReadOnly,
        changeTarget:
          !isReadOnly && generatedDocumentFormat
            ? {
                kind: 'component',
                name: 'robot.urdf',
                componentId,
                format: generatedDocumentFormat,
                content: sourceCodeContent,
                persistContent: false,
              }
            : undefined,
      },
    ];
  }

  const primaryDocumentPath = activeSourceFile.name;
  const primaryDocuments: SourceCodeDocumentDescriptor[] = [
    {
      id: `source:${primaryDocumentPath}`,
      fileName: getSourceFileName(primaryDocumentPath),
      tabLabel: getSourceFileName(primaryDocumentPath),
      filePath: primaryDocumentPath,
      content: sourceCodeContent,
      contentUrl:
        activeSourceFile.format === 'usd' && !sourceCodeContent
          ? activeSourceFile.blobUrl
          : undefined,
      documentFlavor: sourceCodeDocumentFlavor,
      readOnly: forceReadOnly || isSourceCodeDocumentReadOnly(sourceCodeDocumentFlavor),
      changeTarget:
        forceReadOnly || isSourceCodeDocumentReadOnly(sourceCodeDocumentFlavor)
          ? undefined
          : {
              kind: 'component',
              componentId,
              name: activeSourceFile.name,
              format: activeSourceFile.format,
            },
    },
  ];

  const canCollectRelatedSources =
    (activeSourceFile.format === 'xacro' ||
      activeSourceFile.format === 'mjcf' ||
      activeSourceFile.format === 'usd') &&
    (activeSourceFile.format !== 'mjcf' || sourceCodeContent === activeSourceFile.content);

  if (!canCollectRelatedSources) {
    return primaryDocuments;
  }

  const sourceFileIndex = buildSourceFileIndex(availableFiles, allFileContents);
  const relatedEntries = collectRelatedSourceEntries(
    activeSourceFile,
    activeSourceFile.content,
    sourceFileIndex,
  );

  if (relatedEntries.length === 0) {
    return primaryDocuments;
  }

  const displayNames = buildDisplayNames([
    primaryDocumentPath,
    ...relatedEntries.map((entry) => entry.path),
  ]);

  primaryDocuments[0] = {
    ...primaryDocuments[0],
    tabLabel: displayNames.get(primaryDocumentPath) ?? primaryDocuments[0].fileName,
  };

  const relatedDocuments = relatedEntries.map<SourceCodeDocumentDescriptor>((entry) => {
    const documentFlavor = resolveRelatedDocumentFlavor(entry, activeSourceFile.format);
    return {
      id: `source:${entry.path}`,
      fileName: getSourceFileName(entry.path),
      tabLabel: displayNames.get(entry.path) ?? getSourceFileName(entry.path),
      filePath: entry.path,
      content: entry.content,
      contentUrl: entry.format === 'usd' && !entry.content ? entry.blobUrl : undefined,
      documentFlavor,
      readOnly: true,
      validationEnabled: shouldEnableValidationForDocument(documentFlavor, entry.content, false),
      changeTarget: undefined,
    };
  });

  return [...primaryDocuments, ...relatedDocuments];
}

function getGeneratedWorkspaceSourceFileName(workspace: AssemblyState): string {
  const baseName = workspace.name.trim().replace(/[^a-zA-Z0-9_-]+/g, '_') || 'workspace';
  return `${baseName}.urdf`;
}

function sanitizeSourceFileBaseName(name: string): string {
  return name.trim().replace(/[^a-zA-Z0-9_-]+/g, '_') || 'workspace';
}

/**
 * Build the editable draft documents for a single component. Returns [] when the
 * component has no owned draft (the caller then falls back to a generated view).
 */
function buildComponentDraftDocuments(
  component: AssemblyComponent,
  componentSourceDrafts: Record<string, ComponentSourceDraft>,
  availableFiles: RobotFile[],
  allFileContents: Record<string, string>,
): SourceCodeDocumentDescriptor[] {
  const draft = componentSourceDrafts[component.id];
  // The source editor may recover an owned draft whose semantic hash drifted
  // during canonical post-import normalization. Export and viewer resolution keep
  // their stricter hash checks; an explicit source save reparses the draft and
  // commits through the workspace-revision CAS.
  if (draft?.componentId !== component.id) {
    return [];
  }
  const sourceName = component.sourceFile ?? `component.${draft.format}`;
  const librarySource = availableFiles.find((file) => file.name === sourceName);
  const sourceFile: RobotFile = {
    ...librarySource,
    name: sourceName,
    format: draft.format,
    content: draft.content,
  };
  const documentFlavor = getSourceCodeDocumentFlavor(sourceFile);
  return buildSourceCodeDocuments({
    componentId: component.id,
    activeSourceFile: sourceFile,
    sourceCodeContent: draft.content,
    sourceCodeDocumentFlavor: documentFlavor,
    availableFiles,
    allFileContents,
    forceReadOnly: hasComponentEditorLocks(component),
  });
}

/**
 * Namespace a component's document ids (and tab labels) so multiple robots can
 * coexist as distinct tabs. Only applied when more than one component is present;
 * a lone robot keeps its original ids/labels. Edit routing is unaffected because
 * each descriptor already carries its `changeTarget.componentId`.
 */
function prefixComponentDocuments(
  documents: SourceCodeDocumentDescriptor[],
  component: AssemblyComponent,
  disambiguate: boolean,
): SourceCodeDocumentDescriptor[] {
  if (!disambiguate) {
    return documents;
  }
  return documents.map((document) => ({
    ...document,
    id: `comp:${component.id}:${document.id}`,
    tabLabel: `${component.name} / ${document.tabLabel ?? document.fileName}`,
  }));
}

function buildComponentGeneratedFallbackDocument(
  workspace: AssemblyState,
  component: AssemblyComponent,
  disambiguate: boolean,
): SourceCodeDocumentDescriptor {
  const content = component.robot
    ? generateURDF(
        { ...component.robot, selection: { type: null, id: null } },
        { preserveMeshPaths: true },
      )
    : '';
  const fileName = disambiguate
    ? `${sanitizeSourceFileBaseName(component.name)}.urdf`
    : getGeneratedWorkspaceSourceFileName(workspace);
  return {
    id: disambiguate ? `comp:${component.id}:generated` : 'source:workspace-projection',
    fileName,
    tabLabel: disambiguate ? component.name : fileName,
    filePath: null,
    content,
    documentFlavor: 'urdf',
    readOnly: true,
    validationEnabled: true,
  };
}

function buildGroupSubAssembly(workspace: AssemblyState, componentIds: string[]): AssemblyState {
  const idSet = new Set(componentIds);
  const components: AssemblyState['components'] = {};
  for (const id of componentIds) {
    const component = workspace.components[id];
    if (component) {
      components[id] = component;
    }
  }
  const bridges: AssemblyState['bridges'] = {};
  for (const [bridgeId, bridge] of Object.entries(workspace.bridges)) {
    if (idSet.has(bridge.parentComponentId) && idSet.has(bridge.childComponentId)) {
      bridges[bridgeId] = bridge;
    }
  }
  return { ...workspace, components, bridges };
}

/**
 * One URDF document per bridge-connected group. A source-preserving graft is
 * editable through provenance partitioning; unsupported shapes fall back to a
 * fully re-serialized read-only projection.
 */
function buildGroupMergedDocument(
  workspace: AssemblyState,
  componentIds: string[],
  componentSourceDrafts: Record<string, ComponentSourceDraft>,
): SourceCodeDocumentDescriptor {
  const editorLocked = componentIds.some((componentId) => {
    const component = workspace.components[componentId];
    return Boolean(component && hasComponentEditorLocks(component));
  });
  const masterComponentId = resolveAssemblyGroupMasterComponentId(workspace, componentIds);
  const masterComponent = masterComponentId ? workspace.components[masterComponentId] : null;
  const groupName = masterComponent?.name || workspace.name;
  const documentId = `group:${masterComponentId ?? componentIds[0]}:urdf`;
  const fileName = `${sanitizeSourceFileBaseName(groupName)}.urdf`;

  if (masterComponentId && masterComponent) {
    const masterDraft = componentSourceDrafts[masterComponentId];
    if (masterDraft?.componentId === masterComponentId && masterDraft.format === 'urdf') {
      const grafted = graftAssemblyGroupUrdfSource({
        assembly: workspace,
        groupComponentIds: componentIds,
        masterComponentId,
        masterSourceUrdfText: masterDraft.content,
      });
      if (grafted.ok && grafted.urdfText != null && grafted.provenance) {
        return {
          id: documentId,
          fileName,
          tabLabel: groupName,
          filePath: null,
          content: grafted.urdfText,
          documentFlavor: 'urdf',
          readOnly: editorLocked,
          validationEnabled: true,
          changeTarget: editorLocked
            ? undefined
            : {
                kind: 'group',
                rootComponentId: masterComponentId,
                groupComponentIds: [...componentIds],
                provenance: grafted.provenance,
              },
        };
      }
    }
  }

  const subAssembly = buildGroupSubAssembly(workspace, componentIds);
  const projectedRobot = buildExportableAssemblyRobotData(subAssembly);
  const content = projectedRobot
    ? generateURDF(
        { ...projectedRobot, selection: { type: null, id: null } },
        { preserveMeshPaths: true },
      )
    : '';
  return {
    id: documentId,
    fileName,
    tabLabel: groupName,
    filePath: null,
    content,
    documentFlavor: 'urdf',
    readOnly: true,
    validationEnabled: true,
  };
}

/**
 * Canonical source-editor contract. Components with no bridge each get their own
 * editable tab; bridge-connected components collapse into one flattened URDF tab
 * per connected group. Successful grafts route edits through group provenance;
 * fallback projections remain read-only.
 */
export function buildCanonicalWorkspaceSourceDocuments({
  workspace,
  activeComponentId,
  componentSourceDrafts,
  availableFiles,
  allFileContents,
}: BuildCanonicalWorkspaceSourceDocumentsParams): CanonicalWorkspaceSourceDocuments {
  const componentIds = Object.keys(workspace.components);
  const resolvedComponentId =
    activeComponentId && workspace.components[activeComponentId]
      ? activeComponentId
      : componentIds[0] ?? null;
  const disambiguate = componentIds.length > 1;

  const groups = analyzeAssemblyConnectivity(workspace).connectedGroups;
  const documents: SourceCodeDocumentDescriptor[] = [];
  const documentIdsByComponent = new Map<string, string[]>();
  let directComponentDocument: SourceCodeDocumentDescriptor | null = null;
  let hasMultiComponentGroup = false;

  for (const group of groups) {
    if (group.componentIds.length > 1) {
      hasMultiComponentGroup = true;
      const mergedDocument = buildGroupMergedDocument(
        workspace,
        group.componentIds,
        componentSourceDrafts,
      );
      for (const componentId of group.componentIds) {
        documentIdsByComponent.set(componentId, [mergedDocument.id]);
      }
      documents.push(mergedDocument);
      continue;
    }

    const componentId = group.componentIds[0];
    const component = componentId ? workspace.components[componentId] : undefined;
    if (!component) {
      continue;
    }

    const draftDocuments = prefixComponentDocuments(
      buildComponentDraftDocuments(component, componentSourceDrafts, availableFiles, allFileContents),
      component,
      disambiguate,
    );
    const componentDocuments =
      draftDocuments.length > 0
        ? draftDocuments
        : [buildComponentGeneratedFallbackDocument(workspace, component, disambiguate)];
    documentIdsByComponent.set(
      component.id,
      componentDocuments.map((document) => document.id),
    );
    if (component.id === resolvedComponentId) {
      // The direct component document is the active component's editable draft
      // (may be read-only for USD); null when only a generated fallback exists.
      directComponentDocument = draftDocuments[0] ?? null;
    }
    documents.push(...componentDocuments);
  }

  if (documents.length === 0) {
    const fileName = getGeneratedWorkspaceSourceFileName(workspace);
    const emptyDocument: SourceCodeDocumentDescriptor = {
      id: 'source:workspace-projection',
      fileName,
      tabLabel: fileName,
      filePath: null,
      content: '',
      documentFlavor: 'urdf',
      readOnly: true,
      validationEnabled: true,
    };
    return {
      mode: 'component',
      componentId: resolvedComponentId,
      documents: [emptyDocument],
      content: '',
      documentFlavor: 'urdf',
      fileName,
      directComponentDocument: null,
    };
  }

  // Surface the active component's document in the window title / aggregate fields,
  // falling back to the first document when the active component is unresolved.
  const activeDocumentIds = resolvedComponentId
    ? documentIdsByComponent.get(resolvedComponentId) ?? []
    : [];
  const activeDocument =
    documents.find((document) => activeDocumentIds.includes(document.id)) ?? documents[0];

  return {
    mode: hasMultiComponentGroup ? 'assembly' : 'component',
    componentId: resolvedComponentId,
    documents,
    content: activeDocument.content,
    documentFlavor: activeDocument.documentFlavor,
    fileName: activeDocument.fileName,
    directComponentDocument,
  };
}
