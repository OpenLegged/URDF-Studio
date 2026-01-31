import React from 'react';
import { Ruler } from 'lucide-react';
import { MeasureState, ToolMode } from '../types';

interface MeasurePanelProps {
    toolMode: ToolMode;
    measurePanelRef: React.RefObject<HTMLDivElement>;
    measurePanelPos: { x: number; y: number } | null;
    onMouseDown: (e: React.MouseEvent) => void;
    measureState: MeasureState;
    setMeasureState: React.Dispatch<React.SetStateAction<MeasureState>>;
}

export const MeasurePanel: React.FC<MeasurePanelProps> = ({
    toolMode,
    measurePanelRef,
    measurePanelPos,
    onMouseDown,
    measureState,
    setMeasureState,
}) => {
    if (toolMode !== 'measure') return null;

    return (
        <div
            ref={measurePanelRef}
            className="measure-panel absolute z-30 pointer-events-auto"
            style={measurePanelPos
                ? { left: measurePanelPos.x, top: measurePanelPos.y }
                : { left: '16px', top: '100px' }
            }
            onMouseDown={onMouseDown}
        >
            <div className="bg-white dark:bg-panel-bg rounded-lg shadow-xl dark:shadow-black border border-slate-200 dark:border-border-black min-w-[200px] overflow-hidden">
                <div className="cursor-move px-3 py-2 border-b border-slate-200 dark:border-border-black flex items-center justify-between bg-slate-100 dark:bg-element-active">
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
    );
};
