import { type RobotFile } from '@/types';
import {
  escapeXmlAttribute,
  getPreferredNewline,
  getLineStart,
  getIndentAt,
  replaceOrRemoveXmlAttribute,
} from '@/core/utils/xmlSourceTextUtils';
import {
  AppendMJCFChildBodyOptions,
  AppendMJCFBodyCollisionGeomOptions,
  MJCFJointLimitSourcePatchOptions,
  MJCFBodyInertialSourcePatchOptions,
  EditableCollisionGeom,
  DEFAULT_INDENT_UNIT,
  getLineEnd,
  findBodyInsertionPoint,
  findNamedStartTagOccurrence,
  findFirstStartTagOccurrence,
  findNamedStartTagOccurrenceForTags,
  buildRenamePlaceholder,
  findDirectBodyInertialOccurrence,
  updateInertialRawTag,
  buildCollisionGeomSnippet,
  updateCollisionGeomRawTag,
  findCollisionGeomOccurrenceByObjectIndex,
  renameMJCFEntityWithPlaceholder,
  detectIndentUnit,
  buildChildBodySnippet,
  resolveMJCFSourceAngleUnit,
  buildPatchedMJCFJointLimitTag,
  type MJCFRenameOperation,
} from './mjcfEditableSourcePatchHelpers';
export type { MJCFRenameOperation } from './mjcfEditableSourcePatchHelpers';

export function appendMJCFChildBodyToSource({
  sourceContent,
  parentBodyName,
  childBodyName,
  joint,
}: AppendMJCFChildBodyOptions): string {
  const insertionPoint = findBodyInsertionPoint(sourceContent, parentBodyName);
  if (!insertionPoint) {
    throw new Error(`Failed to locate MJCF <body name="${parentBodyName}"> in editable source.`);
  }

  const newline = getPreferredNewline(sourceContent);
  const parentIndent = getIndentAt(sourceContent, insertionPoint.openTagStart);
  const indentUnit = insertionPoint.selfClosing
    ? DEFAULT_INDENT_UNIT
    : detectIndentUnit(
        sourceContent,
        insertionPoint.openTagEnd,
        insertionPoint.closeTagStart,
        parentIndent,
      );
  const childIndent = `${parentIndent}${indentUnit}`;
  const childContentIndent = `${childIndent}${indentUnit}`;
  const snippet = buildChildBodySnippet(
    {
      childBodyName,
      joint,
    },
    {
      newline,
      childIndent,
      childContentIndent,
    },
  );

  if (insertionPoint.selfClosing) {
    const expandedOpenTag = insertionPoint.rawOpenTag.replace(/\/\s*>$/, '>');
    return [
      sourceContent.slice(0, insertionPoint.openTagStart),
      expandedOpenTag,
      newline,
      snippet,
      `${parentIndent}</body>`,
      sourceContent.slice(insertionPoint.openTagEnd),
    ].join('');
  }

  const closingLineStart = getLineStart(sourceContent, insertionPoint.closeTagStart);
  return [
    sourceContent.slice(0, closingLineStart),
    snippet,
    sourceContent.slice(closingLineStart),
  ].join('');
}

export function appendMJCFBodyCollisionGeomToSource({
  sourceContent,
  bodyName,
  geometry,
}: AppendMJCFBodyCollisionGeomOptions): string {
  const insertionPoint = findBodyInsertionPoint(sourceContent, bodyName);
  if (!insertionPoint) {
    throw new Error(`Failed to locate MJCF <body name="${bodyName}"> in editable source.`);
  }

  const newline = getPreferredNewline(sourceContent);
  const parentIndent = getIndentAt(sourceContent, insertionPoint.openTagStart);
  const indentUnit = insertionPoint.selfClosing
    ? DEFAULT_INDENT_UNIT
    : detectIndentUnit(
        sourceContent,
        insertionPoint.openTagEnd,
        insertionPoint.closeTagStart,
        parentIndent,
      );
  const geomIndent = `${parentIndent}${indentUnit}`;
  const snippet = buildCollisionGeomSnippet(geometry, { newline, geomIndent });

  if (insertionPoint.selfClosing) {
    const expandedOpenTag = insertionPoint.rawOpenTag.replace(/\/\s*>$/, '>');
    return [
      sourceContent.slice(0, insertionPoint.openTagStart),
      expandedOpenTag,
      newline,
      snippet,
      `${parentIndent}</body>`,
      sourceContent.slice(insertionPoint.openTagEnd),
    ].join('');
  }

  const closingLineStart = getLineStart(sourceContent, insertionPoint.closeTagStart);
  return [
    sourceContent.slice(0, closingLineStart),
    snippet,
    sourceContent.slice(closingLineStart),
  ].join('');
}

