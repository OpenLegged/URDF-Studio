import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LocateFixed, ZoomIn, ZoomOut } from 'lucide-react';
import { Checkbox, IconButton } from '@/shared/components/ui';
import type {
  CollisionOptimizationAnalysis,
  CollisionOptimizationCandidate,
  CollisionOptimizationManualMergePair,
  CollisionOptimizationSource,
  CollisionTargetRef,
} from '../utils/collisionOptimization';
import { createCollisionOptimizationCandidateKey } from '../utils/collisionOptimization';
import { GeometryType, type InteractionSelection } from '@/types';
import { mergeAssembly } from '@/core/robot/assemblyMerger';

const GRAPH_PADDING = 28;
const NODE_HEIGHT = 28;
const NODE_MIN_WIDTH = 84;
const NODE_MAX_WIDTH = 150;
const NODE_PILL_PADDING = 26;
const NODE_GAP_X = 132;
const NODE_GAP_Y = 92;
const ROOT_GAP_UNITS = 1.15;
const GROUP_PADDING_X = 18;
const GROUP_PADDING_Y = 16;
const MIN_SCALE = 0.32;
const MAX_SCALE = 4.5;

type GraphPairType = 'manual' | 'auto';

type CollisionSelection = InteractionSelection;

interface GraphPoint {
  x: number;
  y: number;
}

interface GestureLikeEvent extends Event {
  clientX: number;
  clientY: number;
  scale: number;
}

interface ViewportState {
  x: number;
  y: number;
  scale: number;
}

interface GraphBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  centerX: number;
  centerY: number;
}

interface GraphNodeModel {
  id: string;
  linkId: string;
  linkName: string;
  componentName?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  center: GraphPoint;
  handle: GraphPoint;
  targetCount: number;
  summaryTarget: CollisionTargetRef | null;
  summaryCandidate: CollisionOptimizationCandidate | null;
  selected: boolean;
  checked: boolean;
}

interface GraphEdgeModel {
  id: string;
  fromLinkId: string;
  toLinkId: string;
}

interface GraphGroupModel {
  id: string;
  sourceLinkId: string;
  targetLinkId: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  candidate: CollisionOptimizationCandidate;
  pairType: GraphPairType;
  checked: boolean;
  labelAnchor: GraphPoint;
}

interface GraphModel {
  nodes: GraphNodeModel[];
  edges: GraphEdgeModel[];
  groups: GraphGroupModel[];
  width: number;
  height: number;
  focusBounds: GraphBounds;
}

interface PanSession {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startViewport: ViewportState;
}

export interface CollisionOptimizationPlanarGraphConnectionState {
  sourceTargetId: string;
  pointer: GraphPoint | null;
}

export interface CollisionOptimizationPlanarGraphLabels {
  autoPair: string;
  collisionIndex: string;
  component: string;
  connectionHandle: string;
  dragHint: string;
  empty: string;
  frontView: string;
  manualPair: string;
  mergeTo: string;
  mergedInto: string;
  primary: string;
  resetView: string;
  selectCandidate: string;
  unselectCandidate: string;
  zoomIn: string;
  zoomOut: string;
}

