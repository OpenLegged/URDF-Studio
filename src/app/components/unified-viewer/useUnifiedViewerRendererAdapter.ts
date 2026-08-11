import React, { useEffect } from 'react';

import type {
  AssemblyEntityRef,
  AssemblyState,
  AssemblyTransform,
  BridgeEntityRef,
  ComponentEntityRef,
  EntityRef,
  InteractionSelection,
  JointEntityRef,
  LinkEntityRef,
  UrdfOrigin,
  WorkspaceSelection,
} from '@/types';
import type { AssemblyScenePlacement, AssemblySceneProjection } from '@/core/robot';
import { isEntityEditorLocked, isWorkspaceSelectionEditorLocked } from '@/core/robot';
import {
  projectJointPreviewToWorkspaceComponents,
  projectWorkspaceSelectionToRenderer,
  resolveRendererSelectionToWorkspace,
  resolveWorkspaceFocusTarget,
  type ViewerHelperKind,
} from '@/features/editor';
import { useProjectedJointMotionCommit } from '@/app/hooks/workspace-mutations/projectedJointMotionCommit';
import type {
  WorkspaceJointPropertyPatch,
  WorkspaceLinkPropertyPatch,
} from '@/store/workspaceStore';
import type { UpdateCommitOptions } from '@/types/viewer';

export type UnifiedViewerRendererUpdatePatch =
  | WorkspaceLinkPropertyPatch
  | WorkspaceJointPropertyPatch;

export type UnifiedViewerRendererUpdateHandler = (
  type: 'link' | 'joint',
  id: string,
  data: unknown,
) => void;

export interface UnifiedViewerWorkspaceUpdateHandler {
  (ref: LinkEntityRef, data: WorkspaceLinkPropertyPatch): void;
  (ref: JointEntityRef, data: WorkspaceJointPropertyPatch): void;
}

export interface UnifiedViewerRendererAdapterInput {
  workspace: AssemblyState;
  sceneProjection: AssemblySceneProjection;
  scenePlacement: AssemblyScenePlacement;
  selection: WorkspaceSelection;
  hoveredSelection: WorkspaceSelection;
  focusTarget?: EntityRef | null;
  workspaceInteractionEnabled: boolean;
  clearHover: () => void;
  onSelect: (selection: WorkspaceSelection) => void;
  onHover?: (selection: WorkspaceSelection) => void;
  onUpdate: UnifiedViewerWorkspaceUpdateHandler;
  onCollisionTransformPreview?: (
    ref: LinkEntityRef,
    position: { x: number; y: number; z: number },
    rotation: { r: number; p: number; y: number },
    objectIndex?: number,
  ) => void;
  onCollisionTransform?: (
    ref: LinkEntityRef,
    position: { x: number; y: number; z: number },
    rotation: { r: number; p: number; y: number },
    objectIndex?: number,
  ) => void;
  onAssemblyTransform?: (
    ref: AssemblyEntityRef,
    transform: AssemblyTransform,
    options?: UpdateCommitOptions,
  ) => void;
  onComponentTransform?: (
    ref: ComponentEntityRef,
    transform: AssemblyTransform,
    options?: UpdateCommitOptions,
  ) => void;
  onBridgeTransform?: (
    ref: BridgeEntityRef,
    origin: UrdfOrigin,
    options?: UpdateCommitOptions,
  ) => void;
}

type RendererSelectionAdapter = Pick<
  UnifiedViewerRendererAdapter,
  | 'rendererSelection'
  | 'rendererHoveredSelection'
  | 'rendererFocusTarget'
  | 'handleRendererSelect'
  | 'handleRendererMeshSelect'
  | 'handleRendererHover'
>;

type RendererMutationAdapter = Pick<
  UnifiedViewerRendererAdapter,
  | 'handleRendererUpdate'
  | 'handleRendererCollisionTransformPreview'
  | 'handleRendererCollisionTransform'
  | 'handleRendererAssemblyTransform'
  | 'handleRendererComponentTransform'
  | 'handleRendererBridgeTransform'
