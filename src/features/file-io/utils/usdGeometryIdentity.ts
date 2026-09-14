import type { BufferAttribute, InterleavedBufferAttribute } from 'three';

type NumericAttribute = BufferAttribute | InterleavedBufferAttribute;

interface GeometryIdentity {
  positions: NumericAttribute;
  faceVertexIndices: number[];
  normalAttribute: NumericAttribute | null;
  normalInterpolation: 'vertex' | 'faceVarying' | null;
  uvAttribute: NumericAttribute | null;
}

const numberBytes = new DataView(new ArrayBuffer(8));

/** Hash both halves of the serialized number; no coordinate quantization. */
export function hashUsdGeometryNumber(hash: number, value: number): number {
  numberBytes.setFloat64(0, Number.isFinite(value) && value !== 0 ? value : 0, true);
  const low = Math.imul(hash ^ numberBytes.getUint32(0, true), 16777619);
  return Math.imul(low ^ numberBytes.getUint32(4, true), 16777619) >>> 0;
}

function sameAttribute(
  left: NumericAttribute | null,
  right: NumericAttribute | null,
  components: 2 | 3,
): boolean {
  if (left === right) return true;
  if (!left || !right || left.count !== right.count) return false;
  for (let index = 0; index < left.count; index += 1) {
    if (left.getX(index) !== right.getX(index) || left.getY(index) !== right.getY(index)) return false;
    if (components === 3 && left.getZ(index) !== right.getZ(index)) return false;
  }
  return true;
}

/** Hash equality only selects candidates; sharing geometry requires exact equality. */
export function hasSameUsdGeometry(left: GeometryIdentity, right: GeometryIdentity): boolean {
  return left.normalInterpolation === right.normalInterpolation
    && left.faceVertexIndices.length === right.faceVertexIndices.length
    && left.faceVertexIndices.every((index, offset) => index === right.faceVertexIndices[offset])
    && sameAttribute(left.positions, right.positions, 3)
    && sameAttribute(left.normalAttribute, right.normalAttribute, 3)
    && sameAttribute(left.uvAttribute, right.uvAttribute, 2);
}
