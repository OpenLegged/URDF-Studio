import * as THREE from 'three';

import type { UsdSceneMaterialRecord, UsdSceneMeshDescriptor } from '@/types';
import { URDFCollider, URDFVisual } from '@/core/parsers/urdf/loader/URDFClasses';
import { buildRobotRuntimeFromData, type RobotRuntimeModel } from '../runtime';
import { resolveUsdDescriptorTargetLinkPath } from './usdDescriptorLinkResolution';
import { parseUsdScene, type ParsedUsdScene, type ParseUsdSceneOptions } from './parseUsd';

export interface LoadUsdRobotRuntimeOptions extends ParseUsdSceneOptions {
  parseVisual?: boolean;
  parseCollision?: boolean;
}

export interface UsdRobotRuntime extends RobotRuntimeModel {
  format: 'usd';
  /** Number of baked USD geometry objects attached to the articulated tree. */
  meshCount: number;
}

type DescriptorGeometrySummary = NonNullable<UsdSceneMeshDescriptor['geometry']> & {
  geomSubsetSections?: Array<{
    start?: number | null;
    length?: number | null;
    materialId?: string | null;
  }> | null;
};

function normalizePath(path: string | null | undefined): string {
  return String(path || '')
    .trim()
    .replace(/[<>]/g, '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
}

function getDescriptorRole(descriptor: UsdSceneMeshDescriptor): 'visual' | 'collision' {
  const section = String(descriptor.sectionName || '').toLowerCase();
  const path = `${descriptor.meshId || ''}/${descriptor.resolvedPrimPath || ''}`.toLowerCase();
  return /coll(?:isions?|iders?)/.test(section) || /\/coll(?:isions?|iders?)(?:$|[/.])/.test(path)
    ? 'collision'
    : 'visual';
}

function readRange<T extends ArrayLike<number>>(
  source: T | null | undefined,
  range: { offset: number; count: number } | null | undefined,
): number[] {
  if (!source || !range) return [];
  const start = Math.max(0, Math.floor(Number(range.offset) || 0));
  const count = Math.max(0, Math.floor(Number(range.count) || 0));
  const end = Math.min(source.length, start + count);
  if (start >= end) return [];
  return Array.from({ length: end - start }, (_, index) => Number(source[start + index]));
}

function readDescriptorMatrix(
  descriptor: UsdSceneMeshDescriptor,
  snapshot: ParsedUsdScene['snapshot'],
): THREE.Matrix4 {
  const values = readRange(snapshot.buffers?.transforms, descriptor.ranges?.transform);
  if (values.length < 16 || values.slice(0, 16).some((value) => !Number.isFinite(value))) {
    return new THREE.Matrix4();
  }

  // The native USD bridge serializes GfMatrix values row-major. Three.js keeps
  // Matrix4.elements column-major, matching the Hydra delegate after one transpose.
  return new THREE.Matrix4()
    .set(
      values[0]!,
      values[1]!,
      values[2]!,
      values[3]!,
      values[4]!,
      values[5]!,
      values[6]!,
      values[7]!,
      values[8]!,
      values[9]!,
      values[10]!,
      values[11]!,
      values[12]!,
      values[13]!,
      values[14]!,
      values[15]!,
    )
    .transpose();
}

function createPrimitiveGeometry(descriptor: UsdSceneMeshDescriptor): THREE.BufferGeometry | null {
  const primType = String(descriptor.primType || '')
    .trim()
    .toLowerCase();
  const size = Number(descriptor.size);
  const radius = Number(descriptor.radius);
  const height = Number(descriptor.height);
  const extent = descriptor.extentSize ? Array.from(descriptor.extentSize, Number) : [];
  const safeSize = Number.isFinite(size) && size > 0 ? size : 1;
  const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : 0.5;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 1;

  if (primType === 'box' || primType === 'cube') {
    return new THREE.BoxGeometry(
      Number.isFinite(extent[0]) && extent[0]! > 0 ? extent[0] : safeSize,
      Number.isFinite(extent[1]) && extent[1]! > 0 ? extent[1] : safeSize,
      Number.isFinite(extent[2]) && extent[2]! > 0 ? extent[2] : safeSize,
    );
  }
  if (primType === 'sphere') {
    return new THREE.SphereGeometry(safeRadius, 24, 16);
  }
  if (primType === 'cylinder') {
    return new THREE.CylinderGeometry(safeRadius, safeRadius, safeHeight, 24);
  }
  if (primType === 'capsule') {
    return new THREE.CapsuleGeometry(safeRadius, safeHeight, 8, 16);
  }
  return null;
}

function createDescriptorGeometry(
  descriptor: UsdSceneMeshDescriptor,
  snapshot: ParsedUsdScene['snapshot'],
): THREE.BufferGeometry | null {
  const positions = readRange(snapshot.buffers?.positions, descriptor.ranges?.positions);
  if (positions.length < 3 || positions.length % 3 !== 0) {
    return createPrimitiveGeometry(descriptor);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

  const indices = readRange(snapshot.buffers?.indices, descriptor.ranges?.indices);
  if (indices.length > 0) {
    geometry.setIndex(indices);
  }

  const normals = readRange(snapshot.buffers?.normals, descriptor.ranges?.normals);
  if (normals.length === positions.length) {
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  } else {
    geometry.computeVertexNormals();
  }

  const uvs = readRange(snapshot.buffers?.uvs, descriptor.ranges?.uvs);
  if (uvs.length === (positions.length / 3) * 2) {
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function toColor(value: ArrayLike<number> | null | undefined, fallback: number): THREE.Color {
  if (!value || value.length < 3) return new THREE.Color(fallback);
  const color = new THREE.Color();
  color.setRGB(Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0);
  return color;
}

function finite(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function createMaterial(record: UsdSceneMaterialRecord | null): THREE.MeshPhysicalMaterial {
  const opacity = THREE.MathUtils.clamp(finite(record?.opacity, 1), 0, 1);
  const material = new THREE.MeshPhysicalMaterial({
    name: record?.name || record?.materialId || 'USD Material',
    color: toColor(record?.color ?? record?.authoredColor, 0xcccccc),
    emissive: toColor(record?.emissive, 0x000000),
    emissiveIntensity: Math.max(0, finite(record?.emissiveIntensity, 1)),
    roughness: THREE.MathUtils.clamp(finite(record?.roughness, 0.7), 0, 1),
    metalness: THREE.MathUtils.clamp(finite(record?.metalness, 0), 0, 1),
    opacity,
    transparent: opacity < 1 || record?.opacityEnabled === true,
    alphaTest: THREE.MathUtils.clamp(finite(record?.alphaTest, 0), 0, 1),
    clearcoat: THREE.MathUtils.clamp(finite(record?.clearcoat, 0), 0, 1),
    clearcoatRoughness: THREE.MathUtils.clamp(finite(record?.clearcoatRoughness, 0), 0, 1),
    transmission: THREE.MathUtils.clamp(finite(record?.transmission, 0), 0, 1),
    thickness: Math.max(0, finite(record?.thickness, 0)),
    ior: Math.max(1, finite(record?.ior, 1.5)),
    side: THREE.DoubleSide,
  });
  material.userData.usdMaterialId = record?.materialId ?? null;
  return material;
}

function resolveAssetUrl(path: string, assets: Record<string, string>): string | null {
  if (/^(?:blob:|data:|https?:)/i.test(path)) return path;
  const normalized = normalizePath(path);
  const direct = Object.entries(assets).find(([key]) => normalizePath(key) === normalized)?.[1];
  if (direct) return direct;
  const basename = normalized.split('/').pop();
  if (!basename) return null;
  const basenameMatches = Object.entries(assets).filter(
    ([key]) => normalizePath(key).split('/').pop() === basename,
  );
  return basenameMatches.length === 1 ? basenameMatches[0]![1] : null;
}

async function applyMaterialTextures(
  material: THREE.MeshPhysicalMaterial,
  record: UsdSceneMaterialRecord | null,
  assets: Record<string, string>,
  textureCache: Map<string, Promise<THREE.Texture>>,
): Promise<void> {
  if (!record || typeof Image === 'undefined') return;
  const loader = new THREE.TextureLoader();
  const load = async (path: string | null | undefined, color: boolean) => {
    if (!path) return null;
    const url = resolveAssetUrl(path, assets);
    if (!url) return null;
    let pending = textureCache.get(url);
    if (!pending) {
      pending = loader.loadAsync(url).then((texture) => {
        texture.flipY = false;
        if (color) texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
      });
      textureCache.set(url, pending);
    }
    return pending;
  };

  const [map, emissiveMap, roughnessMap, metalnessMap, normalMap, aoMap, alphaMap] =
    await Promise.all([
      load(record.mapPath, true),
      load(record.emissiveMapPath, true),
      load(record.roughnessMapPath, false),
      load(record.metalnessMapPath, false),
      load(record.normalMapPath, false),
      load(record.aoMapPath, false),
      load(record.alphaMapPath, false),
    ]);
  material.map = map;
  material.emissiveMap = emissiveMap;
  material.roughnessMap = roughnessMap;
  material.metalnessMap = metalnessMap;
  material.normalMap = normalMap;
  material.aoMap = aoMap;
  material.alphaMap = alphaMap;
  material.needsUpdate = true;
}

function findMaterialRecord(
  materialId: string | null | undefined,
  materialById: Map<string, UsdSceneMaterialRecord>,
): UsdSceneMaterialRecord | null {
  if (!materialId) return null;
  return materialById.get(normalizePath(materialId)) ?? null;
}

async function createDescriptorMaterials(
  descriptor: UsdSceneMeshDescriptor,
  materialById: Map<string, UsdSceneMaterialRecord>,
  assets: Record<string, string>,
  textureCache: Map<string, Promise<THREE.Texture>>,
): Promise<THREE.Material | THREE.Material[]> {
  const geometrySummary = descriptor.geometry as DescriptorGeometrySummary | null | undefined;
  const baseRecord = findMaterialRecord(
    geometrySummary?.materialId ?? descriptor.materialId,
    materialById,
  );
  const records = [baseRecord];
  for (const section of geometrySummary?.geomSubsetSections ?? []) {
    records.push(findMaterialRecord(section.materialId, materialById));
  }
  const materials = records.map(createMaterial);
  await Promise.all(
    materials.map((material, index) =>
      applyMaterialTextures(material, records[index] ?? null, assets, textureCache),
    ),
  );
  return materials.length === 1 ? materials[0]! : materials;
}

function applyGeometryGroups(
  geometry: THREE.BufferGeometry,
  descriptor: UsdSceneMeshDescriptor,
): void {
  const sections = (descriptor.geometry as DescriptorGeometrySummary | null | undefined)
    ?.geomSubsetSections;
  if (!sections || sections.length === 0) return;

  geometry.clearGroups();
  const totalCount = geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0;
  let cursor = 0;
  sections
    .map((section, index) => ({
      start: Math.max(0, Math.floor(Number(section.start) || 0)),
      count: Math.max(0, Math.floor(Number(section.length) || 0)),
      materialIndex: index + 1,
    }))
    .sort((left, right) => left.start - right.start)
    .forEach((section) => {
      if (section.start > cursor) geometry.addGroup(cursor, section.start - cursor, 0);
      if (section.count > 0) geometry.addGroup(section.start, section.count, section.materialIndex);
      cursor = Math.max(cursor, section.start + section.count);
    });
  if (cursor < totalCount) geometry.addGroup(cursor, totalCount - cursor, 0);
}

/** Build a visible articulated runtime from a worker-baked USD scene snapshot. */
export async function buildUsdRobotRuntimeFromScene(
  parsed: ParsedUsdScene,
  options: Pick<LoadUsdRobotRuntimeOptions, 'assets' | 'parseVisual' | 'parseCollision'> = {},
): Promise<UsdRobotRuntime> {
  const runtime = await buildRobotRuntimeFromData(parsed.resolution.robotData, {
    parseVisual: false,
    parseCollision: false,
  });

  try {
    runtime.root.updateMatrixWorld(true);
    const materialById = new Map<string, UsdSceneMaterialRecord>();
    Array.from(parsed.snapshot.render?.materials || []).forEach((record) => {
      if (record.materialId) materialById.set(normalizePath(record.materialId), record);
    });
    const textureCache = new Map<string, Promise<THREE.Texture>>();
    const descriptors = Array.from(parsed.snapshot.render?.meshDescriptors || []);
    const knownLinkPaths = Object.keys(parsed.resolution.linkIdByPath);
    const rootLink = runtime.root.links[parsed.resolution.robotData.rootLinkId] ?? runtime.root;
    let meshCount = 0;

    for (const descriptor of descriptors) {
      const role = getDescriptorRole(descriptor);
      if (role === 'visual' && options.parseVisual === false) continue;
      if (role === 'collision' && options.parseCollision === false) continue;

      const geometry = createDescriptorGeometry(descriptor, parsed.snapshot);
      if (!geometry) continue;
      applyGeometryGroups(geometry, descriptor);
      const material = await createDescriptorMaterials(
        descriptor,
        materialById,
        options.assets ?? {},
        textureCache,
      );
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name =
        normalizePath(descriptor.resolvedPrimPath || descriptor.meshId)
          .split('/')
          .pop() || `usd_mesh_${meshCount}`;
      mesh.castShadow = role === 'visual';
      mesh.receiveShadow = true;
      mesh.userData.geometryRole = role;
      mesh.userData.usdMeshId = descriptor.meshId ?? null;
      mesh.userData.usdPrimPath = descriptor.resolvedPrimPath ?? null;

      const linkPath = resolveUsdDescriptorTargetLinkPath({
        descriptor,
        knownLinkPaths,
      });
      const linkId = linkPath ? parsed.resolution.linkIdByPath[linkPath] : null;
      const link = (linkId ? runtime.root.links[linkId] : null) ?? rootLink;
      link.updateMatrixWorld(true);
      mesh.matrix.copy(
        link.matrixWorld
          .clone()
          .invert()
          .multiply(readDescriptorMatrix(descriptor, parsed.snapshot)),
      );
      mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);

      const group = role === 'collision' ? new URDFCollider() : new URDFVisual();
      const groupKey = `usd_${role}_${meshCount}`;
      group.name = groupKey;
      group.urdfName = groupKey;
      group.userData.geometryRole = role;
      group.userData.parentLinkId = linkId ?? parsed.resolution.robotData.rootLinkId;
      group.add(mesh);
      link.add(group);
      if (group instanceof URDFCollider) {
        runtime.root.colliders[groupKey] = group;
      } else {
        runtime.root.visual[groupKey] = group;
      }
      runtime.root.frames[groupKey] = group;
      meshCount += 1;
    }

    if (meshCount === 0) {
      throw new Error('USD stage contains no baked geometry that can be rendered in Motion Stage');
    }

    runtime.root.visuals = runtime.root.visual;
    runtime.root.rotation.x =
      String(parsed.snapshot.stage?.upAxis || '')
        .trim()
        .toLowerCase() === 'y'
        ? Math.PI / 2
        : 0;
    runtime.root.userData.modelFormat = 'usd';
    runtime.root.userData.usdStageSourcePath = parsed.resolution.stageSourcePath;
    runtime.root.updateMatrixWorld(true);

    return {
      ...runtime,
      format: 'usd',
      meshCount,
    };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

/** Parse a USD package and return a visible Three.js robot for Motion Stage. */
export async function loadUsdRobotRuntime(
  content: string,
  filename: string,
  options: LoadUsdRobotRuntimeOptions = {},
): Promise<UsdRobotRuntime> {
  const parsed = await parseUsdScene(content, filename, options);
  return buildUsdRobotRuntimeFromScene(parsed, options);
}
