import * as THREE from 'three';
import {
  DEFAULT_LINK,
  GeometryType,
  JointType,
  type Euler,
  type RobotState,
  type UrdfJoint,
  type UrdfLink,
  type Vector3,
} from '@/types';
import { getTreeDisplayRootLinkIds } from '@/core/robot';
import {
  MAX_GEOMETRY_DIMENSION_DECIMALS,
  MAX_PROPERTY_DECIMALS,
  formatNumberWithMaxDecimals,
} from '@/core/utils/numberPrecision';
import { normalizeMeshPathForExport } from '../meshPathUtils';

export interface SkeletonExportOptions {
  meshdir?: string;
  includeMeshes?: boolean;
  includeActuators?: boolean;
}

const ZERO_VECTOR: Vector3 = { x: 0, y: 0, z: 0 };
const ZERO_EULER: Euler = { r: 0, p: 0, y: 0 };
const MIN_INERTIAL_MASS = 1e-6;
const MIN_INERTIAL_DIAG = 1e-8;

function escapeXmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function hasRotation(rotation?: Euler): boolean {
  if (!rotation) {
    return false;
  }

  return Math.abs(rotation.r) > 1e-9 || Math.abs(rotation.p) > 1e-9 || Math.abs(rotation.y) > 1e-9;
}

function hexToRgba(color: string | undefined): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color ?? '');
  if (!result) {
    return '0.7 0.7 0.7 1';
  }

  return `${formatNumberWithMaxDecimals(parseInt(result[1], 16) / 255, 4)} ${formatNumberWithMaxDecimals(parseInt(result[2], 16) / 255, 4)} ${formatNumberWithMaxDecimals(parseInt(result[3], 16) / 255, 4)} 1`;
}

function buildChildJointMap(robot: RobotState): Map<string, UrdfJoint[]> {
  const childJointMap = new Map<string, UrdfJoint[]>();

  Object.values(robot.joints)
    .filter((joint) => Boolean(robot.links[joint.parentLinkId] && robot.links[joint.childLinkId]))
    .sort((left, right) => left.name.localeCompare(right.name))
    .forEach((joint) => {
      const joints = childJointMap.get(joint.parentLinkId) ?? [];
      joints.push(joint);
      childJointMap.set(joint.parentLinkId, joints);
    });

  return childJointMap;
}

function buildParentJointMap(robot: RobotState): Map<string, UrdfJoint> {
  return new Map(
    Object.values(robot.joints)
      .filter((joint) => Boolean(robot.links[joint.parentLinkId] && robot.links[joint.childLinkId]))
      .map((joint) => [joint.childLinkId, joint]),
  );
}

function collectMeshAssets(robot: RobotState, includeMeshes: boolean): string[] {
  if (!includeMeshes) {
    return [];
  }

  const meshAssets = new Set<string>();

  Object.values(robot.links).forEach((link) => {
    [link.visual, link.collision, ...(link.collisionBodies || [])].forEach((geometry) => {
      if ((geometry.type !== GeometryType.MESH && geometry.type !== GeometryType.SDF) || !geometry.meshPath) {
        return;
      }

      const normalized = normalizeMeshPathForExport(geometry.meshPath);
      if (normalized) {
        meshAssets.add(normalized);
      }
    });
  });

  return Array.from(meshAssets).sort();
}

interface HfieldAssetEntry {
  key: string;
  name: string;
  file?: string;
  contentType?: string;
  nrow?: number;
  ncol?: number;
  size: [number, number, number, number];
  elevation?: number[];
}

function normalizeHfieldSize(geometry: UrdfLink['visual']): [number, number, number, number] | null {
  const size = geometry.mjcfHfield?.size;
  if (!size) {
    return null;
  }

  return [size.radiusX, size.radiusY, size.elevationZ, size.baseZ];
}

function buildHfieldAssetKey(geometry: UrdfLink['visual']): string | null {
  const size = normalizeHfieldSize(geometry);
  if (!size) {
    return null;
  }

  return JSON.stringify({
    assetRef: geometry.assetRef || geometry.mjcfHfield?.name || '',
    file: geometry.mjcfHfield?.file || '',
    contentType: geometry.mjcfHfield?.contentType || '',
    nrow: geometry.mjcfHfield?.nrow ?? null,
    ncol: geometry.mjcfHfield?.ncol ?? null,
    size,
    elevation: geometry.mjcfHfield?.elevation || [],
  });
}

