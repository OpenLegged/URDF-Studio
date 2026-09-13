import * as THREE from 'three';

import {
  GeometryType,
  type RobotState,
  type UrdfLink,
  type UrdfOrigin,
  type UrdfVisual,
} from '../../../types/index.ts';
import { disposeObject3D } from '../../../shared/utils/three/dispose.ts';
import { createUsdAssetRegistry } from './usdAssetRegistry.ts';
import { type UsdMeshCompressionOptions } from './usdSceneNodeFactory.ts';
import { collectUsdSerializationContext } from './usdSerializationContext.ts';
import { buildUsdBaseLayerContent } from './usdSceneSerialization.ts';
import {
  buildUsdLinkPathMaps,
  buildUsdPhysicsLayerContent,
  buildUsdRobotLayerContent,
  buildUsdRootLayerContent,
  buildUsdSensorLayerContent,
  createUsdArchivePackage,
  resolveUsdPackageLayoutProfile,
  type UsdLayerFileFormat,
  type UsdPackageLayoutProfile,
} from './usdPackageLayers.ts';
import {
  buildUsdLinkSceneRoot,
  flattenUsdLinkSceneHierarchy,
  type UsdVisualMeshMergeOptions,
} from './usdLinkSceneBuilder.ts';
import { collectUsdExportAssetFiles } from './usdAssetCollection.ts';
import {
  advanceUsdProgress,
  createUsdProgressTracker,
  normalizeUsdProgressLabel,
  type UsdProgressEvent,
  type UsdProgressTracker,
  yieldToMainThread,
} from './usdProgress.ts';
import { sanitizeUsdIdentifier } from './usdTextFormatting.ts';

export type { UsdMeshCompressionOptions } from './usdSceneNodeFactory.ts';
export type { UsdLayerFileFormat, UsdPackageLayoutProfile } from './usdPackageLayers.ts';

const USD_EXPORT_RECORD_YIELD_INTERVAL = 4;
const MJCF_SYNTHETIC_GEOM_LINK_RE = /^(.*)_geom_(\d+)$/;
const TEMP_COMPOSE_EULER = new THREE.Euler(0, 0, 0, 'ZYX');

const createUsdExportRobot = (robot: RobotState): RobotState => {
  const exportRobot = structuredClone(robot);
  exportRobot.selection = { type: null, id: null };

  Object.values(exportRobot.joints).forEach((joint) => {
    if (joint.type === 'ball' || joint.type === 'floating') {
      delete joint.quaternion;
    }

    joint.angle = Number.isFinite(joint.referencePosition) ? joint.referencePosition! : 0;
  });

  return exportRobot;
};

const isMeaningfulGeometry = (geometry: UrdfVisual | null | undefined): geometry is UrdfVisual => {
  return geometry !== null && geometry !== undefined && geometry.type !== GeometryType.NONE;
};

const hasMeaningfulGeometryBodies = (bodies: UrdfVisual[] | null | undefined): boolean => {
  return (bodies || []).some((geometry) => isMeaningfulGeometry(geometry));
};

const isZero = (value: number | null | undefined): boolean => {
  return value == null || value === 0;
};

const isMasslessLink = (link: UrdfLink | undefined): boolean => {
  if (!link?.inertial) {
    return true;
  }

  return (
    isZero(link.inertial.mass) &&
    isZero(link.inertial.inertia?.ixx) &&
    isZero(link.inertial.inertia?.ixy) &&
    isZero(link.inertial.inertia?.ixz) &&
    isZero(link.inertial.inertia?.iyy) &&
    isZero(link.inertial.inertia?.iyz) &&
    isZero(link.inertial.inertia?.izz)
  );
};

const rpyToQuaternion = (r: number, p: number, y: number): THREE.Quaternion =>
  new THREE.Quaternion().setFromEuler(new THREE.Euler(r, p, y, 'ZYX'));

