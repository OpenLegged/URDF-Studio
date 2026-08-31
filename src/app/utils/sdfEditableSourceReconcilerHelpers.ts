import { createStableJsonSnapshot } from '@/core/robot';
import { getIndentAt } from '@/core/utils/xmlSourceTextUtils';
import type { RobotData, RobotState } from '@/types';
import {
  applyRootAttributePatch,
  applyTextReplacements,
  collectXmlElementBounds,
  getClosingTagStart,
  getElementAttribute,
  reindentFragment,
  type TextReplacement,
  type XmlElementBounds,
} from '@/app/hooks/source-preserving-export/xmlSourcePatch';
import { patchSdfJointLimitInSource } from './jointEditableSourcePatch';
import { parseEditableRobotSource } from './parseEditableRobotSource';

export type SdfEditableSourceReconcileLevel =
  | 'attribute'
  | 'node'
  | 'entity'
  | 'section';

export interface SdfKeyedElement {
  key: string;
  bounds: XmlElementBounds;
  text: string;
}

const MODEL_OWNED_TAGS = new Set(['pose', 'static', 'self_collide', 'link', 'joint']);
const ENTITY_TAGS = new Set(['link', 'joint']);

export function asSdfRobotState(robot: RobotData): RobotState {
  return {
    ...robot,
    selection: { type: null, id: null },
  };
}

function parseSdf(sourceFileName: string, content: string): RobotState | null {
  return parseEditableRobotSource({
    file: { name: sourceFileName || 'model.sdf', format: 'sdf' },
    content,
    allFileContents: {
      [sourceFileName || 'model.sdf']: content,
    },
  });
}

function stableNormalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableNormalize);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const skippedKeys = new Set([
    'authoredMaterials',
    'inspectionContext',
    'materialSource',
    'quaternion',
    'selection',
    'visible',
  ]);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key, entry]) => !skippedKeys.has(key) && entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableNormalize(entry)]),
  );
}

function semanticSnapshot(robot: RobotData): string {
  return createStableJsonSnapshot(
    stableNormalize({
      name: robot.name,
      ...(robot.version?.trim() ? { version: robot.version } : {}),
      links: robot.links,
      joints: robot.joints,
      rootLinkId: robot.rootLinkId,
      ...(robot.closedLoopConstraints && robot.closedLoopConstraints.length > 0
        ? { closedLoopConstraints: robot.closedLoopConstraints }
        : {}),
    }),
  );
}

function sameSemanticValue(left: unknown, right: unknown): boolean {
  return createStableJsonSnapshot(stableNormalize(left)) ===
    createStableJsonSnapshot(stableNormalize(right));
}

export function validateSdfCandidate(
  sourceFileName: string,
  content: string,
  expectedRobot: RobotData,
): boolean {
  const parsed = parseSdf(sourceFileName, content);
  return Boolean(parsed && semanticSnapshot(parsed) === semanticSnapshot(expectedRobot));
}

export function findGeneratedSdfModel(generatedContent: string): SdfKeyedElement | null {
  const model = collectXmlElementBounds(generatedContent).find(
    (element) => element.tagName === 'model' && element.parentTagName === 'sdf',
  );
  return model
    ? {
        key: getElementAttribute(generatedContent, model, 'name') ?? 'model',
        bounds: model,
        text: generatedContent.slice(model.startOffset, model.endOffset),
      }
    : null;
}

export function findSourceSdfModel(
  sourceContent: string,
  beforeModelName: string,
): SdfKeyedElement | null {
  const models = collectXmlElementBounds(sourceContent)
    .filter((element) => element.tagName === 'model')
    .filter((element) => element.parentTagName === 'sdf' || element.parentTagName === 'world')
    .sort((left, right) => left.startOffset - right.startOffset)
    .map((bounds) => ({
      key: getElementAttribute(sourceContent, bounds, 'name') ?? 'model',
      bounds,
      text: sourceContent.slice(bounds.startOffset, bounds.endOffset),
    }));
  const matchingModel = models.find((model) => model.key === beforeModelName);
  if (matchingModel) return matchingModel;
  return models.length === 1 ? models[0] : null;
}

function containsElement(parent: XmlElementBounds, child: XmlElementBounds): boolean {
  return child.startOffset > parent.startOffset && child.endOffset < parent.endOffset;
}

function sameElementBounds(left: XmlElementBounds, right: XmlElementBounds): boolean {
  return left.tagName === right.tagName &&
    left.startOffset === right.startOffset &&
    left.endOffset === right.endOffset;
}

