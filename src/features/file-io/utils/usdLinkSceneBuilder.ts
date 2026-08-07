import * as THREE from 'three';

import type { RobotState, UrdfJoint, UrdfLink, UrdfVisual } from '../../../types/index.ts';
import {
  getJointMotionAngleFromActualAngle,
  getVisualGeometryEntries,
  hasBoxFaceMaterialPalette,
  resolveVisualMaterialOverride,
} from '@/core/robot';
import {
  buildColladaRootNormalizationHints,
  type ColladaRootNormalizationHints,
} from '../../../core/loaders/colladaRootNormalization.ts';
import {
  USD_GEOMETRY_TYPES as GEOMETRY_TYPES,
  buildUsdVisualSceneNode,
  getUsdGeometryType as getGeometryType,
  type UsdMaterialMetadata,
  type UsdMeshCompressionOptions,
} from './usdSceneNodeFactory.ts';
import { type UsdAssetRegistry } from './usdAssetRegistry.ts';
import { isUsdMeshObject } from './usdMaterialNormalization.ts';
import { applyUsdMaterialMetadata } from './usdSceneSerialization.ts';
import { sanitizeUsdIdentifier } from './usdTextFormatting.ts';
import { disposeObject3D } from '@/shared/utils/three/dispose.ts';

export type UsdVisualMeshMergeOptions = {
  enabled: boolean;
};

export type BuildUsdLinkSceneRootOptions = {
  robot: RobotState;
  registry: UsdAssetRegistry;
  meshCompression?: UsdMeshCompressionOptions;
  colladaRootNormalizationHints?: ColladaRootNormalizationHints | null;
  visualMeshMerge?: UsdVisualMeshMergeOptions;
  onLinkVisit?: (link: UrdfLink) => void | Promise<void>;
};

type DeferredSceneMutation = Promise<void>;
const ISAAC_OMITTED_PLACEHOLDER_VISUAL_MAX_DIMENSION = 0.002;
const USD_GEOMETRY_COMPARE_EPSILON = 1e-6;

const hasNearlyEqualNumber = (left: number, right: number): boolean => {
  return Math.abs(left - right) <= USD_GEOMETRY_COMPARE_EPSILON;
};

const hasMatchingVisualOrigin = (left: UrdfVisual, right: UrdfVisual): boolean => {
  return (
    hasNearlyEqualNumber(left.origin?.xyz?.x ?? 0, right.origin?.xyz?.x ?? 0) &&
    hasNearlyEqualNumber(left.origin?.xyz?.y ?? 0, right.origin?.xyz?.y ?? 0) &&
    hasNearlyEqualNumber(left.origin?.xyz?.z ?? 0, right.origin?.xyz?.z ?? 0) &&
    hasNearlyEqualNumber(left.origin?.rpy?.r ?? 0, right.origin?.rpy?.r ?? 0) &&
    hasNearlyEqualNumber(left.origin?.rpy?.p ?? 0, right.origin?.rpy?.p ?? 0) &&
    hasNearlyEqualNumber(left.origin?.rpy?.y ?? 0, right.origin?.rpy?.y ?? 0)
  );
};

const hasMatchingVisualDimensions = (left: UrdfVisual, right: UrdfVisual): boolean => {
  return (
    hasNearlyEqualNumber(left.dimensions.x ?? 0, right.dimensions.x ?? 0) &&
    hasNearlyEqualNumber(left.dimensions.y ?? 0, right.dimensions.y ?? 0) &&
    hasNearlyEqualNumber(left.dimensions.z ?? 0, right.dimensions.z ?? 0)
  );
};

const getPrimitiveMaxDimension = (visual: UrdfVisual): number => {
  const type = getGeometryType(visual.type);
  if (type === GEOMETRY_TYPES.SPHERE) {
    return Math.abs(visual.dimensions.x ?? 0);
  }

  if (type === GEOMETRY_TYPES.CYLINDER || type === GEOMETRY_TYPES.CAPSULE) {
    return Math.max(Math.abs(visual.dimensions.x ?? 0), Math.abs(visual.dimensions.y ?? 0));
  }

  return Math.max(
    Math.abs(visual.dimensions.x ?? 0),
    Math.abs(visual.dimensions.y ?? 0),
    Math.abs(visual.dimensions.z ?? 0),
  );
};

