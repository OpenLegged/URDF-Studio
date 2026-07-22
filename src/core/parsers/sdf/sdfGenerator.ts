import * as THREE from 'three';

import {
  computeLinkWorldMatrices,
  getCollisionGeometryEntries,
  getVisualGeometryEntries,
  resolveJointKey,
  resolveVisualMaterialOverride,
} from '@/core/robot';
import {
  MAX_GEOMETRY_DIMENSION_DECIMALS,
  MAX_PROPERTY_DECIMALS,
  formatNumberWithMaxDecimals,
} from '@/core/utils/numberPrecision';
import {
  GeometryType,
  JointType,
  type RobotClosedLoopConstraint,
  type RobotState,
  type UrdfJoint,
  type UrdfLink,
  type UrdfVisual,
  type Vector3,
} from '@/types';
import { normalizeMeshPathForExport, normalizeTexturePathForExport } from '../meshPathUtils';

export interface GenerateSDFOptions {
  packageName?: string;
  version?: string;
}

type Pose = {
  xyz: Vector3;
  rpy: { r: number; p: number; y: number };
};

type SdfMaterialState = {
  color?: string;
  colorRgba?: [number, number, number, number];
  texture?: string;
};

const AXIS_EXPORT_TYPES = new Set<JointType>([
  JointType.REVOLUTE,
  JointType.CONTINUOUS,
  JointType.PRISMATIC,
  JointType.PLANAR,
]);

const LIMIT_EXPORT_TYPES = new Set<JointType>([
  JointType.REVOLUTE,
  JointType.CONTINUOUS,
  JointType.PRISMATIC,
]);

const DYNAMICS_EXPORT_TYPES = new Set<JointType>([
  JointType.REVOLUTE,
  JointType.CONTINUOUS,
  JointType.PRISMATIC,
]);

const formatScalar = (value: number) => formatNumberWithMaxDecimals(value, MAX_PROPERTY_DECIMALS);
const formatShape = (value: number) =>
  formatNumberWithMaxDecimals(value, MAX_GEOMETRY_DIMENSION_DECIMALS);

function escapeXml(value: string): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function isExternalAssetPath(path: string): boolean {
  return /^(?:blob:|https?:\/\/|data:)/i.test(path);
}

function matrixToPose(matrix: THREE.Matrix4): Pose {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);
  const euler = new THREE.Euler(0, 0, 0, 'ZYX').setFromQuaternion(quaternion);

  return {
    xyz: { x: position.x, y: position.y, z: position.z },
    rpy: { r: euler.x, p: euler.y, y: euler.z },
  };
}

function isIdentityPose(pose: Pose, epsilon = 1e-9): boolean {
  return (
    Math.abs(pose.xyz.x) <= epsilon &&
    Math.abs(pose.xyz.y) <= epsilon &&
    Math.abs(pose.xyz.z) <= epsilon &&
    Math.abs(pose.rpy.r) <= epsilon &&
    Math.abs(pose.rpy.p) <= epsilon &&
    Math.abs(pose.rpy.y) <= epsilon
  );
}

function formatPose(pose: Pose): string {
  return [
    formatScalar(pose.xyz.x),
    formatScalar(pose.xyz.y),
    formatScalar(pose.xyz.z),
    formatScalar(pose.rpy.r),
    formatScalar(pose.rpy.p),
    formatScalar(pose.rpy.y),
  ].join(' ');
}

function hexToRgba(hex?: string): string | null {
  const normalized = String(hex || '').trim();
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})?$/i.exec(normalized);
  if (!result) {
    return null;
  }

  const serializeChannel = (channelHex: string) => {
    const channel = Number.parseInt(channelHex, 16);
    return Math.min(1, (channel + 1e-3) / 255).toFixed(8);
  };

  const r = serializeChannel(result[1]);
  const g = serializeChannel(result[2]);
  const b = serializeChannel(result[3]);
  const a = result[4] ? serializeChannel(result[4]) : '1.00000000';
  return `${r} ${g} ${b} ${a}`;
}

