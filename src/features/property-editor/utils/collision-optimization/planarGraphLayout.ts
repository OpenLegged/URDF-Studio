/**
 * Collision optimization planar graph layout — pure layout/geometry/model
 * builders for the planar graph view. No React; `createViewportForBounds`
 * takes container dimensions instead of a DOM element so it stays pure.
 *
 * Boundary: feature utils (property-editor/collision-optimization). Imports
 * `@/types`, `@/core/robot/assemblyMerger`, and `../collisionOptimization`.
 */
import { mergeAssembly } from '@/core/robot/assemblyMerger';
import { GeometryType, type InteractionSelection } from '@/types';
import {
  createCollisionOptimizationCandidateKey,
  type CollisionOptimizationAnalysis,
  type CollisionOptimizationCandidate,
  type CollisionOptimizationManualMergePair,
  type CollisionOptimizationSource,
  type CollisionTargetRef,
} from '../collisionOptimization';

export const GRAPH_PADDING = 28;
export const NODE_HEIGHT = 28;
export const NODE_MIN_WIDTH = 84;
export const NODE_MAX_WIDTH = 150;
export const NODE_PILL_PADDING = 26;
export const NODE_GAP_X = 132;
export const NODE_GAP_Y = 92;
export const ROOT_GAP_UNITS = 1.15;
export const GROUP_PADDING_X = 18;
export const GROUP_PADDING_Y = 16;
export const MIN_SCALE = 0.32;
export const MAX_SCALE = 4.5;

export type GraphPairType = 'manual' | 'auto';
export type CollisionSelection = InteractionSelection;

export interface GraphPoint {
  x: number;
  y: number;
}

export interface ViewportState {
  x: number;
  y: number;
  scale: number;
}

export interface GraphBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  centerX: number;
  centerY: number;
}

export interface GraphNodeModel {
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

export interface GraphEdgeModel {
  id: string;
  fromLinkId: string;
  toLinkId: string;
}

export interface GraphGroupModel {
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

export interface GraphModel {
  nodes: GraphNodeModel[];
  edges: GraphEdgeModel[];
  groups: GraphGroupModel[];
  width: number;
  height: number;
  focusBounds: GraphBounds;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function buildPairKey(leftTargetId: string, rightTargetId: string): string {
  return `${leftTargetId}::${rightTargetId}`;
}

export function compareTargets(left: CollisionTargetRef, right: CollisionTargetRef): number {
  return (
    left.sequenceIndex - right.sequenceIndex ||
    left.objectIndex - right.objectIndex ||
    left.linkName.localeCompare(right.linkName) ||
    (left.componentName ?? '').localeCompare(right.componentName ?? '')
  );
}

export function buildCurvePath(from: GraphPoint, to: GraphPoint): string {
  const horizontalOffset = Math.max(34, Math.abs(to.x - from.x) * 0.38);
  return `M ${from.x} ${from.y} C ${from.x + horizontalOffset} ${from.y}, ${to.x - horizontalOffset} ${to.y}, ${to.x} ${to.y}`;
}

export function formatCompactNumber(value: number | null | undefined): string {
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

export function getGeometryMetrics(
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

export function getMetricSummary(candidate: CollisionOptimizationCandidate): string {
  return getGeometryMetrics(candidate)
    .map((metric) => `${metric.label} ${metric.value}`)
    .join(' · ');
}

export function getPrimitiveMonogram(type: GeometryType | null | undefined): string {
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

export function computeBounds(points: GraphPoint[]): GraphBounds {
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

export function expandBounds(bounds: GraphBounds, marginX: number, marginY: number): GraphBounds {
  return {
    minX: bounds.minX - marginX,
    maxX: bounds.maxX + marginX,
    minY: bounds.minY - marginY,
    maxY: bounds.maxY + marginY,
    centerX: bounds.centerX,
    centerY: bounds.centerY,
  };
}

export function createViewportForBounds(
  containerWidth: number,
  containerHeight: number,
  bounds: GraphBounds,
): ViewportState {
  const availableWidth = Math.max(containerWidth - 40, 320);
  const availableHeight = Math.max(containerHeight - 40, 240);
  const boundsWidth = Math.max(bounds.maxX - bounds.minX, 180);
  const boundsHeight = Math.max(bounds.maxY - bounds.minY, 180);
  const scale = clamp(
    Math.min(availableWidth / boundsWidth, availableHeight / boundsHeight),
    0.5,
    1.15,
  );

  return {
    scale,
    x: containerWidth / 2 - bounds.centerX * scale,
    y: containerHeight / 2 - bounds.centerY * scale,
  };
}

export function pickSummaryCandidate(
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

export function buildLinkComponentMap(
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

export function resolveRobot(source: CollisionOptimizationSource) {
  return source.kind === 'robot' ? source.robot : mergeAssembly(source.assembly);
}

export function buildTreeLayout(source: CollisionOptimizationSource): {
  positions: Map<string, GraphPoint>;
  edges: GraphEdgeModel[];
} {
  const robot = resolveRobot(source);
  const linkIds = Object.keys(robot.links);
  const childLinkIdSet = new Set<string>();
  const childrenByParent = new Map<string, string[]>();

  Object.values(robot.joints).forEach((joint) => {
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

  rootIds.forEach((rootId) => {
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

export function buildGraphModel(
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

export function getNodeTone(
  node: GraphNodeModel,
  manualConnection: boolean,
  connectable: boolean,
) {
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
