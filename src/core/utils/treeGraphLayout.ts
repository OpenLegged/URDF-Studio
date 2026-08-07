/**
 * Tree graph layout — pure layout/geometry/wheel math for the structure graph
 * dialog. No React, no business semantics: input is a `StructureGraphNode[]`
 * tree, output is a positioned `GraphLayout`. Node `kind` is just a string
 * discriminant used to pick a default size; the layout does not interpret it.
 *
 * Boundary: core layer. No imports outside TypeScript types.
 */

export type GraphNodeKind = 'robot' | 'assembly' | 'component' | 'link' | 'joint' | 'bridge';

export interface StructureGraphNode {
  uid: string;
  kind: GraphNodeKind;
  label: string;
  caption?: string;
  id?: string;
  componentId?: string;
  targetLinkId?: string;
  children: StructureGraphNode[];
}

export interface PositionedGraphNode {
  node: StructureGraphNode;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GraphEdge {
  from: PositionedGraphNode;
  to: PositionedGraphNode;
}

export interface GraphLayout {
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

export interface GraphViewTransform {
  scale: number;
  x: number;
  y: number;
}

const GRAPH_PADDING_X = 64;
const GRAPH_PADDING_Y = 48;
const DEPTH_GAP = 112;
const LEAF_GAP = 56;
export const GRAPH_MIN_SCALE = 0.1;
export const GRAPH_MAX_SCALE = 8;
const GRAPH_ZOOM_LEVELS = [0.1, 0.2, 0.35, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8] as const;
const GRAPH_WHEEL_ZOOM_SENSITIVITY = 0.0034;
const GRAPH_PINCH_ZOOM_SENSITIVITY = 0.0026;
const GRAPH_WHEEL_LINE_HEIGHT = 16;
const GRAPH_WHEEL_PAGE_HEIGHT = 800;
const GRAPH_MAX_WHEEL_DELTA = 180;
const GRAPH_MAX_TRACKPAD_PAN_DELTA = 240;
const GRAPH_TRACKPAD_DELTA_THRESHOLD = 64;
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

export const DEFAULT_GRAPH_VIEW_TRANSFORM: GraphViewTransform = {
  scale: 1,
  x: 0,
  y: 0,
};

export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function estimateTextWidth(value: string, fontSize: number, fontWeight: number): number {
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

export function resolveNodeSize(node: StructureGraphNode): { width: number; height: number } {
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

export function normalizeWheelDelta(event: WheelEvent): number {
  let deltaY = event.deltaY;

  if (event.deltaMode === WHEEL_DELTA_LINE_MODE) {
    deltaY *= GRAPH_WHEEL_LINE_HEIGHT;
  } else if (event.deltaMode === WHEEL_DELTA_PAGE_MODE) {
    deltaY *= GRAPH_WHEEL_PAGE_HEIGHT;
  }

  return clamp(deltaY, -GRAPH_MAX_WHEEL_DELTA, GRAPH_MAX_WHEEL_DELTA);
}

export function normalizeWheelPanDelta(event: WheelEvent): { x: number; y: number } {
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

export function getWheelZoomSensitivity(event: WheelEvent): number {
  return event.ctrlKey || event.metaKey
    ? GRAPH_PINCH_ZOOM_SENSITIVITY
    : GRAPH_WHEEL_ZOOM_SENSITIVITY;
}

export function shouldPanGraphWheel(event: WheelEvent): boolean {
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

export function layoutGraph(roots: StructureGraphNode | StructureGraphNode[]): GraphLayout {
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

export function getEdgePath(edge: GraphEdge): string {
  const sourceX = edge.from.x;
  const sourceY = edge.from.y + edge.from.height / 2;
  const targetX = edge.to.x;
  const targetY = edge.to.y - edge.to.height / 2;
  const midY = (sourceY + targetY) / 2;

  return `M ${sourceX} ${sourceY} C ${sourceX} ${midY}, ${targetX} ${midY}, ${targetX} ${targetY}`;
}

export function getFittedViewTransform(
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

export function getGraphLayoutKey(layout: GraphLayout): string {
  return layout.nodes
    .map(
      ({ node, x, y, width, height }) =>
        `${node.uid}:${node.label}:${node.caption ?? ''}:${x},${y}:${width}x${height}`,
    )
    .join('|');
}

export function getSteppedZoomScale(currentScale: number, direction: 'in' | 'out'): number {
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
