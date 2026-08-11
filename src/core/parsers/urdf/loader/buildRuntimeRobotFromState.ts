import * as THREE from 'three';
import { isImageAssetPath } from '@/core/utils/assetFileTypes';
import {
  applyVisualMaterialOverrideToObject,
  hasExplicitGeometryMaterialOverride,
  resolvePrimaryAuthoredVisualMaterialOverride,
  resolveVisualMaterialOverrideFromGeometry,
} from '@/core/utils/visualMaterialOverrides';
import {
  getBoxFaceMaterialPalette,
  getCollisionGeometryEntries,
  hasGeometryMeshMaterialGroups,
  getVisualGeometryEntries,
  isUnactuatedJoint,
  resolveMjcfPassiveSpringJointMetadata,
} from '@/core/robot';
import { createMatteMaterial } from '@/core/utils/materialFactory';
import { applyVisualMeshMaterialGroupsToObject } from '@/core/utils/meshMaterialGroups';
import { createMainThreadYieldController } from '@/core/utils/yieldToMainThread';
import { createInlineMJCFMeshObject } from '@/core/parsers/mjcf/mjcfGeometry';
import { getJointMotionAngleFromActualAngle } from '@/core/robot/kinematics';
import { normalizeJointLimitOrder } from '@/core/robot/jointLimits';
import {
  GeometryType,
  JointType,
  type RobotData,
  type UrdfJoint as RobotJoint,
  type UrdfLink as RobotLink,
} from '@/types';
import {
  URDFCollider,
  URDFJoint,
  URDFLink,
  URDFMimicJoint,
  URDFRobot,
  URDFVisual,
} from './URDFClasses';
import type { MeshLoadFunc } from './URDFLoader';
import { type RobotPrimitiveGeometryDetail } from './primitiveGeometry';
import { createVisualRestackBatch } from './visualRestackBatch';
import {
  applyOrigin,
  attachBallJointQuaternionState,
  loadedObjectShouldPreserveEmbeddedMaterials,
  loadedObjectHasSingleMaterialSlot,
  shouldAttachLoadedMeshObject,
  extractSubmesh,
  restackLinkVisualRoots,
  restackRobotVisualRoots,
  resolveStateVisualMaterialOverride,
  applyMeshScale,
  applyRuntimeMeshAssetTransform,
  applyVisualMaterialSidePolicy,
  createImagePreviewMesh,
  createHeightfieldMesh,
  createPolylineMesh,
  createPrimitiveMesh,
  resolveRuntimeJointType,
} from './buildRuntimeRobotFromStateHelpers';

/**
 * Whether a loaded object exposes exactly one material slot across all of its meshes.
 *
 * A single slot means a name-keyed material palette has nothing to map onto, so the
 * palette cannot describe this object and a single override is the only usable form.
 */
/**
 * Extract a named submesh from a loaded Collada/DAE scene object.
 *
 * SDF models often reference a single shared DAE file from multiple links,
 * using `<submesh><name>X</name></submesh>` to select a specific named node.
 * This function finds the child matching `submeshName` and returns a new
 * group containing only that subtree.
 *
 * The mesh loader may apply a unit-conversion scale (e.g. 0.001 for inch→meter)
 * to the root scene object.  Because `clone()` only copies the child's own
 * transform — not the parent's scale — we must carry the parent scale forward
 * so that the extracted submesh renders at the correct size.
 *
 * When `center` is true the extracted geometry is re-centered so that its
 * bounding-box center sits at the local origin (the SDF convention for
 * wheels and other symmetric parts).
 */
export interface BuildRuntimeRobotFromStateOptions {
  robotName?: string;
  links: Record<string, RobotLink>;
  joints: Record<string, RobotJoint>;
  materials?: RobotData['materials'];
  inspectionContext?: RobotData['inspectionContext'];
  manager: THREE.LoadingManager;
  loadMeshCb: MeshLoadFunc;
  parseVisual?: boolean;
  parseCollision?: boolean;
  primitiveGeometryDetail?: RobotPrimitiveGeometryDetail;
  rootLinkId?: string;
  yieldIfNeeded?: () => Promise<void>;
}

