/**
 * MJCF (MuJoCo XML) Parser
 * Parses MuJoCo XML format and converts to RobotState
 */

import {
  RobotState,
  UrdfLink,
  UrdfJoint,
  DEFAULT_LINK,
  DEFAULT_JOINT,
  GeometryType,
  JointType,
  UrdfMjcfSite,
  UrdfVisual,
} from '@/types';
import {
  looksLikeMJCFDocument,
  type MJCFHfield,
  type MJCFMaterial,
  type MJCFMesh,
  type MJCFTexture,
} from './mjcfUtils';
import { assignMJCFBodyGeomRoles, classifyMJCFGeom } from './mjcfGeomClassification';
import { buildCanonicalMjcfAuthoredMaterials } from './mjcfCanonicalMaterials';
import { buildClosedLoopConstraints } from './mjcfClosedLoops';
import { createEmptyLinkInertial, deriveGeomMassInertial } from './mjcfInertial';
import { applyInitialPoseKeyframe } from './mjcfKeyframePose';
import {
  canonicalizeMjcfFromToGeom,
  isNonZeroPosition,
  rotateLocalOffsetToParentFrame,
  subtractLocalOffset,
  toRPYObjectFromQuat,
} from './mjcfMath';
import {
  clearParsedMJCFModelCache,
  normalizeMultiJointBodies,
  parseMJCFModel,
  type ParsedMJCFModel,
} from './mjcfModel';
import {
  MJCFBody,
  MJCFGeom,
  MJCFLinkPair,
  MJCFActuator,
  buildHfieldDimensions,
  cloneMjcfMeshAsset,
  convertJointType,
  convertGeomType,
  shouldPreserveSyntheticWorldRoot,
  resolveJointMechanicalRange,
  resolveJointEffortLimit,
  buildImportedJointLimit,
  resolveJointInitialAngle,
  rgbaToHexColor,
  rgbaToColorRgbaTuple,
  toParserBody,
  toParserActuatorMap,
  applyJointEqualityMimics,
  applySolvedClosedLoopInitialPose,
  refreshClosedLoopAnchorWorlds,
  buildMjcfInspectionContext,
} from './mjcfParserUtils';
import { attachParserRecoveryDiagnostics } from '@/core/parsers/recoveryDiagnostics';

