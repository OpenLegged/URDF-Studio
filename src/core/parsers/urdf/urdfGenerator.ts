/**
 * URDF Generator
 * Generates URDF XML format from RobotState
 */

import {
  RobotState,
  UrdfLink,
  UrdfJoint,
  type UrdfOrigin,
  GeometryType,
  AssemblyState,
  type UrdfVisualMaterial,
} from '@/types';
import { mergeAssembly } from '@/core/robot/assemblyMerger';
import {
  collectGeometryTexturePaths,
  getEffectiveGeometryAuthoredMaterials,
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
  buildTextureExportPathOverrides,
  normalizeMeshPathForExport,
  resolveTextureExportPath,
} from '../meshPathUtils';
import { formatUrdfMeshScaleAttribute } from './meshScale';
import { createUnsupportedUrdfJointError, findUnsupportedUrdfJoint } from './urdfExportSupport';

const AXIS_EXPORT_TYPES = new Set(['revolute', 'continuous', 'prismatic', 'planar']);
const FULL_LIMIT_EXPORT_TYPES = new Set(['revolute', 'prismatic']);
const EFFORT_VELOCITY_LIMIT_EXPORT_TYPES = new Set(['continuous']);
const DYNAMICS_EXPORT_TYPES = new Set(['revolute', 'continuous', 'prismatic']);
// Geometry types with dedicated URDF export handling.
// Types NOT in this set are downgraded to a thin bounding box.
const EXACT_URDF_GEOMETRY_TYPES = new Set([
  GeometryType.BOX,
  GeometryType.CYLINDER,
  GeometryType.SPHERE,
  GeometryType.CAPSULE,
  GeometryType.MESH,
]);

const hasExportableInertial = (link: UrdfLink): boolean => Boolean(link.inertial);

// Bias each serialized color channel by a tiny positive epsilon before converting
// to floats. The importer currently floors `rgba * 255`, so a direct decimal
// expansion of `channel / 255` can still fall just below the intended 8-bit value
// after parsing. Keeping the bias far below one full color step preserves the
// visual result while making roundtrips stable.
const hexToRgba = (hex: string): string => {
  const normalized = String(hex || '').trim();
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})?$/i.exec(normalized);
  if (result) {
    const serializeChannel = (channelHex: string) => {
      const channel = parseInt(channelHex, 16);
      return Math.min(1, (channel + 1e-3) / 255).toFixed(8);
    };

    const r = serializeChannel(result[1]);
    const g = serializeChannel(result[2]);
    const b = serializeChannel(result[3]);
    const a = result[4] ? serializeChannel(result[4]) : '1.00000000';
    return `${r} ${g} ${b} ${a}`;
  }
  return '0.5 0.5 0.5 1.0'; // fallback gray
};

const clampUnitInterval = (value: number): number => Math.min(1, Math.max(0, value));

const formatUnitInterval = (value: number): string => clampUnitInterval(value).toFixed(8);

const colorRgbaToUrdfRgba = (
  colorRgba: readonly number[] | undefined,
  opacityOverride?: number,
): string | null => {
  if (
    !Array.isArray(colorRgba) ||
    colorRgba.length < 4 ||
    !colorRgba.slice(0, 4).every((value) => Number.isFinite(value))
  ) {
    return null;
  }

  const alpha = Number.isFinite(opacityOverride) ? Number(opacityOverride) : Number(colorRgba[3]);
  return [
    formatUnitInterval(Number(colorRgba[0])),
    formatUnitInterval(Number(colorRgba[1])),
    formatUnitInterval(Number(colorRgba[2])),
    formatUnitInterval(alpha),
  ].join(' ');
};

const colorMatchesQuantizedRgba = (
  color: string | undefined,
  colorRgba: readonly number[] | undefined,
): boolean => {
  if (
    !color ||
    !Array.isArray(colorRgba) ||
    colorRgba.length < 3 ||
    !colorRgba.slice(0, 3).every((value) => Number.isFinite(value))
  ) {
    return false;
  }

  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})(?:[a-f\d]{2})?$/i.exec(
    color.trim(),
  );
  if (!match) {
    return false;
  }

  return [match[1], match[2], match[3]].every((channelHex, index) => {
    const parsed = parseInt(channelHex, 16);
    const expected = Math.floor(clampUnitInterval(Number(colorRgba[index])) * 255);
    return parsed === expected;
  });
};

const hexToRgbaWithOpacity = (hex: string, opacityOverride?: number): string => {
  const normalized = String(hex || '').trim();
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})?$/i.exec(normalized);
  if (!result) {
    return Number.isFinite(opacityOverride)
      ? `0.5 0.5 0.5 ${formatUnitInterval(Number(opacityOverride))}`
      : hexToRgba(hex);
  }

  const serializeChannel = (channelHex: string) => {
    const channel = parseInt(channelHex, 16);
    return Math.min(1, (channel + 1e-3) / 255).toFixed(8);
  };

  const r = serializeChannel(result[1]);
  const g = serializeChannel(result[2]);
  const b = serializeChannel(result[3]);
  const a = Number.isFinite(opacityOverride)
    ? formatUnitInterval(Number(opacityOverride))
    : result[4]
      ? serializeChannel(result[4])
      : '1.00000000';
  return `${r} ${g} ${b} ${a}`;
};

