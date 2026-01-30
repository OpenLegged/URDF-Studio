/**
 * MJCF (MuJoCo XML) Parser
 * Parses MuJoCo XML format and converts to RobotState
 */

import { RobotState, UrdfLink, UrdfJoint, DEFAULT_LINK, DEFAULT_JOINT, GeometryType, JointType } from '@/types';

interface MJCFBody {
    name: string;
    pos: { x: number, y: number, z: number };
    euler?: { r: number, p: number, y: number };
    quat?: { w: number, x: number, y: number, z: number };
    geoms: MJCFGeom[];
    joints: MJCFJointDef[];
    inertial?: MJCFInertial;
    children: MJCFBody[];
}

interface MJCFGeom {
    name?: string;
    type: string;
    size?: number[];
    mesh?: string;
    rgba?: number[];
    pos?: { x: number, y: number, z: number };
    fromto?: number[];
}

interface MJCFJointDef {
    name: string;
    type: string;
    axis?: { x: number, y: number, z: number };
    range?: [number, number];
    pos?: { x: number, y: number, z: number };
}

interface MJCFInertial {
    mass: number;
    pos: { x: number, y: number, z: number };
    quat?: { w: number, x: number, y: number, z: number };
    diaginertia?: { ixx: number, iyy: number, izz: number };
    fullinertia?: number[]; // ixx iyy izz ixy ixz iyz
}

interface MJCFMesh {
    name: string;
    file: string;
    scale?: number[];
}

// Parse space-separated numbers
function parseNumbers(str: string | null): number[] {
    if (!str) return [];
    return str.trim().split(/\s+/).map(s => {
        const num = parseFloat(s);
        return isNaN(num) ? 0 : num;
    });
}

// Parse xyz position
function parsePos(str: string | null): { x: number, y: number, z: number } {
    const nums = parseNumbers(str);
    return {
        x: nums.length > 0 ? nums[0] : 0,
        y: nums.length > 1 ? nums[1] : 0,
        z: nums.length > 2 ? nums[2] : 0
    };
}

// Parse euler angles (in radians)
function parseEuler(str: string | null): { r: number, p: number, y: number } {
    const nums = parseNumbers(str);
    return {
        r: nums.length > 0 ? nums[0] : 0,
        p: nums.length > 1 ? nums[1] : 0,
        y: nums.length > 2 ? nums[2] : 0
    };
}

// Parse quaternion (w x y z)
function parseQuat(str: string | null): { w: number, x: number, y: number, z: number } | undefined {
    const nums = parseNumbers(str);
    if (nums.length < 4) return undefined;
    return { w: nums[0], x: nums[1], y: nums[2], z: nums[3] };
}

// Convert MuJoCo diaginertia + quat to URDF inertia tensor
// MuJoCo stores principal moments (diagonal) and rotation (quat)
// URDF needs full 6-element inertia tensor in link frame
function convertInertia(
    diaginertia: { ixx: number, iyy: number, izz: number },
    quat?: { w: number, x: number, y: number, z: number }
): { ixx: number, ixy: number, ixz: number, iyy: number, iyz: number, izz: number } {
    const { ixx: d1, iyy: d2, izz: d3 } = diaginertia;

    // If no rotation, return diagonal inertia
    if (!quat) {
        return { ixx: d1, ixy: 0, ixz: 0, iyy: d2, iyz: 0, izz: d3 };
    }

    // Build rotation matrix from quaternion (w, x, y, z)
    // MuJoCo uses (w, x, y, z) format
    const { w, x, y, z } = quat;

    // Rotation matrix R from quaternion (row-major)
    // R[i][j] means row i, column j
    const R = [
        [1 - 2*(y*y + z*z), 2*(x*y - w*z),     2*(x*z + w*y)    ],
        [2*(x*y + w*z),     1 - 2*(x*x + z*z), 2*(y*z - w*x)    ],
        [2*(x*z - w*y),     2*(y*z + w*x),     1 - 2*(x*x + y*y)]
    ];

    // I = R * D * R^T where D = diag(d1, d2, d3)
    // I_ij = sum_k (R_ik * D_kk * R_jk)
    const d = [d1, d2, d3];

    const ixx = d[0]*R[0][0]*R[0][0] + d[1]*R[0][1]*R[0][1] + d[2]*R[0][2]*R[0][2];
    const iyy = d[0]*R[1][0]*R[1][0] + d[1]*R[1][1]*R[1][1] + d[2]*R[1][2]*R[1][2];
    const izz = d[0]*R[2][0]*R[2][0] + d[1]*R[2][1]*R[2][1] + d[2]*R[2][2]*R[2][2];
    const ixy = d[0]*R[0][0]*R[1][0] + d[1]*R[0][1]*R[1][1] + d[2]*R[0][2]*R[1][2];
    const ixz = d[0]*R[0][0]*R[2][0] + d[1]*R[0][1]*R[2][1] + d[2]*R[0][2]*R[2][2];
    const iyz = d[0]*R[1][0]*R[2][0] + d[1]*R[1][1]*R[2][1] + d[2]*R[1][2]*R[2][2];

    return { ixx, ixy, ixz, iyy, iyz, izz };
}