function colorRgbaToSdfText(colorRgba?: [number, number, number, number]): string | null {
  if (
    !Array.isArray(colorRgba) ||
    colorRgba.length !== 4 ||
    !colorRgba.every((value) => Number.isFinite(value))
  ) {
    return null;
  }

  return colorRgba.map((value) => Math.min(1, Math.max(0, Number(value))).toFixed(8)).join(' ');
}

function resolveVisualMaterialState(
  robot: RobotState,
  link: UrdfLink,
  visual: UrdfVisual,
  isPrimaryVisual: boolean,
): SdfMaterialState {
  const resolvedMaterial = resolveVisualMaterialOverride(robot, link, visual, {
    isPrimaryVisual,
  });

  if (resolvedMaterial.source === 'authored' || resolvedMaterial.source === 'legacy-link') {
    const colorRgba = resolvedMaterial.colorRgba;
    const texture = resolvedMaterial.texture;
    return {
      color:
        resolvedMaterial.color ||
        (colorRgba ? undefined : texture ? '#ffffff' : undefined) ||
        (colorRgba ? undefined : visual.color) ||
        undefined,
      colorRgba,
      texture,
    };
  }

  const inlineAuthoredMaterial = visual.authoredMaterials?.find(
    (material) => material.color || material.colorRgba || material.texture,
  );
  const inlineColorRgba = inlineAuthoredMaterial?.colorRgba;
  return {
    color:
      inlineAuthoredMaterial?.color ||
      (inlineColorRgba
        ? undefined
        : visual.color || (inlineAuthoredMaterial?.texture ? '#ffffff' : undefined)) ||
      undefined,
    colorRgba: inlineColorRgba,
    texture: inlineAuthoredMaterial?.texture,
  };
}

function buildMeshUri(meshPath: string, packageName: string): string {
  if (isExternalAssetPath(meshPath)) {
    return meshPath;
  }

  const exportPath = normalizeMeshPathForExport(meshPath) || meshPath.replace(/\\/g, '/');
  return `model://${packageName}/meshes/${exportPath}`;
}

function generateBoxGeometryXml(dimensions: Vector3): string {
  return [
    '        <geometry>',
    '          <box>',
    `            <size>${formatShape(dimensions.x)} ${formatShape(dimensions.y)} ${formatShape(dimensions.z)}</size>`,
    '          </box>',
    '        </geometry>',
  ].join('\n');
}

function generatePlaneGeometryXml(geometry: UrdfVisual): string {
  return [
    '        <geometry>',
    '          <plane>',
    '            <normal>0 0 1</normal>',
    `            <size>${formatShape(geometry.dimensions.x || 1)} ${formatShape(geometry.dimensions.y || 1)}</size>`,
    '          </plane>',
    '        </geometry>',
  ].join('\n');
}

function generateHeightmapGeometryXml(geometry: UrdfVisual): string | null {
  const heightmap = geometry.sdfHeightmap;
  const uri = heightmap?.uri || geometry.meshPath || '';
  if (!uri) {
    return null;
  }

  const size = heightmap?.size || geometry.dimensions;
  const lines = [
    '        <geometry>',
    '          <heightmap>',
    `            <uri>${escapeXml(uri)}</uri>`,
    `            <size>${formatShape(size.x || 1)} ${formatShape(size.y || 1)} ${formatShape(size.z || 1)}</size>`,
  ];

  if (heightmap?.pos) {
    lines.push(
      `            <pos>${formatShape(heightmap.pos.x)} ${formatShape(heightmap.pos.y)} ${formatShape(heightmap.pos.z)}</pos>`,
    );
  }

  heightmap?.textures.forEach((texture) => {
    lines.push('            <texture>');
    if (texture.diffuse) {
      lines.push(`              <diffuse>${escapeXml(texture.diffuse)}</diffuse>`);
    }
    if (texture.normal) {
      lines.push(`              <normal>${escapeXml(texture.normal)}</normal>`);
    }
    if (texture.size != null) {
      lines.push(`              <size>${formatShape(texture.size)}</size>`);
    }
    lines.push('            </texture>');
  });

  heightmap?.blends.forEach((blend) => {
    lines.push(
      '            <blend>',
      `              <min_height>${formatShape(blend.minHeight)}</min_height>`,
      `              <fade_dist>${formatShape(blend.fadeDist)}</fade_dist>`,
      '            </blend>',
    );
  });

  lines.push('          </heightmap>', '        </geometry>');
  return lines.join('\n');
}

