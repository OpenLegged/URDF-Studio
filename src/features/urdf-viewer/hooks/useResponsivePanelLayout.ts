import { useEffect, useMemo, useState, type RefObject } from 'react';
import {
  WORKSPACE_OVERLAY_LEFT_EDGE_GAP,
  WORKSPACE_OVERLAY_LEFT_INSET_VAR,
  WORKSPACE_OVERLAY_RIGHT_EDGE_GAP,
  WORKSPACE_OVERLAY_RIGHT_INSET_VAR,
} from '@/shared/components/3d/scene/viewerOverlaySafeArea';

export type FloatingPanelPosition = {
  top?: string;
  right?: string;
  left?: string;
  bottom?: string;
  transform?: string;
};

interface UseResponsivePanelLayoutOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  optionsPanelRef: RefObject<HTMLDivElement | null>;
  jointPanelRef: RefObject<HTMLDivElement | null>;
  showOptionsPanel: boolean;
  showJointPanel: boolean;
  preferEdgeDockedOptionsPanel?: boolean;
  preferEdgeDockedJointPanel?: boolean;
}

export interface ResponsivePanelLayoutMetrics {
  containerWidth: number;
  containerHeight: number;
  leftInset?: number;
  optionsWidth: number;
  optionsHeight: number;
  jointsWidth: number;
  rightInset?: number;
}

export interface ResponsivePanelLayoutResult {
  optionsDefaultPosition: FloatingPanelPosition;
  jointsDefaultPosition: FloatingPanelPosition;
  jointsPanelMaxHeight: number | undefined;
}

const EDGE_GAP = 16;
const PANEL_GAP = 12;
const TOP_PANEL_OFFSET = 16;
const FALLBACK_OPTIONS_WIDTH = 208;
const FALLBACK_OPTIONS_HEIGHT = 208;
const FALLBACK_JOINTS_WIDTH = 208;
const MIN_JOINT_PANEL_HEIGHT = 180;
const SOFT_MAX_JOINT_PANEL_HEIGHT = 420;
const MIN_CLEAR_VIEWER_WIDTH_WITH_OPTIONS_PANEL = 420;
const MIN_CLEAR_VIEWER_WIDTH_WITH_JOINT_PANEL = 320;
const OPTIONS_PANEL_EDGE_REVEAL_WIDTH = 56;
const JOINT_PANEL_EDGE_REVEAL_WIDTH = 56;

const readPanelMetrics = (
  containerRef: RefObject<HTMLDivElement | null>,
  optionsPanelRef: RefObject<HTMLDivElement | null>,
  jointPanelRef: RefObject<HTMLDivElement | null>,
): ResponsivePanelLayoutMetrics => {
  const container = containerRef.current;
  const computedStyle = container ? window.getComputedStyle(container) : null;

  return {
    containerWidth: container?.clientWidth ?? 0,
    containerHeight: container?.clientHeight ?? 0,
    leftInset: readCssPixelValue(computedStyle?.getPropertyValue(WORKSPACE_OVERLAY_LEFT_INSET_VAR)),
    optionsWidth: optionsPanelRef.current?.offsetWidth ?? FALLBACK_OPTIONS_WIDTH,
    optionsHeight: optionsPanelRef.current?.offsetHeight ?? FALLBACK_OPTIONS_HEIGHT,
    jointsWidth: jointPanelRef.current?.offsetWidth ?? FALLBACK_JOINTS_WIDTH,
    rightInset: readCssPixelValue(
      computedStyle?.getPropertyValue(WORKSPACE_OVERLAY_RIGHT_INSET_VAR),
    ),
  };
};

