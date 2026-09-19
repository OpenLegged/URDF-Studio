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
  _exportName: string | undefined,
  _replaceTemplate: (template: string, replacements: Record<string, string | number>) => string,
  _unsupportedLabel: string,
): void {
  // Closed loops no longer block URDF export: callers strip them via
  // stripClosedLoopConstraintsForUrdfExport and surface a warning instead.
  const unsupportedJoint = findUnsupportedUrdfJoint(robot);
  if (unsupportedJoint) {
    throw createUnsupportedUrdfJointError(
      unsupportedJoint.jointName,
      unsupportedJoint.jointType,
    );
  }
}

/**
 * URDF/Xacro cannot express closed loops. Instead of failing the export, the
 * loop-closing constraints are cut from the exported robot and a warning is
 * returned for the export result. The in-app model keeps its loops.
 */
export function stripClosedLoopConstraintsForUrdfExport(
  robot: RobotState,
  replaceTemplate: (template: string, replacements: Record<string, string | number>) => string,
  warningLabel: string,
): { robot: RobotState; warning: string | null } {
  const closedLoopConstraintCount = robot.closedLoopConstraints?.length ?? 0;
  if (closedLoopConstraintCount === 0) {
    return { robot, warning: null };
  }

  const resolvedExportName = robot.name?.trim() || 'robot';
  const { closedLoopConstraints: _removed, ...robotWithoutLoops } = robot;
  return {
    robot: robotWithoutLoops as RobotState,
    warning: replaceTemplate(warningLabel, {
      name: resolvedExportName,
      count: closedLoopConstraintCount,
    }),
  };
}

export function assertAssemblyUrdfExportSupported(
  assembly: AssemblyState,
  replaceTemplate: (template: string, replacements: Record<string, string | number>) => string,
  _unsupportedLabel: string,
): void {
  // Closed loops no longer block assembly URDF export; component-level
  // unsupported joint checks remain in assertUrdfExportSupported.
  Object.values(assembly.components).forEach((component) => {
    assertUrdfExportSupported(
      component.robot,
      component.name?.trim() || component.id,
      replaceTemplate,
      _unsupportedLabel,
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