export async function buildRuntimeRobotFromState({
  robotName,
  links,
  joints,
  materials,
  inspectionContext,
  manager,
  loadMeshCb,
  parseVisual = true,
  parseCollision = true,
  primitiveGeometryDetail,
  rootLinkId,
  yieldIfNeeded = createMainThreadYieldController(),
}: BuildRuntimeRobotFromStateOptions): Promise<URDFRobot> {
  const robot = new URDFRobot();
  const linkMap: Record<string, URDFLink> = {};
  const jointMap: Record<string, URDFJoint> = {};
  const colliderMap: Record<string, URDFCollider> = {};
  const visualMap: Record<string, URDFVisual> = {};
  const authoredColliderFrameMap: Record<string, URDFCollider> = {};
  const authoredVisualFrameMap: Record<string, URDFVisual> = {};
  // Shares the resulting MeshStandardMaterial across geoms that resolve to the
  // same visual material override + source-material profile, so each robot
  // load only allocates one material per distinct profile instead of one per
  // mesh. Scope is intentionally one cache per load: dispose lifecycle stays
  // tied to the loaded robot and there is no cross-load aliasing.
  const visualMaterialOverrideCache = new Map<string, THREE.MeshStandardMaterial>();
  const visualRestackBatch = createVisualRestackBatch(() => restackRobotVisualRoots(robot));

  robot.robotName = robotName ?? null;
  robot.name = robotName || '';
  robot.urdfName = robot.name;
  robot.userData.displayName = robotName || '';
  if (inspectionContext?.sourceFormat === 'mjcf' && inspectionContext.mjcf?.tendons.length) {
    robot.userData.__mjcfTendonsData = inspectionContext.mjcf.tendons
      .filter((tendon) => tendon.type === 'spatial')
      .map((tendon) => ({
        name: tendon.name,
        rgba: tendon.rgba ? ([...tendon.rgba] as [number, number, number, number]) : undefined,
        attachmentRefs: [...tendon.attachmentRefs],
        attachments: tendon.attachments.map((attachment) => ({ ...attachment })),
        width: tendon.width,
      }));
  }

  const addGeometryGroup = (
    linkKey: string,
    linkTarget: URDFLink,
    geometry: RobotLink['visual'],
    runtimeKey: string,
    isCollision: boolean,
    objectIndex: number,
  ) => {
    const group = isCollision ? new URDFCollider() : new URDFVisual();
    const hasBoxFacePalette = !isCollision && getBoxFaceMaterialPalette(geometry).length > 0;
    const resolvedMaterialOverride =
      !isCollision && !hasBoxFacePalette
        ? resolveStateVisualMaterialOverride({
            geometry,
            isPrimaryVisual: objectIndex === 0,
            link: links[linkKey] ?? { id: linkKey, name: linkKey },
            materials,
          })
        : { override: null, isExplicit: false };
    const visualMaterialOverride =
      resolvedMaterialOverride.override ??
      (!isCollision && !hasBoxFacePalette
        ? resolveVisualMaterialOverrideFromGeometry(geometry)
        : null);
    const hasExplicitMaterialOverride =
      resolvedMaterialOverride.isExplicit ||
      Boolean(resolvedMaterialOverride.override) ||
      Boolean(visualMaterialOverride) ||
      (!resolvedMaterialOverride.override && hasExplicitGeometryMaterialOverride(geometry));
    group.name = runtimeKey;
    group.urdfName = runtimeKey;
    group.userData.runtimeKey = runtimeKey;
    group.userData.parentLinkId = linkKey;
    group.userData.displayName = runtimeKey;
    group.userData.geometryRole = isCollision ? 'collision' : 'visual';
    group.userData.geometryType = geometry.type;
    group.userData.geometryDimensions = { ...geometry.dimensions };
    if (geometry.name) {
      group.userData.geometryName = geometry.name;
    }

    applyOrigin(group, geometry.origin);
    applyMeshScale(group, geometry);
    const isRuntimeMeshAsset =
      geometry.type === GeometryType.MESH || geometry.type === GeometryType.SDF;

    const attachMeshObject = (object: THREE.Object3D): boolean => {
      if (!shouldAttachLoadedMeshObject(object, isCollision)) {
        return false;
      }

      // Apply SDF submesh filtering: extract only the named child node from
      // the loaded Collada scene when the geometry specifies one.
      let meshObject = object;
      if (geometry.submeshName) {
        const submesh = extractSubmesh(
          object,
          geometry.submeshName,
          geometry.submeshCenter === true,
        );
        if (submesh) {
          meshObject = submesh;
        } else {
          console.warn(
            `[EditorViewer] Submesh "${geometry.submeshName}" not found in "${geometry.meshPath}", using full mesh.`,
          );
        }
      }

      const effectiveVisualMaterialOverride =
        visualMaterialOverride ??
        (!isCollision && !hasBoxFacePalette && loadedObjectHasSingleMaterialSlot(meshObject)
          ? // A multi-material palette left `visualMaterialOverride` null, but this
            // mesh has a single material slot, so no slot mapping can happen and the
            // mesh would otherwise render with the loader's own material.
            resolvePrimaryAuthoredVisualMaterialOverride(geometry)
          : null);

      if (
        !isCollision &&
        effectiveVisualMaterialOverride &&
        (hasExplicitMaterialOverride || !loadedObjectShouldPreserveEmbeddedMaterials(meshObject))
      ) {
        applyVisualMaterialOverrideToObject(
          meshObject,
          effectiveVisualMaterialOverride,
          manager,
          visualMaterialOverrideCache,
        );
      }

      if (!isCollision && hasGeometryMeshMaterialGroups(geometry)) {
        applyVisualMeshMaterialGroupsToObject(meshObject, geometry, { manager });
      }

      applyVisualMaterialSidePolicy(meshObject, geometry, isCollision);
      group.add(applyRuntimeMeshAssetTransform(meshObject, geometry));
      if (group.parent && !isCollision) {
        restackLinkVisualRoots(group.parent);
      }
      return !isCollision;
    };

    if (isRuntimeMeshAsset && geometry.meshPath) {
      if (isImageAssetPath(geometry.meshPath)) {
        group.add(createImagePreviewMesh(geometry, manager, isCollision));
      } else {
        const completeVisualMeshLoad = isCollision ? null : visualRestackBatch.trackLoad();

        loadMeshCb(geometry.meshPath, manager, (object, error) => {
          let didAttachVisualMesh = false;

          try {
            if (error) {
              console.error('[EditorViewer] Failed to load mesh from robot state:', error);
            } else if (!object) {
              console.error(
                '[EditorViewer] Mesh loader completed without an object for robot state geometry:',
                geometry.meshPath,
              );
            }

            if (!object) {
              return;
            }
            didAttachVisualMesh = attachMeshObject(object);
          } finally {
            completeVisualMeshLoad?.(didAttachVisualMesh);
          }
        });
      }
    } else if (
      isRuntimeMeshAsset &&
      geometry.mjcfMesh?.vertices &&
      geometry.mjcfMesh.vertices.length >= 9
    ) {
      const inlineMesh = createInlineMJCFMeshObject({
        ...geometry.mjcfMesh,
        name: geometry.mjcfMesh.name || geometry.assetRef || geometry.name || 'mjcf_mesh',
      });
      if (inlineMesh) {
        attachMeshObject(inlineMesh);
      }
    } else if (geometry.type === GeometryType.HFIELD && geometry.sdfHeightmap) {
      const hfieldMesh = createHeightfieldMesh(geometry, isCollision, manager);
      if (hfieldMesh) {
        group.add(hfieldMesh);
      }
    } else if (geometry.type === GeometryType.POLYLINE) {
      const polylineMesh = createPolylineMesh(geometry, isCollision);
      if (polylineMesh) {
        group.add(polylineMesh);
      }
    } else {
      const primitiveMesh = createPrimitiveMesh(
        geometry,
        isCollision,
        manager,
        primitiveGeometryDetail,
      );
      if (primitiveMesh) {
        if (!isCollision && visualMaterialOverride) {
          applyVisualMaterialOverrideToObject(
            primitiveMesh,
            visualMaterialOverride,
            manager,
            visualMaterialOverrideCache,
          );
        }
        if (!isCollision && hasGeometryMeshMaterialGroups(geometry)) {
          applyVisualMeshMaterialGroupsToObject(primitiveMesh, geometry, { manager });
        }
        group.add(primitiveMesh);
      }

      // Add overlay meshes for multi-pass Gazebo materials (e.g. alpha-blended
      // texture layers like field marking lines on a grass carpet).
      if (!isCollision && geometry.type === GeometryType.PLANE) {
        const authoredMaterial = geometry.authoredMaterials?.[0];
        const overlayPasses =
          authoredMaterial?.passes?.filter(
            (pass) => pass.texture && pass.sceneBlend === 'alpha_blend',
          ) ?? [];

        for (const overlayPass of overlayPasses) {
          if (!overlayPass.texture) {
            continue;
          }

          const overlayMat = createMatteMaterial({
            color: '#ffffff',
            opacity: 1,
            transparent: true,
            preserveExactColor: true,
          });
          overlayMat.side = THREE.DoubleSide;
          overlayMat.depthWrite = false;
          overlayMat.polygonOffset = true;
          overlayMat.polygonOffsetFactor = -1;
          overlayMat.polygonOffsetUnits = -4;

          const dims = geometry.dimensions;
          const overlayMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), overlayMat);
          overlayMesh.scale.set(dims.x || 1, dims.y || 1, 1);
          overlayMesh.renderOrder = 1;
          group.add(overlayMesh);

          if (manager) {
            const loader = new THREE.TextureLoader(manager);
            loader.load(
              overlayPass.texture,
              (texture) => {
                texture.colorSpace = THREE.SRGBColorSpace;
                overlayMat.map = texture;
                overlayMat.needsUpdate = true;
              },
              undefined,
              (error) => {
                console.error(
                  '[EditorViewer] Failed to load multi-pass overlay texture:',
                  overlayPass.texture,
                  error,
                );
              },
            );
          }
        }
      }
    }

    linkTarget.add(group);

    if (isCollision) {
      colliderMap[runtimeKey] = group as URDFCollider;
      if (geometry.name?.trim()) {
        authoredColliderFrameMap[geometry.name.trim()] = group as URDFCollider;
      }
    } else {
      visualMap[runtimeKey] = group as URDFVisual;
      if (geometry.name?.trim()) {
        authoredVisualFrameMap[geometry.name.trim()] = group as URDFVisual;
      }
    }
  };

  for (const [linkId, linkData] of Object.entries(links)) {
    const linkKey = linkData.id || linkId;
    const linkTarget = new URDFLink();
    linkTarget.name = linkKey;
    linkTarget.urdfName = linkKey;
    linkTarget.userData.displayName = linkData.name || linkKey;
    linkTarget.userData.linkId = linkKey;
    if (linkData.mjcfSites?.length) {
      linkTarget.userData.__mjcfSitesData = linkData.mjcfSites.map((site) => {
        const clonedSite = { ...site };
        if (site.size) {
          clonedSite.size = [...site.size];
        }
        if (site.rgba) {
          clonedSite.rgba = [...site.rgba] as [number, number, number, number];
        }
        if (site.pos) {
          clonedSite.pos = [...site.pos] as [number, number, number];
        }
        if (site.quat) {
          clonedSite.quat = [...site.quat] as [number, number, number, number];
        }
        return clonedSite;
      });
    }
    linkMap[linkKey] = linkTarget;

    if (parseVisual) {
      const visualEntries = getVisualGeometryEntries(linkData);
      visualEntries.forEach((entry) => {
        addGeometryGroup(
          linkKey,
          linkTarget,
          entry.geometry,
          `${linkKey}::visual::${entry.objectIndex}`,
          false,
          entry.objectIndex,
        );
      });

      if (visualEntries.length > 0) {
        restackLinkVisualRoots(linkTarget);
      }
    }

    if (parseCollision) {
      const collisionEntries = getCollisionGeometryEntries(linkData);
      collisionEntries.forEach((entry) => {
        addGeometryGroup(
          linkKey,
          linkTarget,
          entry.geometry,
          `${linkKey}::collision::${entry.objectIndex}`,
          true,
          entry.objectIndex,
        );
      });
    }

    await yieldIfNeeded();
  }

  for (const [jointId, jointData] of Object.entries(joints)) {
    const jointKey = jointData.id || jointId;
    const jointDisplayName = jointData.name || jointKey;
    const joint = jointData.mimic ? new URDFMimicJoint() : new URDFJoint();
    joint.name = jointDisplayName;
    joint.urdfName = jointDisplayName;
    joint.userData.displayName = jointDisplayName;
    joint.userData.jointId = jointKey;
    joint.userData.originalJointType = jointData.type;
    if (typeof jointData.dynamics?.stiffness === 'number') {
      joint.userData.mjcfJointStiffness = jointData.dynamics.stiffness;
      Object.assign(
        joint.userData,
        resolveMjcfPassiveSpringJointMetadata({
          stiffness: jointData.dynamics.stiffness,
          hasActuator: !isUnactuatedJoint(jointData),
        }),
      );
    }
    joint.jointType = resolveRuntimeJointType(jointData.type);
    const hasFinitePositionLimits =
      Number.isFinite(jointData.limit?.lower) && Number.isFinite(jointData.limit?.upper);
    if (jointData.type === JointType.REVOLUTE || jointData.type === JointType.PRISMATIC) {
      joint.ignoreLimits = !hasFinitePositionLimits;
    }

    if (jointData.axis) {
      joint.axis = new THREE.Vector3(jointData.axis.x, jointData.axis.y, jointData.axis.z);
      if (joint.axis.lengthSq() > 0) {
        joint.axis.normalize();
      }
    }

    if (jointData.limit) {
      if (hasFinitePositionLimits) {
        const motionLimit = normalizeJointLimitOrder({
          lower: getJointMotionAngleFromActualAngle(jointData, Number(jointData.limit.lower)),
          upper: getJointMotionAngleFromActualAngle(jointData, Number(jointData.limit.upper)),
        });
        joint.limit.lower = motionLimit.lower;
        joint.limit.upper = motionLimit.upper;
      }
      joint.limit.effort = Number.isFinite(jointData.limit.effort)
        ? Number(jointData.limit.effort)
        : undefined;
      joint.limit.velocity = Number.isFinite(jointData.limit.velocity)
        ? Number(jointData.limit.velocity)
        : undefined;
    }

    if (joint instanceof URDFMimicJoint && jointData.mimic) {
      joint.mimicJoint = jointData.mimic.joint;
      joint.multiplier = jointData.mimic.multiplier ?? 1;
      joint.offset = jointData.mimic.offset ?? 0;
    }

    applyOrigin(joint, jointData.origin);
    attachBallJointQuaternionState(joint, jointData);
    if (
      jointData.type !== JointType.BALL &&
      typeof jointData.angle === 'number' &&
      Number.isFinite(jointData.angle)
    ) {
      const originalIgnoreLimits = joint.ignoreLimits;
      joint.ignoreLimits = true;
      joint.setJointValue(getJointMotionAngleFromActualAngle(jointData, jointData.angle));
      joint.ignoreLimits = originalIgnoreLimits;
    }
    jointMap[jointKey] = joint;
    await yieldIfNeeded();
  }

  for (const jointData of Object.values(joints)) {
    const jointKey = jointData.id || jointData.name;
    const joint = jointMap[jointKey];
    const parentLink = linkMap[jointData.parentLinkId];
    const childLink = linkMap[jointData.childLinkId];
    if (!joint || !parentLink || !childLink) {
      continue;
    }

    parentLink.add(joint);
    joint.add(childLink);
    (joint as URDFJoint & { child?: URDFLink; parentLink?: URDFLink }).child = childLink;
    (joint as URDFJoint & { child?: URDFLink; parentLink?: URDFLink }).parentLink = parentLink;
    await yieldIfNeeded();
  }

  const childLinkIds = new Set(Object.values(joints).map((joint) => joint.childLinkId));
  const rootCandidates: string[] = [];
  if (rootLinkId && linkMap[rootLinkId]) {
    rootCandidates.push(rootLinkId);
  }

  Object.keys(linkMap).forEach((linkKey) => {
    if (!childLinkIds.has(linkKey) && !rootCandidates.includes(linkKey)) {
      rootCandidates.push(linkKey);
    }
  });

  rootCandidates.forEach((linkKey) => {
    const link = linkMap[linkKey];
    if (link && link.parent !== robot) {
      robot.add(link);
    }
  });

  Object.values(jointMap).forEach((joint) => {
    if (joint instanceof URDFMimicJoint && joint.mimicJoint) {
      const mimickedJoint = jointMap[joint.mimicJoint];
      if (mimickedJoint) {
        mimickedJoint.mimicJoints.push(joint);
      }
    }
  });

  Object.values(jointMap).forEach((joint) => {
    const uniqueJoints = new Set<URDFJoint>();
    const walk = (currentJoint: URDFJoint) => {
      if (uniqueJoints.has(currentJoint)) {
        throw new Error('URDFLoader: Detected an infinite loop of mimic joints.');
      }

      uniqueJoints.add(currentJoint);
      currentJoint.mimicJoints.forEach((mimicJoint) => walk(mimicJoint));
    };

    walk(joint);
  });

  robot.links = linkMap;
  robot.joints = jointMap;
  robot.colliders = colliderMap;
  robot.visual = visualMap;
  robot.visuals = visualMap;
  robot.frames = {
    ...colliderMap,
    ...authoredColliderFrameMap,
    ...visualMap,
    ...authoredVisualFrameMap,
    ...linkMap,
    ...jointMap,
  };

  visualRestackBatch.markHierarchyReady();
  restackRobotVisualRoots(robot);
  visualRestackBatch.resetAfterImmediateRestack();
  visualRestackBatch.flush();
  return robot;
}
