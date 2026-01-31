import React, { useRef, useState, useEffect } from 'react';
import { RotateCcw, Move, ArrowUpRight, MousePointer2, View as ViewIcon, Scan, Ruler, X } from 'lucide-react';
import Draggable from 'react-draggable';
import { translations } from '@/shared/i18n';
import type { ViewerToolbarProps, ToolMode } from '../types';

export const ViewerToolbar: React.FC<ViewerToolbarProps> = ({ activeMode, setMode, onClose, lang = 'en' }) => {
    const nodeRef = useRef<HTMLDivElement>(null);
    const [initialPosition, setInitialPosition] = useState<{ x: number; y: number } | null>(null);
    const t = translations[lang];
    const tools = [
        { id: 'view', icon: ViewIcon, label: t.viewMode },
        { id: 'select', icon: MousePointer2, label: t.selectMode },
        { id: 'translate', icon: Move, label: t.translateMode },
        { id: 'rotate', icon: RotateCcw, label: t.rotateMode },
        { id: 'universal', icon: ArrowUpRight, label: t.universalMode },
        { id: 'face', icon: Scan, label: t.faceMode },
        { id: 'measure', icon: Ruler, label: t.measureMode },
    ];

    useEffect(() => {
        if (nodeRef.current && initialPosition === null) {
            const parent = nodeRef.current.parentElement;
            if (parent) {
                const parentRect = parent.getBoundingClientRect();
                const toolbarRect = nodeRef.current.getBoundingClientRect();
                const centerX = (parentRect.width - toolbarRect.width) / 2;
                setInitialPosition({ x: centerX, y: 4 });
            }
        }
    }, [initialPosition]);

    if (initialPosition === null) {
        return (
            <div ref={nodeRef} className="urdf-toolbar absolute z-40 bg-white/90 dark:bg-panel-bg rounded-lg border border-slate-200 dark:border-border-black shadow-2xl dark:shadow-black flex items-center p-1 gap-1 cursor-auto" style={{ left: '50%', top: '4px', transform: 'translateX(-50%)' }}>
                <div className="drag-handle cursor-move px-1 text-slate-300 dark:text-slate-600 flex items-center h-full mr-1 hover:text-slate-500 dark:hover:text-slate-400">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>
                </div>
                {tools.map((tool) => {
                    const isActive = activeMode === tool.id;
                    const Icon = tool.icon;
                    return (
                        <button
                            key={tool.id}
                            onClick={() => setMode(tool.id as ToolMode)}
                            className={`group relative p-1.5 rounded-md transition-all ${
                                isActive
                                ? 'bg-blue-100 text-blue-600 dark:bg-system-blue dark:text-white shadow-lg dark:shadow-black/40'
                                : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-element-bg hover:text-slate-700 dark:hover:text-white'
                            }`}
                        >
                            <Icon className="w-4 h-4" />
                            <span className="absolute top-full mt-2 left-1/2 -translate-x-1/2 bg-slate-800 dark:bg-black text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-75 pointer-events-none whitespace-nowrap z-50 shadow-md dark:shadow-lg border border-slate-200 dark:border-slate-700">
                                {tool.label}
                            </span>
                        </button>
                    );
                })}
                {onClose && (
                    <>
                        <div className="w-px h-4 bg-slate-200 dark:bg-border-black mx-1"></div>
                        <button
                            onClick={onClose}
                            className="group relative p-1.5 rounded-md text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 transition-all"
                        >
                            <X className="w-4 h-4" />
                            <span className="absolute top-full mt-2 left-1/2 -translate-x-1/2 bg-slate-800 dark:bg-black text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-75 pointer-events-none whitespace-nowrap z-50 shadow-md dark:shadow-lg border border-slate-200 dark:border-slate-700">
                                {t.closeToolbar}
                            </span>
                        </button>
                    </>
                )}
            </div>
        );
    }

    return (
        <Draggable bounds="parent" handle=".drag-handle" nodeRef={nodeRef} defaultPosition={initialPosition}>
            <div ref={nodeRef} className="urdf-toolbar absolute z-40 bg-white/90 dark:bg-panel-bg rounded-lg border border-slate-200 dark:border-border-black shadow-2xl dark:shadow-black flex items-center p-1 gap-1 cursor-auto">
                <div className="drag-handle cursor-move px-1 text-slate-300 dark:text-slate-600 flex items-center h-full mr-1 hover:text-slate-500 dark:hover:text-slate-400">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>
                </div>
                {tools.map((tool) => {
                    const isActive = activeMode === tool.id;
                    const Icon = tool.icon;
                    return (
                        <button
                            key={tool.id}
                            onClick={() => setMode(tool.id as ToolMode)}
                            className={`group relative p-1.5 rounded-md transition-all ${
                                isActive
                                ? 'bg-blue-100 text-blue-600 dark:bg-system-blue dark:text-white shadow-lg dark:shadow-black/40'
                                : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-element-bg hover:text-slate-700 dark:hover:text-white'
                            }`}
                        >
                            <Icon className="w-4 h-4" />
                            <span className="absolute top-full mt-2 left-1/2 -translate-x-1/2 bg-slate-800 dark:bg-black text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-75 pointer-events-none whitespace-nowrap z-50 shadow-md dark:shadow-lg border border-slate-200 dark:border-slate-700">
                                {tool.label}
                            </span>
                        </button>
                    );
                })}
                {onClose && (
                    <>
                        <div className="w-px h-4 bg-slate-200 dark:bg-border-black mx-1"></div>
                        <button
                            onClick={onClose}
                            className="group relative p-1.5 rounded-md text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 transition-all"
                        >
                            <X className="w-4 h-4" />
                            <span className="absolute top-full mt-2 left-1/2 -translate-x-1/2 bg-slate-800 dark:bg-black text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-75 pointer-events-none whitespace-nowrap z-50 shadow-md dark:shadow-lg border border-slate-200 dark:border-slate-700">
                                {t.closeToolbar}
                            </span>
                        </button>
                    </>
                )}
            </div>
        </Draggable>
    );
};