function findNearestContainingElement(
  elements: XmlElementBounds[],
  child: XmlElementBounds,
): XmlElementBounds | null {
  return elements.reduce<XmlElementBounds | null>((nearest, element) => {
    if (!containsElement(element, child)) return nearest;
    if (!nearest) return element;
    const elementRange = element.endOffset - element.startOffset;
    const nearestRange = nearest.endOffset - nearest.startOffset;
    return elementRange < nearestRange ? element : nearest;
  }, null);
}

function isDirectChildOf(
  elements: XmlElementBounds[],
  child: XmlElementBounds,
  parent: XmlElementBounds,
): boolean {
  const nearestParent = findNearestContainingElement(elements, child);
  return Boolean(nearestParent && sameElementBounds(nearestParent, parent));
}

function collectModelChildren(xml: string, model: XmlElementBounds): SdfKeyedElement[] {
  const elements = collectXmlElementBounds(xml);
  return elements
    .filter((element) => MODEL_OWNED_TAGS.has(element.tagName))
    .filter((element) => isDirectChildOf(elements, element, model))
    .sort((left, right) => left.startOffset - right.startOffset)
    .map((bounds, index) => ({
      key: `${bounds.tagName}:${getElementAttribute(xml, bounds, 'name') ?? index}`,
      bounds,
      text: xml.slice(bounds.startOffset, bounds.endOffset),
    }));
}

function collectDirectChildrenWithin(
  xml: string,
  parent: XmlElementBounds,
  includeTag: (tagName: string) => boolean,
): SdfKeyedElement[] {
  const elements = collectXmlElementBounds(xml);
  return elements
    .filter((element) => includeTag(element.tagName))
    .filter((element) => isDirectChildOf(elements, element, parent))
    .sort((left, right) => left.startOffset - right.startOffset)
    .map((bounds, index) => ({
      key: `${bounds.tagName}:${getElementAttribute(xml, bounds, 'name') ?? index}`,
      bounds,
      text: xml.slice(bounds.startOffset, bounds.endOffset),
    }));
}

function collectNestedModelEntityKeys(xml: string, model: XmlElementBounds): Set<string> {
  const elements = collectXmlElementBounds(xml);
  const nestedEntityKeys = new Set<string>();
  const directNestedModels = elements
    .filter((element) => element.tagName === 'model')
    .filter((element) => isDirectChildOf(elements, element, model));

  const visitNestedModel = (nestedModel: XmlElementBounds, prefix: string): void => {
    elements
      .filter((element) => isDirectChildOf(elements, element, nestedModel))
      .forEach((child) => {
        if (ENTITY_TAGS.has(child.tagName)) {
          const childName = getElementAttribute(xml, child, 'name');
          if (childName) nestedEntityKeys.add(`${child.tagName}:${prefix}::${childName}`);
        }
        if (child.tagName === 'model') {
          const nestedName = getElementAttribute(xml, child, 'name');
          if (nestedName) visitNestedModel(child, `${prefix}::${nestedName}`);
        }
      });
  };

  directNestedModels.forEach((nestedModel) => {
    const nestedModelName = getElementAttribute(xml, nestedModel, 'name');
    if (nestedModelName) visitNestedModel(nestedModel, nestedModelName);
  });
  return nestedEntityKeys;
}

function collectRobotEntityKeys(robot: RobotData): Set<string> {
  return new Set([
    ...Object.values(robot.links).map((link) => `link:${link.name || link.id}`),
    ...Object.values(robot.joints).map((joint) => `joint:${joint.name || joint.id}`),
  ]);
}

function collectChangedEntityKeys(beforeRobot: RobotData, afterRobot: RobotData): Set<string> {
  const beforeKeys = collectRobotEntityKeys(beforeRobot);
  const afterKeys = collectRobotEntityKeys(afterRobot);
  const changedKeys = new Set<string>();

  beforeKeys.forEach((key) => {
    if (!afterKeys.has(key)) changedKeys.add(key);
  });
  afterKeys.forEach((key) => {
    if (!beforeKeys.has(key)) changedKeys.add(key);
  });

  Object.values(afterRobot.links).forEach((afterLink) => {
    const key = `link:${afterLink.name || afterLink.id}`;
    const beforeLink = Object.values(beforeRobot.links).find(
      (link) => (link.name || link.id) === (afterLink.name || afterLink.id),
    );
    if (beforeLink && !sameSemanticValue(beforeLink, afterLink)) {
      changedKeys.add(key);
    }
  });

  Object.values(afterRobot.joints).forEach((afterJoint) => {
    const key = `joint:${afterJoint.name || afterJoint.id}`;
    const beforeJoint = Object.values(beforeRobot.joints).find(
      (joint) => (joint.name || joint.id) === (afterJoint.name || afterJoint.id),
    );
    if (beforeJoint && !sameSemanticValue(beforeJoint, afterJoint)) {
      changedKeys.add(key);
    }
  });

  return changedKeys;
}

