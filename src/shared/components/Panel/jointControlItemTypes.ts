import type { JointPanelActiveJointOptions } from '@/shared/utils/jointPanelStore';
import type { JointDragSyncMode } from '@/shared/utils/jointDragStoreSync';

export const JOINT_PANEL_STORE_SYNC_INTERVAL_MS = 33;

export interface JointControlItemJoint {
  id?: string | number;
  name?: string;
  jointType?: unknown;
  type?: unknown;
  limit?: {
    lower?: number;
    upper?: number;
    effort?: number;
    velocity?: number;
  };
}

export interface JointControlItemProps {
  name: string;
  joint: JointControlItemJoint;
  displayName?: string;
  value: number;
  angleUnit: 'rad' | 'deg';
  isActive: boolean;
  shouldAutoScroll?: boolean;
  setActiveJoint: (name: string | null, options?: JointPanelActiveJointOptions) => void;
  handleJointAngleChange: (name: string, val: number) => void;
  handleJointChangeCommit: (name: string, val: number) => void;
  setIsDragging?: (dragging: boolean) => void;
  onSelect?: (type: 'link' | 'joint', id: string) => void;
  isAdvanced?: boolean;
  /** Let the slider travel past the authored limit (temporary limit override). */
  ignoreLimits?: boolean;
  onUpdate?: (type: 'link' | 'joint', id: string, data: unknown) => void;
  compact?: boolean;
  dragSyncIntervalMs?: number;
  throttleDragSync?: boolean;
  dragSyncMode?: JointDragSyncMode;
}

export type SliderDragSource = 'native-input' | 'slider-shell';

export interface SliderDragBounds {
  left: number;
  width: number;
}
