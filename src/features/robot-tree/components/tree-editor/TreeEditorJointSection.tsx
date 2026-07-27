import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { resolveJointKey } from '@/core/robot';
import { translations } from '@/shared/i18n';
import { JointPanelControls, JointPanelList } from '@/shared/components/Panel/JointPanelContent';
import { resolveActiveViewerJointKeyFromSelection } from '@/shared/utils/active_joint_selection';
import { createJointPanelStore } from '@/shared/utils/jointPanelStore';
import { normalizeViewerJointAngleState } from '@/shared/utils/jointPanelState';
import { getSingleDofJointEntries } from '@/shared/utils/jointTypes';
import type { EntityRef, RobotData, WorkspaceSelection } from '@/types';
import {
  useJointInteractionPreviewStore,
  type JointInteractionPreviewSnapshot,
  type WorkspaceJointInteractionPreview,
} from '@/store/jointInteractionPreviewStore';
import { useUIStore, type Language } from '@/store/uiStore';
import type {
  WorkspaceJointPropertyPatch,
  WorkspacePropertyPatch,
} from '@/store/workspace/types';

const TREE_EDITOR_JOINT_SECTION_KEY = 'tree_editor_joint_panel';

export function resolveComponentViewerJointPreview(
  preview: JointInteractionPreviewSnapshot,
  componentId: string,
): WorkspaceJointInteractionPreview | null {
  if (preview.source !== 'viewer') {
    return null;
  }
  return preview.workspaceByComponent?.[componentId] ?? null;
}

export function createTreeJointPanelScopeKey({
  componentId,
  sourceFilePath,
  robot,
}: {
  componentId: string;
  sourceFilePath?: string;
  robot: Pick<RobotData, 'name' | 'rootLinkId'>;
}): string {
  return `${componentId}:${sourceFilePath ?? `${robot.name}:${robot.rootLinkId}`}`;
}

interface TreeEditorJointSectionProps {
  componentId: string;
  robot: RobotData;
  selection: WorkspaceSelection;
  lang: Language;
  onSelect?: (selection: WorkspaceSelection) => void;
  onUpdate: (ref: EntityRef, patch: WorkspacePropertyPatch) => void;
  onJointAnglePreview?: (ref: Extract<EntityRef, { type: 'joint' }>, angle: number) => void;
  onJointAngleChange?: (ref: Extract<EntityRef, { type: 'joint' }>, angle: number) => void;
  show: boolean;
  sourceFilePath?: string;
  height: number;
  isDragging?: boolean;
}

function resolveJointSnapshotAngle(joint: any) {
  const angle = Number(joint?.angle ?? joint?.jointValue);
  return Number.isFinite(angle) ? angle : 0;
}

function areJointAnglesEquivalent(left: number | undefined, right: number | undefined) {
  if (typeof left !== 'number' || typeof right !== 'number') {
    return left === right;
  }

  return Math.abs(left - right) <= 1e-6;
}

function buildJointAngleSnapshot(joints: Record<string, any>) {
  const nextAngles: Record<string, number> = {};
  getSingleDofJointEntries(joints).forEach(([jointId, joint]) => {
    const angle = resolveJointSnapshotAngle(joint);
    nextAngles[jointId] = angle;
    if (typeof joint.name === 'string' && joint.name.length > 0) {
      nextAngles[joint.name] = angle;
    }
  });

  return normalizeViewerJointAngleState(joints, nextAngles);
}