export interface CollisionOptimizationPlanarGraphProps {
  source: CollisionOptimizationSource;
  analysis: CollisionOptimizationAnalysis;
  candidates: CollisionOptimizationCandidate[];
  checkedCandidateKeys: ReadonlySet<string>;
  selection?: CollisionSelection;
  manualMergePairs: CollisionOptimizationManualMergePair[];
  manualConnection?: CollisionOptimizationPlanarGraphConnectionState | null;
  labels: CollisionOptimizationPlanarGraphLabels;
  formatGeometryType: (type: GeometryType | null | undefined) => string;
  canCreateManualPair: (sourceTargetId: string, targetTargetId: string) => boolean;
  onToggleCandidate: (candidateKey: string) => void;
  onSelectTarget?: (target: CollisionTargetRef) => void;
  onManualConnectionStart?: (target: CollisionTargetRef) => void;
  onManualConnectionMove?: (pointer: GraphPoint) => void;
  onManualConnectionEnd?: (target: CollisionTargetRef | null) => void;
  onManualConnectionCancel?: () => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function buildPairKey(leftTargetId: string, rightTargetId: string): string {
  return `${leftTargetId}::${rightTargetId}`;
}

function compareTargets(left: CollisionTargetRef, right: CollisionTargetRef): number {
  return (
    left.sequenceIndex - right.sequenceIndex ||
    left.objectIndex - right.objectIndex ||
    left.linkName.localeCompare(right.linkName) ||
    (left.componentName ?? '').localeCompare(right.componentName ?? '')
  );
}

function buildCurvePath(from: GraphPoint, to: GraphPoint): string {
  const horizontalOffset = Math.max(34, Math.abs(to.x - from.x) * 0.38);
  return `M ${from.x} ${from.y} C ${from.x + horizontalOffset} ${from.y}, ${to.x - horizontalOffset} ${to.y}, ${to.x} ${to.y}`;
}

function formatCompactNumber(value: number | null | undefined): string {
  if (!Number.isFinite(value)) {
    return '—';
  }

  const safeValue = Number(value);
  const absolute = Math.abs(safeValue);
  if (absolute >= 10) {
    return safeValue.toFixed(1).replace(/\.0$/, '');
  }

  if (absolute >= 1) {
    return safeValue.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  }

  return safeValue.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function getGeometryMetrics(
  candidate: CollisionOptimizationCandidate,
): Array<{ label: string; value: string }> {
  const geometry = candidate.nextGeometry ?? candidate.target.geometry;
  const dimensions = geometry.dimensions;

  if (!dimensions) {
    return [];
  }

  if (geometry.type === GeometryType.CYLINDER || geometry.type === GeometryType.CAPSULE) {
    return [
      { label: 'R', value: formatCompactNumber(dimensions.x) },
      { label: 'L', value: formatCompactNumber(dimensions.y) },
    ];
  }

  if (geometry.type === GeometryType.SPHERE) {
    return [{ label: 'R', value: formatCompactNumber(dimensions.x) }];
  }

  if (geometry.type === GeometryType.ELLIPSOID) {
    return [
      { label: 'RX', value: formatCompactNumber(dimensions.x) },
      { label: 'RY', value: formatCompactNumber(dimensions.y) },
      { label: 'RZ', value: formatCompactNumber(dimensions.z) },
    ];
  }

  if (geometry.type === GeometryType.BOX) {
    return [
      { label: 'X', value: formatCompactNumber(dimensions.x) },
      { label: 'Y', value: formatCompactNumber(dimensions.y) },
      { label: 'Z', value: formatCompactNumber(dimensions.z) },
    ];
  }

  if (geometry.type === GeometryType.PLANE) {
    return [
      { label: 'W', value: formatCompactNumber(dimensions.x) },
      { label: 'D', value: formatCompactNumber(dimensions.y) },
    ];
  }

  return [];
}

function getMetricSummary(candidate: CollisionOptimizationCandidate): string {
  return getGeometryMetrics(candidate)
    .map((metric) => `${metric.label} ${metric.value}`)
    .join(' · ');
}

function getPrimitiveMonogram(type: GeometryType | null | undefined): string {
  switch (type) {
    case GeometryType.CYLINDER:
      return 'CYL';
    case GeometryType.CAPSULE:
      return 'CAP';
    case GeometryType.BOX:
      return 'BOX';
    case GeometryType.PLANE:
      return 'PLN';
    case GeometryType.SPHERE:
      return 'SPH';
    case GeometryType.ELLIPSOID:
      return 'ELP';
    case GeometryType.HFIELD:
      return 'HFD';
    case GeometryType.SDF:
      return 'SDF';
    case GeometryType.MESH:
      return 'MSH';
    default:
      return '—';
  }
}

function computeBounds(points: GraphPoint[]): GraphBounds {
  if (points.length === 0) {
    return {
      minX: GRAPH_PADDING,
      maxX: GRAPH_PADDING,
      minY: GRAPH_PADDING,
      maxY: GRAPH_PADDING,
      centerX: GRAPH_PADDING,
      centerY: GRAPH_PADDING,
    };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  points.forEach((point) => {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  });

  return {
    minX,
    maxX,
    minY,
    maxY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}

function expandBounds(bounds: GraphBounds, marginX: number, marginY: number): GraphBounds {
  return {
    minX: bounds.minX - marginX,
    maxX: bounds.maxX + marginX,
    minY: bounds.minY - marginY,
    maxY: bounds.maxY + marginY,
    centerX: bounds.centerX,
    centerY: bounds.centerY,
  };
}

function createViewportForBounds(container: HTMLDivElement, bounds: GraphBounds): ViewportState {
  const availableWidth = Math.max(container.clientWidth - 40, 320);
  const availableHeight = Math.max(container.clientHeight - 40, 240);
  const boundsWidth = Math.max(bounds.maxX - bounds.minX, 180);
  const boundsHeight = Math.max(bounds.maxY - bounds.minY, 180);
  const scale = clamp(
    Math.min(availableWidth / boundsWidth, availableHeight / boundsHeight),
    0.5,
    1.15,
  );

  return {
    scale,
    x: container.clientWidth / 2 - bounds.centerX * scale,
    y: container.clientHeight / 2 - bounds.centerY * scale,
  };
}

function pickSummaryCandidate(
  candidates: CollisionOptimizationCandidate[],
): CollisionOptimizationCandidate | null {
  if (candidates.length === 0) {
    return null;
  }

  return (
    [...candidates].sort((left, right) => {
      return (
        Number(right.eligible) - Number(left.eligible) ||
        Number(Boolean(right.secondaryTarget)) - Number(Boolean(left.secondaryTarget)) ||
        Number(right.target.isPrimary) - Number(left.target.isPrimary) ||
        left.target.sequenceIndex - right.target.sequenceIndex ||
        left.target.objectIndex - right.target.objectIndex
      );
    })[0] ?? null
  );
}

function buildLinkComponentMap(
  source: CollisionOptimizationSource,
): Map<string, { componentName?: string }> {
  if (source.kind === 'robot') {
    return new Map(
      Object.values(source.robot.links).map(
        (link) => [link.id, { componentName: undefined }] as const,
      ),
    );
  }

  return new Map(
    Object.values(source.assembly.components).flatMap((component) =>
      Object.values(component.robot.links).map(
        (link) => [link.id, { componentName: component.name }] as const,
      ),
    ),
  );
}

function resolveRobot(source: CollisionOptimizationSource) {
  return source.kind === 'robot' ? source.robot : mergeAssembly(source.assembly);
}

function buildTreeLayout(source: CollisionOptimizationSource): {
  positions: Map<string, GraphPoint>;
  edges: GraphEdgeModel[];
} {
  const robot = resolveRobot(source);
  const linkIds = Object.keys(robot.links);
  const childLinkIdSet = new Set<string>();
  const childrenByParent = new Map<string, string[]>();

  Object.values(robot.joints).forEach((joint, index) => {
    childLinkIdSet.add(joint.childLinkId);
    const bucket = childrenByParent.get(joint.parentLinkId) ?? [];
    bucket.push(joint.childLinkId);
    childrenByParent.set(joint.parentLinkId, bucket);
  });

  childrenByParent.forEach((children, parentId) => {
    children.sort((left, right) => {
      const leftName = robot.links[left]?.name ?? left;
      const rightName = robot.links[right]?.name ?? right;
      return leftName.localeCompare(rightName);
    });
    childrenByParent.set(parentId, children);
  });

  const rootIds = Array.from(
    new Set([robot.rootLinkId, ...linkIds.filter((linkId) => !childLinkIdSet.has(linkId))]),
  ).filter(Boolean);

  const widthCache = new Map<string, number>();
  const measure = (linkId: string): number => {
    const cached = widthCache.get(linkId);
    if (cached != null) {
      return cached;
    }

    const children = childrenByParent.get(linkId) ?? [];
    const width =
      children.length === 0 ? 1 : children.reduce((sum, childId) => sum + measure(childId), 0);
    widthCache.set(linkId, width);
    return width;
  };

  const positions = new Map<string, GraphPoint>();
  const edges: GraphEdgeModel[] = [];
  let cursorUnits = 0;

  const place = (linkId: string, depth: number, startUnits: number): number => {
    const widthUnits = measure(linkId);
    const centerUnits = startUnits + widthUnits / 2;
    positions.set(linkId, {
      x: GRAPH_PADDING + centerUnits * NODE_GAP_X,
      y: GRAPH_PADDING + depth * NODE_GAP_Y,
    });

    let childCursor = startUnits;
    const children = childrenByParent.get(linkId) ?? [];
    children.forEach((childId, index) => {
      place(childId, depth + 1, childCursor);
      childCursor += measure(childId);
      edges.push({
        id: `tree-edge::${linkId}::${childId}::${index}`,
        fromLinkId: linkId,
        toLinkId: childId,
      });
    });

    return widthUnits;
  };

  rootIds.forEach((rootId, index) => {
    if (!robot.links[rootId]) {
      return;
    }

    place(rootId, 0, cursorUnits);
    cursorUnits += measure(rootId) + ROOT_GAP_UNITS;
  });

  linkIds.forEach((linkId, index) => {
    if (positions.has(linkId)) {
      return;
    }

    positions.set(linkId, {
      x: GRAPH_PADDING + (cursorUnits + index) * NODE_GAP_X,
      y: GRAPH_PADDING,
    });
  });

  return { positions, edges };
}

function buildGraphModel(
  source: CollisionOptimizationSource,
  analysis: CollisionOptimizationAnalysis,
  candidates: CollisionOptimizationCandidate[],
  checkedCandidateKeys: ReadonlySet<string>,
  selection: CollisionSelection | undefined,
  manualMergePairs: CollisionOptimizationManualMergePair[],
): GraphModel {
  const { positions, edges } = buildTreeLayout(source);
  const linkComponentMeta = buildLinkComponentMap(source);
  const targetsByLinkId = new Map<string, CollisionTargetRef[]>();
  const candidatesByPrimaryLinkId = new Map<string, CollisionOptimizationCandidate[]>();

  analysis.targets.forEach((target) => {
    const bucket = targetsByLinkId.get(target.linkId) ?? [];
    bucket.push(target);
    targetsByLinkId.set(target.linkId, bucket);
  });

  candidates.forEach((candidate) => {
    const bucket = candidatesByPrimaryLinkId.get(candidate.target.linkId) ?? [];
    bucket.push(candidate);
    candidatesByPrimaryLinkId.set(candidate.target.linkId, bucket);
  });

  const manualPairKeys = new Set(
    manualMergePairs.map((pair) => buildPairKey(pair.primaryTargetId, pair.secondaryTargetId)),
  );

  const nodes = Array.from(positions.entries())
    .map(([linkId, center]) => {
      const linkTargets = [...(targetsByLinkId.get(linkId) ?? [])].sort(compareTargets);
      const summaryCandidate = pickSummaryCandidate(candidatesByPrimaryLinkId.get(linkId) ?? []);
      const summaryTarget = summaryCandidate?.target ?? linkTargets[0] ?? null;
      const linkName = summaryTarget?.linkName ?? linkId;
      const width = clamp(
        NODE_PILL_PADDING + linkName.length * 6.1,
        NODE_MIN_WIDTH,
        NODE_MAX_WIDTH,
      );
      const height = NODE_HEIGHT;
      const selected = linkTargets.some((target) => {
        return (
          selection?.type === 'link' &&
          selection.id === target.linkId &&
          selection.subType === 'collision' &&
          (selection.objectIndex ?? 0) === target.objectIndex
        );
      });
      const checked = (candidatesByPrimaryLinkId.get(linkId) ?? []).some((candidate) =>
        checkedCandidateKeys.has(createCollisionOptimizationCandidateKey(candidate)),
      );

      return {
        id: linkId,
        linkId,
        linkName,
        componentName: linkComponentMeta.get(linkId)?.componentName,
        x: center.x - width / 2,
        y: center.y - height / 2,
        width,
        height,
        center,
        handle: { x: center.x + width / 2 - 6, y: center.y },
        targetCount: linkTargets.length,
        summaryTarget,
        summaryCandidate,
        selected,
        checked,
      };
    })
    .sort((left, right) => left.center.y - right.center.y || left.center.x - right.center.x);

  const nodeByLinkId = new Map(nodes.map((node) => [node.linkId, node] as const));
  const relationMap = new Map<string, GraphGroupModel>();

  candidates.forEach((candidate) => {
    if (!candidate.secondaryTarget) {
      return;
    }

    const pairKey = buildPairKey(candidate.target.id, candidate.secondaryTarget.id);
    const sourceNode = nodeByLinkId.get(candidate.target.linkId);
    const targetNode = nodeByLinkId.get(candidate.secondaryTarget.linkId);
    if (!sourceNode || !targetNode) {
      return;
    }

    const minX = Math.min(sourceNode.x, targetNode.x) - GROUP_PADDING_X;
    const maxX =
      Math.max(sourceNode.x + sourceNode.width, targetNode.x + targetNode.width) + GROUP_PADDING_X;
    const minY = Math.min(sourceNode.y, targetNode.y) - GROUP_PADDING_Y;
    const maxY =
      Math.max(sourceNode.y + sourceNode.height, targetNode.y + targetNode.height) +
      GROUP_PADDING_Y;
    const pairType: GraphPairType = manualPairKeys.has(pairKey) ? 'manual' : 'auto';
    const existing = relationMap.get(pairKey);
    const checked = checkedCandidateKeys.has(createCollisionOptimizationCandidateKey(candidate));
    const group: GraphGroupModel = {
      id: pairKey,
      sourceLinkId: candidate.target.linkId,
      targetLinkId: candidate.secondaryTarget.linkId,
      bounds: {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      },
      candidate,
      pairType,
      checked,
      labelAnchor: {
        x: maxX - 10,
        y: minY - 6,
      },
    };

    if (!existing || pairType === 'manual') {
      relationMap.set(pairKey, group);
    }
  });

  const groups = [...relationMap.values()];
  const modelPoints: GraphPoint[] = [];
  nodes.forEach((node) => {
    modelPoints.push({ x: node.x, y: node.y });
    modelPoints.push({ x: node.x + node.width, y: node.y + node.height });
  });
  groups.forEach((group) => {
    modelPoints.push({ x: group.bounds.x, y: group.bounds.y });
    modelPoints.push({
      x: group.bounds.x + group.bounds.width,
      y: group.bounds.y + group.bounds.height,
    });
  });

  const contentBounds = expandBounds(computeBounds(modelPoints), 44, 52);

  return {
    nodes,
    edges,
    groups,
    width: contentBounds.maxX,
    height: contentBounds.maxY,
    focusBounds: contentBounds,
  };
}

function getNodeTone(node: GraphNodeModel, manualConnection: boolean, connectable: boolean) {
  if (manualConnection && connectable) {
    return 'border-system-blue/35 bg-system-blue/10 ring-1 ring-system-blue/10';
  }

  if (node.selected) {
    return 'border-system-blue/35 bg-system-blue/10 ring-1 ring-system-blue/10';
  }

  if (node.checked) {
    return 'border-system-blue/25 bg-system-blue/6';
  }

  return 'border-border-black bg-element-bg/96 hover:bg-element-hover';
}

export function CollisionOptimizationPlanarGraph({
  source,
  analysis,
  candidates,
  checkedCandidateKeys,
  selection,
  manualMergePairs,
  manualConnection = null,
  labels,
  formatGeometryType,
  canCreateManualPair,
  onToggleCandidate,
  onSelectTarget,
  onManualConnectionStart,
  onManualConnectionMove,
  onManualConnectionEnd,
  onManualConnectionCancel,
}: CollisionOptimizationPlanarGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hasInitializedViewportRef = useRef(false);
  const gestureScaleRef = useRef(1);

  const model = useMemo(
    () =>
      buildGraphModel(
        source,
        analysis,
        candidates,
        checkedCandidateKeys,
        selection,
        manualMergePairs,
      ),
    [analysis, candidates, checkedCandidateKeys, manualMergePairs, selection, source],
  );

  const [viewport, setViewport] = useState<ViewportState>({ x: 24, y: 24, scale: 1 });
  const [panSession, setPanSession] = useState<PanSession | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || hasInitializedViewportRef.current || model.nodes.length === 0) {
      return;
    }

    setViewport(createViewportForBounds(container, model.focusBounds));
    hasInitializedViewportRef.current = true;
  }, [model.focusBounds, model.nodes.length]);

  const nodeByLinkId = useMemo(
    () => new Map(model.nodes.map((node) => [node.linkId, node] as const)),
    [model.nodes],
  );
  const nodeByTargetId = useMemo(() => {
    const map = new Map<string, GraphNodeModel>();
    model.nodes.forEach((node) => {
      if (node.summaryTarget) {
        map.set(node.summaryTarget.id, node);
      }
    });
    return map;
  }, [model.nodes]);

  const toWorldPoint = useCallback(
    (clientX: number, clientY: number): GraphPoint | null => {
      const container = containerRef.current;
      if (!container) {
        return null;
      }

      const rect = container.getBoundingClientRect();
      return {
        x: (clientX - rect.left - viewport.x) / viewport.scale,
        y: (clientY - rect.top - viewport.y) / viewport.scale,
      };
    },
    [viewport.scale, viewport.x, viewport.y],
  );

  const zoomAtClientPoint = useCallback((clientX: number, clientY: number, scaleFactor: number) => {
    const container = containerRef.current;
    if (!container || !Number.isFinite(scaleFactor) || scaleFactor <= 0) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const pointerX = clientX - rect.left;
    const pointerY = clientY - rect.top;

    setViewport((current) => {
      const worldPoint = {
        x: (pointerX - current.x) / current.scale,
        y: (pointerY - current.y) / current.scale,
      };
      const nextScale = clamp(current.scale * scaleFactor, MIN_SCALE, MAX_SCALE);

      if (Math.abs(nextScale - current.scale) <= 1e-4) {
        return current;
      }

      return {
        scale: nextScale,
        x: pointerX - worldPoint.x * nextScale,
        y: pointerY - worldPoint.y * nextScale,
      };
    });
  }, []);

  const handleResetViewport = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    setViewport(createViewportForBounds(container, model.focusBounds));
  }, [model.focusBounds]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const handleWheelEvent = (event: WheelEvent) => {
      event.preventDefault();
      zoomAtClientPoint(event.clientX, event.clientY, Math.exp(-event.deltaY * 0.0022));
    };