export function patchMJCFBodyInertialInSource({
  sourceContent,
  bodyName,
  inertial,
}: MJCFBodyInertialSourcePatchOptions): string {
  const insertionPoint = findBodyInsertionPoint(sourceContent, bodyName);
  if (!insertionPoint) {
    throw new Error(`Failed to locate MJCF <body name="${bodyName}"> in editable source.`);
  }

  const angleUnit = resolveMJCFSourceAngleUnit(sourceContent);
  const occurrence = findDirectBodyInertialOccurrence(sourceContent, bodyName);
  if (occurrence) {
    const nextRawTag = updateInertialRawTag(occurrence.rawTag, inertial, angleUnit);
    return [
      sourceContent.slice(0, occurrence.start),
      nextRawTag,
      sourceContent.slice(occurrence.end),
    ].join('');
  }

  const newline = getPreferredNewline(sourceContent);
  const parentIndent = getIndentAt(sourceContent, insertionPoint.openTagStart);
  const indentUnit = insertionPoint.selfClosing
    ? DEFAULT_INDENT_UNIT
    : detectIndentUnit(
        sourceContent,
        insertionPoint.openTagEnd,
        insertionPoint.closeTagStart,
        parentIndent,
      );
  const inertialIndent = `${parentIndent}${indentUnit}`;
  const inertialSnippet = `${inertialIndent}${updateInertialRawTag('<inertial />', inertial, angleUnit)}${newline}`;

  if (insertionPoint.selfClosing) {
    const expandedOpenTag = insertionPoint.rawOpenTag.replace(/\/\s*>$/, '>');
    return [
      sourceContent.slice(0, insertionPoint.openTagStart),
      expandedOpenTag,
      newline,
      inertialSnippet,
      `${parentIndent}</body>`,
      sourceContent.slice(insertionPoint.openTagEnd),
    ].join('');
  }

  return [
    sourceContent.slice(0, insertionPoint.openTagEnd),
    newline,
    inertialSnippet,
    sourceContent.slice(insertionPoint.openTagEnd),
  ].join('');
}

export function removeMJCFBodyFromSource(sourceContent: string, bodyName: string): string {
  const bodyPoint = findBodyInsertionPoint(sourceContent, bodyName);
  if (!bodyPoint) {
    throw new Error(`Failed to locate MJCF <body name="${bodyName}"> in editable source.`);
  }

  const removalStart = getLineStart(sourceContent, bodyPoint.openTagStart);
  const removalEnd = getLineEnd(sourceContent, bodyPoint.closeTagEnd);

  return `${sourceContent.slice(0, removalStart)}${sourceContent.slice(removalEnd)}`;
}

export function hasMJCFBodyInSource(sourceContent: string, bodyName: string): boolean {
  return findBodyInsertionPoint(sourceContent, bodyName) !== null;
}

export function removeMJCFBodyCollisionGeomFromSource(
  sourceContent: string,
  bodyName: string,
  objectIndex: number,
): string {
  const target = findCollisionGeomOccurrenceByObjectIndex(sourceContent, bodyName, objectIndex);
  if (!target) {
    throw new Error(
      `Failed to locate MJCF collision geom #${objectIndex} in <body name="${bodyName}">.`,
    );
  }

  if (target.renderVisual) {
    throw new Error(
      `Cannot safely remove shared visual/collision MJCF geom #${objectIndex} from <body name="${bodyName}">.`,
    );
  }

  const removalStart = getLineStart(sourceContent, target.occurrence.start);
  const removalEnd = getLineEnd(sourceContent, target.occurrence.end);
  return `${sourceContent.slice(0, removalStart)}${sourceContent.slice(removalEnd)}`;
}

