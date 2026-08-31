import { createSourceSemanticRobotHash, createStableJsonSnapshot } from '@/core/robot';
import { replaceOrRemoveXmlAttribute } from '@/core/utils/xmlSourceTextUtils';
import type { RobotData, RobotState } from '@/types';
import {
  resolveSourcePreservingExportContent,
} from '@/app/hooks/sourcePreservingExportUtils';
import {
  applyRootAttributePatch,
  applyTextReplacements,
  collectDirectChildren,
  collectXmlElementBounds,
  findRootElement,
  getAttributeValueFromOpenTag,
  getElementAttribute,
  type TextReplacement,
} from '@/app/hooks/source-preserving-export/xmlSourcePatch';
import {
  patchUrdfJointLimitInSource,
  patchUrdfLinkInertialInSource,
  patchUrdfRobotNameInSource,
} from './jointEditableSourcePatch';
import { generateEditableRobotSource } from './generateEditableRobotSource';
import { parseEditableRobotSource } from './parseEditableRobotSource';
import {
  patchUrdfJointFieldsInSource,
  patchUrdfLinkFieldsInSource,
  type UrdfJointFinePatchField,
  type UrdfLinkFinePatchField,
} from './urdfFineGrainedSourcePatch';

export interface ReconcileUrdfEditableSourceOptions {
  sourceContent: string;
  beforeRobot: RobotData;
  afterRobot: RobotData;
  sourceFileName: string;
}

export type ReconcileUrdfEditableSourceResult =
  | { status: 'patched'; content: string }
  | { status: 'unsafe'; reason: string };

interface PreservedTopLevelElement {
  marker: string;
  sourceText: string;
}

interface MarkedSource {
  content: string;
  preservedElements: PreservedTopLevelElement[];
}

const ALWAYS_PRESERVED_TOP_LEVEL_TAGS = new Set([
  'material',
  'transmission',
  'ros2_control',
  'gazebo',
]);
const XACRO_SOURCE_RE = /<\s*\/?\s*xacro:|\$\{|\$\(/i;
const XML_TOKEN_RE =
  /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?([A-Za-z_][\w:.-]*)\b[^>]*?>/g;

export function asRobotState(robot: RobotData): RobotState {
  return {
    ...robot,
    selection: { type: null, id: null },
  };
}

function stripUrdfSourceProvenance<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUrdfSourceProvenance(item)) as T;
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'materialSource')
      .map(([key, nestedValue]) => [key, stripUrdfSourceProvenance(nestedValue)]),
  ) as T;
}

/**
 * Keep only model fields that URDF generation can claim to own. Source
 * envelopes and import diagnostics describe provenance rather than editable
 * URDF semantics, while empty optional collections serialize the same as none.
 */
function asSourceSemanticRobot(robot: RobotData): RobotData {
  const materials = robot.materials && Object.keys(robot.materials).length > 0
    ? robot.materials
    : undefined;
  const closedLoopConstraints =
    robot.closedLoopConstraints && robot.closedLoopConstraints.length > 0
      ? robot.closedLoopConstraints
      : undefined;

  return {
    name: robot.name,
    ...(robot.version?.trim() ? { version: robot.version } : {}),
    links: stripUrdfSourceProvenance(robot.links),
    joints: robot.joints,
    rootLinkId: robot.rootLinkId,
    ...(materials ? { materials } : {}),
    ...(closedLoopConstraints ? { closedLoopConstraints } : {}),
  };
}

function buildSourceIdentityMap<T extends { id: string; name: string }>(
  records: Record<string, T>,
): Map<string, string> {
  const identities = new Map<string, string>();
  Object.entries(records).forEach(([key, record]) => {
    const sourceName = record.name || record.id || key;
    identities.set(key, sourceName);
    identities.set(record.id, sourceName);
    identities.set(record.name, sourceName);
  });
  return identities;
}

