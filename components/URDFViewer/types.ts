import React from 'react';
import * as THREE from 'three';
import { Language, translations } from '../../services/i18n';
import { Theme, UrdfLink } from '../../types';

export type ToolMode = 'select' | 'translate' | 'rotate' | 'universal' | 'view' | 'face' | 'measure';

export interface MeasureState {
    measurements: [THREE.Vector3, THREE.Vector3][];
    currentPoints: THREE.Vector3[];
    tempPoint: THREE.Vector3 | null;
}

export interface URDFViewerProps {
    urdfContent: string;
    assets: Record<string, string>;
    onJointChange?: (jointName: string, angle: number) => void;
    jointAngleState?: Record<string, number>;
    lang: Language;
    mode?: 'detail' | 'hardware';
    onSelect?: (type: 'link' | 'joint', id: string, subType?: 'visual' | 'collision') => void;
    theme: Theme;
    selection?: { type: 'link' | 'joint' | null; id: string | null; subType?: 'visual' | 'collision' };
    hoveredSelection?: { type: 'link' | 'joint' | null; id: string | null; subType?: 'visual' | 'collision' };
    robotLinks?: Record<string, UrdfLink>;
    focusTarget?: string | null;
    showVisual?: boolean;
    setShowVisual?: (show: boolean) => void;
    showToolbar?: boolean;
    setShowToolbar?: (show: boolean) => void;
    showOptionsPanel?: boolean;
    setShowOptionsPanel?: (show: boolean) => void;
    showJointPanel?: boolean;
    setShowJointPanel?: (show: boolean) => void;
    onCollisionTransform?: (linkName: string, position: {x: number, y: number, z: number}, rotation: {r: number, p: number, y: number}) => void;
    snapshotAction?: React.MutableRefObject<(() => void) | null>;
    /** Currently loaded filename for display in the UI */
    fileName?: string;
}

export interface RobotModelProps {
    urdfContent: string;
    assets: Record<string, string>;
    onRobotLoaded?: (robot: any) => void;
    showCollision?: boolean;
    showVisual?: boolean;
    onSelect?: (type: 'link' | 'joint', id: string, subType?: 'visual' | 'collision') => void;
    onJointChange?: (name: string, angle: number) => void;
    onJointChangeCommit?: (name: string, angle: number) => void;
    jointAngles?: Record<string, number>;
    setIsDragging?: (dragging: boolean) => void;
    setActiveJoint?: (jointName: string | null) => void;
    justSelectedRef?: React.MutableRefObject<boolean>;
    t: typeof translations['en'];
    mode?: 'detail' | 'hardware';
    highlightMode?: 'link' | 'collision';
    showInertia?: boolean;
    showCenterOfMass?: boolean;
    showOrigins?: boolean;
    originSize?: number;
    showJointAxes?: boolean;
    jointAxisSize?: number;
    modelOpacity?: number;
    robotLinks?: Record<string, UrdfLink>;
    focusTarget?: string | null;
    transformMode?: 'select' | 'translate' | 'rotate' | 'universal';
    toolMode?: ToolMode;
    onCollisionTransformEnd?: (linkName: string, position: {x: number, y: number, z: number}, rotation: {r: number, p: number, y: number}) => void;
    isOrbitDragging?: React.MutableRefObject<boolean>;
    selection?: URDFViewerProps['selection'];
    hoveredSelection?: URDFViewerProps['selection'];
}

export interface CollisionTransformControlsProps {
    robot: THREE.Object3D | null;
    selection: URDFViewerProps['selection'];
    transformMode: 'select' | 'translate' | 'rotate' | 'universal';
    setIsDragging: (dragging: boolean) => void;
    onTransformEnd?: (linkId: string, position: {x: number, y: number, z: number}, rotation: {r: number, p: number, y: number}) => void;
    robotLinks?: Record<string, UrdfLink>;
    lang?: Language;
}

export interface JointControlItemProps {
    name: string;
    joint: any;
    jointAngles: Record<string, number>;
    angleUnit: 'rad' | 'deg';
    activeJoint: string | null;
    setActiveJoint: (name: string | null) => void;
    handleJointAngleChange: (name: string, val: number) => void;
    handleJointChangeCommit: (name: string, val: number) => void;
    onSelect?: (type: 'link' | 'joint', id: string) => void;
}

export interface ViewerToolbarProps {
    activeMode: ToolMode;
    setMode: (mode: ToolMode) => void;
    onClose?: () => void;
    lang?: Language;
}

export interface MeasureToolProps {
    active: boolean;
    robot: THREE.Object3D | null;
    measureState: MeasureState;
    setMeasureState: React.Dispatch<React.SetStateAction<MeasureState>>;
}

export interface JointInteractionProps {
    joint: any;
    value: number;
    onChange: (val: number) => void;
    onCommit?: (val: number) => void;
}