const shouldOmitIsaacPlaceholderPrimitiveVisual = (
  visual: UrdfVisual,
  collisions: UrdfVisual[],
  materialState: UsdMaterialMetadata,
): boolean => {
  const geometryType = getGeometryType(visual.type);
  if (geometryType !== GEOMETRY_TYPES.BOX) {
    return false;
  }

  if (getPrimitiveMaxDimension(visual) > ISAAC_OMITTED_PLACEHOLDER_VISUAL_MAX_DIMENSION) {
    return false;
  }

  const hasNamedPlaceholderMaterial = (visual.authoredMaterials || []).some((material) => {
    const materialName = String(material?.name || '').trim();
    if (!materialName) {
      return false;
    }

    const rgba = Array.isArray(materialState.colorRgba) ? materialState.colorRgba : null;
    if (rgba && rgba.length >= 3) {
      const minChannel = Math.min(rgba[0] ?? 0, rgba[1] ?? 0, rgba[2] ?? 0);
      const maxChannel = Math.max(rgba[0] ?? 0, rgba[1] ?? 0, rgba[2] ?? 0);
      return minChannel >= 0.99 && maxChannel - minChannel <= 0.01;
    }

    return (
      String(materialState.color || '')
        .trim()
        .toLowerCase() === '#ffffff'
    );
  });
  if (!hasNamedPlaceholderMaterial) {
    return false;
  }

  return collisions.some((collision) => {
    return (
      getGeometryType(collision.type) === geometryType &&
      hasMatchingVisualDimensions(visual, collision) &&
      hasMatchingVisualOrigin(visual, collision)
    );
  });
};

const shouldSuppressIsaacPlaceholderPrimitiveMaterial = (
  visual: UrdfVisual,
  collisions: UrdfVisual[],
  materialState: UsdMaterialMetadata,
): boolean => {
  const geometryType = getGeometryType(visual.type);
  if (
    geometryType !== GEOMETRY_TYPES.SPHERE &&
    geometryType !== GEOMETRY_TYPES.CYLINDER &&
    geometryType !== GEOMETRY_TYPES.CAPSULE
  ) {
    return false;
  }

  if (getPrimitiveMaxDimension(visual) > ISAAC_OMITTED_PLACEHOLDER_VISUAL_MAX_DIMENSION) {
    return false;
  }

  const rgba = Array.isArray(materialState.colorRgba) ? materialState.colorRgba : null;
  const isWhite = rgba
    ? Math.min(rgba[0] ?? 0, rgba[1] ?? 0, rgba[2] ?? 0) >= 0.99
    : String(materialState.color || '')
        .trim()
        .toLowerCase() === '#ffffff';
  if (!isWhite) {
    return false;
  }

  return collisions.some((collision) => {
    return (
      getGeometryType(collision.type) === geometryType &&
      hasMatchingVisualDimensions(visual, collision) &&
      hasMatchingVisualOrigin(visual, collision)
    );
  });
};

