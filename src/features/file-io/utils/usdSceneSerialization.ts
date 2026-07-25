import * as THREE from 'three';

import { isUsdMeshObject } from './usdMaterialNormalization.ts';
import { toUsdAuthoredColorFromSrgbTuple } from './usdColorSpace.ts';
import {
  extractUsdMeshGeometryData,
  getUsdNumericAttributeSource,
  getUsdDisplayColor,
  type UsdMeshGeometryData,
  type UsdMaterialSubsetRecord,
  type UsdSerializationContext,
} from './usdSerializationContext.ts';
import { type UsdMaterialMetadata } from './usdSceneNodeFactory.ts';
import {
  advanceUsdProgress,
  createUsdProgressTracker,
  type UsdProgressEvent,
  type UsdProgressTracker,
  yieldPeriodically,
} from './usdProgress.ts';
import {
  escapeUsdString,
  formatUsdFloat,
  formatUsdTuple,
  formatUsdTuple2,
  formatUsdTuple3,
  makeUsdIndent,
  quaternionToUsdTuple,
  sanitizeUsdIdentifier,
  serializeUsdPrimSpecWithMetadata,
} from './usdTextFormatting.ts';

type SerializedPrimitiveType = 'Cube' | 'Sphere' | 'Cylinder' | 'Capsule';

export type UsdSceneSerializationProgress = {
  phase: 'scene';
  completed: number;
  total: number;
  label?: string;
};

export type UsdBaseLayerSerializationOptions = {
  materialProfile?: 'preview' | 'isaacsim';
  useMeshGeometryLibrary?: boolean;
};

type UsdSceneProgressTracker = UsdProgressTracker<'scene'>;

const USD_SCENE_SERIALIZATION_YIELD_INTERVAL = 16;
const USD_SCENE_FACE_VERTEX_CHUNK_SIZE = 16384;
const USD_SCENE_NORMAL_CHUNK_SIZE = 4096;
const USD_SCENE_POINT_CHUNK_SIZE = 4096;
const USD_SCENE_TEXCOORD_CHUNK_SIZE = 4096;

const serializeTransformOps = (lines: string[], depth: number, object: THREE.Object3D): void => {
  const indent = makeUsdIndent(depth);
  const opOrder: string[] = [];

  const hasTranslate = object.position.lengthSq() > 1e-12;
  if (hasTranslate) {
    lines.push(
      `${indent}double3 xformOp:translate = ${formatUsdTuple([
        object.position.x,
        object.position.y,
        object.position.z,
      ])}`,
    );
    opOrder.push('xformOp:translate');
  }

  const hasOrient =
    Math.abs(object.quaternion.x) > 1e-9 ||
    Math.abs(object.quaternion.y) > 1e-9 ||
    Math.abs(object.quaternion.z) > 1e-9 ||
    Math.abs(object.quaternion.w - 1) > 1e-9;
  if (hasOrient) {
    lines.push(`${indent}quatf xformOp:orient = ${quaternionToUsdTuple(object.quaternion)}`);
    opOrder.push('xformOp:orient');
  }

  const hasScale =
    Math.abs(object.scale.x - 1) > 1e-9 ||
    Math.abs(object.scale.y - 1) > 1e-9 ||
    Math.abs(object.scale.z - 1) > 1e-9;
  if (hasScale) {
    lines.push(
      `${indent}double3 xformOp:scale = ${formatUsdTuple([
        object.scale.x,
        object.scale.y,
        object.scale.z,
      ])}`,
    );
    opOrder.push('xformOp:scale');
  }

  if (opOrder.length > 0) {
    lines.push(
      `${indent}uniform token[] xformOpOrder = [${opOrder.map((entry) => `"${entry}"`).join(', ')}]`,
    );
  }
};

const serializeDisplayColor = (lines: string[], depth: number, object: THREE.Object3D): void => {
  const color = getUsdDisplayColor(object);
  if (!color) {
    return;
  }

  const indent = makeUsdIndent(depth);
  lines.push(`${indent}color3f[] primvars:displayColor = [${formatUsdTuple(color)}]`);
};