/** URDF identifies entities by name even though the workspace keeps stable IDs. */
function projectToUrdfSourceIdentities(robot: RobotData): RobotData {
  const linkIdentities = buildSourceIdentityMap(robot.links);
  const jointIdentities = buildSourceIdentityMap(robot.joints);
  const links = Object.fromEntries(
    Object.entries(robot.links).map(([key, link]) => {
      const sourceName = linkIdentities.get(key) ?? link.name;
      return [sourceName, { ...link, id: sourceName, name: sourceName }];
    }),
  );
  const joints = Object.fromEntries(
    Object.entries(robot.joints).map(([key, joint]) => {
      const sourceName = jointIdentities.get(key) ?? joint.name;
      return [
        sourceName,
        {
          ...joint,
          id: sourceName,
          name: sourceName,
          parentLinkId: linkIdentities.get(joint.parentLinkId) ?? joint.parentLinkId,
          childLinkId: linkIdentities.get(joint.childLinkId) ?? joint.childLinkId,
          ...(joint.mimic
            ? {
                mimic: {
                  ...joint.mimic,
                  joint:
                    jointIdentities.get(joint.mimic.joint) ?? joint.mimic.joint,
                },
              }
            : {}),
        },
      ];
    }),
  );
  const materials = robot.materials
    ? Object.fromEntries(
        Object.entries(robot.materials).map(([key, material]) => [
          linkIdentities.get(key) ?? key,
          material,
        ]),
      )
    : undefined;

  return {
    ...robot,
    links,
    joints,
    rootLinkId: linkIdentities.get(robot.rootLinkId) ?? robot.rootLinkId,
    ...(materials ? { materials } : {}),
  };
}

export function sourceSemanticHash(robot: RobotData): string {
  return createSourceSemanticRobotHash(
    projectToUrdfSourceIdentities(asSourceSemanticRobot(robot)),
  );
}

/**
 * Imported workspaces do not always retain the optional URDF root version.
 * In that case the version remains source-owned XML and must neither make the
 * draft look stale nor be removed by a property edit.
 */
export function sourceSemanticHashForWorkspace(
  sourceRobot: RobotData,
  workspaceRobot: RobotData,
): string {
  if (workspaceRobot.version?.trim()) {
    return sourceSemanticHash(sourceRobot);
  }

  const { version: _sourceOwnedVersion, ...robotWithoutVersion } = sourceRobot;
  return sourceSemanticHash(robotWithoutVersion as RobotData);
}

