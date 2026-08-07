import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Network, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import {
  clamp,
  DEFAULT_GRAPH_VIEW_TRANSFORM,
  getEdgePath,
  getFittedViewTransform,
  getGraphLayoutKey,
  getSteppedZoomScale,
  GRAPH_MAX_SCALE,
  GRAPH_MIN_SCALE,
  getWheelZoomSensitivity,
  layoutGraph,
  normalizeWheelDelta,
  normalizeWheelPanDelta,
  shouldPanGraphWheel,
  type GraphViewTransform,
  type PositionedGraphNode,
  type StructureGraphNode,
} from '@/core/utils/treeGraphLayout';
import {
  buildAssemblyRootNodes,
  buildChildJointsByParent,
  buildRobotRootNode,
  getNodeEntityRef,
  getNodeKindLabel,
  toRobotState,
} from '@/features/robot-tree/utils/structureGraphBuilder';
import { getTreeRenderRootLinkIds } from '@/core/robot';
import {
  DraggableWindow,
  FLOATING_WINDOW_HEADER_HEIGHT_CLASS,
  FLOATING_WINDOW_RADIUS_CLASS,
  FLOATING_WINDOW_TITLE_CLASS,
} from '@/shared/components/DraggableWindow';
import { CLOSE_BUTTON_DANGER_TERTIARY_CLASS } from '@/shared/components/ui';
import { useDraggableWindow } from '@/shared/hooks/useDraggableWindow';
import type { TranslationKeys } from '@/shared/i18n';
import { useManagedWindowLayer } from '@/store';
import { matchesSelection, useSelectionStore } from '@/store/selectionStore';
import type { AssemblyState, EntityRef, WorkspaceSelection } from '@/types';

const GRAPH_WINDOW_HEADER_HEIGHT = 40;
const GRAPH_BLANK_CLICK_DRAG_THRESHOLD = 4;
const GRAPH_WINDOW_DEFAULT_SIZE = {
  width: 780,
  height: 560,
} as const;
const GRAPH_WINDOW_MIN_SIZE = {
  width: 420,
  height: 320,
} as const;

interface TreeStructureGraphDialogProps {
  isOpen: boolean;
  onClose: () => void;
  workspace: AssemblyState;
  activeComponentId: string;
  t: TranslationKeys;
  onSelect?: (selection: WorkspaceSelection) => void;
  onFocus?: (ref: EntityRef) => void;
}

interface GraphNodeShapeProps {
  positionedNode: PositionedGraphNode;
  isSelected: boolean;
  isHovered: boolean;
  t: TranslationKeys;
  onActivate: (node: StructureGraphNode) => void;
  onFocusNode: (node: StructureGraphNode) => void;
  onHoverStart: (node: StructureGraphNode) => void;
  onHoverEnd: () => void;
}

const GraphNodeShape = memo(function GraphNodeShape({
  positionedNode,
  isSelected,
  isHovered,
  t,
  onActivate,
  onFocusNode,
  onHoverStart,
  onHoverEnd,
}: GraphNodeShapeProps) {
  const { node, x, y, width, height } = positionedNode;
  const isHighlighted = isSelected || isHovered;
  const isJointLike = node.kind === 'joint' || node.kind === 'bridge';
  const label = node.label;
  const caption = node.caption ?? '';
  const kindLabel = getNodeKindLabel(node.kind, t);
  const ariaLabel = `${kindLabel} ${node.label}`;

  return (
    <g
      role="button"
      tabIndex={0}
      data-structure-graph-node
      aria-label={ariaLabel}
      transform={`translate(${x}, ${y}) scale(${isHovered ? 1.025 : 1})`}
      className="cursor-pointer outline-none"
      onClick={(event) => {
        event.stopPropagation();
        onActivate(node);
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onFocusNode(node);
      }}
      onMouseEnter={() => onHoverStart(node)}
      onMouseLeave={onHoverEnd}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onActivate(node);
      }}
    >
      <title>{ariaLabel}</title>
      {isHighlighted && (
        <rect
          x={-width / 2 - 4}
          y={-height / 2 - 4}
          width={width + 8}
          height={height + 8}
          rx={isJointLike ? height / 2 + 4 : 12}
          fill={isSelected ? 'rgba(0, 122, 255, 0.16)' : 'rgba(15, 23, 42, 0.08)'}
          opacity={isSelected ? 0.95 : 0.72}
          pointerEvents="none"
        />
      )}
      <rect
        x={-width / 2}
        y={-height / 2}
        width={width}
        height={height}
        rx={isJointLike ? height / 2 : 8}
        fill={
          isSelected
            ? 'rgba(0, 122, 255, 0.14)'
            : isHovered
              ? 'var(--ui-surface-elevated)'
              : 'var(--ui-panel-bg)'
        }
        stroke={
          isSelected ? 'var(--ui-accent)' : isHovered ? 'var(--ui-accent)' : 'var(--ui-border)'
        }
        strokeWidth={isHighlighted ? 2.4 : 1.4}
      />
      <text
        y={caption ? -3 : 4}
        textAnchor="middle"
        fill="var(--ui-text-primary)"
        fontSize={12}
        fontWeight={600}
        letterSpacing={0}
        pointerEvents="none"
      >
        {label}
      </text>
      {caption && (
        <text
          y={13}
          textAnchor="middle"
          fill="var(--ui-text-tertiary)"
          fontSize={9.5}
          fontWeight={500}
          letterSpacing={0}
          pointerEvents="none"
        >
          {caption}
        </text>
      )}
    </g>
  );
});

