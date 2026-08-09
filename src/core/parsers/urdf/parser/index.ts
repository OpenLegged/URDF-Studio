import {
  DEFAULT_COLLISION_COLOR,
  DEFAULT_VISUAL_COLOR,
  GeometryType,
  IMPORTED_EXTERNAL_FRAME_LINK_TYPE,
  type RobotState,
  type UrdfJoint,
  type UrdfLink,
} from '@/types';
import { preprocessXML } from './utils';
import { parseMaterials } from './materialParser';
import { parseLinks } from './linkParser';
import { parseJoints } from './jointParser';
import { buildUrdfInspectionContext } from './diagnostics';

function createImportedExternalFrameLink(linkId: string): UrdfLink {
  return {
    id: linkId,
    name: linkId,
    type: IMPORTED_EXTERNAL_FRAME_LINK_TYPE,
    visible: true,
    visual: {
      type: GeometryType.NONE,
      dimensions: { x: 0, y: 0, z: 0 },
      color: DEFAULT_VISUAL_COLOR,
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
    },
    visualBodies: [],
    collision: {
      type: GeometryType.NONE,
      dimensions: { x: 0, y: 0, z: 0 },
      color: DEFAULT_COLLISION_COLOR,
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
    },
    collisionBodies: [],
  };
}

function synthesizeMissingExternalParentLinks(
  links: Record<string, UrdfLink>,
  joints: Record<string, UrdfJoint>,
): Record<string, UrdfLink> {
  let nextLinks = links;

  Object.values(joints).forEach((joint) => {
    if (!joint.parentLinkId || !joint.childLinkId) {
      return;
    }

    if (links[joint.parentLinkId] || !links[joint.childLinkId]) {
      return;
    }

    if (nextLinks === links) {
      nextLinks = { ...links };
    }

    nextLinks[joint.parentLinkId] = createImportedExternalFrameLink(joint.parentLinkId);
  });

  return nextLinks;
}

function getValidInternalJoints(
  links: Record<string, UrdfLink>,
  joints: Record<string, UrdfJoint>,
): UrdfJoint[] {
  return Object.values(joints).filter(
    (joint) => Boolean(links[joint.parentLinkId]) && Boolean(links[joint.childLinkId]),
  );
}

function countReachableLinks(
  rootLinkId: string,
  childJointsByParent: Map<string, UrdfJoint[]>,
): number {
  const visited = new Set<string>();
  const stack = [rootLinkId];

  while (stack.length > 0) {
    const linkId = stack.pop();
    if (!linkId || visited.has(linkId)) {
      continue;
    }

    visited.add(linkId);
    (childJointsByParent.get(linkId) || []).forEach((joint) => {
      if (joint.childLinkId && !visited.has(joint.childLinkId)) {
        stack.push(joint.childLinkId);
      }
    });
  }

  return visited.size;
}

function resolveRootLinkId(
  links: Record<string, UrdfLink>,
  joints: Record<string, UrdfJoint>,
): string | null {
  const internalJoints = getValidInternalJoints(links, joints);
  const childLinkIds = new Set(internalJoints.map((joint) => joint.childLinkId));
  const rootCandidates = Object.keys(links).filter((linkId) => !childLinkIds.has(linkId));

  if (rootCandidates.length === 0) {
    // Every link is some joint's child, so the joint graph is entirely cyclic
    // and no link can anchor it. Anchor on the first declared link anyway so the
    // document still imports; import recovery breaks the cycle and re-resolves
    // the root from what survives.
    return Object.keys(links)[0] ?? null;
  }

  if (rootCandidates.length === 1) {
    return rootCandidates[0];
  }

  const childJointsByParent = new Map<string, UrdfJoint[]>();
  internalJoints.forEach((joint) => {
    const children = childJointsByParent.get(joint.parentLinkId) || [];
    children.push(joint);
    childJointsByParent.set(joint.parentLinkId, children);
  });

  return [...rootCandidates].sort(
    (left, right) =>
      countReachableLinks(right, childJointsByParent) -
      countReachableLinks(left, childJointsByParent),
  )[0];
}

export const parseURDF = (xmlString: string): RobotState | null => {
  // Preprocess XML to fix common issues
  xmlString = preprocessXML(xmlString);

  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, 'text/xml');

  // Check for XML parsing errors
  const parseError = xmlDoc.querySelector('parsererror');
  if (parseError) {
    console.error('XML parsing error:', parseError.textContent);
    return null;
  }

  const robotEl = xmlDoc.querySelector('robot');
  if (!robotEl) {
    console.error('Invalid URDF: No <robot> tag found.');
    return null;
  }

  const name = robotEl.getAttribute('name') || 'imported_robot';
  const version = robotEl.getAttribute('version')?.trim() || undefined;

  let globalMaterials: Record<
    string,
    { color?: string; colorRgba?: [number, number, number, number]; texture?: string }
  >;
  let linkGazeboMaterials: Record<string, string>;
  let parsedLinks: Record<string, UrdfLink>;
  let extraJoints: ReturnType<typeof parseLinks>['extraJoints'];
  let linkMaterials: Record<
    string,
    { color?: string; colorRgba?: [number, number, number, number]; texture?: string }
  >;
  let joints: Record<string, UrdfJoint>;

  try {
    const materialResult = parseMaterials(robotEl);
    globalMaterials = materialResult.globalMaterials;
    linkGazeboMaterials = materialResult.linkGazeboMaterials;

    const linkResult = parseLinks(robotEl, globalMaterials, linkGazeboMaterials);
    parsedLinks = linkResult.links;
    extraJoints = linkResult.extraJoints;
    linkMaterials = linkResult.linkMaterials;

    joints = parseJoints(robotEl);
  } catch (error) {
    console.error('[URDFParser] Failed to parse URDF document:', error);
    return null;
  }

  if (Object.keys(parsedLinks).length === 0) {
    console.error('Invalid URDF: No <link> tags found.');
    return null;
  }

  // Add virtual joints from multi-collision parsing
  extraJoints.forEach((j) => {
    joints[j.id] = j;
  });

  const links = synthesizeMissingExternalParentLinks(parsedLinks, joints);

  // 3. Find Root
  // The root link is the largest internally connected component root. Some
  // robotics packages anchor the robot to an undeclared external frame such as
  // "world"; those anchors are synthesized above so the internal tree remains
  // valid without hard-coding any particular frame name.
  const rootId = resolveRootLinkId(links, joints);

  if (!rootId) {
    console.error('Invalid URDF: Could not determine a unique root link.');
    return null;
  }

  const urdfInspectionContext = buildUrdfInspectionContext({
    robotEl,
    parsedLinks,
    joints,
    rootLinkId: rootId,
  });

  const materials = Object.fromEntries(
    Object.entries(linkMaterials)
      .filter(([, material]) => Boolean(material.color || material.colorRgba || material.texture))
      .map(([linkId, material]) => [linkId, material]),
  );

  return {
    name,
    version,
    links,
    joints,
    rootLinkId: rootId,
    ...(Object.keys(materials).length > 0 ? { materials } : {}),
    inspectionContext: {
      sourceFormat: 'urdf',
      urdf: urdfInspectionContext,
    },
    selection: { type: 'link', id: rootId },
  };
};