// Convert parsed MJCF to RobotState
function mjcfToRobotState(
  robotName: string,
  bodies: MJCFBody[],
  meshMap: Map<string, MJCFMesh>,
  hfieldMap: Map<string, MJCFHfield>,
  materialMap: Map<string, MJCFMaterial>,
  textureMap: Map<string, MJCFTexture>,
  actuatorMap: Map<string, MJCFActuator[]>,
): RobotState {
  const links: Record<string, UrdfLink> = {};
  const joints: Record<string, UrdfJoint> = {};
  const materials: NonNullable<RobotState['materials']> = {};
  let rootLinkId = '';
  let linkCounter = 0;

  function resolveGeomMaterialState(
    geom: MJCFGeom,
  ): { color?: string; colorRgba?: [number, number, number, number]; texture?: string } | null {
    const materialDef = geom.material ? materialMap.get(geom.material) : undefined;
    const texturePath = materialDef?.texture
      ? textureMap.get(materialDef.texture)?.file
      : undefined;

    const explicitGeomRgba =
      geom.hasExplicitRgba && geom.rgba && geom.rgba.length >= 3 ? geom.rgba : undefined;
    const materialRgba =
      materialDef?.rgba && materialDef.rgba.length >= 3 ? materialDef.rgba : undefined;
    const inheritedGeomRgba = geom.rgba && geom.rgba.length >= 3 ? geom.rgba : undefined;
    const resolvedRgba = explicitGeomRgba ?? materialRgba ?? inheritedGeomRgba;
    const resolvedColor = resolvedRgba ? rgbaToHexColor(resolvedRgba) || undefined : undefined;
    const resolvedColorRgba = rgbaToColorRgbaTuple(resolvedRgba);

    // MJCF textures use white as the neutral color multiplier when rgba is absent.
    const neutralTextureColor = texturePath ? '#ffffff' : undefined;
    const color = resolvedColor ?? neutralTextureColor;

    if (!color && !texturePath) {
      return null;
    }

    return {
      ...(color ? { color } : {}),
      ...(resolvedColorRgba ? { colorRgba: resolvedColorRgba } : {}),
      ...(texturePath ? { texture: texturePath } : {}),
    };
  }

  function resolveGeomAuthoredMaterials(geom: MJCFGeom): UrdfVisual['authoredMaterials'] {
    const materialDef = geom.material ? materialMap.get(geom.material) : undefined;
    const textureDef = materialDef?.texture ? textureMap.get(materialDef.texture) : undefined;

    const explicitGeomRgba =
      geom.hasExplicitRgba && geom.rgba && geom.rgba.length >= 3 ? geom.rgba : undefined;
    const materialRgba =
      materialDef?.rgba && materialDef.rgba.length >= 3 ? materialDef.rgba : undefined;
    const inheritedGeomRgba = geom.rgba && geom.rgba.length >= 3 ? geom.rgba : undefined;
    const resolvedRgba = explicitGeomRgba ?? materialRgba ?? inheritedGeomRgba;
    const sharedColor = resolvedRgba ? rgbaToHexColor(resolvedRgba) || undefined : undefined;
    const sharedColorRgba = rgbaToColorRgbaTuple(resolvedRgba);

    return buildCanonicalMjcfAuthoredMaterials({
      geomType: geom.type,
      materialName: geom.material,
      material: materialDef,
      sharedColor,
      sharedColorRgba,
      texture: textureDef,
    });
  }

  function assignLinkMaterial(linkId: string, geom: MJCFGeom | null | undefined): void {
    if (!geom) {
      return;
    }

    const materialState = resolveGeomMaterialState(geom);
    if (!materialState) {
      return;
    }

    materials[linkId] = materialState;
  }

  function buildImplicitFixedJointId(parentLinkId: string, childLinkId: string): string {
    const baseId = `${parentLinkId}_to_${childLinkId}`;
    let candidate = baseId;
    let suffix = 2;

    while (joints[candidate]) {
      candidate = `${baseId}_${suffix++}`;
    }

    return candidate;
  }

  function processGeometry(
    geom: MJCFGeom,
    linkFrameOffsetLocal: { x: number; y: number; z: number } | null = null,
  ): UrdfVisual {
    const result: UrdfVisual = { ...DEFAULT_LINK.visual };
    const canonicalFromTo = canonicalizeMjcfFromToGeom(geom);
    const effectiveSize = canonicalFromTo?.size ?? geom.size;
    const effectivePosition = canonicalFromTo
      ? {
          x: canonicalFromTo.pos[0],
          y: canonicalFromTo.pos[1],
          z: canonicalFromTo.pos[2],
        }
      : geom.pos;
    const effectiveQuaternion = canonicalFromTo
      ? {
          w: canonicalFromTo.quat[0],
          x: canonicalFromTo.quat[1],
          y: canonicalFromTo.quat[2],
          z: canonicalFromTo.quat[3],
        }
      : geom.quat;
    if (geom.name?.trim()) {
      result.name = geom.name.trim();
    }
    const convertedType = convertGeomType(geom.type);
    const hasExplicitPrimitiveParams = Boolean(
      (geom.size && geom.size.length > 0) || (geom.fromto && geom.fromto.length >= 6),
    );
    const isMeshBackedPrimitiveWithoutResolvedFit = Boolean(
      geom.mesh &&
      !hasExplicitPrimitiveParams &&
      (convertedType === GeometryType.BOX ||
        convertedType === GeometryType.SPHERE ||
        convertedType === GeometryType.PLANE ||
        convertedType === GeometryType.ELLIPSOID ||
        convertedType === GeometryType.CYLINDER ||
        convertedType === GeometryType.CAPSULE),
    );
    result.type =
      convertedType === GeometryType.NONE && geom.mesh
        ? GeometryType.MESH
        : isMeshBackedPrimitiveWithoutResolvedFit
          ? GeometryType.MESH
          : convertedType;

    if (geom.mesh && meshMap.has(geom.mesh)) {
      const meshDef = meshMap.get(geom.mesh)!;
      result.mjcfMesh = cloneMjcfMeshAsset(meshDef);
      if (meshDef.file) {
        result.meshPath = meshDef.file;
      } else {
        result.assetRef = geom.mesh;
      }
      const scale = meshDef.scale;
      if (scale && scale.length >= 3) {
        result.dimensions = { x: scale[0], y: scale[1], z: scale[2] };
      } else {
        result.dimensions = { x: 1, y: 1, z: 1 };
      }
    } else if (geom.mesh) {
      result.meshPath = geom.mesh;
      result.dimensions = { x: 1, y: 1, z: 1 };
    }

    if (result.type === GeometryType.HFIELD) {
      result.assetRef = geom.hfield;
      const hfieldAsset = geom.hfield ? hfieldMap.get(geom.hfield) : undefined;
      if (hfieldAsset) {
        result.mjcfHfield = {
          name: hfieldAsset.name,
          file: hfieldAsset.file,
          contentType: hfieldAsset.contentType,
          nrow: hfieldAsset.nrow,
          ncol: hfieldAsset.ncol,
          size: hfieldAsset.size
            ? {
                radiusX: hfieldAsset.size[0] ?? 0,
                radiusY: hfieldAsset.size[1] ?? 0,
                elevationZ: hfieldAsset.size[2] ?? 0,
                baseZ: hfieldAsset.size[3] ?? 0,
              }
            : undefined,
          elevation: hfieldAsset.elevation ? [...hfieldAsset.elevation] : undefined,
        };
      }
    } else if (result.type === GeometryType.SDF) {
      result.assetRef = geom.mesh;
    }

    if (effectiveSize && effectiveSize.length > 0) {
      const geomType = geom.type?.toLowerCase() || 'sphere';
      switch (geomType) {
        case 'box':
          result.dimensions = {
            x: (effectiveSize[0] || 0.1) * 2,
            y: ((effectiveSize[1] ?? effectiveSize[0]) || 0.1) * 2,
            z: ((effectiveSize[2] ?? effectiveSize[0]) || 0.1) * 2,
          };
          break;
        case 'sphere':
          result.dimensions = { x: effectiveSize[0] || 0.1, y: 0, z: 0 };
          break;
        case 'plane':
          result.dimensions = {
            x: ((effectiveSize[0] ?? 1) || 1) * 2,
            y: ((effectiveSize[1] ?? effectiveSize[0] ?? 1) || 1) * 2,
            z: 0,
          };
          break;
        case 'ellipsoid':
          result.dimensions = {
            x: effectiveSize[0] || 0.1,
            y: (effectiveSize[1] ?? effectiveSize[0]) || 0.1,
            z: (effectiveSize[2] ?? effectiveSize[0]) || 0.1,
          };
          break;
        case 'cylinder':
        case 'capsule':
          result.dimensions = {
            x: effectiveSize[0] || 0.1,
            y: (effectiveSize[1] || 0.1) * 2,
            z: 0,
          };
          break;
        case 'hfield':
          result.dimensions = buildHfieldDimensions(
            geom.hfield ? hfieldMap.get(geom.hfield) : undefined,
            effectiveSize,
          );
          break;
        case 'sdf':
          result.dimensions = {
            x: effectiveSize[0] || 1,
            y: (effectiveSize[1] ?? effectiveSize[0]) || 1,
            z: (effectiveSize[2] ?? 0) || 0,
          };
          break;
        default:
          result.dimensions = { x: effectiveSize[0] || 0.1, y: 0, z: 0 };
          break;
      }
    } else if (!geom.mesh) {
      switch (result.type) {
        case GeometryType.PLANE:
          result.dimensions = { x: 2, y: 2, z: 0 };
          break;
        case GeometryType.HFIELD:
          result.dimensions = buildHfieldDimensions(
            geom.hfield ? hfieldMap.get(geom.hfield) : undefined,
            geom.size,
          );
          break;
        case GeometryType.SDF:
          result.dimensions = { x: 1, y: 1, z: 0 };
          break;
        default:
          result.dimensions = { x: 0.05, y: 0, z: 0 };
          break;
      }
    }

    const materialState = resolveGeomMaterialState(geom);
    if (materialState?.color) {
      result.color = materialState.color;
    }
    const authoredMaterials = resolveGeomAuthoredMaterials(geom);
    if (authoredMaterials && authoredMaterials.length > 0) {
      result.authoredMaterials = authoredMaterials;
    }

    const geomRotation = toRPYObjectFromQuat(effectiveQuaternion);
    const hasMeaningfulRotation =
      !!geomRotation &&
      (Math.abs(geomRotation.r) > 1e-9 ||
        Math.abs(geomRotation.p) > 1e-9 ||
        Math.abs(geomRotation.y) > 1e-9);
    const geomPosition = subtractLocalOffset(effectivePosition, linkFrameOffsetLocal);

    if (geomPosition || hasMeaningfulRotation) {
      result.origin = {
        xyz: {
          x: geomPosition?.x ?? 0,
          y: geomPosition?.y ?? 0,
          z: geomPosition?.z ?? 0,
        },
        rpy: geomRotation || { r: 0, p: 0, y: 0 },
      };
    }

    return result;
  }

  function processBody(body: MJCFBody, parentLinkId: string | null): string {
    const mainLinkId = body.name || `link_${linkCounter++}`;
    const bodyRotation = toRPYObjectFromQuat(body.quat) || body.euler || { r: 0, p: 0, y: 0 };
    const mjcfJoint = body.joints[0];
    const linkFrameOffsetLocal = isNonZeroPosition(mjcfJoint?.pos)
      ? {
          x: mjcfJoint!.pos!.x,
          y: mjcfJoint!.pos!.y,
          z: mjcfJoint!.pos!.z,
        }
      : null;
    const jointFrameOffsetInParent = rotateLocalOffsetToParentFrame(
      linkFrameOffsetLocal,
      bodyRotation,
    );

    // 1. Classify Geoms
    const visuals: MJCFGeom[] = [];
    const collisions: MJCFGeom[] = [];
    const geomRoles = assignMJCFBodyGeomRoles(body.geoms);

    geomRoles.forEach(({ geom, renderVisual, renderCollision }) => {
      if (renderVisual) {
        visuals.push(geom);
      }
      if (renderCollision) {
        collisions.push(geom);
      }
    });

    // 2. Pair Visuals and Collisions
    const pairs: MJCFLinkPair[] = [];
    const usedCollisions = new Set<MJCFGeom>();

    // Pass 1: Match visuals to collisions (by mesh name match)
    for (const vis of visuals) {
      // Plain MuJoCo geoms often act as both visual and collision. Once such a geom has
      // already been consumed as the collision partner for an earlier visual geom, emitting
      // it again as a standalone visual creates the exact regression seen on HighTorque:
      // a base-link collision box gets duplicated into the visual tree.
      const visClassification = classifyMJCFGeom(vis);
      if (visClassification.isCollision && usedCollisions.has(vis)) {
        continue;
      }

      let matchIndex = -1;
      const visualMeshKey = vis.mesh || vis.fittedFromMesh;
      if (visualMeshKey) {
        matchIndex = collisions.findIndex(
          (collision) =>
            (collision.mesh || collision.fittedFromMesh) === visualMeshKey &&
            !usedCollisions.has(collision),
        );
      } else if (vis.name) {
        matchIndex = collisions.findIndex((c) => c.name === vis.name && !usedCollisions.has(c));
      }

      // Fallback for Main Link (index 0): if no strict match, grab first available collision
      // Only if this is the very first visual we are processing for the body
      if (
        matchIndex === -1 &&
        pairs.length === 0 &&
        collisions.length > 0 &&
        !usedCollisions.has(collisions[0])
      ) {
        // Check if collision[0] is also nameless/meshless or generically compatible?
        // For G1: torso (mesh) matches torso (mesh).
        // For simple models, often 1 vis 1 col.
        matchIndex = 0;
      }

      let col: MJCFGeom | null = null;
      if (matchIndex !== -1) {
        col = collisions[matchIndex];
        usedCollisions.add(col);
      }
      pairs.push({ visual: vis, collision: col });
    }

    // Pass 2: Remaining collisions (create collision-only links)
    for (const col of collisions) {
      if (!usedCollisions.has(col)) {
        pairs.push({ visual: null, collision: col });
      }
    }

    // 3. Create Links
    // If no pairs (empty body), create a dummy pair to generate the link
    if (pairs.length === 0) {
      pairs.push({ visual: null, collision: null });
    }

    // Process Main Link (Index 0)
    const mainPair = pairs[0];

    let visual: UrdfVisual = { ...DEFAULT_LINK.visual };
    if (mainPair.visual) {
      visual = processGeometry(mainPair.visual, linkFrameOffsetLocal);
      assignLinkMaterial(mainLinkId, mainPair.visual);
    } else {
      visual.type = GeometryType.NONE;
    }

    let collision: UrdfVisual = { ...DEFAULT_LINK.collision };
    if (mainPair.collision) {
      const colGeo = processGeometry(mainPair.collision, linkFrameOffsetLocal);
      collision = {
        ...collision,
        ...(mainPair.collision.name?.trim() ? { name: mainPair.collision.name.trim() } : {}),
        type: colGeo.type,
        dimensions: colGeo.dimensions,
        origin: colGeo.origin,
        meshPath: colGeo.meshPath,
        assetRef: colGeo.assetRef,
        mjcfMesh: colGeo.mjcfMesh,
        mjcfHfield: colGeo.mjcfHfield,
      };
      if (colGeo.color) {
        collision.color = colGeo.color;
      }
    } else {
      collision.type = GeometryType.NONE;
    }

    let linkInertial = createEmptyLinkInertial();

    if (body.inertial) {
      const {
        mass,
        pos: inertialPos,
        quat: inertialQuat,
        diaginertia,
        fullinertia,
      } = body.inertial;
      const linkInertialPos = subtractLocalOffset(inertialPos, linkFrameOffsetLocal) || {
        x: 0,
        y: 0,
        z: 0,
      };
      linkInertial.mass = mass;
      linkInertial.origin = {
        xyz: { x: linkInertialPos.x, y: linkInertialPos.y, z: linkInertialPos.z },
        rpy: toRPYObjectFromQuat(inertialQuat) || { r: 0, p: 0, y: 0 },
      };
      if (fullinertia && fullinertia.length >= 6) {
        linkInertial.inertia = {
          ixx: fullinertia[0],
          iyy: fullinertia[1],
          izz: fullinertia[2],
          ixy: fullinertia[3],
          ixz: fullinertia[4],
          iyz: fullinertia[5],
        };
      } else if (diaginertia) {
        linkInertial.inertia = {
          ixx: diaginertia.ixx,
          ixy: 0,
          ixz: 0,
          iyy: diaginertia.iyy,
          iyz: 0,
          izz: diaginertia.izz,
        };
      }
    } else {
      const derivedGeomMassInertial = deriveGeomMassInertial(body.geoms);
      if (derivedGeomMassInertial) {
        if (linkFrameOffsetLocal && derivedGeomMassInertial.origin) {
          derivedGeomMassInertial.origin.xyz = subtractLocalOffset(
            derivedGeomMassInertial.origin.xyz,
            linkFrameOffsetLocal,
          ) || { x: 0, y: 0, z: 0 };
        }
        linkInertial = derivedGeomMassInertial;
      }
    }

    const mjcfSites = (body.sites || []).map((site): UrdfMjcfSite => {
      const rebasedPosition = subtractLocalOffset(site.pos, linkFrameOffsetLocal);

      return {
        name: site.name,
        ...(site.sourceName ? { sourceName: site.sourceName } : {}),
        type: site.type,
        ...(Array.isArray(site.size) ? { size: [...site.size] } : {}),
        ...(Array.isArray(site.rgba)
          ? { rgba: [...site.rgba] as [number, number, number, number] }
          : {}),
        ...(rebasedPosition
          ? {
              pos: [rebasedPosition.x, rebasedPosition.y, rebasedPosition.z] as [
                number,
                number,
                number,
              ],
            }
          : {}),
        ...(site.quat
          ? {
              quat: [site.quat.w, site.quat.x, site.quat.y, site.quat.z] as [
                number,
                number,
                number,
                number,
              ],
            }
          : {}),
        ...(typeof site.group === 'number' ? { group: site.group } : {}),
      };
    });

    const mainLink: UrdfLink = {
      ...DEFAULT_LINK,
      id: mainLinkId,
      name: body.name,
      visual,
      collision,
      inertial: linkInertial,
      ...(mjcfSites.length > 0 ? { mjcfSites } : {}),
    };
    links[mainLinkId] = mainLink;

    // Create Main Joint
    if (parentLinkId) {
      const jointId = mjcfJoint?.name || buildImplicitFixedJointId(parentLinkId, mainLinkId);
      const jointType = mjcfJoint
        ? convertJointType(mjcfJoint.type, mjcfJoint.range, mjcfJoint.limited)
        : JointType.FIXED;
      const jointMechanicalRange = resolveJointMechanicalRange(mjcfJoint, jointType);
      const jointEffort = resolveJointEffortLimit(mjcfJoint, actuatorMap.get(jointId));
      const jointLimit = buildImportedJointLimit(jointType, jointMechanicalRange, jointEffort);
      const jointInitialAngle = resolveJointInitialAngle(mjcfJoint, jointType);
      const jointOrigin = {
        xyz: {
          x: body.pos.x + (jointFrameOffsetInParent?.x ?? 0),
          y: body.pos.y + (jointFrameOffsetInParent?.y ?? 0),
          z: body.pos.z + (jointFrameOffsetInParent?.z ?? 0),
        },
        rpy: bodyRotation,
      };
      const joint: UrdfJoint = {
        ...DEFAULT_JOINT,
        id: jointId,
        name: jointId,
        type: jointType,
        parentLinkId: parentLinkId,
        childLinkId: mainLinkId,
        origin: jointOrigin,
        axis: mjcfJoint?.axis || { x: 0, y: 0, z: 1 },
        limit: jointLimit,
        dynamics: {
          ...DEFAULT_JOINT.dynamics,
          damping: mjcfJoint?.damping ?? DEFAULT_JOINT.dynamics.damping,
          friction: mjcfJoint?.frictionloss ?? DEFAULT_JOINT.dynamics.friction,
          ...(typeof mjcfJoint?.stiffness === 'number' ? { stiffness: mjcfJoint.stiffness } : {}),
        },
        ...(jointInitialAngle != null ? { referencePosition: jointInitialAngle } : {}),
        ...(jointInitialAngle != null ? { angle: jointInitialAngle } : {}),
        hardware: {
          ...DEFAULT_JOINT.hardware,
          armature: mjcfJoint?.armature ?? DEFAULT_JOINT.hardware.armature,
        },
      };
      joints[jointId] = joint;
    } else {
      rootLinkId = mainLinkId;
    }

    // Process remaining pairs (Pairs 1..N)
    for (let i = 1; i < pairs.length; i++) {
      const pair = pairs[i];

      // Preserve additional collision-only geoms on the same link. The rest of the stack
      // already understands `collisionBodies`, so emitting synthetic links here only makes
      // URDF exports drift away from the source MJCF topology.
      if (!pair.visual && pair.collision) {
        const colGeo = processGeometry(pair.collision, linkFrameOffsetLocal);
        const extraCollision: UrdfLink['collision'] = {
          ...DEFAULT_LINK.collision,
          ...(pair.collision.name?.trim() ? { name: pair.collision.name.trim() } : {}),
          type: colGeo.type,
          dimensions: colGeo.dimensions,
          origin: colGeo.origin,
          meshPath: colGeo.meshPath,
          assetRef: colGeo.assetRef,
          mjcfMesh: colGeo.mjcfMesh,
          mjcfHfield: colGeo.mjcfHfield,
        };

        if (colGeo.color) {
          extraCollision.color = colGeo.color;
        }

        mainLink.collisionBodies = [...(mainLink.collisionBodies || []), extraCollision];
        continue;
      }

      if (pair.visual) {
        const extraVisual = processGeometry(pair.visual, linkFrameOffsetLocal);
        mainLink.visualBodies = [...(mainLink.visualBodies || []), extraVisual];
      }

      if (pair.collision) {
        const colGeo = processGeometry(pair.collision, linkFrameOffsetLocal);
        const extraCollision: UrdfLink['collision'] = {
          ...DEFAULT_LINK.collision,
          ...(pair.collision.name?.trim() ? { name: pair.collision.name.trim() } : {}),
          type: colGeo.type,
          dimensions: colGeo.dimensions,
          origin: colGeo.origin,
          meshPath: colGeo.meshPath,
          assetRef: colGeo.assetRef,
          mjcfMesh: colGeo.mjcfMesh,
          mjcfHfield: colGeo.mjcfHfield,
        };
        if (colGeo.color) {
          extraCollision.color = colGeo.color;
        }

        mainLink.collisionBodies = [...(mainLink.collisionBodies || []), extraCollision];
      }
    }

    body.children.forEach((child) => processBody(child, mainLinkId));
    return mainLinkId;
  }

  bodies.forEach((body, index) => {
    const linkId = processBody(body, index === 0 ? null : rootLinkId);
    if (index === 0) rootLinkId = linkId;
  });

  if (!rootLinkId) {
    rootLinkId = 'base_link';
    links[rootLinkId] = { ...DEFAULT_LINK, id: rootLinkId, name: 'base_link' };
  }

  return {
    name: robotName,
    links,
    joints,
    rootLinkId,
    ...(Object.keys(materials).length > 0 ? { materials } : {}),
    selection: { type: 'link', id: rootLinkId },
  };
}

