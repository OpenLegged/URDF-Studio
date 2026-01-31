import React, { Suspense, useState, useRef, useEffect, useCallback } from 'react';
import { Canvas, RootState } from '@react-three/fiber';
import { OrbitControls, Environment, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import { SnapshotManager, SceneLighting, ReferenceGrid } from '@/shared/components/3d';
import { translations } from '@/shared/i18n';

import type { URDFViewerProps, ToolMode, MeasureState } from '../types';
import { RobotModel } from './RobotModel';
import { JointInteraction } from './JointInteraction';
import { MeasureTool } from './MeasureTool';
import { ViewerToolbar } from './ViewerToolbar';
import { ViewerOptionsPanel } from './ViewerOptionsPanel';
import { MeasurePanel } from './MeasurePanel';
import { JointsPanel } from './JointsPanel';

import { useViewerSettings } from '../hooks/useViewerSettings';
import { usePanelDrag } from '../hooks/usePanelDrag';

export function URDFViewer({
    urdfContent,
    assets,
    onJointChange,
    jointAngleState,
    lang,
    mode = 'detail',
    onSelect,
    theme,
    selection,
    hoveredSelection,
    robotLinks,
    focusTarget,
    showVisual: propShowVisual,
    setShowVisual: propSetShowVisual,
    snapshotAction,
    onCollisionTransform,
    showToolbar = true,
    setShowToolbar,
    showOptionsPanel = true,
    setShowOptionsPanel,
    showJointPanel = true,
    setShowJointPanel,
    fileName
}: URDFViewerProps) {
    const t = translations[lang];

    const isOrbitDragging = useRef(false);
    const [robot, setRobot] = useState<any>(null);

    const {
        showCollision, setShowCollision,
        localShowVisual, setLocalShowVisual,
        showJointControls, setShowJointControls,
        showCenterOfMass, setShowCenterOfMass,
        showCoMOverlay, setShowCoMOverlay,
        centerOfMassSize, setCenterOfMassSize,
        showInertia, setShowInertia,
        showInertiaOverlay, setShowInertiaOverlay,
        showOrigins, setShowOrigins,
        showOriginsOverlay, setShowOriginsOverlay,
        originSize, setOriginSize,
        showJointAxes, setShowJointAxes,
        showJointAxesOverlay, setShowJointAxesOverlay,
        jointAxisSize, setJointAxisSize,
        modelOpacity, setModelOpacity,
        highlightMode, setHighlightMode,
        isOptionsCollapsed, toggleOptionsCollapsed,
        isJointsCollapsed, toggleJointsCollapsed
    } = useViewerSettings();

    const showVisual = propShowVisual !== undefined ? propShowVisual : localShowVisual;
    const setShowVisual = propSetShowVisual || setLocalShowVisual;

    const [toolMode, setToolMode] = useState<ToolMode>('select');

    // WebGL context lost state
    const [contextLost, setContextLost] = useState(false);
    const glRef = useRef<THREE.WebGLRenderer | null>(null);

    const [measureState, setMeasureState] = useState<MeasureState>({
        measurements: [],
        currentPoints: [],
        tempPoint: null
    });
    
    const containerRef = useRef<HTMLDivElement>(null);
    const optionsPanelRef = useRef<HTMLDivElement>(null);
    const jointPanelRef = useRef<HTMLDivElement>(null);
    const measurePanelRef = useRef<HTMLDivElement>(null);

    const {
        optionsPanelPos,
        jointPanelPos,
        measurePanelPos,
        dragging,
        handleMouseDown,
        handleMouseMove,
        handleMouseUp
    } = usePanelDrag(containerRef, optionsPanelRef, jointPanelRef, measurePanelRef);

    const transformMode = (['translate', 'rotate', 'universal'].includes(toolMode) ? toolMode : 'select') as 'select' | 'translate' | 'rotate' | 'universal';

    useEffect(() => {
        if (selection?.subType === 'collision') {
            setHighlightMode('collision');
        } else if (selection?.subType === 'visual') {
            setHighlightMode('link');
        }
    }, [selection?.subType]);


    const [jointAngles, setJointAngles] = useState<Record<string, number>>({});
    const [initialJointAngles, setInitialJointAngles] = useState<Record<string, number>>({});
    const [angleUnit, setAngleUnit] = useState<'rad' | 'deg'>('rad');
    const [activeJoint, setActiveJoint] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);

    const justSelectedRef = useRef(false);

    const handleRobotLoaded = useCallback((loadedRobot: any) => {
        setRobot(loadedRobot);

        if (loadedRobot.joints) {
            const angles: Record<string, number> = {};
            Object.keys(loadedRobot.joints).forEach(name => {
                angles[name] = loadedRobot.joints[name].angle || 0;
            });
            setJointAngles(angles);
            setInitialJointAngles(angles);
        }
    }, []);

    useEffect(() => {
        if (!robot || !jointAngleState) return;

        setJointAngles(prev => {
            const next = { ...prev, ...jointAngleState };
            return next;
        });

        Object.entries(jointAngleState).forEach(([name, angle]) => {
            const joint = robot.joints?.[name];
            if (joint?.setJointValue) {
                joint.setJointValue(angle);
            }
        });
    }, [robot, jointAngleState]);

    useEffect(() => {
        if (robot && robot.joints) {
            setJointAngles(prev => {
                const next = { ...prev };
                let changed = false;
                Object.keys(robot.joints).forEach(name => {
                    const newAngle = robot.joints[name].angle;
                    if (newAngle !== undefined && newAngle !== prev[name]) {
                        next[name] = newAngle;
                        changed = true;
                        if (robot.joints[name].setJointValue) {
                            robot.joints[name].setJointValue(newAngle);
                        }
                    }
                });
                return changed ? next : prev;
            });
        }
    }, [robot]);

    const handleJointAngleChange = useCallback((jointName: string, angle: number) => {
        if (!robot?.joints?.[jointName]) return;

        const joint = robot.joints[jointName];
        if (joint.setJointValue) {
            joint.setJointValue(angle);
        }

        setJointAngles(prev => ({ ...prev, [jointName]: angle }));
    }, [robot]);

    const handleJointChangeCommit = useCallback((jointName: string, angle: number) => {
        if (onJointChange) {
            onJointChange(jointName, angle);
        }
    }, [onJointChange]);

    const handleResetJoints = useCallback(() => {
        if (!robot || !robot.joints) return;

        Object.keys(jointAngles).forEach(name => {
            const initialAngle = initialJointAngles[name] || 0;
            handleJointAngleChange(name, initialAngle);
        });
    }, [robot, jointAngles, initialJointAngles, handleJointAngleChange]);

    const handleSelectWrapper = useCallback((type: 'link' | 'joint', id: string, subType?: 'visual' | 'collision') => {
        if (onSelect) onSelect(type, id, subType || selection?.subType);

        if (type === 'link' && robot) {
            const jointName = Object.keys(robot.joints).find(name => {
                const joint = robot.joints[name];
                return joint?.child?.name === id && joint?.jointType !== 'fixed';
            });
            if (jointName) {
                setActiveJoint(jointName);
            } else {
                setActiveJoint(null);
            }
        } else if (type === 'joint') {
            setActiveJoint(id);
        } else {
            setActiveJoint(null);
        }
    }, [onSelect, robot, selection?.subType]);

    // Handle WebGL context creation and context lost/restored events
    const handleCanvasCreated = useCallback((state: RootState) => {
        const gl = state.gl;
        const scene = state.scene;
        glRef.current = gl;
        const canvas = gl.domElement;

        // Expose scene to window for debugging
        if (typeof window !== 'undefined') {
            (window as any).scene = scene;
            (window as any).THREE = THREE;
            console.log('Three.js scene exposed to window.scene');
        }

        const handleContextLost = (event: Event) => {
            event.preventDefault();
            console.warn('WebGL context lost. Attempting to restore...');
            setContextLost(true);
        };

        const handleContextRestored = () => {
            setContextLost(false);
            state.invalidate();
        };

        canvas.addEventListener('webglcontextlost', handleContextLost, false);
        canvas.addEventListener('webglcontextrestored', handleContextRestored, false);

        // Store cleanup function
        (canvas as any).__contextCleanup = () => {
            canvas.removeEventListener('webglcontextlost', handleContextLost);
            canvas.removeEventListener('webglcontextrestored', handleContextRestored);
        };
    }, []);

    // Cleanup WebGL context event listeners on unmount
    useEffect(() => {
        return () => {
            if (glRef.current?.domElement) {
                const cleanup = (glRef.current.domElement as any).__contextCleanup;
                if (cleanup) cleanup();
            }
        };
    }, []);

    useEffect(() => {
        if (!robot) return;

        if (selection?.type === 'joint' && selection.id) {
            setActiveJoint(selection.id);
        } else if (selection?.type === 'link' && selection.id) {
            const jointName = Object.keys(robot.joints).find(name => {
                const joint = robot.joints[name];
                return joint?.child?.name === selection.id && joint?.jointType !== 'fixed';
            });
            if (jointName) {
                setActiveJoint(jointName);
            } else {
                setActiveJoint(null);
            }
        } else {
            setActiveJoint(null);
        }
    }, [selection, robot]);

    return (
        <div
            ref={containerRef}
            className="flex-1 relative bg-google-light-bg dark:bg-google-dark-bg h-full min-w-0 overflow-hidden"
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
        >
            {/* Info overlay */}
            <div className="absolute top-4 left-4 z-20 pointer-events-none select-none">
                <div className="text-slate-500 dark:text-slate-400 text-xs bg-white/50 dark:bg-google-dark-surface/50 backdrop-blur px-2 py-1 rounded border border-slate-200 dark:border-google-dark-border">
                    {mode === 'hardware' ? t.hardware : t.detail} {t.modeLabel}
                </div>
            </div>

            {/* Settings panel */}
            <ViewerOptionsPanel
                showOptionsPanel={showOptionsPanel}
                optionsPanelRef={optionsPanelRef}
                optionsPanelPos={optionsPanelPos}
                onMouseDown={(e) => handleMouseDown('options', e)}
                mode={mode}
                t={t}
                isOptionsCollapsed={isOptionsCollapsed}
                toggleOptionsCollapsed={toggleOptionsCollapsed}
                setShowOptionsPanel={setShowOptionsPanel}
                fileName={fileName}
                lang={lang}
                highlightMode={highlightMode}
                setHighlightMode={setHighlightMode}
                showJointControls={showJointControls}
                setShowJointControls={setShowJointControls}
                showVisual={showVisual}
                setShowVisual={setShowVisual}
                showCollision={showCollision}
                setShowCollision={setShowCollision}
                modelOpacity={modelOpacity}
                setModelOpacity={setModelOpacity}
                showOrigins={showOrigins}
                setShowOrigins={setShowOrigins}
                showOriginsOverlay={showOriginsOverlay}
                setShowOriginsOverlay={setShowOriginsOverlay}
                originSize={originSize}
                setOriginSize={setOriginSize}
                showJointAxes={showJointAxes}
                setShowJointAxes={setShowJointAxes}
                showJointAxesOverlay={showJointAxesOverlay}
                setShowJointAxesOverlay={setShowJointAxesOverlay}
                jointAxisSize={jointAxisSize}
                setJointAxisSize={setJointAxisSize}
                showCenterOfMass={showCenterOfMass}
                setShowCenterOfMass={setShowCenterOfMass}
                showCoMOverlay={showCoMOverlay}
                setShowCoMOverlay={setShowCoMOverlay}
                centerOfMassSize={centerOfMassSize}
                setCenterOfMassSize={setCenterOfMassSize}
                showInertia={showInertia}
                setShowInertia={setShowInertia}
                showInertiaOverlay={showInertiaOverlay}
                setShowInertiaOverlay={setShowInertiaOverlay}
            />

            {/* Joint controls panel */}
            <JointsPanel
                showJointControls={showJointControls}
                showJointPanel={showJointPanel}
                robot={robot}
                jointPanelRef={jointPanelRef}
                jointPanelPos={jointPanelPos}
                onMouseDown={(e) => handleMouseDown('joints', e)}
                t={t}
                handleResetJoints={handleResetJoints}
                angleUnit={angleUnit}
                setAngleUnit={setAngleUnit}
                isJointsCollapsed={isJointsCollapsed}
                toggleJointsCollapsed={toggleJointsCollapsed}
                setShowJointPanel={setShowJointPanel}
                jointAngles={jointAngles}
                activeJoint={activeJoint}
                setActiveJoint={setActiveJoint}
                handleJointAngleChange={handleJointAngleChange}
                handleJointChangeCommit={handleJointChangeCommit}
                onSelect={onSelect}
            />

            {/* Toolbar */}
            {showToolbar && (
                <ViewerToolbar
                    activeMode={toolMode}
                    setMode={setToolMode}
                    onClose={setShowToolbar ? () => setShowToolbar(false) : undefined}
                    lang={lang}
                />
            )}

            {/* Measure panel */}
            <MeasurePanel
                toolMode={toolMode}
                measurePanelRef={measurePanelRef}
                measurePanelPos={measurePanelPos}
                onMouseDown={(e) => handleMouseDown('measure', e)}
                measureState={measureState}
                setMeasureState={setMeasureState}
            />

            {/* Show overlay when WebGL context is lost */}
            {contextLost && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
                    <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-xl text-center">
                        <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4" />
                        <p className="text-gray-700 dark:text-gray-300">WebGL context lost, restoring...</p>
                    </div>
                </div>
            )}

            <Canvas
                camera={{ position: [2, 2, 2], up: [0, 0, 1], fov: 60 }}
                shadows
                frameloop="demand"
                gl={{
                    antialias: true,
                    toneMapping: THREE.ACESFilmicToneMapping,
                    toneMappingExposure: 1.1,
                    preserveDrawingBuffer: true,
                    powerPreference: 'high-performance',
                    failIfMajorPerformanceCaveat: false,
                }}
                onCreated={handleCanvasCreated}
                onPointerMissed={() => {
                    if (contextLost) return; // Don't handle events when context is lost
                    if (justSelectedRef.current) return;
                    if (onSelect) {
                        onSelect('link', '');
                    }
                    setActiveJoint(null);
                }}
            >
                <color attach="background" args={[theme === 'light' ? '#f8f9fa' : '#1f1f1f']} />
                <SceneLighting />
                <Environment files="/potsdamer_platz_1k.hdr" environmentIntensity={1.2} />
                <SnapshotManager actionRef={snapshotAction} robotName={robot?.name || 'robot'} />

                <MeasureTool
                    active={toolMode === 'measure'}
                    robot={robot}
                    measureState={measureState}
                    setMeasureState={setMeasureState}
                />

                <Suspense fallback={null}>
                    <RobotModel
                        urdfContent={urdfContent}
                        assets={assets}
                        onRobotLoaded={handleRobotLoaded}
                        showCollision={showCollision}
                        showVisual={showVisual}
                        onSelect={handleSelectWrapper}
                        onJointChange={handleJointAngleChange}
                        onJointChangeCommit={handleJointChangeCommit}
                        jointAngles={jointAngles}
                        setIsDragging={setIsDragging}
                        setActiveJoint={setActiveJoint}
                        justSelectedRef={justSelectedRef}
                        t={t}
                        mode={mode}
                        selection={selection}
                        hoveredSelection={hoveredSelection}
                        highlightMode={highlightMode}
                        showInertia={showInertia}
                        showInertiaOverlay={showInertiaOverlay}
                        showCenterOfMass={showCenterOfMass}
                        showCoMOverlay={showCoMOverlay}
                        centerOfMassSize={centerOfMassSize}
                        showOrigins={showOrigins}
                        showOriginsOverlay={showOriginsOverlay}
                        originSize={originSize}
                        showJointAxes={showJointAxes}
                        showJointAxesOverlay={showJointAxesOverlay}
                        jointAxisSize={jointAxisSize}
                        modelOpacity={modelOpacity}
                        robotLinks={robotLinks}
                        focusTarget={focusTarget}
                        transformMode={transformMode}
                        toolMode={toolMode}
                        onCollisionTransformEnd={onCollisionTransform}
                        isOrbitDragging={isOrbitDragging}
                    />
                </Suspense>

                {activeJoint && robot?.joints?.[activeJoint] && (
                    <JointInteraction
                        joint={robot.joints[activeJoint]}
                        value={jointAngles[activeJoint] || 0}
                        onChange={(val) => handleJointAngleChange(activeJoint, val)}
                        onCommit={(val) => handleJointChangeCommit(activeJoint, val)}
                    />
                )}

                {/* Contact shadows disabled - removed for cleaner appearance */}
                {/* <ContactShadows
                    opacity={0.6}
                    scale={10}
                    blur={2.5}
                    far={1}
                    resolution={512}
                    color="#000000"
                    position={[0, 0, 0]}
                    rotation={[Math.PI / 2, 0, 0]}
                /> */}

                <ReferenceGrid theme={theme} />

                <OrbitControls
                    makeDefault
                    enableDamping={false}
                    minDistance={0.5}
                    maxDistance={20}
                    enabled={!isDragging}
                    onStart={() => { isOrbitDragging.current = true; }}
                    onEnd={() => { isOrbitDragging.current = false; }}
                />

                <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
                    <GizmoViewport labelColor={theme === 'light' ? '#0f172a' : 'white'} axisHeadScale={1} />
                </GizmoHelper>

            </Canvas>
        </div>
    );
}

export { URDFViewer as default };
