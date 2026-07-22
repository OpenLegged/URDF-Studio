import { DEFAULT_JOINT, DEFAULT_VISUAL_COLOR, type UrdfJoint, type UrdfLink } from '@/types';
import {
  applyDeletionPlan,
  buildDeletionPlan,
  createAttachedChildLink,
  hasComponentEditorLocks,
  isEntityEditorLocked,
  resolveRobotLinkEditorLock,
  resolveDefaultChildJointOrigin,
} from '@/core/robot';
import { syncRobotMaterialsForLinkUpdate } from '@/core/robot/materials';

import {
  createUniqueEntityId,
  removeInvalidBridges,
  repairRobotReferencesAfterDeletion,
} from './helpers';
import {
  applyWorkspaceJointPropertyPatch,
  applyWorkspaceLinkPropertyPatch,
} from './propertyPatches';
import type { WorkspaceRuntime } from './runtime';
import type { WorkspaceActions, WorkspaceStoreGet } from './types';

type TopologyActions = Pick<
  WorkspaceActions,
  | 'addLink'
  | 'updateLink'
  | 'deleteLink'
  | 'setLinkVisibility'
  | 'setLinkEditorLocked'
  | 'setAllLinksVisibility'
  | 'setAllWorkspaceLinksVisibility'
  | 'addJoint'
  | 'updateJoint'
  | 'deleteJoint'
  | 'updateTendon'
  | 'addChild'
  | 'deleteSubtree'
>;

interface LinkOwnedRobotReferences {
  linkNames: Set<string>;
  siteRefs: Set<string>;
  geometryRefs: Set<string>;
}

function collectLinkOwnedRobotReferences(
  links: Record<string, UrdfLink>,
  linkIds: Iterable<string>,
): LinkOwnedRobotReferences {
  const linkNames = new Set<string>();
  const siteRefs = new Set<string>();
  const geometryRefs = new Set<string>();

  for (const linkId of linkIds) {
    const link = links[linkId];
    if (!link) continue;
    linkNames.add(link.name);
    (link.mjcfSites ?? []).forEach((site) => {
      siteRefs.add(site.name);
      if (site.sourceName) siteRefs.add(site.sourceName);
    });
    [
      link.visual,
      ...(link.visualBodies ?? []),
      link.collision,
      ...(link.collisionBodies ?? []),
    ].forEach((geometry) => {
      if (geometry.name) geometryRefs.add(geometry.name);
    });
  }

  return { linkNames, siteRefs, geometryRefs };
}

function requireStableEntityId(
  patchId: string | undefined,
  entityId: string,
  entityType: 'link' | 'joint',
): void {
  if (patchId !== undefined && patchId !== entityId) {
    throw new Error(`${entityType} IDs are stable; expected "${entityId}".`);
  }
}

