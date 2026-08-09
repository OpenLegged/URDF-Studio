import { analyzeAssemblyConnectivity } from '@/core/robot';
import {
  createUnsupportedUrdfJointError,
  findUnsupportedUrdfJoint,
} from '@/core/parsers/urdf/urdfExportSupport';
import type { AssemblyState, RobotState } from '@/types';
import type { ExportActionRequired, ExportTarget } from './types';

export interface BoxFaceFallbackWarningLabels {
  sdf: string;
  urdf: string;
  xacro: string;
}

export function createBoxFaceTextureFallbackWarnings(
  format: 'urdf' | 'sdf' | 'xacro',
  count: number,
  replaceTemplate: (template: string, replacements: Record<string, string | number>) => string,
  labels: BoxFaceFallbackWarningLabels,
): string[] {
  if (count <= 0) {
    return [];
  }

  const template = format === 'urdf' ? labels.urdf : format === 'sdf' ? labels.sdf : labels.xacro;

  return [
    replaceTemplate(template, {
      count,
    }),
  ];
}

export function assertUrdfExportSupported(
  robot: Pick<RobotState, 'name' | 'closedLoopConstraints'> & Partial<Pick<RobotState, 'joints'>>,
  exportName: string | undefined,
  replaceTemplate: (template: string, replacements: Record<string, string | number>) => string,
  unsupportedLabel: string,
): void {
  const unsupportedJoint = findUnsupportedUrdfJoint(robot);
  if (unsupportedJoint) {
    throw createUnsupportedUrdfJointError(
      unsupportedJoint.jointName,
      unsupportedJoint.jointType,
    );
  }
  const closedLoopConstraintCount = robot.closedLoopConstraints?.length ?? 0;
  if (closedLoopConstraintCount === 0) {
    return;
  }

  const resolvedExportName = exportName?.trim() || robot.name?.trim() || 'robot';
  throw new Error(
    replaceTemplate(unsupportedLabel, {
      name: resolvedExportName,
      count: closedLoopConstraintCount,
    }),
  );
}

export function assertAssemblyUrdfExportSupported(
  assembly: AssemblyState,
  replaceTemplate: (template: string, replacements: Record<string, string | number>) => string,
  unsupportedLabel: string,
): void {
  Object.values(assembly.components).forEach((component) => {
    assertUrdfExportSupported(
      component.robot,
      component.name?.trim() || component.id,
      replaceTemplate,
      unsupportedLabel,
    );
  });
}

function sanitizeAssemblyExportNameSegment(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function buildAssemblyExportName(assembly: AssemblyState): string {
  const componentName = Object.values(assembly.components)
    .map((component) =>
      sanitizeAssemblyExportNameSegment(component.name || component.sourceFile || component.id),
    )
    .filter(Boolean)
    .join('_');

  return (
    componentName ||
    sanitizeAssemblyExportNameSegment(assembly.name) ||
    assembly.name?.trim() ||
    'assembly'
  );
}

export function resolveDisconnectedWorkspaceUrdfAction(
  target: ExportTarget,
  config: { format: string },
  assemblyState: AssemblyState | null,
): ExportActionRequired | null {
  if (
    target.type !== 'current' ||
    config.format !== 'urdf' ||
    !assemblyState
  ) {
    return null;
  }

  const analysis = analyzeAssemblyConnectivity(assemblyState);
  if (!analysis.hasDisconnectedComponents) {
    return null;
  }

  return {
    type: 'disconnected-workspace-urdf',
    componentCount: analysis.componentCount,
    connectedGroupCount: analysis.connectedGroupCount,
    exportName: buildAssemblyExportName(assemblyState),
  };
}