>;

export interface UnifiedViewerRendererAdapter {
  rendererSelection: InteractionSelection;
  rendererHoveredSelection: InteractionSelection;
  rendererFocusTarget: string | null;
  handleRendererSelect: (
    type: Exclude<InteractionSelection['type'], null>,
    id: string,
    subType?: 'visual' | 'collision',
    helperKind?: ViewerHelperKind,
  ) => void;
  handleRendererMeshSelect: (
    linkId: string,
    jointId: string | null,
    objectIndex: number,
    objectType: 'visual' | 'collision',
  ) => void;
  handleRendererHover: (
    type: InteractionSelection['type'],
    id: string | null,
    subType?: 'visual' | 'collision',
    objectIndex?: number,
    helperKind?: ViewerHelperKind,
    highlightObjectId?: number,
  ) => void;
  handleRendererUpdate: UnifiedViewerRendererUpdateHandler;
  handleRendererCollisionTransformPreview: (
    linkId: string,
    position: { x: number; y: number; z: number },
    rotation: { r: number; p: number; y: number },
    objectIndex?: number,
  ) => void;
  handleRendererCollisionTransform: (
    linkId: string,
    position: { x: number; y: number; z: number },
    rotation: { r: number; p: number; y: number },
    objectIndex?: number,
  ) => void;
  handleRendererAssemblyTransform: (
    transform: AssemblyTransform,
    options?: UpdateCommitOptions,
  ) => void;
  handleRendererComponentTransform: (
    componentId: string,
    transform: AssemblyTransform,
    options?: UpdateCommitOptions,
  ) => void;
  handleRendererBridgeTransform: (
    bridgeId: string,
    origin: UrdfOrigin,
    options?: UpdateCommitOptions,
  ) => void;
  commitProjectedJointMotion: ReturnType<typeof useProjectedJointMotionCommit>;
  projectJointInteractionPreview: (
    preview: Parameters<typeof projectJointPreviewToWorkspaceComponents>[1],
  ) => ReturnType<typeof projectJointPreviewToWorkspaceComponents>;
}

type RendererHoverArgs = Parameters<UnifiedViewerRendererAdapter['handleRendererHover']>;

function isObjectPatch(data: unknown): data is Record<string, unknown> {
  return typeof data === 'object' && data !== null && !Array.isArray(data);
}

