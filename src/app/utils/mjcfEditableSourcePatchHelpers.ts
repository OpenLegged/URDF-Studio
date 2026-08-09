import {
  GeometryType,
  JointType,
  type UrdfInertial,
  type UrdfJoint,
  type UrdfVisual,
} from '@/types';
import {
  assignMJCFBodyGeomRoles,
  type MJCFGeomClassificationInput,
} from '@/core/parsers/mjcf/mjcfGeomClassification';
import {
  escapeXmlAttribute,
  escapeRegex,
  replaceOrRemoveXmlAttribute,
} from '@/core/utils/xmlSourceTextUtils';
import {
  formatScalar,
  formatVec3,
  formatColorRgba,
  formatCollisionGeomSize,
  formatEuler,
  formatEulerForAngleUnit,
  formatQuaternionWxyzFromRpy,
  formatMJCFInertiaDiagonal,
  formatMJCFFullInertia,
} from './mjcfSourceFormatters';

export interface MJCFRenameOperation {
  kind: 'link' | 'joint';
  currentName: string;
  nextName: string;
}

export interface AppendMJCFChildBodyOptions {
  sourceContent: string;
  parentBodyName: string;
  childBodyName: string;
  joint: Pick<UrdfJoint, 'name' | 'type' | 'origin' | 'axis' | 'limit'>;
}

export interface BodyInsertionPoint {
  openTagStart: number;
  openTagEnd: number;
  closeTagStart: number;
  closeTagEnd: number;
  selfClosing: boolean;
  rawOpenTag: string;
}

export interface NamedStartTagOccurrence {
  start: number;
  end: number;
  rawTag: string;
}

export interface GeomTagOccurrence {
  start: number;
  end: number;
  rawTag: string;
}

export interface AppendMJCFBodyCollisionGeomOptions {
  sourceContent: string;
  bodyName: string;
  geometry: Pick<
    UrdfVisual,
    'type' | 'dimensions' | 'color' | 'origin' | 'meshPath' | 'assetRef' | 'mjcfHfield'
  >;
}

export interface MJCFJointLimitSourcePatchOptions {
  sourceContent: string;
  jointName: string;
  jointType: UrdfJoint['type'];
  limit: NonNullable<UrdfJoint['limit']>;
}

export interface MJCFBodyInertialSourcePatchOptions {
  sourceContent: string;
  bodyName: string;
  inertial: UrdfInertial;
}

export type EditableCollisionGeom = Pick<
  UrdfVisual,
  'type' | 'dimensions' | 'color' | 'origin' | 'meshPath' | 'assetRef' | 'mjcfHfield'
>;