function resolveLinkExportMaterial(
  robot: RobotState,
  link: UrdfLink,
  visual: UrdfLink['visual'],
  options: {
    isPrimaryVisual?: boolean;
  } = {},
): {
  authoredMaterials?: UrdfVisualMaterial[];
  color?: string;
  colorRgba?: [number, number, number, number];
  opacity?: number;
  texture?: string;
  source: 'authored' | 'legacy-link' | 'inline' | 'none';
} {
  const resolvedMaterial = resolveVisualMaterialOverride(robot, link, visual, {
    isPrimaryVisual: options.isPrimaryVisual,
  });

  if (resolvedMaterial.source === 'authored') {
    return {
      authoredMaterials: getEffectiveGeometryAuthoredMaterials(visual),
      color: resolvedMaterial.color,
      colorRgba: resolvedMaterial.colorRgba,
      opacity: resolvedMaterial.opacity,
      texture: resolvedMaterial.texture,
      source: 'authored',
    };
  }

  if (resolvedMaterial.source === 'legacy-link') {
    return {
      color: resolvedMaterial.color,
      colorRgba: resolvedMaterial.colorRgba,
      opacity: resolvedMaterial.opacity,
      texture: resolvedMaterial.texture,
      source: 'legacy-link',
    };
  }

  if (visual.color) {
    return {
      color: visual.color,
      source: 'inline',
    };
  }

  return {
    source: 'none',
  };
}

function generateUrdfMaterialXml(
  material: UrdfVisualMaterial,
  indent: string,
  exportRobotName: string,
  useRelativePaths: boolean,
  preserveMeshPaths: boolean,
  texturePathOverrides?: ReadonlyMap<string, string>,
): string {
  const nameAttr = material.name ? ` name="${material.name}"` : '';
  let xml = `${indent}<material${nameAttr}>\n`;

  const colorRgba =
    material.color && material.color.trim()
      ? colorMatchesQuantizedRgba(material.color, material.colorRgba) &&
        material.opacity === undefined
        ? colorRgbaToUrdfRgba(material.colorRgba) ||
          hexToRgbaWithOpacity(material.color, material.colorRgba?.[3])
        : hexToRgbaWithOpacity(
            material.color,
            material.opacity ?? material.colorRgba?.[3],
          )
      : colorRgbaToUrdfRgba(material.colorRgba, material.opacity);

  if (colorRgba) {
    xml += `${indent}  <color rgba="${colorRgba}"/>\n`;
  }

  if (material.texture) {
    const texturePath = preserveMeshPaths
      ? material.texture.replace(/\\/g, '/')
      : resolveTextureExportPath(material.texture, texturePathOverrides);
    const textureFilename = preserveMeshPaths
      ? texturePath
      : useRelativePaths
        ? `textures/${texturePath || 'texture.png'}`
        : `package://${exportRobotName}/textures/${texturePath || 'texture.png'}`;
    xml += `${indent}  <texture filename="${textureFilename}" />\n`;
  }

  xml += `${indent}</material>\n`;
  return xml;
}

const generateLimitTag = (joint: UrdfJoint, formatScalar: (n: number) => string): string | null => {
  const jointType = String(joint.type).toLowerCase();
  if (!joint.limit) {
    return null;
  }
  const finiteAttribute = (name: string, value: number | undefined): string[] =>
    Number.isFinite(value) ? [`${name}="${formatScalar(Number(value))}"`] : [];
  const attributes = FULL_LIMIT_EXPORT_TYPES.has(jointType)
    ? [
        ...finiteAttribute('lower', joint.limit.lower),
        ...finiteAttribute('upper', joint.limit.upper),
        ...finiteAttribute('effort', joint.limit.effort),
        ...finiteAttribute('velocity', joint.limit.velocity),
      ]
    : EFFORT_VELOCITY_LIMIT_EXPORT_TYPES.has(jointType)
      ? [
          ...finiteAttribute('effort', joint.limit.effort),
          ...finiteAttribute('velocity', joint.limit.velocity),
        ]
      : [];

  if (attributes.length === 0) {
    return null;
  }
  if (FULL_LIMIT_EXPORT_TYPES.has(jointType)) {
    return `    <limit ${attributes.join(' ')} />`;
  }
  if (EFFORT_VELOCITY_LIMIT_EXPORT_TYPES.has(jointType)) {
    return `    <limit ${attributes.join(' ')} />`;
  }
  return null;
};

