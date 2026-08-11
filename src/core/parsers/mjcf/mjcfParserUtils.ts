// Pure helpers and local types extracted from mjcfParser.ts
import * as THREE from 'three';
import { GeometryType, JointType, type RobotState, type UrdfJoint, type UrdfVisual } from '@/types';
import { computeLinkWorldMatrices, solveClosedLoopMotionCompensation } from '@/core/robot';
import { type MJCFCompilerSettings, type MJCFHfield, type MJCFMesh } from './mjcfUtils';
import { isNonZeroPosition, toPositionObject, toQuatObject, toRPYObjectFromQuat } from './mjcfMath';
import type {
  MJCFModelActuator,
  MJCFModelBody,
  MJCFModelJointEqualityConstraint,
  MJCFModelTendonAttachment,
  ParsedMJCFModel,
} from './mjcfModel';

export interface MJCFBody {
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

export interface MJCFGeom {
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
  rgba?: number[];
  hasExplicitRgba?: boolean;
  pos?: { x: number; y: number; z: number };
  quat?: { w: number; x: number; y: number; z: number };
  fromto?: number[];
  contype?: number;
  conaffinity?: number;
  group?: number;
}

export interface MJCFLinkPair {
  visual: MJCFGeom | null;
  collision: MJCFGeom | null;
}

export interface MJCFJointDef {
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

export interface MJCFSite {
  name: string;
  sourceName?: string;
  type: string;
  size?: number[];
  rgba?: [number, number, number, number];
  pos?: { x: number; y: number; z: number };
  quat?: { w: number; x: number; y: number; z: number };
  group?: number;
}

export interface MJCFActuator {
  name: string;
  type: string;
  joint?: string;
  ctrlrange?: [number, number];
  forcerange?: [number, number];
  gear?: number[];
}

export interface MJCFInertial {
  mass: number;
  pos: { x: number; y: number; z: number };
  quat?: { w: number; x: number; y: number; z: number };
  diaginertia?: { ixx: number; iyy: number; izz: number };
  fullinertia?: number[]; // ixx iyy izz ixy ixz iyz
}

export function buildHfieldDimensions(
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

export function cloneMjcfMeshAsset(meshAsset: MJCFMesh): NonNullable<UrdfVisual['mjcfMesh']> {
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

export function convertJointType(
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

export function convertGeomType(mjcfType: string): GeometryType {
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

export function hasImportableGeometry(geom: MJCFGeom): boolean {
  if (geom.mesh) {
    return true;
  }

  return convertGeomType(geom.type) !== GeometryType.NONE;
}

export function shouldPreserveSyntheticWorldRoot(worldBody: MJCFBody): boolean {
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

export function convertAngle(value: number, settings: MJCFCompilerSettings): number {
  return settings.angleUnit === 'degree' ? value * (Math.PI / 180) : value;
}

export function convertJointRange(
  range: [number, number] | undefined,
  _mjcfType: string | undefined,
  _settings: MJCFCompilerSettings,
): [number, number] | undefined {
  return range;
}

export function toEffortMagnitude(range: [number, number] | undefined): number | undefined {
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

export function pickMaxDefined(values: Array<number | undefined>): number | undefined {
  let maxValue: number | undefined;
  values.forEach((value) => {
    if (value == null || !Number.isFinite(value)) {
      return;
    }

    maxValue = maxValue == null ? value : Math.max(maxValue, value);
  });

  return maxValue;
}

export function resolveJointMechanicalRange(
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

export function resolveJointEffortLimit(
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

export function buildImportedJointLimit(
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

export function resolveJointInitialAngle(
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

export function rgbaToHexColor(rgba: number[]): string | null {
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

export function rgbaToColorRgbaTuple(
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

export function toRPYObjectFromEulerTuple(
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

export function toParserBody(sharedBody: MJCFModelBody, settings: MJCFCompilerSettings): MJCFBody {
  return {
    name: sharedBody.name,
    pos: toPositionObject(sharedBody.pos),
    euler: toRPYObjectFromEulerTuple(sharedBody.euler, settings),
    quat: toQuatObject(sharedBody.quat),
    geoms: (sharedBody.geoms || []).map((geom) => ({
      name: geom.sourceName || geom.name,
      sourceName: geom.sourceName,
      className: geom.className,
      classQName: geom.classQName,
      type: geom.type,
      size: geom.size,
      mass: typeof geom.mass === 'number' ? geom.mass : undefined,
      mesh: geom.mesh,
      fittedFromMesh: geom.fittedFromMesh,
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
    sites: (sharedBody.sites || []).map((site) => ({
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
    joints: (sharedBody.joints || []).map((joint) => ({
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
    children: (sharedBody.children || []).map((child) => toParserBody(child, settings)),
  };
}

export function toParserActuatorMap(
  sharedActuatorMap: Map<string, MJCFModelActuator[]> | undefined,
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

export function applyJointEqualityMimics(
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

export function applySolvedClosedLoopInitialPose(
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

export function refreshClosedLoopAnchorWorlds(
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

export function buildMjcfInspectionContext(
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
