import * as THREE from 'three';
import { getVisualGeometryEntries } from '@/core/robot';
import { isProtectedMaterial } from '@/core/utils/three/materialProtection';
import { GeometryType, type UrdfLink } from '@/types';

import {
  collisionBaseMaterial,
  enhanceMaterials,
  resolveCollisionRenderOrder,
  syncCollisionBaseMaterialPriority,
} from '@/shared/components/3d/materials';
import { disposeReplacedMaterials } from '@/shared/components/3d/materialDisposal';
import {
  applyURDFMaterials,
  collectURDFMaterialsFromLinks,
  collectURDFMaterialsFromVisualGeometry,
  type URDFMaterialInfo,
} from '@/shared/components/3d/urdfMaterials';
import { applyVisualMeshShadowPolicy } from '@/core/utils/visualMeshShadowPolicy';
import { getGeometryObjectIndexUserDataKey } from '@/shared/components/3d/runtimeGeometrySelection';
import {
  asRuntimeObject3D,
  asRuntimeRobotObject,
} from '@/shared/components/3d/runtimeRobotTypes';

export interface SyncLoadedRobotSceneOptions {
  robot: THREE.Object3D;
  sourceFormat: 'urdf' | 'mjcf' | 'usd';
  showCollision: boolean;
  showVisual: boolean;
  showMjcfWorldLink?: boolean;
  showCollisionAlwaysOnTop?: boolean;
  urdfMaterials?: Map<string, URDFMaterialInfo> | null;
  robotLinks?: Record<string, UrdfLink>;
}

export interface SyncLoadedRobotSceneResult {
  changed: boolean;
  linkMeshMap: Map<string, THREE.Mesh[]>;
}

type URDFMaterialScopeMap = Map<string, Map<string, URDFMaterialInfo>>;

function buildURDFMaterialScopes(robotLinks: Record<string, UrdfLink> | undefined): {
  byLink: URDFMaterialScopeMap;
  byVisualObject: URDFMaterialScopeMap;
} {
  const byLink: URDFMaterialScopeMap = new Map();
  const byVisualObject: URDFMaterialScopeMap = new Map();

  if (!robotLinks) {
    return { byLink, byVisualObject };
  }

  const registerScopedMaterials = (
    target: URDFMaterialScopeMap,
    scopeKey: string,
    materials: Map<string, URDFMaterialInfo>,
  ) => {
    if (!scopeKey || materials.size === 0) {
      return;
    }
    target.set(scopeKey, materials);
  };

  Object.values(robotLinks).forEach((link) => {
    const linkScopeKeys = [link.id, link.name].filter(
      (value, index, array): value is string => Boolean(value) && array.indexOf(value) === index,
    );
    const linkMaterials = collectURDFMaterialsFromLinks({ [link.id]: link });

    linkScopeKeys.forEach((scopeKey) => {
      registerScopedMaterials(byLink, scopeKey, linkMaterials);
    });

    getVisualGeometryEntries(link).forEach((entry) => {
      const entryMaterials = collectURDFMaterialsFromVisualGeometry(entry.geometry);
      if (entryMaterials.size === 0) {
        return;
      }

      linkScopeKeys.forEach((scopeKey) => {
        registerScopedMaterials(
          byVisualObject,
          `${scopeKey}::visual::${entry.objectIndex}`,
          entryMaterials,
        );
      });
    });
  });

  return { byLink, byVisualObject };
}

function resolveVisualObjectIndex(geometryRoot: THREE.Object3D): number | null {
  const runtimeKey = String(geometryRoot.userData?.runtimeKey || geometryRoot.name || '').trim();
  const runtimeKeyMatch = runtimeKey.match(/::visual::(\d+)$/);
  if (runtimeKeyMatch) {
    const runtimeObjectIndex = Number(runtimeKeyMatch[1]);
    return Number.isInteger(runtimeObjectIndex) ? runtimeObjectIndex : null;
  }

  const visualObjectIndexValue =
    geometryRoot.userData?.[getGeometryObjectIndexUserDataKey('visual')];
  const visualObjectIndex =
    typeof visualObjectIndexValue === 'number'
      ? visualObjectIndexValue
      : Number(visualObjectIndexValue);
  return Number.isInteger(visualObjectIndex) && visualObjectIndex >= 0 ? visualObjectIndex : null;
}

