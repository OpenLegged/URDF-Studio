import type { Language } from '@/store';
import { JointType, type BridgeJoint, type UrdfJoint, type UrdfOrigin } from '@/types';

export type BridgeRotationDisplayMode = 'euler_deg' | 'euler_rad' | 'quaternion';
export type BridgeEulerAxisKey = 'r' | 'p' | 'y';
export type BridgeEndpointInputMode = 'geometry' | 'link';

export type BridgeCreateParams = {
  name: string;
  parentComponentId: string;
  parentLinkId: string;
  childComponentId: string;
  childLinkId: string;
  joint: {
    type: JointType;
    origin: UrdfOrigin;
    axis: { x: number; y: number; z: number };
    limit?: NonNullable<UrdfJoint['limit']>;
    hardware?: UrdfJoint['hardware'];
  };
};

export interface BridgeCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPreviewChange?: (bridge: BridgeJoint | null) => void;
  onCreate: (params: BridgeCreateParams) => void;
  lang: Language;
}