const generateCalibrationTag = (
  joint: UrdfJoint,
  formatScalar: (n: number) => string,
): string | null => {
  const referencePosition = Number.isFinite(joint.calibration?.referencePosition)
    ? joint.calibration!.referencePosition
    : Number.isFinite(joint.referencePosition)
      ? joint.referencePosition
      : undefined;
  const rising = Number.isFinite(joint.calibration?.rising) ? joint.calibration!.rising : undefined;
  const falling = Number.isFinite(joint.calibration?.falling)
    ? joint.calibration!.falling
    : undefined;
  const attributes = [
    ...(referencePosition !== undefined
      ? [`reference_position="${formatScalar(referencePosition)}"`]
      : []),
    ...(rising !== undefined ? [`rising="${formatScalar(rising)}"`] : []),
    ...(falling !== undefined ? [`falling="${formatScalar(falling)}"`] : []),
  ];

  if (attributes.length === 0) {
    return null;
  }

  return `    <calibration ${attributes.join(' ')} />`;
};

const generateSafetyControllerTag = (
  joint: UrdfJoint,
  formatScalar: (n: number) => string,
): string | null => {
  const attributes = [
    ...(Number.isFinite(joint.safetyController?.softLowerLimit)
      ? [`soft_lower_limit="${formatScalar(joint.safetyController!.softLowerLimit!)}"`]
      : []),
    ...(Number.isFinite(joint.safetyController?.softUpperLimit)
      ? [`soft_upper_limit="${formatScalar(joint.safetyController!.softUpperLimit!)}"`]
      : []),
    ...(Number.isFinite(joint.safetyController?.kPosition)
      ? [`k_position="${formatScalar(joint.safetyController!.kPosition!)}"`]
      : []),
    ...(Number.isFinite(joint.safetyController?.kVelocity)
      ? [`k_velocity="${formatScalar(joint.safetyController!.kVelocity!)}"`]
      : []),
  ];

  if (attributes.length === 0) {
    return null;
  }

  return `    <safety_controller ${attributes.join(' ')} />`;
};

const generateOriginTag = (
  origin: UrdfOrigin | undefined,
  indent: string,
  vecStr: (v: { x: number; y: number; z: number }) => string,
  rotStr: (v: { r: number; p: number; y: number }) => string,
  formatQuaternionScalar: (n: number) => string,
): string => {
  if (!origin) {
    return '';
  }

  const attributes = [`xyz="${vecStr(origin.xyz)}"`, `rpy="${rotStr(origin.rpy)}"`];

  if (origin.quatXyzw) {
    attributes.push(
      `quat_xyzw="${formatQuaternionScalar(origin.quatXyzw.x)} ${formatQuaternionScalar(origin.quatXyzw.y)} ${formatQuaternionScalar(origin.quatXyzw.z)} ${formatQuaternionScalar(origin.quatXyzw.w)}"`,
    );
  }

  return `${indent}<origin ${attributes.join(' ')} />\n`;
};

function generateCapsuleCompatibilityGeometryXml(
  dimensions: { x: number; y: number; z: number },
  formatShape: (n: number) => string,
): string {
  // Standard URDF / urdfdom do not support <capsule>, so emit the closest
  // compatible primitive while preserving the capsule's end-to-end extent.
  const radius = Math.max(dimensions.x || 0, 0);
  const bodyLength = Math.max(dimensions.y || 0, 0);
  return `        <cylinder radius="${formatShape(radius)}" length="${formatShape(bodyLength + radius * 2)}" />\n`;
}

function generateUrdfGeometryXml(
  geometry: UrdfLink['visual'] | UrdfLink['collision'],
  formatters: {
    vecStr: (v: { x: number; y: number; z: number }) => string;
    formatShape: (n: number) => string;
  },
  exportContext: {
    robotName: string;
    useRelativePaths: boolean;
    preserveMeshPaths: boolean;
    fallbackFileName: string;
    ownerName: string;
    kind: 'visual' | 'collision';
  },
): string {
  if (geometry.type === GeometryType.NONE) {
    return '';
  }

  if (geometry.type === GeometryType.PLANE) {
    // URDF has no <plane> element; emit a thin box preserving width/depth.
    const w = Math.max(geometry.dimensions.x || 0, 0);
    const d = Math.max(geometry.dimensions.y || 0, 0);
    return `        <box size="${formatters.formatShape(w)} ${formatters.formatShape(d)} 0.001" />\n`;
  }
  if (geometry.type === GeometryType.BOX) {
    return `        <box size="${formatters.vecStr(geometry.dimensions)}" />\n`;
  }
  if (geometry.type === GeometryType.CYLINDER) {
    return `        <cylinder radius="${formatters.formatShape(geometry.dimensions.x)}" length="${formatters.formatShape(geometry.dimensions.y)}" />\n`;
  }
  if (geometry.type === GeometryType.SPHERE) {
    return `        <sphere radius="${formatters.formatShape(geometry.dimensions.x)}" />\n`;
  }
  if (geometry.type === GeometryType.CAPSULE) {
    return generateCapsuleCompatibilityGeometryXml(geometry.dimensions, formatters.formatShape);
  }

  if (geometry.type === GeometryType.MESH) {
    const meshPath = geometry.meshPath
      ? exportContext.preserveMeshPaths
        ? geometry.meshPath.replace(/\\/g, '/')
        : normalizeMeshPathForExport(geometry.meshPath)
      : exportContext.fallbackFileName;
    const filename = exportContext.preserveMeshPaths
      ? meshPath || exportContext.fallbackFileName
      : exportContext.useRelativePaths
        ? `meshes/${meshPath || exportContext.fallbackFileName}`
        : `package://${exportContext.robotName}/meshes/${meshPath || exportContext.fallbackFileName}`;
    const scaleAttribute = formatUrdfMeshScaleAttribute(
      geometry.dimensions,
      formatters.formatShape,
    );
    return `        <mesh filename="${filename}"${scaleAttribute} />\n`;
  }

  // Remaining types (ELLIPSOID, HFIELD, SDF, etc.) have no URDF equivalent.
  // Downgrade to a bounding box using available dimensions.
  return `        <box size="${formatters.vecStr(geometry.dimensions)}" />\n`;
}

