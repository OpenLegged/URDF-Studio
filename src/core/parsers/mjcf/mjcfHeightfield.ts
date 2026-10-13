import * as THREE from 'three';
import type { MJCFHfield } from './mjcfUtils';
import {
  isMJCFLoadAbortedError,
  throwIfMJCFLoadAborted,
  type MJCFLoadAbortSignal,
} from './mjcfLoadLifecycle';

// Includes the surface, duplicated hard edges, normals, UVs and triangle indices.
// Keep untrusted assets from allocating an unbounded browser mesh.
const MAX_HEIGHTFIELD_SAMPLES = 1_048_576;
const MAX_HEIGHTFIELD_BYTES = 8 + MAX_HEIGHTFIELD_SAMPLES * 4;

interface HeightfieldSamples {
  rows: number;
  columns: number;
  heights: Float32Array;
  flipRows: boolean;
}

function heightfieldError(hfield: MJCFHfield, detail: string, cause?: unknown): Error {
  return new Error(
    `[MJCFLoader] Height field "${hfield.name}": ${detail}`,
    cause === undefined ? undefined : { cause },
  );
}

function validateDimensions(hfield: MJCFHfield, rows?: number, columns?: number): number {
  if (!rows || !columns || !Number.isSafeInteger(rows) || !Number.isSafeInteger(columns)
    || rows < 2 || columns < 2) {
    throw heightfieldError(hfield, 'nrow and ncol must be integers of at least 2');
  }
  const count = rows * columns;
  if (!Number.isSafeInteger(count) || count > MAX_HEIGHTFIELD_SAMPLES) {
    throw heightfieldError(hfield, `sample budget exceeded (maximum ${MAX_HEIGHTFIELD_SAMPLES})`);
  }
  if (count + 8 * (rows + columns - 2) + 4 > 2 * MAX_HEIGHTFIELD_SAMPLES) {
    throw heightfieldError(hfield, 'geometry vertex budget exceeded');
  }
  return count;
}

function decodeBinaryHeightfield(hfield: MJCFHfield, buffer: ArrayBuffer): HeightfieldSamples {
  if (buffer.byteLength < 8) {
    throw heightfieldError(hfield, 'binary asset is missing its rows/columns header');
  }
  const view = new DataView(buffer);
  const rows = view.getInt32(0, true);
  const columns = view.getInt32(4, true);
  const count = validateDimensions(hfield, rows, columns);
  if (buffer.byteLength !== 8 + count * 4) {
    throw heightfieldError(hfield, 'binary asset byte length does not match rows/columns');
  }
  const heights = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    heights[index] = view.getFloat32(8 + index * 4, true);
  }
  // MuJoCo custom binary data already runs from -Y to +Y.
  return { rows, columns, heights, flipRows: false };
}

async function decodePngHeightfield(
  hfield: MJCFHfield,
  buffer: ArrayBuffer,
  abortSignal?: MJCFLoadAbortSignal,
): Promise<HeightfieldSamples> {
  const header = new DataView(buffer);
  if (buffer.byteLength < 24 || header.getUint32(0) !== 0x89504e47
    || header.getUint32(4) !== 0x0d0a1a0a || header.getUint32(12) !== 0x49484452) {
    throw heightfieldError(hfield, 'PNG asset has an invalid header');
  }
  validateDimensions(hfield, header.getUint32(20), header.getUint32(16));
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    throw heightfieldError(hfield, 'PNG decoding requires a browser image/canvas runtime');
  }
  const bitmap = await createImageBitmap(new Blob([buffer], { type: 'image/png' }), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
  try {
    throwIfMJCFLoadAborted(abortSignal);
    const rows = bitmap.height;
    const columns = bitmap.width;
    const count = validateDimensions(hfield, rows, columns);
    const canvas = document.createElement('canvas');
    canvas.width = columns;
    canvas.height = rows;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw heightfieldError(hfield, 'PNG canvas context could not be created');
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, columns, rows).data;
    const heights = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      const offset = index * 4;
      heights[index] = Math.floor(
        (299 * pixels[offset] + 587 * pixels[offset + 1] + 114 * pixels[offset + 2]) / 1000,
      );
    }
    return { rows, columns, heights, flipRows: true };
  } finally {
    bitmap.close();
  }
}

