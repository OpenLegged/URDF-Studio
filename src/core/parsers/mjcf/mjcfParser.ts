/**
 * MJCF (MuJoCo XML) Parser
 * Parses MuJoCo XML format and converts to RobotState
 */

import * as THREE from 'three';
import {
  RobotState,
  UrdfLink,
  UrdfJoint,
  DEFAULT_LINK,
  DEFAULT_JOINT,
  GeometryType,
  JointType,
  UrdfMjcfSite,
  UrdfVisual,
} from '@/types';
import {
  computeLinkWorldMatrices,
  solveClosedLoopMotionCompensation,
} from '@/core/robot';
import {
  looksLikeMJCFDocument,
  type MJCFCompilerSettings,
  type MJCFHfield,
  type MJCFMaterial,
  type MJCFMesh,
  type MJCFTexture,
} from './mjcfUtils';
import { assignMJCFBodyGeomRoles, classifyMJCFGeom } from './mjcfGeomClassification';
import { buildMjcfCubeAuthoredMaterials, getMjcfCubeTextureFaceRecord } from './mjcfCubeTextures';
import { buildClosedLoopConstraints } from './mjcfClosedLoops';
import { createEmptyLinkInertial, deriveGeomMassInertial } from './mjcfInertial';
import { applyInitialPoseKeyframe } from './mjcfKeyframePose';
import {
  isNonZeroPosition,
  rotateLocalOffsetToParentFrame,
  subtractLocalOffset,
  toPositionObject,
  toQuatObject,
  toRPYObjectFromQuat,
} from './mjcfMath';
import {
  clearParsedMJCFModelCache,
  normalizeMultiJointBodies,
  parseMJCFModel,
  type MJCFModelJointEqualityConstraint,
  type MJCFModelTendonAttachment,
  type ParsedMJCFModel,
} from './mjcfModel';

interface MJCFBody {
  name: string;
  pos: { x: number; y: number; z: number };
  euler?: { r: number; p: number; y: number };
  quat?: { w: number; x: number; y: number; z: number };
  geoms: MJCFGeom[];
  sites?: MJCFSite[];
  joints: MJCFJointDef[];
  inertial?: MJCFInertial;
  children: MJCFBody[];
}

interface MJCFGeom {
  name?: string;
  sourceName?: string;
  className?: string;
  classQName?: string;
  type: string;
  size?: number[];
  mass?: number;
  mesh?: string;
  hfield?: string;
  material?: string;
  rgba?: number[];
  hasExplicitRgba?: boolean;
  pos?: { x: number; y: number; z: number };
  quat?: { w: number; x: number; y: number; z: number };
  fromto?: number[];
  contype?: number;
  conaffinity?: number;
  group?: number;
}

interface MJCFLinkPair {
  visual: MJCFGeom | null;
  collision: MJCFGeom | null;
}

interface MJCFJointDef {
  name: string;
  type: string;
  axis?: { x: number; y: number; z: number };
  range?: [number, number];
  ref?: number;
  pos?: { x: number; y: number; z: number };
  limited?: boolean;
  damping?: number;
  frictionloss?: number;
  armature?: number;
  stiffness?: number;
  actuatorForceRange?: [number, number];
  actuatorForceLimited?: boolean;
}

interface MJCFSite {
  name: string;
  sourceName?: string;
  type: string;
  size?: number[];
  rgba?: [number, number, number, number];
  pos?: { x: number; y: number; z: number };
  quat?: { w: number; x: number; y: number; z: number };
  group?: number;
}

interface MJCFActuator {
  name: string;
  type: string;
  joint?: string;
  ctrlrange?: [number, number];
  forcerange?: [number, number];
  gear?: number[];
}

interface MJCFInertial {
  mass: number;
  pos: { x: number; y: number; z: number };
  quat?: { w: number; x: number; y: number; z: number };
  diaginertia?: { ixx: number; iyy: number; izz: number };
  fullinertia?: number[]; // ixx iyy izz ixy ixz iyz
}

function buildHfieldDimensions(
  hfieldAsset: MJCFHfield | undefined,
  geomSize: number[] | undefined,
): { x: number; y: number; z: number } {
  const size =
    hfieldAsset?.size && hfieldAsset.size.length >= 4
      ? hfieldAsset.size
      : geomSize && geomSize.length >= 4
        ? ([geomSize[0] ?? 1, geomSize[1] ?? 1, geomSize[2] ?? 0, geomSize[3] ?? 0] as [
            number,
            number,
            number,
            number,
          ])
        : undefined;

  if (!size) {
    return { x: 1, y: 1, z: 0 };
  }

  return {
    x: (size[0] ?? 1) * 2,
    y: (size[1] ?? 1) * 2,
    z: (size[2] ?? 0) + (size[3] ?? 0),
  };
}

function cloneMjcfMeshAsset(meshAsset: MJCFMesh): NonNullable<UrdfVisual['mjcfMesh']> {
  return {
    name: meshAsset.name,
    ...(meshAsset.file ? { file: meshAsset.file } : {}),
    ...(meshAsset.vertices?.length ? { vertices: [...meshAsset.vertices] } : {}),
    ...(meshAsset.scale && meshAsset.scale.length >= 3
      ? {
          scale: [meshAsset.scale[0] ?? 1, meshAsset.scale[1] ?? 1, meshAsset.scale[2] ?? 1],
        }
      : {}),
    ...(meshAsset.refpos && meshAsset.refpos.length >= 3
      ? {
          refpos: [meshAsset.refpos[0] ?? 0, meshAsset.refpos[1] ?? 0, meshAsset.refpos[2] ?? 0],
        }
      : {}),
    ...(meshAsset.refquat && meshAsset.refquat.length >= 4
      ? {
          refquat: [
            meshAsset.refquat[0] ?? 1,
            meshAsset.refquat[1] ?? 0,
            meshAsset.refquat[2] ?? 0,
            meshAsset.refquat[3] ?? 0,
          ],
        }
      : {}),
  };
}