const generateCollisionElement = (
  collision: UrdfLink['collision'],
  vecStr: (v: { x: number; y: number; z: number }) => string,
  rotStr: (v: { r: number; p: number; y: number }) => string,
  formatQuaternionScalar: (n: number) => string,
  formatShape: (n: number) => string,
  exportRobotName: string,
  useRelativePaths: boolean = false,
  preserveMeshPaths: boolean = false,
): string => {
  if (!collision || collision.type === GeometryType.NONE) return '';

  const collisionNameAttr = collision.name ? ` name="${collision.name}"` : '';
  let xml = `    <collision${collisionNameAttr}>\n`;
  if (collision.origin) {
    xml += generateOriginTag(collision.origin, '      ', vecStr, rotStr, formatQuaternionScalar);
  }
  xml += `      <geometry>\n`;
  xml += generateUrdfGeometryXml(
    collision,
    { vecStr, formatShape },
    {
      robotName: exportRobotName,
      useRelativePaths,
      preserveMeshPaths,
      fallbackFileName: 'part_collision.stl',
      ownerName: collision.name || exportRobotName,
      kind: 'collision',
    },
  );
  xml += `      </geometry>\n`;
  if (collision.verbose) {
    xml += `      <verbose value="${collision.verbose}" />\n`;
  }
  xml += `    </collision>\n`;

  return xml;
};

export interface UrdfGeneratorOptions {
  extended?: boolean;
  includeHardware?: 'never' | 'auto' | 'always';
  useRelativePaths?: boolean;
  preserveMeshPaths?: boolean;
  omitMeshMaterialPaths?: Iterable<string>;
}

const DEFAULT_PARSED_HARDWARE = {
  armature: 0,
  brand: '',
  motorType: 'None',
  motorId: '',
  motorDirection: 1 as 1 | -1,
  hardwareInterface: undefined as 'effort' | 'position' | 'velocity' | undefined,
};

const hasExportableHardware = (joint: UrdfJoint): boolean => {
  const hardware = joint.hardware;
  if (!hardware) return false;

  return (
    (hardware.motorType?.trim() ?? '') !== DEFAULT_PARSED_HARDWARE.motorType ||
    (hardware.brand?.trim() ?? '') !== DEFAULT_PARSED_HARDWARE.brand ||
    (hardware.motorId?.trim() ?? '') !== DEFAULT_PARSED_HARDWARE.motorId ||
    (hardware.motorDirection ?? DEFAULT_PARSED_HARDWARE.motorDirection) !==
      DEFAULT_PARSED_HARDWARE.motorDirection ||
    (hardware.armature ?? DEFAULT_PARSED_HARDWARE.armature) !== DEFAULT_PARSED_HARDWARE.armature ||
    (hardware.hardwareInterface ?? DEFAULT_PARSED_HARDWARE.hardwareInterface) !==
      DEFAULT_PARSED_HARDWARE.hardwareInterface
  );
};

export const generateAssemblyURDF = (
  assembly: AssemblyState,
  options: UrdfGeneratorOptions = {},
): string => {
  const mergedData = mergeAssembly(assembly);
  return generateURDF(mergedData as unknown as RobotState, options);
};

