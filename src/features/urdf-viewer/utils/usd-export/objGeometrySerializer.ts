import { Matrix3, Matrix4, Vector3 } from 'three';

import {
  getDescriptorRanges,
  hasTrustedSnapshotNormals,
  readRangeNumber,
  readRangeValues,
  sliceRangeValues,
} from './objBufferReaders.ts';
import { sanitizeFileToken } from './usdExportPaths.ts';
import { NORMAL_EPSILON, NORMAL_REPAIR_DOT_THRESHOLD } from './internalTypes.ts';

import type { ExportDescriptor, SnapshotBuffers } from './internalTypes.ts';

function formatObjNumber(value: number): string {
  const normalized = Math.abs(value) < 1e-9 ? 0 : value;
  const fixed = Number(normalized.toFixed(6));
  return Number.isInteger(fixed) ? String(fixed) : String(fixed);
}

function resolveObjIndex(rawIndex: number, count: number): number {
  if (!Number.isInteger(rawIndex) || rawIndex === 0) {
    return -1;
  }
  return rawIndex > 0 ? rawIndex - 1 : count + rawIndex;
}

function parseObjFaceVertexRef(
  value: string,
  vertexCount: number,
  normalCount: number,
): { vertexIndex: number; normalIndex: number | null } {
  const parts = value.split('/');
  const vertexIndex = resolveObjIndex(Number.parseInt(parts[0] || '', 10), vertexCount);
  const normalIndex =
    parts.length >= 3 && parts[2]
      ? resolveObjIndex(Number.parseInt(parts[2], 10), normalCount)
      : null;
  return { vertexIndex, normalIndex };
}

export function repairObjFaceVaryingNormalsForExport(objText: string): string {
  if (!objText || (!objText.includes('\nf ') && !objText.startsWith('f '))) {
    return objText;
  }

  const lines = objText.split('\n');
  const vertices: Vector3[] = [];
  const normals: Array<Vector3 | null> = [];
  const normalLineIndexes: number[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex].trim();
    const parts = line.split(/\s+/);
    if (parts[0] === 'v' && parts.length >= 4) {
      const x = Number(parts[1]);
      const y = Number(parts[2]);
      const z = Number(parts[3]);
      vertices.push(
        new Vector3(
          Number.isFinite(x) ? x : 0,
          Number.isFinite(y) ? y : 0,
          Number.isFinite(z) ? z : 0,
        ),
      );
      continue;
    }
    if (parts[0] === 'vn' && parts.length >= 4) {
      const x = Number(parts[1]);
      const y = Number(parts[2]);
      const z = Number(parts[3]);
      const normal = new Vector3(
        Number.isFinite(x) ? x : 0,
        Number.isFinite(y) ? y : 0,
        Number.isFinite(z) ? z : 0,
      );
      normals.push(normal.lengthSq() > NORMAL_EPSILON ? normal.normalize() : null);
      normalLineIndexes.push(lineIndex);
    }
  }

  if (vertices.length < 3 || normals.length === 0) {
    return objText;
  }

  const edgeA = new Vector3();
  const edgeB = new Vector3();
  const faceNormal = new Vector3();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('f ')) {
      continue;
    }

    const refs = trimmed
      .split(/\s+/)
      .slice(1)
      .map((ref) => parseObjFaceVertexRef(ref, vertices.length, normals.length));
    if (refs.length < 3) {
      continue;
    }

    for (let triangleIndex = 1; triangleIndex + 1 < refs.length; triangleIndex += 1) {
      const triangle = [refs[0], refs[triangleIndex], refs[triangleIndex + 1]];
      const positionA = vertices[triangle[0].vertexIndex];
      const positionB = vertices[triangle[1].vertexIndex];
      const positionC = vertices[triangle[2].vertexIndex];
      if (!positionA || !positionB || !positionC) {
        continue;
      }

      edgeA.subVectors(positionB, positionA);
      edgeB.subVectors(positionC, positionA);
      faceNormal.crossVectors(edgeA, edgeB);
      if (faceNormal.lengthSq() <= NORMAL_EPSILON) {
        continue;
      }
      faceNormal.normalize();

      for (const ref of triangle) {
        if (ref.normalIndex === null) {
          continue;
        }
        const normal = normals[ref.normalIndex];
        const normalLineIndex = normalLineIndexes[ref.normalIndex];
        if (!normal || normalLineIndex === undefined) {
          continue;
        }
        if (normal.dot(faceNormal) >= NORMAL_REPAIR_DOT_THRESHOLD) {
          continue;
        }
        const repairedNormal = faceNormal.clone();
        normals[ref.normalIndex] = repairedNormal;
        lines[normalLineIndex] =
          `vn ${formatObjNumber(repairedNormal.x)} ${formatObjNumber(repairedNormal.y)} ${formatObjNumber(repairedNormal.z)}`;
      }
    }
  }

  return lines.join('\n');
}

