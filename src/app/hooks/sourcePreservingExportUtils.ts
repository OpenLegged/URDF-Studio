import { parseEditableRobotSource } from '@/app/utils/parseEditableRobotSource';
import type { RobotFile, RobotState } from '@/types';
import { createRobotSourceSnapshot } from './workspace-source-sync/robot_source_snapshot';
import { getPreferredNewline, getIndentAt } from '@/core/utils/xmlSourceTextUtils';
import {
  applyRootAttributePatch,
  applyTextReplacements,
  collectDirectChildren,
  collectXmlElementBounds,
  findRootElement,
  getAttributeValueFromOpenTag,
  getClosingTagStart,
  getElementAttribute,
  getOpenTag,
  reindentFragment,
  SourcePreservingExportError,
} from './source-preserving-export/xmlSourcePatch';
import type { TextReplacement, XmlElementBounds } from './source-preserving-export/xmlSourcePatch';

export { SourcePreservingExportError } from './source-preserving-export/xmlSourcePatch';

export type SourcePreservingExportFormat = Extract<
  RobotFile['format'],
  'urdf' | 'mjcf' | 'sdf' | 'xacro'
>;

export type SourcePreservingExportStrategy = 'source-preserved' | 'generated-from-robot-state';

export interface SourcePreservingExportFile {
  name: string;
  format: SourcePreservingExportFormat;
  content?: string | null;
}

export interface ResolveSourcePreservingExportContentOptions {
  format: SourcePreservingExportFormat;
  currentRobot: RobotState;
  sourceFile?: SourcePreservingExportFile | null;
  generatedContent: string;
  availableFiles?: RobotFile[];
  allFileContents?: Record<string, string>;
}

export interface SourcePreservingExportResult {
  content: string;
  strategy: SourcePreservingExportStrategy;
}

interface KeyedElement {
  key: string;
  tagName: string;
  bounds: XmlElementBounds;
  text: string;
}

