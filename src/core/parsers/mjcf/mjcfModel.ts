import * as THREE from 'three';
import type { RobotImportRecoveryDiagnostic } from '@/types';
import {
  parseCompilerSettings,
  parseHfieldAssets,
  parseMaterialAssets,
  parseMeshAssets,
  parseMJCFDefaults,
  parseMJCFXmlDocument,
  parseOrientationAsQuat,
  parseTextureAssets,
  parseNumbers,
  parsePosAsTuple,
  resolveCompilerSettingsForElement,
  resolveDefaultClassQName,
  resolveElementAttributes,
  type MJCFCompilerSettings,
  type MJCFDefaultsRegistry,
  type MJCFHfield,
  type MJCFMaterial,
  type MJCFMesh,
  type MJCFTexture,
} from './mjcfUtils';
import {
  buildGeneratedMjcfBodyPath,
  buildGeneratedMjcfGeomName,
  buildGeneratedMjcfSiteName,
} from './mjcfGeneratedNames';
import { convertMjcfAngle, mjcfQuatToThreeQuat } from './mjcfMath';

export interface MJCFModelGeom {
  name?: string;
  sourceName?: string;
  className?: string;
  classQName?: string;
  type: string;
  size?: number[];
  mass?: number;
  mesh?: string;
  fittedFromMesh?: string;
  hfield?: string;
  material?: string;
  rgba?: [number, number, number, number];
  hasExplicitRgba?: boolean;
  pos?: [number, number, number];
  quat?: [number, number, number, number];
  fromto?: number[];
  contype?: number;
  conaffinity?: number;
  group?: number;
}

export interface MJCFModelJoint {
  name: string;
  sourceName?: string;
  type: string;
  axis?: [number, number, number];
  range?: [number, number];
  ref?: number;
  pos?: [number, number, number];
  limited?: boolean;
  damping?: number;
  frictionloss?: number;
  armature?: number;
  stiffness?: number;
  actuatorForceRange?: [number, number];
  actuatorForceLimited?: boolean;
}

export interface MJCFModelActuator {
  name: string;
  type: string;
  className?: string;
  classQName?: string;
  joint?: string;
  tendon?: string;
  ctrlrange?: [number, number];
  forcerange?: [number, number];
  gear?: number[];
  ctrllimited?: boolean;
  forcelimited?: boolean;
}

export interface MJCFModelSite {
  name: string;
  sourceName?: string;
  className?: string;
  classQName?: string;
  type: string;
  size?: number[];
  rgba?: [number, number, number, number];
  pos?: [number, number, number];
  quat?: [number, number, number, number];
  group?: number;
}

export interface MJCFModelTendonAttachment {
  type: 'site' | 'geom' | 'joint' | 'pulley';
  ref?: string;
  sidesite?: string;
  divisor?: number;
  coef?: number;
}

export interface MJCFModelTendon {
  name: string;
  sourceName?: string;
  className?: string;
  classQName?: string;
  group?: number;
  type: 'fixed' | 'spatial';
  limited?: boolean;
  range?: [number, number];
  width?: number;
  stiffness?: number;
  springlength?: number;
  rgba?: [number, number, number, number];
  attachments: MJCFModelTendonAttachment[];
}

export interface MJCFModelInertial {
  mass: number;
  pos: [number, number, number];
  quat?: [number, number, number, number];
  diaginertia?: [number, number, number];
  fullinertia?: [number, number, number, number, number, number];
}

export interface MJCFModelConnectConstraint {
  name?: string;
  body1: string;
  body2: string;
  anchor: [number, number, number];
}

export interface MJCFModelJointEqualityConstraint {
  name?: string;
  joint1: string;
  joint2: string;
  polycoef: [number, number, number, number, number];
}

export interface MJCFModelKeyframe {
  name?: string;
  qpos?: number[];
}

export interface MJCFModelBody {
  name: string;
  sourceName?: string;
  pos: [number, number, number];
  euler?: [number, number, number];
  quat?: [number, number, number, number];
  geoms: MJCFModelGeom[];
  sites: MJCFModelSite[];
  joints: MJCFModelJoint[];
  inertial?: MJCFModelInertial;
  children: MJCFModelBody[];
}

export interface ParsedMJCFModel {
  modelName: string;
  compilerSettings: MJCFCompilerSettings;
  defaults: MJCFDefaultsRegistry;
  meshMap: Map<string, MJCFMesh>;
  hfieldMap: Map<string, MJCFHfield>;
  materialMap: Map<string, MJCFMaterial>;
  textureMap: Map<string, MJCFTexture>;
  actuatorMap: Map<string, MJCFModelActuator[]>;
  tendonActuators: MJCFModelActuator[];
  tendonMap: Map<string, MJCFModelTendon>;
  connectConstraints: MJCFModelConnectConstraint[];
  jointEqualityConstraints: MJCFModelJointEqualityConstraint[];
  keyframes: MJCFModelKeyframe[];
  worldBody: MJCFModelBody;
  recoveryDiagnostics: RobotImportRecoveryDiagnostic[];
}

interface CachedParsedMJCFModelEntry {
  model: ParsedMJCFModel | null;
  error: string | null;
}

const PARSED_MODEL_CACHE_LIMIT = 24;
const parsedModelCache = new Map<string, CachedParsedMJCFModelEntry>();

function rememberParsedModel(
  xmlContent: string,
  parsedModel: ParsedMJCFModel | null,
  error: string | null = null,
): ParsedMJCFModel | null {
  if (!parsedModelCache.has(xmlContent) && parsedModelCache.size >= PARSED_MODEL_CACHE_LIMIT) {
    const oldestKey = parsedModelCache.keys().next().value;
    if (oldestKey !== undefined) {
      parsedModelCache.delete(oldestKey);
    }
  }

  parsedModelCache.set(xmlContent, {
    model: parsedModel,
    error,
  });
  return parsedModel;
}

export function clearParsedMJCFModelCache(xmlContent?: string): void {
  if (typeof xmlContent === 'string') {
    parsedModelCache.delete(xmlContent);
    return;
  }

  parsedModelCache.clear();
}

export function getParsedMJCFModelCacheSize(): number {
  return parsedModelCache.size;
}

export function getParsedMJCFModelError(xmlContent: string): string | null {
  if (!parsedModelCache.has(xmlContent)) {
    parseMJCFModel(xmlContent);
  }

  return parsedModelCache.get(xmlContent)?.error ?? null;
}

function directChildren(element: Element, tagName: string): Element[] {
  const normalizedTagName = tagName.toLowerCase();
  return Array.from(element.children).filter(
    (child) => child.tagName.toLowerCase() === normalizedTagName,
  );
}

function directChild(element: Element, tagName: string): Element | null {
  return directChildren(element, tagName)[0] || null;
}

function directChildrenByTagNames(element: Element, tagNames: string[]): Element[] {
  const normalized = new Set(tagNames.map((tagName) => tagName.toLowerCase()));
  return Array.from(element.children).filter((child) =>
    normalized.has(child.tagName.toLowerCase()),
  );
}

type RecoverableMJCFElementKind = 'body' | 'frame' | 'geom' | 'inertial' | 'joint' | 'site';

interface MJCFModelRecoveryCollector {
  diagnostics: RobotImportRecoveryDiagnostic[];
  add: (diagnostic: RobotImportRecoveryDiagnostic) => void;
  omit: (
    kind: RecoverableMJCFElementKind,
    element: Element,
    detail: string,
    bodyPath?: string,
  ) => void;
}

const NUMERIC_ATTRIBUTE_ARITIES: Readonly<Record<string, readonly [number, number]>> = {
  actuatorfrcrange: [2, 2],
  axis: [3, 3],
  axisangle: [4, 4],
  diaginertia: [3, 3],
  euler: [3, 3],
  fromto: [6, 6],
  fullinertia: [6, 6],
  pos: [3, 3],
  quat: [4, 4],
  range: [2, 2],
  rgba: [3, 4],
  size: [1, Number.POSITIVE_INFINITY],
  xyaxes: [6, 6],
  zaxis: [3, 3],
};