function useRendererSelectionAdapter({
  workspace,
  sceneProjection,
  scenePlacement,
  selection,
  hoveredSelection,
  focusTarget,
  onSelect,
  onHover,
}: Pick<
  UnifiedViewerRendererAdapterInput,
  | 'workspace'
  | 'sceneProjection'
  | 'scenePlacement'
  | 'selection'
  | 'hoveredSelection'
  | 'focusTarget'
  | 'onSelect'
  | 'onHover'
>): RendererSelectionAdapter {
  const rendererSelection = React.useMemo(
    () => projectWorkspaceSelectionToRenderer(sceneProjection, selection),
    [sceneProjection, selection],
  );
  const rendererHoveredSelection = React.useMemo(
    () => projectWorkspaceSelectionToRenderer(sceneProjection, hoveredSelection),
    [hoveredSelection, sceneProjection],
  );
  const rendererFocusTarget = React.useMemo(
    () => resolveWorkspaceFocusTarget(sceneProjection, scenePlacement, focusTarget),
    [focusTarget, scenePlacement, sceneProjection],
  );

  const handleRendererSelect = React.useCallback(
    (
      type: Exclude<InteractionSelection['type'], null>,
      id: string,
      subType?: 'visual' | 'collision',
      helperKind?: ViewerHelperKind,
    ) => {
      const nextSelection = resolveRendererSelectionToWorkspace(sceneProjection, {
        type,
        id,
        subType,
        helperKind,
      });
      if (!isWorkspaceSelectionEditorLocked(workspace, nextSelection)) {
        onSelect(nextSelection);
      }
    },
    [onSelect, sceneProjection, workspace],
  );

  const handleRendererMeshSelect = React.useCallback(
    (
      linkId: string,
      _jointId: string | null,
      objectIndex: number,
      objectType: 'visual' | 'collision',
    ) => {
      const nextSelection = resolveRendererSelectionToWorkspace(sceneProjection, {
        type: 'link',
        id: linkId,
        subType: objectType,
        objectIndex,
      });
      if (!isWorkspaceSelectionEditorLocked(workspace, nextSelection)) {
        onSelect(nextSelection);
      }
    },
    [onSelect, sceneProjection, workspace],
  );

  const handleRendererHover = React.useCallback<RendererSelectionAdapter['handleRendererHover']>(
    (...[
      type,
      id,
      subType,
      objectIndex,
      helperKind,
      highlightObjectId,
    ]: RendererHoverArgs) => {
      const nextSelection = resolveRendererSelectionToWorkspace(sceneProjection, {
        type,
        id,
        subType,
        objectIndex,
        helperKind,
        highlightObjectId,
      });
      onHover?.(
        isWorkspaceSelectionEditorLocked(workspace, nextSelection) ? null : nextSelection,
      );
    },
    [onHover, sceneProjection, workspace],
  );

  return {
    rendererSelection,
    rendererHoveredSelection,
    rendererFocusTarget,
    handleRendererSelect,
    handleRendererMeshSelect,
    handleRendererHover,
  };
}

function useRendererMutationAdapter({
  workspace,
  sceneProjection,
  onUpdate,
  onCollisionTransformPreview,
  onCollisionTransform,
  onAssemblyTransform,
  onComponentTransform,
  onBridgeTransform,
}: Pick<
  UnifiedViewerRendererAdapterInput,
  | 'workspace'
  | 'sceneProjection'
  | 'onUpdate'
  | 'onCollisionTransformPreview'
  | 'onCollisionTransform'
  | 'onAssemblyTransform'
  | 'onComponentTransform'
  | 'onBridgeTransform'
>): RendererMutationAdapter {
  const handleRendererUpdate = React.useCallback<UnifiedViewerRendererUpdateHandler>(
    (type, id, data) => {
      if (!isObjectPatch(data)) {
        return;
      }

      const resolved = resolveRendererSelectionToWorkspace(sceneProjection, { type, id });
      if (!resolved || (resolved.entity.type !== 'link' && resolved.entity.type !== 'joint')) {
        return;
      }
      if (isEntityEditorLocked(workspace, resolved.entity)) {
        return;
      }

      if (resolved.entity.type === 'link') {
        onUpdate(resolved.entity, data as WorkspaceLinkPropertyPatch);
        return;
      }
      onUpdate(resolved.entity, data as WorkspaceJointPropertyPatch);
    },
    [onUpdate, sceneProjection, workspace],
  );

  const resolveRendererLinkRef = React.useCallback(
    (linkId: string): LinkEntityRef | null => {
      const resolved = resolveRendererSelectionToWorkspace(sceneProjection, {
        type: 'link',
        id: linkId,
      });
      return resolved?.entity.type === 'link' ? resolved.entity : null;
    },
    [sceneProjection],
  );

  const handleRendererCollisionTransformPreview = React.useCallback(
    (
      linkId: string,
      position: { x: number; y: number; z: number },
      rotation: { r: number; p: number; y: number },
      objectIndex?: number,
    ) => {
      const ref = resolveRendererLinkRef(linkId);
      if (ref && !isEntityEditorLocked(workspace, ref)) {
        onCollisionTransformPreview?.(ref, position, rotation, objectIndex);
      }
    },
    [onCollisionTransformPreview, resolveRendererLinkRef, workspace],
  );

  const handleRendererCollisionTransform = React.useCallback(
    (
      linkId: string,
      position: { x: number; y: number; z: number },
      rotation: { r: number; p: number; y: number },
      objectIndex?: number,
    ) => {
      const ref = resolveRendererLinkRef(linkId);
      if (ref && !isEntityEditorLocked(workspace, ref)) {
        onCollisionTransform?.(ref, position, rotation, objectIndex);
      }
    },
    [onCollisionTransform, resolveRendererLinkRef, workspace],
  );

  const handleRendererAssemblyTransform = React.useCallback(
    (transform: AssemblyTransform, options?: UpdateCommitOptions) => {
      onAssemblyTransform?.({ type: 'assembly' }, transform, options);
    },
    [onAssemblyTransform],
  );

  const handleRendererComponentTransform = React.useCallback(
    (componentId: string, transform: AssemblyTransform, options?: UpdateCommitOptions) => {
      if (isEntityEditorLocked(workspace, { type: 'component', componentId })) {
        return;
      }
      onComponentTransform?.({ type: 'component', componentId }, transform, options);
    },
    [onComponentTransform, workspace],
  );

  const handleRendererBridgeTransform = React.useCallback(
    (bridgeId: string, origin: UrdfOrigin, options?: UpdateCommitOptions) => {
      if (isEntityEditorLocked(workspace, { type: 'bridge', bridgeId })) {
        return;
      }
      onBridgeTransform?.({ type: 'bridge', bridgeId }, origin, options);
    },
    [onBridgeTransform, workspace],
  );

  return {
    handleRendererUpdate,
    handleRendererCollisionTransformPreview,
    handleRendererCollisionTransform,
    handleRendererAssemblyTransform,
    handleRendererComponentTransform,
    handleRendererBridgeTransform,
  };
}