export const ANGLE_ATTR_RE = /\bangle\s*=\s*(["'])(.*?)\1/i;

export const NAME_ATTR_RE = /\bname\s*=\s*(["'])(.*?)\1/i;

export const XML_TAG_OR_COMMENT_RE = /<!--[\s\S]*?-->|<\s*(\/?)([A-Za-z_][\w:.-]*)\b[^>]*>/gi;

export const DEFAULT_INDENT_UNIT = '  ';

export const LOCKED_JOINT_RANGE_EPSILON = 1e-6;

export function getLineEnd(sourceContent: string, index: number): number {
  let cursor = index;
  while (cursor < sourceContent.length) {
    const current = sourceContent[cursor];
    if (current === '\r') {
      return cursor + 1 < sourceContent.length && sourceContent[cursor + 1] === '\n'
        ? cursor + 2
        : cursor + 1;
    }
    if (current === '\n') {
      return cursor + 1;
    }
    cursor += 1;
  }
  return cursor;
}

export function isZeroVec3(vector: { x: number; y: number; z: number }): boolean {
  return Math.abs(vector.x) < 1e-9 && Math.abs(vector.y) < 1e-9 && Math.abs(vector.z) < 1e-9;
}

export function isZeroRpy(rpy: { r: number; p: number; y: number }): boolean {
  return Math.abs(rpy.r) < 1e-9 && Math.abs(rpy.p) < 1e-9 && Math.abs(rpy.y) < 1e-9;
}

export function replaceOutsideXmlComments(
  sourceContent: string,
  replaceSegment: (segment: string) => string,
): string {
  return sourceContent
    .split(/(<!--[\s\S]*?-->)/g)
    .map((segment) => (segment.startsWith('<!--') ? segment : replaceSegment(segment)))
    .join('');
}

export function resolveMJCFJointType(type: JointType): 'hinge' | 'slide' | 'ball' | null {
  switch (type) {
    case JointType.REVOLUTE:
    case JointType.CONTINUOUS:
      return 'hinge';
    case JointType.PRISMATIC:
      return 'slide';
    case JointType.BALL:
      return 'ball';
    case JointType.FIXED:
      return null;
    default:
      return 'hinge';
  }
}

export function shouldEmitRange(type: JointType): boolean {
  return type !== JointType.CONTINUOUS && type !== JointType.BALL && type !== JointType.FIXED;
}

export function findBodyInsertionPoint(
  sourceContent: string,
  targetBodyName: string,
): BodyInsertionPoint | null {
  XML_TAG_OR_COMMENT_RE.lastIndex = 0;
  const stack: Array<{
    name: string | null;
    openTagStart: number;
    openTagEnd: number;
    selfClosing: boolean;
    rawOpenTag: string;
  }> = [];

  let match: RegExpExecArray | null;
  while ((match = XML_TAG_OR_COMMENT_RE.exec(sourceContent)) !== null) {
    const rawTag = match[0];
    if (rawTag.startsWith('<!--')) {
      continue;
    }
    const matchedTagName = match[2] ?? '';
    if (matchedTagName.toLowerCase() !== 'body') {
      continue;
    }

    const isClosing = match[1] === '/';
    if (isClosing) {
      const openTag = stack.pop();
      if (openTag?.name === targetBodyName) {
        return {
          openTagStart: openTag.openTagStart,
          openTagEnd: openTag.openTagEnd,
          closeTagStart: match.index,
          closeTagEnd: match.index + rawTag.length,
          selfClosing: false,
          rawOpenTag: openTag.rawOpenTag,
        };
      }
      continue;
    }

    const nameMatch = rawTag.match(NAME_ATTR_RE);
    const openTag = {
      name: nameMatch?.[2] ?? null,
      openTagStart: match.index,
      openTagEnd: match.index + rawTag.length,
      selfClosing: /\/\s*>$/.test(rawTag),
      rawOpenTag: rawTag,
    };

    if (openTag.selfClosing) {
      if (openTag.name === targetBodyName) {
        return {
          openTagStart: openTag.openTagStart,
          openTagEnd: openTag.openTagEnd,
          closeTagStart: openTag.openTagEnd,
          closeTagEnd: openTag.openTagEnd,
          selfClosing: true,
          rawOpenTag: openTag.rawOpenTag,
        };
      }
      continue;
    }

    stack.push(openTag);
  }

  return null;
}

export function findNamedStartTagOccurrence(
  sourceContent: string,
  tagName: string,
  targetName: string,
): NamedStartTagOccurrence | null {
  XML_TAG_OR_COMMENT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = XML_TAG_OR_COMMENT_RE.exec(sourceContent)) !== null) {
    const rawTag = match[0];
    if (rawTag.startsWith('<!--')) {
      continue;
    }
    const matchedTagName = match[2] ?? '';
    if (matchedTagName.toLowerCase() !== tagName.toLowerCase()) {
      continue;
    }
    if (match[1] === '/') {
      continue;
    }

    const nameMatch = rawTag.match(NAME_ATTR_RE);
    if (nameMatch?.[2] === targetName) {
      return {
        start: match.index,
        end: match.index + rawTag.length,
        rawTag,
      };
    }
  }

  return null;
}

export function findFirstStartTagOccurrence(
  sourceContent: string,
  tagName: string,
): NamedStartTagOccurrence | null {
  XML_TAG_OR_COMMENT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = XML_TAG_OR_COMMENT_RE.exec(sourceContent)) !== null) {
    const rawTag = match[0];
    if (rawTag.startsWith('<!--')) {
      continue;
    }
    const matchedTagName = match[2] ?? '';
    if (matchedTagName.toLowerCase() !== tagName.toLowerCase()) {
      continue;
    }
    if (match[1] === '/') {
      continue;
    }

    return {
      start: match.index,
      end: match.index + rawTag.length,
      rawTag,
    };
  }

  return null;
}