const SCALAR_NUMERIC_ATTRIBUTES = new Set([
  'armature',
  'conaffinity',
  'contype',
  'damping',
  'frictionloss',
  'group',
  'mass',
  'ref',
  'stiffness',
]);

const ORIENTATION_ATTRIBUTES = ['quat', 'axisangle', 'xyaxes', 'zaxis', 'euler'] as const;
const SUPPORTED_GEOM_TYPES = new Set([
  'box',
  'capsule',
  'cylinder',
  'ellipsoid',
  'hfield',
  'mesh',
  'plane',
  'sdf',
  'sphere',
]);
const SUPPORTED_SITE_TYPES = new Set(['box', 'capsule', 'cylinder', 'ellipsoid', 'sphere']);
const SUPPORTED_JOINT_TYPES = new Set(['ball', 'free', 'hinge', 'slide']);

function createMJCFModelRecoveryCollector(): MJCFModelRecoveryCollector {
  const diagnostics: RobotImportRecoveryDiagnostic[] = [];
  const seen = new Set<string>();
  const add = (diagnostic: RobotImportRecoveryDiagnostic): void => {
    const key = [
      diagnostic.code,
      diagnostic.action,
      diagnostic.message,
      diagnostic.source?.tag ?? '',
      diagnostic.source?.name ?? '',
    ].join('\0');
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    diagnostics.push(diagnostic);
  };

  return {
    diagnostics,
    add,
    omit(kind, element, detail, bodyPath) {
      let sourceName: string | undefined;
      try {
        sourceName = element.getAttribute('name')?.trim() || undefined;
      } catch {
        sourceName = undefined;
      }
      const displayName = sourceName || bodyPath;
      const code = kind === 'body' ? 'mjcf_body_subtree_omitted' : `mjcf_${kind}_omitted`;
      add({
        code,
        severity: 'warning',
        category:
          kind === 'body' || kind === 'frame'
            ? 'topology'
            : kind === 'joint'
              ? 'joint'
              : kind === 'inertial'
                ? 'physical'
                : 'geometry',
        message: `MJCF <${kind}>${displayName ? ` "${displayName}"` : ''} was omitted: ${detail}`,
        ...(displayName ? { relatedIds: [displayName] } : {}),
        source: {
          tag: kind,
          ...(sourceName ? { name: sourceName } : {}),
        },
        action: 'omitted',
      });
    },
  };
}

function parseFiniteNumberList(value: string): number[] | null {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const values = normalized.split(/\s+/).map(Number);
  return values.every(Number.isFinite) ? values : null;
}

function validateNumericAttributes(
  attributes: Record<string, string>,
  attributeNames: readonly string[],
): string | null {
  for (const attributeName of attributeNames) {
    const value = attributes[attributeName];
    if (value == null) {
      continue;
    }

    // MuJoCo accepts an explicitly blank optional rgba as an unset color.
    // Some upstream models use it to avoid inheriting a visual color on a
    // collision geom, so omitting the whole geom would lose physical data.
    if (attributeName === 'rgba' && value.trim() === '') {
      continue;
    }

    const values = parseFiniteNumberList(value);
    if (!values) {
      return `attribute "${attributeName}" does not contain finite numbers`;
    }

    const arity = NUMERIC_ATTRIBUTE_ARITIES[attributeName];
    if (arity && (values.length < arity[0] || values.length > arity[1])) {
      const expected = arity[0] === arity[1] ? `${arity[0]}` : `${arity[0]}-${arity[1]}`;
      return `attribute "${attributeName}" requires ${expected} numbers`;
    }

    if (SCALAR_NUMERIC_ATTRIBUTES.has(attributeName) && values.length !== 1) {
      return `attribute "${attributeName}" requires 1 number`;
    }
  }

  return null;
}

function describeError(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : String(error ?? 'unknown parse failure');
}

function requireValidNumericAttributes(
  attributes: Record<string, string>,
  attributeNames: readonly string[],
): void {
  const validationError = validateNumericAttributes(attributes, attributeNames);
  if (validationError) {
    throw new Error(validationError);
  }
}

function requireSingleExplicitOrientation(element: Element): void {
  const orientationCount = ORIENTATION_ATTRIBUTES.filter((attributeName) =>
    element.hasAttribute(attributeName),
  ).length;
  if (orientationCount > 1) {
    throw new Error('multiple orientation attributes are ambiguous');
  }
}

function parseEulerAsTuple(str: string | null): [number, number, number] | undefined {
  const nums = parseNumbers(str);
  if (nums.length === 0) {
    return undefined;
  }

  return [
    nums.length > 0 ? nums[0] : 0,
    nums.length > 1 ? nums[1] : 0,
    nums.length > 2 ? nums[2] : 0,
  ];
}

function parseBooleanAttribute(value: string | undefined): boolean | undefined {
  if (value == null) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }

  return undefined;
}

function toOptionalRangeTuple(values: number[]): [number, number] | undefined {
  if (values.length < 2) {
    return undefined;
  }

  return [values[0] ?? 0, values[1] ?? 0];
}

function normalizeJointRange(
  range: [number, number] | undefined,
  jointType: string,
  settings: MJCFCompilerSettings,
): [number, number] | undefined {
  if (!range) {
    return undefined;
  }

  if (jointType.toLowerCase() === 'slide') {
    return range;
  }

  return [
    convertMjcfAngle(range[0] ?? 0, settings.angleUnit),
    convertMjcfAngle(range[1] ?? 0, settings.angleUnit),
  ];
}

function parseJointElement(
  jointElement: Element,
  defaults: MJCFDefaultsRegistry,
  activeClassQName: string | undefined,
  compilerSettings: MJCFCompilerSettings,
  jointIndexRef: { value: number },
): MJCFModelJoint {
  const isFreeJoint = jointElement.tagName.toLowerCase() === 'freejoint';
  const jointAttrs = isFreeJoint
    ? {
        ...resolveElementAttributes(defaults, 'joint', jointElement, activeClassQName),
        type: 'free',
      }
    : resolveElementAttributes(defaults, 'joint', jointElement, activeClassQName);
  requireValidNumericAttributes(jointAttrs, [
    'actuatorfrcrange',
    'armature',
    'axis',
    'damping',
    'frictionloss',
    'pos',
    'range',
    'ref',
    'stiffness',
  ]);
  const jointType = isFreeJoint ? 'free' : (jointAttrs.type || 'hinge').trim().toLowerCase();
  if (!SUPPORTED_JOINT_TYPES.has(jointType)) {
    throw new Error(`unsupported joint type "${jointAttrs.type}"`);
  }
  const sourceJointName = jointElement.getAttribute('name') || jointAttrs.name || undefined;
  const generatedJointName = buildGeneratedJointName(jointIndexRef.value++);
  const axisNums = !isFreeJoint && jointAttrs.axis ? parseNumbers(jointAttrs.axis) : [];
  const rangeNums = jointAttrs.range ? parseNumbers(jointAttrs.range) : [];
  const actuatorForceRange = jointAttrs.actuatorfrcrange
    ? parseNumbers(jointAttrs.actuatorfrcrange)
    : [];
  const parsedRef =
    jointAttrs.ref != null && jointAttrs.ref !== '' ? parseFloat(jointAttrs.ref) : Number.NaN;

  const joint: MJCFModelJoint = {
    // Match MuJoCo's anonymous joint fallback naming (`joint_<global-index>`).
    name: sourceJointName || generatedJointName,
    sourceName: sourceJointName,
    type: jointAttrs.type || 'hinge',
    axis: axisNums.length > 0 ? [axisNums[0] ?? 0, axisNums[1] ?? 0, axisNums[2] ?? 1] : [0, 0, 1],
    limited: parseBooleanAttribute(jointAttrs.limited),
    actuatorForceLimited: parseBooleanAttribute(jointAttrs.actuatorfrclimited),
  };

  if (jointAttrs.damping != null && jointAttrs.damping !== '') {
    const parsedDamping = parseFloat(jointAttrs.damping);
    if (Number.isFinite(parsedDamping)) {
      joint.damping = parsedDamping;
    }
  }

  if (jointAttrs.frictionloss != null && jointAttrs.frictionloss !== '') {
    const parsedFriction = parseFloat(jointAttrs.frictionloss);
    if (Number.isFinite(parsedFriction)) {
      joint.frictionloss = parsedFriction;
    }
  }

  if (jointAttrs.stiffness != null && jointAttrs.stiffness !== '') {
    const parsedStiffness = parseFloat(jointAttrs.stiffness);
    if (Number.isFinite(parsedStiffness)) {
      joint.stiffness = parsedStiffness;
    }
  }

  if (jointAttrs.armature != null && jointAttrs.armature !== '') {
    const parsedArmature = parseFloat(jointAttrs.armature);
    if (Number.isFinite(parsedArmature)) {
      joint.armature = parsedArmature;
    }
  }

  if (isFreeJoint) {
    joint.range = [0, 0];
  } else {
    const parsedRange = toOptionalRangeTuple(rangeNums);
    if (parsedRange) {
      joint.range = normalizeJointRange(parsedRange, joint.type, compilerSettings);
    }
  }

  if (Number.isFinite(parsedRef)) {
    joint.ref =
      joint.type.toLowerCase() === 'slide'
        ? parsedRef
        : convertMjcfAngle(parsedRef, compilerSettings.angleUnit);
  }

  const parsedActuatorForceRange = toOptionalRangeTuple(actuatorForceRange);
  if (parsedActuatorForceRange) {
    joint.actuatorForceRange = parsedActuatorForceRange;
  }

  if (joint.limited == null && compilerSettings.autolimits && joint.range) {
    joint.limited = true;
  }
  if (
    joint.actuatorForceLimited == null &&
    compilerSettings.autolimits &&
    joint.actuatorForceRange
  ) {
    joint.actuatorForceLimited = true;
  }

  if (jointAttrs.pos) {
    joint.pos = parsePosAsTuple(jointAttrs.pos);
  } else if (isFreeJoint || joint.type === 'free') {
    joint.pos = [0, 0, 0];
  }

  return joint;
}