function convertJointType(
  mjcfType: string,
  range?: [number, number],
  limited?: boolean,
): JointType {
  switch (mjcfType.toLowerCase()) {
    case 'hinge':
      return limited === false || !range ? JointType.CONTINUOUS : JointType.REVOLUTE;
    case 'slide':
      return JointType.PRISMATIC;
    case 'ball':
      return JointType.BALL;
    case 'free':
      return JointType.FLOATING;
    default:
      return JointType.FIXED;
  }
}

function convertGeomType(mjcfType: string): GeometryType {
  switch (mjcfType.toLowerCase()) {
    case 'box':
      return GeometryType.BOX;
    case 'plane':
      return GeometryType.PLANE;
    case 'sphere':
      return GeometryType.SPHERE;
    case 'cylinder':
      return GeometryType.CYLINDER;
    case 'capsule':
      return GeometryType.CAPSULE;
    case 'ellipsoid':
      return GeometryType.ELLIPSOID;
    case 'hfield':
      return GeometryType.HFIELD;
    case 'sdf':
      return GeometryType.SDF;
    case 'mesh':
      return GeometryType.MESH;
    default:
      return GeometryType.NONE;
  }
}

function hasImportableGeometry(geom: MJCFGeom): boolean {
  if (geom.mesh) {
    return true;
  }

  return convertGeomType(geom.type) !== GeometryType.NONE;
}

function shouldPreserveSyntheticWorldRoot(worldBody: MJCFBody): boolean {
  if (worldBody.inertial && worldBody.inertial.mass > 0) {
    return true;
  }

  if (worldBody.joints.length > 0) {
    return true;
  }

  if (worldBody.geoms.some(hasImportableGeometry)) {
    return true;
  }

  if (worldBody.children.length !== 1) {
    return true;
  }

  const [onlyChild] = worldBody.children;
  if (onlyChild.joints.length > 0) {
    return true;
  }

  if (isNonZeroPosition(onlyChild.pos)) {
    return true;
  }

  const rootRotation = onlyChild.euler || toRPYObjectFromQuat(onlyChild.quat);
  return (
    !!rootRotation &&
    (Math.abs(rootRotation.r) > 1e-9 ||
      Math.abs(rootRotation.p) > 1e-9 ||
      Math.abs(rootRotation.y) > 1e-9)
  );
}

function convertAngle(value: number, settings: MJCFCompilerSettings): number {
  return settings.angleUnit === 'degree' ? value * (Math.PI / 180) : value;
}

function convertJointRange(
  range: [number, number] | undefined,
  _mjcfType: string | undefined,
  _settings: MJCFCompilerSettings,
): [number, number] | undefined {
  return range;
}

function toEffortMagnitude(range: [number, number] | undefined): number | undefined {
  if (!range) {
    return undefined;
  }

  const lower = range[0];
  const upper = range[1];
  if (!Number.isFinite(lower) || !Number.isFinite(upper)) {
    return undefined;
  }

  return Math.max(Math.abs(lower), Math.abs(upper));
}

function pickMaxDefined(values: Array<number | undefined>): number | undefined {
  let maxValue: number | undefined;
  values.forEach((value) => {
    if (value == null || !Number.isFinite(value)) {
      return;
    }

    maxValue = maxValue == null ? value : Math.max(maxValue, value);
  });

  return maxValue;
}

function resolveJointMechanicalRange(
  joint: MJCFJointDef | undefined,
  jointType: JointType,
): [number, number] | undefined {
  if (!joint?.range) {
    return undefined;
  }

  if (
    jointType === JointType.CONTINUOUS ||
    jointType === JointType.BALL ||
    joint.limited === false
  ) {
    return undefined;
  }

  return joint.range;
}

function resolveJointEffortLimit(
  joint: MJCFJointDef | undefined,
  actuators: MJCFActuator[] | undefined,
): number | undefined {
  if (joint?.actuatorForceLimited !== false) {
    const jointActuatorForce = toEffortMagnitude(joint?.actuatorForceRange);
    if (jointActuatorForce != null) {
      return jointActuatorForce;
    }
  }

  const actuatorForce = pickMaxDefined(
    (actuators || []).map((actuator) => toEffortMagnitude(actuator.forcerange)),
  );
  if (actuatorForce != null) {
    return actuatorForce;
  }

  const motorControlLimit = pickMaxDefined(
    (actuators || [])
      .filter((actuator) => actuator.type.toLowerCase() === 'motor')
      .map((actuator) => toEffortMagnitude(actuator.ctrlrange)),
  );
  return motorControlLimit;
}

function buildImportedJointLimit(
  jointType: JointType,
  range: [number, number] | undefined,
  effort: number | undefined,
): NonNullable<UrdfJoint['limit']> | undefined {
  if (
    jointType === JointType.FIXED ||
    jointType === JointType.FLOATING ||
    jointType === JointType.BALL
  ) {
    return undefined;
  }

  const lower = range?.[0];
  const upper = range?.[1];
  const limit: NonNullable<UrdfJoint['limit']> = {
    ...(Number.isFinite(lower) ? { lower: Number(lower) } : {}),
    ...(Number.isFinite(upper) ? { upper: Number(upper) } : {}),
    ...(Number.isFinite(effort) ? { effort: Number(effort) } : {}),
  };

  return Object.keys(limit).length > 0 ? limit : undefined;
}

function resolveJointInitialAngle(
  joint: MJCFJointDef | undefined,
  jointType: JointType,
): number | undefined {
  if (!joint || !Number.isFinite(joint.ref)) {
    return undefined;
  }

  if (
    jointType === JointType.REVOLUTE ||
    jointType === JointType.CONTINUOUS ||
    jointType === JointType.PRISMATIC
  ) {
    return joint.ref;
  }

  return undefined;
}

function rgbaToHexColor(rgba: number[]): string | null {
  if (rgba.length < 3) {
    return null;
  }

  const [r, g, b, a] = rgba;
  if (![r, g, b].every((value) => Number.isFinite(value))) {
    return null;
  }

  const toHexChannel = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value * 255)))
      .toString(16)
      .padStart(2, '0');

  const rgbHex = `${toHexChannel(r)}${toHexChannel(g)}${toHexChannel(b)}`;
  if (!Number.isFinite(a) || a >= 0.999) {
    return `#${rgbHex}`;
  }

  return `#${rgbHex}${toHexChannel(a)}`;
}

