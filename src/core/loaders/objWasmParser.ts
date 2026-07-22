import type { SerializedObjModelData } from './objModelData';
import {
  durationMs,
  type MeshLoadPerformanceEntry,
  readHighResolutionEpochMs,
} from './meshLoadPerformance';

interface ObjParserWasmModule {
  HEAPU8: Uint8Array;
  _free: (ptr: number) => void;
  _malloc: (size: number) => number;
  _obj_parser_free_result: () => void;
  _obj_parser_get_error_ptr: () => number;
  _obj_parser_get_error_size: () => number;
  _obj_parser_get_result_ptr: () => number;
  _obj_parser_get_result_size: () => number;
  _parse_obj: (ptr: number, length: number) => number;
}

type ObjParserModuleFactory = (options?: {
  locateFile?: (path: string) => string;
}) => Promise<ObjParserWasmModule>;

const OBJ_WASM_MAGIC_V1 = 0x3157504f;
const OBJ_WASM_MAGIC_V2 = 0x3257504f;
const OBJ_WASM_MAGIC_V3 = 0x3357504f;
const OBJ_PARSER_PUBLIC_PATH = 'wasm/obj-parser/objParser.js';
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

let modulePromise: Promise<ObjParserWasmModule> | null = null;
let moduleFactoryOverride: ObjParserModuleFactory | null = null;
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

  const publicPath = `${baseUrl}${normalizedPath}`;
  return new URL(publicPath, location.href).href;
}

function buildWasmSiblingUrl(moduleUrl: string, path: string): string {
  return new URL(path, moduleUrl).href;
}

async function loadObjParserModule(): Promise<ObjParserWasmModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const moduleUrl = moduleUrlOverride ?? buildPublicAssetUrl(OBJ_PARSER_PUBLIC_PATH);
      const factory =
        moduleFactoryOverride ??
        (((await import(/* @vite-ignore */ moduleUrl)) as { default?: ObjParserModuleFactory })
          .default as ObjParserModuleFactory | undefined);

      if (!factory) {
        throw new Error('OBJ parser WASM module did not export a module factory.');
      }

      return await factory({
        locateFile: (path) => buildWasmSiblingUrl(moduleUrl, path),
      });
    })();
  }

  return await modulePromise;
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
  options: { alignedFloatArrays: boolean },
): SerializedObjModelData['children'][number]['geometry']['position'] {
  const byteLength = floatCount * Float32Array.BYTES_PER_ELEMENT;
  if (options.alignedFloatArrays) {
    offsetRef.offset = (offsetRef.offset + 3) & ~3;
  }

  const start = offsetRef.offset;
  offsetRef.offset += byteLength;
  if (start % Float32Array.BYTES_PER_ELEMENT !== 0) {
    return {
      array: buffer.slice(start, start + byteLength),
      byteLength,
      itemSize: 1,
    };
  }

  return {
    array: buffer,
    byteOffset: start,
    byteLength,
    itemSize: 1,
  };
}

export function decodeSerializedObjWasmPayload(buffer: ArrayBuffer): SerializedObjModelData {
  const view = new DataView(buffer);
  const offsetRef = { offset: 0 };
  const magic = readU32(view, offsetRef);
  if (magic !== OBJ_WASM_MAGIC_V1 && magic !== OBJ_WASM_MAGIC_V2 && magic !== OBJ_WASM_MAGIC_V3) {
    throw new Error('Invalid OBJ parser WASM payload.');
  }
  const alignedFloatArrays = magic === OBJ_WASM_MAGIC_V2 || magic === OBJ_WASM_MAGIC_V3;
  const hasMaterialFlatShading = magic === OBJ_WASM_MAGIC_V3;

  const materialLibraryCount = readU32(view, offsetRef);
  const materialLibraries: string[] = [];
  for (let index = 0; index < materialLibraryCount; index += 1) {
    materialLibraries.push(readString(buffer, view, offsetRef));
  }

  const childCount = readU32(view, offsetRef);
  const children: SerializedObjModelData['children'] = [];
  for (let childIndex = 0; childIndex < childCount; childIndex += 1) {
    const kindId = readU8(view, offsetRef);
    const name = readString(buffer, view, offsetRef);
    const materialCount = readU32(view, offsetRef);
    const materials: SerializedObjModelData['children'][number]['materials'] = [];
    for (let materialIndex = 0; materialIndex < materialCount; materialIndex += 1) {
      const materialKind: SerializedObjModelData['children'][number]['materials'][number]['kind'] =
        kindId === 1 ? 'line-basic' : kindId === 2 ? 'points' : 'mesh-phong';
      const material = {
        kind: materialKind,
        name: readString(buffer, view, offsetRef),
        color: readU32(view, offsetRef),
        vertexColors: readU8(view, offsetRef) === 1,
      };
      if (hasMaterialFlatShading) {
        materials.push({
          ...material,
          flatShading: readU8(view, offsetRef) === 1,
        });
      } else {
        materials.push(material);
      }
    }

    const vertexCount = readU32(view, offsetRef);
    const position = {
      ...readFloatAttribute(buffer, offsetRef, vertexCount * 3, { alignedFloatArrays }),
      itemSize: 3,
    };

    const hasNormal = readU8(view, offsetRef) === 1;
    const normal = hasNormal
      ? {
          ...readFloatAttribute(buffer, offsetRef, vertexCount * 3, { alignedFloatArrays }),
          itemSize: 3,
        }
      : undefined;

    const hasUv = readU8(view, offsetRef) === 1;
    const uv = hasUv
      ? {
          ...readFloatAttribute(buffer, offsetRef, vertexCount * 2, { alignedFloatArrays }),
          itemSize: 2,
        }
      : undefined;

    const hasColor = readU8(view, offsetRef) === 1;
    const color = hasColor
      ? {
          ...readFloatAttribute(buffer, offsetRef, vertexCount * 3, { alignedFloatArrays }),
          itemSize: 3,
        }
      : undefined;

    const groupCount = readU32(view, offsetRef);
    const groups: SerializedObjModelData['children'][number]['geometry']['groups'] = [];
    for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
      groups.push({
        start: readU32(view, offsetRef),
        count: readU32(view, offsetRef),
        materialIndex: readU32(view, offsetRef),
      });
    }

    children.push({
      kind: kindId === 1 ? 'line-segments' : kindId === 2 ? 'points' : 'mesh',
      name,
      materials,
      geometry: {
        position,
        normal,
        uv,
        color,
        groups,
      },
    });
  }

  if (offsetRef.offset !== buffer.byteLength) {
    throw new Error('OBJ parser WASM payload has trailing bytes.');
  }

  return {
    children,
    materialLibraries,
  };
}