const serializeVisibility = (lines: string[], depth: number, object: THREE.Object3D): void => {
  const visibility = String(object.userData?.usdVisibility || '').trim();
  if (!visibility) {
    return;
  }

  const indent = makeUsdIndent(depth);
  lines.push(`${indent}token visibility = "${escapeUsdString(visibility)}"`);
};

const serializePrimitiveAttributes = (
  lines: string[],
  depth: number,
  primitiveType: SerializedPrimitiveType,
  object: THREE.Object3D,
): void => {
  const indent = makeUsdIndent(depth);

  if (primitiveType === 'Cube') {
    lines.push(`${indent}double size = 1`);
    return;
  }

  if (primitiveType === 'Sphere') {
    lines.push(
      `${indent}double radius = ${formatUsdFloat(Number(object.userData.usdRadius ?? 0.5))}`,
    );
    return;
  }

  if (primitiveType === 'Cylinder' || primitiveType === 'Capsule') {
    lines.push(
      `${indent}double radius = ${formatUsdFloat(Number(object.userData.usdRadius ?? 0.5))}`,
    );
    lines.push(
      `${indent}double height = ${formatUsdFloat(Number(object.userData.usdHeight ?? 1))}`,
    );
    lines.push(`${indent}uniform token axis = "Z"`);
  }
};

