import React, { memo, useRef, useState, useMemo, useEffect, useCallback } from 'react';
import { useThree } from '@react-three/fiber';
import { type Group } from 'three';
import {
  LinkIkTransformControls,
  SceneCompileWarmup,
} from '@/shared/components/3d';
import { requestShadowMapRefresh } from '@/shared/components/3d/scene/shadowMapRefresh';
import { VIEWER_RENDER_QUALITY_PROFILES } from '@/shared/utils/viewerRenderQuality';
import {
  isWorkspaceSelectionEditorLocked,
  resolveDirectManipulableLinkIkJointIds,
  resolveLinkKey,
  updateVisualGeometryByObjectIndex,
} from '@/core/robot';
import { cloneAssemblyTransform } from '@/core/robot/assemblyTransformUtils';
import { GeometryTransformControls } from './CollisionTransformControls';
import { JointInteraction } from './JointInteraction';
import { OriginTransformControls } from './OriginTransformControls';
import { AssemblyTransformControls } from './AssemblyTransformControls';
import { RobotModelLoadingHud } from './RobotModelLoadingHud';
import type { RobotModelProps } from '../types';
import { useSnapshotRenderActive } from '@/shared/components/3d/scene/SnapshotRenderContext';
import { useSelectionStore, useUIStore } from '@/store';
import type { HoverFreezeOwner } from '@/store/selectionStore';
import type { RobotData, RobotFile } from '@/types';

import { useRendererBackend } from '../hooks/useRendererBackend';
import { useHighlightManager } from '../hooks/useHighlightManager';
import { useCameraFocus } from '../hooks/useCameraFocus';
import { useMouseInteraction } from '../hooks/useMouseInteraction';
import { useHoverDetection } from '../hooks/useHoverDetection';
import { useVisualizationEffects } from '../hooks/useVisualizationEffects';
import { useAssemblyComponentAutoGrounding } from '../hooks/useAssemblyComponentAutoGrounding';
import { useRobotModelIkState } from '../hooks/useRobotModelIkState';
import { useRobotModelPaintInteraction } from '../hooks/useRobotModelPaintInteraction';
import { useExternalHoverHighlightSync } from '../hooks/useExternalHoverHighlightSync';
import { useRobotModelRuntimeRegistration } from '../hooks/useRobotModelRuntimeRegistration';
import { resolveCameraAutoFrameLoadScopeKey } from '../utils/cameraAutoFrame';
import {
  createRuntimeSceneLinkMetadataState,
  resolveRuntimeSceneLinkMetadataState,
} from '../utils/runtimeSceneMetadata';
import { resolveViewerRobotSourceFormat } from '@/features/urdf-viewer/renderers/sourceFormat';
import { shouldEnableViewerSceneCompileWarmup } from '../utils/sceneCompileWarmupPolicy';
import { isWorkspaceTransformSelection } from '../utils/workspaceSceneProjection';
import { canTransformGeometry } from '../utils/geometryTransformPolicy';
import { isRegressionDebugEnabled } from '@/shared/debug/regressionDebugEnabled';

const EMPTY_ROBOT_FILES: RobotFile[] = [];