export async function parseObjModelDataWithWasm(
  data: ArrayBuffer | Uint8Array,
  loadPerformance?: MeshLoadPerformanceEntry,
): Promise<SerializedObjModelData> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const wasmStartedAt = readHighResolutionEpochMs();
  const moduleStartedAt = readHighResolutionEpochMs();
  const module = await loadObjParserModule();
  if (loadPerformance) {
    loadPerformance.wasmModuleMs = durationMs(moduleStartedAt);
  }
  const inputPtr = module._malloc(bytes.byteLength);
  if (!inputPtr) {
    throw new Error('Failed to allocate OBJ parser input buffer.');
  }

  try {
    const inputCopyStartedAt = readHighResolutionEpochMs();
    module.HEAPU8.set(bytes, inputPtr);
    if (loadPerformance) {
      loadPerformance.wasmInputCopyMs = durationMs(inputCopyStartedAt);
    }
    const parseStartedAt = readHighResolutionEpochMs();
    const ok = module._parse_obj(inputPtr, bytes.byteLength);
    if (loadPerformance) {
      loadPerformance.wasmParseMs = durationMs(parseStartedAt);
    }
    if (!ok) {
      const errorPtr = module._obj_parser_get_error_ptr();
      const errorSize = module._obj_parser_get_error_size();
      const error =
        errorPtr && errorSize
          ? textDecoder.decode(module.HEAPU8.subarray(errorPtr, errorPtr + errorSize))
          : 'OBJ parser WASM failed.';
      throw new Error(error);
    }

    const resultPtr = module._obj_parser_get_result_ptr();
    const resultSize = module._obj_parser_get_result_size();
    if (!resultPtr || !resultSize) {
      throw new Error('OBJ parser WASM returned an empty result buffer.');
    }

    const resultCopyStartedAt = readHighResolutionEpochMs();
    const resultBytes = module.HEAPU8.slice(resultPtr, resultPtr + resultSize);
    if (loadPerformance) {
      loadPerformance.wasmResultCopyMs = durationMs(resultCopyStartedAt);
    }
    const decodeStartedAt = readHighResolutionEpochMs();
    const result = decodeSerializedObjWasmPayload(resultBytes.buffer);
    if (loadPerformance) {
      loadPerformance.wasmDecodeMs = durationMs(decodeStartedAt);
      loadPerformance.wasmTotalMs = durationMs(wasmStartedAt);
      result.loadPerformance = loadPerformance;
    }
    return result;
  } finally {
    module._free(inputPtr);
    module._obj_parser_free_result();
  }
}

export async function parseObjModelDataFromBytes(
  data: ArrayBuffer | Uint8Array,
  loadPerformance?: MeshLoadPerformanceEntry,
): Promise<SerializedObjModelData> {
  return await parseObjModelDataWithWasm(data, loadPerformance);
}

export function parseObjModelDataFromTextBytes(text: string): Promise<SerializedObjModelData> {
  return parseObjModelDataFromBytes(textEncoder.encode(text));
}

export function resetObjWasmParserForTests(): void {
  modulePromise = null;
  moduleFactoryOverride = null;
  moduleUrlOverride = null;
}

export function setObjWasmParserModuleFactoryForTests(
  factory: ObjParserModuleFactory | null,
): void {
  modulePromise = null;
  moduleFactoryOverride = factory;
}

export function setObjWasmParserModuleUrlForTests(moduleUrl: string | null): void {
  modulePromise = null;
  moduleUrlOverride = moduleUrl;
}