const composeOrigins = (
  parentOrigin: UrdfOrigin | null | undefined,
  childOrigin: UrdfOrigin | null | undefined,
): UrdfOrigin => {
  const parentTranslation = new THREE.Vector3(
    parentOrigin?.xyz?.x ?? 0,
    parentOrigin?.xyz?.y ?? 0,
    parentOrigin?.xyz?.z ?? 0,
  );
  const childTranslation = new THREE.Vector3(
    childOrigin?.xyz?.x ?? 0,
    childOrigin?.xyz?.y ?? 0,
    childOrigin?.xyz?.z ?? 0,
  );
  const parentQuaternion = rpyToQuaternion(
    parentOrigin?.rpy?.r ?? 0,
    parentOrigin?.rpy?.p ?? 0,
    parentOrigin?.rpy?.y ?? 0,
  );
  const childQuaternion = rpyToQuaternion(
    childOrigin?.rpy?.r ?? 0,
    childOrigin?.rpy?.p ?? 0,
    childOrigin?.rpy?.y ?? 0,
  );
  const composedQuaternion = parentQuaternion.clone().multiply(childQuaternion).normalize();
  const composedTranslation = childTranslation.applyQuaternion(parentQuaternion).add(parentTranslation);

  TEMP_COMPOSE_EULER.setFromQuaternion(composedQuaternion, 'ZYX');
  return {
    xyz: {
      x: composedTranslation.x,
      y: composedTranslation.y,
      z: composedTranslation.z,
    },
    rpy: {
      r: TEMP_COMPOSE_EULER.x,
      p: TEMP_COMPOSE_EULER.y,
      y: TEMP_COMPOSE_EULER.z,
    },
    quatXyzw: {
      x: composedQuaternion.x,
      y: composedQuaternion.y,
      z: composedQuaternion.z,
      w: composedQuaternion.w,
    },
  };
};

type RobotMaterialEntry = NonNullable<NonNullable<RobotState['materials']>[string]>;

const cloneGeometryForCollapsedMjcfExport = (
  geometry: UrdfVisual,
  material: RobotMaterialEntry | undefined,
  materialName: string,
  parentLinkOrigin?: UrdfOrigin | null,
): UrdfVisual => {
  const nextGeometry = structuredClone(geometry);
  nextGeometry.origin = composeOrigins(parentLinkOrigin, geometry.origin);
  if (!material) {
    return nextGeometry;
  }

  if (!nextGeometry.color && material.color) {
    nextGeometry.color = material.color;
  }

  if (
    (nextGeometry.authoredMaterials?.length ?? 0) === 0 &&
    (material.color || material.colorRgba || material.texture || material.usdMaterial)
  ) {
    nextGeometry.authoredMaterials = [
      {
        name: materialName,
        ...(material.color ? { color: material.color } : {}),
        ...(material.colorRgba ? { colorRgba: [...material.colorRgba] as [number, number, number, number] } : {}),
        ...(material.texture ? { texture: material.texture } : {}),
        ...(material.usdMaterial ? { usdMaterial: structuredClone(material.usdMaterial) } : {}),
      },
    ];
  }

  return nextGeometry;
};

const appendGeometryBody = (
  parent: UrdfLink,
  key: 'visualBodies' | 'collisionBodies',
  geometry: UrdfVisual,
): void => {
  parent[key] = [...(parent[key] || []), geometry];
};

