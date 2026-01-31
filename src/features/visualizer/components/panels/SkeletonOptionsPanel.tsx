import React, { forwardRef } from 'react';
import { Language, translations } from '@/shared/i18n';
import {
  CheckboxOption,
  SliderOption,
} from '@/shared/components/Panel/OptionsPanel';

interface SkeletonOptionsPanelProps {
  lang: Language;
  showGeometry: boolean;
  setShowGeometry: (show: boolean) => void;
  showSkeletonOrigin: boolean;
  setShowSkeletonOrigin: (show: boolean) => void;
  frameSize: number;
  setFrameSize: (size: number) => void;
  showLabels: boolean;
  setShowLabels: (show: boolean) => void;
  labelScale: number;
  setLabelScale: (scale: number) => void;
  showJointAxes: boolean;
  setShowJointAxes: (show: boolean) => void;
  jointAxisSize: number;
  setJointAxisSize: (size: number) => void;
  transformMode: 'translate' | 'rotate';
  setTransformMode: (mode: 'translate' | 'rotate') => void;
  isCollapsed: boolean;
  toggleCollapsed: () => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onResetPosition: () => void;
  onClose?: () => void;
  optionsPanelPos: { x: number; y: number } | null;
}

export const SkeletonOptionsPanel = forwardRef<HTMLDivElement, SkeletonOptionsPanelProps>(
  (
    {
      lang,
      showGeometry,
      setShowGeometry,
      showSkeletonOrigin,
      setShowSkeletonOrigin,
      frameSize,
      setFrameSize,
      showLabels,
      setShowLabels,
      labelScale,
      setLabelScale,
      showJointAxes,
      setShowJointAxes,
      jointAxisSize,
      setJointAxisSize,
      transformMode,
      setTransformMode,
      isCollapsed,
      toggleCollapsed,
      onMouseDown,
      onResetPosition,
      onClose,
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
              {t.skeletonOptions}
            </div>
            <div className="flex items-center gap-1">
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onResetPosition();
                  toggleCollapsed();
                }}
                className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 hover:bg-slate-200 dark:hover:bg-google-dark-border rounded"
                title={isCollapsed ? t.expand : t.collapse}
              >
                {isCollapsed ? (
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                ) : (
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 15l7-7 7 7"
                    />
                  </svg>
                )}
              </button>
              {onClose && (
                <button
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose();
                  }}
                  className="text-slate-400 hover:text-red-600 dark:hover:text-red-400 p-1 hover:bg-slate-200 dark:hover:bg-google-dark-border rounded"
                  title={t.close}
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              )}
            </div>
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

              <CheckboxOption checked={showGeometry} onChange={setShowGeometry} label={t.showGeometry} />

              <CheckboxOption
                checked={showSkeletonOrigin}
                onChange={setShowSkeletonOrigin}
                label={t.showOrigin}
              />
              {showSkeletonOrigin && (
                <SliderOption
                  label={t.frameSize}
                  value={frameSize}
                  onChange={setFrameSize}
                  min={0.01}
                  max={0.5}
                  step={0.01}
                />
              )}

              <CheckboxOption checked={showLabels} onChange={setShowLabels} label={t.showLabels} />
              {showLabels && (
                <SliderOption
                  label={t.labelScale}
                  value={labelScale}
                  onChange={setLabelScale}
                  min={0.1}
                  max={2.0}
                  step={0.1}
                  decimals={1}
                />
              )}

              <CheckboxOption
                checked={showJointAxes}
                onChange={setShowJointAxes}
                label={t.showJointAxes}
              />
              {showJointAxes && (
                <SliderOption
                  label={t.jointAxisSize}
                  value={jointAxisSize}
                  onChange={setJointAxisSize}
                  min={0.01}
                  max={2.0}
                  step={0.01}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }
);

SkeletonOptionsPanel.displayName = 'SkeletonOptionsPanel';
