import {
  createStableJsonSnapshot,
  stripTransientJointMotionFromJoint,
} from '@/shared/utils/robot/semanticSnapshot';
import type { RobotData, UrdfJoint, UrdfLink } from '@/types/index';

interface CreateViewerRobotLoadInputSignatureOptions {
  urdfContent: string;
  hasStructuredRobotState: boolean;
  robotLinks?: Record<string, UrdfLink>;
  robotJoints?: Record<string, UrdfJoint>;
  robotName?: string;
  rootLinkId?: string;
  robotMaterials?: RobotData['materials'];
  inspectionContext?: RobotData['inspectionContext'];
}

function hashStringFNV1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function stripPatchableRuntimeStateFromGeometry<T extends UrdfLink['visual']>(geometry: T): T {
  const { color: _color, visible: _visible, authoredMaterials, ...restGeometry } = geometry;
  const nextGeometry = { ...restGeometry } as T;

  if (authoredMaterials) {
    nextGeometry.authoredMaterials = authoredMaterials.map((material) => {
      const { color: _materialColor, colorRgba: _colorRgba, ...restMaterial } = material;
      return restMaterial;
    });
  }

  return nextGeometry;
}

export function stripPatchableRuntimeStateFromJoints(
  joints: Record<string, UrdfJoint>,
): Record<string, Partial<UrdfJoint>> {
  // These fields are applied incrementally by the in-place joint patch path
  // (detectJointPatches -> patchJointsInPlace), so they must NOT contribute to
  // the load-scope signature. Otherwise a property-panel single-field edit
  // churns the scope key and forces a full async robot rebuild. Topology fields
  // such as id/parent/child stay in the signature so real structural changes
  // still trigger a rebuild.
  return Object.fromEntries(
    Object.entries(joints).map(([jointId, joint]) => {
      const {
        name: _name,
        type: _type,
        origin: _origin,
        axis: _axis,
        limit: _limit,
        dynamics: _dynamics,
        hardware: _hardware,
        ...rest
      } = stripTransientJointMotionFromJoint(joint);
      return [jointId, rest];
    }),
  );
}

function stripPatchableRuntimeStateFromLinks(
  links: Record<string, UrdfLink>,
): Record<string, UrdfLink> {
  return Object.fromEntries(
    Object.entries(links).map(([linkId, link]) => {
      const {
        visible: _visible,
        visual,
        visualBodies,
        collision,
        collisionBodies,
        ...restLink
      } = link;

      return [
        linkId,
        {
          ...restLink,
          visual: stripPatchableRuntimeStateFromGeometry(visual),
          visualBodies: visualBodies?.map(stripPatchableRuntimeStateFromGeometry),
          collision: stripPatchableRuntimeStateFromGeometry(collision),
          collisionBodies: collisionBodies?.map(stripPatchableRuntimeStateFromGeometry),
        },
      ];
    }),
  );
}

export function createViewerRobotLoadInputSignature({
  urdfContent,
  hasStructuredRobotState,
  robotLinks,
  robotJoints,
  robotName,
  rootLinkId,
  robotMaterials,
  inspectionContext,
}: CreateViewerRobotLoadInputSignatureOptions): string {
  if (hasStructuredRobotState && robotLinks && robotJoints) {
    const structuredSnapshot = createStableJsonSnapshot({
      runtimeBuildMetadata: {
        name: robotName ?? null,
        rootLinkId: rootLinkId ?? null,
        materials: robotMaterials ?? null,
        inspectionContext: inspectionContext ?? null,
      },
      links: stripPatchableRuntimeStateFromLinks(robotLinks),
      joints: stripPatchableRuntimeStateFromJoints(robotJoints),
    });
    return `structured:${hashStringFNV1a(structuredSnapshot)}`;
  }

  return `content:${hashStringFNV1a(urdfContent)}`;
}