const resolveLinkMaterialEntry = (
  robot: RobotState,
  link: UrdfLink,
  visual: UrdfVisual,
  options: { isPrimaryVisual: boolean },
): UsdMaterialMetadata => {
  const resolvedMaterial = resolveVisualMaterialOverride(robot, link, visual, {
    isPrimaryVisual: options.isPrimaryVisual,
  });
  const shouldSuppressGazeboFallback = visual.materialSource === 'gazebo';

  if (resolvedMaterial.source === 'authored') {
    if (resolvedMaterial.isMultiMaterial) {
      return {
        preserveEmbeddedMaterials: true,
      };
    }

    return {
      color: resolvedMaterial.color || undefined,
      colorRgba: resolvedMaterial.colorRgba,
      opacity: resolvedMaterial.opacity,
      texture: resolvedMaterial.texture || undefined,
      forceUniformOverride: true,
    };
  }

  if (resolvedMaterial.source === 'legacy-link') {
    if (shouldSuppressGazeboFallback) {
      return {
        suppressVisualColor: true,
      };
    }

    return {
      color:
        resolvedMaterial.color ||
        (resolvedMaterial.texture ? '#ffffff' : undefined) ||
        visual.color ||
        undefined,
      colorRgba: resolvedMaterial.colorRgba,
      opacity: resolvedMaterial.opacity,
      texture: resolvedMaterial.texture || undefined,
      forceUniformOverride: true,
    };
  }

  return {
    color: shouldSuppressGazeboFallback ? undefined : visual.color || undefined,
    ...(shouldSuppressGazeboFallback ? { suppressVisualColor: true } : {}),
  };
};

const rpyToQuaternion = (r: number, p: number, y: number): THREE.Quaternion => {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(r, p, y, 'ZYX'));
};

const createJointLocalMatrix = (joint: UrdfJoint): THREE.Matrix4 => {
  const originPosition = new THREE.Vector3(
    joint.origin?.xyz?.x ?? 0,
    joint.origin?.xyz?.y ?? 0,
    joint.origin?.xyz?.z ?? 0,
  );
  const originQuaternion = rpyToQuaternion(
    joint.origin?.rpy?.r ?? 0,
    joint.origin?.rpy?.p ?? 0,
    joint.origin?.rpy?.y ?? 0,
  );

  const originMatrix = new THREE.Matrix4().compose(
    originPosition,
    originQuaternion,
    new THREE.Vector3(1, 1, 1),
  );

  const motionMatrix = new THREE.Matrix4();
  const axis = new THREE.Vector3(joint.axis?.x ?? 1, joint.axis?.y ?? 0, joint.axis?.z ?? 0);
  if (axis.lengthSq() <= 1e-12) {
    axis.set(1, 0, 0);
  } else {
    axis.normalize();
  }

  const jointType = String(joint.type || '').toLowerCase();
  const jointMotion =
    typeof joint.angle === 'number' ? getJointMotionAngleFromActualAngle(joint, joint.angle) : 0;
  if (jointType === 'revolute' || jointType === 'continuous') {
    motionMatrix.makeRotationAxis(axis, jointMotion);
  } else if (jointType === 'prismatic') {
    motionMatrix.makeTranslation(axis.x * jointMotion, axis.y * jointMotion, axis.z * jointMotion);
  } else if ((jointType === 'ball' || jointType === 'floating') && joint.quaternion) {
    motionMatrix.makeRotationFromQuaternion(
      new THREE.Quaternion(
        joint.quaternion.x,
        joint.quaternion.y,
        joint.quaternion.z,
        joint.quaternion.w,
      ),
    );
  } else {
    motionMatrix.identity();
  }

  return originMatrix.multiply(motionMatrix);
};

const getCollisionVisuals = (link: UrdfLink): UrdfVisual[] => {
  return [
    ...(getGeometryType(link.collision?.type) === GEOMETRY_TYPES.NONE ? [] : [link.collision]),
    ...(link.collisionBodies || []).filter(
      (body) => getGeometryType(body.type) !== GEOMETRY_TYPES.NONE,
    ),
  ];
};

const buildChildIdsByParent = (robot: RobotState): Map<string, string[]> => {
  const childIdsByParent = new Map<string, string[]>();
  Object.values(robot.joints).forEach((joint) => {
    const children = childIdsByParent.get(joint.parentLinkId) || [];
    children.push(joint.childLinkId);
    childIdsByParent.set(joint.parentLinkId, children);
  });
  return childIdsByParent;
};

const buildJointsByChild = (robot: RobotState): Map<string, UrdfJoint> => {
  const jointsByChild = new Map<string, UrdfJoint>();
  Object.values(robot.joints).forEach((joint) => {
    jointsByChild.set(joint.childLinkId, joint);
  });
  return jointsByChild;
};