function generateGeometryXml(geometry: UrdfVisual, packageName: string): string {
  if (geometry.type === GeometryType.BOX) {
    return generateBoxGeometryXml(geometry.dimensions);
  }

  if (geometry.type === GeometryType.CYLINDER) {
    return [
      '        <geometry>',
      '          <cylinder>',
      `            <radius>${formatShape(geometry.dimensions.x)}</radius>`,
      `            <length>${formatShape(geometry.dimensions.y)}</length>`,
      '          </cylinder>',
      '        </geometry>',
    ].join('\n');
  }

  if (geometry.type === GeometryType.SPHERE) {
    return [
      '        <geometry>',
      '          <sphere>',
      `            <radius>${formatShape(geometry.dimensions.x)}</radius>`,
      '          </sphere>',
      '        </geometry>',
    ].join('\n');
  }

  if (geometry.type === GeometryType.CAPSULE) {
    return [
      '        <geometry>',
      '          <capsule>',
      `            <radius>${formatShape(geometry.dimensions.x)}</radius>`,
      `            <length>${formatShape(geometry.dimensions.y)}</length>`,
      '          </capsule>',
      '        </geometry>',
    ].join('\n');
  }

  if (geometry.type === GeometryType.PLANE) {
    return generatePlaneGeometryXml(geometry);
  }

  if (geometry.type === GeometryType.HFIELD) {
    return generateHeightmapGeometryXml(geometry) || generateBoxGeometryXml(geometry.dimensions);
  }

  if (
    (geometry.type === GeometryType.MESH || geometry.type === GeometryType.SDF) &&
    geometry.meshPath
  ) {
    const lines = [
      '        <geometry>',
      '          <mesh>',
      `            <uri>${escapeXml(buildMeshUri(geometry.meshPath, packageName))}</uri>`,
    ];

    const scale = geometry.dimensions;
    const hasCustomScale =
      Math.abs(scale.x - 1) > 1e-9 || Math.abs(scale.y - 1) > 1e-9 || Math.abs(scale.z - 1) > 1e-9;
    if (hasCustomScale) {
      lines.push(
        `            <scale>${formatShape(scale.x)} ${formatShape(scale.y)} ${formatShape(scale.z)}</scale>`,
      );
    }

    if (geometry.submeshName) {
      lines.push('            <submesh>');
      lines.push(`              <name>${escapeXml(geometry.submeshName)}</name>`);
      lines.push(`              <center>${geometry.submeshCenter ? 'true' : 'false'}</center>`);
      lines.push('            </submesh>');
    }

    lines.push('          </mesh>', '        </geometry>');
    return lines.join('\n');
  }

  if (
    geometry.type === GeometryType.POLYLINE &&
    geometry.polylinePoints &&
    geometry.polylinePoints.length >= 3
  ) {
    const pointLines = geometry.polylinePoints.map(
      (p) => `            <point>${formatShape(p.x)} ${formatShape(p.y)}</point>`,
    );
    const heightLine =
      geometry.polylineHeight != null
        ? `            <height>${formatShape(geometry.polylineHeight)}</height>`
        : '';
    return [
      '        <geometry>',
      '          <polyline>',
      ...pointLines,
      heightLine,
      '          </polyline>',
      '        </geometry>',
    ]
      .filter(Boolean)
      .join('\n');
  }

  if (geometry.type === GeometryType.ELLIPSOID || geometry.type === GeometryType.SDF) {
    return generateBoxGeometryXml(geometry.dimensions);
  }

  return ['        <geometry>', '          <empty/>', '        </geometry>'].join('\n');
}

function buildTextureUri(texturePath: string, packageName: string): string {
  if (isExternalAssetPath(texturePath)) {
    return texturePath;
  }

  const exportPath = normalizeTexturePathForExport(texturePath) || texturePath.replace(/\\/g, '/');
  return `model://${packageName}/textures/${exportPath}`;
}

