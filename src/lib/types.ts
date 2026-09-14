import type { CSSProperties, RefObject } from 'react';
import type { Object3D } from 'three';
import type { Language } from '../shared/i18n';
import type { SnapshotCaptureAction } from '../shared/components/3d';
import { DEFAULT_ORIGIN_AXES_SIZE } from '../shared/components/3d/helpers/coordinateAxesSizing';
import type { AppMode, RobotData, Theme, UrdfJoint, UrdfLink } from '../types';
import type { ToolMode } from '../shared/components/3d/viewerInteractionTypes';
import type { ViewerRenderQuality } from '../shared/utils/viewerRenderQuality';

export type RobotCanvasSourceFormat = 'auto' | 'urdf' | 'mjcf';

export interface RobotCanvasSource {
  format?: RobotCanvasSourceFormat;
  content: string;
  sourceFilePath?: string;
}

export interface RobotCanvasSelection {
  type: 'link' | 'joint' | 'tendon' | null;
  id: string | null;
  subType?: 'visual' | 'collision';
  objectIndex?: number;
}

export interface RobotCanvasDisplayOptions {
  cameraProjection: 'perspective' | 'orthographic';
  renderQuality: ViewerRenderQuality;
  showMjcfWorldLink: boolean;
  showVisual: boolean;
  showCollision: boolean;
  highlightMode: 'link' | 'collision';
  showInertia: boolean;
  showInertiaOverlay: boolean;
  showCenterOfMass: boolean;
  showCoMOverlay: boolean;
  centerOfMassSize: number;
  showOrigins: boolean;
  showOriginsOverlay: boolean;
  originSize: number;
  showJointAxes: boolean;
  showJointAxesOverlay: boolean;
  jointAxisSize: number;
  modelOpacity: number;
  transformMode: 'select' | 'translate' | 'rotate' | 'universal';
  toolMode: ToolMode;
}

export const DEFAULT_ROBOT_CANVAS_SELECTION: RobotCanvasSelection = {
  type: null,
  id: null,
};

export const DEFAULT_ROBOT_CANVAS_DISPLAY_OPTIONS: RobotCanvasDisplayOptions = {
  cameraProjection: 'perspective',
  renderQuality: 'high',
  showMjcfWorldLink: true,
  showVisual: true,
  showCollision: false,
  highlightMode: 'link',
  showInertia: false,
  showInertiaOverlay: true,
  showCenterOfMass: false,
  showCoMOverlay: true,
  centerOfMassSize: 0.01,
  showOrigins: false,
  showOriginsOverlay: true,
  originSize: DEFAULT_ORIGIN_AXES_SIZE,
  showJointAxes: false,
  showJointAxesOverlay: true,
  jointAxisSize: 0.1,
  modelOpacity: 1,
  transformMode: 'select',
  toolMode: 'select',
};

export interface RobotCanvasProps {
  source: RobotCanvasSource;
  assets?: Record<string, string>;
  lang?: Language;
  theme?: Theme;
  mode?: AppMode;
  className?: string;
  style?: CSSProperties;
  selection?: RobotCanvasSelection;
  defaultSelection?: RobotCanvasSelection;
  hoveredSelection?: RobotCanvasSelection;
  onSelectionChange?: (selection: RobotCanvasSelection) => void;
  onHoverChange?: (selection: RobotCanvasSelection) => void;
  onMeshSelect?: (
    linkId: string,
    jointId: string | null,
    objectIndex: number,
    objectType: 'visual' | 'collision'
  ) => void;
  jointAngles?: Record<string, number>;
  defaultJointAngles?: Record<string, number>;
  onJointAnglesChange?: (jointAngles: Record<string, number>) => void;
  onJointChange?: (jointName: string, angle: number) => void;
  display?: Partial<RobotCanvasDisplayOptions>;
  allowUrdfXmlFallback?: boolean;
  /** Preparsed canonical model; required for MJCF and preferred over separate maps. */
  robotData?: RobotData;
  robotLinks?: Record<string, UrdfLink>;
  robotJoints?: Record<string, UrdfJoint>;
  focusTarget?: string | null;
  groundPlaneOffset?: number;
  snapshotAction?: RefObject<SnapshotCaptureAction | null>;
  orbitEnabled?: boolean;
  showUsageGuide?: boolean;
  enableJointInteraction?: boolean;
  isMeshPreview?: boolean;
  onPointerMissed?: () => void;
  onRobotLoaded?: (robot: Object3D) => void;
  onOrbitStart?: () => void;
  onOrbitEnd?: () => void;
  onCollisionTransformPreview?: (
    linkName: string,
    position: { x: number; y: number; z: number },
    rotation: { r: number; p: number; y: number },
    objectIndex?: number
  ) => void;
  onCollisionTransform?: (
    linkName: string,
    position: { x: number; y: number; z: number },
    rotation: { r: number; p: number; y: number },
    objectIndex?: number
  ) => void;
  onTransformPendingChange?: (pending: boolean) => void;
}
