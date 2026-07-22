import { Check, Crosshair, ListTree, MousePointer2, RotateCcw } from 'lucide-react';

import { PanelSelect, SegmentedControl, type SelectOption } from '@/shared/components/ui';
import type { JointPickSide } from '@/store/jointPickSessionStore';

import { BRIDGE_PANEL_SELECT_CLASS } from './bridgeCreateModalStyles';
import type { BridgeEndpointInputMode } from './bridgeCreateModalTypes';

const ENDPOINT_TONE = {
  parent: {
    accent: 'bg-system-blue',
    badge: 'border-system-blue/30 bg-system-blue/10 text-system-blue',
    active: 'border-system-blue/45 ring-2 ring-system-blue/15',
  },
  child: {
    accent: 'bg-success',
    badge: 'border-success/30 bg-success/10 text-success',
    active: 'border-success/45 ring-2 ring-success/15',
  },
} as const;

interface BridgeGeometryEndpointRailProps {
  side: JointPickSide;
  title: string;
  summary: string;
  detail: string;
  componentId: string;
  linkId: string;
  componentSummary: string;
  linkSummary: string;
  active: boolean;
  snapped: boolean;
  clearLabel: string;
  onActivate: () => void;
  onClear: () => void;
}

export function BridgeGeometryEndpointRail({
  side,
  title,
  summary,
  detail,
  componentId,
  linkId,
  componentSummary,
  linkSummary,
  active,
  snapped,
  clearLabel,
  onActivate,
  onClear,
}: BridgeGeometryEndpointRailProps) {
  const tone = ENDPOINT_TONE[side];

  return (
    <div
      data-bridge-endpoint-rail={side}
      data-bridge-endpoint-active={String(active)}
      data-bridge-endpoint-snapped={String(snapped)}
      data-bridge-endpoint-component-id={componentId}
      data-bridge-endpoint-link-id={linkId}
      data-bridge-side={side}
      data-bridge-component-summary={componentSummary}
      data-bridge-link-summary={linkSummary}
      className={`group relative flex min-w-0 items-stretch overflow-hidden rounded-lg border bg-element-bg/45 transition-[border-color,box-shadow,background-color] ${
        active ? tone.active : 'border-border-black/70 hover:border-border-strong'
      }`}
    >
      <div className={`w-1 shrink-0 ${tone.accent}`} aria-hidden="true" />
      <button
        type="button"
        aria-pressed={active}
        onClick={onActivate}
        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-system-blue/30"
      >
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${tone.badge}`}
          aria-hidden="true"
        >
          {snapped ? <Check className="h-3.5 w-3.5" /> : <Crosshair className="h-3.5 w-3.5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="shrink-0 text-[9px] font-semibold uppercase tracking-[0.1em] text-text-tertiary">
              {title}
            </span>
            {active ? (
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.accent}`} />
            ) : null}
          </span>
          <span className="block truncate text-[11px] font-medium text-text-primary">
            {summary}
          </span>
          <span className="block truncate text-[9px] leading-3 text-text-tertiary">{detail}</span>
        </span>
      </button>
      {snapped ? (
        <button
          type="button"
          aria-label={clearLabel}
          title={clearLabel}
          onClick={onClear}
          className="m-1.5 ml-0 flex w-6 shrink-0 items-center justify-center rounded-md text-text-tertiary outline-none transition-colors hover:bg-element-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-system-blue/30"
        >
          <RotateCcw className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}

interface BridgeLinkEndpointSelectProps {
  side: JointPickSide;
  title: string;
  ariaLabel: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
}

export function BridgeLinkEndpointSelect({
  side,
  title,
  ariaLabel,
  options,
  value,
  onChange,
}: BridgeLinkEndpointSelectProps) {
  const tone = ENDPOINT_TONE[side];

  return (
    <div
      data-bridge-link-endpoint={side}
      className="relative grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2 overflow-hidden rounded-lg border border-border-black/70 bg-element-bg/35 px-2 py-1.5"
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${tone.accent}`} aria-hidden="true" />
      <span className="pl-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
        {title}
      </span>
      <PanelSelect
        variant="property"
        aria-label={ariaLabel}
        options={options}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={BRIDGE_PANEL_SELECT_CLASS}
      />
    </div>
  );
}

export interface BridgeEndpointRailViewModel {
  title: string;
  summary: string;
  detail: string;
  componentId: string;
  linkId: string;
  componentSummary: string;
  linkSummary: string;
  active: boolean;
  snapped: boolean;
  clearLabel: string;
}

interface BridgeEndpointChooserProps {
  mode: BridgeEndpointInputMode;
  modeAriaLabel: string;
  geometryModeLabel: string;
  linkListModeLabel: string;
  liveStatus: string;
  parentEndpoint: BridgeEndpointRailViewModel;
  childEndpoint: BridgeEndpointRailViewModel;
  freePointHint: string;
  parentLinkAriaLabel: string;
  childLinkAriaLabel: string;
  parentLinkOptions: SelectOption[];
  childLinkOptions: SelectOption[];
  parentLinkValue: string;
  childLinkValue: string;
  onModeChange: (mode: BridgeEndpointInputMode) => void;
  onEndpointActivate: (side: JointPickSide) => void;
  onEndpointClear: (side: JointPickSide) => void;
  onLinkChange: (side: JointPickSide, value: string) => void;
}

export function BridgeEndpointChooser({
  mode,
  modeAriaLabel,
  geometryModeLabel,
  linkListModeLabel,
  liveStatus,
  parentEndpoint,
  childEndpoint,
  freePointHint,
  parentLinkAriaLabel,
  childLinkAriaLabel,
  parentLinkOptions,
  childLinkOptions,
  parentLinkValue,
  childLinkValue,
  onModeChange,
  onEndpointActivate,
  onEndpointClear,
  onLinkChange,
}: BridgeEndpointChooserProps) {
  return (
    <div data-bridge-input-mode={mode} data-bridge-section-panel="relation" className="space-y-2">
      <SegmentedControl
        ariaLabel={modeAriaLabel}
        options={[
          {
            value: 'geometry',
            label: geometryModeLabel,
            icon: <MousePointer2 className="h-3 w-3" />,
          },
          {
            value: 'link',
            label: linkListModeLabel,
            icon: <ListTree className="h-3 w-3" />,
          },
        ]}
        value={mode}
        onChange={onModeChange}
        size="xs"
        className="w-full [&>button]:min-h-7"
      />
      <span className="sr-only" role="status" aria-live="polite">
        {liveStatus}
      </span>

      {mode === 'geometry' ? (
        <div className="space-y-1.5">
          <BridgeGeometryEndpointRail
            side="parent"
            {...parentEndpoint}
            onActivate={() => onEndpointActivate('parent')}
            onClear={() => onEndpointClear('parent')}
          />

          <div className="flex h-3 items-center pl-[19px]" aria-hidden="true">
            <div className="h-full w-px bg-border-strong" />
          </div>

          <BridgeGeometryEndpointRail
            side="child"
            {...childEndpoint}
            onActivate={() => onEndpointActivate('child')}
            onClear={() => onEndpointClear('child')}
          />

          <p className="px-1 text-[9px] leading-4 text-text-tertiary">{freePointHint}</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          <BridgeLinkEndpointSelect
            side="parent"
            title={parentEndpoint.title}
            ariaLabel={parentLinkAriaLabel}
            options={parentLinkOptions}
            value={parentLinkValue}
            onChange={(value) => onLinkChange('parent', value)}
          />
          <BridgeLinkEndpointSelect
            side="child"
            title={childEndpoint.title}
            ariaLabel={childLinkAriaLabel}
            options={childLinkOptions}
            value={childLinkValue}
            onChange={(value) => onLinkChange('child', value)}
          />
        </div>
      )}
    </div>
  );
}