export const generateURDF = (
  robot: RobotState,
  options: UrdfGeneratorOptions | boolean = false,
): string => {
  // Backward compat: accept boolean as legacy `extended` param
  const opts: UrdfGeneratorOptions = typeof options === 'boolean' ? { extended: options } : options;
  const hardwareMode = opts.includeHardware ?? ((opts.extended ?? false) ? 'always' : 'never');
  const useRelativePaths = opts.useRelativePaths ?? false;
  const preserveMeshPaths = opts.preserveMeshPaths ?? false;
  const omitMeshMaterialPaths = opts.omitMeshMaterialPaths
    ? new Set(
        Array.from(opts.omitMeshMaterialPaths, (path) => String(path || '').replace(/\\/g, '/')),
      )
    : null;
  const { name, version, links, joints } = robot;
  const exportRobotName = name?.trim() ? name : 'robot';
  const texturePathOverrides = buildTextureExportPathOverrides([
    ...Object.values(links).flatMap((link) => [
      ...getVisualGeometryEntries(link).flatMap((entry) =>
        collectGeometryTexturePaths(entry.geometry),
      ),
      ...collectGeometryTexturePaths(link.collision),
      ...(link.collisionBodies || []).flatMap((body) => collectGeometryTexturePaths(body)),
    ]),
    ...Object.values(robot.materials || {})
      .map((material) => material.texture)
      .filter((texture): texture is string => Boolean(texture)),
  ]);

  const robotVersionAttr = version ? ` version="${version}"` : '';
  let xml = `<?xml version="1.0"?>\n<robot name="${name}"${robotVersionAttr}>\n\n`;

  // Helper to format numbers
  const formatScalar = (n: number) => formatNumberWithMaxDecimals(n, MAX_PROPERTY_DECIMALS);
  const formatQuaternionScalar = (n: number) =>
    formatNumberWithMaxDecimals(n, MAX_PROPERTY_DECIMALS + 1);
  const formatShape = (n: number) =>
    formatNumberWithMaxDecimals(n, MAX_GEOMETRY_DIMENSION_DECIMALS);
  const vecStr = (v: { x: number; y: number; z: number }) =>
    `${formatScalar(v.x)} ${formatScalar(v.y)} ${formatScalar(v.z)}`;
  const rotStr = (v: { r: number; p: number; y: number }) =>
    `${formatScalar(v.r)} ${formatScalar(v.p)} ${formatScalar(v.y)}`;
  const shouldOmitMeshMaterial = (meshPath?: string): boolean => {
    if (!omitMeshMaterialPaths || !meshPath) {
      return false;
    }

    const normalizedPath = meshPath.replace(/\\/g, '/');
    if (omitMeshMaterialPaths.has(normalizedPath)) {
      return true;
    }

    const exportPath = normalizeMeshPathForExport(meshPath);
    return Boolean(exportPath && omitMeshMaterialPaths.has(exportPath));
  };

  // Generate Links
  Object.values(links).forEach((link) => {
    const linkTypeAttr = link.type ? ` type="${link.type}"` : '';
    xml += `  <link name="${link.name}"${linkTypeAttr}>\n`;

    const visualEntries = getVisualGeometryEntries(link);
    visualEntries.forEach((entry, index) => {
      const visual = entry.geometry;
      const visualMaterial = resolveLinkExportMaterial(robot, link, visual, {
        isPrimaryVisual: entry.bodyIndex === null,
      });
      const authoredMaterials =
        visualMaterial.source === 'authored' ? visualMaterial.authoredMaterials : undefined;
      const visualNameAttr = visual.name ? ` name="${visual.name}"` : '';
      xml += `    <visual${visualNameAttr}>\n`;
      if (visual.origin) {
        xml += generateOriginTag(visual.origin, '      ', vecStr, rotStr, formatQuaternionScalar);
      }

      xml += `      <geometry>\n`;
      xml += generateUrdfGeometryXml(
        visual,
        { vecStr, formatShape },
        {
          robotName: exportRobotName,
          useRelativePaths,
          preserveMeshPaths,
          fallbackFileName: 'part.stl',
          ownerName: visual.name || link.name,
          kind: 'visual',
        },
      );
      xml += `      </geometry>\n`;
      const shouldEmitVisualColor = !(
        visual.type === GeometryType.MESH && shouldOmitMeshMaterial(visual.meshPath)
      );
      if (shouldEmitVisualColor && authoredMaterials && authoredMaterials.length > 0) {
        authoredMaterials.forEach((material) => {
          xml += generateUrdfMaterialXml(
            material,
            '      ',
            exportRobotName,
            useRelativePaths,
            preserveMeshPaths,
            texturePathOverrides,
          );
        });
      } else if (
        (shouldEmitVisualColor && (visualMaterial.color || visualMaterial.colorRgba)) ||
        visualMaterial.texture
      ) {
        xml += generateUrdfMaterialXml(
          {
            name: index === 0 ? `${link.id}_mat` : `${link.id}_mat_${index}`,
            color: shouldEmitVisualColor ? visualMaterial.color : undefined,
            colorRgba: shouldEmitVisualColor ? visualMaterial.colorRgba : undefined,
            opacity: shouldEmitVisualColor ? visualMaterial.opacity : undefined,
            texture: visualMaterial.texture,
          },
          '      ',
          exportRobotName,
          useRelativePaths,
          preserveMeshPaths,
          texturePathOverrides,
        );
      }
      xml += `    </visual>\n`;
    });

    // Collision (primary + additional bodies on the same link)
    xml += generateCollisionElement(
      link.collision,
      vecStr,
      rotStr,
      formatQuaternionScalar,
      formatShape,
      exportRobotName,
      useRelativePaths,
      preserveMeshPaths,
    );
    (link.collisionBodies || []).forEach((collisionBody: UrdfLink['collision']) => {
      xml += generateCollisionElement(
        collisionBody,
        vecStr,
        rotStr,
        formatQuaternionScalar,
        formatShape,
        exportRobotName,
        useRelativePaths,
        preserveMeshPaths,
      );
    });

    // Inertial
    if (hasExportableInertial(link) && link.inertial) {
      xml += `    <inertial>\n`;
      if (link.inertial.origin) {
        xml += generateOriginTag(
          link.inertial.origin,
          '      ',
          vecStr,
          rotStr,
          formatQuaternionScalar,
        );
      }
      xml += `      <mass value="${formatScalar(link.inertial.mass)}" />\n`;
      xml += `      <inertia ixx="${formatScalar(link.inertial.inertia.ixx)}" ixy="${formatScalar(link.inertial.inertia.ixy)}" ixz="${formatScalar(link.inertial.inertia.ixz)}" iyy="${formatScalar(link.inertial.inertia.iyy)}" iyz="${formatScalar(link.inertial.inertia.iyz)}" izz="${formatScalar(link.inertial.inertia.izz)}" />\n`;
      xml += `    </inertial>\n`;
    }
    xml += `  </link>\n\n`;
  });

  // Generate Joints
  Object.values(joints).forEach((joint) => {
    const parent = links[joint.parentLinkId];
    const child = links[joint.childLinkId];
    if (!parent || !child) return;
    const jointType = String(joint.type).toLowerCase();
    const unsupportedJoint = findUnsupportedUrdfJoint({ joints: { [joint.id]: joint } });
    if (unsupportedJoint) {
      throw createUnsupportedUrdfJointError(unsupportedJoint.jointName, unsupportedJoint.jointType);
    }

    xml += `  <joint name="${joint.name}" type="${joint.type}">\n`;
    xml += `    <parent link="${parent.name}" />\n`;
    xml += `    <child link="${child.name}" />\n`;
    xml += generateOriginTag(joint.origin, '    ', vecStr, rotStr, formatQuaternionScalar);
    if (AXIS_EXPORT_TYPES.has(jointType) && joint.axis) {
      xml += `    <axis xyz="${vecStr(joint.axis)}" />\n`;
    }

    const calibrationTag = generateCalibrationTag(joint, formatScalar);
    if (calibrationTag) {
      xml += `${calibrationTag}\n`;
    }

    const limitTag = generateLimitTag(joint, formatScalar);
    if (limitTag) {
      xml += `${limitTag}\n`;
    }

    const safetyControllerTag = generateSafetyControllerTag(joint, formatScalar);
    if (safetyControllerTag) {
      xml += `${safetyControllerTag}\n`;
    }

    if (DYNAMICS_EXPORT_TYPES.has(jointType)) {
      if (joint.dynamics && (joint.dynamics.damping !== 0 || joint.dynamics.friction !== 0)) {
        xml += `    <dynamics damping="${formatScalar(joint.dynamics.damping)}" friction="${formatScalar(joint.dynamics.friction)}" />\n`;
      }
    }

    if (DYNAMICS_EXPORT_TYPES.has(jointType)) {
      const shouldExportHardware =
        joint.hardware &&
        (hardwareMode === 'always' || (hardwareMode === 'auto' && hasExportableHardware(joint)));

      if (shouldExportHardware) {
        xml += `    <hardware>\n`;
        if (joint.hardware.brand) xml += `      <brand>${joint.hardware.brand}</brand>\n`;
        if (joint.hardware.motorType)
          xml += `      <motorType>${joint.hardware.motorType}</motorType>\n`;
        if (joint.hardware.motorId) xml += `      <motorId>${joint.hardware.motorId}</motorId>\n`;
        if (joint.hardware.motorDirection)
          xml += `      <motorDirection>${joint.hardware.motorDirection}</motorDirection>\n`;
        if (joint.hardware.armature !== undefined)
          xml += `      <armature>${formatScalar(joint.hardware.armature)}</armature>\n`;
        if (joint.hardware.hardwareInterface) {
          xml += `      <hardwareInterface>${joint.hardware.hardwareInterface}</hardwareInterface>\n`;
        }
        xml += `    </hardware>\n`;
      }
    }

    if (joint.mimic?.joint) {
      const targetJointId = resolveJointKey(joints, joint.mimic.joint);
      const targetJoint = targetJointId ? joints[targetJointId] : undefined;
      const targetJointName = targetJoint?.name || joint.mimic.joint;
      const mimicAttributes = [`joint="${targetJointName}"`];
      if (typeof joint.mimic.multiplier === 'number' && Number.isFinite(joint.mimic.multiplier)) {
        mimicAttributes.push(`multiplier="${formatScalar(joint.mimic.multiplier)}"`);
      }
      if (typeof joint.mimic.offset === 'number' && Number.isFinite(joint.mimic.offset)) {
        mimicAttributes.push(`offset="${formatScalar(joint.mimic.offset)}"`);
      }
      xml += `    <mimic ${mimicAttributes.join(' ')} />\n`;
    }
    xml += `  </joint>\n\n`;
  });

  xml += `</robot>`;
  return xml;
};

