import * as THREE from 'three';
import { BOX_FACE_MATERIAL_ORDER, resolveMjcfPassiveSpringJointMetadata } from '@/core/robot';
import { stackCoincidentVisualRoots } from '@/core/loaders/visualMeshStacking';
import { findAssetByPath } from '@/core/loaders';
import { createMatteMaterial } from '@/core/utils/materialFactory';
import { createThreeColorFromSRGB } from '@/core/utils/color.ts';
import { applyVisualMeshShadowPolicy } from '@/core/utils/visualMeshShadowPolicy';
import {
  COLLISION_OVERLAY_RENDER_ORDER,
  createCollisionOverlayMaterial,
} from '@/core/utils/three/collisionOverlayMaterial';
import { URDFCollider, URDFVisual } from '../urdf/loader/URDFClasses';
import { createGeometryMesh, type MJCFMeshCache } from './mjcfGeometry';
import { assignMJCFBodyGeomRoles } from './mjcfGeomClassification';
import { applyRgbaToMesh, createJointAxisHelper, createLinkAxesHelper } from './mjcfRenderHelpers';
import type { MJCFCompilerSettings, MJCFMesh, MJCFMaterial, MJCFTexture } from './mjcfUtils';
import { getMjcfCubeTextureFacePaths, getMjcfCubeTextureFaceRecord } from './mjcfCubeTextures';
import { convertMjcfAngle, mjcfQuatToThreeQuat } from './mjcfMath';
import { createMainThreadYieldController } from '@/core/utils/yieldToMainThread';
import {
  disposeTemporaryTexturePromiseCache,
  disposeTransientObject3D,
  isMJCFLoadAbortedError,
  type MJCFLoadAbortSignal,
  throwIfMJCFLoadAborted,
} from './mjcfLoadLifecycle';
import {
  isMjcfCubeTexture,
  createBuiltinCubeFaceTextures,
  getBuiltinTexturePromise,
} from './mjcfBuiltinTextures';

export interface MJCFHierarchyGeom {
  name?: string;
  className?: string;
  classQName?: string;
  type: string;
  size?: number[];
  mesh?: string;
  rgba?: [number, number, number, number];
  hasExplicitRgba?: boolean;
  pos?: [number, number, number];
  quat?: [number, number, number, number];
  fromto?: number[];
  contype?: number;
  conaffinity?: number;
  group?: number;
  material?: string;
}

export interface MJCFHierarchyJoint {
  name: string;
  type: string;
  axis?: [number, number, number];
  range?: [number, number];
  ref?: number;
  pos?: [number, number, number];
  stiffness?: number;
}

export interface MJCFHierarchySite {
  name: string;
  type: string;
  size?: number[];
  rgba?: [number, number, number, number];
  pos?: [number, number, number];
  quat?: [number, number, number, number];
  group?: number;
}

export interface MJCFHierarchyBody {
  name: string;
  pos: [number, number, number];
  quat?: [number, number, number, number];
  euler?: [number, number, number];
  geoms: MJCFHierarchyGeom[];
  sites?: MJCFHierarchySite[];
  joints: MJCFHierarchyJoint[];
  children: MJCFHierarchyBody[];
}

interface BuildMJCFHierarchyOptions {
  bodies: MJCFHierarchyBody[];
  rootGroup: THREE.Group;
  meshMap: Map<string, MJCFMesh>;
  assets: Record<string, string>;
  abortSignal?: MJCFLoadAbortSignal;
  meshCache: MJCFMeshCache;
  compilerSettings: MJCFCompilerSettings;
  materialMap: Map<string, MJCFMaterial>;
  textureMap: Map<string, MJCFTexture>;
  actuatorMap?: Map<string, unknown[]>;
  sourceFileDir?: string;
  onProgress?: (progress: { processedGeoms: number; totalGeoms: number }) => void;
  yieldIfNeeded?: () => Promise<void>;
  onAsyncSceneMutation?: () => void;
}

export interface MJCFHierarchyResult {
  linksMap: Record<string, THREE.Object3D>;
  jointsMap: Record<string, THREE.Object3D>;
  deferredTextureApplicationsReady: Promise<void>;
}

type RuntimeJointMetadataNode = THREE.Object3D & {
  parentLinkId?: string | null;
  parentName?: string | null;
  childLinkId?: string;
  childName?: string;
  parentLink?: THREE.Object3D | null;
  child?: THREE.Object3D;
};

function isRecoverableMissingMeshAssetError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.startsWith('[MJCFLoader] Mesh file could not be resolved:')
  );
}

function restackLinkVisualRoots(linkTarget: THREE.Object3D): void {
  const visualRoots = linkTarget.children
    .filter((child: any) => child?.isURDFVisual)
    .map((child, index) => ({
      root: child,
      stableId: child.userData?.visualOrder ?? index,
    }));

  if (visualRoots.length < 2) {
    return;
  }

  stackCoincidentVisualRoots(visualRoots);
}

function restackRobotVisualRoots(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);

  const visualRoots: Array<{ root: THREE.Object3D; stableId: number }> = [];
  let visualIndex = 0;
  root.traverse((child: any) => {
    if (!child?.isURDFVisual) {
      return;
    }

    visualRoots.push({
      root: child,
      stableId: visualIndex++,
    });
  });

  if (visualRoots.length < 2) {
    return;
  }

  stackCoincidentVisualRoots(visualRoots, { space: 'world' });
}

function countBodyGeoms(body: MJCFHierarchyBody): number {
  return body.geoms.length + body.children.reduce((sum, child) => sum + countBodyGeoms(child), 0);
}

function cloneSiteData(sites: MJCFHierarchySite[] | undefined): MJCFHierarchySite[] {
  if (!sites || sites.length === 0) {
    return [];
  }

  return sites.map((site) => ({
    ...site,
    size: Array.isArray(site.size) ? [...site.size] : undefined,
    rgba: Array.isArray(site.rgba)
      ? ([...site.rgba] as [number, number, number, number])
      : undefined,
    pos: Array.isArray(site.pos) ? ([...site.pos] as [number, number, number]) : undefined,
    quat: Array.isArray(site.quat)
      ? ([...site.quat] as [number, number, number, number])
      : undefined,
  }));
}