export function replaceNameAttribute(rawTag: string, nextName: string): string {
  if (!rawTag.match(NAME_ATTR_RE)) {
    throw new Error('Failed to locate name attribute in editable MJCF tag.');
  }

  return rawTag.replace(
    NAME_ATTR_RE,
    (_match, quote) => `name=${quote}${escapeXmlAttribute(nextName)}${quote}`,
  );
}

export function findNamedStartTagOccurrenceForTags(
  sourceContent: string,
  tagNames: string[],
  targetName: string,
): NamedStartTagOccurrence | null {
  for (const tagName of tagNames) {
    const occurrence = findNamedStartTagOccurrence(sourceContent, tagName, targetName);
    if (occurrence) {
      return occurrence;
    }
  }

  return null;
}

export function replaceAttributeValueOccurrences(
  sourceContent: string,
  attributeNames: string[],
  currentValue: string,
  nextValue: string,
): string {
  let nextSource = sourceContent;
  const escapedCurrentValue = escapeRegex(currentValue);

  for (const attributeName of attributeNames) {
    const attributeRe = new RegExp(
      `(\\b${escapeRegex(attributeName)}\\s*=\\s*)(["'])${escapedCurrentValue}\\2`,
      'g',
    );
    nextSource = replaceOutsideXmlComments(nextSource, (segment) =>
      segment.replace(attributeRe, (_match, prefix: string, quote: string) => {
        return `${prefix}${quote}${nextValue}${quote}`;
      }),
    );
  }

  return nextSource;
}

export function replaceNamedTagOccurrences(
  sourceContent: string,
  tagNames: string[],
  currentName: string,
  nextName: string,
): string {
  let nextSource = sourceContent;
  const escapedCurrentName = escapeRegex(currentName);

  for (const tagName of tagNames) {
    const tagRe = new RegExp(
      `(<\\s*${escapeRegex(tagName)}\\b[^>]*\\bname\\s*=\\s*)(["'])${escapedCurrentName}\\2`,
      'g',
    );
    nextSource = replaceOutsideXmlComments(nextSource, (segment) =>
      segment.replace(tagRe, (_match, prefix: string, quote: string) => {
        return `${prefix}${quote}${nextName}${quote}`;
      }),
    );
  }

  return nextSource;
}

export function buildRenamePlaceholder(sourceContent: string, index: number): string {
  let candidate = `__CODEX_MJCF_RENAME_${index}__`;
  while (sourceContent.includes(candidate)) {
    candidate = `_${candidate}_`;
  }
  return candidate;
}

