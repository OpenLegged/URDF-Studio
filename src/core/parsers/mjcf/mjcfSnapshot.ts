import type { ParsedMJCFModel } from './mjcfModel';
import {
  buildGeneratedMjcfBodyPath,
  buildGeneratedMjcfGeomName,
  buildGeneratedMjcfJointName,
} from './mjcfGeneratedNames';
import {
  normalizeVector,
  normalizeUnitVector,
  normalizeQuatFromEuler,
  normalizeQuat,
  normalizePos,
  normalizeNumber,
  normalizeScale,
  normalizeGeomRGBA,
  canonicalizeFromToGeom,
  diagonalizeFullInertia,
  quaternionsEqual,
  axisymmetricGeomOrientationsEqual,
  normalizeRange,
  canonicalizeGeomSize,
  normalizeOracleJointType,
  normalizeOracleGeomType,
  normalizeMeshFile,
  bodyKeyFromName,
  jointKeyFromName,
  geomKeyFromName,
  normalizeOracleAngleUnit,
  nearlyEqual,
  arraysEqual,
  optionalMassesEqual,
  applyBoundInertia,
  geomMassesEqual,
  jointAxesEqual,
  rangesEqual,
  materialRGBAEqual,
  canonicalBodyInertiaTensor,
  type CanonicalMJCFBody,
  type CanonicalMJCFGeom,
} from './mjcfSnapshotHelpers';

export type { CanonicalMJCFBody, CanonicalMJCFGeom } from './mjcfSnapshotHelpers';

export interface CanonicalMJCFJoint {
  key: string;
  name: string | null;
  parentBodyKey: string;
  type: string;
  axis: [number, number, number] | null;
  range: [number, number] | null;
  pos: [number, number, number] | null;
}

export interface CanonicalMJCFMeshAsset {
  name: string;
  file: string | null;
  scale: number[];
  refpos: [number, number, number] | null;
  refquat: [number, number, number, number] | null;
}

export interface CanonicalMJCFMaterialAsset {
  name: string;
  rgba: [number, number, number, number] | null;
  emission: number | null;
}

export interface CanonicalMJCFSnapshot {
  schema: 'urdf-studio.mjcf-canonical/v1';
  meta: {
    modelName: string;
    sourceFile?: string;
    effectiveFile?: string;
  };
  counts: {
    bodies: number;
    joints: number;
    geoms: number;
    meshes: number;
    materials: number;
  };
  bodies: CanonicalMJCFBody[];
  joints: CanonicalMJCFJoint[];
  geoms: CanonicalMJCFGeom[];
  assets: {
    meshes: CanonicalMJCFMeshAsset[];
    materials: CanonicalMJCFMaterialAsset[];
  };
}

export interface CanonicalSnapshotOptions {
  sourceFile?: string;
  effectiveFile?: string;
  angleUnit?: 'radian' | 'degree';
}

export interface MJCFSnapshotDiff {
  type:
    | 'SOURCE_RESOLUTION_MISMATCH'
    | 'BODY_MISSING'
    | 'BODY_PARENT_MISMATCH'
    | 'BODY_POS_MISMATCH'
    | 'BODY_QUAT_MISMATCH'
    | 'BODY_MASS_MISMATCH'
    | 'BODY_INERTIAL_POS_MISMATCH'
    | 'BODY_INERTIAL_QUAT_MISMATCH'
    | 'BODY_INERTIA_MISMATCH'
    | 'BODY_FULLINERTIA_MISMATCH'
    | 'JOINT_MISSING'
    | 'JOINT_BODY_MISMATCH'
    | 'JOINT_TYPE_MISMATCH'
    | 'JOINT_AXIS_MISMATCH'
    | 'JOINT_POS_MISMATCH'
    | 'JOINT_RANGE_MISMATCH'
    | 'GEOM_MISSING'
    | 'GEOM_TYPE_MISMATCH'
    | 'GEOM_BODY_MISMATCH'
    | 'GEOM_SIZE_MISMATCH'
    | 'GEOM_MESH_MISMATCH'
    | 'GEOM_MATERIAL_MISMATCH'
    | 'GEOM_POS_MISMATCH'
    | 'GEOM_QUAT_MISMATCH'
    | 'GEOM_RGBA_MISMATCH'
    | 'GEOM_GROUP_MISMATCH'
    | 'GEOM_CONTYPE_MISMATCH'
    | 'GEOM_CONAFFINITY_MISMATCH'
    | 'GEOM_MASS_MISMATCH'
    | 'MESH_PATH_MISMATCH'
    | 'MESH_SCALE_MISMATCH'
    | 'MESH_REFPOS_MISMATCH'
    | 'MESH_REFQUAT_MISMATCH'
    | 'MATERIAL_RGBA_MISMATCH'
    | 'MATERIAL_EMISSION_MISMATCH'
    | 'COUNT_MISMATCH';
  key: string;
  message: string;
  expected?: unknown;
  actual?: unknown;
}

