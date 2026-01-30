/**
 * MJCF (MuJoCo XML) Parser
 * Parses MuJoCo XML format and converts to RobotState
 */

import { RobotState, UrdfLink, UrdfJoint, DEFAULT_LINK, DEFAULT_JOINT, GeometryType, JointType, UrdfVisual } from '@/types';

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
    quat?: { w: number, x: number, y: number, z: number };
    fromto?: number[];
    contype?: number;
    conaffinity?: number;
    group?: number;
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

interface MJCFCompilerSettings {
    angleUnit: 'radian' | 'degree';
    meshdir: string;
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

// Parse compiler settings
function parseCompilerSettings(doc: Document): MJCFCompilerSettings {
    const compiler = doc.querySelector('compiler');
    const angleAttr = compiler?.getAttribute('angle')?.toLowerCase() || 'radian';
    const meshdir = compiler?.getAttribute('meshdir') || '';
    return {
        angleUnit: angleAttr === 'degree' ? 'degree' : 'radian',
        meshdir
    };
}

// Convert MuJoCo diaginertia + quat to URDF inertia tensor
function convertInertia(
    diaginertia: { ixx: number, iyy: number, izz: number },
    quat?: { w: number, x: number, y: number, z: number }
): { ixx: number, ixy: number, ixz: number, iyy: number, iyz: number, izz: number } {
    const { ixx: d1, iyy: d2, izz: d3 } = diaginertia;

    if (!quat) {
        return { ixx: d1, ixy: 0, ixz: 0, iyy: d2, iyz: 0, izz: d3 };
    }

    const { w, x, y, z } = quat;
    const R = [
        [1 - 2*(y*y + z*z), 2*(x*y - w*z),     2*(x*z + w*y)    ],
        [2*(x*y + w*z),     1 - 2*(x*x + z*z), 2*(y*z - w*x)    ],
        [2*(x*z - w*y),     2*(y*z + w*x),     1 - 2*(x*x + y*y)]
    ];

    const d = [d1, d2, d3];
    const ixx = d[0]*R[0][0]*R[0][0] + d[1]*R[0][1]*R[0][1] + d[2]*R[0][2]*R[0][2];
    const iyy = d[0]*R[1][0]*R[1][0] + d[1]*R[1][1]*R[1][1] + d[2]*R[1][2]*R[1][2];
    const izz = d[0]*R[2][0]*R[2][0] + d[1]*R[2][1]*R[2][1] + d[2]*R[2][2]*R[2][2];
    const ixy = d[0]*R[0][0]*R[1][0] + d[1]*R[0][1]*R[1][1] + d[2]*R[0][2]*R[1][2];
    const ixz = d[0]*R[0][0]*R[2][0] + d[1]*R[0][1]*R[2][1] + d[2]*R[0][2]*R[2][2];
    const iyz = d[0]*R[1][0]*R[2][0] + d[1]*R[1][1]*R[2][1] + d[2]*R[1][2]*R[2][2];

    return { ixx, ixy, ixz, iyy, iyz, izz };
}

function convertJointType(mjcfType: string): JointType {
    switch (mjcfType.toLowerCase()) {
        case 'hinge': return JointType.REVOLUTE;
        case 'slide': return JointType.PRISMATIC;
        case 'ball': return JointType.CONTINUOUS;
        case 'free': return JointType.CONTINUOUS;
        default: return JointType.FIXED;
    }
}

function convertGeomType(mjcfType: string): GeometryType {
    switch (mjcfType.toLowerCase()) {
        case 'box': return GeometryType.BOX;
        case 'sphere': return GeometryType.SPHERE;
        case 'cylinder': return GeometryType.CYLINDER;
        case 'capsule': return GeometryType.CYLINDER;
        case 'ellipsoid': return GeometryType.SPHERE;
        case 'mesh': return GeometryType.MESH;
        case 'plane': return GeometryType.BOX;
        default: return GeometryType.BOX;
    }
}

function parseBody(bodyElement: Element, meshMap: Map<string, MJCFMesh>): MJCFBody {
    const name = bodyElement.getAttribute('name') || `body_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const pos = parsePos(bodyElement.getAttribute('pos'));
    const euler = bodyElement.getAttribute('euler') ? parseEuler(bodyElement.getAttribute('euler')) : undefined;
    const quat = parseQuat(bodyElement.getAttribute('quat'));

    const geoms: MJCFGeom[] = [];
    const geomElements = bodyElement.querySelectorAll(':scope > geom');
    geomElements.forEach(geomEl => {
        const sizeArr = parseNumbers(geomEl.getAttribute('size'));
        const fromtoArr = parseNumbers(geomEl.getAttribute('fromto'));
        const meshAttr = geomEl.getAttribute('mesh');
        
        let inferredType = geomEl.getAttribute('type');
        if (!inferredType) {
            if (meshAttr) {
                inferredType = 'mesh';
            } else if (fromtoArr && fromtoArr.length === 6) {
                inferredType = 'capsule';
            } else if (sizeArr.length === 1) {
                inferredType = 'sphere';
            } else if (sizeArr.length === 2) {
                inferredType = 'capsule';
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
            quat: parseQuat(geomEl.getAttribute('quat')),
            fromto: fromtoArr.length > 0 ? fromtoArr : undefined,
        };

        const rgbaStr = geomEl.getAttribute('rgba');
        if (rgbaStr) {
            geom.rgba = parseNumbers(rgbaStr);
        }

        const contypeStr = geomEl.getAttribute('contype');
        const conaffinityStr = geomEl.getAttribute('conaffinity');
        const groupStr = geomEl.getAttribute('group');

        if (contypeStr) geom.contype = parseInt(contypeStr);
        if (conaffinityStr) geom.conaffinity = parseInt(conaffinityStr);
        if (groupStr) geom.group = parseInt(groupStr);

        geoms.push(geom);
    });

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
            joint.axis = {
                x: nums.length > 0 ? nums[0] : 0,
                y: nums.length > 1 ? nums[1] : 0,
                z: nums.length > 2 ? nums[2] : 1
            };
        }

        const rangeStr = jointEl.getAttribute('range');
        if (rangeStr) {
            const nums = parseNumbers(rangeStr);
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

    let inertial: MJCFInertial | undefined;
    const inertialEl = bodyElement.querySelector(':scope > inertial');
    if (inertialEl) {
        const mass = parseFloat(inertialEl.getAttribute('mass') || '0');
        const inertialPos = parsePos(inertialEl.getAttribute('pos'));
        const inertialQuat = parseQuat(inertialEl.getAttribute('quat'));

        const diaginertiaStr = inertialEl.getAttribute('diaginertia');
        let diaginertia: { ixx: number, iyy: number, izz: number } | undefined;
        if (diaginertiaStr) {
            const nums = parseNumbers(diaginertiaStr);
            diaginertia = { ixx: nums[0] || 0, iyy: nums[1] || 0, izz: nums[2] || 0 };
        }

        const fullinertiaStr = inertialEl.getAttribute('fullinertia');
        let fullinertia: number[] | undefined;
        if (fullinertiaStr) {
            fullinertia = parseNumbers(fullinertiaStr);
        }

        inertial = { mass, pos: inertialPos, quat: inertialQuat, diaginertia, fullinertia };
    }

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

    function processGeometry(geom: MJCFGeom): UrdfVisual {
        const result: UrdfVisual = { ...DEFAULT_LINK.visual };
        result.type = geom.mesh ? GeometryType.MESH : convertGeomType(geom.type);

        if (geom.mesh && meshMap.has(geom.mesh)) {
            result.meshPath = meshMap.get(geom.mesh)!.file;
            const scale = meshMap.get(geom.mesh)!.scale;
            if (scale && scale.length >= 3) {
                result.dimensions = { x: scale[0], y: scale[1], z: scale[2] };
            } else {
                result.dimensions = { x: 1, y: 1, z: 1 };
            }
        } else if (geom.mesh) {
            result.meshPath = geom.mesh;
            result.dimensions = { x: 1, y: 1, z: 1 };
        }

        if (geom.size && geom.size.length > 0) {
            const geomType = geom.type?.toLowerCase() || 'sphere';
            switch (geomType) {
                case 'box':
                    result.dimensions = {
                        x: (geom.size[0] || 0.1) * 2,
                        y: ((geom.size[1] ?? geom.size[0]) || 0.1) * 2,
                        z: ((geom.size[2] ?? geom.size[0]) || 0.1) * 2
                    };
                    break;
                case 'sphere':
                    result.dimensions = { x: geom.size[0] || 0.1, y: 0, z: 0 };
                    break;
                case 'ellipsoid':
                    result.dimensions = {
                        x: geom.size[0] || 0.1,
                        y: (geom.size[1] ?? geom.size[0]) || 0.1,
                        z: (geom.size[2] ?? geom.size[0]) || 0.1
                    };
                    break;
                case 'cylinder':
                case 'capsule':
                    result.dimensions = {
                        x: geom.size[0] || 0.1,
                        y: (geom.size[1] || 0.1) * 2,
                        z: 0
                    };
                    break;
                default:
                    result.dimensions = { x: geom.size[0] || 0.1, y: 0, z: 0 };
                    break;
            }
        } else if (!geom.mesh) {
            result.dimensions = { x: 0.05, y: 0, z: 0 };
        }

        if (geom.rgba && geom.rgba.length >= 3) {
            const r = Math.round(geom.rgba[0] * 255);
            const g = Math.round(geom.rgba[1] * 255);
            const b = Math.round(geom.rgba[2] * 255);
            result.color = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
        }

        if (geom.pos) {
            result.origin = {
                xyz: { x: geom.pos.x, y: geom.pos.y, z: geom.pos.z },
                rpy: { r: 0, p: 0, y: 0 }
            };
        }
        
        return result;
    }

    function processBody(body: MJCFBody, parentLinkId: string | null): string {
        const mainLinkId = body.name || `link_${linkCounter++}`;

        // 1. Classify Geoms
        const visuals: MJCFGeom[] = [];
        const collisions: MJCFGeom[] = [];

        body.geoms.forEach(geom => {
            const hasGroup1 = geom.group === 1;
            const hasContype0 = geom.contype === 0 && geom.conaffinity === 0;
            if (hasGroup1 && hasContype0) {
                visuals.push(geom);
            } else {
                collisions.push(geom);
            }
        });

        // 2. Pair Visuals and Collisions
        interface LinkPair { visual: MJCFGeom | null, collision: MJCFGeom | null }
        const pairs: LinkPair[] = [];
        const usedCollisions = new Set<MJCFGeom>();

        // Pass 1: Match visuals to collisions (by mesh name match)
        for (const vis of visuals) {
            let matchIndex = -1;
            if (vis.mesh) {
                matchIndex = collisions.findIndex(c => c.mesh === vis.mesh && !usedCollisions.has(c));
            } else if (vis.name) {
                matchIndex = collisions.findIndex(c => c.name === vis.name && !usedCollisions.has(c));
            }

            // Fallback for Main Link (index 0): if no strict match, grab first available collision
            // Only if this is the very first visual we are processing for the body
            if (matchIndex === -1 && pairs.length === 0 && collisions.length > 0 && !usedCollisions.has(collisions[0])) {
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
        
        let visual = { ...DEFAULT_LINK.visual };
        if (mainPair.visual) {
            visual = processGeometry(mainPair.visual);
        } else {
            visual.type = GeometryType.NONE;
        }

        let collision = { ...DEFAULT_LINK.collision };
        if (mainPair.collision) {
            const colGeo = processGeometry(mainPair.collision);
            collision = {
                ...collision,
                type: colGeo.type,
                dimensions: colGeo.dimensions,
                origin: colGeo.origin,
                meshPath: colGeo.meshPath
            };
            if (mainPair.collision.rgba) {
                collision.color = colGeo.color;
            }
        } else {
            collision.type = GeometryType.NONE;
        }

        let linkInertial = { ...DEFAULT_LINK.inertial };
        if (body.inertial) {
            const { mass, pos: inertialPos, quat: inertialQuat, diaginertia, fullinertia } = body.inertial;
            linkInertial.mass = mass;
            linkInertial.origin = {
                xyz: { x: inertialPos.x, y: inertialPos.y, z: inertialPos.z },
                rpy: { r: 0, p: 0, y: 0 }
            };
            if (fullinertia && fullinertia.length >= 6) {
                linkInertial.inertia = {
                    ixx: fullinertia[0], iyy: fullinertia[1], izz: fullinertia[2],
                    ixy: fullinertia[3], ixz: fullinertia[4], iyz: fullinertia[5]
                };
            } else if (diaginertia) {
                linkInertial.inertia = convertInertia(diaginertia, inertialQuat);
            }
        }

        const mainLink: UrdfLink = {
            ...DEFAULT_LINK,
            id: mainLinkId,
            name: body.name,
            visual,
            collision,
            inertial: linkInertial
        };
        links[mainLinkId] = mainLink;

        // Create Main Joint
        if (parentLinkId) {
            const mjcfJoint = body.joints[0];
            const jointId = mjcfJoint?.name || `joint_${jointCounter++}`;
            const joint: UrdfJoint = {
                ...DEFAULT_JOINT,
                id: jointId,
                name: jointId,
                type: mjcfJoint ? convertJointType(mjcfJoint.type) : JointType.FIXED,
                parentLinkId: parentLinkId,
                childLinkId: mainLinkId,
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
            rootLinkId = mainLinkId;
        }

        // Process Virtual Links (Pairs 1..N)
        for (let i = 1; i < pairs.length; i++) {
            const pair = pairs[i];
            const subLinkId = `${mainLinkId}_geom_${i}`;
            const subJointId = `fixed_${subLinkId}`;

            // Virtual Link Visual
            let subVisual = { ...DEFAULT_LINK.visual };
            if (pair.visual) {
                subVisual = processGeometry(pair.visual);
            } else {
                subVisual.type = GeometryType.NONE;
            }

            // Virtual Link Collision
            let subCollision = { ...DEFAULT_LINK.collision };
            if (pair.collision) {
                const colGeo = processGeometry(pair.collision);
                subCollision = {
                    ...subCollision,
                    type: colGeo.type,
                    dimensions: colGeo.dimensions,
                    origin: colGeo.origin,
                    meshPath: colGeo.meshPath
                };
                if (pair.collision.rgba) {
                    subCollision.color = colGeo.color;
                }
            } else {
                subCollision.type = GeometryType.NONE;
            }

            const subLink: UrdfLink = {
                ...DEFAULT_LINK,
                id: subLinkId,
                name: subLinkId,
                visual: subVisual,
                collision: subCollision,
                inertial: { ...DEFAULT_LINK.inertial, mass: 0 } // Massless virtual link
            };
            links[subLinkId] = subLink;

            // Fixed Joint connecting Main -> Sub
            const subJoint: UrdfJoint = {
                ...DEFAULT_JOINT,
                id: subJointId,
                name: subJointId,
                type: JointType.FIXED,
                parentLinkId: mainLinkId,
                childLinkId: subLinkId,
                origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
                axis: { x: 0, y: 0, z: 1 }
            };
            joints[subJointId] = subJoint;
        }

        body.children.forEach(child => processBody(child, mainLinkId));
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
        selection: { type: 'link', id: rootLinkId }
    };
}

export function parseMJCF(xmlContent: string): RobotState | null {
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlContent, 'text/xml');

        const parseError = doc.querySelector('parsererror');
        if (parseError) {
            console.error('[MJCF Parser] XML parsing error:', parseError.textContent);
            return null;
        }

        const mujocoEl = doc.querySelector('mujoco');
        if (!mujocoEl) {
            console.error('[MJCF Parser] No <mujoco> root element found');
            return null;
        }

        const compilerSettings = parseCompilerSettings(doc);
        const modelName = mujocoEl.getAttribute('model') || 'mjcf_robot';

        const meshMap = new Map<string, MJCFMesh>();
        const assetEl = mujocoEl.querySelector('asset');
        if (assetEl) {
            const meshElements = assetEl.querySelectorAll('mesh');
            meshElements.forEach(meshEl => {
                const name = meshEl.getAttribute('name');
                const fileAttribute = meshEl.getAttribute('file');
                
                if (name && fileAttribute) {
                    let file = fileAttribute;
                    if (compilerSettings.meshdir && !file.startsWith('/') && !file.includes(':')) {
                        const prefix = compilerSettings.meshdir.endsWith('/') 
                            ? compilerSettings.meshdir 
                            : `${compilerSettings.meshdir}/`;
                        file = `${prefix}${file}`;
                    }

                    const scale = parseNumbers(meshEl.getAttribute('scale'));
                    meshMap.set(name, { name, file, scale: scale.length >= 3 ? scale : undefined });
                }
            });
        }

        const worldbodyEl = mujocoEl.querySelector('worldbody');
        if (!worldbodyEl) {
            console.error('[MJCF Parser] No <worldbody> element found');
            return null;
        }

        // Parse worldbody as the root body to capture direct geoms and child bodies
        const rootBody = parseBody(worldbodyEl, meshMap);
        // Ensure it has a standard name if none provided (worldbody tag usually has no name)
        if (!worldbodyEl.getAttribute('name')) {
            rootBody.name = 'world';
        }

        return mjcfToRobotState(modelName, [rootBody], meshMap);

    } catch (error) {
        console.error('[MJCF Parser] Failed to parse MJCF:', error);
        return null;
    }
}

export function isMJCF(xmlContent: string): boolean {
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlContent, 'text/xml');
        return doc.querySelector('mujoco') !== null;
    } catch {
        return false;
    }
}