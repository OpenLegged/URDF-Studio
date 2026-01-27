/**
 * URDF Generator
 * Generates URDF XML format from RobotState
 */

import { RobotState, UrdfLink, UrdfJoint, GeometryType } from '@/types';

// Helper to convert hex color to RGBA string
const hexToRgba = (hex: string): string => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (result) {
    const r = parseInt(result[1], 16) / 255;
    const g = parseInt(result[2], 16) / 255;
    const b = parseInt(result[3], 16) / 255;
    return `${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)} 1.0`;
  }
  return '0.5 0.5 0.5 1.0'; // fallback gray
};

export const generateURDF = (robot: RobotState, extended: boolean = false): string => {
  const { name, links, joints, rootLinkId } = robot;

  let xml = `<?xml version="1.0"?>\n<robot name="${name}">\n\n`;

  // Helper to format numbers
  const f = (n: number) => n.toFixed(4);
  const vecStr = (v: { x: number; y: number; z: number }) => `${f(v.x)} ${f(v.y)} ${f(v.z)}`;
  const rotStr = (v: { r: number; p: number; y: number }) => `${f(v.r)} ${f(v.p)} ${f(v.y)}`;

  // Generate Links
  Object.values(links).forEach((link) => {
    xml += `  <link name="${link.name}">\n`;

    // Visual
    if (link.visual.type !== GeometryType.NONE) {
        xml += `    <visual>\n`;
        if (link.visual.origin) {
            xml += `      <origin xyz="${vecStr(link.visual.origin.xyz)}" rpy="${rotStr(link.visual.origin.rpy)}" />\n`;
        }

        xml += `      <geometry>\n`;
        if (link.visual.type === GeometryType.BOX) {
          xml += `        <box size="${vecStr(link.visual.dimensions)}" />\n`;
        } else if (link.visual.type === GeometryType.CYLINDER) {
          xml += `        <cylinder radius="${f(link.visual.dimensions.x)}" length="${f(link.visual.dimensions.y)}" />\n`;
        } else if (link.visual.type === GeometryType.SPHERE) {
          xml += `        <sphere radius="${f(link.visual.dimensions.x)}" />\n`;
        } else if (link.visual.type === GeometryType.MESH) {
           const filename = link.visual.meshPath ? `package://${name}/meshes/${link.visual.meshPath}` : 'package://robot/meshes/part.stl';
           xml += `        <mesh filename="${filename}" />\n`;
        }
        xml += `      </geometry>\n`;
        xml += `      <material name="${link.id}_mat">\n`;
        xml += `        <color rgba="${hexToRgba(link.visual.color || '#808080')}"/>\n`;
        xml += `      </material>\n`;
        xml += `    </visual>\n`;
    }

    // Collision
    if (link.collision && link.collision.type !== GeometryType.NONE) {
        xml += `    <collision>\n`;
        if (link.collision.origin) {
            xml += `      <origin xyz="${vecStr(link.collision.origin.xyz)}" rpy="${rotStr(link.collision.origin.rpy)}" />\n`;
        }
        xml += `      <geometry>\n`;
         if (link.collision.type === GeometryType.BOX) {
          xml += `        <box size="${vecStr(link.collision.dimensions)}" />\n`;
        } else if (link.collision.type === GeometryType.CYLINDER) {
          xml += `        <cylinder radius="${f(link.collision.dimensions.x)}" length="${f(link.collision.dimensions.y)}" />\n`;
        } else if (link.collision.type === GeometryType.SPHERE) {
          xml += `        <sphere radius="${f(link.collision.dimensions.x)}" />\n`;
        } else if (link.collision.type === GeometryType.MESH) {
           const filename = link.collision.meshPath ? `package://${name}/meshes/${link.collision.meshPath}` : 'package://robot/meshes/part_collision.stl';
           xml += `        <mesh filename="${filename}" />\n`;
        }
        xml += `      </geometry>\n`;
        xml += `    </collision>\n`;
    }

    // Inertial
    xml += `    <inertial>\n`;
    if (link.inertial.origin) {
      xml += `      <origin xyz="${vecStr(link.inertial.origin.xyz)}" rpy="${rotStr(link.inertial.origin.rpy)}" />\n`;
    }
    xml += `      <mass value="${link.inertial.mass}" />\n`;
    xml += `      <inertia ixx="${f(link.inertial.inertia.ixx)}" ixy="${f(link.inertial.inertia.ixy)}" ixz="${f(link.inertial.inertia.ixz)}" iyy="${f(link.inertial.inertia.iyy)}" iyz="${f(link.inertial.inertia.iyz)}" izz="${f(link.inertial.inertia.izz)}" />\n`;
    xml += `    </inertial>\n`;
    xml += `  </link>\n\n`;
  });

  // Generate Joints
  Object.values(joints).forEach((joint) => {
    const parent = links[joint.parentLinkId];
    const child = links[joint.childLinkId];
    if (!parent || !child) return;

    xml += `  <joint name="${joint.name}" type="${joint.type}">\n`;
    xml += `    <parent link="${parent.name}" />\n`;
    xml += `    <child link="${child.name}" />\n`;
    xml += `    <origin xyz="${vecStr(joint.origin.xyz)}" rpy="${rotStr(joint.origin.rpy)}" />\n`;
    if (joint.type !== 'fixed') {
        xml += `    <axis xyz="${vecStr(joint.axis)}" />\n`;
        xml += `    <limit lower="${joint.limit.lower}" upper="${joint.limit.upper}" effort="${joint.limit.effort}" velocity="${joint.limit.velocity}" />\n`;
        if (joint.dynamics && (joint.dynamics.damping !== 0 || joint.dynamics.friction !== 0)) {
            xml += `    <dynamics damping="${joint.dynamics.damping}" friction="${joint.dynamics.friction}" />\n`;
        }

        // Extended Hardware Info
        if (extended && joint.hardware) {
            xml += `    <hardware>\n`;
            if (joint.hardware.motorType) xml += `      <motorType>${joint.hardware.motorType}</motorType>\n`;
            if (joint.hardware.motorId) xml += `      <motorId>${joint.hardware.motorId}</motorId>\n`;
            if (joint.hardware.motorDirection) xml += `      <motorDirection>${joint.hardware.motorDirection}</motorDirection>\n`;
            if (joint.hardware.armature !== undefined) xml += `      <armature>${joint.hardware.armature}</armature>\n`;
            xml += `    </hardware>\n`;
        }
    }
    xml += `  </joint>\n\n`;
  });

  xml += `</robot>`;
  return xml;
};