export function createCanonicalSnapshotFromParsedModel(
  parsedModel: ParsedMJCFModel,
  options: CanonicalSnapshotOptions = {},
): CanonicalMJCFSnapshot {
  const bodies: CanonicalMJCFBody[] = [];
  const joints: CanonicalMJCFJoint[] = [];
  const geoms: CanonicalMJCFGeom[] = [];

  const visitBody = (
    body: ParsedMJCFModel['worldBody'],
    parentKey: string | null,
    path: string,
  ): void => {
    const bodyName = body.sourceName || (path === 'world' ? 'world' : null);
    const bodyKey = bodyKeyFromName(bodyName, path);
    const canonicalInertia = diagonalizeFullInertia(
      body.inertial?.fullinertia || null,
      parsedModel.compilerSettings.boundinertia,
    );
    const quat = normalizeQuat(body.quat) ||
      normalizeQuatFromEuler(body.euler, parsedModel.compilerSettings.angleUnit) || [1, 0, 0, 0];

    bodies.push({
      key: bodyKey,
      name: bodyName,
      parentKey,
      path,
      pos: normalizePos(body.pos),
      quat,
      mass: normalizeNumber(body.inertial?.mass),
      inertialPos: body.inertial ? normalizePos(body.inertial.pos) : null,
      inertialQuat: body.inertial
        ? normalizeQuat(body.inertial.quat) || canonicalInertia?.quat || [1, 0, 0, 0]
        : null,
      inertia: body.inertial?.diaginertia
        ? applyBoundInertia(
            normalizeVector(body.inertial.diaginertia, 3) as [number, number, number] | null,
            parsedModel.compilerSettings.boundinertia,
          )
        : canonicalInertia?.diaginertia || null,
      fullinertia: body.inertial?.fullinertia
        ? (normalizeVector(body.inertial.fullinertia, 6) as
            | [number, number, number, number, number, number]
            | null)
        : null,
    });

    body.joints.forEach((joint, jointIndex) => {
      const fallback = buildGeneratedMjcfJointName(bodyKey, jointIndex);
      joints.push({
        key: jointKeyFromName(joint.sourceName, fallback),
        name: joint.sourceName || null,
        parentBodyKey: bodyKey,
        type: joint.type,
        axis: normalizeUnitVector(joint.axis, 3) as [number, number, number] | null,
        range: joint.range ? normalizeRange(joint.range, 'radian') : [0, 0],
        pos: normalizePos(joint.pos),
      });
    });

    body.geoms.forEach((geom, geomIndex) => {
      const fallback = buildGeneratedMjcfGeomName(bodyKey, geomIndex);
      const canonicalFromTo = canonicalizeFromToGeom(geom);
      geoms.push({
        key: geomKeyFromName(geom.sourceName || geom.name, fallback),
        name: geom.sourceName || null,
        bodyKey,
        type: geom.type,
        size:
          canonicalFromTo?.size ||
          canonicalizeGeomSize(geom.type, normalizeVector(geom.size, geom.size?.length || 0)),
        mesh: geom.mesh || null,
        material: geom.material || null,
        mass: normalizeNumber(geom.mass),
        pos: canonicalFromTo?.pos || normalizePos(geom.pos),
        quat: canonicalFromTo?.quat || normalizeQuat(geom.quat) || [1, 0, 0, 0],
        rgba: normalizeGeomRGBA(geom.rgba),
        group: geom.group ?? 0,
        contype: geom.contype ?? 1,
        conaffinity: geom.conaffinity ?? 1,
      });
    });

    body.children.forEach((child, childIndex) => {
      const childPath = child.sourceName
        ? `${path}/${child.sourceName}`
        : child.name || buildGeneratedMjcfBodyPath(path, childIndex);
      visitBody(child, bodyKey, childPath);
    });
  };

  visitBody(parsedModel.worldBody, null, 'world');

  const meshAssets = Array.from(parsedModel.meshMap.values())
    .map((mesh) => ({
      name: mesh.name,
      file: normalizeMeshFile(mesh.file),
      scale: normalizeScale(mesh.scale),
      refpos: normalizeVector(mesh.refpos, 3) as [number, number, number] | null,
      refquat: normalizeQuat(mesh.refquat),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const materialAssets = Array.from(parsedModel.materialMap.values())
    .map((material) => ({
      name: material.name,
      rgba: normalizeVector(material.rgba, 4) as [number, number, number, number] | null,
      emission: normalizeNumber(material.emission),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    schema: 'urdf-studio.mjcf-canonical/v1',
    meta: {
      modelName: parsedModel.modelName,
      sourceFile: options.sourceFile,
      effectiveFile: options.effectiveFile,
    },
    counts: {
      bodies: bodies.length,
      joints: joints.length,
      geoms: geoms.length,
      meshes: meshAssets.length,
      materials: materialAssets.length,
    },
    bodies: bodies.sort((left, right) => left.key.localeCompare(right.key)),
    joints: joints.sort((left, right) => left.key.localeCompare(right.key)),
    geoms: geoms.sort((left, right) => left.key.localeCompare(right.key)),
    assets: {
      meshes: meshAssets,
      materials: materialAssets,
    },
  };
}

export function createCanonicalSnapshotFromOracleExport(
  oracleExport: any,
  options: CanonicalSnapshotOptions = {},
): CanonicalMJCFSnapshot {
  const oracleAngleUnit =
    options.angleUnit || normalizeOracleAngleUnit(oracleExport?.compiler?.angle);
  const bodyKeyById = new Map<string, string>();
  const bodyPathById = new Map<string, string>();
  const childBodyIndexByParentId = new Map<string, number>();
  const nextLocalIndex = (counterMap: Map<string, number>, parentKey: string): number => {
    const nextIndex = counterMap.get(parentKey) ?? 0;
    counterMap.set(parentKey, nextIndex + 1);
    return nextIndex;
  };

  const bodies = (oracleExport.bodies || [])
    .map((body: any) => {
      const parentId = body.parent?.id as string | undefined;
      const parentPath = parentId
        ? bodyPathById.get(parentId) || body.parent?.name || 'world'
        : null;
      const path = parentId
        ? body.name ||
          buildGeneratedMjcfBodyPath(parentPath, nextLocalIndex(childBodyIndexByParentId, parentId))
        : 'world';
      const key = bodyKeyFromName(body.name || null, path);
      const parentKey = parentId
        ? bodyKeyById.get(parentId) || body.parent?.name || parentPath
        : null;
      bodyKeyById.set(body.id, key);
      bodyPathById.set(body.id, path);

      return {
        key,
        name: body.name || null,
        parentKey,
        path,
        pos: normalizePos(body.attrs?.pos),
        quat: normalizeQuat(body.attrs?.quat) ||
          normalizeQuatFromEuler(body.attrs?.euler, oracleAngleUnit) || [1, 0, 0, 0],
        mass: normalizeNumber(body.attrs?.mass),
        inertialPos: normalizeVector(body.attrs?.ipos, 3) as [number, number, number] | null,
        inertialQuat: normalizeQuat(body.attrs?.iquat) || [1, 0, 0, 0],
        inertia: normalizeVector(body.attrs?.inertia, 3) as [number, number, number] | null,
        fullinertia: normalizeVector(body.attrs?.fullinertia, 6) as
          | [number, number, number, number, number, number]
          | null,
      } satisfies CanonicalMJCFBody;
    })
    .sort((left: CanonicalMJCFBody, right: CanonicalMJCFBody) => left.key.localeCompare(right.key));

  const jointLocalIndexByBody = new Map<string, number>();
  const joints = (oracleExport.joints || [])
    .map((joint: any) => {
      const parentBodyKey = bodyKeyById.get(joint.parent?.id) || joint.parent?.name || 'world';
      const fallback = buildGeneratedMjcfJointName(
        parentBodyKey,
        nextLocalIndex(jointLocalIndexByBody, parentBodyKey),
      );
      return {
        key: jointKeyFromName(joint.name || null, fallback),
        name: joint.name || null,
        parentBodyKey,
        type: normalizeOracleJointType(joint.attrs?.type),
        axis: normalizeUnitVector(joint.attrs?.axis, 3) as [number, number, number] | null,
        range: normalizeRange(joint.attrs?.range, oracleAngleUnit),
        pos: normalizePos(joint.attrs?.pos),
      } satisfies CanonicalMJCFJoint;
    })
    .sort((left: CanonicalMJCFJoint, right: CanonicalMJCFJoint) =>
      left.key.localeCompare(right.key),
    );

  const geomLocalIndexByBody = new Map<string, number>();
  const geoms = (oracleExport.geoms || [])
    .map((geom: any) => {
      const parentBodyKey = bodyKeyById.get(geom.parent?.id) || geom.parent?.name || 'world';
      const fallback = buildGeneratedMjcfGeomName(
        parentBodyKey,
        nextLocalIndex(geomLocalIndexByBody, parentBodyKey),
      );
      const geomType = normalizeOracleGeomType(geom.attrs?.type);
      const canonicalFromTo = canonicalizeFromToGeom({
        type: geomType,
        size: geom.attrs?.size,
        fromto: geom.attrs?.fromto,
      });
      return {
        key: geomKeyFromName(geom.name || null, fallback),
        name: geom.name || null,
        bodyKey: parentBodyKey,
        type: geomType,
        size:
          canonicalFromTo?.size ||
          canonicalizeGeomSize(
            geomType,
            normalizeVector(geom.attrs?.size, geom.attrs?.size?.length || 0),
          ),
        mesh: geom.attrs?.meshname || null,
        material: geom.attrs?.material || null,
        mass: normalizeNumber(geom.attrs?.mass),
        pos: canonicalFromTo?.pos || normalizePos(geom.attrs?.pos),
        quat: canonicalFromTo?.quat ||
          normalizeQuat(geom.attrs?.quat) ||
          normalizeQuatFromEuler(geom.attrs?.euler, oracleAngleUnit) || [1, 0, 0, 0],
        rgba: normalizeGeomRGBA(geom.attrs?.rgba),
        group: geom.attrs?.group ?? 0,
        contype: geom.attrs?.contype ?? 1,
        conaffinity: geom.attrs?.conaffinity ?? 1,
      } satisfies CanonicalMJCFGeom;
    })
    .sort((left: CanonicalMJCFGeom, right: CanonicalMJCFGeom) => left.key.localeCompare(right.key));

  const meshAssets = (oracleExport.meshes || [])
    .map((mesh: any) => ({
      name: mesh.name || mesh.id,
      file: normalizeMeshFile(mesh.attrs?.file),
      scale: normalizeScale(mesh.attrs?.scale),
      refpos: normalizeVector(mesh.attrs?.refpos, 3) as [number, number, number] | null,
      refquat: normalizeQuat(mesh.attrs?.refquat),
    }))
    .sort((left: CanonicalMJCFMeshAsset, right: CanonicalMJCFMeshAsset) =>
      left.name.localeCompare(right.name),
    );

  const materialAssets = (oracleExport.materials || [])
    .map((material: any) => ({
      name: material.name || material.id,
      rgba: normalizeVector(material.attrs?.rgba, 4) as [number, number, number, number] | null,
      emission: normalizeNumber(material.attrs?.emission),
    }))
    .sort((left: CanonicalMJCFMaterialAsset, right: CanonicalMJCFMaterialAsset) =>
      left.name.localeCompare(right.name),
    );

  return {
    schema: 'urdf-studio.mjcf-canonical/v1',
    meta: {
      modelName: oracleExport.model_name,
      sourceFile: options.sourceFile,
      effectiveFile: options.effectiveFile,
    },
    counts: {
      bodies: oracleExport.spec_counts?.bodies ?? bodies.length,
      joints: oracleExport.spec_counts?.joints ?? joints.length,
      geoms: oracleExport.spec_counts?.geoms ?? geoms.length,
      meshes: oracleExport.spec_counts?.meshes ?? meshAssets.length,
      materials: oracleExport.spec_counts?.materials ?? materialAssets.length,
    },
    bodies,
    joints,
    geoms,
    assets: {
      meshes: meshAssets,
      materials: materialAssets,
    },
  };
}

export function diffCanonicalSnapshots(
  expected: CanonicalMJCFSnapshot,
  actual: CanonicalMJCFSnapshot,
): MJCFSnapshotDiff[] {
  const diffs: MJCFSnapshotDiff[] = [];

  if ((expected.meta.effectiveFile || null) !== (actual.meta.effectiveFile || null)) {
    diffs.push({
      type: 'SOURCE_RESOLUTION_MISMATCH',
      key: 'meta.effectiveFile',
      message: 'Effective MJCF file differs',
      expected: expected.meta.effectiveFile || null,
      actual: actual.meta.effectiveFile || null,
    });
  }

  (['bodies', 'joints', 'geoms', 'meshes', 'materials'] as const).forEach((field) => {
    if (expected.counts[field] !== actual.counts[field]) {
      diffs.push({
        type: 'COUNT_MISMATCH',
        key: `counts.${field}`,
        message: `Count mismatch for ${field}`,
        expected: expected.counts[field],
        actual: actual.counts[field],
      });
    }
  });

  const expectedBodies = new Map(expected.bodies.map((body) => [body.key, body]));
  const actualBodies = new Map(actual.bodies.map((body) => [body.key, body]));
  expectedBodies.forEach((expectedBody, key) => {
    const actualBody = actualBodies.get(key);
    if (!actualBody) {
      diffs.push({
        type: 'BODY_MISSING',
        key,
        message: 'Body missing in TS snapshot',
        expected: expectedBody,
      });
      return;
    }

    const expectedInertiaTensor = canonicalBodyInertiaTensor(expectedBody);
    const actualInertiaTensor = canonicalBodyInertiaTensor(actualBody);
    const inertiaTensorMatches = arraysEqual(expectedInertiaTensor, actualInertiaTensor);

    if ((expectedBody.parentKey || null) !== (actualBody.parentKey || null)) {
      diffs.push({
        type: 'BODY_PARENT_MISMATCH',
        key,
        message: 'Body parent differs',
        expected: expectedBody.parentKey || null,
        actual: actualBody.parentKey || null,
      });
    }

    if (!arraysEqual(expectedBody.pos, actualBody.pos)) {
      diffs.push({
        type: 'BODY_POS_MISMATCH',
        key,
        message: 'Body position differs',
        expected: expectedBody.pos,
        actual: actualBody.pos,
      });
    }

    if (!quaternionsEqual(expectedBody.quat, actualBody.quat)) {
      diffs.push({
        type: 'BODY_QUAT_MISMATCH',
        key,
        message: 'Body orientation differs',
        expected: expectedBody.quat,
        actual: actualBody.quat,
      });
    }

    if (!optionalMassesEqual(expectedBody.mass, actualBody.mass)) {
      diffs.push({
        type: 'BODY_MASS_MISMATCH',
        key,
        message: 'Body mass differs',
        expected: expectedBody.mass,
        actual: actualBody.mass,
      });
    }

    if (!arraysEqual(expectedBody.inertialPos, actualBody.inertialPos)) {
      diffs.push({
        type: 'BODY_INERTIAL_POS_MISMATCH',
        key,
        message: 'Body inertial position differs',
        expected: expectedBody.inertialPos,
        actual: actualBody.inertialPos,
      });
    }

    if (
      !quaternionsEqual(expectedBody.inertialQuat, actualBody.inertialQuat) &&
      !inertiaTensorMatches
    ) {
      diffs.push({
        type: 'BODY_INERTIAL_QUAT_MISMATCH',
        key,
        message: 'Body inertial orientation differs',
        expected: expectedBody.inertialQuat,
        actual: actualBody.inertialQuat,
      });
    }

    if (!arraysEqual(expectedBody.inertia, actualBody.inertia) && !inertiaTensorMatches) {
      diffs.push({
        type: 'BODY_INERTIA_MISMATCH',
        key,
        message: 'Body diagonal inertia differs',
        expected: expectedBody.inertia,
        actual: actualBody.inertia,
      });
    }

    // MuJoCo may represent non-principal inertia as NaN-padded fullinertia;
    // skip strict fullinertia comparison to avoid noisy false positives.
  });

  const expectedJoints = new Map(expected.joints.map((joint) => [joint.key, joint]));
  const actualJoints = new Map(actual.joints.map((joint) => [joint.key, joint]));
  expectedJoints.forEach((expectedJoint, key) => {
    const actualJoint = actualJoints.get(key);
    if (!actualJoint) {
      diffs.push({
        type: 'JOINT_MISSING',
        key,
        message: 'Joint missing in TS snapshot',
        expected: expectedJoint,
      });
      return;
    }

    if (expectedJoint.type !== actualJoint.type) {
      diffs.push({
        type: 'JOINT_TYPE_MISMATCH',
        key,
        message: 'Joint type differs',
        expected: expectedJoint.type,
        actual: actualJoint.type,
      });
    }

    if (expectedJoint.parentBodyKey !== actualJoint.parentBodyKey) {
      diffs.push({
        type: 'JOINT_BODY_MISMATCH',
        key,
        message: 'Joint parent body differs',
        expected: expectedJoint.parentBodyKey,
        actual: actualJoint.parentBodyKey,
      });
    }

    if (!jointAxesEqual(expectedJoint.axis, actualJoint.axis)) {
      diffs.push({
        type: 'JOINT_AXIS_MISMATCH',
        key,
        message: 'Joint axis differs',
        expected: expectedJoint.axis,
        actual: actualJoint.axis,
      });
    }

    if (!arraysEqual(expectedJoint.pos, actualJoint.pos)) {
      diffs.push({
        type: 'JOINT_POS_MISMATCH',
        key,
        message: 'Joint anchor position differs',
        expected: expectedJoint.pos,
        actual: actualJoint.pos,
      });
    }

    if (!rangesEqual(expectedJoint.range, actualJoint.range)) {
      diffs.push({
        type: 'JOINT_RANGE_MISMATCH',
        key,
        message: 'Joint range differs',
        expected: expectedJoint.range,
        actual: actualJoint.range,
      });
    }
  });

  const expectedGeoms = new Map(expected.geoms.map((geom) => [geom.key, geom]));
  const actualGeoms = new Map(actual.geoms.map((geom) => [geom.key, geom]));
  expectedGeoms.forEach((expectedGeom, key) => {
    const actualGeom = actualGeoms.get(key);
    if (!actualGeom) {
      diffs.push({
        type: 'GEOM_MISSING',
        key,
        message: 'Geom missing in TS snapshot',
        expected: expectedGeom,
      });
      return;
    }

    if (expectedGeom.type !== actualGeom.type) {
      diffs.push({
        type: 'GEOM_TYPE_MISMATCH',
        key,
        message: 'Geom type differs',
        expected: expectedGeom.type,
        actual: actualGeom.type,
      });
    }

    if (expectedGeom.bodyKey !== actualGeom.bodyKey) {
      diffs.push({
        type: 'GEOM_BODY_MISMATCH',
        key,
        message: 'Geom parent body differs',
        expected: expectedGeom.bodyKey,
        actual: actualGeom.bodyKey,
      });
    }

    const expectedSize = canonicalizeGeomSize(expectedGeom.type, expectedGeom.size);
    const actualSize = canonicalizeGeomSize(actualGeom.type, actualGeom.size);
    if (!arraysEqual(expectedSize, actualSize)) {
      diffs.push({
        type: 'GEOM_SIZE_MISMATCH',
        key,
        message: 'Geom size differs',
        expected: expectedSize,
        actual: actualSize,
      });
    }

    if ((expectedGeom.mesh || null) !== (actualGeom.mesh || null)) {
      diffs.push({
        type: 'GEOM_MESH_MISMATCH',
        key,
        message: 'Geom mesh reference differs',
        expected: expectedGeom.mesh || null,
        actual: actualGeom.mesh || null,
      });
    }

    if ((expectedGeom.material || null) !== (actualGeom.material || null)) {
      diffs.push({
        type: 'GEOM_MATERIAL_MISMATCH',
        key,
        message: 'Geom material differs',
        expected: expectedGeom.material || null,
        actual: actualGeom.material || null,
      });
    }

    if (!arraysEqual(expectedGeom.pos, actualGeom.pos)) {
      diffs.push({
        type: 'GEOM_POS_MISMATCH',
        key,
        message: 'Geom position differs',
        expected: expectedGeom.pos,
        actual: actualGeom.pos,
      });
    }

    if (!axisymmetricGeomOrientationsEqual(expectedGeom.type, expectedGeom.quat, actualGeom.quat)) {
      diffs.push({
        type: 'GEOM_QUAT_MISMATCH',
        key,
        message: 'Geom orientation differs',
        expected: expectedGeom.quat,
        actual: actualGeom.quat,
      });
    }

    if (!arraysEqual(expectedGeom.rgba, actualGeom.rgba)) {
      diffs.push({
        type: 'GEOM_RGBA_MISMATCH',
        key,
        message: 'Geom color differs',
        expected: expectedGeom.rgba,
        actual: actualGeom.rgba,
      });
    }

    if (expectedGeom.group !== actualGeom.group) {
      diffs.push({
        type: 'GEOM_GROUP_MISMATCH',
        key,
        message: 'Geom group differs',
        expected: expectedGeom.group,
        actual: actualGeom.group,
      });
    }

    if (expectedGeom.contype !== actualGeom.contype) {
      diffs.push({
        type: 'GEOM_CONTYPE_MISMATCH',
        key,
        message: 'Geom contype differs',
        expected: expectedGeom.contype,
        actual: actualGeom.contype,
      });
    }

    if (expectedGeom.conaffinity !== actualGeom.conaffinity) {
      diffs.push({
        type: 'GEOM_CONAFFINITY_MISMATCH',
        key,
        message: 'Geom conaffinity differs',
        expected: expectedGeom.conaffinity,
        actual: actualGeom.conaffinity,
      });
    }

    if (
      !geomMassesEqual(
        expectedGeom,
        actualGeom,
        expectedBodies.get(expectedGeom.bodyKey),
        actualBodies.get(actualGeom.bodyKey),
      )
    ) {
      diffs.push({
        type: 'GEOM_MASS_MISMATCH',
        key,
        message: 'Geom mass differs',
        expected: expectedGeom.mass,
        actual: actualGeom.mass,
      });
    }
  });

  const expectedMeshes = new Map(expected.assets.meshes.map((mesh) => [mesh.name, mesh]));
  const actualMeshes = new Map(actual.assets.meshes.map((mesh) => [mesh.name, mesh]));
  expectedMeshes.forEach((expectedMesh, key) => {
    const actualMesh = actualMeshes.get(key);
    if (!actualMesh || (expectedMesh.file || null) !== (actualMesh.file || null)) {
      diffs.push({
        type: 'MESH_PATH_MISMATCH',
        key,
        message: 'Mesh file path differs',
        expected: expectedMesh.file || null,
        actual: actualMesh?.file || null,
      });
    }

    if (!arraysEqual(expectedMesh.scale, actualMesh?.scale || null)) {
      diffs.push({
        type: 'MESH_SCALE_MISMATCH',
        key,
        message: 'Mesh scale differs',
        expected: expectedMesh.scale,
        actual: actualMesh?.scale || null,
      });
    }

    if (!arraysEqual(expectedMesh.refpos, actualMesh?.refpos || null)) {
      diffs.push({
        type: 'MESH_REFPOS_MISMATCH',
        key,
        message: 'Mesh reference position differs',
        expected: expectedMesh.refpos,
        actual: actualMesh?.refpos || null,
      });
    }

    if (!quaternionsEqual(expectedMesh.refquat, actualMesh?.refquat || null)) {
      diffs.push({
        type: 'MESH_REFQUAT_MISMATCH',
        key,
        message: 'Mesh reference orientation differs',
        expected: expectedMesh.refquat,
        actual: actualMesh?.refquat || null,
      });
    }
  });

  const expectedMaterials = new Map(
    expected.assets.materials.map((material) => [material.name, material]),
  );
  const actualMaterials = new Map(
    actual.assets.materials.map((material) => [material.name, material]),
  );
  expectedMaterials.forEach((expectedMaterial, key) => {
    const actualMaterial = actualMaterials.get(key);
    if (!materialRGBAEqual(expectedMaterial.rgba, actualMaterial?.rgba || null)) {
      diffs.push({
        type: 'MATERIAL_RGBA_MISMATCH',
        key,
        message: 'Material rgba differs',
        expected: expectedMaterial.rgba,
        actual: actualMaterial?.rgba || null,
      });
    }

    if (!nearlyEqual(expectedMaterial.emission, actualMaterial?.emission)) {
      diffs.push({
        type: 'MATERIAL_EMISSION_MISMATCH',
        key,
        message: 'Material emission differs',
        expected: expectedMaterial.emission,
        actual: actualMaterial?.emission ?? null,
      });
    }
  });

  return diffs;
}