const readCssPixelValue = (value: string | undefined): number => {
  if (!value) return 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

const resolveJointPanelMaxHeight = (availableHeight: number) =>
  Math.max(MIN_JOINT_PANEL_HEIGHT, Math.min(SOFT_MAX_JOINT_PANEL_HEIGHT, availableHeight));

export function resolveResponsivePanelLayout({
  metrics,
  showOptionsPanel,
  showJointPanel,
  preferEdgeDockedOptionsPanel = false,
  preferEdgeDockedJointPanel = false,
}: {
  metrics: ResponsivePanelLayoutMetrics;
  showOptionsPanel: boolean;
  showJointPanel: boolean;
  preferEdgeDockedOptionsPanel?: boolean;
  preferEdgeDockedJointPanel?: boolean;
}): ResponsivePanelLayoutResult {
  const shouldStackPanels =
    showOptionsPanel &&
    showJointPanel &&
    metrics.containerWidth > 0 &&
    metrics.containerWidth < metrics.optionsWidth + metrics.jointsWidth + EDGE_GAP * 2 + PANEL_GAP;
  const shouldEdgeDockOptionsPanel =
    preferEdgeDockedOptionsPanel &&
    showOptionsPanel &&
    metrics.containerWidth > 0 &&
    metrics.containerWidth <
      metrics.optionsWidth + EDGE_GAP * 2 + MIN_CLEAR_VIEWER_WIDTH_WITH_OPTIONS_PANEL;
  const shouldEdgeDockJointPanel =
    preferEdgeDockedJointPanel &&
    showJointPanel &&
    metrics.containerWidth > 0 &&
    metrics.containerWidth <
      metrics.jointsWidth + EDGE_GAP * 2 + MIN_CLEAR_VIEWER_WIDTH_WITH_JOINT_PANEL;
  const hasLeftOverlayInset = (metrics.leftInset ?? 0) > 0;
  const hasRightOverlayInset = (metrics.rightInset ?? 0) > 0;

  const optionsDefaultPosition: FloatingPanelPosition = shouldStackPanels
    ? {
        top: `${TOP_PANEL_OFFSET}px`,
        left: WORKSPACE_OVERLAY_LEFT_EDGE_GAP,
        right: 'auto',
        transform: 'none',
      }
    : metrics.containerWidth > 0 && metrics.containerWidth < 520
      ? {
          top: `${TOP_PANEL_OFFSET}px`,
          left: `${EDGE_GAP}px`,
          right: 'auto',
          transform: 'none',
        }
      : shouldEdgeDockOptionsPanel
      ? hasRightOverlayInset
        ? {
            top: `${TOP_PANEL_OFFSET}px`,
            right: WORKSPACE_OVERLAY_RIGHT_EDGE_GAP,
            left: 'auto',
            transform: 'none',
          }
        : {
            top: `${TOP_PANEL_OFFSET}px`,
            right: `${Math.min(EDGE_GAP, OPTIONS_PANEL_EDGE_REVEAL_WIDTH - metrics.optionsWidth)}px`,
            left: 'auto',
            transform: 'none',
          }
      : { top: '16px', right: WORKSPACE_OVERLAY_RIGHT_EDGE_GAP };

  if (shouldStackPanels) {
    const stackedTop = TOP_PANEL_OFFSET + metrics.optionsHeight + PANEL_GAP;
    const stackedHeight = resolveJointPanelMaxHeight(
      metrics.containerHeight - stackedTop - EDGE_GAP,
    );

    return {
      optionsDefaultPosition,
      jointsDefaultPosition: {
        top: `${stackedTop}px`,
        left: WORKSPACE_OVERLAY_LEFT_EDGE_GAP,
        right: 'auto',
        transform: 'none',
      },
      jointsPanelMaxHeight: stackedHeight,
    };
  }

  if (shouldEdgeDockJointPanel) {
    const dockedTop = TOP_PANEL_OFFSET;
    const dockedHeight = resolveJointPanelMaxHeight(metrics.containerHeight - dockedTop - EDGE_GAP);

    return {
      optionsDefaultPosition,
      jointsDefaultPosition: {
        top: `${dockedTop}px`,
        left: hasLeftOverlayInset
          ? WORKSPACE_OVERLAY_LEFT_EDGE_GAP
          : `${Math.min(EDGE_GAP, JOINT_PANEL_EDGE_REVEAL_WIDTH - metrics.jointsWidth)}px`,
        right: 'auto',
        transform: 'none',
      },
      jointsPanelMaxHeight: dockedHeight,
    };
  }

  return {
    optionsDefaultPosition,
    jointsDefaultPosition: {
      top: '50%',
      left: WORKSPACE_OVERLAY_LEFT_EDGE_GAP,
      transform: 'translateY(-50%)',
    },
    jointsPanelMaxHeight: resolveJointPanelMaxHeight(metrics.containerHeight - EDGE_GAP * 2),
  };
}

export function useResponsivePanelLayout({
  containerRef,
  optionsPanelRef,
  jointPanelRef,
  showOptionsPanel,
  showJointPanel,
  preferEdgeDockedOptionsPanel = false,
  preferEdgeDockedJointPanel = false,
}: UseResponsivePanelLayoutOptions) {
  const [metrics, setMetrics] = useState<ResponsivePanelLayoutMetrics>(() =>
    readPanelMetrics(containerRef, optionsPanelRef, jointPanelRef),
  );

  useEffect(() => {
    const updateMetrics = () => {
      setMetrics(readPanelMetrics(containerRef, optionsPanelRef, jointPanelRef));
    };

    updateMetrics();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateMetrics);
      return () => window.removeEventListener('resize', updateMetrics);
    }

    const observer = new ResizeObserver(updateMetrics);
    const observedNodes = [
      containerRef.current,
      optionsPanelRef.current,
      jointPanelRef.current,
    ].filter((node): node is HTMLDivElement => Boolean(node));

    observedNodes.forEach((node) => observer.observe(node));
    window.addEventListener('resize', updateMetrics);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateMetrics);
    };
  }, [containerRef, jointPanelRef, optionsPanelRef, showJointPanel, showOptionsPanel]);

  return useMemo(
    () =>
      resolveResponsivePanelLayout({
        metrics,
        showOptionsPanel,
        showJointPanel,
        preferEdgeDockedOptionsPanel,
        preferEdgeDockedJointPanel,
      }),
    [
      metrics,
      preferEdgeDockedOptionsPanel,
      preferEdgeDockedJointPanel,
      showJointPanel,
      showOptionsPanel,
    ],
  );
}
