import React from 'react';
import { ArrowUpRight, Move, Shapes, Shield } from 'lucide-react';
import {
  CheckboxOption,
  OptionsPanelContainer,
  OptionsPanelHeader,
  OptionsPanelContent,
  PanelOverlayToggleButton,
  ToggleSliderOption,
} from '@/shared/components/Panel/OptionsPanel';
import { WORKSPACE_OVERLAY_RIGHT_EDGE_GAP } from '@/shared/components/3d/scene';
import {
  ORIGIN_AXES_SIZE_FALLBACK_MAX,
  ORIGIN_AXES_SIZE_MIN,
  ORIGIN_AXES_SIZE_STEP,
} from '@/shared/components/3d/helpers/coordinateAxesSizing';
import { useOverlayHoverBlock } from '@/shared/hooks/useOverlayHoverBlock';

interface ViewerOptionsPanelProps {
  showOptionsPanel: boolean;
  optionsPanelRef: React.RefObject<HTMLDivElement | null>;
  optionsPanelPos: { x: number; y: number } | null;
  defaultPosition?: {
    top?: string;
    right?: string;
    left?: string;
    bottom?: string;
    transform?: string;
  };
  onMouseDown: (e: React.MouseEvent) => void;
  t: any;
  isOptionsCollapsed: boolean;
  toggleOptionsCollapsed: () => void;
  setShowOptionsPanel?: (show: boolean) => void;
  showVisual: boolean;
  setShowVisual: (show: boolean) => void;
  showCollision: boolean;
  setShowCollision: (show: boolean) => void;
  showCollisionAlwaysOnTop: boolean;
  setShowCollisionAlwaysOnTop: (show: boolean) => void;
  modelOpacity: number;
  setModelOpacity: (opacity: number) => void;
  showOrigins: boolean;
  setShowOrigins: (show: boolean) => void;
  showOriginsOverlay: boolean;
  setShowOriginsOverlay: (show: boolean) => void;
  originSize: number;
  setOriginSize: (size: number) => void;
  originSizeMax?: number;
  showMjcfSiteToggle?: boolean;
  showMjcfSites: boolean;
  setShowMjcfSites: (show: boolean) => void;
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
  onAutoFitGround?: () => void;
  groundPlaneOffset: number;
  groundPlaneOffsetReadOnly?: boolean;
  setGroundPlaneOffset: (value: number) => void;
  zIndex?: number;
  onActivate?: () => void;
}

interface OverlayToggleOptionProps {
  checked: boolean;
  className?: string;
  icon: React.ReactNode;
  label: string;
  onChange: (checked: boolean) => void;
  onToggleOverlay: () => void;
  overlayActive: boolean;
  overlayLabel: string;
  sliderConfig?: {
    decimals?: number;
    label: string;
    max: number;
    min: number;
    onChange: (value: number) => void;
    step: number;
    value: number;
  };
}

function OverlayToggleOption({
  checked,
  className,
  icon,
  label,
  onChange,
  onToggleOverlay,
  overlayActive,
  overlayLabel,
  sliderConfig,
}: OverlayToggleOptionProps) {
  return (
    <ToggleSliderOption
      checked={checked}
      onChange={onChange}
      label={label}
      icon={icon}
      className={className}
      rowClassName="pr-1"
      trailingControl={
        checked ? (
          <PanelOverlayToggleButton
            active={overlayActive}
            label={overlayLabel}
            onClick={onToggleOverlay}
          />
        ) : undefined
      }
      sliderConfig={
        sliderConfig
          ? {
              label: sliderConfig.label,
              value: sliderConfig.value,
              onChange: sliderConfig.onChange,
              min: sliderConfig.min,
              max: sliderConfig.max,
              step: sliderConfig.step,
              decimals: sliderConfig.decimals,
              compact: true,
              indent: false,
            }
          : undefined
      }
    />
  );
}

