/**
 * Assembly Merger - Merges AssemblyState into a single RobotData
 * Used for rendering and URDF export
 */
import * as THREE from 'three';

import {
  type AssemblyState,
  type RobotClosedLoopConstraint,
  type RobotData,
  type UrdfJoint,
} from '@/types';

import { computeLinkWorldMatrices } from './kinematics';
import { classifyAssemblyBridges } from './assemblyBridgeTopology';
import { rerootAssemblyComponentRobot } from './assemblyReroot';

function resolveAssemblyBridgeLinkId(robot: RobotData, linkId: string): string | null {
  return robot.links[linkId] ? linkId : null;
}

function requireAssemblyBridgeLinkId(
  assemblyName: string,
  bridgeId: string,
  bridgeSide: 'parent' | 'child',
  componentId: string,
  robot: RobotData,
  linkId: string,
): string {
  const resolvedLinkId = resolveAssemblyBridgeLinkId(robot, linkId);
  if (resolvedLinkId) {
    return resolvedLinkId;
  }

  throw new Error(
    `Cannot merge assembly "${assemblyName}" because bridge "${bridgeId}" references missing ${bridgeSide} link "${linkId}" on component "${componentId}"`,
  );
}

function assertMergedLinksHaveSingleParentJoint(
  assemblyName: string,
  joints: RobotData['joints'],
): void {
  const incomingJointIdsByChildLinkId = new Map<string, string[]>();

  Object.values(joints).forEach((joint) => {
    const incomingJointIds = incomingJointIdsByChildLinkId.get(joint.childLinkId) ?? [];
    incomingJointIds.push(joint.id);
    incomingJointIdsByChildLinkId.set(joint.childLinkId, incomingJointIds);
  });

  for (const [childLinkId, incomingJointIds] of incomingJointIdsByChildLinkId.entries()) {
    if (incomingJointIds.length <= 1) {
      continue;
    }

    throw new Error(
      `Cannot merge assembly "${assemblyName}" because link "${childLinkId}" would have multiple parent joints: ${incomingJointIds.join(', ')}`,
    );
  }
}

interface VisibleAssemblyBridgeResolution {
  bridge: AssemblyState['bridges'][string];
  parentRobot: RobotData;
  childRobot: RobotData;
  resolvedParentLinkId: string;
  resolvedChildLinkId: string;
}

function collectVisibleAssemblyBridgeResolutions(
  assembly: AssemblyState,
  visibleCompIds: Set<string>,
  effectiveRobotByComponentId: Map<string, RobotData>,
): VisibleAssemblyBridgeResolution[] {
  return Object.values(assembly.bridges).flatMap((bridge) => {
    if (
      !visibleCompIds.has(bridge.parentComponentId) ||
      !visibleCompIds.has(bridge.childComponentId)
    ) {
      return [];
    }

    const parentRobot =
      effectiveRobotByComponentId.get(bridge.parentComponentId) ??
      assembly.components[bridge.parentComponentId]?.robot;
    const childRobot =
      effectiveRobotByComponentId.get(bridge.childComponentId) ??
      assembly.components[bridge.childComponentId]?.robot;

    if (!parentRobot) {
      throw new Error(
        `Cannot merge assembly "${assembly.name}" because bridge "${bridge.id}" references missing parent component "${bridge.parentComponentId}"`,
      );
    }
    if (!childRobot) {
      throw new Error(
        `Cannot merge assembly "${assembly.name}" because bridge "${bridge.id}" references missing child component "${bridge.childComponentId}"`,
      );
    }

    return [
      {
        bridge,
        parentRobot,
        childRobot,
        resolvedParentLinkId: requireAssemblyBridgeLinkId(
          assembly.name,
          bridge.id,
          'parent',
          bridge.parentComponentId,
          parentRobot,
          bridge.parentLinkId,
        ),
        resolvedChildLinkId: requireAssemblyBridgeLinkId(
          assembly.name,
          bridge.id,
          'child',
          bridge.childComponentId,
          childRobot,
          bridge.childLinkId,
        ),
      },
    ];
  });
}

