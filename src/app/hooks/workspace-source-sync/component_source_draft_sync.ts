import {
  createComponentSourceDraft,
  createSourceSemanticRobotHash,
  isComponentSourceDraftMatchingComponent,
} from '@/core/robot';
import { useAssetsStore } from '@/store/assetsStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import type {
  AssemblyComponent,
  ComponentSourceDraft,
  ComponentSourceFormat,
  RobotFile,
  RobotState,
} from '@/types';
import { generateEditableRobotSource } from '@/app/utils/generateEditableRobotSource';
import {
  patchSdfModelNameInSource,
  patchUrdfRobotNameInSource,
} from '@/app/utils/jointEditableSourcePatch';
import { patchMJCFRootModelNameInSource } from '@/app/utils/mjcfEditableSourcePatch';
import { resolveSourcePreservingExportContent } from '../sourcePreservingExportUtils';
import type { SourcePreservingExportFormat } from '../sourcePreservingExportUtils';

export type ComponentSourceDraftSyncOutcome =
  | 'created'
  | 'failed'
  | 'removed'
  | 'synchronized'
  | 'unchanged';

interface EditableSourceSeed {
  content: string;
  format: SourcePreservingExportFormat;
  name: string;
}

const EDITABLE_SOURCE_FORMATS = new Set<SourcePreservingExportFormat>([
  'urdf',
  'mjcf',
  'sdf',
  'xacro',
]);

function isEditableSourceFormat(
  format: ComponentSourceFormat | RobotFile['format'],
): format is SourcePreservingExportFormat {
  return EDITABLE_SOURCE_FORMATS.has(format as SourcePreservingExportFormat);
}

function getGeneratedSourceName(component: AssemblyComponent, format: SourcePreservingExportFormat) {
  return component.sourceFile ?? `component-${component.id}.${format}`;
}

function resolveEditableSourceSeed(
  component: AssemblyComponent,
  draft: ComponentSourceDraft | undefined,
  availableFiles: RobotFile[],
): EditableSourceSeed | null {
  if (draft) {
    if (!isEditableSourceFormat(draft.format)) return null;
    return {
      content: draft.content,
      format: draft.format,
      name: getGeneratedSourceName(component, draft.format),
    };
  }

  const librarySource = component.sourceFile
    ? availableFiles.find((file) => file.name === component.sourceFile)
    : undefined;
  if (librarySource) {
    if (!isEditableSourceFormat(librarySource.format)) return null;
    return {
      content: librarySource.content,
      format: librarySource.format,
      name: librarySource.name,
    };
  }

  if (component.robot.inspectionContext?.sourceFormat === 'usd') return null;

  return {
    content: '',
    format: 'urdf',
    name: getGeneratedSourceName(component, 'urdf'),
  };
}

function readSourceModelName(draft: ComponentSourceDraft): string | null {
  if (typeof DOMParser === 'undefined') return null;
  const document = new DOMParser().parseFromString(draft.content, 'text/xml');
  const tagName = draft.format === 'mjcf'
    ? 'mujoco'
    : draft.format === 'sdf'
      ? 'model'
      : 'robot';
  return document.getElementsByTagName(tagName).item(0)?.getAttribute(
    draft.format === 'mjcf' ? 'model' : 'name',
  )?.trim() || null;
}

function patchSourceModelName(
  draft: ComponentSourceDraft,
  name: string,
): string | null {
  if (draft.format === 'urdf' || draft.format === 'xacro') {
    return patchUrdfRobotNameInSource(draft.content, name);
  }
  if (draft.format === 'sdf') {
    return patchSdfModelNameInSource(draft.content, name);
  }
  if (draft.format === 'mjcf') {
    return patchMJCFRootModelNameInSource(draft.content, name);
  }
  return null;
}

