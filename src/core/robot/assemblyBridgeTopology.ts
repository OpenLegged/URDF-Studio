import { type BridgeJoint, type JointType } from '@/types';

type AssemblyBridgeTopologyEdge = Pick<
  BridgeJoint,
  'id' | 'parentComponentId' | 'childComponentId'
>;

export function buildAssemblyParentByChildComponentId(
  bridges: Iterable<AssemblyBridgeTopologyEdge>,
  options?: { ignoreBridgeId?: string },
): Map<string, string> {
  const parentByChildComponentId = new Map<string, string>();

  for (const bridge of bridges) {
    if (bridge.id === options?.ignoreBridgeId) {
      continue;
    }

    if (!parentByChildComponentId.has(bridge.childComponentId)) {
      parentByChildComponentId.set(bridge.childComponentId, bridge.parentComponentId);
    }
  }

  return parentByChildComponentId;
}

export function isAssemblyBridgeCyclic(
  parentByChildComponentId: Map<string, string>,
  parentComponentId: string,
  childComponentId: string,
): boolean {
  return parentComponentId === childComponentId ||
    wouldCreateAssemblyComponentCycle(
      parentByChildComponentId,
      parentComponentId,
      childComponentId,
    );
}

export function wouldCreateAssemblyComponentCycle(
  parentByChildComponentId: Map<string, string>,
  parentComponentId: string,
  childComponentId: string,
): boolean {
  const visitedComponentIds = new Set<string>();
  let currentComponentId: string | undefined = parentComponentId;

  while (currentComponentId) {
    if (currentComponentId === childComponentId) {
      return true;
    }
    // Guard against cyclic parent maps so traversal terminates.
    if (visitedComponentIds.has(currentComponentId)) {
      return false;
    }
    visitedComponentIds.add(currentComponentId);

    currentComponentId = parentByChildComponentId.get(currentComponentId);
  }

  return false;
}

/**
 * Classify bridges into structural tree edges and cyclic (loop-closing) edges.
 * A bridge is cyclic when it links a component to itself or to an ancestor in
 * the parent chain. All cyclic bridges — fixed or movable — become closed-loop
 * constraints; only the tree edges remain structural joints.
 */
export function classifyAssemblyBridges(
  bridges: Iterable<AssemblyBridgeTopologyEdge>,
): {
  structuralEdges: AssemblyBridgeTopologyEdge[];
  cyclicEdges: AssemblyBridgeTopologyEdge[];
  parentByChildComponentId: Map<string, string>;
} {
  const structuralEdges: AssemblyBridgeTopologyEdge[] = [];
  const cyclicEdges: AssemblyBridgeTopologyEdge[] = [];
  const parentByChildComponentId = new Map<string, string>();
  const orderedBridges = Array.from(bridges);

  for (const bridge of orderedBridges) {
    if (bridge.childComponentId === bridge.parentComponentId) {
      cyclicEdges.push(bridge);
      continue;
    }

    if (wouldCreateAssemblyComponentCycle(
      parentByChildComponentId,
      bridge.parentComponentId,
      bridge.childComponentId,
    )) {
      cyclicEdges.push(bridge);
      continue;
    }

    structuralEdges.push(bridge);
    parentByChildComponentId.set(bridge.childComponentId, bridge.parentComponentId);
  }

  return { structuralEdges, cyclicEdges, parentByChildComponentId };
}

export function wouldBridgeCreateUnsupportedAssemblyCycle(
  _bridges: Iterable<AssemblyBridgeTopologyEdge>,
  _bridge: AssemblyBridgeTopologyEdge,
  _jointType: JointType,
  _options?: { ignoreBridgeId?: string },
): boolean {
  // All cyclic bridges (fixed and movable) are supported as closed-loop
  // constraints, so no joint type creates an unsupported cycle anymore.
  return false;
}