function resolveScopedURDFMaterialsForVisualMesh({
  geometryRoot,
  semanticLinkName,
  runtimeLinkName,
  globalMaterials,
  scopedMaterialsByLink,
  scopedMaterialsByVisualObject,
}: {
  geometryRoot: THREE.Object3D;
  semanticLinkName: string;
  runtimeLinkName: string;
  globalMaterials: Map<string, URDFMaterialInfo> | null | undefined;
  scopedMaterialsByLink: URDFMaterialScopeMap;
  scopedMaterialsByVisualObject: URDFMaterialScopeMap;
}): Map<string, URDFMaterialInfo> | null {
  const visualObjectIndex = resolveVisualObjectIndex(geometryRoot);
  if (visualObjectIndex !== null) {
    const exactVisualMaterials =
      scopedMaterialsByVisualObject.get(`${semanticLinkName}::visual::${visualObjectIndex}`) ??
      scopedMaterialsByVisualObject.get(`${runtimeLinkName}::visual::${visualObjectIndex}`);
    if (exactVisualMaterials && exactVisualMaterials.size > 0) {
      return exactVisualMaterials;
    }
  }

  const linkMaterials =
    scopedMaterialsByLink.get(semanticLinkName) ?? scopedMaterialsByLink.get(runtimeLinkName);
  if (linkMaterials && linkMaterials.size > 0) {
    return linkMaterials;
  }

  return globalMaterials && globalMaterials.size > 0 ? globalMaterials : null;
}

function assignSemanticGeometryMetadata(
  {
    target,
    semanticLinkName,
    runtimeLinkName,
    subType,
    objectIndex,
  }: {
    target: THREE.Object3D;
    semanticLinkName: string;
    runtimeLinkName: string;
    subType: 'visual' | 'collision';
    objectIndex: number;
  },
): boolean {
  const objectIndexKey = getGeometryObjectIndexUserDataKey(subType);
  let changed = false;

  if (
    target.userData?.parentLinkName !== semanticLinkName ||
    target.userData?.runtimeParentLinkName !== runtimeLinkName ||
    target.userData?.[objectIndexKey] !== objectIndex
  ) {
    changed = true;
  }

  target.userData.parentLinkName = semanticLinkName;
  target.userData.runtimeParentLinkName = runtimeLinkName;
  target.userData[objectIndexKey] = objectIndex;
  return changed;
}

function meshNeedsMaterialUpgrade(mesh: THREE.Mesh): boolean {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

  return materials.some((material) => {
    if (!material) return false;
    if (isProtectedMaterial(material)) return false;
    if (!(material instanceof THREE.MeshStandardMaterial)) return true;

    const materialWithPbrState = material as THREE.MeshStandardMaterial & {
      envMapIntensity?: number;
      emissiveMap?: THREE.Texture | null;
      roughnessMap?: THREE.Texture | null;
      metalnessMap?: THREE.Texture | null;
      normalMap?: THREE.Texture | null;
      aoMap?: THREE.Texture | null;
      bumpMap?: THREE.Texture | null;
    };
    const originalRoughness = Number(material.userData?.originalRoughness);
    const originalMetalness = Number(material.userData?.originalMetalness);
    const originalEnvMapIntensity = Number(material.userData?.originalEnvMapIntensity);
    const originalEmissive = material.userData?.originalEmissive;
    const originalEmissiveIntensity = Number(material.userData?.originalEmissiveIntensity);
    const currentEnvMapIntensity = Number.isFinite(materialWithPbrState.envMapIntensity)
      ? Number(materialWithPbrState.envMapIntensity)
      : 1;
    const currentEmissiveIntensity = Number.isFinite(materialWithPbrState.emissiveIntensity)
      ? Number(materialWithPbrState.emissiveIntensity)
      : 0;
    const currentEmissiveHex = material.emissive?.isColor ? material.emissive.getHex() : 0x000000;
    const expectedEmissiveHex = (originalEmissive as THREE.Color | undefined)?.isColor
      ? (originalEmissive as THREE.Color).getHex()
      : 0x000000;

    if (
      !Number.isFinite(originalRoughness) ||
      !Number.isFinite(originalMetalness) ||
      !Number.isFinite(originalEnvMapIntensity)
    ) {
      return true;
    }

    if (Math.abs(material.roughness - originalRoughness) > 1e-6) {
      return true;
    }

    if (Math.abs(material.metalness - originalMetalness) > 1e-6) {
      return true;
    }

    if (Math.abs(currentEnvMapIntensity - originalEnvMapIntensity) > 1e-6) {
      return true;
    }

    if (currentEmissiveHex !== expectedEmissiveHex) {
      return true;
    }

    if (
      Number.isFinite(originalEmissiveIntensity) &&
      Math.abs(currentEmissiveIntensity - originalEmissiveIntensity) > 1e-6
    ) {
      return true;
    }

    if (material.userData?.urdfColorApplied === true && material.toneMapped !== false) {
      return true;
    }

    if (material.userData?.usesVertexColors === true && material.toneMapped !== false) {
      return true;
    }

    return false;
  });
}