/**
 * Read context produced by {@link readGeometryData} and consumed by the
 * transform/serialize stages. It owns the per-call THREE scratch objects and
 * pre-resolved typed-array views so that the three OBJ stages reuse the exact
 * same shared state — preserving byte-level output and zero-copy semantics.
 */
type ObjBuildContext = {
  descriptor: ExportDescriptor;
  lines: string[];
  positionValues: ArrayLike<number>;
  normalValues: ArrayLike<number>;
  uvValues: ArrayLike<number>;
  transform: Matrix4 | null;
  shouldBakeTransform: boolean;
  normalMatrix: Matrix3 | null;
  tempVector: Vector3;
  vertexCount: number;
  fullTriangleIndices: ArrayLike<number>;
  subsetStart: number;
  subsetEnd: number;
  triangleIndices: ArrayLike<number>;
  vertexColorByIndex: Map<number, [number, number, number]>;
  defaultVertexColor: [number, number, number] | null;
  uvStride: number;
  hasFaceVaryingUvs: boolean;
  hasPerVertexUvs: boolean;
  normalStride: number;
  hasFaceVaryingNormals: boolean;
  hasPerVertexNormals: boolean;
  positionA: Vector3;
  positionB: Vector3;
  positionC: Vector3;
  edgeA: Vector3;
  edgeB: Vector3;
  faceNormal: Vector3;
  authoredNormalA: Vector3;
  authoredNormalB: Vector3;
  authoredNormalC: Vector3;
  averagedAuthoredNormal: Vector3;
  shouldWriteRepairedFaceVaryingNormals: boolean;
  writesFaceVaryingNormals: boolean;
  pointBasedKind: 'points' | 'basiscurves' | null;
};

/**
 * Stage 1 — read all typed-array ranges for the descriptor and derive the
 * transform, subset bounds, normal/uv layout flags and shared scratch objects.
 * Returns `null` when there is not enough position data to emit geometry.
 */