function retainSourceOwnedRootVersion({
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
  if (beforeRobot.version?.trim() || afterRobot.version?.trim()) {
    return generatedContent;
  }

  const sourceRoot = findRootElement(sourceContent, 'robot');
  const generatedRoot = findRootElement(generatedContent, 'robot');
  if (!sourceRoot || !generatedRoot) {
    throw new Error('Failed to locate the URDF <robot> root.');
  }

  return applyRootAttributePatch({
    xml: generatedContent,
    sourceRoot: generatedRoot,
    generatedRoot: sourceRoot,
    generatedXml: sourceContent,
    attrNames: ['version'],
  });
}

function parseUrdf(sourceFileName: string, content: string): RobotState | null {
  return parseEditableRobotSource({
    file: { name: sourceFileName || 'robot.urdf', format: 'urdf' },
    content,
  });
}

export function hasSameValue(left: unknown, right: unknown): boolean {
  return createStableJsonSnapshot(left) === createStableJsonSnapshot(right);
}

function findByName<T extends { id: string; name: string }>(
  records: Record<string, T>,
  name: string,
): T | undefined {
  return Object.values(records).find((record) => (record.name || record.id) === name);
}

export function findByStableIdentity<T extends { id: string; name: string }>(
  records: Record<string, T>,
  key: string,
  id: string,
): T | undefined {
  return records[key] ?? Object.values(records).find((record) => record.id === id);
}

function collectEntityRenames<T extends { id: string; name: string }>(
  beforeRecords: Record<string, T>,
  afterRecords: Record<string, T>,
): Map<string, string> {
  const renames = new Map<string, string>();
  Object.entries(beforeRecords).forEach(([key, beforeRecord]) => {
    const afterRecord = findByStableIdentity(afterRecords, key, beforeRecord.id);
    if (afterRecord && beforeRecord.name !== afterRecord.name) {
      renames.set(beforeRecord.name, afterRecord.name);
    }
  });
  return renames;
}

function collectDeletedEntityNames<T extends { id: string; name: string }>(
  beforeRecords: Record<string, T>,
  afterRecords: Record<string, T>,
): Set<string> {
  return new Set(
    Object.entries(beforeRecords).flatMap(([key, beforeRecord]) =>
      findByStableIdentity(afterRecords, key, beforeRecord.id) ? [] : [beforeRecord.name],
    ),
  );
}

function patchMappedAttribute(
  openTag: string,
  attributeName: string,
  renames: ReadonlyMap<string, string>,
): string {
  const currentValue = getAttributeValueFromOpenTag(openTag, attributeName);
  const nextValue = currentValue ? renames.get(currentValue) : undefined;
  return nextValue
    ? replaceOrRemoveXmlAttribute(openTag, attributeName, nextValue)
    : openTag;
}

function patchStandardReferenceOpenTag({
  openTag,
  tagName,
  parentTagName,
  linkRenames,
  jointRenames,
}: {
  openTag: string;
  tagName: string;
  parentTagName: string | null;
  linkRenames: ReadonlyMap<string, string>;
  jointRenames: ReadonlyMap<string, string>;
}): string {
  if (parentTagName === 'robot' && tagName === 'link') {
    return patchMappedAttribute(openTag, 'name', linkRenames);
  }
  if (parentTagName === 'robot' && tagName === 'joint') {
    return patchMappedAttribute(openTag, 'name', jointRenames);
  }
  if (parentTagName === 'joint' && (tagName === 'parent' || tagName === 'child')) {
    return patchMappedAttribute(openTag, 'link', linkRenames);
  }
  if (parentTagName === 'robot' && tagName === 'gazebo') {
    const linkPatched = patchMappedAttribute(openTag, 'reference', linkRenames);
    return linkPatched === openTag
      ? patchMappedAttribute(openTag, 'reference', jointRenames)
      : linkPatched;
  }
  if (parentTagName === 'joint' && tagName === 'mimic') {
    return patchMappedAttribute(openTag, 'joint', jointRenames);
  }
  if (
    tagName === 'joint' &&
    (parentTagName === 'transmission' || parentTagName === 'ros2_control')
  ) {
    return patchMappedAttribute(openTag, 'name', jointRenames);
  }
  return openTag;
}

/** Patch standard name references in one pass so rename chains cannot cascade. */
function patchStandardUrdfRenames(
  sourceContent: string,
  linkRenames: ReadonlyMap<string, string>,
  jointRenames: ReadonlyMap<string, string>,
): string {
  if (linkRenames.size === 0 && jointRenames.size === 0) {
    return sourceContent;
  }

  const stack: string[] = [];
  const replacements: TextReplacement[] = [];
  XML_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = XML_TOKEN_RE.exec(sourceContent)) !== null) {
    const rawTag = match[0];
    const tagName = match[1];
    if (!tagName) continue;
    if (rawTag.startsWith('</')) {
      const matchingIndex = stack.lastIndexOf(tagName);
      if (matchingIndex >= 0) stack.splice(matchingIndex);
      continue;
    }

    const parentTagName = stack[stack.length - 1] ?? null;
    const patchedTag = patchStandardReferenceOpenTag({
      openTag: rawTag,
      tagName,
      parentTagName,
      linkRenames,
      jointRenames,
    });

    if (patchedTag !== rawTag) {
      replacements.push({
        startOffset: match.index,
        endOffset: match.index + rawTag.length,
        text: patchedTag,
      });
    }
    if (!/\/\s*>$/.test(rawTag)) stack.push(tagName);
  }
  return applyTextReplacements(sourceContent, replacements);
}

function containsNamedJointReference(fragment: string, deletedNames: ReadonlySet<string>): boolean {
  return collectXmlElementBounds(fragment).some(
    (element) =>
      element.tagName === 'joint' &&
      deletedNames.has(getElementAttribute(fragment, element, 'name') ?? ''),
  );
}

function removeDeletedRos2ControlJoints(
  sourceContent: string,
  deletedJointNames: ReadonlySet<string>,
): string {
  const replacements: TextReplacement[] = [];
  collectDirectChildren(sourceContent, 'robot')
    .filter((element) => element.tagName === 'ros2_control')
    .forEach((controlElement) => {
      const fragment = sourceContent.slice(controlElement.startOffset, controlElement.endOffset);
      collectXmlElementBounds(fragment)
        .filter(
          (element) =>
            element.tagName === 'joint' &&
            deletedJointNames.has(getElementAttribute(fragment, element, 'name') ?? ''),
        )
        .forEach((element) => {
          replacements.push({
            startOffset: controlElement.startOffset + element.startOffset,
            endOffset: controlElement.startOffset + element.endOffset,
            text: '',
          });
        });
    });
  return applyTextReplacements(sourceContent, replacements);
}