function generateMaterialXml(materialState: SdfMaterialState, packageName: string): string {
  const resolvedColor = materialState.color || (materialState.texture ? '#ffffff' : undefined);
  const rgba = colorRgbaToSdfText(materialState.colorRgba) ?? hexToRgba(resolvedColor);
  if (!rgba && !materialState.texture) {
    return '';
  }

  const lines = ['        <material>'];
  if (rgba) {
    lines.push(`          <ambient>${rgba}</ambient>`, `          <diffuse>${rgba}</diffuse>`);
  }

  if (materialState.texture) {
    lines.push(
      '          <pbr>',
      '            <metal>',
      `              <albedo_map>${escapeXml(buildTextureUri(materialState.texture, packageName))}</albedo_map>`,
      '            </metal>',
      '          </pbr>',
    );
  }

  lines.push('        </material>');
  return lines.join('\n');
}

function generateVisualXml(
  robot: RobotState,
  link: UrdfLink,
  visual: UrdfVisual,
  visualIndex: number,
  packageName: string,
  isPrimaryVisual: boolean,
): string {
  const lines = [`      <visual name="${escapeXml(`${link.name}_visual_${visualIndex}`)}">`];
  if (!isIdentityPose(visual.origin)) {
    lines.push(`        <pose>${formatPose(visual.origin)}</pose>`);
  }
  lines.push(generateGeometryXml(visual, packageName));

  const materialXml = generateMaterialXml(
    resolveVisualMaterialState(robot, link, visual, isPrimaryVisual),
    packageName,
  );
  if (materialXml) {
    lines.push(materialXml);
  }

  lines.push('      </visual>');
  return lines.join('\n');
}

function generateCollisionXml(
  link: UrdfLink,
  collision: UrdfVisual,
  collisionIndex: number,
  packageName: string,
): string {
  const lines = [
    `      <collision name="${escapeXml(`${link.name}_collision_${collisionIndex}`)}">`,
  ];
  if (!isIdentityPose(collision.origin)) {
    lines.push(`        <pose>${formatPose(collision.origin)}</pose>`);
  }
  lines.push(generateGeometryXml(collision, packageName));
  lines.push('      </collision>');
  return lines.join('\n');
}

function generateInertialXml(link: UrdfLink): string | null {
  if (!link.inertial) {
    return null;
  }

  const inertia = link.inertial.inertia;
  const lines = ['      <inertial>'];
  if (link.inertial.origin && !isIdentityPose(link.inertial.origin)) {
    lines.push(`        <pose>${formatPose(link.inertial.origin)}</pose>`);
  }
  lines.push(
    `        <mass>${formatScalar(link.inertial.mass)}</mass>`,
    '        <inertia>',
    `          <ixx>${formatScalar(inertia.ixx)}</ixx>`,
    `          <ixy>${formatScalar(inertia.ixy)}</ixy>`,
    `          <ixz>${formatScalar(inertia.ixz)}</ixz>`,
    `          <iyy>${formatScalar(inertia.iyy)}</iyy>`,
    `          <iyz>${formatScalar(inertia.iyz)}</iyz>`,
    `          <izz>${formatScalar(inertia.izz)}</izz>`,
    '        </inertia>',
    '      </inertial>',
  );
  return lines.join('\n');
}

function buildLinkWorldMatrices(
  robot: RobotState,
  useCurrentJointPose = false,
): Map<string, THREE.Matrix4> {
  const matrices = new Map<string, THREE.Matrix4>();
  if (useCurrentJointPose) {
    Object.entries(computeLinkWorldMatrices(robot)).forEach(([linkId, matrix]) => {
      matrices.set(linkId, matrix.clone());
    });
    return matrices;
  }

  const restAngles = Object.fromEntries(
    Object.values(robot.joints).map((joint) => [
      joint.id,
      Number.isFinite(joint.referencePosition) ? joint.referencePosition! : 0,
    ]),
  );
  const restQuaternions = Object.fromEntries(
    Object.values(robot.joints)
      .filter((joint) => joint.type === JointType.BALL)
      .map((joint) => [joint.id, { x: 0, y: 0, z: 0, w: 1 }]),
  );
  Object.entries(
    computeLinkWorldMatrices(robot, {
      angles: restAngles,
      quaternions: restQuaternions,
    }),
  ).forEach(([linkId, matrix]) => {
    matrices.set(linkId, matrix.clone());
  });

  return matrices;
}