const serializeMeshGeometryData = async (
  data: UsdMeshGeometryData,
  lines: string[],
  depth: number,
): Promise<void> => {
  const indent = makeUsdIndent(depth);

  const serializeChunkedArray = async (
    prefix: string,
    length: number,
    formatter: (index: number) => string,
    chunkSize = 512,
  ) => {
    if (length === 0) {
      lines.push(`${indent}${prefix} = []`);
      return;
    }

    lines.push(`${indent}${prefix} = [`);
    for (let start = 0; start < length; start += chunkSize) {
      const end = Math.min(length, start + chunkSize);
      const chunk = new Array<string>(end - start);
      for (let index = start; index < end; index += 1) {
        chunk[index - start] = formatter(index);
      }

      const suffix = end < length ? ',' : '';
      lines.push(`${makeUsdIndent(depth + 1)}${chunk.join(', ')}${suffix}`);
      await yieldPeriodically(end, chunkSize);
    }
    lines.push(`${indent}]`);
  };

  const serializePoints = async () => {
    const source = getUsdNumericAttributeSource(data.positions);

    lines.push(`${indent}point3f[] points = [`);
    for (let start = 0; start < data.positions.count; start += USD_SCENE_POINT_CHUNK_SIZE) {
      const end = Math.min(data.positions.count, start + USD_SCENE_POINT_CHUNK_SIZE);
      const chunk = new Array<string>(end - start);
      for (let index = start; index < end; index += 1) {
        const chunkIndex = index - start;
        if (source && data.positions.itemSize >= 3) {
          const base = index * source.stride + source.offset;
          chunk[chunkIndex] = formatUsdTuple3(
            Number(source.array[base] ?? 0),
            Number(source.array[base + 1] ?? 0),
            Number(source.array[base + 2] ?? 0),
          );
        } else {
          chunk[chunkIndex] = formatUsdTuple3(
            data.positions.getX(index),
            data.positions.getY(index),
            data.positions.getZ(index),
          );
        }
      }

      const suffix = end < data.positions.count ? ',' : '';
      lines.push(`${makeUsdIndent(depth + 1)}${chunk.join(', ')}${suffix}`);
      await yieldPeriodically(end, USD_SCENE_POINT_CHUNK_SIZE);
    }
    lines.push(`${indent}]`);
  };

  const serializeFaceVaryingUvs = async () => {
    if (!data.uvAttribute || data.faceVertexIndices.length === 0) {
      return;
    }

    const source = getUsdNumericAttributeSource(data.uvAttribute);

    lines.push(`${indent}texCoord2f[] primvars:st = [`);
    for (
      let start = 0;
      start < data.faceVertexIndices.length;
      start += USD_SCENE_TEXCOORD_CHUNK_SIZE
    ) {
      const end = Math.min(data.faceVertexIndices.length, start + USD_SCENE_TEXCOORD_CHUNK_SIZE);
      const chunk = new Array<string>(end - start);
      for (let index = start; index < end; index += 1) {
        const faceVertexIndex = data.faceVertexIndices[index];
        const chunkIndex = index - start;
        if (source && data.uvAttribute.itemSize >= 2) {
          const base = faceVertexIndex * source.stride + source.offset;
          chunk[chunkIndex] = formatUsdTuple2(
            Number(source.array[base] ?? 0),
            Number(source.array[base + 1] ?? 0),
          );
        } else {
          chunk[chunkIndex] = formatUsdTuple2(
            data.uvAttribute.getX(faceVertexIndex),
            data.uvAttribute.getY(faceVertexIndex),
          );
        }
      }

      const suffix = end < data.faceVertexIndices.length ? ',' : '';
      lines.push(`${makeUsdIndent(depth + 1)}${chunk.join(', ')}${suffix}`);
      await yieldPeriodically(end, USD_SCENE_TEXCOORD_CHUNK_SIZE);
    }
    lines.push(`${indent}]`);
    lines.push(`${indent}uniform token primvars:st:interpolation = "faceVarying"`);
  };

  const serializeNormals = async () => {
    if (!data.normalAttribute || !data.normalInterpolation) {
      return;
    }

    const source = getUsdNumericAttributeSource(data.normalAttribute);

    lines.push(`${indent}normal3f[] normals = [`);
    for (let start = 0; start < data.normalAttribute.count; start += USD_SCENE_NORMAL_CHUNK_SIZE) {
      const end = Math.min(data.normalAttribute.count, start + USD_SCENE_NORMAL_CHUNK_SIZE);
      const chunk = new Array<string>(end - start);
      for (let index = start; index < end; index += 1) {
        const chunkIndex = index - start;
        if (source && data.normalAttribute.itemSize >= 3) {
          const base = index * source.stride + source.offset;
          chunk[chunkIndex] = formatUsdTuple3(
            Number(source.array[base] ?? 0),
            Number(source.array[base + 1] ?? 0),
            Number(source.array[base + 2] ?? 0),
          );
        } else {
          chunk[chunkIndex] = formatUsdTuple3(
            data.normalAttribute.getX(index),
            data.normalAttribute.getY(index),
            data.normalAttribute.getZ(index),
          );
        }
      }

      const suffix = end < data.normalAttribute.count ? ',' : '';
      lines.push(`${makeUsdIndent(depth + 1)}${chunk.join(', ')}${suffix}`);
      await yieldPeriodically(end, USD_SCENE_NORMAL_CHUNK_SIZE);
    }
    lines.push(`${indent}]`);
    lines.push(`${indent}uniform token normals:interpolation = "${data.normalInterpolation}"`);
  };

  await serializeChunkedArray(
    'int[] faceVertexCounts',
    data.triangleCount,
    () => '3',
    USD_SCENE_FACE_VERTEX_CHUNK_SIZE,
  );
  await serializeChunkedArray(
    'int[] faceVertexIndices',
    data.faceVertexIndices.length,
    (index) => String(data.faceVertexIndices[index]),
    USD_SCENE_FACE_VERTEX_CHUNK_SIZE,
  );
  await serializePoints();
  await serializeNormals();
  await serializeFaceVaryingUvs();

  lines.push(`${indent}uniform token subdivisionScheme = "none"`);
};

export const applyUsdMaterialMetadata = (
  node: THREE.Object3D,
  materialState: UsdMaterialMetadata,
): void => {
  const explicitOpacity = Number.isFinite(materialState.opacity)
    ? Math.max(0, Math.min(1, Number(materialState.opacity)))
    : undefined;
  node.userData.usdMaterial = materialState;
  if (materialState.colorRgba) {
    node.userData.usdAuthoredColor = toUsdAuthoredColorFromSrgbTuple([
      materialState.colorRgba[0],
      materialState.colorRgba[1],
      materialState.colorRgba[2],
    ]);
    node.userData.usdOpacity = explicitOpacity ?? materialState.colorRgba[3];
  } else if (explicitOpacity !== undefined) {
    node.userData.usdOpacity = explicitOpacity;
  }

  node.traverse((child) => {
    if (child === node) {
      return;
    }

    if (!(child.userData.usdGeomType || isUsdMeshObject(child))) {
      return;
    }

    child.userData.usdMaterial = materialState;
    if (materialState.colorRgba) {
      child.userData.usdAuthoredColor = toUsdAuthoredColorFromSrgbTuple([
        materialState.colorRgba[0],
        materialState.colorRgba[1],
        materialState.colorRgba[2],
      ]);
      child.userData.usdOpacity = explicitOpacity ?? materialState.colorRgba[3];
    } else if (explicitOpacity !== undefined) {
      child.userData.usdOpacity = explicitOpacity;
    }
  });
};