/** Convert an already-prepared MJCF model into canonical RobotState. */
export function convertParsedMJCFModelToRobotState(parsedModel: ParsedMJCFModel): RobotState {
  const parserModelWorldBody = normalizeMultiJointBodies(parsedModel.worldBody);
  const worldBody = toParserBody(parserModelWorldBody, parsedModel.compilerSettings);
  const rootBodies = shouldPreserveSyntheticWorldRoot(worldBody)
    ? [worldBody]
    : worldBody.children;

  const robot = mjcfToRobotState(
    parsedModel.modelName,
    rootBodies,
    parsedModel.meshMap,
    parsedModel.hfieldMap,
    parsedModel.materialMap,
    parsedModel.textureMap,
    toParserActuatorMap(parsedModel.actuatorMap),
  );

  applyJointEqualityMimics(robot, parsedModel.jointEqualityConstraints);
  robot.closedLoopConstraints = buildClosedLoopConstraints(
    robot,
    parsedModel.connectConstraints,
    parsedModel.tendonMap,
    parserModelWorldBody,
  );
  applyInitialPoseKeyframe(robot, worldBody, parsedModel.keyframes);
  applySolvedClosedLoopInitialPose(robot, parsedModel.actuatorMap);
  refreshClosedLoopAnchorWorlds(robot);
  robot.inspectionContext = buildMjcfInspectionContext(parsedModel);
  return attachParserRecoveryDiagnostics(robot, parsedModel.recoveryDiagnostics);
}

export function parseMJCF(xmlContent: string): RobotState | null {
  try {
    const parsedModel = parseMJCFModel(xmlContent);
    return parsedModel ? convertParsedMJCFModelToRobotState(parsedModel) : null;
  } catch (error) {
    console.warn('[MJCFParser] Failed to parse MJCF:', error);
    return null;
  } finally {
    // The parsed model cache is only needed within a single top-level parse
    // call; retaining entire MJCF model trees across file switches keeps
    // old robots alive in memory for no runtime benefit.
    clearParsedMJCFModelCache(xmlContent);
  }
}

export function isMJCF(xmlContent: string): boolean {
  return looksLikeMJCFDocument(xmlContent);
}