function linkHasSdfExportablePayload(link: UrdfLink): boolean {
  const inertial = link.inertial;
  const hasExportableInertial = Boolean(
    inertial &&
    (((Number.isFinite(inertial.mass) ? inertial.mass : 0) || 0) > 1e-9 ||
      Object.values(inertial.inertia || {}).some((value) => Math.abs(Number(value) || 0) > 1e-9)),
  );

  return (
    getVisualGeometryEntries(link).some((entry) => entry.geometry.type !== GeometryType.NONE) ||
    getCollisionGeometryEntries(link).some((entry) => entry.geometry.type !== GeometryType.NONE) ||
    hasExportableInertial
  );
}

function resolveSyntheticRootOmissions(robot: RobotState): {
  omittedJointIds: Set<string>;
  omittedLinkIds: Set<string>;
} {
  const omittedJointIds = new Set<string>();
  const omittedLinkIds = new Set<string>();
  const rootLinkId = robot.rootLinkId;
  if (!rootLinkId) {
    return { omittedJointIds, omittedLinkIds };
  }

  const rootLink = robot.links[rootLinkId];
  if (!rootLink) {
    return { omittedJointIds, omittedLinkIds };
  }

  const childJoints = Object.values(robot.joints).filter(
    (joint) => joint.parentLinkId === rootLinkId,
  );
  const canOmitRootAnchor =
    childJoints.length > 0 &&
    childJoints.every(
      (joint) => joint.type === JointType.FLOATING || joint.type === JointType.FIXED,
    ) &&
    !Object.values(robot.joints).some((joint) => joint.childLinkId === rootLinkId) &&
    !linkHasSdfExportablePayload(rootLink);

  if (!canOmitRootAnchor) {
    return { omittedJointIds, omittedLinkIds };
  }

  omittedLinkIds.add(rootLinkId);
  childJoints.forEach((joint) => {
    omittedJointIds.add(joint.id);
  });

  return { omittedJointIds, omittedLinkIds };
}

function createUniqueModelChildName(baseName: string, usedNames: Set<string>): string {
  const normalizedBase = baseName.trim() || 'joint';
  const preferredName = usedNames.has(normalizedBase) ? `${normalizedBase}_joint` : normalizedBase;
  if (!usedNames.has(preferredName)) {
    usedNames.add(preferredName);
    return preferredName;
  }

  let suffix = 1;
  while (usedNames.has(`${preferredName}_${suffix}`)) {
    suffix += 1;
  }
  const uniqueName = `${preferredName}_${suffix}`;
  usedNames.add(uniqueName);
  return uniqueName;
}

function createSafeSdfLinkName(baseName: string, usedNames: Set<string>): string {
  const normalizedBase = baseName.trim() || 'link';
  const safeBase = normalizedBase === 'world' ? 'world_link' : normalizedBase;
  return createUniqueModelChildName(safeBase, usedNames);
}