// Wrap with memo and custom comparison to prevent unnecessary re-renders
export const RobotModel: React.FC<RobotModelProps> = memo(
  ({
    urdfContent,
    assets,
    sourceFile,
    availableFiles = EMPTY_ROBOT_FILES,
    sourceFormat = 'auto',
    allowUrdfXmlFallback = false,
    reloadToken = 0,
    initialRobot = null,
    sourceFilePath,
    onRobotLoaded,
    onDocumentLoadEvent,
    runtimeBridge,
    showCollision = false,
    showVisual = true,
    showIkHandles = false,
    showIkHandlesAlwaysOnTop = true,
    showCollisionAlwaysOnTop = true,
    onSelect,
    onHover,
    onMeshSelect,
    onUpdate,
    paintColor = '#ff6c0a',
    paintSelectionScope = 'island',
    paintOperation = 'paint',
    paintInteractionRef,
    onPaintStatusChange,
    onJointChange,
    onJointChangeCommit,
    onJointMotionCommit,
    initialJointAngles,
    registerSceneRefresh,
    setIsDragging,
    onIkPreviewKinematicOverrides,
    onIkCommitKinematicOverrides,
    onClearIkPreviewKinematicOverrides,
    setActiveJoint,
    justSelectedRef,
    t,
    mode,
    selection,
    interactionEnabled = true,
    hoverSelectionEnabled = true,
    showInertia = false,
    showInertiaOverlay = true,
    showCenterOfMass = false,
    showCoMOverlay = true,
    centerOfMassSize = 0.01,
    showOrigins = false,
    showOriginsOverlay = false,
    originSize = 1.0,
    showMjcfSites = false,
    showJointAxes = false,
    showJointAxesOverlay = true,
    jointAxisSize = 1.0,
    modelOpacity = 1.0,
    ikRobotState: providedIkRobotState = null,
    robotLinks,
    robotJoints,
    robotData,
    focusTarget,
    transformMode = 'select',
    toolMode = 'select',
    measureMode,
    ikDragActive = false,
    onCollisionTransformPreview,
    onCollisionTransformEnd,
    isOrbitDragging,
    onTransformPending,
    isSelectionLockedRef,
    isMeshPreview = false,
    hoveredSelection,
    interactionLayerPriority = [],
    groundPlaneOffset = 0,
    active = true,
    workspace = null,
    sceneProjection = null,
    scenePlacement = null,
    workspaceSelection = null,
    onAssemblyTransform,
    onComponentTransform,
    onBridgeTransform,
    pendingAutoGroundComponentIds,
    onAssemblyComponentAutoGroundResolved,
  }) => {
    const { gl, invalidate } = useThree();
    const snapshotRenderActive = useSnapshotRenderActive();
    const showMjcfWorldLink = useUIStore((state) => state.viewOptions.showMjcfWorldLink);
    const cameraProjection = useUIStore((state) => state.viewOptions.cameraProjection);
    const renderQuality = useUIStore((state) => state.viewOptions.renderQuality);
    const renderQualityProfile = VIEWER_RENDER_QUALITY_PROFILES[renderQuality];
    const setHoverFrozen = useSelectionStore((state) => state.setHoverFrozen);
    const hoverFreezeOwner = useRef<HoverFreezeOwner>(Symbol('robot-model')).current;
    const setOwnedHoverFrozen = useCallback(
      (frozen: boolean) => setHoverFrozen(hoverFreezeOwner, frozen),
      [hoverFreezeOwner, setHoverFrozen],
    );
    useEffect(() => {
      if (!interactionEnabled) {
        setOwnedHoverFrozen(false);
      }
      return () => setOwnedHoverFrozen(false);
    }, [interactionEnabled, setOwnedHoverFrozen]);
    const autoFrameScopeFallbackRef = useRef<string | null>(null);
    const [assemblyRoot, setAssemblyRoot] = useState<Group | null>(null);
    const [directComponentRoot, setDirectComponentRoot] = useState<Group | null>(null);
    const resolvedSourceFormat = useMemo(
      () => resolveViewerRobotSourceFormat(urdfContent, sourceFormat),
      [sourceFormat, urdfContent],
    );
    const sourceFileForBackend = useMemo<RobotFile>(() => {
      if (sourceFile) {
        return sourceFile;
      }

      const fallbackFormat: RobotFile['format'] =
        sourceFormat === 'mjcf'
          ? 'mjcf'
          : sourceFormat === 'sdf'
            ? 'sdf'
            : sourceFormat === 'xacro'
              ? 'xacro'
              : resolvedSourceFormat;

      return {
        name: sourceFilePath ?? `inline.${fallbackFormat}`,
        content: urdfContent,
        format: fallbackFormat,
      };
    }, [resolvedSourceFormat, sourceFile, sourceFilePath, sourceFormat, urdfContent]);
    const regressionRuntimeScopeKey =
      isRegressionDebugEnabled() && !isMeshPreview
        ? `${sourceFileForBackend.format}:${sourceFileForBackend.name}`
        : null;
    const runtimeSceneMetadataScopeKey = `${sourceFilePath ?? 'viewer-inline'}:${reloadToken}`;
    const runtimeSceneLinkMetadataRef = useRef(
      createRuntimeSceneLinkMetadataState({
        scopeKey: runtimeSceneMetadataScopeKey,
        robot: null,
        robotVersion: 0,
        robotLinks,
      }),
    );

    if (!autoFrameScopeFallbackRef.current) {
      autoFrameScopeFallbackRef.current = `viewer-session:${Math.random().toString(36).slice(2)}`;
    }
    const autoFrameLoadScopeKey = resolveCameraAutoFrameLoadScopeKey({
      sourceFilePath,
      reloadToken,
      fallbackScopeKey: autoFrameScopeFallbackRef.current,
    });
    // Include the camera projection so switching perspective <-> orthographic
    // (which remounts the canvas and resets the camera) re-triggers auto-framing.
    // Without this, the scope key is unchanged and the post-switch perspective
    // view stays at the default (far) camera position, leaving the robot tiny.
    const autoFrameScopeKey = `${autoFrameLoadScopeKey}:proj:${cameraProjection}`;

    // Keep ref for setIsDragging to avoid stale closures
    const setIsDraggingRef = useRef(setIsDragging);
    useEffect(() => {
      setIsDraggingRef.current = setIsDragging;
    }, [setIsDragging]);
    const backendRobotData = useMemo<RobotData | null>(() => {
      const backendLinks = robotData?.links ?? robotLinks;
      const backendJoints = robotData?.joints ?? robotJoints;

      if (!backendLinks || !backendJoints) {
        return null;
      }

      const childLinkIds = new Set(Object.values(backendJoints).map((joint) => joint.childLinkId));
      const computedRootLinkId =
        robotData?.rootLinkId ||
        Object.keys(backendLinks).find((linkId) => !childLinkIds.has(linkId)) ||
        Object.keys(backendLinks)[0] ||
        '';

      return {
        name: robotData?.name || sourceFileForBackend.name,
        links: backendLinks,
        joints: backendJoints,
        rootLinkId: computedRootLinkId,
        materials: robotData?.materials,
        closedLoopConstraints: robotData?.closedLoopConstraints,
        inspectionContext: robotData?.inspectionContext,
      };
    }, [robotData, robotJoints, robotLinks, sourceFileForBackend.name]);
    // ============================================================
    // HOOK: Robot Loading
    // ============================================================
    const {
      robot,
      isLoading,
      loadingProgress,
      robotVersion,
      linkMeshMapRef,
      robotLinks: loadedRobotLinks,
      robotJoints: loadedRobotJoints,
      rootLinkId: loadedRootLinkId,
    } = useRendererBackend({
      sourceFile: sourceFileForBackend,
      availableFiles,
      assets,
      reloadToken,
      initialRobot,
      showCollision,
      showVisual,
      showCollisionAlwaysOnTop,
      allowUrdfXmlFallback,
      robotLinks,
      robotJoints,
      robotData: backendRobotData,
      primitiveGeometryDetail: renderQualityProfile.primitiveGeometryDetail,
      textureAnisotropy: renderQualityProfile.textureAnisotropy,
      materialDithering: renderQualityProfile.materialDithering,
      initialJointAngles,
      onRobotLoaded,
      onDocumentLoadEvent,
      runtimeBridge,
      groundPlaneOffset,
    });
    const hasRenderedRobotRef = useRobotModelRuntimeRegistration({
      initialRobotPresent: Boolean(initialRobot),
      regressionRuntimeScopeKey,
      robot,
      isLoading,
      onDocumentLoadEvent,
    });
    const effectiveRobotLinks = useMemo(
      () => (Object.keys(loadedRobotLinks).length > 0 ? loadedRobotLinks : robotLinks),
      [loadedRobotLinks, robotLinks],
    );
    const effectiveRobotJoints = useMemo(
      () => (Object.keys(loadedRobotJoints).length > 0 ? loadedRobotJoints : robotJoints),
      [loadedRobotJoints, robotJoints],
    );

    // Keep scene metadata pinned to the currently mounted runtime robot while a
    // different source file is still streaming in. This prevents the old scene
    // from briefly inheriting the next file's visibility rules and helper state.
    runtimeSceneLinkMetadataRef.current = resolveRuntimeSceneLinkMetadataState(
      runtimeSceneLinkMetadataRef.current,
      {
        scopeKey: runtimeSceneMetadataScopeKey,
        robot,
        robotVersion,
        robotLinks: effectiveRobotLinks,
      },
    );
    const runtimeRobotLinks = runtimeSceneLinkMetadataRef.current.robotLinks;
    const runtimeRobotRootLinkId = useMemo(() => {
      if (loadedRootLinkId) {
        return loadedRootLinkId;
      }
      const links = runtimeRobotLinks ?? {};
      const joints = effectiveRobotJoints ?? {};
      const linkIds = Object.keys(links);

      if (linkIds.length === 0) {
        return null;
      }

      const childLinkIds = new Set(Object.values(joints).map((joint) => joint.childLinkId));
      return linkIds.find((linkId) => !childLinkIds.has(linkId)) ?? linkIds[0] ?? null;
    }, [effectiveRobotJoints, loadedRootLinkId, runtimeRobotLinks]);
    const {
      commitIkKinematicOverrides,
      createIkHistorySnapshot,
      ikRobotState,
      selectedIkAnchorLocal,
      selectedIkHandle,
      selectedIkHandleLinkId,
      selectedIkJointIds,
      selectedIkRuntimeLink,
      selectedJointEntry,
      selectedJointValue,
    } = useRobotModelIkState({
      robot,
      robotVersion,
      selection,
      ikDragActive,
      robotLinks: runtimeRobotLinks,
      robotJoints: effectiveRobotJoints,
      rootLinkId: runtimeRobotRootLinkId,
      providedIkRobotState,
      backendRobotData,
      onIkCommitKinematicOverrides,
      onJointMotionCommit,
    });
    const workspaceTransformSelectionArmed = isWorkspaceTransformSelection(workspaceSelection);
    const workspaceSelectionEditorLocked = useMemo(
      () => Boolean(
        workspace
        && isWorkspaceSelectionEditorLocked(workspace, workspaceSelection),
      ),
      [workspace, workspaceSelection],
    );
    // ============================================================
    // HOOK: Highlight Manager
    // ============================================================
    const {
      highlightGeometry,
      rayIntersectsBoundingBox,
      highlightedMeshesRef,
      boundingBoxNeedsUpdateRef,
    } = useHighlightManager({
      robot,
      robotVersion,
      showCollision,
      showVisual,
      showCollisionAlwaysOnTop,
      robotLinks: runtimeRobotLinks,
      linkMeshMapRef,
    });

    // ============================================================
    // HOOK: Camera Focus
    // ============================================================
    useCameraFocus({
      robot,
      focusTarget,
      selection,
      mode,
      autoFrameOnRobotChange: active && !isLoading,
      autoFrameScopeKey,
      active,
    });

    const handlePaintFace = useRobotModelPaintInteraction({
      isMeshPreview,
      robotMaterials: backendRobotData?.materials,
      robotLinks: effectiveRobotLinks,
      paintColor,
      paintSelectionScope,
      paintOperation,
      paintInteractionRef,
      onPaintStatusChange,
      onUpdate,
      t,
    });

    // ============================================================
    // HOOK: Mouse Interaction
    // ============================================================
    const { mouseRef, raycasterRef, hoveredLinkRef, isDraggingJoint, needsRaycastRef } =
      useMouseInteraction({
        enabled: interactionEnabled,
        robot,
        robotVersion,
        toolMode,
        measureMode,
        mode,
        showCollision,
        showVisual,
        showCollisionAlwaysOnTop,
        interactionLayerPriority,
        linkMeshMapRef,
        robotLinks: runtimeRobotLinks,
        robotJoints: effectiveRobotJoints,
        onHover,
        onSelect,
        onMeshSelect,
        onPaintFace: handlePaintFace,
        onJointChange,
        onJointChangeCommit,
        throttleJointChangeDuringDrag: true,
        deferDirectJointRuntimeUpdate: Boolean(ikRobotState?.closedLoopConstraints?.length),
        setIsDragging,
        setHoverFrozen: interactionEnabled ? setOwnedHoverFrozen : undefined,
        setActiveJoint,
        justSelectedRef,
        isOrbitDragging,
        isSelectionLockedRef,
        selection,
        rayIntersectsBoundingBox,
        highlightGeometry,
        resolveDirectIkHandleLink:
          ikDragActive && runtimeRobotRootLinkId && runtimeRobotLinks && effectiveRobotJoints
            ? (linkId) =>
                resolveDirectManipulableLinkIkJointIds(
                  {
                    links: runtimeRobotLinks,
                    joints: effectiveRobotJoints,
                    rootLinkId: runtimeRobotRootLinkId,
                  },
                  linkId,
                )?.length
                  ? linkId
                  : null
            : undefined,
      });

    const handleCollisionTransformDragging = useCallback(
      (dragging: boolean) => {
        if (dragging) {
          // Arm the selection-miss guard during collision transform drags so
          // that R3F's onPointerMissed does not clear the selection while the
          // user is actively dragging the gizmo.
          if (justSelectedRef) {
            justSelectedRef.current = true;
          }
        }
        setIsDraggingRef.current?.(dragging);
        if (!dragging) {
          needsRaycastRef.current = true;
          invalidate();
        }
      },
      [invalidate, needsRaycastRef, justSelectedRef],
    );

    const handleVisualTransformEnd = useCallback(
      (
        linkId: string,
        position: { x: number; y: number; z: number },
        rotation: { r: number; p: number; y: number },
        objectIndex = 0,
      ) => {
        const links = effectiveRobotLinks ?? {};
        const resolvedLinkId = resolveLinkKey(links, linkId) ?? linkId;
        const link = links[resolvedLinkId];
        if (!link || !onUpdate) {
          return;
        }

        onUpdate(
          'link',
          link.id,
          updateVisualGeometryByObjectIndex(link, objectIndex, {
            origin: { xyz: position, rpy: rotation },
          }),
        );
      },
      [effectiveRobotLinks, onUpdate],
    );

    // ============================================================
    // HOOK: Hover Detection
    // ============================================================
    useHoverDetection({
      robot,
      robotVersion,
      toolMode,
      hoverSelectionEnabled,
      mode,
      showCollision,
      showVisual,
      showCollisionAlwaysOnTop,
      interactionLayerPriority,
      selection,
      onHover,
      linkMeshMapRef,
      robotLinks: runtimeRobotLinks,
      robotJoints: effectiveRobotJoints,
      mouseRef,
      raycasterRef,
      hoveredLinkRef,
      isDraggingJoint,
      needsRaycastRef,
      isOrbitDragging,
      justSelectedRef,
      isSelectionLockedRef,
      rayIntersectsBoundingBox,
      highlightGeometry,
    });

    // ============================================================
    // HOOK: Visualization Effects
    // ============================================================
    const { syncHoverHighlight } = useVisualizationEffects({
      robot,
      robotVersion,
      showCollision,
      showVisual,
      showCollisionAlwaysOnTop,
      showInertia,
      showInertiaOverlay,
      showIkHandles,
      showIkHandlesAlwaysOnTop,
      ikDragActive,
      showCenterOfMass,
      showCoMOverlay,
      centerOfMassSize,
      showOrigins,
      showOriginsOverlay,
      originSize,
      showMjcfSites,
      showJointAxes,
      showJointAxesOverlay,
      jointAxisSize,
      modelOpacity,
      robotLinks: runtimeRobotLinks,
      robotMaterials: backendRobotData?.materials,
      robotJoints: effectiveRobotJoints,
      selection,
      highlightGeometry,
      highlightedMeshesRef,
      linkMeshMapRef,
      sourceFormat: resolvedSourceFormat,
      showMjcfWorldLink,
    });
    useExternalHoverHighlightSync({
      hoveredSelection,
      hoverSelectionEnabled,
      syncHoverHighlight,
    });

    // Default to a dirty-only matrixWorld walk (force=false). All upstream
    // mutation paths (setJointValue, transform writes) already flag the dirty
    // chain, so the non-forced walk only touches changed subtrees instead of
    // the entire merged scene graph. In multi-component assemblies the old
    // force=true path was an every-frame O(N×L) sweep that dominated drag
    // latency; force=false reduces it to O(touched joints). needsRaycastRef
    // and boundingBoxNeedsUpdateRef defer the authoritative recompute to the
    // next consumer that actually needs world coords, and R3F's render still
    // calls updateMatrixWorld() before drawing, so visuals stay current.
    // Callers that *must* see fully-resolved world matrices synchronously
    // (one-shot transform commits, load handoffs) can pass {force: true}.
    const requestSceneRefresh = useCallback(
      (options?: { force?: boolean }) => {
        if (!robot) {
          return;
        }

        robot.updateMatrixWorld(options?.force ?? false);
        boundingBoxNeedsUpdateRef.current = true;
        needsRaycastRef.current = true;
        requestShadowMapRefresh(gl);
        invalidate();
      },
      [boundingBoxNeedsUpdateRef, gl, invalidate, needsRaycastRef, robot],
    );

    useAssemblyComponentAutoGrounding({
      groundPlaneOffset,
      onResolved: onAssemblyComponentAutoGroundResolved,
      pendingComponentIds: pendingAutoGroundComponentIds,
      requestSceneRefresh,
      runtimeRobot: robot,
      scenePlacement,
      workspace,
    });

    useEffect(() => {
      registerSceneRefresh?.(requestSceneRefresh);
      return () => {
        registerSceneRefresh?.(null);
      };
    }, [registerSceneRefresh, requestSceneRefresh]);

    // ============================================================
    // RENDER
    // ============================================================
    const sceneCompileWarmupKey = [
      sourceFilePath ?? 'viewer-inline',
      String(robotVersion),
      showVisual ? 'visual-on' : 'visual-off',
      showCollision ? 'collision-on' : 'collision-off',
    ].join('|');
    const sceneCompileWarmupEnabled = shouldEnableViewerSceneCompileWarmup(resolvedSourceFormat);
    const assemblyTransform = cloneAssemblyTransform(scenePlacement?.assemblyTransform);
    const directComponentTransform = cloneAssemblyTransform(
      scenePlacement?.directComponentTransform,
    );
    const shouldShowLoadingHud = isLoading && !robot && !hasRenderedRobotRef.current;
    const transformGeometrySubType = canTransformGeometry(selection?.subType, {
      showVisual,
      showCollision,
    })
      ? selection?.subType ?? null
      : null;
    const handleAssemblyRootRef = useCallback((node: Group | null) => {
      setAssemblyRoot((current) => (current === node ? current : node));
    }, []);
    const handleDirectComponentRootRef = useCallback((node: Group | null) => {
      setDirectComponentRoot((current) => (current === node ? current : node));
    }, []);

    return (
      <>
        <SceneCompileWarmup
          active={sceneCompileWarmupEnabled && active && Boolean(robot) && !isLoading}
          warmupKey={sceneCompileWarmupKey}
        />
        <group
          ref={handleAssemblyRootRef}
          position={[
            assemblyTransform.position.x,
            assemblyTransform.position.y,
            assemblyTransform.position.z,
          ]}
          rotation={[
            assemblyTransform.rotation.r,
            assemblyTransform.rotation.p,
            assemblyTransform.rotation.y,
            'ZYX',
          ]}
        >
          <group
            ref={handleDirectComponentRootRef}
            position={[
              directComponentTransform.position.x,
              directComponentTransform.position.y,
              directComponentTransform.position.z,
            ]}
            rotation={[
              directComponentTransform.rotation.r,
              directComponentTransform.rotation.p,
              directComponentTransform.rotation.y,
              'ZYX',
            ]}
          >
            {robot ? <primitive object={robot} /> : null}
          </group>
        </group>
        <RobotModelLoadingHud
          visible={shouldShowLoadingHud}
          loadingProgress={loadingProgress}
          t={t}
        />
        {!snapshotRenderActive
        && interactionEnabled
        && !workspaceSelectionEditorLocked
        && robot
        && toolMode !== 'measure' && (
          <LinkIkTransformControls
            selectedLinkId={selectedIkHandleLinkId}
            selectedHandle={selectedIkHandle}
            selectedLinkObject={selectedIkRuntimeLink}
            selectedAnchorLocal={selectedIkAnchorLocal ?? null}
            coordinateRoot={robot}
            ikRobotState={ikRobotState}
            enabled={
              active &&
              Boolean(selectedIkJointIds?.length) &&
              Boolean(selectedIkHandle || (selectedIkRuntimeLink && selectedIkAnchorLocal))
            }
            historyLabel="Move IK handle"
            setIsDragging={setIsDragging}
            createHistorySnapshot={createIkHistorySnapshot}
            onPreviewKinematicOverrides={(overrides) =>
              onIkPreviewKinematicOverrides?.(overrides.angles, overrides.quaternions)
            }
            onCommitKinematicOverrides={commitIkKinematicOverrides}
            onClearPreviewKinematicOverrides={onClearIkPreviewKinematicOverrides}
          />
        )}
        {!snapshotRenderActive &&
        active &&
        !workspaceSelectionEditorLocked &&
        selection?.helperKind === 'origin-axes' &&
        transformMode !== 'select' ? (
          <OriginTransformControls
            robot={robot}
            robotVersion={robotVersion}
            selection={selection}
            transformMode={transformMode}
            setIsDragging={handleCollisionTransformDragging}
            onTransformPending={onTransformPending}
            onUpdate={onUpdate}
            robotJoints={effectiveRobotJoints}
            closedLoopRobotState={ikRobotState}
          />
        ) : !snapshotRenderActive &&
          active &&
          !workspaceSelectionEditorLocked &&
          selectedJointEntry &&
          transformMode !== 'select' &&
          !workspaceTransformSelectionArmed ? (
          <JointInteraction
            joint={selectedJointEntry.joint}
            value={selectedJointValue}
            transformMode={transformMode}
            onChange={(nextValue) => onJointChange?.(selectedJointEntry.jointName, nextValue)}
            onCommit={(nextValue) => onJointChangeCommit?.(selectedJointEntry.jointName, nextValue)}
            setIsDragging={setIsDragging}
          />
        ) : null}
        {!snapshotRenderActive &&
        active &&
        !workspaceSelectionEditorLocked &&
        sceneProjection &&
        scenePlacement &&
        transformMode !== 'select' &&
        workspaceTransformSelectionArmed ? (
          <AssemblyTransformControls
            runtimeRobot={robot}
            sceneProjection={sceneProjection}
            scenePlacement={scenePlacement}
            workspaceSelection={workspaceSelection}
            transformMode={transformMode}
            assemblyRoot={assemblyRoot}
            directComponentRoot={directComponentRoot}
            onAssemblyTransform={onAssemblyTransform}
            onComponentTransform={onComponentTransform}
            onBridgeTransform={onBridgeTransform}
            onTransformPendingChange={onTransformPending}
          />
        ) : !snapshotRenderActive &&
          !workspaceSelectionEditorLocked &&
          transformMode !== 'select' &&
          transformGeometrySubType ? (
          <GeometryTransformControls
            robot={robot}
            robotVersion={robotVersion}
            selection={selection}
            geometrySubType={transformGeometrySubType}
            transformMode={transformMode}
            setIsDragging={handleCollisionTransformDragging}
            onTransformChange={
              transformGeometrySubType === 'collision' ? onCollisionTransformPreview : undefined
            }
            onTransformEnd={
              transformGeometrySubType === 'collision'
                ? onCollisionTransformEnd
                : handleVisualTransformEnd
            }
            robotLinks={runtimeRobotLinks}
            onTransformPending={onTransformPending}
          />
        ) : null}
      </>
    );
  },
);
