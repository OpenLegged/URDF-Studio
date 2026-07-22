import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { Html } from '@react-three/drei';
import * as THREE from 'three';

import { UnifiedTransformControls, VISUALIZER_UNIFIED_GIZMO_SIZE } from '@/shared/components/3d';
import type {
  AssemblyScenePlacement,
  AssemblySceneProjection,
} from '@/core/robot';
import { entityRefKey, type AssemblyTransform, type UrdfOrigin, type WorkspaceSelection } from '@/types';
import type { UpdateCommitOptions } from '@/types/viewer';
import { useSelectionStore, type HoverFreezeOwner } from '@/store/selectionStore';

import { decomposeJointPivotMatrixToOrigin } from '../utils/assemblyTransformControlsShared';
import { AssemblySelectionBounds } from './AssemblySelectionBounds';

interface AssemblyTransformControlsProps {
  runtimeRobot: THREE.Object3D | null;
  sceneProjection: AssemblySceneProjection;
  scenePlacement: AssemblyScenePlacement;
  workspaceSelection: WorkspaceSelection;
  transformMode: 'translate' | 'rotate' | 'universal';
  assemblyRoot: THREE.Group | null;
  directComponentRoot: THREE.Group | null;
  onAssemblyTransform?: (transform: AssemblyTransform) => void;
  onComponentTransform?: (
    componentId: string,
    transform: AssemblyTransform,
    options?: UpdateCommitOptions,
  ) => void;
  onBridgeTransform?: (
    bridgeId: string,
    origin: UrdfOrigin,
    options?: UpdateCommitOptions,
  ) => void;
  onTransformPendingChange?: (pending: boolean) => void;
}

type ActiveTransformTarget =
  | { kind: 'assembly'; object: THREE.Object3D }
  | { kind: 'component'; componentId: string; object: THREE.Object3D }
  | { kind: 'bridge'; bridgeId: string; object: THREE.Object3D };

function decomposeTransformMatrix(matrix: THREE.Matrix4): AssemblyTransform {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler(0, 0, 0, 'ZYX');

  matrix.decompose(position, quaternion, scale);
  euler.setFromQuaternion(quaternion, 'ZYX');

  return {
    position: { x: position.x, y: position.y, z: position.z },
    rotation: { r: euler.x, p: euler.y, y: euler.z },
  };
}

function resolveRuntimeJoints(
  runtimeRobot: THREE.Object3D | null,
): Record<string, THREE.Object3D | undefined> {
  return (
    runtimeRobot as (THREE.Object3D & { joints?: Record<string, THREE.Object3D> }) | null
  )?.joints ?? {};
}

export const AssemblyTransformControls = memo(function AssemblyTransformControls({
  runtimeRobot,
  sceneProjection,
  scenePlacement,
  workspaceSelection,
  transformMode,
  assemblyRoot,
  directComponentRoot,
  onAssemblyTransform,
  onComponentTransform,
  onBridgeTransform,
  onTransformPendingChange,
}: AssemblyTransformControlsProps) {
  const setHoverFrozen = useSelectionStore((state) => state.setHoverFrozen);
  const hoverFreezeOwner = useRef<HoverFreezeOwner>(
    Symbol('assembly-transform-controls'),
  ).current;
  const dragTargetRef = useRef<ActiveTransformTarget | null>(null);
  const runtimeJoints = useMemo(() => resolveRuntimeJoints(runtimeRobot), [runtimeRobot]);

  const activeTarget = useMemo<ActiveTransformTarget | null>(() => {
    const entity = workspaceSelection?.entity;
    if (!entity) {
      return null;
    }
    if (entity.type === 'assembly') {
      return assemblyRoot ? { kind: 'assembly', object: assemblyRoot } : null;
    }
    if (entity.type === 'bridge') {
      const runtimeJointId = sceneProjection.entityRefKeyToGlobal.get(entityRefKey(entity));
      const object = runtimeJointId ? runtimeJoints[runtimeJointId] : undefined;
      return object ? { kind: 'bridge', bridgeId: entity.bridgeId, object } : null;
    }
    if (entity.type !== 'component') {
      return null;
    }

    if (
      scenePlacement.renderStrategy === 'direct-component' &&
      scenePlacement.directComponentId === entity.componentId
    ) {
      return directComponentRoot
        ? { kind: 'component', componentId: entity.componentId, object: directComponentRoot }
        : null;
    }

    const target = scenePlacement.componentTransformTargets.get(entity.componentId);
    if (!target) {
      return null;
    }
    const object = runtimeJoints[target.runtimeJointId];
    if (!object) {
      return null;
    }
    return target.kind === 'bridge'
      ? { kind: 'bridge', bridgeId: target.bridgeId, object }
      : { kind: 'component', componentId: entity.componentId, object };
  }, [
    assemblyRoot,
    directComponentRoot,
    runtimeJoints,
    scenePlacement,
    sceneProjection.entityRefKeyToGlobal,
    workspaceSelection,
  ]);

  const commitTransform = useCallback(() => {
    const target = dragTargetRef.current;
    if (!target) {
      return;
    }
    target.object.updateMatrix();
    if (target.kind === 'assembly') {
      onAssemblyTransform?.(decomposeTransformMatrix(target.object.matrix));
      return;
    }
    if (target.kind === 'bridge') {
      onBridgeTransform?.(
        target.bridgeId,
        decomposeJointPivotMatrixToOrigin(target.object.matrix),
        { commitMode: 'immediate' },
      );
      return;
    }
    onComponentTransform?.(
      target.componentId,
      decomposeTransformMatrix(target.object.matrix),
      { commitMode: 'immediate' },
    );
  }, [onAssemblyTransform, onBridgeTransform, onComponentTransform]);

  const handleDraggingChanged = useCallback(
    (event?: { value?: boolean }) => {
      const dragging = Boolean(event?.value);
      setHoverFrozen(hoverFreezeOwner, dragging);
      onTransformPendingChange?.(dragging);

      if (dragging) {
        dragTargetRef.current = activeTarget;
        return;
      }
      commitTransform();
      dragTargetRef.current = null;
    },
    [activeTarget, commitTransform, hoverFreezeOwner, onTransformPendingChange, setHoverFrozen],
  );

  useEffect(
    () => () => {
      setHoverFrozen(hoverFreezeOwner, false);
      onTransformPendingChange?.(false);
      dragTargetRef.current = null;
    },
    [hoverFreezeOwner, onTransformPendingChange, setHoverFrozen],
  );

  if (!activeTarget) {
    return workspaceSelection?.entity.type === 'component' ? (
      <Html fullscreen>
        <div className="pointer-events-none absolute right-4 top-4 rounded-lg border border-amber-400/30 bg-panel-bg/95 px-3 py-2 text-xs text-text-primary shadow-lg">
          This component has no editable scene transform target.
        </div>
      </Html>
    ) : null;
  }

  return (
    <>
      <AssemblySelectionBounds object={activeTarget.object} />
      <UnifiedTransformControls
        object={activeTarget.object}
        mode={transformMode}
        size={VISUALIZER_UNIFIED_GIZMO_SIZE}
        translateSpace="world"
        rotateSpace="local"
        hoverStyle="single-axis"
        displayStyle="thick-primary"
        onDraggingChanged={handleDraggingChanged}
      />
    </>
  );
});
