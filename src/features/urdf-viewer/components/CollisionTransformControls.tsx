import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { UnifiedTransformControls } from '@/shared/components/3d';
import { resolveLinkKey } from '@/core/robot';
import type { GeometryTransformControlsProps } from '../types';
import { useCollisionTransformDragLifecycle } from '../hooks/useCollisionTransformDragLifecycle';
import { getObjectRPY } from '../utils/collisionTransformMath';
import { resolveCurrentCollisionDraggingControls } from '../utils/collisionTransformControlsShared';
import { resolveLocalTransformGizmoSizing } from '../utils/localTransformGizmoSizing';

const COLLISION_GIZMO_SIZING = resolveLocalTransformGizmoSizing('collision');
const COLLISION_TRANSLATE_GIZMO_SIZE = COLLISION_GIZMO_SIZING.translateSize;
const COLLISION_ROTATE_GIZMO_SIZE = COLLISION_GIZMO_SIZING.rotateSize;
const COLLISION_GIZMO_THICKNESS_SCALE = COLLISION_GIZMO_SIZING.thicknessScale;
const COLLISION_COMMITTED_TRANSFORM_EPSILON = 1e-6;

export const GeometryTransformControls: React.FC<GeometryTransformControlsProps> = ({
  robot,
  robotVersion,
  selection,
  geometrySubType,
  transformMode,
  setIsDragging,
  onTransformChange,
  onTransformEnd,
  robotLinks,
  onTransformPending,
}) => {
  const transformRef = useRef<any>(null);
  const rotateTransformRef = useRef<any>(null);
  const { invalidate } = useThree();
  const [targetObject, setTargetObject] = useState<THREE.Object3D | null>(null);
  const [translateProxy, setTranslateProxy] = useState<THREE.Group | null>(null);

  const originalPositionRef = useRef(new THREE.Vector3());
  const originalRotationRef = useRef(new THREE.Euler());
  const originalQuaternionRef = useRef(new THREE.Quaternion());
  const targetObjectRef = useRef<THREE.Object3D | null>(null);
  const translateProxyRef = useRef<THREE.Group | null>(null);
  const activeSelectionRef = useRef<{ id: string; objectIndex?: number } | null>(null);
  const onTransformChangeRef = useRef(onTransformChange);
  const onTransformEndRef = useRef(onTransformEnd);
  const proxyWorldPositionRef = useRef(new THREE.Vector3());
  const proxyLocalPositionRef = useRef(new THREE.Vector3());
  const proxyParentQuaternionRef = useRef(new THREE.Quaternion());
  const queuedPreviewFrameRef = useRef<number | null>(null);
  const queuedPreviewRef = useRef<{
    id: string;
    objectIndex?: number;
    position: { x: number; y: number; z: number };
    rotation: { r: number; p: number; y: number };
  } | null>(null);
  const lastCommittedTransformRef = useRef<{
    id: string;
    objectIndex: number;
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
  } | null>(null);

  const resolveSelectionLinkId = useCallback(
    (identity: string | null | undefined) => {
      if (!identity) return null;
      return resolveLinkKey(robotLinks || {}, identity) ?? identity;
    },
    [robotLinks],
  );

  const hasTransformChanged = useCallback((object: THREE.Object3D) => {
    const positionChanged = originalPositionRef.current.distanceToSquared(object.position) > 1e-8;
    const rotationChanged = originalQuaternionRef.current.angleTo(object.quaternion) > 1e-4;
    return positionChanged || rotationChanged;
  }, []);

  useEffect(() => {
    targetObjectRef.current = targetObject;
  }, [targetObject]);

  useEffect(() => {
    onTransformChangeRef.current = onTransformChange;
  }, [onTransformChange]);

  useEffect(() => {
    onTransformEndRef.current = onTransformEnd;
  }, [onTransformEnd]);

  const syncTranslateProxy = useCallback(
    (proxyTarget: THREE.Object3D | null, object = targetObjectRef.current) => {
      if (!proxyTarget || !object) return;

      object.updateMatrixWorld(true);
      object.getWorldPosition(proxyWorldPositionRef.current);
      proxyTarget.position.copy(proxyWorldPositionRef.current);

      const parent = object.parent;
      if (parent) {
        parent.getWorldQuaternion(proxyParentQuaternionRef.current);
        proxyTarget.quaternion.copy(proxyParentQuaternionRef.current);
      } else {
        proxyTarget.quaternion.identity();
      }

      proxyTarget.scale.setScalar(1);
      proxyTarget.updateMatrixWorld(true);
    },
    [],
  );

  const applyTranslateProxyToTarget = useCallback(() => {
    const proxy = translateProxyRef.current;
    const object = targetObjectRef.current;
    if (!proxy || !object) return;

    proxy.updateMatrixWorld(true);
    proxy.getWorldPosition(proxyWorldPositionRef.current);
    proxyLocalPositionRef.current.copy(proxyWorldPositionRef.current);

    const parent = object.parent;
    if (parent) {
      parent.worldToLocal(proxyLocalPositionRef.current);
    }

    object.position.copy(proxyLocalPositionRef.current);
    object.updateMatrixWorld(true);
  }, []);

  const handleTranslateProxyRef = useCallback(
    (proxy: THREE.Group | null) => {
      translateProxyRef.current = proxy;
      setTranslateProxy(proxy);
      syncTranslateProxy(proxy);
    },
    [syncTranslateProxy],
  );

  useEffect(() => {
    if (selection?.id && selection.subType === geometrySubType) {
      const resolvedSelectionId = resolveSelectionLinkId(selection.id);
      if (!resolvedSelectionId) return;

      activeSelectionRef.current = {
        id: resolvedSelectionId,
        objectIndex: selection.objectIndex,
      };
      return;
    }

    if (!isDraggingRef.current) {
      activeSelectionRef.current = null;
    }
  }, [geometrySubType, resolveSelectionLinkId, selection?.id, selection?.objectIndex, selection?.subType]);

  const commitTransform = useCallback(() => {
    const activeTargetObject = targetObjectRef.current;
    const activeSelection = activeSelectionRef.current;
    const handleTransformEnd = onTransformEndRef.current;
    if (!activeTargetObject || !activeSelection?.id || !handleTransformEnd) return false;

    activeTargetObject.updateMatrixWorld(true);

    const position = activeTargetObject.position;
    const rotation = getObjectRPY(activeTargetObject);

    handleTransformEnd(
      activeSelection.id,
      { x: position.x, y: position.y, z: position.z },
      rotation,
      activeSelection.objectIndex,
    );

    lastCommittedTransformRef.current = {
      id: activeSelection.id,
      objectIndex: activeSelection.objectIndex ?? 0,
      position: activeTargetObject.position.clone(),
      quaternion: activeTargetObject.quaternion.clone(),
    };
    originalPositionRef.current.copy(activeTargetObject.position);
    originalRotationRef.current.copy(activeTargetObject.rotation);
    originalQuaternionRef.current.copy(activeTargetObject.quaternion);
    return true;
  }, []);

  const reconcileCommittedTransform = useCallback(
    (object: THREE.Object3D, selectionId: string, objectIndex: number) => {
      const committed = lastCommittedTransformRef.current;
      if (!committed) {
        return;
      }

      if (committed.id !== selectionId || committed.objectIndex !== objectIndex) {
        lastCommittedTransformRef.current = null;
        return;
      }

      const positionMatches =
        object.position.distanceToSquared(committed.position) <=
        COLLISION_COMMITTED_TRANSFORM_EPSILON * COLLISION_COMMITTED_TRANSFORM_EPSILON;
      const rotationMatches =
        object.quaternion.angleTo(committed.quaternion) <= COLLISION_COMMITTED_TRANSFORM_EPSILON;

      if (positionMatches && rotationMatches) {
        lastCommittedTransformRef.current = null;
        return;
      }

      object.position.copy(committed.position);
      object.quaternion.copy(committed.quaternion);
      object.updateMatrixWorld(true);
    },
    [],
  );

  const cancelQueuedTransformPreview = useCallback(() => {
    if (
      queuedPreviewFrameRef.current !== null &&
      typeof window !== 'undefined' &&
      typeof window.cancelAnimationFrame === 'function'
    ) {
      window.cancelAnimationFrame(queuedPreviewFrameRef.current);
    }

    queuedPreviewFrameRef.current = null;
    queuedPreviewRef.current = null;
  }, []);

  const flushQueuedTransformPreview = useCallback(() => {
    queuedPreviewFrameRef.current = null;
    const preview = queuedPreviewRef.current;
    queuedPreviewRef.current = null;
    const handleTransformChange = onTransformChangeRef.current;
    if (!preview || !handleTransformChange) {
      return;
    }

    handleTransformChange(preview.id, preview.position, preview.rotation, preview.objectIndex);
  }, []);

  const queueTransformPreview = useCallback(
    (object: THREE.Object3D) => {
      const activeSelection = activeSelectionRef.current;
      if (!activeSelection?.id || !onTransformChangeRef.current) {
        return;
      }

      object.updateMatrixWorld(true);
      const position = object.position;
      const rotation = getObjectRPY(object);

      queuedPreviewRef.current = {
        id: activeSelection.id,
        objectIndex: activeSelection.objectIndex,
        position: { x: position.x, y: position.y, z: position.z },
        rotation,
      };

      if (queuedPreviewFrameRef.current !== null) {
        return;
      }

      if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
        flushQueuedTransformPreview();
        return;
      }

      queuedPreviewFrameRef.current = window.requestAnimationFrame(flushQueuedTransformPreview);
    },
    [flushQueuedTransformPreview],
  );

  const handleCancelDrag = useCallback(() => {
    const activeTargetObject = targetObjectRef.current;
    cancelQueuedTransformPreview();

    if (activeTargetObject) {
      activeTargetObject.position.copy(originalPositionRef.current);
      activeTargetObject.quaternion.copy(originalQuaternionRef.current);
      activeTargetObject.updateMatrixWorld(true);
      syncTranslateProxy(translateProxyRef.current, activeTargetObject);
    }
  }, [cancelQueuedTransformPreview, syncTranslateProxy]);

  const handleFinishDrag = useCallback(() => {
    const activeTargetObject = targetObjectRef.current;
    cancelQueuedTransformPreview();
    if (!activeTargetObject) {
      return;
    }

    if (hasTransformChanged(activeTargetObject)) {
      commitTransform();
    }

    syncTranslateProxy(translateProxyRef.current, activeTargetObject);
  }, [cancelQueuedTransformPreview, commitTransform, hasTransformChanged, syncTranslateProxy]);

  const handleBeginDrag = useCallback(() => {
    const activeTargetObject = targetObjectRef.current;
    if (!activeTargetObject) return false;

    let nextSelection = activeSelectionRef.current;
    if (selection?.id) {
      const resolvedSelectionId = resolveSelectionLinkId(selection.id);
      if (!resolvedSelectionId) return false;

      nextSelection = {
        id: resolvedSelectionId,
        objectIndex: selection.objectIndex,
      };
    }

    activeSelectionRef.current = nextSelection;

    originalPositionRef.current.copy(activeTargetObject.position);
    originalRotationRef.current.copy(activeTargetObject.rotation);
    originalQuaternionRef.current.copy(activeTargetObject.quaternion);
    return true;
  }, [resolveSelectionLinkId, selection?.id, selection?.objectIndex]);

  const {
    activeControlsRef,
    beginActiveDrag,
    cancelActiveDrag,
    controlMode,
    finishActiveDrag,
    handleDraggingChanged,
    handleObjectChange,
    isDraggingRef,
    shouldUseTranslateProxy,
  } = useCollisionTransformDragLifecycle({
    transformMode,
    transformRef,
    rotateTransformRef,
    invalidate,
    setIsDragging,
    onTransformPending,
    onBeginDrag: handleBeginDrag,
    onFinishDrag: handleFinishDrag,
    onCancelDrag: handleCancelDrag,
    onObjectChange: ({ isDragging, isTranslateDragging }) => {
      const activeTargetObject = targetObjectRef.current;
      if (shouldUseTranslateProxy && isTranslateDragging) {
        applyTranslateProxyToTarget();
      }

      if (activeTargetObject && isDragging) {
        queueTransformPreview(activeTargetObject);
      }
    },
  });

  useEffect(() => cancelQueuedTransformPreview, [cancelQueuedTransformPreview]);

  useEffect(() => {
    // While a drag is in flight, transform previews can churn the `selection`
    // object identity, re-running this effect. Recomputing/clearing the target
    // mid-drag would unmount the gizmo (thick handles vanish, only stock thin
    // lines remain). The drag lifecycle's useFrame owns finishing the drag, so
    // keep the resolved target stable until the drag ends.
    if (isDraggingRef.current) {
      return;
    }

    if (
      !robot ||
      !selection?.id ||
      selection.subType !== geometrySubType ||
      transformMode === 'select'
    ) {
      if (isDraggingRef.current) {
        cancelActiveDrag();
      }
      activeControlsRef.current = null;
      setTargetObject((current) => (current === null ? current : null));
      return;
    }

    const runtimeLinks = (robot as any).links as Record<string, THREE.Object3D> | undefined;
    let runtimeLinkKey = selection.id;

    if (!runtimeLinks?.[runtimeLinkKey]) {
      const resolvedLinkId = resolveLinkKey(robotLinks || {}, selection.id);
      const runtimeLinkName = resolvedLinkId ? robotLinks?.[resolvedLinkId]?.name : null;
      if (runtimeLinkName && runtimeLinks?.[runtimeLinkName]) {
        runtimeLinkKey = runtimeLinkName;
      }
    }

    const linkObj = runtimeLinks?.[runtimeLinkKey];
    if (!linkObj) {
      if (isDraggingRef.current) {
        cancelActiveDrag();
      }
      setTargetObject((current) => (current === null ? current : null));
      return;
    }

    const geometryObjects: THREE.Object3D[] = [];
    linkObj.traverse((child: any) => {
      const matchesGeometry = geometrySubType === 'collision' ? child.isURDFCollider : child.isURDFVisual;
      if (matchesGeometry && child.parent === linkObj) {
        geometryObjects.push(child);
      }
    });

    if (geometryObjects.length === 0) {
      linkObj.traverse((child: any) => {
        const matchesGeometry = geometrySubType === 'collision' ? child.isURDFCollider : child.isURDFVisual;
        if (matchesGeometry) {
          geometryObjects.push(child);
        }
      });
    }

    const geometryObject = geometryObjects[selection.objectIndex ?? 0] || geometryObjects[0] || null;
    if (!geometryObject) {
      if (isDraggingRef.current) {
        cancelActiveDrag();
      }
      setTargetObject((current) => (current === null ? current : null));
      return;
    }

    const isSameTarget = targetObjectRef.current === geometryObject;
    const resolvedSelectionId = resolveSelectionLinkId(selection.id) ?? selection.id;
    reconcileCommittedTransform(geometryObject, resolvedSelectionId, selection.objectIndex ?? 0);

    if (isDraggingRef.current && targetObjectRef.current && !isSameTarget) {
      cancelActiveDrag();
    }

    setTargetObject((current) => (current === geometryObject ? current : geometryObject));

    if (!isDraggingRef.current) {
      activeControlsRef.current = null;
      originalPositionRef.current.copy(geometryObject.position);
      originalRotationRef.current.copy(geometryObject.rotation);
      originalQuaternionRef.current.copy(geometryObject.quaternion);
    }
  }, [
    cancelActiveDrag,
    geometrySubType,
    reconcileCommittedTransform,
    resolveSelectionLinkId,
    robot,
    robotLinks,
    robotVersion,
    selection,
    transformMode,
  ]);

  useEffect(() => {
    if (!isDraggingRef.current) {
      syncTranslateProxy(translateProxyRef.current, targetObject);
    }
  }, [syncTranslateProxy, targetObject]);

  useFrame(() => {
    const draggingControls = resolveCurrentCollisionDraggingControls(
      transformRef.current,
      rotateTransformRef.current,
    );

    if (draggingControls) {
      beginActiveDrag(draggingControls);
      invalidate();
      return;
    }

    if (isDraggingRef.current) {
      finishActiveDrag();
    }
  }, 1000);

  if (!targetObject || transformMode === 'select') {
    return null;
  }

  // Keep <UnifiedTransformControls> mounted unconditionally. Gating it on the
  // translate proxy being ready caused an unmount/remount cycle on first
  // render (proxy ref callback -> setState -> re-render): the freshly created
  // Drei gizmo had not yet been patched, so the thick handles vanished for a
  // frame leaving only the stock thin axis lines. UnifiedTransformControls
  // already falls back to `object` when `translateObject` is undefined
  // (resolvedTranslateObject = translateObject ?? object), so attaching to the
  // real target until the proxy mounts is safe and flicker-free.
  return (
    <>
      {shouldUseTranslateProxy && <group ref={handleTranslateProxyRef} visible={false} />}

      <UnifiedTransformControls
        ref={transformRef}
        rotateRef={rotateTransformRef}
        object={targetObject}
        translateObject={shouldUseTranslateProxy ? (translateProxy ?? undefined) : undefined}
        mode={controlMode}
        size={COLLISION_TRANSLATE_GIZMO_SIZE}
        rotateSize={COLLISION_ROTATE_GIZMO_SIZE}
        translateSpace="local"
        rotateSpace="local"
        hoverStyle="single-axis"
        displayStyle="thick-primary"
        displayThicknessScale={COLLISION_GIZMO_THICKNESS_SCALE}
        onObjectChange={handleObjectChange}
        onDraggingChanged={handleDraggingChanged}
      />
    </>
  );
};