function walkMJCFBodies(
  bodies: MJCFHierarchyBody[],
  visitor: (body: MJCFHierarchyBody) => void,
): void {
  for (const body of bodies) {
    visitor(body);
    if (body.children.length > 0) {
      walkMJCFBodies(body.children, visitor);
    }
  }
}

function resolveRuntimeJointType(
  joint: MJCFHierarchyJoint,
): 'revolute' | 'continuous' | 'prismatic' | 'ball' | 'floating' {
  if (joint.type === 'hinge') {
    return joint.range ? 'revolute' : 'continuous';
  }

  if (joint.type === 'slide') {
    return 'prismatic';
  }

  if (joint.type === 'ball') {
    return 'ball';
  }

  if (joint.type === 'free') {
    return 'floating';
  }

  return 'continuous';
}

function resolveInitialRuntimeJointValue(joint: MJCFHierarchyJoint): number | null {
  if (!Number.isFinite(joint.ref)) {
    return null;
  }

  if (joint.type === 'hinge' || joint.type === 'slide') {
    return joint.ref ?? null;
  }

  return null;
}

const textureLoader = new THREE.TextureLoader();
let imageBitmapTextureLoader: THREE.ImageBitmapLoader | null = null;
type MJCFTextureLoadCache = Map<string, Promise<THREE.Texture | null>>;

function canUseImageBitmapTextureLoading(): boolean {
  return typeof createImageBitmap === 'function';
}

function getImageBitmapTextureLoader(): THREE.ImageBitmapLoader {
  if (!imageBitmapTextureLoader) {
    imageBitmapTextureLoader = new THREE.ImageBitmapLoader();
    imageBitmapTextureLoader.setOptions({ imageOrientation: 'flipY', premultiplyAlpha: 'none' });
  }

  return imageBitmapTextureLoader;
}