type MergeableUsdMesh = THREE.Mesh & {
  userData: {
    usdAuthoredColor?: [number, number, number];
    usdDisplayColor?: string | null;
    usdMaterial?: Record<string, unknown>;
    usdMaterialPalette?: Array<{
      materialIndex: number;
      usdAuthoredColor?: [number, number, number];
      usdDisplayColor?: string | null;
      usdMaterial?: Record<string, unknown>;
      usdOpacity?: number;
      usdSourceMaterialName?: string;
    }>;
    usdOpacity?: number;
    usdSourceMaterialName?: string;
  };
};

const getMeshMaterials = (mesh: THREE.Mesh): THREE.Material[] => {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return materials.filter((material): material is THREE.Material => Boolean(material));
};

const cloneMaterialForMergedMesh = (material: THREE.Material): THREE.Material => {
  const cloned = material.clone();
  cloned.userData = {
    ...(material.userData ?? {}),
    ...(cloned.userData ?? {}),
  };
  return cloned;
};

const getMaterialPaletteEntryForMerge = (
  mesh: MergeableUsdMesh,
  materialIndex: number,
  nextMaterialIndex: number,
) => {
  const paletteEntry = Array.isArray(mesh.userData.usdMaterialPalette)
    ? mesh.userData.usdMaterialPalette.find((entry) => entry?.materialIndex === materialIndex)
    : null;

  if (paletteEntry) {
    return {
      ...paletteEntry,
      materialIndex: nextMaterialIndex,
      ...(paletteEntry.usdAuthoredColor
        ? { usdAuthoredColor: [...paletteEntry.usdAuthoredColor] as [number, number, number] }
        : {}),
      ...(paletteEntry.usdMaterial
        ? { usdMaterial: structuredClone(paletteEntry.usdMaterial) }
        : {}),
    };
  }

  const material = getMeshMaterials(mesh)[materialIndex] || getMeshMaterials(mesh)[0];
  return {
    materialIndex: nextMaterialIndex,
    ...(mesh.userData.usdAuthoredColor
      ? { usdAuthoredColor: [...mesh.userData.usdAuthoredColor] as [number, number, number] }
      : {}),
    ...(mesh.userData.usdDisplayColor !== undefined
      ? { usdDisplayColor: mesh.userData.usdDisplayColor }
      : {}),
    ...(mesh.userData.usdMaterial
      ? { usdMaterial: structuredClone(mesh.userData.usdMaterial) }
      : {}),
    ...(mesh.userData.usdOpacity !== undefined ? { usdOpacity: mesh.userData.usdOpacity } : {}),
    ...(mesh.userData.usdSourceMaterialName || material?.name
      ? { usdSourceMaterialName: mesh.userData.usdSourceMaterialName || material?.name }
      : {}),
  };
};

const collectGeometryIndexValues = (geometry: THREE.BufferGeometry): number[] => {
  const index = geometry.getIndex();
  if (index) {
    return Array.from(index.array, (value) => Number(value));
  }

  const position = geometry.getAttribute('position');
  return Array.from({ length: position?.count ?? 0 }, (_, value) => value);
};

const getGeometryGroupsForMerge = (
  geometry: THREE.BufferGeometry,
  indexCount: number,
): Array<{ start: number; count: number; materialIndex: number }> => {
  const groups = geometry.groups.filter((group) => {
    return Number.isFinite(group.start) && Number.isFinite(group.count) && group.count > 0;
  });

  if (groups.length > 0) {
    return groups.map((group) => ({
      start: Math.max(0, Math.floor(group.start)),
      count: Math.max(0, Math.floor(group.count)),
      materialIndex: Math.max(0, Math.floor(group.materialIndex ?? 0)),
    }));
  }

  return [{ start: 0, count: indexCount, materialIndex: 0 }];
};

