import { GeometryType, JointType, type RobotFile, type UrdfInertial, type UrdfJoint, type UrdfVisual } from '@/types';
import { assignMJCFBodyGeomRoles, type MJCFGeomClassificationInput } from '@/core/parsers/mjcf/mjcfGeomClassification';

interface AppendMJCFChildBodyOptions {
  sourceContent: string;
  parentBodyName: string;
  childBodyName: string;
  joint: Pick<UrdfJoint, 'name' | 'type' | 'origin' | 'axis' | 'limit'>;
}

interface BodyInsertionPoint {
  openTagStart: number;
  openTagEnd: number;
  closeTagStart: number;
  closeTagEnd: number;
  selfClosing: boolean;
  rawOpenTag: string;
}

interface NamedStartTagOccurrence {
  start: number;
  end: number;
  rawTag: string;
}

interface GeomTagOccurrence {
  start: number;
  end: number;
  rawTag: string;
}

interface AppendMJCFBodyCollisionGeomOptions {
  sourceContent: string;
  bodyName: string;
  geometry: Pick<UrdfVisual, 'type' | 'dimensions' | 'color' | 'origin' | 'meshPath' | 'assetRef' | 'mjcfHfield'>;
}

interface MJCFJointLimitSourcePatchOptions {
  sourceContent: string;
  jointName: string;
  jointType: UrdfJoint['type'];
  limit: NonNullable<UrdfJoint['limit']>;
}

interface MJCFBodyInertialSourcePatchOptions {
  sourceContent: string;
  bodyName: string;
  inertial: UrdfInertial;
}

type EditableCollisionGeom = Pick<UrdfVisual, 'type' | 'dimensions' | 'color' | 'origin' | 'meshPath' | 'assetRef' | 'mjcfHfield'>;

export interface MJCFRenameOperation {
  kind: 'link' | 'joint';
  currentName: string;
  nextName: string;
}