const serializeCustomMetadata = (lines: string[], depth: number, object: THREE.Object3D): void => {
  const indent = makeUsdIndent(depth);
  const linkMetadata = object.userData.usdLink as { id: string; name: string } | undefined;
  if (linkMetadata) {
    lines.push(`${indent}custom string urdf:linkId = "${escapeUsdString(linkMetadata.id)}"`);
    lines.push(`${indent}custom string urdf:linkName = "${escapeUsdString(linkMetadata.name)}"`);
  }

  const materialMetadata = object.userData.usdMaterial as UsdMaterialMetadata | undefined;
  if (materialMetadata?.color) {
    lines.push(
      `${indent}custom string urdf:materialColor = "${escapeUsdString(materialMetadata.color)}"`,
    );
  }
  if (materialMetadata?.texture) {
    lines.push(
      `${indent}custom string urdf:materialTexture = "${escapeUsdString(materialMetadata.texture)}"`,
    );
  }
};

const serializeUsdPreviewMaterials = async (
  lines: string[],
  depth: number,
  context: UsdSerializationContext,
  options: UsdBaseLayerSerializationOptions,
  progressTracker?: UsdSceneProgressTracker,
): Promise<void> => {
  if (context.materialRecords.length === 0) {
    return;
  }

  const indent = makeUsdIndent(depth);
  const childIndent = makeUsdIndent(depth + 1);
  const grandchildIndent = makeUsdIndent(depth + 2);

  lines.push(`${indent}def Scope "Looks"`);
  lines.push(`${indent}{`);

  for (let index = 0; index < context.materialRecords.length; index += 1) {
    const record = context.materialRecords[index];
    const useIsaacSimMaterial = options.materialProfile === 'isaacsim';
    lines.push(`${childIndent}def Material "${record.name}"`);
    lines.push(`${childIndent}{`);
    lines.push(
      `${grandchildIndent}token outputs:surface.connect = <${record.path}/PreviewSurface.outputs:surface>`,
    );
    if (useIsaacSimMaterial) {
      lines.push(
        `${grandchildIndent}token outputs:mdl:surface.connect = <${record.path}/OmniPBR.outputs:out>`,
      );
      lines.push(
        `${grandchildIndent}token outputs:mdl:displacement.connect = <${record.path}/OmniPBR.outputs:out>`,
      );
      lines.push(
        `${grandchildIndent}token outputs:mdl:volume.connect = <${record.path}/OmniPBR.outputs:out>`,
      );
    }
    lines.push(`${grandchildIndent}def Shader "PreviewSurface"`);
    lines.push(`${grandchildIndent}{`);
    lines.push(`${makeUsdIndent(depth + 3)}uniform token info:id = "UsdPreviewSurface"`);
    if (record.appearance.texture) {
      lines.push(
        `${makeUsdIndent(depth + 3)}color3f inputs:diffuseColor.connect = <${record.path}/DiffuseTexture.outputs:rgb>`,
      );
    } else {
      lines.push(
        `${makeUsdIndent(depth + 3)}color3f inputs:diffuseColor = ${formatUsdTuple(record.appearance.authoredColor)}`,
      );
    }
    lines.push(`${makeUsdIndent(depth + 3)}float inputs:metallic = 0`);
    lines.push(`${makeUsdIndent(depth + 3)}float inputs:roughness = 1`);
    lines.push(
      `${makeUsdIndent(depth + 3)}float inputs:opacity = ${formatUsdFloat(record.appearance.opacity)}`,
    );
    lines.push(`${makeUsdIndent(depth + 3)}token outputs:surface`);
    lines.push(`${grandchildIndent}}`);

    if (useIsaacSimMaterial) {
      lines.push(`${grandchildIndent}def Shader "OmniPBR"`);
      lines.push(`${grandchildIndent}{`);
      lines.push(
        `${makeUsdIndent(depth + 3)}uniform token info:implementationSource = "sourceAsset"`,
      );
      lines.push(`${makeUsdIndent(depth + 3)}uniform asset info:mdl:sourceAsset = @OmniPBR.mdl@`);
      lines.push(
        `${makeUsdIndent(depth + 3)}uniform token info:mdl:sourceAsset:subIdentifier = "OmniPBR"`,
      );
      lines.push(
        `${makeUsdIndent(depth + 3)}color3f inputs:diffuse_color_constant = ${formatUsdTuple(record.appearance.authoredColor)}`,
      );
      if (record.appearance.texture) {
        lines.push(
          `${makeUsdIndent(depth + 3)}asset inputs:diffuse_texture = @../assets/${record.appearance.texture.exportPath}@`,
        );
      }
      lines.push(
        `${makeUsdIndent(depth + 3)}float inputs:opacity_constant = ${formatUsdFloat(record.appearance.opacity)}`,
      );
      lines.push(
        `${makeUsdIndent(depth + 3)}bool inputs:enable_opacity = ${record.appearance.opacity < 0.999 ? 'true' : 'false'}`,
      );
      lines.push(`${makeUsdIndent(depth + 3)}bool inputs:enable_opacity_texture = false`);
      lines.push(`${makeUsdIndent(depth + 3)}bool inputs:enable_emission = false`);
      lines.push(`${makeUsdIndent(depth + 3)}token outputs:out`);
      lines.push(`${grandchildIndent}}`);
    }

    if (record.appearance.texture) {
      lines.push(`${grandchildIndent}def Shader "PrimvarReader_st"`);
      lines.push(`${grandchildIndent}{`);
      lines.push(`${makeUsdIndent(depth + 3)}uniform token info:id = "UsdPrimvarReader_float2"`);
      lines.push(`${makeUsdIndent(depth + 3)}token inputs:varname = "st"`);
      lines.push(`${makeUsdIndent(depth + 3)}float2 outputs:result`);
      lines.push(`${grandchildIndent}}`);

      lines.push(`${grandchildIndent}def Shader "DiffuseTexture"`);
      lines.push(`${grandchildIndent}{`);
      lines.push(`${makeUsdIndent(depth + 3)}uniform token info:id = "UsdUVTexture"`);
      lines.push(
        `${makeUsdIndent(depth + 3)}asset inputs:file = @../assets/${record.appearance.texture.exportPath}@`,
      );
      lines.push(
        `${makeUsdIndent(depth + 3)}float2 inputs:st.connect = <${record.path}/PrimvarReader_st.outputs:result>`,
      );
      lines.push(
        `${makeUsdIndent(depth + 3)}float4 inputs:fallback = ${formatUsdTuple([
          ...record.appearance.authoredColor,
          record.appearance.opacity,
        ])}`,
      );
      lines.push(`${makeUsdIndent(depth + 3)}token inputs:sourceColorSpace = "sRGB"`);
      lines.push(`${makeUsdIndent(depth + 3)}float3 outputs:rgb`);
      lines.push(`${grandchildIndent}}`);
    }

    lines.push(`${childIndent}}`);
    advanceUsdProgress(progressTracker, record.name);
    await yieldPeriodically(index + 1, USD_SCENE_SERIALIZATION_YIELD_INTERVAL);
  }

  lines.push(`${indent}}`);
};

