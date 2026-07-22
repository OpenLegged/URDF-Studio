import React, { forwardRef } from 'react';
import { ArrowUpRight, Move, Shapes, Shield } from 'lucide-react';
import { Language, translations } from '@/shared/i18n';
import { WORKSPACE_OVERLAY_RIGHT_EDGE_GAP } from '@/shared/components/3d/scene';
import {
  ORIGIN_AXES_SIZE_FALLBACK_MAX,
  ORIGIN_AXES_SIZE_MIN,
  ORIGIN_AXES_SIZE_STEP,
} from '@/shared/components/3d/helpers/coordinateAxesSizing';
import {
  CheckboxOption,
  OptionsPanelContainer,
  OptionsPanelContent,
  OptionsPanelHeader,
  PanelOverlayToggleButton,
  ToggleSliderOption,
} from './OptionsPanel';

interface UnifiedVisualizerOptionsPanelProps {
  lang: Language;
  showVisual: boolean;
  setShowVisual: (show: boolean) => void;
  showOrigin: boolean;
  setShowOrigin: (show: boolean) => void;
  showOriginOverlay?: boolean;
  setShowOriginOverlay?: (show: boolean) => void;
  frameSize: number;
  setFrameSize: (size: number) => void;
  frameSizeMax?: number;
  showLabels: boolean;
  setShowLabels: (show: boolean) => void;
  labelScale: number;
  setLabelScale: (scale: number) => void;
  showJointAxes: boolean;
  setShowJointAxes: (show: boolean) => void;
  showJointAxesOverlay?: boolean;
  setShowJointAxesOverlay?: (show: boolean) => void;
  jointAxisSize: number;
  setJointAxisSize: (size: number) => void;
  showCollision: boolean;
  setShowCollision: (show: boolean) => void;
  showCollisionAlwaysOnTop: boolean;
  setShowCollisionAlwaysOnTop: (show: boolean) => void;
  showInertia: boolean;
  setShowInertia: (show: boolean) => void;
  showInertiaOverlay?: boolean;
  setShowInertiaOverlay?: (show: boolean) => void;
  showCenterOfMass: boolean;
  setShowCenterOfMass: (show: boolean) => void;
  showCoMOverlay?: boolean;
  setShowCoMOverlay?: (show: boolean) => void;
  modelOpacity: number;
  setModelOpacity: (opacity: number) => void;
  isCollapsed: boolean;
  toggleCollapsed: () => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onResetPosition: () => void;
  onClose?: () => void;
  optionsPanelPos: { x: number; y: number } | null;
  onAutoFitGround?: () => void;
  groundPlaneOffset: number;
  setGroundPlaneOffset: (value: number) => void;
  zIndex?: number;
  onActivate?: () => void;
}

export const UnifiedVisualizerOptionsPanel = forwardRef<
  HTMLDivElement,
  UnifiedVisualizerOptionsPanelProps