export function TreeStructureGraphDialog({
  isOpen,
  onClose,
  workspace,
  t,
  onSelect,
  onFocus,
}: TreeStructureGraphDialogProps) {
  const [viewTransform, setViewTransform] = useState<GraphViewTransform>(
    DEFAULT_GRAPH_VIEW_TRANSFORM,
  );
  const [isPanning, setIsPanning] = useState(false);
  const [hoveredNodeUid, setHoveredNodeUid] = useState<string | null>(null);
  const structureGraphWindowLayer = useManagedWindowLayer('structureGraph');
  const graphSurfaceRef = useRef<HTMLDivElement | null>(null);
  const viewTransformRef = useRef(viewTransform);
  const hasAutoFitOpenViewRef = useRef(false);
  const lastAutoFitLayoutKeyRef = useRef<string | null>(null);
  const panStartRef = useRef({
    pointerX: 0,
    pointerY: 0,
    transform: DEFAULT_GRAPH_VIEW_TRANSFORM,
    hasDragged: false,
  });
  const windowState = useDraggableWindow({
    isOpen,
    defaultSize: GRAPH_WINDOW_DEFAULT_SIZE,
    minSize: GRAPH_WINDOW_MIN_SIZE,
    centerOnMount: true,
    enableMinimize: false,
    enableMaximize: true,
    clampResizeToViewport: true,
    dragBounds: {
      allowNegativeX: false,
      minVisibleWidth: 280,
      topMargin: 12,
      bottomMargin: 56,
    },
  });
  const [graphViewportSize, setGraphViewportSize] = useState(() => ({
    width: Math.max(1, windowState.size.width),
    height: Math.max(1, windowState.size.height - GRAPH_WINDOW_HEADER_HEIGHT),
  }));
  const graphViewportWidth = graphViewportSize.width;
  const graphViewportHeight = graphViewportSize.height;
  const rootNodes = useMemo(() => {
    const components = Object.values(workspace.components);
    if (components.length === 1 && Object.keys(workspace.bridges).length === 0) {
      const component = components[0];
      const robot = toRobotState(component.robot);
      return [buildRobotRootNode(
        robot,
        getTreeRenderRootLinkIds(robot),
        buildChildJointsByParent(robot.joints),
        t,
        `component:${component.id}`,
        component.id,
      )];
    }

    return buildAssemblyRootNodes(workspace, t);
  }, [t, workspace]);

  const layout = useMemo(() => layoutGraph(rootNodes), [rootNodes]);
  const layoutKey = useMemo(() => getGraphLayoutKey(layout), [layout]);
  const applyViewTransform = useCallback((nextTransform: GraphViewTransform) => {
    viewTransformRef.current = nextTransform;
    setViewTransform(nextTransform);
  }, []);
  const {
    selection,
    hoveredSelection,
    setSelection,
    setHoveredSelection,
    clearHover,
    clearSelection,
  } = useSelectionStore(
    useShallow((state) => ({
      selection: state.selection,
      hoveredSelection: state.hoveredSelection,
      setSelection: state.setSelection,
      setHoveredSelection: state.setHoveredSelection,
      clearHover: state.clearHover,
      clearSelection: state.clearSelection,
    })),
  );

  useEffect(() => {
    viewTransformRef.current = viewTransform;
  }, [viewTransform]);

  const updateGraphViewportSize = useCallback(() => {
    const surface = graphSurfaceRef.current;
    if (!surface) return;

    const rect = surface.getBoundingClientRect();
    const nextWidth = Math.max(1, Math.round(rect.width));
    const nextHeight = Math.max(1, Math.round(rect.height));

    setGraphViewportSize((currentSize) =>
      currentSize.width === nextWidth && currentSize.height === nextHeight
        ? currentSize
        : { width: nextWidth, height: nextHeight },
    );
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    updateGraphViewportSize();

    const surface = graphSurfaceRef.current;
    if (!surface) return;

    const ResizeObserverCtor = window.ResizeObserver;
    const observer = ResizeObserverCtor ? new ResizeObserverCtor(updateGraphViewportSize) : null;
    observer?.observe(surface);
    window.addEventListener('resize', updateGraphViewportSize);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateGraphViewportSize);
    };
  }, [isOpen, updateGraphViewportSize]);

  useEffect(() => {
    if (!isOpen) {
      hasAutoFitOpenViewRef.current = false;
      return;
    }

    const isFirstOpenFit = !hasAutoFitOpenViewRef.current;
    const isStructuralLayoutChange = lastAutoFitLayoutKeyRef.current !== layoutKey;
    if (!isFirstOpenFit && !isStructuralLayoutChange) return;

    hasAutoFitOpenViewRef.current = true;
    lastAutoFitLayoutKeyRef.current = layoutKey;
    applyViewTransform(getFittedViewTransform(layout, graphViewportWidth, graphViewportHeight));
  }, [
    applyViewTransform,
    graphViewportHeight,
    graphViewportWidth,
    isOpen,
    layout,
    layoutKey,
  ]);

  // Re-fit the graph when the window is maximized or restored, mirroring the
  // initial open behavior. The viewport size is updated asynchronously by the
  // ResizeObserver, so defer the fit to the next animation frame to read the
  // post-toggle viewport dimensions.
  const isMaximized = windowState.isMaximized;
  const previousIsMaximizedRef = useRef(isMaximized);
  useEffect(() => {
    if (!isOpen) return;
    if (previousIsMaximizedRef.current === isMaximized) return;
    previousIsMaximizedRef.current = isMaximized;

    const animationFrame = window.requestAnimationFrame(() => {
      const surface = graphSurfaceRef.current;
      if (!surface) return;
      const rect = surface.getBoundingClientRect();
      applyViewTransform(
        getFittedViewTransform(
          layout,
          Math.max(1, Math.round(rect.width)),
          Math.max(1, Math.round(rect.height)),
        ),
      );
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [applyViewTransform, isOpen, isMaximized, layout]);

  useEffect(() => {
    if (!isPanning) return;

    const previousBodyCursor = document.body.style.cursor;
    const previousBodyUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (event: globalThis.MouseEvent) => {
      const deltaX = event.clientX - panStartRef.current.pointerX;
      const deltaY = event.clientY - panStartRef.current.pointerY;
      if (Math.hypot(deltaX, deltaY) >= GRAPH_BLANK_CLICK_DRAG_THRESHOLD) {
        panStartRef.current.hasDragged = true;
      }

      const nextTransform = {
        ...panStartRef.current.transform,
        x: panStartRef.current.transform.x + deltaX,
        y: panStartRef.current.transform.y + deltaY,
      };
      applyViewTransform(nextTransform);
    };

    const handleMouseUp = () => {
      if (!panStartRef.current.hasDragged) {
        clearSelection();
      }
      setIsPanning(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('blur', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', handleMouseUp);
      document.body.style.cursor = previousBodyCursor;
      document.body.style.userSelect = previousBodyUserSelect;
    };
  }, [applyViewTransform, clearSelection, isPanning]);

  const zoomGraphAtPoint = useCallback(
    (nextScale: number, targetX: number, targetY: number) => {
      const currentTransform = viewTransformRef.current;
      const clampedScale = clamp(nextScale, GRAPH_MIN_SCALE, GRAPH_MAX_SCALE);
      if (Math.abs(clampedScale - currentTransform.scale) < 0.001) return;

      const scaleRatio = clampedScale / currentTransform.scale;
      applyViewTransform({
        scale: clampedScale,
        x: targetX - (targetX - currentTransform.x) * scaleRatio,
        y: targetY - (targetY - currentTransform.y) * scaleRatio,
      });
    },
    [applyViewTransform],
  );

  const zoomGraphFromCenter = useCallback(
    (direction: 'in' | 'out') => {
      zoomGraphAtPoint(
        getSteppedZoomScale(viewTransformRef.current.scale, direction),
        graphViewportWidth / 2,
        graphViewportHeight / 2,
      );
    },
    [graphViewportHeight, graphViewportWidth, zoomGraphAtPoint],
  );

  const resetGraphView = useCallback(() => {
    applyViewTransform(getFittedViewTransform(layout, graphViewportWidth, graphViewportHeight));
  }, [applyViewTransform, graphViewportHeight, graphViewportWidth, layout]);

  const handleNativeGraphWheel = useCallback(
    (event: WheelEvent) => {
      event.preventDefault();
      const surface = graphSurfaceRef.current;
      if (!surface) return;

      if (shouldPanGraphWheel(event)) {
        const currentTransform = viewTransformRef.current;
        const panDelta = normalizeWheelPanDelta(event);
        applyViewTransform({
          ...currentTransform,
          x: currentTransform.x - panDelta.x,
          y: currentTransform.y - panDelta.y,
        });
        return;
      }

      const rect = surface.getBoundingClientRect();
      const targetX = event.clientX - rect.left;
      const targetY = event.clientY - rect.top;
      const normalizedDelta = normalizeWheelDelta(event);
      const nextScale =
        viewTransformRef.current.scale *
        Math.exp(-normalizedDelta * getWheelZoomSensitivity(event));
      zoomGraphAtPoint(nextScale, targetX, targetY);
    },
    [applyViewTransform, zoomGraphAtPoint],
  );

  useEffect(() => {
    const surface = graphSurfaceRef.current;
    if (!surface || !isOpen) return;

    const preventBrowserGestureZoom = (event: Event) => event.preventDefault();
    surface.addEventListener('wheel', handleNativeGraphWheel, { passive: false });
    surface.addEventListener('gesturestart', preventBrowserGestureZoom, { passive: false });
    surface.addEventListener('gesturechange', preventBrowserGestureZoom, { passive: false });

    return () => {
      surface.removeEventListener('wheel', handleNativeGraphWheel);
      surface.removeEventListener('gesturestart', preventBrowserGestureZoom);
      surface.removeEventListener('gesturechange', preventBrowserGestureZoom);
    };
  }, [handleNativeGraphWheel, isOpen]);

  const handleGraphMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('[data-structure-graph-node], button, input, textarea, select')) {
      return;
    }

    event.preventDefault();
    panStartRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      transform: viewTransformRef.current,
      hasDragged: false,
    };
    setIsPanning(true);
  }, []);

  const activateNode = (node: StructureGraphNode) => {
    const ref = getNodeEntityRef(node);
    if (!ref) return;
    const next: WorkspaceSelection = { entity: ref };
    setSelection(next);
    onSelect?.(next);
  };

  const focusNode = (node: StructureGraphNode) => {
    const ref = getNodeEntityRef(node);
    if (ref) onFocus?.(ref);
  };

  const hoverNode = (node: StructureGraphNode) => {
    setHoveredNodeUid(node.uid);

    const ref = getNodeEntityRef(node);
    if (ref) setHoveredSelection({ entity: ref });
  };

  const clearNodeHover = () => {
    setHoveredNodeUid(null);
    clearHover();
  };

  const isNodeSelected = (node: StructureGraphNode): boolean => {
    const ref = getNodeEntityRef(node);
    return ref ? matchesSelection(selection, { entity: ref }) : false;
  };

  const isNodeHovered = (node: StructureGraphNode): boolean => {
    const ref = getNodeEntityRef(node);
    return ref ? matchesSelection(hoveredSelection, { entity: ref }) : false;
  };

  if (!isOpen) {
    return null;
  }

  const dialog = (
    <DraggableWindow
      window={windowState}
      onClose={onClose}
      role="dialog"
      ariaLabel={t.structureGraphTitle}
      ariaModal="false"
      title={
        <div className="flex items-center gap-2">
          <div className="rounded-lg border border-border-black bg-panel-bg p-1 text-system-blue shadow-sm">
            <Network className="h-3 w-3" />
          </div>
          <div className={`tracking-[0.01em] ${FLOATING_WINDOW_TITLE_CLASS}`}>
            {t.structureGraphTitle}
          </div>
        </div>
      }
      headerActions={
        <div className="flex items-center gap-1" data-window-control>
          <button
            type="button"
            className="rounded-md p-1 text-text-tertiary transition-colors hover:bg-panel-bg hover:text-text-primary"
            title={t.structureGraphZoomOut}
            aria-label={t.structureGraphZoomOut}
            onClick={() => zoomGraphFromCenter('out')}
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="rounded-md p-1 text-text-tertiary transition-colors hover:bg-panel-bg hover:text-text-primary"
            title={t.structureGraphZoomIn}
            aria-label={t.structureGraphZoomIn}
            onClick={() => zoomGraphFromCenter('in')}
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="rounded-md p-1 text-text-tertiary transition-colors hover:bg-panel-bg hover:text-text-primary"
            title={t.structureGraphResetView}
            aria-label={t.structureGraphResetView}
            onClick={resetGraphView}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>
      }
      className={`overflow-hidden ${FLOATING_WINDOW_RADIUS_CLASS} border border-border-black bg-panel-bg/60 text-text-primary shadow-xl pointer-events-auto`}
      zIndex={structureGraphWindowLayer.zIndex}
      onActivate={structureGraphWindowLayer.onActivate}
      headerClassName={`flex ${FLOATING_WINDOW_HEADER_HEIGHT_CLASS} shrink-0 items-center justify-between border-b border-border-black bg-element-bg px-3`}
      interactionClassName="select-none"
      controlButtonClassName="rounded-md p-1 text-text-tertiary transition-colors hover:bg-panel-bg hover:text-text-primary"
      closeButtonClassName={`rounded-md p-1 ${CLOSE_BUTTON_DANGER_TERTIARY_CLASS}`}
      controlIcons={{ close: <X className="h-3.5 w-3.5" /> }}
      showMinimizeButton={false}
      showMaximizeButton
      showResizeHandles
      maximizeTitle={t.maximize}
      restoreTitle={t.restore}
      leftResizeHandleClassName="hidden"
      rightResizeHandleClassName="absolute resize-edge-right resize-edge-visual-right top-0 bottom-3 z-20 w-2 cursor-ew-resize after:absolute after:right-0 after:top-0 after:bottom-0 after:w-px after:bg-transparent after:content-[''] after:transition-colors hover:after:bg-system-blue/50 active:after:bg-system-blue/70"
      bottomResizeHandleClassName="absolute resize-edge-bottom resize-edge-visual-bottom left-0 right-3 z-20 h-2 cursor-ns-resize after:absolute after:bottom-0 after:left-0 after:right-0 after:h-px after:bg-transparent after:content-[''] after:transition-colors hover:after:bg-system-blue/50 active:after:bg-system-blue/70"
      cornerResizeHandleClassName="absolute resize-edge-bottom resize-edge-right z-30 h-3 w-3 cursor-nwse-resize"
      cornerResizeHandle={
        <div className="absolute bottom-0 right-0 h-2.5 w-2.5 border-b border-r border-border-strong/80" />
      }
      closeTitle={t.close}
    >
      <div className="flex h-[calc(100%-40px)] min-h-0 flex-col overflow-hidden">
        <div
          ref={graphSurfaceRef}
          data-testid="structure-graph-surface"
          className={`min-h-0 flex-1 touch-none overflow-hidden overscroll-contain ${
            isPanning ? 'cursor-grabbing' : 'cursor-default'
          }`}
          onMouseDown={handleGraphMouseDown}
          onMouseLeave={() => {
            if (!isPanning) {
              setHoveredNodeUid(null);
            }
          }}
          onKeyDown={(event) => event.stopPropagation()}
          role="button"
          aria-label={t.structureGraphTitle}
          tabIndex={0}
        >
          {layout.nodes.length === 0 ? (
            <div className="flex h-full items-center justify-center text-[12px] text-text-tertiary">
              {t.structureGraphEmpty}
            </div>
          ) : (
            <svg
              data-testid="structure-graph-canvas"
              role="img"
              aria-label={t.structureGraphTitle}
              width="100%"
              height="100%"
              viewBox={`0 0 ${graphViewportWidth} ${graphViewportHeight}`}
              className="block h-full w-full"
            >
              <g
                data-testid="structure-graph-layer"
                transform={`translate(${viewTransform.x} ${viewTransform.y}) scale(${viewTransform.scale})`}
              >
                <g>
                  {layout.edges.map((edge) => (
                    <path
                      key={`${edge.from.node.uid}->${edge.to.node.uid}`}
                      d={getEdgePath(edge)}
                      fill="none"
                      stroke="var(--ui-border-strong)"
                      strokeWidth={1.4}
                      opacity={0.76}
                    />
                  ))}
                </g>
                <g>
                  {layout.nodes.map((positionedNode) => (
                    <GraphNodeShape
                      key={positionedNode.node.uid}
                      positionedNode={positionedNode}
                      isSelected={isNodeSelected(positionedNode.node)}
                      isHovered={
                        hoveredNodeUid === positionedNode.node.uid ||
                        isNodeHovered(positionedNode.node)
                      }
                      t={t}
                      onActivate={activateNode}
                      onFocusNode={focusNode}
                      onHoverStart={hoverNode}
                      onHoverEnd={clearNodeHover}
                    />
                  ))}
                </g>
              </g>
            </svg>
          )}
        </div>
      </div>
    </DraggableWindow>
  );

  return createPortal(dialog, document.body);
}
