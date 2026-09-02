import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  getJointReferencePosition,
  resolveJointKey,
  type AssemblySceneProjection,
} from '@/core/robot';
import { translations } from '@/shared/i18n';
import { JointPanelControls, JointPanelList } from '@/shared/components/Panel/JointPanelContent';
import { resolveActiveViewerJointKeyFromSelection } from '@/shared/utils/active_joint_selection';
import { createJointPanelStore } from '@/shared/utils/jointPanelStore';
import { normalizeViewerJointAngleState } from '@/shared/utils/jointPanelState';
import { getSingleDofJointEntries } from '@/shared/utils/jointTypes';
import { entityRefKey } from '@/types';
import type {
  BridgeEntityRef,
  EntityRef,
  JointEntityRef,
  RobotData,
  WorkspaceSelection,
} from '@/types';
import {
  useJointInteractionPreviewStore,
  type JointInteractionPreviewSnapshot,
  type WorkspaceJointInteractionPreview,
} from '@/store/jointInteractionPreviewStore';
import { useUIStore, type Language } from '@/store/uiStore';
import type { WorkspaceJointPropertyPatch, WorkspacePropertyPatch } from '@/store/workspace/types';

const TREE_EDITOR_JOINT_SECTION_KEY = 'tree_editor_joint_panel';
const projectionScopeIds = new WeakMap<AssemblySceneProjection, number>();
let nextProjectionScopeId = 1;

function resolveProjectionScopeId(projection: AssemblySceneProjection): number {
  const existingScopeId = projectionScopeIds.get(projection);
  if (existingScopeId !== undefined) {
    return existingScopeId;
  }
  const scopeId = nextProjectionScopeId;
  nextProjectionScopeId += 1;
  projectionScopeIds.set(projection, scopeId);
  return scopeId;
}

export function resolveComponentViewerJointPreview(
  preview: JointInteractionPreviewSnapshot,
  componentId: string,
): WorkspaceJointInteractionPreview | null {
  if (preview.source !== 'viewer') {
    return null;
  }
  return preview.workspaceByComponent?.[componentId] ?? null;
}

export function resolveWorkspaceViewerJointPreview(
  preview: JointInteractionPreviewSnapshot,
  projection: AssemblySceneProjection,
): Record<string, number> {
  return resolveWorkspaceViewerJointPreviewState(preview, projection).jointAngles;
}

export interface WorkspaceViewerJointPreviewState {
  activeJointId: string | null;
  jointAngles: Record<string, number>;
  jointQuaternions: JointInteractionPreviewSnapshot['jointQuaternions'];
  jointOrigins: JointInteractionPreviewSnapshot['jointOrigins'];
}

export function resolveWorkspaceViewerJointPreviewState(
  preview: JointInteractionPreviewSnapshot,
  projection: AssemblySceneProjection,
): WorkspaceViewerJointPreviewState {
  if (preview.source !== 'viewer') {
    return {
      activeJointId: null,
      jointAngles: {},
      jointQuaternions: {},
      jointOrigins: {},
    };
  }

  const projected: WorkspaceViewerJointPreviewState = {
    activeJointId: null,
    jointAngles: {},
    jointQuaternions: {},
    jointOrigins: {},
  };
  const canonicalTargets = preview.workspaceTargets ?? [];
  canonicalTargets.forEach((target) => {
    const projectedId = projection.entityRefKeyToGlobal.get(entityRefKey(target.ref));
    if (!projectedId) {
      return;
    }
    if (target.active) {
      projected.activeJointId = projectedId;
    }
    if (typeof target.angle === 'number' && Number.isFinite(target.angle)) {
      projected.jointAngles[projectedId] = target.angle;
    }
    if (target.quaternion) {
      projected.jointQuaternions[projectedId] = { ...target.quaternion };
    }
    if (target.origin) {
      projected.jointOrigins[projectedId] = structuredClone(target.origin);
    }
  });

  if (canonicalTargets.length > 0) {
    return projected;
  }

  // Compatibility for tree-panel previews published before canonical bridge
  // targets were introduced. New viewer publishers use workspaceTargets.
  Object.entries(preview.workspaceByComponent ?? {}).forEach(([componentId, componentPreview]) => {
    Object.entries(componentPreview.jointAngles).forEach(([entityId, angle]) => {
      const projectedId = projection.entityRefKeyToGlobal.get(
        entityRefKey({
          type: 'joint',
          componentId,
          entityId,
        }),
      );
      if (projectedId && Number.isFinite(angle)) {
        projected.jointAngles[projectedId] = angle;
      }
    });
    Object.entries(componentPreview.jointQuaternions).forEach(([entityId, quaternion]) => {
      const projectedId = projection.entityRefKeyToGlobal.get(
        entityRefKey({ type: 'joint', componentId, entityId }),
      );
      if (projectedId && quaternion) {
        projected.jointQuaternions[projectedId] = { ...quaternion };
      }
    });
    Object.entries(componentPreview.jointOrigins).forEach(([entityId, origin]) => {
      const projectedId = projection.entityRefKeyToGlobal.get(
        entityRefKey({ type: 'joint', componentId, entityId }),
      );
      if (projectedId && origin) {
        projected.jointOrigins[projectedId] = structuredClone(origin);
      }
    });
    if (componentPreview.activeJointId) {
      projected.activeJointId =
        projection.entityRefKeyToGlobal.get(
          entityRefKey({
            type: 'joint',
            componentId,
            entityId: componentPreview.activeJointId,
          }),
        ) ?? projected.activeJointId;
    }
  });
  return projected;
}