export function parseXmlAttributes(rawTag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const attrRe = /([A-Za-z_][\w:.-]*)\s*=\s*(["'])(.*?)\2/g;
  let match: RegExpExecArray | null;

  while ((match = attrRe.exec(rawTag)) !== null) {
    attributes[match[1]] = match[3];
  }

  return attributes;
}

export function parseOptionalNumber(value: string | undefined): number | undefined {
  if (value == null) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseGeomClassificationInput(rawTag: string): MJCFGeomClassificationInput {
  const attributes = parseXmlAttributes(rawTag);
  return {
    name: attributes.name,
    className: attributes.class,
    classQName: attributes.class,
    group: parseOptionalNumber(attributes.group),
    contype: parseOptionalNumber(attributes.contype),
    conaffinity: parseOptionalNumber(attributes.conaffinity),
  };
}

export function findDirectBodyGeomOccurrences(
  sourceContent: string,
  bodyName: string,
): GeomTagOccurrence[] {
  const bodyPoint = findBodyInsertionPoint(sourceContent, bodyName);
  if (!bodyPoint) {
    throw new Error(`Failed to locate MJCF <body name="${bodyName}"> in editable source.`);
  }

  if (bodyPoint.selfClosing) {
    return [];
  }

  const tokenRe = /<\s*(\/?)\s*(body|geom)\b[^>]*?(\/?)>/gi;
  tokenRe.lastIndex = bodyPoint.openTagEnd;

  const occurrences: GeomTagOccurrence[] = [];
  let nestedBodyDepth = 0;
  let pendingGeomStart: number | null = null;

  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(sourceContent)) !== null && match.index < bodyPoint.closeTagStart) {
    const rawTag = match[0];
    const tagName = match[2].toLowerCase();
    const isClosing = match[1] === '/';
    const selfClosing = match[3] === '/' || /\/\s*>$/.test(rawTag);
    const tagStart = match.index;
    const tagEnd = tagStart + rawTag.length;

    if (tagName === 'body') {
      if (isClosing) {
        nestedBodyDepth = Math.max(0, nestedBodyDepth - 1);
      } else if (!selfClosing) {
        nestedBodyDepth += 1;
      }
      continue;
    }

    if (nestedBodyDepth !== 0) {
      continue;
    }

    if (isClosing) {
      if (pendingGeomStart !== null) {
        occurrences.push({
          start: pendingGeomStart,
          end: tagEnd,
          rawTag: sourceContent.slice(pendingGeomStart, tagEnd),
        });
        pendingGeomStart = null;
      }
      continue;
    }

    if (selfClosing) {
      occurrences.push({
        start: tagStart,
        end: tagEnd,
        rawTag,
      });
      continue;
    }

    pendingGeomStart = tagStart;
  }

  if (pendingGeomStart !== null) {
    throw new Error(
      `Failed to resolve closing MJCF <geom> while inspecting <body name="${bodyName}">.`,
    );
  }

  return occurrences;
}

export function findDirectBodyInertialOccurrence(
  sourceContent: string,
  bodyName: string,
): GeomTagOccurrence | null {
  const bodyPoint = findBodyInsertionPoint(sourceContent, bodyName);
  if (!bodyPoint) {
    throw new Error(`Failed to locate MJCF <body name="${bodyName}"> in editable source.`);
  }

  if (bodyPoint.selfClosing) {
    return null;
  }

  const tokenRe = /<\s*(\/?)\s*(body|inertial)\b[^>]*?(\/?)>/gi;
  tokenRe.lastIndex = bodyPoint.openTagEnd;

  let nestedBodyDepth = 0;
  let pendingInertialStart: number | null = null;

  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(sourceContent)) !== null && match.index < bodyPoint.closeTagStart) {
    const rawTag = match[0];
    const tagName = match[2].toLowerCase();
    const isClosing = match[1] === '/';
    const selfClosing = match[3] === '/' || /\/\s*>$/.test(rawTag);
    const tagStart = match.index;
    const tagEnd = tagStart + rawTag.length;

    if (tagName === 'body') {
      if (isClosing) {
        nestedBodyDepth = Math.max(0, nestedBodyDepth - 1);
      } else if (!selfClosing) {
        nestedBodyDepth += 1;
      }
      continue;
    }

    if (nestedBodyDepth !== 0) {
      continue;
    }

    if (isClosing) {
      if (pendingInertialStart !== null) {
        return {
          start: pendingInertialStart,
          end: tagEnd,
          rawTag: sourceContent.slice(pendingInertialStart, tagEnd),
        };
      }
      continue;
    }

    if (selfClosing) {
      return {
        start: tagStart,
        end: tagEnd,
        rawTag,
      };
    }

    pendingInertialStart = tagStart;
  }

  if (pendingInertialStart !== null) {
    throw new Error(
      `Failed to resolve closing MJCF <inertial> while inspecting <body name="${bodyName}">.`,
    );
  }

  return null;
}

export function buildManagedInertialAttributeEntries(
  inertial: UrdfInertial,
  options: {
    angleUnit: 'radian' | 'degree';
    existingAttributes: Record<string, string>;
  },
): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  const origin = inertial.origin;

  entries.push(['mass', formatScalar(inertial.mass) ?? '0']);

  if (origin?.xyz) {
    entries.push(['pos', formatVec3(origin.xyz)]);
  }

  if (origin?.rpy) {
    if (
      Object.prototype.hasOwnProperty.call(options.existingAttributes, 'euler') &&
      !Object.prototype.hasOwnProperty.call(options.existingAttributes, 'quat')
    ) {
      entries.push(['euler', formatEulerForAngleUnit(origin.rpy, options.angleUnit)]);
    } else {
      entries.push(['quat', formatQuaternionWxyzFromRpy(origin.rpy)]);
    }
  }

  if (Object.prototype.hasOwnProperty.call(options.existingAttributes, 'fullinertia')) {
    entries.push(['fullinertia', formatMJCFFullInertia(inertial)]);
  } else {
    entries.push(['diaginertia', formatMJCFInertiaDiagonal(inertial)]);
  }

  return entries;
}

