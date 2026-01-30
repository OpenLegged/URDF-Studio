import React, { Suspense, useState, useRef, useEffect, useCallback } from 'react';
import { Canvas, RootState } from '@react-three/fiber';
import { OrbitControls, Environment, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import { RotateCcw, Move, ArrowUpRight, X, Ruler } from 'lucide-react';
import { CheckboxOption, SliderOption } from '@/shared/components/Panel/OptionsPanel';
import { SnapshotManager, SceneLighting, ReferenceGrid } from '@/shared/components/3d';
import { translations } from '@/shared/i18n';

import type { URDFViewerProps, ToolMode, MeasureState } from '../types';
import { RobotModel } from './RobotModel';
import { JointInteraction } from './JointInteraction';
import { MeasureTool } from './MeasureTool';
import { ViewerToolbar } from './ViewerToolbar';
import { JointControlItem } from './JointControlItem';

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

    const [showCollision, setShowCollision] = useState(false);

    const [localShowVisual, setLocalShowVisual] = useState(true);
    const showVisual = propShowVisual !== undefined ? propShowVisual : localShowVisual;
    const setShowVisual = propSetShowVisual || setLocalShowVisual;

    const [showJointControls, setShowJointControls] = useState(true);
    const [showCenterOfMass, setShowCenterOfMass] = useState(false);
    const [centerOfMassSize, setCenterOfMassSize] = useState(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('urdf_viewer_com_size');
            return saved ? Math.min(parseFloat(saved), 0.5) : 0.01;
        }
        return 0.01;
    });
    const [showInertia, setShowInertia] = useState(false);
    const [showOrigins, setShowOrigins] = useState(false);
    const [originSize, setOriginSize] = useState(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('urdf_viewer_origin_size');
            return saved ? Math.min(parseFloat(saved), 0.5) : 0.1;
        }
        return 0.1;
    });
    const [showJointAxes, setShowJointAxes] = useState(false);
    const [jointAxisSize, setJointAxisSize] = useState(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('urdf_viewer_joint_axis_size');
            return saved ? Math.min(parseFloat(saved), 2.0) : 0.1;
        }
        return 0.1;
    });
    const [modelOpacity, setModelOpacity] = useState(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('urdf_viewer_model_opacity');
            return saved ? parseFloat(saved) : 1.0;
        }
        return 1.0;
    });

    useEffect(() => {
        localStorage.setItem('urdf_viewer_origin_size', originSize.toString());
    }, [originSize]);

    useEffect(() => {
        localStorage.setItem('urdf_viewer_com_size', centerOfMassSize.toString());
    }, [centerOfMassSize]);

    useEffect(() => {
        localStorage.setItem('urdf_viewer_joint_axis_size', jointAxisSize.toString());
    }, [jointAxisSize]);

    useEffect(() => {
        localStorage.setItem('urdf_viewer_model_opacity', modelOpacity.toString());
    }, [modelOpacity]);


    const [highlightMode, setHighlightMode] = useState<'link' | 'collision'>('link');
    const [toolMode, setToolMode] = useState<ToolMode>('select');

    // WebGL context lost state
    const [contextLost, setContextLost] = useState(false);
    const glRef = useRef<THREE.WebGLRenderer | null>(null);

    const [measureState, setMeasureState] = useState<MeasureState>({
        measurements: [],
        currentPoints: [],
        tempPoint: null
    });
    const measurePanelRef = useRef<HTMLDivElement>(null);
    const [measurePanelPos, setMeasurePanelPos] = useState<{ x: number; y: number } | null>(null);

    const transformMode = (['translate', 'rotate', 'universal'].includes(toolMode) ? toolMode : 'select') as 'select' | 'translate' | 'rotate' | 'universal';

    useEffect(() => {
        if (selection?.subType === 'collision') {
            setHighlightMode('collision');
        } else if (selection?.subType === 'visual') {
            setHighlightMode('link');
        }
    }, [selection?.subType]);

    const containerRef = useRef<HTMLDivElement>(null);
    const optionsPanelRef = useRef<HTMLDivElement>(null);
    const jointPanelRef = useRef<HTMLDivElement>(null);
    const [optionsPanelPos, setOptionsPanelPos] = useState<{ x: number; y: number } | null>(null);
    const [jointPanelPos, setJointPanelPos] = useState<{ x: number; y: number } | null>(null);
    const [dragging, setDragging] = useState<'options' | 'joints' | 'measure' | null>(null);
    const dragStartRef = useRef<{ mouseX: number; mouseY: number; panelX: number; panelY: number } | null>(null);
    const [isOptionsCollapsed, setIsOptionsCollapsed] = useState(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('urdf_viewer_options_collapsed');
            return saved === 'true';
        }
        return false;
    });
    const [isJointsCollapsed, setIsJointsCollapsed] = useState(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('urdf_viewer_joints_collapsed');
            return saved === 'true';
        }
        return false;
    });

    const toggleOptionsCollapsed = () => {
        setIsOptionsCollapsed(prev => {
            const newState = !prev;
            localStorage.setItem('urdf_viewer_options_collapsed', String(newState));
            return newState;
        });
    };

    const toggleJointsCollapsed = () => {
        setIsJointsCollapsed(prev => {
            const newState = !prev;
            localStorage.setItem('urdf_viewer_joints_collapsed', String(newState));
            return newState;
        });
    };

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

    const handleMouseDown = useCallback((panel: 'options' | 'joints', e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        const panelRef = panel === 'options' ? optionsPanelRef : jointPanelRef;
        if (!panelRef.current || !containerRef.current) return;

        const rect = panelRef.current.getBoundingClientRect();
        const containerRect = containerRef.current.getBoundingClientRect();

        dragStartRef.current = {
            mouseX: e.clientX,
            mouseY: e.clientY,
            panelX: rect.left - containerRect.left,
            panelY: rect.top - containerRect.top
        };
        setDragging(panel);
    }, []);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (!dragging || !dragStartRef.current || !containerRef.current) return;

        const panelRef = dragging === 'options' ? optionsPanelRef :
            dragging === 'joints' ? jointPanelRef : measurePanelRef;
        if (!panelRef.current) return;

        const deltaX = e.clientX - dragStartRef.current.mouseX;
        const deltaY = e.clientY - dragStartRef.current.mouseY;

        const containerRect = containerRef.current.getBoundingClientRect();
        const panelRect = panelRef.current.getBoundingClientRect();

        let newX = dragStartRef.current.panelX + deltaX;
        let newY = dragStartRef.current.panelY + deltaY;

        const padding = 2;
        const maxX = containerRect.width - panelRect.width - padding;
        const maxY = containerRect.height - panelRect.height - padding;

        newX = Math.max(padding, Math.min(newX, Math.max(padding, maxX)));
        newY = Math.max(padding, Math.min(newY, Math.max(padding, maxY)));

        if (dragging === 'options') {
            setOptionsPanelPos({ x: newX, y: newY });
        } else if (dragging === 'joints') {
            setJointPanelPos({ x: newX, y: newY });
        } else if (dragging === 'measure') {
            setMeasurePanelPos({ x: newX, y: newY });
        }
    }, [dragging]);

    const handleMouseUp = useCallback(() => {
        setDragging(null);
        dragStartRef.current = null;
    }, []);

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
            {showOptionsPanel && (
                <div
                    ref={optionsPanelRef}
                    className="absolute z-30 pointer-events-auto"
                    style={optionsPanelPos
                        ? { left: optionsPanelPos.x, top: optionsPanelPos.y, right: 'auto' }
                        : { top: '16px', right: '16px' }
                    }
                >
                    <div className="bg-white/80 dark:bg-google-dark-surface/80 backdrop-blur rounded-lg border border-slate-200 dark:border-google-dark-border flex flex-col w-48 shadow-xl overflow-hidden">
                        <div
                            className="text-[10px] text-slate-500 uppercase font-bold tracking-wider px-3 py-2 cursor-move bg-slate-100/50 dark:bg-google-dark-bg/50 hover:bg-slate-100 dark:hover:bg-google-dark-bg select-none flex items-center justify-between"
                            onMouseDown={(e) => handleMouseDown('options', e)}
                        >
                            <div className="flex items-center gap-2">
                                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                    <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
                                </svg>
                                {mode === 'hardware' ? t.hardwareOptions : t.detailOptions}
                            </div>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={(e) => { e.stopPropagation(); toggleOptionsCollapsed(); }}
                                    className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 hover:bg-slate-200 dark:hover:bg-google-dark-border rounded"
                                >
                                    {isOptionsCollapsed ? (
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                    ) : (
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                                    )}
                                </button>
                                {setShowOptionsPanel && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setShowOptionsPanel(false); }}
                                        className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 rounded"
                                    >
                                        <X className="w-3 h-3" />
                                    </button>
                                )}
                            </div>
                        </div>

                        {!isOptionsCollapsed && (
                            <div className="px-2 pb-2 pt-1 flex flex-col gap-2">
                                {/* Loaded File Display */}
                                {fileName && (
                                    <div className="bg-gradient-to-r from-slate-50 to-slate-100 dark:from-google-dark-bg dark:to-google-dark-surface rounded-md px-2 py-1.5 border border-slate-200 dark:border-google-dark-border animate-fade-in">
                                        <div className="text-[9px] text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-0.5">
                                            {lang === 'zh' ? '已加载' : 'Loaded'}
                                        </div>
                                        <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-200 truncate" title={fileName}>
                                            {fileName}
                                        </div>
                                    </div>
                                )}

                                <div className="border-b border-slate-200 dark:border-slate-700 pb-2 mb-1">
                                    <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-1.5 px-1">{t.highlightMode}</div>
                                    <div className="flex bg-slate-100 dark:bg-google-dark-bg rounded p-0.5">
                                        <button
                                            onClick={() => setHighlightMode('link')}
                                            className={`flex-1 py-1 text-[10px] font-medium rounded transition-all ${highlightMode === 'link' ? 'bg-white dark:bg-google-dark-surface text-google-blue shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
                                        >
                                            {t.linkMode}
                                        </button>
                                        <button
                                            onClick={() => setHighlightMode('collision')}
                                            className={`flex-1 py-1 text-[10px] font-medium rounded transition-all ${highlightMode === 'collision' ? 'bg-white dark:bg-google-dark-surface text-google-blue shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
                                        >
                                            {t.collisionMode}
                                        </button>
                                    </div>
                                </div>

                                <div className="space-y-1">
                                    <CheckboxOption checked={showJointControls} onChange={setShowJointControls} label={t.showJointControls} compact />
                                    <CheckboxOption checked={showVisual} onChange={setShowVisual} label={t.showVisual} compact />
                                    <CheckboxOption checked={showCollision} onChange={setShowCollision} label={t.showCollision} compact />
                                </div>

                                {/* Model Transparency - Beautified */}
                                <div className="border-t border-slate-200 dark:border-slate-700 pt-2">
                                    <div className="px-1">
                                        <div className="flex items-center gap-2 mb-1.5">
                                            <div className="flex items-center gap-1">
                                                <svg className="w-3 h-3 text-slate-400" viewBox="0 0 24 24" fill="currentColor">
                                                    <circle cx="12" cy="12" r="10" fillOpacity={modelOpacity} />
                                                    <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.5" />
                                                </svg>
                                                <span className="text-[10px] text-slate-600 dark:text-slate-300">
                                                    {lang === 'zh' ? '不透明度' : 'Opacity'}
                                                </span>
                                            </div>
                                            <span className="text-[10px] font-mono text-google-blue ml-auto">
                                                {Math.round(modelOpacity / 1.0 * 100)}%
                                            </span>
                                        </div>
                                        <div className="relative">
                                            <input
                                                type="range"
                                                min={0.1}
                                                max={1.0}
                                                step={0.01}
                                                value={modelOpacity}
                                                onChange={(e) => setModelOpacity(parseFloat(e.target.value))}
                                                className="w-full h-2 rounded-full appearance-none cursor-pointer bg-gradient-to-r from-slate-200 via-slate-300 to-slate-400 dark:from-slate-700 dark:via-slate-600 dark:to-slate-500 shadow-inner"
                                                style={{
                                                    background: `linear-gradient(to right, rgb(59, 130, 246) 0%, rgb(59, 130, 246) ${(modelOpacity) / 1.0 * 100}%, rgb(203, 213, 225) ${(modelOpacity) / 1.0 * 100}%, rgb(203, 213, 225) 100%)`
                                                }}
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Coordinate Axes Section */}
                                <div className="border-t border-slate-200 dark:border-slate-700 pt-2 space-y-1">
                                    <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-1 px-1">
                                        {lang === 'zh' ? '坐标系显示' : 'Coordinate Axes'}
                                    </div>

                                    <CheckboxOption
                                        checked={showOrigins}
                                        onChange={setShowOrigins}
                                        label={t.showOrigin}
                                        icon={<Move className="w-3 h-3 text-slate-500" />}
                                        compact
                                    />

                                    {showOrigins && (
                                        <SliderOption label={t.size} value={originSize} onChange={setOriginSize} min={0.01} max={0.5} step={0.01} compact />
                                    )}

                                    <CheckboxOption
                                        checked={showJointAxes}
                                        onChange={setShowJointAxes}
                                        label={t.showJointAxes}
                                        icon={<ArrowUpRight className="w-3 h-3 text-red-500" />}
                                        compact
                                    />

                                    {showJointAxes && (
                                        <SliderOption label={t.size} value={jointAxisSize} onChange={setJointAxisSize} min={0.01} max={2.0} step={0.01} compact />
                                    )}
                                </div>

                                {/* Physics Visualization Section */}
                                <div className="border-t border-slate-200 dark:border-slate-700 pt-2 space-y-1">
                                    <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-1 px-1">
                                        {lang === 'zh' ? '物理可视化' : 'Physics'}
                                    </div>

                                    <CheckboxOption
                                        checked={showCenterOfMass}
                                        onChange={setShowCenterOfMass}
                                        label={t.showCenterOfMass}
                                        icon={<div className="w-3 h-3 rounded-full border border-slate-500 flex items-center justify-center"><div className="w-1 h-1 bg-slate-500 rounded-full"></div></div>}
                                        compact
                                    />
                                    {showCenterOfMass && (
                                        <SliderOption label={t.size} value={centerOfMassSize} onChange={setCenterOfMassSize} min={0.005} max={0.1} step={0.005} decimals={3} compact />
                                    )}

                                    <CheckboxOption
                                        checked={showInertia}
                                        onChange={setShowInertia}
                                        label={t.showInertia}
                                        icon={<div className="w-3 h-3 border border-dashed border-slate-500"></div>}
                                        compact
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Joint controls panel */}
            {showJointControls && showJointPanel && robot?.joints && Object.keys(robot.joints).length > 0 && (
                <div
                    ref={jointPanelRef}
                    className="absolute z-30 bg-white/90 dark:bg-google-dark-surface/90 backdrop-blur rounded-lg border border-slate-200 dark:border-google-dark-border max-h-[50vh] overflow-hidden w-64 shadow-xl flex flex-col pointer-events-auto"
                    style={jointPanelPos
                        ? { left: jointPanelPos.x, top: jointPanelPos.y, right: 'auto', bottom: 'auto' }
                        : { bottom: '16px', right: '16px' }
                    }
                >
                    <div
                        className="text-[10px] text-slate-500 uppercase font-bold tracking-wider px-3 py-2 cursor-move bg-slate-100/50 dark:bg-google-dark-bg/50 hover:bg-slate-100 dark:hover:bg-google-dark-bg select-none flex items-center justify-between flex-shrink-0"
                        onMouseDown={(e) => handleMouseDown('joints', e)}
                    >
                        <div className="flex items-center gap-2">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
                            </svg>
                            {t.jointControls}
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={(e) => { e.stopPropagation(); handleResetJoints(); }}
                                className="p-1 rounded bg-slate-200 dark:bg-google-dark-bg hover:bg-slate-300 dark:hover:bg-google-dark-border text-slate-700 dark:text-white"
                                title={t.resetJoints}
                            >
                                <RotateCcw className="w-3 h-3" />
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); setAngleUnit(angleUnit === 'rad' ? 'deg' : 'rad'); }}
                                className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-google-dark-bg hover:bg-slate-300 dark:hover:bg-google-dark-border text-slate-700 dark:text-white font-mono"
                                title={t.switchUnit}
                            >
                                {angleUnit.toUpperCase()}
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); toggleJointsCollapsed(); }}
                                className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 hover:bg-slate-200 dark:hover:bg-google-dark-border rounded"
                            >
                                {isJointsCollapsed ? (
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                ) : (
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                                )}
                            </button>
                            {setShowJointPanel && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); setShowJointPanel(false); }}
                                    className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 rounded"
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            )}
                        </div>
                    </div>
                    {!isJointsCollapsed && (
                        <div className="p-3 overflow-y-auto flex-1">
                            <div className="space-y-2">
                                {Object.entries(robot.joints)
                                    .filter(([_, joint]: [string, any]) => joint.jointType !== 'fixed')
                                    .map(([name, joint]: [string, any]) => (
                                        <JointControlItem
                                            key={name}
                                            name={name}
                                            joint={joint}
                                            jointAngles={jointAngles}
                                            angleUnit={angleUnit}
                                            activeJoint={activeJoint}
                                            setActiveJoint={setActiveJoint}
                                            handleJointAngleChange={handleJointAngleChange}
                                            handleJointChangeCommit={handleJointChangeCommit}
                                            onSelect={onSelect}
                                        />
                                    ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

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
            {toolMode === 'measure' && (
                <div
                    ref={measurePanelRef}
                    className="measure-panel absolute z-30 pointer-events-auto"
                    style={measurePanelPos
                        ? { left: measurePanelPos.x, top: measurePanelPos.y }
                        : { left: '16px', top: '100px' }
                    }
                    onMouseDown={(e) => {
                        e.stopPropagation();
                        if (!measurePanelRef.current || !containerRef.current) return;
                        const rect = measurePanelRef.current.getBoundingClientRect();
                        const containerRect = containerRef.current.getBoundingClientRect();
                        dragStartRef.current = {
                            mouseX: e.clientX,
                            mouseY: e.clientY,
                            panelX: rect.left - containerRect.left,
                            panelY: rect.top - containerRect.top
                        };
                        setDragging('measure');
                    }}
                >
                    <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 min-w-[200px] overflow-hidden">
                        <div className="cursor-move px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between bg-slate-100/50 dark:bg-slate-700/50">
                            <div className="text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                                <svg className="w-3 h-3 text-slate-400" fill="currentColor" viewBox="0 0 20 20"><path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" /></svg>
                                <Ruler className="w-4 h-4" />
                                测量工具
                            </div>
                        </div>
                        <div className="p-3">
                            <div className="text-[10px] text-slate-500 dark:text-slate-400 mb-3 space-y-1">
                                <div>• 点击模型选择测量点</div>
                                <div>• <kbd className="px-1 py-0.5 bg-slate-200 dark:bg-slate-700 rounded text-[9px]">Esc</kbd> 取消当前测量</div>
                                <div>• <kbd className="px-1 py-0.5 bg-slate-200 dark:bg-slate-700 rounded text-[9px]">Delete</kbd> 删除上一个</div>
                            </div>
                            <div className="text-xs text-slate-600 dark:text-slate-300 mb-2">
                                已测量: {measureState.measurements.length} 个
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => {
                                        if (measureState.currentPoints.length > 0) {
                                            setMeasureState(prev => ({ ...prev, currentPoints: [], tempPoint: null }));
                                        } else if (measureState.measurements.length > 0) {
                                            setMeasureState(prev => ({ ...prev, measurements: prev.measurements.slice(0, -1) }));
                                        }
                                    }}
                                    disabled={measureState.measurements.length === 0 && measureState.currentPoints.length === 0}
                                    className="flex-1 px-2 py-1.5 text-xs bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
                                >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                                    </svg>
                                    撤销
                                </button>
                                <button
                                    onClick={() => setMeasureState({ measurements: [], currentPoints: [], tempPoint: null })}
                                    disabled={measureState.measurements.length === 0 && measureState.currentPoints.length === 0}
                                    className="flex-1 px-2 py-1.5 text-xs bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 text-red-700 dark:text-red-400 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
                                >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                    全部清除
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

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
                        showCenterOfMass={showCenterOfMass}
                        centerOfMassSize={centerOfMassSize}
                        showOrigins={showOrigins}
                        originSize={originSize}
                        showJointAxes={showJointAxes}
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