const ANGLE_ATTR_RE = /\bangle\s*=\s*(["'])(.*?)\1/i;
const NAME_ATTR_RE = /\bname\s*=\s*(["'])(.*?)\1/i;
const XML_TAG_OR_COMMENT_RE = /<!--[\s\S]*?-->|<\s*(\/?)([A-Za-z_][\w:.-]*)\b[^>]*>/gi;
const DEFAULT_INDENT_UNIT = '  ';
const DEFAULT_COLLISION_RGBA = '0.937255 0.266667 0.266667 1';
const LOCKED_JOINT_RANGE_EPSILON = 1e-6;

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function getPreferredNewline(sourceContent: string): string {
  return sourceContent.includes('\r\n') ? '\r\n' : '\n';
}

function getLineStart(sourceContent: string, index: number): number {
  let cursor = index;
  while (cursor > 0) {
    const previous = sourceContent[cursor - 1];
    if (previous === '\n' || previous === '\r') {
      break;
    }
    cursor -= 1;
  }
  return cursor;
}

function getIndentAt(sourceContent: string, index: number): string {
  const lineStart = getLineStart(sourceContent, index);
  const leading = sourceContent.slice(lineStart, index).match(/^[ \t]*/);
  return leading?.[0] ?? '';
}

function getLineEnd(sourceContent: string, index: number): number {
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

function formatScalar(value: number | undefined): string | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }

  const normalized = Math.abs(value) < 1e-9 ? 0 : Number(value.toFixed(6));
  return `${normalized}`;
}

function formatVec3(vector: { x: number; y: number; z: number }): string {
  return [vector.x, vector.y, vector.z]
    .map((value) => formatScalar(value) ?? '0')
    .join(' ');
}

function isZeroVec3(vector: { x: number; y: number; z: number }): boolean {
  return Math.abs(vector.x) < 1e-9
    && Math.abs(vector.y) < 1e-9
    && Math.abs(vector.z) < 1e-9;
}

function isZeroRpy(rpy: { r: number; p: number; y: number }): boolean {
  return Math.abs(rpy.r) < 1e-9
    && Math.abs(rpy.p) < 1e-9
    && Math.abs(rpy.y) < 1e-9;
}

function replaceOutsideXmlComments(
  sourceContent: string,
  replaceSegment: (segment: string) => string,
): string {
  return sourceContent
    .split(/(<!--[\s\S]*?-->)/g)
    .map((segment) => (segment.startsWith('<!--') ? segment : replaceSegment(segment)))
    .join('');
}

function resolveMJCFJointType(type: JointType): 'hinge' | 'slide' | 'ball' | null {
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

function shouldEmitRange(type: JointType): boolean {
  return type !== JointType.CONTINUOUS
    && type !== JointType.BALL
    && type !== JointType.FIXED;
}

function findBodyInsertionPoint(sourceContent: string, targetBodyName: string): BodyInsertionPoint | null {
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

function findNamedStartTagOccurrence(
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

function findFirstStartTagOccurrence(
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

function replaceNameAttribute(rawTag: string, nextName: string): string {
  if (!rawTag.match(NAME_ATTR_RE)) {
    throw new Error('Failed to locate name attribute in editable MJCF tag.');
  }

  return rawTag.replace(NAME_ATTR_RE, (_match, quote) => `name=${quote}${escapeXmlAttribute(nextName)}${quote}`);
}

function replaceOrRemoveXmlAttribute(
  rawTag: string,
  attributeName: string,
  nextValue: string | null,
): string {
  const attrRe = new RegExp(`\\s+${escapeRegex(attributeName)}\\s*=\\s*(["']).*?\\1`, 'i');
  if (nextValue == null) {
    return rawTag.replace(attrRe, '');
  }

  if (attrRe.test(rawTag)) {
    return rawTag.replace(
      new RegExp(`(\\s+${escapeRegex(attributeName)}\\s*=\\s*)(["']).*?\\2`, 'i'),
      (_match, prefix: string, quote: string) =>
        `${prefix}${quote}${escapeXmlAttribute(nextValue)}${quote}`,
    );
  }

  return rawTag.replace(/(\s*\/?>)$/, ` ${attributeName}="${escapeXmlAttribute(nextValue)}"$1`);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findNamedStartTagOccurrenceForTags(
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

function replaceAttributeValueOccurrences(
  sourceContent: string,
  attributeNames: string[],
  currentValue: string,
  nextValue: string,
): string {
  let nextSource = sourceContent;
  const escapedCurrentValue = escapeRegex(currentValue);

  for (const attributeName of attributeNames) {
    const attributeRe = new RegExp(`(\\b${escapeRegex(attributeName)}\\s*=\\s*)(["'])${escapedCurrentValue}\\2`, 'g');
    nextSource = replaceOutsideXmlComments(nextSource, (segment) =>
      segment.replace(attributeRe, (_match, prefix: string, quote: string) => {
        return `${prefix}${quote}${nextValue}${quote}`;
      }),
    );
  }

  return nextSource;
}

function replaceNamedTagOccurrences(
  sourceContent: string,
  tagNames: string[],
  currentName: string,
  nextName: string,
): string {
  let nextSource = sourceContent;
  const escapedCurrentName = escapeRegex(currentName);

  for (const tagName of tagNames) {
    const tagRe = new RegExp(`(<\\s*${escapeRegex(tagName)}\\b[^>]*\\bname\\s*=\\s*)(["'])${escapedCurrentName}\\2`, 'g');
    nextSource = replaceOutsideXmlComments(nextSource, (segment) =>
      segment.replace(tagRe, (_match, prefix: string, quote: string) => {
        return `${prefix}${quote}${nextName}${quote}`;
      }),
    );
  }

  return nextSource;
}

function buildRenamePlaceholder(sourceContent: string, index: number): string {
  let candidate = `__CODEX_MJCF_RENAME_${index}__`;
  while (sourceContent.includes(candidate)) {
    candidate = `_${candidate}_`;
  }
  return candidate;
}

function parseXmlAttributes(rawTag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const attrRe = /([A-Za-z_][\w:.-]*)\s*=\s*(["'])(.*?)\2/g;
  let match: RegExpExecArray | null;

  while ((match = attrRe.exec(rawTag)) !== null) {
    attributes[match[1]] = match[3];
  }

  return attributes;
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (value == null) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseGeomClassificationInput(rawTag: string): MJCFGeomClassificationInput {
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

function findDirectBodyGeomOccurrences(sourceContent: string, bodyName: string): GeomTagOccurrence[] {
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
    throw new Error(`Failed to resolve closing MJCF <geom> while inspecting <body name="${bodyName}">.`);
  }

  return occurrences;
}

function findDirectBodyInertialOccurrence(sourceContent: string, bodyName: string): GeomTagOccurrence | null {
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
    throw new Error(`Failed to resolve closing MJCF <inertial> while inspecting <body name="${bodyName}">.`);
  }

  return null;
}

function normalizeHexColor(color: string | undefined): string | null {
  if (!color) {
    return null;
  }

  const normalized = color.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(normalized) || /^[0-9a-fA-F]{4}$/.test(normalized)) {
    return normalized
      .split('')
      .map((char) => `${char}${char}`)
      .join('');
  }

  if (/^[0-9a-fA-F]{6}$/.test(normalized) || /^[0-9a-fA-F]{8}$/.test(normalized)) {
    return normalized;
  }

  return null;
}

function formatColorRgba(color: string | undefined): string {
  const normalized = normalizeHexColor(color);
  if (!normalized) {
    return DEFAULT_COLLISION_RGBA;
  }

  const channels = normalized.match(/.{2}/g);
  if (!channels || (channels.length !== 3 && channels.length !== 4)) {
    return DEFAULT_COLLISION_RGBA;
  }

  const [r, g, b, a = 255] = channels.map((value) => Number.parseInt(value, 16));
  return [r, g, b, a]
    .map((value, index) => {
      const normalizedChannel = Math.max(0, Math.min(255, value)) / 255;
      const rounded = Number(normalizedChannel.toFixed(6));
      return index === 3 ? `${rounded}` : `${rounded}`;
    })
    .join(' ');
}

function formatCollisionGeomSize(geometry: Pick<UrdfVisual, 'type' | 'dimensions'>): string {
  switch (geometry.type) {
    case GeometryType.BOX:
      return `${formatScalar(geometry.dimensions.x / 2) ?? '0'} ${formatScalar(geometry.dimensions.y / 2) ?? '0'} ${formatScalar(geometry.dimensions.z / 2) ?? '0'}`;
    case GeometryType.PLANE:
      return `${formatScalar(geometry.dimensions.x / 2) ?? '0'} ${formatScalar(geometry.dimensions.y / 2) ?? '0'} 0.1`;
    case GeometryType.CYLINDER:
    case GeometryType.CAPSULE:
      return `${formatScalar(geometry.dimensions.x) ?? '0'} ${formatScalar(geometry.dimensions.y / 2) ?? '0'}`;
    case GeometryType.SPHERE:
      return `${formatScalar(geometry.dimensions.x) ?? '0'}`;
    case GeometryType.ELLIPSOID:
      return `${formatScalar(geometry.dimensions.x) ?? '0'} ${formatScalar(geometry.dimensions.y) ?? '0'} ${formatScalar(geometry.dimensions.z) ?? '0'}`;
    default:
      return '';
  }
}

function formatEuler(rpy: { r: number; p: number; y: number }): string {
  return [
    formatScalar(rpy.r) ?? '0',
    formatScalar(rpy.p) ?? '0',
    formatScalar(rpy.y) ?? '0',
  ].join(' ');
}

function formatEulerForAngleUnit(
  rpy: { r: number; p: number; y: number },
  angleUnit: 'radian' | 'degree',
): string {
  if (angleUnit === 'radian') {
    return formatEuler(rpy);
  }

  return [
    formatScalar(rpy.r * 180 / Math.PI) ?? '0',
    formatScalar(rpy.p * 180 / Math.PI) ?? '0',
    formatScalar(rpy.y * 180 / Math.PI) ?? '0',
  ].join(' ');
}

function formatQuaternionWxyzFromRpy(rpy: { r: number; p: number; y: number }): string {
  const cr = Math.cos(rpy.r / 2);
  const sr = Math.sin(rpy.r / 2);
  const cp = Math.cos(rpy.p / 2);
  const sp = Math.sin(rpy.p / 2);
  const cy = Math.cos(rpy.y / 2);
  const sy = Math.sin(rpy.y / 2);

  const w = cr * cp * cy + sr * sp * sy;
  const x = sr * cp * cy - cr * sp * sy;
  const y = cr * sp * cy + sr * cp * sy;
  const z = cr * cp * sy - sr * sp * cy;

  return [w, x, y, z]
    .map((value) => formatScalar(value) ?? '0')
    .join(' ');
}

function formatMJCFInertiaDiagonal(inertial: UrdfInertial): string {
  return [
    inertial.inertia.ixx,
    inertial.inertia.iyy,
    inertial.inertia.izz,
  ].map((value) => formatScalar(value) ?? '0').join(' ');
}

function formatMJCFFullInertia(inertial: UrdfInertial): string {
  return [
    inertial.inertia.ixx,
    inertial.inertia.iyy,
    inertial.inertia.izz,
    inertial.inertia.ixy,
    inertial.inertia.ixz,
    inertial.inertia.iyz,
  ].map((value) => formatScalar(value) ?? '0').join(' ');
}

function buildManagedInertialAttributeEntries(
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
    if (Object.prototype.hasOwnProperty.call(options.existingAttributes, 'euler') &&
        !Object.prototype.hasOwnProperty.call(options.existingAttributes, 'quat')) {
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

function updateInertialRawTag(
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

  buildManagedInertialAttributeEntries(inertial, { angleUnit, existingAttributes })
    .forEach(([name, value]) => {
      nextAttributes.set(name, value);
    });

  const serializedAttributes = Array.from(nextAttributes.entries())
    .map(([name, value]) => `${name}="${escapeXmlAttribute(value)}"`)
    .join(' ');

  return serializedAttributes
    ? `<inertial ${serializedAttributes} />`
    : '<inertial />';
}

function buildManagedCollisionGeomAttributeEntries(
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
    entries.push(
      ['group', '3'],
      ['contype', '1'],
      ['conaffinity', '1'],
    );
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
      throw new Error(`Failed to patch MJCF collision geom: unsupported geometry type "${geometry.type}".`);
  }

  return entries;
}

function buildCollisionGeomSnippet(
  geometry: EditableCollisionGeom,
  indentation: {
    newline: string;
    geomIndent: string;
  },
): string {
  const attrs = buildManagedCollisionGeomAttributeEntries(geometry, { includeCollisionDefaults: true })
    .map(([name, value]) => `${name}="${escapeXmlAttribute(value)}"`);

  return `${indentation.geomIndent}<geom ${attrs.join(' ')} />${indentation.newline}`;
}

function updateCollisionGeomRawTag(rawTag: string, geometry: EditableCollisionGeom): string {
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

  buildManagedCollisionGeomAttributeEntries(geometry, { includeCollisionDefaults: false })
    .forEach(([name, value]) => {
      nextAttributes.set(name, value);
    });

  const serializedAttributes = Array.from(nextAttributes.entries())
    .map(([name, value]) => `${name}="${escapeXmlAttribute(value)}"`)
    .join(' ');

  return serializedAttributes
    ? `<geom ${serializedAttributes} />`
    : '<geom />';
}

function findCollisionGeomOccurrenceByObjectIndex(
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

function renameMJCFEntityWithPlaceholder(
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
    replaceNamedTagOccurrences(sourceContent, ['joint', 'freejoint'], operation.currentName, placeholder),
    ['joint', 'joint1', 'joint2'],
    operation.currentName,
    placeholder,
  );
}

function detectIndentUnit(
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

function buildChildBodySnippet(
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
    const jointAttrs = [
      `name="${escapeXmlAttribute(joint.name)}"`,
      `type="${jointType}"`,
    ];

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

function resolveMJCFSourceAngleUnit(sourceContent: string): 'radian' | 'degree' {
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

function formatMJCFJointRangeValue(
  value: number,
  jointType: UrdfJoint['type'],
  angleUnit: 'radian' | 'degree',
): number {
  if (jointType === JointType.PRISMATIC || angleUnit === 'radian') {
    return value;
  }

  return value * 180 / Math.PI;
}

function getMujocoJointRange(
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

function buildPatchedMJCFJointLimitTag(
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
    : detectIndentUnit(sourceContent, insertionPoint.openTagEnd, insertionPoint.closeTagStart, parentIndent);
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
    : detectIndentUnit(sourceContent, insertionPoint.openTagEnd, insertionPoint.closeTagStart, parentIndent);
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
    : detectIndentUnit(sourceContent, insertionPoint.openTagEnd, insertionPoint.closeTagStart, parentIndent);
  const inertialIndent = `${parentIndent}${indentUnit}`;
  const inertialSnippet =
    `${inertialIndent}${updateInertialRawTag('<inertial />', inertial, angleUnit)}${newline}`;

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
    throw new Error(`Failed to locate MJCF collision geom #${objectIndex} in <body name="${bodyName}">.`);
  }

  if (target.renderVisual) {
    throw new Error(`Cannot safely remove shared visual/collision MJCF geom #${objectIndex} from <body name="${bodyName}">.`);
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
    throw new Error(`Failed to locate MJCF collision geom #${objectIndex} in <body name="${bodyName}">.`);
  }

  if (target.renderVisual) {
    throw new Error(`Cannot safely update shared visual/collision MJCF geom #${objectIndex} in <body name="${bodyName}">.`);
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
    .filter((operation) => operation.currentName && operation.nextName && operation.currentName !== operation.nextName);

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
      throw new Error(`Failed to locate MJCF ${tagLabel} named "${operation.currentName}" in editable source.`);
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
  return renameMJCFEntitiesInSource(sourceContent, [
    { kind: 'link', currentName, nextName },
  ]);
}

export function renameMJCFJointInSource(
  sourceContent: string,
  currentName: string,
  nextName: string,
): string {
  return renameMJCFEntitiesInSource(sourceContent, [
    { kind: 'joint', currentName, nextName },
  ]);
}

export function patchMJCFRootModelNameInSource(
  sourceContent: string,
  modelName: string,
): string {
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