export function updateInertialRawTag(
  rawTag: string,
  inertial: UrdfInertial,
  angleUnit: 'radian' | 'degree',
): string {
  const existingAttributes = parseXmlAttributes(rawTag);
  const managedAttributeNames = new Set([
    'mass',
    'pos',
    'quat',
    'euler',
    'axisangle',
    'xyaxes',
    'zaxis',
    'diaginertia',
    'fullinertia',
  ]);

  const nextAttributes = new Map<string, string>();
  Object.entries(existingAttributes).forEach(([name, value]) => {
    if (managedAttributeNames.has(name)) {
      return;
    }
    nextAttributes.set(name, value);
  });

  buildManagedInertialAttributeEntries(inertial, { angleUnit, existingAttributes }).forEach(
    ([name, value]) => {
      nextAttributes.set(name, value);
    },
  );

  const serializedAttributes = Array.from(nextAttributes.entries())
    .map(([name, value]) => `${name}="${escapeXmlAttribute(value)}"`)
    .join(' ');

  return serializedAttributes ? `<inertial ${serializedAttributes} />` : '<inertial />';
}

export function buildManagedCollisionGeomAttributeEntries(
  geometry: EditableCollisionGeom,
  options: { includeCollisionDefaults: boolean },
): Array<[string, string]> {
  if (geometry.type === GeometryType.NONE) {
    throw new Error('Failed to patch MJCF collision geom: geometry type is none.');
  }

  const entries: Array<[string, string]> = [];

  if (!isZeroVec3(geometry.origin.xyz)) {
    entries.push(['pos', formatVec3(geometry.origin.xyz)]);
  }
  if (!isZeroRpy(geometry.origin.rpy)) {
    entries.push(['euler', formatEuler(geometry.origin.rpy)]);
  }

  entries.push(['rgba', formatColorRgba(geometry.color)]);

  if (options.includeCollisionDefaults) {
    entries.push(['group', '3'], ['contype', '1'], ['conaffinity', '1']);
  }

  switch (geometry.type) {
    case GeometryType.BOX:
      entries.push(['type', 'box'], ['size', formatCollisionGeomSize(geometry)]);
      break;
    case GeometryType.PLANE:
      entries.push(['type', 'plane'], ['size', formatCollisionGeomSize(geometry)]);
      break;
    case GeometryType.CYLINDER:
      entries.push(['type', 'cylinder'], ['size', formatCollisionGeomSize(geometry)]);
      break;
    case GeometryType.SPHERE:
      entries.push(['type', 'sphere'], ['size', formatCollisionGeomSize(geometry)]);
      break;
    case GeometryType.ELLIPSOID:
      entries.push(['type', 'ellipsoid'], ['size', formatCollisionGeomSize(geometry)]);
      break;
    case GeometryType.CAPSULE:
      entries.push(['type', 'capsule'], ['size', formatCollisionGeomSize(geometry)]);
      break;
    case GeometryType.HFIELD: {
      const hfieldRef = geometry.assetRef ?? geometry.mjcfHfield?.name;
      if (!hfieldRef) {
        throw new Error('Failed to patch MJCF collision geom: hfield asset reference is missing.');
      }
      entries.push(['type', 'hfield'], ['hfield', hfieldRef]);
      break;
    }
    case GeometryType.SDF: {
      const sdfMeshRef = geometry.assetRef ?? geometry.meshPath;
      if (!sdfMeshRef) {
        throw new Error('Failed to patch MJCF collision geom: sdf mesh reference is missing.');
      }
      entries.push(['type', 'sdf'], ['mesh', sdfMeshRef]);
      break;
    }
    case GeometryType.MESH: {
      const meshRef = geometry.assetRef ?? geometry.meshPath;
      if (!meshRef) {
        throw new Error('Failed to patch MJCF collision geom: mesh reference is missing.');
      }
      entries.push(['type', 'mesh'], ['mesh', meshRef]);
      break;
    }
    default:
      throw new Error(
        `Failed to patch MJCF collision geom: unsupported geometry type "${geometry.type}".`,
      );
  }

  return entries;
}

export function buildCollisionGeomSnippet(
  geometry: EditableCollisionGeom,
  indentation: {
    newline: string;
    geomIndent: string;
  },
): string {
  const attrs = buildManagedCollisionGeomAttributeEntries(geometry, {
    includeCollisionDefaults: true,
  }).map(([name, value]) => `${name}="${escapeXmlAttribute(value)}"`);

  return `${indentation.geomIndent}<geom ${attrs.join(' ')} />${indentation.newline}`;
}