async function readHeightfieldBuffer(
  hfield: MJCFHfield,
  response: Response,
  abortSignal?: MJCFLoadAbortSignal,
): Promise<ArrayBuffer> {
  if (!response.body) return response.arrayBuffer();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const result = await reader.read();
      throwIfMJCFLoadAborted(abortSignal);
      if (result.done) break;
      byteLength += result.value.byteLength;
      if (byteLength > MAX_HEIGHTFIELD_BYTES) {
        throw heightfieldError(hfield, 'asset byte budget exceeded');
      }
      chunks.push(result.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const buffer = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buffer.buffer;
}

async function loadSamples(
  hfield: MJCFHfield,
  assetUrl?: string | null,
  abortSignal?: MJCFLoadAbortSignal,
): Promise<HeightfieldSamples> {
  if (!hfield.file) {
    const count = validateDimensions(hfield, hfield.nrow, hfield.ncol);
    if (hfield.elevation && hfield.elevation.length !== count) {
      throw heightfieldError(hfield, 'elevation length does not match nrow*ncol');
    }
    return {
      rows: hfield.nrow!,
      columns: hfield.ncol!,
      heights: hfield.elevation ? Float32Array.from(hfield.elevation) : new Float32Array(count),
      // XML elevation lists are top-to-bottom, unlike custom binary files.
      flipRows: true,
    };
  }
  if (hfield.nrow || hfield.ncol || hfield.elevation) {
    throw heightfieldError(hfield, 'file and inline dimensions/elevation cannot be combined');
  }
  if (!assetUrl) throw heightfieldError(hfield, `asset could not be resolved: ${hfield.file}`);
  const contentType = hfield.contentType?.trim().toLowerCase();
  if (contentType && contentType !== 'image/png' && contentType !== 'image/vnd.mujoco.hfield') {
    throw heightfieldError(hfield, `unsupported content type: ${contentType}`);
  }
  const response = await fetch(assetUrl, {
    signal: typeof AbortSignal !== 'undefined' && abortSignal instanceof AbortSignal
      ? abortSignal : undefined,
  });
  throwIfMJCFLoadAborted(abortSignal);
  if (!response.ok) throw heightfieldError(hfield, `asset request failed (${response.status})`);
  const declaredLength = Number(response.headers.get('content-length'));
  if (declaredLength > MAX_HEIGHTFIELD_BYTES) {
    await response.body?.cancel();
    throw heightfieldError(hfield, 'asset byte budget exceeded');
  }
  const buffer = await readHeightfieldBuffer(hfield, response, abortSignal);
  throwIfMJCFLoadAborted(abortSignal);
  if (buffer.byteLength > MAX_HEIGHTFIELD_BYTES) {
    throw heightfieldError(hfield, 'asset byte budget exceeded');
  }
  const isPng = contentType ? contentType === 'image/png' : /\.png$/i.test(hfield.file);
  return isPng ? decodePngHeightfield(hfield, buffer, abortSignal)
    : decodeBinaryHeightfield(hfield, buffer);
}

function createHeightfieldGeometry(
  hfield: MJCFHfield,
  samples: HeightfieldSamples,
  size: [number, number, number, number],
  abortSignal?: MJCFLoadAbortSignal,
): THREE.BufferGeometry {
  const { rows, columns, heights, flipRows } = samples;
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const height of heights) {
    if (!Number.isFinite(height)) throw heightfieldError(hfield, 'elevation contains non-finite values');
    minimum = Math.min(minimum, height);
    maximum = Math.max(maximum, height);
  }
  const range = Math.fround(maximum - minimum);
  if (!Number.isFinite(range)) throw heightfieldError(hfield, 'elevation range exceeds Float32 precision');
  const sampleCount = rows * columns;
  const wallSegments = 2 * (rows + columns - 2);
  const vertexCount = sampleCount + 4 * wallSegments + 4;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array((rows - 1) * (columns - 1) * 6 + wallSegments * 6 + 6);
  let vertex = 0;
  let triangle = 0;
  function addVertex(x: number, y: number, z: number): number {
    const index = vertex++;
    positions.set([x, y, z], index * 3);
    uvs.set([(x / size[0] + 1) / 2, (y / size[1] + 1) / 2], index * 2);
    return index;
  }
  function addQuad(a: number, b: number, c: number, d: number): void {
    indices.set([a, b, c, a, c, d], triangle);
    triangle += 6;
  }
  for (let row = 0; row < rows; row += 1) {
    throwIfMJCFLoadAborted(abortSignal);
    const sourceRow = flipRows ? rows - row - 1 : row;
    for (let column = 0; column < columns; column += 1) {
      const relative = Math.fround(heights[sourceRow * columns + column] - minimum);
      const normalized = range > 1e-14 ? Math.fround(relative / range) : relative;
      addVertex(size[0] * (2 * column / (columns - 1) - 1),
        size[1] * (2 * row / (rows - 1) - 1), normalized * size[2]);
    }
  }
  for (let row = 0; row < rows - 1; row += 1) {
    for (let column = 0; column < columns - 1; column += 1) {
      const a = row * columns + column;
      // MuJoCo's row triangle strips use the (-X,-Y) to (+X,+Y) diagonal.
      addQuad(a, a + 1, a + columns + 1, a + columns);
    }
  }
  function addWall(start: number, end: number): void {
    const a = addVertex(positions[start * 3], positions[start * 3 + 1], positions[start * 3 + 2]);
    const b = addVertex(positions[start * 3], positions[start * 3 + 1], -size[3]);
    const c = addVertex(positions[end * 3], positions[end * 3 + 1], -size[3]);
    const d = addVertex(positions[end * 3], positions[end * 3 + 1], positions[end * 3 + 2]);
    addQuad(a, b, c, d);
  }
  for (let column = 0; column < columns - 1; column += 1) {
    addWall(column, column + 1);
    addWall((rows - 1) * columns + column + 1, (rows - 1) * columns + column);
  }
  for (let row = 0; row < rows - 1; row += 1) {
    addWall((row + 1) * columns, row * columns);
    addWall(row * columns + columns - 1, (row + 1) * columns + columns - 1);
  }
  const bottom = vertex;
  addVertex(-size[0], -size[1], -size[3]);
  addVertex(-size[0], size[1], -size[3]);
  addVertex(size[0], size[1], -size[3]);
  addVertex(size[0], -size[1], -size[3]);
  addQuad(bottom, bottom + 1, bottom + 2, bottom + 3);
  throwIfMJCFLoadAborted(abortSignal);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Build local Z-up geometry; the caller owns material, geom pose and disposal. */
export async function loadMJCFHeightfieldGeometry(
  hfield: MJCFHfield,
  assetUrl?: string | null,
  abortSignal?: MJCFLoadAbortSignal,
): Promise<THREE.BufferGeometry> {
  try {
    throwIfMJCFLoadAborted(abortSignal);
    const size = hfield.size;
    if (!size || size.length !== 4 || size.some((value) => !Number.isFinite(value)
      || value <= 0 || !Number.isFinite(Math.fround(value)) || Math.fround(value) <= 0)) {
      throw heightfieldError(hfield, 'size must contain four finite positive values');
    }
    const samples = await loadSamples(hfield, assetUrl, abortSignal);
    throwIfMJCFLoadAborted(abortSignal);
    return createHeightfieldGeometry(hfield, samples, size, abortSignal);
  } catch (error) {
    throwIfMJCFLoadAborted(abortSignal);
    if (isMJCFLoadAbortedError(error)) throw error;
    if (error instanceof Error && error.message.startsWith('[MJCFLoader]')) throw error;
    throw heightfieldError(hfield, 'asset loading or geometry construction failed', error);
  }
}
