import { resolveJointKey, resolveLinkKey } from '@/core/robot';
import type { UrdfJoint, UrdfLink } from '@/types';
import type { ResolvedHoverInteractionCandidate } from './hoverInteractionResolution';

type EditorInteractionCandidate = Pick<
  ResolvedHoverInteractionCandidate,
  'type' | 'id' | 'linkId'
>;

function isLinkLocked(
  linkId: string | null | undefined,
  robotLinks: Record<string, UrdfLink> | undefined,
): boolean {
  if (!linkId || !robotLinks) {
    return false;
  }

  const resolvedLinkId = resolveLinkKey(robotLinks, linkId) ?? linkId;
  return robotLinks[resolvedLinkId]?.editorLocked === true;
}

/** Filters locked renderer hits before they can highlight, select, paint, or drag. */
export function isRuntimeInteractionEditorLocked(
  candidate: EditorInteractionCandidate | null | undefined,
  robotLinks: Record<string, UrdfLink> | undefined,
  robotJoints: Record<string, UrdfJoint> | undefined,
): boolean {
  if (!candidate) {
    return false;
  }

  if (isLinkLocked(candidate.linkId, robotLinks)) {
    return true;
  }

  if (candidate.type === 'link') {
    return isLinkLocked(candidate.id, robotLinks);
  }

  if (candidate.type === 'joint' && robotJoints) {
    const jointId = resolveJointKey(robotJoints, candidate.id) ?? candidate.id;
    const joint = robotJoints[jointId];
    return isLinkLocked(joint?.parentLinkId, robotLinks)
      || isLinkLocked(joint?.childLinkId, robotLinks);
  }

  return false;
}