const serializeUsdJointScope = (lines: string[], depth: number): void => {
  const indent = makeUsdIndent(depth);
  lines.push(`${indent}def Scope "joints"`);
  lines.push(`${indent}{`);
  lines.push(`${indent}}`);
};

const serializeUsdMeshGeometryLibrary = async (
  lines: string[],
  depth: number,
  context: UsdSerializationContext,
  progressTracker?: UsdSceneProgressTracker,
): Promise<void> => {
  if (context.geometryRecords.length === 0) {
    return;
  }

  const indent = makeUsdIndent(depth);
  const childIndent = makeUsdIndent(depth + 1);

  lines.push(`${indent}class Scope "__MeshLibrary"`);
  lines.push(`${indent}{`);

  for (let index = 0; index < context.geometryRecords.length; index += 1) {
    const record = context.geometryRecords[index];
    lines.push(`${childIndent}class Mesh "${record.name}"`);
    lines.push(`${childIndent}{`);
    await serializeMeshGeometryData(record.data, lines, depth + 2);
    lines.push(`${childIndent}}`);
    advanceUsdProgress(progressTracker, record.name);
    await yieldPeriodically(index + 1, USD_SCENE_SERIALIZATION_YIELD_INTERVAL);
  }

  lines.push(`${indent}}`);
};