const collapseSyntheticMjcfGeomLinksForUsdExport = (robot: RobotState): RobotState => {
  if (robot.inspectionContext?.sourceFormat !== 'mjcf') {
    return robot;
  }

  const childIdsByParent = new Map<string, string[]>();
  Object.values(robot.joints).forEach((joint) => {
    const children = childIdsByParent.get(joint.parentLinkId) || [];
    children.push(joint.childLinkId);
    childIdsByParent.set(joint.parentLinkId, children);
  });

  const syntheticAttachments = Object.values(robot.joints)
    .map((joint) => {
      if (joint.type !== 'fixed') {
        return null;
      }

      const childLink = robot.links[joint.childLinkId];
      if (!childLink) {
        return null;
      }

      const syntheticMatch =
        MJCF_SYNTHETIC_GEOM_LINK_RE.exec(childLink.id || '') ||
        MJCF_SYNTHETIC_GEOM_LINK_RE.exec(childLink.name || '');
      if (!syntheticMatch || syntheticMatch[1] !== joint.parentLinkId) {
        return null;
      }

      if ((childIdsByParent.get(joint.childLinkId)?.length || 0) > 0) {
        return null;
      }

      return {
        childLinkId: joint.childLinkId,
        jointId: joint.id,
        order: Number(syntheticMatch[2]),
        parentLinkId: joint.parentLinkId,
      };
    })
    .filter((entry) => Boolean(entry))
    .sort((left, right) => {
      if (left!.parentLinkId !== right!.parentLinkId) {
        return left!.parentLinkId.localeCompare(right!.parentLinkId);
      }
      return left!.order - right!.order;
    }) as Array<{
    childLinkId: string;
    jointId: string;
    order: number;
    parentLinkId: string;
  }>;

  for (const attachment of syntheticAttachments) {
    const parentLink = robot.links[attachment.parentLinkId];
    const childLink = robot.links[attachment.childLinkId];
    const joint = robot.joints[attachment.jointId];
    if (!parentLink || !childLink || !joint) {
      continue;
    }

    const childMaterial =
      robot.materials?.[childLink.id] || (childLink.name ? robot.materials?.[childLink.name] : undefined);
    const childMaterialName = childLink.name || childLink.id;
    const childLinkOrigin = joint.origin;

    if (isMeaningfulGeometry(childLink.visual)) {
      appendGeometryBody(
        parentLink,
        'visualBodies',
        cloneGeometryForCollapsedMjcfExport(
          childLink.visual,
          childMaterial,
          childMaterialName,
          childLinkOrigin,
        ),
      );
    }

    (childLink.visualBodies || []).forEach((visual) => {
      if (!isMeaningfulGeometry(visual)) {
        return;
      }
      appendGeometryBody(
        parentLink,
        'visualBodies',
        cloneGeometryForCollapsedMjcfExport(visual, childMaterial, childMaterialName, childLinkOrigin),
      );
    });

    if (isMeaningfulGeometry(childLink.collision)) {
      const collision = structuredClone(childLink.collision);
      collision.origin = composeOrigins(childLinkOrigin, childLink.collision.origin);
      appendGeometryBody(parentLink, 'collisionBodies', collision);
    }

    (childLink.collisionBodies || []).forEach((collision) => {
      if (!isMeaningfulGeometry(collision)) {
        return;
      }
      const nextCollision = structuredClone(collision);
      nextCollision.origin = composeOrigins(childLinkOrigin, collision.origin);
      appendGeometryBody(parentLink, 'collisionBodies', nextCollision);
    });

    delete robot.links[attachment.childLinkId];
    delete robot.joints[attachment.jointId];
    if (robot.materials) {
      delete robot.materials[childLink.id];
      if (childLink.name) {
        delete robot.materials[childLink.name];
      }
      if (Object.keys(robot.materials).length === 0) {
        delete robot.materials;
      }
    }
  }

  while (true) {
    const rootLink = robot.links[robot.rootLinkId];
    if (!rootLink || !isMasslessLink(rootLink)) {
      break;
    }
    if (
      isMeaningfulGeometry(rootLink.visual) ||
      isMeaningfulGeometry(rootLink.collision) ||
      hasMeaningfulGeometryBodies(rootLink.visualBodies) ||
      hasMeaningfulGeometryBodies(rootLink.collisionBodies) ||
      (rootLink.mjcfSites?.length ?? 0) > 0
    ) {
      break;
    }

    const childJoint = Object.values(robot.joints).find(
      (joint) => joint.parentLinkId === rootLink.id && joint.type === 'fixed',
    );
    if (!childJoint) {
      break;
    }

    const siblingCount = Object.values(robot.joints).filter(
      (joint) => joint.parentLinkId === rootLink.id,
    ).length;
    if (siblingCount !== 1 || !robot.links[childJoint.childLinkId]) {
      break;
    }

    delete robot.joints[childJoint.id];
    delete robot.links[rootLink.id];
    if (robot.materials) {
      delete robot.materials[rootLink.id];
      if (rootLink.name) {
        delete robot.materials[rootLink.name];
      }
      if (Object.keys(robot.materials).length === 0) {
        delete robot.materials;
      }
    }
    const childLink = robot.links[childJoint.childLinkId];
    if (childLink && childJoint.origin) {
      const hasJointOrigin = !isZero(childJoint.origin.xyz?.x)
        || !isZero(childJoint.origin.xyz?.y)
        || !isZero(childJoint.origin.xyz?.z)
        || !isZero(childJoint.origin.rpy?.r)
        || !isZero(childJoint.origin.rpy?.p)
        || !isZero(childJoint.origin.rpy?.y);
      if (hasJointOrigin) {
        const prependOrigin = (target: UrdfVisual | null | undefined): void => {
          if (!target || target.type === GeometryType.NONE) return;
          const jx = Number(childJoint.origin.xyz?.x || 0);
          const jy = Number(childJoint.origin.xyz?.y || 0);
          const jz = Number(childJoint.origin.xyz?.z || 0);
          const ox = Number(target.origin?.xyz?.x || 0) + jx;
          const oy = Number(target.origin?.xyz?.y || 0) + jy;
          const oz = Number(target.origin?.xyz?.z || 0) + jz;
          target.origin = {
            xyz: { x: ox, y: oy, z: oz },
            rpy: target.origin?.rpy ?? { r: 0, p: 0, y: 0 },
          };
        };
        prependOrigin(childLink.visual);
        prependOrigin(childLink.collision);
        if (childLink.inertial?.origin) {
          childLink.inertial.origin.xyz = {
            x: Number(childLink.inertial.origin.xyz.x) + Number(childJoint.origin.xyz?.x || 0),
            y: Number(childLink.inertial.origin.xyz.y) + Number(childJoint.origin.xyz?.y || 0),
            z: Number(childLink.inertial.origin.xyz.z) + Number(childJoint.origin.xyz?.z || 0),
          };
        }
      }
    }
    robot.rootLinkId = childJoint.childLinkId;
  }

  return robot;
};