const mergeUsdVisualMeshesInScope = (visualsScope: THREE.Group): void => {
  if (visualsScope.children.length < 2) {
    return;
  }

  visualsScope.updateMatrixWorld(true);
  const scopeWorldInverse = visualsScope.matrixWorld.clone().invert();
  const meshEntries: Array<{ mesh: MergeableUsdMesh; matrix: THREE.Matrix4 }> = [];

  visualsScope.children.forEach((visualRoot) => {
    let meshCount = 0;
    visualRoot.updateMatrixWorld(true);
    visualRoot.traverse((child) => {
      if (!isUsdMeshObject(child) || (child as THREE.SkinnedMesh).isSkinnedMesh) {
        return;
      }

      const position = child.geometry.getAttribute('position');
      if (!position || position.count === 0) {
        return;
      }

      meshCount += 1;
      meshEntries.push({
        mesh: child as MergeableUsdMesh,
        matrix: scopeWorldInverse.clone().multiply(child.matrixWorld),
      });
    });

    if (meshCount === 0) {
      meshEntries.length = 0;
    }
  });

  if (meshEntries.length < 2) {
    return;
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const mergedMaterials: THREE.Material[] = [];
  const mergedPalette: Array<Record<string, unknown> & { materialIndex: number }> = [];
  const mergedGeometry = new THREE.BufferGeometry();
  let includeNormals = true;
  let includeUvs = true;

  meshEntries.forEach(({ mesh, matrix }) => {
    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const uv = geometry.getAttribute('uv');
    includeNormals = includeNormals && Boolean(normal && normal.count >= position.count);
    includeUvs = includeUvs && Boolean(uv && uv.count >= position.count);
  });

  meshEntries.forEach(({ mesh, matrix }) => {
    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const uv = geometry.getAttribute('uv');
    const sourceIndices = collectGeometryIndexValues(geometry);
    const sourceGroups = getGeometryGroupsForMerge(geometry, sourceIndices.length);
    const meshMaterials = getMeshMaterials(mesh);
    const materialOffset = mergedMaterials.length;
    meshMaterials.forEach((material) => {
      mergedMaterials.push(cloneMaterialForMergedMesh(material));
    });

    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
    const point = new THREE.Vector3();
    const normalVector = new THREE.Vector3();
    let appendedVertexCount = 0;

    sourceGroups.forEach((group) => {
      const groupStart = appendedVertexCount;
      const groupEnd = Math.min(sourceIndices.length, group.start + group.count);
      const sourceMaterialIndex = Math.min(
        group.materialIndex,
        Math.max(0, meshMaterials.length - 1),
      );
      const targetMaterialIndex = materialOffset + sourceMaterialIndex;
      for (let index = group.start; index < groupEnd; index += 1) {
        const vertexIndex = sourceIndices[index] ?? 0;
        point
          .set(position.getX(vertexIndex), position.getY(vertexIndex), position.getZ(vertexIndex))
          .applyMatrix4(matrix);
        positions.push(point.x, point.y, point.z);

        if (includeNormals && normal) {
          normalVector
            .set(normal.getX(vertexIndex), normal.getY(vertexIndex), normal.getZ(vertexIndex))
            .applyMatrix3(normalMatrix)
            .normalize();
          normals.push(normalVector.x, normalVector.y, normalVector.z);
        }

        if (includeUvs && uv) {
          uvs.push(uv.getX(vertexIndex), uv.getY(vertexIndex));
        }
        appendedVertexCount += 1;
      }

      const appendedCount = appendedVertexCount - groupStart;
      if (appendedCount > 0) {
        mergedGeometry.addGroup(
          positions.length / 3 - appendedCount,
          appendedCount,
          targetMaterialIndex,
        );
        mergedPalette.push(
          getMaterialPaletteEntryForMerge(mesh, sourceMaterialIndex, targetMaterialIndex),
        );
      }
    });
  });

  if (positions.length === 0 || mergedMaterials.length < 2) {
    mergedGeometry.dispose();
    mergedMaterials.forEach((material) => material.dispose());
    return;
  }

  mergedGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (includeNormals && normals.length === positions.length) {
    mergedGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  } else {
    mergedGeometry.computeVertexNormals();
  }
  if (includeUvs && uvs.length === (positions.length / 3) * 2) {
    mergedGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  }
  mergedGeometry.computeBoundingBox();
  mergedGeometry.computeBoundingSphere();

  const mergedMesh = new THREE.Mesh(mergedGeometry, mergedMaterials);
  mergedMesh.name = 'visual_merged';
  mergedMesh.userData = {
    usdMergedVisual: true,
    usdMergedSourcePrims: visualsScope.children.map((child) => child.name),
    usdMaterialPalette: mergedPalette,
  };

  const previousChildren = [...visualsScope.children];
  visualsScope.clear();
  visualsScope.add(mergedMesh);
  const mergedMaterialSet = new Set(mergedMaterials);
  previousChildren.forEach((child) => disposeObject3D(child, false, mergedMaterialSet));
};

const buildLinkSceneNode = async (
  robot: RobotState,
  linkId: string,
  childIdsByParent: Map<string, string[]>,
  jointsByChild: Map<string, UrdfJoint>,
  registry: UsdAssetRegistry,
  pendingSceneMutations: DeferredSceneMutation[],
  meshCompression?: UsdMeshCompressionOptions,
  colladaRootNormalizationHints?: ColladaRootNormalizationHints | null,
  visualMeshMerge?: UsdVisualMeshMergeOptions,
  onLinkVisit?: (link: UrdfLink) => void | Promise<void>,
): Promise<THREE.Group> => {
  const link = robot.links[linkId];
  const group = new THREE.Group();
  group.name = sanitizeUsdIdentifier(linkId);

  if (!link) {
    return group;
  }

  group.userData.usdLink = {
    id: link.id,
    name: link.name,
  };
  await onLinkVisit?.(link);

  const visuals = getVisualGeometryEntries(link);
  if (visuals.length > 0) {
    const visualsScope = new THREE.Group();
    visualsScope.name = 'visuals';
    group.add(visualsScope);
    const collisions = getCollisionVisuals(link);
    const resolvedVisualEntries = visuals.map((visualEntry) => {
      const materialState = resolveLinkMaterialEntry(robot, link, visualEntry.geometry, {
        isPrimaryVisual: visualEntry.bodyIndex === null,
      });
      const suppressIsaacPlaceholderMaterial = shouldSuppressIsaacPlaceholderPrimitiveMaterial(
        visualEntry.geometry,
        collisions,
        materialState,
      );

      return {
        visualEntry,
        materialState: suppressIsaacPlaceholderMaterial
          ? { suppressVisualColor: true }
          : materialState,
        omitIsaacPlaceholderVisual: shouldOmitIsaacPlaceholderPrimitiveVisual(
          visualEntry.geometry,
          collisions,
          materialState,
        ),
      };
    });
    const visibleVisualEntries = resolvedVisualEntries.filter((entry) => {
      return !entry.omitIsaacPlaceholderVisual;
    });
    const omittedPlaceholderVisualCount =
      resolvedVisualEntries.length - visibleVisualEntries.length;

    const visualNodePromises = visibleVisualEntries.map(async (entry, index) => {
      const visual = entry.visualEntry.geometry;
      const materialState = entry.materialState;
      const visualNode = await buildUsdVisualSceneNode({
        visual,
        role: 'visual',
        registry,
        materialState,
        meshCompression,
        colladaRootNormalizationHints,
      });
      if (!visualNode) {
        return null;
      }

      visualNode.name = `visual_${index}`;
      if (
        !visualNode.userData.usdPreserveEmbeddedMaterialAppearance &&
        !hasBoxFaceMaterialPalette(visual) &&
        (materialState.color || materialState.texture)
      ) {
        applyUsdMaterialMetadata(visualNode, materialState);
      }

      return visualNode;
    });

    pendingSceneMutations.push(
      Promise.all(visualNodePromises).then((visualNodes) => {
        visualNodes.forEach((visualNode) => {
          if (visualNode) {
            visualsScope.add(visualNode);
          }
        });

        if (visualsScope.children.length === 0 && omittedPlaceholderVisualCount === 0) {
          group.remove(visualsScope);
          return;
        }

        if (visualMeshMerge?.enabled) {
          mergeUsdVisualMeshesInScope(visualsScope);
        }
      }),
    );
  }

  const collisions = getCollisionVisuals(link);
  if (collisions.length > 0) {
    const collidersScope = new THREE.Group();
    collidersScope.name = 'collisions';
    collidersScope.userData.usdVisibility = 'invisible';
    group.add(collidersScope);

    const collisionNodePromises = collisions.map(async (collision, index) => {
      const collisionNode = await buildUsdVisualSceneNode({
        visual: collision,
        role: 'collision',
        registry,
        meshCompression,
        colladaRootNormalizationHints,
      });
      if (!collisionNode) {
        return null;
      }

      collisionNode.name = `collision_${index}`;
      collisionNode.userData.usdPurpose = 'guide';
      collisionNode.userData.usdCollision = true;
      if (getGeometryType(collision.type) === GEOMETRY_TYPES.MESH) {
        collisionNode.userData.usdMeshCollision = true;
      }

      return collisionNode;
    });

    pendingSceneMutations.push(
      Promise.all(collisionNodePromises).then((collisionNodes) => {
        collisionNodes.forEach((collisionNode) => {
          if (collisionNode) {
            collidersScope.add(collisionNode);
          }
        });

        if (collidersScope.children.length === 0) {
          group.remove(collidersScope);
        }
      }),
    );
  }

  const childLinkIds = childIdsByParent.get(linkId) || [];
  if (childLinkIds.length > 0) {
    const childNodes = await Promise.all(
      childLinkIds.map((childLinkId) =>
        buildLinkSceneNode(
          robot,
          childLinkId,
          childIdsByParent,
          jointsByChild,
          registry,
          pendingSceneMutations,
          meshCompression,
          colladaRootNormalizationHints,
          visualMeshMerge,
          onLinkVisit,
        ),
      ),
    );

    childLinkIds.forEach((childLinkId, index) => {
      const childNode = childNodes[index];
      const joint = jointsByChild.get(childLinkId);
      if (joint) {
        const jointMatrix = createJointLocalMatrix(joint);
        jointMatrix.decompose(childNode.position, childNode.quaternion, childNode.scale);
      }

      group.add(childNode);
    });
  }

  return group;
};

export const flattenUsdLinkSceneHierarchy = (sceneRoot: THREE.Object3D): void => {
  sceneRoot.updateMatrixWorld(true);

  const nestedLinkNodes: THREE.Object3D[] = [];
  sceneRoot.traverse((node) => {
    if (node === sceneRoot) {
      return;
    }
    if (!node.userData?.usdLink) {
      return;
    }
    if (node.parent === sceneRoot) {
      return;
    }
    nestedLinkNodes.push(node);
  });

  nestedLinkNodes.forEach((node) => {
    sceneRoot.attach(node);
  });
};

export const buildUsdLinkSceneRoot = async ({
  robot,
  registry,
  meshCompression,
  colladaRootNormalizationHints,
  visualMeshMerge,
  onLinkVisit,
}: BuildUsdLinkSceneRootOptions): Promise<THREE.Group> => {
  const resolvedHints =
    colladaRootNormalizationHints ?? buildColladaRootNormalizationHints(robot.links);
  const pendingSceneMutations: DeferredSceneMutation[] = [];
  const root = await buildLinkSceneNode(
    robot,
    robot.rootLinkId,
    buildChildIdsByParent(robot),
    buildJointsByChild(robot),
    registry,
    pendingSceneMutations,
    meshCompression,
    resolvedHints,
    visualMeshMerge,
    onLinkVisit,
  );

  const mutationResults = await Promise.allSettled(pendingSceneMutations);
  const rejectedMutation = mutationResults.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (rejectedMutation) {
    throw rejectedMutation.reason;
  }

  return root;
};