export type RosHardwareInterface = 'effort' | 'position' | 'velocity';
export type RosGazeboProfile = 'ros1' | 'ros2' | 'ros2_gz';
export type GazeboControlOutputMode = 'parameterized' | 'selected';

export interface InjectGazeboTagsOptions {
  outputMode?: GazeboControlOutputMode;
}

/**
 * Generate ROS1 <transmission> tags for non-fixed joints.
 * These are appended inside the <robot> element before the closing tag.
 */
export const generateRos1Transmissions = (
  robot: RobotState,
  hwInterface: RosHardwareInterface = 'effort',
): string => {
  const { joints } = robot;
  const ifName =
    hwInterface === 'effort'
      ? 'hardware_interface/EffortJointInterface'
      : hwInterface === 'position'
        ? 'hardware_interface/PositionJointInterface'
        : 'hardware_interface/VelocityJointInterface';

  let xml = '';
  Object.values(joints).forEach((j) => {
    const jType = String(j.type).toLowerCase();
    if (jType === 'fixed') return;
    xml += `  <transmission name="${j.name}_trans">\n`;
    xml += `    <type>transmission_interface/SimpleTransmission</type>\n`;
    xml += `    <joint name="${j.name}">\n`;
    xml += `      <hardwareInterface>${ifName}</hardwareInterface>\n`;
    xml += `    </joint>\n`;
    xml += `    <actuator name="${j.name}_motor">\n`;
    xml += `      <hardwareInterface>${ifName}</hardwareInterface>\n`;
    xml += `      <mechanicalReduction>1</mechanicalReduction>\n`;
    xml += `    </actuator>\n`;
    xml += `  </transmission>\n\n`;
  });
  return xml;
};