function removeDeletedStandardReferences(
  sourceContent: string,
  deletedLinkNames: ReadonlySet<string>,
  deletedJointNames: ReadonlySet<string>,
): string {
  const topLevelRemovals = collectDirectChildren(sourceContent, 'robot')
    .filter((element) => {
      if (element.tagName === 'gazebo') {
        const reference = getElementAttribute(sourceContent, element, 'reference') ?? '';
        return deletedLinkNames.has(reference) || deletedJointNames.has(reference);
      }
      if (element.tagName === 'transmission') {
        return containsNamedJointReference(
          sourceContent.slice(element.startOffset, element.endOffset),
          deletedJointNames,
        );
      }
      return false;
    })
    .map((element) => ({
      startOffset: element.startOffset,
      endOffset: element.endOffset,
      text: '',
    }));
  return removeDeletedRos2ControlJoints(
    applyTextReplacements(sourceContent, topLevelRemovals),
    deletedJointNames,
  );
}

export function reconcileStandardUrdfReferences(
  sourceContent: string,
  beforeRobot: RobotData,
  afterRobot: RobotData,
): string {
  const deletedLinkNames = collectDeletedEntityNames(beforeRobot.links, afterRobot.links);
  const deletedJointNames = collectDeletedEntityNames(beforeRobot.joints, afterRobot.joints);
  const withoutDeletedReferences = removeDeletedStandardReferences(
    sourceContent,
    deletedLinkNames,
    deletedJointNames,
  );
  return patchStandardUrdfRenames(
    withoutDeletedReferences,
    collectEntityRenames(beforeRobot.links, afterRobot.links),
    collectEntityRenames(beforeRobot.joints, afterRobot.joints),
  );
}

/** Fine-grained patches retain comments and vendor children inside common edits. */
export function applyFineGrainedUrdfPatches(
  sourceContent: string,
  generatedContent: string,
  beforeRobot: RobotData,
  afterRobot: RobotData,
): string {
  let content = sourceContent;

  if (beforeRobot.name !== afterRobot.name) {
    try {
      content = patchUrdfRobotNameInSource(content, afterRobot.name);
    } catch {
      // The top-level source-preserving reconciler remains the safe fallback.
    }
  }

  Object.values(afterRobot.joints).forEach((afterJoint) => {
    const jointName = afterJoint.name || afterJoint.id;
    const beforeJoint = findByName(beforeRobot.joints, jointName);
    if (!beforeJoint || !afterJoint.limit || hasSameValue(beforeJoint.limit, afterJoint.limit)) {
      // Limit patching is optional; the remaining fields are handled below.
    } else {
      try {
        content = patchUrdfJointLimitInSource({
          sourceContent: content,
          jointName,
          jointType: afterJoint.type,
          limit: afterJoint.limit,
        });
      } catch {
        // A renamed or unusual joint is replaced as one affected top-level element.
      }
    }

    if (!beforeJoint) return;
    const changedFields = new Set<UrdfJointFinePatchField>();
    if (beforeJoint.type !== afterJoint.type) changedFields.add('type');
    if (beforeJoint.parentLinkId !== afterJoint.parentLinkId) changedFields.add('parent');
    if (beforeJoint.childLinkId !== afterJoint.childLinkId) changedFields.add('child');
    if (!hasSameValue(beforeJoint.origin, afterJoint.origin)) changedFields.add('origin');
    if (!hasSameValue(beforeJoint.axis, afterJoint.axis)) changedFields.add('axis');
    if (!hasSameValue(beforeJoint.dynamics, afterJoint.dynamics)) changedFields.add('dynamics');
    if (!hasSameValue(beforeJoint.hardware, afterJoint.hardware)) changedFields.add('hardware');
    if (!hasSameValue(beforeJoint.mimic, afterJoint.mimic)) changedFields.add('mimic');
    if (
      !hasSameValue(beforeJoint.calibration, afterJoint.calibration) ||
      beforeJoint.referencePosition !== afterJoint.referencePosition
    ) {
      changedFields.add('calibration');
    }
    if (!hasSameValue(beforeJoint.safetyController, afterJoint.safetyController)) {
      changedFields.add('safety_controller');
    }
    content = patchUrdfJointFieldsInSource({
      sourceContent: content,
      generatedContent,
      entityName: jointName,
      fields: changedFields,
    });
  });

  Object.values(afterRobot.links).forEach((afterLink) => {
    const linkName = afterLink.name || afterLink.id;
    const beforeLink = findByName(beforeRobot.links, linkName);
    if (!beforeLink || !afterLink.inertial || hasSameValue(beforeLink.inertial, afterLink.inertial)) {
      // Inertial patching is optional; visual/collision patches still apply.
    } else {
      try {
        content = patchUrdfLinkInertialInSource({
          sourceContent: content,
          linkName,
          inertial: afterLink.inertial,
        });
      } catch {
        // A renamed or unusual link is replaced as one affected top-level element.
      }
    }

    if (!beforeLink) return;
    const changedFields = new Set<UrdfLinkFinePatchField>();
    if (
      !hasSameValue(beforeLink.visual, afterLink.visual) ||
      !hasSameValue(beforeLink.visualBodies, afterLink.visualBodies)
    ) {
      changedFields.add('visual');
    }
    if (
      !hasSameValue(beforeLink.collision, afterLink.collision) ||
      !hasSameValue(beforeLink.collisionBodies, afterLink.collisionBodies)
    ) {
      changedFields.add('collision');
    }
    content = patchUrdfLinkFieldsInSource({
      sourceContent: content,
      generatedContent,
      entityName: linkName,
      fields: changedFields,
    });
  });

  return content;
}

