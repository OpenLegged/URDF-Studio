import type {
  AssemblyComponent,
  AssemblyState,
  ComponentSourceDraft,
  RobotFile,
} from '@/types';
import { buildExportableAssemblyRobotData } from '@/core/robot/assemblyTransforms';
import { analyzeAssemblyConnectivity } from '@/core/robot/assemblyConnectivity';
import type { SourceCodeDocumentFlavor } from './sourceCodeDisplay';
import {
  collectRelatedSourceEntries,
  getSourceFileName,
  normalizeSourcePath,
  type SourceFileFormat,
  type SourceTextFileEntry,
} from '@/core/parsers/sourceReferenceGraph';
import { getSourceCodeDocumentFlavor, isSourceCodeDocumentReadOnly } from './sourceCodeDisplay.ts';
import {
  graftAssemblyGroupUrdfSource,
  resolveAssemblyGroupMasterComponentId,
} from './assemblyUrdfSourceGraft.ts';
import type { GraftAssemblyGroupUrdfSourceProvenance } from './assemblyUrdfSourceGraft.ts';
import {
  tryGenerateEditableRobotSource,
  resolveEditableRobotSourceFormat,
} from './generateEditableRobotSource.ts';

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
  /** User-selected fallback format for URDF-sourced closed-loop source views. */
  closedLoopSourceFallbackFormat?: 'sdf' | 'mjcf';
}

interface BuildSourceCodeDocumentsParams {
  componentId: string;
  activeSourceFile: RobotFile | null;
  sourceCodeContent: string;
  sourceCodeDocumentFlavor: SourceCodeDocumentFlavor;
  availableFiles: RobotFile[];
  allFileContents: Record<string, string>;
}

const SOURCE_ROOT_PATTERNS: Partial<Record<SourceCodeDocumentFlavor, RegExp>> = {
  urdf: /<robot\b/i,
  xacro: /<\s*(?:xacro:)?robot\b/i,
  sdf: /<sdf\b/i,
  mjcf: /<mujoco\b/i,
  'equivalent-mjcf': /<mujoco\b/i,
  usd: /#usda\b/i,
};

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