export function TreeEditorJointSection({
  componentId,
  robot,
  selection,
  lang,
  onSelect,
  onUpdate,
  onJointAnglePreview,
  onJointAngleChange,
  show,
  sourceFilePath,
  height,
  isDragging = false,
}: TreeEditorJointSectionProps) {
  const t = translations[lang];
  const localSelection = React.useMemo(() => {
    const ref = selection?.entity;
    if (
      !ref
      || (ref.type !== 'link' && ref.type !== 'joint')
      || ref.componentId !== componentId
    ) {
      return { type: null, id: null } as const;
    }
    return { type: ref.type, id: ref.entityId };
  }, [componentId, selection]);
  const localRobot = React.useMemo(() => ({ ...robot, selection: localSelection }), [localSelection, robot]);
  const jointEntries = React.useMemo(
    () => getSingleDofJointEntries(robot?.joints),
    [robot?.joints],
  );
  const hasJointEntries = jointEntries.length > 0;
  const panelSections = useUIStore((state) => state.panelSections);
  const setPanelSection = useUIStore((state) => state.setPanelSection);
  const isCollapsed = panelSections[TREE_EDITOR_JOINT_SECTION_KEY] ?? false;
  const [angleUnit, setAngleUnit] = React.useState<'rad' | 'deg'>('rad');
  const [isAdvanced, setIsAdvanced] = React.useState(false);
  const jointPanelStoreRef = React.useRef(createJointPanelStore());
  const initialJointAnglesRef = React.useRef<Record<string, number>>({});
  const pendingCommittedJointAnglesRef = React.useRef<Record<string, number>>({});
  const pendingCommittedJointAnglesScopeRef = React.useRef<string | null>(null);
  const resetScopeRef = React.useRef<string | null>(null);
  const previousActiveJointRef = React.useRef<string | null>(null);
  const shouldShow = show;
  const jointAngleSnapshot = React.useMemo(
    () => buildJointAngleSnapshot(robot.joints),
    [robot.joints],
  );
  const resetScopeKey = createTreeJointPanelScopeKey({
    componentId,
    sourceFilePath,
    robot,
  });
  const effectiveJointAngleSnapshot = React.useMemo(() => {
    const pendingCommittedAngles = pendingCommittedJointAnglesRef.current;
    if (
      pendingCommittedJointAnglesScopeRef.current !== resetScopeKey ||
      Object.keys(pendingCommittedAngles).length === 0
    ) {
      return jointAngleSnapshot;
    }

    let nextSnapshot = jointAngleSnapshot;
    Object.entries(pendingCommittedAngles).forEach(([jointId, pendingAngle]) => {
      if (areJointAnglesEquivalent(jointAngleSnapshot[jointId], pendingAngle)) {
        return;
      }

      if (nextSnapshot === jointAngleSnapshot) {
        nextSnapshot = { ...jointAngleSnapshot };
      }
      nextSnapshot[jointId] = pendingAngle;
    });

    return nextSnapshot;
  }, [jointAngleSnapshot, resetScopeKey]);

  React.useEffect(() => {
    jointPanelStoreRef.current.replaceJointAngles(effectiveJointAngleSnapshot);
  }, [effectiveJointAngleSnapshot]);

  React.useEffect(() => {
    const pendingCommittedAngles = pendingCommittedJointAnglesRef.current;
    if (
      pendingCommittedJointAnglesScopeRef.current !== resetScopeKey ||
      Object.keys(pendingCommittedAngles).length === 0
    ) {
      return;
    }

    const remainingPendingAngles = Object.fromEntries(
      Object.entries(pendingCommittedAngles).filter(
        ([jointId, pendingAngle]) =>
          !areJointAnglesEquivalent(jointAngleSnapshot[jointId], pendingAngle),
      ),
    );

    if (Object.keys(remainingPendingAngles).length !== Object.keys(pendingCommittedAngles).length) {
      pendingCommittedJointAnglesRef.current = remainingPendingAngles;
    }
  }, [jointAngleSnapshot, resetScopeKey]);

  React.useEffect(() => {
    if (resetScopeRef.current === resetScopeKey) {
      return;
    }

    resetScopeRef.current = resetScopeKey;
    pendingCommittedJointAnglesRef.current = {};
    pendingCommittedJointAnglesScopeRef.current = resetScopeKey;
    initialJointAnglesRef.current = jointAngleSnapshot;
  }, [jointAngleSnapshot, resetScopeKey]);

  const patchLocalJointAngles = React.useCallback(
    (jointAngles: Record<string, number>) => {
      const normalizedAngles = normalizeViewerJointAngleState(robot.joints, jointAngles);
      jointPanelStoreRef.current.patchJointAngles(normalizedAngles);
      return normalizedAngles;
    },
    [robot.joints],
  );

  const patchLocalJointAngle = React.useCallback(
    (jointName: string, angle: number) => {
      const jointId = resolveJointKey(robot.joints, jointName) ?? jointName;
      patchLocalJointAngles({ [jointId]: angle });
      return jointId;
    },
    [patchLocalJointAngles, robot.joints],
  );

  React.useEffect(() => {
    const applyViewerJointPreview = (
      preview = useJointInteractionPreviewStore.getState().preview,
    ) => {
      const componentPreview = resolveComponentViewerJointPreview(preview, componentId);
      if (!componentPreview || Object.keys(componentPreview.jointAngles).length === 0) {
        return;
      }

      const previewAngles = patchLocalJointAngles(componentPreview.jointAngles);
      if (Object.keys(previewAngles).length === 0) {
        return;
      }

      pendingCommittedJointAnglesRef.current = {
        ...pendingCommittedJointAnglesRef.current,
        ...previewAngles,
      };
      pendingCommittedJointAnglesScopeRef.current = resetScopeKey;
    };

    applyViewerJointPreview();

    return useJointInteractionPreviewStore.subscribe((state) => {
      applyViewerJointPreview(state.preview);
    });
  }, [componentId, patchLocalJointAngles, resetScopeKey]);

  const handleJointAnglePreview = React.useCallback(
    (jointName: string, angle: number) => {
      const jointId = patchLocalJointAngle(jointName, angle);
      onJointAnglePreview?.({ type: 'joint', componentId, entityId: jointId }, angle);
    },
    [componentId, onJointAnglePreview, patchLocalJointAngle],
  );

  const handleJointAngleCommit = React.useCallback(
    (jointName: string, angle: number) => {
      const jointId = patchLocalJointAngle(jointName, angle);
      pendingCommittedJointAnglesRef.current = {
        ...pendingCommittedJointAnglesRef.current,
        [jointId]: angle,
      };
      pendingCommittedJointAnglesScopeRef.current = resetScopeKey;
      onJointAngleChange?.({ type: 'joint', componentId, entityId: jointId }, angle);
    },
    [componentId, onJointAngleChange, patchLocalJointAngle, resetScopeKey],
  );

  React.useEffect(() => {
    const nextActiveJoint = resolveActiveViewerJointKeyFromSelection(robot.joints, localSelection);
    const autoScroll = nextActiveJoint !== null && previousActiveJointRef.current !== nextActiveJoint;

    jointPanelStoreRef.current.setActiveJoint(nextActiveJoint, { autoScroll });
    previousActiveJointRef.current = nextActiveJoint;
  }, [localSelection, robot.joints]);

  const handleResetJoints = React.useCallback(() => {
    const resetAngles: Record<string, number> = {};

    jointEntries.forEach(([jointId, joint]) => {
      const initialAngle =
        initialJointAnglesRef.current[jointId] ??
        (typeof joint.name === 'string' ? initialJointAnglesRef.current[joint.name] : undefined);
      resetAngles[jointId] = initialAngle ?? 0;
    });

    const normalizedResetAngles = patchLocalJointAngles(resetAngles);
    pendingCommittedJointAnglesRef.current = normalizedResetAngles;
    pendingCommittedJointAnglesScopeRef.current = resetScopeKey;

    Object.entries(normalizedResetAngles).forEach(([jointId, nextAngle]) => {
      onJointAngleChange?.({ type: 'joint', componentId, entityId: jointId }, nextAngle);
    });
  }, [componentId, jointEntries, onJointAngleChange, patchLocalJointAngles, resetScopeKey]);

  if (!shouldShow) {
    return null;
  }

  return (
    <div
      className={`relative flex min-h-0 shrink-0 flex-col overflow-hidden border-t border-border-black/60 bg-element-bg dark:bg-element-bg ${isDragging ? '' : 'transition-[height] duration-200 ease-out'}`}
      style={{ height: isCollapsed ? 'auto' : `${height}px` }}
    >
      <div className="flex h-8 items-center justify-between gap-2 px-2.5 transition-colors hover:bg-element-hover">
        <button
          type="button"
          data-testid="tree-editor-joint-section-toggle"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => setPanelSection(TREE_EDITOR_JOINT_SECTION_KEY, !isCollapsed)}
        >
          {isCollapsed ? (
            <ChevronRight className="h-3.5 w-3.5 text-text-tertiary" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-text-tertiary" />
          )}
          <span className="truncate text-[11px] font-semibold leading-none tracking-[0.02em] text-text-secondary">
            {t.joints || 'Joints'}
          </span>
        </button>
        {hasJointEntries ? (
          <div className="flex min-w-fit shrink-0 items-center gap-1">
            <JointPanelControls
              t={t}
              angleUnit={angleUnit}
              setAngleUnit={setAngleUnit}
              isAdvanced={isAdvanced}
              setIsAdvanced={setIsAdvanced}
              onReset={handleResetJoints}
              compact
            />
            <span aria-hidden="true" className="sr-only">
              {isCollapsed ? t.expand : t.collapse}
            </span>
          </div>
        ) : null}
      </div>
      <div
        data-testid="tree-editor-joint-section-content"
        className={`overflow-hidden transition-all duration-200 ease-in-out ${
          isCollapsed ? 'max-h-0 opacity-0' : 'flex min-h-0 flex-1 flex-col opacity-100'
        }`}
      >
        <div className="flex min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden border-t border-border-black/40 bg-panel-bg py-1 custom-scrollbar">
          {hasJointEntries ? (
            <JointPanelList
              robot={localRobot}
              angleUnit={angleUnit}
              jointPanelStore={jointPanelStoreRef.current}
              setActiveJoint={jointPanelStoreRef.current.setActiveJoint}
              handleJointAngleChange={handleJointAnglePreview}
              handleJointChangeCommit={handleJointAngleCommit}
              onSelect={(type: 'link' | 'joint', id: string) => {
                onSelect?.({
                  entity: { type, componentId, entityId: id },
                });
              }}
              isAdvanced={isAdvanced}
              onUpdate={(type, id, data) => {
                if (type !== 'link' && type !== 'joint') return;
                onUpdate(
                  { type, componentId, entityId: id },
                  data as WorkspaceJointPropertyPatch,
                );
              }}
              className="space-y-0.5 px-1 py-1"
            />
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center px-3 py-4 text-center text-xs italic text-text-tertiary">
              {t.noJointsYet || 'No joints yet.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