function rgbaToColorRgbaTuple(
  rgba: number[] | undefined,
): [number, number, number, number] | undefined {
  if (!rgba || rgba.length < 3) {
    return undefined;
  }

  const [r, g, b, a = 1] = rgba;
  if (![r, g, b, a].every((value) => Number.isFinite(value))) {
    return undefined;
  }

  const clamp = (value: number) => Math.max(0, Math.min(1, Number(value)));
  return [clamp(r), clamp(g), clamp(b), clamp(a)];
}

function toRPYObjectFromEulerTuple(
  tuple: [number, number, number] | undefined,
  settings: MJCFCompilerSettings,
): { r: number; p: number; y: number } | undefined {
  if (!tuple) {
    return undefined;
  }

  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      convertAngle(tuple[0] ?? 0, settings),
      convertAngle(tuple[1] ?? 0, settings),
      convertAngle(tuple[2] ?? 0, settings),
    ),
  );

  return toRPYObjectFromQuat({
    w: quaternion.w,
    x: quaternion.x,
    y: quaternion.y,
    z: quaternion.z,
  });
}

function toParserBody(sharedBody: any, settings: MJCFCompilerSettings): MJCFBody {
  return {
    name: sharedBody.name,
    pos: toPositionObject(sharedBody.pos),
    euler: toRPYObjectFromEulerTuple(sharedBody.euler, settings),
    quat: toQuatObject(sharedBody.quat),
    geoms: (sharedBody.geoms || []).map((geom: any) => ({
      name: geom.sourceName || geom.name,
      sourceName: geom.sourceName,
      className: geom.className,
      classQName: geom.classQName,
      type: geom.type,
      size: geom.size,
      mass: typeof geom.mass === 'number' ? geom.mass : undefined,
      mesh: geom.mesh,
      hfield: geom.hfield,
      material: geom.material,
      rgba: geom.rgba,
      hasExplicitRgba: geom.hasExplicitRgba,
      pos: geom.pos ? toPositionObject(geom.pos) : undefined,
      quat: toQuatObject(geom.quat),
      fromto: geom.fromto,
      contype: geom.contype,
      conaffinity: geom.conaffinity,
      group: geom.group,
    })),
    sites: (sharedBody.sites || []).map((site: any) => ({
      name: site.name,
      sourceName: site.sourceName,
      type: site.type,
      size: Array.isArray(site.size) ? [...site.size] : undefined,
      rgba: Array.isArray(site.rgba)
        ? ([...site.rgba] as [number, number, number, number])
        : undefined,
      pos: site.pos ? toPositionObject(site.pos) : undefined,
      quat: toQuatObject(site.quat),
      group: typeof site.group === 'number' ? site.group : undefined,
    })),
    joints: (sharedBody.joints || []).map((joint: any) => ({
      name: joint.name,
      type: joint.type,
      axis: joint.axis ? toPositionObject(joint.axis) : undefined,
      range: convertJointRange(joint.range, joint.type, settings),
      ref: typeof joint.ref === 'number' ? joint.ref : undefined,
      pos: joint.pos ? toPositionObject(joint.pos) : undefined,
      limited: typeof joint.limited === 'boolean' ? joint.limited : undefined,
      damping: typeof joint.damping === 'number' ? joint.damping : undefined,
      frictionloss: typeof joint.frictionloss === 'number' ? joint.frictionloss : undefined,
      armature: typeof joint.armature === 'number' ? joint.armature : undefined,
      stiffness: typeof joint.stiffness === 'number' ? joint.stiffness : undefined,
      actuatorForceRange: joint.actuatorForceRange,
      actuatorForceLimited:
        typeof joint.actuatorForceLimited === 'boolean' ? joint.actuatorForceLimited : undefined,
    })),
    inertial: sharedBody.inertial
      ? {
          mass: sharedBody.inertial.mass,
          pos: toPositionObject(sharedBody.inertial.pos),
          quat: toQuatObject(sharedBody.inertial.quat),
          diaginertia: sharedBody.inertial.diaginertia
            ? {
                ixx: sharedBody.inertial.diaginertia[0],
                iyy: sharedBody.inertial.diaginertia[1],
                izz: sharedBody.inertial.diaginertia[2],
              }
            : undefined,
          fullinertia: sharedBody.inertial.fullinertia,
        }
      : undefined,
    children: (sharedBody.children || []).map((child: any) => toParserBody(child, settings)),
  };
}

function toParserActuatorMap(
  sharedActuatorMap: Map<string, any[]> | undefined,
): Map<string, MJCFActuator[]> {
  const actuatorMap = new Map<string, MJCFActuator[]>();
  if (!sharedActuatorMap) {
    return actuatorMap;
  }

  sharedActuatorMap.forEach((actuators, jointName) => {
    actuatorMap.set(
      jointName,
      (actuators || []).map((actuator) => ({
        name: actuator.name,
        type: actuator.type,
        joint: actuator.joint,
        ctrlrange: actuator.ctrlrange,
        forcerange: actuator.forcerange,
        gear: actuator.gear,
      })),
    );
  });

  return actuatorMap;
}

function applyJointEqualityMimics(
  robot: Pick<RobotState, 'joints'>,
  jointEqualityConstraints: MJCFModelJointEqualityConstraint[],
): void {
  jointEqualityConstraints.forEach((constraint) => {
    const joint1 = robot.joints[constraint.joint1];
    const joint2 = robot.joints[constraint.joint2];
    if (!joint1 || !joint2) {
      return;
    }

    const [, multiplier = 1, quadratic = 0, cubic = 0, quartic = 0] = constraint.polycoef;
    if (Math.abs(quadratic) > 1e-9 || Math.abs(cubic) > 1e-9 || Math.abs(quartic) > 1e-9) {
      return;
    }

    const joint1Reference = Number.isFinite(joint1.referencePosition)
      ? joint1.referencePosition!
      : 0;
    const joint2Reference = Number.isFinite(joint2.referencePosition)
      ? joint2.referencePosition!
      : 0;
    const offset = joint1Reference + constraint.polycoef[0] - multiplier * joint2Reference;

    joint1.mimic = {
      joint: joint2.id,
      multiplier,
      offset,
    };
  });
}