function createBridgeClosedLoopConstraint(
  bridge: AssemblyState['bridges'][string],
  parentLinkId: string,
  childLinkId: string,
  linkWorldMatrices: Record<string, THREE.Matrix4>,
): RobotClosedLoopConstraint {
  const parentAnchorLocal = {
    x: Number.isFinite(bridge.joint.origin?.xyz?.x) ? bridge.joint.origin.xyz.x : 0,
    y: Number.isFinite(bridge.joint.origin?.xyz?.y) ? bridge.joint.origin.xyz.y : 0,
    z: Number.isFinite(bridge.joint.origin?.xyz?.z) ? bridge.joint.origin.xyz.z : 0,
  };
  const parentAnchorWorld = new THREE.Vector3(
    parentAnchorLocal.x,
    parentAnchorLocal.y,
    parentAnchorLocal.z,
  );
  const parentLinkMatrix = linkWorldMatrices[parentLinkId];

  if (parentLinkMatrix) {
    parentAnchorWorld.applyMatrix4(parentLinkMatrix);
  }

  const baseConstraint = {
    id: bridge.id,
    linkAId: parentLinkId,
    linkBId: childLinkId,
    anchorLocalA: parentAnchorLocal,
    anchorLocalB: { x: 0, y: 0, z: 0 },
    anchorWorld: {
      x: parentAnchorWorld.x,
      y: parentAnchorWorld.y,
      z: parentAnchorWorld.z,
    },
    source: undefined,
  };

  // Every authored bridge keeps its joint semantics. In particular, a fixed
  // closure locks orientation as well as position; a connect only locks a point.
  return {
    ...baseConstraint,
    type: 'joint',
    jointType: bridge.joint.type,
    ...(bridge.joint.axis ? { axis: structuredClone(bridge.joint.axis) } : {}),
    ...(bridge.joint.limit ? { limit: structuredClone(bridge.joint.limit) } : {}),
    origin: structuredClone(bridge.joint.origin),
  };
}

