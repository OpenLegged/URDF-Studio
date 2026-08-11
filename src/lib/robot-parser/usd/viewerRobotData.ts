import type { RobotData, UsdBakedScene, UsdSceneSnapshot } from '@/types';

/**
 * Normalized parser/runtime payload consumed by the shared viewer layer.
 * Format-specific loaders should adapt into this shape before updating UI state.
 */
export interface ViewerRobotDataResolution {
  robotData: RobotData;
  stageSourcePath: string | null;
  linkIdByPath: Record<string, string>;
  linkPathById: Record<string, string>;
  jointPathById: Record<string, string>;
  childLinkPathByJointId: Record<string, string>;
  parentLinkPathByJointId: Record<string, string>;
  runtimeLinkMappingMode?: 'robot-data' | 'synthetic-root';
  usdBakedScene?: UsdBakedScene | null;
  usdSceneSnapshot?: UsdSceneSnapshot | null;
}
