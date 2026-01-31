import React, { memo, useRef, useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { CollisionTransformControls } from './CollisionTransformControls';
import { translations } from '@/shared/i18n';
import type { RobotModelProps } from '../types';

// Import hooks
import {
    useRobotLoader,
    useHighlightManager,
    useCameraFocus,
    useMouseInteraction,
    useHoverDetection,
    useVisualizationEffects
} from '../hooks';

// Wrap with memo and custom comparison to prevent unnecessary re-renders
export const RobotModel: React.FC<RobotModelProps> = memo(({
    urdfContent,
    assets,
    onRobotLoaded,
    showCollision = false,
    showVisual = true,
    onSelect,
    onJointChange,
    onJointChangeCommit,
    jointAngles,
    setIsDragging,
    setActiveJoint,
    justSelectedRef,
    t,
    mode,
    selection,
    hoveredSelection,
    highlightMode = 'link',
    showInertia = false,
    showCenterOfMass = false,
    showCoMOverlay = true,
    centerOfMassSize = 0.01,
    showOrigins = false,
    showOriginsOverlay = true,
    originSize = 1.0,
    showJointAxes = false,
    showJointAxesOverlay = true,
    jointAxisSize = 1.0,
    modelOpacity = 1.0,
    robotLinks,
    focusTarget,
    transformMode = 'select',
    toolMode = 'select',
    onCollisionTransformEnd,
    isOrbitDragging
}) => {
    const { invalidate } = useThree();

    // Keep ref for setIsDragging to avoid stale closures
    const setIsDraggingRef = useRef(setIsDragging);
    useEffect(() => {
        setIsDraggingRef.current = setIsDragging;
    }, [setIsDragging]);

    // ============================================================
    // HOOK: Robot Loading
    // ============================================================
    const {
        robot,
        error,
        robotVersion,
        linkMeshMapRef
    } = useRobotLoader({
        urdfContent,
        assets,
        showCollision,
        showVisual,
        onRobotLoaded
    });

    // ============================================================
    // HOOK: Highlight Manager
    // ============================================================
    const {
        highlightGeometry,
        rayIntersectsBoundingBox,
        highlightedMeshesRef
    } = useHighlightManager({
        robot,
        robotVersion,
        highlightMode,
        showCollision,
        showVisual,
        linkMeshMapRef
    });

    // ============================================================
    // HOOK: Camera Focus
    // ============================================================
    useCameraFocus({
        robot,
        focusTarget,
        mode
    });

    // ============================================================
    // HOOK: Mouse Interaction
    // ============================================================
    const {
        mouseRef,
        raycasterRef,
        hoveredLinkRef,
        isDraggingJoint,
        needsRaycastRef
    } = useMouseInteraction({
        robot,
        toolMode,
        mode,
        highlightMode,
        showCollision,
        showVisual,
        onSelect,
        onJointChange,
        onJointChangeCommit,
        setIsDragging,
        setActiveJoint,
        justSelectedRef,
        isOrbitDragging,
        highlightGeometry
    });

    // ============================================================
    // HOOK: Hover Detection
    // ============================================================
    useHoverDetection({
        robot,
        toolMode,
        mode,
        highlightMode,
        showCollision,
        showVisual,
        selection,
        mouseRef,
        raycasterRef,
        hoveredLinkRef,
        isDraggingJoint,
        needsRaycastRef,
        isOrbitDragging,
        justSelectedRef,
        rayIntersectsBoundingBox,
        highlightGeometry
    });

    // ============================================================
    // HOOK: Visualization Effects
    // ============================================================
    useVisualizationEffects({
        robot,
        robotVersion,
        showCollision,
        showVisual,
        highlightMode,
        showInertia,
        showCenterOfMass,
        showCoMOverlay,
        centerOfMassSize,
        showOrigins,
        showOriginsOverlay,
        originSize,
        showJointAxes,
        showJointAxesOverlay,
        jointAxisSize,
        modelOpacity,
        robotLinks,
        toolMode,
        selection,
        hoveredSelection,
        highlightGeometry,
        highlightedMeshesRef
    });

    // ============================================================
    // Apply joint angles when jointAngles prop changes
    // ============================================================
    useEffect(() => {
        if (!robot || !jointAngles) return;

        const joints = (robot as any).joints;
        if (!joints) return;

        Object.entries(jointAngles).forEach(([jointName, angle]) => {
            const joint = joints[jointName];
            if (joint && typeof joint.setJointValue === 'function') {
                joint.setJointValue(angle);
            }
        });

        invalidate();
    }, [robot, jointAngles, invalidate]);

    // ============================================================
    // RENDER
    // ============================================================
    if (error) {
        return (
            <Html center>
                <div className="bg-red-900/80 text-red-200 px-4 py-2 rounded text-sm">
                    Error: {error}
                </div>
            </Html>
        );
    }

    if (!robot) {
        return (
            <Html center>
                <div className="text-slate-500 dark:text-slate-400 text-sm">{t.loadingRobot}</div>
            </Html>
        );
    }

    return (
        <>
            <primitive object={robot} />
            {(() => {
                const shouldShow = mode === 'detail' && highlightMode === 'collision' && transformMode !== 'select' && selection?.subType === 'collision';
                return shouldShow ? (
                    <CollisionTransformControls
                        robot={robot}
                        selection={selection}
                        transformMode={transformMode}
                        setIsDragging={(dragging) => setIsDraggingRef.current?.(dragging)}
                        onTransformEnd={onCollisionTransformEnd}
                        robotLinks={robotLinks}
                        lang={t === translations['zh'] ? 'zh' : 'en'}
                    />
                ) : null;
            })()}
        </>
    );
});
