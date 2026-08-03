import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OptionsPanel } from './OptionsPanel';
import { getSingleDofJointEntries } from '@/shared/utils/jointTypes';
import type { JointPanelActiveJointOptions, JointPanelStore } from '@/shared/utils/jointPanelStore';
import { JointPanelControls, JointPanelList } from './JointPanelContent';
import type {
  JointPanelAngleUnit,
  JointPanelRobot,
  JointPanelTranslations,
} from './JointPanelContent';

const JOINT_PANEL_HEADER_ESTIMATED_HEIGHT = 52;
const JOINT_PANEL_COMPACT_ITEM_ESTIMATED_HEIGHT = 52;
const JOINT_PANEL_COMPACT_ADVANCED_ITEM_ESTIMATED_HEIGHT = 70;

interface JointsPanelProps {
  showJointPanel: boolean;
  robot: JointPanelRobot | null | undefined;
  jointPanelRef: React.RefObject<HTMLDivElement | null>;
  jointPanelPos: { x: number; y: number } | null;
  defaultPosition?: {
    top?: string;
    right?: string;
    left?: string;
    bottom?: string;
    transform?: string;
  };
  maxHeight?: number;
  onMouseDown: (e: React.MouseEvent) => void;
  t: JointPanelTranslations;
  handleResetJoints: () => void;
  ignoreLimits?: boolean;
  onToggleIgnoreLimits?: (ignore: boolean) => void;
  angleUnit: JointPanelAngleUnit;
  setAngleUnit: (unit: JointPanelAngleUnit) => void;
  isJointsCollapsed: boolean;
  toggleJointsCollapsed: () => void;
  setShowJointPanel?: (show: boolean) => void;
  jointPanelStore: JointPanelStore;
  setActiveJoint: (name: string | null, options?: JointPanelActiveJointOptions) => void;
  handleJointAngleChange: (name: string, angle: number) => void;
  handleJointChangeCommit: (name: string, angle: number) => void;
  setIsDragging?: (dragging: boolean) => void;
  onSelect?: (type: 'link' | 'joint', id: string) => void;
  onHover?: (
    type: 'link' | 'joint' | null,
    id: string | null,
    subType?: 'visual' | 'collision',
  ) => void;
  onUpdate?: (type: 'link' | 'joint', id: string, data: unknown) => void;
  zIndex?: number;
  onActivate?: () => void;
}

export const JointsPanel: React.FC<JointsPanelProps> = ({
  showJointPanel,
  robot,
  jointPanelRef,
  jointPanelPos,
  defaultPosition,
  maxHeight,
  onMouseDown,
  t,
  handleResetJoints,
  ignoreLimits,
  onToggleIgnoreLimits,
  angleUnit,
  setAngleUnit,
  isJointsCollapsed,
  toggleJointsCollapsed,
  setShowJointPanel,
  jointPanelStore,
  setActiveJoint,
  handleJointAngleChange,
  handleJointChangeCommit,
  setIsDragging,
  onSelect,
  onHover,
  onUpdate,
  zIndex = 40,
  onActivate,
}) => {
  const [isAdvanced, setIsAdvanced] = useState(false);
  const onHoverRef = useRef(onHover);
  const jointEntries = useMemo(() => getSingleDofJointEntries(robot?.joints), [robot?.joints]);
  const shouldShow = showJointPanel && jointEntries.length > 0;

  useEffect(() => {
    onHoverRef.current = onHover;
  }, [onHover]);

  useEffect(() => {
    return () => {
      onHoverRef.current?.(null, null);
    };
  }, []);

  const clearGlobalHover = useCallback(() => {
    onHoverRef.current?.(null, null);
  }, []);

  const resolvedPanelHeight = useMemo(() => {
    if (typeof maxHeight !== 'number' || !Number.isFinite(maxHeight)) {
      return undefined;
    }

    const itemEstimatedHeight = isAdvanced
      ? JOINT_PANEL_COMPACT_ADVANCED_ITEM_ESTIMATED_HEIGHT
      : JOINT_PANEL_COMPACT_ITEM_ESTIMATED_HEIGHT;
    const estimatedHeight =
      JOINT_PANEL_HEADER_ESTIMATED_HEIGHT + jointEntries.length * itemEstimatedHeight;
    return Math.min(maxHeight, estimatedHeight);
  }, [isAdvanced, jointEntries.length, maxHeight]);

  const additionalControls = (
    <JointPanelControls
      t={t}
      angleUnit={angleUnit}
      setAngleUnit={setAngleUnit}
      isAdvanced={isAdvanced}
      setIsAdvanced={setIsAdvanced}
      onReset={handleResetJoints}
      ignoreLimits={ignoreLimits}
      onToggleIgnoreLimits={onToggleIgnoreLimits}
    />
  );

  return (
    <OptionsPanel
      title={t.joints || 'Joints'}
      show={!!shouldShow}
      showDragGrip={false}
      panelRef={jointPanelRef}
      position={jointPanelPos}
      defaultPosition={
        defaultPosition ?? { top: '50%', left: '16px', transform: 'translateY(-50%)' }
      }
      isCollapsed={isJointsCollapsed}
      onToggleCollapse={toggleJointsCollapsed}
      onClose={() => setShowJointPanel && setShowJointPanel(false)}
      onMouseDown={onMouseDown}
      expandText={t.expand}
      collapseText={t.collapse}
      closeText={t.close}
      resizable={true}
      height={resolvedPanelHeight}
      maxHeight={maxHeight}
      additionalControls={additionalControls}
      zIndex={zIndex}
      resizeTitle={t.resize}
      panelClassName="urdf-joint-panel"
      onActivate={onActivate}
      onMouseEnter={clearGlobalHover}
      onMouseLeave={clearGlobalHover}
    >
      <JointPanelList
        robot={robot}
        angleUnit={angleUnit}
        jointPanelStore={jointPanelStore}
        setActiveJoint={setActiveJoint}
        handleJointAngleChange={handleJointAngleChange}
        handleJointChangeCommit={handleJointChangeCommit}
        setIsDragging={setIsDragging}
        onSelect={onSelect}
        onHover={onHover}
        isAdvanced={isAdvanced}
        ignoreLimits={ignoreLimits}
        onUpdate={onUpdate}
      />
    </OptionsPanel>
  );
};
