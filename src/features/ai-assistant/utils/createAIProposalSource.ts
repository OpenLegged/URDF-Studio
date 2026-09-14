import { generateMujocoXML, generateURDF } from '@/core/parsers';
import { canGenerateUrdf } from '@/core/parsers/urdf/urdfExportSupport';
import { canPreserveJointTypesInSource } from '@/core/parsers/sourceJointSupport';
import { canPreserveGeometryInSource } from '@/core/parsers/sourceGeometrySupport';
import { createSourceSemanticRobotHash } from '@/core/robot';
import type { ComponentSourceDraft, RobotState } from '@/types';

/** A source diff is optional; the canonical proposal remains editable without it. */
export function createAIProposalSource(
  currentRobot: RobotState,
  proposedRobot: RobotState,
  currentDraft?: ComponentSourceDraft,
): { sourceFormat?: 'urdf' | 'mjcf'; currentUrdf: string; proposedUrdf: string } {
  const sourceFormat = currentDraft?.format === 'mjcf'
    || currentRobot.inspectionContext?.sourceFormat === 'mjcf'
    || !canGenerateUrdf(currentRobot)
    || !canGenerateUrdf(proposedRobot)
    ? 'mjcf'
    : 'urdf';
  const generateSource = (robot: RobotState): string => sourceFormat === 'mjcf'
    ? generateMujocoXML(robot, { meshdir: 'meshes/', includeSceneHelpers: false, preserveNumericPrecision: true })
    : generateURDF(robot, { preserveMeshPaths: true, preserveNumericPrecision: true });

  if (
    canPreserveJointTypesInSource(currentRobot, sourceFormat)
    && canPreserveJointTypesInSource(proposedRobot, sourceFormat)
    && canPreserveGeometryInSource(currentRobot, sourceFormat)
    && canPreserveGeometryInSource(proposedRobot, sourceFormat)
  ) {
    try {
      return {
        sourceFormat,
        currentUrdf: currentDraft?.format === sourceFormat
          && currentDraft.robotSnapshotHash === createSourceSemanticRobotHash(currentRobot)
          ? currentDraft.content
          : generateSource(currentRobot),
        proposedUrdf: generateSource(proposedRobot),
      };
    } catch {
      // Drafts may contain unfinished geometry; export readiness is not edit validity.
    }
  }
  return { currentUrdf: '', proposedUrdf: '' };
}
