import { Matrix4, Quaternion, Vector3 } from 'three';

import {
  GeometryType,
  type UrdfVisual,
  type UsdMeshRange,
  type UsdSceneMeshDescriptor,
  type UsdSceneSnapshot,
} from '@/types';

type PrimitiveScale = readonly [number, number, number];

const NORMALIZED_USD_PRIMITIVE_RADIUS = 0.5;
const NORMALIZED_USD_PRIMITIVE_HEIGHT = 1;

function normalizeFinitePositiveNumber(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 1e-9) {
    return null;
  }
  return numeric;
}

function readArrayValues(source: ArrayLike<number> | null | undefined): number[] | null {
  if (!source || typeof source.length !== 'number' || source.length < 16) {
    return null;
  }

  const values: number[] = [];
  for (let index = 0; index < 16; index += 1) {
    const value = Number(source[index]);
    if (!Number.isFinite(value)) {
      return null;
    }
    values.push(value);
  }
  return values;
}

function readRangeValues(
  source: ArrayLike<number> | null | undefined,
  range: UsdMeshRange | null | undefined,
): number[] | null {
  if (
    !source ||
    typeof source.length !== 'number' ||
    !range ||
    !Number.isFinite(range.offset) ||
    !Number.isFinite(range.count)
  ) {
    return null;
  }

  const offset = Math.trunc(range.offset);
  const count = Math.trunc(range.count);
  if (offset < 0 || count < 16 || offset + 16 > source.length) {
    return null;
  }

  const values: number[] = [];
  for (let index = 0; index < 16; index += 1) {
    const value = Number(source[offset + index]);
    if (!Number.isFinite(value)) {
      return null;
    }
    values.push(value);
  }
  return values;
}

function getTransformScaleFromMatrixValues(values: number[] | null): PrimitiveScale | null {
  if (!values || values.length < 16) {
    return null;
  }

  const matrix = new Matrix4().fromArray(values);
  const position = new Vector3();
  const rotation = new Quaternion();
  const scale = new Vector3();
  matrix.decompose(position, rotation, scale);

  const dimensions: PrimitiveScale = [
    Math.abs(scale.x),
    Math.abs(scale.y),
    Math.abs(scale.z),
  ];
  if (dimensions.some((value) => !Number.isFinite(value) || value <= 1e-9)) {
    return null;
  }

  return dimensions;
}

function getDescriptorTransformScale(
  descriptor: UsdSceneMeshDescriptor,
  snapshot: UsdSceneSnapshot | null | undefined,
): PrimitiveScale | null {
  const inlineTransform = readArrayValues(
    (descriptor as UsdSceneMeshDescriptor & { worldTransform?: ArrayLike<number> | null })
      .worldTransform,
  );
  const inlineScale = getTransformScaleFromMatrixValues(inlineTransform);
  if (inlineScale) {
    return inlineScale;
  }

  return getTransformScaleFromMatrixValues(
    readRangeValues(snapshot?.buffers?.transforms, descriptor.ranges?.transform),
  );
}

function hasNonIdentityScale(scale: PrimitiveScale | null): scale is PrimitiveScale {
  if (!scale) {
    return false;
  }

  return (
    Math.abs(scale[0] - 1) > 1e-9 ||
    Math.abs(scale[1] - 1) > 1e-9 ||
    Math.abs(scale[2] - 1) > 1e-9
  );
}

export function getUsdDescriptorPrimitiveType(
  descriptor: UsdSceneMeshDescriptor,
): GeometryType | null {
  const normalized = String(descriptor.primType || '').trim().toLowerCase();

  switch (normalized) {
    case 'box':
    case 'cube':
      return GeometryType.BOX;
    case 'sphere':
      return GeometryType.SPHERE;
    case 'cylinder':
      return GeometryType.CYLINDER;
    case 'capsule':
      return GeometryType.CAPSULE;
    default:
      return null;
  }
}

function getUsdDescriptorAxis(descriptor: UsdSceneMeshDescriptor): 'X' | 'Y' | 'Z' {
  const normalized = String(descriptor.axis || '').trim().toUpperCase();
  if (normalized === 'X' || normalized === 'Y' || normalized === 'Z') {
    return normalized;
  }
  return 'Z';
}

function getUsdDescriptorExtentDimensions(
  descriptor: UsdSceneMeshDescriptor,
): [number, number, number] | null {
  const source = descriptor.extentSize;
  if (!source || typeof source.length !== 'number' || source.length < 3) {
    return null;
  }

  const dimensions = [
    Math.abs(Number(source[0] ?? 0)),
    Math.abs(Number(source[1] ?? 0)),
    Math.abs(Number(source[2] ?? 0)),
  ];

  if (dimensions.some((value) => !Number.isFinite(value) || value <= 1e-9)) {
    return null;
  }

  return [
    Math.max(dimensions[0], 1e-6),
    Math.max(dimensions[1], 1e-6),
    Math.max(dimensions[2], 1e-6),
  ];
}

