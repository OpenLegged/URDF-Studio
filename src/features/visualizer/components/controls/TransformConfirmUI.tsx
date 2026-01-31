import React, { memo } from 'react';
import { Html } from '@react-three/drei';
import * as THREE from 'three';

interface TransformConfirmUIProps {
  pendingEdit: {
    axis: string;
    value: number;
    startValue: number;
    isRotate: boolean;
  };
  worldPosition: THREE.Vector3;
  getDisplayValue: () => string;
  getDeltaDisplay: () => string;
  handleValueChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  handleConfirm: () => void;
  handleCancel: () => void;
  confirmTitle?: string;
}

/**
 * TransformConfirmUI - Input UI for confirming/canceling transform edits
 *
 * Features:
 * - Displays input field with axis indicator
 * - Shows current value and delta
 * - Confirm/Cancel buttons
 * - Keyboard shortcuts (Enter/Esc)
 */
export const TransformConfirmUI = memo(function TransformConfirmUI({
  pendingEdit,
  worldPosition,
  getDisplayValue,
  getDeltaDisplay,
  handleValueChange,
  handleKeyDown,
  handleConfirm,
  handleCancel,
  confirmTitle = 'Confirm (Enter)',
}: TransformConfirmUIProps) {

  const getAxisColor = (axis: string) => {
    if (axis === 'X') return '#ef4444'; // Red
    if (axis === 'Y') return '#22c55e'; // Green
    if (axis === 'Z') return '#3b82f6'; // Blue
    return '#94a3b8'; // Gray
  };

  return (
    <Html
      position={worldPosition.toArray()}
      style={{ pointerEvents: 'auto' }}
      center
      zIndexRange={[100, 0]}
    >
      <div
        className="flex flex-col items-center gap-1"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Compact input with axis indicator */}
        <div className="flex items-center gap-1">
          <span
            className="w-5 h-5 rounded text-white text-xs font-bold flex items-center justify-center shadow"
            style={{ backgroundColor: getAxisColor(pendingEdit.axis) }}
          >
            {pendingEdit.axis}
          </span>
          <input
            type="number"
            step={pendingEdit.isRotate ? "1" : "0.001"}
            value={getDisplayValue()}
            onChange={handleValueChange}
            onKeyDown={handleKeyDown}
            autoFocus
            className="w-20 px-1.5 py-0.5 text-xs font-mono bg-white dark:bg-[#000000] border border-slate-300 dark:border-[#48484A] rounded text-slate-900 dark:text-white focus:outline-none focus:border-blue-500 shadow-lg"
          />
          <span className="text-[10px] text-slate-500 dark:text-slate-400">
            {pendingEdit.isRotate ? '°' : 'm'} ({getDeltaDisplay()})
          </span>
        </div>

        {/* Compact confirm/cancel buttons */}
        <div className="flex gap-1">
          <button
            onClick={handleConfirm}
            className="w-6 h-6 bg-green-500 hover:bg-green-600 text-white rounded shadow flex items-center justify-center transition-colors"
            title={confirmTitle}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </button>
          <button
            onClick={handleCancel}
            className="w-6 h-6 bg-red-500 hover:bg-red-600 text-white rounded shadow flex items-center justify-center transition-colors"
            title="Cancel (Esc)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </Html>
  );
});
