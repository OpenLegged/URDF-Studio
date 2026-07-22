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
import type {
  AssemblyState,
  EntityRef,
  RobotData,
  RobotState,
  UrdfJoint,
  WorkspaceSelection,
} from '@/types';

type GraphNodeKind = 'robot' | 'assembly' | 'component' | 'link' | 'joint' | 'bridge';

interface StructureGraphNode {
  uid: string;
  kind: GraphNodeKind;
  label: string;
  caption?: string;
  id?: string;
  componentId?: string;
  targetLinkId?: string;
  children: StructureGraphNode[];
}

interface PositionedGraphNode {
  node: StructureGraphNode;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface GraphEdge {
  from: PositionedGraphNode;
  to: PositionedGraphNode;
}

interface GraphLayout {
  nodes: PositionedGraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
}

interface LayoutSubtree {
  positionedNode: PositionedGraphNode;
  nodes: PositionedGraphNode[];
  left: number;
  right: number;
}

interface TreeStructureGraphDialogProps {
  isOpen: boolean;
  onClose: () => void;
  workspace: AssemblyState;
  activeComponentId: string;
  t: TranslationKeys;
  onSelect?: (selection: WorkspaceSelection) => void;
  onFocus?: (ref: EntityRef) => void;
}

const GRAPH_PADDING_X = 64;
const GRAPH_PADDING_Y = 48;
const DEPTH_GAP = 112;
const LEAF_GAP = 56;
const GRAPH_WINDOW_HEADER_HEIGHT = 40;
const GRAPH_MIN_SCALE = 0.1;
const GRAPH_MAX_SCALE = 8;
const GRAPH_ZOOM_LEVELS = [0.1, 0.2, 0.35, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8] as const;
const GRAPH_WHEEL_ZOOM_SENSITIVITY = 0.0034;
const GRAPH_PINCH_ZOOM_SENSITIVITY = 0.0026;
const GRAPH_WHEEL_LINE_HEIGHT = 16;
const GRAPH_WHEEL_PAGE_HEIGHT = 800;
const GRAPH_MAX_WHEEL_DELTA = 180;
const GRAPH_MAX_TRACKPAD_PAN_DELTA = 240;
const GRAPH_TRACKPAD_DELTA_THRESHOLD = 64;
const GRAPH_BLANK_CLICK_DRAG_THRESHOLD = 4;
const GRAPH_WINDOW_DEFAULT_SIZE = {
  width: 780,
  height: 560,
} as const;
const GRAPH_WINDOW_MIN_SIZE = {
  width: 420,
  height: 320,
} as const;

interface GraphViewTransform {
  scale: number;
  x: number;
  y: number;
}

const DEFAULT_GRAPH_VIEW_TRANSFORM: GraphViewTransform = {
  scale: 1,
  x: 0,
  y: 0,
};

const NODE_BASE_SIZE: Record<GraphNodeKind, { width: number; height: number }> = {
  robot: { width: 156, height: 44 },
  assembly: { width: 164, height: 44 },
  component: { width: 148, height: 40 },
  link: { width: 136, height: 40 },
  joint: { width: 128, height: 36 },
  bridge: { width: 140, height: 36 },
};
const NODE_LABEL_HORIZONTAL_PADDING = 34;
const NODE_CAPTION_HORIZONTAL_PADDING = 28;
const NODE_LABEL_FONT_SIZE = 12;
const NODE_CAPTION_FONT_SIZE = 9.5;
const WHEEL_DELTA_LINE_MODE = 1;
const WHEEL_DELTA_PAGE_MODE = 2;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function estimateTextWidth(value: string, fontSize: number, fontWeight: number): number {
  const weightFactor = fontWeight >= 600 ? 1.06 : 1;
  let width = 0;

  for (const character of value) {
    if (character === ' ') {
      width += fontSize * 0.34;
    } else if (/[._:-]/.test(character)) {
      width += fontSize * 0.36;
    } else if (/[\dilIjtf]/.test(character)) {
      width += fontSize * 0.38;
    } else if (/[MW@#%]/.test(character)) {
      width += fontSize * 0.78;
    } else if (character.charCodeAt(0) > 127) {
      width += fontSize;
    } else {
      width += fontSize * 0.58;
    }
  }

  return Math.ceil(width * weightFactor);
}

function resolveNodeSize(node: StructureGraphNode): { width: number; height: number } {
  const baseSize = NODE_BASE_SIZE[node.kind];
  const labelWidth =
    estimateTextWidth(node.label, NODE_LABEL_FONT_SIZE, 600) + NODE_LABEL_HORIZONTAL_PADDING;
  const captionWidth = node.caption
    ? estimateTextWidth(node.caption, NODE_CAPTION_FONT_SIZE, 500) +
      NODE_CAPTION_HORIZONTAL_PADDING
    : 0;

  return {
    width: Math.ceil(Math.max(baseSize.width, labelWidth, captionWidth)),
    height: baseSize.height,
  };
}

function normalizeWheelDelta(event: WheelEvent): number {
  let deltaY = event.deltaY;

  if (event.deltaMode === WHEEL_DELTA_LINE_MODE) {
    deltaY *= GRAPH_WHEEL_LINE_HEIGHT;
  } else if (event.deltaMode === WHEEL_DELTA_PAGE_MODE) {
    deltaY *= GRAPH_WHEEL_PAGE_HEIGHT;
  }

  return clamp(deltaY, -GRAPH_MAX_WHEEL_DELTA, GRAPH_MAX_WHEEL_DELTA);
}

function normalizeWheelPanDelta(event: WheelEvent): { x: number; y: number } {
  let deltaX = event.deltaX;
  let deltaY = event.deltaY;

  if (event.deltaMode === WHEEL_DELTA_LINE_MODE) {
    deltaX *= GRAPH_WHEEL_LINE_HEIGHT;
    deltaY *= GRAPH_WHEEL_LINE_HEIGHT;
  } else if (event.deltaMode === WHEEL_DELTA_PAGE_MODE) {
    deltaX *= GRAPH_WHEEL_PAGE_HEIGHT;
    deltaY *= GRAPH_WHEEL_PAGE_HEIGHT;
  }

  return {
    x: clamp(deltaX, -GRAPH_MAX_TRACKPAD_PAN_DELTA, GRAPH_MAX_TRACKPAD_PAN_DELTA),
    y: clamp(deltaY, -GRAPH_MAX_TRACKPAD_PAN_DELTA, GRAPH_MAX_TRACKPAD_PAN_DELTA),
  };
}

function getWheelZoomSensitivity(event: WheelEvent): number {
  return event.ctrlKey || event.metaKey
    ? GRAPH_PINCH_ZOOM_SENSITIVITY
    : GRAPH_WHEEL_ZOOM_SENSITIVITY;
}

function shouldPanGraphWheel(event: WheelEvent): boolean {
  if (event.ctrlKey || event.metaKey) {
    return false;
  }

  if (event.deltaMode !== 0) {
    return false;
  }

  const absDeltaX = Math.abs(event.deltaX);
  const absDeltaY = Math.abs(event.deltaY);

  return (
    absDeltaX > 0 ||
    (absDeltaY > 0 && absDeltaY < GRAPH_TRACKPAD_DELTA_THRESHOLD) ||
    !Number.isInteger(event.deltaY)
  );
}

function shiftLayoutSubtree(subtree: LayoutSubtree, deltaX: number): LayoutSubtree {
  subtree.nodes.forEach((positionedNode) => {
    positionedNode.x += deltaX;
  });
  subtree.left += deltaX;
  subtree.right += deltaX;

  return subtree;
}

function getNodeKindLabel(kind: GraphNodeKind, t: TranslationKeys): string {
  switch (kind) {
    case 'robot':
      return t.structureGraphRobot;
    case 'assembly':
      return t.structureGraphAssembly;
    case 'component':
      return t.structureGraphComponent;
    case 'link':
      return t.structureGraphLink;
    case 'joint':
      return t.structureGraphJoint;
    case 'bridge':
      return t.structureGraphBridge;
  }
}

function sortByDisplayName<T>(
  items: readonly T[],
  resolveName: (item: T) => string,
): T[] {
  return [...items].sort((left, right) => resolveName(left).localeCompare(resolveName(right)));
}

function toRobotState(robot: RobotData | RobotState): RobotState {
  if ('selection' in robot) return robot;
  return { ...robot, selection: { type: null, id: null } };
}

function buildChildJointsByParent(joints: Record<string, UrdfJoint>) {
  const result: Record<string, UrdfJoint[]> = {};
  Object.values(joints).forEach((joint) => {
    (result[joint.parentLinkId] ??= []).push(joint);
  });
  return result;
}

function buildLinkNode(
  robot: RobotData | RobotState,
  linkId: string,
  childJointsByParent: Record<string, RobotState['joints'][string][]>,
  t: TranslationKeys,
  scope: string,
  componentId: string,
  path: readonly string[] = [],
): StructureGraphNode | null {
  const link = robot.links[linkId];
  if (!link) return null;

  const nextPath = [...path, linkId];
  const hasCycle = path.includes(linkId);
  const childJoints = hasCycle ? [] : childJointsByParent[linkId] ?? [];
  const children = childJoints
    .map((joint) => {
      const childLink = buildLinkNode(
        robot,
        joint.childLinkId,
        childJointsByParent,
        t,
        scope,
        componentId,
        nextPath,
      );

      return {
        uid: `${scope}:joint:${joint.id}:${nextPath.join('/')}`,
        kind: 'joint' as const,
        id: joint.id,
        componentId,
        label: joint.name || joint.id,
        caption: joint.type,
        children: childLink ? [childLink] : [],
      };
    });

  return {
    uid: `${scope}:link:${linkId}:${nextPath.join('/')}`,
    kind: 'link',
    id: linkId,
    componentId,
    label: link.name || linkId,
    caption: t.structureGraphLink,
    children,
  };
}

function buildRobotRootNode(
  robot: RobotData | RobotState,
  rootLinkIds: string[],
  childJointsByParent: Record<string, RobotState['joints'][string][]>,
  t: TranslationKeys,
  scope: string,
  componentId: string,
): StructureGraphNode {
  const robotState = toRobotState(robot);
  const resolvedRootLinkIds =
    rootLinkIds.length > 0 ? rootLinkIds : getTreeRenderRootLinkIds(robotState);
  const rootLinks = resolvedRootLinkIds
    .map((linkId) => buildLinkNode(robot, linkId, childJointsByParent, t, scope, componentId))
    .filter((node): node is StructureGraphNode => Boolean(node));

  return {
    uid: `${scope}:robot`,
    kind: 'robot',
    label: robotState.name || t.structureGraphRobot,
    caption: t.structureGraphRobot,
    componentId,
    targetLinkId: resolvedRootLinkIds[0] ?? robotState.rootLinkId,
    children: rootLinks,
  };
}

function buildAssemblyRootNodes(
  assemblyState: AssemblyState,
  t: TranslationKeys,
): StructureGraphNode[] {
  const components = sortByDisplayName(
    Object.values(assemblyState.components),
    (component) => component.name,
  );
  const bridges = sortByDisplayName(Object.values(assemblyState.bridges), (bridge) => bridge.name);

  const componentNodes = components.map((component) => {
    const rootLinkIds = getTreeRenderRootLinkIds(toRobotState(component.robot));
    const componentChildJointsByParent = buildChildJointsByParent(component.robot.joints);
    const robotNode = buildRobotRootNode(
      component.robot,
      rootLinkIds,
      componentChildJointsByParent,
      t,
      `component:${component.id}`,
      component.id,
    );

    return {
      uid: `component:${component.id}`,
      kind: 'component' as const,
      id: component.id,
      componentId: component.id,
      targetLinkId: rootLinkIds[0] ?? component.robot.rootLinkId,
      label: component.name,
      caption: t.structureGraphComponent,
      children: robotNode.children,
    };
  });

  const bridgeNodes = bridges.map((bridge) => ({
    uid: `bridge:${bridge.id}`,
    kind: 'bridge' as const,
    id: bridge.id,
    label: bridge.name || bridge.id,
    caption: bridge.joint.type,
    children: [],
  }));

  return [...componentNodes, ...bridgeNodes];
}

function layoutGraph(roots: StructureGraphNode | StructureGraphNode[]): GraphLayout {
  const nodes: PositionedGraphNode[] = [];
  const edges: GraphEdge[] = [];
  const rootNodes = Array.isArray(roots) ? roots : [roots];

  const walk = (node: StructureGraphNode, depth: number): LayoutSubtree => {
    const size = resolveNodeSize(node);
    const childSubtrees = node.children.map((child) => walk(child, depth + 1));
    let nextChildLeft = 0;

    childSubtrees.forEach((subtree) => {
      shiftLayoutSubtree(subtree, nextChildLeft - subtree.left);
      nextChildLeft = subtree.right + LEAF_GAP;
    });

    const childPositions = childSubtrees.map((subtree) => subtree.positionedNode);
    const childCenter =
      childPositions.length > 0
        ? childPositions.reduce((total, child) => total + child.x, 0) / childPositions.length
        : size.width / 2;
    const x = childCenter;
    const positionedNode: PositionedGraphNode = {
      node,
      x,
      y: GRAPH_PADDING_Y + depth * DEPTH_GAP,
      width: size.width,
      height: size.height,
    };

    nodes.push(positionedNode);
    childPositions.forEach((child) => edges.push({ from: positionedNode, to: child }));

    const subtreeNodes = [...childSubtrees.flatMap((subtree) => subtree.nodes), positionedNode];
    const childLeft =
      childSubtrees.length > 0 ? Math.min(...childSubtrees.map((subtree) => subtree.left)) : 0;
    const childRight =
      childSubtrees.length > 0
        ? Math.max(...childSubtrees.map((subtree) => subtree.right))
        : size.width;

    return {
      positionedNode,
      nodes: subtreeNodes,
      left: Math.min(childLeft, x - size.width / 2),
      right: Math.max(childRight, x + size.width / 2),
    };
  };

  const rootSubtrees = rootNodes.map((root) => walk(root, 0));
  let nextRootLeft = GRAPH_PADDING_X;

  rootSubtrees.forEach((subtree) => {
    shiftLayoutSubtree(subtree, nextRootLeft - subtree.left);
    nextRootLeft = subtree.right + LEAF_GAP;
  });

  if (nodes.length === 0) {
    return {
      nodes,
      edges,
      width: GRAPH_PADDING_X * 2,
      height: GRAPH_PADDING_Y * 2,
    };
  }

  const maxNodeRight = nodes.reduce(
    (maxRight, positionedNode) =>
      Math.max(maxRight, positionedNode.x + positionedNode.width / 2),
    0,
  );
  const maxNodeBottom = nodes.reduce(
    (maxBottom, positionedNode) =>
      Math.max(maxBottom, positionedNode.y + positionedNode.height / 2),
    0,
  );

  return {
    nodes,
    edges,
    width: maxNodeRight + GRAPH_PADDING_X,
    height: maxNodeBottom + GRAPH_PADDING_Y,
  };
}

function getEdgePath(edge: GraphEdge): string {
  const sourceX = edge.from.x;
  const sourceY = edge.from.y + edge.from.height / 2;
  const targetX = edge.to.x;
  const targetY = edge.to.y - edge.to.height / 2;
  const midY = (sourceY + targetY) / 2;

  return `M ${sourceX} ${sourceY} C ${sourceX} ${midY}, ${targetX} ${midY}, ${targetX} ${targetY}`;
}

function getFittedViewTransform(
  layout: Pick<GraphLayout, 'width' | 'height'>,
  viewportWidth: number,
  viewportHeight: number,
): GraphViewTransform {
  const availableWidth = Math.max(1, viewportWidth - 48);
  const availableHeight = Math.max(1, viewportHeight - 48);
  const scale = clamp(
    Math.min(1, availableWidth / layout.width, availableHeight / layout.height),
    GRAPH_MIN_SCALE,
    1,
  );

  return {
    scale,
    x: Math.max(24, (viewportWidth - layout.width * scale) / 2),
    y: 24,
  };
}

function getGraphLayoutKey(layout: GraphLayout): string {
  return layout.nodes
    .map(
      ({ node, x, y, width, height }) =>
        `${node.uid}:${node.label}:${node.caption ?? ''}:${x},${y}:${width}x${height}`,
    )
    .join('|');
}

function getNodeEntityRef(node: StructureGraphNode): EntityRef | null {
  if (node.kind === 'assembly') return { type: 'assembly' };
  if (node.kind === 'component' && node.componentId) {
    return { type: 'component', componentId: node.componentId };
  }
  if (node.kind === 'bridge' && node.id) {
    return { type: 'bridge', bridgeId: node.id };
  }
  if (node.kind === 'robot' && node.componentId) {
    return node.targetLinkId
      ? { type: 'link', componentId: node.componentId, entityId: node.targetLinkId }
      : { type: 'component', componentId: node.componentId };
  }
  if ((node.kind === 'link' || node.kind === 'joint') && node.id && node.componentId) {
    return {
      type: node.kind,
      componentId: node.componentId,
      entityId: node.id,
    };
  }
  return null;
}

function getSteppedZoomScale(currentScale: number, direction: 'in' | 'out'): number {
  const normalizedScale = clamp(currentScale, GRAPH_MIN_SCALE, GRAPH_MAX_SCALE);
  const epsilon = 0.001;

  if (direction === 'in') {
    return (
      GRAPH_ZOOM_LEVELS.find((scale) => scale > normalizedScale + epsilon) ?? GRAPH_MAX_SCALE
    );
  }

  for (let index = GRAPH_ZOOM_LEVELS.length - 1; index >= 0; index -= 1) {
    const scale = GRAPH_ZOOM_LEVELS[index];
    if (scale < normalizedScale - epsilon) {
      return scale;
    }
  }

  return GRAPH_MIN_SCALE;
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