function readGeometryData(
  descriptor: ExportDescriptor,
  buffers: SnapshotBuffers | null | undefined,
): ObjBuildContext | null {
  const ranges = getDescriptorRanges(descriptor.descriptor, buffers);
  const positionValues = readRangeValues(buffers?.positions, ranges?.positions);
  const normalizedPrimType = String(descriptor.descriptor.primType || '').trim().toLowerCase();
  const pointBasedKind = normalizedPrimType === 'points'
    ? 'points'
    : normalizedPrimType === 'basiscurves'
      ? 'basiscurves'
      : null;
  const minimumPositionValueCount = pointBasedKind === 'points'
    ? 3
    : pointBasedKind === 'basiscurves'
      ? 6
      : 9;
  if (positionValues.length < minimumPositionValueCount) {
    return null;
  }

  const indexValues = readRangeValues(buffers?.indices, ranges?.indices);
  const normalValues = readRangeValues(buffers?.normals, ranges?.normals);
  const uvValues = readRangeValues(buffers?.uvs, ranges?.uvs);
  const transformValues = readRangeValues(buffers?.transforms, ranges?.transform);

  const transform =
    transformValues.length >= 16
      ? new Matrix4().fromArray(
          Array.from({ length: 16 }, (_, index) => readRangeNumber(transformValues, index)),
        )
      : null;
  const shouldBakeTransform = descriptor.bakeTransformIntoMesh !== false;
  const normalMatrix =
    transform && shouldBakeTransform ? new Matrix3().getNormalMatrix(transform) : null;
  const tempVector = new Vector3();

  const lines: string[] = [
    `o ${sanitizeFileToken(`${descriptor.linkId}_${descriptor.role}_${descriptor.ordinal}`)}`,
  ];

  const vertexCount = Math.floor(positionValues.length / 3);
  const fullTriangleIndices =
    indexValues.length >= 3
      ? indexValues
      : Array.from({ length: vertexCount }, (_, index) => index);
  const subsetStart = descriptor.subsetSection
    ? Math.max(0, Math.min(fullTriangleIndices.length, descriptor.subsetSection.start))
    : 0;
  const subsetEnd = descriptor.subsetSection
    ? Math.max(
        subsetStart,
        Math.min(fullTriangleIndices.length, subsetStart + descriptor.subsetSection.length),
      )
    : fullTriangleIndices.length;
  const triangleIndices = descriptor.subsetSection
    ? (() => {
        const sliced = sliceRangeValues(fullTriangleIndices, subsetStart, subsetEnd);
        return sliced.length >= 3 ? sliced : [];
      })()
    : fullTriangleIndices;
  const vertexColorByIndex = new Map<number, [number, number, number]>();
  (descriptor.subsetDisplayColors || []).forEach((section) => {
    const start = Math.max(0, Math.min(fullTriangleIndices.length, Math.floor(section.start)));
    const end = Math.max(
      start,
      Math.min(fullTriangleIndices.length, start + Math.floor(section.length)),
    );
    for (let faceVertexIndex = start; faceVertexIndex < end; faceVertexIndex += 1) {
      const vertexIndex = readRangeNumber(fullTriangleIndices, faceVertexIndex);
      if (!Number.isInteger(vertexIndex) || vertexIndex < 0) {
        continue;
      }
      if (!vertexColorByIndex.has(vertexIndex)) {
        vertexColorByIndex.set(vertexIndex, section.color);
      }
    }
  });
  const defaultVertexColor = descriptor.displayColor || null;

  const shouldWriteTextureCoordinates = descriptor.writeTextureCoordinates === true;
  const uvStride = Math.max(1, Number(ranges?.uvs?.stride || 2));
  const uvCount = shouldWriteTextureCoordinates ? Math.floor(uvValues.length / uvStride) : 0;
  const hasIndexedUvs = shouldWriteTextureCoordinates && uvCount >= vertexCount;
  const hasFaceVaryingUvs =
    shouldWriteTextureCoordinates &&
    indexValues.length >= 3 &&
    uvCount === fullTriangleIndices.length;
  const hasPerVertexUvs = hasIndexedUvs && !hasFaceVaryingUvs;
  const normalStride = Math.max(1, Number(ranges?.normals?.stride || 3));
  const normalCount = Math.floor(normalValues.length / normalStride);
  const hasIndexedNormals = normalCount >= vertexCount;
  const hasFaceVaryingNormals =
    indexValues.length >= 3 && normalCount === fullTriangleIndices.length;
  const hasPerVertexNormals = hasIndexedNormals && !hasFaceVaryingNormals;
  const positionA = new Vector3();
  const positionB = new Vector3();
  const positionC = new Vector3();
  const edgeA = new Vector3();
  const edgeB = new Vector3();
  const faceNormal = new Vector3();
  const authoredNormalA = new Vector3();
  const authoredNormalB = new Vector3();
  const authoredNormalC = new Vector3();
  const averagedAuthoredNormal = new Vector3();

  const readPositionVector = (vertexIndex: number, target: Vector3): boolean => {
    const offset = vertexIndex * 3;
    if (offset < 0 || offset + 2 >= positionValues.length) {
      return false;
    }
    target.set(
      readRangeNumber(positionValues, offset),
      readRangeNumber(positionValues, offset + 1),
      readRangeNumber(positionValues, offset + 2),
    );
    if (transform && shouldBakeTransform) {
      target.applyMatrix4(transform);
    }
    return Number.isFinite(target.x) && Number.isFinite(target.y) && Number.isFinite(target.z);
  };

  const computeFaceNormal = (
    vertexIndexA: number,
    vertexIndexB: number,
    vertexIndexC: number,
    target: Vector3,
  ): boolean => {
    if (
      !readPositionVector(vertexIndexA, positionA) ||
      !readPositionVector(vertexIndexB, positionB) ||
      !readPositionVector(vertexIndexC, positionC)
    ) {
      return false;
    }
    edgeA.subVectors(positionB, positionA);
    edgeB.subVectors(positionC, positionA);
    target.crossVectors(edgeA, edgeB);
    if (target.lengthSq() <= NORMAL_EPSILON) {
      return false;
    }
    target.normalize();
    return true;
  };

  const readAuthoredNormalVector = (
    faceVertexIndex: number,
    vertexIndex: number,
    target: Vector3,
  ): boolean => {
    let offset = -1;
    if (hasFaceVaryingNormals) {
      offset = faceVertexIndex * normalStride;
    } else if (hasPerVertexNormals) {
      offset = vertexIndex * normalStride;
    }
    if (offset < 0 || offset + 2 >= normalValues.length) {
      return false;
    }
    target.set(
      readRangeNumber(normalValues, offset),
      readRangeNumber(normalValues, offset + 1),
      readRangeNumber(normalValues, offset + 2),
    );
    if (normalMatrix) {
      target.applyMatrix3(normalMatrix);
    }
    if (
      !Number.isFinite(target.x) ||
      !Number.isFinite(target.y) ||
      !Number.isFinite(target.z) ||
      target.lengthSq() <= NORMAL_EPSILON
    ) {
      return false;
    }
    target.normalize();
    return true;
  };

  const doesAuthoredNormalOpposeFace = (
    faceVertexIndex: number,
    vertexIndexA: number,
    vertexIndexB: number,
    vertexIndexC: number,
  ): boolean => {
    if (!computeFaceNormal(vertexIndexA, vertexIndexB, vertexIndexC, faceNormal)) {
      return false;
    }
    const hasNormalA = readAuthoredNormalVector(faceVertexIndex, vertexIndexA, authoredNormalA);
    const hasNormalB = readAuthoredNormalVector(faceVertexIndex + 1, vertexIndexB, authoredNormalB);
    const hasNormalC = readAuthoredNormalVector(faceVertexIndex + 2, vertexIndexC, authoredNormalC);
    if (!hasNormalA || !hasNormalB || !hasNormalC) {
      return true;
    }
    if (
      authoredNormalA.dot(faceNormal) < NORMAL_REPAIR_DOT_THRESHOLD ||
      authoredNormalB.dot(faceNormal) < NORMAL_REPAIR_DOT_THRESHOLD ||
      authoredNormalC.dot(faceNormal) < NORMAL_REPAIR_DOT_THRESHOLD
    ) {
      return true;
    }
    averagedAuthoredNormal
      .copy(authoredNormalA)
      .add(authoredNormalB)
      .add(authoredNormalC);
    if (averagedAuthoredNormal.lengthSq() <= NORMAL_EPSILON) {
      return true;
    }
    averagedAuthoredNormal.normalize();
    return averagedAuthoredNormal.dot(faceNormal) < NORMAL_REPAIR_DOT_THRESHOLD;
  };

  const shouldWriteRepairedFaceVaryingNormals =
    !(
      descriptor.bakeTransformIntoMesh === false &&
      hasTrustedSnapshotNormals(descriptor.descriptor)
    ) &&
    (hasFaceVaryingNormals || hasPerVertexNormals) &&
    (() => {
      for (let index = 0; index + 2 < triangleIndices.length; index += 3) {
        const a = readRangeNumber(triangleIndices, index);
        const b = readRangeNumber(triangleIndices, index + 1);
        const c = readRangeNumber(triangleIndices, index + 2);
        if (!Number.isInteger(a) || !Number.isInteger(b) || !Number.isInteger(c)) {
          continue;
        }
        if (doesAuthoredNormalOpposeFace(subsetStart + index, a, b, c)) {
          return true;
        }
      }
      return false;
    })();
  const writesFaceVaryingNormals = shouldWriteRepairedFaceVaryingNormals || hasFaceVaryingNormals;

  return {
    descriptor,
    lines,
    positionValues,
    normalValues,
    uvValues,
    transform,
    shouldBakeTransform,
    normalMatrix,
    tempVector,
    vertexCount,
    fullTriangleIndices,
    subsetStart,
    subsetEnd,
    triangleIndices,
    vertexColorByIndex,
    defaultVertexColor,
    uvStride,
    hasFaceVaryingUvs,
    hasPerVertexUvs,
    normalStride,
    hasFaceVaryingNormals,
    hasPerVertexNormals,
    positionA,
    positionB,
    positionC,
    edgeA,
    edgeB,
    faceNormal,
    authoredNormalA,
    authoredNormalB,
    authoredNormalC,
    averagedAuthoredNormal,
    shouldWriteRepairedFaceVaryingNormals,
    writesFaceVaryingNormals,
    pointBasedKind,
  };
}

