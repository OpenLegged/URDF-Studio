import React, { forwardRef } from 'react';
import { Language, translations } from '@/shared/i18n';
import { CheckboxOption } from '@/shared/components/Panel/OptionsPanel';

interface DetailOptionsPanelProps {
  lang: Language;
  showDetailOrigin: boolean;
  setShowDetailOrigin: (show: boolean) => void;
  showDetailLabels: boolean;
  setShowDetailLabels: (show: boolean) => void;
  showVisual: boolean;
  setShowVisual: (show: boolean) => void;
  showCollision: boolean;
  setShowCollision: (show: boolean) => void;
  showInertia: boolean;
  setShowInertia: (show: boolean) => void;
  showCenterOfMass: boolean;
  setShowCenterOfMass: (show: boolean) => void;
  transformMode: 'translate' | 'rotate';
  setTransformMode: (mode: 'translate' | 'rotate') => void;
  isCollapsed: boolean;
  toggleCollapsed: () => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onResetPosition: () => void;
  optionsPanelPos: { x: number; y: number } | null;
}

export const DetailOptionsPanel = forwardRef<HTMLDivElement, DetailOptionsPanelProps>(
  (
    {
      lang,
      showDetailOrigin,
      setShowDetailOrigin,
      showDetailLabels,
      setShowDetailLabels,
      showVisual,
      setShowVisual,
      showCollision,
      setShowCollision,
      showInertia,
      setShowInertia,
      showCenterOfMass,
      setShowCenterOfMass,
      transformMode,
      setTransformMode,
      isCollapsed,
      toggleCollapsed,
      onMouseDown,
      onResetPosition,
      optionsPanelPos,
    },
    ref
  ) => {
    const t = translations[lang];

    return (
      <div
        ref={ref}
        className="absolute z-10 pointer-events-auto"
        style={
          optionsPanelPos
            ? { left: optionsPanelPos.x, top: optionsPanelPos.y, right: 'auto' }
            : { top: '16px', right: '16px' }
        }
      >
        <div className="bg-white dark:bg-google-dark-surface rounded-lg border border-slate-200 dark:border-google-dark-border flex flex-col w-48 shadow-md dark:shadow-xl overflow-hidden">
          <div
            className="text-[10px] text-slate-500 uppercase font-bold tracking-wider px-3 py-2 cursor-move bg-slate-100 dark:bg-google-dark-bg hover:bg-slate-100 dark:hover:bg-google-dark-bg select-none flex items-center justify-between"
            onMouseDown={onMouseDown}
          >
            <div className="flex items-center gap-2">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
              </svg>
              {t.detailOptions}
            </div>
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onResetPosition();
                toggleCollapsed();
              }}
              className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 hover:bg-slate-200 dark:hover:bg-google-dark-border rounded"
            >
              {isCollapsed ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 15l7-7 7 7"
                  />
                </svg>
              )}
            </button>
          </div>

          <div
            className={`transition-all duration-200 ease-in-out overflow-hidden ${
              isCollapsed ? 'max-h-0 opacity-0' : 'max-h-96 opacity-100'
            }`}
          >
            <div className="p-2 flex flex-col gap-2">
              <div className="flex bg-slate-100 dark:bg-google-dark-bg rounded-lg p-0.5 mb-1">
                <button
                  onClick={() => setTransformMode('translate')}
                  className={`flex-1 py-1 text-xs rounded-md ${
                    transformMode === 'translate'
                      ? 'bg-google-blue text-white shadow'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {t.move}
                </button>
                <button
                  onClick={() => setTransformMode('rotate')}
                  className={`flex-1 py-1 text-xs rounded-md ${
                    transformMode === 'rotate'
                      ? 'bg-google-blue text-white shadow'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {t.rotate}
                </button>
              </div>

              <CheckboxOption
                checked={showDetailOrigin}
                onChange={setShowDetailOrigin}
                label={t.showOrigin}
              />
              <CheckboxOption
                checked={showDetailLabels}
                onChange={setShowDetailLabels}
                label={t.showLabels}
              />
              <CheckboxOption checked={showVisual} onChange={setShowVisual} label={t.showVisual} />
              <CheckboxOption
                checked={showCollision}
                onChange={setShowCollision}
                label={t.showCollision}
              />
              <CheckboxOption checked={showInertia} onChange={setShowInertia} label={t.showInertia} />
              <CheckboxOption
                checked={showCenterOfMass}
                onChange={setShowCenterOfMass}
                label={t.showCenterOfMass}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }
);

DetailOptionsPanel.displayName = 'DetailOptionsPanel';