function patchRobotRootAttributes(sourceContent: string, generatedContent: string): string {
  const sourceRoot = findRootElement(sourceContent, 'robot');
  const generatedRoot = findRootElement(generatedContent, 'robot');
  if (!sourceRoot || !generatedRoot) {
    throw new Error('Failed to locate the URDF <robot> root.');
  }
  return applyRootAttributePatch({
    xml: sourceContent,
    sourceRoot,
    generatedRoot,
    generatedXml: generatedContent,
    attrNames: ['name', 'version'],
  });
}

function createUniqueMarker(
  sourceContent: string,
  index: number,
  usedMarkers: ReadonlySet<string>,
): string {
  let suffix = index;
  let marker = `<!--__URDF_STUDIO_PRESERVE_TOP_LEVEL_${suffix}__-->`;
  while (sourceContent.includes(marker) || usedMarkers.has(marker)) {
    suffix += 1;
    marker = `<!--__URDF_STUDIO_PRESERVE_TOP_LEVEL_${suffix}__-->`;
  }
  return marker;
}

/**
 * Mark modeled-looking extensions before export reconciliation. The resolver
 * otherwise treats these tags as generated control output and may delete them.
 */
function markPreservedTopLevelElements(sourceContent: string): MarkedSource {
  const preservedElements: PreservedTopLevelElement[] = [];
  const replacements: TextReplacement[] = [];
  const usedMarkers = new Set<string>();

  collectDirectChildren(sourceContent, 'robot')
    .filter((element) => ALWAYS_PRESERVED_TOP_LEVEL_TAGS.has(element.tagName))
    .forEach((element, index) => {
      const marker = createUniqueMarker(sourceContent, index, usedMarkers);
      usedMarkers.add(marker);
      preservedElements.push({
        marker,
        sourceText: sourceContent.slice(element.startOffset, element.endOffset),
      });
      replacements.push({
        startOffset: element.startOffset,
        endOffset: element.startOffset,
        text: marker,
      });
    });

  return {
    content: applyTextReplacements(sourceContent, replacements),
    preservedElements,
  };
}

function removeGeneratedTopLevelExtensions(content: string): string {
  return applyTextReplacements(
    content,
    collectDirectChildren(content, 'robot')
      .filter((element) => ALWAYS_PRESERVED_TOP_LEVEL_TAGS.has(element.tagName))
      .map((element) => ({
        startOffset: element.startOffset,
        endOffset: element.endOffset,
        text: '',
      })),
  );
}

function restorePreservedTopLevelElements(
  content: string,
  preservedElements: PreservedTopLevelElement[],
): string | null {
  let restored = removeGeneratedTopLevelExtensions(content);
  for (const preserved of preservedElements) {
    const markerOffset = restored.indexOf(preserved.marker);
    if (markerOffset < 0) {
      return null;
    }
    restored = `${restored.slice(0, markerOffset)}${preserved.sourceText}${restored.slice(
      markerOffset + preserved.marker.length,
    )}`;
  }
  return restored;
}