const serializeMaterialBinding = (
  lines: string[],
  depth: number,
  object: THREE.Object3D,
  context: UsdSerializationContext,
): void => {
  const materialRecord = context.materialByObject.get(object);
  if (!materialRecord) {
    return;
  }

  lines.push(`${makeUsdIndent(depth)}rel material:binding = <${materialRecord.path}>`);
};

const serializeMaterialSubsets = (
  lines: string[],
  depth: number,
  subsets: readonly UsdMaterialSubsetRecord[],
): void => {
  subsets.forEach((subset, subsetIndex) => {
    const subsetName = sanitizeUsdIdentifier(subset.name || `subset_${subsetIndex}`);
    const metadata = ['prepend apiSchemas = ["MaterialBindingAPI"]'];
    if (subset.displayName) {
      metadata.push(`displayName = "${escapeUsdString(subset.displayName)}"`);
    }

    serializeUsdPrimSpecWithMetadata(lines, depth, `def GeomSubset "${subsetName}"`, metadata);
    lines.push(`${makeUsdIndent(depth)}{`);
    lines.push(`${makeUsdIndent(depth + 1)}token elementType = "face"`);
    lines.push(`${makeUsdIndent(depth + 1)}token familyName = "materialBind"`);
    lines.push(`${makeUsdIndent(depth + 1)}int[] indices = [${subset.faceIndices.join(', ')}]`);
    lines.push(`${makeUsdIndent(depth + 1)}rel material:binding = <${subset.materialRecord.path}>`);
    lines.push(`${makeUsdIndent(depth)}}`);
  });
};