function collectHfieldAssets(robot: RobotState): HfieldAssetEntry[] {
  const hfieldAssets = new Map<string, HfieldAssetEntry>();
  const usedNames = new Set<string>();
  const buildAssetName = (link: UrdfLink, geometry: UrdfLink['visual']) => {
    const base = (geometry.assetRef || geometry.mjcfHfield?.name || `${link.name || link.id}_hfield`)
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/^_+|_+$/g, '') || 'hfield';
    let candidate = base;
    let suffix = 2;
    while (usedNames.has(candidate)) {
      candidate = `${base}_${suffix}`;
      suffix += 1;
    }
    usedNames.add(candidate);
    return candidate;
  };

  const register = (link: UrdfLink, geometry: UrdfLink['visual']) => {
    if (geometry.type !== GeometryType.HFIELD) {
      return;
    }

    const key = buildHfieldAssetKey(geometry);
    const size = normalizeHfieldSize(geometry);
    if (!key || !size || hfieldAssets.has(key)) {
      return;
    }

    hfieldAssets.set(key, {
      key,
      name: buildAssetName(link, geometry),
      file: geometry.mjcfHfield?.file,
      contentType: geometry.mjcfHfield?.contentType,
      nrow: geometry.mjcfHfield?.nrow,
      ncol: geometry.mjcfHfield?.ncol,
      size,
      elevation: geometry.mjcfHfield?.elevation ? [...geometry.mjcfHfield.elevation] : undefined,
    });
  };

  Object.values(robot.links).forEach((link) => {
    [link.visual, link.collision, ...(link.collisionBodies || [])].forEach((geometry) => {
      register(link, geometry);
    });
  });

  return Array.from(hfieldAssets.values());
}

function buildMeshAssetNameMap(meshAssets: string[]): Map<string, string> {
  const meshAssetNameMap = new Map<string, string>();
  const usedNames = new Set<string>();

  const buildMeshAssetName = (meshPath: string): string => {
    const baseName = meshPath
      .replace(/\.[^/.]+$/, '')
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/^_+|_+$/g, '') || 'mesh';

    let candidate = baseName;
    let suffix = 2;
    while (usedNames.has(candidate)) {
      candidate = `${baseName}_${suffix}`;
      suffix += 1;
    }

    usedNames.add(candidate);
    return candidate;
  };

  meshAssets.forEach((meshPath) => {
    meshAssetNameMap.set(meshPath, buildMeshAssetName(meshPath));
  });

  return meshAssetNameMap;
}

function hasFiniteJointRange(joint: UrdfJoint): boolean {
  return Boolean(
    joint.limit
    && Number.isFinite(joint.limit.lower)
    && Number.isFinite(joint.limit.upper),
  );
}

function buildVisualGeometry(link: UrdfLink): UrdfLink['visual'] | null {
  if (link.visual.type !== GeometryType.NONE) {
    return link.visual;
  }

  if (link.collision.type !== GeometryType.NONE) {
    return link.collision;
  }

  return link.collisionBodies?.find((geometry) => geometry.type !== GeometryType.NONE) ?? null;
}

