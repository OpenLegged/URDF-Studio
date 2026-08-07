import { resolveSourcePreservingComponentDraft } from '@/core/robot';
import type { AssemblySceneProjection } from '@/core/robot';
import { escapeXmlAttribute } from '@/core/utils/xmlSourceTextUtils';
import type { ViewerRobotSourceFormat } from '@/features/editor';
import type {
  AssemblyComponent,
  AssemblyState,
  ComponentSourceDraft,
  RobotFile,
} from '@/types';

export interface CanonicalWorkspaceViewerDocument {
  sourceFile: RobotFile;
  sourceFilePath: string;
  sourceFormat: ViewerRobotSourceFormat;
  urdfContent: string;
  componentId: string | null;
  synthetic: boolean;
}

function createSyntheticWorkspaceDocument(
  workspace: AssemblyState,
  component: AssemblyComponent | null,
): CanonicalWorkspaceViewerDocument {
  const sourcePath = component?.sourceFile ?? '__workspace__/assembly.urdf';
  const lastDot = sourcePath.lastIndexOf('.');
  const syntheticPath = lastDot >= 0
    ? `${sourcePath.slice(0, lastDot)}.__workspace__.urdf`
    : `${sourcePath}.__workspace__.urdf`;
  const urdfContent = `<robot name="${escapeXmlAttribute(workspace.name)}"></robot>`;
  const sourceFile: RobotFile = {
    name: syntheticPath,
    format: 'urdf',
    content: urdfContent,
  };
  return {
    sourceFile,
    sourceFilePath: syntheticPath,
    sourceFormat: 'urdf',
    urdfContent,
    componentId: component?.id ?? null,
    synthetic: true,
  };
}

/**
 * Selects only renderer resource context. Canonical selection/mutation routing
 * always stays on the workspace projection and never depends on this document.
 */
export function resolveCanonicalWorkspaceViewerDocument({
  workspace,
  projection,
  availableFiles,
  componentSourceDrafts,
}: {
  workspace: AssemblyState;
  projection: AssemblySceneProjection;
  availableFiles: RobotFile[];
  componentSourceDrafts: Record<string, ComponentSourceDraft>;
}): CanonicalWorkspaceViewerDocument {
  const directComponent = projection.renderStrategy === 'direct-component'
    ? Object.values(workspace.components).find((component) => component.visible !== false) ?? null
    : null;
  if (!directComponent?.sourceFile) {
    return createSyntheticWorkspaceDocument(workspace, directComponent);
  }

  const librarySource = availableFiles.find(
    (file) => file.name === directComponent.sourceFile,
  );
  // Hydrated USD and assembled scenes must use structured RobotData through a
  // non-USD backend. Passing a USD source here is explicitly rejected.
  if (!librarySource || librarySource.format === 'usd') {
    return createSyntheticWorkspaceDocument(workspace, directComponent);
  }

  const draftResolution = resolveSourcePreservingComponentDraft({
    workspace,
    componentId: directComponent.id,
    drafts: componentSourceDrafts,
  });
  const content = draftResolution.status === 'matched'
    ? draftResolution.draft.content
    : librarySource.content;
  const sourceFile = { ...librarySource, content };
  return {
    sourceFile,
    sourceFilePath: sourceFile.name,
    sourceFormat: sourceFile.format as ViewerRobotSourceFormat,
    urdfContent: content,
    componentId: directComponent.id,
    synthetic: false,
  };
}
