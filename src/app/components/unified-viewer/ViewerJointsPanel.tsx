import React from 'react';

import type { Language } from '@/shared/i18n';
import { translations } from '@/shared/i18n';
import { JointsPanel } from '@/shared/components/Panel/JointsPanel';
import { useUIStore } from '@/store/uiStore';
import type {
  ViewerControllerJointsPanelSurface,
  ViewerControllerLayoutSurface,
} from '@/features/editor';
import { useResponsivePanelLayout } from '@/features/editor';

export function ViewerJointsPanel({
  layout,
  jointsPanel,
  showJointPanel,
  setShowJointPanel,
  lang,
  onUpdate,
}: {
  layout: ViewerControllerLayoutSurface;
  jointsPanel: ViewerControllerJointsPanelSurface;
  showJointPanel: boolean;
  setShowJointPanel?: (show: boolean) => void;
  lang: Language;
  onUpdate?: (type: 'link' | 'joint', id: string, data: unknown) => void;
}) {
  const t = translations[lang];
  const ignoreJointLimits = useUIStore((state) => state.ignoreJointLimits);
  const setIgnoreJointLimits = useUIStore((state) => state.setIgnoreJointLimits);
  const { jointsDefaultPosition, jointsPanelMaxHeight } = useResponsivePanelLayout({
    containerRef: layout.containerRef,
    optionsPanelRef: layout.optionsPanelRef,
    jointPanelRef: layout.jointPanelRef,
    showOptionsPanel: false,
    showJointPanel,
    preferEdgeDockedJointPanel: true,
  });

  return (
    <JointsPanel
      showJointPanel={showJointPanel}
      robot={jointsPanel.jointPanelRobot ?? jointsPanel.robot}
      jointPanelRef={layout.jointPanelRef}
      jointPanelPos={layout.jointPanelPos}
      defaultPosition={jointsDefaultPosition}
      maxHeight={jointsPanelMaxHeight}
      onMouseDown={(event) => layout.handleMouseDown('joints', event)}
      t={t}
      handleResetJoints={jointsPanel.handleResetJoints}
      ignoreLimits={ignoreJointLimits}
      onToggleIgnoreLimits={setIgnoreJointLimits}
      angleUnit={jointsPanel.angleUnit}
      setAngleUnit={jointsPanel.setAngleUnit}
      isJointsCollapsed={jointsPanel.isJointsCollapsed}
      toggleJointsCollapsed={jointsPanel.toggleJointsCollapsed}
      setShowJointPanel={setShowJointPanel}
      jointPanelStore={jointsPanel.jointPanelStore}
      setActiveJoint={jointsPanel.setActiveJoint}
      handleJointAngleChange={jointsPanel.handleJointAngleChange}
      handleJointChangeCommit={jointsPanel.handleJointChangeCommit}
      onSelect={jointsPanel.handleSelectWrapper}
      onHover={jointsPanel.handleHoverWrapper}
      onUpdate={onUpdate}
    />
  );
}