export function resolveUsdPrimitiveGeometryFromDescriptor(
  descriptor: UsdSceneMeshDescriptor,
  current: UrdfVisual | null | undefined,
  snapshot?: UsdSceneSnapshot | null,
): Pick<UrdfVisual, 'type' | 'dimensions'> | null {
  const primitiveType = getUsdDescriptorPrimitiveType(descriptor);
  if (!primitiveType) {
    return null;
  }

  const extentDimensions = getUsdDescriptorExtentDimensions(descriptor);
  const size = normalizeFinitePositiveNumber(descriptor.size);
  const radius = normalizeFinitePositiveNumber(descriptor.radius);
  const height = normalizeFinitePositiveNumber(descriptor.height);
  const axis = getUsdDescriptorAxis(descriptor);
  const transformScale = getDescriptorTransformScale(descriptor, snapshot);
  const nonIdentityTransformScale = hasNonIdentityScale(transformScale) ? transformScale : null;
  const scaledExtentDimensions = extentDimensions && nonIdentityTransformScale
    ? [
        extentDimensions[0] * nonIdentityTransformScale[0],
        extentDimensions[1] * nonIdentityTransformScale[1],
        extentDimensions[2] * nonIdentityTransformScale[2],
      ] as const
    : extentDimensions;

  if (primitiveType === GeometryType.BOX) {
    const transformScale = nonIdentityTransformScale;
    const scaledSize = nonIdentityTransformScale
      ? size ?? (!extentDimensions ? 1 : null)
      : null;
    const scaledDimensions = scaledSize !== null && transformScale
      ? [
          transformScale[0] * scaledSize,
          transformScale[1] * scaledSize,
          transformScale[2] * scaledSize,
        ]
      : null;

    if (!scaledDimensions && !scaledExtentDimensions && size === null) {
      return null;
    }

    return {
      type: GeometryType.BOX,
      dimensions: {
        x: scaledDimensions?.[0] ?? scaledExtentDimensions?.[0] ?? size ?? 0,
        y: scaledDimensions?.[1] ?? scaledExtentDimensions?.[1] ?? size ?? 0,
        z: scaledDimensions?.[2] ?? scaledExtentDimensions?.[2] ?? size ?? 0,
      },
    };
  }

  if (primitiveType === GeometryType.SPHERE) {
    const radiusFromExtent = scaledExtentDimensions
      ? Math.max(scaledExtentDimensions[0], scaledExtentDimensions[1], scaledExtentDimensions[2]) * 0.5
      : null;
    const scaledSphereBaseRadius = radius ?? (!extentDimensions ? NORMALIZED_USD_PRIMITIVE_RADIUS : null);
    const radiusFromScale = nonIdentityTransformScale && scaledSphereBaseRadius !== null
      ? Math.max(
          nonIdentityTransformScale[0],
          nonIdentityTransformScale[1],
          nonIdentityTransformScale[2],
        ) *
        scaledSphereBaseRadius
      : null;

    const resolvedRadius = radiusFromScale ?? radius ?? radiusFromExtent;
    if (resolvedRadius === null) {
      return null;
    }

    return {
      type: GeometryType.SPHERE,
      dimensions: {
        x: resolvedRadius,
        y: 0,
        z: 0,
      },
    };
  }

  let radiusFromExtent: number | null = null;
  let heightFromExtent: number | null = null;
  if (extentDimensions) {
    if (axis === 'X') {
      heightFromExtent = scaledExtentDimensions?.[0] ?? null;
      radiusFromExtent = scaledExtentDimensions
        ? Math.max(scaledExtentDimensions[1], scaledExtentDimensions[2]) * 0.5
        : null;
    } else if (axis === 'Y') {
      heightFromExtent = scaledExtentDimensions?.[1] ?? null;
      radiusFromExtent = scaledExtentDimensions
        ? Math.max(scaledExtentDimensions[0], scaledExtentDimensions[2]) * 0.5
        : null;
    } else {
      heightFromExtent = scaledExtentDimensions?.[2] ?? null;
      radiusFromExtent = scaledExtentDimensions
        ? Math.max(scaledExtentDimensions[0], scaledExtentDimensions[1]) * 0.5
        : null;
    }
  }

  let radiusFromScale: number | null = null;
  let heightFromScale: number | null = null;
  if (nonIdentityTransformScale) {
    const baseRadius = radius ?? (!extentDimensions ? NORMALIZED_USD_PRIMITIVE_RADIUS : null);
    const baseHeight = height ?? (!extentDimensions ? NORMALIZED_USD_PRIMITIVE_HEIGHT : null);
    if (axis === 'X') {
      radiusFromScale = baseRadius === null
        ? null
        : Math.max(nonIdentityTransformScale[1], nonIdentityTransformScale[2]) * baseRadius;
      heightFromScale = baseHeight === null ? null : nonIdentityTransformScale[0] * baseHeight;
    } else if (axis === 'Y') {
      radiusFromScale = baseRadius === null
        ? null
        : Math.max(nonIdentityTransformScale[0], nonIdentityTransformScale[2]) * baseRadius;
      heightFromScale = baseHeight === null ? null : nonIdentityTransformScale[1] * baseHeight;
    } else {
      radiusFromScale = baseRadius === null
        ? null
        : Math.max(nonIdentityTransformScale[0], nonIdentityTransformScale[1]) * baseRadius;
      heightFromScale = baseHeight === null ? null : nonIdentityTransformScale[2] * baseHeight;
    }
  }

  const resolvedRadius = radiusFromScale ?? radius ?? radiusFromExtent;
  const resolvedHeight = heightFromScale ?? height ?? heightFromExtent;
  if (resolvedRadius === null || resolvedHeight === null) {
    return null;
  }

  return {
    type: primitiveType,
    dimensions: {
      x: resolvedRadius,
      y: resolvedHeight,
      z: 0,
    },
  };
}
