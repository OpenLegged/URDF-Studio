/**
 * Settings Modal Component
 * Draggable settings panel for UI scale configuration
 */
import React from 'react';
import { Settings, X } from 'lucide-react';
import { useUIStore } from '@/store';

export function SettingsModal() {
  const isSettingsOpen = useUIStore((state) => state.isSettingsOpen);
  const settingsPos = useUIStore((state) => state.settingsPos);
  const closeSettings = useUIStore((state) => state.closeSettings);
  const setSettingsPos = useUIStore((state) => state.setSettingsPos);
  const uiScale = useUIStore((state) => state.uiScale);
  const setUiScale = useUIStore((state) => state.setUiScale);
  const lang = useUIStore((state) => state.lang);

  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const initialX = settingsPos.x;
    const initialY = settingsPos.y;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      setSettingsPos({ x: initialX + dx, y: initialY + dy });
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  if (!isSettingsOpen) {
    return null;
  }

  return (
    <div
      style={{ left: settingsPos.x, top: settingsPos.y }}
      className="fixed z-[100] w-[320px] bg-white dark:bg-panel-bg rounded-xl shadow-2xl border border-slate-200 dark:border-border-black overflow-hidden"
    >
      {/* Header */}
      <div
        onMouseDown={handleDragStart}
        className="bg-slate-50 dark:bg-element-active px-4 py-3 border-b border-slate-200 dark:border-border-black flex items-center justify-between cursor-move select-none"
      >
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-slate-500 dark:text-slate-400" />
          <h2 className="text-sm font-bold text-slate-800 dark:text-white">
            {lang === 'zh' ? '设置' : 'Settings'}
          </h2>
        </div>
        <button
          onClick={closeSettings}
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-slate-600 dark:text-slate-300">
              {lang === 'zh' ? '界面缩放' : 'Interface Scale'}
            </label>
            <span className="text-xs text-slate-500 font-mono">
              {(uiScale * 100).toFixed(0)}%
            </span>
          </div>
          <input
            type="range"
            min="0.8"
            max="1.5"
            step="0.05"
            value={uiScale}
            onChange={(e) => setUiScale(parseFloat(e.target.value))}
            className="w-full h-1.5 bg-slate-200 dark:bg-black border border-slate-200 dark:border-element-hover rounded-lg appearance-none cursor-pointer accent-[#0060FA]"
          />
          <div className="relative h-4 text-[10px] text-slate-400">
            <span className="absolute left-0">80%</span>
            <span className="absolute left-[28.57%] -translate-x-1/2">100%</span>
            <span className="absolute right-0">150%</span>
          </div>
        </div>

        <button
          onClick={() => setUiScale(1.0)}
          className="w-full py-1.5 text-xs text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-element-bg hover:bg-slate-200 dark:hover:bg-element-hover rounded transition-colors"
        >
          {lang === 'zh' ? '重置默认' : 'Reset to Default'}
        </button>
      </div>
    </div>
  );
}

export default SettingsModal;