export function buildSourceCodeDocuments({
  componentId,
  activeSourceFile,
  sourceCodeContent,
  sourceCodeDocumentFlavor,
  availableFiles,
  allFileContents,
}: BuildSourceCodeDocumentsParams): SourceCodeDocumentDescriptor[] {
  if (!activeSourceFile) {
    const generatedDocumentFormat = resolveGeneratedDocumentFormat(sourceCodeDocumentFlavor);
    const isReadOnly = isSourceCodeDocumentReadOnly(sourceCodeDocumentFlavor);
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
      readOnly: isSourceCodeDocumentReadOnly(sourceCodeDocumentFlavor),
      changeTarget:
        isSourceCodeDocumentReadOnly(sourceCodeDocumentFlavor)
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

  const relatedEntries = collectRelatedSourceEntries({
    rootFile: activeSourceFile,
    availableFiles,
    allFileContents,
  });

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

function getGeneratedWorkspaceSourceFileName(workspace: AssemblyState, extension = 'urdf'): string {
  const baseName = workspace.name.trim().replace(/[^a-zA-Z0-9_-]+/g, '_') || 'workspace';
  return `${baseName}.${extension}`;
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
  closedLoopFallbackOptions: { closedLoopFallbackFormat: 'sdf' | 'mjcf' },
): SourceCodeDocumentDescriptor {
  const format = resolveEditableRobotSourceFormat(
    component.robot,
    undefined,
    closedLoopFallbackOptions,
  );
  const content = component.robot
    ? tryGenerateEditableRobotSource({
        format,
        robotState: { ...component.robot, selection: { type: null, id: null } },
        includeHardware: 'auto',
        preserveMeshPaths: true,
      })
    : '';
  const extension = format === 'mjcf' ? 'xml' : format;
  const fileName = disambiguate
    ? `${sanitizeSourceFileBaseName(component.name)}.${extension}`
    : getGeneratedWorkspaceSourceFileName(workspace, extension);
  return {
    id: disambiguate ? `comp:${component.id}:generated` : 'source:workspace-projection',
    fileName,
    tabLabel: disambiguate ? component.name : fileName,
    filePath: null,
    content: content ?? '',
    documentFlavor: format,
    readOnly: content === null,
    validationEnabled: true,
    changeTarget: content === null ? undefined : {
      kind: 'component',
      componentId: component.id,
      name: fileName,
      format,
      content,
      persistContent: false,
    },
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
 * One source document per bridge-connected group. A source-preserving URDF graft is
 * editable through provenance partitioning; unsupported shapes fall back to a
 * fully re-serialized read-only projection.
 */
function buildGroupMergedDocument(
  workspace: AssemblyState,
  componentIds: string[],
  componentSourceDrafts: Record<string, ComponentSourceDraft>,
  closedLoopFallbackOptions: { closedLoopFallbackFormat: 'sdf' | 'mjcf' },
): SourceCodeDocumentDescriptor {
  const masterComponentId = resolveAssemblyGroupMasterComponentId(workspace, componentIds);
  const masterComponent = masterComponentId ? workspace.components[masterComponentId] : null;
  const groupName = masterComponent?.name || workspace.name;
  const subAssembly = buildGroupSubAssembly(workspace, componentIds);
  const projectedRobot = buildExportableAssemblyRobotData(subAssembly);
  const format = resolveEditableRobotSourceFormat(
    projectedRobot,
    undefined,
    closedLoopFallbackOptions,
  );
  const documentId = `group:${masterComponentId ?? componentIds[0]}:${format}`;
  const fileName = `${sanitizeSourceFileBaseName(groupName)}.${format === 'mjcf' ? 'xml' : format}`;

  if (format === 'urdf' && masterComponentId && masterComponent) {
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
          readOnly: false,
          validationEnabled: true,
          changeTarget: {
            kind: 'group',
            rootComponentId: masterComponentId,
            groupComponentIds: [...componentIds],
            provenance: grafted.provenance,
          },
        };
      }
    }
  }

  const content = projectedRobot
    ? tryGenerateEditableRobotSource({
        format,
        robotState: { ...projectedRobot, selection: { type: null, id: null } },
        includeHardware: 'auto',
        preserveMeshPaths: true,
      })
    : '';
  return {
    id: documentId,
    fileName,
    tabLabel: groupName,
    filePath: null,
    content: content ?? '',
    documentFlavor: format,
    readOnly: true,
    validationEnabled: true,
  };
}

/**
 * Canonical source-editor contract. Components with no bridge each get their own
 * editable tab; bridge-connected components collapse into one flattened source tab
 * per connected group. Successful grafts route edits through group provenance;
 * fallback projections remain read-only.
 */
export function buildCanonicalWorkspaceSourceDocuments({
  workspace,
  activeComponentId,
  componentSourceDrafts,
  availableFiles,
  allFileContents,
  closedLoopSourceFallbackFormat,
}: BuildCanonicalWorkspaceSourceDocumentsParams): CanonicalWorkspaceSourceDocuments {
  const componentIds = Object.keys(workspace.components);
  const resolvedComponentId =
    activeComponentId && workspace.components[activeComponentId]
      ? activeComponentId
      : componentIds[0] ?? null;
  const disambiguate = componentIds.length > 1;
  const closedLoopFallbackOptions = {
    closedLoopFallbackFormat: closedLoopSourceFallbackFormat ?? 'sdf',
  };

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
        closedLoopFallbackOptions,
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
        : [
            buildComponentGeneratedFallbackDocument(
              workspace,
              component,
              disambiguate,
              closedLoopFallbackOptions,
            ),
          ];
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