function resolveRos1GazeboNamespace(robotName?: string): string {
  const normalizedName = String(robotName || 'robot').trim() || 'robot';
  const namespaceRoot = normalizedName.replace(/_description$/i, '') || 'robot';
  return `/${namespaceRoot}_gazebo`;
}

export const generateRos1Control = (
  robot: RobotState,
  hwInterface: RosHardwareInterface = 'effort',
  robotName?: string,
): string => {
  const controlName = robotName || robot.name || 'robot';
  let xml = generateRos1Transmissions(robot, hwInterface);
  xml += `  <gazebo>\n`;
  xml += `    <plugin name="gazebo_ros_control" filename="libgazebo_ros_control.so">\n`;
  xml += `      <robotNamespace>${resolveRos1GazeboNamespace(controlName)}</robotNamespace>\n`;
  xml += `      <robotSimType>gazebo_ros_control/DefaultRobotHWSim</robotSimType>\n`;
  xml += `    </plugin>\n`;
  xml += `  </gazebo>\n`;
  return xml;
};

/**
 * Generate ROS2 <ros2_control> block + Gazebo plugin tag.
 * These are appended inside the <robot> element before the closing tag.
 */
export const generateRos2Control = (
  robot: RobotState,
  hwInterface: RosHardwareInterface = 'effort',
  robotName?: string,
): string => {
  const { joints, name } = robot;
  const ctrlName = robotName || name || 'robot';
  const cmdIf =
    hwInterface === 'position' ? 'position' : hwInterface === 'velocity' ? 'velocity' : 'effort';

  let xml = `  <ros2_control name="${ctrlName}" type="system">\n`;
  xml += `    <hardware>\n`;
  xml += `      <plugin>gazebo_ros2_control/GazeboSystem</plugin>\n`;
  xml += `    </hardware>\n`;

  Object.values(joints).forEach((j) => {
    const jType = String(j.type).toLowerCase();
    if (jType === 'fixed') return;
    xml += `    <joint name="${j.name}">\n`;
    xml += `      <command_interface name="${cmdIf}"/>\n`;
    xml += `      <state_interface name="position"/>\n`;
    xml += `      <state_interface name="velocity"/>\n`;
    if (cmdIf === 'effort') {
      xml += `      <state_interface name="effort"/>\n`;
    }
    xml += `    </joint>\n`;
  });

  xml += `  </ros2_control>\n\n`;

  xml += `  <gazebo>\n`;
  xml += `    <plugin name="gazebo_ros2_control" filename="libgazebo_ros2_control.so">\n`;
  xml += `      <robot_param>robot_description</robot_param>\n`;
  xml += `      <robot_param_node>robot_state_publisher</robot_param_node>\n`;
  xml += `    </plugin>\n`;
  xml += `  </gazebo>\n`;

  return xml;
};