/**
 * Stage 2 — bake the descriptor transform into vertex positions and emit the
 * `v` / `vt` / `vn` OBJ sections (including face-varying normal repair) in the
 * exact original order, reusing the shared scratch objects from the context.
 */
function applyTransformToGeometry(ctx: ObjBuildContext): void {
  const {
    lines,
    positionValues,
    normalValues,
    uvValues,
    transform,
    shouldBakeTransform,
    normalMatrix,
    tempVector,
    vertexCount,
    subsetStart,
    subsetEnd,
    triangleIndices,
    vertexColorByIndex,
    defaultVertexColor,
    uvStride,
    hasFaceVaryingUvs,
    hasPerVertexUvs,
    normalStride,
    hasFaceVaryingNormals,
    hasPerVertexNormals,
    faceNormal,
    authoredNormalA,
    authoredNormalB,
    authoredNormalC,
    averagedAuthoredNormal,
    shouldWriteRepairedFaceVaryingNormals,
  } = ctx;

  // The face-normal/authored-normal helpers depend on the shared scratch in the
  // context; recreate the same closures so the repair pass behaves identically.
  const readPositionVector = (vertexIndex: number, target: Vector3): boolean => {
    const offset = vertexIndex * 3;
    if (offset < 0 || offset + 2 >= positionValues.length) {
      return false;
    }
    target.set(
      readRangeNumber(positionValues, offset),
      readRangeNumber(positionValues, offset + 1),
      readRangeNumber(positionValues, offset + 2),
    );
    if (transform && shouldBakeTransform) {
      target.applyMatrix4(transform);
    }
    return Number.isFinite(target.x) && Number.isFinite(target.y) && Number.isFinite(target.z);
  };

  const computeFaceNormal = (
    vertexIndexA: number,
    vertexIndexB: number,
    vertexIndexC: number,
    target: Vector3,
  ): boolean => {
    if (
      !readPositionVector(vertexIndexA, ctx.positionA) ||
      !readPositionVector(vertexIndexB, ctx.positionB) ||
      !readPositionVector(vertexIndexC, ctx.positionC)
    ) {
      return false;
    }
    ctx.edgeA.subVectors(ctx.positionB, ctx.positionA);
    ctx.edgeB.subVectors(ctx.positionC, ctx.positionA);
    target.crossVectors(ctx.edgeA, ctx.edgeB);
    if (target.lengthSq() <= NORMAL_EPSILON) {
      return false;
    }
    target.normalize();
    return true;
  };

  const readAuthoredNormalVector = (
    faceVertexIndex: number,
    vertexIndex: number,
    target: Vector3,
  ): boolean => {
    let offset = -1;
    if (hasFaceVaryingNormals) {
      offset = faceVertexIndex * normalStride;
    } else if (hasPerVertexNormals) {
      offset = vertexIndex * normalStride;
    }
    if (offset < 0 || offset + 2 >= normalValues.length) {
      return false;
    }
    target.set(
      readRangeNumber(normalValues, offset),
      readRangeNumber(normalValues, offset + 1),
      readRangeNumber(normalValues, offset + 2),
    );
    if (normalMatrix) {
      target.applyMatrix3(normalMatrix);
    }
    if (
      !Number.isFinite(target.x) ||
      !Number.isFinite(target.y) ||
      !Number.isFinite(target.z) ||
      target.lengthSq() <= NORMAL_EPSILON
    ) {
      return false;
    }
    target.normalize();
    return true;
  };

  for (let index = 0; index + 2 < positionValues.length; index += 3) {
    tempVector.set(
      readRangeNumber(positionValues, index),
      readRangeNumber(positionValues, index + 1),
      readRangeNumber(positionValues, index + 2),
    );
    if (transform && shouldBakeTransform) {
      tempVector.applyMatrix4(transform);
    }
    const vertexColor = vertexColorByIndex.get(index / 3) || defaultVertexColor;
    lines.push(
      vertexColor
        ? `v ${formatObjNumber(tempVector.x)} ${formatObjNumber(tempVector.y)} ${formatObjNumber(tempVector.z)} ${formatObjNumber(vertexColor[0])} ${formatObjNumber(vertexColor[1])} ${formatObjNumber(vertexColor[2])}`
        : `v ${formatObjNumber(tempVector.x)} ${formatObjNumber(tempVector.y)} ${formatObjNumber(tempVector.z)}`,
    );
  }

  const pushObjNormalLine = (normal: Vector3): void => {
    lines.push(
      `vn ${formatObjNumber(normal.x)} ${formatObjNumber(normal.y)} ${formatObjNumber(normal.z)}`,
    );
  };

  if (hasFaceVaryingUvs) {
    for (let uvIndex = subsetStart; uvIndex < subsetEnd; uvIndex += 1) {
      const offset = uvIndex * uvStride;
      lines.push(
        `vt ${formatObjNumber(readRangeNumber(uvValues, offset))} ${formatObjNumber(
          readRangeNumber(uvValues, offset + 1),
        )}`,
      );
    }
  } else if (hasPerVertexUvs) {
    for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
      const offset = vertexIndex * uvStride;
      lines.push(
        `vt ${formatObjNumber(readRangeNumber(uvValues, offset))} ${formatObjNumber(
          readRangeNumber(uvValues, offset + 1),
        )}`,
      );
    }
  }

  if (shouldWriteRepairedFaceVaryingNormals) {
    for (let index = 0; index + 2 < triangleIndices.length; index += 3) {
      const a = readRangeNumber(triangleIndices, index);
      const b = readRangeNumber(triangleIndices, index + 1);
      const c = readRangeNumber(triangleIndices, index + 2);
      const globalFaceVertexIndex = subsetStart + index;
      const hasComputedFaceNormal = computeFaceNormal(a, b, c, faceNormal);
      const hasNormalA = readAuthoredNormalVector(globalFaceVertexIndex, a, authoredNormalA);
      const hasNormalB = readAuthoredNormalVector(globalFaceVertexIndex + 1, b, authoredNormalB);
      const hasNormalC = readAuthoredNormalVector(globalFaceVertexIndex + 2, c, authoredNormalC);
      let useComputedFaceNormal = false;

      if (hasComputedFaceNormal && hasNormalA && hasNormalB && hasNormalC) {
        averagedAuthoredNormal
          .copy(authoredNormalA)
          .add(authoredNormalB)
          .add(authoredNormalC);
        useComputedFaceNormal =
          averagedAuthoredNormal.lengthSq() <= NORMAL_EPSILON ||
          averagedAuthoredNormal.normalize().dot(faceNormal) < NORMAL_REPAIR_DOT_THRESHOLD;
      }

      if (useComputedFaceNormal) {
        pushObjNormalLine(faceNormal);
        pushObjNormalLine(faceNormal);
        pushObjNormalLine(faceNormal);
        continue;
      }

      const fallbackNormal = hasComputedFaceNormal ? faceNormal : tempVector.set(0, 0, 1);
      const normalA =
        hasNormalA &&
        (!hasComputedFaceNormal || authoredNormalA.dot(faceNormal) >= NORMAL_REPAIR_DOT_THRESHOLD)
          ? authoredNormalA
          : fallbackNormal;
      const normalB =
        hasNormalB &&
        (!hasComputedFaceNormal || authoredNormalB.dot(faceNormal) >= NORMAL_REPAIR_DOT_THRESHOLD)
          ? authoredNormalB
          : fallbackNormal;
      const normalC =
        hasNormalC &&
        (!hasComputedFaceNormal || authoredNormalC.dot(faceNormal) >= NORMAL_REPAIR_DOT_THRESHOLD)
          ? authoredNormalC
          : fallbackNormal;

      pushObjNormalLine(normalA);
      pushObjNormalLine(normalB);
      pushObjNormalLine(normalC);
    }
  } else if (hasFaceVaryingNormals) {
    for (let normalIndex = subsetStart; normalIndex < subsetEnd; normalIndex += 1) {
      const offset = normalIndex * normalStride;
      tempVector.set(
        readRangeNumber(normalValues, offset),
        readRangeNumber(normalValues, offset + 1),
        readRangeNumber(normalValues, offset + 2),
      );
      if (normalMatrix) {
        tempVector.applyMatrix3(normalMatrix).normalize();
      }
      pushObjNormalLine(tempVector);
    }
  } else if (hasPerVertexNormals) {
    for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
      const offset = vertexIndex * normalStride;
      tempVector.set(
        readRangeNumber(normalValues, offset),
        readRangeNumber(normalValues, offset + 1),
        readRangeNumber(normalValues, offset + 2),
      );
      if (normalMatrix) {
        tempVector.applyMatrix3(normalMatrix).normalize();
      }
      pushObjNormalLine(tempVector);
    }
  }
}

