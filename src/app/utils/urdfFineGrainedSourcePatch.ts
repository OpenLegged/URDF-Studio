import {
  getIndentAt,
  getLineStart,
  getPreferredNewline,
  replaceOrRemoveXmlAttribute,
} from '@/core/utils/xmlSourceTextUtils';
import {
  applyTextReplacements,
  collectDirectChildren,
  getAttributeValueFromOpenTag,
  getClosingTagStart,
  getElementAttribute,
  getOpenTag,
  reindentFragment,
  type TextReplacement,
  type XmlElementBounds,
} from '@/app/hooks/source-preserving-export/xmlSourcePatch';

export type UrdfJointFinePatchField =
  | 'type'
  | 'parent'
  | 'child'
  | 'origin'
  | 'axis'
  | 'calibration'
  | 'safety_controller'
  | 'dynamics'
  | 'hardware'
  | 'mimic';

export type UrdfLinkFinePatchField = 'visual' | 'collision';

interface NamedEntityPatchOptions<Field extends string> {
  sourceContent: string;
  generatedContent: string;
  entityName: string;
  fields: ReadonlySet<Field>;
}

const JOINT_SIMPLE_CHILD_ATTRIBUTES: Partial<
  Record<UrdfJointFinePatchField, string[]>
> = {
  parent: ['link'],
  child: ['link'],
  origin: ['xyz', 'rpy'],
  axis: ['xyz'],
  calibration: ['reference_position', 'rising', 'falling'],
  safety_controller: [
    'soft_lower_limit',
    'soft_upper_limit',
    'k_position',
    'k_velocity',
  ],
  dynamics: ['damping', 'friction'],
  mimic: ['joint', 'multiplier', 'offset'],
};

function findNamedRootChild(
  content: string,
  tagName: 'link' | 'joint',
  name: string,
): XmlElementBounds | null {
  return (
    collectDirectChildren(content, 'robot').find(
      (element) =>
        element.tagName === tagName && getElementAttribute(content, element, 'name') === name,
    ) ?? null
  );
}

function collectEntityChildren(
  content: string,
  entity: XmlElementBounds,
  childTagName: string,
): XmlElementBounds[] {
  const fragment = content.slice(entity.startOffset, entity.endOffset);
  return collectDirectChildren(fragment, entity.tagName)
    .filter((child) => child.tagName === childTagName)
    .map((child) => ({
      ...child,
      startOffset: entity.startOffset + child.startOffset,
      endOffset: entity.startOffset + child.endOffset,
    }));
}

function removeElements(content: string, elements: XmlElementBounds[]): string {
  return applyTextReplacements(
    content,
    elements.map((element) => ({
      startOffset: element.startOffset,
      endOffset: element.endOffset,
      text: '',
    })),
  );
}

function insertGeneratedChildren(
  sourceContent: string,
  sourceEntity: XmlElementBounds,
  generatedContent: string,
  generatedChildren: XmlElementBounds[],
): string {
  if (generatedChildren.length === 0) return sourceContent;

  let closeOffset: number;
  try {
    closeOffset = getClosingTagStart(sourceContent, sourceEntity);
  } catch {
    // A self-closing entity needs structural expansion; the safe fragment
    // reconciler will handle that case.
    return sourceContent;
  }

  const entityIndent = getIndentAt(sourceContent, sourceEntity.startOffset);
  const childIndent = `${entityIndent}  `;
  const newline = getPreferredNewline(sourceContent);
  const fragments = generatedChildren.map((child) =>
    reindentFragment(
      generatedContent.slice(child.startOffset, child.endOffset),
      childIndent,
    ),
  );
  const closeLineStart = getLineStart(sourceContent, closeOffset);
  return `${sourceContent.slice(0, closeLineStart)}${fragments.join(newline)}${newline}${sourceContent.slice(closeLineStart)}`;
}

function replaceWholeDirectChildren({
  sourceContent,
  generatedContent,
  sourceEntity,
  generatedEntity,
  childTagName,
}: {
  sourceContent: string;
  generatedContent: string;
  sourceEntity: XmlElementBounds;
  generatedEntity: XmlElementBounds;
  childTagName: string;
}): string {
  const sourceChildren = collectEntityChildren(sourceContent, sourceEntity, childTagName);
  const generatedChildren = collectEntityChildren(
    generatedContent,
    generatedEntity,
    childTagName,
  );
  if (sourceChildren.length !== generatedChildren.length) {
    const withoutSourceChildren = removeElements(sourceContent, sourceChildren);
    const refreshedEntity = findNamedRootChild(
      withoutSourceChildren,
      sourceEntity.tagName as 'link' | 'joint',
      getElementAttribute(sourceContent, sourceEntity, 'name') ?? '',
    );
    return refreshedEntity
      ? insertGeneratedChildren(
          withoutSourceChildren,
          refreshedEntity,
          generatedContent,
          generatedChildren,
        )
      : sourceContent;
  }

  const replacements: TextReplacement[] = sourceChildren.map((sourceChild, index) => {
    const generatedChild = generatedChildren[index]!;
    return {
      startOffset: sourceChild.startOffset,
      endOffset: sourceChild.endOffset,
      text: reindentFragment(
        generatedContent.slice(generatedChild.startOffset, generatedChild.endOffset),
        '',
      ),
    };
  });
  return applyTextReplacements(sourceContent, replacements);
}