const NAME_ATTR_RE = /\bname\s*=\s*(["'])(.*?)\1/i;
const PATCHABLE_URDF_LIKE_TAGS = new Set([
  'link',
  'joint',
  'material',
  'transmission',
  'ros2_control',
  'gazebo',
  'xacro:arg',
  'xacro:property',
  'xacro:if',
  'xacro:unless',
]);
const URDF_MODEL_TAGS = new Set([
  'link',
  'joint',
  'material',
  'transmission',
  'ros2_control',
  'gazebo',
]);
const MANAGED_XACRO_CONTROL_ARG_NAMES = new Set(['ros_profile', 'ros_hardware_interface']);
const MANAGED_GAZEBO_CONTROL_PLUGIN_NAMES = new Set([
  'gazebo_ros_control',
  'gazebo_ros2_control',
  'gz_ros2_control::GazeboSimROS2ControlPlugin',
]);
const MJCF_MODEL_SECTION_TAGS = new Set([
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

function resolveElementKey(
  xml: string,
  element: XmlElementBounds,
  fallbackIndex: number,
): string | null {
  const openTag = getOpenTag(xml, element);
  const name = getAttributeValueFromOpenTag(openTag, 'name');
  if (name) {
    return `${element.tagName}:${name}`;
  }

  const reference = getAttributeValueFromOpenTag(openTag, 'reference');
  if (reference) {
    return `${element.tagName}:reference:${reference}`;
  }

  if (element.tagName === 'gazebo') {
    const text = xml.slice(element.startOffset, element.endOffset);
    const pluginName =
      getFirstNestedPluginAttribute(text, 'name') ||
      getFirstNestedPluginAttribute(text, 'filename');
    if (pluginName) {
      return `${element.tagName}:plugin:${pluginName}`;
    }
  }

  const value = getAttributeValueFromOpenTag(openTag, 'value');
  if (value && (element.tagName === 'xacro:if' || element.tagName === 'xacro:unless')) {
    return `${element.tagName}:value:${value}`;
  }

  if (element.tagName === 'worldbody' || element.tagName === 'asset') {
    return element.tagName;
  }

  return `${element.tagName}:index:${fallbackIndex}`;
}

function getFirstNestedPluginAttribute(elementText: string, attrName: string): string | null {
  const pluginOpenTag = elementText.match(/<\s*plugin\b[^>]*>/i)?.[0];
  return pluginOpenTag ? getAttributeValueFromOpenTag(pluginOpenTag, attrName) : null;
}

function isManagedGazeboControlPlugin(text: string): boolean {
  const pluginName = getFirstNestedPluginAttribute(text, 'name');
  const pluginFilename = getFirstNestedPluginAttribute(text, 'filename');
  return (
    Boolean(pluginName && MANAGED_GAZEBO_CONTROL_PLUGIN_NAMES.has(pluginName)) ||
    pluginFilename === 'libgazebo_ros_control.so' ||
    pluginFilename === 'libgazebo_ros2_control.so' ||
    pluginFilename === 'libgz_ros2_control-system.so'
  );
}

function isManagedXacroControlConditional(text: string): boolean {
  return (
    /xacro\.arg\(\s*['"]ros_profile['"]\s*\)/.test(text) &&
    /xacro\.arg\(\s*['"]ros_hardware_interface['"]\s*\)/.test(text)
  );
}

function isManagedXacroControlChild(child: KeyedElement): boolean {
  if (child.tagName === 'transmission' || child.tagName === 'ros2_control') {
    return true;
  }

  if (child.tagName === 'gazebo') {
    return isManagedGazeboControlPlugin(child.text);
  }

  if (child.tagName === 'xacro:arg') {
    return MANAGED_XACRO_CONTROL_ARG_NAMES.has(
      getAttributeValueFromOpenTag(
        getOpenTag(child.text, {
          tagName: child.tagName,
          startOffset: 0,
          endOffset: child.text.length,
          parentTagName: null,
        }),
        'name',
      ) ?? '',
    );
  }

  if (child.tagName === 'xacro:if' || child.tagName === 'xacro:unless') {
    return isManagedXacroControlConditional(child.text);
  }

  return false;
}

function collectKeyedChildren(
  xml: string,
  parentTagName: string,
  includeTag: (tagName: string) => boolean,
): KeyedElement[] {
  return collectDirectChildren(xml, parentTagName)
    .filter((element) => includeTag(element.tagName))
    .map((element, index) => ({
      key: resolveElementKey(xml, element, index) ?? `${element.tagName}:index:${index}`,
      tagName: element.tagName,
      bounds: element,
      text: xml.slice(element.startOffset, element.endOffset),
    }));
}

function shouldDeleteMissingUrdfLikeChild(format: 'urdf' | 'xacro', child: KeyedElement): boolean {
  if (format !== 'xacro') {
    return URDF_MODEL_TAGS.has(child.tagName);
  }

  if (child.tagName === 'gazebo') {
    return isManagedXacroControlChild(child);
  }

  if (
    child.tagName === 'xacro:arg' ||
    child.tagName === 'xacro:if' ||
    child.tagName === 'xacro:unless'
  ) {
    return isManagedXacroControlChild(child);
  }

  return URDF_MODEL_TAGS.has(child.tagName);
}

function collectManagedXacroControlChildren(xml: string): KeyedElement[] {
  return collectKeyedChildren(xml, 'robot', (tagName) =>
    PATCHABLE_URDF_LIKE_TAGS.has(tagName),
  ).filter((child) => isManagedXacroControlChild(child));
}

function patchMatchingXacroSource(sourceContent: string, generatedContent: string): string {
  const sourceRoot = findRootElement(sourceContent, 'robot');
  const generatedRoot = findRootElement(generatedContent, 'robot');
  if (!sourceRoot || !generatedRoot) {
    throw new SourcePreservingExportError('Cannot locate <robot> root for xacro export.');
  }

  const patched = applyRootAttributePatch({
    xml: sourceContent,
    sourceRoot,
    generatedRoot,
    generatedXml: generatedContent,
    attrNames: ['name', 'version', 'xmlns:xacro'],
  });
  const patchedRoot = findRootElement(patched, 'robot');
  if (!patchedRoot) {
    throw new SourcePreservingExportError('Cannot re-locate <robot> root for xacro export.');
  }

  const sourceChildren = collectManagedXacroControlChildren(patched);
  const generatedChildren = collectManagedXacroControlChildren(generatedContent);
  const sourceChildrenByKey = new Map(sourceChildren.map((child) => [child.key, child]));
  const generatedChildrenByKey = new Map(generatedChildren.map((child) => [child.key, child]));
  const replacements: TextReplacement[] = [];

  sourceChildren.forEach((sourceChild) => {
    const generatedChild = generatedChildrenByKey.get(sourceChild.key);
    replacements.push({
      startOffset: sourceChild.bounds.startOffset,
      endOffset: sourceChild.bounds.endOffset,
      text: generatedChild
        ? reindentFragment(
            generatedChild.text,
            getIndentAt(patched, sourceChild.bounds.startOffset),
          )
        : '',
    });
  });

  const missingGeneratedChildren = generatedChildren.filter(
    (child) => !sourceChildrenByKey.has(child.key),
  );
  if (missingGeneratedChildren.length > 0) {
    const newline = getPreferredNewline(patched);
    const allRootChildren = collectDirectChildren(patched, 'robot');
    const insertionIndent = allRootChildren[0]
      ? getIndentAt(patched, allRootChildren[0].startOffset)
      : '  ';
    replacements.push({
      startOffset: getClosingTagStart(patched, patchedRoot),
      endOffset: getClosingTagStart(patched, patchedRoot),
      text: `${newline}${missingGeneratedChildren
        .map((child) => reindentFragment(child.text, insertionIndent))
        .join(newline)}${newline}`,
    });
  }

  return applyTextReplacements(patched, replacements);
}

function normalizeForSnapshot(robot: RobotState): RobotState {
  return {
    ...robot,
    selection: { type: null, id: null },
  };
}

function stableNormalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableNormalize);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const skippedKeys = new Set(['visible', 'selection', 'quaternion']);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !skippedKeys.has(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableNormalize(entry)]),
  );
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableNormalize(value));
}

function resolveRobotLinkByName(robot: RobotState, name: string): unknown {
  return Object.values(robot.links).find((link) => (link.name || link.id) === name) ?? null;
}

function resolveRobotJointByName(robot: RobotState, name: string): unknown {
  return Object.values(robot.joints).find((joint) => (joint.name || joint.id) === name) ?? null;
}

function collectChangedUrdfLikeKeys(
  sourceRobot: RobotState | null,
  generatedRobot: RobotState,
): Set<string> {
  const changedKeys = new Set<string>();

  const sourceLinkNames = new Set(
    sourceRobot ? Object.values(sourceRobot.links).map((link) => link.name || link.id) : [],
  );
  const sourceJointNames = new Set(
    sourceRobot ? Object.values(sourceRobot.joints).map((joint) => joint.name || joint.id) : [],
  );

  Object.values(generatedRobot.links).forEach((link) => {
    const name = link.name || link.id;
    const sourceLink = sourceRobot ? resolveRobotLinkByName(sourceRobot, name) : null;
    if (!sourceLink || stableStringify(sourceLink) !== stableStringify(link)) {
      changedKeys.add(`link:${name}`);
    }
  });

  Object.values(generatedRobot.joints).forEach((joint) => {
    const name = joint.name || joint.id;
    const sourceJoint = sourceRobot ? resolveRobotJointByName(sourceRobot, name) : null;
    if (!sourceJoint || stableStringify(sourceJoint) !== stableStringify(joint)) {
      changedKeys.add(`joint:${name}`);
    }
  });

  sourceLinkNames.forEach((name) => {
    if (!resolveRobotLinkByName(generatedRobot, name)) {
      changedKeys.add(`link:${name}`);
    }
  });
  sourceJointNames.forEach((name) => {
    if (!resolveRobotJointByName(generatedRobot, name)) {
      changedKeys.add(`joint:${name}`);
    }
  });

  if (
    sourceRobot &&
    stableStringify(sourceRobot.materials ?? {}) !== stableStringify(generatedRobot.materials ?? {})
  ) {
    Object.keys(generatedRobot.materials ?? {}).forEach((name) => {
      changedKeys.add(`material:${name}`);
    });
  }

  return changedKeys;
}

function parseExportContent(
  format: SourcePreservingExportFormat,
  sourceFileName: string,
  content: string,
  availableFiles: RobotFile[] = [],
  allFileContents: Record<string, string> = {},
): RobotState | null {
  return parseEditableRobotSource({
    file: {
      name: sourceFileName,
      format,
    },
    content,
    availableFiles,
    allFileContents: {
      ...allFileContents,
      [sourceFileName]: content,
    },
  });
}

function buildRobotSnapshot(robot: RobotState): string {
  return createRobotSourceSnapshot(normalizeForSnapshot(robot));
}

function validatePatchedContent(
  options: ResolveSourcePreservingExportContentOptions,
  patchedContent: string,
): void {
  const sourceFileName = options.sourceFile?.name || `export.${options.format}`;
  const generatedRobot = parseExportContent(
    options.format,
    sourceFileName,
    options.generatedContent,
    options.availableFiles,
    options.allFileContents,
  );
  const patchedRobot = parseExportContent(
    options.format,
    sourceFileName,
    patchedContent,
    options.availableFiles,
    options.allFileContents,
  );

  if (!generatedRobot || !patchedRobot) {
    throw new SourcePreservingExportError(
      `Failed to validate ${options.format.toUpperCase()} source-preserving export.`,
    );
  }

  if (buildRobotSnapshot(generatedRobot) !== buildRobotSnapshot(patchedRobot)) {
    throw new SourcePreservingExportError(
      `${options.format.toUpperCase()} source-preserving export did not match RobotState output.`,
    );
  }
}

function assertPatchableXacro(
  sourceContent: string,
  sourceChildrenByKey: Map<string, KeyedElement>,
  generatedChildrenByKey: Map<string, KeyedElement>,
): void {
  const hasComplexXacro = /<\s*xacro:(?:macro|include)\b|\$\{|\$\(/i.test(sourceContent);
  if (!hasComplexXacro) {
    return;
  }

  const missingModelKeys = [...generatedChildrenByKey.values()].filter(
    (child) =>
      (child.tagName === 'link' || child.tagName === 'joint') &&
      !sourceChildrenByKey.has(child.key),
  );

  if (missingModelKeys.length > 0) {
    throw new SourcePreservingExportError(
      'Cannot preserve Xacro text structure because links or joints are generated by macros/includes.',
    );
  }
}

function patchUrdfLikeSource(
  sourceContent: string,
  generatedContent: string,
  format: 'urdf' | 'xacro',
  sourceRobot: RobotState | null,
  generatedRobot: RobotState,
): string {
  const sourceRoot = findRootElement(sourceContent, 'robot');
  const generatedRoot = findRootElement(generatedContent, 'robot');
  if (!sourceRoot || !generatedRoot) {
    throw new SourcePreservingExportError(`Cannot locate <robot> root for ${format} export.`);
  }

  const changedKeys = collectChangedUrdfLikeKeys(sourceRobot, generatedRobot);
  const patched = applyRootAttributePatch({
    xml: sourceContent,
    sourceRoot,
    generatedRoot,
    generatedXml: generatedContent,
    attrNames: format === 'xacro' ? ['name', 'version', 'xmlns:xacro'] : ['name', 'version'],
  });
  const patchedRoot = findRootElement(patched, 'robot');
  if (!patchedRoot) {
    throw new SourcePreservingExportError(`Cannot re-locate <robot> root for ${format} export.`);
  }

  const sourceChildren = collectKeyedChildren(patched, 'robot', (tagName) =>
    PATCHABLE_URDF_LIKE_TAGS.has(tagName),
  );
  const generatedChildren = collectKeyedChildren(generatedContent, 'robot', (tagName) =>
    PATCHABLE_URDF_LIKE_TAGS.has(tagName),
  );
  const sourceChildrenByKey = new Map(sourceChildren.map((child) => [child.key, child]));
  const generatedChildrenByKey = new Map(generatedChildren.map((child) => [child.key, child]));

  if (format === 'xacro') {
    assertPatchableXacro(patched, sourceChildrenByKey, generatedChildrenByKey);
  }

  const replacements: TextReplacement[] = [];
  sourceChildren.forEach((sourceChild) => {
    const generatedChild = generatedChildrenByKey.get(sourceChild.key);
    const shouldDeleteIfMissing = shouldDeleteMissingUrdfLikeChild(format, sourceChild);

    if (!generatedChild) {
      if (shouldDeleteIfMissing) {
        replacements.push({
          startOffset: sourceChild.bounds.startOffset,
          endOffset: sourceChild.bounds.endOffset,
          text: '',
        });
      }
      return;
    }

    if (
      !URDF_MODEL_TAGS.has(sourceChild.tagName) ||
      changedKeys.has(sourceChild.key) ||
      (format === 'xacro' && isManagedXacroControlChild(sourceChild))
    ) {
      replacements.push({
        startOffset: sourceChild.bounds.startOffset,
        endOffset: sourceChild.bounds.endOffset,
        text: reindentFragment(
          generatedChild.text,
          getIndentAt(patched, sourceChild.bounds.startOffset),
        ),
      });
    }
  });

  const missingGeneratedChildren = generatedChildren.filter((child) => {
    if (sourceChildrenByKey.has(child.key)) {
      return false;
    }
    if (format === 'xacro' && child.tagName === 'xacro:property') {
      return false;
    }
    return true;
  });

  if (missingGeneratedChildren.length > 0) {
    const newline = getPreferredNewline(patched);
    const existingIndent = sourceChildren[0]
      ? getIndentAt(patched, sourceChildren[0].bounds.startOffset)
      : '  ';
    const insertion = `${newline}${missingGeneratedChildren
      .map((child) => reindentFragment(child.text, existingIndent))
      .join(newline)}${newline}`;
    replacements.push({
      startOffset: getClosingTagStart(patched, patchedRoot),
      endOffset: getClosingTagStart(patched, patchedRoot),
      text: insertion,
    });
  }

  return applyTextReplacements(patched, replacements);
}

function patchMjcfSource(sourceContent: string, generatedContent: string): string {
  const sourceRoot = findRootElement(sourceContent, 'mujoco');
  const generatedRoot = findRootElement(generatedContent, 'mujoco');
  if (!sourceRoot || !generatedRoot) {
    throw new SourcePreservingExportError('Cannot locate <mujoco> root for MJCF export.');
  }
  if (collectDirectChildren(sourceContent, 'mujoco').some((child) => child.tagName === 'include')) {
    throw new SourcePreservingExportError(
      'Cannot preserve MJCF text structure with root-level <include> files.',
    );
  }

  const patched = applyRootAttributePatch({
    xml: sourceContent,
    sourceRoot,
    generatedRoot,
    generatedXml: generatedContent,
    attrNames: ['model'],
  });
  const patchedRoot = findRootElement(patched, 'mujoco');
  if (!patchedRoot) {
    throw new SourcePreservingExportError('Cannot re-locate <mujoco> root for MJCF export.');
  }

  const sourceSections = collectKeyedChildren(patched, 'mujoco', (tagName) =>
    MJCF_MODEL_SECTION_TAGS.has(tagName),
  );
  const generatedSections = collectKeyedChildren(generatedContent, 'mujoco', (tagName) =>
    MJCF_MODEL_SECTION_TAGS.has(tagName),
  );
  const sourceSectionsByKey = new Map(sourceSections.map((section) => [section.key, section]));
  const generatedSectionsByKey = new Map(
    generatedSections.map((section) => [section.key, section]),
  );
  const replacements: TextReplacement[] = [];

  sourceSections.forEach((sourceSection) => {
    const generatedSection = generatedSectionsByKey.get(sourceSection.key);
    replacements.push({
      startOffset: sourceSection.bounds.startOffset,
      endOffset: sourceSection.bounds.endOffset,
      text: generatedSection
        ? reindentFragment(
            generatedSection.text,
            getIndentAt(patched, sourceSection.bounds.startOffset),
          )
        : '',
    });
  });

  const missingSections = generatedSections.filter(
    (section) => !sourceSectionsByKey.has(section.key),
  );
  if (missingSections.length > 0) {
    const newline = getPreferredNewline(patched);
    const insertionIndent = sourceSections[0]
      ? getIndentAt(patched, sourceSections[0].bounds.startOffset)
      : '  ';
    replacements.push({
      startOffset: getClosingTagStart(patched, patchedRoot),
      endOffset: getClosingTagStart(patched, patchedRoot),
      text: `${newline}${missingSections
        .map((section) => reindentFragment(section.text, insertionIndent))
        .join(newline)}${newline}`,
    });
  }

  return applyTextReplacements(patched, replacements);
}

function findGeneratedSdfModel(generatedContent: string): KeyedElement | null {
  return collectKeyedChildren(generatedContent, 'sdf', (tagName) => tagName === 'model')[0] ?? null;
}

function findSourceSdfModel(
  sourceContent: string,
  generatedModelName: string | null,
): KeyedElement | null {
  const allBounds = collectXmlElementBounds(sourceContent);
  const modelBounds = allBounds
    .filter((element) => element.tagName === 'model')
    .filter((element) => element.parentTagName === 'sdf' || element.parentTagName === 'world')
    .sort((left, right) => left.startOffset - right.startOffset);
  const keyedModels = modelBounds.map((bounds, index) => ({
    key: resolveElementKey(sourceContent, bounds, index) ?? `model:index:${index}`,
    tagName: 'model',
    bounds,
    text: sourceContent.slice(bounds.startOffset, bounds.endOffset),
  }));

  if (generatedModelName) {
    const matchingModel = keyedModels.find(
      (model) => getElementAttribute(sourceContent, model.bounds, 'name') === generatedModelName,
    );
    if (matchingModel) {
      return matchingModel;
    }
  }

  if (keyedModels.length === 1) {
    return keyedModels[0];
  }

  return null;
}

function patchSdfSource(sourceContent: string, generatedContent: string): string {
  const sourceRoot = findRootElement(sourceContent, 'sdf');
  const generatedRoot = findRootElement(generatedContent, 'sdf');
  if (!sourceRoot || !generatedRoot) {
    throw new SourcePreservingExportError('Cannot locate <sdf> root for SDF export.');
  }

  const generatedModel = findGeneratedSdfModel(generatedContent);
  if (!generatedModel) {
    throw new SourcePreservingExportError('Cannot locate generated <model> for SDF export.');
  }

  const generatedModelName = getElementAttribute(generatedContent, generatedModel.bounds, 'name');
  const sourceModel = findSourceSdfModel(sourceContent, generatedModelName);
  if (!sourceModel) {
    throw new SourcePreservingExportError(
      'Cannot preserve SDF text structure because the source model is ambiguous.',
    );
  }

  const patched = applyRootAttributePatch({
    xml: sourceContent,
    sourceRoot,
    generatedRoot,
    generatedXml: generatedContent,
    attrNames: ['version'],
  });
  const adjustedSourceModel =
    patched === sourceContent
      ? sourceModel
      : findSourceSdfModel(
          patched,
          getElementAttribute(generatedContent, generatedModel.bounds, 'name'),
        );
  if (!adjustedSourceModel) {
    throw new SourcePreservingExportError('Cannot re-locate source <model> for SDF export.');
  }

  return applyTextReplacements(patched, [
    {
      startOffset: adjustedSourceModel.bounds.startOffset,
      endOffset: adjustedSourceModel.bounds.endOffset,
      text: reindentFragment(
        generatedModel.text,
        getIndentAt(patched, adjustedSourceModel.bounds.startOffset),
      ),
    },
  ]);
}

function patchSourceContent(
  format: SourcePreservingExportFormat,
  sourceContent: string,
  generatedContent: string,
  sourceRobot: RobotState | null,
  generatedRobot: RobotState,
): string {
  switch (format) {
    case 'urdf':
      return patchUrdfLikeSource(
        sourceContent,
        generatedContent,
        'urdf',
        sourceRobot,
        generatedRobot,
      );
    case 'xacro':
      return patchUrdfLikeSource(
        sourceContent,
        generatedContent,
        'xacro',
        sourceRobot,
        generatedRobot,
      );
    case 'mjcf':
      return patchMjcfSource(sourceContent, generatedContent);
    case 'sdf':
      return patchSdfSource(sourceContent, generatedContent);
    default: {
      const unsupportedFormat: never = format;
      throw new SourcePreservingExportError(
        `Unsupported source-preserving export format: ${unsupportedFormat}`,
      );
    }
  }
}

function shouldFallbackToGeneratedContent(
  format: SourcePreservingExportFormat,
  error: unknown,
): boolean {
  return (
    format === 'mjcf' &&
    error instanceof SourcePreservingExportError &&
    error.message === 'Cannot preserve MJCF text structure with root-level <include> files.'
  );
}

export function resolveSourcePreservingExportContent(
  options: ResolveSourcePreservingExportContentOptions,
): SourcePreservingExportResult {
  const { format, sourceFile, generatedContent } = options;
  const sourceContent = sourceFile?.content?.trim() ? sourceFile.content : null;

  if (!sourceFile || sourceFile.format !== format || !sourceContent) {
    return {
      content: generatedContent,
      strategy: 'generated-from-robot-state',
    };
  }

  const sourceRobot = parseExportContent(
    format,
    sourceFile.name,
    sourceContent,
    options.availableFiles,
    options.allFileContents,
  );
  const generatedRobot = parseExportContent(
    format,
    sourceFile.name,
    generatedContent,
    options.availableFiles,
    options.allFileContents,
  );

  if (!generatedRobot) {
    throw new SourcePreservingExportError(
      `Generated ${format.toUpperCase()} content cannot be parsed for source-preserving export.`,
    );
  }

  if (sourceRobot && buildRobotSnapshot(sourceRobot) === buildRobotSnapshot(generatedRobot)) {
    if (format === 'xacro') {
      const patchedContent = patchMatchingXacroSource(
        sourceFile.content ?? sourceContent,
        generatedContent,
      );
      validatePatchedContent(options, patchedContent);
      return {
        content: patchedContent,
        strategy: 'source-preserved',
      };
    }

    return {
      content: sourceFile.content ?? sourceContent,
      strategy: 'source-preserved',
    };
  }

  let patchedContent: string;
  try {
    patchedContent = patchSourceContent(
      format,
      sourceFile.content ?? sourceContent,
      generatedContent,
      sourceRobot,
      generatedRobot,
    );
  } catch (error) {
    if (shouldFallbackToGeneratedContent(format, error)) {
      return {
        content: generatedContent,
        strategy: 'generated-from-robot-state',
      };
    }
    throw error;
  }
  validatePatchedContent(options, patchedContent);

  return {
    content: patchedContent,
    strategy: 'source-preserved',
  };
}
