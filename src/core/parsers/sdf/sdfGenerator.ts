import * as THREE from 'three';

import {
  computeLinkWorldMatrices,
  getCollisionGeometryEntries,
  getVisualGeometryEntries,
  resolveJointKey,
  resolveVisualMaterialOverride,
} from '@/core/robot';
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
import { createSdfNumericFormat, type SdfNumericFormat } from './sdfNumericFormat';
import {
  generateSdfClosedLoopMetadata,
  getSdfClosedLoopJointFrame,
  SDF_CLOSED_LOOP_NAMESPACE,
} from './sdf_closed_loop';

export interface GenerateSDFOptions {
  packageName?: string;
  version?: string;
  /** Preserve editable values, including sub-decimal transforms and material channels. */
  preserveNumericPrecision?: boolean;
  /** Explicit export callers collect compatibility warnings; internal serialization stays silent. */
  onWarning?: (message: string) => void;
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

function colorRgbaToSdfText(
  colorRgba: [number, number, number, number] | undefined,
  format: SdfNumericFormat,
): string | null {
  if (
    !Array.isArray(colorRgba) ||
    colorRgba.length !== 4 ||
    !colorRgba.every((value) => Number.isFinite(value))
  ) {
    return null;
  }

  return colorRgba.map((value) => format.color(Math.min(1, Math.max(0, Number(value))))).join(' ');
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

function generateBoxGeometryXml(dimensions: Vector3, format: SdfNumericFormat): string {
  return [
    '        <geometry>',
    '          <box>',
    `            <size>${format.shape(dimensions.x)} ${format.shape(dimensions.y)} ${format.shape(dimensions.z)}</size>`,
    '          </box>',
    '        </geometry>',
  ].join('\n');
}

function generatePlaneGeometryXml(geometry: UrdfVisual, format: SdfNumericFormat): string {
  return [
    '        <geometry>',
    '          <plane>',
    '            <normal>0 0 1</normal>',
    `            <size>${format.shape(geometry.dimensions.x || 1)} ${format.shape(geometry.dimensions.y || 1)}</size>`,
    '          </plane>',
    '        </geometry>',
  ].join('\n');
}

function generateHeightmapGeometryXml(geometry: UrdfVisual, format: SdfNumericFormat): string | null {
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
    `            <size>${format.shape(size.x || 1)} ${format.shape(size.y || 1)} ${format.shape(size.z || 1)}</size>`,
  ];

  if (heightmap?.pos) {
    lines.push(
      `            <pos>${format.shape(heightmap.pos.x)} ${format.shape(heightmap.pos.y)} ${format.shape(heightmap.pos.z)}</pos>`,
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
      lines.push(`              <size>${format.shape(texture.size)}</size>`);
    }
    lines.push('            </texture>');
  });

  heightmap?.blends.forEach((blend) => {
    lines.push(
      '            <blend>',
      `              <min_height>${format.shape(blend.minHeight)}</min_height>`,
      `              <fade_dist>${format.shape(blend.fadeDist)}</fade_dist>`,
      '            </blend>',
    );
  });

  lines.push('          </heightmap>', '        </geometry>');
  return lines.join('\n');
}