function pushMesh(map: Map<string, THREE.Mesh[]>, key: string, mesh: THREE.Mesh): void {
  const bucket = map.get(key);
  if (bucket) {
    bucket.push(mesh);
    return;
  }

  map.set(key, [mesh]);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getGeomSuffixOrder(candidate: string, parentLinkId: string, parentName: string): number {
  const patterns = [
    new RegExp(`^${escapeRegExp(parentLinkId)}_geom_(\\d+)$`),
    new RegExp(`^${escapeRegExp(parentName)}_geom_(\\d+)$`),
  ];

  for (const pattern of patterns) {
    const match = candidate.match(pattern);
    if (!match) {
      continue;
    }

    const numeric = Number(match[1]);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  return Number.POSITIVE_INFINITY;
}

function resolveRobotLinkDataByRuntimeName(
  robotLinks: Record<string, UrdfLink> | undefined,
  runtimeLinkName: string,
): UrdfLink | null {
  if (!robotLinks) {
    return null;
  }

  const direct = robotLinks[runtimeLinkName];
  if (direct) {
    return direct;
  }
  const nameMatches = Object.values(robotLinks).filter(
    (link) => link.name === runtimeLinkName,
  );
  return nameMatches.length === 1 ? nameMatches[0]! : null;
}

function resolveSemanticLinkIdForRuntimeLink(
  sourceFormat: 'urdf' | 'mjcf' | 'usd',
  robotLinks: Record<string, UrdfLink> | undefined,
  runtimeLinkName: string,
): string {
  if (sourceFormat !== 'mjcf') {
    return runtimeLinkName;
  }

  return resolveRobotLinkDataByRuntimeName(robotLinks, runtimeLinkName)?.id ?? runtimeLinkName;
}

function hasVisualGeometry(link: UrdfLink | null | undefined): boolean {
  return Boolean(link && link.visual.type !== GeometryType.NONE);
}

function shouldHideMjcfWorldRuntimeLink(
  sourceFormat: 'urdf' | 'mjcf' | 'usd',
  showMjcfWorldLink: boolean,
  runtimeLinkName: string | undefined,
): boolean {
  return sourceFormat === 'mjcf' && !showMjcfWorldLink && runtimeLinkName === 'world';
}

function buildMjcfVisualOwnershipByRuntimeLink(
  robotLinks: Record<string, UrdfLink> | undefined,
): Map<string, string[]> {
  const ownership = new Map<string, string[]>();
  if (!robotLinks) {
    return ownership;
  }

  const linkEntries = Object.values(robotLinks);
  for (let index = 0; index < linkEntries.length; index += 1) {
    const parentLink = linkEntries[index];
    const runtimeLinkName = parentLink.name || parentLink.id;
    if (!runtimeLinkName) {
      continue;
    }

    const semanticOwners: string[] = [];
    if (hasVisualGeometry(parentLink)) {
      semanticOwners.push(parentLink.id);
    }

    const attachmentLinks = linkEntries
      .filter((candidate) => {
        if (candidate.id === parentLink.id || !hasVisualGeometry(candidate)) {
          return false;
        }

        return (
          getGeomSuffixOrder(candidate.id, parentLink.id, parentLink.name) !==
            Number.POSITIVE_INFINITY ||
          getGeomSuffixOrder(candidate.name, parentLink.id, parentLink.name) !==
            Number.POSITIVE_INFINITY
        );
      })
      .sort((left, right) => {
        const leftOrder = Math.min(
          getGeomSuffixOrder(left.id, parentLink.id, parentLink.name),
          getGeomSuffixOrder(left.name, parentLink.id, parentLink.name),
        );
        const rightOrder = Math.min(
          getGeomSuffixOrder(right.id, parentLink.id, parentLink.name),
          getGeomSuffixOrder(right.name, parentLink.id, parentLink.name),
        );

        return leftOrder - rightOrder;
      })
      .map((candidate) => candidate.id);

    if (attachmentLinks.length > 0) {
      semanticOwners.push(...attachmentLinks);
    }

    if (semanticOwners.length > 0) {
      ownership.set(runtimeLinkName, semanticOwners);
    }
  }

  return ownership;
}

function findDirectChildUnderParent(
  node: THREE.Object3D,
  parent: THREE.Object3D,
): THREE.Object3D | null {
  let current: THREE.Object3D | null = node;
  while (current?.parent && current.parent !== parent) {
    current = current.parent;
  }

  return current?.parent === parent ? current : null;
}

function getClaimedMjcfVisualOwnerIndexes(
  claimedIndexesByRuntimeLink: Map<string, Set<number>>,
  runtimeLinkName: string,
): Set<number> {
  const existing = claimedIndexesByRuntimeLink.get(runtimeLinkName);
  if (existing) {
    return existing;
  }

  const created = new Set<number>();
  claimedIndexesByRuntimeLink.set(runtimeLinkName, created);
  return created;
}

function buildMjcfVisualRankByGeometryRoot(
  runtimeLinks: Record<string, THREE.Object3D> | undefined,
): WeakMap<THREE.Object3D, number> {
  const visualRankByGeometryRoot = new WeakMap<THREE.Object3D, number>();
  if (!runtimeLinks) {
    return visualRankByGeometryRoot;
  }

  Object.values(runtimeLinks).forEach((link) => {
    const rankedVisualRoots = link.children
      .map((child, childIndex) => {
        const visualOrderValue = child.userData?.visualOrder;
        const visualOrder =
          typeof visualOrderValue === 'number' ? visualOrderValue : Number(visualOrderValue);
        return {
          root: child,
          childIndex,
          visualOrder,
        };
      })
      .filter(
        (
          candidate,
        ): candidate is { root: THREE.Object3D; childIndex: number; visualOrder: number } =>
          Number.isInteger(candidate.visualOrder) && candidate.visualOrder >= 0,
      )
      .sort(
        (left, right) => left.visualOrder - right.visualOrder || left.childIndex - right.childIndex,
      );

    rankedVisualRoots.forEach(({ root }, rank) => {
      visualRankByGeometryRoot.set(root, rank);
    });
  });

  return visualRankByGeometryRoot;
}

function buildMjcfRankedVisualRootCountByRuntimeLink(
  runtimeLinks: Record<string, THREE.Object3D> | undefined,
): Map<string, number> {
  const rankedVisualRootCountByRuntimeLink = new Map<string, number>();
  if (!runtimeLinks) {
    return rankedVisualRootCountByRuntimeLink;
  }

  Object.entries(runtimeLinks).forEach(([runtimeLinkName, link]) => {
    const rankedVisualRootCount = link.children.reduce((count, child) => {
      const visualOrderValue = child.userData?.visualOrder;
      const visualOrder =
        typeof visualOrderValue === 'number' ? visualOrderValue : Number(visualOrderValue);
      return Number.isInteger(visualOrder) && visualOrder >= 0 ? count + 1 : count;
    }, 0);

    if (rankedVisualRootCount > 0) {
      rankedVisualRootCountByRuntimeLink.set(runtimeLinkName, rankedVisualRootCount);
    }
  });

  return rankedVisualRootCountByRuntimeLink;
}

export function syncLoadedRobotScene({
  robot,
  sourceFormat,
  showCollision,
  showVisual,
  showMjcfWorldLink = false,
  showCollisionAlwaysOnTop = true,
  urdfMaterials,
  robotLinks: robotLinkData,
}: SyncLoadedRobotSceneOptions): SyncLoadedRobotSceneResult {
  const linkMeshMap = new Map<string, THREE.Mesh[]>();
  let changed = false;
  const disposedMaterials = new Set<THREE.Material>();
  // Lifts the per-mesh material memo to sync scope so MJCF assets that flatten
  // each <geom> into its own visual group reuse one MeshStandardMaterial per
  // source material instead of cloning it per mesh — that was a ~100×
  // duplicate-clone hot path on multi-geom models like anymal_b.
  const enhancedMaterialMemo = new Map<THREE.Material, THREE.Material>();
  const robotLinks = asRuntimeRobotObject(robot).links;
  const mjcfVisualOwnershipByRuntimeLink =
    sourceFormat === 'mjcf'
      ? buildMjcfVisualOwnershipByRuntimeLink(robotLinkData)
      : new Map<string, string[]>();
  const mjcfVisualRankByGeometryRoot =
    sourceFormat === 'mjcf' ? buildMjcfVisualRankByGeometryRoot(robotLinks) : new WeakMap();
  const mjcfRankedVisualRootCountByRuntimeLink =
    sourceFormat === 'mjcf'
      ? buildMjcfRankedVisualRootCountByRuntimeLink(robotLinks)
      : new Map<string, number>();
  const visualBodyIndexByRuntimeLink = new Map<string, number>();
  const claimedMjcfVisualOwnerIndexesByRuntimeLink = new Map<string, Set<number>>();
  const visualOwnerByGeometryRoot = new WeakMap<THREE.Object3D, string>();
  const visualObjectIndexByGeometryRoot = new WeakMap<THREE.Object3D, number>();
  const collisionObjectIndexByGeometryRoot = new WeakMap<THREE.Object3D, number>();
  const nextVisualObjectIndexBySemanticLink = new Map<string, number>();
  const nextCollisionObjectIndexBySemanticLink = new Map<string, number>();
  const urdfMaterialScopes = buildURDFMaterialScopes(robotLinkData);
  if (syncCollisionBaseMaterialPriority(showCollisionAlwaysOnTop, showVisual)) {
    changed = true;
  }

  const isLinkNode = (object: THREE.Object3D): boolean =>
    Boolean(asRuntimeObject3D(object).isURDFLink || robotLinks?.[object.name]);

  const processCollisionMesh = (mesh: THREE.Mesh, parentLink: THREE.Object3D | null) => {
    if (mesh.userData?.isCollisionMesh !== true || mesh.userData?.isVisualMesh !== false) {
      changed = true;
    }

    mesh.userData.isCollisionMesh = true;
    mesh.userData.isCollision = true;
    mesh.userData.isVisual = false;
    mesh.userData.isVisualMesh = false;

    if (mesh.material !== collisionBaseMaterial) {
      changed = true;
      const previousMaterial = mesh.material as THREE.Material | THREE.Material[] | undefined;
      mesh.material = collisionBaseMaterial;
      disposeReplacedMaterials(previousMaterial, disposedMaterials, true);
    }

    const collisionRenderOrder = resolveCollisionRenderOrder(showCollisionAlwaysOnTop);
    if (mesh.renderOrder !== collisionRenderOrder) {
      changed = true;
      mesh.renderOrder = collisionRenderOrder;
    }

    if (parentLink) {
      const semanticLinkName = resolveSemanticLinkIdForRuntimeLink(
        sourceFormat,
        robotLinkData,
        parentLink.name,
      );
      const geometryRoot = findDirectChildUnderParent(mesh, parentLink) ?? mesh;
      let collisionObjectIndex = collisionObjectIndexByGeometryRoot.get(geometryRoot);
      if (collisionObjectIndex === undefined) {
        collisionObjectIndex = nextCollisionObjectIndexBySemanticLink.get(semanticLinkName) ?? 0;
        collisionObjectIndexByGeometryRoot.set(geometryRoot, collisionObjectIndex);
        nextCollisionObjectIndexBySemanticLink.set(semanticLinkName, collisionObjectIndex + 1);
      }

      if (
        assignSemanticGeometryMetadata({
          target: geometryRoot,
          semanticLinkName,
          runtimeLinkName: parentLink.name,
          subType: 'collision',
          objectIndex: collisionObjectIndex,
        })
      ) {
        changed = true;
      }
      if (
        assignSemanticGeometryMetadata({
          target: mesh,
          semanticLinkName,
          runtimeLinkName: parentLink.name,
          subType: 'collision',
          objectIndex: collisionObjectIndex,
        })
      ) {
        changed = true;
      }
      pushMesh(linkMeshMap, `${semanticLinkName}:collision`, mesh);
    }
  };

  const processVisualMesh = (mesh: THREE.Mesh, parentLink: THREE.Object3D) => {
    const shouldUpgradeVisualMaterial = meshNeedsMaterialUpgrade(mesh);
    const geometryRoot = findDirectChildUnderParent(mesh, parentLink) ?? mesh;
    let semanticLinkName = visualOwnerByGeometryRoot.get(geometryRoot);

    if (!semanticLinkName) {
      const visualOwners = mjcfVisualOwnershipByRuntimeLink.get(parentLink.name);
      let visualOwnerIndex: number | null = null;

      if (sourceFormat === 'mjcf' && visualOwners?.length) {
        const claimedIndexes = getClaimedMjcfVisualOwnerIndexes(
          claimedMjcfVisualOwnerIndexesByRuntimeLink,
          parentLink.name,
        );
        const preferredVisualOrder = mjcfVisualRankByGeometryRoot.get(geometryRoot) ?? null;
        const hasRankedVisualRoots =
          (mjcfRankedVisualRootCountByRuntimeLink.get(parentLink.name) ?? 0) > 0;

        if (
          preferredVisualOrder !== null &&
          preferredVisualOrder < visualOwners.length &&
          !claimedIndexes.has(preferredVisualOrder)
        ) {
          visualOwnerIndex = preferredVisualOrder;
        } else if (preferredVisualOrder === null && hasRankedVisualRoots) {
          semanticLinkName =
            resolveRobotLinkDataByRuntimeName(robotLinkData, parentLink.name)?.id ??
            parentLink.name;
        } else {
          let nextVisualBodyIndex = visualBodyIndexByRuntimeLink.get(parentLink.name) ?? 0;
          while (
            nextVisualBodyIndex < visualOwners.length &&
            claimedIndexes.has(nextVisualBodyIndex)
          ) {
            nextVisualBodyIndex += 1;
          }

          if (nextVisualBodyIndex < visualOwners.length) {
            visualOwnerIndex = nextVisualBodyIndex;
          }
        }

        if (visualOwnerIndex !== null) {
          claimedIndexes.add(visualOwnerIndex);
          visualBodyIndexByRuntimeLink.set(parentLink.name, visualOwnerIndex + 1);
          semanticLinkName = visualOwners[visualOwnerIndex] ?? null;
        }
      }

      semanticLinkName =
        semanticLinkName ??
        resolveRobotLinkDataByRuntimeName(robotLinkData, parentLink.name)?.id ??
        parentLink.name;
      visualOwnerByGeometryRoot.set(geometryRoot, semanticLinkName);
    }
    let visualObjectIndex = visualObjectIndexByGeometryRoot.get(geometryRoot);
    if (visualObjectIndex === undefined) {
      visualObjectIndex = nextVisualObjectIndexBySemanticLink.get(semanticLinkName) ?? 0;
      visualObjectIndexByGeometryRoot.set(geometryRoot, visualObjectIndex);
      nextVisualObjectIndexBySemanticLink.set(semanticLinkName, visualObjectIndex + 1);
    }

    const isVisible =
      showVisual &&
      !shouldHideMjcfWorldRuntimeLink(sourceFormat, showMjcfWorldLink, parentLink.name);

    const scopedUrdfMaterials =
      sourceFormat === 'urdf'
        ? resolveScopedURDFMaterialsForVisualMesh({
            geometryRoot,
            semanticLinkName,
            runtimeLinkName: parentLink.name,
            globalMaterials: urdfMaterials,
            scopedMaterialsByLink: urdfMaterialScopes.byLink,
            scopedMaterialsByVisualObject: urdfMaterialScopes.byVisualObject,
          })
        : null;

    if (shouldUpgradeVisualMaterial && scopedUrdfMaterials) {
      applyURDFMaterials(mesh, scopedUrdfMaterials);
    }

    if (shouldUpgradeVisualMaterial) {
      enhanceMaterials(mesh, null, enhancedMaterialMemo);
      changed = true;
    }

    if (applyVisualMeshShadowPolicy(mesh)) {
      changed = true;
    }

    if (
      assignSemanticGeometryMetadata({
        target: geometryRoot,
        semanticLinkName,
        runtimeLinkName: parentLink.name,
        subType: 'visual',
        objectIndex: visualObjectIndex,
      })
    ) {
      changed = true;
    }

    if (
      assignSemanticGeometryMetadata({
        target: mesh,
        semanticLinkName,
        runtimeLinkName: parentLink.name,
        subType: 'visual',
        objectIndex: visualObjectIndex,
      }) ||
      mesh.userData?.isVisualMesh !== true ||
      mesh.userData?.isCollisionMesh === true ||
      mesh.visible !== isVisible
    ) {
      changed = true;
    }

    mesh.userData.isVisualMesh = true;
    mesh.userData.isCollisionMesh = false;
    mesh.visible = isVisible;

    pushMesh(linkMeshMap, `${semanticLinkName}:visual`, mesh);
  };

  const walkNode = (
    node: THREE.Object3D,
    parentLink: THREE.Object3D | null,
    insideCollider: boolean,
  ) => {
    const nodeIsLink = isLinkNode(node);
    const nextParentLink = nodeIsLink ? node : parentLink;
    if (nodeIsLink) {
      const semanticLinkId =
        resolveRobotLinkDataByRuntimeName(robotLinkData, node.name)?.id ?? node.name;
      if (node.userData.semanticLinkId !== semanticLinkId) {
        changed = true;
        node.userData.semanticLinkId = semanticLinkId;
      }
    }
    const nodeIsCollider = Boolean(
      asRuntimeObject3D(node).isURDFCollider || node.userData?.isCollisionGroup === true,
    );
    const nextInsideCollider = insideCollider || nodeIsCollider;

    if (nodeIsCollider) {
      const colliderVisible =
        showCollision &&
        !shouldHideMjcfWorldRuntimeLink(sourceFormat, showMjcfWorldLink, nextParentLink?.name);

      if (node.visible !== colliderVisible) {
        changed = true;
      }
      node.visible = colliderVisible;

      if (nextParentLink) {
        const semanticLinkName = resolveSemanticLinkIdForRuntimeLink(
          sourceFormat,
          robotLinkData,
          nextParentLink.name,
        );

        if (
          node.userData?.parentLinkName !== semanticLinkName ||
          node.userData?.runtimeParentLinkName !== nextParentLink.name
        ) {
          changed = true;
        }
        node.userData.parentLinkName = semanticLinkName;
        node.userData.runtimeParentLinkName = nextParentLink.name;
      }

      // Keep traversing hidden collider subtrees so collision meshes still receive
      // stable metadata (link ownership, object index, semantic tags).
    }

    if ((node as THREE.Mesh).isMesh) {
      const mesh = node as THREE.Mesh;
      if (nextInsideCollider) {
        processCollisionMesh(mesh, nextParentLink);
      } else if (nextParentLink) {
        processVisualMesh(mesh, nextParentLink);
      }
    }

    for (let index = 0; index < node.children.length; index += 1) {
      walkNode(node.children[index], nextParentLink, nextInsideCollider);
    }
  };

  walkNode(robot, null, false);

  return { changed, linkMeshMap };
}