function parseActuatorData(
  mujocoElement: Element,
  defaults: MJCFDefaultsRegistry,
  compilerSettings: MJCFCompilerSettings,
): {
  actuatorMap: Map<string, MJCFModelActuator[]>;
  tendonActuators: MJCFModelActuator[];
} {
  const actuatorMap = new Map<string, MJCFModelActuator[]>();
  const tendonActuators: MJCFModelActuator[] = [];
  const actuatorElements = directChildren(mujocoElement, 'actuator');
  if (actuatorElements.length === 0) {
    return { actuatorMap, tendonActuators };
  }

  const actuatorTags = [
    'motor',
    'position',
    'velocity',
    'intvelocity',
    'general',
    'damper',
    'muscle',
    'adhesion',
  ] as const;
  const actuatorTagSet = new Set<string>(actuatorTags);
  actuatorElements.forEach((actuatorElement) => {
    Array.from(actuatorElement.children).forEach((child) => {
      const actuatorType = child.tagName.toLowerCase();
      if (!actuatorTagSet.has(actuatorType)) {
        return;
      }

      const actuatorAttrs = resolveElementAttributes(
        defaults,
        actuatorType as (typeof actuatorTags)[number],
        child,
      );
      const actuatorClassQName = resolveDefaultClassQName(defaults, child.getAttribute('class'));
      const jointName = child.getAttribute('joint') || actuatorAttrs.joint || undefined;
      const tendonName = child.getAttribute('tendon') || actuatorAttrs.tendon || undefined;
      if (!jointName && !tendonName) {
        return;
      }

      const ctrlrange = toOptionalRangeTuple(parseNumbers(actuatorAttrs.ctrlrange || null));
      const forcerange = toOptionalRangeTuple(parseNumbers(actuatorAttrs.forcerange || null));
      const gear = parseNumbers(actuatorAttrs.gear || null);
      const actuator: MJCFModelActuator = {
        name:
          child.getAttribute('name') ||
          actuatorAttrs.name ||
          jointName ||
          tendonName ||
          actuatorType,
        type: actuatorType,
        className: actuatorClassQName?.split('/').pop() || child.getAttribute('class') || undefined,
        classQName: actuatorClassQName,
        joint: jointName,
        tendon: tendonName,
        ctrlrange,
        forcerange,
        gear: gear.length > 0 ? gear : undefined,
        ctrllimited:
          parseBooleanAttribute(actuatorAttrs.ctrllimited) ??
          (compilerSettings.autolimits && ctrlrange ? true : undefined),
        forcelimited:
          parseBooleanAttribute(actuatorAttrs.forcelimited) ??
          (compilerSettings.autolimits && forcerange ? true : undefined),
      };

      if (!jointName) {
        tendonActuators.push(actuator);
        return;
      }

      const existing = actuatorMap.get(jointName) || [];
      existing.push(actuator);
      actuatorMap.set(jointName, existing);
    });
  });

  return { actuatorMap, tendonActuators };
}

function parseConnectConstraints(mujocoElement: Element): MJCFModelConnectConstraint[] {
  const constraints: MJCFModelConnectConstraint[] = [];

  directChildren(mujocoElement, 'equality').forEach((equalityElement) => {
    directChildren(equalityElement, 'connect').forEach((connectElement) => {
      const body1 = connectElement.getAttribute('body1')?.trim() || '';
      const body2 = connectElement.getAttribute('body2')?.trim() || '';
      const anchor = parsePosAsTuple(connectElement.getAttribute('anchor'));

      if (!body1 || !body2 || anchor.length < 3) {
        return;
      }

      constraints.push({
        name: connectElement.getAttribute('name') || undefined,
        body1,
        body2,
        anchor: [anchor[0] ?? 0, anchor[1] ?? 0, anchor[2] ?? 0],
      });
    });
  });

  return constraints;
}

function parseJointEqualityConstraints(mujocoElement: Element): MJCFModelJointEqualityConstraint[] {
  const constraints: MJCFModelJointEqualityConstraint[] = [];
  const defaultPolycoef: [number, number, number, number, number] = [0, 1, 0, 0, 0];

  directChildren(mujocoElement, 'equality').forEach((equalityElement) => {
    directChildren(equalityElement, 'joint').forEach((jointElement) => {
      const isActive = parseBooleanAttribute(jointElement.getAttribute('active') ?? undefined);
      if (isActive === false) {
        return;
      }

      const joint1 = jointElement.getAttribute('joint1')?.trim() || '';
      const joint2 = jointElement.getAttribute('joint2')?.trim() || '';
      if (!joint1 || !joint2) {
        return;
      }

      const parsedPolycoef = parseNumbers(jointElement.getAttribute('polycoef'));
      const polycoef = defaultPolycoef.map((defaultValue, index) =>
        Number.isFinite(parsedPolycoef[index]) ? parsedPolycoef[index]! : defaultValue,
      ) as [number, number, number, number, number];

      constraints.push({
        name: jointElement.getAttribute('name') || undefined,
        joint1,
        joint2,
        polycoef,
      });
    });
  });

  return constraints;
}

function parseKeyframes(mujocoElement: Element): MJCFModelKeyframe[] {
  return directChildren(mujocoElement, 'keyframe').flatMap((keyframeElement) =>
    directChildren(keyframeElement, 'key')
      .map((keyElement): MJCFModelKeyframe => {
        const qpos = parseNumbers(keyElement.getAttribute('qpos'));
        const name = keyElement.getAttribute('name')?.trim() || undefined;

        return {
          ...(name ? { name } : {}),
          ...(qpos.length > 0 ? { qpos } : {}),
        };
      })
      .filter((keyframe) => Boolean(keyframe.name || keyframe.qpos)),
  );
}

function resolveChildDefaultsClassQName(
  defaults: MJCFDefaultsRegistry,
  element: Element,
  activeClassQName: string | undefined,
): string | undefined {
  return (
    resolveDefaultClassQName(defaults, element.getAttribute('childclass'), activeClassQName) ||
    activeClassQName
  );
}