export type ExportRobotToUsdPhase = 'links' | 'geometry' | 'scene' | 'assets';

export interface ExportRobotToUsdProgress {
  phase: ExportRobotToUsdPhase;
  completed: number;
  total: number;
  label?: string;
}

type UsdExportProgressTracker<TPhase extends ExportRobotToUsdPhase = ExportRobotToUsdPhase> =
  UsdProgressTracker<TPhase>;

export interface ExportRobotToUsdOptions {
  robot: RobotState;
  exportName: string;
  assets: Record<string, string>;
  extraMeshFiles?: Map<string, Blob>;
  meshCompression?: UsdMeshCompressionOptions;
  visualMeshMerge?: UsdVisualMeshMergeOptions;
  fileFormat?: UsdLayerFileFormat;
  layoutProfile?: UsdPackageLayoutProfile;
  onProgress?: (progress: ExportRobotToUsdProgress) => void;
}

export interface ExportRobotToUsdPayload {
  content: string;
  downloadFileName: string;
  archiveFileName: string;
  rootLayerPath: string;
  archiveFiles: Map<string, Blob>;
}

export async function exportRobotToUsd({
  robot,
  exportName,
  assets,
  extraMeshFiles,
  meshCompression,
  visualMeshMerge,
  fileFormat = 'usd',
  layoutProfile = 'legacy',
  onProgress,
}: ExportRobotToUsdOptions): Promise<ExportRobotToUsdPayload> {
  const exportRobot = createUsdExportRobot(robot);
  const resolvedLayoutProfile = resolveUsdPackageLayoutProfile(layoutProfile);
  collapseSyntheticMjcfGeomLinksForUsdExport(exportRobot);
  const normalizedExportName = sanitizeUsdIdentifier(exportName || exportRobot.name || 'robot');
  const configStem =
    resolvedLayoutProfile === 'isaacsim'
      ? normalizedExportName
      : `${normalizedExportName}${normalizedExportName.includes('description') ? '' : '_description'}`;
  const rootPrimName = configStem;
  const downloadExtension = fileFormat === 'usda' ? 'usda' : 'usd';
  const { registry, tempObjectUrls } = createUsdAssetRegistry(assets, extraMeshFiles);
  const pathMaps = buildUsdLinkPathMaps(exportRobot, rootPrimName, {
    layoutProfile: resolvedLayoutProfile,
  });
  const sceneRoot = new THREE.Group();
  sceneRoot.name = rootPrimName;
  const linkProgressTracker: UsdExportProgressTracker<'links'> = createUsdProgressTracker(
    'links',
    Math.max(1, Object.keys(exportRobot.links).length),
    onProgress as ((progress: UsdProgressEvent<'links'>) => void) | undefined,
  );

  try {
    const linkRoot = await buildUsdLinkSceneRoot({
      robot: exportRobot,
      registry,
      meshCompression,
      visualMeshMerge:
        visualMeshMerge ??
        (exportRobot.inspectionContext?.sourceFormat === 'mjcf' ? { enabled: true } : undefined),
      onLinkVisit: async (link) => {
        advanceUsdProgress(
          linkProgressTracker,
          normalizeUsdProgressLabel(link.name || link.id, 'link'),
        );

        if (
          linkProgressTracker.completed < linkProgressTracker.total &&
          linkProgressTracker.completed % 4 === 0
        ) {
          await yieldToMainThread();
        }
      },
    });
    sceneRoot.add(linkRoot);
    if (resolvedLayoutProfile === 'isaacsim') {
      flattenUsdLinkSceneHierarchy(sceneRoot);
    }
    sceneRoot.updateMatrixWorld(true);

    const rootLayerContent = buildUsdRootLayerContent(rootPrimName, configStem, {
      fileFormat,
      layoutProfile: resolvedLayoutProfile,
    });
    await yieldToMainThread();
    const usdContext = await collectUsdSerializationContext(sceneRoot, {
      rootPrimName,
      onProgress,
    });
    await yieldToMainThread();
    const baseLayerContent = await buildUsdBaseLayerContent(sceneRoot, usdContext, onProgress, {
      materialProfile: resolvedLayoutProfile === 'isaacsim' ? 'isaacsim' : 'preview',
    });
    await yieldToMainThread();
    const physicsLayerContent = buildUsdPhysicsLayerContent(
      exportRobot,
      pathMaps,
      rootPrimName,
      configStem,
      {
        fileFormat,
        layoutProfile: resolvedLayoutProfile,
      },
    );
    await yieldToMainThread();
    const sensorLayerContent = buildUsdSensorLayerContent(rootPrimName);
    const robotLayerContent =
      resolvedLayoutProfile === 'isaacsim'
        ? buildUsdRobotLayerContent(exportRobot, pathMaps, rootPrimName, {
            layoutProfile: resolvedLayoutProfile,
          })
        : undefined;
    await yieldToMainThread();
    const usdAssetFiles = await collectUsdExportAssetFiles({
      sceneRoot,
      context: usdContext,
      registry,
      onProgress,
      recordYieldInterval: USD_EXPORT_RECORD_YIELD_INTERVAL,
    });

    const archive = createUsdArchivePackage(
      normalizedExportName,
      {
        rootLayerContent,
        baseLayerContent,
        physicsLayerContent,
        sensorLayerContent,
        robotLayerContent,
      },
      usdAssetFiles,
      {
        fileFormat,
        layoutProfile: resolvedLayoutProfile,
      },
    );

    return {
      content: rootLayerContent,
      downloadFileName: `${normalizedExportName}.${downloadExtension}`,
      archiveFileName: archive.archiveFileName,
      rootLayerPath: archive.rootLayerPath,
      archiveFiles: archive.archiveFiles,
    };
  } finally {
    disposeObject3D(sceneRoot);
    tempObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  }
}