function useRendererHoverCleanup({
  workspaceInteractionEnabled,
  clearHover,
}: Pick<
  UnifiedViewerRendererAdapterInput,
  'workspaceInteractionEnabled' | 'clearHover'
>): void {
  useEffect(() => {
    if (!workspaceInteractionEnabled) {
      clearHover();
      return undefined;
    }

    const handleWindowBlur = () => {
      clearHover();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        clearHover();
      }
    };

    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearHover();
    };
  }, [clearHover, workspaceInteractionEnabled]);
}

export function useUnifiedViewerRendererAdapter({
  workspace,
  sceneProjection,
  scenePlacement,
  selection,
  hoveredSelection,
  focusTarget,
  workspaceInteractionEnabled,
  clearHover,
  onSelect,
  onHover,
  onUpdate,
  onCollisionTransformPreview,
  onCollisionTransform,
  onAssemblyTransform,
  onComponentTransform,
  onBridgeTransform,
}: UnifiedViewerRendererAdapterInput): UnifiedViewerRendererAdapter {
  const selectionAdapter = useRendererSelectionAdapter({
    workspace,
    sceneProjection,
    scenePlacement,
    selection,
    hoveredSelection,
    focusTarget,
    onSelect,
    onHover,
  });
  const mutationAdapter = useRendererMutationAdapter({
    workspace,
    sceneProjection,
    onUpdate,
    onCollisionTransformPreview,
    onCollisionTransform,
    onAssemblyTransform,
    onComponentTransform,
    onBridgeTransform,
  });
  const commitProjectedJointMotion = useProjectedJointMotionCommit(sceneProjection);
  const projectJointInteractionPreview = React.useCallback(
    (preview: Parameters<typeof projectJointPreviewToWorkspaceComponents>[1]) =>
      projectJointPreviewToWorkspaceComponents(sceneProjection, preview),
    [sceneProjection],
  );

  useRendererHoverCleanup({ workspaceInteractionEnabled, clearHover });

  return {
    ...selectionAdapter,
    ...mutationAdapter,
    commitProjectedJointMotion,
    projectJointInteractionPreview,
  };
}