// Convert MJCF joint type to URDF joint type
function convertJointType(mjcfType: string): JointType {
    switch (mjcfType.toLowerCase()) {
        case 'hinge': return JointType.REVOLUTE;
        case 'slide': return JointType.PRISMATIC;
        case 'ball': return JointType.CONTINUOUS; // Approximation
        case 'free': return JointType.CONTINUOUS; // No floating in our JointType, use continuous
        default: return JointType.FIXED;
    }
}

// Convert MJCF geometry type to URDF geometry type
function convertGeomType(mjcfType: string): GeometryType {
    switch (mjcfType.toLowerCase()) {
        case 'box': return GeometryType.BOX;
        case 'sphere': return GeometryType.SPHERE;
        case 'cylinder': return GeometryType.CYLINDER;
        case 'capsule': return GeometryType.CYLINDER; // Approximation - rendered as cylinder
        case 'ellipsoid': return GeometryType.SPHERE; // Approximation - rendered as scaled sphere
        case 'mesh': return GeometryType.MESH;
        case 'plane': return GeometryType.BOX; // Approximation
        default: return GeometryType.BOX;
    }
}

// Parse body element recursively
function parseBody(bodyElement: Element, meshMap: Map<string, MJCFMesh>): MJCFBody {
    const name = bodyElement.getAttribute('name') || `body_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const pos = parsePos(bodyElement.getAttribute('pos'));
    const euler = bodyElement.getAttribute('euler') ? parseEuler(bodyElement.getAttribute('euler')) : undefined;
    const quat = parseQuat(bodyElement.getAttribute('quat'));

    // Parse geoms
    const geoms: MJCFGeom[] = [];
    const geomElements = bodyElement.querySelectorAll(':scope > geom');
    geomElements.forEach(geomEl => {
        // Parse size and fromto first for type inference
        const sizeArr = parseNumbers(geomEl.getAttribute('size'));
        const fromtoArr = parseNumbers(geomEl.getAttribute('fromto'));
        const meshAttr = geomEl.getAttribute('mesh');
        
        // Infer geometry type according to MJCF specification:
        // 1. Explicit type attribute takes priority
        // 2. If mesh attribute exists → 'mesh'
        // 3. If fromto attribute exists → 'capsule' (MJCF default)
        // 4. Based on size array length (MJCF defaults):
        //    - 1 element → sphere
        //    - 2 elements → capsule (MJCF default for 2-element size)
        //    - 3 elements → ellipsoid
        // 5. Default → sphere
        let inferredType = geomEl.getAttribute('type');
        if (!inferredType) {
            if (meshAttr) {
                inferredType = 'mesh';
            } else if (fromtoArr && fromtoArr.length === 6) {
                inferredType = 'capsule';
            } else if (sizeArr.length === 1) {
                inferredType = 'sphere';
            } else if (sizeArr.length === 2) {
                inferredType = 'capsule'; // MJCF default for 2-element size
            } else if (sizeArr.length >= 3) {
                inferredType = 'ellipsoid';
            } else {
                inferredType = 'sphere';
            }
        }
        
        const geom: MJCFGeom = {
            name: geomEl.getAttribute('name') || undefined,
            type: inferredType,
            size: sizeArr,
            mesh: meshAttr || undefined,
            pos: geomEl.getAttribute('pos') ? parsePos(geomEl.getAttribute('pos')) : undefined,
            fromto: fromtoArr.length > 0 ? fromtoArr : undefined,
        };

        const rgbaStr = geomEl.getAttribute('rgba');
        if (rgbaStr) {
            geom.rgba = parseNumbers(rgbaStr);
        }

        geoms.push(geom);
    });

    // Parse joints
    const joints: MJCFJointDef[] = [];
    const jointElements = bodyElement.querySelectorAll(':scope > joint');
    jointElements.forEach(jointEl => {
        const joint: MJCFJointDef = {
            name: jointEl.getAttribute('name') || `joint_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            type: jointEl.getAttribute('type') || 'hinge',
        };

        const axisStr = jointEl.getAttribute('axis');
        if (axisStr) {
            const nums = parseNumbers(axisStr);
            // Use array length check - 0 is a valid axis component
            joint.axis = {
                x: nums.length > 0 ? nums[0] : 0,
                y: nums.length > 1 ? nums[1] : 0,
                z: nums.length > 2 ? nums[2] : 1  // Default Z to 1 if not specified
            };
        }

        const rangeStr = jointEl.getAttribute('range');
        if (rangeStr) {
            const nums = parseNumbers(rangeStr);
            // Use array length check to preserve valid 0 values
            joint.range = [
                nums.length > 0 ? nums[0] : -Math.PI,
                nums.length > 1 ? nums[1] : Math.PI
            ];
        }

        const posStr = jointEl.getAttribute('pos');
        if (posStr) {
            joint.pos = parsePos(posStr);
        }

        joints.push(joint);
    });

    // Parse inertial
    let inertial: MJCFInertial | undefined;
    const inertialEl = bodyElement.querySelector(':scope > inertial');
    if (inertialEl) {
        const mass = parseFloat(inertialEl.getAttribute('mass') || '0');
        const inertialPos = parsePos(inertialEl.getAttribute('pos'));
        const inertialQuat = parseQuat(inertialEl.getAttribute('quat'));

        // Parse diaginertia (ixx iyy izz)
        const diaginertiaStr = inertialEl.getAttribute('diaginertia');
        let diaginertia: { ixx: number, iyy: number, izz: number } | undefined;
        if (diaginertiaStr) {
            const nums = parseNumbers(diaginertiaStr);
            diaginertia = { ixx: nums[0] || 0, iyy: nums[1] || 0, izz: nums[2] || 0 };
        }

        // Parse fullinertia (ixx iyy izz ixy ixz iyz)
        const fullinertiaStr = inertialEl.getAttribute('fullinertia');
        let fullinertia: number[] | undefined;
        if (fullinertiaStr) {
            fullinertia = parseNumbers(fullinertiaStr);
        }

        inertial = { mass, pos: inertialPos, quat: inertialQuat, diaginertia, fullinertia };
    }

    // Parse child bodies
    const children: MJCFBody[] = [];
    const childBodyElements = bodyElement.querySelectorAll(':scope > body');
    childBodyElements.forEach(childEl => {
        children.push(parseBody(childEl, meshMap));
    });

    return { name, pos, euler, quat, geoms, joints, inertial, children };
}

