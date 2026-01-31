import React from 'react';
import { Move, ArrowUpRight, X } from 'lucide-react';
import { CheckboxOption, SliderOption } from '@/shared/components/Panel/OptionsPanel';

interface ViewerOptionsPanelProps {
    showOptionsPanel: boolean;
    optionsPanelRef: React.RefObject<HTMLDivElement>;
    optionsPanelPos: { x: number; y: number } | null;
    onMouseDown: (e: React.MouseEvent) => void;
    mode: 'detail' | 'hardware';
    t: any;
    isOptionsCollapsed: boolean;
    toggleOptionsCollapsed: () => void;
    setShowOptionsPanel?: (show: boolean) => void;
    fileName?: string;
    lang: string;
    highlightMode: 'link' | 'collision';
    setHighlightMode: (mode: 'link' | 'collision') => void;
    showJointControls: boolean;
    setShowJointControls: (show: boolean) => void;
    showVisual: boolean;
    setShowVisual: (show: boolean) => void;
    showCollision: boolean;
    setShowCollision: (show: boolean) => void;
    modelOpacity: number;
    setModelOpacity: (opacity: number) => void;
    showOrigins: boolean;
    setShowOrigins: (show: boolean) => void;
    showOriginsOverlay: boolean;
    setShowOriginsOverlay: (show: boolean) => void;
    originSize: number;
    setOriginSize: (size: number) => void;
    showJointAxes: boolean;
    setShowJointAxes: (show: boolean) => void;
    showJointAxesOverlay: boolean;
    setShowJointAxesOverlay: (show: boolean) => void;
    jointAxisSize: number;
    setJointAxisSize: (size: number) => void;
    showCenterOfMass: boolean;
    setShowCenterOfMass: (show: boolean) => void;
    showCoMOverlay: boolean;
    setShowCoMOverlay: (show: boolean) => void;
    centerOfMassSize: number;
    setCenterOfMassSize: (size: number) => void;
    showInertia: boolean;
    setShowInertia: (show: boolean) => void;
    showInertiaOverlay: boolean;
    setShowInertiaOverlay: (show: boolean) => void;
}