function applySolvedClosedLoopInitialPose(
  robot: Pick<RobotState, 'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'>,
  actuatorMap: Map<string, MJCFActuator[]>,
): void {
  if (!robot.closedLoopConstraints || robot.closedLoopConstraints.length === 0) {
    return;
  }

  const lockedActuatedJointIds = Array.from(actuatorMap.keys()).filter((jointId) =>
    Boolean(robot.joints[jointId]),
  );
  const lockedSolution = solveClosedLoopMotionCompensation(robot, {
    lockedJointIds: lockedActuatedJointIds,
  });
  const solution =
    lockedSolution.converged || lockedActuatedJointIds.length === 0
      ? lockedSolution
      : solveClosedLoopMotionCompensation(robot);

  if (!solution.converged) {
    return;
  }

  Object.entries(solution.angles).forEach(([jointId, angle]) => {
    const joint = robot.joints[jointId];
    if (joint && Number.isFinite(angle)) {
      joint.angle = angle;
    }
  });

  Object.entries(solution.quaternions).forEach(([jointId, quaternion]) => {
    const joint = robot.joints[jointId];
    if (!joint) {
      return;
    }

    const length = Math.hypot(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    if (length <= 1e-12) {
      return;
    }

    joint.quaternion = {
      x: quaternion.x / length,
      y: quaternion.y / length,
      z: quaternion.z / length,
      w: quaternion.w / length,
    };
  });
}

function refreshClosedLoopAnchorWorlds(
  robot: Pick<RobotState, 'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'>,
): void {
  if (!robot.closedLoopConstraints || robot.closedLoopConstraints.length === 0) {
    return;
  }

  const linkWorldMatrices = computeLinkWorldMatrices(robot);

  robot.closedLoopConstraints = robot.closedLoopConstraints.map((constraint) => {
    const linkMatrix = linkWorldMatrices[constraint.linkAId];
    if (!linkMatrix) {
      return constraint;
    }

    const anchorWorld = new THREE.Vector3(
      constraint.anchorLocalA.x,
      constraint.anchorLocalA.y,
      constraint.anchorLocalA.z,
    ).applyMatrix4(linkMatrix);

    return {
      ...constraint,
      anchorWorld: {
        x: anchorWorld.x,
        y: anchorWorld.y,
        z: anchorWorld.z,
      },
    };
  });
}

function buildMjcfInspectionContext(
  parsedModel: ParsedMJCFModel,
): NonNullable<RobotState['inspectionContext']> {
  const bodiesWithSites: NonNullable<
    NonNullable<RobotState['inspectionContext']>['mjcf']
  >['bodiesWithSites'] = [];
  let siteCount = 0;

  const visitBody = (body: ParsedMJCFModel['worldBody']): void => {
    const bodySites = body.sites || [];
    if (bodySites.length > 0) {
      bodiesWithSites.push({
        bodyId: body.name,
        siteCount: bodySites.length,
        siteNames: bodySites.map((site) => site.name),
      });
      siteCount += bodySites.length;
    }

    (body.children || []).forEach(visitBody);
  };

  visitBody(parsedModel.worldBody);

  const tendonActuatorNamesByTendon = new Map<string, string[]>();
  parsedModel.tendonActuators.forEach((actuator) => {
    if (!actuator.tendon) {
      return;
    }

    const names = tendonActuatorNamesByTendon.get(actuator.tendon) || [];
    names.push(actuator.name);
    tendonActuatorNamesByTendon.set(actuator.tendon, names);
  });

  const resolveTendonVisualizationAttachmentRef = (
    attachment: MJCFModelTendonAttachment,
  ): string | undefined => {
    return attachment.ref || attachment.sidesite;
  };

  return {
    sourceFormat: 'mjcf',
    mjcf: {
      siteCount,
      tendonCount: parsedModel.tendonMap.size,
      tendonActuatorCount: parsedModel.tendonActuators.length,
      bodiesWithSites,
      tendons: Array.from(parsedModel.tendonMap.values()).map((tendon) => ({
        className: tendon.className,
        group: tendon.group,
        name: tendon.name,
        type: tendon.type,
        limited: tendon.limited,
        range: tendon.range,
        width: tendon.width,
        stiffness: tendon.stiffness,
        springlength: tendon.springlength,
        rgba: tendon.rgba,
        attachmentRefs: tendon.attachments
          .map(resolveTendonVisualizationAttachmentRef)
          .filter((value): value is string => typeof value === 'string' && value.length > 0),
        attachments: tendon.attachments.map((attachment) => ({
          type: attachment.type,
          ref: attachment.ref,
          sidesite: attachment.sidesite,
          divisor: attachment.divisor,
          coef: attachment.coef,
        })),
        actuatorNames: tendonActuatorNamesByTendon.get(tendon.name) || [],
      })),
    },
  };
}

// Convert parsed MJCF to RobotState
function mjcfToRobotState(
  robotName: string,
  bodies: MJCFBody[],
  meshMap: Map<string, MJCFMesh>,
  hfieldMap: Map<string, MJCFHfield>,
  materialMap: Map<string, MJCFMaterial>,
  textureMap: Map<string, MJCFTexture>,
  actuatorMap: Map<string, MJCFActuator[]>,
): RobotState {
  const links: Record<string, UrdfLink> = {};
  const joints: Record<string, UrdfJoint> = {};
  const materials: NonNullable<RobotState['materials']> = {};
  let rootLinkId = '';
  let linkCounter = 0;

  function resolveGeomMaterialState(
    geom: MJCFGeom,
  ): { color?: string; colorRgba?: [number, number, number, number]; texture?: string } | null {
    const materialDef = geom.material ? materialMap.get(geom.material) : undefined;
    const texturePath = materialDef?.texture
      ? textureMap.get(materialDef.texture)?.file
      : undefined;

    const explicitGeomRgba =
      geom.hasExplicitRgba && geom.rgba && geom.rgba.length >= 3 ? geom.rgba : undefined;
    const materialRgba =
      materialDef?.rgba && materialDef.rgba.length >= 3 ? materialDef.rgba : undefined;
    const inheritedGeomRgba = geom.rgba && geom.rgba.length >= 3 ? geom.rgba : undefined;
    const resolvedRgba = explicitGeomRgba ?? materialRgba ?? inheritedGeomRgba;
    const resolvedColor = resolvedRgba ? rgbaToHexColor(resolvedRgba) || undefined : undefined;
    const resolvedColorRgba = rgbaToColorRgbaTuple(resolvedRgba);

    // MJCF textures use white as the neutral color multiplier when rgba is absent.
    const neutralTextureColor = texturePath ? '#ffffff' : undefined;
    const color = resolvedColor ?? neutralTextureColor;

    if (!color && !texturePath) {
      return null;
    }

    return {
      ...(color ? { color } : {}),
      ...(resolvedColorRgba ? { colorRgba: resolvedColorRgba } : {}),
      ...(texturePath ? { texture: texturePath } : {}),
    };
  }

  function resolveGeomAuthoredMaterials(geom: MJCFGeom): UrdfVisual['authoredMaterials'] {
    const materialDef = geom.material ? materialMap.get(geom.material) : undefined;
    const textureDef = materialDef?.texture ? textureMap.get(materialDef.texture) : undefined;
    const cubeFaceRecord =
      geom.type?.toLowerCase() === 'box' ? getMjcfCubeTextureFaceRecord(textureDef) : null;

    const explicitGeomRgba =
      geom.hasExplicitRgba && geom.rgba && geom.rgba.length >= 3 ? geom.rgba : undefined;
    const materialRgba =
      materialDef?.rgba && materialDef.rgba.length >= 3 ? materialDef.rgba : undefined;
    const inheritedGeomRgba = geom.rgba && geom.rgba.length >= 3 ? geom.rgba : undefined;
    const resolvedRgba = explicitGeomRgba ?? materialRgba ?? inheritedGeomRgba;
    const sharedColor = resolvedRgba ? rgbaToHexColor(resolvedRgba) || undefined : undefined;
    const sharedColorRgba = rgbaToColorRgbaTuple(resolvedRgba);

    if (cubeFaceRecord) {
      return buildMjcfCubeAuthoredMaterials(cubeFaceRecord, sharedColor, sharedColorRgba);
    }

    const texturePath = textureDef?.file;
    if (!sharedColor && !texturePath) {
      return undefined;
    }

    return [
      {
        ...(geom.material ? { name: geom.material } : {}),
        ...(sharedColor ? { color: sharedColor } : {}),
        ...(sharedColorRgba ? { colorRgba: sharedColorRgba } : {}),
        ...(texturePath ? { texture: texturePath } : {}),
        ...(Number.isFinite(materialDef?.shininess)
          ? { roughness: Math.max(0, Math.min(1, 1 - Number(materialDef!.shininess))) }
          : {}),
        ...(Number.isFinite(materialDef?.reflectance)
          ? { metalness: Math.max(0, Math.min(1, Number(materialDef!.reflectance))) }
          : {}),
        ...(Number.isFinite(materialDef?.emission) && sharedColor
          ? {
              emissive: sharedColor,
              emissiveIntensity: Math.max(0, Number(materialDef!.emission)),
            }
          : {}),
      },
    ];
  }

  function assignLinkMaterial(linkId: string, geom: MJCFGeom | null | undefined): void {
    if (!geom) {
      return;
    }

    const materialState = resolveGeomMaterialState(geom);
    if (!materialState) {
      return;
    }

    materials[linkId] = materialState;
  }

  function buildImplicitFixedJointId(parentLinkId: string, childLinkId: string): string {
    const baseId = `${parentLinkId}_to_${childLinkId}`;
    let candidate = baseId;
    let suffix = 2;

    while (joints[candidate]) {
      candidate = `${baseId}_${suffix++}`;
    }

    return candidate;
  }

  function processGeometry(
    geom: MJCFGeom,
    linkFrameOffsetLocal: { x: number; y: number; z: number } | null = null,
  ): UrdfVisual {
    const result: UrdfVisual = { ...DEFAULT_LINK.visual };
    if (geom.name?.trim()) {
      result.name = geom.name.trim();
    }
    const convertedType = convertGeomType(geom.type);
    const hasExplicitPrimitiveParams = Boolean(
      (geom.size && geom.size.length > 0) || (geom.fromto && geom.fromto.length >= 6),
    );
    const isMeshBackedPrimitiveWithoutResolvedFit = Boolean(
      geom.mesh &&
      !hasExplicitPrimitiveParams &&
      (convertedType === GeometryType.BOX ||
        convertedType === GeometryType.SPHERE ||
        convertedType === GeometryType.PLANE ||
        convertedType === GeometryType.ELLIPSOID ||
        convertedType === GeometryType.CYLINDER ||
        convertedType === GeometryType.CAPSULE),
    );
    result.type =
      convertedType === GeometryType.NONE && geom.mesh
        ? GeometryType.MESH
        : isMeshBackedPrimitiveWithoutResolvedFit
          ? GeometryType.MESH
          : convertedType;

    if (geom.mesh && meshMap.has(geom.mesh)) {
      const meshDef = meshMap.get(geom.mesh)!;
      result.mjcfMesh = cloneMjcfMeshAsset(meshDef);
      if (meshDef.file) {
        result.meshPath = meshDef.file;
      } else {
        result.assetRef = geom.mesh;
      }
      const scale = meshDef.scale;
      if (scale && scale.length >= 3) {
        result.dimensions = { x: scale[0], y: scale[1], z: scale[2] };
      } else {
        result.dimensions = { x: 1, y: 1, z: 1 };
      }
    } else if (geom.mesh) {
      result.meshPath = geom.mesh;
      result.dimensions = { x: 1, y: 1, z: 1 };
    }

    if (result.type === GeometryType.HFIELD) {
      result.assetRef = geom.hfield;
      const hfieldAsset = geom.hfield ? hfieldMap.get(geom.hfield) : undefined;
      if (hfieldAsset) {
        result.mjcfHfield = {
          name: hfieldAsset.name,
          file: hfieldAsset.file,
          contentType: hfieldAsset.contentType,
          nrow: hfieldAsset.nrow,
          ncol: hfieldAsset.ncol,
          size: hfieldAsset.size
            ? {
                radiusX: hfieldAsset.size[0] ?? 0,
                radiusY: hfieldAsset.size[1] ?? 0,
                elevationZ: hfieldAsset.size[2] ?? 0,
                baseZ: hfieldAsset.size[3] ?? 0,
              }
            : undefined,
          elevation: hfieldAsset.elevation ? [...hfieldAsset.elevation] : undefined,
        };
      }
    } else if (result.type === GeometryType.SDF) {
      result.assetRef = geom.mesh;
    }

    if (geom.size && geom.size.length > 0) {
      const geomType = geom.type?.toLowerCase() || 'sphere';
      switch (geomType) {
        case 'box':
          result.dimensions = {
            x: (geom.size[0] || 0.1) * 2,
            y: ((geom.size[1] ?? geom.size[0]) || 0.1) * 2,
            z: ((geom.size[2] ?? geom.size[0]) || 0.1) * 2,
          };
          break;
        case 'sphere':
          result.dimensions = { x: geom.size[0] || 0.1, y: 0, z: 0 };
          break;
        case 'plane':
          result.dimensions = {
            x: ((geom.size[0] ?? 1) || 1) * 2,
            y: ((geom.size[1] ?? geom.size[0] ?? 1) || 1) * 2,
            z: 0,
          };
          break;
        case 'ellipsoid':
          result.dimensions = {
            x: geom.size[0] || 0.1,
            y: (geom.size[1] ?? geom.size[0]) || 0.1,
            z: (geom.size[2] ?? geom.size[0]) || 0.1,
          };
          break;
        case 'cylinder':
        case 'capsule':
          result.dimensions = {
            x: geom.size[0] || 0.1,
            y: (geom.size[1] || 0.1) * 2,
            z: 0,
          };
          break;
        case 'hfield':
          result.dimensions = buildHfieldDimensions(
            geom.hfield ? hfieldMap.get(geom.hfield) : undefined,
            geom.size,
          );
          break;
        case 'sdf':
          result.dimensions = {
            x: geom.size[0] || 1,
            y: (geom.size[1] ?? geom.size[0]) || 1,
            z: (geom.size[2] ?? 0) || 0,
          };
          break;
        default:
          result.dimensions = { x: geom.size[0] || 0.1, y: 0, z: 0 };
          break;
      }
    } else if (!geom.mesh) {
      switch (result.type) {
        case GeometryType.PLANE:
          result.dimensions = { x: 2, y: 2, z: 0 };
          break;
        case GeometryType.HFIELD:
          result.dimensions = buildHfieldDimensions(
            geom.hfield ? hfieldMap.get(geom.hfield) : undefined,
            geom.size,
          );
          break;
        case GeometryType.SDF:
          result.dimensions = { x: 1, y: 1, z: 0 };
          break;
        default:
          result.dimensions = { x: 0.05, y: 0, z: 0 };
          break;
      }
    }

    const materialState = resolveGeomMaterialState(geom);
    if (materialState?.color) {
      result.color = materialState.color;
    }
    const authoredMaterials = resolveGeomAuthoredMaterials(geom);
    if (authoredMaterials && authoredMaterials.length > 0) {
      result.authoredMaterials = authoredMaterials;
    }

    const geomRotation = toRPYObjectFromQuat(geom.quat);
    const hasMeaningfulRotation =
      !!geomRotation &&
      (Math.abs(geomRotation.r) > 1e-9 ||
        Math.abs(geomRotation.p) > 1e-9 ||
        Math.abs(geomRotation.y) > 1e-9);
    const geomPosition = subtractLocalOffset(geom.pos, linkFrameOffsetLocal);

    if (geomPosition || hasMeaningfulRotation) {
      result.origin = {
        xyz: {
          x: geomPosition?.x ?? 0,
          y: geomPosition?.y ?? 0,
          z: geomPosition?.z ?? 0,
        },
        rpy: geomRotation || { r: 0, p: 0, y: 0 },
      };
    }

    return result;
  }

  function processBody(body: MJCFBody, parentLinkId: string | null): string {
    const mainLinkId = body.name || `link_${linkCounter++}`;
    const bodyRotation = toRPYObjectFromQuat(body.quat) || body.euler || { r: 0, p: 0, y: 0 };
    const mjcfJoint = body.joints[0];
    const linkFrameOffsetLocal = isNonZeroPosition(mjcfJoint?.pos)
      ? {
          x: mjcfJoint!.pos!.x,
          y: mjcfJoint!.pos!.y,
          z: mjcfJoint!.pos!.z,
        }
      : null;
    const jointFrameOffsetInParent = rotateLocalOffsetToParentFrame(
      linkFrameOffsetLocal,
      bodyRotation,
    );

    // 1. Classify Geoms
    const visuals: MJCFGeom[] = [];
    const collisions: MJCFGeom[] = [];
    const geomRoles = assignMJCFBodyGeomRoles(body.geoms);

    geomRoles.forEach(({ geom, renderVisual, renderCollision }) => {
      if (renderVisual) {
        visuals.push(geom);
      }
      if (renderCollision) {
        collisions.push(geom);
      }
    });

    // 2. Pair Visuals and Collisions
    const pairs: MJCFLinkPair[] = [];
    const usedCollisions = new Set<MJCFGeom>();

    // Pass 1: Match visuals to collisions (by mesh name match)
    for (const vis of visuals) {
      // Plain MuJoCo geoms often act as both visual and collision. Once such a geom has
      // already been consumed as the collision partner for an earlier visual geom, emitting
      // it again as a standalone visual creates the exact regression seen on HighTorque:
      // a base-link collision box gets duplicated into the visual tree.
      const visClassification = classifyMJCFGeom(vis);
      if (visClassification.isCollision && usedCollisions.has(vis)) {
        continue;
      }

      let matchIndex = -1;
      if (vis.mesh) {
        matchIndex = collisions.findIndex((c) => c.mesh === vis.mesh && !usedCollisions.has(c));
      } else if (vis.name) {
        matchIndex = collisions.findIndex((c) => c.name === vis.name && !usedCollisions.has(c));
      }

      // Fallback for Main Link (index 0): if no strict match, grab first available collision
      // Only if this is the very first visual we are processing for the body
      if (
        matchIndex === -1 &&
        pairs.length === 0 &&
        collisions.length > 0 &&
        !usedCollisions.has(collisions[0])
      ) {
        // Check if collision[0] is also nameless/meshless or generically compatible?
        // For G1: torso (mesh) matches torso (mesh).
        // For simple models, often 1 vis 1 col.
        matchIndex = 0;
      }

      let col: MJCFGeom | null = null;
      if (matchIndex !== -1) {
        col = collisions[matchIndex];
        usedCollisions.add(col);
      }
      pairs.push({ visual: vis, collision: col });
    }

    // Pass 2: Remaining collisions (create collision-only links)
    for (const col of collisions) {
      if (!usedCollisions.has(col)) {
        pairs.push({ visual: null, collision: col });
      }
    }

    // 3. Create Links
    // If no pairs (empty body), create a dummy pair to generate the link
    if (pairs.length === 0) {
      pairs.push({ visual: null, collision: null });
    }

    // Process Main Link (Index 0)
    const mainPair = pairs[0];

    let visual: UrdfVisual = { ...DEFAULT_LINK.visual };
    if (mainPair.visual) {
      visual = processGeometry(mainPair.visual, linkFrameOffsetLocal);
      assignLinkMaterial(mainLinkId, mainPair.visual);
    } else {
      visual.type = GeometryType.NONE;
    }

    let collision: UrdfVisual = { ...DEFAULT_LINK.collision };
    if (mainPair.collision) {
      const colGeo = processGeometry(mainPair.collision, linkFrameOffsetLocal);
      collision = {
        ...collision,
        ...(mainPair.collision.name?.trim() ? { name: mainPair.collision.name.trim() } : {}),
        type: colGeo.type,
        dimensions: colGeo.dimensions,
        origin: colGeo.origin,
        meshPath: colGeo.meshPath,
        assetRef: colGeo.assetRef,
        mjcfMesh: colGeo.mjcfMesh,
        mjcfHfield: colGeo.mjcfHfield,
      };
      if (colGeo.color) {
        collision.color = colGeo.color;
      }
    } else {
      collision.type = GeometryType.NONE;
    }

    let linkInertial = createEmptyLinkInertial();

    if (body.inertial) {
      const {
        mass,
        pos: inertialPos,
        quat: inertialQuat,
        diaginertia,
        fullinertia,
      } = body.inertial;
      const linkInertialPos = subtractLocalOffset(inertialPos, linkFrameOffsetLocal) || {
        x: 0,
        y: 0,
        z: 0,
      };
      linkInertial.mass = mass;
      linkInertial.origin = {
        xyz: { x: linkInertialPos.x, y: linkInertialPos.y, z: linkInertialPos.z },
        rpy: toRPYObjectFromQuat(inertialQuat) || { r: 0, p: 0, y: 0 },
      };
      if (fullinertia && fullinertia.length >= 6) {
        linkInertial.inertia = {
          ixx: fullinertia[0],
          iyy: fullinertia[1],
          izz: fullinertia[2],
          ixy: fullinertia[3],
          ixz: fullinertia[4],
          iyz: fullinertia[5],
        };
      } else if (diaginertia) {
        linkInertial.inertia = {
          ixx: diaginertia.ixx,
          ixy: 0,
          ixz: 0,
          iyy: diaginertia.iyy,
          iyz: 0,
          izz: diaginertia.izz,
        };
      }
    } else {
      const derivedGeomMassInertial = deriveGeomMassInertial(body.geoms);
      if (derivedGeomMassInertial) {
        if (linkFrameOffsetLocal && derivedGeomMassInertial.origin) {
          derivedGeomMassInertial.origin.xyz = subtractLocalOffset(
            derivedGeomMassInertial.origin.xyz,
            linkFrameOffsetLocal,
          ) || { x: 0, y: 0, z: 0 };
        }
        linkInertial = derivedGeomMassInertial;
      }
    }

    const mjcfSites = (body.sites || []).map((site): UrdfMjcfSite => {
      const rebasedPosition = subtractLocalOffset(site.pos, linkFrameOffsetLocal);

      return {
        name: site.name,
        ...(site.sourceName ? { sourceName: site.sourceName } : {}),
        type: site.type,
        ...(Array.isArray(site.size) ? { size: [...site.size] } : {}),
        ...(Array.isArray(site.rgba)
          ? { rgba: [...site.rgba] as [number, number, number, number] }
          : {}),
        ...(rebasedPosition
          ? {
              pos: [rebasedPosition.x, rebasedPosition.y, rebasedPosition.z] as [
                number,
                number,
                number,
              ],
            }
          : {}),
        ...(site.quat
          ? {
              quat: [site.quat.w, site.quat.x, site.quat.y, site.quat.z] as [
                number,
                number,
                number,
                number,
              ],
            }
          : {}),
        ...(typeof site.group === 'number' ? { group: site.group } : {}),
      };
    });

    const mainLink: UrdfLink = {
      ...DEFAULT_LINK,
      id: mainLinkId,
      name: body.name,
      visual,
      collision,
      inertial: linkInertial,
      ...(mjcfSites.length > 0 ? { mjcfSites } : {}),
    };
    links[mainLinkId] = mainLink;

    // Create Main Joint
    if (parentLinkId) {
      const jointId = mjcfJoint?.name || buildImplicitFixedJointId(parentLinkId, mainLinkId);
      const jointType = mjcfJoint
        ? convertJointType(mjcfJoint.type, mjcfJoint.range, mjcfJoint.limited)
        : JointType.FIXED;
      const jointMechanicalRange = resolveJointMechanicalRange(mjcfJoint, jointType);
      const jointEffort = resolveJointEffortLimit(mjcfJoint, actuatorMap.get(jointId));
      const jointLimit = buildImportedJointLimit(jointType, jointMechanicalRange, jointEffort);
      const jointInitialAngle = resolveJointInitialAngle(mjcfJoint, jointType);
      const jointOrigin = {
        xyz: {
          x: body.pos.x + (jointFrameOffsetInParent?.x ?? 0),
          y: body.pos.y + (jointFrameOffsetInParent?.y ?? 0),
          z: body.pos.z + (jointFrameOffsetInParent?.z ?? 0),
        },
        rpy: bodyRotation,
      };
      const joint: UrdfJoint = {
        ...DEFAULT_JOINT,
        id: jointId,
        name: jointId,
        type: jointType,
        parentLinkId: parentLinkId,
        childLinkId: mainLinkId,
        origin: jointOrigin,
        axis: mjcfJoint?.axis || { x: 0, y: 0, z: 1 },
        limit: jointLimit,
        dynamics: {
          ...DEFAULT_JOINT.dynamics,
          damping: mjcfJoint?.damping ?? DEFAULT_JOINT.dynamics.damping,
          friction: mjcfJoint?.frictionloss ?? DEFAULT_JOINT.dynamics.friction,
          ...(typeof mjcfJoint?.stiffness === 'number' ? { stiffness: mjcfJoint.stiffness } : {}),
        },
        ...(jointInitialAngle != null ? { referencePosition: jointInitialAngle } : {}),
        ...(jointInitialAngle != null ? { angle: jointInitialAngle } : {}),
        hardware: {
          ...DEFAULT_JOINT.hardware,
          armature: mjcfJoint?.armature ?? DEFAULT_JOINT.hardware.armature,
        },
      };
      joints[jointId] = joint;
    } else {
      rootLinkId = mainLinkId;
    }

    // Process remaining pairs (Pairs 1..N)
    for (let i = 1; i < pairs.length; i++) {
      const pair = pairs[i];

      // Preserve additional collision-only geoms on the same link. The rest of the stack
      // already understands `collisionBodies`, so emitting synthetic links here only makes
      // URDF exports drift away from the source MJCF topology.
      if (!pair.visual && pair.collision) {
        const colGeo = processGeometry(pair.collision, linkFrameOffsetLocal);
        const extraCollision: UrdfLink['collision'] = {
          ...DEFAULT_LINK.collision,
          ...(pair.collision.name?.trim() ? { name: pair.collision.name.trim() } : {}),
          type: colGeo.type,
          dimensions: colGeo.dimensions,
          origin: colGeo.origin,
          meshPath: colGeo.meshPath,
          assetRef: colGeo.assetRef,
          mjcfMesh: colGeo.mjcfMesh,
          mjcfHfield: colGeo.mjcfHfield,
        };

        if (colGeo.color) {
          extraCollision.color = colGeo.color;
        }

        mainLink.collisionBodies = [...(mainLink.collisionBodies || []), extraCollision];
        continue;
      }

      if (pair.visual) {
        const extraVisual = processGeometry(pair.visual, linkFrameOffsetLocal);
        mainLink.visualBodies = [...(mainLink.visualBodies || []), extraVisual];
      }

      if (pair.collision) {
        const colGeo = processGeometry(pair.collision, linkFrameOffsetLocal);
        const extraCollision: UrdfLink['collision'] = {
          ...DEFAULT_LINK.collision,
          ...(pair.collision.name?.trim() ? { name: pair.collision.name.trim() } : {}),
          type: colGeo.type,
          dimensions: colGeo.dimensions,
          origin: colGeo.origin,
          meshPath: colGeo.meshPath,
          assetRef: colGeo.assetRef,
          mjcfMesh: colGeo.mjcfMesh,
          mjcfHfield: colGeo.mjcfHfield,
        };
        if (colGeo.color) {
          extraCollision.color = colGeo.color;
        }

        mainLink.collisionBodies = [...(mainLink.collisionBodies || []), extraCollision];
      }
    }

    body.children.forEach((child) => processBody(child, mainLinkId));
    return mainLinkId;
  }

  bodies.forEach((body, index) => {
    const linkId = processBody(body, index === 0 ? null : rootLinkId);
    if (index === 0) rootLinkId = linkId;
  });

  if (!rootLinkId) {
    rootLinkId = 'base_link';
    links[rootLinkId] = { ...DEFAULT_LINK, id: rootLinkId, name: 'base_link' };
  }

  return {
    name: robotName,
    links,
    joints,
    rootLinkId,
    ...(Object.keys(materials).length > 0 ? { materials } : {}),
    selection: { type: 'link', id: rootLinkId },
  };
}

export function parseMJCF(xmlContent: string): RobotState | null {
  try {
    const parsedModel = parseMJCFModel(xmlContent);
    if (!parsedModel) {
      return null;
    }

    const parserModelWorldBody = normalizeMultiJointBodies(parsedModel.worldBody);
    const worldBody = toParserBody(parserModelWorldBody, parsedModel.compilerSettings);
    const rootBodies = shouldPreserveSyntheticWorldRoot(worldBody)
      ? [worldBody]
      : worldBody.children;

    const robot = mjcfToRobotState(
      parsedModel.modelName,
      rootBodies,
      parsedModel.meshMap,
      parsedModel.hfieldMap,
      parsedModel.materialMap,
      parsedModel.textureMap,
      toParserActuatorMap(parsedModel.actuatorMap),
    );

    applyJointEqualityMimics(robot, parsedModel.jointEqualityConstraints);
    robot.closedLoopConstraints = buildClosedLoopConstraints(
      robot,
      parsedModel.connectConstraints,
      parsedModel.tendonMap,
      parserModelWorldBody,
    );
    applyInitialPoseKeyframe(robot, worldBody, parsedModel.keyframes);
    applySolvedClosedLoopInitialPose(robot, parsedModel.actuatorMap);
    refreshClosedLoopAnchorWorlds(robot);
    robot.inspectionContext = buildMjcfInspectionContext(parsedModel);
    return robot;
  } finally {
    // The parsed model cache is only needed within a single top-level parse
    // call; retaining entire MJCF model trees across file switches keeps
    // old robots alive in memory for no runtime benefit.
    clearParsedMJCFModelCache(xmlContent);
  }
}

export function isMJCF(xmlContent: string): boolean {
  return looksLikeMJCFDocument(xmlContent);
}