export function updateCollisionGeomRawTag(rawTag: string, geometry: EditableCollisionGeom): string {
  const existingAttributes = parseXmlAttributes(rawTag);
  const managedAttributeNames = new Set([
    'pos',
    'quat',
    'euler',
    'axisangle',
    'xyaxes',
    'zaxis',
    'fromto',
    'rgba',
    'type',
    'size',
    'mesh',
    'hfield',
  ]);

  const nextAttributes = new Map<string, string>();
  Object.entries(existingAttributes).forEach(([name, value]) => {
    if (managedAttributeNames.has(name)) {
      return;
    }
    nextAttributes.set(name, value);
  });

  buildManagedCollisionGeomAttributeEntries(geometry, { includeCollisionDefaults: false }).forEach(
    ([name, value]) => {
      nextAttributes.set(name, value);
    },
  );

  const serializedAttributes = Array.from(nextAttributes.entries())
    .map(([name, value]) => `${name}="${escapeXmlAttribute(value)}"`)
    .join(' ');

  return serializedAttributes ? `<geom ${serializedAttributes} />` : '<geom />';
}

export function findCollisionGeomOccurrenceByObjectIndex(
  sourceContent: string,
  bodyName: string,
  objectIndex: number,
): { occurrence: GeomTagOccurrence; renderVisual: boolean } | null {
  const geomOccurrences = findDirectBodyGeomOccurrences(sourceContent, bodyName);
  const geomRoles = assignMJCFBodyGeomRoles(
    geomOccurrences.map((occurrence) => parseGeomClassificationInput(occurrence.rawTag)),
  );

  const collisionOccurrences = geomRoles
    .map((role, index) => ({ role, occurrence: geomOccurrences[index] }))
    .filter(({ role }) => role.renderCollision);

  if (objectIndex < 0 || objectIndex >= collisionOccurrences.length) {
    return null;
  }

  const target = collisionOccurrences[objectIndex];
  return {
    occurrence: target.occurrence,
    renderVisual: target.role.renderVisual,
  };
}

export function renameMJCFEntityWithPlaceholder(
  sourceContent: string,
  operation: MJCFRenameOperation,
  placeholder: string,
): string {
  if (operation.kind === 'link') {
    return replaceAttributeValueOccurrences(
      replaceNamedTagOccurrences(sourceContent, ['body'], operation.currentName, placeholder),
      ['body', 'body1', 'body2'],
      operation.currentName,
      placeholder,
    );
  }

  return replaceAttributeValueOccurrences(
    replaceNamedTagOccurrences(
      sourceContent,
      ['joint', 'freejoint'],
      operation.currentName,
      placeholder,
    ),
    ['joint', 'joint1', 'joint2'],
    operation.currentName,
    placeholder,
  );
}

export function detectIndentUnit(
  sourceContent: string,
  parentOpenTagEnd: number,
  parentCloseTagStart: number,
  parentIndent: string,
): string {
  const bodyInterior = sourceContent.slice(parentOpenTagEnd, parentCloseTagStart);
  const lines = bodyInterior.split(/\r?\n/);

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    const leading = line.match(/^[ \t]*/)?.[0] ?? '';
    if (leading.startsWith(parentIndent) && leading.length > parentIndent.length) {
      return leading.slice(parentIndent.length);
    }
  }

  return DEFAULT_INDENT_UNIT;
}