const serializeSceneNode = async (
  object: THREE.Object3D,
  depth: number,
  lines: string[],
  context: UsdSerializationContext,
  options: UsdBaseLayerSerializationOptions,
  forcedName?: string,
  progressTracker?: UsdSceneProgressTracker,
): Promise<void> => {
  const indent = makeUsdIndent(depth);
  const childIndent = makeUsdIndent(depth + 1);
  const primitiveType = object.userData.usdGeomType as SerializedPrimitiveType | undefined;
  const name = sanitizeUsdIdentifier(forcedName || object.name || primitiveType || 'Node');
  const typeName = primitiveType || (isUsdMeshObject(object) ? 'Mesh' : 'Xform');
  const materialRecord = context.materialByObject.get(object);
  const materialSubsets = context.materialSubsetsByObject.get(object) || [];
  const geometryRecord =
    options.useMeshGeometryLibrary !== false && isUsdMeshObject(object)
      ? context.geometryByObject.get(object)
      : undefined;
  const primMetadata: string[] = [];
  const apiSchemas: string[] = [];

  if (materialRecord && materialSubsets.length === 0) {
    apiSchemas.push('"MaterialBindingAPI"');
  }
  if (object.userData?.usdCollision === true && (primitiveType || isUsdMeshObject(object))) {
    apiSchemas.push('"PhysicsCollisionAPI"');
    if (isUsdMeshObject(object)) {
      apiSchemas.push('"PhysicsMeshCollisionAPI"');
    }
  }
  if (geometryRecord) {
    primMetadata.push(`prepend references = <${geometryRecord.path}>`);
  }
  if (apiSchemas.length > 0) {
    primMetadata.unshift(`prepend apiSchemas = [${Array.from(new Set(apiSchemas)).join(', ')}]`);
  }

  serializeUsdPrimSpecWithMetadata(lines, depth, `def ${typeName} "${name}"`, primMetadata);
  lines.push(`${indent}{`);

  const childDepth = depth + 1;

  serializeTransformOps(lines, childDepth, object);
  serializeCustomMetadata(lines, childDepth, object);
  serializeVisibility(lines, childDepth, object);

  if (object.userData?.usdPurpose === 'guide') {
    lines.push(`${childIndent}uniform token purpose = "guide"`);
  }
  if (object.userData?.usdCollision === true && (primitiveType || isUsdMeshObject(object))) {
    lines.push(`${childIndent}bool physics:collisionEnabled = true`);
    if (isUsdMeshObject(object)) {
      lines.push(`${childIndent}uniform token physics:approximation = "convexHull"`);
    }
  }

  if (primitiveType) {
    serializePrimitiveAttributes(lines, childDepth, primitiveType, object);
    serializeDisplayColor(lines, childDepth, object);
    serializeMaterialBinding(lines, childDepth, object, context);
  } else if (isUsdMeshObject(object)) {
    if (!geometryRecord) {
      const inlineGeometry = await extractUsdMeshGeometryData(object);
      if (inlineGeometry) {
        await serializeMeshGeometryData(inlineGeometry, lines, childDepth);
      }
    }
    serializeDisplayColor(lines, childDepth, object);
    if (materialSubsets.length > 0) {
      serializeMaterialSubsets(lines, childDepth, materialSubsets);
    } else {
      serializeMaterialBinding(lines, childDepth, object, context);
    }
  }

  if (depth === 0) {
    if (options.useMeshGeometryLibrary !== false) {
      await serializeUsdMeshGeometryLibrary(lines, childDepth, context, progressTracker);
    }
    await serializeUsdPreviewMaterials(lines, childDepth, context, options, progressTracker);
    serializeUsdJointScope(lines, childDepth);
  }

  advanceUsdProgress(progressTracker, name);

  const usedNames = new Set<string>();
  if (
    depth === 0 &&
    options.useMeshGeometryLibrary !== false &&
    context.geometryRecords.length > 0
  ) {
    usedNames.add('__MeshLibrary');
  }
  if (depth === 0 && context.materialRecords.length > 0) {
    usedNames.add('Looks');
  }
  if (depth === 0) {
    usedNames.add('joints');
  }

  for (let index = 0; index < object.children.length; index += 1) {
    const child = object.children[index];
    const baseChildName = sanitizeUsdIdentifier(child.name || `child_${index}`);
    let childName = baseChildName;
    let duplicateCount = 1;
    while (usedNames.has(childName)) {
      childName = `${baseChildName}_${duplicateCount}`;
      duplicateCount += 1;
    }
    usedNames.add(childName);
    await serializeSceneNode(
      child,
      childDepth,
      lines,
      context,
      options,
      childName,
      progressTracker,
    );
    await yieldPeriodically(index + 1, USD_SCENE_SERIALIZATION_YIELD_INTERVAL);
  }

  lines.push(`${indent}}`);
};

export const buildUsdBaseLayerContent = async (
  sceneRoot: THREE.Object3D,
  serializationContext: UsdSerializationContext,
  onProgress?: (progress: UsdSceneSerializationProgress) => void,
  options: UsdBaseLayerSerializationOptions = {},
): Promise<string> => {
  const rootPrimName = sanitizeUsdIdentifier(sceneRoot.name || 'Robot');
  const lines = [
    '#usda 1.0',
    '(',
    `    defaultPrim = "${rootPrimName}"`,
    '    upAxis = "Z"',
    '    metersPerUnit = 1',
    ')',
    '',
  ];

  let sceneNodeCount = 0;
  sceneRoot.traverse(() => {
    sceneNodeCount += 1;
  });

  const progressTracker = createUsdProgressTracker(
    'scene',
    sceneNodeCount +
      (options.useMeshGeometryLibrary !== false ? serializationContext.geometryRecords.length : 0) +
      serializationContext.materialRecords.length,
    onProgress as ((progress: UsdProgressEvent<'scene'>) => void) | undefined,
  );

  await serializeSceneNode(
    sceneRoot,
    0,
    lines,
    serializationContext,
    options,
    undefined,
    progressTracker,
  );
  return `${lines.join('\n')}\n`;
};
