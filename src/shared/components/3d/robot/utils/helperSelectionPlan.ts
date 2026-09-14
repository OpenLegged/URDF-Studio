import type { ViewerHelperKind } from '@/shared/components/3d/robot/types';

export interface HelperSelectionPlanOptions {
  fallbackType: 'link' | 'joint';
  fallbackId: string;
  helperKind?: ViewerHelperKind;
  linkObject?: unknown;
}

export interface HelperSelectionPlan {
  selectTarget: { type: 'link' | 'joint'; id: string };
}

export function resolveHelperSelectionPlan({
  fallbackType,
  fallbackId,
  helperKind,
}: HelperSelectionPlanOptions): HelperSelectionPlan {
  void helperKind;

  return {
    selectTarget: {
      type: fallbackType,
      id: fallbackId,
    },
  };
}