function synchronizeNameOnlyDraft(
  component: AssemblyComponent,
  draft: ComponentSourceDraft,
): ComponentSourceDraft | null {
  const sourceName = readSourceModelName(draft);
  if (!sourceName || sourceName === component.robot.name) return null;

  const previousRobotHash = createSourceSemanticRobotHash({
    ...component.robot,
    name: sourceName,
  });
  if (previousRobotHash !== draft.robotSnapshotHash) return null;

  const content = patchSourceModelName(draft, component.robot.name);
  return content === null
    ? null
    : createComponentSourceDraft({
        componentId: component.id,
        format: draft.format,
        content,
        robot: component.robot,
      });
}

/**
 * Keep one component-owned editable source aligned with canonical RobotData.
 * Fine-grained property patchers run first; this is the source-preserving safety
 * net for unhandled mutations, missing drafts, undo/redo, and bulk operations.
 */
export function synchronizeComponentSourceDraft(
  componentId: string,
  options: { force?: boolean } = {},
): ComponentSourceDraftSyncOutcome {
  const workspace = useWorkspaceStore.getState().workspace;
  const component = workspace.components[componentId];
  const assets = useAssetsStore.getState();
  const currentDraft = assets.componentSourceDrafts[componentId];

  if (!component) {
    if (currentDraft) {
      assets.removeComponentSourceDraft(componentId);
      return 'removed';
    }
    return 'unchanged';
  }

  if (
    !options.force
    && currentDraft
    && isEditableSourceFormat(currentDraft.format)
    && isComponentSourceDraftMatchingComponent(currentDraft, component)
  ) {
    return 'unchanged';
  }

  const seed = resolveEditableSourceSeed(component, currentDraft, assets.availableFiles);
  if (!seed) return 'unchanged';
  const robotState: RobotState = {
    ...component.robot,
    selection: { type: null, id: null },
  };

  try {
    if (currentDraft && isEditableSourceFormat(currentDraft.format)) {
      const nameOnlyDraft = synchronizeNameOnlyDraft(component, currentDraft);
      if (nameOnlyDraft) {
        assets.setComponentSourceDraft(nameOnlyDraft);
        return 'synchronized';
      }
    }

    const generatedContent = generateEditableRobotSource({
      format: seed.format,
      robotState,
      preserveMeshPaths: true,
    });
    let content = generatedContent;

    if (seed.content.trim() && typeof DOMParser !== 'undefined') {
      try {
        content = resolveSourcePreservingExportContent({
          format: seed.format,
          currentRobot: robotState,
          sourceFile: seed,
          generatedContent,
          availableFiles: assets.availableFiles,
          allFileContents: assets.allFileContents,
        }).content;
      } catch (error) {
        // Complex macro/include sources are not always structurally patchable.
        // The generated component-owned draft remains editable and semantically
        // correct; the immutable library source is never overwritten.
        console.warn(
          `Falling back to generated editable source for component "${componentId}".`,
          error,
        );
      }
    }

    const nextDraft = createComponentSourceDraft({
      componentId,
      format: seed.format,
      content,
      robot: component.robot,
    });
    if (
      currentDraft
      && currentDraft.format === nextDraft.format
      && currentDraft.content === nextDraft.content
      && currentDraft.robotSnapshotHash === nextDraft.robotSnapshotHash
    ) {
      return 'unchanged';
    }

    assets.setComponentSourceDraft(nextDraft);
    return currentDraft ? 'synchronized' : 'created';
  } catch (error) {
    console.error(`Failed to synchronize source draft for component "${componentId}".`, error);
    return 'failed';
  }
}

/** Synchronize owned drafts and prune drafts whose owner no longer exists. */
export function synchronizeWorkspaceComponentSourceDrafts(): void {
  const workspace = useWorkspaceStore.getState().workspace;
  const componentIds = new Set(Object.keys(workspace.components));
  const draftIds = Object.keys(useAssetsStore.getState().componentSourceDrafts);

  draftIds.forEach((componentId) => {
    if (!componentIds.has(componentId)) {
      useAssetsStore.getState().removeComponentSourceDraft(componentId);
    }
  });
  Object.keys(useAssetsStore.getState().componentSourceDrafts).forEach((componentId) => {
    if (componentIds.has(componentId)) {
      synchronizeComponentSourceDraft(componentId);
    }
  });
}