// Convert parsed MJCF to RobotState
function mjcfToRobotState(
    robotName: string,
    bodies: MJCFBody[],
    meshMap: Map<string, MJCFMesh>
): RobotState {
    const links: Record<string, UrdfLink> = {};
    const joints: Record<string, UrdfJoint> = {};
    let rootLinkId = '';
    let linkCounter = 0;
    let jointCounter = 0;

    // Process body recursively
    function processBody(body: MJCFBody, parentLinkId: string | null): string {
        const linkId = body.name || `link_${linkCounter++}`;

        // Determine visual geometry from first geom
        let visual = { ...DEFAULT_LINK.visual };
        if (body.geoms.length > 0) {
            const geom = body.geoms[0];
            visual.type = geom.mesh ? GeometryType.MESH : convertGeomType(geom.type);

            if (geom.mesh && meshMap.has(geom.mesh)) {
                visual.meshPath = meshMap.get(geom.mesh)!.file;
                const scale = meshMap.get(geom.mesh)!.scale;
                if (scale && scale.length >= 3) {
                    // Store scale in dimensions (will be applied during render)
                    visual.dimensions = { x: scale[0], y: scale[1], z: scale[2] };
                } else {
                    // Default scale 1:1:1 for meshes without explicit scale
                    visual.dimensions = { x: 1, y: 1, z: 1 };
                }
            } else if (geom.mesh) {
                // Mesh referenced but not in meshMap - still set default scale
                visual.meshPath = geom.mesh;
                visual.dimensions = { x: 1, y: 1, z: 1 };
            }

            // Parse size - use dimensions: x=radius, y=length for cylinder; xyz for box
            if (geom.size && geom.size.length > 0) {
                const geomType = geom.type?.toLowerCase() || 'sphere';
                switch (geomType) {
                    case 'box':
                        visual.dimensions = {
                            x: (geom.size[0] || 0.1) * 2,
                            y: ((geom.size[1] ?? geom.size[0]) || 0.1) * 2,
                            z: ((geom.size[2] ?? geom.size[0]) || 0.1) * 2
                        };
                        break;
                    case 'sphere':
                        visual.dimensions = { x: geom.size[0] || 0.1, y: 0, z: 0 };
                        break;
                    case 'ellipsoid':
                        // Ellipsoid uses 3 radii
                        visual.dimensions = {
                            x: geom.size[0] || 0.1,
                            y: (geom.size[1] ?? geom.size[0]) || 0.1,
                            z: (geom.size[2] ?? geom.size[0]) || 0.1
                        };
                        break;
                    case 'cylinder':
                    case 'capsule':
                        visual.dimensions = {
                            x: geom.size[0] || 0.1,  // radius
                            y: (geom.size[1] || 0.1) * 2,  // length (MJCF uses half-length)
                            z: 0
                        };
                        break;
                    default:
                        // For unknown types with size, treat as sphere
                        visual.dimensions = { x: geom.size[0] || 0.1, y: 0, z: 0 };
                        break;
                }
            } else if (!geom.mesh) {
                // No size and no mesh - use small default sphere dimensions
                visual.dimensions = { x: 0.05, y: 0, z: 0 };
            }

            // Parse color
            if (geom.rgba && geom.rgba.length >= 3) {
                const r = Math.round(geom.rgba[0] * 255);
                const g = Math.round(geom.rgba[1] * 255);
                const b = Math.round(geom.rgba[2] * 255);
                visual.color = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
            }

            // Handle origin offset from geom pos
            if (geom.pos) {
                visual.origin = {
                    xyz: { x: geom.pos.x, y: geom.pos.y, z: geom.pos.z },
                    rpy: { r: 0, p: 0, y: 0 }
                };
            }
        }

        // Build inertial data
        let linkInertial = { ...DEFAULT_LINK.inertial };
        if (body.inertial) {
            const { mass, pos: inertialPos, quat: inertialQuat, diaginertia, fullinertia } = body.inertial;
            linkInertial.mass = mass;
            linkInertial.origin = {
                xyz: { x: inertialPos.x, y: inertialPos.y, z: inertialPos.z },
                rpy: { r: 0, p: 0, y: 0 }
            };

            if (fullinertia && fullinertia.length >= 6) {
                // Full inertia tensor provided: ixx iyy izz ixy ixz iyz
                linkInertial.inertia = {
                    ixx: fullinertia[0],
                    iyy: fullinertia[1],
                    izz: fullinertia[2],
                    ixy: fullinertia[3],
                    ixz: fullinertia[4],
                    iyz: fullinertia[5]
                };
            } else if (diaginertia) {
                // Convert diagonal inertia + quaternion to full tensor
                linkInertial.inertia = convertInertia(diaginertia, inertialQuat);
            }
        }

        // Create link
        const link: UrdfLink = {
            ...DEFAULT_LINK,
            id: linkId,
            name: body.name,
            visual,
            inertial: linkInertial
        };
        links[linkId] = link;

        // Create joint connecting to parent (if exists)
        if (parentLinkId) {
            // Use first joint definition if available
            const mjcfJoint = body.joints[0];
            const jointId = mjcfJoint?.name || `joint_${jointCounter++}`;

            const joint: UrdfJoint = {
                ...DEFAULT_JOINT,
                id: jointId,
                name: jointId,
                type: mjcfJoint ? convertJointType(mjcfJoint.type) : JointType.FIXED,
                parentLinkId: parentLinkId,
                childLinkId: linkId,
                origin: {
                    xyz: { x: body.pos.x, y: body.pos.y, z: body.pos.z },
                    rpy: body.euler || { r: 0, p: 0, y: 0 }
                },
                axis: mjcfJoint?.axis || { x: 0, y: 0, z: 1 }
            };

            if (mjcfJoint?.range) {
                joint.limit = {
                    lower: mjcfJoint.range[0],
                    upper: mjcfJoint.range[1],
                    effort: 100,
                    velocity: 1
                };
            }

            joints[jointId] = joint;
        } else {
            rootLinkId = linkId;
        }

        // Process children
        body.children.forEach(child => {
            processBody(child, linkId);
        });

        return linkId;
    }

    // Process all top-level bodies
    bodies.forEach((body, index) => {
        const linkId = processBody(body, index === 0 ? null : rootLinkId);
        if (index === 0) {
            rootLinkId = linkId;
        }
    });

    // If no bodies, create a default root link
    if (!rootLinkId) {
        rootLinkId = 'base_link';
        links[rootLinkId] = {
            ...DEFAULT_LINK,
            id: rootLinkId,
            name: 'base_link'
        };
    }

    return {
        name: robotName,
        links,
        joints,
        rootLinkId,
        selection: { type: 'link', id: rootLinkId }
    };
}