function unsafe(reason: string): ReconcileUrdfEditableSourceResult {
  return { status: 'unsafe', reason };
}

/**
 * Reconcile a concrete URDF (including files named `.xml`) with one complete
 * RobotData mutation. The function never rewrites Xacro and never falls back to
 * wholesale generated text: it reports `unsafe` whenever semantic equivalence
 * or source preservation cannot be proven.
 */
export function reconcileUrdfEditableSource({
  sourceContent,
  beforeRobot,
  afterRobot,
  sourceFileName,
}: ReconcileUrdfEditableSourceOptions): ReconcileUrdfEditableSourceResult {
  if (/\.xacro$/i.test(sourceFileName) || XACRO_SOURCE_RE.test(sourceContent)) {
    return unsafe('Xacro sources require Xacro-aware reconciliation.');
  }

  try {
    const parsedSource = parseUrdf(sourceFileName, sourceContent);
    if (!parsedSource) {
      return unsafe('The editable source is not valid URDF.');
    }
    if (
      sourceSemanticHashForWorkspace(parsedSource, beforeRobot) !==
      sourceSemanticHash(beforeRobot)
    ) {
      return unsafe('The editable source no longer matches the robot before this mutation.');
    }

    const generatedAfterWithoutSourceEnvelope = generateEditableRobotSource({
      format: 'urdf',
      robotState: asRobotState(afterRobot),
      includeHardware: 'auto',
      preserveMeshPaths: true,
    });
    const parsedGeneratedAfterWithoutSourceEnvelope = parseUrdf(
      sourceFileName,
      generatedAfterWithoutSourceEnvelope,
    );
    if (!parsedGeneratedAfterWithoutSourceEnvelope) {
      return unsafe('The generated URDF could not be parsed.');
    }
    if (
      sourceSemanticHash(parsedGeneratedAfterWithoutSourceEnvelope) !==
      sourceSemanticHash(afterRobot)
    ) {
      return unsafe('The robot mutation cannot be represented losslessly as URDF.');
    }

    const generatedAfter = retainSourceOwnedRootVersion({
      sourceContent,
      generatedContent: generatedAfterWithoutSourceEnvelope,
      beforeRobot,
      afterRobot,
    });
    const parsedGeneratedAfter = parseUrdf(sourceFileName, generatedAfter);
    if (!parsedGeneratedAfter) {
      return unsafe('The generated URDF could not be parsed after restoring source attributes.');
    }

    const referencePatched = reconcileStandardUrdfReferences(
      sourceContent,
      beforeRobot,
      afterRobot,
    );
    const finePatched = applyFineGrainedUrdfPatches(
      referencePatched,
      generatedAfter,
      beforeRobot,
      afterRobot,
    );
    const rootPatched = patchRobotRootAttributes(finePatched, generatedAfter);
    const markedSource = markPreservedTopLevelElements(rootPatched);
    const generatedModelContent = removeGeneratedTopLevelExtensions(generatedAfter);
    const reconciled = resolveSourcePreservingExportContent({
      format: 'urdf',
      currentRobot: asRobotState(afterRobot),
      sourceFile: {
        name: sourceFileName || 'robot.urdf',
        format: 'urdf',
        content: markedSource.content,
      },
      generatedContent: generatedModelContent,
      finalizePatchedContent: (content) => {
        const restored = restorePreservedTopLevelElements(
          content,
          markedSource.preservedElements,
        );
        if (restored === null) {
          throw new Error('A preserved top-level URDF extension could not be restored.');
        }
        return restored;
      },
    });
    if (reconciled.strategy !== 'source-preserved') {
      return unsafe('URDF reconciliation would require replacing the complete source.');
    }

    const restored = reconciled.content;
    const parsedRestored = parseUrdf(sourceFileName, restored);
    if (
      !parsedRestored ||
      sourceSemanticHash(parsedRestored) !== sourceSemanticHash(parsedGeneratedAfter)
    ) {
      return unsafe('The patched URDF did not preserve the requested robot semantics.');
    }

    return { status: 'patched', content: restored };
  } catch (error) {
    return unsafe(error instanceof Error ? error.message : 'URDF reconciliation failed.');
  }
}
