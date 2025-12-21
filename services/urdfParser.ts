
import { RobotState, UrdfLink, UrdfJoint, GeometryType, JointType, DEFAULT_LINK, DEFAULT_JOINT } from '../types';

export const parseURDF = (xmlString: string): RobotState | null => {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, "text/xml");
  const robotEl = xmlDoc.querySelector("robot");
  if (!robotEl) {
      console.error("Invalid URDF: No <robot> tag found.");
      return null;
  }

  const name = robotEl.getAttribute("name") || "imported_robot";
  const links: Record<string, UrdfLink> = {};
  const joints: Record<string, UrdfJoint> = {};

  const parseVec3 = (str: string | null) => {
    if (!str) return { x: 0, y: 0, z: 0 };
    const parts = str.trim().split(/\s+/).map(Number);
    return { x: parts[0] || 0, y: parts[1] || 0, z: parts[2] || 0 };
  };

  const parseRPY = (str: string | null) => {
    if (!str) return { r: 0, p: 0, y: 0 };
    const parts = str.trim().split(/\s+/).map(Number);
    return { r: parts[0] || 0, p: parts[1] || 0, y: parts[2] || 0 };
  };

  const parseGeometry = (geoEl: Element | null, defaultGeo: any) => {
      if (!geoEl) return defaultGeo;
      
      const box = geoEl.querySelector("box");
      const cylinder = geoEl.querySelector("cylinder");
      const sphere = geoEl.querySelector("sphere");
      const mesh = geoEl.querySelector("mesh");

      if (box) {
          return {
              type: GeometryType.BOX,
              dimensions: parseVec3(box.getAttribute("size")),
          };
      } else if (cylinder) {
          return {
              type: GeometryType.CYLINDER,
              dimensions: {
                  x: parseFloat(cylinder.getAttribute("radius") || "0.1"),
                  y: parseFloat(cylinder.getAttribute("length") || "0.5"),
                  z: 0
              }
          };
      } else if (sphere) {
          return {
              type: GeometryType.SPHERE,
              dimensions: {
                  x: parseFloat(sphere.getAttribute("radius") || "0.1"),
                  y: 0, z: 0
              }
          };
      } else if (mesh) {
          const filename = mesh.getAttribute("filename") || "";
          // Extract just the filename from package paths like "package://robot/meshes/file.stl"
          const cleanName = filename.split('/').pop() || "";
          return {
              type: GeometryType.MESH,
              dimensions: { x: 1, y: 1, z: 1 }, // Scale not supported in this simple parser yet
              meshPath: cleanName
          };
      }
      return defaultGeo;
  };

  // 1. Parse Links
  robotEl.querySelectorAll("link").forEach(linkEl => {
      const linkName = linkEl.getAttribute("name");
      if (!linkName) return;
      const id = linkName; // Use name as ID for imported structure

      // Visual
      const visualEl = linkEl.querySelector("visual");
      const visualOriginEl = visualEl?.querySelector("origin");
      
      let visualGeo;
      if (visualEl) {
          visualGeo = parseGeometry(visualEl.querySelector("geometry"), DEFAULT_LINK.visual);
      } else {
          // If no visual tag exists, map to NONE
          visualGeo = { type: GeometryType.NONE, dimensions: { x:0, y:0, z:0 } };
      }
      
      // Collision
      const collisionEl = linkEl.querySelector("collision");
      const collisionOriginEl = collisionEl?.querySelector("origin");
      
      let collisionGeo;
      if (collisionEl) {
          collisionGeo = parseGeometry(collisionEl.querySelector("geometry"), DEFAULT_LINK.collision);
      } else {
          // If no collision tag exists, map to NONE
          collisionGeo = { type: GeometryType.NONE, dimensions: { x:0, y:0, z:0 } };
      }

      // Inertial
      const inertialEl = linkEl.querySelector("inertial");
      const massEl = inertialEl?.querySelector("mass");
      const inertiaEl = inertialEl?.querySelector("inertia");
      const inertialOriginEl = inertialEl?.querySelector("origin");

      links[id] = {
          id,
          name: linkName,
          visual: {
              ...DEFAULT_LINK.visual,
              ...visualGeo,
              origin: {
                  xyz: parseVec3(visualOriginEl?.getAttribute("xyz")),
                  rpy: parseRPY(visualOriginEl?.getAttribute("rpy"))
              },
              // Attempt to recover color if material is simple (rudimentary check)
              color: '#3b82f6' 
          },
          collision: {
              ...DEFAULT_LINK.collision,
              ...collisionGeo,
              origin: {
                  xyz: parseVec3(collisionOriginEl?.getAttribute("xyz")),
                  rpy: parseRPY(collisionOriginEl?.getAttribute("rpy"))
              }
          },
          inertial: {
              mass: parseFloat(massEl?.getAttribute("value") || "0"),
              origin: inertialOriginEl ? {
                  xyz: parseVec3(inertialOriginEl.getAttribute("xyz")),
                  rpy: parseRPY(inertialOriginEl.getAttribute("rpy"))
              } : undefined,
              inertia: {
                  ixx: parseFloat(inertiaEl?.getAttribute("ixx") || "0"),
                  ixy: parseFloat(inertiaEl?.getAttribute("ixy") || "0"),
                  ixz: parseFloat(inertiaEl?.getAttribute("ixz") || "0"),
                  iyy: parseFloat(inertiaEl?.getAttribute("iyy") || "0"),
                  iyz: parseFloat(inertiaEl?.getAttribute("iyz") || "0"),
                  izz: parseFloat(inertiaEl?.getAttribute("izz") || "0"),
              }
          }
      };
  });

  // 2. Parse Joints
  robotEl.querySelectorAll("joint").forEach(jointEl => {
      const jointName = jointEl.getAttribute("name");
      if (!jointName) return;
      const id = jointName;

      const parentEl = jointEl.querySelector("parent");
      const childEl = jointEl.querySelector("child");
      const originEl = jointEl.querySelector("origin");
      const axisEl = jointEl.querySelector("axis");
      const limitEl = jointEl.querySelector("limit");
      const dynamicsEl = jointEl.querySelector("dynamics");
      const hardwareEl = jointEl.querySelector("hardware");

      let hardware = { 
          armature: 0, 
          motorType: 'None', 
          motorId: '', 
          motorDirection: 1 as 1 | -1 
      };

      if (hardwareEl) {
          hardware = {
              motorType: hardwareEl.querySelector("motorType")?.textContent || 'None',
              motorId: hardwareEl.querySelector("motorId")?.textContent || '',
              motorDirection: (parseInt(hardwareEl.querySelector("motorDirection")?.textContent || "1") as 1 | -1),
              armature: parseFloat(hardwareEl.querySelector("armature")?.textContent || "0")
          };
      }

      joints[id] = {
          id,
          name: jointName,
          type: (jointEl.getAttribute("type") as JointType) || JointType.REVOLUTE,
          parentLinkId: parentEl?.getAttribute("link") || "",
          childLinkId: childEl?.getAttribute("link") || "",
          origin: {
              xyz: parseVec3(originEl?.getAttribute("xyz")),
              rpy: parseRPY(originEl?.getAttribute("rpy"))
          },
          axis: parseVec3(axisEl?.getAttribute("xyz") || "0 0 1"),
          limit: {
              lower: parseFloat(limitEl?.getAttribute("lower") || "-1.57"),
              upper: parseFloat(limitEl?.getAttribute("upper") || "1.57"),
              effort: parseFloat(limitEl?.getAttribute("effort") || "100"),
              velocity: parseFloat(limitEl?.getAttribute("velocity") || "10")
          },
          dynamics: {
              damping: parseFloat(dynamicsEl?.getAttribute("damping") || "0"),
              friction: parseFloat(dynamicsEl?.getAttribute("friction") || "0")
          },
          hardware: hardware
      };
  });

  // 3. Find Root
  // The root link is the one that is never a child in any joint
  const childLinkIds = new Set(Object.values(joints).map(j => j.childLinkId));
  const rootId = Object.keys(links).find(id => !childLinkIds.has(id));

  if (!rootId) {
      console.warn("Could not determine root link. Selecting first link.");
  }

  const finalRootId = rootId || Object.keys(links)[0];

  return {
      name,
      links,
      joints,
      rootLinkId: finalRootId,
      selection: { type: 'link', id: finalRootId }
  };
};