/**
 * Parse MJCF (MuJoCo XML) content and convert to RobotState
 */
export function parseMJCF(xmlContent: string): RobotState | null {
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlContent, 'text/xml');

        // Check for parsing errors
        const parseError = doc.querySelector('parsererror');
        if (parseError) {
            console.error('[MJCF Parser] XML parsing error:', parseError.textContent);
            return null;
        }

        // Find mujoco root element
        const mujocoEl = doc.querySelector('mujoco');
        if (!mujocoEl) {
            console.error('[MJCF Parser] No <mujoco> root element found');
            return null;
        }

        // Get model name
        const modelName = mujocoEl.getAttribute('model') || 'mjcf_robot';

        // Parse meshes from asset section
        const meshMap = new Map<string, MJCFMesh>();
        const assetEl = mujocoEl.querySelector('asset');
        if (assetEl) {
            const meshElements = assetEl.querySelectorAll('mesh');
            meshElements.forEach(meshEl => {
                const name = meshEl.getAttribute('name');
                const file = meshEl.getAttribute('file');
                if (name && file) {
                    const scale = parseNumbers(meshEl.getAttribute('scale'));
                    meshMap.set(name, { name, file, scale: scale.length >= 3 ? scale : undefined });
                }
            });
        }

        // Parse worldbody
        const worldbodyEl = mujocoEl.querySelector('worldbody');
        if (!worldbodyEl) {
            console.error('[MJCF Parser] No <worldbody> element found');
            return null;
        }

        // Parse all body elements in worldbody
        const bodies: MJCFBody[] = [];
        const bodyElements = worldbodyEl.querySelectorAll(':scope > body');
        bodyElements.forEach(bodyEl => {
            bodies.push(parseBody(bodyEl, meshMap));
        });

        // Convert to RobotState
        return mjcfToRobotState(modelName, bodies, meshMap);

    } catch (error) {
        console.error('[MJCF Parser] Failed to parse MJCF:', error);
        return null;
    }
}

/**
 * Check if XML content is MJCF format
 */
export function isMJCF(xmlContent: string): boolean {
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlContent, 'text/xml');
        return doc.querySelector('mujoco') !== null;
    } catch {
        return false;
    }
}
