import {
  buildAssemblyExportProjection,
  isIdentityAssemblyTransform,
} from '@/core/robot/assemblyTransforms';
import {
  buildAssemblyProjectedAssetAliases,
  resolveAssemblyComponentResourcePath,
  resolveAssemblySceneRenderStrategy,
  resolveSourcePreservingComponentDraft,
} from '@/core/robot';
import type {
  AssemblyComponent,
  AssemblyState,
  ComponentSourceDraft,
  ComponentSourceFormat,
  RobotState,
  UsdPreparedExportCache,
} from '@/types';

import type { ExportContext } from './types';

export interface CanonicalComponentSourceFile {
  name: string;
  format: ComponentSourceFormat;
  content: string;
}

export interface CanonicalExportContext extends ExportContext {
  identityComponent: AssemblyComponent | null;
  sourceFile: CanonicalComponentSourceFile | null;
}

export function buildCanonicalWorkspaceExportAssets({
  workspace,
  assets,
}: {
  workspace: AssemblyState;
  assets: Record<string, string>;
}): Record<string, string> {
  const aliases = buildAssemblyProjectedAssetAliases({ assembly: workspace, assets });
  return Object.keys(aliases).length > 0 ? { ...assets, ...aliases } : assets;
}

export function collectCanonicalWorkspacePreparedMeshFiles({
  workspace,
  getPreparedCache,
}: {
  workspace: AssemblyState;
  getPreparedCache: (sourceFile: string) => UsdPreparedExportCache | null;
}): Map<string, Blob> {
  const renderStrategy = resolveAssemblySceneRenderStrategy(workspace);
  const meshFiles = new Map<string, Blob>();
  Object.values(workspace.components).forEach((component) => {
    if (component.visible === false || !component.sourceFile) return;
    const cache = getPreparedCache(component.sourceFile);
    Object.entries(cache?.meshFiles ?? {}).forEach(([sourceLocalPath, blob]) => {
      const projectedPath = resolveAssemblyComponentResourcePath({
        componentId: component.id,
        sourceFile: component.sourceFile,
        resourcePath: sourceLocalPath,
        renderStrategy,
      });
      meshFiles.set(projectedPath, blob);
    });
  });
  return meshFiles;
}

function getFileBaseName(path: string): string {
  const fileName = path.replace(/\\/g, '/').split('/').pop() ?? path;
  return fileName.replace(/\.(?:urdf\.xacro|[^.]+)$/i, '') || 'robot';
}

function sanitizeExportName(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'assembly';
}

function getGeneratedSourceFileName(
  robotName: string,
  format: ComponentSourceFormat,
): string {
  const extension = format === 'mjcf'
    ? 'xml'
    : format === 'xacro'
      ? 'urdf.xacro'
      : format;
  return `${sanitizeExportName(robotName)}.${extension}`;
}

export function resolveIdentityExportComponent(
  workspace: AssemblyState,
): AssemblyComponent | null {
  const visibleComponents = Object.values(workspace.components).filter(
    (component) => component.visible !== false,
  );
  if (
    visibleComponents.length !== 1
    || Object.keys(workspace.bridges).length > 0
    || !isIdentityAssemblyTransform(workspace.transform)
  ) {
    return null;
  }
  const component = visibleComponents[0]!;
  return isIdentityAssemblyTransform(component.transform) ? component : null;
}

/** Canonical current-target export. Library files are deliberately not consulted. */
export function buildCanonicalExportContext({
  workspace,
  componentSourceDrafts,
}: {
  workspace: AssemblyState;
  componentSourceDrafts: Record<string, ComponentSourceDraft>;
}): CanonicalExportContext {
  const identityComponent = resolveIdentityExportComponent(workspace);
  const sourceResolution = identityComponent
    ? resolveSourcePreservingComponentDraft({
        workspace,
        componentId: identityComponent.id,
        drafts: componentSourceDrafts,
      })
    : null;
  const sourceFile =
    identityComponent && sourceResolution?.status === 'matched'
      ? {
          name: identityComponent.sourceFile
            ?? getGeneratedSourceFileName(
              identityComponent.robot.name,
              sourceResolution.draft.format,
            ),
          format: sourceResolution.draft.format,
          content: sourceResolution.draft.content,
        }
      : null;
  const { robotData, frameLinkIds } = buildAssemblyExportProjection(workspace);
  const robot: RobotState = {
    ...robotData,
    selection: { type: null, id: null },
  };
  const exportName = identityComponent?.sourceFile
    ? getFileBaseName(identityComponent.sourceFile)
    : sourceFile
      ? getFileBaseName(sourceFile.name)
    : sanitizeExportName(
        identityComponent?.robot.name
        || workspace.name
        || robot.name,
      );

  return {
    robot,
    mjcfFrameLinkIds: frameLinkIds,
    exportName,
    identityComponent,
    sourceFile,
  };
}
