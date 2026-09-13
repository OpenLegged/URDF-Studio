import type { InteractionSelection } from '@/types/index';

import type { ResolvedInteractionSelectionHit } from '@/shared/components/3d/robot/utils/selectionTargets';

export type SelectionCommitHoverAction =
  | {
      mode: 'preserve';
      hoveredSelection: InteractionSelection;
    }
  | {
      mode: 'clear';
    };

export function resolveSelectionCommitHoverAction(
  resolvedHit: Pick<
    ResolvedInteractionSelectionHit,
    | 'type'
    | 'id'
    | 'subType'
    | 'targetKind'
    | 'helperKind'
    | 'linkId'
    | 'objectIndex'
    | 'highlightTarget'
  >,
): SelectionCommitHoverAction {
  if (
    resolvedHit.targetKind === 'helper' &&
    resolvedHit.type === 'link' &&
    resolvedHit.helperKind === 'inertia'
  ) {
    return {
      mode: 'preserve',
      hoveredSelection: {
        type: 'link',
        id: resolvedHit.linkId ?? resolvedHit.id,
        helperKind: resolvedHit.helperKind,
        highlightObjectId: resolvedHit.highlightTarget?.id,
      },
    };
  }

  if (
    resolvedHit.targetKind === 'geometry' &&
    resolvedHit.type === 'tendon'
  ) {
    return {
      mode: 'preserve',
      hoveredSelection: {
        type: 'tendon',
        id: resolvedHit.id,
        highlightObjectId: resolvedHit.highlightTarget?.id,
      },
    };
  }

  if (
    resolvedHit.targetKind !== 'geometry' ||
    resolvedHit.type !== 'link' ||
    resolvedHit.subType === undefined
  ) {
    return { mode: 'clear' };
  }

  return {
    mode: 'preserve',
    hoveredSelection: {
      type: 'link',
      id: resolvedHit.linkId ?? resolvedHit.id,
      subType: resolvedHit.subType,
      objectIndex: resolvedHit.objectIndex ?? 0,
      highlightObjectId: resolvedHit.highlightTarget?.id,
    },
  };
}