function generateGeometryXml(
  geometry: UrdfVisual, packageName: string, format: SdfNumericFormat,
): string {
  if (geometry.type === GeometryType.BOX) {
    return generateBoxGeometryXml(geometry.dimensions, format);
  }

  if (geometry.type === GeometryType.CYLINDER) {
    return [
      '        <geometry>',
      '          <cylinder>',
      `            <radius>${format.shape(geometry.dimensions.x)}</radius>`,
      `            <length>${format.shape(geometry.dimensions.y)}</length>`,
      '          </cylinder>',
      '        </geometry>',
    ].join('\n');
  }

  if (geometry.type === GeometryType.SPHERE) {
    return [
      '        <geometry>',
      '          <sphere>',
      `            <radius>${format.shape(geometry.dimensions.x)}</radius>`,
      '          </sphere>',
      '        </geometry>',
    ].join('\n');
  }

  if (geometry.type === GeometryType.CAPSULE) {
    return [
      '        <geometry>',
      '          <capsule>',
      `            <radius>${format.shape(geometry.dimensions.x)}</radius>`,
      `            <length>${format.shape(geometry.dimensions.y)}</length>`,
      '          </capsule>',
      '        </geometry>',
    ].join('\n');
  }

  if (geometry.type === GeometryType.PLANE) {
    return generatePlaneGeometryXml(geometry, format);
  }

  if (geometry.type === GeometryType.HFIELD) {
    return generateHeightmapGeometryXml(geometry, format) || generateBoxGeometryXml(geometry.dimensions, format);
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
      Math.abs(scale.x - 1) > format.epsilon ||
      Math.abs(scale.y - 1) > format.epsilon ||
      Math.abs(scale.z - 1) > format.epsilon;
    if (hasCustomScale) {
      lines.push(
        `            <scale>${format.shape(scale.x)} ${format.shape(scale.y)} ${format.shape(scale.z)}</scale>`,
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
      (p) => `            <point>${format.shape(p.x)} ${format.shape(p.y)}</point>`,
    );
    const heightLine =
      geometry.polylineHeight != null
        ? `            <height>${format.shape(geometry.polylineHeight)}</height>`
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
    return generateBoxGeometryXml(geometry.dimensions, format);
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

function generateMaterialXml(
  materialState: SdfMaterialState, packageName: string, format: SdfNumericFormat,
): string {
  const resolvedColor = materialState.color || (materialState.texture ? '#ffffff' : undefined);
  const rgba = colorRgbaToSdfText(materialState.colorRgba, format) ?? hexToRgba(resolvedColor);
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
  format: SdfNumericFormat,
): string {
  const lines = [`      <visual name="${escapeXml(`${link.name}_visual_${visualIndex}`)}">`];
  if (!format.isIdentityPose(visual.origin)) {
    lines.push(`        <pose>${format.pose(visual.origin)}</pose>`);
  }
  lines.push(generateGeometryXml(visual, packageName, format));

  const materialXml = generateMaterialXml(
    resolveVisualMaterialState(robot, link, visual, isPrimaryVisual),
    packageName,
    format,
  );
  if (materialXml) {
    lines.push(materialXml);
  }

  lines.push('      </visual>');
  return lines.join('\n');
}

function generateCollisionXml({
  link, collision, collisionIndex, packageName, format,
}: {
  link: UrdfLink;
  collision: UrdfVisual;
  collisionIndex: number;
  packageName: string;
  format: SdfNumericFormat;
}): string {
  const lines = [
    `      <collision name="${escapeXml(`${link.name}_collision_${collisionIndex}`)}">`,
  ];
  if (!format.isIdentityPose(collision.origin)) {
    lines.push(`        <pose>${format.pose(collision.origin)}</pose>`);
  }
  lines.push(generateGeometryXml(collision, packageName, format));
  lines.push('      </collision>');
  return lines.join('\n');
}

function generateInertialXml(link: UrdfLink, format: SdfNumericFormat): string | null {
  if (!link.inertial) {
    return null;
  }

  const inertia = link.inertial.inertia;
  const lines = ['      <inertial>'];
  if (link.inertial.origin && !format.isIdentityPose(link.inertial.origin)) {
    lines.push(`        <pose>${format.pose(link.inertial.origin)}</pose>`);
  }
  lines.push(
    `        <mass>${format.scalar(link.inertial.mass)}</mass>`,
    '        <inertia>',
    `          <ixx>${format.scalar(inertia.ixx)}</ixx>`,
    `          <ixy>${format.scalar(inertia.ixy)}</ixy>`,
    `          <ixz>${format.scalar(inertia.ixz)}</ixz>`,
    `          <iyy>${format.scalar(inertia.iyy)}</iyy>`,
    `          <iyz>${format.scalar(inertia.iyz)}</iyz>`,
    `          <izz>${format.scalar(inertia.izz)}</izz>`,
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
  format: SdfNumericFormat,
  jointNameOverride?: string,
  mimicJointNameOverride?: string,
  parentLinkNameOverride?: string,
  childLinkNameOverride?: string,
): string {
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
      `        <xyz>${format.scalar(joint.axis.x)} ${format.scalar(joint.axis.y)} ${format.scalar(joint.axis.z)}</xyz>`,
    );
    // Our internal axis is stored in the joint frame (URDF convention).
    // Explicitly mark this so SDF readers (any version) interpret it correctly.
    lines.push('        <use_parent_model_frame>false</use_parent_model_frame>');

    if (!joint.mimic && LIMIT_EXPORT_TYPES.has(joint.type) && joint.limit) {
      const limitLines: string[] = [];
      if (Number.isFinite(joint.limit.lower)) {
        limitLines.push(`          <lower>${format.scalar(Number(joint.limit.lower))}</lower>`);
      }
      if (Number.isFinite(joint.limit.upper)) {
        limitLines.push(`          <upper>${format.scalar(Number(joint.limit.upper))}</upper>`);
      }
      if (Number.isFinite(joint.limit.effort)) {
        limitLines.push(`          <effort>${format.scalar(Number(joint.limit.effort))}</effort>`);
      }
      if (Number.isFinite(joint.limit.velocity)) {
        limitLines.push(`          <velocity>${format.scalar(Number(joint.limit.velocity))}</velocity>`);
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
      (Math.abs(joint.dynamics.damping) > format.epsilon || Math.abs(joint.dynamics.friction) > format.epsilon)
    ) {
      lines.push('        <dynamics>');
      if (Math.abs(joint.dynamics.damping) > format.epsilon) {
        lines.push(`          <damping>${format.scalar(joint.dynamics.damping)}</damping>`);
      }
      if (Math.abs(joint.dynamics.friction) > format.epsilon) {
        lines.push(`          <friction>${format.scalar(joint.dynamics.friction)}</friction>`);
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
      lines.push(`          <multiplier>${format.scalar(multiplier)}</multiplier>`);
      lines.push(`          <offset>${format.scalar(offset)}</offset>`);
      lines.push('          <reference>0</reference>');
      lines.push('        </mimic>');
    }

    lines.push('      </axis>');
  }

  lines.push('    </joint>');
  return lines.join('\n');
}

function generateClosedLoopJointXmlWithName({
  constraint, format, jointName, parentLinkName, childLinkName, supportsRelativeTo, linkMatrices,
}: {
  constraint: RobotClosedLoopConstraint;
  format: SdfNumericFormat;
  jointName: string;
  parentLinkName: string;
  childLinkName: string;
  supportsRelativeTo: boolean;
  linkMatrices: Map<string, THREE.Matrix4>;
}): string | null {
  if (constraint.type === 'distance') {
    return null;
  }

  // SDF joints may reference any parent/child pair, so movable loop closers
  // keep their joint semantics; legacy connects stay ball joints.
  const jointType = constraint.type === 'joint' ? constraint.jointType : JointType.BALL;
  const childLink = escapeXml(childLinkName);
  const frame = constraint.type === 'joint'
    ? getSdfClosedLoopJointFrame(
      constraint,
      linkMatrices.get(constraint.linkAId) ?? new THREE.Matrix4(),
      linkMatrices.get(constraint.linkBId) ?? new THREE.Matrix4(),
    )
    : { pose: { xyz: constraint.anchorLocalB, rpy: { r: 0, p: 0, y: 0 } }, referencePosition: 0 };

  const jointXmlLines = [
    `    <joint name="${escapeXml(jointName)}" type="${jointType}">`,
    `      <parent>${escapeXml(parentLinkName)}</parent>`,
    `      <child>${childLink}</child>`,
    `      <pose${supportsRelativeTo ? ` relative_to="${childLink}"` : ''}>${format.pose(frame.pose)}</pose>`,
  ];

  if (constraint.type === 'joint' && AXIS_EXPORT_TYPES.has(jointType)) {
    jointXmlLines.push('      <axis>');
    jointXmlLines.push(
      `        <xyz>${[
        format.scalar(constraint.axis?.x ?? 1),
        format.scalar(constraint.axis?.y ?? 0),
        format.scalar(constraint.axis?.z ?? 0),
      ].join(' ')}</xyz>`,
    );
    const limitLines: string[] = [];
    for (const key of ['lower', 'upper', 'effort', 'velocity'] as const) {
      const value = constraint.limit?.[key];
      const isPosition = key === 'lower' || key === 'upper';
      if (!Number.isFinite(value) || (isPosition && jointType === JointType.CONTINUOUS)) continue;
      const exportedValue = Number(value) - (isPosition ? frame.referencePosition : 0);
      limitLines.push(`          <${key}>${format.scalar(exportedValue)}</${key}>`);
    }
    if (limitLines.length > 0) {
      jointXmlLines.push('        <limit>');
      jointXmlLines.push(...limitLines);
      jointXmlLines.push('        </limit>');
    }
    jointXmlLines.push('      </axis>');
  }

  if (constraint.type === 'joint') {
    jointXmlLines.push(generateSdfClosedLoopMetadata(constraint, frame.referencePosition));
  }

  jointXmlLines.push('    </joint>');
  return jointXmlLines.join('\n');
}

export function generateSDF(robot: RobotState, options: GenerateSDFOptions = {}): string {
  const format = createSdfNumericFormat(options.preserveNumericPrecision);
  const packageName = (options.packageName || robot.name || 'robot').trim() || 'robot';
  const modelName = (robot.name || packageName).trim() || 'robot';
  const version = options.version || '1.7';
  const linkMatrices = buildLinkWorldMatrices(
    robot,
    (robot.closedLoopConstraints?.length ?? 0) > 0,
  );
  const { omittedJointIds, omittedLinkIds } = options.preserveNumericPrecision
    ? { omittedJointIds: new Set<string>(), omittedLinkIds: new Set<string>() }
    : resolveSyntheticRootOmissions(robot);
  const usedModelChildNames = new Set<string>();
  const linkNameById = new Map<string, string>();
  Object.values(robot.links).forEach((link) => {
    if (!omittedLinkIds.has(link.id)) {
      linkNameById.set(link.id, createSafeSdfLinkName(link.name || link.id, usedModelChildNames));
    }
  });
  const [schemaMajor, schemaMinor] = version.split('.').map(Number);
  const supportsRelativeTo = schemaMajor > 1 || (schemaMajor === 1 && schemaMinor >= 7);
  const useJointOrigins = options.preserveNumericPrecision && !robot.closedLoopConstraints?.length;
  const useLocalLinkPoses = useJointOrigins && supportsRelativeTo;
  const parentJointByLink = new Map(
    Object.values(robot.joints).map((joint) => [joint.childLinkId, joint]),
  );

  const lines = [
    '<?xml version="1.0"?>',
    `<sdf version="${escapeXml(version)}"${robot.closedLoopConstraints?.some((constraint) => constraint.type === 'joint') ? ` xmlns:urdf_studio="${SDF_CLOSED_LOOP_NAMESPACE}"` : ''}>`,
    `  <model name="${escapeXml(modelName)}">`,
  ];

  Object.values(robot.links).forEach((link) => {
    if (omittedLinkIds.has(link.id)) {
      return;
    }

    const linkName = linkNameById.get(link.id)!;
    const parentJoint = useJointOrigins ? parentJointByLink.get(link.id) : undefined;
    const parentFrame = parentJoint && linkNameById.get(parentJoint.parentLinkId);
    const linkPose = parentJoint && linkMatrices.get(parentJoint.parentLinkId)?.equals(new THREE.Matrix4())
      ? parentJoint.origin
      : matrixToPose(linkMatrices.get(link.id || link.name) ?? new THREE.Matrix4());
    lines.push(`    <link name="${escapeXml(linkName)}">`);
    // Express editable transforms in their owning frame to avoid accumulating
    // matrix/Euler round-trip error across a kinematic chain.
    if (useLocalLinkPoses && parentJoint && parentFrame) {
      lines.push(`      <pose relative_to="${escapeXml(parentFrame)}">${format.pose(parentJoint.origin)}</pose>`);
    } else if (!format.isIdentityPose(linkPose)) {
      lines.push(`      <pose>${format.pose(linkPose)}</pose>`);
    }

    getVisualGeometryEntries(link).forEach((entry, index) => {
      lines.push(
        generateVisualXml(robot, link, entry.geometry, index, packageName, entry.bodyIndex == null, format),
      );
    });

    getCollisionGeometryEntries(link).forEach((entry, index) => {
      lines.push(generateCollisionXml({
        link, collision: entry.geometry, collisionIndex: index, packageName, format,
      }));
    });

    const inertialXml = generateInertialXml(link, format);
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

    if (joint.type === JointType.FLOATING) {
      options.onWarning?.(
        `[SDF export] Joint "${joint.name || joint.id}" uses unsupported floating type; skipping (link will be fixed to parent).`,
      );
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
        format,
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
    const closedLoopXml = generateClosedLoopJointXmlWithName({
      constraint,
      format,
      jointName: closedLoopName,
      supportsRelativeTo,
      linkMatrices,
      parentLinkName: linkNameById.get(constraint.linkAId) ||
        robot.links[constraint.linkAId]?.name ||
        constraint.linkAId,
      childLinkName: linkNameById.get(constraint.linkBId) ||
        robot.links[constraint.linkBId]?.name ||
        constraint.linkBId,
    });
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