export function updateMJCFBodyCollisionGeomInSource(
  sourceContent: string,
  bodyName: string,
  objectIndex: number,
  geometry: EditableCollisionGeom,
): string {
  const target = findCollisionGeomOccurrenceByObjectIndex(sourceContent, bodyName, objectIndex);
  if (!target) {
    throw new Error(
      `Failed to locate MJCF collision geom #${objectIndex} in <body name="${bodyName}">.`,
    );
  }

  if (target.renderVisual) {
    throw new Error(
      `Cannot safely update shared visual/collision MJCF geom #${objectIndex} in <body name="${bodyName}">.`,
    );
  }

  const nextRawTag = updateCollisionGeomRawTag(target.occurrence.rawTag, geometry);
  return `${sourceContent.slice(0, target.occurrence.start)}${nextRawTag}${sourceContent.slice(target.occurrence.end)}`;
}

export function renameMJCFEntitiesInSource(
  sourceContent: string,
  operations: MJCFRenameOperation[],
): string {
  const normalizedOperations = operations
    .map((operation) => ({
      kind: operation.kind,
      currentName: operation.currentName.trim(),
      nextName: operation.nextName.trim(),
    }))
    .filter(
      (operation) =>
        operation.currentName && operation.nextName && operation.currentName !== operation.nextName,
    );

  if (!normalizedOperations.length) {
    return sourceContent;
  }

  const seenOperations = new Set<string>();
  normalizedOperations.forEach((operation) => {
    const key = `${operation.kind}:${operation.currentName}`;
    if (seenOperations.has(key)) {
      throw new Error(`Duplicate MJCF rename requested for ${key}.`);
    }
    seenOperations.add(key);

    const occurrence = findNamedStartTagOccurrenceForTags(
      sourceContent,
      operation.kind === 'link' ? ['body'] : ['joint', 'freejoint'],
      operation.currentName,
    );
    if (!occurrence) {
      const tagLabel = operation.kind === 'link' ? '<body>' : '<joint>/<freejoint>';
      throw new Error(
        `Failed to locate MJCF ${tagLabel} named "${operation.currentName}" in editable source.`,
      );
    }
  });

  let nextSource = sourceContent;
  const placeholderOperations = normalizedOperations.map((operation, index) => ({
    operation,
    placeholder: buildRenamePlaceholder(nextSource, index),
  }));

  for (const { operation, placeholder } of placeholderOperations) {
    nextSource = renameMJCFEntityWithPlaceholder(nextSource, operation, placeholder);
  }

  for (const { operation, placeholder } of placeholderOperations) {
    nextSource = nextSource.split(placeholder).join(escapeXmlAttribute(operation.nextName));
  }

  return nextSource;
}

export function renameMJCFBodyInSource(
  sourceContent: string,
  currentName: string,
  nextName: string,
): string {
  return renameMJCFEntitiesInSource(sourceContent, [{ kind: 'link', currentName, nextName }]);
}

export function renameMJCFJointInSource(
  sourceContent: string,
  currentName: string,
  nextName: string,
): string {
  return renameMJCFEntitiesInSource(sourceContent, [{ kind: 'joint', currentName, nextName }]);
}

export function patchMJCFRootModelNameInSource(sourceContent: string, modelName: string): string {
  const rootOccurrence = findFirstStartTagOccurrence(sourceContent, 'mujoco');
  if (!rootOccurrence) {
    throw new Error('Failed to locate MJCF <mujoco> root in editable source.');
  }

  const nextRawTag = replaceOrRemoveXmlAttribute(rootOccurrence.rawTag, 'model', modelName);
  return `${sourceContent.slice(0, rootOccurrence.start)}${nextRawTag}${sourceContent.slice(rootOccurrence.end)}`;
}

export function patchMJCFJointLimitInSource({
  sourceContent,
  jointName,
  jointType,
  limit,
}: MJCFJointLimitSourcePatchOptions): string {
  const occurrence = findNamedStartTagOccurrence(sourceContent, 'joint', jointName);
  if (!occurrence) {
    throw new Error(`Failed to locate MJCF <joint name="${jointName}"> in editable source.`);
  }

  const nextRawTag = buildPatchedMJCFJointLimitTag(
    occurrence.rawTag,
    jointType,
    limit,
    resolveMJCFSourceAngleUnit(sourceContent),
  );
  return `${sourceContent.slice(0, occurrence.start)}${nextRawTag}${sourceContent.slice(occurrence.end)}`;
}

export function canPatchMJCFEditableSource(file: RobotFile | null | undefined): file is RobotFile {
  return Boolean(file && file.format === 'mjcf' && typeof file.content === 'string');
}
