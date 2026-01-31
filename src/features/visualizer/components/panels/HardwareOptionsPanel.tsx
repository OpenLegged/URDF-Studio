import React, { forwardRef } from 'react';
import { Language, translations } from '@/shared/i18n';
import { CheckboxOption } from '@/shared/components/Panel/OptionsPanel';

interface HardwareOptionsPanelProps {
  lang: Language;
  showHardwareOrigin: boolean;
  setShowHardwareOrigin: (show: boolean) => void;
  showHardwareLabels: boolean;
  setShowHardwareLabels: (show: boolean) => void;
  isCollapsed: boolean;
  toggleCollapsed: () => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onResetPosition: () => void;
  onClose?: () => void;
  optionsPanelPos: { x: number; y: number } | null;
}

export const HardwareOptionsPanel = forwardRef<HTMLDivElement, HardwareOptionsPanelProps>(
  (
    {
      lang,
      showHardwareOrigin,
      setShowHardwareOrigin,
      showHardwareLabels,
      setShowHardwareLabels,
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
              {t.hardwareOptions}
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
              <CheckboxOption
                checked={showHardwareOrigin}
                onChange={setShowHardwareOrigin}
                label={t.showOrigin}
              />
              <CheckboxOption
                checked={showHardwareLabels}
                onChange={setShowHardwareLabels}
                label={t.showLabels}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }
);

HardwareOptionsPanel.displayName = 'HardwareOptionsPanel';