function parseFrameLocalTransform(
  frameElement: Element,
  compilerSettings: MJCFCompilerSettings,
): MJCFLocalTransform {
  const framePos = frameElement.getAttribute('pos')
    ? parsePosAsTuple(frameElement.getAttribute('pos'))
    : undefined;
  const frameCompilerSettings = resolveCompilerSettingsForElement(frameElement, compilerSettings);
  const frameQuat = parseOrientationAsQuat(
    {
      quat: frameElement.getAttribute('quat'),
      axisangle: frameElement.getAttribute('axisangle'),
      xyaxes: frameElement.getAttribute('xyaxes'),
      zaxis: frameElement.getAttribute('zaxis'),
      euler: frameElement.getAttribute('euler'),
    },
    frameCompilerSettings,
  );

  return createLocalTransform(framePos, frameQuat);
}

function resolveFrameTransform(
  frameElement: Element,
  compilerSettings: MJCFCompilerSettings,
  inheritedTransform?: MJCFLocalTransform,
): MJCFLocalTransform {
  const localTransform = parseFrameLocalTransform(frameElement, compilerSettings);
  return inheritedTransform
    ? composeTransforms(inheritedTransform, localTransform)
    : localTransform;
}

function walkFrameExpandedChildren(
  container: Element,
  defaults: MJCFDefaultsRegistry,
  activeClassQName: string | undefined,
  compilerSettings: MJCFCompilerSettings,
  visitor: (
    child: Element,
    context: {
      activeClassQName: string | undefined;
      inheritedTransform: MJCFLocalTransform | undefined;
    },
  ) => void,
  inheritedTransform?: MJCFLocalTransform,
  recovery?: MJCFModelRecoveryCollector,
  bodyPath?: string,
): void {
  const deferredFrames: Array<{
    frame: Element;
    activeClassQName: string | undefined;
    inheritedTransform: MJCFLocalTransform | undefined;
  }> = [];

  Array.from(container.children).forEach((child) => {
    if (child.tagName.toLowerCase() === 'frame') {
      try {
        const frameAttributes = Object.fromEntries(
          Array.from(child.attributes).map((attribute) => [attribute.name, attribute.value]),
        );
        requireValidNumericAttributes(frameAttributes, [
          'axisangle',
          'euler',
          'pos',
          'quat',
          'xyaxes',
          'zaxis',
        ]);
        requireSingleExplicitOrientation(child);
        deferredFrames.push({
          frame: child,
          activeClassQName: resolveChildDefaultsClassQName(defaults, child, activeClassQName),
          inheritedTransform: resolveFrameTransform(child, compilerSettings, inheritedTransform),
        });
      } catch (error) {
        recovery?.omit('frame', child, describeError(error), bodyPath);
      }
      return;
    }

    visitor(child, { activeClassQName, inheritedTransform });
  });

  deferredFrames.forEach((entry) => {
    walkFrameExpandedChildren(
      entry.frame,
      defaults,
      entry.activeClassQName,
      compilerSettings,
      visitor,
      entry.inheritedTransform,
      recovery,
      bodyPath,
    );
  });
}

function parseSiteElement(
  siteElement: Element,
  defaults: MJCFDefaultsRegistry,
  activeClassQName: string | undefined,
  compilerSettings: MJCFCompilerSettings,
  bodyPath: string,
  siteIndex: number,
  inheritedTransform?: MJCFLocalTransform,
): MJCFModelSite {
  const siteAttrs = resolveElementAttributes(defaults, 'site', siteElement, activeClassQName);
  requireSingleExplicitOrientation(siteElement);
  requireValidNumericAttributes(siteAttrs, [
    'axisangle',
    'euler',
    'group',
    'pos',
    'quat',
    'rgba',
    'size',
    'xyaxes',
    'zaxis',
  ]);
  const siteType = (siteAttrs.type || 'sphere').trim().toLowerCase();
  if (!SUPPORTED_SITE_TYPES.has(siteType)) {
    throw new Error(`unsupported site type "${siteAttrs.type}"`);
  }
  const siteCompilerSettings = resolveCompilerSettingsForElement(siteElement, compilerSettings);
  const siteClassQName = resolveDefaultClassQName(
    defaults,
    siteElement.getAttribute('class'),
    activeClassQName,
  );
  const sourceSiteName = siteElement.getAttribute('name') || siteAttrs.name || undefined;
  const siteQuat = parseOrientationAsQuat(
    {
      quat: siteAttrs.quat,
      axisangle: siteAttrs.axisangle,
      xyaxes: siteAttrs.xyaxes,
      zaxis: siteAttrs.zaxis,
      euler: siteAttrs.euler,
    },
    siteCompilerSettings,
  );
  const sitePos = siteAttrs.pos ? parsePosAsTuple(siteAttrs.pos) : undefined;
  const size = parseNumbers(siteAttrs.size || null);
  const hasInheritedTransform = !isIdentityTransform(inheritedTransform);

  let resolvedPos = sitePos;
  let resolvedQuat = siteQuat;
  if (hasInheritedTransform && inheritedTransform) {
    const composedTransform = composeTransforms(
      inheritedTransform,
      createLocalTransform(sitePos, siteQuat),
    );
    resolvedPos = vectorToTuple(composedTransform.position);
    resolvedQuat = threeQuatToMJCFQuat(composedTransform.quaternion);
  }

  const site: MJCFModelSite = {
    name: sourceSiteName || buildGeneratedMjcfSiteName(bodyPath, siteIndex),
    sourceName: sourceSiteName,
    className: siteClassQName?.split('/').pop() || siteElement.getAttribute('class') || undefined,
    classQName: siteClassQName,
    type: siteAttrs.type || 'sphere',
    size: size.length > 0 ? size : undefined,
    rgba: toRgbaTuple(siteAttrs.rgba),
    pos: resolvedPos,
    quat: resolvedQuat,
  };

  if (siteAttrs.group != null && siteAttrs.group !== '') {
    site.group = parseInt(siteAttrs.group, 10);
  }

  return site;
}

function collectSitesInBodyOrder(
  container: Element,
  defaults: MJCFDefaultsRegistry,
  activeClassQName: string | undefined,
  compilerSettings: MJCFCompilerSettings,
  bodyPath: string,
  siteIndexRef: { value: number },
  recovery: MJCFModelRecoveryCollector,
  inheritedTransform?: MJCFLocalTransform,
): MJCFModelSite[] {
  const sites: MJCFModelSite[] = [];
  walkFrameExpandedChildren(
    container,
    defaults,
    activeClassQName,
    compilerSettings,
    (child, context) => {
      if (child.tagName.toLowerCase() !== 'site') {
        return;
      }

      try {
        sites.push(
          parseSiteElement(
            child,
            defaults,
            context.activeClassQName,
            compilerSettings,
            bodyPath,
            siteIndexRef.value,
            context.inheritedTransform,
          ),
        );
      } catch (error) {
        recovery.omit('site', child, describeError(error), bodyPath);
      }
      siteIndexRef.value += 1;
    },
    inheritedTransform,
    recovery,
    bodyPath,
  );

  return sites;
}