export function buildChildBodySnippet(
  options: Omit<AppendMJCFChildBodyOptions, 'sourceContent' | 'parentBodyName'>,
  indentation: {
    newline: string;
    childIndent: string;
    childContentIndent: string;
  },
): string {
  const { childBodyName, joint } = options;
  const { newline, childIndent, childContentIndent } = indentation;

  const bodyAttrs = [`name="${escapeXmlAttribute(childBodyName)}"`];
  if (!isZeroVec3(joint.origin.xyz)) {
    bodyAttrs.push(`pos="${formatVec3(joint.origin.xyz)}"`);
  }
  if (!isZeroRpy(joint.origin.rpy)) {
    bodyAttrs.push(
      `euler="${[
        formatScalar(joint.origin.rpy.r) ?? '0',
        formatScalar(joint.origin.rpy.p) ?? '0',
        formatScalar(joint.origin.rpy.y) ?? '0',
      ].join(' ')}"`,
    );
  }

  const jointType = resolveMJCFJointType(joint.type);
  const lines = [`${childIndent}<body ${bodyAttrs.join(' ')}>`];

  if (jointType) {
    const jointAttrs = [`name="${escapeXmlAttribute(joint.name)}"`, `type="${jointType}"`];

    if (jointType !== 'ball') {
      jointAttrs.push(`axis="${formatVec3(joint.axis ?? { x: 0, y: 0, z: 1 })}"`);
    }

    if (shouldEmitRange(joint.type) && joint.limit) {
      const lower = formatScalar(joint.limit.lower);
      const upper = formatScalar(joint.limit.upper);
      if (lower !== null && upper !== null) {
        jointAttrs.push(`range="${lower} ${upper}"`);
      }
    }

    lines.push(`${childContentIndent}<joint ${jointAttrs.join(' ')} />`);
  }

  lines.push(`${childIndent}</body>`);
  return `${lines.join(newline)}${newline}`;
}

export function resolveMJCFSourceAngleUnit(sourceContent: string): 'radian' | 'degree' {
  let angleUnit: 'radian' | 'degree' = 'degree';
  XML_TAG_OR_COMMENT_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = XML_TAG_OR_COMMENT_RE.exec(sourceContent)) !== null) {
    const rawTag = match[0];
    if (rawTag.startsWith('<!--')) {
      continue;
    }
    const matchedTagName = match[2] ?? '';
    if (matchedTagName.toLowerCase() !== 'compiler') {
      continue;
    }

    const rawAngle = rawTag.match(ANGLE_ATTR_RE)?.[2]?.trim().toLowerCase();
    if (rawAngle) {
      angleUnit = rawAngle === 'degree' ? 'degree' : 'radian';
    }
  }

  return angleUnit;
}

export function formatMJCFJointRangeValue(
  value: number,
  jointType: UrdfJoint['type'],
  angleUnit: 'radian' | 'degree',
): number {
  if (jointType === JointType.PRISMATIC || angleUnit === 'radian') {
    return value;
  }

  return (value * 180) / Math.PI;
}

export function getMujocoJointRange(
  limit: NonNullable<UrdfJoint['limit']>,
  jointType: UrdfJoint['type'],
  angleUnit: 'radian' | 'degree',
): [number, number] | null {
  const lower = Number(limit.lower);
  const upper = Number(limit.upper);
  if (!Number.isFinite(lower) || !Number.isFinite(upper)) {
    return null;
  }

  if (upper > lower) {
    return [
      formatMJCFJointRangeValue(lower, jointType, angleUnit),
      formatMJCFJointRangeValue(upper, jointType, angleUnit),
    ];
  }

  if (Math.abs(upper - lower) <= LOCKED_JOINT_RANGE_EPSILON) {
    const halfEpsilon = LOCKED_JOINT_RANGE_EPSILON / 2;
    return [
      formatMJCFJointRangeValue(lower - halfEpsilon, jointType, angleUnit),
      formatMJCFJointRangeValue(upper + halfEpsilon, jointType, angleUnit),
    ];
  }

  return [
    formatMJCFJointRangeValue(lower, jointType, angleUnit),
    formatMJCFJointRangeValue(upper, jointType, angleUnit),
  ];
}

export function buildPatchedMJCFJointLimitTag(
  rawTag: string,
  jointType: UrdfJoint['type'],
  limit: NonNullable<UrdfJoint['limit']>,
  angleUnit: 'radian' | 'degree',
): string {
  if (!shouldEmitRange(jointType)) {
    return replaceOrRemoveXmlAttribute(
      replaceOrRemoveXmlAttribute(rawTag, 'range', null),
      'limited',
      null,
    );
  }

  const range = getMujocoJointRange(limit, jointType, angleUnit);
  if (!range) {
    return replaceOrRemoveXmlAttribute(
      replaceOrRemoveXmlAttribute(rawTag, 'range', null),
      'limited',
      null,
    );
  }
  const [lower, upper] = range;
  return replaceOrRemoveXmlAttribute(
    replaceOrRemoveXmlAttribute(rawTag, 'limited', 'true'),
    'range',
    `${formatScalar(lower) ?? '0'} ${formatScalar(upper) ?? '0'}`,
  );
}