export const generateSkeletonXML = (robot: RobotState, options: SkeletonExportOptions = {}): string => {
  const meshdir = options.meshdir ?? 'meshes/';
  const includeMeshes = options.includeMeshes ?? true;
  const includeActuators = options.includeActuators ?? true;
  const formatScalar = (value: number) => formatNumberWithMaxDecimals(value, MAX_PROPERTY_DECIMALS);
  const formatShape = (value: number) => formatNumberWithMaxDecimals(value, MAX_GEOMETRY_DIMENSION_DECIMALS);
  const vecStr = (vector: Vector3 = ZERO_VECTOR) =>
    `${formatScalar(vector.x ?? 0)} ${formatScalar(vector.y ?? 0)} ${formatScalar(vector.z ?? 0)}`;
  const quatStr = (rotation: Euler = ZERO_EULER) => {
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation.r ?? 0, rotation.p ?? 0, rotation.y ?? 0, 'ZYX'));
    return `${formatScalar(quaternion.w)} ${formatScalar(quaternion.x)} ${formatScalar(quaternion.y)} ${formatScalar(quaternion.z)}`;
  };

  const meshAssets = collectMeshAssets(robot, includeMeshes);
  const hfieldAssets = collectHfieldAssets(robot);
  const meshAssetNameMap = buildMeshAssetNameMap(meshAssets);
  const childJointMap = buildChildJointMap(robot);
  const parentJointMap = buildParentJointMap(robot);
  const rootLinkIds = getTreeDisplayRootLinkIds(robot)
    .filter((linkId) => Boolean(robot.links[linkId]))
    .sort((left, right) => robot.links[left].name.localeCompare(robot.links[right].name));
  const exportRootLinkIds =
    rootLinkIds.length > 0
      ? rootLinkIds
      : [robot.rootLinkId, ...Object.keys(robot.links).sort()].filter((linkId, index, list) => Boolean(robot.links[linkId]) && list.indexOf(linkId) === index).slice(0, 1);

  const resolveMeshAssetName = (meshPath?: string): string | null => {
    if (!meshPath || !includeMeshes) {
      return null;
    }

    const normalized = normalizeMeshPathForExport(meshPath);
    if (!normalized) {
      return null;
    }

    return meshAssetNameMap.get(normalized) ?? null;
  };

  const hfieldAssetNameMap = new Map(hfieldAssets.map((entry) => [entry.key, entry.name] as const));
  const resolveHfieldAssetName = (geometry: UrdfLink['visual']): string | null => {
    const key = buildHfieldAssetKey(geometry);
    if (!key) {
      return null;
    }

    return hfieldAssetNameMap.get(key) ?? null;
  };

  const buildInertialXml = (link: UrdfLink, indent: string): string => {
    const inertial = link.inertial ?? DEFAULT_LINK.inertial;
    const origin = inertial.origin ?? { xyz: ZERO_VECTOR, rpy: ZERO_EULER };
    const mass = inertial.mass > 0 ? inertial.mass : MIN_INERTIAL_MASS;
    const ixx = Math.max(Math.abs(inertial.inertia.ixx || 0), MIN_INERTIAL_DIAG);
    const iyy = Math.max(Math.abs(inertial.inertia.iyy || 0), MIN_INERTIAL_DIAG);
    const izz = Math.max(Math.abs(inertial.inertia.izz || 0), MIN_INERTIAL_DIAG);
    const quatAttribute = hasRotation(origin.rpy) ? ` quat="${quatStr(origin.rpy)}"` : '';

    return `${indent}<inertial pos="${vecStr(origin.xyz)}"${quatAttribute} mass="${formatScalar(mass)}" diaginertia="${formatScalar(ixx)} ${formatScalar(iyy)} ${formatScalar(izz)}"/>\n`;
  };

  const buildJointXml = (joint: UrdfJoint, indent: string): string => {
    if (joint.type === JointType.FIXED) {
      return '';
    }

    const jointType =
      joint.type === JointType.PRISMATIC
        ? 'slide'
        : joint.type === JointType.REVOLUTE || joint.type === JointType.CONTINUOUS
          ? 'hinge'
          : null;

    if (!jointType) {
      return '';
    }

    const rangeAttribute =
      joint.type === JointType.CONTINUOUS || !hasFiniteJointRange(joint)
        ? ''
        : ` range="${formatScalar(Number(joint.limit!.lower))} ${formatScalar(Number(joint.limit!.upper))}"`;
    const effortAttribute =
      (joint.limit?.effort ?? 0) > 0
        ? ` actuatorfrcrange="${formatScalar(-(joint.limit?.effort ?? 0))} ${formatScalar(joint.limit?.effort ?? 0)}"`
        : '';

    return `${indent}<joint name="${escapeXmlAttribute(joint.name)}" pos="0 0 0" type="${jointType}" axis="${vecStr(joint.axis)}"${rangeAttribute}${effortAttribute}/>\n`;
  };

  const buildGeomXml = (link: UrdfLink, indent: string): string => {
    const geometry = buildVisualGeometry(link);
    if (!geometry) {
      return '';
    }

    const position = geometry.origin?.xyz ?? ZERO_VECTOR;
    const rotation = geometry.origin?.rpy ?? ZERO_EULER;
    const attributes = [
      `pos="${vecStr(position)}"`,
      hasRotation(rotation) ? `quat="${quatStr(rotation)}"` : '',
      'contype="0"',
      'conaffinity="0"',
      'group="1"',
      'density="0"',
      `rgba="${hexToRgba(geometry.color)}"`,
    ].filter(Boolean);

    if (geometry.type === GeometryType.BOX) {
      return `${indent}<geom ${attributes.join(' ')} type="box" size="${formatShape(geometry.dimensions.x / 2)} ${formatShape(geometry.dimensions.y / 2)} ${formatShape(geometry.dimensions.z / 2)}"/>\n`;
    }

    if (geometry.type === GeometryType.PLANE) {
      return `${indent}<geom ${attributes.join(' ')} type="plane" size="${formatShape(geometry.dimensions.x / 2)} ${formatShape(geometry.dimensions.y / 2)} 0.1"/>\n`;
    }

    if (geometry.type === GeometryType.CYLINDER) {
      return `${indent}<geom ${attributes.join(' ')} type="cylinder" size="${formatShape(geometry.dimensions.x)} ${formatShape(geometry.dimensions.y / 2)}"/>\n`;
    }

    if (geometry.type === GeometryType.SPHERE) {
      return `${indent}<geom ${attributes.join(' ')} type="sphere" size="${formatShape(geometry.dimensions.x)}"/>\n`;
    }

    if (geometry.type === GeometryType.ELLIPSOID) {
      return `${indent}<geom ${attributes.join(' ')} type="ellipsoid" size="${formatShape(geometry.dimensions.x)} ${formatShape(geometry.dimensions.y)} ${formatShape(geometry.dimensions.z)}"/>\n`;
    }

    if (geometry.type === GeometryType.CAPSULE) {
      return `${indent}<geom ${attributes.join(' ')} type="capsule" size="${formatShape(geometry.dimensions.x)} ${formatShape(geometry.dimensions.y / 2)}"/>\n`;
    }

    if (geometry.type === GeometryType.HFIELD) {
      const hfieldName = resolveHfieldAssetName(geometry);
      if (!hfieldName) {
        throw new Error(`[MJCF skeleton export] Height field geometry on link "${link.name}" is missing MJCF hfield asset metadata.`);
      }
      return `${indent}<geom ${attributes.join(' ')} type="hfield" hfield="${escapeXmlAttribute(hfieldName)}"/>\n`;
    }

    if (geometry.type === GeometryType.SDF) {
      const meshName = resolveMeshAssetName(geometry.meshPath);
      const fallbackMeshRef = geometry.assetRef;
      if (meshName) {
        return `${indent}<geom ${attributes.join(' ')} type="sdf" mesh="${escapeXmlAttribute(meshName)}"/>\n`;
      }
      if (fallbackMeshRef) {
        return `${indent}<geom ${attributes.join(' ')} type="sdf" mesh="${escapeXmlAttribute(fallbackMeshRef)}"/>\n`;
      }
      throw new Error(`[MJCF skeleton export] Signed distance field geometry on link "${link.name}" is missing a mesh asset reference.`);
    }

    if (geometry.type === GeometryType.MESH) {
      const meshName = resolveMeshAssetName(geometry.meshPath);
      if (meshName) {
        return `${indent}<geom ${attributes.join(' ')} type="mesh" mesh="${escapeXmlAttribute(meshName)}"/>\n`;
      }
    }

    return '';
  };

  const buildBodyXml = (linkId: string, indent: string, isRootBody: boolean, path = new Set<string>()): string => {
    if (path.has(linkId)) {
      return '';
    }

    const link = robot.links[linkId];
    if (!link) {
      return '';
    }

    const nextPath = new Set(path);
    nextPath.add(linkId);

    const parentJoint = parentJointMap.get(linkId);
    const bodyPosition = parentJoint?.origin.xyz ?? ZERO_VECTOR;
    const bodyRotation = parentJoint?.origin.rpy ?? ZERO_EULER;
    const bodyAttributes = [`name="${escapeXmlAttribute(link.name)}"`];

    if (bodyPosition.x !== 0 || bodyPosition.y !== 0 || bodyPosition.z !== 0) {
      bodyAttributes.push(`pos="${vecStr(bodyPosition)}"`);
    }

    if (hasRotation(bodyRotation)) {
      bodyAttributes.push(`quat="${quatStr(bodyRotation)}"`);
    }

    let xml = `${indent}<body ${bodyAttributes.join(' ')}>\n`;
    xml += buildInertialXml(link, `${indent}  `);

    if (isRootBody) {
      xml += `${indent}  <freejoint name="${escapeXmlAttribute(link.name)}"/>\n`;
    } else if (parentJoint) {
      xml += buildJointXml(parentJoint, `${indent}  `);
    }

    xml += buildGeomXml(link, `${indent}  `);

    for (const childJoint of childJointMap.get(linkId) ?? []) {
      xml += buildBodyXml(childJoint.childLinkId, `${indent}  `, false, nextPath);
    }

    xml += `${indent}</body>\n`;
    return xml;
  };

  const modelName = escapeXmlAttribute(`${robot.name || 'robot'}_skeleton`);
  let xml = `<mujoco model="${modelName}">\n`;
  xml += `  <compiler angle="radian" meshdir="${escapeXmlAttribute(meshdir)}"/>\n\n`;
  xml += `  <default>\n`;
  xml += `    <motor ctrlrange="-1 1" ctrllimited="true"/>\n`;
  xml += `    <joint actuatorfrclimited="true" type="hinge"/>\n`;
  xml += `  </default>\n\n`;

  if (meshAssets.length > 0 || hfieldAssets.length > 0) {
    xml += `  <asset>\n`;
    meshAssets.forEach((meshPath) => {
      const meshName = meshAssetNameMap.get(meshPath);
      if (!meshName) {
        return;
      }

      xml += `    <mesh name="${escapeXmlAttribute(meshName)}" file="${escapeXmlAttribute(meshPath)}"/>\n`;
    });
    hfieldAssets.forEach(({ name, file, contentType, nrow, ncol, size, elevation }) => {
      const attrs = [
        `name="${escapeXmlAttribute(name)}"`,
        file ? `file="${escapeXmlAttribute(file)}"` : '',
        contentType ? `content_type="${escapeXmlAttribute(contentType)}"` : '',
        !file && Number.isFinite(nrow) ? `nrow="${nrow}"` : '',
        !file && Number.isFinite(ncol) ? `ncol="${ncol}"` : '',
        `size="${formatShape(size[0])} ${formatShape(size[1])} ${formatShape(size[2])} ${formatShape(size[3])}"`,
        !file && elevation && elevation.length > 0
          ? `elevation="${elevation.map((value) => formatShape(value)).join(' ')}"`
          : '',
      ].filter(Boolean);
      xml += `    <hfield ${attrs.join(' ')} />\n`;
    });
    xml += `  </asset>\n\n`;
  }

  xml += `  <worldbody>\n`;
  exportRootLinkIds.forEach((rootLinkId) => {
    xml += buildBodyXml(rootLinkId, '    ', true);
  });
  xml += `  </worldbody>\n`;

  if (includeActuators) {
    const actuatedJoints = Object.values(robot.joints)
      .filter((joint) => joint.type === JointType.REVOLUTE || joint.type === JointType.CONTINUOUS || joint.type === JointType.PRISMATIC)
      .sort((left, right) => left.name.localeCompare(right.name));

    if (actuatedJoints.length > 0) {
      xml += `\n  <actuator>\n`;
      actuatedJoints.forEach((joint) => {
        xml += `    <motor name="${escapeXmlAttribute(joint.name)}" joint="${escapeXmlAttribute(joint.name)}"/>\n`;
      });
      xml += `  </actuator>\n`;
    }
  }

  xml += `</mujoco>\n`;
  return xml;
};