/**
 * Angles that put every controllable joint back at the pose the model is authored
 * in: `referencePosition` where the source declares one (MJCF `ref`, URDF
 * `<calibration reference_position>`), otherwise 0.
 *
 * Reset deliberately reads this from the joints themselves instead of a pose
 * captured when the panel first saw the robot: the capture drifted to whatever
 * pose the user had already applied whenever its scope was re-seeded, which made
 * Reset a silent no-op.
 */
export function resolveJointPanelResetAngles(joints: RobotData['joints']): Record<string, number> {
  return Object.fromEntries(
    getSingleDofJointEntries(joints).map(([jointId, joint]) => [
      jointId,
      getJointReferencePosition(joint),
    ]),
  );
}

export function createTreeJointPanelScopeKey({
  componentId,
  sourceFilePath,
  robot,
  projection,
}: {
  componentId: string;
  sourceFilePath?: string;
  robot: Pick<RobotData, 'name' | 'rootLinkId'>;
  projection?: AssemblySceneProjection;
}): string {
  const projectionScope = projection ? `projection-${resolveProjectionScopeId(projection)}:` : '';
  return `${componentId}:${projectionScope}${sourceFilePath ?? `${robot.name}:${robot.rootLinkId}`}`;
}

interface TreeEditorJointSectionProps {
  robot: RobotData;
  projection: AssemblySceneProjection;
  jointAngleState?: Record<string, number>;
  selection: WorkspaceSelection;
  lang: Language;
  onSelect?: (selection: WorkspaceSelection) => void;
  onUpdate: (ref: EntityRef, patch: WorkspacePropertyPatch) => void;
  onJointAnglePreview?: (ref: JointEntityRef | BridgeEntityRef, angle: number) => void;
  onJointAngleChange?: (ref: JointEntityRef | BridgeEntityRef, angle: number) => void;
  onResetJointAngles?: (
    targets: readonly { ref: JointEntityRef | BridgeEntityRef; angle: number }[],
  ) => readonly { ref: JointEntityRef | BridgeEntityRef; angle: number }[];
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

function buildJointAngleSnapshot(
  joints: Record<string, any>,
  projectedJointAngles?: Record<string, number>,
) {
  const nextAngles: Record<string, number> = {};
  getSingleDofJointEntries(joints).forEach(([jointId, joint]) => {
    const angle = resolveJointSnapshotAngle(joint);
    nextAngles[jointId] = angle;
    if (typeof joint.name === 'string' && joint.name.length > 0) {
      nextAngles[joint.name] = angle;
    }
  });

  return {
    ...normalizeViewerJointAngleState(joints, nextAngles),
    ...normalizeViewerJointAngleState(joints, projectedJointAngles),
  };
}

export function resolveJointPanelWorkspaceRef(
  projection: AssemblySceneProjection,
  projectedJointId: string,
): JointEntityRef | BridgeEntityRef | null {
  const ref = projection.globalToEntityRef.get(projectedJointId);
  return ref?.type === 'joint' || ref?.type === 'bridge' ? ref : null;
}

export function resolveJointPanelResetReconciliation({
  acceptedTargets,
  currentAngles,
  projection,
  requestedAngles,
}: {
  acceptedTargets: readonly { ref: JointEntityRef | BridgeEntityRef; angle: number }[];
  currentAngles: Record<string, number>;
  projection: AssemblySceneProjection;
  requestedAngles: Record<string, number>;
}): {
  jointAngles: Record<string, number>;
  pendingAngles: Record<string, number>;
} {
  const acceptedAngles = Object.fromEntries(
    acceptedTargets.flatMap(({ ref, angle }) => {
      const jointId = projection.entityRefKeyToGlobal.get(entityRefKey(ref));
      return jointId && jointId in requestedAngles && Number.isFinite(angle)
        ? [[jointId, angle]]
        : [];
    }),
  );
  const jointAngles: Record<string, number> = {};
  const pendingAngles: Record<string, number> = {};

  Object.keys(requestedAngles).forEach((jointId) => {
    const acceptedAngle = acceptedAngles[jointId];
    if (acceptedAngle !== undefined) {
      jointAngles[jointId] = acceptedAngle;
      if (!areJointAnglesEquivalent(currentAngles[jointId], acceptedAngle)) {
        pendingAngles[jointId] = acceptedAngle;
      }
      return;
    }

    const currentAngle = currentAngles[jointId];
    if (Number.isFinite(currentAngle)) {
      jointAngles[jointId] = currentAngle;
    }
  });

  return { jointAngles, pendingAngles };
}

export function TreeEditorJointSection({
  robot,
  projection,
  jointAngleState,
  selection,
  lang,
  onSelect,
  onUpdate,
  onJointAnglePreview,
  onJointAngleChange,
  onResetJointAngles,
  show,
  sourceFilePath,
  height,
  isDragging = false,
}: TreeEditorJointSectionProps) {
  const t = translations[lang];
  const localSelection = React.useMemo(() => {
    const ref = selection?.entity;
    if (!ref || (ref.type !== 'link' && ref.type !== 'joint' && ref.type !== 'bridge')) {
      return { type: null, id: null } as const;
    }
    const id = projection.entityRefKeyToGlobal.get(entityRefKey(ref));
    if (!id) {
      return { type: null, id: null } as const;
    }
    return { type: ref.type === 'bridge' ? 'joint' : ref.type, id } as const;
  }, [projection, selection]);
  const localRobot = React.useMemo(
    () => ({ ...robot, selection: localSelection }),
    [localSelection, robot],
  );
  const jointEntries = React.useMemo(
    () => getSingleDofJointEntries(robot?.joints),
    [robot?.joints],
  );
  const hasJointEntries = jointEntries.length > 0;
  const panelSections = useUIStore((state) => state.panelSections);
  const setPanelSection = useUIStore((state) => state.setPanelSection);
  const ignoreJointLimits = useUIStore((state) => state.ignoreJointLimits);
  const setIgnoreJointLimits = useUIStore((state) => state.setIgnoreJointLimits);
  const isCollapsed = panelSections[TREE_EDITOR_JOINT_SECTION_KEY] ?? false;
  const [angleUnit, setAngleUnit] = React.useState<'rad' | 'deg'>('rad');
  const [isAdvanced, setIsAdvanced] = React.useState(false);
  const jointPanelStoreRef = React.useRef(createJointPanelStore());
  const pendingCommittedJointAnglesRef = React.useRef<Record<string, number>>({});
  const pendingCommittedJointAnglesScopeRef = React.useRef<string | null>(null);
  const resetScopeRef = React.useRef<string | null>(null);
  const previousActiveJointRef = React.useRef<string | null>(null);
  const shouldShow = show;
  const jointAngleSnapshot = React.useMemo(
    () => buildJointAngleSnapshot(robot.joints, jointAngleState),
    [jointAngleState, robot.joints],
  );
  const resetScopeKey = createTreeJointPanelScopeKey({
    componentId: 'workspace',
    sourceFilePath,
    robot,
    projection,
  });
  // Row-local editing and drag state belongs to the document target, not to a
  // semantic projection revision. Limit edits rebuild the projection; using
  // resetScopeKey as the React key would unmount a slider while pointerdown is
  // committing an adjacent numeric editor.
  const interactionScopeKey = createTreeJointPanelScopeKey({
    componentId: 'workspace',
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
  }, [resetScopeKey]);

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
      const projectedPreview = resolveWorkspaceViewerJointPreviewState(preview, projection);
      if (projectedPreview.activeJointId) {
        jointPanelStoreRef.current.setActiveJoint(projectedPreview.activeJointId, {
          autoScroll: projectedPreview.activeJointId !== previousActiveJointRef.current,
        });
        previousActiveJointRef.current = projectedPreview.activeJointId;
      }

      const previewAngles = patchLocalJointAngles(projectedPreview.jointAngles);
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
  }, [patchLocalJointAngles, projection, resetScopeKey]);

  const handleJointAnglePreview = React.useCallback(
    (jointName: string, angle: number) => {
      const jointId = patchLocalJointAngle(jointName, angle);
      const ref = resolveJointPanelWorkspaceRef(projection, jointId);
      if (ref) {
        onJointAnglePreview?.(ref, angle);
      }
    },
    [onJointAnglePreview, patchLocalJointAngle, projection],
  );

  const handleJointAngleCommit = React.useCallback(
    (jointName: string, angle: number) => {
      const jointId = patchLocalJointAngle(jointName, angle);
      pendingCommittedJointAnglesRef.current = {
        ...pendingCommittedJointAnglesRef.current,
        [jointId]: angle,
      };
      pendingCommittedJointAnglesScopeRef.current = resetScopeKey;
      const ref = resolveJointPanelWorkspaceRef(projection, jointId);
      if (ref) {
        onJointAngleChange?.(ref, angle);
      }
    },
    [onJointAngleChange, patchLocalJointAngle, projection, resetScopeKey],
  );

  React.useEffect(() => {
    const nextActiveJoint = resolveActiveViewerJointKeyFromSelection(robot.joints, localSelection);
    const autoScroll =
      nextActiveJoint !== null && previousActiveJointRef.current !== nextActiveJoint;

    jointPanelStoreRef.current.setActiveJoint(nextActiveJoint, { autoScroll });
    previousActiveJointRef.current = nextActiveJoint;
  }, [localSelection, robot.joints]);

  const handleResetJoints = React.useCallback(() => {
    const normalizedResetAngles = normalizeViewerJointAngleState(
      robot.joints,
      resolveJointPanelResetAngles(robot.joints),
    );

    const resetTargets = Object.entries(normalizedResetAngles).flatMap(([jointId, angle]) => {
      const ref = resolveJointPanelWorkspaceRef(projection, jointId);
      return ref ? [{ ref, angle }] : [];
    });
    let acceptedTargets: readonly {
      ref: JointEntityRef | BridgeEntityRef;
      angle: number;
    }[];
    if (onResetJointAngles) {
      acceptedTargets = onResetJointAngles(resetTargets);
    } else {
      resetTargets.forEach(({ ref, angle }) => {
        onJointAngleChange?.(ref, angle);
      });
      acceptedTargets = resetTargets;
    }

    const reconciliation = resolveJointPanelResetReconciliation({
      acceptedTargets,
      currentAngles: jointAngleSnapshot,
      projection,
      requestedAngles: normalizedResetAngles,
    });
    patchLocalJointAngles(reconciliation.jointAngles);
    pendingCommittedJointAnglesRef.current = reconciliation.pendingAngles;
    pendingCommittedJointAnglesScopeRef.current = resetScopeKey;
  }, [
    jointAngleSnapshot,
    onJointAngleChange,
    onResetJointAngles,
    patchLocalJointAngles,
    projection,
    resetScopeKey,
    robot.joints,
  ]);

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
              ignoreLimits={ignoreJointLimits}
              onToggleIgnoreLimits={setIgnoreJointLimits}
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
              scopeKey={interactionScopeKey}
              angleUnit={angleUnit}
              jointPanelStore={jointPanelStoreRef.current}
              setActiveJoint={jointPanelStoreRef.current.setActiveJoint}
              handleJointAngleChange={handleJointAnglePreview}
              handleJointChangeCommit={handleJointAngleCommit}
              onSelect={(type: 'link' | 'joint', id: string) => {
                if (type !== 'joint') return;
                const ref = resolveJointPanelWorkspaceRef(projection, id);
                if (ref) onSelect?.({ entity: ref });
              }}
              isAdvanced={isAdvanced}
              ignoreLimits={ignoreJointLimits}
              onUpdate={(type, id, data) => {
                if (type !== 'link' && type !== 'joint') return;
                const ref = resolveJointPanelWorkspaceRef(projection, id);
                if (!ref) return;
                const patch = data as WorkspaceJointPropertyPatch;
                onUpdate(ref, ref.type === 'bridge' ? { joint: patch } : patch);
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
