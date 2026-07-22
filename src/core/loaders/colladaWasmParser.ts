import type {
  SerializedColladaAttributeData,
  SerializedFastColladaSceneData,
} from './colladaWorkerSceneData';
import {
  durationMs,
  type MeshLoadPerformanceEntry,
  readHighResolutionEpochMs,
} from './meshLoadPerformance';

interface ColladaMeshParserWasmModule {
  HEAPU8: Uint8Array;
  _free: (ptr: number) => void;
  _malloc: (size: number) => number;
  _collada_mesh_parser_free_result: () => void;
  _collada_mesh_parser_get_error_ptr: () => number;
  _collada_mesh_parser_get_error_size: () => number;
  _collada_mesh_parser_get_last_timing_ms: (metricIndex: number) => number;
  _collada_mesh_parser_get_result_ptr: () => number;
  _collada_mesh_parser_get_result_size: () => number;
  _parse_collada_mesh: (ptr: number, length: number) => number;
}

type ColladaWasmInternalTimingField =
  | 'colladaWasmFeatureCheckMs'
  | 'colladaWasmUpAxisMs'
  | 'colladaWasmUnitScaleMs'
  | 'colladaWasmImagesMs'
  | 'colladaWasmMaterialsMs'
  | 'colladaWasmGeometriesMs'
  | 'colladaWasmLibraryNodesMs'
  | 'colladaWasmVisualSceneMs'
  | 'colladaWasmWriteResultMs';

const COLLADA_WASM_INTERNAL_TIMING_FIELDS: readonly ColladaWasmInternalTimingField[] = [
  'colladaWasmFeatureCheckMs',
  'colladaWasmUpAxisMs',
  'colladaWasmUnitScaleMs',
  'colladaWasmImagesMs',
  'colladaWasmMaterialsMs',
  'colladaWasmGeometriesMs',
  'colladaWasmLibraryNodesMs',
  'colladaWasmVisualSceneMs',
  'colladaWasmWriteResultMs',
];

type ColladaMeshParserModuleFactory = (options?: {
  locateFile?: (path: string) => string;
}) => Promise<ColladaMeshParserWasmModule>;

const COLLADA_MESH_WASM_MAGIC_V1 = 0x31434d44;
const COLLADA_MESH_WASM_MAGIC_V2 = 0x32434d44;
const COLLADA_MESH_WASM_MAGIC_V3 = 0x33434d44;
const COLLADA_MESH_WASM_MAGIC_V4 = 0x34434d44;
const COLLADA_MESH_PARSER_PUBLIC_PATH = 'wasm/collada-mesh-parser/colladaMeshParser.js';
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

let modulePromise: Promise<ColladaMeshParserWasmModule> | null = null;
let moduleFactoryOverride: ColladaMeshParserModuleFactory | null = null;
let moduleUrlOverride: string | null = null;

function getViteBaseUrl(): string {
  return (
    (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL?.trim() || '/'
  );
}

function buildPublicAssetUrl(path: string): string {
  const baseUrl = getViteBaseUrl().replace(/\/?$/, '/');
  const normalizedPath = path.replace(/^\/+/, '');
  if (typeof location === 'undefined') {
    const root = new URL(/* @vite-ignore */ '../../../', import.meta.url);
    return new URL('public/' + normalizedPath, root).href;
  }

  return new URL(`${baseUrl}${normalizedPath}`, location.href).href;
}

function buildWasmSiblingUrl(moduleUrl: string, path: string): string {
  return new URL(path, moduleUrl).href;
}

async function loadColladaMeshParserModule(): Promise<ColladaMeshParserWasmModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const moduleUrl =
        moduleUrlOverride ?? buildPublicAssetUrl(COLLADA_MESH_PARSER_PUBLIC_PATH);
      const factory =
        moduleFactoryOverride ??
        (((await import(/* @vite-ignore */ moduleUrl)) as {
          default?: ColladaMeshParserModuleFactory;
        }).default as ColladaMeshParserModuleFactory | undefined);

      if (!factory) {
        throw new Error('Collada mesh parser WASM module did not export a module factory.');
      }

      return await factory({
        locateFile: (path) => buildWasmSiblingUrl(moduleUrl, path),
      });
    })();
  }

  return await modulePromise;
}

function recordColladaWasmInternalTimings(
  module: ColladaMeshParserWasmModule,
  loadPerformance: MeshLoadPerformanceEntry | undefined,
): void {
  if (!loadPerformance) {
    return;
  }

  COLLADA_WASM_INTERNAL_TIMING_FIELDS.forEach((field, metricIndex) => {
    const value = module._collada_mesh_parser_get_last_timing_ms(metricIndex);
    if (Number.isFinite(value) && value >= 0) {
      loadPerformance[field] = value;
    }
  });
}

function readU8(view: DataView, offsetRef: { offset: number }): number {
  const value = view.getUint8(offsetRef.offset);
  offsetRef.offset += 1;
  return value;
}

function readU32(view: DataView, offsetRef: { offset: number }): number {
  const value = view.getUint32(offsetRef.offset, true);
  offsetRef.offset += 4;
  return value;
}