export function patchSdfModelOpenTag(
  sourceContent: string,
  sourceModel: XmlElementBounds,
  generatedModel: XmlElementBounds,
  generatedContent: string,
): string {
  return applyRootAttributePatch({
    xml: sourceContent,
    sourceRoot: sourceModel,
    generatedRoot: generatedModel,
    generatedXml: generatedContent,
    attrNames: ['name'],
  });
}

export function patchSdfFineGrainedAttributes(
  sourceContent: string,
  beforeRobot: RobotData,
  afterRobot: RobotData,
): string {
  return Object.values(afterRobot.joints).reduce((content, afterJoint) => {
    const jointName = afterJoint.name || afterJoint.id;
    const beforeJoint = Object.values(beforeRobot.joints).find(
      (joint) => (joint.name || joint.id) === jointName,
    );
    if (
      !beforeJoint ||
      !afterJoint.limit ||
      sameSemanticValue(beforeJoint.limit, afterJoint.limit)
    ) {
      return content;
    }
    return patchSdfJointLimitInSource({
      sourceContent: content,
      jointName,
      jointType: afterJoint.type,
      limit: afterJoint.limit,
    });
  }, sourceContent);
}

export function patchSdfLinkNodes({
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

  Object.values(afterRobot.links).forEach((afterLink) => {
    const linkName = afterLink.name || afterLink.id;
    const beforeLink = Object.values(beforeRobot.links).find(
      (link) => (link.name || link.id) === linkName,
    );
    if (!beforeLink) return;

    const changedTags = new Set<string>();
    if (
      !sameSemanticValue(beforeLink.visual, afterLink.visual) ||
      !sameSemanticValue(beforeLink.visualBodies, afterLink.visualBodies)
    ) {
      changedTags.add('visual');
    }
    if (
      !sameSemanticValue(beforeLink.collision, afterLink.collision) ||
      !sameSemanticValue(beforeLink.collisionBodies, afterLink.collisionBodies)
    ) {
      changedTags.add('collision');
    }
    if (!sameSemanticValue(beforeLink.inertial, afterLink.inertial)) {
      changedTags.add('inertial');
    }
    if (changedTags.size === 0) return;

    const sourceLink = collectXmlElementBounds(content).find(
      (element) =>
        element.tagName === 'link' && getElementAttribute(content, element, 'name') === linkName,
    );
    const generatedLink = collectXmlElementBounds(generatedContent).find(
      (element) =>
        element.tagName === 'link' &&
        getElementAttribute(generatedContent, element, 'name') === linkName,
    );
    if (!sourceLink || !generatedLink) return;

    const sourceNodes = collectDirectChildrenWithin(content, sourceLink, (tagName) =>
      changedTags.has(tagName),
    );
    const generatedNodes = collectDirectChildrenWithin(generatedContent, generatedLink, (tagName) =>
      changedTags.has(tagName),
    );
    const sourceNodesByKey = new Map(sourceNodes.map((node) => [node.key, node]));
    const generatedNodesByKey = new Map(generatedNodes.map((node) => [node.key, node]));
    const replacements: TextReplacement[] = [];
    sourceNodes.forEach((sourceNode) => {
      const generatedNode = generatedNodesByKey.get(sourceNode.key);
      replacements.push({
        startOffset: sourceNode.bounds.startOffset,
        endOffset: sourceNode.bounds.endOffset,
        text: generatedNode
          ? reindentFragment(
              generatedNode.text,
              getIndentAt(content, sourceNode.bounds.startOffset),
            )
          : '',
      });
    });
    const missingGeneratedNodes = generatedNodes.filter((node) => !sourceNodesByKey.has(node.key));
    if (missingGeneratedNodes.length > 0) {
      const insertAt = getClosingTagStart(content, sourceLink);
      const newline = content.includes('\r\n') ? '\r\n' : '\n';
      const childIndent = sourceNodes[0]
        ? getIndentAt(content, sourceNodes[0].bounds.startOffset)
        : `${getIndentAt(content, sourceLink.startOffset)}  `;
      replacements.push({
        startOffset: insertAt,
        endOffset: insertAt,
        text: `${newline}${missingGeneratedNodes
          .map((node) => reindentFragment(node.text, childIndent))
          .join(newline)}${newline}${getIndentAt(content, insertAt)}`,
      });
    }
    content = applyTextReplacements(content, replacements);
  });

  return content;
}

export function patchSdfModelEntities({
  sourceContent,
  sourceModel,
  generatedContent,
  generatedModel,
  beforeRobot,
  afterRobot,
}: {
  sourceContent: string;
  sourceModel: XmlElementBounds;
  generatedContent: string;
  generatedModel: XmlElementBounds;
  beforeRobot: RobotData;
  afterRobot: RobotData;
}): { content: string; level: SdfEditableSourceReconcileLevel } {
  const changedKeys = collectChangedEntityKeys(beforeRobot, afterRobot);
  const sourceChildren = collectModelChildren(sourceContent, sourceModel);
  const generatedChildren = collectModelChildren(generatedContent, generatedModel);
  const nestedEntityKeys = collectNestedModelEntityKeys(sourceContent, sourceModel);
  const sourceChildrenByKey = new Map(sourceChildren.map((child) => [child.key, child]));
  const generatedChildrenByKey = new Map(generatedChildren.map((child) => [child.key, child]));
  const replacements: TextReplacement[] = [];

  sourceChildren.forEach((sourceChild) => {
    const generatedChild = generatedChildrenByKey.get(sourceChild.key);
    if (!generatedChild) {
      if (ENTITY_TAGS.has(sourceChild.bounds.tagName) && changedKeys.has(sourceChild.key)) {
        replacements.push({
          startOffset: sourceChild.bounds.startOffset,
          endOffset: sourceChild.bounds.endOffset,
          text: '',
        });
      }
      return;
    }
    if (changedKeys.has(sourceChild.key)) {
      replacements.push({
        startOffset: sourceChild.bounds.startOffset,
        endOffset: sourceChild.bounds.endOffset,
        text: reindentFragment(
          generatedChild.text,
          getIndentAt(sourceContent, sourceChild.bounds.startOffset),
        ),
      });
    }
  });

  const missingGeneratedChildren = generatedChildren.filter(
    (child) =>
      ENTITY_TAGS.has(child.bounds.tagName) &&
      !sourceChildrenByKey.has(child.key) &&
      !nestedEntityKeys.has(child.key),
  );
  if (missingGeneratedChildren.length > 0) {
    const newline = sourceContent.includes('\r\n') ? '\r\n' : '\n';
    const insertionIndent = sourceChildren[0]
      ? getIndentAt(sourceContent, sourceChildren[0].bounds.startOffset)
      : `${getIndentAt(sourceContent, sourceModel.startOffset)}  `;
    const insertAt = getClosingTagStart(sourceContent, sourceModel);
    replacements.push({
      startOffset: insertAt,
      endOffset: insertAt,
      text: `${newline}${missingGeneratedChildren
        .map((child) => reindentFragment(child.text, insertionIndent))
        .join(newline)}${newline}${getIndentAt(sourceContent, insertAt)}`,
    });
  }

  if (replacements.length === 0) {
    return { content: sourceContent, level: 'attribute' };
  }
  return { content: applyTextReplacements(sourceContent, replacements), level: 'entity' };
}

export function patchControlledSdfModelSections({
  sourceContent,
  sourceModel,
  generatedContent,
  generatedModel,
}: {
  sourceContent: string;
  sourceModel: XmlElementBounds;
  generatedContent: string;
  generatedModel: XmlElementBounds;
}): string {
  const sourceSections = collectModelChildren(sourceContent, sourceModel);
  const generatedSections = collectModelChildren(generatedContent, generatedModel);
  const nestedEntityKeys = collectNestedModelEntityKeys(sourceContent, sourceModel);
  const generatedByKey = new Map(generatedSections.map((section) => [section.key, section]));
  const sourceByKey = new Map(sourceSections.map((section) => [section.key, section]));
  const replacements: TextReplacement[] = [];

  sourceSections.forEach((sourceSection) => {
    const generatedSection = generatedByKey.get(sourceSection.key);
    replacements.push({
      startOffset: sourceSection.bounds.startOffset,
      endOffset: sourceSection.bounds.endOffset,
      text: generatedSection
        ? reindentFragment(
            generatedSection.text,
            getIndentAt(sourceContent, sourceSection.bounds.startOffset),
          )
        : '',
    });
  });

  const missingGeneratedSections = generatedSections.filter(
    (section) =>
      !sourceByKey.has(section.key) &&
      !(ENTITY_TAGS.has(section.bounds.tagName) && nestedEntityKeys.has(section.key)),
  );
  if (missingGeneratedSections.length > 0) {
    const insertAt = getClosingTagStart(sourceContent, sourceModel);
    const newline = sourceContent.includes('\r\n') ? '\r\n' : '\n';
    const childIndent = sourceSections[0]
      ? getIndentAt(sourceContent, sourceSections[0].bounds.startOffset)
      : `${getIndentAt(sourceContent, sourceModel.startOffset)}  `;
    replacements.push({
      startOffset: insertAt,
      endOffset: insertAt,
      text: `${newline}${missingGeneratedSections
        .map((section) => reindentFragment(section.text, childIndent))
        .join(newline)}${newline}${getIndentAt(sourceContent, insertAt)}`,
    });
  }

  return applyTextReplacements(sourceContent, replacements);
}
