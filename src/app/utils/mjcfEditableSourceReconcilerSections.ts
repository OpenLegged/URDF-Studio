import { MAX_PROPERTY_DECIMALS, formatNumberWithMaxDecimals } from '@/core/utils/numberPrecision';
import {
  escapeXmlAttribute,
  getIndentAt,
  getPreferredNewline,
} from '@/core/utils/xmlSourceTextUtils';
import type {
  RobotData,
  RobotMjcfInspectionTendonAttachment,
  RobotMjcfInspectionTendonSummary,
} from '@/types';
import {
  applyTextReplacements,
  collectDirectChildren,
  findRootElement,
  getClosingTagStart,
  reindentFragment,
  type TextReplacement,
} from '@/app/hooks/source-preserving-export/xmlSourcePatch';

import { mjcfValuesEqual } from './mjcfEditableSourceReconcilerSemantics';

const SECTION_TAGS = new Set([
  'compiler',
  'default',
  'asset',
  'worldbody',
  'actuator',
  'tendon',
  'equality',
  'sensor',
  'contact',
  'keyframe',
]);

function sectionFragments(content: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  collectDirectChildren(content, 'mujoco')
    .filter((element) => SECTION_TAGS.has(element.tagName))
    .forEach((element) => {
      const entries = sections.get(element.tagName) ?? [];
      entries.push(content.slice(element.startOffset, element.endOffset));
      sections.set(element.tagName, entries);
    });
  return sections;
}

function changedGeneratedSections(beforeContent: string, afterContent: string): Set<string> {
  const beforeSections = sectionFragments(beforeContent);
  const afterSections = sectionFragments(afterContent);
  return new Set(
    [...new Set([...beforeSections.keys(), ...afterSections.keys()])].filter(
      (tagName) => !mjcfValuesEqual(beforeSections.get(tagName), afterSections.get(tagName)),
    ),
  );
}

function patchOneSection(content: string, generatedContent: string, tagName: string): string {
  const sourceElements = collectDirectChildren(content, 'mujoco').filter(
    (element) => element.tagName === tagName,
  );
  const generatedElements = collectDirectChildren(generatedContent, 'mujoco').filter(
    (element) => element.tagName === tagName,
  );
  const replacements: TextReplacement[] = sourceElements.map((sourceElement, index) => {
    const generatedElement = generatedElements[index];
    return {
      startOffset: sourceElement.startOffset,
      endOffset: sourceElement.endOffset,
      text: generatedElement
        ? reindentFragment(
            generatedContent.slice(generatedElement.startOffset, generatedElement.endOffset),
            getIndentAt(content, sourceElement.startOffset),
          )
        : '',
    };
  });
  if (generatedElements.length > sourceElements.length) {
    const root = findRootElement(content, 'mujoco');
    if (!root) throw new Error('Failed to locate the MJCF <mujoco> root.');
    const newline = getPreferredNewline(content);
    const indent = sourceElements[0]
      ? getIndentAt(content, sourceElements[0].startOffset)
      : '  ';
    replacements.push({
      startOffset: getClosingTagStart(content, root),
      endOffset: getClosingTagStart(content, root),
      text: `${newline}${generatedElements
        .slice(sourceElements.length)
        .map((element) =>
          reindentFragment(
            generatedContent.slice(element.startOffset, element.endOffset),
            indent,
          ),
        )
        .join(newline)}${newline}`,
    });
  }
  return applyTextReplacements(content, replacements);
}

function formatNumber(value: number): string {
  return formatNumberWithMaxDecimals(value, MAX_PROPERTY_DECIMALS);
}

function formatNumberList(values: readonly number[]): string {
  return values.map(formatNumber).join(' ');
}

function tendonAttributes(tendon: RobotMjcfInspectionTendonSummary): string {
  const attributes: Array<[string, string | undefined]> = [
    ['name', tendon.name],
    ['class', tendon.className],
    ['group', tendon.group === undefined ? undefined : formatNumber(tendon.group)],
    ['limited', tendon.limited === undefined ? undefined : String(tendon.limited)],
    ['range', tendon.range ? formatNumberList(tendon.range) : undefined],
    ['width', tendon.width === undefined ? undefined : formatNumber(tendon.width)],
    ['stiffness', tendon.stiffness === undefined ? undefined : formatNumber(tendon.stiffness)],
    [
      'springlength',
      tendon.springlength === undefined ? undefined : formatNumber(tendon.springlength),
    ],
    ['rgba', tendon.rgba ? formatNumberList(tendon.rgba) : undefined],
  ];
  return attributes
    .flatMap(([name, value]) =>
      value === undefined ? [] : [` ${name}="${escapeXmlAttribute(value)}"`],
    )
    .join('');
}

function tendonAttachment(attachment: RobotMjcfInspectionTendonAttachment): string {
  const ref = attachment.ref ? escapeXmlAttribute(attachment.ref) : undefined;
  switch (attachment.type) {
    case 'joint':
      return `<joint${ref ? ` joint="${ref}"` : ''}${
        attachment.coef === undefined ? '' : ` coef="${formatNumber(attachment.coef)}"`
      } />`;
    case 'site':
      return `<site${ref ? ` site="${ref}"` : ''} />`;
    case 'geom':
      return `<geom${ref ? ` geom="${ref}"` : ''}${
        attachment.sidesite
          ? ` sidesite="${escapeXmlAttribute(attachment.sidesite)}"`
          : ''
      } />`;
    case 'pulley':
      return `<pulley${
        attachment.divisor === undefined
          ? ''
          : ` divisor="${formatNumber(attachment.divisor)}"`
      } />`;
  }
}

function tendonSection(tendons: readonly RobotMjcfInspectionTendonSummary[]): string {
  if (tendons.length === 0) return '<mujoco />';
  const entries = tendons
    .map((tendon) => {
      const children = tendon.attachments
        .map((attachment) => `      ${tendonAttachment(attachment)}`)
        .join('\n');
      return `    <${tendon.type}${tendonAttributes(tendon)}>\n${children}\n    </${
        tendon.type
      }>`;
    })
    .join('\n');
  return `<mujoco>\n  <tendon>\n${entries}\n  </tendon>\n</mujoco>`;
}

function tendonsOf(robot: RobotData): RobotMjcfInspectionTendonSummary[] {
  return robot.inspectionContext?.mjcf?.tendons ?? [];
}

export function applyMJCFSectionPatches({
  sourceContent,
  generatedBefore,
  generatedAfter,
  beforeRobot,
  afterRobot,
}: {
  sourceContent: string;
  generatedBefore: string;
  generatedAfter: string;
  beforeRobot: RobotData;
  afterRobot: RobotData;
}): string {
  let content = sourceContent;
  changedGeneratedSections(generatedBefore, generatedAfter).forEach((tagName) => {
    content = patchOneSection(content, generatedAfter, tagName);
  });
  if (!mjcfValuesEqual(tendonsOf(beforeRobot), tendonsOf(afterRobot))) {
    content = patchOneSection(content, tendonSection(tendonsOf(afterRobot)), 'tendon');
  }
  return content;
}