export const ViewerOptionsPanel: React.FC<ViewerOptionsPanelProps> = ({
    showOptionsPanel,
    optionsPanelRef,
    optionsPanelPos,
    onMouseDown,
    mode,
    t,
    isOptionsCollapsed,
    toggleOptionsCollapsed,
    setShowOptionsPanel,
    fileName,
    lang,
    highlightMode,
    setHighlightMode,
    showJointControls,
    setShowJointControls,
    showVisual,
    setShowVisual,
    showCollision,
    setShowCollision,
    modelOpacity,
    setModelOpacity,
    showOrigins,
    setShowOrigins,
    showOriginsOverlay,
    setShowOriginsOverlay,
    originSize,
    setOriginSize,
    showJointAxes,
    setShowJointAxes,
    showJointAxesOverlay,
    setShowJointAxesOverlay,
    jointAxisSize,
    setJointAxisSize,
    showCenterOfMass,
    setShowCenterOfMass,
    showCoMOverlay,
    setShowCoMOverlay,
    centerOfMassSize,
    setCenterOfMassSize,
    showInertia,
    setShowInertia,
    showInertiaOverlay,
    setShowInertiaOverlay,
}) => {
    if (!showOptionsPanel) return null;

    return (
        <div
            ref={optionsPanelRef}
            className="absolute z-30 pointer-events-auto"
            style={optionsPanelPos
                ? { left: optionsPanelPos.x, top: optionsPanelPos.y, right: 'auto' }
                : { top: '16px', right: '16px' }
            }
        >
            <div className="bg-white dark:bg-panel-bg rounded-lg border border-slate-200 dark:border-border-black flex flex-col w-48 shadow-xl dark:shadow-black overflow-hidden">
                <div
                    className="text-[10px] text-slate-500 uppercase font-bold tracking-wider px-3 py-2 cursor-move bg-slate-100 dark:bg-element-active hover:bg-slate-100 dark:hover:bg-element-active select-none flex items-center justify-between"
                    onMouseDown={onMouseDown}
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
                                className="text-slate-400 dark:hover:text-white p-1 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 rounded"
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
                            <div className="bg-linear-to-r from-slate-50 to-slate-100 dark:from-google-dark-bg dark:to-google-dark-surface rounded-md px-2 py-1.5 border border-slate-200 dark:border-google-dark-border animate-fade-in">
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
                                        className="w-full h-2 rounded-full appearance-none cursor-pointer bg-linear-to-r from-slate-200 via-slate-300 to-slate-400 dark:from-slate-700 dark:via-slate-600 dark:to-slate-500 shadow-inner"
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

                            <div className="flex items-center justify-between pr-1">
                                <CheckboxOption
                                    checked={showOrigins}
                                    onChange={setShowOrigins}
                                    label={t.showOrigin}
                                    icon={<Move className="w-3 h-3 text-slate-500" />}
                                    compact
                                />
                                {showOrigins && (
                                    <button
                                        className={`p-0.5 rounded transition-colors ${showOriginsOverlay ? 'text-google-blue bg-blue-50 dark:bg-blue-900/30' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                                        onClick={() => setShowOriginsOverlay(!showOriginsOverlay)}
                                        title={lang === 'zh' ? "显示在最前" : "Always on top"}
                                    >
                                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                                        </svg>
                                    </button>
                                )}
                            </div>

                            {showOrigins && (
                                <SliderOption label={t.size} value={originSize} onChange={setOriginSize} min={0.01} max={0.5} step={0.01} compact />
                            )}

                            <div className="flex items-center justify-between pr-1">
                                <CheckboxOption
                                    checked={showJointAxes}
                                    onChange={setShowJointAxes}
                                    label={t.showJointAxes}
                                    icon={<ArrowUpRight className="w-3 h-3 text-red-500" />}
                                    compact
                                />
                                {showJointAxes && (
                                    <button
                                        className={`p-0.5 rounded transition-colors ${showJointAxesOverlay ? 'text-google-blue bg-blue-50 dark:bg-blue-900/30' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                                        onClick={() => setShowJointAxesOverlay(!showJointAxesOverlay)}
                                        title={lang === 'zh' ? "显示在最前" : "Always on top"}
                                    >
                                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                                        </svg>
                                    </button>
                                )}
                            </div>

                            {showJointAxes && (
                                <SliderOption label={t.size} value={jointAxisSize} onChange={setJointAxisSize} min={0.01} max={2.0} step={0.01} compact />
                            )}
                        </div>

                        {/* Physics Visualization Section */}
                        <div className="border-t border-slate-200 dark:border-slate-700 pt-2 space-y-1">
                            <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-1 px-1">
                                {lang === 'zh' ? '物理可视化' : 'Physics'}
                            </div>

                            <div className="flex items-center justify-between pr-1">
                                <CheckboxOption
                                    checked={showCenterOfMass}
                                    onChange={setShowCenterOfMass}
                                    label={t.showCenterOfMass}
                                    icon={<div className="w-3 h-3 rounded-full border border-slate-500 flex items-center justify-center"><div className="w-1 h-1 bg-slate-500 rounded-full"></div></div>}
                                    compact
                                />
                                {showCenterOfMass && (
                                    <button
                                        className={`p-0.5 rounded transition-colors ${showCoMOverlay ? 'text-google-blue bg-blue-50 dark:bg-blue-900/30' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                                        onClick={() => setShowCoMOverlay(!showCoMOverlay)}
                                        title={lang === 'zh' ? "显示在最前" : "Always on top"}
                                    >
                                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                                        </svg>
                                    </button>
                                )}
                            </div>
                            {showCenterOfMass && (
                                <SliderOption label={t.size} value={centerOfMassSize} onChange={setCenterOfMassSize} min={0.005} max={0.1} step={0.005} decimals={3} compact />
                            )}

                            <div className="flex items-center justify-between pr-1">
                                <CheckboxOption
                                    checked={showInertia}
                                    onChange={setShowInertia}
                                    label={t.showInertia}
                                    icon={<div className="w-3 h-3 border border-dashed border-slate-500"></div>}
                                    compact
                                />
                                {showInertia && (
                                    <button
                                        className={`p-0.5 rounded transition-colors ${showInertiaOverlay ? 'text-google-blue bg-blue-50 dark:bg-blue-900/30' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                                        onClick={() => setShowInertiaOverlay(!showInertiaOverlay)}
                                        title={lang === 'zh' ? "显示在最前" : "Always on top"}
                                    >
                                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                                        </svg>
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