/** Merges an AssemblyState whose component robots already carry projection-global IDs. */
export function mergeProjectedAssembly(assembly: AssemblyState): RobotData {
  const links: RobotData['links'] = {};
  const joints: RobotData['joints'] = {};
  const materials: RobotData['materials'] = {};
  const closedLoopConstraints: RobotClosedLoopConstraint[] = [];
  let inspectionContext: RobotData['inspectionContext'] | undefined;
  const componentVersions = new Set<string>();
  const effectiveRobotByComponentId = new Map<string, RobotData>();
  let fallbackRootLinkId = '';

  const comps = Object.values(assembly.components).filter((c) => c.visible !== false);
  const visibleCompIds = new Set(comps.map((c) => c.id));
  if (comps.length === 0) {
    return {
      name: assembly.name,
      links: {},
      joints: {},
      rootLinkId: '',
    };
  }

  comps.forEach((component) => {
    effectiveRobotByComponentId.set(component.id, component.robot);
  });

  const visibleBridgeResolutions = collectVisibleAssemblyBridgeResolutions(
    assembly,
    visibleCompIds,
    effectiveRobotByComponentId,
  );
  // Structural bridges form the merged tree; every cyclic bridge (self-loop or
  // ancestor loop, fixed or movable) becomes a closed-loop constraint.
  const { structuralEdges, cyclicEdges } = classifyAssemblyBridges(
    visibleBridgeResolutions.map(({ bridge }) => bridge),
  );
  const structuralBridgeIds = new Set(structuralEdges.map((edge) => edge.id));
  const closedLoopBridgeIds = new Set(cyclicEdges.map((edge) => edge.id));

  visibleBridgeResolutions.forEach(({ bridge, resolvedChildLinkId }) => {
    if (!structuralBridgeIds.has(bridge.id)) {
      return;
    }

    const childRobot = effectiveRobotByComponentId.get(bridge.childComponentId);
    if (!childRobot || resolvedChildLinkId === childRobot.rootLinkId) {
      return;
    }

    effectiveRobotByComponentId.set(
      bridge.childComponentId,
      rerootAssemblyComponentRobot(childRobot, resolvedChildLinkId, bridge.childComponentId),
    );
  });

  const structuralBridgeResolutions = collectVisibleAssemblyBridgeResolutions(
    assembly,
    visibleCompIds,
    effectiveRobotByComponentId,
  ).filter(({ bridge }) => structuralBridgeIds.has(bridge.id));

  const closedLoopBridgeResolutions = collectVisibleAssemblyBridgeResolutions(
    assembly,
    visibleCompIds,
    effectiveRobotByComponentId,
  ).filter(({ bridge }) => closedLoopBridgeIds.has(bridge.id));

  // Guard against unexpected cycles that slipped through classification.
  if (
    structuralBridgeResolutions.length + closedLoopBridgeResolutions.length !==
    visibleBridgeResolutions.length
  ) {
    throw new Error(
      `Cannot merge assembly "${assembly.name}" because not all visible bridges were classified as structural or closed-loop`,
    );
  }

  // 1. Merge component links/joints whose IDs were allocated by scene projection.
  for (const comp of comps) {
    const robot = effectiveRobotByComponentId.get(comp.id) ?? comp.robot;
    const version = robot.version?.trim();
    if (version) {
      componentVersions.add(version);
    }
    for (const [id, link] of Object.entries(robot.links)) {
      links[id] = link;
    }
    for (const [id, joint] of Object.entries(robot.joints)) {
      joints[id] = joint;
    }
    closedLoopConstraints.push(...(robot.closedLoopConstraints || []));
    if (robot.materials) {
      Object.assign(materials, robot.materials);
    }
    if (!inspectionContext && robot.inspectionContext) {
      inspectionContext = robot.inspectionContext;
    }
    if (!fallbackRootLinkId) {
      fallbackRootLinkId = robot.rootLinkId;
    }
  }

  // 2. Add bridge joints whose endpoints already use projection-global link IDs.
  for (const {
    bridge,
    resolvedParentLinkId: parentId,
    resolvedChildLinkId: childId,
  } of structuralBridgeResolutions) {
    const j = bridge.joint;
    if (!links[parentId]) {
      throw new Error(
        `Cannot merge assembly "${assembly.name}" because resolved parent link "${parentId}" for bridge "${bridge.id}" is not present in merged links`,
      );
    }
    if (!links[childId]) {
      throw new Error(
        `Cannot merge assembly "${assembly.name}" because resolved child link "${childId}" for bridge "${bridge.id}" is not present in merged links`,
      );
    }

    const jointId = bridge.id;
    const fullJoint: UrdfJoint = {
      ...j,
      id: jointId,
      name: bridge.name,
      parentLinkId: parentId,
      childLinkId: childId,
    };
    joints[jointId] = fullJoint;
  }

  assertMergedLinksHaveSingleParentJoint(assembly.name, joints);

  const childLinkIds = new Set<string>();
  Object.values(joints).forEach((joint) => {
    childLinkIds.add(joint.childLinkId);
  });

  const graphRootLinkIds = Object.keys(links).filter((linkId) => !childLinkIds.has(linkId));
  if (Object.keys(links).length > 0 && graphRootLinkIds.length === 0) {
    throw new Error(
      `Cannot merge assembly "${assembly.name}" because the merged joint graph has no root link; the assembly contains a cycle`,
    );
  }

  const graphRootLinkId = graphRootLinkIds[0] ?? '';
  const rootLinkId =
    graphRootLinkId ||
    (fallbackRootLinkId && links[fallbackRootLinkId] ? fallbackRootLinkId : '') ||
    Object.keys(links)[0] ||
    '';

  const treeRobot: RobotData = {
    name: assembly.name,
    ...(componentVersions.size === 1 ? { version: Array.from(componentVersions)[0] } : {}),
    links,
    joints,
    rootLinkId,
    materials: Object.keys(materials).length > 0 ? materials : undefined,
    closedLoopConstraints: closedLoopConstraints.length > 0 ? closedLoopConstraints : undefined,
    inspectionContext,
  };
  const linkWorldMatrices = computeLinkWorldMatrices(treeRobot);

  closedLoopBridgeResolutions.forEach(
    ({ bridge, resolvedParentLinkId: parentLinkId, resolvedChildLinkId: childLinkId }) => {
      if (!links[parentLinkId]) {
        throw new Error(
          `Cannot merge assembly "${assembly.name}" because resolved parent link "${parentLinkId}" for closed-loop bridge "${bridge.id}" is not present in merged links`,
        );
      }
      if (!links[childLinkId]) {
        throw new Error(
          `Cannot merge assembly "${assembly.name}" because resolved child link "${childLinkId}" for closed-loop bridge "${bridge.id}" is not present in merged links`,
        );
      }

      closedLoopConstraints.push(
        createBridgeClosedLoopConstraint(bridge, parentLinkId, childLinkId, linkWorldMatrices),
      );
    },
  );

  return {
    ...treeRobot,
    closedLoopConstraints: closedLoopConstraints.length > 0 ? closedLoopConstraints : undefined,
  };
}