function parseTendonMap(
  mujocoElement: Element,
  defaults: MJCFDefaultsRegistry,
  compilerSettings: MJCFCompilerSettings,
): Map<string, MJCFModelTendon> {
  const tendonMap = new Map<string, MJCFModelTendon>();
  const tendonElements = directChildren(mujocoElement, 'tendon');
  if (tendonElements.length === 0) {
    return tendonMap;
  }

  let tendonIndex = 0;
  tendonElements.forEach((tendonElement) => {
    Array.from(tendonElement.children).forEach((child) => {
      const tendonType = child.tagName.toLowerCase();
      if (tendonType !== 'fixed' && tendonType !== 'spatial') {
        return;
      }

      const tendonClassQName = resolveDefaultClassQName(defaults, child.getAttribute('class'));
      const tendonAttrs = resolveElementAttributes(defaults, 'tendon', child, tendonClassQName);
      const parsedRange = toOptionalRangeTuple(parseNumbers(tendonAttrs.range || null));
      const attachments: MJCFModelTendonAttachment[] = [];

      Array.from(child.children).forEach((attachmentElement) => {
        const attachmentType = attachmentElement.tagName.toLowerCase();
        if (attachmentType === 'site') {
          attachments.push({
            type: 'site',
            ref: attachmentElement.getAttribute('site') || undefined,
          });
          return;
        }

        if (attachmentType === 'geom') {
          attachments.push({
            type: 'geom',
            ref: attachmentElement.getAttribute('geom') || undefined,
            sidesite: attachmentElement.getAttribute('sidesite') || undefined,
          });
          return;
        }

        if (attachmentType === 'joint') {
          const coefAttr = attachmentElement.getAttribute('coef');
          attachments.push({
            type: 'joint',
            ref: attachmentElement.getAttribute('joint') || undefined,
            coef: coefAttr != null && coefAttr !== '' ? parseFloat(coefAttr) : undefined,
          });
          return;
        }

        if (attachmentType === 'pulley') {
          const divisorAttr = attachmentElement.getAttribute('divisor');
          attachments.push({
            type: 'pulley',
            divisor:
              divisorAttr != null && divisorAttr !== '' ? parseFloat(divisorAttr) : undefined,
          });
        }
      });

      const tendonName = tendonAttrs.name || `tendon_${tendonIndex}`;
      const tendon: MJCFModelTendon = {
        name: tendonName,
        sourceName: child.getAttribute('name') || tendonAttrs.name || undefined,
        className: tendonClassQName?.split('/').pop() || child.getAttribute('class') || undefined,
        classQName: tendonClassQName,
        type: tendonType,
        limited:
          parseBooleanAttribute(tendonAttrs.limited) ??
          (compilerSettings.autolimits && parsedRange ? true : undefined),
        range: parsedRange,
        rgba: toRgbaTuple(tendonAttrs.rgba),
        attachments,
      };

      if (tendonAttrs.group != null && tendonAttrs.group !== '') {
        const parsedGroup = parseFloat(tendonAttrs.group);
        if (Number.isFinite(parsedGroup)) {
          tendon.group = parsedGroup;
        }
      }

      if (tendonAttrs.width != null && tendonAttrs.width !== '') {
        const parsedWidth = parseFloat(tendonAttrs.width);
        if (Number.isFinite(parsedWidth)) {
          tendon.width = parsedWidth;
        }
      }
      if (tendonAttrs.stiffness != null && tendonAttrs.stiffness !== '') {
        const parsedStiffness = parseFloat(tendonAttrs.stiffness);
        if (Number.isFinite(parsedStiffness)) {
          tendon.stiffness = parsedStiffness;
        }
      }
      if (tendonAttrs.springlength != null && tendonAttrs.springlength !== '') {
        const parsedSpringLength = parseFloat(tendonAttrs.springlength);
        if (Number.isFinite(parsedSpringLength)) {
          tendon.springlength = parsedSpringLength;
        }
      }

      tendonMap.set(tendonName, tendon);
      tendonIndex += 1;
    });
  });

  return tendonMap;
}

