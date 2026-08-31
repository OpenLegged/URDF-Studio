import { getIndentAt } from '@/core/utils/xmlSourceTextUtils';
import type { RobotData, UrdfLink, UrdfVisual } from '@/types';
import {
  applyTextReplacements,
  collectXmlElementBounds,
  getElementAttribute,
  reindentFragment,
  type TextReplacement,
} from '@/app/hooks/source-preserving-export/xmlSourcePatch';

import {
  appendMJCFBodyCollisionGeomToSource,
  appendMJCFChildBodyToSource,
  patchMJCFBodyInertialInSource,
  patchMJCFJointLimitInSource,
  patchMJCFRootModelNameInSource,
  removeMJCFBodyCollisionGeomFromSource,
  removeMJCFBodyFromSource,
  renameMJCFEntitiesInSource,
  updateMJCFBodyCollisionGeomInSource,
  type MJCFRenameOperation,
} from './mjcfEditableSourcePatch';
import { findNamedStartTagOccurrenceForTags } from './mjcfEditableSourcePatchHelpers';
import {
  collectMJCFEntityPairs,
  findMJCFEntityPair,
  mjcfValuesEqual,
} from './mjcfEditableSourceReconcilerSemantics';

function collectRenames(
  beforeRobot: RobotData,
  afterRobot: RobotData,
): MJCFRenameOperation[] {
  return [
    ...collectMJCFEntityPairs(beforeRobot.links, afterRobot.links).flatMap(
      ({ before, after }) =>
        before.name === after.name
          ? []
          : [{ kind: 'link' as const, currentName: before.name, nextName: after.name }],
    ),
    ...collectMJCFEntityPairs(beforeRobot.joints, afterRobot.joints).flatMap(
      ({ before, after }) =>
        before.name === after.name
          ? []
          : [{ kind: 'joint' as const, currentName: before.name, nextName: after.name }],
    ),
  ];
}

export function applyMJCFAttributePatches(
  sourceContent: string,
  beforeRobot: RobotData,
  afterRobot: RobotData,
): string {
  let content = sourceContent;
  if (beforeRobot.name !== afterRobot.name) {
    content = patchMJCFRootModelNameInSource(content, afterRobot.name);
  }
  const renames = collectRenames(beforeRobot, afterRobot);
  if (renames.length > 0) content = renameMJCFEntitiesInSource(content, renames);

  collectMJCFEntityPairs(beforeRobot.joints, afterRobot.joints).forEach(
    ({ before, after }) => {
      if (!after.limit || mjcfValuesEqual(before.limit, after.limit)) return;
      content = patchMJCFJointLimitInSource({
        sourceContent: content,
        jointName: after.name,
        jointType: after.type,
        limit: after.limit,
      });
    },
  );
  return content;
}

function collisionEntries(link: UrdfLink): UrdfVisual[] {
  return [link.collision, ...(link.collisionBodies ?? [])].filter(
    (geometry) => geometry.type !== 'none',
  );
}

function patchCollisionNodes(
  sourceContent: string,
  beforeLink: UrdfLink,
  afterLink: UrdfLink,
): string {
  let content = sourceContent;
  const beforeEntries = collisionEntries(beforeLink);
  const afterEntries = collisionEntries(afterLink);
  const sharedCount = Math.min(beforeEntries.length, afterEntries.length);
  for (let index = 0; index < sharedCount; index += 1) {
    if (mjcfValuesEqual(beforeEntries[index], afterEntries[index])) continue;
    content = updateMJCFBodyCollisionGeomInSource(
      content,
      afterLink.name,
      index,
      afterEntries[index]!,
    );
  }
  for (let index = beforeEntries.length - 1; index >= afterEntries.length; index -= 1) {
    content = removeMJCFBodyCollisionGeomFromSource(content, afterLink.name, index);
  }
  for (let index = beforeEntries.length; index < afterEntries.length; index += 1) {
    content = appendMJCFBodyCollisionGeomToSource({
      sourceContent: content,
      bodyName: afterLink.name,
      geometry: afterEntries[index]!,
    });
  }
  return content;
}

export function applyMJCFNodePatches(
  sourceContent: string,
  beforeRobot: RobotData,
  afterRobot: RobotData,
): string {
  let content = sourceContent;
  collectMJCFEntityPairs(beforeRobot.links, afterRobot.links).forEach(
    ({ before, after }) => {
      if (after.inertial && !mjcfValuesEqual(before.inertial, after.inertial)) {
        content = patchMJCFBodyInertialInSource({
          sourceContent: content,
          bodyName: after.name,
          inertial: after.inertial,
        });
      }
      content = patchCollisionNodes(content, before, after);
    },
  );
  return content;
}

type XmlBounds = ReturnType<typeof collectXmlElementBounds>[number];

function bodyBoundsByName(content: string): Map<string, XmlBounds> {
  return new Map(
    collectXmlElementBounds(content)
      .filter((element) => element.tagName === 'body')
      .flatMap((element) => {
        const name = getElementAttribute(content, element, 'name');
        return name ? [[name, element] as const] : [];
      }),
  );
}

function changedBodyNames(beforeRobot: RobotData, afterRobot: RobotData): Set<string> {
  const names = new Set<string>();
  collectMJCFEntityPairs(beforeRobot.links, afterRobot.links).forEach(
    ({ before, after }) => {
      if (!mjcfValuesEqual(before, after)) names.add(after.name);
    },
  );
  collectMJCFEntityPairs(beforeRobot.joints, afterRobot.joints).forEach(
    ({ before, after }) => {
      if (!mjcfValuesEqual(before, after)) {
        const child = afterRobot.links[after.childLinkId];
        if (child) names.add(child.name);
      }
    },
  );
  Object.entries(afterRobot.links).forEach(([key, link]) => {
    if (!findMJCFEntityPair(beforeRobot.links, key, link.id)) names.add(link.name);
  });
  return names;
}

