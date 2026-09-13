import type { ViewerSceneMode } from '@/shared/components/3d/robot/types';

export interface MouseDownSelectionPlanOptions {
  mode?: ViewerSceneMode;
  linkName: string;
  jointName: string | null;
  subType: 'visual' | 'collision';
  preferredIkHandleLinkId?: string | null;
}

export interface MouseDownSelectionPlan {
  selectTarget:
    | { type: 'link'; id: string; subType?: 'visual' | 'collision'; helperKind?: 'ik-handle' }
    | { type: 'joint'; id: string };
  shouldApplyImmediateGeometryHighlight: boolean;
  shouldSyncMeshSelection: boolean;
}

export function resolveMouseDownSelectionPlan({
  mode,
  linkName,
  subType,
  preferredIkHandleLinkId = null,
}: MouseDownSelectionPlanOptions): MouseDownSelectionPlan {
  void mode;

  if (preferredIkHandleLinkId) {
    return {
      selectTarget: { type: 'link', id: preferredIkHandleLinkId, helperKind: 'ik-handle' },
      shouldApplyImmediateGeometryHighlight: false,
      shouldSyncMeshSelection: false,
    };
  }

  return {
    selectTarget: { type: 'link', id: linkName, subType },
    shouldApplyImmediateGeometryHighlight: true,
    shouldSyncMeshSelection: true,
  };
}