function generateJointXml(
  joint: UrdfJoint,
  jointNameOverride?: string,
  mimicJointNameOverride?: string,
  parentLinkNameOverride?: string,
  childLinkNameOverride?: string,
): string {
  if (joint.type === JointType.FLOATING) {
    throw new Error(
      `[SDF export] Joint "${joint.name || joint.id}" uses unsupported floating type.`,
    );
  }

  const jointName = jointNameOverride || joint.name || joint.id;
  const lines = [`    <joint name="${escapeXml(jointName)}" type="${escapeXml(joint.type)}">`];
  const parentLinkName = parentLinkNameOverride || joint.parentLinkId;
  const childLinkName = childLinkNameOverride || joint.childLinkId;
  if (parentLinkName) {
    lines.push(`      <parent>${escapeXml(parentLinkName)}</parent>`);
  }
  lines.push(`      <child>${escapeXml(childLinkName)}</child>`);

  if (AXIS_EXPORT_TYPES.has(joint.type) && joint.axis) {
    lines.push('      <axis>');
    lines.push(
      `        <xyz>${formatScalar(joint.axis.x)} ${formatScalar(joint.axis.y)} ${formatScalar(joint.axis.z)}</xyz>`,
    );
    // Our internal axis is stored in the joint frame (URDF convention).
    // Explicitly mark this so SDF readers (any version) interpret it correctly.
    lines.push('        <use_parent_model_frame>false</use_parent_model_frame>');

    if (LIMIT_EXPORT_TYPES.has(joint.type) && joint.limit) {
      const limitLines: string[] = [];
      if (Number.isFinite(joint.limit.lower)) {
        limitLines.push(`          <lower>${formatScalar(Number(joint.limit.lower))}</lower>`);
      }
      if (Number.isFinite(joint.limit.upper)) {
        limitLines.push(`          <upper>${formatScalar(Number(joint.limit.upper))}</upper>`);
      }
      if (Number.isFinite(joint.limit.effort)) {
        limitLines.push(`          <effort>${formatScalar(Number(joint.limit.effort))}</effort>`);
      }
      if (Number.isFinite(joint.limit.velocity)) {
        limitLines.push(`          <velocity>${formatScalar(Number(joint.limit.velocity))}</velocity>`);
      }
      if (limitLines.length > 0) {
        lines.push('        <limit>');
        lines.push(...limitLines);
        lines.push('        </limit>');
      }
    }

    if (
      DYNAMICS_EXPORT_TYPES.has(joint.type) &&
      joint.dynamics &&
      (Math.abs(joint.dynamics.damping) > 1e-9 || Math.abs(joint.dynamics.friction) > 1e-9)
    ) {
      lines.push('        <dynamics>');
      if (Math.abs(joint.dynamics.damping) > 1e-9) {
        lines.push(`          <damping>${formatScalar(joint.dynamics.damping)}</damping>`);
      }
      if (Math.abs(joint.dynamics.friction) > 1e-9) {
        lines.push(`          <friction>${formatScalar(joint.dynamics.friction)}</friction>`);
      }
      lines.push('        </dynamics>');
    }

    if (joint.mimic?.joint) {
      const mimicJointName = mimicJointNameOverride || joint.mimic.joint;
      const multiplier = joint.mimic.multiplier === undefined ? 1 : Number(joint.mimic.multiplier);
      const offset = joint.mimic.offset === undefined ? 0 : Number(joint.mimic.offset);
      if (!Number.isFinite(multiplier) || !Number.isFinite(offset)) {
        throw new Error(
          `[SDF export] Mimic joint "${joint.name || joint.id}" must use finite multiplier and offset values.`,
        );
      }

      lines.push(`        <mimic joint="${escapeXml(mimicJointName)}">`);
      lines.push(`          <multiplier>${formatScalar(multiplier)}</multiplier>`);
      lines.push(`          <offset>${formatScalar(offset)}</offset>`);
      lines.push('          <reference>0</reference>');
      lines.push('        </mimic>');
    }

    lines.push('      </axis>');
  }

  lines.push('    </joint>');
  return lines.join('\n');
}

function generateClosedLoopJointXmlWithName(
  constraint: RobotClosedLoopConstraint,
  jointName: string,
  parentLinkName: string,
  childLinkName: string,
): string | null {
  if (constraint.type !== 'connect') {
    return null;
  }

  const childLink = escapeXml(childLinkName);
  const anchorLocalB: Pose = {
    xyz: { ...constraint.anchorLocalB },
    rpy: { r: 0, p: 0, y: 0 },
  };

  return [
    `    <joint name="${escapeXml(jointName)}" type="ball">`,
    `      <parent>${escapeXml(parentLinkName)}</parent>`,
    `      <child>${childLink}</child>`,
    `      <pose relative_to="${childLink}">${formatPose(anchorLocalB)}</pose>`,
    '    </joint>',
  ].join('\n');
}