export const ViewerOptionsPanel: React.FC<ViewerOptionsPanelProps> = ({
  showOptionsPanel,
  optionsPanelRef,
  optionsPanelPos,
  defaultPosition,
  onMouseDown,
  t,
  isOptionsCollapsed,
  toggleOptionsCollapsed,
  setShowOptionsPanel,
  showVisual,
  setShowVisual,
  showCollision,
  setShowCollision,
  showCollisionAlwaysOnTop,
  setShowCollisionAlwaysOnTop,
  showOrigins,
  setShowOrigins,
  showOriginsOverlay,
  setShowOriginsOverlay,
  originSize,
  setOriginSize,
  originSizeMax = ORIGIN_AXES_SIZE_FALLBACK_MAX,
  showMjcfSiteToggle = false,
  showMjcfSites,
  setShowMjcfSites,
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
  zIndex,
  onActivate,
}) => {
  const { activateHoverBlock, deactivateHoverBlock } = useOverlayHoverBlock();
  const detailOptionIconClassName = 'w-3 h-3 text-slate-500';

  if (!showOptionsPanel) return null;

  const stopPanelEventPropagation = (event: React.SyntheticEvent) => {
    event.stopPropagation();
  };
  const handlePanelFocus = (event: React.FocusEvent<HTMLDivElement>) => {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
      return;
    }
    onActivate?.();
    activateHoverBlock();
  };
  const handlePanelBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
      return;
    }
    deactivateHoverBlock();
  };

  return (
    <div
      ref={optionsPanelRef}
      className="urdf-options-panel absolute pointer-events-auto"
      style={
        optionsPanelPos
          ? {
              left: optionsPanelPos.x,
              top: optionsPanelPos.y,
              right: 'auto',
              bottom: 'auto',
              transform: 'none',
              zIndex,
            }
          : {
              ...(defaultPosition ?? { top: '16px', right: WORKSPACE_OVERLAY_RIGHT_EDGE_GAP }),
              zIndex,
            }
      }
      onClick={stopPanelEventPropagation}
      onContextMenu={stopPanelEventPropagation}
      onDoubleClick={stopPanelEventPropagation}
      onKeyDown={stopPanelEventPropagation}
      onMouseEnter={activateHoverBlock}
      onMouseLeave={deactivateHoverBlock}
      onFocus={handlePanelFocus}
      onBlur={handlePanelBlur}
      onPointerDownCapture={onActivate}
      onPointerDown={stopPanelEventPropagation}
      onWheel={stopPanelEventPropagation}
      role="toolbar"
      aria-label={t.viewOptions}
      tabIndex={-1}
    >
      <OptionsPanelContainer
        width="9.5rem"
        minWidth={148}
        resizable={true}
        isCollapsed={isOptionsCollapsed}
        resizeTitle={t.resize}
      >
        <OptionsPanelHeader
          title={t.viewOptions}
          isCollapsed={isOptionsCollapsed}
          onToggleCollapse={toggleOptionsCollapsed}
          onClose={() => setShowOptionsPanel && setShowOptionsPanel(false)}
          showDragGrip={false}
          onMouseDown={onMouseDown}
          className="!h-auto !gap-1.5 !px-1.5 !py-1"
          titleClassName="!text-[11px] !text-text-secondary"
          expandText={t.expand}
          collapseText={t.collapse}
          closeText={t.close}
        />

        <OptionsPanelContent isCollapsed={isOptionsCollapsed}>
          <div className="px-2 py-2 space-y-2">
            <CheckboxOption
              checked={showVisual}
              onChange={setShowVisual}
              icon={<Shapes className="w-3 h-3 text-emerald-500 dark:text-emerald-400" />}
              label={t.showVisual}
            />
            <ToggleSliderOption
              checked={showCollision}
              onChange={setShowCollision}
              icon={<Shield className="w-3 h-3 text-amber-500 dark:text-amber-400" />}
              label={t.showCollision}
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

            {showMjcfSiteToggle ? (
              <CheckboxOption
                checked={showMjcfSites}
                onChange={setShowMjcfSites}
                label={t.showMjcfSites}
              />
            ) : null}

            <OverlayToggleOption
              checked={showOrigins}
              icon={<Move className={detailOptionIconClassName} />}
              label={t.showOrigin}
              onChange={setShowOrigins}
              onToggleOverlay={() => setShowOriginsOverlay(!showOriginsOverlay)}
              overlayActive={showOriginsOverlay}
              overlayLabel={t.alwaysOnTop}
              sliderConfig={{
                label: t.size,
                value: originSize,
                onChange: setOriginSize,
                min: ORIGIN_AXES_SIZE_MIN,
                max: originSizeMax,
                step: ORIGIN_AXES_SIZE_STEP,
              }}
            />

            <OverlayToggleOption
              checked={showJointAxes}
              className="mt-1"
              icon={<ArrowUpRight className="w-3 h-3 text-red-500" />}
              label={t.showJointAxes}
              onChange={setShowJointAxes}
              onToggleOverlay={() => setShowJointAxesOverlay(!showJointAxesOverlay)}
              overlayActive={showJointAxesOverlay}
              overlayLabel={t.alwaysOnTop}
              sliderConfig={{
                label: t.size,
                value: jointAxisSize,
                onChange: setJointAxisSize,
                min: 0.01,
                max: 2.0,
                step: 0.01,
              }}
            />

            <OverlayToggleOption
              checked={showCenterOfMass}
              icon={
                <div className="flex h-3 w-3 items-center justify-center rounded-full border border-slate-500">
                  <div className="h-1 w-1 rounded-full bg-slate-500"></div>
                </div>
              }
              label={t.showCenterOfMass}
              onChange={setShowCenterOfMass}
              onToggleOverlay={() => setShowCoMOverlay(!showCoMOverlay)}
              overlayActive={showCoMOverlay}
              overlayLabel={t.alwaysOnTop}
              sliderConfig={{
                label: t.size,
                value: centerOfMassSize,
                onChange: setCenterOfMassSize,
                min: 0.005,
                max: 0.1,
                step: 0.005,
                decimals: 3,
              }}
            />

            <OverlayToggleOption
              checked={showInertia}
              className="mt-1"
              icon={<div className="h-3 w-3 border border-dashed border-slate-500"></div>}
              label={t.showInertia}
              onChange={setShowInertia}
              onToggleOverlay={() => setShowInertiaOverlay(!showInertiaOverlay)}
              overlayActive={showInertiaOverlay}
              overlayLabel={t.alwaysOnTop}
            />
          </div>
        </OptionsPanelContent>
      </OptionsPanelContainer>
    </div>
  );
};