interface MJCFLocalTransform {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

function threeQuatToMJCFQuat(quaternion: THREE.Quaternion): [number, number, number, number] {
  return [quaternion.w, quaternion.x, quaternion.y, quaternion.z];
}

function createLocalTransform(
  pos: [number, number, number] | undefined,
  quat: [number, number, number, number] | undefined,
): MJCFLocalTransform {
  return {
    position: new THREE.Vector3(pos?.[0] ?? 0, pos?.[1] ?? 0, pos?.[2] ?? 0),
    quaternion: mjcfQuatToThreeQuat(quat),
  };
}

function composeTransforms(
  parent: MJCFLocalTransform,
  local: MJCFLocalTransform,
): MJCFLocalTransform {
  return {
    position: local.position.clone().applyQuaternion(parent.quaternion).add(parent.position),
    quaternion: parent.quaternion.clone().multiply(local.quaternion),
  };
}

function isIdentityTransform(transform: MJCFLocalTransform | undefined): boolean {
  if (!transform) {
    return true;
  }

  return (
    transform.position.lengthSq() <= 1e-12 &&
    Math.abs(transform.quaternion.x) <= 1e-12 &&
    Math.abs(transform.quaternion.y) <= 1e-12 &&
    Math.abs(transform.quaternion.z) <= 1e-12 &&
    Math.abs(transform.quaternion.w - 1) <= 1e-12
  );
}

function vectorToTuple(vector: THREE.Vector3): [number, number, number] {
  return [vector.x, vector.y, vector.z];
}

function quaternionToAxisTuple(
  quaternion: THREE.Quaternion,
  axis: [number, number, number] = [0, 0, 1],
): [number, number, number] {
  const rotated = new THREE.Vector3(axis[0] ?? 0, axis[1] ?? 0, axis[2] ?? 1).applyQuaternion(
    quaternion,
  );
  return [rotated.x, rotated.y, rotated.z];
}

function transformFromTo(fromto: number[], transform: MJCFLocalTransform): number[] {
  if (fromto.length < 6) {
    return fromto;
  }

  const start = new THREE.Vector3(fromto[0], fromto[1], fromto[2])
    .applyQuaternion(transform.quaternion)
    .add(transform.position);
  const end = new THREE.Vector3(fromto[3], fromto[4], fromto[5])
    .applyQuaternion(transform.quaternion)
    .add(transform.position);
  return [start.x, start.y, start.z, end.x, end.y, end.z];
}

function parseGeomElement(
  geomElement: Element,
  defaults: MJCFDefaultsRegistry,
  activeClassQName: string | undefined,
  compilerSettings: MJCFCompilerSettings,
  bodyPath: string,
  geomIndex: number,
  inheritedTransform?: MJCFLocalTransform,
): MJCFModelGeom {
  const geomAttrs = resolveElementAttributes(defaults, 'geom', geomElement, activeClassQName);
  requireSingleExplicitOrientation(geomElement);
  requireValidNumericAttributes(geomAttrs, [
    'axisangle',
    'conaffinity',
    'contype',
    'euler',
    'fromto',
    'group',
    'mass',
    'pos',
    'quat',
    'rgba',
    'size',
    'xyaxes',
    'zaxis',
  ]);
  const geomCompilerSettings = resolveCompilerSettingsForElement(geomElement, compilerSettings);
  const geomClassQName = resolveDefaultClassQName(
    defaults,
    geomElement.getAttribute('class'),
    activeClassQName,
  );
  const size = parseNumbers(geomAttrs.size || null);
  const sourceGeomName = geomElement.getAttribute('name') || geomAttrs.name || undefined;
  const meshName = geomAttrs.mesh || undefined;
  const hfieldName = geomAttrs.hfield || undefined;
  const geomQuat = parseOrientationAsQuat(
    {
      quat: geomAttrs.quat,
      axisangle: geomAttrs.axisangle,
      xyaxes: geomAttrs.xyaxes,
      zaxis: geomAttrs.zaxis,
      euler: geomAttrs.euler,
    },
    geomCompilerSettings,
  );
  const geomPos = geomAttrs.pos ? parsePosAsTuple(geomAttrs.pos) : undefined;
  const rawFromTo = parseNumbers(geomAttrs.fromto || null);
  const geomType = inferGeomType(geomAttrs.type, meshName, rawFromTo);
  if (!SUPPORTED_GEOM_TYPES.has(geomType.trim().toLowerCase())) {
    throw new Error(`unsupported geom type "${geomType}"`);
  }
  const hasInheritedTransform = !isIdentityTransform(inheritedTransform);

  let resolvedPos = geomPos;
  let resolvedQuat = geomQuat;
  let resolvedFromTo = rawFromTo.length > 0 ? rawFromTo : undefined;

  if (hasInheritedTransform && inheritedTransform) {
    const composedTransform = composeTransforms(
      inheritedTransform,
      createLocalTransform(geomPos, geomQuat),
    );
    resolvedPos = vectorToTuple(composedTransform.position);
    resolvedQuat = threeQuatToMJCFQuat(composedTransform.quaternion);
    if (resolvedFromTo) {
      resolvedFromTo = transformFromTo(resolvedFromTo, inheritedTransform);
    }
  }

  const geom: MJCFModelGeom = {
    name: sourceGeomName || buildGeneratedMjcfGeomName(bodyPath, geomIndex),
    sourceName: sourceGeomName,
    className: geomClassQName?.split('/').pop() || geomElement.getAttribute('class') || undefined,
    classQName: geomClassQName,
    type: geomType,
    size,
    mesh: meshName,
    hfield: hfieldName,
    material: geomAttrs.material || undefined,
    rgba: toRgbaTuple(geomAttrs.rgba),
    hasExplicitRgba: geomElement.hasAttribute('rgba'),
    pos: resolvedPos,
    quat: resolvedQuat,
    fromto: resolvedFromTo,
  };

  if (geomAttrs.mass != null && geomAttrs.mass !== '') {
    const parsedMass = parseFloat(geomAttrs.mass);
    if (Number.isFinite(parsedMass)) {
      geom.mass = parsedMass;
    }
  }

  if (geomAttrs.contype != null && geomAttrs.contype !== '') {
    geom.contype = parseInt(geomAttrs.contype, 10);
  }
  if (geomAttrs.conaffinity != null && geomAttrs.conaffinity !== '') {
    geom.conaffinity = parseInt(geomAttrs.conaffinity, 10);
  }
  if (geomAttrs.group != null && geomAttrs.group !== '') {
    geom.group = parseInt(geomAttrs.group, 10);
  }

  return geom;
}

function collectGeomsInBodyOrder(
  container: Element,
  defaults: MJCFDefaultsRegistry,
  activeClassQName: string | undefined,
  compilerSettings: MJCFCompilerSettings,
  bodyPath: string,
  geomIndexRef: { value: number },
  recovery: MJCFModelRecoveryCollector,
  inheritedTransform?: MJCFLocalTransform,
): MJCFModelGeom[] {
  const geoms: MJCFModelGeom[] = [];
  walkFrameExpandedChildren(
    container,
    defaults,
    activeClassQName,
    compilerSettings,
    (child, context) => {
      if (child.tagName.toLowerCase() !== 'geom') {
        return;
      }

      try {
        geoms.push(
          parseGeomElement(
            child,
            defaults,
            context.activeClassQName,
            compilerSettings,
            bodyPath,
            geomIndexRef.value,
            context.inheritedTransform,
          ),
        );
      } catch (error) {
        recovery.omit('geom', child, describeError(error), bodyPath);
      }
      geomIndexRef.value += 1;
    },
    inheritedTransform,
    recovery,
    bodyPath,
  );

  return geoms;
}

function applyJointTransform(
  joint: MJCFModelJoint,
  inheritedTransform?: MJCFLocalTransform,
): MJCFModelJoint {
  if (!inheritedTransform || isIdentityTransform(inheritedTransform)) {
    return joint;
  }

  const composedTransform = composeTransforms(
    inheritedTransform,
    createLocalTransform(joint.pos, undefined),
  );

  return {
    ...joint,
    pos: vectorToTuple(composedTransform.position),
    axis:
      joint.type.toLowerCase() === 'free'
        ? joint.axis
        : quaternionToAxisTuple(inheritedTransform.quaternion, joint.axis),
  };
}

function collectJointsInBodyOrder(
  container: Element,
  defaults: MJCFDefaultsRegistry,
  activeClassQName: string | undefined,
  compilerSettings: MJCFCompilerSettings,
  jointIndexRef: { value: number },
  recovery: MJCFModelRecoveryCollector,
  bodyPath: string,
  inheritedTransform?: MJCFLocalTransform,
): MJCFModelJoint[] {
  const joints: MJCFModelJoint[] = [];

  walkFrameExpandedChildren(
    container,
    defaults,
    activeClassQName,
    compilerSettings,
    (child, context) => {
      const tagName = child.tagName.toLowerCase();
      if (tagName !== 'joint' && tagName !== 'freejoint') {
        return;
      }

      try {
        const joint = parseJointElement(
          child,
          defaults,
          context.activeClassQName,
          resolveCompilerSettingsForElement(child, compilerSettings),
          jointIndexRef,
        );
        joints.push(applyJointTransform(joint, context.inheritedTransform));
      } catch (error) {
        recovery.omit('joint', child, describeError(error), bodyPath);
        jointIndexRef.value += 1;
      }
    },
    inheritedTransform,
    recovery,
    bodyPath,
  );

  return joints;
}

function parseInertialElement(
  inertialElement: Element,
  defaults: MJCFDefaultsRegistry,
  activeClassQName: string | undefined,
  compilerSettings: MJCFCompilerSettings,
  inheritedTransform?: MJCFLocalTransform,
): MJCFModelInertial {
  const inertialAttrs = resolveElementAttributes(
    defaults,
    'inertial',
    inertialElement,
    activeClassQName,
  );
  requireSingleExplicitOrientation(inertialElement);
  requireValidNumericAttributes(inertialAttrs, [
    'axisangle',
    'diaginertia',
    'euler',
    'fullinertia',
    'mass',
    'pos',
    'quat',
    'xyaxes',
    'zaxis',
  ]);
  if (!inertialAttrs.mass || !inertialAttrs.pos) {
    throw new Error('required attributes "mass" and "pos" are missing');
  }
  if (!inertialAttrs.diaginertia && !inertialAttrs.fullinertia) {
    throw new Error('either "diaginertia" or "fullinertia" is required');
  }
  const diaginertia = parseNumbers(inertialAttrs.diaginertia || null);
  const fullinertia = parseNumbers(inertialAttrs.fullinertia || null);
  const localQuat = parseOrientationAsQuat(
    {
      quat: inertialAttrs.quat,
      axisangle: inertialAttrs.axisangle,
      xyaxes: inertialAttrs.xyaxes,
      zaxis: inertialAttrs.zaxis,
      euler: inertialAttrs.euler,
    },
    resolveCompilerSettingsForElement(inertialElement, compilerSettings),
  );
  const localPos = parsePosAsTuple(inertialAttrs.pos || null);

  let resolvedPos = localPos;
  let resolvedQuat = localQuat;
  if (!isIdentityTransform(inheritedTransform)) {
    const composedTransform = composeTransforms(
      inheritedTransform!,
      createLocalTransform(localPos, localQuat),
    );
    resolvedPos = vectorToTuple(composedTransform.position);
    resolvedQuat = threeQuatToMJCFQuat(composedTransform.quaternion);
  }

  return {
    mass: parseFloat(inertialAttrs.mass || '0'),
    pos: resolvedPos,
    quat: resolvedQuat,
    diaginertia:
      diaginertia.length >= 3 ? [diaginertia[0], diaginertia[1], diaginertia[2]] : undefined,
    fullinertia:
      fullinertia.length >= 6
        ? [
            fullinertia[0],
            fullinertia[1],
            fullinertia[2],
            fullinertia[3],
            fullinertia[4],
            fullinertia[5],
          ]
        : undefined,
  };
}

function collectFirstInertialInBodyOrder(options: {
  container: Element;
  defaults: MJCFDefaultsRegistry;
  activeClassQName: string | undefined;
  compilerSettings: MJCFCompilerSettings;
  recovery: MJCFModelRecoveryCollector;
  bodyPath: string;
  inheritedTransform?: MJCFLocalTransform;
}): MJCFModelInertial | undefined {
  const {
    container,
    defaults,
    activeClassQName,
    compilerSettings,
    recovery,
    bodyPath,
    inheritedTransform,
  } = options;
  let inertial: MJCFModelInertial | undefined;

  walkFrameExpandedChildren(
    container,
    defaults,
    activeClassQName,
    compilerSettings,
    (child, context) => {
      if (inertial || child.tagName.toLowerCase() !== 'inertial') {
        return;
      }

      try {
        inertial = parseInertialElement(
          child,
          defaults,
          context.activeClassQName,
          compilerSettings,
          context.inheritedTransform,
        );
      } catch (error) {
        recovery.omit('inertial', child, describeError(error), bodyPath);
      }
    },
    inheritedTransform,
    recovery,
    bodyPath,
  );

  return inertial;
}

function collectBodiesInBodyOrder(
  container: Element,
  defaults: MJCFDefaultsRegistry,
  activeClassQName: string | undefined,
  compilerSettings: MJCFCompilerSettings,
  parentPath: string,
  jointIndexRef: { value: number },
  bodyIndexRef: { value: number },
  recovery: MJCFModelRecoveryCollector,
  inheritedTransform?: MJCFLocalTransform,
): MJCFModelBody[] {
  const bodies: MJCFModelBody[] = [];

  walkFrameExpandedChildren(
    container,
    defaults,
    activeClassQName,
    compilerSettings,
    (child, context) => {
      if (child.tagName.toLowerCase() !== 'body') {
        return;
      }

      const bodyPath =
        child.getAttribute('name') || buildGeneratedMjcfBodyPath(parentPath, bodyIndexRef.value);
      try {
        bodies.push(
          parseBody(
            child,
            defaults,
            compilerSettings,
            parentPath,
            bodyIndexRef.value,
            jointIndexRef,
            recovery,
            context.activeClassQName,
            context.inheritedTransform,
          ),
        );
      } catch (error) {
        recovery.omit('body', child, describeError(error), bodyPath);
      }
      bodyIndexRef.value += 1;
    },
    inheritedTransform,
    recovery,
    parentPath,
  );

  return bodies;
}

function inferGeomType(
  explicitType: string | undefined,
  meshName: string | undefined,
  fromto: number[] | undefined,
): string {
  const normalizedExplicitType = explicitType?.trim();
  if (normalizedExplicitType) {
    return normalizedExplicitType;
  }

  if (meshName) {
    return 'mesh';
  }

  if (fromto && fromto.length === 6) {
    return 'capsule';
  }

  return 'sphere';
}

function toRgbaTuple(str: string | undefined): [number, number, number, number] | undefined {
  if (!str) {
    return undefined;
  }

  const rgba = parseNumbers(str);
  if (rgba.length < 3) {
    return undefined;
  }

  return [rgba[0], rgba[1], rgba[2], rgba[3] ?? 1];
}

function buildGeneratedJointName(jointIndex: number): string {
  return `joint_${jointIndex}`;
}

function createZeroPosition(): [number, number, number] {
  return [0, 0, 0];
}

function buildSyntheticJointStageName(bodyName: string, stageIndex: number): string {
  return `${bodyName}__joint_stage_${stageIndex}`;
}

export function normalizeMultiJointBodies(body: MJCFModelBody): MJCFModelBody {
  const normalizedChildren = body.children.map(normalizeMultiJointBodies);
  const normalizedBody: MJCFModelBody = {
    ...body,
    children: normalizedChildren,
  };

  if (normalizedBody.joints.length <= 1) {
    return normalizedBody;
  }

  const bodyJoints = normalizedBody.joints;
  let chainedBody: MJCFModelBody = {
    ...normalizedBody,
    pos: createZeroPosition(),
    euler: undefined,
    quat: undefined,
    joints: [bodyJoints[bodyJoints.length - 1]],
    children: normalizedChildren,
  };

  for (let jointIndex = bodyJoints.length - 2; jointIndex >= 0; jointIndex -= 1) {
    chainedBody = {
      name: buildSyntheticJointStageName(normalizedBody.name, jointIndex),
      sourceName: undefined,
      pos: jointIndex === 0 ? normalizedBody.pos : createZeroPosition(),
      euler: jointIndex === 0 ? normalizedBody.euler : undefined,
      quat: jointIndex === 0 ? normalizedBody.quat : undefined,
      geoms: [],
      sites: [],
      joints: [bodyJoints[jointIndex]],
      inertial: undefined,
      children: [chainedBody],
    };
  }

  return chainedBody;
}

function parseBody(
  bodyElement: Element,
  defaults: MJCFDefaultsRegistry,
  compilerSettings: MJCFCompilerSettings,
  parentPath: string,
  siblingIndex: number,
  jointIndexRef: { value: number },
  recovery: MJCFModelRecoveryCollector,
  activeClassQName?: string,
  inheritedTransform?: MJCFLocalTransform,
): MJCFModelBody {
  const bodyAttrs = resolveElementAttributes(defaults, 'body', bodyElement, activeClassQName);
  requireSingleExplicitOrientation(bodyElement);
  requireValidNumericAttributes(bodyAttrs, [
    'axisangle',
    'euler',
    'pos',
    'quat',
    'xyaxes',
    'zaxis',
  ]);
  const bodyCompilerSettings = resolveCompilerSettingsForElement(bodyElement, compilerSettings);
  const sourceName = bodyElement.getAttribute('name') || bodyAttrs.name || undefined;
  const bodyPath = sourceName || buildGeneratedMjcfBodyPath(parentPath, siblingIndex);
  const childDefaultsClassQName = resolveChildDefaultsClassQName(
    defaults,
    bodyElement,
    activeClassQName,
  );
  const localBodyQuat = parseOrientationAsQuat(
    {
      quat: bodyAttrs.quat,
      axisangle: bodyAttrs.axisangle,
      xyaxes: bodyAttrs.xyaxes,
      zaxis: bodyAttrs.zaxis,
      euler: bodyAttrs.euler,
    },
    bodyCompilerSettings,
  );
  const localBodyPos = parsePosAsTuple(bodyAttrs.pos || null);

  let resolvedBodyPos = localBodyPos;
  let resolvedBodyQuat = localBodyQuat;
  let resolvedBodyEuler = parseEulerAsTuple(bodyAttrs.euler || null);
  if (!isIdentityTransform(inheritedTransform)) {
    const composedTransform = composeTransforms(
      inheritedTransform!,
      createLocalTransform(localBodyPos, localBodyQuat),
    );
    resolvedBodyPos = vectorToTuple(composedTransform.position);
    resolvedBodyQuat = threeQuatToMJCFQuat(composedTransform.quaternion);
    resolvedBodyEuler = undefined;
  }

  const geoms = collectGeomsInBodyOrder(
    bodyElement,
    defaults,
    childDefaultsClassQName,
    bodyCompilerSettings,
    bodyPath,
    { value: 0 },
    recovery,
  );
  const sites = collectSitesInBodyOrder(
    bodyElement,
    defaults,
    childDefaultsClassQName,
    bodyCompilerSettings,
    bodyPath,
    { value: 0 },
    recovery,
  );
  const joints = collectJointsInBodyOrder(
    bodyElement,
    defaults,
    childDefaultsClassQName,
    bodyCompilerSettings,
    jointIndexRef,
    recovery,
    bodyPath,
  );
  const inertial = collectFirstInertialInBodyOrder({
    container: bodyElement,
    defaults,
    activeClassQName: childDefaultsClassQName,
    compilerSettings: bodyCompilerSettings,
    recovery,
    bodyPath,
  });
  const children = collectBodiesInBodyOrder(
    bodyElement,
    defaults,
    childDefaultsClassQName,
    bodyCompilerSettings,
    bodyPath,
    jointIndexRef,
    { value: 0 },
    recovery,
  );

  return {
    name: bodyPath,
    sourceName,
    pos: resolvedBodyPos,
    euler: resolvedBodyEuler,
    quat: resolvedBodyQuat,
    geoms,
    sites,
    joints,
    inertial,
    children,
  };
}

function omitUnresolvableGeomReferences(options: {
  body: MJCFModelBody;
  meshMap: Map<string, MJCFMesh>;
  hfieldMap: Map<string, MJCFHfield>;
  materialMap: Map<string, MJCFMaterial>;
  recovery: MJCFModelRecoveryCollector;
}): void {
  const { body, meshMap, hfieldMap, materialMap, recovery } = options;
  body.geoms = body.geoms.filter((geom) => {
    const geomName = geom.sourceName || geom.name;
    if (geom.mesh && !meshMap.has(geom.mesh)) {
      recovery.add({
        code: 'mjcf_geom_omitted',
        severity: 'warning',
        category: 'geometry',
        message: `MJCF <geom>${geomName ? ` "${geomName}"` : ''} was omitted: mesh asset "${geom.mesh}" is not defined.`,
        ...(geomName ? { relatedIds: [geomName] } : {}),
        source: { tag: 'geom', ...(geomName ? { name: geomName } : {}), attribute: 'mesh' },
        action: 'omitted',
      });
      return false;
    }

    if (geom.hfield && !hfieldMap.has(geom.hfield)) {
      recovery.add({
        code: 'mjcf_geom_omitted',
        severity: 'warning',
        category: 'geometry',
        message: `MJCF <geom>${geomName ? ` "${geomName}"` : ''} was omitted: height field asset "${geom.hfield}" is not defined.`,
        ...(geomName ? { relatedIds: [geomName] } : {}),
        source: { tag: 'geom', ...(geomName ? { name: geomName } : {}), attribute: 'hfield' },
        action: 'omitted',
      });
      return false;
    }

    if (geom.material && !materialMap.has(geom.material)) {
      recovery.add({
        code: 'mjcf_material_reference_downgraded',
        severity: 'warning',
        category: 'material',
        message: `MJCF <geom>${geomName ? ` "${geomName}"` : ''} references undefined material "${geom.material}"; default rendering material was used.`,
        ...(geomName ? { relatedIds: [geomName] } : {}),
        source: { tag: 'geom', ...(geomName ? { name: geomName } : {}), attribute: 'material' },
        action: 'downgraded',
      });
      geom.material = undefined;
    }

    return true;
  });

  body.children.forEach((child) =>
    omitUnresolvableGeomReferences({
      body: child,
      meshMap,
      hfieldMap,
      materialMap,
      recovery,
    }),
  );
}

function omitDuplicateTopologyNames(
  worldBody: MJCFModelBody,
  recovery: MJCFModelRecoveryCollector,
): void {
  const bodyNames = new Set<string>([worldBody.name]);
  const jointNames = new Set<string>();

  const visit = (body: MJCFModelBody): void => {
    body.joints = body.joints.filter((joint) => {
      if (!jointNames.has(joint.name)) {
        jointNames.add(joint.name);
        return true;
      }

      recovery.add({
        code: 'mjcf_joint_omitted',
        severity: 'warning',
        category: 'joint',
        message: `Duplicate MJCF joint "${joint.name}" was omitted to preserve an unambiguous topology.`,
        relatedIds: [joint.name],
        source: { tag: 'joint', name: joint.name },
        action: 'omitted',
      });
      return false;
    });

    body.children = body.children.filter((child) => {
      if (!bodyNames.has(child.name)) {
        bodyNames.add(child.name);
        visit(child);
        return true;
      }

      recovery.add({
        code: 'mjcf_body_subtree_omitted',
        severity: 'warning',
        category: 'topology',
        message: `Duplicate MJCF body "${child.name}" and its subtree were omitted to preserve an unambiguous topology.`,
        relatedIds: [child.name],
        source: { tag: 'body', name: child.name },
        action: 'omitted',
      });
      return false;
    });
  };

  visit(worldBody);
}

function hasUsableMJCFBody(worldBody: MJCFModelBody): boolean {
  return worldBody.children.length > 0 || worldBody.geoms.length > 0 || worldBody.sites.length > 0;
}

export function parseMJCFModel(xmlContent: string): ParsedMJCFModel | null {
  if (parsedModelCache.has(xmlContent)) {
    return parsedModelCache.get(xmlContent)?.model ?? null;
  }

  try {
    const { doc, parseErrorText, recovered } = parseMJCFXmlDocument(xmlContent);
    if (!doc) {
      console.error('[MJCF] XML parsing error:', parseErrorText ?? 'unknown parse error');
      return rememberParsedModel(
        xmlContent,
        null,
        parseErrorText ? `XML parsing error: ${parseErrorText}` : 'XML parsing error.',
      );
    }

    const mujocoElement =
      doc.documentElement?.tagName.toLowerCase() === 'mujoco' ? doc.documentElement : null;
    if (!mujocoElement) {
      console.error('[MJCF] No <mujoco> root element found');
      return rememberParsedModel(xmlContent, null, 'No <mujoco> root element found.');
    }

    const recovery = createMJCFModelRecoveryCollector();
    if (recovered) {
      recovery.add({
        code: 'mjcf_xml_attribute_spacing_repaired',
        severity: 'warning',
        category: 'topology',
        message: 'MJCF attribute spacing was repaired before parsing.',
        source: { tag: 'mujoco' },
        action: 'downgraded',
      });
    }

    const compilerSettings = parseCompilerSettings(doc);
    const defaults = parseMJCFDefaults(doc);
    const meshMap = parseMeshAssets(doc, compilerSettings, defaults);
    const hfieldMap = parseHfieldAssets(doc);
    const materialMap = parseMaterialAssets(doc, defaults);
    const textureMap = parseTextureAssets(doc, compilerSettings, defaults);
    const connectConstraints = parseConnectConstraints(mujocoElement);
    const jointEqualityConstraints = parseJointEqualityConstraints(mujocoElement);
    const keyframes = parseKeyframes(mujocoElement);
    const worldbodyElements = directChildren(mujocoElement, 'worldbody');
    if (worldbodyElements.length === 0) {
      console.error('[MJCF] No <worldbody> element found');
      return rememberParsedModel(xmlContent, null, 'No <worldbody> element found.');
    }
    const jointIndexRef = { value: 0 };

    const worldBody: MJCFModelBody = {
      name: 'world',
      sourceName: 'world',
      pos: [0, 0, 0],
      geoms: [],
      sites: [],
      joints: [],
      children: [],
    };
    const { actuatorMap, tendonActuators } = parseActuatorData(
      mujocoElement,
      defaults,
      compilerSettings,
    );
    const tendonMap = parseTendonMap(mujocoElement, defaults, compilerSettings);

    worldbodyElements.forEach((worldbodyElement) => {
      worldBody.geoms.push(
        ...collectGeomsInBodyOrder(
          worldbodyElement,
          defaults,
          undefined,
          compilerSettings,
          'world',
          { value: worldBody.geoms.length },
          recovery,
        ),
      );
      worldBody.sites.push(
        ...collectSitesInBodyOrder(
          worldbodyElement,
          defaults,
          undefined,
          compilerSettings,
          'world',
          { value: worldBody.sites.length },
          recovery,
        ),
      );
      worldBody.joints.push(
        ...collectJointsInBodyOrder(
          worldbodyElement,
          defaults,
          undefined,
          compilerSettings,
          jointIndexRef,
          recovery,
          'world',
        ),
      );
      worldBody.children.push(
        ...collectBodiesInBodyOrder(
          worldbodyElement,
          defaults,
          undefined,
          compilerSettings,
          'world',
          jointIndexRef,
          { value: worldBody.children.length },
          recovery,
        ),
      );
    });

    omitUnresolvableGeomReferences({
      body: worldBody,
      meshMap,
      hfieldMap,
      materialMap,
      recovery,
    });
    omitDuplicateTopologyNames(worldBody, recovery);
    if (!hasUsableMJCFBody(worldBody)) {
      return rememberParsedModel(xmlContent, null, 'No usable MJCF body or world geometry found.');
    }

    return rememberParsedModel(
      xmlContent,
      {
        modelName: mujocoElement.getAttribute('model') || 'mjcf_robot',
        compilerSettings,
        defaults,
        meshMap,
        hfieldMap,
        materialMap,
        textureMap,
        actuatorMap,
        tendonActuators,
        tendonMap,
        connectConstraints,
        jointEqualityConstraints,
        keyframes,
        worldBody,
        recoveryDiagnostics: recovery.diagnostics,
      },
      null,
    );
  } catch (error) {
    console.error('[MJCF] Failed to parse MJCF model:', error);
    return rememberParsedModel(
      xmlContent,
      null,
      error instanceof Error ? error.message : 'Unknown MJCF parse error.',
    );
  }
}