export function createTopologyActions(
  get: WorkspaceStoreGet,
  runtime: WorkspaceRuntime,
): TopologyActions {
  return {
    addLink: (componentId, link, options) => {
      if (get().workspace.components[componentId]?.editorLocked === true) return false;
      return runtime.applyMutation(
        'Add link',
        (draft) => {
          const robot = draft.components[componentId]?.robot;
          if (!robot) {
            return;
          }
          if (robot.links[link.id]) {
            throw new Error(`Link "${link.id}" already exists on component "${componentId}".`);
          }
          robot.links[link.id] = structuredClone(link);
        },
        options,
      );
    },

    updateLink: (ref, patch, options) => {
      requireStableEntityId(patch.id, ref.entityId, 'link');
      if (
        patch.editorLocked !== undefined
        || isEntityEditorLocked(get().workspace, ref)
      ) {
        return false;
      }
      return runtime.applyMutation(
        'Update link',
        (draft) => {
          const robot = draft.components[ref.componentId]?.robot;
          const current = robot?.links[ref.entityId];
          if (!robot || !current) {
            return;
          }
          const next = applyWorkspaceLinkPropertyPatch(current, patch);
          robot.links[ref.entityId] = next;
          robot.materials = syncRobotMaterialsForLinkUpdate(
            robot.materials,
            next,
            current,
          );
        },
        options,
      );
    },

    deleteLink: (ref, options) => {
      const component = get().workspace.components[ref.componentId];
      const connectedLinkIds = new Set([ref.entityId]);
      Object.values(component?.robot.joints ?? {}).forEach((joint) => {
        if (joint.parentLinkId === ref.entityId) connectedLinkIds.add(joint.childLinkId);
        if (joint.childLinkId === ref.entityId) connectedLinkIds.add(joint.parentLinkId);
      });
      if (
        !component
        || [...connectedLinkIds].some((entityId) => isEntityEditorLocked(
          get().workspace,
          { type: 'link', componentId: ref.componentId, entityId },
        ))
      ) {
        return false;
      }
      return runtime.applyMutation(
        'Delete link',
        (draft) => {
          const robot = draft.components[ref.componentId]?.robot;
          if (!robot?.links[ref.entityId] || robot.rootLinkId === ref.entityId) {
            return;
          }
          const deletedReferences = collectLinkOwnedRobotReferences(
            robot.links,
            [ref.entityId],
          );
          const deletedJointIds = new Set<string>();
          delete robot.links[ref.entityId];
          Object.entries(robot.joints).forEach(([jointId, joint]) => {
            if (joint.parentLinkId === ref.entityId || joint.childLinkId === ref.entityId) {
              delete robot.joints[jointId];
              deletedJointIds.add(jointId);
              deletedJointIds.add(joint.name);
            }
          });
          repairRobotReferencesAfterDeletion(
            robot,
            {
              deletedLinkIds: new Set([ref.entityId]),
              deletedJointIds,
              deletedLinkNames: deletedReferences.linkNames,
              deletedSiteRefs: deletedReferences.siteRefs,
              deletedGeometryRefs: deletedReferences.geometryRefs,
            },
          );
          removeInvalidBridges(draft);
        },
        options,
      );
    },

    setLinkVisibility: (ref, visible, options) =>
      runtime.applyMutation(
        'Set link visibility',
        (draft) => {
          const link = draft.components[ref.componentId]?.robot.links[ref.entityId];
          if (link) {
            link.visible = visible;
          }
        },
        options,
      ),

    setLinkEditorLocked: (ref, locked, options) => {
      const component = get().workspace.components[ref.componentId];
      const lockState = component
        ? resolveRobotLinkEditorLock(component.robot, ref.entityId)
        : null;
      if (
        !component
        || component.editorLocked === true
        || lockState?.source === 'ancestor'
      ) {
        return false;
      }
      return runtime.applyMutation(
        locked ? 'Lock link editing' : 'Unlock link editing',
        (draft) => {
          const link = draft.components[ref.componentId]?.robot.links[ref.entityId];
          if (!link) return;
          if (locked) link.editorLocked = true;
          else delete link.editorLocked;
        },
        options,
      );
    },

    setAllLinksVisibility: (componentId, visible, options) =>
      runtime.applyMutation(
        'Set all link visibility',
        (draft) => {
          const robot = draft.components[componentId]?.robot;
          if (!robot) {
            return;
          }
          Object.values(robot.links).forEach((link) => {
            link.visible = visible;
          });
        },
        options,
      ),

    setAllWorkspaceLinksVisibility: (visible, options) =>
      runtime.applyMutation(
        'Set workspace link visibility',
        (draft) => {
          Object.values(draft.components).forEach((component) => {
            Object.values(component.robot.links).forEach((link) => {
              link.visible = visible;
            });
          });
        },
        options,
      ),

    addJoint: (componentId, joint, options) => {
      const workspace = get().workspace;
      if (
        workspace.components[componentId]?.editorLocked === true
        || isEntityEditorLocked(workspace, {
          type: 'link', componentId, entityId: joint.parentLinkId,
        })
        || isEntityEditorLocked(workspace, {
          type: 'link', componentId, entityId: joint.childLinkId,
        })
      ) {
        return false;
      }
      return runtime.applyMutation(
        'Add joint',
        (draft) => {
          const robot = draft.components[componentId]?.robot;
          if (!robot) {
            return;
          }
          if (robot.joints[joint.id]) {
            throw new Error(`Joint "${joint.id}" already exists on component "${componentId}".`);
          }
          robot.joints[joint.id] = structuredClone(joint);
        },
        options,
      );
    },

    updateJoint: (ref, patch, options) => {
      requireStableEntityId(patch.id, ref.entityId, 'joint');
      if (isEntityEditorLocked(get().workspace, ref)) return false;
      return runtime.applyMutation(
        'Update joint',
        (draft) => {
          const robot = draft.components[ref.componentId]?.robot;
          const joint = robot?.joints[ref.entityId];
          if (joint && robot) {
            robot.joints[ref.entityId] = applyWorkspaceJointPropertyPatch(joint, patch);
          }
        },
        options,
      );
    },

    deleteJoint: (ref, options) => {
      if (isEntityEditorLocked(get().workspace, ref)) return false;
      return runtime.applyMutation(
        'Delete joint',
        (draft) => {
          const joints = draft.components[ref.componentId]?.robot.joints;
          const robot = draft.components[ref.componentId]?.robot;
          if (joints?.[ref.entityId] && robot) {
            const deletedJointRefs = new Set([
              ref.entityId,
              joints[ref.entityId]!.name,
            ]);
            delete joints[ref.entityId];
            repairRobotReferencesAfterDeletion(
              robot,
              { deletedLinkIds: new Set(), deletedJointIds: deletedJointRefs },
            );
          }
        },
        options,
      );
    },

    updateTendon: (ref, patch, options) => {
      const component = get().workspace.components[ref.componentId];
      if (!component || hasComponentEditorLocks(component)) return false;
      return runtime.applyMutation(
        'Update tendon',
        (draft) => {
          const tendon = draft.components[
            ref.componentId
          ]?.robot.inspectionContext?.mjcf?.tendons.find(
            (candidate) => candidate.name === ref.entityId,
          );
          if (!tendon) {
            return;
          }
          if (patch.width !== undefined && Number.isFinite(patch.width)) {
            tendon.width = patch.width;
          }
          if (patch.rgba?.every(Number.isFinite)) {
            tendon.rgba = [...patch.rgba];
          }
        },
        options,
      );
    },

    addChild: (target, options) => {
      const robot = get().workspace.components[target.componentId]?.robot;
      const parentLink = robot?.links[target.parentLinkId];
      if (
        !robot
        || !parentLink
        || isEntityEditorLocked(get().workspace, {
          type: 'link',
          componentId: target.componentId,
          entityId: target.parentLinkId,
        })
      ) {
        return null;
      }

      const linkId = createUniqueEntityId(Object.keys(robot.links), 'link');
      const jointId = createUniqueEntityId(Object.keys(robot.joints), 'joint');
      const siblingCount = Object.values(robot.joints).filter(
        (joint) => joint.parentLinkId === target.parentLinkId,
      ).length;
      const link: UrdfLink = createAttachedChildLink({
        id: linkId,
        name: `link_${Object.keys(robot.links).length + 1}`,
      });
      link.visual = { ...link.visual, color: DEFAULT_VISUAL_COLOR };
      const joint: UrdfJoint = {
        ...structuredClone(DEFAULT_JOINT),
        id: jointId,
        name: `joint_${Object.keys(robot.joints).length + 1}`,
        parentLinkId: target.parentLinkId,
        childLinkId: linkId,
        origin: resolveDefaultChildJointOrigin(parentLink, siblingCount * 0.5),
      };

      const changed = runtime.applyMutation(
        'Add child subtree',
        (draft) => {
          const draftRobot = draft.components[target.componentId]?.robot;
          if (!draftRobot) {
            return;
          }
          draftRobot.links[linkId] = link;
          draftRobot.joints[jointId] = joint;
        },
        options,
      );
      return changed ? { linkId, jointId } : null;
    },

    deleteSubtree: (ref, options) => {
      const robot = get().workspace.components[ref.componentId]?.robot;
      if (!robot) {
        return false;
      }
      const plan = buildDeletionPlan(
        ref.entityId,
        robot.links,
        robot.joints,
        robot.rootLinkId,
      );
      if (!plan || !robot.links[ref.entityId]) {
        return false;
      }
      if ([...plan.toDeleteLinks].some((entityId) => isEntityEditorLocked(
        get().workspace,
        { type: 'link', componentId: ref.componentId, entityId },
      ))) {
        return false;
      }

      return runtime.applyMutation(
        'Delete subtree',
        (draft) => {
          const draftRobot = draft.components[ref.componentId]?.robot;
          if (!draftRobot) {
            return;
          }
          const next = applyDeletionPlan(draftRobot.links, draftRobot.joints, plan);
          const deletedReferences = collectLinkOwnedRobotReferences(
            draftRobot.links,
            plan.toDeleteLinks,
          );
          const deletedJointRefs = new Set(
            [...plan.toDeleteJoints].flatMap((jointId) => {
              const jointName = draftRobot.joints[jointId]?.name;
              return jointName ? [jointId, jointName] : [jointId];
            }),
          );
          draftRobot.links = next.links;
          draftRobot.joints = next.joints;
          repairRobotReferencesAfterDeletion(
            draftRobot,
            {
              deletedLinkIds: plan.toDeleteLinks,
              deletedJointIds: deletedJointRefs,
              deletedLinkNames: deletedReferences.linkNames,
              deletedSiteRefs: deletedReferences.siteRefs,
              deletedGeometryRefs: deletedReferences.geometryRefs,
            },
          );
          removeInvalidBridges(draft);
        },
        options,
      );
    },
  };
}