function deletedBodyNames(beforeRobot: RobotData, afterRobot: RobotData): string[] {
  const deleted = new Set(
    Object.entries(beforeRobot.links).flatMap(([key, link]) =>
      findMJCFEntityPair(afterRobot.links, key, link.id) ? [] : [link.name],
    ),
  );
  const parentByChild = new Map(
    Object.values(beforeRobot.joints).map((joint) => [joint.childLinkId, joint.parentLinkId]),
  );
  return Object.entries(beforeRobot.links).flatMap(([key, link]) => {
    if (!deleted.has(link.name)) return [];
    let parentId = parentByChild.get(key) ?? parentByChild.get(link.id);
    while (parentId) {
      const parent = beforeRobot.links[parentId];
      if (parent && deleted.has(parent.name)) return [];
      parentId = parentByChild.get(parentId);
    }
    return [link.name];
  });
}

function linkDepth(robot: RobotData, linkId: string): number {
  const parentByChild = new Map(
    Object.values(robot.joints).map((joint) => [joint.childLinkId, joint.parentLinkId]),
  );
  let depth = 0;
  let current = linkId;
  const visited = new Set<string>();
  while (parentByChild.has(current) && !visited.has(current)) {
    visited.add(current);
    current = parentByChild.get(current)!;
    depth += 1;
  }
  return depth;
}

function appendAddedBodies(
  sourceContent: string,
  beforeRobot: RobotData,
  afterRobot: RobotData,
): string {
  let content = sourceContent;
  const addedLinks = Object.entries(afterRobot.links)
    .filter(([key, link]) => !findMJCFEntityPair(beforeRobot.links, key, link.id))
    .sort(
      ([leftId], [rightId]) =>
        linkDepth(afterRobot, leftId) - linkDepth(afterRobot, rightId),
    );
  for (const [linkId, link] of addedLinks) {
    const joint = Object.values(afterRobot.joints).find(
      (candidate) => candidate.childLinkId === linkId,
    );
    const parent = joint ? afterRobot.links[joint.parentLinkId] : undefined;
    if (!joint || !parent) continue;
    content = appendMJCFChildBodyToSource({
      sourceContent: content,
      parentBodyName: parent.name,
      childBodyName: link.name,
      joint,
    });
  }
  return content;
}

function topmostAffectedBodyNames(content: string, names: ReadonlySet<string>): string[] {
  const bounds = bodyBoundsByName(content);
  return [...names].filter((name) => {
    const target = bounds.get(name);
    if (!target) return false;
    return ![...names].some((candidateName) => {
      if (candidateName === name) return false;
      const candidate = bounds.get(candidateName);
      return Boolean(
        candidate &&
          candidate.startOffset < target.startOffset &&
          candidate.endOffset > target.endOffset,
      );
    });
  });
}

function replaceAffectedBodies(
  sourceContent: string,
  generatedContent: string,
  affectedNames: ReadonlySet<string>,
): string {
  const sourceBounds = bodyBoundsByName(sourceContent);
  const generatedBounds = bodyBoundsByName(generatedContent);
  const replacements: TextReplacement[] = [];
  topmostAffectedBodyNames(sourceContent, affectedNames).forEach((name) => {
    const sourceBody = sourceBounds.get(name);
    const generatedBody = generatedBounds.get(name);
    if (!sourceBody || !generatedBody) return;
    replacements.push({
      startOffset: sourceBody.startOffset,
      endOffset: sourceBody.endOffset,
      text: reindentFragment(
        generatedContent.slice(generatedBody.startOffset, generatedBody.endOffset),
        getIndentAt(sourceContent, sourceBody.startOffset),
      ),
    });
  });
  return applyTextReplacements(sourceContent, replacements);
}

function replaceChangedJointTags(
  sourceContent: string,
  generatedContent: string,
  beforeRobot: RobotData,
  afterRobot: RobotData,
): string {
  let content = sourceContent;
  collectMJCFEntityPairs(beforeRobot.joints, afterRobot.joints).forEach(
    ({ before, after }) => {
      if (mjcfValuesEqual(before, after)) return;
      const sourceJoint = findNamedStartTagOccurrenceForTags(
        content,
        ['joint', 'freejoint'],
        after.name,
      );
      const generatedJoint = findNamedStartTagOccurrenceForTags(
        generatedContent,
        ['joint', 'freejoint'],
        after.name,
      );
      if (!sourceJoint || !generatedJoint) return;
      content = `${content.slice(0, sourceJoint.start)}${generatedJoint.rawTag}${content.slice(
        sourceJoint.end,
      )}`;
    },
  );
  return content;
}

export function applyMJCFEntityPatches({
  sourceContent,
  generatedContent,
  beforeRobot,
  afterRobot,
}: {
  sourceContent: string;
  generatedContent: string;
  beforeRobot: RobotData;
  afterRobot: RobotData;
}): string {
  let content = sourceContent;
  deletedBodyNames(beforeRobot, afterRobot).forEach((name) => {
    content = removeMJCFBodyFromSource(content, name);
  });
  content = appendAddedBodies(content, beforeRobot, afterRobot);
  content = replaceChangedJointTags(content, generatedContent, beforeRobot, afterRobot);
  return replaceAffectedBodies(
    content,
    generatedContent,
    changedBodyNames(beforeRobot, afterRobot),
  );
}