/**
 * Stage 3 — emit the `f` face section (1-based, subset-relative indices) and
 * serialize the accumulated OBJ lines into a Blob plus its encoded bytes.
 */
function serializeAsOBJ(ctx: ObjBuildContext): { blob: Blob; bytes: Uint8Array } | null {
  const {
    lines,
    triangleIndices,
    hasFaceVaryingUvs,
    hasPerVertexUvs,
    hasPerVertexNormals,
    writesFaceVaryingNormals,
    pointBasedKind,
  } = ctx;

  if (pointBasedKind === 'points') {
    const pointIndexes = Array.from({ length: ctx.vertexCount }, (_, index) => index + 1);
    if (pointIndexes.length === 0) return null;
    lines.push(`p ${pointIndexes.join(' ')}`);
  } else if (pointBasedKind === 'basiscurves') {
    for (let index = 0; index + 1 < ctx.vertexCount; index += 2) {
      lines.push(`l ${index + 1} ${index + 2}`);
    }
    if (ctx.vertexCount < 2) return null;
  }

  const formatObjFaceVertex = (
    vertexIndex: number,
    uvIndex: number | null,
    normalIndex: number | null,
  ): string => {
    if (uvIndex !== null && normalIndex !== null) {
      return `${vertexIndex}/${uvIndex}/${normalIndex}`;
    }
    if (uvIndex !== null) {
      return `${vertexIndex}/${uvIndex}`;
    }
    if (normalIndex !== null) {
      return `${vertexIndex}//${normalIndex}`;
    }
    return String(vertexIndex);
  };

  let wroteFace = pointBasedKind !== null;
  if (pointBasedKind !== null) {
    const objText = `${lines.join('\n')}\n`;
    const bytes = new TextEncoder().encode(objText);
    return {
      blob: new Blob([bytes], { type: 'text/plain;charset=utf-8' }),
      bytes,
    };
  }
  for (let index = 0; index + 2 < triangleIndices.length; index += 3) {
    const a = readRangeNumber(triangleIndices, index) + 1;
    const b = readRangeNumber(triangleIndices, index + 1) + 1;
    const c = readRangeNumber(triangleIndices, index + 2) + 1;
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) {
      continue;
    }
    const uvIndexes = hasFaceVaryingUvs
      ? [index + 1, index + 2, index + 3]
      : hasPerVertexUvs
        ? [a, b, c]
        : [null, null, null];
    const normalIndexes = writesFaceVaryingNormals
      ? [index + 1, index + 2, index + 3]
      : hasPerVertexNormals
        ? [a, b, c]
        : [null, null, null];
    lines.push(
      `f ${formatObjFaceVertex(a, uvIndexes[0], normalIndexes[0])} ${formatObjFaceVertex(
        b,
        uvIndexes[1],
        normalIndexes[1],
      )} ${formatObjFaceVertex(c, uvIndexes[2], normalIndexes[2])}`,
    );
    wroteFace = true;
  }

  if (!wroteFace) {
    return null;
  }

  const objText = `${lines.join('\n')}\n`;
  const bytes = new TextEncoder().encode(objText);

  return {
    blob: new Blob([bytes], { type: 'text/plain;charset=utf-8' }),
    bytes,
  };
}

export function buildObjBlobFromDescriptor(
  descriptor: ExportDescriptor,
  buffers: SnapshotBuffers | null | undefined,
): { blob: Blob; bytes: Uint8Array } | null {
  const ctx = readGeometryData(descriptor, buffers);
  if (!ctx) {
    return null;
  }

  applyTransformToGeometry(ctx);

  return serializeAsOBJ(ctx);
}