export function generateSDF(robot: RobotState, options: GenerateSDFOptions = {}): string {
  const packageName = (options.packageName || robot.name || 'robot').trim() || 'robot';
  const modelName = (robot.name || packageName).trim() || 'robot';
  const version = options.version || '1.7';
  const linkMatrices = buildLinkWorldMatrices(
    robot,
    (robot.closedLoopConstraints?.length ?? 0) > 0,
  );
  const { omittedJointIds, omittedLinkIds } = resolveSyntheticRootOmissions(robot);
  const usedModelChildNames = new Set<string>();
  const linkNameById = new Map<string, string>();

  const lines = [
    '<?xml version="1.0"?>',
    `<sdf version="${escapeXml(version)}">`,
    `  <model name="${escapeXml(modelName)}">`,
  ];

  Object.values(robot.links).forEach((link) => {
    if (omittedLinkIds.has(link.id)) {
      return;
    }

    const linkName = createSafeSdfLinkName(link.name || link.id, usedModelChildNames);
    linkNameById.set(link.id, linkName);
    const linkPose = matrixToPose(
      linkMatrices.get(link.id || link.name) ?? new THREE.Matrix4().identity(),
    );
    lines.push(`    <link name="${escapeXml(linkName)}">`);
    if (!isIdentityPose(linkPose)) {
      lines.push(`      <pose>${formatPose(linkPose)}</pose>`);
    }

    getVisualGeometryEntries(link).forEach((entry, index) => {
      lines.push(
        generateVisualXml(robot, link, entry.geometry, index, packageName, entry.bodyIndex == null),
      );
    });

    getCollisionGeometryEntries(link).forEach((entry, index) => {
      lines.push(generateCollisionXml(link, entry.geometry, index, packageName));
    });

    const inertialXml = generateInertialXml(link);
    if (inertialXml) {
      lines.push(inertialXml);
    }

    lines.push('    </link>');
  });

  const jointNameByOriginalId = new Map<string, string>();
  Object.values(robot.joints).forEach((joint) => {
    if (omittedJointIds.has(joint.id)) {
      return;
    }

    const jointName = createUniqueModelChildName(joint.name || joint.id, usedModelChildNames);
    jointNameByOriginalId.set(joint.id, jointName);
  });

  Object.values(robot.joints).forEach((joint) => {
    if (omittedJointIds.has(joint.id)) {
      return;
    }

    const jointName = jointNameByOriginalId.get(joint.id) || joint.name || joint.id;
    const mimicJointId = resolveJointKey(robot.joints, joint.mimic?.joint);
    const mimicJointResolvedName = mimicJointId
      ? jointNameByOriginalId.get(mimicJointId) || robot.joints[mimicJointId]?.name
      : undefined;
    lines.push(
      generateJointXml(
        joint,
        jointName,
        mimicJointResolvedName,
        linkNameById.get(joint.parentLinkId) || robot.links[joint.parentLinkId]?.name,
        linkNameById.get(joint.childLinkId) || robot.links[joint.childLinkId]?.name,
      ),
    );
  });
  (robot.closedLoopConstraints || []).forEach((constraint) => {
    const closedLoopName = createUniqueModelChildName(
      constraint.id || `${constraint.linkAId}_${constraint.linkBId}_closed_loop`,
      usedModelChildNames,
    );
    const closedLoopXml = generateClosedLoopJointXmlWithName(
      constraint,
      closedLoopName,
      linkNameById.get(constraint.linkAId) ||
        robot.links[constraint.linkAId]?.name ||
        constraint.linkAId,
      linkNameById.get(constraint.linkBId) ||
        robot.links[constraint.linkBId]?.name ||
        constraint.linkBId,
    );
    if (closedLoopXml) {
      lines.push(closedLoopXml);
    }
  });

  lines.push('  </model>', '</sdf>', '');

  return lines.join('\n');
}

export function generateSdfModelConfig(modelName: string, version = '1.7'): string {
  const safeName = (modelName || 'robot').trim() || 'robot';

  return [
    '<?xml version="1.0"?>',
    '<model>',
    `  <name>${escapeXml(safeName)}</name>`,
    '  <version>1.0</version>',
    `  <sdf version="${escapeXml(version)}">model.sdf</sdf>`,
    '</model>',
    '',
  ].join('\n');
}