/**
 * Generate ROS2 ros2_control block + modern Gazebo (gz-sim) plugin tag.
 */
export const generateRos2GzControl = (
  robot: RobotState,
  hwInterface: RosHardwareInterface = 'effort',
  robotName?: string,
): string => {
  const { joints, name } = robot;
  const ctrlName = robotName || name || 'robot';
  const cmdIf =
    hwInterface === 'position' ? 'position' : hwInterface === 'velocity' ? 'velocity' : 'effort';

  let xml = `  <ros2_control name="${ctrlName}" type="system">\n`;
  xml += `    <hardware>\n`;
  xml += `      <plugin>gz_ros2_control/GazeboSimSystem</plugin>\n`;
  xml += `    </hardware>\n`;

  Object.values(joints).forEach((j) => {
    const jType = String(j.type).toLowerCase();
    if (jType === 'fixed') return;
    xml += `    <joint name="${j.name}">\n`;
    xml += `      <command_interface name="${cmdIf}"/>\n`;
    xml += `      <state_interface name="position"/>\n`;
    xml += `      <state_interface name="velocity"/>\n`;
    if (cmdIf === 'effort') {
      xml += `      <state_interface name="effort"/>\n`;
    }
    xml += `    </joint>\n`;
  });

  xml += `  </ros2_control>\n\n`;

  xml += `  <gazebo>\n`;
  xml += `    <plugin filename="libgz_ros2_control-system.so" name="gz_ros2_control::GazeboSimROS2ControlPlugin">\n`;
  xml += `    </plugin>\n`;
  xml += `  </gazebo>\n`;

  return xml;
};

export const ensureXacroNamespace = (xml: string): string => {
  if (/xmlns:xacro\s*=/.test(xml)) {
    return xml;
  }

  return xml.replace(/<robot\b([^>]*)>/, (_match, attrs: string) => {
    const separator = attrs.trim().length > 0 ? ' ' : '';
    return `<robot${attrs}${separator}xmlns:xacro="http://www.ros.org/wiki/xacro">`;
  });
};

function indentXmlBlock(content: string, indent: string): string {
  return content
    .split('\n')
    .map((line) => (line.length > 0 ? `${indent}${line}` : line))
    .join('\n');
}

function generateProfileParameterizedXacro(
  robot: RobotState,
  defaultRosVersion: RosGazeboProfile,
  hwInterface: RosHardwareInterface = 'effort',
): string {
  const rosVersions: RosGazeboProfile[] = ['ros1', 'ros2', 'ros2_gz'];
  const hwInterfaces: RosHardwareInterface[] = ['effort', 'position', 'velocity'];
  const branches = rosVersions.flatMap((rosVersion) =>
    hwInterfaces.map((hardwareInterface) => {
      const block =
        rosVersion === 'ros1'
          ? generateRos1Control(robot, hardwareInterface)
          : rosVersion === 'ros2_gz'
            ? generateRos2GzControl(robot, hardwareInterface)
            : generateRos2Control(robot, hardwareInterface);
      return [
        `  <xacro:if value="\${xacro.arg('ros_profile') == '${rosVersion}' and xacro.arg('ros_hardware_interface') == '${hardwareInterface}'}">`,
        indentXmlBlock(block, '    '),
        `  </xacro:if>`,
        '',
      ].join('\n');
    }),
  );

  return [
    `  <xacro:arg name="ros_profile" default="${defaultRosVersion}" />`,
    `  <xacro:arg name="ros_hardware_interface" default="${hwInterface}" />`,
    '',
    ...branches,
  ].join('\n');
}

/**
 * Inject ROS1 or ROS2 Gazebo tags into an already-generated URDF string.
 * Inserts the extra XML just before the closing </robot> tag.
 */
export const injectGazeboTags = (
  urdfXml: string,
  robot: RobotState,
  rosVersion: RosGazeboProfile,
  hwInterface: RosHardwareInterface = 'effort',
  options: InjectGazeboTagsOptions = {},
): string => {
  const outputMode = options.outputMode ?? 'parameterized';
  const extra =
    outputMode === 'selected'
      ? rosVersion === 'ros1'
        ? generateRos1Control(robot, hwInterface)
        : rosVersion === 'ros2_gz'
          ? generateRos2GzControl(robot, hwInterface)
        : generateRos2Control(robot, hwInterface)
      : generateProfileParameterizedXacro(robot, rosVersion, hwInterface);
  return ensureXacroNamespace(urdfXml).replace(/(<\/robot>)\s*$/, `\n${extra}</robot>`);
};