function patchDirectChildAttributes({
  sourceContent,
  generatedContent,
  sourceEntity,
  generatedEntity,
  childTagName,
  attributeNames,
}: {
  sourceContent: string;
  generatedContent: string;
  sourceEntity: XmlElementBounds;
  generatedEntity: XmlElementBounds;
  childTagName: string;
  attributeNames: string[];
}): string {
  const sourceChild = collectEntityChildren(sourceContent, sourceEntity, childTagName)[0];
  const generatedChild = collectEntityChildren(
    generatedContent,
    generatedEntity,
    childTagName,
  )[0];
  if (!generatedChild) {
    return sourceChild ? removeElements(sourceContent, [sourceChild]) : sourceContent;
  }
  if (!sourceChild) {
    return insertGeneratedChildren(
      sourceContent,
      sourceEntity,
      generatedContent,
      [generatedChild],
    );
  }

  const sourceOpenTag = getOpenTag(sourceContent, sourceChild);
  const generatedOpenTag = getOpenTag(generatedContent, generatedChild);
  const patchedOpenTag = attributeNames.reduce(
    (openTag, attributeName) =>
      replaceOrRemoveXmlAttribute(
        openTag,
        attributeName,
        getAttributeValueFromOpenTag(generatedOpenTag, attributeName),
      ),
    sourceOpenTag,
  );
  return `${sourceContent.slice(0, sourceChild.startOffset)}${patchedOpenTag}${sourceContent.slice(
    sourceChild.startOffset + sourceOpenTag.length,
  )}`;
}

function patchEntityOpenTagAttribute({
  sourceContent,
  sourceEntity,
  generatedContent,
  generatedEntity,
  attributeName,
}: {
  sourceContent: string;
  sourceEntity: XmlElementBounds;
  generatedContent: string;
  generatedEntity: XmlElementBounds;
  attributeName: string;
}): string {
  const sourceOpenTag = getOpenTag(sourceContent, sourceEntity);
  const generatedOpenTag = getOpenTag(generatedContent, generatedEntity);
  const patchedOpenTag = replaceOrRemoveXmlAttribute(
    sourceOpenTag,
    attributeName,
    getAttributeValueFromOpenTag(generatedOpenTag, attributeName),
  );
  return `${sourceContent.slice(0, sourceEntity.startOffset)}${patchedOpenTag}${sourceContent.slice(
    sourceEntity.startOffset + sourceOpenTag.length,
  )}`;
}

export function patchUrdfJointFieldsInSource({
  sourceContent,
  generatedContent,
  entityName,
  fields,
}: NamedEntityPatchOptions<UrdfJointFinePatchField>): string {
  let content = sourceContent;
  for (const field of fields) {
    const sourceJoint = findNamedRootChild(content, 'joint', entityName);
    const generatedJoint = findNamedRootChild(generatedContent, 'joint', entityName);
    if (!sourceJoint || !generatedJoint) return content;

    if (field === 'type') {
      content = patchEntityOpenTagAttribute({
        sourceContent: content,
        sourceEntity: sourceJoint,
        generatedContent,
        generatedEntity: generatedJoint,
        attributeName: 'type',
      });
      continue;
    }
    if (field === 'hardware') {
      content = replaceWholeDirectChildren({
        sourceContent: content,
        generatedContent,
        sourceEntity: sourceJoint,
        generatedEntity: generatedJoint,
        childTagName: field,
      });
      continue;
    }

    content = patchDirectChildAttributes({
      sourceContent: content,
      generatedContent,
      sourceEntity: sourceJoint,
      generatedEntity: generatedJoint,
      childTagName: field,
      attributeNames: JOINT_SIMPLE_CHILD_ATTRIBUTES[field] ?? [],
    });
  }
  return content;
}

export function patchUrdfLinkFieldsInSource({
  sourceContent,
  generatedContent,
  entityName,
  fields,
}: NamedEntityPatchOptions<UrdfLinkFinePatchField>): string {
  let content = sourceContent;
  for (const field of fields) {
    const sourceLink = findNamedRootChild(content, 'link', entityName);
    const generatedLink = findNamedRootChild(generatedContent, 'link', entityName);
    if (!sourceLink || !generatedLink) return content;
    content = replaceWholeDirectChildren({
      sourceContent: content,
      generatedContent,
      sourceEntity: sourceLink,
      generatedEntity: generatedLink,
      childTagName: field,
    });
  }
  return content;
}
