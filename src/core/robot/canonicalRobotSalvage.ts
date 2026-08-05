import type { RobotData, RobotImportRecoveryDiagnostic } from '@/types';

import type { CanonicalWorkspaceValidationIssue } from './canonicalWorkspace';
import { DEFAULT_ROBOT_NAME } from './constants';

export interface CanonicalRobotSalvageResult {
  robotData: RobotData;
  diagnostics: RobotImportRecoveryDiagnostic[];
}

/**
 * Entity kinds a salvage pass knows how to drop. Any residual issue outside
 * these owners means the payload is not a robot we can partially show, so the
 * caller keeps its hard import error instead of inventing data.
 */
type SalvageTarget = 'links' | 'joints' | 'materials';

const SALVAGE_TARGETS: readonly SalvageTarget[] = ['links', 'joints', 'materials'];

/**
 * Resolve the map key a validation issue belongs to.
 *
 * Ids may themselves contain dots (`base.link`), so the remainder after the
 * collection prefix is matched against real keys longest-first rather than
 * split on the first separator.
 */
function resolveOwningKey(remainder: string, keys: Readonly<Record<string, unknown>>): string | null {
  let candidate = remainder;
  while (candidate) {
    if (Object.hasOwn(keys, candidate)) {
      return candidate;
    }
    const separatorIndex = candidate.lastIndexOf('.');
    if (separatorIndex < 0) {
      return null;
    }
    candidate = candidate.slice(0, separatorIndex);
  }
  return null;
}

interface SalvagePlan {
  drops: Record<SalvageTarget, Set<string>>;
  dropClosedLoopConstraints: boolean;
  repairName: boolean;
  repairRootLinkId: boolean;
}

function planSalvage(
  robotData: RobotData,
  issues: readonly CanonicalWorkspaceValidationIssue[],
  path: string,
): SalvagePlan | null {
  const plan: SalvagePlan = {
    drops: { links: new Set(), joints: new Set(), materials: new Set() },
    dropClosedLoopConstraints: false,
    repairName: false,
    repairRootLinkId: false,
  };
  const collections: Record<SalvageTarget, Readonly<Record<string, unknown>>> = {
    links: robotData.links,
    joints: robotData.joints,
    materials: robotData.materials ?? {},
  };

  for (const issue of issues) {
    if (!issue.path.startsWith(`${path}.`)) {
      return null;
    }
    const field = issue.path.slice(path.length + 1);

    if (field === 'name') {
      plan.repairName = true;
      continue;
    }
    if (field === 'rootLinkId') {
      plan.repairRootLinkId = true;
      continue;
    }
    if (field === 'closedLoopConstraints' || field.startsWith('closedLoopConstraints.')) {
      plan.dropClosedLoopConstraints = true;
      continue;
    }

    const target = SALVAGE_TARGETS.find((candidate) => field.startsWith(`${candidate}.`));
    if (!target) {
      return null;
    }
    const owningKey = resolveOwningKey(field.slice(target.length + 1), collections[target]);
    if (!owningKey) {
      return null;
    }
    plan.drops[target].add(owningKey);
  }

  return plan;
}

function resolveReplacementRootLinkId(robotData: RobotData): string | null {
  const linkIds = Object.keys(robotData.links);
  if (linkIds.length === 0) {
    return null;
  }
  if (robotData.links[robotData.rootLinkId]) {
    return robotData.rootLinkId;
  }

  const childLinkIds = new Set(
    Object.values(robotData.joints).map((joint) => joint.childLinkId),
  );
  return linkIds.find((linkId) => !childLinkIds.has(linkId)) ?? linkIds[0];
}

/**
 * Drop the entities canonical validation rejected so the rest of the file can
 * still be shown.
 *
 * Returns `null` when the residual issues have no droppable owner or when
 * nothing displayable survives; the caller then keeps its hard import error.
 * The input is never mutated, and dropping a link leaves its joints dangling on
 * purpose — the caller re-runs `recoverImportedRobotData`, which owns cascade
 * removal and re-validation.
 */
export function salvageCanonicalRobotData(
  robotData: RobotData,
  issues: readonly CanonicalWorkspaceValidationIssue[],
  path: string,
): CanonicalRobotSalvageResult | null {
  const plan = planSalvage(robotData, issues, path);
  if (!plan) {
    return null;
  }

  const salvaged = structuredClone(robotData);
  const diagnostics: RobotImportRecoveryDiagnostic[] = [];

  plan.drops.links.forEach((linkId) => {
    delete salvaged.links[linkId];
    diagnostics.push({
      code: 'invalid_link_omitted',
      severity: 'warning',
      category: 'topology',
      message: `Link "${linkId}" could not be represented and was omitted.`,
      relatedIds: [linkId],
      action: 'omitted',
    });
  });
  plan.drops.joints.forEach((jointId) => {
    delete salvaged.joints[jointId];
    diagnostics.push({
      code: 'invalid_joint_omitted',
      severity: 'warning',
      category: 'topology',
      message: `Joint "${jointId}" could not be represented and was omitted.`,
      relatedIds: [jointId],
      action: 'omitted',
    });
  });
  plan.drops.materials.forEach((materialId) => {
    if (salvaged.materials) {
      delete salvaged.materials[materialId];
    }
    diagnostics.push({
      code: 'invalid_material_omitted',
      severity: 'warning',
      category: 'material',
      message: `Material "${materialId}" could not be represented and was omitted.`,
      relatedIds: [materialId],
      action: 'omitted',
    });
  });

  if (plan.dropClosedLoopConstraints) {
    delete salvaged.closedLoopConstraints;
    diagnostics.push({
      code: 'invalid_closed_loop_constraints_omitted',
      severity: 'warning',
      category: 'topology',
      message: 'Closed-loop constraints could not be represented and were omitted.',
      action: 'omitted',
    });
  }

  if (plan.repairName) {
    salvaged.name = DEFAULT_ROBOT_NAME;
    diagnostics.push({
      code: 'invalid_robot_name_defaulted',
      severity: 'warning',
      category: 'topology',
      message: `The robot name was unusable and was defaulted to "${DEFAULT_ROBOT_NAME}".`,
      action: 'defaulted',
    });
  }

  const replacementRootLinkId = resolveReplacementRootLinkId(salvaged);
  if (!replacementRootLinkId) {
    return null;
  }
  if (plan.repairRootLinkId || replacementRootLinkId !== salvaged.rootLinkId) {
    diagnostics.push({
      code: 'invalid_root_link_reassigned',
      severity: 'warning',
      category: 'topology',
      message: `The root link was unusable and was reassigned to "${replacementRootLinkId}".`,
      relatedIds: [replacementRootLinkId],
      action: 'defaulted',
    });
    salvaged.rootLinkId = replacementRootLinkId;
  }

  return { robotData: salvaged, diagnostics };
}