function configureLoadedTexture(texture: THREE.Texture): THREE.Texture {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

async function loadTextureWithPreferredLoader(assetUrl: string): Promise<THREE.Texture | null> {
  if (canUseImageBitmapTextureLoading()) {
    try {
      const imageBitmap = await getImageBitmapTextureLoader().loadAsync(assetUrl);
      return configureLoadedTexture(new THREE.Texture(imageBitmap));
    } catch (error) {
      console.warn(
        `[MJCFLoader] ImageBitmap texture decode failed, falling back to TextureLoader: ${assetUrl}`,
        error,
      );
    }
  }

  const texture = await textureLoader.loadAsync(assetUrl);
  return configureLoadedTexture(texture);
}

function getTexturePromise(
  assetUrl: string,
  textureLoadCache: MJCFTextureLoadCache,
): Promise<THREE.Texture | null> {
  const cached = textureLoadCache.get(assetUrl);
  if (cached) {
    return cached;
  }

  const promise = loadTextureWithPreferredLoader(assetUrl).catch((error) => {
    console.error(`[MJCFLoader] Failed to load texture asset: ${assetUrl}`, error);
    return null;
  });

  textureLoadCache.set(assetUrl, promise);
  return promise;
}

function cloneTextureWithMaterialSettings(
  baseTexture: THREE.Texture,
  materialDef: MJCFMaterial,
): THREE.Texture {
  const texture = baseTexture.clone();
  texture.source = baseTexture.source;
  return applyTextureMaterialSettings(texture, materialDef);
}

function applyTextureMaterialSettings(
  baseTexture: THREE.Texture,
  materialDef: MJCFMaterial,
): THREE.Texture {
  const texture = baseTexture;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;

  if (materialDef.texrepeat && materialDef.texrepeat.length >= 2) {
    texture.repeat.set(materialDef.texrepeat[0] ?? 1, materialDef.texrepeat[1] ?? 1);
  } else {
    texture.repeat.set(1, 1);
  }

  texture.needsUpdate = true;
  return texture;
}

function collectReferencedTextureAssetUrls(
  bodies: MJCFHierarchyBody[],
  materialMap: Map<string, MJCFMaterial>,
  textureMap: Map<string, MJCFTexture>,
  assets: Record<string, string>,
  sourceFileDir: string,
): string[] {
  const assetUrls = new Set<string>();

  walkMJCFBodies(bodies, (body) => {
    body.geoms.forEach((geom) => {
      if (!geom.material) {
        return;
      }

      const materialDef = materialMap.get(geom.material);
      if (!materialDef?.texture) {
        return;
      }

      const textureDef = textureMap.get(materialDef.texture);
      const cubeFacePaths = getMjcfCubeTextureFacePaths(textureDef);
      if (cubeFacePaths.length > 0) {
        cubeFacePaths.forEach((texturePath) => {
          const assetUrl = findAssetByPath(texturePath, assets, sourceFileDir);
          if (assetUrl) {
            assetUrls.add(assetUrl);
          }
        });
        return;
      }

      if (!textureDef?.file) {
        return;
      }

      const assetUrl = findAssetByPath(textureDef.file, assets, sourceFileDir);
      if (assetUrl) {
        assetUrls.add(assetUrl);
      }
    });
  });

  return [...assetUrls];
}

function resolveMJCFGeomType(geom: MJCFHierarchyGeom): string {
  return geom.type?.trim() || (geom.mesh ? 'mesh' : '');
}

function collectFirstMeshGeomByMeshName(
  bodies: MJCFHierarchyBody[],
): Map<string, MJCFHierarchyGeom> {
  const firstMeshGeomByName = new Map<string, MJCFHierarchyGeom>();

  walkMJCFBodies(bodies, (body) => {
    assignMJCFBodyGeomRoles(body.geoms).forEach(({ geom, renderVisual, renderCollision }) => {
      if (!renderVisual && !renderCollision) {
        return;
      }

      if (!geom.mesh || firstMeshGeomByName.has(geom.mesh)) {
        return;
      }

      const geomType = resolveMJCFGeomType(geom);
      if (geomType !== 'mesh' && geomType !== 'sdf') {
        return;
      }

      firstMeshGeomByName.set(geom.mesh, geom);
    });
  });

  return firstMeshGeomByName;
}

async function loadMaterialTexture(
  materialDef: MJCFMaterial,
  textureMap: Map<string, MJCFTexture>,
  assets: Record<string, string>,
  sourceFileDir: string,
  textureLoadCache: MJCFTextureLoadCache,
  abortSignal?: MJCFLoadAbortSignal,
): Promise<THREE.Texture | null> {
  throwIfMJCFLoadAborted(abortSignal);
  if (!materialDef.texture) {
    return null;
  }

  const textureDef = textureMap.get(materialDef.texture);
  if (!textureDef) {
    console.error(
      `[MJCFLoader] Material "${materialDef.name || '<unnamed>'}" references missing texture definition: ${materialDef.texture}`,
    );
    return null;
  }

  if (!textureDef.file && textureDef.builtin) {
    const texture = await getBuiltinTexturePromise(textureDef, textureLoadCache);
    if (!texture) {
      return null;
    }

    throwIfMJCFLoadAborted(abortSignal);
    return cloneTextureWithMaterialSettings(texture, materialDef);
  }

  if (!textureDef.file) {
    console.error(
      `[MJCFLoader] Material "${materialDef.name || '<unnamed>'}" references missing texture definition: ${materialDef.texture}`,
    );
    return null;
  }

  const assetUrl = findAssetByPath(textureDef.file, assets, sourceFileDir);
  if (!assetUrl) {
    console.error(`[MJCFLoader] Texture asset not found: ${textureDef.file}`);
    return null;
  }

  const texture = await getTexturePromise(assetUrl, textureLoadCache);
  if (!texture) {
    return null;
  }

  throwIfMJCFLoadAborted(abortSignal);
  return cloneTextureWithMaterialSettings(texture, materialDef);
}

async function loadCubeMaterialTextures(
  materialDef: MJCFMaterial,
  textureMap: Map<string, MJCFTexture>,
  assets: Record<string, string>,
  sourceFileDir: string,
  textureLoadCache: MJCFTextureLoadCache,
  abortSignal?: MJCFLoadAbortSignal,
): Promise<THREE.Texture[] | null> {
  throwIfMJCFLoadAborted(abortSignal);
  if (!materialDef.texture) {
    return null;
  }

  const textureDef = textureMap.get(materialDef.texture);
  if (!isMjcfCubeTexture(textureDef)) {
    return null;
  }

  const cubeFaceRecord = getMjcfCubeTextureFaceRecord(textureDef);
  if (cubeFaceRecord) {
    const textures: THREE.Texture[] = [];
    for (const texturePath of Object.values(cubeFaceRecord)) {
      const assetUrl = findAssetByPath(texturePath, assets, sourceFileDir);
      if (!assetUrl) {
        console.error(`[MJCFLoader] Cube texture asset not found: ${texturePath}`);
        return null;
      }

      const texture = await getTexturePromise(assetUrl, textureLoadCache);
      if (!texture) {
        return null;
      }

      throwIfMJCFLoadAborted(abortSignal);
      textures.push(cloneTextureWithMaterialSettings(texture, materialDef));
    }

    return textures;
  }

  if (textureDef?.builtin) {
    return (
      createBuiltinCubeFaceTextures(textureDef)?.map((texture) =>
        applyTextureMaterialSettings(texture, materialDef),
      ) || null
    );
  }

  if (textureDef?.file) {
    const assetUrl = findAssetByPath(textureDef.file, assets, sourceFileDir);
    if (!assetUrl) {
      console.error(`[MJCFLoader] Cube texture asset not found: ${textureDef.file}`);
      return null;
    }

    const baseTexture = await getTexturePromise(assetUrl, textureLoadCache);
    if (!baseTexture) {
      return null;
    }

    throwIfMJCFLoadAborted(abortSignal);
    return BOX_FACE_MATERIAL_ORDER.map(() =>
      cloneTextureWithMaterialSettings(baseTexture, materialDef),
    );
  }

  console.error(
    `[MJCFLoader] Material "${materialDef.name || '<unnamed>'}" references incomplete cube texture definition: ${materialDef.texture}`,
  );
  return null;
}

async function applyCubeMaterialAssetToMesh(
  mesh: THREE.Object3D,
  materialDef: MJCFMaterial,
  textureMap: Map<string, MJCFTexture>,
  assets: Record<string, string>,
  sourceFileDir: string,
  textureLoadCache: MJCFTextureLoadCache,
  abortSignal?: MJCFLoadAbortSignal,
  materialName?: string,
  inheritedGeomRgba?: [number, number, number, number],
  hasExplicitGeomRgba: boolean = false,
): Promise<boolean> {
  const faceTextures = await loadCubeMaterialTextures(
    materialDef,
    textureMap,
    assets,
    sourceFileDir,
    textureLoadCache,
    abortSignal,
  );
  if (!faceTextures || faceTextures.length === 0) {
    return false;
  }

  const hasAuthoredRgba = Array.isArray(materialDef.rgba) && materialDef.rgba.length >= 3;
  const rgba = materialDef.rgba || [1, 1, 1, 1];
  const r = Math.max(0, Math.min(1, rgba[0] ?? 1));
  const g = Math.max(0, Math.min(1, rgba[1] ?? 1));
  const b = Math.max(0, Math.min(1, rgba[2] ?? 1));
  const inheritedAlphaOverride =
    !hasExplicitGeomRgba &&
    Array.isArray(inheritedGeomRgba) &&
    inheritedGeomRgba.length >= 4 &&
    Number.isFinite(inheritedGeomRgba[3]) &&
    (inheritedGeomRgba[3] ?? 1) < 0.999
      ? inheritedGeomRgba[3]
      : null;
  const alpha = Math.max(0, Math.min(1, inheritedAlphaOverride ?? rgba[3] ?? 1));
  const roughness =
    materialDef.shininess != null ? Math.max(0, Math.min(1, 1 - materialDef.shininess)) : undefined;
  const metalness =
    materialDef.reflectance != null ? Math.max(0, Math.min(1, materialDef.reflectance)) : undefined;
  const emission =
    materialDef.emission != null ? Math.max(0, Math.min(1, materialDef.emission)) : undefined;

  let applied = false;
  mesh.traverse((child: any) => {
    if (!child?.isMesh) {
      return;
    }

    const targetMesh = child as THREE.Mesh;
    const geometry = targetMesh.geometry;
    if (!(geometry instanceof THREE.BoxGeometry) && geometry.type !== 'BoxGeometry') {
      return;
    }

    const preferDoubleSide = alpha < 1 || Boolean(targetMesh.userData?.mjcfPreferDoubleSide);
    const currentMaterials = Array.isArray(targetMesh.material)
      ? targetMesh.material
      : [targetMesh.material];
    const nextMaterials = faceTextures.map((texture, index) => {
      const nextMaterial = createMatteMaterial({
        color: createThreeColorFromSRGB(r, g, b),
        opacity: alpha,
        transparent: alpha < 1,
        side: preferDoubleSide ? THREE.DoubleSide : THREE.FrontSide,
        map: texture,
        name: `${materialName || materialDef.name || 'mjcf_material_asset'}_${index + 1}`,
        preserveExactColor: hasAuthoredRgba || Boolean(materialDef.texture),
      });

      if (roughness != null) {
        nextMaterial.roughness = roughness;
      }
      if (metalness != null) {
        nextMaterial.metalness = metalness;
      }
      if (emission != null) {
        nextMaterial.emissive = new THREE.Color(r, g, b);
        nextMaterial.emissiveIntensity = emission;
      }
      nextMaterial.needsUpdate = true;
      return nextMaterial;
    });

    targetMesh.material = nextMaterials;
    currentMaterials.forEach((material) => material?.dispose?.());
    applyVisualMeshShadowPolicy(targetMesh);
    applied = true;
  });

  if (!applied) {
    faceTextures.forEach((texture) => texture.dispose());
  }

  return applied;
}

async function applyMaterialAssetToMesh(
  mesh: THREE.Object3D,
  materialDef: MJCFMaterial,
  textureMap: Map<string, MJCFTexture>,
  assets: Record<string, string>,
  sourceFileDir: string,
  textureLoadCache: MJCFTextureLoadCache,
  abortSignal?: MJCFLoadAbortSignal,
  materialName?: string,
  inheritedGeomRgba?: [number, number, number, number],
  hasExplicitGeomRgba: boolean = false,
  options: {
    deferTextureLoad?: boolean;
    enqueueDeferredTextureApplication?: ((job: () => Promise<void>) => void) | undefined;
    yieldIfNeeded?: (() => Promise<void>) | undefined;
    onAsyncSceneMutation?: (() => void) | undefined;
    materialAssetCache?: Map<string, THREE.MeshStandardMaterial>;
  } = {},
): Promise<void> {
  const appliedCubeTextureMaterials = await applyCubeMaterialAssetToMesh(
    mesh,
    materialDef,
    textureMap,
    assets,
    sourceFileDir,
    textureLoadCache,
    abortSignal,
    materialName,
    inheritedGeomRgba,
    hasExplicitGeomRgba,
  );
  if (appliedCubeTextureMaterials) {
    return;
  }

  const hasAuthoredRgba = Array.isArray(materialDef.rgba) && materialDef.rgba.length >= 3;
  const rgba = materialDef.rgba || (materialDef.texture ? [1, 1, 1, 1] : [0.8, 0.8, 0.8, 1]);
  const r = Math.max(0, Math.min(1, rgba[0] ?? 0.8));
  const g = Math.max(0, Math.min(1, rgba[1] ?? 0.8));
  const b = Math.max(0, Math.min(1, rgba[2] ?? 0.8));
  const inheritedAlphaOverride =
    !hasExplicitGeomRgba &&
    Array.isArray(inheritedGeomRgba) &&
    inheritedGeomRgba.length >= 4 &&
    Number.isFinite(inheritedGeomRgba[3]) &&
    (inheritedGeomRgba[3] ?? 1) < 0.999
      ? inheritedGeomRgba[3]
      : null;
  const alpha = Math.max(0, Math.min(1, inheritedAlphaOverride ?? rgba[3] ?? 1));
  const roughness =
    materialDef.shininess != null ? Math.max(0, Math.min(1, 1 - materialDef.shininess)) : undefined;
  const metalness =
    materialDef.reflectance != null ? Math.max(0, Math.min(1, materialDef.reflectance)) : undefined;
  const emission =
    materialDef.emission != null ? Math.max(0, Math.min(1, materialDef.emission)) : undefined;
  const materialTargets: THREE.Mesh[] = [];
  mesh.traverse((child: any) => {
    if (child.isMesh) {
      materialTargets.push(child as THREE.Mesh);
    }
  });

  const materialAssetCache = options.materialAssetCache;
  // Cache key spans the parameters that materially change the resulting
  // MeshStandardMaterial. Same (materialDef, alpha, preferDoubleSide,
  // hasAuthoredRgba) → identical material; can be shared across geoms.
  // alpha + preferDoubleSide are derived per-mesh (inheritedGeomRgba is
  // pinned by this call). MJCF documents like menagerie's anymal_b
  // reference ~10 distinct <material> elements across ~140 <geom>s; without
  // this cache the loader allocated one MeshStandardMaterial per geom and
  // every assembly add re-spent that cost — the path the user hit.
  const buildCacheKey = (preferDoubleSide: boolean): string =>
    `${materialName || materialDef.name || ''}|a=${alpha.toFixed(4)}|d=${preferDoubleSide ? 1 : 0}|${
      hasAuthoredRgba ? 'a' : 'g'
    }|tx=${materialDef.texture || ''}`;

  const applyResolvedMaterial = (
    resolvedTexture: THREE.Texture | null,
    mode: 'create' | 'update' = 'create',
  ) => {
    const updatedSharedMaterials = new Set<THREE.MeshStandardMaterial>();
    materialTargets.forEach((targetMesh) => {
      const preferDoubleSide = alpha < 1 || Boolean(targetMesh.userData?.mjcfPreferDoubleSide);
      const existingMaterial =
        targetMesh.material instanceof THREE.MeshStandardMaterial ? targetMesh.material : null;

      if (mode === 'update' && existingMaterial) {
        if (!updatedSharedMaterials.has(existingMaterial)) {
          existingMaterial.map = resolvedTexture;
          if (resolvedTexture) {
            const textureBaseColor = createThreeColorFromSRGB(r, g, b);
            existingMaterial.color.copy(textureBaseColor);
            existingMaterial.userData.originalColor = textureBaseColor.clone();
            existingMaterial.toneMapped = false;
          }
          existingMaterial.needsUpdate = true;
          updatedSharedMaterials.add(existingMaterial);
        }
        applyVisualMeshShadowPolicy(targetMesh);
        return;
      }

      const cacheKey = materialAssetCache ? buildCacheKey(preferDoubleSide) : null;
      const cached = cacheKey ? materialAssetCache!.get(cacheKey) : undefined;
      if (cached) {
        targetMesh.material = cached;
        applyVisualMeshShadowPolicy(targetMesh);
        return;
      }

      const fresh = createMatteMaterial({
        color: createThreeColorFromSRGB(r, g, b),
        opacity: alpha,
        transparent: alpha < 1,
        side: preferDoubleSide ? THREE.DoubleSide : THREE.FrontSide,
        map: resolvedTexture,
        name: materialName || materialDef.name || 'mjcf_material_asset',
        preserveExactColor: hasAuthoredRgba || Boolean(materialDef.texture),
      });
      targetMesh.material = fresh;
      if (!(fresh instanceof THREE.MeshStandardMaterial)) {
        return;
      }
      if (roughness != null) {
        fresh.roughness = roughness;
      }
      if (metalness != null) {
        fresh.metalness = metalness;
      }
      if (emission != null) {
        fresh.emissive = new THREE.Color(r, g, b);
        fresh.emissiveIntensity = emission;
      }
      fresh.needsUpdate = true;
      if (cacheKey && materialAssetCache) {
        materialAssetCache.set(cacheKey, fresh);
      }
      applyVisualMeshShadowPolicy(targetMesh);
    });
  };

  if (
    options.deferTextureLoad &&
    materialDef.texture &&
    options.enqueueDeferredTextureApplication
  ) {
    // Start the texture request immediately so network/decode can overlap with
    // the rest of hierarchy construction, but don't block first scene readiness.
    const deferredTexturePromise = loadMaterialTexture(
      materialDef,
      textureMap,
      assets,
      sourceFileDir,
      textureLoadCache,
      abortSignal,
    );
    applyResolvedMaterial(null);
    options.enqueueDeferredTextureApplication(async () => {
      const deferredTexture = await deferredTexturePromise;
      if (abortSignal?.aborted) {
        deferredTexture?.dispose?.();
        throwIfMJCFLoadAborted(abortSignal);
      }
      if (!deferredTexture) {
        console.warn(
          `[MJCFLoader] Deferred texture application produced no texture for material "${materialDef.name || materialName || '<unnamed>'}".`,
        );
        return;
      }

      await options.yieldIfNeeded?.();
      if (abortSignal?.aborted) {
        deferredTexture.dispose?.();
        throwIfMJCFLoadAborted(abortSignal);
      }

      applyResolvedMaterial(deferredTexture, 'update');
      options.onAsyncSceneMutation?.();
    });
    return;
  }

  const texture = await loadMaterialTexture(
    materialDef,
    textureMap,
    assets,
    sourceFileDir,
    textureLoadCache,
    abortSignal,
  );
  if (abortSignal?.aborted) {
    texture?.dispose?.();
    throwIfMJCFLoadAborted(abortSignal);
  }

  applyResolvedMaterial(texture);
}

function objectHasVisibleMaterial(mesh: THREE.Object3D): boolean {
  let hasVisibleMaterial = false;

  mesh.traverse((child: any) => {
    if (hasVisibleMaterial || !child?.isMesh) {
      return;
    }

    const materials = Array.isArray(child.material) ? child.material : [child.material];
    hasVisibleMaterial = materials.some(
      (material: THREE.Material | undefined) => !material || (material.opacity ?? 1) > 1e-6,
    );
  });

  return hasVisibleMaterial;
}

export async function buildMJCFHierarchy(
  options: BuildMJCFHierarchyOptions,
): Promise<MJCFHierarchyResult> {
  const {
    bodies,
    rootGroup,
    meshMap,
    assets,
    meshCache,
    compilerSettings,
    materialMap,
    textureMap,
    sourceFileDir = '',
    onProgress,
    yieldIfNeeded = createMainThreadYieldController(),
    abortSignal,
    onAsyncSceneMutation,
  } = options;
  const linksMap: Record<string, THREE.Object3D> = {};
  const jointsMap: Record<string, THREE.Object3D> = {};
  const textureLoadCache: MJCFTextureLoadCache = new Map();
  const materialAssetCache = new Map<string, THREE.MeshStandardMaterial>();
  const deferredTextureApplications: Array<() => Promise<void>> = [];
  const prewarmedMeshByName = new Map<string, Promise<THREE.Object3D | null>>();
  let textureCacheOwnershipTransferred = false;
  const totalGeoms = bodies.reduce((sum, body) => sum + countBodyGeoms(body), 0);
  let processedGeoms = 0;

  if (totalGeoms > 0) {
    onProgress?.({ processedGeoms, totalGeoms });
  }

  const throwIfAborted = () => {
    throwIfMJCFLoadAborted(abortSignal);
  };

  const prewarmedTextureAssetUrls = collectReferencedTextureAssetUrls(
    bodies,
    materialMap,
    textureMap,
    assets,
    sourceFileDir,
  );
  for (const assetUrl of prewarmedTextureAssetUrls) {
    getTexturePromise(assetUrl, textureLoadCache);
  }

  const firstMeshGeomByName = collectFirstMeshGeomByMeshName(bodies);
  for (const [meshName, firstMeshGeom] of firstMeshGeomByName.entries()) {
    prewarmedMeshByName.set(
      meshName,
      createGeometryMesh(firstMeshGeom, meshMap, assets, meshCache, sourceFileDir, abortSignal),
    );
  }

  const consumePrewarmedMesh = async (
    geom: MJCFHierarchyGeom,
  ): Promise<THREE.Object3D | null | undefined> => {
    if (!geom.mesh) {
      return undefined;
    }

    const prewarmedMeshPromise = prewarmedMeshByName.get(geom.mesh);
    if (!prewarmedMeshPromise) {
      return undefined;
    }

    prewarmedMeshByName.delete(geom.mesh);
    return await prewarmedMeshPromise;
  };

  async function addGeomsToGroup(
    geoms: MJCFHierarchyGeom[],
    targetGroup: THREE.Group,
  ): Promise<void> {
    const geomRoles = assignMJCFBodyGeomRoles(geoms);

    for (const [
      geomIndex,
      { geom, renderVisual: isVisualGeom, renderCollision: isCollisionGeom },
    ] of geomRoles.entries()) {
      throwIfAborted();
      let mesh: THREE.Object3D | null | undefined = null;
      try {
        if (!isVisualGeom && !isCollisionGeom) {
          continue;
        }

        mesh = await consumePrewarmedMesh(geom);
        if (mesh === undefined) {
          mesh = await createGeometryMesh(
            geom,
            meshMap,
            assets,
            meshCache,
            sourceFileDir,
            abortSignal,
          );
        }
        if (!mesh) {
          continue;
        }

        throwIfAborted();

        const materialDef = geom.material ? materialMap.get(geom.material) : undefined;
        if (materialDef) {
          await applyMaterialAssetToMesh(
            mesh,
            materialDef,
            textureMap,
            assets,
            sourceFileDir,
            textureLoadCache,
            abortSignal,
            geom.material,
            geom.rgba,
            Boolean(geom.hasExplicitRgba),
            {
              deferTextureLoad: true,
              enqueueDeferredTextureApplication: (job) => {
                deferredTextureApplications.push(job);
              },
              yieldIfNeeded,
              onAsyncSceneMutation,
              materialAssetCache,
            },
          );
          throwIfAborted();
        }

        if (geom.rgba && (geom.hasExplicitRgba || !materialDef)) {
          applyRgbaToMesh(mesh, geom.rgba);
        }

        mesh.name = geom.name || geom.type || 'geom';
        const shouldRenderVisualMesh = objectHasVisibleMaterial(mesh);

        const applyGeomTransformToContainer = (container: THREE.Object3D) => {
          if (geom.pos) {
            container.position.set(geom.pos[0], geom.pos[1], geom.pos[2]);
          }

          if (geom.quat) {
            container.quaternion.copy(mjcfQuatToThreeQuat(geom.quat));
          }
        };

        if (isVisualGeom && shouldRenderVisualMesh) {
          const visualGroup = new URDFVisual();
          visualGroup.name = geom.name || `visual_${geom.type || 'geom'}`;
          visualGroup.urdfName = visualGroup.name;
          visualGroup.userData.isVisualGroup = true;
          visualGroup.userData.visualOrder = geomIndex;
          applyGeomTransformToContainer(visualGroup);

          mesh.userData.isVisual = true;
          mesh.userData.isVisualMesh = true;
          // Force deterministic draw order = XML order. MJCF convention is
          // that later-declared geoms render on top of earlier ones, and many
          // menagerie models intentionally model attachments (battery covers,
          // mount plates, etc.) coplanar with the outer shell. With Three.js
          // depthFunc=LessEqual, the last-drawn coplanar surface wins, so
          // ascending renderOrder matches MJCF semantics and prevents the
          // tie-breaker from flipping per frame (the source of flicker).
          mesh.renderOrder = geomIndex;
          mesh.traverse((child: any) => {
            if (child.isMesh) {
              child.userData.isVisual = true;
              child.userData.isVisualMesh = true;
              child.renderOrder = geomIndex;
            }
          });
          visualGroup.add(mesh);
          targetGroup.add(visualGroup);
        }

        if (isCollisionGeom) {
          const collisionMesh = isVisualGeom ? mesh.clone(true) : mesh;
          const collisionGroup = new URDFCollider();
          collisionGroup.name = geom.name || `collision_${geom.type || 'geom'}`;
          collisionGroup.urdfName = collisionGroup.name;
          collisionGroup.userData.isCollisionGroup = true;
          collisionGroup.visible = false;
          applyGeomTransformToContainer(collisionGroup);

          collisionMesh.userData.isCollisionMesh = true;
          collisionMesh.userData.isCollision = true;
          collisionMesh.userData.isVisual = false;
          collisionMesh.userData.isVisualMesh = false;

          collisionMesh.traverse((child: any) => {
            if (child.isMesh) {
              child.userData.isCollisionMesh = true;
              child.userData.isCollision = true;
              child.userData.isVisual = false;
              child.userData.isVisualMesh = false;
              child.material = createCollisionOverlayMaterial('mjcf_collision');
              child.renderOrder = COLLISION_OVERLAY_RENDER_ORDER;
            }
          });

          collisionGroup.add(collisionMesh);
          targetGroup.add(collisionGroup);
        }
      } catch (error) {
        if (mesh && !mesh.parent) {
          disposeTransientObject3D(mesh);
        }
        if (!isRecoverableMissingMeshAssetError(error)) {
          throw error;
        }
        console.warn(
          `[MJCFLoader] Failed to build geom "${geom.name || geom.type || 'unnamed'}":`,
          error,
        );
      } finally {
        processedGeoms += 1;
        onProgress?.({ processedGeoms, totalGeoms });
        await yieldIfNeeded();
      }
    }
  }

  function applyBodyTransform(target: THREE.Group, body: MJCFHierarchyBody): void {
    target.position.set(body.pos[0], body.pos[1], body.pos[2]);

    if (body.quat) {
      target.quaternion.copy(mjcfQuatToThreeQuat(body.quat));
      return;
    }

    if (body.euler) {
      const ex = convertMjcfAngle(body.euler[0], compilerSettings.angleUnit);
      const ey = convertMjcfAngle(body.euler[1], compilerSettings.angleUnit);
      const ez = convertMjcfAngle(body.euler[2], compilerSettings.angleUnit);
      target.rotation.set(ex, ey, ez);
    }
  }

  function createLinkGroup(bodyName: string): THREE.Group {
    const linkGroup = new THREE.Group();
    linkGroup.name = bodyName;
    (linkGroup as any).isURDFLink = true;
    (linkGroup as any).type = 'URDFLink';
    linksMap[bodyName] = linkGroup;

    const linkAxes = createLinkAxesHelper(0.1);
    linkAxes.visible = false;
    linkGroup.add(linkAxes);

    return linkGroup;
  }

  function createImplicitFixedJointName(parentLinkId: string, childLinkId: string): string {
    const baseName = `${parentLinkId}_to_${childLinkId}`;
    let candidate = baseName;
    let suffix = 2;

    while (jointsMap[candidate]) {
      candidate = `${baseName}_${suffix}`;
      suffix += 1;
    }

    return candidate;
  }

  function applyRuntimeJointLinkMetadata(
    jointNode: RuntimeJointMetadataNode,
    {
      parentLink,
      parentLinkId,
      childLink,
      childLinkId,
    }: {
      parentLink: THREE.Object3D | null;
      parentLinkId: string | null;
      childLink: THREE.Object3D;
      childLinkId: string;
    },
  ): void {
    jointNode.parentLinkId = parentLinkId;
    jointNode.parentName = parentLinkId;
    jointNode.childLinkId = childLinkId;
    jointNode.childName = childLinkId;
    jointNode.parentLink = parentLink;
    jointNode.child = childLink;
  }

  function registerImplicitFixedJointMetadata(
    parentLink: THREE.Object3D,
    childLink: THREE.Object3D,
  ): void {
    const jointNode = new THREE.Group();
    jointNode.name = createImplicitFixedJointName(parentLink.name, childLink.name);
    (jointNode as any).isURDFJoint = true;
    (jointNode as any).type = 'URDFJoint';
    (jointNode as any).jointType = 'fixed';
    (jointNode as any).angle = 0;
    applyRuntimeJointLinkMetadata(jointNode as RuntimeJointMetadataNode, {
      parentLink,
      parentLinkId: parentLink.name,
      childLink,
      childLinkId: childLink.name,
    });
    jointsMap[jointNode.name] = jointNode;
  }

  function createJointNode(
    joint: MJCFHierarchyJoint,
    bodyName: string,
    bodyOffsetGroup: THREE.Group,
    jointIndex: number,
  ): { jointNode: THREE.Group; attachmentGroup: THREE.Group } {
    const jointPos: [number, number, number] = joint.pos || [0, 0, 0];
    const jointNode = new THREE.Group();
    jointNode.name = joint.name || `joint_${bodyName}_${jointIndex}`;
    (jointNode as any).isURDFJoint = true;
    (jointNode as any).type = 'URDFJoint';
    (jointNode as any).jointType = resolveRuntimeJointType(joint);
    (jointNode as any).referencePosition = Number.isFinite(joint.ref) ? joint.ref : 0;
    jointNode.position.set(jointPos[0], jointPos[1], jointPos[2]);
    (jointNode as any).bodyOffsetGroup = bodyOffsetGroup;
    const hasActuator = (options.actuatorMap?.get(joint.name)?.length ?? 0) > 0;
    if (typeof joint.stiffness === 'number' && Number.isFinite(joint.stiffness)) {
      jointNode.userData.mjcfJointStiffness = joint.stiffness;
      Object.assign(
        jointNode.userData,
        resolveMjcfPassiveSpringJointMetadata({
          stiffness: joint.stiffness,
          hasActuator,
        }),
      );
    }

    const axisVec = joint.axis
      ? new THREE.Vector3(joint.axis[0], joint.axis[1], joint.axis[2]).normalize()
      : new THREE.Vector3(0, 0, 1);
    (jointNode as any).axis = axisVec;

    if (joint.range && joint.type !== 'free') {
      (jointNode as any).limit = {
        lower: joint.range[0],
        upper: joint.range[1],
      };
    }

    (jointNode as any).angle = 0;
    (jointNode as any).jointQuaternion = new THREE.Quaternion();
    (jointNode as any).setJointValue = function (value: number) {
      this.angle = value;
      this.jointValue = value;
      const referencePosition = Number.isFinite(this.referencePosition)
        ? this.referencePosition
        : 0;
      const motionValue = value - referencePosition;
      const axis = this.axis ? this.axis.clone().normalize() : new THREE.Vector3(0, 0, 1);

      if (this.jointType === 'revolute' || this.jointType === 'continuous') {
        if (!this.userData) this.userData = {};
        if (!this.userData.initialQuaternion) {
          this.userData.initialQuaternion = this.quaternion.clone();
        }

        const rotationQuat = new THREE.Quaternion();
        rotationQuat.setFromAxisAngle(axis, motionValue);

        this.quaternion.copy(this.userData.initialQuaternion);
        this.quaternion.multiply(rotationQuat);
        this.updateMatrixWorld(true);
      } else if (this.jointType === 'prismatic') {
        if (!this.userData) this.userData = {};
        if (!this.userData.initialPosition) {
          this.userData.initialPosition = this.position.clone();
        }
        this.position.copy(this.userData.initialPosition);
        this.position.addScaledVector(axis, motionValue);
        this.updateMatrixWorld(true);
      }
    };
    (jointNode as any).setJointQuaternion = function (value: {
      x: number;
      y: number;
      z: number;
      w: number;
    }) {
      if (!this.userData) this.userData = {};
      if (!this.userData.initialQuaternion) {
        this.userData.initialQuaternion = this.quaternion.clone();
      }

      const rotationQuat = new THREE.Quaternion(value.x, value.y, value.z, value.w).normalize();
      this.jointQuaternion.copy(rotationQuat);
      this.jointValue = rotationQuat;
      this.quaternion.copy(this.userData.initialQuaternion);
      this.quaternion.multiply(rotationQuat);
      this.updateMatrixWorld(true);
    };

    const axisHelper = createJointAxisHelper(axisVec);
    axisHelper.visible = false;
    jointNode.add(axisHelper);

    const debugAxes = new THREE.AxesHelper(0.1);
    debugAxes.name = '__debug_joint_axes__';
    debugAxes.visible = false;
    (debugAxes as any).userData = { isGizmo: true, isSelectableHelper: true, isDebugAxes: true };
    jointNode.add(debugAxes);

    jointsMap[jointNode.name] = jointNode;

    const attachmentGroup = new THREE.Group();
    attachmentGroup.name = `geom_compensation_${bodyName}_${jointIndex}`;
    attachmentGroup.position.set(-jointPos[0], -jointPos[1], -jointPos[2]);
    jointNode.add(attachmentGroup);

    const initialJointValue = resolveInitialRuntimeJointValue(joint);
    if (initialJointValue != null) {
      (jointNode as any).setJointValue(initialJointValue);
    }

    return { jointNode, attachmentGroup };
  }

  async function buildBody(
    body: MJCFHierarchyBody,
    parentGroup: THREE.Group,
    parentLink: THREE.Object3D | null,
  ): Promise<void> {
    throwIfAborted();
    const bodyOffsetGroup = new THREE.Group();
    bodyOffsetGroup.name = `body_offset_${body.name}`;
    applyBodyTransform(bodyOffsetGroup, body);
    parentGroup.add(bodyOffsetGroup);

    let attachmentGroup: THREE.Group = bodyOffsetGroup;
    const runtimeJointNodes: THREE.Group[] = [];
    body.joints
      .filter((joint) => joint.type !== 'fixed')
      .forEach((joint, jointIndex) => {
        const jointLayer = createJointNode(joint, body.name, bodyOffsetGroup, jointIndex);
        attachmentGroup.add(jointLayer.jointNode);
        attachmentGroup = jointLayer.attachmentGroup;
        runtimeJointNodes.push(jointLayer.jointNode);
      });

    const linkGroup = createLinkGroup(body.name);
    linkGroup.userData.__mjcfSitesData = cloneSiteData(body.sites);
    await addGeomsToGroup(body.geoms, linkGroup);
    restackLinkVisualRoots(linkGroup);
    attachmentGroup.add(linkGroup);

    runtimeJointNodes.forEach((jointNode) => {
      applyRuntimeJointLinkMetadata(jointNode as RuntimeJointMetadataNode, {
        parentLink,
        parentLinkId: parentLink?.name ?? null,
        childLink: linkGroup,
        childLinkId: body.name,
      });
    });

    if (runtimeJointNodes.length === 0 && parentLink) {
      registerImplicitFixedJointMetadata(parentLink, linkGroup);
    }

    for (const childBody of body.children) {
      throwIfAborted();
      await buildBody(childBody, linkGroup, linkGroup);
      await yieldIfNeeded();
    }
  }

  try {
    // Build all top-level bodies
    for (const body of bodies) {
      throwIfAborted();
      await buildBody(body, rootGroup, null);
      await yieldIfNeeded();
    }

    throwIfAborted();
    restackRobotVisualRoots(rootGroup);

    let deferredTextureApplicationsReady: Promise<void> = Promise.resolve();
    if (deferredTextureApplications.length > 0) {
      textureCacheOwnershipTransferred = true;
      deferredTextureApplicationsReady = (async () => {
        try {
          const settledApplications = await Promise.allSettled(
            deferredTextureApplications.map((applyDeferredTexture) => applyDeferredTexture()),
          );
          settledApplications.forEach((result) => {
            if (result.status === 'rejected' && !isMJCFLoadAbortedError(result.reason)) {
              console.error(
                '[MJCFLoader] Failed to apply deferred material texture.',
                result.reason,
              );
            }
          });
        } finally {
          disposeTemporaryTexturePromiseCache(textureLoadCache);
        }
      })();
    } else {
      disposeTemporaryTexturePromiseCache(textureLoadCache);
      textureCacheOwnershipTransferred = true;
    }

    return { linksMap, jointsMap, deferredTextureApplicationsReady };
  } finally {
    if (prewarmedMeshByName.size > 0) {
      const unresolvedPrewarmedMeshes = [...prewarmedMeshByName.values()];
      prewarmedMeshByName.clear();

      const settledPrewarmedMeshes = await Promise.allSettled(unresolvedPrewarmedMeshes);
      settledPrewarmedMeshes.forEach((result) => {
        if (result.status !== 'fulfilled') {
          return;
        }

        if (result.value) {
          disposeTransientObject3D(result.value);
        }
      });
    }

    if (!textureCacheOwnershipTransferred && textureLoadCache.size > 0) {
      disposeTemporaryTexturePromiseCache(textureLoadCache);
    }
  }
}