function readF32(view: DataView, offsetRef: { offset: number }): number {
  offsetRef.offset = (offsetRef.offset + 3) & ~3;
  const value = view.getFloat32(offsetRef.offset, true);
  offsetRef.offset += 4;
  return value;
}

function readString(buffer: ArrayBuffer, view: DataView, offsetRef: { offset: number }): string {
  const length = readU32(view, offsetRef);
  const start = offsetRef.offset;
  offsetRef.offset += length;
  return textDecoder.decode(new Uint8Array(buffer, start, length));
}

function readFloatAttribute(
  buffer: ArrayBuffer,
  offsetRef: { offset: number },
  floatCount: number,
  itemSize: number,
): SerializedColladaAttributeData {
  offsetRef.offset = (offsetRef.offset + 3) & ~3;
  const byteOffset = offsetRef.offset;
  const byteLength = floatCount * Float32Array.BYTES_PER_ELEMENT;
  offsetRef.offset += byteLength;
  return {
    array: buffer,
    byteOffset,
    byteLength,
    itemSize,
  };
}

export function decodeSerializedColladaMeshWasmPayload(
  buffer: ArrayBuffer,
  resourcePath: string,
): SerializedFastColladaSceneData {
  const view = new DataView(buffer);
  const offsetRef = { offset: 0 };
  const magic = readU32(view, offsetRef);
  if (
    magic !== COLLADA_MESH_WASM_MAGIC_V1 &&
    magic !== COLLADA_MESH_WASM_MAGIC_V2 &&
    magic !== COLLADA_MESH_WASM_MAGIC_V3 &&
    magic !== COLLADA_MESH_WASM_MAGIC_V4
  ) {
    throw new Error('Invalid Collada mesh parser WASM payload.');
  }
  const hasExtendedAttributes =
    magic === COLLADA_MESH_WASM_MAGIC_V2 ||
    magic === COLLADA_MESH_WASM_MAGIC_V3 ||
    magic === COLLADA_MESH_WASM_MAGIC_V4;
  const hasMaterialMetadata =
    magic === COLLADA_MESH_WASM_MAGIC_V3 || magic === COLLADA_MESH_WASM_MAGIC_V4;
  const hasPrimitiveKind = magic === COLLADA_MESH_WASM_MAGIC_V4;

  const unitScale = readF32(view, offsetRef);
  const childCount = readU32(view, offsetRef);
  const children: SerializedFastColladaSceneData['children'] = [];
  for (let childIndex = 0; childIndex < childCount; childIndex += 1) {
    const name = readString(buffer, view, offsetRef);
    const rawPrimitiveKind = hasPrimitiveKind ? readString(buffer, view, offsetRef) : 'mesh';
    const primitiveKind =
      rawPrimitiveKind === 'lines' || rawPrimitiveKind === 'linestrips'
        ? rawPrimitiveKind
        : 'mesh';
    const matrix: number[] = [];
    for (let matrixIndex = 0; matrixIndex < 16; matrixIndex += 1) {
      matrix.push(readF32(view, offsetRef));
    }

    const materialCount = readU32(view, offsetRef);
    const materials: SerializedFastColladaSceneData['children'][number]['materials'] = [];
    for (let materialIndex = 0; materialIndex < materialCount; materialIndex += 1) {
      const material: SerializedFastColladaSceneData['children'][number]['materials'][number] = {
        name: readString(buffer, view, offsetRef),
        color: readU32(view, offsetRef),
        opacity: readF32(view, offsetRef),
      };
      if (hasMaterialMetadata) {
        const model = readString(buffer, view, offsetRef);
        const map = readString(buffer, view, offsetRef);
        const normalMap = readString(buffer, view, offsetRef);
        const specularMap = readString(buffer, view, offsetRef);
        const emissiveMap = readString(buffer, view, offsetRef);
        const lightMap = readString(buffer, view, offsetRef);
        material.model = model || undefined;
        material.map = map || undefined;
        material.normalMap = normalMap || undefined;
        material.specularMap = specularMap || undefined;
        material.emissiveMap = emissiveMap || undefined;
        material.lightMap = lightMap || undefined;
        material.specular = readU32(view, offsetRef);
        material.emissive = readU32(view, offsetRef);
        material.shininess = readF32(view, offsetRef);
        material.doubleSided = readU8(view, offsetRef) === 1;
        material.transparent = readU8(view, offsetRef) === 1;
      }
      materials.push(material);
    }

    const vertexCount = readU32(view, offsetRef);
    const position = readFloatAttribute(buffer, offsetRef, vertexCount * 3, 3);
    const normal =
      readU8(view, offsetRef) === 1
        ? readFloatAttribute(buffer, offsetRef, vertexCount * 3, 3)
        : undefined;
    let uv: SerializedFastColladaSceneData['children'][number]['geometry']['uv'];
    if (readU8(view, offsetRef) === 1) {
      const itemSize = hasExtendedAttributes ? readU32(view, offsetRef) : 2;
      uv = readFloatAttribute(buffer, offsetRef, vertexCount * itemSize, itemSize);
    }
    const uv1 =
      hasExtendedAttributes && readU8(view, offsetRef) === 1
        ? (() => {
            const itemSize = readU32(view, offsetRef);
            return readFloatAttribute(buffer, offsetRef, vertexCount * itemSize, itemSize);
          })()
        : undefined;
    const color =
      hasExtendedAttributes && readU8(view, offsetRef) === 1
        ? (() => {
            const itemSize = readU32(view, offsetRef);
            return readFloatAttribute(buffer, offsetRef, vertexCount * itemSize, itemSize);
          })()
        : undefined;

    const groupCount = readU32(view, offsetRef);
    const groups: SerializedFastColladaSceneData['children'][number]['geometry']['groups'] = [];
    for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
      groups.push({
        start: readU32(view, offsetRef),
        count: readU32(view, offsetRef),
        materialIndex: readU32(view, offsetRef),
      });
    }

    children.push({
      name,
      primitiveKind,
      matrix,
      materials,
      geometry: {
        position,
        normal,
        uv,
        uv1,
        color,
        groups,
      },
    });
  }

  if (offsetRef.offset !== buffer.byteLength) {
    throw new Error('Collada mesh parser WASM payload has trailing bytes.');
  }

  return {
    kind: 'fast-mesh-v1',
    resourcePath,
    children,
    unitScale: unitScale > 0 && unitScale !== 1 ? unitScale : null,
  };
}