    const handleGestureStart = (event: Event) => {
      const gestureEvent = event as GestureLikeEvent;
      gestureScaleRef.current =
        Number.isFinite(gestureEvent.scale) && gestureEvent.scale > 0 ? gestureEvent.scale : 1;
      event.preventDefault();
    };

    const handleGestureChange = (event: Event) => {
      const gestureEvent = event as GestureLikeEvent;
      event.preventDefault();

      const nextGestureScale =
        Number.isFinite(gestureEvent.scale) && gestureEvent.scale > 0
          ? gestureEvent.scale
          : gestureScaleRef.current;
      const scaleFactor = nextGestureScale / Math.max(gestureScaleRef.current, 1e-4);
      gestureScaleRef.current = nextGestureScale;
      zoomAtClientPoint(gestureEvent.clientX, gestureEvent.clientY, scaleFactor);
    };

    const handleGestureEnd = (event: Event) => {
      gestureScaleRef.current = 1;
      event.preventDefault();
    };

    container.addEventListener('wheel', handleWheelEvent, { passive: false });
    container.addEventListener('gesturestart', handleGestureStart as EventListener, {
      passive: false,
    });
    container.addEventListener('gesturechange', handleGestureChange as EventListener, {
      passive: false,
    });
    container.addEventListener('gestureend', handleGestureEnd as EventListener, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleWheelEvent);
      container.removeEventListener('gesturestart', handleGestureStart as EventListener);
      container.removeEventListener('gesturechange', handleGestureChange as EventListener);
      container.removeEventListener('gestureend', handleGestureEnd as EventListener);
    };
  }, [zoomAtClientPoint]);

  const handleSurfacePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (![0, 1, 2].includes(event.button) || manualConnection) {
        return;
      }

      const target = event.target as HTMLElement;
      if (target.closest('[data-graph-node]') || target.closest('[data-graph-no-pan="true"]')) {
        return;
      }

      event.preventDefault();
      setPanSession({
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startViewport: viewport,
      });
    },
    [manualConnection, viewport],
  );

  const handleConnectionStart = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>, target: CollisionTargetRef) => {
      event.preventDefault();
      event.stopPropagation();
      onManualConnectionStart?.(target);

      const point = toWorldPoint(event.clientX, event.clientY);
      if (point) {
        onManualConnectionMove?.(point);
      }
    },
    [onManualConnectionMove, onManualConnectionStart, toWorldPoint],
  );

  useEffect(() => {
    if (!manualConnection && !panSession) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (panSession && event.pointerId === panSession.pointerId) {
        setViewport({
          ...panSession.startViewport,
          x: panSession.startViewport.x + (event.clientX - panSession.startClientX),
          y: panSession.startViewport.y + (event.clientY - panSession.startClientY),
        });
        return;
      }

      if (manualConnection) {
        const point = toWorldPoint(event.clientX, event.clientY);
        if (point) {
          onManualConnectionMove?.(point);
        }
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (panSession && event.pointerId === panSession.pointerId) {
        setPanSession(null);
      }

      if (manualConnection) {
        const hitElement = document.elementFromPoint(
          event.clientX,
          event.clientY,
        ) as HTMLElement | null;
        const targetId =
          hitElement?.closest<HTMLElement>('[data-graph-node-target-id]')?.dataset
            .graphNodeTargetId ?? null;
        const node = targetId ? (nodeByTargetId.get(targetId) ?? null) : null;
        const target = node?.summaryTarget ?? null;
        onManualConnectionEnd?.(
          target && target.id !== manualConnection.sourceTargetId ? target : null,
        );
      }
    };

    const handlePointerCancel = () => {
      setPanSession(null);
      if (manualConnection) {
        onManualConnectionCancel?.();
      }
    };

    const handleWindowBlur = () => {
      handlePointerCancel();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        handlePointerCancel();
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: false });
    window.addEventListener('pointercancel', handlePointerCancel, { once: false });
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [
    manualConnection,
    nodeByTargetId,
    onManualConnectionCancel,
    onManualConnectionEnd,
    onManualConnectionMove,
    panSession,
    toWorldPoint,
  ]);

  const dragSourceNode = manualConnection?.sourceTargetId
    ? (nodeByTargetId.get(manualConnection.sourceTargetId) ?? null)
    : null;

  return (
    <div
      ref={containerRef}
      className="relative h-full min-h-[16rem] w-full select-none overflow-hidden rounded-lg border border-border-black bg-panel-bg"
      onPointerDown={handleSurfacePointerDown}
      onContextMenu={(event) => event.preventDefault()}
      style={{ touchAction: 'none' }}
    >
      {model.nodes.length === 0 ? (
        <div className="flex h-full min-h-[12rem] items-center justify-center px-3 text-center text-[10px] leading-relaxed text-text-secondary">
          {labels.empty}
        </div>
      ) : (
        <>
          <div className="absolute left-2.5 top-2 z-20 max-w-[min(24rem,calc(100%-7rem))] rounded-2xl border border-border-black bg-element-bg/95 px-2.5 py-2 shadow-sm">
            <div className="min-w-0 text-[9px] leading-relaxed text-text-secondary">
              {labels.dragHint}
            </div>
          </div>

          <div className="absolute right-2.5 top-2 z-20 flex items-center gap-1 rounded-full border border-border-black bg-element-bg/95 p-1 shadow-sm">
            <IconButton
              variant="toolbar"
              size="sm"
              data-graph-no-pan="true"
              aria-label={labels.zoomOut}
              title={labels.zoomOut}
              onClick={() => {
                const container = containerRef.current;
                if (!container) {
                  return;
                }
                const rect = container.getBoundingClientRect();
                zoomAtClientPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, 1 / 1.2);
              }}
              className="h-7 w-7 rounded-full"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton
              variant="toolbar"
              size="sm"
              data-graph-no-pan="true"
              aria-label={labels.zoomIn}
              title={labels.zoomIn}
              onClick={() => {
                const container = containerRef.current;
                if (!container) {
                  return;
                }
                const rect = container.getBoundingClientRect();
                zoomAtClientPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, 1.2);
              }}
              className="h-7 w-7 rounded-full"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton
              variant="toolbar"
              size="sm"
              data-graph-no-pan="true"
              aria-label={labels.resetView}
              title={labels.resetView}
              onClick={handleResetViewport}
              className="h-7 w-7 rounded-full"
            >
              <LocateFixed className="h-3.5 w-3.5" />
            </IconButton>
          </div>

          <div
            className={`absolute inset-0 ${
              manualConnection ? 'cursor-crosshair' : panSession ? 'cursor-grabbing' : 'cursor-grab'
            }`}
          >
            <div
              className="absolute inset-0 opacity-35"
              style={{
                backgroundImage:
                  'radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--color-border-black) 24%, transparent) 1px, transparent 0)',
                backgroundSize: '24px 24px',
              }}
            />

            <div
              className="absolute left-0 top-0"
              style={{
                width: model.width,
                height: model.height,
                transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
                transformOrigin: '0 0',
              }}
            >
              <svg
                className="pointer-events-none absolute inset-0"
                width={model.width}
                height={model.height}
                viewBox={`0 0 ${model.width} ${model.height}`}
                fill="none"
              >
                {model.edges.map((edge) => {
                  const from = nodeByLinkId.get(edge.fromLinkId);
                  const to = nodeByLinkId.get(edge.toLinkId);
                  if (!from || !to) {
                    return null;
                  }

                  return (
                    <path
                      key={edge.id}
                      d={buildCurvePath(
                        { x: from.center.x, y: from.center.y + from.height / 2 - 2 },
                        { x: to.center.x, y: to.center.y - to.height / 2 + 2 },
                      )}
                      className="stroke-border-black/42 dark:stroke-border-strong/45"
                      strokeWidth={1.8}
                      strokeLinecap="round"
                    />
                  );
                })}

                {dragSourceNode && manualConnection?.pointer ? (
                  <path
                    d={buildCurvePath(dragSourceNode.handle, manualConnection.pointer)}
                    className="stroke-system-blue"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeDasharray="7 5"
                  />
                ) : null}
              </svg>

              {model.groups.map((group) => {
                const labelText = `${labels.mergeTo}: ${formatGeometryType(group.candidate.suggestedType ?? group.candidate.target.geometry.type)}`;
                const metricText = getMetricSummary(group.candidate);
                const groupToneClass = group.checked
                  ? 'border-system-blue/35 bg-system-blue/10'
                  : group.pairType === 'manual'
                    ? 'border-system-blue/28 bg-system-blue/6 border-dashed'
                    : 'border-border-black/45 bg-element-hover/55';

                return (
                  <React.Fragment key={group.id}>
                    <div
                      className={`absolute rounded-[24px] border ${groupToneClass}`}
                      style={{
                        left: group.bounds.x,
                        top: group.bounds.y,
                        width: group.bounds.width,
                        height: group.bounds.height,
                      }}
                    />

                    <div
                      className="absolute z-10"
                      style={{
                        left: group.labelAnchor.x,
                        top: group.labelAnchor.y,
                        transform: 'translate(-100%, -100%)',
                      }}
                    >
                      <button
                        type="button"
                        data-graph-no-pan="true"
                        onClick={() => {
                          if (group.candidate.eligible) {
                            onToggleCandidate(
                              createCollisionOptimizationCandidateKey(group.candidate),
                            );
                          }
                        }}
                        className={`grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-2xl border px-2.5 py-1.5 text-left shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30 ${
                          group.checked
                            ? 'border-system-blue/35 bg-panel-bg text-system-blue hover:bg-system-blue/8'
                            : 'border-border-black bg-panel-bg text-text-primary hover:bg-element-hover'
                        }`}
                      >
                        <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-xl border border-system-blue/20 bg-system-blue/10 px-1.5 text-[9px] font-semibold tracking-[0.18em]">
                          {getPrimitiveMonogram(group.candidate.suggestedType)}
                        </span>

                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-1">
                            <span className="rounded-full border border-border-black bg-element-bg px-1.5 py-0.5 text-[8px] font-semibold tracking-[0.02em] text-text-tertiary">
                              {group.pairType === 'manual' ? labels.manualPair : labels.autoPair}
                            </span>
                            <span className="truncate text-[10px] font-semibold">{labelText}</span>
                          </span>
                          {metricText ? (
                            <span className="mt-0.5 block truncate text-[8px] text-text-secondary">
                              {metricText}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </div>
                  </React.Fragment>
                );
              })}

              {model.nodes.map((node) => {
                const connectable =
                  manualConnection?.sourceTargetId && node.summaryTarget
                    ? node.summaryTarget.id !== manualConnection.sourceTargetId &&
                      canCreateManualPair(manualConnection.sourceTargetId, node.summaryTarget.id)
                    : false;
                const nodeToneClass = getNodeTone(
                  node,
                  Boolean(manualConnection),
                  Boolean(connectable),
                );
                const summaryCandidate = node.summaryCandidate;
                const summaryTarget = node.summaryTarget;
                const summaryType = summaryCandidate?.suggestedType ?? summaryTarget?.geometry.type;
                const summaryMetricText =
                  summaryCandidate && !summaryCandidate.secondaryTarget
                    ? getMetricSummary(summaryCandidate)
                    : '';

                return (
                  <div
                    key={node.id}
                    data-graph-node={node.linkId}
                    data-graph-node-target-id={summaryTarget?.id ?? undefined}
                    className="absolute"
                    style={{
                      left: node.x,
                      top: node.y,
                      width: node.width,
                      height: node.height,
                    }}
                  >
                    <div
                      className={`relative h-full rounded-full border shadow-sm ${nodeToneClass}`}
                    >
                      <button
                        type="button"
                        data-graph-no-pan="true"
                        onClick={() => {
                          if (summaryTarget) {
                            onSelectTarget?.(summaryTarget);
                          }
                        }}
                        className="flex h-full w-full items-center gap-1.5 rounded-full px-2.5 pr-9 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
                        title={
                          node.componentName
                            ? `${node.componentName} / ${node.linkName}`
                            : node.linkName
                        }
                      >
                        <span
                          className={`h-[7px] w-[7px] shrink-0 rounded-full ${node.checked ? 'bg-system-blue' : 'bg-text-tertiary'}`}
                        />
                        <span className="min-w-0 flex-1 truncate text-[9px] font-semibold text-text-primary">
                          {node.linkName}
                        </span>
                        {node.targetCount > 1 ? (
                          <span className="shrink-0 rounded-full border border-border-black bg-panel-bg px-1.5 py-0.5 text-[7px] font-medium text-text-tertiary">
                            {node.targetCount}
                          </span>
                        ) : null}
                      </button>

                      {summaryCandidate ? (
                        <div
                          data-graph-no-pan="true"
                          className="absolute right-1 top-1 rounded-full bg-panel-bg/90 p-0.75 shadow-sm"
                        >
                          <Checkbox
                            checked={node.checked}
                            onChange={() => {
                              if (summaryCandidate.eligible) {
                                onToggleCandidate(
                                  createCollisionOptimizationCandidateKey(summaryCandidate),
                                );
                              }
                            }}
                            disabled={!summaryCandidate.eligible}
                            ariaLabel={
                              node.checked ? labels.unselectCandidate : labels.selectCandidate
                            }
                            className="shrink-0"
                          />
                        </div>
                      ) : null}

                      {summaryTarget ? (
                        <button
                          type="button"
                          data-graph-no-pan="true"
                          aria-label={labels.connectionHandle}
                          title={labels.connectionHandle}
                          onPointerDown={(event) => handleConnectionStart(event, summaryTarget)}
                          className={`absolute -bottom-1 right-2 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30 ${
                            connectable || !manualConnection
                              ? 'border-border-black bg-element-bg text-text-secondary hover:bg-element-hover hover:text-text-primary'
                              : 'border-system-blue/30 bg-system-blue/10 text-system-blue'
                          }`}
                        >
                          <span className="h-1.25 w-1.25 rounded-full bg-current" />
                        </button>
                      ) : null}
                    </div>

                    {summaryCandidate && !summaryCandidate.secondaryTarget ? (
                      <div
                        className="pointer-events-none absolute left-1/2 top-full mt-1.5 -translate-x-1/2"
                        style={{ maxWidth: Math.max(node.width + 24, 140) }}
                      >
                        <div className="rounded-full border border-border-black bg-panel-bg/96 px-2 py-1 text-center shadow-sm">
                          <div className="flex items-center justify-center gap-1">
                            <span className="rounded-full border border-system-blue/20 bg-system-blue/10 px-1.5 py-0.5 text-[7px] font-semibold tracking-[0.18em] text-system-blue">
                              {getPrimitiveMonogram(summaryType)}
                            </span>
                            <span className="truncate text-[8px] font-medium text-text-primary">
                              {formatGeometryType(summaryType)}
                            </span>
                          </div>
                          {summaryMetricText ? (
                            <div className="mt-0.5 truncate text-[7px] text-text-secondary">
                              {summaryMetricText}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default CollisionOptimizationPlanarGraph;