>(
  (
    {
      lang,
      showVisual,
      setShowVisual,
      showOrigin,
      setShowOrigin,
      showOriginOverlay = false,
      setShowOriginOverlay,
      frameSize,
      setFrameSize,
      frameSizeMax = ORIGIN_AXES_SIZE_FALLBACK_MAX,
      showLabels,
      setShowLabels,
      labelScale,
      setLabelScale,
      showJointAxes,
      setShowJointAxes,
      showJointAxesOverlay = false,
      setShowJointAxesOverlay,
      jointAxisSize,
      setJointAxisSize,
      showCollision,
      setShowCollision,
      showCollisionAlwaysOnTop,
      setShowCollisionAlwaysOnTop,
      showInertia,
      setShowInertia,
      showInertiaOverlay = false,
      setShowInertiaOverlay,
      showCenterOfMass,
      setShowCenterOfMass,
      showCoMOverlay = false,
      setShowCoMOverlay,
      isCollapsed,
      toggleCollapsed,
      onMouseDown,
      onResetPosition,
      onClose,
      optionsPanelPos,
      zIndex = 40,
      onActivate,
    },
    ref,
  ) => {
    const t = translations[lang];
    const isEnglish = lang === 'en';
    const englishCheckboxLabelClassName = isEnglish ? 'text-[10px]' : '';
    const englishSliderLabelClassName = isEnglish ? 'text-[9px]' : '';
    const detailOptionIconClassName = 'w-3 h-3 text-text-tertiary';
    const renderOverlayToggle = (
      checked: boolean,
      active: boolean,
      onToggle: ((show: boolean) => void) | undefined,
    ) =>
      checked && onToggle ? (
        <PanelOverlayToggleButton
          active={active}
          label={t.alwaysOnTop}
          onClick={() => onToggle(!active)}
        />
      ) : undefined;

    return (
      <div
        ref={ref}
        className="absolute pointer-events-auto"
        style={
          optionsPanelPos
            ? { left: optionsPanelPos.x, top: optionsPanelPos.y, right: 'auto', zIndex }
            : { top: '16px', right: WORKSPACE_OVERLAY_RIGHT_EDGE_GAP, zIndex }
        }
        onPointerDownCapture={onActivate}
        onFocusCapture={onActivate}
      >
        <OptionsPanelContainer
          width="10rem"
          minWidth={156}
          resizable={true}
          isCollapsed={isCollapsed}
          resizeTitle={t.resize}
        >
          <OptionsPanelHeader
            title={t.viewOptions}
            isCollapsed={isCollapsed}
            onToggleCollapse={() => {
              onResetPosition();
              toggleCollapsed();
            }}
            onClose={onClose}
            showDragGrip={false}
            onMouseDown={onMouseDown}
            className="gap-1.5 px-2"
            expandText={t.expand}
            collapseText={t.collapse}
            closeText={t.close}
          />

          <OptionsPanelContent isCollapsed={isCollapsed}>
            <div className="px-2 py-2 space-y-2">
              <CheckboxOption
                checked={showVisual}
                onChange={setShowVisual}
                icon={<Shapes className="w-3 h-3 text-emerald-500 dark:text-emerald-400" />}
                label={t.showVisual}
                labelClassName={englishCheckboxLabelClassName}
              />

              <ToggleSliderOption
                checked={showCollision}
                onChange={setShowCollision}
                icon={<Shield className="w-3 h-3 text-amber-500 dark:text-amber-400" />}
                label={t.showCollision}
                labelClassName={englishCheckboxLabelClassName}
                rowClassName="pr-1"
                trailingControl={
                  showCollision ? (
                    <PanelOverlayToggleButton
                      active={showCollisionAlwaysOnTop}
                      label={t.alwaysOnTop}
                      onClick={() => setShowCollisionAlwaysOnTop(!showCollisionAlwaysOnTop)}
                    />
                  ) : undefined
                }
              />

              <ToggleSliderOption
                checked={showOrigin}
                onChange={setShowOrigin}
                icon={<Move className={detailOptionIconClassName} />}
                label={t.showOrigin}
                className="mt-1"
                labelClassName={englishCheckboxLabelClassName}
                rowClassName="pr-1"
                trailingControl={renderOverlayToggle(
                  showOrigin,
                  showOriginOverlay,
                  setShowOriginOverlay,
                )}
                sliderConfig={{
                  label: t.frameSize,
                  value: frameSize,
                  onChange: setFrameSize,
                  min: ORIGIN_AXES_SIZE_MIN,
                  max: frameSizeMax,
                  step: ORIGIN_AXES_SIZE_STEP,
                  compact: true,
                  indent: false,
                  labelClassName: englishSliderLabelClassName,
                }}
              />

              <ToggleSliderOption
                checked={showLabels}
                onChange={setShowLabels}
                label={t.showLabels}
                className="mt-1"
                labelClassName={englishCheckboxLabelClassName}
                sliderConfig={{
                  label: t.labelScale,
                  value: labelScale,
                  onChange: setLabelScale,
                  min: 0.1,
                  max: 2.0,
                  step: 0.1,
                  decimals: 1,
                  compact: true,
                  indent: false,
                  labelClassName: englishSliderLabelClassName,
                }}
              />

              <ToggleSliderOption
                checked={showJointAxes}
                onChange={setShowJointAxes}
                icon={<ArrowUpRight className="w-3 h-3 text-red-500" />}
                label={t.showJointAxes}
                className="mt-1"
                labelClassName={englishCheckboxLabelClassName}
                rowClassName="pr-1"
                trailingControl={renderOverlayToggle(
                  showJointAxes,
                  showJointAxesOverlay,
                  setShowJointAxesOverlay,
                )}
                sliderConfig={{
                  label: t.jointAxisSize,
                  value: jointAxisSize,
                  onChange: setJointAxisSize,
                  min: 0.01,
                  max: 2.0,
                  step: 0.01,
                  compact: true,
                  indent: false,
                  labelClassName: englishSliderLabelClassName,
                }}
              />

              <ToggleSliderOption
                checked={showInertia}
                onChange={setShowInertia}
                icon={<div className="h-3 w-3 border border-dashed border-slate-500" />}
                label={t.showInertia}
                className="mt-1"
                labelClassName={englishCheckboxLabelClassName}
                rowClassName="pr-1"
                trailingControl={renderOverlayToggle(
                  showInertia,
                  showInertiaOverlay,
                  setShowInertiaOverlay,
                )}
              />

              <ToggleSliderOption
                checked={showCenterOfMass}
                onChange={setShowCenterOfMass}
                icon={
                  <div className="flex h-3 w-3 items-center justify-center rounded-full border border-slate-500">
                    <div className="h-1 w-1 rounded-full bg-slate-500" />
                  </div>
                }
                label={t.showCenterOfMass}
                className="mt-1"
                labelClassName={englishCheckboxLabelClassName}
                rowClassName="pr-1"
                trailingControl={renderOverlayToggle(
                  showCenterOfMass,
                  showCoMOverlay,
                  setShowCoMOverlay,
                )}
              />
            </div>
          </OptionsPanelContent>
        </OptionsPanelContainer>
      </div>
    );
  },
);

UnifiedVisualizerOptionsPanel.displayName = 'UnifiedVisualizerOptionsPanel';