export async function parseColladaMeshDataWithWasm(
  data: ArrayBuffer | Uint8Array,
  resourcePath: string,
  loadPerformance?: MeshLoadPerformanceEntry,
): Promise<SerializedFastColladaSceneData> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const wasmStartedAt = readHighResolutionEpochMs();
  const moduleStartedAt = readHighResolutionEpochMs();
  const module = await loadColladaMeshParserModule();
  if (loadPerformance) {
    loadPerformance.wasmModuleMs = durationMs(moduleStartedAt);
  }
  const inputPtr = module._malloc(bytes.byteLength);
  if (!inputPtr) {
    throw new Error('Failed to allocate Collada parser input buffer.');
  }

  try {
    const inputCopyStartedAt = readHighResolutionEpochMs();
    module.HEAPU8.set(bytes, inputPtr);
    if (loadPerformance) {
      loadPerformance.wasmInputCopyMs = durationMs(inputCopyStartedAt);
    }
    const parseStartedAt = readHighResolutionEpochMs();
    const ok = module._parse_collada_mesh(inputPtr, bytes.byteLength);
    if (loadPerformance) {
      loadPerformance.wasmParseMs = durationMs(parseStartedAt);
    }
    recordColladaWasmInternalTimings(module, loadPerformance);
    if (!ok) {
      const errorPtr = module._collada_mesh_parser_get_error_ptr();
      const errorSize = module._collada_mesh_parser_get_error_size();
      const error =
        errorPtr && errorSize
          ? textDecoder.decode(module.HEAPU8.subarray(errorPtr, errorPtr + errorSize))
          : 'Collada mesh parser WASM failed.';
      throw new Error(error);
    }

    const resultPtr = module._collada_mesh_parser_get_result_ptr();
    const resultSize = module._collada_mesh_parser_get_result_size();
    if (!resultPtr || !resultSize) {
      throw new Error('Collada mesh parser WASM returned an empty result buffer.');
    }

    const resultCopyStartedAt = readHighResolutionEpochMs();
    const resultBytes = module.HEAPU8.slice(resultPtr, resultPtr + resultSize);
    if (loadPerformance) {
      loadPerformance.wasmResultCopyMs = durationMs(resultCopyStartedAt);
    }
    const decodeStartedAt = readHighResolutionEpochMs();
    const result = decodeSerializedColladaMeshWasmPayload(resultBytes.buffer, resourcePath);
    if (loadPerformance) {
      loadPerformance.wasmDecodeMs = durationMs(decodeStartedAt);
      loadPerformance.wasmTotalMs = durationMs(wasmStartedAt);
      result.loadPerformance = loadPerformance;
    }
    return result;
  } finally {
    module._free(inputPtr);
    module._collada_mesh_parser_free_result();
  }
}

export function parseColladaMeshDataFromTextWithWasm(
  text: string,
  resourcePath: string,
): Promise<SerializedFastColladaSceneData> {
  return parseColladaMeshDataWithWasm(textEncoder.encode(text), resourcePath);
}

export function resetColladaWasmParserForTests(): void {
  modulePromise = null;
  moduleFactoryOverride = null;
  moduleUrlOverride = null;
}

export function setColladaWasmParserModuleFactoryForTests(
  factory: ColladaMeshParserModuleFactory | null,
): void {
  modulePromise = null;
  moduleFactoryOverride = factory;
}

export function setColladaWasmParserModuleUrlForTests(moduleUrl: string | null): void {
  modulePromise = null;
  moduleUrlOverride = moduleUrl;
}
